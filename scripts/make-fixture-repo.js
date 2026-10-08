#!/usr/bin/env node
// Builds a tiny, deterministic throwaway git repo with a known history, for tests.
//
//   import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
//   const { dir, commits, cleanup } = makeFixtureRepo();
//
//   node scripts/make-fixture-repo.js [dir]   # builds it and prints the path
//
// Lives in scripts/ (not test/) because `node --test` on Node 20 runs every .js under test/.
// Requires git >= 2.32 (`init -b`, and GIT_CONFIG_GLOBAL so user config is really ignored). Global/system git config is ignored so user settings
// (autocrlf, gpgsign, hooks, default branch...) cannot change the result.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTHORS = {
  ada: { name: 'Ada Lovelace', email: 'ada@example.com' },
  bob: { name: 'Bob Builder', email: 'bob@example.com' },
};

const STRIPPED_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_DEFAULT_HASH'];

const lines = (...xs) => xs.map((x) => `${x}\n`).join('');
const APP_V1 = lines('export function app(input) {', '  const x = input;', '  return x;', '}', '');
const APP_V2 = lines('export function app(input) {', '  if (!input) return null;', '  const x = input;', '  // handled', '  return x;', '}', '');
const APP_V3 = APP_V2.replace('// handled', '// handled empty input');
const LOCK_V1 = lines('{', '  "name": "fixture",', '  "lockfileVersion": 3', '}');
const LOCK_V2 = LOCK_V1.replace('"lockfileVersion": 3', '"lockfileVersion": 4');
const PNG_V1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x01, 0x02]);
const PNG_V2 = Buffer.concat([PNG_V1, Buffer.from([0x00, 0xff, 0x00, 0xfe])]);

const f = (path, added, removed, binary = false) => ({ path, added, removed, binary });

// Oldest first. `files` is the expected `git log --numstat --no-renames` result, in git's
// path order; `born` / `buried` the paths it adds / deletes (renames excluded, see
// readLifecycle in src/git.js) and `renamed` its renames (`[{from, to}]`), only when there are any. Dates use explicit offsets so the history is the same in every timezone.
const STEPS = [
  {
    subject: 'feat: initial commit',
    by: 'ada',
    date: '2024-03-04T10:00:00+01:00', // Monday morning
    write: { 'README.md': lines('# fixture', '', 'hello'), 'package-lock.json': LOCK_V1, 'src/app.js': APP_V1 },
    files: [f('README.md', 3, 0), f('package-lock.json', 4, 0), f('src/app.js', 5, 0)],
    born: ['README.md', 'package-lock.json', 'src/app.js'],
  },
  {
    subject: 'fix: handle empty input',
    by: 'bob',
    date: '2024-03-05T14:30:00+01:00',
    write: { 'src/app.js': APP_V2 },
    files: [f('src/app.js', 2, 0)],
  },
  {
    subject: 'wip',
    by: 'ada',
    date: '2024-03-06T23:45:00+01:00', // late night
    write: { 'notes/my notes.txt': lines('todo', 'more todo'), 'logo.png': PNG_V1 },
    files: [f('logo.png', 0, 0, true), f('notes/my notes.txt', 2, 0)],
    born: ['logo.png', 'notes/my notes.txt'],
  },
  {
    subject: 'chore: bump lockfile',
    by: 'bob',
    date: '2024-03-09T11:00:00+01:00', // Saturday
    write: { 'package-lock.json': LOCK_V2 },
    files: [f('package-lock.json', 1, 1)],
  },
  {
    subject: 'oops',
    by: 'ada',
    date: '2024-03-10T02:15:00-08:00', // Sunday, 2am local
    remove: ['README.md'],
    files: [f('README.md', 0, 3)],
    buried: ['README.md'],
  },
  {
    subject: 'chore: empty commit',
    by: 'bob',
    date: '2024-03-11T09:00:00+00:00',
    files: [],
  },
  {
    subject: 'fix: typo in app',
    by: 'ada',
    date: '2024-03-12T16:20:00+05:30',
    write: { 'src/app.js': APP_V3, 'logo.png': PNG_V2 },
    files: [f('logo.png', 0, 0, true), f('src/app.js', 1, 1)],
  },
  {
    // A rename shows up as delete + add because readCommits passes --no-renames; it is
    // neither born nor buried but renamed (readLifecycle detects renames).
    subject: 'refactor: move app to main',
    by: 'bob',
    date: '2024-03-13T12:00:00+00:00',
    move: [['src/app.js', 'src/main.js']],
    files: [f('src/app.js', 0, 7), f('src/main.js', 7, 0)],
    renamed: [{ from: 'src/app.js', to: 'src/main.js' }],
  },
];

function gitEnv(extra = {}) {
  const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
  for (const name of STRIPPED_ENV) delete env[name];
  return env;
}

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Build the fixture repo. Returns `{dir, cleanup(), commits}` where `commits` is the
 * expected readCommits() data, newest first (hash filled in after creation).
 * `dir` defaults to a fresh directory in os.tmpdir(); a given dir is created if needed
 * and must be empty (throws otherwise). `cleanup()` deletes the directory either way.
 */
export function makeFixtureRepo({ dir } = {}) {
  if (dir) {
    dir = resolve(dir);
    mkdirSync(dir, { recursive: true });
    // Never commit into, or (on failure) delete, a directory that already has content.
    if (readdirSync(dir).length > 0) throw new Error(`fixture dir is not empty: ${dir}`);
  } else {
    dir = mkdtempSync(join(tmpdir(), 'gitwrapped-fixture-'));
  }
  const cleanup = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.name', 'Fixture']);
    git(dir, ['config', 'user.email', 'fixture@example.com']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['config', 'core.autocrlf', 'false']);

    const commits = [];
    for (const step of STEPS) {
      for (const [path, content] of Object.entries(step.write ?? {})) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      for (const path of step.remove ?? []) git(dir, ['rm', '-q', '--', path]);
      for (const [from, to] of step.move ?? []) git(dir, ['mv', '--', from, to]);
      git(dir, ['add', '-A']);
      const { name, email } = AUTHORS[step.by];
      git(dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', step.subject], {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: step.date,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_COMMITTER_DATE: step.date,
      });
      const files = step.files.map((x) => ({ ...x }));
      commits.push({
        hash: git(dir, ['rev-parse', 'HEAD']).trim(),
        author: name,
        email,
        date: step.date,
        subject: step.subject,
        files,
        filesChanged: files.length,
        linesAdded: files.reduce((n, x) => n + x.added, 0),
        linesRemoved: files.reduce((n, x) => n + x.removed, 0),
        ...(step.born ? { born: [...step.born] } : {}),
        ...(step.buried ? { buried: [...step.buried] } : {}),
        ...(step.renamed ? { renamed: step.renamed.map((r) => ({ ...r })) } : {}),
      });
    }
    return { dir, cleanup, commits: commits.reverse() };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// Compare real paths: the ESM loader resolves symlinks (e.g. macOS /var → /private/var)
// and Windows drive-letter case can differ between argv[1] and import.meta.url.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    const norm = (p) => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
    return norm(resolve(process.argv[1])) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { dir } = makeFixtureRepo({ dir: process.argv[2] });
  process.stdout.write(`${dir}\n`);
}
