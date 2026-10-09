import { execFile, spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { scrubEmails } from './privacy.js';
import { hasMessageBody } from './stats/messages.js';
import { localParts } from './stats/time.js';

const execFileAsync = promisify(execFile);

// `git log -z` terminates each record with NUL, which git never allows inside a
// commit message, name or email. Fields are split on the unit separator (\x1f);
// the subject is the last field, so a stray \x1f or \x1e in a subject is kept.
//
// With `--numstat`, the same output also carries per-file stats. Observed byte layout
// (git 2.43 and later), one NUL-terminated token per item:
//
//   <header>\0                          commit with no file changes (empty, merge)
//   <header>\0\n<a>\t<r>\t<path>\0...     commit with files: "\n" before the first entry
//
// where <a>/<r> are line counts, or "-" for binary files. Paths are raw (never quoted)
// and may contain spaces, tabs, newlines and \x1f. A rename would be
// `<a>\t<r>\t\0<old>\0<new>\0`; we pass --no-renames so a rename is reported as a
// delete plus an add (simpler and stable across user config), but the parser still
// understands the rename form. Merge commits get no numstat by default, so files: [].
//
// Fields: hash, author name and email (mailmapped: %aN/%aE, matching how --author is
// matched with --use-mailmap), author date, parent hashes (space-separated; >1 = merge),
// subject; then, after a newline, the committer date (%cI, strict ISO, on a line of its own:
// see COMMITTER_DATE), then the values of the message's `Co-authored-by:` trailers,
// one per line (key matched case-insensitively, folded lines unfolded; nothing when there
// are none; raw, not mailmapped: see mailmapCoAuthors). A subject (%s) never contains a
// newline and a trailer value is one line, so the first "\n" of the last field ends the
// subject, and whatever a trailer value contains (\x1f too) stays in the trailer part.
const US = '\x1f';
const NUMSTAT = /^[\r\n]*(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
export const LOG_FORMAT = '%H%x1f%aN%x1f%aE%x1f%aI%x1f%P%x1f%s%n%cI%n%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)';

/**
 * The committer date line after the subject: strict ISO 8601 as %cI prints it. The line is
 * always consumed as the committer date line; a value that is not a valid date of this
 * shape (an fsck-invalid zone such as "+123:45", a 5-digit year) is dropped, not read as a
 * co-author.
 */
const COMMITTER_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * A `Name <email>` Co-authored-by value. %cI never prints "<", so a line after the subject
 * shaped like this can only come from a record without the committer date line (output of
 * the older format, as hand-built test records are): it is then left for the co-authors.
 */
const CO_AUTHOR_LINE = /<[^<>]*>\s*$/;

const MAX_BUFFER = 256 * 1024 * 1024;

/** Default cap on analyzed commits: the most recent DEFAULT_LIMIT are read. */
export const DEFAULT_LIMIT = 50_000;

// Variables that would make git ignore `-C <path>` or stop repo discovery early.
const STRIPPED_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Slack for git's pre-filter: committer dates may be a little older than author dates. */
export const SINCE_SLACK_DAYS = 7;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Git-side since bound: SINCE_SLACK_DAYS before `since` (a bare YYYY-MM-DD is local
 * midnight). git filters on the committer date, which can be slightly older than the
 * author date (clock skew, `git commit --date`), and the author's own calendar day can
 * start up to a day before the machine's, so git gets a looser bound and the exact
 * author-date filter runs in JS. An unparseable value is passed through unchanged.
 * Returns null when the bound would fall before 1970-01-01 (git cannot parse it, and no
 * commit is older anyway): then no git-side filter is needed.
 */
function gitSince(since) {
  if (DATE_ONLY.test(since)) {
    const [y, m, d] = since.split('-').map(Number);
    const t = new Date(y, m - 1, d - SINCE_SLACK_DAYS);
    if (t.getTime() < 0) return null;
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} 00:00:00`;
  }
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) return since;
  const t = ms - SINCE_SLACK_DAYS * 86_400_000;
  return t < 0 ? null : new Date(t).toISOString();
}

/** A commit's author-local calendar day ('YYYY-MM-DD', as in the stats), or null. */
const authorDay = (c) => localParts(c.date)?.dayKey ?? null;

/**
 * The exact author-date window as a predicate on parsed commits. A YYYY-MM-DD bound is
 * compared with the commit's author-local calendar day (the day every stat uses), so the
 * window does not depend on the machine's timezone; any other value is read as an
 * instant (Date.parse), and an unparseable one is ignored. Commits with an unparseable
 * date never match a set bound.
 */
function windowFilter(since, until) {
  const bound = (value, cmpDay, cmpMs) => {
    if (!value) return null;
    if (DATE_ONLY.test(value)) {
      return (c) => {
        const day = authorDay(c);
        return day !== null && cmpDay(day, value);
      };
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : (c) => cmpMs(Date.parse(c.date), ms);
  };
  const tests = [
    bound(since, (d, v) => d >= v, (t, ms) => t >= ms),
    bound(until, (d, v) => d <= v, (t, ms) => t <= ms),
  ].filter(Boolean);
  return (c) => tests.every((t) => t(c));
}

/** Format of the index pass: hash and strict ISO author date. */
const INDEX_FORMAT = '%H%x1f%aI';

/** The full-record part of the `git log` arguments (format, numstat and diff settings). */
const DETAIL_ARGS = [
  `--format=${LOG_FORMAT}`,
  // Per-file stats. --no-renames keeps paths independent of diff.renames config;
  // diff.relative is disabled via `-c` in readCommits (works on any git version).
  '--numstat',
  '--no-renames',
  // --root: log.showRoot=false would otherwise drop the root commit's files.
  // -O/dev/null: ignore diff.orderFile so files stay in git's path order.
  '--root',
  '-O/dev/null',
  // A submodule bump (gitlink) is not a file edit.
  '--ignore-submodules=all',
];

/** Largest value git accepts for --max-count (a C int). */
const GIT_INT_MAX = 2 ** 31 - 1;

/**
 * Build the argument list for `git log` (without `-C <path>`).
 * Arguments are passed straight to execFile (no shell), so values are never interpreted.
 * `since` is sent as --since-as-filter (git >= 2.37), which checks every commit's
 * committer date; plain --since would stop walking at the first older commit and drop
 * newer commits behind it (e.g. merged from an old branch). The bound is
 * SINCE_SLACK_DAYS looser than `since`: it is only a pre-filter, and the caller applies
 * the exact author-date filter. With `sinceAsFilter: false` (older git) no date filter is
 * sent at all.
 */
export function buildLogArgs({ since, author, maxCount, sinceAsFilter = true, index = false } = {}) {
  const args = [
    'log',
    '-z',
    '--no-color',
    '--no-show-signature',
    '--encoding=UTF-8',
    // Apply .mailmap to --author matching even when log.mailmap=false is configured.
    '--use-mailmap',
  ];
  if (index) {
    // Hash and author date only: the cheap first pass of a windowed read (see readHistory).
    args.push(`--format=${INDEX_FORMAT}`);
  } else {
    args.push(...DETAIL_ARGS);
  }
  if (maxCount !== undefined) {
    if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new TypeError(`maxCount must be a positive integer, got ${maxCount}`);
    args.push(`--max-count=${maxCount}`);
  }
  const gitBound = since && sinceAsFilter ? gitSince(since) : null;
  if (gitBound) args.push(`--since-as-filter=${gitBound}`);
  if (author) {
    // Exact email match, case-insensitive: git matches --author against "Name <email>".
    args.push('--fixed-strings', '--regexp-ignore-case', `--author=<${author}>`);
  }
  return args;
}

/**
 * One `Co-authored-by:` trailer value as `{name, email}` (whitespace runs collapsed, both
 * trimmed): the email is the last "<...>" holding an "@" (else the last "<...>"), the
 * name the text before it without angle brackets, and text after it is dropped
 * ("Ada <ada@x.io> (she/her)" → Ada, ada@x.io). Without a "<...>" the whole value is the
 * name and the email is empty. Null when both come out empty.
 */
export function parseCoAuthor(value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  const all = [...v.matchAll(/<([^<>]*)>/g)];
  const m = all.findLast((x) => x[1].includes('@')) ?? all.at(-1);
  const name = (m ? v.slice(0, m.index) : v).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const email = m ? m[1].trim() : '';
  return name || email ? { name, email } : null;
}

/**
 * The co-authors of the trailer part (one value per line, see LOG_FORMAT). git older
 * than 2.22 does not know the trailer options and prints the placeholder as is: no co-authors.
 */
const coAuthorsOf = (part) => (part.startsWith('%(trailers') ? [] : part.split('\n').map(parseCoAuthor).filter(Boolean));

/**
 * Parse `git log -z --numstat --format=LOG_FORMAT` output into commit objects:
 * `{hash, author, email, date, committerDate, parents, coAuthors: [{name, email}], subject,
 * files: [{path, added, removed, binary}], filesChanged, linesAdded, linesRemoved}`
 * (parents: array of hashes; a merge has more than one; coAuthors: the Co-authored-by
 * trailers in message order, as written, see parseCoAuthor; committerDate: the strict ISO
 * committer date, "Z" normalized like `date`, present only when the record has one, see
 * COMMITTER_DATE). Binary files count as 0 lines.
 * Output without numstat entries also parses (files: []). Pure function: returns [] for empty output.
 */
export function parseLog(stdout) {
  if (!stdout) return [];
  const commits = [];
  let current = null;
  const tokens = String(stdout).split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Numstat entries come before header detection: a hex hash never contains a tab.
    const stat = NUMSTAT.exec(token);
    if (stat) {
      let path = stat[3];
      // Rename form: empty path, then old and new path as their own tokens.
      if (path === '') {
        i += 2;
        path = tokens[i] ?? '';
      }
      if (!current) continue;
      const binary = stat[1] === '-' || stat[2] === '-';
      const added = binary ? 0 : Number(stat[1]);
      const removed = binary ? 0 : Number(stat[2]);
      current.files.push({ path, added, removed, binary });
      current.filesChanged += 1;
      current.linesAdded += added;
      current.linesRemoved += removed;
      continue;
    }
    const trimmed = token.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (trimmed === '') continue;
    const fields = trimmed.split(US);
    if (fields.length < 6) continue;
    const [hash, author, email, date, parents, ...rest] = fields;
    // The subject ends at the first newline; the Co-authored-by values follow it.
    const last = rest.join(US);
    const nl = last.indexOf('\n');
    // The line after the subject is the committer date line (%cI): always consumed, never a
    // co-author, and kept only when it is a valid strict ISO date (see COMMITTER_DATE).
    let after = nl < 0 ? '' : last.slice(nl + 1);
    const nl2 = after.indexOf('\n');
    const line = (nl2 < 0 ? after : after.slice(0, nl2)).replace(/\r$/, '');
    const committed = COMMITTER_DATE.test(line) && Number.isFinite(Date.parse(line)) ? line.replace(/Z$/i, '+00:00') : null;
    if (!CO_AUTHOR_LINE.test(line)) after = nl2 < 0 ? '' : after.slice(nl2 + 1);
    current = {
      hash,
      author,
      email,
      // git >= 2.5x prints UTC as "Z", older git as "+00:00": normalize so output is stable.
      date: date.replace(/Z$/i, '+00:00'),
      ...(committed ? { committerDate: committed } : {}),
      parents: parents.split(' ').filter(Boolean),
      coAuthors: after === '' ? [] : coAuthorsOf(after),
      subject: nl < 0 ? last : last.slice(0, nl),
      files: [],
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    commits.push(current);
  }
  return commits;
}

function gitEnv() {
  const env = { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' };
  for (const name of STRIPPED_ENV) delete env[name];
  return env;
}

/** Fail fast, before running git, when `repoPath` is missing or not a directory. */
function checkRepoPath(repoPath) {
  let st;
  try {
    st = statSync(repoPath);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') throw new Error(`path does not exist: ${repoPath}`);
    throw new Error(`cannot access ${repoPath}: ${err?.code ?? err?.message ?? err}`);
  }
  if (!st.isDirectory()) throw new Error(`not a directory: ${repoPath}`);
}

/** Shell-quote `p` for the user's platform, for a copy-paste command hint. */
export function quoteForShell(p, platform = process.platform) {
  const s = String(p);
  if (platform === 'win32') return `"${s.replace(/"/g, '\\"')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** A user-facing Error when the git executable itself cannot be started, else null. */
function spawnError(err) {
  if (err?.code === 'ENOENT') return new Error('git not found on PATH; install git and try again');
  // EINVAL: on Windows, Node refuses to spawn a .cmd/.bat "git" shim without a shell.
  // EACCES: a "git" on PATH that is not executable.
  if (err?.code === 'EINVAL' || err?.code === 'EACCES') {
    return new Error(
      `could not run git (${err.code}): the "git" found on PATH cannot be started directly. ` +
        'On Windows, make sure PATH points at git.exe (Git for Windows), not a git.cmd or git.bat wrapper.',
    );
  }
  return null;
}

let gitVersionPromise = null;

/**
 * The installed git version as [major, minor, patch] (e.g. "git version 2.39.3 (Apple
 * Git-145)" → [2, 39, 3]), read once per process. Rejects when git cannot be started.
 */
export function gitVersion() {
  gitVersionPromise ??= execFileAsync('git', ['--version'], { encoding: 'utf8', env: gitEnv() }).then(
    ({ stdout }) => {
      const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [0, 0, 0];
    },
    (err) => {
      gitVersionPromise = null;
      throw spawnError(err) ?? new Error(`git --version failed: ${err?.message ?? err}`);
    },
  );
  return gitVersionPromise;
}

/** True when `version` ([major, minor, ...]) is at least major.minor. */
export function versionAtLeast(version, major, minor) {
  return version[0] > major || (version[0] === major && version[1] >= minor);
}

/**
 * True when the repo has at least one branch, remote-tracking branch or tag (any ref under
 * refs/heads, refs/remotes or refs/tags); false when it has none or git fails. Used to
 * explain an empty run on an unborn / orphan HEAD whose history lives on other branches.
 */
export async function hasOtherRefs(repoPath) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'for-each-ref', '--count=1', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Hashes of a shallow clone's boundary commits (their parents are missing, so git diffs
 * them against an empty tree), or null when the repo is not shallow. Best effort: any
 * failure counts as "not shallow".
 */
async function shallowBoundary(repoPath) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--is-shallow-repository', '--git-path', 'shallow'], {
      encoding: 'utf8',
      env: gitEnv(),
    });
    const [flag, file] = stdout.split('\n');
    if (flag.trim() !== 'true' || !file) return null;
    const text = readFileSync(isAbsolute(file) ? file : join(repoPath, file), 'utf8');
    return new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * Read the history of the repo at `repoPath`, newest first, capped at `limit` commits
 * (default 50,000: the most recent ones; `Infinity` means no cap). Returns
 * `{commits, truncated, limit, shallow}` where `truncated` is true when more than `limit`
 * commits matched the filters, and `shallow` is true for a shallow clone (its boundary
 * commits get empty file stats: git would otherwise count their whole tree as added).
 * `since` / `until` (inclusive) filter on the author date: a YYYY-MM-DD bound compares the
 * commit's author-local calendar day, the same day the stats use, so a window gives the
 * same commits in every machine timezone. On git >= 2.37 git pre-filters `since` with
 * --since-as-filter (committer date, with slack) so --max-count still caps the output;
 * older git gets no date filter and everything is filtered in JS.
 * `until` has no git-side filter: git's --until checks the committer date, which can be
 * any amount later than the author date (rebase, cherry-pick, squash merge). Instead a
 * cheap first pass lists hashes and author dates only, the window and cap are applied to
 * that list, and only the selected commits are read in full (see readWindow).
 * Each commit's `coAuthors` (its Co-authored-by trailers) go through the repo's .mailmap
 * like its author does (see mailmapCoAuthors); `coAuthors: false` skips that git call for
 * a read whose co-authors are not used (they are then left as written).
 * A commit that tags point at gets `tags`, their names (see readTags); `tags: false`
 * skips that git call for a read whose releases are not used.
 * A commit whose message says "This reverts commit <hash>" gets `revertOf`, those hashes
 * (see readReverts); `reverts: false` skips that git call for a read whose reverts are not used.
 * Every commit gets `hasBody`, whether its message has a body beyond the subject (see
 * readBodies); `bodies: false` skips that git call for a read whose message bodies are not used.
 * A commit that adds, deletes or renames files gets `born` / `buried`, those paths, and
 * `renamed`, `[{from, to}]` (see readLifecycle); `lifecycle: false` skips that git call for a read whose file lifecycle
 * is not used.
 * `commits` is [] for a repo without commits. When HEAD has no commits (a new repo, or an
 * orphan branch) the result also has `unborn: true` and `otherRefs` (see hasOtherRefs):
 * only HEAD's history is read, so other branches' commits are not seen. Throws a TypeError for an invalid
 * `limit`, and a user-facing Error for: a missing path ("path does not exist: <path>"),
 * a file ("not a directory: <path>"), a folder that is not a repo ("not a git repository:
 * <path>"), git's safe.directory ownership check, a missing git, or oversized output.
 */
export async function readHistory(repoPath, { since, until, author, limit = DEFAULT_LIMIT, maxBuffer = MAX_BUFFER, coAuthors = true, tags = true, reverts = true, bodies = true, lifecycle = true } = {}) {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new TypeError(`limit must be a positive integer or Infinity, got ${limit}`);
  }
  checkRepoPath(repoPath);
  const sinceAsFilter = since ? versionAtLeast(await gitVersion(), 2, 37) : true;
  const inWindow = windowFilter(since, until);
  const log = { since, author, maxBuffer, sinceAsFilter, windowed: Boolean(since || until) };

  let commits;
  if (until) {
    commits = await readWindow(repoPath, log, inWindow, limit);
  } else {
    // Ask git for one extra commit so a history of exactly `limit` commits is not
    // "truncated". git parses --max-count as a C int (newer git rejects larger values), so
    // a limit that big is the same as no cap: skip --max-count and cut in JS below.
    // Without a git-side date filter (old git), git cannot cap a --since run at all.
    const canCap = limit + 1 <= GIT_INT_MAX && (!since || sinceAsFilter);
    commits = await runLog(repoPath, { ...log, maxCount: canCap ? limit + 1 : undefined });
    if (commits !== null) {
      let filtered = commits.filter(inWindow);
      // git's pre-filter checks the committer date with some slack: a rebased commit (old
      // author date, new committer date) or one inside the slack window can use up a
      // capped slot and then fail the author-date filter. If fewer than limit + 1 commits
      // survive, the cap may have hidden matching ones: read again without it. (When
      // limit + 1 survive, the capped read is a prefix of the full one, so the result is
      // the same.)
      if (canCap && since && commits.length === limit + 1 && filtered.length <= limit) {
        filtered = ((await runLog(repoPath, log)) ?? []).filter(inWindow);
      }
      commits = filtered;
    }
  }
  if (commits === null) {
    return { commits: [], truncated: false, limit, shallow: false, unborn: true, otherRefs: await hasOtherRefs(repoPath) };
  }
  const truncated = commits.length > limit;
  if (truncated) commits = commits.slice(0, limit);
  if (coAuthors) await mailmapCoAuthors(repoPath, commits);
  if (tags) await readTags(repoPath, commits);
  if (reverts) await readReverts(repoPath, commits);
  if (bodies) await readBodies(repoPath, commits);
  if (lifecycle) await readLifecycle(repoPath, commits);
  const boundary = await shallowBoundary(repoPath);
  if (boundary) {
    for (const c of commits) {
      if (!boundary.has(c.hash)) continue;
      Object.assign(c, { files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
      // Diffed against an empty tree: its whole tree would count as born.
      delete c.born;
      delete c.buried;
      delete c.renamed;
    }
  }
  return { commits, truncated, limit, shallow: Boolean(boundary) };
}

/**
 * `git show-ref --tags -d` output → Map of tag name → the commit (or other object) it
 * points at, peeled: an annotated tag's "<hash> refs/tags/<name>^{}" line (the object it
 * finally points at, through tags of tags too) wins over its own "<hash> refs/tags/<name>";
 * a lightweight tag has only the latter. Ref names never contain whitespace, so each line
 * is "<hash> <ref>". Pure function.
 */
export function parseTagRefs(stdout) {
  const peeled = new Map();
  for (const line of String(stdout ?? '').split('\n')) {
    const m = /^([0-9a-f]+) refs\/tags\/(\S+?)(\^\{\})?\r?$/i.exec(line);
    if (!m) continue;
    const [, hash, name, deref] = m;
    if (deref || !peeled.has(name)) peeled.set(name, hash.toLowerCase());
  }
  return peeled;
}

/**
 * Give every commit that tags point at (lightweight or annotated, peeled to the commit)
 * `tags`: their names, sorted; commits without a tag are left without the field. One
 * `git show-ref --tags -d` call. Only the given commits are matched, so the window,
 * --author and the cap apply to releases as to everything else. Best effort: when git
 * fails (or the repo has no tags, where show-ref exits 1), no commit gets tags. Returns
 * `commits`.
 */
export async function readTags(repoPath, commits) {
  if (!Array.isArray(commits) || commits.length === 0) return commits;
  let refs;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'show-ref', '--tags', '-d'], { encoding: 'utf8', env: gitEnv(), maxBuffer: MAX_BUFFER });
    refs = parseTagRefs(stdout);
  } catch {
    return commits;
  }
  const byHash = new Map();
  for (const [name, hash] of refs) {
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(name);
  }
  if (byHash.size === 0) return commits;
  for (const c of commits) {
    const names = typeof c?.hash === 'string' ? byHash.get(c.hash.toLowerCase()) : undefined;
    if (names) c.tags = [...names].sort();
  }
  return commits;
}

/**
 * The line `git revert` writes into a revert's message: "This reverts commit <hash>" at
 * the start of a line (leading blanks allowed; abbreviated hashes too, as people paste
 * them; up to 64 hex digits for SHA-256 repos). Mid-line mentions ("see This reverts
 * commit …") do not count.
 */
const REVERTS_LINE = /^[ \t]*This reverts commit ([0-9a-f]{7,64})(?![0-9a-z])/gim;

/**
 * The commits a message says it reverts: the hashes of its "This reverts commit <hash>"
 * lines (see REVERTS_LINE), lowercased, distinct, in order. [] for none. Pure function.
 */
export function revertTargets(message) {
  if (typeof message !== 'string' || !message) return [];
  return [...new Set([...message.matchAll(REVERTS_LINE)].map((m) => m[1].toLowerCase()))];
}

/**
 * `git log -z --format=%H%x1f%B` output → Map of commit hash → the hashes its message
 * says it reverts (see revertTargets); commits without such a line are left out. Each
 * record is NUL-terminated (git never allows NUL in a message) and the hash is hex, so
 * the first \x1f ends it whatever the message holds. Pure function.
 */
export function parseRevertLog(stdout) {
  const found = new Map();
  for (const rec of String(stdout ?? '').split('\0')) {
    const us = rec.indexOf(US);
    if (us < 0) continue;
    const hash = rec.slice(0, us).replace(/^[\r\n]+/, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(hash)) continue;
    const targets = revertTargets(rec.slice(us + 1));
    if (targets.length > 0) found.set(hash, targets);
  }
  return found;
}

/**
 * Give every commit whose message (subject or body) has a line starting "This reverts
 * commit <hash>" (see REVERTS_LINE; what `git revert` writes, for a "Revert" and a
 * "Reapply" alike) `revertOf`: those hashes (see revertTargets); other commits are left without the field. LOG_FORMAT
 * carries only the subject and the Co-authored-by trailers (a raw body could hold
 * anything), so the bodies are read by one extra `git log -z --no-walk=unsorted --stdin`
 * call over exactly the given commits (hashes on stdin: no command-line length limit, and
 * the window, --author and the cap apply as to everything else) that git itself filters
 * with `--grep` (extended regexp anchored at a line start, as git matches --grep per line;
 * case-insensitive like REVERTS_LINE; set on the command line so grep.patternType cannot
 * change it): only the revert commits' messages come back, and the line is checked again
 * here. Every option used works on any git this tool supports. Best effort: when git
 * fails, no commit gets `revertOf` (a `Revert "…"` subject still counts, see
 * stats/reverts.js). Returns `commits`.
 */
export async function readReverts(repoPath, commits) {
  if (!Array.isArray(commits) || commits.length === 0) return commits;
  const hashes = commits.map((c) => c?.hash).filter((h) => typeof h === 'string' && /^[0-9a-f]+$/i.test(h));
  if (hashes.length === 0) return commits;
  let found;
  try {
    const run = execFileAsync(
      'git',
      ['-C', repoPath, 'log', '-z', '--no-walk=unsorted', '--stdin', '--no-color', '--no-show-signature', '--encoding=UTF-8', '--extended-regexp', '--regexp-ignore-case', '--grep=^[[:blank:]]*This reverts commit [0-9a-f]{7}', '--format=%H%x1f%B'],
      { encoding: 'utf8', env: gitEnv(), maxBuffer: MAX_BUFFER },
    );
    run.child.stdin.on('error', () => {}); // git exiting early (EPIPE) surfaces below
    run.child.stdin.end(`${hashes.join('\n')}\n`);
    found = parseRevertLog((await run).stdout);
  } catch {
    return commits;
  }
  if (found.size === 0) return commits;
  for (const c of commits) {
    const targets = typeof c?.hash === 'string' ? found.get(c.hash.toLowerCase()) : undefined;
    if (targets) c.revertOf = targets;
  }
  return commits;
}

/**
 * One `%H%x1f%b` record (see parseBodyLog) → `[hash, hasBody]` (hash lowercased), or null
 * when it is not one (no \x1f, or a non-hex hash). Newlines (and CRs) before the hash, as
 * `-z` output may put between records, are skipped.
 */
function parseBodyRecord(rec) {
  const us = rec.indexOf(US);
  if (us < 0) return null;
  const hash = rec.slice(0, us).replace(/^[\r\n]+/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(hash)) return null;
  return [hash, hasMessageBody(rec.slice(us + 1))];
}

/**
 * `git log -z --format=%H%x1f%b` output → Map of commit hash (lowercase) → whether its
 * message has a body beyond the subject (see hasMessageBody in stats/messages.js: blank
 * lines, trailers and git's revert boilerplate ignored). Each record is NUL-terminated
 * (git never allows NUL in a message) and the hash is hex, so the first \x1f ends it
 * whatever the body holds. Pure function (readBodies parses the same records as they
 * stream in).
 */
export function parseBodyLog(stdout) {
  const found = new Map();
  for (const rec of String(stdout ?? '').split('\0')) {
    const parsed = parseBodyRecord(rec);
    if (parsed) found.set(parsed[0], parsed[1]);
  }
  return found;
}

/**
 * Run `git <args>` with `input` on stdin and parse its NUL-terminated stdout records as
 * they arrive (see parseBodyRecord), so only one record's bytes and a boolean per commit
 * are ever held, however long the messages are. A NUL byte never occurs inside a UTF-8
 * multi-byte sequence, so each record is cut from the raw bytes and decoded whole.
 * Resolves the Map; rejects when git cannot start, exits non-zero, or a single record
 * grows past MAX_BUFFER.
 */
function streamBodyLog(args, input) {
  return new Promise((resolve, reject) => {
    const found = new Map();
    let pending = [];
    let pendingBytes = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(err);
    };
    const take = (buf) => {
      const parsed = parseBodyRecord(buf.toString('utf8'));
      if (parsed) found.set(parsed[0], parsed[1]);
    };
    const child = spawn('git', args, { env: gitEnv(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    child.on('error', fail);
    child.stdin.on('error', () => {}); // git exiting early (EPIPE) surfaces as its exit code
    child.stdout.on('data', (chunk) => {
      if (failed) return;
      let start = 0;
      for (let nul = chunk.indexOf(0); nul >= 0; nul = chunk.indexOf(0, start)) {
        const piece = chunk.subarray(start, nul);
        take(pending.length > 0 ? Buffer.concat([...pending, piece]) : piece);
        pending = [];
        pendingBytes = 0;
        start = nul + 1;
      }
      if (start < chunk.length) {
        pending.push(chunk.subarray(start));
        pendingBytes += chunk.length - start;
        if (pendingBytes > MAX_BUFFER) fail(new Error('git log: message too large'));
      }
    });
    child.on('close', (code) => {
      if (failed) return;
      if (code !== 0) return fail(new Error(`git log exited with ${code}`));
      if (pending.length > 0) take(Buffer.concat(pending));
      resolve(found);
    });
    child.stdin.end(input);
  });
}

/**
 * Give every commit `hasBody`: whether its message says anything after the subject (the
 * first paragraph, as `%s` / `%b` split it), blank lines, trailers and git's revert
 * boilerplate ignored (see hasMessageBody). LOG_FORMAT carries only the subject and the
 * Co-authored-by trailers (a raw body could hold anything, \x1f and newlines included), so
 * the bodies are read by one extra `git log -z --no-walk=unsorted --stdin
 * --format=%H%x1f%b` call over exactly the given commits (hashes on stdin, as readReverts
 * does: the window, --author and the cap apply as to everything else). No diff is
 * computed, and the output is parsed as it streams in (see streamBodyLog): only a boolean
 * per commit is kept, never the text. Best effort and all or nothing: when git fails, no
 * commit gets `hasBody`, which stats.messages.bodies reports as null (unknown), not as
 * "no bodies". Returns `commits`.
 */
export async function readBodies(repoPath, commits) {
  if (!Array.isArray(commits) || commits.length === 0) return commits;
  const hashes = commits.map((c) => c?.hash).filter((h) => typeof h === 'string' && /^[0-9a-f]+$/i.test(h));
  if (hashes.length === 0) return commits;
  let found;
  try {
    found = await streamBodyLog(
      ['-C', repoPath, 'log', '-z', '--no-walk=unsorted', '--stdin', '--no-color', '--no-show-signature', '--encoding=UTF-8', '--format=%H%x1f%b'],
      `${hashes.join('\n')}\n`,
    );
  } catch {
    return commits;
  }
  for (const c of commits) {
    const has = typeof c?.hash === 'string' ? found.get(c.hash.toLowerCase()) : undefined;
    if (typeof has === 'boolean') c.hasBody = has;
  }
  return commits;
}

/** A commit hash as `--format=%H` prints it (SHA-1 or SHA-256, lowercase). */
const FULL_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** A `--name-status` status token: a letter, plus a score for renames / copies ("R087"). */
const NAME_STATUS = /^([A-Z])(\d*)$/;

/**
 * `git log -z --name-status --format=%H` output → Map of commit hash → `{born, buried,
 * renamed}`: the paths its diff adds (status A) and deletes (status D), and the files it
 * renames (status R, as `{from, to}`), in git's order; commits with none are left out.
 * Observed byte layout, one NUL-terminated token per item:
 *
 *   <hash>\0                                 commit with no matching file changes
 *   <hash>\0\n<status>\0<path>\0...           "\n" before the first entry
 *   ...R<score>\0<old path>\0<new path>\0...   a rename carries two paths
 *
 * A copy (C, with a score) also carries two paths and is skipped, as is every other
 * status. Paths are raw (may hold any byte but NUL), so a token is only read as a header
 * where a status could start, and a status is one uppercase letter (plus digits) while a
 * hash is 40 or 64 lowercase hex digits: they never look alike. Pure function.
 */
export function parseLifecycleLog(stdout) {
  const found = new Map();
  const tokens = String(stdout ?? '').split('\0');
  let current = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^[\r\n]+/, '');
    if (FULL_HASH.test(tok)) {
      current = { born: [], buried: [], renamed: [] };
      found.set(tok, current);
      continue;
    }
    const m = NAME_STATUS.exec(tok);
    if (!m || !current) continue;
    const paths = m[1] === 'R' || m[1] === 'C' ? 2 : 1;
    const path = tokens[i + 1];
    const to = paths === 2 ? tokens[i + 2] : undefined;
    i += paths;
    if (typeof path !== 'string' || path === '') continue;
    if (m[1] === 'A') current.born.push(path);
    else if (m[1] === 'D') current.buried.push(path);
    else if (m[1] === 'R' && typeof to === 'string' && to !== '') current.renamed.push({ from: path, to });
  }
  for (const [hash, v] of found) if (v.born.length === 0 && v.buried.length === 0 && v.renamed.length === 0) found.delete(hash);
  return found;
}

/**
 * Give every commit that adds files `born` (those paths), every commit that deletes
 * files `buried` (those paths) and every commit that renames files `renamed` (`[{from,
 * to}]`, the old and new paths), as git prints them; other commits are left without the
 * fields. The numstat read passes --no-renames (a rename is a delete plus an add there),
 * so this is one extra `git log -z --no-walk=unsorted --stdin --name-status` call over
 * exactly the given commits (hashes on stdin, as readReverts: the window, --author and the
 * cap apply as to everything else) with rename detection forced on (`-M`, whatever
 * diff.renames says) and `--diff-filter=ADR`, so a rename is neither born nor buried but
 * renamed, and a copy (when detected) is none of them: only the A, D and R entries come
 * back. A rename edited past git's similarity threshold is still an add plus a delete.
 * Same diff settings as the numstat read: merge commits get no diff (no -m), the root
 * commit does (--root), submodule bumps are skipped, diff.relative is off. Best effort:
 * when git fails, no commit gets the fields (stats.fileLifecycle is then 0 / 0 / 0).
 * Returns `commits`.
 */
export async function readLifecycle(repoPath, commits) {
  if (!Array.isArray(commits) || commits.length === 0) return commits;
  const hashes = commits.map((c) => c?.hash).filter((h) => typeof h === 'string' && /^[0-9a-f]+$/i.test(h));
  if (hashes.length === 0) return commits;
  let found;
  try {
    const run = execFileAsync(
      'git',
      ['-C', repoPath, '-c', 'diff.relative=false', 'log', '-z', '--no-walk=unsorted', '--stdin', '--no-color', '--no-show-signature', '--format=%H', '--name-status', '-M', '--diff-filter=ADR', '--root', '-O/dev/null', '--ignore-submodules=all'],
      { encoding: 'utf8', env: gitEnv(), maxBuffer: MAX_BUFFER },
    );
    run.child.stdin.on('error', () => {}); // git exiting early (EPIPE) surfaces below
    run.child.stdin.end(`${hashes.join('\n')}\n`);
    found = parseLifecycleLog((await run).stdout);
  } catch {
    return commits;
  }
  if (found.size === 0) return commits;
  for (const c of commits) {
    const hit = typeof c?.hash === 'string' ? found.get(c.hash.toLowerCase()) : undefined;
    if (!hit) continue;
    if (hit.born.length > 0) c.born = hit.born;
    if (hit.buried.length > 0) c.buried = hit.buried;
    if (hit.renamed.length > 0) c.renamed = hit.renamed;
  }
  return commits;
}

/** A co-author as a `git check-mailmap` contact line: "Name <email>", nothing that would break it. */
const contactLine = ({ name, email }) => `${String(name ?? '').replace(/[<>\r\n]/g, '')} <${String(email ?? '').replace(/[<>\r\n]/g, '')}>`;

/**
 * Map every commit's `coAuthors` through the repo's .mailmap (and mailmap.file /
 * mailmap.blob), in place, the way %aN / %aE map authors: one `git check-mailmap --stdin`
 * call with each distinct "Name <email>" contact on its own line (stdin: no command-line
 * length limit), and only when some commit has a co-author. Best effort: when git fails
 * (or answers with fewer lines than asked), the co-authors stay as written. Returns
 * `commits`.
 */
export async function mailmapCoAuthors(repoPath, commits) {
  const mapped = new Map();
  for (const c of commits ?? []) for (const p of c?.coAuthors ?? []) mapped.set(contactLine(p), null);
  if (mapped.size === 0) return commits;
  const contacts = [...mapped.keys()];
  let lines;
  try {
    const run = execFileAsync('git', ['-C', repoPath, 'check-mailmap', '--stdin'], { encoding: 'utf8', env: gitEnv(), maxBuffer: MAX_BUFFER });
    run.child.stdin.on('error', () => {}); // git exiting early (EPIPE) surfaces below
    run.child.stdin.end(`${contacts.join('\n')}\n`);
    lines = (await run).stdout.split('\n');
  } catch {
    return commits;
  }
  if (lines.length < contacts.length) return commits;
  contacts.forEach((k, i) => mapped.set(k, parseCoAuthor(lines[i].replace(/\r$/, ''))));
  for (const c of commits) {
    if (!Array.isArray(c?.coAuthors) || c.coAuthors.length === 0) continue;
    c.coAuthors = c.coAuthors.map((p) => mapped.get(contactLine(p)) ?? p);
  }
  return commits;
}

/**
 * A windowed read in two passes, so an --until run never parses numstat for commits
 * outside the window: (1) `git log --format=%H %aI` with the same pre-filters lists every
 * candidate (small: ~70 bytes a commit); the exact window applies to that list in git's
 * order and the first limit + 1 hashes are kept; (2) only those are read in full with
 * `git log --no-walk=unsorted --stdin` (hashes on stdin: no command-line length limit),
 * which keeps the given order. Same result as a full read filtered in JS. Returns the
 * window's commits (at most limit + 1), or null for a repo without commits.
 */
async function readWindow(repoPath, log, inWindow, limit) {
  const out = await gitLog(repoPath, buildLogArgs({ ...log, index: true }), log);
  if (out === null) return null;
  const picked = [];
  for (const rec of out.split('\0')) {
    const [hash, date] = rec.replace(/^[\r\n]+/, '').split(US);
    if (!hash || date === undefined) continue;
    if (!inWindow({ date: date.replace(/Z$/i, '+00:00') })) continue;
    picked.push(hash);
    if (picked.length > limit) break;
  }
  if (picked.length === 0) return [];
  const detail = await gitLog(repoPath, ['log', '--no-walk=unsorted', '--stdin', ...buildLogArgs({}).slice(1)], {
    ...log,
    maxCount: picked.length,
    input: `${picked.join('\n')}\n`,
  });
  return parseLog(detail ?? '');
}

/** Run `git log` and parse it; null for a repo without commits. */
async function runLog(repoPath, { since, author, maxBuffer, sinceAsFilter, maxCount, windowed }) {
  const out = await gitLog(repoPath, buildLogArgs({ since, author, maxCount, sinceAsFilter }), { maxBuffer, maxCount, windowed });
  return out === null ? null : parseLog(out);
}

/**
 * Run git with `args` (after `-C <path> -c diff.relative=false`), optionally feeding
 * `input` on stdin; resolves to stdout, or null for a repo without commits. Maps errors
 * to user-facing ones (`maxCount` / `windowed` pick the advice for oversized output).
 */
async function gitLog(repoPath, args, { maxBuffer, maxCount, windowed, input }) {
  let stdout;
  try {
    const run = execFileAsync('git', ['-C', repoPath, '-c', 'diff.relative=false', ...args], {
      maxBuffer,
      encoding: 'utf8',
      // LC_ALL=C forces English messages so the error checks below are reliable.
      env: gitEnv(),
    });
    if (input !== undefined) {
      run.child.stdin.on('error', () => {}); // git exiting early (EPIPE) surfaces below
      run.child.stdin.end(input);
    }
    ({ stdout } = await run);
  } catch (err) {
    const spawn = spawnError(err);
    if (spawn) throw spawn;
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const mb = Math.round(maxBuffer / (1024 * 1024));
      // Only suggest what can shrink the output: --max-commits only helps when git caps it.
      const tips = windowed ? ['a narrower --since/--until/--year window', '--author'] : ['--since', '--author'];
      const narrow = `narrow it down with ${tips.join(' or ')}`;
      throw new Error(`git log output is larger than ${mb} MB; ${maxCount !== undefined ? `${narrow}, or lower --max-commits` : narrow}`);
    }
    const stderr = String(err.stderr ?? '');
    if (/does not have any commits yet|bad default revision 'HEAD'/.test(stderr)) return null;
    if (/detected dubious ownership/i.test(stderr)) {
      const at = /dubious ownership in repository at '([^\n]+)'[ \t]*$/im.exec(stderr)?.[1] ?? repoPath;
      throw new Error(
        `git refused to read ${repoPath}: the repository is owned by another user ("dubious ownership").\n` +
          `If you trust it, run: git config --global --add safe.directory ${quoteForShell(at)}`,
      );
    }
    if (/not a git repository|cannot change to/i.test(stderr)) {
      throw new Error(`not a git repository: ${repoPath}`);
    }
    throw new Error(`git log failed: ${stderr.trim() || err.message}`);
  }
  return stdout;
}

/**
 * Control, format (bidi embeddings / overrides / isolates, zero-width characters, BOM),
 * line / paragraph separator and lone surrogate characters: never part of a repo label
 * (the cards and the recap strip them on display, which could make two labels look alike).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029\p{Cs}]/gu;

/**
 * Unique labels for several repos of a multi-repo run, in the given order: each name
 * without invisible characters (see INVISIBLE) and surrounding whitespace, with anything
 * shaped like an email address replaced by "…" (see scrubEmails; nothing left → "repo"), and a name already used gets the first free "-2", "-3",
 * ... suffix: ['app', 'app', 'web'] → ['app', 'app-2', 'web']. Labels are compared
 * case-insensitively, so 'App' and 'app' never become the same path prefix on a
 * case-insensitive file system.
 */
export function repoLabels(names) {
  const used = new Set();
  return (names ?? []).map((n) => {
    // Email-shaped text is cut (see scrubEmails), so no output shows an address in a label.
    const clean = typeof n === 'string' ? scrubEmails(n.replace(INVISIBLE, '')).trim() : '';
    const base = clean || 'repo';
    let label = base;
    for (let i = 2; used.has(label.toLowerCase()); i++) label = `${base}-${i}`;
    used.add(label.toLowerCase());
    return label;
  });
}

/**
 * Merge the histories of several repos (`histories`: `[{label, commits, truncated}]`, each
 * `commits` as readHistory gives them) into one, newest first, capped at `limit` commits.
 * Every commit is copied with `repo: <label>` and its file paths prefixed with
 * `<label>/` ("src/x.js" in repo "api" → "api/src/x.js"; its `born` / `buried` paths
 * and both paths of each `renamed` entry too); the inputs are not changed.
 * Order: by author-date instant, newest first; equal instants (and unparseable dates,
 * which sort last) keep their input order: repo by repo, each in git's order.
 * A commit whose hash was already seen in an earlier repo (a fork or a second clone that
 * shares history) is counted once, under the first repo; the tags the later repo has on it
 * (see readTags) are added to the kept copy's `tags` as `{name, repo}` (that repo's label),
 * so a release tagged only in the later repo still counts, under its own repo's name
 * (see computeReleases). `truncated` is true when any
 * input was truncated or the merged history has more than `limit` commits; with each
 * repo read with the same `limit`, the result is the `limit` most recent commits of all
 * repos together. Returns `{commits, truncated}`.
 */
export function mergeHistories(histories, { limit = DEFAULT_LIMIT } = {}) {
  const seen = new Map();
  const merged = [];
  for (const { label, commits } of histories ?? []) {
    for (const c of commits ?? []) {
      const kept = c.hash ? seen.get(c.hash) : undefined;
      if (kept) {
        // A shared commit: keep the first repo's copy, with this repo's tags added to it.
        if (Array.isArray(c.tags) && c.tags.length > 0) kept.tags = [...(kept.tags ?? []), ...c.tags.map((name) => ({ name, repo: label }))];
        continue;
      }
      const copy = { ...c, repo: label, files: (c.files ?? []).map((f) => ({ ...f, path: `${label}/${f.path}` })) };
      // Added / deleted paths (see readLifecycle) get the same prefix.
      for (const key of ['born', 'buried']) if (Array.isArray(c[key])) copy[key] = c[key].map((p) => `${label}/${p}`);
      if (Array.isArray(c.renamed)) copy.renamed = c.renamed.filter((r) => typeof r?.from === 'string' && typeof r?.to === 'string').map((r) => ({ from: `${label}/${r.from}`, to: `${label}/${r.to}` }));
      if (c.hash) seen.set(c.hash, copy);
      merged.push(copy);
    }
  }
  const time = (c) => {
    const t = Date.parse(c.date);
    return Number.isNaN(t) ? -Infinity : t;
  };
  const keyed = merged.map((c, i) => ({ c, i, t: time(c) }));
  keyed.sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1));
  const sorted = keyed.map((x) => x.c);
  const truncated = (histories ?? []).some((h) => h.truncated) || sorted.length > limit;
  return { commits: sorted.length > limit ? sorted.slice(0, limit) : sorted, truncated };
}

/**
 * Read commits from the repo at `repoPath`, newest first: `readHistory(...).commits`
 * (same options and errors). Like readHistory, it is capped by default at the most recent
 * DEFAULT_LIMIT (50,000) commits, silently; pass `limit: Infinity` to read everything, or
 * use readHistory to learn whether the result was truncated. Returns [] for a repo without commits.
 */
export async function readCommits(repoPath, opts = {}) {
  return (await readHistory(repoPath, opts)).commits;
}
