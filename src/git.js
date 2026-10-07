import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { scrubEmails } from './privacy.js';
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
// subject; then, after a newline, the values of the message's `Co-authored-by:` trailers,
// one per line (key matched case-insensitively, folded lines unfolded; nothing when there
// are none; raw, not mailmapped: see mailmapCoAuthors). A subject (%s) never contains a
// newline and a trailer value is one line, so the first "\n" of the last field ends the
// subject, and whatever a trailer value contains (\x1f too) stays in the trailer part.
const US = '\x1f';
const NUMSTAT = /^[\r\n]*(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
export const LOG_FORMAT = '%H%x1f%aN%x1f%aE%x1f%aI%x1f%P%x1f%s%n%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)';

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
 * `{hash, author, email, date, parents, coAuthors: [{name, email}], subject,
 * files: [{path, added, removed, binary}], filesChanged, linesAdded, linesRemoved}`
 * (parents: array of hashes; a merge has more than one; coAuthors: the Co-authored-by
 * trailers in message order, as written, see parseCoAuthor). Binary files count as 0 lines.
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
    current = {
      hash,
      author,
      email,
      // git >= 2.5x prints UTC as "Z", older git as "+00:00": normalize so output is stable.
      date: date.replace(/Z$/i, '+00:00'),
      parents: parents.split(' ').filter(Boolean),
      coAuthors: nl < 0 ? [] : coAuthorsOf(last.slice(nl + 1)),
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
 * `commits` is []for a repo without commits. When HEAD has no commits (a new repo, or an
 * orphan branch) the result also has `unborn: true` and `otherRefs` (see hasOtherRefs):
 * only HEAD's history is read, so other branches' commits are not seen. Throws a TypeError for an invalid
 * `limit`, and a user-facing Error for: a missing path ("path does not exist: <path>"),
 * a file ("not a directory: <path>"), a folder that is not a repo ("not a git repository:
 * <path>"), git's safe.directory ownership check, a missing git, or oversized output.
 */
export async function readHistory(repoPath, { since, until, author, limit = DEFAULT_LIMIT, maxBuffer = MAX_BUFFER, coAuthors = true } = {}) {
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
  const boundary = await shallowBoundary(repoPath);
  if (boundary) {
    for (const c of commits) {
      if (!boundary.has(c.hash)) continue;
      Object.assign(c, { files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
    }
  }
  return { commits, truncated, limit, shallow: Boolean(boundary) };
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
 * `<label>/` ("src/x.js" in repo "api" → "api/src/x.js"); the inputs are not changed.
 * Order: by author-date instant, newest first; equal instants (and unparseable dates,
 * which sort last) keep their input order: repo by repo, each in git's order.
 * A commit whose hash was already seen in an earlier repo (a fork or a second clone that
 * shares history) is counted once, under the first repo. `truncated` is true when any
 * input was truncated or the merged history has more than `limit` commits; with each
 * repo read with the same `limit`, the result is the `limit` most recent commits of all
 * repos together. Returns `{commits, truncated}`.
 */
export function mergeHistories(histories, { limit = DEFAULT_LIMIT } = {}) {
  const seen = new Set();
  const merged = [];
  for (const { label, commits } of histories ?? []) {
    for (const c of commits ?? []) {
      if (c.hash && seen.has(c.hash)) continue;
      if (c.hash) seen.add(c.hash);
      merged.push({ ...c, repo: label, files: (c.files ?? []).map((f) => ({ ...f, path: `${label}/${f.path}` })) });
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
