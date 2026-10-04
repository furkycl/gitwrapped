import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// `git log -z` terminates each record with NUL, which git never allows inside a
// commit message, name or email. Fields are split on the unit separator (\x1f);
// the subject is the last field, so a stray \x1f or \x1e in a subject is kept.
const US = '\x1f';
export const LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s';

const MAX_BUFFER = 256 * 1024 * 1024;

// Variables that would make git ignore `-C <path>` or stop repo discovery early.
const STRIPPED_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR'];

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
  const args = ['log', '-z', '--no-color', '--no-show-signature', '--encoding=UTF-8', `--format=${LOG_FORMAT}`];
  if (since) args.push(`--since=${gitSince(since)}`);
  if (author) {
    // Exact email match, case-insensitive: git matches --author against "Name <email>".
    args.push('--fixed-strings', '--regexp-ignore-case', `--author=<${author}>`);
  }
  return args;
}

/**
 * Parse `git log -z --format=LOG_FORMAT` output into commit objects.
 * Pure function: returns [] for empty output.
 */
export function parseLog(stdout) {
  if (!stdout) return [];
  const commits = [];
  for (const record of String(stdout).split('\0')) {
    const trimmed = record.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (trimmed === '') continue;
    const fields = trimmed.split(US);
    if (fields.length < 5) continue;
    const [hash, author, email, date, ...rest] = fields;
    commits.push({ hash, author, email, date, subject: rest.join(US) });
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
  const args = ['-C', repoPath, ...buildLogArgs({ since, author })];
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
