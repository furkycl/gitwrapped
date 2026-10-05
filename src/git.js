import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
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
// subject.
const US = '\x1f';
const NUMSTAT = /^[\r\n]*(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
export const LOG_FORMAT = '%H%x1f%aN%x1f%aE%x1f%aI%x1f%P%x1f%s';

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
 * author date (clock skew, `git commit --date`), so git gets a looser bound and the exact
 * author-date filter runs in JS. An unparseable value is passed through unchanged.
 */
function gitSince(since) {
  if (DATE_ONLY.test(since)) {
    const [y, m, d] = since.split('-').map(Number);
    const t = new Date(y, m - 1, d - SINCE_SLACK_DAYS);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} 00:00:00`;
  }
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? since : new Date(ms - SINCE_SLACK_DAYS * 86_400_000).toISOString();
}

/**
 * Slack for git's --until pre-filter: git filters on the committer date, which is often
 * later than the author date (rebases, rebase-merges, cherry-picks), sometimes by weeks.
 */
export const UNTIL_SLACK_DAYS = 31;

/**
 * Git-side until bound: the end of the local day UNTIL_SLACK_DAYS after `until`. It is
 * only a loose pre-filter on the committer date; the exact author-date filter runs in JS.
 * Commits whose committer date is more than UNTIL_SLACK_DAYS after `until` are not seen.
 * An unparseable value is passed through unchanged.
 */
function gitUntil(until) {
  if (DATE_ONLY.test(until)) {
    const [y, m, d] = until.split('-').map(Number);
    const t = new Date(y, m - 1, d + UNTIL_SLACK_DAYS);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} 23:59:59`;
  }
  const ms = Date.parse(until);
  return Number.isNaN(ms) ? until : new Date(ms + UNTIL_SLACK_DAYS * 86_400_000).toISOString();
}

/**
 * Exclusive upper bound as epoch ms: local midnight after the `until` day for YYYY-MM-DD
 * (so the whole day is included), else the parsed instant + 1 ms; NaN if unparseable.
 */
function untilEndMs(until) {
  if (DATE_ONLY.test(until)) {
    const [y, m, d] = until.split('-').map(Number);
    return new Date(y, m - 1, d + 1).getTime();
  }
  return Date.parse(until) + 1;
}

/**
 * The exact author-date filter for a since / until window: a function from a commit list
 * to the commits inside it. A YYYY-MM-DD bound compares the commit's author-local day
 * (from the offset in git's %aI date) as text; any other bound compares instants (a
 * commit whose date cannot be split into local parts falls back to that too).
 */
function windowFilter(since, until) {
  if (!since && !until) return (list) => list;
  const sinceDay = since && DATE_ONLY.test(since) ? since : null;
  const untilDay = until && DATE_ONLY.test(until) ? until : null;
  const min = since ? sinceMs(since) : NaN;
  const end = until ? untilEndMs(until) : NaN;
  const inWindow = (c) => {
    const t = Date.parse(c.date);
    const day = localParts(c.date)?.dayKey ?? null;
    const afterSince = !since || (sinceDay && day ? day >= sinceDay : Number.isNaN(min) || t >= min);
    const beforeUntil = !until || (untilDay && day ? day <= untilDay : Number.isNaN(end) || t < end);
    return afterSince && beforeUntil;
  };
  return (list) => list.filter(inWindow);
}

/** Since as epoch ms (local midnight for YYYY-MM-DD), or NaN if unparseable. */
function sinceMs(since) {
  if (DATE_ONLY.test(since)) {
    const [y, m, d] = since.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(since);
}

/** Largest value git accepts for --max-count (a C int). */
const GIT_INT_MAX = 2 ** 31 - 1;

/**
 * Build the argument list for `git log` (without `-C <path>`).
 * Arguments are passed straight to execFile (no shell), so values are never interpreted.
 * `since` is sent as --since-as-filter (git >= 2.37), which checks every commit's
 * committer date; plain --since would stop walking at the first older commit and drop
 * newer commits behind it (e.g. merged from an old branch). The bound is
 * SINCE_SLACK_DAYS looser than `since`: it is only a pre-filter, and the caller applies
 * the exact author-date filter. With `sinceAsFilter: false` (older git) no since filter is
 * sent at all. `until` is sent as plain --until (works on every git version: it never stops
 * the walk early), UNTIL_SLACK_DAYS looser than `until`, again only as a pre-filter.
 */
export function buildLogArgs({ since, until, author, maxCount, sinceAsFilter = true } = {}) {
  const args = [
    'log',
    '-z',
    '--no-color',
    '--no-show-signature',
    '--encoding=UTF-8',
    // Apply .mailmap to --author matching even when log.mailmap=false is configured.
    '--use-mailmap',
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
  if (maxCount !== undefined) {
    if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new TypeError(`maxCount must be a positive integer, got ${maxCount}`);
    args.push(`--max-count=${maxCount}`);
  }
  if (since && sinceAsFilter) args.push(`--since-as-filter=${gitSince(since)}`);
  if (until) args.push(`--until=${gitUntil(until)}`);
  if (author) {
    // Exact email match, case-insensitive: git matches --author against "Name <email>".
    args.push('--fixed-strings', '--regexp-ignore-case', `--author=<${author}>`);
  }
  return args;
}

/**
 * Parse `git log -z --numstat --format=LOG_FORMAT` output into commit objects:
 * `{hash, author, email, date, parents, subject, files: [{path, added, removed, binary}],
 * filesChanged, linesAdded, linesRemoved}` (parents: array of hashes; a merge has more
 * than one). Binary files count as 0 lines.
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
    current = {
      hash,
      author,
      email,
      // git >= 2.5x prints UTC as "Z", older git as "+00:00": normalize so output is stable.
      date: date.replace(/Z$/i, '+00:00'),
      parents: parents.split(' ').filter(Boolean),
      subject: rest.join(US),
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
 * `since` / `until` (YYYY-MM-DD, both inclusive) filter on each commit's author-local
 * calendar day (the day in the author's own UTC offset, the same day the stats use), so
 * the result does not depend on the machine's time zone. Other `since` / `until` values
 * are compared as instants. On git >= 2.37 git pre-filters since with --since-as-filter
 * (committer date) so --max-count still caps the output; older git gets no since filter
 * and everything is filtered in JS. git pre-filters until with a loose --until on the
 * committer date (UNTIL_SLACK_DAYS). Both pre-filters have days of slack, which also
 * covers author offsets of up to ±14 hours. `year` (a number) only changes the wording of
 * the "output too large" hint.
 * `commits` is [] for a repo without commits. Throws a TypeError for an invalid
 * `limit`, and a user-facing Error for: a missing path ("path does not exist: <path>"),
 * a file ("not a directory: <path>"), a folder that is not a repo ("not a git repository:
 * <path>"), git's safe.directory ownership check, a missing git, or oversized output.
 */
export async function readHistory(repoPath, { since, until, year, author, limit = DEFAULT_LIMIT, maxBuffer = MAX_BUFFER } = {}) {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new TypeError(`limit must be a positive integer or Infinity, got ${limit}`);
  }
  checkRepoPath(repoPath);
  const sinceAsFilter = since ? versionAtLeast(await gitVersion(), 2, 37) : true;
  // Ask git for one extra commit so a history of exactly `limit` commits is not
  // "truncated". git parses --max-count as a C int (newer git rejects larger values), so
  // a limit that big is the same as no cap: skip --max-count and cut in JS below.
  // Without a git-side date filter (old git), git cannot cap a --since run at all.
  const canCap = limit + 1 <= GIT_INT_MAX && (!since || sinceAsFilter);
  const byAuthorDate = windowFilter(since, until);

  const logOpts = { since, until, year, author, maxBuffer, sinceAsFilter };
  let maxCount = canCap ? limit + 1 : undefined;
  let commits = await runLog(repoPath, { ...logOpts, maxCount });
  if (commits === null) return { commits: [], truncated: false, limit, shallow: false };
  let filtered = byAuthorDate(commits);
  // git's pre-filters check the committer date with some slack: a rebased commit (old
  // author date, new committer date) or one inside a slack window can use up a capped
  // slot and then fail the author-date filter. While the capped read came back full and
  // fewer than limit + 1 commits survived, the cap may have hidden matching ones: read
  // again with room for at least the dropped ones, doubling that room each round, so a
  // busy slack window never makes us read the whole history. Once limit + 1 survive (or
  // the read was not full), the capped read is a prefix of the full one: same result.
  let allowance = 0;
  while (maxCount !== undefined && (since || until) && commits.length === maxCount && filtered.length <= limit) {
    allowance = Math.max(commits.length - filtered.length, allowance * 2);
    maxCount = limit + 1 + allowance <= GIT_INT_MAX ? limit + 1 + allowance : undefined;
    commits = (await runLog(repoPath, { ...logOpts, maxCount })) ?? [];
    filtered = byAuthorDate(commits);
  }
  commits = filtered;
  const truncated = commits.length > limit;
  if (truncated) commits = commits.slice(0, limit);
  const boundary = await shallowBoundary(repoPath);
  if (boundary) {
    for (const c of commits) {
      if (!boundary.has(c.hash)) continue;
      Object.assign(c, { files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
    }
  }
  return { commits, truncated, limit, shallow: Boolean(boundary) };
}

/** Run `git log` and parse it; null for a repo without commits. Maps errors to user-facing ones. */
async function runLog(repoPath, { since, until, year, author, maxBuffer, sinceAsFilter, maxCount }) {
  const args = ['-C', repoPath, '-c', 'diff.relative=false', ...buildLogArgs({ since, until, author, maxCount, sinceAsFilter })];
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', args, {
      maxBuffer,
      encoding: 'utf8',
      // LC_ALL=C forces English messages so the error checks below are reliable.
      env: gitEnv(),
    }));
  } catch (err) {
    const spawn = spawnError(err);
    if (spawn) throw spawn;
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const mb = Math.round(maxBuffer / (1024 * 1024));
      // Only suggest what can shrink the output: --max-commits only helps when git caps it.
      let narrow;
      if (year !== undefined) {
        narrow = 'narrow it down by splitting the year with --since and --until instead of --year (e.g. one quarter at a time), or with --author';
      } else {
        const tips = [since ? 'a later --since' : '--since', ...(until ? ['an earlier --until'] : []), '--author'];
        narrow = `narrow it down with ${tips.slice(0, -1).join(', ')} or ${tips.at(-1)}`;
      }
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
  return parseLog(stdout);
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
