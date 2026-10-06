// Extra edge cases for multi-repo Wrapped (`gitwrapped repoA repoB ...`), from the tester.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { generate, parseCli, run } from '../src/cli.js';
import { repoLabels } from '../src/git.js';

const TODAY = '2026-10-05';

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

/** A throwaway repo at `dir` with `steps` ([{date, files: {path: content}, email, name}]), oldest first. */
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
    const who = { GIT_AUTHOR_NAME: s.name ?? 'Ada', GIT_AUTHOR_EMAIL: s.email ?? 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };
    git(dir, ['commit', '-q', '--allow-empty', '-m', s.subject ?? `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
  return dir;
}

const capture = () => {
  let s = '';
  return { write: (x) => { s += x; }, get text() { return s; } };
};

/** Every text file below `dir`. */
function readAll(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...readAll(p));
    else if (/\.(svg|html|json)$/.test(e.name)) out.push({ p, s: readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '') });
  }
  return out;
}

const BAD = /undefined|NaN|\[object |null commits|\$\{/;

describe('parseCli with several paths', () => {
  test('3 paths + every option', () => {
    const o = parseCli(['a', 'b', 'c', '--since', '2026-01-01', '--until', '2026-06-30', '--author', 'x@y.z', '--out', 'o', '--lang', 'tr', '--theme', 'mono', '--max-commits', '10', '--no-png', '--json', '--open', '--no-color']);
    assert.equal(o.path, 'a');
    assert.deepEqual(o.paths, ['a', 'b', 'c']);
    assert.equal(o.since, '2026-01-01');
    assert.equal(o.until, '2026-06-30');
    assert.equal(o.author, 'x@y.z');
    assert.equal(o.out, 'o');
    assert.equal(o.lang, 'tr');
    assert.equal(o.theme, 'mono');
    assert.equal(o.maxCommits, 10);
    assert.equal(o.png, false);
    assert.equal(o.json, true);
    assert.equal(o.open, true);
    assert.equal(o.color, false);
  });

  test('options interleaved between paths; --year with several paths', () => {
    const o = parseCli(['a', '--year', '2025', 'b', '--no-png', 'c']);
    assert.deepEqual(o.paths, ['a', 'b', 'c']);
    assert.equal(o.since, '2025-01-01');
    assert.equal(o.until, '2025-12-31');
  });

  test('labels: collisions with existing suffixes and case', () => {
    assert.deepEqual(repoLabels(['app', 'APP', 'App-2', 'app']), ['app', 'APP-2', 'App-2-2', 'app-3']);
    assert.deepEqual(repoLabels([' web ', 'web']), ['web', 'web-2']);
  });
});

describe('multi-repo generate / run', () => {
  let tmp;
  let api; // 2025-12 + 2026-09 commits
  let web;
  let api2; // other/api
  let api3; // third/API
  let empty;
  let notRepo;
  let distRepo; // a repo whose folder is named "dist"
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-multi-x-'));
    api = makeRepo(join(tmp, 'api'), [
      { date: '2025-12-20T10:00:00+00:00', files: { 'old.js': 'o\n' } },
      { date: '2026-09-01T10:00:00+00:00', files: { 'src/server.js': 'a\nb\n', 'package-lock.json': '{}\n', 'dist/bundle.js': 'x\n', 'vendor/lib.js': 'v\n' } },
      { date: '2026-09-03T10:00:00+00:00', files: { 'src/server.js': 'a\nb\nc\n' } },
      { date: '2026-09-05T10:00:00+00:00', files: { 'src/server.js': 'a\nc\n' }, email: 'bob@example.com', name: 'Bob' },
    ]);
    web = makeRepo(join(tmp, 'web'), [
      { date: '2026-09-02T10:00:00+00:00', files: { 'src/App.tsx': 'x\n' } },
      { date: '2026-09-04T10:00:00+00:00', files: { 'src/App.tsx': 'x\ny\n', 'README.md': '# web\n' }, email: 'bob@example.com', name: 'Bob' },
      { date: '2026-09-06T10:00:00+00:00', files: { 'src/App.tsx': 'x\ny\nz\n' } },
    ]);
    api2 = makeRepo(join(tmp, 'other', 'api'), [{ date: '2026-09-07T10:00:00+00:00', files: { 'main.go': 'package main\n' } }]);
    api3 = makeRepo(join(tmp, 'third', 'API'), [{ date: '2026-09-08T10:00:00+00:00', files: { 'lib.rs': 'fn main() {}\n' } }]);
    empty = join(tmp, 'empty');
    mkdirSync(empty);
    git(empty, ['init', '-q', '-b', 'main']);
    notRepo = join(tmp, 'plain');
    mkdirSync(notRepo);
    distRepo = makeRepo(join(tmp, 'dist'), [{ date: '2026-09-09T10:00:00+00:00', files: { 'src/index.py': 'print(1)\n' } }]);
  });
  after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

  const out = (n) => join(tmp, `out-${n}`);

  test('three same-basename repos (case-insensitive): api, api-2, API-3', async () => {
    const r = await generate({ path: api, paths: [api, api2, api3], out: out('labels'), png: false }, { today: TODAY });
    assert.deepEqual(r.repos, ['api', 'api-2', 'API-3']);
    const paths = r.stats.hotFiles.map((f) => f.path);
    assert.ok(paths.includes('api-2/main.go'));
    assert.ok(paths.includes('API-3/lib.rs'));
  });

  test('duplicates: relative vs absolute, trailing slash, symlink, literal repeat', async () => {
    const rel = relative(process.cwd(), api) || '.';
    for (const second of [rel, `${api}/`, api]) {
      const stderr = capture();
      const code = await run([api, second, '--out', out('dup'), '--no-png'], { stdout: capture(), stderr, today: TODAY });
      assert.equal(code, 1, `duplicate ${second} not detected`);
      assert.match(stderr.text, /the same repository was given twice/);
    }
    const link = join(tmp, 'api-link');
    symlinkSync(api, link);
    const stderr = capture();
    assert.equal(await run([api, web, link, '--out', out('dup2'), '--no-png'], { stdout: capture(), stderr, today: TODAY }), 1);
    assert.equal(stderr.text, `gitwrapped: the same repository was given twice: ${api} and ${link}\n`);
  });

  test('--year and --until windows apply per repo; a repo with no commits in the window is listed with zeros', async () => {
    const y = await generate({ path: api, paths: [api, web], out: out('year'), png: false, since: '2025-01-01', until: '2025-12-31' }, { today: TODAY });
    assert.equal(y.commits, 1);
    assert.deepEqual(y.stats.repos, [
      { name: 'api', commits: 1, linesAdded: 1, linesRemoved: 0, filesTouched: 1, share: 100 },
      { name: 'web', commits: 0, linesAdded: 0, linesRemoved: 0, filesTouched: 0, share: 0 },
    ]);
    assert.equal(y.pastWindow, true);
    const u = await generate({ path: api, paths: [api, web], out: out('until'), png: false, since: '2026-09-02', until: '2026-09-04' }, { today: TODAY });
    assert.deepEqual(u.stats.repos.map((x) => [x.name, x.commits]), [['web', 2], ['api', 1]]);
  });

  test('run --year: recap lists both repos, zero row included', async () => {
    const stdout = capture();
    assert.equal(await run([api, web, '--year', '2025', '--out', out('year-run'), '--no-png', '--no-color'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.match(stdout.text, /Repos +2 repos/);
    assert.match(stdout.text, /^ {4}web +0 commits/m);
  });

  test('--max-commits caps the total across 3 repos, newest overall kept', async () => {
    // Newest: api3 Sep 8, api2 Sep 7, web Sep 6, api Sep 5.
    const r = await generate({ path: api, paths: [api, web, api2, api3], out: out('cap'), png: false, maxCommits: 4 }, { today: TODAY });
    assert.equal(r.commits, 4);
    assert.equal(r.truncated, true);
    assert.equal(r.limit, 4);
    assert.deepEqual(Object.fromEntries(r.stats.repos.map((x) => [x.name, x.commits])), { api: 1, web: 1, 'api-2': 1, 'API-3': 1 });
    // Exactly the total, not truncated.
    const exact = await generate({ path: api, paths: [api2, api3], out: out('cap2'), png: false, maxCommits: 2 }, { today: TODAY });
    assert.equal(exact.commits, 2);
    assert.equal(exact.truncated, false);
  });

  test('run --max-commits: the multi-repo truncation note', async () => {
    const stdout = capture();
    assert.equal(await run([api, web, '--max-commits', '2', '--out', out('cap-run'), '--no-png', '--no-color'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.match(stdout.text, /these repos have more than 2 commits together/);
  });

  test('--author across repos: only that author, team counted in both repos', async () => {
    const r = await generate({ path: api, paths: [api, web], out: out('author'), png: false, author: 'bob@example.com' }, { today: TODAY });
    assert.equal(r.commits, 2);
    // Tied on commits: web's Bob commit changed more lines (+2) than api's (−1).
    assert.deepEqual(r.stats.repos.map((x) => [x.name, x.commits, x.linesAdded, x.linesRemoved]), [['web', 1, 2, 0], ['api', 1, 0, 1]]);
    assert.equal(r.stats.contributors.total, 2);
    assert.equal(r.stats.contributors.you.commits, 2);
    // An author with no commits anywhere: still succeeds, every repo zero.
    const none = await generate({ path: api, paths: [api, web], out: out('author2'), png: false, author: 'nobody@example.com' }, { today: TODAY });
    assert.equal(none.commits, 0);
    assert.deepEqual(none.stats.repos.map((x) => x.commits), [0, 0]);
  });

  test('ignore rules on prefixed paths; a repo named "dist" is not ignored', async () => {
    const r = await generate({ path: api, paths: [api, distRepo], out: out('ignore'), png: false }, { today: TODAY });
    const paths = r.stats.hotFiles.map((f) => f.path);
    assert.ok(!paths.some((p) => /package-lock|api\/dist\/|api\/vendor\//.test(p)), paths.join(','));
    assert.ok(paths.includes('dist/src/index.py'), paths.join(','));
    assert.ok(r.stats.languages.languages.some((l) => l.name === 'Python'));
    assert.ok(!r.stats.languages.languages.some((l) => l.name === 'JSON'));
    // filesTouched in the per-repo row still counts every file (as totals do).
    assert.equal(r.stats.repos.find((x) => x.name === 'api').filesTouched, 5);
  });

  test('--json: multi-repo shape; single repo has no repos key', async () => {
    await generate({ path: api, paths: [api, web, empty], out: out('json'), png: false, json: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(join(out('json'), 'stats.json'), 'utf8'));
    assert.equal(doc.repo, null);
    assert.deepEqual(doc.repos, ['api', 'web', 'empty']);
    assert.equal(doc.stats.repos.length, 3);
    for (const row of doc.stats.repos) assert.deepEqual(Object.keys(row), ['name', 'commits', 'linesAdded', 'linesRemoved', 'filesTouched', 'share']);
    assert.equal(doc.stats.repos.reduce((n, x) => n + x.commits, 0), doc.stats.totals.commits);
    assert.ok(doc.stats.hotFiles.every((f) => /^(api|web)\//.test(f.path)));

    const single = await generate({ path: api, out: out('json1'), png: false, json: true }, { today: TODAY });
    const one = JSON.parse(readFileSync(join(out('json1'), 'stats.json'), 'utf8'));
    assert.equal(one.repo, 'api');
    assert.equal('repos' in one, false);
    assert.equal('repos' in one.stats, false);
    assert.equal('repos' in single, false);
    assert.equal(single.repoName, 'api');
    assert.ok(single.stats.hotFiles.every((f) => !f.path.startsWith('api/')));
    // paths with one entry behaves like a single repo.
    const solo = await generate({ path: api, paths: [api], out: out('json2'), png: false }, { today: TODAY });
    assert.equal('repos' in solo, false);
    assert.equal(solo.repoName, 'api');
  });

  test('single repo run: parseCli has no paths, recap unchanged (no Repos line)', async () => {
    const o = parseCli([api, '--no-png']);
    assert.equal(o.path, api);
    assert.equal('paths' in o, false);
    const stdout = capture();
    assert.equal(await run([api, '--out', out('single'), '--no-png', '--no-color'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.match(stdout.text, /★ api Wrapped/);
    assert.doesNotMatch(stdout.text, /Repos/);
    assert.match(stdout.text, /Hottest file src\/server\.js/);
  });

  test('--lang tr multi-repo: no missing strings in recap, cards, viewer', async () => {
    const stdout = capture();
    const o = out('tr');
    assert.equal(await run([api, web, api2, api3, distRepo, empty, '--lang', 'tr', '--json', '--out', o, '--no-png', '--no-color'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.doesNotMatch(stdout.text, BAD);
    assert.match(stdout.text, /★ 6 repo Wrapped/);
    // Six repos are all listed (no "…and 1 more" line for a single extra repo).
    assert.match(stdout.text, /^ {4}empty +0 commit/m);
    assert.doesNotMatch(stdout.text, /repo daha/);
    for (const { p, s } of readAll(o)) assert.doesNotMatch(s, BAD, p);
    assert.match(readFileSync(join(o, 'cards', readdirSync(join(o, 'cards')).find((f) => f.includes('totals'))), 'utf8'), /REPO BAŞINA COMMIT/);
  });

  test('en multi-repo with 6 repos: no missing strings either', async () => {
    const stdout = capture();
    const o = out('en6');
    assert.equal(await run([api, web, api2, api3, distRepo, empty, '--out', o, '--no-png', '--no-color'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.doesNotMatch(stdout.text, BAD);
    for (const { p, s } of readAll(o)) assert.doesNotMatch(s, BAD, p);
    assert.match(readFileSync(join(o, 'share.svg'), 'utf8'), /6 repos/);
  });

  test('--theme with multi-repo: each theme renders, and differs from default', async () => {
    const svgs = {};
    for (const theme of ['default', 'mono', 'neon']) {
      const o = out(`theme-${theme}`);
      const r = await generate({ path: api, paths: [api, web], out: o, png: false, theme }, { today: TODAY });
      assert.deepEqual(r.repos, ['api', 'web']);
      const totals = r.cardFiles.find((f) => f.includes('totals'));
      svgs[theme] = readFileSync(totals, 'utf8');
      assert.match(svgs[theme], /COMMITS BY REPO/);
    }
    assert.notEqual(svgs.mono, svgs.default);
    assert.notEqual(svgs.neon, svgs.default);
  });

  test('a non-git path among several (any position) is named in the error', async () => {
    for (const args of [[api, web, notRepo], [notRepo, api], [api, join(tmp, 'missing'), web]]) {
      const stderr = capture();
      assert.equal(await run([...args, '--out', out('bad'), '--no-png'], { stdout: capture(), stderr, today: TODAY }), 1);
      const bad = args.find((a) => a === notRepo || a.endsWith('missing'));
      assert.ok(stderr.text.includes(bad), stderr.text);
      assert.ok(stderr.text.startsWith('gitwrapped: '), stderr.text);
    }
  });

  test('an empty repo among several: listed with zeros, others counted', async () => {
    const r = await generate({ path: api, paths: [empty, web], out: out('empty'), png: false }, { today: TODAY });
    assert.equal(r.commits, 3);
    assert.deepEqual(r.repos, ['empty', 'web']);
    assert.deepEqual(r.stats.repos.map((x) => [x.name, x.commits]), [['web', 3], ['empty', 0]]);
    assert.equal(r.unbornWithRefs, false);
    // Two empty repos: no crash, zero commits.
    const empty2 = join(tmp, 'empty2');
    mkdirSync(empty2);
    git(empty2, ['init', '-q', '-b', 'main']);
    const z = await generate({ path: empty, paths: [empty, empty2], out: out('empty2'), png: false }, { today: TODAY });
    assert.equal(z.commits, 0);
    assert.deepEqual(z.stats.repos.map((x) => x.commits), [0, 0]);
  });

  test('a bare clone of a repo given too: shared commits counted once', async () => {
    const bare = join(tmp, 'bare', 'web.git');
    mkdirSync(dirname(bare), { recursive: true });
    git(tmp, ['clone', '-q', '--bare', web, bare]);
    const r = await generate({ path: web, paths: [web, bare], out: out('bare'), png: false }, { today: TODAY });
    assert.deepEqual(r.repos, ['web', 'web-2']);
    assert.equal(r.commits, 3);
    assert.deepEqual(r.stats.repos.map((x) => [x.name, x.commits]), [['web', 3], ['web-2', 0]]);
  });
});
