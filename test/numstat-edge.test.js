// Adversarial inputs for the --numstat parser, run against real temp repos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLogArgs, readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const STRIPPED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR'];

function git(cwd, args, { env = {}, input } = {}) {
  const e = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@x',
    GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
    ...env,
  };
  for (const k of STRIPPED) delete e[k];
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: e, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

function newRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

const commit = (dir, msg, extra = []) => git(dir, ['commit', '-q', '--no-verify', ...extra, '-m', msg]);
const paths = (c) => c.files.map((x) => x.path);

describe('numstat: paths and subjects that look like numstat lines or headers', () => {
  const hex40 = '0123456789abcdef0123456789abcdef01234567';
  const tricky = ['1\t2\tx', '42 starts with digits', `a\x1fb\x1fc\x1fd\x1fe`, hex40, 'p\n3\t4\tfake', '-\t-\tbin', 'trail\n'];
  let dir;
  let commits;

  before(async () => {
    dir = newRepo('gitwrapped-tricky-');
    writeFileSync(join(dir, 'base'), 'x\n');
    git(dir, ['add', '-A']);
    commit(dir, 'base');
    for (const p of tricky) writeFileSync(join(dir, p), '1\n2\n');
    git(dir, ['add', '-A']);
    commit(dir, '12\t34\tfoo');
    git(dir, ['commit', '-q', '--allow-empty', '--allow-empty-message', '-m', '']);
    writeFileSync(join(dir, 'base'), 'y\n');
    git(dir, ['add', '-A']);
    commit(dir, '-\t-\tlooks binary');
    commits = await readCommits(dir);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  test('commit count and subjects are intact', () => {
    assert.deepEqual(commits.map((c) => c.subject), ['-\t-\tlooks binary', '', '12\t34\tfoo', 'base']);
  });

  test('every tricky path is one file entry with 2 added lines', () => {
    const c = commits[2];
    assert.deepEqual([...paths(c)].sort(), [...tricky].sort());
    for (const f of c.files) assert.deepEqual([f.added, f.removed, f.binary], [2, 0, false]);
    assert.equal(c.filesChanged, tricky.length);
    assert.equal(c.linesAdded, 2 * tricky.length);
  });

  test('empty-subject commit has no files; neighbours keep theirs', () => {
    assert.deepEqual([commits[1].subject, commits[1].files], ['', []]);
    assert.deepEqual(commits[0].files, [{ path: 'base', added: 1, removed: 1, binary: false }]);
    assert.deepEqual(paths(commits[3]), ['base']);
  });

  test('multi-line message: subject is the first paragraph, files unaffected', async () => {
    writeFileSync(join(dir, 'base'), 'z\n');
    git(dir, ['add', '-A']);
    commit(dir, 'line one\nline two\n\n5\t6\tbody');
    const [c] = await readCommits(dir);
    assert.equal(c.subject, 'line one line two');
    assert.deepEqual(paths(c), ['base']);
  });
});

describe('numstat: deletes, big counts, merges, submodules', () => {
  let dir;
  let commits;
  const BIG = 120_000;

  before(async () => {
    dir = newRepo('gitwrapped-shapes-');
    writeFileSync(join(dir, 'shared.txt'), 'a\nb\nc\n');
    writeFileSync(join(dir, 'doomed.txt'), 'one\ntwo\n');
    git(dir, ['add', '-A']);
    commit(dir, 'root');
    git(dir, ['rm', '-q', 'doomed.txt']);
    commit(dir, 'delete only');
    writeFileSync(join(dir, 'big.txt'), 'line\n'.repeat(BIG));
    git(dir, ['add', '-A']);
    commit(dir, 'big add');
    // Conflicting branches, resolved by hand in the merge.
    git(dir, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(dir, 'shared.txt'), 'a\nSIDE\nc\n');
    git(dir, ['commit', '-q', '-am', 'side change']);
    git(dir, ['checkout', '-q', 'main']);
    writeFileSync(join(dir, 'shared.txt'), 'a\nMAIN\nc\n');
    git(dir, ['commit', '-q', '-am', 'main change']);
    try {
      git(dir, ['merge', '-q', 'side']);
      assert.fail('expected a conflict');
    } catch (err) {
      if (err.code === 'ERR_ASSERTION') throw err;
    }
    writeFileSync(join(dir, 'shared.txt'), 'a\nRESOLVED\nc\n');
    git(dir, ['add', 'shared.txt']);
    commit(dir, 'merge side');
    // A gitlink (submodule pointer) without needing a second repo on disk.
    git(dir, ['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/sub`]);
    commit(dir, 'add submodule');
    commits = await readCommits(dir);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  const by = (s) => commits.find((c) => c.subject === s);

  test('delete-only commit counts removed lines', () => {
    assert.deepEqual(by('delete only').files, [{ path: 'doomed.txt', added: 0, removed: 2, binary: false }]);
    assert.equal(by('delete only').linesRemoved, 2);
  });

  test('large line counts are exact numbers', () => {
    assert.deepEqual(by('big add').files, [{ path: 'big.txt', added: BIG, removed: 0, binary: false }]);
  });

  test('conflict-resolved merge has files [] and zero stats; parents keep theirs', () => {
    const m = by('merge side');
    assert.deepEqual([m.files, m.filesChanged, m.linesAdded, m.linesRemoved], [[], 0, 0, 0]);
    assert.deepEqual(by('side change').files, [{ path: 'shared.txt', added: 1, removed: 1, binary: false }]);
    assert.deepEqual(by('main change').files, [{ path: 'shared.txt', added: 1, removed: 1, binary: false }]);
    assert.equal(commits.length, 7);
  });

  test('submodule pointer shows as a 1-line file', () => {
    assert.deepEqual(by('add submodule').files, [{ path: 'vendor/sub', added: 1, removed: 0, binary: false }]);
  });
});

describe('numstat: git config cannot change the result', () => {
  let fx;
  let baseline;

  before(async () => {
    fx = makeFixtureRepo();
    baseline = await readCommits(fx.dir);
  });

  after(() => fx?.cleanup());

  const orderFile = () => {
    const p = join(fx.dir, '.git', 'order.txt');
    writeFileSync(p, 'src/*\nREADME.md\n');
    return p;
  };

  const CASES = [
    ['diff.noprefix', 'true'],
    ['diff.mnemonicPrefix', 'true'],
    ['log.showRoot', 'false'],
    ['diff.relative', 'true'],
    ['core.quotePath', 'true'],
    ['color.ui', 'always'],
    ['color.diff', 'always'],
    ['log.decorate', 'full'],
    ['format.pretty', 'format:%s'],
    ['log.showSignature', 'true'],
    ['log.abbrevCommit', 'true'],
    ['i18n.logOutputEncoding', 'ISO-8859-1'],
    ['diff.renames', 'copies'],
    ['diff.orderFile', orderFile],
  ];

  for (const [key, value] of CASES) {
    test(`${key}`, async () => {
      const v = typeof value === 'function' ? value() : value;
      git(fx.dir, ['config', key, v]);
      try {
        assert.deepEqual(await readCommits(fx.dir), baseline);
      } finally {
        git(fx.dir, ['config', '--unset', key]);
      }
    });
  }

  test('args pin --root and ignore orderFile', () => {
    const args = buildLogArgs();
    assert.ok(args.includes('--root'));
    assert.ok(args.includes('-O/dev/null'));
  });
});

describe('numstat: many commits / files', () => {
  test('300 commits x 5 files parse quickly and completely', async () => {
    const dir = newRepo('gitwrapped-many-');
    try {
      // fast-import builds the history in one process, so this stays well under a second.
      let stream = '';
      for (let i = 0; i < 300; i++) {
        const msg = `c${i}`;
        stream += `commit refs/heads/main\ncommitter T <t@x> ${1_700_000_000 + i * 60} +0000\ndata ${msg.length}\n${msg}\n`;
        for (let j = 0; j < 5; j++) {
          const body = `${i}\n`.repeat(j + 1);
          stream += `M 100644 inline d${j}/f${j}.txt\ndata ${body.length}\n${body}\n`;
        }
      }
      git(dir, ['fast-import', '--quiet'], { input: stream });
      const t0 = performance.now();
      const commits = await readCommits(dir);
      const ms = performance.now() - t0;
      assert.equal(commits.length, 300);
      assert.ok(ms < 2000, `readCommits took ${ms}ms`);
      assert.equal(commits.at(-1).subject, 'c0');
      assert.deepEqual(commits.at(-1).files.map((f) => f.added), [1, 2, 3, 4, 5]);
      for (const c of commits.slice(0, -1)) {
        assert.equal(c.filesChanged, 5);
        assert.equal(c.linesAdded, 15);
        assert.equal(c.linesRemoved, 15);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('makeFixtureRepo: safety and determinism', () => {
  test('refuses a non-empty target dir and leaves it untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitwrapped-nonempty-'));
    try {
      writeFileSync(join(dir, 'keep.txt'), 'precious');
      assert.throws(() => makeFixtureRepo({ dir }), /not empty/);
      assert.deepEqual(readdirSync(dir), ['keep.txt']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLI refuses a non-empty dir with a non-zero exit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitwrapped-nonempty-cli-'));
    try {
      mkdirSync(join(dir, 'sub'));
      const script = fileURLToPath(new URL('../scripts/make-fixture-repo.js', import.meta.url));
      assert.throws(() => execFileSync(process.execPath, [script, dir], { stdio: 'pipe' }));
      assert.ok(existsSync(join(dir, 'sub')));
      assert.equal(existsSync(join(dir, '.git')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('same hashes in a different timezone and with hostile env identity', () => {
    const a = makeFixtureRepo();
    const saved = { TZ: process.env.TZ, GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME, GIT_COMMITTER_DATE: process.env.GIT_COMMITTER_DATE };
    process.env.TZ = 'Pacific/Kiritimati';
    process.env.GIT_AUTHOR_NAME = 'Someone Else';
    process.env.GIT_COMMITTER_DATE = '2001-01-01T00:00:00Z';
    let b;
    try {
      b = makeFixtureRepo();
      assert.deepEqual(b.commits.map((c) => c.hash), a.commits.map((c) => c.hash));
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      a.cleanup();
      b?.cleanup();
    }
  });
});
