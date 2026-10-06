// Multi-repo Wrapped: `gitwrapped repoA repoB ...` merges histories (repo-prefixed paths,
// per-repo breakdown on the totals / hot-files cards, stats.json and the recap). Single
// repo output stays exactly as it was.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildCardSpecs, displayRepoName, layoutCard, renderShareCard, repoRows } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { generate, HELP_TEXT, parseCli, run } from '../src/cli.js';
import { mergeHistories, repoLabels } from '../src/git.js';
import { buildStatsJson } from '../src/json.js';
import { computeHotFiles, computeLanguages, computeRepos, computeStats, repoRelativePath } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-05';

/** A commit as readCommits() returns it. */
function commit(hash, date, files = [{ path: 'src/a.js', added: 2, removed: 1 }], email = 'a@x.io', author = 'Ada') {
  return {
    hash, author, email, date, parents: ['p'], subject: `feat: ${hash}`, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

/** A throwaway repo at `dir` with `steps` ([{date, files: {path: content}, email}]), oldest first. */
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

describe('repoLabels', () => {
  test('keeps names, suffixes collisions (case-insensitive), fills empty names', () => {
    assert.deepEqual(repoLabels(['api', 'web']), ['api', 'web']);
    assert.deepEqual(repoLabels(['app', 'app', 'app']), ['app', 'app-2', 'app-3']);
    assert.deepEqual(repoLabels(['app', 'app-2', 'app']), ['app', 'app-2', 'app-3']);
    assert.deepEqual(repoLabels(['App', 'app']), ['App', 'app-2']);
    assert.deepEqual(repoLabels(['', '  ']), ['repo', 'repo-2']);
  });

  test('invisible characters (bidi, zero-width, controls) are stripped before trimming and collisions', () => {
    assert.deepEqual(repoLabels(['\u202e']), ['repo']);
    assert.deepEqual(repoLabels(['app', 'app\u202e']), ['app', 'app-2']);
    assert.deepEqual(repoLabels(['a\u200bp\u2066p\u2069', 'app']), ['app', 'app-2']);
    assert.deepEqual(repoLabels(['\u0007 web \ufeff', '\u2028']), ['web', 'repo']);
  });
});

describe('mergeHistories', () => {
  const a = [commit('a2', '2026-10-03T10:00:00+00:00'), commit('a1', '2026-10-01T10:00:00+00:00')];
  const b = [commit('b1', '2026-10-02T10:00:00+00:00', [{ path: 'README.md', added: 1, removed: 0 }])];

  test('sorts newest first, labels commits, prefixes paths and never mutates the input', () => {
    const before = JSON.stringify([a, b]);
    const m = mergeHistories([{ label: 'api', commits: a }, { label: 'web', commits: b }]);
    assert.deepEqual(m.commits.map((c) => c.hash), ['a2', 'b1', 'a1']);
    assert.deepEqual(m.commits.map((c) => c.repo), ['api', 'web', 'api']);
    assert.equal(m.commits[1].files[0].path, 'web/README.md');
    assert.equal(m.truncated, false);
    assert.equal(JSON.stringify([a, b]), before);
  });

  test('instants, not wall-clock strings, decide the order; ties keep repo order', () => {
    const x = [commit('x', '2026-10-01T12:00:00+03:00')]; // 09:00Z
    const y = [commit('y', '2026-10-01T10:00:00+00:00')]; // 10:00Z: newer
    const z = [commit('z', '2026-10-01T10:00:00+00:00')];
    assert.deepEqual(mergeHistories([{ label: 'x', commits: x }, { label: 'y', commits: y }]).commits.map((c) => c.hash), ['y', 'x']);
    assert.deepEqual(mergeHistories([{ label: 'y', commits: y }, { label: 'z', commits: z }]).commits.map((c) => c.hash), ['y', 'z']);
  });

  test('limit caps the merged history (most recent first); truncated from any repo or the cap', () => {
    const m = mergeHistories([{ label: 'api', commits: a }, { label: 'web', commits: b }], { limit: 2 });
    assert.deepEqual(m.commits.map((c) => c.hash), ['a2', 'b1']);
    assert.equal(m.truncated, true);
    assert.equal(mergeHistories([{ label: 'api', commits: a, truncated: true }, { label: 'web', commits: b }]).truncated, true);
  });

  test('a commit shared by two repos (fork / second clone) counts once, under the first', () => {
    const m = mergeHistories([{ label: 'api', commits: a }, { label: 'fork', commits: [...a, ...b] }]);
    assert.deepEqual(m.commits.map((c) => `${c.repo}:${c.hash}`), ['api:a2', 'fork:b1', 'api:a1']);
  });
});

describe('stats on merged history', () => {
  test('ignore rules apply at each repo root; languages still detected on prefixed paths', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit('1', '2026-10-01T10:00:00+00:00', [{ path: 'dist/app.js', added: 9, removed: 0 }, { path: 'package-lock.json', added: 9, removed: 0 }, { path: 'src/x.py', added: 3, removed: 0 }])] },
      { label: 'web', commits: [commit('2', '2026-10-02T10:00:00+00:00', [{ path: 'build/out.js', added: 9, removed: 0 }, { path: 'src/dist/real.ts', added: 2, removed: 0 }])] },
    ]).commits;
    assert.deepEqual(computeHotFiles(merged).map((f) => f.path).sort(), ['api/src/x.py', 'web/src/dist/real.ts']);
    assert.deepEqual(computeLanguages(merged).languages.map((l) => l.name), ['Python', 'TypeScript']);
    assert.equal(repoRelativePath({ repo: 'api' }, 'api/dist/a.js'), 'dist/a.js');
    assert.equal(repoRelativePath({}, 'api/dist/a.js'), 'api/dist/a.js');
  });

  test('computeRepos: every repo, sorted by commits, shares of all commits', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit('1', '2026-10-01T10:00:00+00:00')] },
      { label: 'web', commits: [commit('2', '2026-10-02T10:00:00+00:00'), commit('3', '2026-10-03T10:00:00+00:00', [{ path: 'b.js', added: 5, removed: 0 }])] },
      { label: 'docs', commits: [] },
    ]).commits;
    assert.deepEqual(computeRepos(merged, ['api', 'web', 'docs']), [
      { name: 'web', commits: 2, linesAdded: 7, linesRemoved: 1, filesTouched: 2, share: 66.7 },
      { name: 'api', commits: 1, linesAdded: 2, linesRemoved: 1, filesTouched: 1, share: 33.3 },
      { name: 'docs', commits: 0, linesAdded: 0, linesRemoved: 0, filesTouched: 0, share: 0 },
    ]);
    const stats = computeStats(merged, { today: TODAY, repos: ['api', 'web', 'docs'] });
    assert.equal(Object.keys(stats).at(-1), 'repos');
    assert.equal(stats.totals.filesTouched, 3);
    // One repo (or none): no key, so single-repo stats are unchanged.
    assert.equal('repos' in computeStats(merged, { today: TODAY, repos: ['api'] }), false);
    assert.equal('repos' in computeStats(merged, { today: TODAY }), false);
  });
});

/** Stats of `n` repos with commits spread over a few days. */
function multiStats(n, { long = false } = {}) {
  const names = Array.from({ length: n }, (_, i) => (long ? `a-really-long-repository-name-number-${i}-of-many` : `repo${i}`));
  const histories = names.map((label, r) => ({
    label,
    commits: Array.from({ length: r + 2 }, (_, i) => commit(`${r}-${i}`, `2026-09-${String(10 + i).padStart(2, '0')}T1${r % 10}:00:00+00:00`, [
      { path: `src/deep/folder/file${i % 3}.js`, added: 10 * (i + 1), removed: i },
    ], i % 2 ? 'b@x.io' : 'a@x.io', i % 2 ? 'Bob' : 'Ada')),
  }));
  const { commits } = mergeHistories(histories);
  return computeStats(commits, { today: TODAY, repos: names });
}

const overlaps = (x, y) => x.top < y.bottom && y.top < x.bottom;

describe('cards', () => {
  test('single repo: repoRows null, cards unchanged by the feature', () => {
    const stats = computeStats([commit('1', '2026-10-01T10:00:00+00:00')], { today: TODAY });
    assert.equal(repoRows(stats), null);
    assert.equal(displayRepoName(stats, { repoName: 'proj' }), 'proj');
    const specs = buildCardSpecs(stats, { repoName: 'proj', today: TODAY });
    const totals = specs.find((s) => s.id === 'totals').spec;
    assert.equal(Array.isArray(totals.chart), false);
    assert.equal(totals.chart.kind, 'split');
    assert.equal(Array.isArray(specs.find((s) => s.id === 'hot-files').spec.chart), false);
  });

  for (const n of [2, 4, 7]) {
    for (const lang of ['en', 'tr']) {
      for (const long of [false, true]) {
        test(`${n} repos (${lang}${long ? ', long names' : ''}): per-repo bars fit on totals and hot files, no overlap`, () => {
          const stats = multiStats(n, { long });
          const specs = buildCardSpecs(stats, { repoName: 'ignored', today: TODAY, lang });
          const L = lang === 'tr' ? tr : en;
          for (const id of ['totals', 'hot-files']) {
            const { spec } = specs.find((s) => s.id === id);
            assert.ok(Array.isArray(spec.chart) && spec.chart.length === 2, `${id} has two charts`);
            const repoChart = spec.chart[1];
            assert.equal(repoChart.items.length, Math.min(n, 4));
            if (n > 4) assert.equal(repoChart.items.at(-1).label, L.repos.moreBar(n - 3));
            const { blocks } = layoutCard(spec);
            // Both charts survive the layout (none dropped).
            assert.equal(blocks.filter((b) => b.kind === 'hbars' || b.kind === 'split').length, 2, `${id}: a chart was dropped`);
            for (const b of blocks) {
              assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${id}: ${b.kind} outside content area`);
            }
            for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) assert.ok(!overlaps(blocks[i], blocks[j]), `${id}: ${blocks[i].kind} overlaps ${blocks[j].kind}`);
          }
          const intro = specs.find((s) => s.id === 'intro').spec;
          assert.equal(intro.big, L.repos.name(n));
          assert.match(intro.subtitle, new RegExp(L.repos.featuring('').slice(0, 6)));
          assert.match(specs[0].spec.footer, new RegExp(`^${L.repos.name(n)}`));
          assert.ok(specs.find((s) => s.id === 'outro').spec.title.includes(L.repos.name(n)));
          assert.match(renderShareCard(stats, { today: TODAY, lang }), new RegExp(L.repos.name(n)));
        });
      }
    }
  }
});

describe('recap and stats.json', () => {
  test('recap lists repos (top five, then "…and N more"); single repo has no Repos line', () => {
    const out = formatSummary(multiStats(7), { paths: { html: 'x.html' } });
    assert.match(out, /Repos +7 repos/);
    assert.equal((out.match(/^ {4}repo\d/gm) ?? []).length, 5);
    assert.match(out, /…and 2 more/);
    const single = formatSummary(computeStats([commit('1', '2026-10-01T10:00:00+00:00')], { today: TODAY }), { paths: { html: 'x.html' } });
    assert.doesNotMatch(single, /Repos/);
  });

  test('stats.json: repo null + repos labels for several repos; single repo unchanged', () => {
    const stats = multiStats(2);
    const doc = JSON.parse(buildStatsJson({ stats, repoName: '2 repos', repos: ['repo0', 'repo1'], version: '1', asOf: TODAY }));
    assert.equal(doc.repo, null);
    assert.deepEqual(doc.repos, ['repo0', 'repo1']);
    assert.deepEqual(Object.keys(doc).slice(0, 5), ['schemaVersion', 'generator', 'repo', 'repos', 'asOf']);
    assert.equal(doc.stats.repos.length, 2);
    const one = JSON.parse(buildStatsJson({ stats, repoName: 'p', version: '1', asOf: TODAY }));
    assert.equal(one.repo, 'p');
    assert.equal('repos' in one, false);
  });
});

describe('CLI', () => {
  test('parseCli: several paths → paths (path is the first); one path has no paths key', () => {
    const o = parseCli(['a', 'b', '', '--no-png']);
    assert.equal(o.path, 'a');
    assert.deepEqual(o.paths, ['a', 'b', '.']);
    assert.equal('paths' in parseCli(['a']), false);
    assert.equal('paths' in parseCli([]), false);
    assert.match(HELP_TEXT, /gitwrapped \[path\.\.\.\] \[options\]/);
  });

  let tmp;
  let api;
  let web;
  let app2;
  let notRepo;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-multi-'));
    api = makeRepo(join(tmp, 'api'), [
      { date: '2026-09-01T10:00:00+00:00', files: { 'src/server.js': 'a\nb\n', 'package-lock.json': '{}\n', 'dist/bundle.js': 'x\n' } },
      { date: '2026-09-03T10:00:00+00:00', files: { 'src/server.js': 'a\nb\nc\n' } },
      { date: '2026-09-05T10:00:00+00:00', files: { 'src/server.js': 'a\nc\n' }, email: 'bob@example.com', name: 'Bob' },
    ]);
    web = makeRepo(join(tmp, 'web'), [
      { date: '2026-09-02T10:00:00+00:00', files: { 'src/App.tsx': 'x\n' } },
      { date: '2026-09-04T10:00:00+00:00', files: { 'src/App.tsx': 'x\ny\n', 'README.md': '# web\n' } },
    ]);
    // Same folder name as `api`: labelled api-2.
    app2 = makeRepo(join(tmp, 'other', 'api'), [{ date: '2026-09-06T10:00:00+00:00', files: { 'main.go': 'package main\n' } }]);
    notRepo = join(tmp, 'plain');
    mkdirSync(notRepo);
  });
  after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

  test('generate merges repos: prefixed paths, per-repo stats, label collisions, stats.json', async () => {
    const out = join(tmp, 'out1');
    const r = await generate({ path: api, paths: [api, web, app2], out, png: false, json: true }, { today: TODAY });
    assert.equal(r.commits, 6);
    assert.deepEqual(r.repos, ['api', 'web', 'api-2']);
    assert.equal(r.repoName, '3 repos');
    assert.deepEqual(r.stats.repos.map((x) => [x.name, x.commits]), [['api', 3], ['web', 2], ['api-2', 1]]);
    assert.equal(r.stats.hotFiles[0].path, 'api/src/server.js');
    // Lockfile and root build output of a repo are still ignored.
    assert.ok(!r.stats.hotFiles.some((f) => /package-lock|dist\//.test(f.path)));
    assert.equal(r.stats.contributors.total, 2);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.repos, ['api', 'web', 'api-2']);
    assert.equal(doc.repo, null);
    assert.match(readFileSync(join(out, 'wrapped.html'), 'utf8'), /<title>gitwrapped · 3 repos<\/title>/);
  });

  test('--max-commits caps the merged history: the most recent commits across repos', async () => {
    const r = await generate({ path: api, paths: [api, web], out: join(tmp, 'out2'), png: false, maxCommits: 3 }, { today: TODAY });
    assert.equal(r.commits, 3);
    assert.equal(r.truncated, true);
    // Sep 5 (api), Sep 4 (web), Sep 3 (api).
    assert.deepEqual(r.stats.repos.map((x) => [x.name, x.commits]), [['api', 2], ['web', 1]]);
  });

  test('--since and --author apply to every repo', async () => {
    const r = await generate({ path: api, paths: [api, web], out: join(tmp, 'out3'), png: false, since: '2026-09-03', author: 'ada@example.com' }, { today: TODAY });
    assert.equal(r.commits, 2); // api Sep 3, web Sep 4
    // The team read covers both repos too.
    assert.equal(r.stats.contributors.total, 2);
    assert.equal(r.stats.contributors.you.commits, 2);
  });

  test('run: recap names the repos; errors name the bad path or the duplicate', async () => {
    const capture = () => {
      let s = '';
      return { write: (x) => { s += x; }, get text() { return s; } };
    };
    let stdout = capture();
    let stderr = capture();
    assert.equal(await run([api, web, '--out', join(tmp, 'out4'), '--no-png', '--no-color'], { stdout, stderr, today: TODAY }), 0);
    assert.match(stdout.text, /★ 2 repos Wrapped/);
    assert.match(stdout.text, /Repos +2 repos\n {4}api +3 commits/);
    assert.match(stdout.text, /Hottest file api\/src\/server\.js/);

    stdout = capture();
    stderr = capture();
    assert.equal(await run([api, notRepo, '--out', join(tmp, 'out5'), '--no-png'], { stdout, stderr, today: TODAY }), 1);
    assert.equal(stderr.text, `gitwrapped: not a git repository: ${notRepo}\n`);

    stderr = capture();
    assert.equal(await run([api, join(api, 'src'), '--out', join(tmp, 'out6'), '--no-png'], { stdout, stderr, today: TODAY }), 1);
    assert.equal(stderr.text, `gitwrapped: the same repository was given twice: ${api} and ${join(api, 'src')}\n`);
  });

  const capture = () => {
    let text = '';
    return { write: (x) => { text += x; }, get text() { return text; } };
  };

  test('--year window applies to every repo', async () => {
    const r = await generate({ path: api, paths: [api, web], out: join(tmp, 'out8'), png: false, since: '2026-01-01', until: '2026-12-31' }, { today: TODAY });
    assert.equal(r.commits, 5);
    const none = await generate({ path: api, paths: [api, web], out: join(tmp, 'out9'), png: false, since: '2025-01-01', until: '2025-12-31' }, { today: TODAY });
    assert.equal(none.commits, 0);
    assert.deepEqual(none.stats.repos.map((x) => x.commits), [0, 0]);
  });

  test('run: the multi-repo truncation note', async () => {
    const stdout = capture();
    assert.equal(await run([api, web, '--out', join(tmp, 'out10'), '--no-png', '--no-color', '--max-commits', '2'], { stdout, stderr: capture(), today: TODAY }), 0);
    assert.ok(stdout.text.includes(en.notes.truncatedRepos('2')), stdout.text);
  });

  test('"--" ends options: later paths may start with "-"', async () => {
    assert.deepEqual(parseCli(['--no-png', '--', '-odd', 'b']).paths, ['-odd', 'b']);
    const dashed = makeRepo(join(tmp, '-dash'), [{ date: '2026-09-07T10:00:00+00:00', files: { 'x.md': 'x\n' } }]);
    const stdout = capture();
    const old = process.cwd();
    process.chdir(tmp);
    try {
      assert.equal(await run(['--out', join(tmp, 'out11'), '--no-png', '--no-color', '--', api, '-dash'], { stdout, stderr: stdout, today: TODAY }), 0);
    } finally {
      process.chdir(old);
    }
    assert.ok(dashed);
    assert.match(stdout.text, /★ 2 repos Wrapped/);
    assert.match(stdout.text, / {4}-dash +1 commit/);
  });

  test('a git worktree of a repo already given is a duplicate; checked before any read', async () => {
    const wt = join(tmp, 'api-wt');
    git(api, ['worktree', 'add', '-q', '-b', 'wt-branch', wt]);
    const stderr = capture();
    assert.equal(await run([api, wt, '--out', join(tmp, 'out12'), '--no-png'], { stdout: capture(), stderr, today: TODAY }), 1);
    assert.equal(stderr.text, `gitwrapped: the same repository was given twice: ${api} and ${wt}\n`);
    // The duplicate is found before a later bad path is ever read.
    const stderr2 = capture();
    assert.equal(await run([api, wt, join(tmp, 'missing'), '--out', join(tmp, 'out13'), '--no-png'], { stdout: capture(), stderr: stderr2, today: TODAY }), 1);
    assert.match(stderr2.text, /given twice/);
    // A bad path before the duplicate is named first.
    const stderr3 = capture();
    assert.equal(await run([notRepo, api, wt, '--out', join(tmp, 'out14'), '--no-png'], { stdout: capture(), stderr: stderr3, today: TODAY }), 1);
    assert.equal(stderr3.text, `gitwrapped: not a git repository: ${notRepo}\n`);
  });

  test('unborn HEAD in one of several repos: the note names that repo (en and tr)', async () => {
    const orphan = makeRepo(join(tmp, 'orphan'), [{ date: '2026-09-08T10:00:00+00:00', files: { 'a.md': 'a\n' } }]);
    git(orphan, ['switch', '-q', '--orphan', 'empty']);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const stdout = capture();
      assert.equal(await run([api, orphan, '--out', join(tmp, `out15-${lang}`), '--no-png', '--no-color', '--lang', lang], { stdout, stderr: capture(), today: TODAY }), 0);
      assert.ok(stdout.text.includes(L.notes.unbornRepos('orphan')), stdout.text);
      assert.ok(!stdout.text.includes(L.notes.unborn));
    }
  });

  test('a repo name with <&" and bidi characters is escaped (SVG, wrapped.html) and stripped from labels', { skip: process.platform === 'win32' && 'file name not allowed on Windows' }, async () => {
    const odd = makeRepo(join(tmp, 'a<&"b\u202ec'), [{ date: '2026-09-09T10:00:00+00:00', files: { 'src/z.js': 'z\n' } }]);
    const out = join(tmp, 'out16');
    const r = await generate({ path: api, paths: [api, odd], out, png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.repos, ['api', 'a<&"bc']);
    const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
    const svgs = readdirSync(join(out, 'cards')).map((f) => readFileSync(join(out, 'cards', f), 'utf8'));
    for (const text of [html, ...svgs]) {
      assert.ok(!text.includes('a<&"b'), 'raw name leaked');
      assert.ok(!text.includes('\u202e'), 'bidi char leaked');
    }
    assert.ok(html.includes('a&lt;&amp;&quot;bc') || html.includes('a&lt;&amp;"bc'));
    assert.ok(svgs.some((x) => x.includes('a&lt;&amp;&quot;bc')));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).repos, ['api', 'a<&"bc']);
  });

  test('--lang tr names the repos in Turkish', async () => {
    let s = '';
    const stdout = { write: (x) => { s += x; } };
    assert.equal(await run([api, web, '--out', join(tmp, 'out7'), '--no-png', '--no-color', '--lang', 'tr'], { stdout, stderr: stdout, today: TODAY }), 0);
    assert.match(s, /★ 2 repo Wrapped/);
    assert.match(s, /Repolar/);
  });
});
