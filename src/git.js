import { execFile } from 'node:child_process';
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
export function buildLogArgs({ since, author } = {}) {
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

/**
 * Read commits from the repo at `repoPath`, newest first.
 * `since` filters on the author date (git's own --since uses the committer date, so it
 * is only a pre-filter). Returns [] for a repo without commits; throws
 * "not a git repository: <path>" for anything that is not a repo.
 */
export async function readCommits(repoPath, { since, author, maxBuffer = MAX_BUFFER } = {}) {
  const args = ['-C', repoPath, '-c', 'diff.relative=false', ...buildLogArgs({ since, author })];
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
      throw new Error(`git log output is larger than ${mb} MB; narrow it down with --since or --author`);
    }
    const stderr = String(err.stderr ?? '');
    if (/does not have any commits yet|bad default revision 'HEAD'/.test(stderr)) {
      return [];
    }
    if (/not a git repository|cannot change to/i.test(stderr)) {
      throw new Error(`not a git repository: ${repoPath}`);
    }
    throw new Error(`git log failed: ${stderr.trim() || err.message}`);
  }
  const commits = parseLog(stdout);
  const min = since ? sinceMs(since) : NaN;
  if (Number.isNaN(min)) return commits;
  return commits.filter((c) => Date.parse(c.date) >= min);
}
