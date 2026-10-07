// Top folders: the most-changed top-level directories by lines changed, counted by
// computeFolders (src/stats/folders.js) over the same files as hot files, shown as
// stats.folders, a recap line, a wrapped.md table and a small list on the hot-files card
// (spare room only, two or more folders).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHistories } from '../src/git.js';
import { computeFolders, computeStats, folderOf, ROOT_FOLDER, shownFolders, TOP_FOLDERS } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, folderLabel, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});
const hotSpec = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, ...opts }).find((c) => c.id === 'hot-files').spec;
const hotSvg = (stats, lang = 'en', opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, ...opts }).find((c) => c.id === 'hot-files').svg;
const chartsOf = (spec) => (Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : []);
const folderChart = (spec) => chartsOf(spec).find((c) => c.title === en.hotFiles.foldersTitle || c.title === tr.hotFiles.foldersTitle);

const sample = () => [
  commit(1, [['src/a.js', 100, 10], ['src/b.js', 20, 0], ['README.md', 5, 1]]),
  commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]]),
  commit(3, [['docs/guide.md', 7, 0], ['package-lock.json', 5000, 4000], ['dist/app.js', 900, 0]]),
];

describe('folderOf', () => {
  test('first directory, or (root) for a root file; multi-repo keeps the label', () => {
    assert.equal(folderOf({}, 'src/a/b.js'), 'src');
    assert.equal(folderOf({}, 'README.md'), ROOT_FOLDER);
    assert.equal(folderOf({ repo: 'api' }, 'api/src/x.js'), 'api/src');
    assert.equal(folderOf({ repo: 'api' }, 'api/README.md'), 'api/(root)');
    assert.equal(folderOf({}, ''), null);
    assert.equal(folderOf({}, 42), null);
  });
});

describe('computeFolders', () => {
  test('groups by top-level folder, sums lines, counts commits once per commit', () => {
    assert.deepEqual(computeFolders(sample()), [
      { path: 'src', lines: 136, added: 123, deleted: 13, commits: 2 },
      { path: 'test', lines: 42, added: 40, deleted: 2, commits: 1 },
      { path: 'docs', lines: 7, added: 7, deleted: 0, commits: 1 },
      { path: '(root)', lines: 6, added: 5, deleted: 1, commits: 1 },
    ]);
  });

  test('ignore rules as for hot files: lockfiles, build output, node_modules, minified', () => {
    const out = computeFolders([commit(1, [['package-lock.json', 9, 9], ['dist/x.js', 9, 9], ['lib/node_modules/y/z.js', 9, 9], ['web/app.min.js', 9, 9], ['lib/ok.js', 1, 0]])]);
    assert.deepEqual(out, [{ path: 'lib', lines: 1, added: 1, deleted: 0, commits: 1 }]);
  });

  test('sorted by lines desc, ties by path asc; top 5; limit option', () => {
    const files = ['f', 'e', 'd', 'c', 'b', 'a'].map((d) => [`${d}/x.js`, 10, 0]);
    files.push(['g/x.js', 50, 0]);
    const out = computeFolders([commit(1, files)]);
    assert.equal(out.length, TOP_FOLDERS);
    assert.deepEqual(out.map((f) => f.path), ['g', 'a', 'b', 'c', 'd']);
    assert.deepEqual(computeFolders([commit(1, files)], { limit: 2 }).map((f) => f.path), ['g', 'a']);
    assert.equal(computeFolders([commit(1, files)], { limit: -1 }).length, TOP_FOLDERS);
  });

  test('folders with no lines changed (binary only) are left out', () => {
    const out = computeFolders([commit(1, [['img/logo.png', 0, 0], ['src/a.js', 1, 1]])]);
    assert.deepEqual(out.map((f) => f.path), ['src']);
  });

  test('multi-repo: repo-prefixed, root rules at each repo root', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit(1, [['src/x.js', 10, 0], ['README.md', 2, 0], ['dist/b.js', 99, 0]])] },
      { label: 'web', commits: [commit(2, [['src/y.js', 4, 0]])] },
    ]);
    assert.deepEqual(computeFolders(merged.commits).map((f) => [f.path, f.lines]), [['api/src', 10], ['web/src', 4], ['api/(root)', 2]]);
  });

  test('--exclude drops files before (excludeFiles)', () => {
    const commits = excludeFiles(sample(), compileExcludes(['docs/', 'test']));
    assert.deepEqual(computeFolders(commits).map((f) => f.path), ['src', '(root)']);
  });

  test('email-shaped folder names are scrubbed', () => {
    const out = computeFolders([commit(1, [['ada@example.com/a.js', 5, 0], ['src/a.js', 1, 0]])]);
    assert.deepEqual(out.map((f) => f.path), ['…', 'src']);
  });

  test('bad input never throws', () => {
    assert.deepEqual(computeFolders(undefined), []);
    assert.deepEqual(computeFolders(null), []);
    assert.deepEqual(computeFolders('nope'), []);
    assert.deepEqual(computeFolders([null, 7, { files: 'x' }, { files: [null, { path: 3 }, { path: 'a/b.js', added: 'x', removed: NaN }, { path: 'a/c.js', added: Infinity, removed: -4 }] }]), []);
    assert.deepEqual(computeFolders([{ files: [{ path: 'a/b.js', added: 2 }] }]), [{ path: 'a', lines: 2, added: 2, deleted: 0, commits: 1 }]);
    assert.deepEqual(computeFolders([commit(1, [['a/x', 1, 0]])], { limit: 'x' }).length, 1);
  });

  test('computeStats puts folders right after hotFiles', () => {
    const stats = computeStats(sample(), { today: TODAY });
    const keys = Object.keys(stats);
    assert.equal(keys[keys.indexOf('hotFiles') + 1], 'folders');
    assert.equal(stats.folders[0].path, 'src');
    assert.deepEqual(computeStats([], { today: TODAY }).folders, []);
  });
});

describe('shownFolders / folderLabel', () => {
  test('null with fewer than two; malformed entries skipped', () => {
    assert.equal(shownFolders(null), null);
    assert.equal(shownFolders('x'), null);
    assert.equal(shownFolders([{ path: 'src', lines: 3 }]), null);
    assert.equal(shownFolders([{ path: 'src', lines: 3 }, { path: '', lines: 2 }, { path: 'x', lines: 0 }, null, { path: 7, lines: 2 }]), null);
    const out = shownFolders([{ path: 'src', lines: 3, added: 2, deleted: 1, commits: 1 }, { path: 'api/(root)', lines: 1.5 }, { path: 'api/(root)', lines: 2, added: -1 }]);
    assert.deepEqual(out, [
      { path: 'src', repo: '', name: 'src', root: false, lines: 3, added: 2, deleted: 1, commits: 1 },
      { path: 'api/(root)', repo: 'api', name: '(root)', root: true, lines: 2, added: 0, deleted: 0, commits: 0 },
    ]);
  });

  test('folderLabel: trailing slash, localized root, repo first', () => {
    const [a, b] = shownFolders([{ path: 'src', lines: 3 }, { path: '(root)', lines: 2 }]);
    assert.equal(folderLabel(a, en), 'src/');
    assert.equal(folderLabel(b, en), '(root)');
    assert.equal(folderLabel(b, tr), '(kök)');
    const [c] = shownFolders([{ path: 'api/(root)', lines: 3 }, { path: 'api/src', lines: 2 }]);
    assert.equal(folderLabel(c, tr), 'api/(kök)');
  });
});

describe('hot-files card', () => {
  const stats = () => computeStats(sample(), { today: TODAY });

  test('a "Top folders" list after the hot files when there is room, en and tr', () => {
    for (const lang of ['en', 'tr']) {
      const L = lang === 'en' ? en : tr;
      const spec = hotSpec(stats(), lang);
      const chart = folderChart(spec);
      assert.ok(chart, lang);
      assert.equal(chartsOf(spec).at(-1), chart);
      assert.equal(chart.title, L.hotFiles.foldersTitle);
      assert.deepEqual(chart.items.map((i) => i.label), ['src/', 'test/', 'docs/'].slice(0, chart.items.length));
      assert.ok(chart.items.length >= 2 && chart.items.length <= 3);
      assert.equal(chart.items[0].value, L.hotFiles.folderValue(136));
      const svg = hotSvg(stats(), lang);
      assert.ok(svg.includes(L.upper(L.hotFiles.foldersTitle)), lang);
    }
  });

  test('the hot-files list keeps all its files at full size; at most the big word shrinks one step', () => {
    const s = stats();
    const without = { ...s, folders: [] };
    const a = layoutCard(hotSpec(without));
    const b = layoutCard(hotSpec(s));
    assert.ok(b.shrinkSteps <= a.shrinkSteps + 1);
    assert.equal(a.shrinkSteps, 0);
    assert.deepEqual(b.drawnCharts, [0, 1]);
    assert.deepEqual(chartsOf(hotSpec(s))[0], hotSpec(without).chart); // the hot-files list is the same spec
    // Five files drawn (not compacted: bars stay 18px tall at 36px labels).
    const hot = b.blocks.filter((x) => x.kind === 'hbars')[0].svg;
    assert.equal((hot.match(/<title>/g) ?? []).length, 5);
    const blocks = b.blocks.filter((x) => x.group === 'body');
    for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].top >= blocks[i - 1].bottom, 'no overlap');
  });

  test('(root) is localized on the card', () => {
    const s = { ...stats(), folders: [{ path: '(root)', lines: 9, added: 9, deleted: 0, commits: 1 }, { path: 'src', lines: 3, added: 3, deleted: 0, commits: 1 }] };
    assert.equal(folderChart(hotSpec(s)).items[0].label, '(root)');
    assert.equal(folderChart(hotSpec(s, 'tr')).items[0].label, '(kök)');
  });

  test('byte-identical without folders, with a single folder or malformed folders', () => {
    const s = stats();
    const none = { ...s };
    delete none.folders;
    const ref = hotSvg(none);
    assert.equal(hotSvg({ ...s, folders: [] }), ref);
    assert.equal(hotSvg({ ...s, folders: [{ path: '(root)', lines: 50, added: 50, deleted: 0, commits: 3 }] }), ref);
    assert.equal(hotSvg({ ...s, folders: 'x' }), ref);
    assert.equal(hotSvg({ ...s, folders: [{ path: 'a', lines: 0 }, { path: 'b', lines: -1 }] }), ref);
    assert.notEqual(hotSvg(s), ref);
  });

  test('no hot files: no folders either', () => {
    const s = { ...computeStats([], { today: TODAY }), folders: [{ path: 'a', lines: 2 }, { path: 'b', lines: 1 }] };
    assert.equal(folderChart(hotSpec(s)), undefined);
  });

  test('every theme and language: shown, or the card is exactly as without it', () => {
    const s = stats();
    const none = { ...s, folders: [] };
    for (const colorTheme of ['default', 'mono', 'neon']) {
      for (const lang of ['en', 'tr']) {
        const spec = hotSpec(s, lang, { colorTheme });
        assert.ok(folderChart(spec), `${colorTheme}/${lang}`);
        assert.ok(hotSvg(s, lang, { colorTheme }).includes((lang === 'en' ? en : tr).upper((lang === 'en' ? en : tr).hotFiles.foldersTitle)));
        assert.notEqual(hotSvg(s, lang, { colorTheme }), hotSvg(none, lang, { colorTheme }));
      }
    }
  });

  test('multi-repo: repo label as the dimmed sub; left out (card unchanged) when there is no room', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit(1, [['src/x.js', 10, 0], ['README.md', 2, 0], ['lib/q.js', 1, 0]]), commit(3, [['src/y.js', 3, 1]])] },
      { label: 'web', commits: [commit(2, [['src/y.js', 4, 0], ['docs/d.md', 1, 0]])] },
    ]);
    const s = computeStats(merged.commits, { today: TODAY, repos: ['api', 'web'] });
    for (const lang of ['en', 'tr']) {
      const spec = hotSpec(s, lang);
      const chart = folderChart(spec);
      const without = { ...s, folders: [] };
      if (chart) {
        assert.deepEqual(chart.items.map((i) => [i.label, i.sub]).slice(0, 2), [['src/', 'api'], ['src/', 'web']]);
        const l = layoutCard(spec);
        assert.equal(l.drawnCharts.length, chartsOf(spec).length);
        assert.ok(l.shrinkSteps <= layoutCard(hotSpec(without, lang)).shrinkSteps + 1);
      } else {
        assert.equal(hotSvg(s, lang), hotSvg(without, lang));
      }
    }
  });

  test('no room (three repos: per-repo chart too): left out, card byte-identical', () => {
    const labels = ['api', 'web', 'cli'];
    const merged = mergeHistories(labels.map((label, i) => ({ label, commits: [commit(i + 1, [['src/x.js', 10, 0], ['lib/y.js', 3, 0]])] })));
    const s = computeStats(merged.commits, { today: TODAY, repos: labels });
    assert.ok(shownFolders(s.folders));
    for (const lang of ['en', 'tr']) {
      assert.equal(folderChart(hotSpec(s, lang)), undefined);
      assert.equal(hotSvg(s, lang), hotSvg({ ...s, folders: [] }, lang));
    }
    // Still in the recap and wrapped.md.
    assert.match(formatSummary(s, { repoName: 'x', today: TODAY }), /Top folders\s+api\/src\//);
    assert.match(buildMarkdown(s, { repoName: 'x', today: TODAY }), /\| 1 \| api\/src\/ \|/);
  });

  test('never displaces anything: whenever shown, every other chart is still drawn', () => {
    // Long names and many files, with and without several repos, en and tr.
    const long = 'a-very-long-directory-name-that-goes-on-and-on';
    const variants = [
      sample(),
      [commit(1, [[`${long}/x.js`, 1000, 1], [`${long}2/y.js`, 900, 1], ['z/a.js', 5, 0], ['z/b.js', 4, 0], ['z/c.js', 3, 0], ['z/d.js', 2, 0]])],
    ];
    for (const commits of variants) {
      for (const lang of ['en', 'tr']) {
        const s = computeStats(commits, { today: TODAY });
        const spec = hotSpec(s, lang);
        const base = hotSpec({ ...s, folders: [] }, lang);
        if (!folderChart(spec)) {
          assert.equal(hotSvg(s, lang), hotSvg({ ...s, folders: [] }, lang));
          continue;
        }
        const a = layoutCard(base);
        const b = layoutCard(spec);
        assert.deepEqual(b.drawnCharts, [...a.drawnCharts, a.drawnCharts.length]);
        assert.ok(b.shrinkSteps <= a.shrinkSteps + (a.shrinkSteps === 0 ? 1 : 0));
        assert.deepEqual(chartsOf(spec).slice(0, -1), chartsOf(base));
      }
    }
  });

  test('the card description lists the folders only when drawn', () => {
    const card = buildCards(stats(), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'hot-files');
    assert.match(card.description, /Top folders\. src\/: 136 lines changed \(\+123 \/ −13\) in 2 commits\./);
  });
});

describe('recap and wrapped.md', () => {
  const stats = () => computeStats(sample(), { today: TODAY });

  test('recap line with the first three, en and tr; none with fewer than two', () => {
    assert.match(formatSummary(stats(), { repoName: 'demo', today: TODAY }), /\n {2}Top folders {2}src\/ \(136 lines\) · test\/ \(42 lines\) · docs\/ \(7 lines\)\n/);
    assert.match(formatSummary(stats(), { repoName: 'demo', today: TODAY, lang: 'tr' }), /Gözde klasörler\s+src\/ \(136 satır\) · test\/ \(42 satır\) · docs\/ \(7 satır\)/);
    const one = { ...stats(), folders: [{ path: '(root)', lines: 5, added: 5, deleted: 0, commits: 1 }] };
    assert.doesNotMatch(formatSummary(one, { repoName: 'demo', today: TODAY }), /Top folders/);
  });

  test('recap: no emails, root localized', () => {
    const s = { ...stats(), folders: [{ path: 'ada@example.com', lines: 5 }, { path: '(root)', lines: 2 }] };
    const out = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.doesNotMatch(out, /@example/);
    assert.match(out, /…\/ \(5 satır\) · \(kök\) \(2 satır\)/);
  });

  test('wrapped.md table after the hot files, en and tr; none with fewer than two', () => {
    const md = buildMarkdown(stats(), { repoName: 'demo', today: TODAY });
    assert.match(md, /## Hot files[\s\S]*## Top folders\n\n\| # \| Folder \| Lines \| Commits \|\n\|--:\|:--\|--:\|--:\|\n\| 1 \| src\/ \| \+123 \/ −13 \| 2 \|\n/);
    assert.match(md, /\| 4 \| \\\(root\\\) \| \+5 \/ −1 \| 1 \|/);
    const trMd = buildMarkdown(stats(), { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(trMd, /## Gözde klasörler\n\n\| # \| Klasör \| Satır \| Commit \|/);
    assert.match(trMd, /\\\(kök\\\)/);
    const one = { ...stats(), folders: [{ path: 'src', lines: 5 }] };
    assert.doesNotMatch(buildMarkdown(one, { repoName: 'demo', today: TODAY }), /Top folders/);
  });

  test('every language has the strings', () => {
    for (const L of [en, tr]) {
      for (const k of ['foldersTitle', 'rootFolder']) assert.equal(typeof L.hotFiles[k], 'string');
      assert.equal(typeof L.hotFiles.folderValue(3), 'string');
      assert.equal(typeof L.hotFiles.folderBarTitle('src/', 3, '+2', '−1', 1), 'string');
      assert.equal(typeof L.recap.topFolders, 'string');
      assert.ok(L.recap.topFolders.length < L.recap.labelWidth);
      assert.equal(typeof L.recap.folderLines(2), 'string');
      assert.equal(typeof L.markdown.topFolders, 'string');
      assert.equal(typeof L.markdown.folder, 'string');
    }
  });
});

describe('git (real repos)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let root;
  let repo;
  let other;
  let day = 1;
  const at = () => {
    const d = `2025-03-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const write = (dir, path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const lines = (n, seed = 'x') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join('\n') + '\n';
  const init = (dir) => {
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-folders-'));
    repo = join(root, 'app');
    init(repo);
    write(repo, 'src/a.js', lines(10));
    write(repo, 'docs/guide.md', lines(4));
    write(repo, 'README.md', lines(2));
    write(repo, 'package-lock.json', lines(500));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: start'], at());
    write(repo, 'src/b.js', lines(3));
    write(repo, 'test/a.test.js', lines(6));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'test: add'], at());

    other = join(root, 'lib');
    init(other);
    write(other, 'index.js', lines(5));
    write(other, 'dist/bundle.js', lines(50));
    write(other, 'src/x.js', lines(1));
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', 'feat: lib'], at());
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md; --exclude drops files', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.folders, [
      { path: 'src', lines: 13, added: 13, deleted: 0, commits: 2 },
      { path: 'test', lines: 6, added: 6, deleted: 0, commits: 1 },
      { path: 'docs', lines: 4, added: 4, deleted: 0, commits: 1 },
      { path: '(root)', lines: 2, added: 2, deleted: 0, commits: 1 },
    ]);
    assert.match(readFileSync(r.markdown, 'utf8'), /## Top folders/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Top folders\s+src\/ \(13 lines\)/);

    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['src/', 'test'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.folders.map((f) => f.path), ['docs', '(root)']);
  });

  test('generate: several repos, repo-prefixed, ignore rules at each repo root', async () => {
    const r = await generate({ paths: [repo, other], out: join(root, 'o3'), png: false, json: true }, { today: TODAY });
    const folders = JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.folders;
    assert.deepEqual(folders.map((f) => [f.path, f.lines]), [['app/src', 13], ['app/test', 6], ['lib/(root)', 5], ['app/docs', 4], ['app/(root)', 2]]);
  });

  test('the CLI prints the recap line', () => {
    const res = spawnSync(process.execPath, [BIN, repo, '--out', join(root, 'o4'), '--no-png', '--no-color'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Top folders {2}src\/ \(13 lines\) · test\/ \(6 lines\) · docs\/ \(4 lines\)/);
  });
});
