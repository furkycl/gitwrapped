// --exclude <glob>: the matcher (src/glob.js), the per-commit filter (excludeFiles in
// src/stats/files.js), CLI parsing and the end-to-end effect on stats and stats.json.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compileExcludes, compileGlob } from '../src/glob.js';
import { excludeFiles } from '../src/stats/files.js';
import { generate, parseCli, run } from '../src/cli.js';

const TODAY = '2026-10-05';

describe('compileGlob', () => {
  const yes = (p, path) => assert.equal(compileGlob(p)(path), true, `${p} should match ${path}`);
  const no = (p, path) => assert.equal(compileGlob(p)(path), false, `${p} should not match ${path}`);

  test('a pattern without "/" matches a name at any depth', () => {
    yes('*.min.js', 'app.min.js');
    yes('*.min.js', 'a/b/app.min.js');
    no('*.min.js', 'app.js');
    no('*.min.js', 'app.min.jsx');
    yes('fixtures', 'test/fixtures/x.json');
    yes('fixtures', 'fixtures');
    no('fixtures', 'test/fixtures2/x.json');
    yes('CHANGELOG.md', 'packages/a/CHANGELOG.md');
  });

  test('directories drop everything below them: docs, docs/, docs/**', () => {
    for (const p of ['docs', 'docs/', 'docs/**', './docs', '/docs/']) {
      yes(p, 'docs/guide/intro.md');
      yes(p, 'docs/a.md');
      no(p, 'src/a.js');
      no(p, 'docsite/a.md');
    }
    // A trailing slash only matches directories, not a file of that name.
    no('build/', 'build');
    yes('build', 'build');
    yes('build/', 'build/x.js');
    no('docs/**', 'docs');
  });

  test('a "/" inside, or a leading "/" or "./", anchors at the repo root', () => {
    yes('src/gen/*.js', 'src/gen/a.js');
    no('src/gen/*.js', 'lib/src/gen/a.js');
    no('src/gen/*.js', 'src/gen/sub/a.js');
    yes('src/gen/*.js', 'src/gen/a.js');
    yes('/README.md', 'README.md');
    no('/README.md', 'docs/README.md');
    yes('./README.md', 'README.md');
    no('./README.md', 'docs/README.md');
  });

  test('* and ? stop at "/", ** crosses directories (and zero of them before "/")', () => {
    no('src/*', 'x/src/a.js');
    yes('src/*.js', 'src/a.js');
    no('src/*.js', 'src/a/b.js');
    yes('src/**/*.js', 'src/a.js');
    yes('src/**/*.js', 'src/a/b/c.js');
    yes('**/gen/*.ts', 'gen/a.ts');
    yes('**/gen/*.ts', 'x/y/gen/a.ts');
    yes('src/?.js', 'src/a.js');
    no('src/?.js', 'src/ab.js');
    yes('**', 'anything/at/all.txt');
    yes('a/**/b', 'a/b');
    yes('a/**/b', 'a/x/y/b');
  });

  test('regex specials are literal; matching is case-sensitive', () => {
    yes('a+b(1).[x]$', 'a+b(1).[x]$');
    no('a.c', 'abc');
    yes('{a,b}.js', '{a,b}.js');
    no('{a,b}.js', 'a.js');
    no('README.md', 'readme.md');
  });

  test('backslashes are read as "/" and surrounding whitespace is ignored', () => {
    yes('src\\gen\\*.js', 'src/gen/a.js');
    yes('  docs/  ', 'docs/a.md');
  });

  test('empty or anchor-only patterns throw a user-facing error', () => {
    assert.throws(() => compileGlob(''), /--exclude requires a non-empty pattern/);
    assert.throws(() => compileGlob('   '), /--exclude requires a non-empty pattern/);
    for (const p of ['/', './', '//', '.']) assert.throws(() => compileGlob(p), /invalid --exclude .*matches nothing/);
  });

  test('non-string or empty paths never match', () => {
    const m = compileGlob('**');
    assert.equal(m(''), false);
    assert.equal(m(undefined), false);
  });

  test('no catastrophic backtracking: pathological patterns stay fast', () => {
    const cases = [
      ['*a*a*a*a*a*b', 'a'.repeat(100)],
      ['*a*'.repeat(6) + 'b', 'a'.repeat(60)],
      ['**/'.repeat(30) + 'x', 'a/'.repeat(500) + 'y'],
      ['**a**a**a**a**a**a**b', 'a'.repeat(2000)],
      ['*?*?*?*?*?*?*?*?*?b', 'a'.repeat(1000)],
    ];
    for (const [p, path] of cases) {
      const m = compileGlob(p);
      const t = performance.now();
      assert.equal(m(path), false);
      const ms = performance.now() - t;
      assert.ok(ms < 200, `${p} took ${ms.toFixed(1)}ms`);
    }
    // Collapsed runs keep their meaning.
    assert.equal(compileGlob('**/**/**/x')('x'), true);
    assert.equal(compileGlob('a/**/**/b')('a/b'), true);
    assert.equal(compileGlob('a/**/**/b')('a/q/r/b'), true);
    assert.equal(compileGlob('a/****/b')('a/q/r/b'), true);
  });

  test('named marks name patterns (no inner "/", not anchored)', () => {
    assert.equal(compileGlob('docs').named, true);
    assert.equal(compileGlob('docs/').named, true);
    assert.equal(compileGlob('*.min.js').named, true);
    assert.equal(compileGlob('/docs').named, false);
    assert.equal(compileGlob('./docs').named, false);
    assert.equal(compileGlob('a/b').named, false);
    assert.equal(compileGlob('**/b').named, false);
  });

  test('compileExcludes: any pattern matches; none → null', () => {
    assert.equal(compileExcludes([]), null);
    assert.equal(compileExcludes(undefined), null);
    const m = compileExcludes(['docs/', '*.lock']);
    assert.equal(m('docs/a.md'), true);
    assert.equal(m('x/y.lock'), true);
    assert.equal(m('src/a.js'), false);
  });
});

/** A commit as readCommits() returns it. */
function commit(hash, files, extra = {}) {
  return {
    hash, author: 'Ada', email: 'a@x.io', date: '2026-01-02T10:00:00+00:00', parents: ['p'], subject: `feat: ${hash}`, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
    ...extra,
  };
}

describe('excludeFiles', () => {
  test('drops matching files and recomputes the per-commit totals; keeps the commit', () => {
    const c = commit('h1', [
      { path: 'src/a.js', added: 3, removed: 1, binary: false },
      { path: 'docs/a.md', added: 100, removed: 50, binary: false },
    ]);
    const only = commit('h2', [{ path: 'docs/b.md', added: 7, removed: 0, binary: false }]);
    const untouched = commit('h3', [{ path: 'src/b.js', added: 1, removed: 0, binary: false }]);
    const input = [c, only, untouched];
    const out = excludeFiles(input, compileExcludes(['docs/']));
    assert.equal(out.length, 3);
    assert.deepEqual(out[0].files.map((f) => f.path), ['src/a.js']);
    assert.equal(out[0].filesChanged, 1);
    assert.equal(out[0].linesAdded, 3);
    assert.equal(out[0].linesRemoved, 1);
    assert.deepEqual(out[1].files, []);
    assert.equal(out[1].linesAdded, 0);
    assert.equal(out[1].filesChanged, 0);
    assert.equal(out[2], untouched, 'a commit without excluded files is the same object');
    // The input is not modified.
    assert.equal(c.files.length, 2);
    assert.equal(c.linesAdded, 103);
  });

  test('no matcher → the same array', () => {
    const input = [commit('h', [])];
    assert.equal(excludeFiles(input, null), input);
  });

  test('multi-repo paths match relative to their repo or as shown with the label', () => {
    const api = commit('a', [{ path: 'api/src/x.js', added: 1, removed: 0 }, { path: 'api/lib/y.js', added: 2, removed: 0 }], { repo: 'api' });
    const web = commit('w', [{ path: 'web/src/x.js', added: 4, removed: 0 }, { path: 'web/lib/y.js', added: 8, removed: 0 }], { repo: 'web' });
    const everySrc = excludeFiles([api, web], compileExcludes(['src/']));
    assert.deepEqual(everySrc.map((c) => c.files.map((f) => f.path)), [['api/lib/y.js'], ['web/lib/y.js']]);
    const apiSrc = excludeFiles([api, web], compileExcludes(['api/src/']));
    assert.deepEqual(apiSrc.map((c) => c.files.map((f) => f.path)), [['api/lib/y.js'], ['web/src/x.js', 'web/lib/y.js']]);
    assert.equal(apiSrc[1], web);
  });

  test('multi-repo: name patterns never match the repo label', () => {
    const docs = commit('d', [{ path: 'docs/src/x.js', added: 1, removed: 0 }, { path: 'docs/docs/y.md', added: 2, removed: 0 }], { repo: 'docs' });
    const out = excludeFiles([docs], compileExcludes(['docs']));
    assert.deepEqual(out[0].files.map((f) => f.path), ['docs/src/x.js'], 'only the repo\'s own docs/ folder');
    assert.equal(excludeFiles([docs], compileExcludes(['do*']))[0].files.length, 1);
    assert.deepEqual(excludeFiles([docs], compileExcludes(['/docs']))[0].files, [], 'anchored /docs names the label');
  });
});

describe('parseCli --exclude', () => {
  test('repeatable, trimmed, in order; absent when not given', () => {
    assert.deepEqual(parseCli(['--exclude', 'docs/', '--exclude=*.min.js', '--exclude', ' a/b ']).exclude, ['docs/', '*.min.js', 'a/b']);
    assert.equal('exclude' in parseCli([]), false);
  });

  test('an empty or anchor-only pattern is an error', () => {
    assert.throws(() => parseCli(['--exclude=']), /--exclude requires a non-empty value/);
    assert.throws(() => parseCli(['--exclude', '  ']), /--exclude requires a non-empty value/);
    assert.throws(() => parseCli(['--exclude', '/']), /invalid --exclude "\/"/);
    assert.throws(() => parseCli(['--exclude']), /--exclude requires a value/);
  });
});

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    for (const [p, content] of Object.entries(s.files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    git(dir, ['add', '-A']);
    const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };
    git(dir, ['commit', '-q', '-m', `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
  return dir;
}

const lines = (n) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n') + '\n';

describe('generate with --exclude', () => {
  let root;
  let repo;
  let other;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-exclude-'));
    repo = makeRepo(join(root, 'app'), [
      { date: '2025-03-01T10:00:00+00:00', files: { 'src/a.js': lines(10), 'docs/guide.md': lines(200) } },
      { date: '2025-03-02T10:00:00+00:00', files: { 'docs/guide.md': lines(300) } },
      { date: '2025-03-03T10:00:00+00:00', files: { 'src/a.js': lines(12), 'dist2/app.min.js': lines(50) } },
    ]);
    other = makeRepo(join(root, 'web'), [
      { date: '2025-03-04T10:00:00+00:00', files: { 'docs/x.md': lines(40), 'src/b.ts': lines(5) } },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('excluded files leave lines, files, hot files and languages; commits stay', async () => {
    const plain = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true }, { today: TODAY });
    const ex = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/', '*.min.js'] }, { today: TODAY });
    assert.equal(plain.stats.totals.filesTouched, 3);
    assert.equal(ex.stats.totals.commits, plain.stats.totals.commits);
    assert.equal(ex.stats.totals.activeDays, plain.stats.totals.activeDays);
    assert.deepEqual(ex.stats.streaks, plain.stats.streaks);
    assert.equal(ex.stats.totals.filesTouched, 1);
    assert.equal(ex.stats.totals.linesAdded, 12);
    assert.equal(ex.stats.totals.linesRemoved, 0);
    assert.deepEqual(ex.stats.hotFiles.map((f) => f.path), ['src/a.js']);
    assert.deepEqual(ex.stats.languages.languages.map((l) => l.name), ['JavaScript']);
    const doc = JSON.parse(readFileSync(ex.statsJson, 'utf8'));
    assert.deepEqual(doc.filters.exclude, ['docs/', '*.min.js']);
    assert.deepEqual(JSON.parse(readFileSync(plain.statsJson, 'utf8')).filters.exclude, []);
  });

  test('multi-repo: per-repo lines follow the filter; a labeled pattern hits one repo', async () => {
    const all = await generate({ paths: [repo, other], out: join(root, 'o3'), png: false, exclude: ['docs'] }, { today: TODAY });
    const byName = Object.fromEntries(all.stats.repos.map((r) => [r.name, r]));
    assert.equal(byName.web.linesAdded, 5);
    assert.equal(byName.web.filesTouched, 1);
    assert.equal(byName.web.commits, 1);
    const one = await generate({ paths: [repo, other], out: join(root, 'o4'), png: false, exclude: ['web/docs/'] }, { today: TODAY });
    const byName1 = Object.fromEntries(one.stats.repos.map((r) => [r.name, r]));
    assert.equal(byName1.web.linesAdded, 5);
    assert.equal(byName1.app.filesTouched, 3, 'app/docs is not excluded by web/docs/');
  });

  test('--year: the previous year is read with the same excludes', async () => {
    const y = makeRepo(join(root, 'yr'), [
      { date: '2024-05-01T10:00:00+00:00', files: { 'docs/a.md': lines(100), 'src/a.js': lines(1) } },
      { date: '2025-05-01T10:00:00+00:00', files: { 'docs/a.md': lines(150), 'src/a.js': lines(3) } },
    ]);
    const r = await generate({ path: y, out: join(root, 'o5'), png: false, year: '2025', since: '2025-01-01', until: '2025-12-31', exclude: ['docs/'] }, { today: TODAY });
    assert.deepEqual(r.stats.yearOverYear.lines, { current: 2, previous: 1, delta: 1 });
  });

  test('run: --exclude flows through to stats.json', async () => {
    const out = join(root, 'o6');
    const sink = { write() {} };
    const code = await run([repo, '--exclude', 'docs/', '--json', '--no-png', '--out', out], { stdout: sink, stderr: sink, env: {}, today: TODAY });
    assert.equal(code, 0);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.filters.exclude, ['docs/']);
    assert.equal(doc.stats.totals.filesTouched, 2);
  });
});
