// Renames: files renamed in the window, read by src/git.js readLifecycle (the R entries of
// its `git log -z --name-status -M --diff-filter=ADR` call), counted by
// computeFileLifecycle (src/stats/files.js) as stats.fileLifecycle.renamed and shown in
// the recap, wrapped.md and (when it fits) the totals card's born / buried row.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories, parseLifecycleLog, readCommits } from '../src/git.js';
import { computeFileLifecycle, computeStats, shownFileLifecycle } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const LANGS = { en, tr };
const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 5 + i, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const totalsSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
const totalsSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').svg;

describe('parseLifecycleLog: R entries', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(64);

  test('a rename carries old and new path; copies are skipped; a rename-only commit is kept', () => {
    const out = `${a}\0\nR100\0old name.js\0new name.js\0C075\0x.js\0y.js\0A\0z.js\0${b}\0\nR087\0dir/a\nb.txt\0dir/c.txt\0${c}\0\nC100\0p\0q\0`;
    const found = parseLifecycleLog(out);
    assert.deepEqual(found.get(a), { born: ['z.js'], buried: [], renamed: [{ from: 'old name.js', to: 'new name.js' }] });
    assert.deepEqual(found.get(b), { born: [], buried: [], renamed: [{ from: 'dir/a\nb.txt', to: 'dir/c.txt' }] });
    assert.equal(found.has(c), false); // only a copy: left out
  });

  test('paths that look like statuses stay paths; a truncated rename is dropped', () => {
    const out = `${a}\0\nR100\0A\0D\0D\0R050\0${b}\0`;
    // R100 A → D, then D R050 (a delete of a file named "R050"), then the hash header.
    assert.deepEqual(parseLifecycleLog(out).get(a), { born: [], buried: ['R050'], renamed: [{ from: 'A', to: 'D' }] });
    assert.equal(parseLifecycleLog(`${a}\0\nR100\0only.js\0`).size, 0);
    assert.equal(parseLifecycleLog(`${a}\0\nR100\0only.js\0\0`).size, 0);
  });
});

describe('computeFileLifecycle: renamed', () => {
  test('counted per commit by the new path; ignored targets, merges and junk skipped', () => {
    const commits = [
      commit(1, { renamed: [{ from: 'src/a.js', to: 'src/b.js' }, { from: 'lib/x.js', to: 'src/x.js' }] }),
      commit(2, { renamed: [{ from: 'src/c.js', to: 'vendor/c.js' }] }), // into an ignored path: no
      commit(3, { renamed: [{ from: 'dist/app.js', to: 'src/app.js' }] }), // out of one: yes
      commit(4, { renamed: [{ from: 'dist/a.js', to: 'build/a.js' }] }), // both ignored: no
      commit(5, { parents: ['p1', 'p2'], renamed: [{ from: 'src/m.js', to: 'src/n.js' }] }), // merge: no
      commit(6, { renamed: [null, { from: 'a' }, { from: 'a', to: '' }, 'x', { to: 7 }] }),
      commit(7, { renamed: 'nope' }),
      commit(8, { renamed: [{ from: 'src/b.js', to: 'src/a.js' }] }), // renamed back: counts again
    ];
    assert.deepEqual(computeFileLifecycle(commits), { added: 0, deleted: 0, renamed: 4 });
  });

  test('multi-repo: ignore rules at each repo root', () => {
    const commits = [commit(1, { repo: 'api', renamed: [{ from: 'api/src/a.js', to: 'api/dist/a.js' }, { from: 'api/a.js', to: 'api/src/a.js' }] })];
    assert.deepEqual(computeFileLifecycle(commits), { added: 0, deleted: 0, renamed: 1 });
  });

  test('stats.fileLifecycle key order is added, deleted, renamed', () => {
    const stats = computeStats([commit(1, { born: ['src/z.js'], renamed: [{ from: 'src/a.js', to: 'src/b.js' }] })], { today: TODAY });
    assert.deepEqual(Object.keys(stats.fileLifecycle), ['added', 'deleted', 'renamed']);
    assert.deepEqual(stats.fileLifecycle, { added: 1, deleted: 0, renamed: 1 });
  });
});

describe('excludeFiles and mergeHistories carry renamed', () => {
  test('--exclude drops a rename whose new path matches; the input is untouched', () => {
    const isExcluded = compileExcludes(['docs/']);
    const renamed = [{ from: 'docs/a.md', to: 'docs/b.md' }, { from: 'docs/c.md', to: 'src/c.md' }, { from: 'src/d.js', to: 'docs/d.js' }];
    const c = commit(1, { renamed });
    const [out] = excludeFiles([c], isExcluded);
    assert.deepEqual(out.renamed, [{ from: 'docs/c.md', to: 'src/c.md' }]);
    assert.equal(c.renamed, renamed);
    assert.equal(c.renamed.length, 3);
    const plain = commit(2, { renamed: [{ from: 'src/a.js', to: 'src/b.js' }] });
    assert.equal(excludeFiles([plain], isExcluded)[0], plain);
  });

  test('--exclude with a labelled path pattern in a multi-repo run', () => {
    const isExcluded = compileExcludes(['api/docs/']);
    const c = commit(1, { repo: 'api', files: [], renamed: [{ from: 'api/x.md', to: 'api/docs/x.md' }, { from: 'api/y.js', to: 'api/z.js' }] });
    assert.deepEqual(excludeFiles([c], isExcluded)[0].renamed, [{ from: 'api/y.js', to: 'api/z.js' }]);
  });

  test('mergeHistories prefixes both paths with the repo label', () => {
    const merged = mergeHistories([{ label: 'api', commits: [commit(1, { renamed: [{ from: 'a.js', to: 'src/a.js' }] })] }, { label: 'web', commits: [commit(2)] }]);
    assert.deepEqual(merged.commits.find((c) => c.repo === 'api').renamed, [{ from: 'api/a.js', to: 'api/src/a.js' }]);
    assert.equal('renamed' in merged.commits.find((c) => c.repo === 'web'), false);
  });
});

describe('shownFileLifecycle: renamed', () => {
  test('renames alone are shown; older stats.json without renamed reads as 0', () => {
    assert.deepEqual(shownFileLifecycle({ added: 0, deleted: 0, renamed: 3 }), { added: 0, deleted: 0, renamed: 3 });
    assert.deepEqual(shownFileLifecycle({ added: 2, deleted: 1 }), { added: 2, deleted: 1, renamed: 0 });
    assert.deepEqual(shownFileLifecycle({ added: 2, deleted: 1, renamed: -4 }), { added: 2, deleted: 1, renamed: 0 });
    assert.deepEqual(shownFileLifecycle({ added: 2, deleted: 1, renamed: 1.5 }), { added: 2, deleted: 1, renamed: 0 });
    assert.equal(shownFileLifecycle({ added: 0, deleted: 0, renamed: 0 }), null);
    assert.equal(shownFileLifecycle({ renamed: '3' }), null);
  });
});

describe('totals card', () => {
  const base = () => computeStats([commit(1), commit(2)], { today: TODAY });
  const noCut = (svg, label) => {
    assert.ok(svg.includes(label), `the SVG holds the full label "${label}"`);
    for (let k = 1; k < label.length; k += 1) assert.ok(!svg.includes(`${label.slice(0, k).trimEnd()}…`), `no truncated "${label.slice(0, k)}…"`);
  };

  test('"Born / buried / renamed" when it fits', () => {
    const stats = { ...base(), fileLifecycle: { added: 12, deleted: 3, renamed: 4 } };
    assert.deepEqual(totalsSpec(stats).lines.at(-1), { label: 'Born / buried / renamed', value: '12 / 3 / 4' });
    noCut(totalsSvg(stats), 'Born / buried / renamed');
    const one = { ...base(), fileLifecycle: { added: 1, deleted: 1, renamed: 1 } };
    assert.deepEqual(totalsSpec(one, 'tr').lines.at(-1), { label: 'Doğan / gömülen / taşınan', value: '1 / 1 / 1' });
    noCut(totalsSvg(one, 'tr'), 'Doğan / gömülen / taşınan');
  });

  test('renames only: "0 / 0 / 4"', () => {
    const stats = { ...base(), fileLifecycle: { added: 0, deleted: 0, renamed: 4 } };
    assert.deepEqual(totalsSpec(stats).lines.at(-1), { label: 'Born / buried / renamed', value: '0 / 0 / 4' });
  });

  test('falls back to the born / buried row when the renamed one would be cut', () => {
    const big = { added: 123456, deleted: 654321, renamed: 123456 };
    assert.equal(rowFits({ label: en.totals.fileLifecycleRenamed, value: en.totals.fileLifecycleValue(big.added, big.deleted, big.renamed) }), false);
    const stats = { ...base(), fileLifecycle: big };
    assert.deepEqual(totalsSpec(stats).lines.at(-1), { label: 'Born / buried', value: '123,456 / 654,321' });
    assert.equal(totalsSvg(stats), totalsSvg({ ...base(), fileLifecycle: { added: big.added, deleted: big.deleted } }));
    assert.doesNotMatch(totalsSvg(stats), /renamed/);
    // Turkish: the longer label leaves less room for the value, so 12 / 3 / 4 is already cut there.
    assert.equal(rowFits({ label: tr.totals.fileLifecycleRenamed, value: tr.totals.fileLifecycleValue(12, 3, 4) }), false);
    const tr12 = { ...base(), fileLifecycle: { added: 12, deleted: 3, renamed: 4 } };
    assert.deepEqual(totalsSpec(tr12, 'tr').lines.at(-1), { label: 'Doğan / gömülen', value: '12 / 3' });
    assert.equal(totalsSvg(tr12, 'tr'), totalsSvg({ ...base(), fileLifecycle: { added: 12, deleted: 3 } }, 'tr'));
  });

  test('renames only and too wide: no row at all', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    assert.equal(rowFits({ label: en.totals.fileLifecycleRenamed, value: en.totals.fileLifecycleValue(0, 0, huge) }), false);
    const without = base();
    delete without.fileLifecycle;
    assert.equal(totalsSvg({ ...base(), fileLifecycle: { added: 0, deleted: 0, renamed: huge } }), totalsSvg(without));
  });

  test('byte-identical cards when renamed is 0 (en and tr)', () => {
    for (const lang of ['en', 'tr']) {
      for (const lc of [{ added: 12, deleted: 3 }, { added: 0, deleted: 0 }, { added: 123456, deleted: 654321 }]) {
        const before = buildCards({ ...base(), fileLifecycle: lc }, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg);
        const after = buildCards({ ...base(), fileLifecycle: { ...lc, renamed: 0 } }, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg);
        assert.deepEqual(after, before);
      }
    }
  });

  test('a full card gets no row (spare room only)', () => {
    const commits = [commit(1), commit(2, { author: 'Bob', email: 'bob@example.com' })];
    const previous = [commit(3, { date: '2025-03-03T10:00:00Z' })];
    const stats = computeStats(commits, { today: TODAY, previousYear: { year: 2026, commits: previous } });
    const full = totalsSpec(stats);
    assert.equal(full.lines.length, 6);
    assert.deepEqual(totalsSpec({ ...stats, fileLifecycle: { added: 4, deleted: 1, renamed: 2 } }), full);
  });

  test('never a cut label or value, en and tr, across sizes', () => {
    for (const lang of ['en', 'tr']) {
      for (const n of [1, 9, 57, 1234, 98765, 1234567]) {
        const spec = totalsSpec({ ...base(), fileLifecycle: { added: n, deleted: n, renamed: n } }, lang);
        const row = spec.lines.at(-1);
        if (row.label === LANGS[lang].totals.fileLifecycleRenamed) assert.ok(rowFits(row), JSON.stringify(row));
      }
    }
  });
});

describe('recap and wrapped.md', () => {
  const base = () => computeStats([commit(1), commit(2)], { today: TODAY });

  test('recap: " · 4 renamed" only with renames, en and tr', () => {
    const stats = { ...base(), fileLifecycle: { added: 12, deleted: 3, renamed: 4 } };
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), /\n {2}Files {8}12 born · 3 buried · 4 renamed\n/);
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Dosyalar\s+12 doğdu · 3 gömüldü · 4 taşındı\n/);
    const none = { ...base(), fileLifecycle: { added: 12, deleted: 3, renamed: 0 } };
    assert.match(formatSummary(none, { repoName: 'demo', today: TODAY }), /Files\s+12 born · 3 buried\n/);
    const only = { ...base(), fileLifecycle: { added: 0, deleted: 0, renamed: 1234 } };
    assert.match(formatSummary(only, { repoName: 'demo', today: TODAY }), /Files\s+0 born · 0 buried · 1,234 renamed\n/);
  });

  test('wrapped.md: ", 4 renamed" only with renames, en and tr', () => {
    const stats = { ...base(), fileLifecycle: { added: 1, deleted: 1200, renamed: 4 } };
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /- \*\*Files born \/ buried:\*\* 1 file added, 1,200 deleted, 4 renamed\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Doğan \/ gömülen dosyalar:\*\* 1 dosya eklendi, 1\.200 silindi, 4 taşındı\n/);
    const none = { ...base(), fileLifecycle: { added: 1, deleted: 1200, renamed: 0 } };
    assert.match(buildMarkdown(none, { repoName: 'demo', today: TODAY }), /1 file added, 1,200 deleted\n/);
  });

  test('every language has the strings; two-argument calls are unchanged', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.totals.fileLifecycleRenamed, 'string');
      for (const S of [L.totals, L.recap, L.markdown]) {
        assert.equal(S.fileLifecycleValue(2, 1), S.fileLifecycleValue(2, 1, 0));
        assert.notEqual(S.fileLifecycleValue(2, 1, 3), S.fileLifecycleValue(2, 1));
      }
    }
  });
});

describe('git (real repo): git mv end to end', () => {
  let root;
  let repo;
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let day = 1;
  const at = () => {
    const d = `2025-05-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const write = (path, text) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const body = (seed) => Array.from({ length: 20 }, (_, i) => `${seed} line ${i}`).join('\n') + '\n';

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-renames-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    // 05-01: five files born.
    write('src/a.js', body('a'));
    write('src/b.js', body('b'));
    write('lib/util.js', body('u'));
    write('docs/guide.md', body('g'));
    write('src/side.js', body('s'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: start'], at());
    // 05-02: a rename and a move (2 renamed), plus a file born.
    git(repo, ['mv', 'src/a.js', 'src/alpha.js']);
    git(repo, ['mv', 'lib/util.js', 'src/util.js']);
    write('src/new.js', body('n'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'refactor: rename and move'], at());
    // 05-03: a move into vendor/ (ignored as for hot files): not counted.
    mkdirSync(join(repo, 'vendor'));
    git(repo, ['mv', 'src/b.js', 'vendor/b.js']);
    git(repo, ['commit', '-q', '-m', 'chore: vendor b'], at());
    // 05-04: a docs rename (dropped by --exclude docs/).
    git(repo, ['mv', 'docs/guide.md', 'docs/handbook.md']);
    git(repo, ['commit', '-q', '-m', 'docs: rename guide'], at());
    // 05-05: a side-branch rename merged with --no-ff (the merge itself adds nothing).
    git(repo, ['checkout', '-q', '-b', 'side']);
    git(repo, ['mv', 'src/side.js', 'src/aside.js']);
    git(repo, ['commit', '-q', '-m', 'refactor: side rename'], at());
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], at());
    // Config that must not change the result.
    git(repo, ['config', 'diff.renames', 'false']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits gives renamed; renames are neither born nor buried', async () => {
    const commits = await readCommits(repo);
    const by = new Map(commits.map((c) => [c.subject, c]));
    const r = by.get('refactor: rename and move');
    assert.deepEqual([...r.renamed].sort((x, y) => (x.to < y.to ? -1 : 1)), [{ from: 'src/a.js', to: 'src/alpha.js' }, { from: 'lib/util.js', to: 'src/util.js' }]);
    assert.deepEqual(r.born, ['src/new.js']);
    assert.equal('buried' in r, false);
    assert.deepEqual(by.get('chore: vendor b').renamed, [{ from: 'src/b.js', to: 'vendor/b.js' }]);
    assert.equal('renamed' in by.get('Merge side'), false);
    assert.equal('renamed' in by.get('feat: start'), false);
    // 2 + 0 (vendor) + 1 (docs) + 1 (side) renamed; 5 + 1 born.
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 6, deleted: 0, renamed: 4 });
  });

  test('generate: stats.json, recap, wrapped.md and the totals card; --exclude; tr', async () => {
    const out = join(root, 'o1');
    const r = await generate({ path: repo, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.fileLifecycle, { added: 6, deleted: 0, renamed: 4 });
    assert.match(readFileSync(r.markdown, 'utf8'), /- \*\*Files born \/ buried:\*\* 6 files added, 0 deleted, 4 renamed/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Files\s+6 born · 0 buried · 4 renamed/);
    const svg = readFileSync(join(out, 'cards', '02-totals.svg'), 'utf8');
    assert.match(svg, />Born \/ buried \/ renamed</);
    assert.match(svg, />6 \/ 0 \/ 4</);

    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.fileLifecycle, { added: 5, deleted: 0, renamed: 3 });

    const t = await generate({ path: repo, out: join(root, 'o3'), png: false, md: true, lang: 'tr' }, { today: TODAY });
    assert.match(readFileSync(t.markdown, 'utf8'), /6 dosya eklendi, 0 silindi, 4 taşındı/);
  });

  test('several repos: summed, ignore rules at each repo root', async () => {
    const lib = join(root, 'lib');
    mkdirSync(lib);
    git(lib, ['init', '-q', '-b', 'main']);
    git(lib, ['config', 'commit.gpgsign', 'false']);
    for (const f of ['index.js', 'a.js']) writeFileSync(join(lib, f), body(f));
    git(lib, ['add', '-A']);
    git(lib, ['commit', '-q', '-m', 'feat: lib'], at());
    mkdirSync(join(lib, 'dist'));
    mkdirSync(join(lib, 'src'));
    git(lib, ['mv', 'index.js', 'dist/index.js']); // into dist/ at the repo root: not counted
    git(lib, ['mv', 'a.js', 'src/a.js']);
    git(lib, ['commit', '-q', '-m', 'refactor: lib layout'], at());
    const r = await generate({ paths: [repo, lib], out: join(root, 'o4'), png: false, json: true }, { today: TODAY });
    // app 6 / 0 / 4; lib 2 born, 1 renamed.
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.fileLifecycle, { added: 8, deleted: 0, renamed: 5 });
  });
});
