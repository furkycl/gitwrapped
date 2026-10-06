// Extra edge cases for --exclude <glob>: matcher corners (regex specials, ?, ***, anchors,
// backslashes, unicode/spaces), excludeFiles robustness, CLI parsing, and end-to-end
// behaviour on real temp repos (renames, binary files, excluded-only commits, multi-repo,
// "no --exclude" equivalence, stats.json filters order).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compileExcludes, compileGlob } from '../src/glob.js';
import { excludeFiles } from '../src/stats/files.js';
import { generate, parseCli, run } from '../src/cli.js';

const TODAY = '2026-10-05';
const yes = (p, path) => assert.equal(compileGlob(p)(path), true, `${p} should match ${path}`);
const no = (p, path) => assert.equal(compileGlob(p)(path), false, `${p} should not match ${path}`);

describe('compileGlob edge cases', () => {
  test('regex specials are literal one at a time', () => {
    yes('a.b', 'a.b');
    no('a.b', 'axb');
    yes('c++', 'src/c++');
    no('c++', 'src/cc');
    yes('f(x).js', 'f(x).js');
    no('f(x).js', 'fx.js');
    yes('price$', 'price$');
    no('price$', 'price');
    yes('^start', 'lib/^start');
    yes('a|b', 'a|b');
    no('a|b', 'a');
    no('a|b', 'b');
    yes('[ab].js', '[ab].js');
    no('[ab].js', 'a.js');
    yes('x{2}', 'x{2}');
    no('x{2}', 'xx');
    // A dot-star in the pattern is literal "." + glob star, not regex ".*".
    yes('.env*', 'config/.env.local');
    no('.env*', 'xenv');
  });

  test('? matches exactly one non-"/" character, also as a directory segment', () => {
    yes('?.js', 'a.js');
    yes('?.js', 'deep/b.js');
    no('?.js', 'ab.js');
    no('?.js', '.js');
    no('a?b', 'a/b');
    // Unanchored "?" matches any one-character segment, so a one-letter directory goes.
    yes('?', 'a/b.js');
    no('?', 'ab/cd.js');
  });

  test('three or more stars collapse to "**"', () => {
    yes('a/***/b', 'a/b');
    yes('a/***/b', 'a/x/y/b');
    yes('a/****', 'a/x/y');
    yes('***', 'x/y/z');
  });

  test('trailing slash: directory only; nested dirs match; files of that name do not', () => {
    no('lib/', 'lib');
    yes('lib/', 'lib/x.js');
    yes('lib/', 'pkg/lib/x.js');
    no('lib/', 'pkg/lib');
    yes('lib', 'pkg/lib');
    no('lib/', 'libs/x.js');
    // "**/" alone: every file inside some directory, not root-level files.
    yes('**/', 'a/x.js');
    no('**/', 'x.js');
  });

  test('anchored vs unanchored', () => {
    yes('gen', 'a/b/gen/x.js');
    no('/gen', 'a/gen/x.js');
    yes('/gen', 'gen/x.js');
    no('./gen/', 'a/gen/x.js');
    yes('a/gen', 'a/gen/x.js');
    no('a/gen', 'z/a/gen/x.js');
    yes('**/a/gen', 'z/a/gen/x.js');
    // A pattern is never a substring match.
    no('gen', 'generated/x.js');
    no('src/gen', 'src/generated/x.js');
  });

  test('Windows backslash patterns', () => {
    yes('docs\\', 'docs/a.md');
    no('docs\\', 'docs');
    yes('\\README.md', 'README.md');
    no('\\README.md', 'x/README.md');
    yes('.\\src\\gen', 'src/gen/a.js');
    yes('src\\**\\*.snap', 'src/a/b/c.snap');
    assert.throws(() => compileGlob('\\'), /matches nothing/);
    assert.throws(() => compileGlob('.\\'), /matches nothing/);
  });

  test('paths with spaces and unicode', () => {
    yes('my docs/', 'my docs/a b.md');
    yes('* *.md', 'x/a b.md');
    no('* *.md', 'x/ab.md');
    yes('ünï*', 'a/ünïcode.md');
    yes('日本/*.md', '日本/a.md');
    no('日本/*.md', 'x/日本/a.md');
    yes('?.md', 'é.md'); // one BMP code unit
    yes('emoji-*', 'emoji-🎉.txt');
  });

  test('repeated and leading slashes inside the pattern are tolerated', () => {
    yes('a//b', 'a/b/c');
    yes('//a', 'a/x');
    no('//a', 'z/a/x');
    yes('././a', 'a/x');
  });

  test('a non-string pattern throws the user-facing error', () => {
    assert.throws(() => compileGlob(undefined), /non-empty pattern/);
    assert.throws(() => compileGlob(42), /non-empty pattern/);
  });

  test('compileExcludes keeps every pattern (order does not change the result)', () => {
    const a = compileExcludes(['x/', '*.md']);
    const b = compileExcludes(['*.md', 'x/']);
    for (const p of ['x/a.js', 'y/a.md', 'y/a.js']) assert.equal(a(p), b(p));
    assert.throws(() => compileExcludes(['ok', '/']), /invalid --exclude "\/"/);
  });
});

describe('excludeFiles robustness', () => {
  const m = compileExcludes(['docs/']);

  test('merge commits (no files) and odd entries are kept as they are', () => {
    const merge = { hash: 'm', parents: ['a', 'b'], files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    const noFiles = { hash: 'n' };
    const out = excludeFiles([merge, noFiles, null], m);
    assert.equal(out[0], merge);
    assert.equal(out[1], noFiles);
    assert.equal(out[2], null);
  });

  test('binary files are dropped too; non-finite counts add 0', () => {
    const c = {
      hash: 'b', files: [
        { path: 'docs/logo.png', added: 0, removed: 0, binary: true },
        { path: 'img/x.png', added: 0, removed: 0, binary: true },
        { path: 'src/a.js', added: NaN, removed: 2 },
        { path: 'src/b.js', added: 4, removed: undefined },
      ], filesChanged: 4, linesAdded: 4, linesRemoved: 2,
    };
    const [out] = excludeFiles([c], m);
    assert.deepEqual(out.files.map((f) => f.path), ['img/x.png', 'src/a.js', 'src/b.js']);
    assert.equal(out.filesChanged, 3);
    assert.equal(out.linesAdded, 4);
    assert.equal(out.linesRemoved, 2);
  });

  test('non-array input passes through', () => {
    assert.equal(excludeFiles(undefined, m), undefined);
  });

  test('multi-repo: an anchored pattern can name the repo label; an unanchored one cannot cross it', () => {
    const c = { hash: 'x', repo: 'api', files: [{ path: 'api/docs/a.md', added: 1, removed: 0 }, { path: 'api/src/a.js', added: 1, removed: 0 }] };
    assert.deepEqual(excludeFiles([c], compileExcludes(['/api/docs']))[0].files.map((f) => f.path), ['api/src/a.js']);
    assert.equal(excludeFiles([c], compileExcludes(['api']))[0], c, 'a name pattern never matches the repo label');
    assert.equal(excludeFiles([c], compileExcludes(['api*']))[0], c);
    assert.deepEqual(excludeFiles([c], compileExcludes(['docs']))[0].files.map((f) => f.path), ['api/src/a.js']);
    assert.deepEqual(excludeFiles([c], compileExcludes(['/api']))[0].files, [], 'an anchored pattern can name the label');
    assert.equal(excludeFiles([c], compileExcludes(['web/docs/']))[0], c);
  });
});

describe('parseCli --exclude extra', () => {
  test('flag order is preserved, duplicates kept, backslashes kept as given', () => {
    const r = parseCli(['--exclude', 'b', '--exclude', 'a', '--exclude', 'b', '--exclude', 'src\\gen']);
    assert.deepEqual(r.exclude, ['b', 'a', 'b', 'src\\gen']);
  });

  test('a pattern that starts with "-" works with "="', () => {
    assert.deepEqual(parseCli(['--exclude=-weird.txt']).exclude, ['-weird.txt']);
  });

  test('anchor-only patterns are rejected in any spelling', () => {
    for (const p of ['./', '.', '//', '\\', '.\\', ' / ']) {
      assert.throws(() => parseCli(['--exclude', p]), /invalid --exclude/, p);
    }
  });

  test('one bad pattern among good ones is still an error', () => {
    assert.throws(() => parseCli(['--exclude', 'docs/', '--exclude', '/']), /invalid --exclude "\/"/);
    assert.throws(() => parseCli(['--exclude', 'docs/', '--exclude=']), /non-empty value/);
  });

  test('run() exits non-zero with the message on stderr for "/"', async () => {
    let err = '';
    const code = await run(['--exclude', '/'], { stdout: { write() {} }, stderr: { write(s) { err += s; } }, env: {}, today: TODAY });
    assert.notEqual(code, 0);
    assert.match(err, /invalid --exclude "\/"/);
  });
});

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };

/** Steps: {date, files: {path: content}, move?: [from, to]}. */
function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.quotepath', 'true']);
  for (const [i, s] of steps.entries()) {
    if (s.move) {
      mkdirSync(dirname(join(dir, s.move[1])), { recursive: true });
      renameSync(join(dir, s.move[0]), join(dir, s.move[1]));
    }
    for (const [p, content] of Object.entries(s.files ?? {})) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', s.msg ?? `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
  return dir;
}

const lines = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n') + '\n';
const sink = { write() {} };

describe('generate --exclude end to end (extra)', () => {
  let root;
  let repo;
  let other;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-exclude-extra-'));
    repo = makeRepo(join(root, 'app'), [
      { date: '2025-03-01T10:00:00+00:00', files: { 'src/a.js': lines(10), 'docs/guide.md': lines(200), 'my docs/ünï note.md': lines(7) } },
      // Excluded-only commits on their own days (one a weekend night).
      { date: '2025-03-02T23:30:00+00:00', msg: 'docs: more', files: { 'docs/guide.md': lines(300) } },
      { date: '2025-03-03T10:00:00+00:00', msg: 'chore: logo', files: { 'docs/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0, 3]) } },
      // A rename out of docs/ (with --no-renames: delete docs/old.md + add src/moved.md).
      { date: '2025-03-04T10:00:00+00:00', files: { 'docs/old.md': lines(20, 'o') } },
      { date: '2025-03-05T10:00:00+00:00', move: ['docs/old.md', 'src/moved.md'] },
      { date: '2025-03-06T10:00:00+00:00', files: { 'src/a.js': lines(12), 'src/c++/x(1).cpp': lines(3) } },
    ]);
    other = makeRepo(join(root, 'web'), [
      { date: '2025-03-07T10:00:00+00:00', files: { 'docs/x.md': lines(40), 'src/b.ts': lines(5) } },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const gen = (o, extra = {}) => generate({ path: repo, out: join(root, o), png: false, json: true, ...extra }, { today: TODAY });

  test('no --exclude, exclude: [] and a never-matching pattern all give identical stats', async () => {
    const plain = await gen('n1');
    const empty = await gen('n2', { exclude: [] });
    const none = await gen('n3', { exclude: ['does-not-exist/', '*.nope'] });
    assert.deepEqual(empty.stats, plain.stats);
    assert.deepEqual(none.stats, plain.stats);
    const docPlain = JSON.parse(readFileSync(plain.statsJson, 'utf8'));
    const docNone = JSON.parse(readFileSync(none.statsJson, 'utf8'));
    assert.deepEqual(docPlain.filters.exclude, []);
    assert.deepEqual(docNone.filters.exclude, ['does-not-exist/', '*.nope']);
    assert.deepEqual(docNone.stats, docPlain.stats);
  });

  test('commits touching only excluded files still count everywhere commits count', async () => {
    const plain = await gen('c1');
    const ex = await gen('c2', { exclude: ['docs/'] });
    assert.equal(ex.stats.totals.commits, plain.stats.totals.commits);
    assert.equal(ex.stats.totals.activeDays, plain.stats.totals.activeDays);
    assert.deepEqual(ex.stats.streaks, plain.stats.streaks);
    assert.deepEqual(ex.stats.habits, plain.stats.habits);
    assert.deepEqual(ex.stats.messages, plain.stats.messages);
    assert.deepEqual(ex.stats.daily, plain.stats.daily);
    assert.equal(ex.stats.contributors.top[0].commits, plain.stats.contributors.top[0].commits);
    assert.ok(ex.stats.contributors.top[0].added < plain.stats.contributors.top[0].added);
  });

  test('excluding everything: zero lines/files/hot files/languages, commits unchanged', async () => {
    const plain = await gen('e1');
    const ex = await gen('e2', { exclude: ['**'] });
    assert.equal(ex.stats.totals.commits, plain.stats.totals.commits);
    assert.equal(ex.stats.totals.linesAdded, 0);
    assert.equal(ex.stats.totals.linesRemoved, 0);
    assert.equal(ex.stats.totals.filesTouched, 0);
    assert.deepEqual(ex.stats.hotFiles, []);
    assert.deepEqual(ex.stats.languages.languages, []);
    // Cards and stats.json still render.
    const doc = JSON.parse(readFileSync(ex.statsJson, 'utf8'));
    assert.deepEqual(doc.filters.exclude, ['**']);
  });

  test('renames are a delete + add: excluding the old dir keeps the new path, and vice versa', async () => {
    const oldDir = await gen('r1', { exclude: ['docs/'] });
    const hot = oldDir.stats.hotFiles.map((f) => f.path);
    assert.ok(hot.includes('src/moved.md'), `src/moved.md still counted: ${hot}`);
    assert.ok(!hot.some((p) => p.startsWith('docs/')));
    const newDir = await gen('r2', { exclude: ['src/moved.md'] });
    const hot2 = newDir.stats.hotFiles.map((f) => f.path);
    assert.ok(!hot2.includes('src/moved.md'));
    // docs/old.md was added (20) and later deleted (20) — both sides stay.
    const plain = await gen('r3');
    assert.equal(plain.stats.totals.linesAdded - newDir.stats.totals.linesAdded, 20);
    assert.equal(plain.stats.totals.linesRemoved, newDir.stats.totals.linesRemoved);
  });

  test('binary files: excluded by name, still a file before', async () => {
    const plain = await gen('b1');
    const ex = await gen('b2', { exclude: ['*.png'] });
    assert.equal(plain.stats.totals.filesTouched - ex.stats.totals.filesTouched, 1);
    assert.equal(ex.stats.totals.linesAdded, plain.stats.totals.linesAdded, 'a binary file adds no lines');
  });

  test('paths with spaces, unicode and regex specials are matched on the real repo', async () => {
    const plain = await gen('s1');
    const ex = await gen('s2', { exclude: ['my docs/', 'c++/'] });
    assert.equal(plain.stats.totals.filesTouched - ex.stats.totals.filesTouched, 2);
    assert.equal(plain.stats.totals.linesAdded - ex.stats.totals.linesAdded, 10);
    const ex2 = await gen('s3', { exclude: ['ünï note.md', 'x(1).cpp'] });
    assert.equal(ex2.stats.totals.filesTouched, ex.stats.totals.filesTouched);
    assert.ok(!ex2.stats.languages.languages.some((l) => l.name === 'C++'));
  });

  test('hot files, languages and totals all drop the same files', async () => {
    const ex = await gen('h1', { exclude: ['*.md', '*.png', 'c++'] });
    assert.deepEqual(ex.stats.hotFiles.map((f) => f.path), ['src/a.js']);
    assert.deepEqual(ex.stats.languages.languages.map((l) => l.name), ['JavaScript']);
    assert.equal(ex.stats.totals.filesTouched, 1);
    assert.equal(ex.stats.totals.linesAdded, 12);
    assert.equal(ex.stats.totals.linesRemoved, 0);
  });

  test('--author: contributors lines also follow the filter', async () => {
    const plain = await gen('a1', { author: 'ada@example.com' });
    const ex = await gen('a2', { author: 'ada@example.com', exclude: ['docs/'] });
    assert.equal(ex.stats.totals.commits, plain.stats.totals.commits);
    assert.ok(ex.stats.totals.linesAdded < plain.stats.totals.linesAdded);
    const ada = (s) => s.stats.contributors.top.find((c) => c.name === 'Ada');
    assert.equal(ada(ex).commits, ada(plain).commits);
    assert.equal(ada(ex).added, ex.stats.totals.linesAdded, 'contributor lines follow the filter');
  });

  test('multi-repo: anchored "/web" drops one whole repo\'s files; its commits stay', async () => {
    const r = await generate({ paths: [repo, other], out: join(root, 'm1'), png: false, exclude: ['/web'] }, { today: TODAY });
    const byName = Object.fromEntries(r.stats.repos.map((x) => [x.name, x]));
    assert.equal(byName.web.commits, 1);
    assert.equal(byName.web.linesAdded, 0);
    assert.equal(byName.web.filesTouched, 0);
    assert.ok(byName.app.filesTouched > 0);
    // "docs" (unanchored) hits docs/ in both repos; root-relative "/docs" also both (checked per repo).
    const both = await generate({ paths: [repo, other], out: join(root, 'm2'), png: false, exclude: ['/docs/'] }, { today: TODAY });
    assert.ok(!both.stats.hotFiles.some((f) => /^(app|web)\/docs\//.test(f.path)));
    assert.equal(Object.fromEntries(both.stats.repos.map((x) => [x.name, x])).web.linesAdded, 5);
  });

  test('run: repeated flags land in stats.json filters.exclude in order, as given', async () => {
    const out = join(root, 'j1');
    const code = await run([repo, '--exclude', '*.png', '--exclude=docs\\', '--exclude', ' c++ ', '--json', '--no-png', '--out', out], { stdout: sink, stderr: sink, env: {}, today: TODAY });
    assert.equal(code, 0);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.filters.exclude, ['*.png', 'docs\\', 'c++']);
    assert.ok(!doc.stats.hotFiles.some((f) => f.path.startsWith('docs/')));
  });
});
