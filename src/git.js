import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';

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
const US = '\x1f';
const NUMSTAT = /^[\r\n]*(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
export const LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s';

const MAX_BUFFER = 256 * 1024 * 1024;

/** Default cap on analyzed commits: the most recent DEFAULT_LIMIT are read. */
export const DEFAULT_LIMIT = 50_000;

// Variables that would make git ignore `-C <path>` or stop repo discovery early.
const STRIPPED_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Git-side --since value: a bare YYYY-MM-DD means local midnight of that day. */
function gitSince(since) {
  return DATE_ONLY.test(since) ? `${since} 00:00:00` : since;
}

/** Since as epoch ms (local midnight for YYYY-MM-DD), or NaN if unparseable. */
function sinceMs(since) {
  if (DATE_ONLY.test(since)) {
    const [y, m, d] = since.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(since);
}

/**
 * Build the argument list for `git log` (without `-C <path>`).
 * Arguments are passed straight to execFile (no shell), so values are never interpreted.
 */
/** Largest value git accepts for --max-count (a C int). */
const GIT_INT_MAX = 2 ** 31 - 1;

export function buildLogArgs({ since, author, maxCount } = {}) {
  const args = [
    'log',
    '-z',
    '--no-color',
    '--no-show-signature',
    '--encoding=UTF-8',
    `--format=${LOG_FORMAT}`,
    // Per-file stats. --no-renames keeps paths independent of diff.renames config;
    // diff.relative is disabled via `-c` in readCommits (works on any git version).
    '--numstat',
    '--no-renames',
    // --root: log.showRoot=false would otherwise drop the root commit's files.
    // -O/dev/null: ignore diff.orderFile so files stay in git's path order.
    '--root',
    '-O/dev/null',
  ];
  if (maxCount !== undefined) {
    if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new TypeError(`maxCount must be a positive integer, got ${maxCount}`);
    args.push(`--max-count=${maxCount}`);
  }
  if (since) args.push(`--since=${gitSince(since)}`);
  if (author) {
    // Exact email match, case-insensitive: git matches --author against "Name <email>".
    args.push('--fixed-strings', '--regexp-ignore-case', `--author=<${author}>`);
  }
  return args;
}

/**
 * Parse `git log -z --numstat --format=LOG_FORMAT` output into commit objects:
 * `{hash, author, email, date, subject, files: [{path, added, removed, binary}],
 * filesChanged, linesAdded, linesRemoved}`. Binary files count as 0 lines.
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
    if (fields.length < 5) continue;
    const [hash, author, email, date, ...rest] = fields;
    current = {
      hash,
      author,
      email,
      // git >= 2.5x prints UTC as "Z", older git as "+00:00": normalize so output is stable.
      date: date.replace(/Z$/i, '+00:00'),
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

/**
 * Read the history of the repo at `repoPath`, newest first, capped at `limit` commits
 * (default 50,000: the most recent ones; `Infinity` means no cap). Returns
 * `{commits, truncated, limit}` where `truncated` is true when more than `limit` commits
 * matched the filters. `since` filters on the author date: git's own --since uses the
 * committer date, so it is only a pre-filter; the cap is applied after the author-date
 * filter. `commits` is [] for a repo without commits. Throws a TypeError for an invalid
 * `limit`, and a user-facing Error for: a missing path ("path does not exist: <path>"),
 * a file ("not a directory: <path>"), a folder that is not a repo ("not a git repository:
 * <path>"), git's safe.directory ownership check, a missing git, or oversized output.
 */
export async function readHistory(repoPath, { since, author, limit = DEFAULT_LIMIT, maxBuffer = MAX_BUFFER } = {}) {
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new TypeError(`limit must be a positive integer or Infinity, got ${limit}`);
  }
  checkRepoPath(repoPath);
  // Without `since`, ask git for one extra commit so a history of exactly `limit` commits
  // is not "truncated". With
  // `since`, git cannot cap: its --since checks the committer date, and a rebased commit
  // (old author date, new committer date) would use up a slot before the author-date filter.
  // git parses --max-count as a C int (newer git rejects larger values), so a limit that
  // big is the same as no cap: skip --max-count and cut in JS below.
  const maxCount = since || limit + 1 > GIT_INT_MAX ? undefined : limit + 1;
  const args = ['-C', repoPath, '-c', 'diff.relative=false', ...buildLogArgs({ since, author, maxCount })];
  let stdout;
  try {
    ({ stdout } = await execFileAsync('git', args, {
      maxBuffer,
      encoding: 'utf8',
      // LC_ALL=C forces English messages so the error checks below are reliable.
      env: gitEnv(),
    }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH');
    }
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      const mb = Math.round(maxBuffer / (1024 * 1024));
      throw new Error(`git log output is larger than ${mb} MB; narrow it down with --since or --author, or lower --max-commits`);
    }
    const stderr = String(err.stderr ?? '');
    if (/does not have any commits yet|bad default revision 'HEAD'/.test(stderr)) {
      return { commits: [], truncated: false, limit };
    }
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
  let commits = parseLog(stdout);
  const min = since ? sinceMs(since) : NaN;
  if (!Number.isNaN(min)) commits = commits.filter((c) => Date.parse(c.date) >= min);
  const truncated = commits.length > limit;
  if (truncated) commits = commits.slice(0, limit);
  return { commits, truncated, limit };
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
