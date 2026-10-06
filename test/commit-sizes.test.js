// Commit size mix: computeCommitSizes (src/stats/sizes.js), stats.json, the totals card's
// stacked bar and the recap line.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMMIT_SIZE_BUCKETS, COMMIT_SIZE_IDS, commitSizeOf, computeCommitSizes, computeStats, shownCommitSizes, sizeShares } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard, renderCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(lines, extra = {}) {
  n += 1;
  const files = typeof lines === 'number' ? [f('src/a.js', lines)] : lines;
  return { hash: `h${n}`, author: 'A', email: 'a@x', date: `2026-03-${String((n % 28) + 1).padStart(2, '0')}T10:00:00Z`, subject: `c${n}`, parents: ['p'], files, ...extra };
}
const f = (path, added, removed = 0) => ({ path, added, removed, binary: false });
const ZERO = { total: 0, tiny: 0, small: 0, medium: 0, large: 0, shares: { tiny: 0, small: 0, medium: 0, large: 0 } };

describe('computeCommitSizes', () => {
  test('thresholds: tiny < 10, small 10-99, medium 100-500, large > 500', () => {
    assert.deepEqual(COMMIT_SIZE_IDS, ['tiny', 'small', 'medium', 'large']);
    assert.deepEqual(COMMIT_SIZE_BUCKETS.map((b) => b.max), [9, 99, 500, Infinity]);
    const cases = { 0: 'tiny', 1: 'tiny', 9: 'tiny', 10: 'small', 99: 'small', 100: 'medium', 500: 'medium', 501: 'large', 1e6: 'large' };
    for (const [lines, id] of Object.entries(cases)) {
      assert.equal(commitSizeOf(Number(lines)), id, lines);
      const r = computeCommitSizes([commit(Number(lines))]);
      assert.equal(r[id], 1, `${lines} lines → ${id}`);
      assert.equal(r.total, 1);
      assert.equal(r.shares[id], 100);
    }
    for (const bad of [NaN, -5, Infinity, '7', null]) assert.equal(commitSizeOf(bad), 'tiny');
  });

  test('boundary history: counts, shares and the documented shape', () => {
    // 9 + 1 → 10 lines (added + removed); 99 split across files; 500 vs 501.
    const commits = [commit(9), commit([f('a.js', 9, 1)]), commit([f('a.js', 50), f('b.js', 49)]), commit(100), commit([f('a.js', 250, 250)]), commit([f('a.js', 250, 251)])];
    const r = computeCommitSizes(commits);
    assert.deepEqual(r, { total: 6, tiny: 1, small: 2, medium: 2, large: 1, shares: { tiny: 17, small: 33, medium: 33, large: 17 } });
    assert.deepEqual(Object.keys(r), ['total', 'tiny', 'small', 'medium', 'large', 'shares']);
  });

  test('merge commits are skipped (by parents, or by subject without parents)', () => {
    const merge = commit(1000, { parents: ['a', 'b'], subject: 'Merge branch x' });
    const mergeBySubject = { hash: 'm', date: '2026-03-01T10:00:00Z', subject: "Merge branch 'x' into main", files: [f('a.js', 3)] };
    const r = computeCommitSizes([merge, mergeBySubject, commit(20)]);
    assert.equal(r.total, 1);
    assert.equal(r.small, 1);
    assert.equal(r.large, 0);
    assert.deepEqual(computeCommitSizes([merge]), ZERO);
  });

  test('ignored paths (lockfiles, build output, vendored, minified, snapshots) add no lines', () => {
    const noisy = commit([
      f('package-lock.json', 50000, 40000),
      f('yarn.lock', 900),
      f('dist/app.js', 9000),
      f('node_modules/x/index.js', 900),
      f('vendor/lib.c', 800),
      f('web.min.js', 700),
      f('__snapshots__/a.snap', 600),
      f('src/real.js', 3, 2),
    ]);
    const r = computeCommitSizes([noisy]);
    assert.equal(r.tiny, 1, 'only the 5 real lines count');
    // A commit touching only ignored files, or none at all, is tiny (0 lines).
    const lockOnly = commit([f('package-lock.json', 12345)]);
    const empty = commit([]);
    assert.deepEqual(computeCommitSizes([lockOnly, empty]), { total: 2, tiny: 2, small: 0, medium: 0, large: 0, shares: { tiny: 100, small: 0, medium: 0, large: 0 } });
  });

  test('multi-repo: ignore rules apply at each repo root', () => {
    const api = commit([f('api/dist/out.js', 5000), f('api/src/x.js', 1)], { repo: 'api' });
    const deep = commit([f('api/src/dist/z.js', 600)], { repo: 'api' });
    const r = computeCommitSizes([api, deep]);
    assert.equal(r.tiny, 1);
    assert.equal(r.large, 1);
  });

  test('invalid input never throws: bad counts add 0, bad files and entries are skipped', () => {
    for (const bad of [undefined, null, [], 'x', 5, {}]) assert.deepEqual(computeCommitSizes(bad), ZERO, String(bad));
    const c = commit([null, { path: 5, added: 900 }, f('a.js', -5, NaN), f('b.js', Infinity, 4), f('c.js', '700', 2)]);
    const noFiles = { hash: 'x', subject: 's', parents: ['p'] };
    const badFiles = { hash: 'y', subject: 's', parents: ['p'], files: 'nope' };
    const r = computeCommitSizes([c, null, 7, 'str', noFiles, badFiles]);
    // c counts 6 lines; commits without a files array count as tiny.
    assert.deepEqual(r, { total: 3, tiny: 3, small: 0, medium: 0, large: 0, shares: { tiny: 100, small: 0, medium: 0, large: 0 } });
  });

  test('shares are whole percents that always add up to 100 (largest remainder)', () => {
    assert.deepEqual(sizeShares([0, 0, 0, 0]), [0, 0, 0, 0]);
    assert.deepEqual(sizeShares([1, 1, 1, 0]), [34, 33, 33, 0]);
    assert.deepEqual(sizeShares([1, 1, 1, 1]), [25, 25, 25, 25]);
    assert.deepEqual(sizeShares([2, 1, 0, 0]), [67, 33, 0, 0]);
    assert.deepEqual(sizeShares([1, 0, 0, 199]), [1, 0, 0, 99]);
    // Pseudo-random mixes: always 100, each within 1 of the exact share.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 50;
    for (let i = 0; i < 300; i++) {
      const values = [rnd(), rnd(), rnd(), rnd()];
      const total = values.reduce((a, b) => a + b, 0);
      const shares = sizeShares(values);
      if (total === 0) continue;
      assert.equal(shares.reduce((a, b) => a + b, 0), 100, values.join());
      values.forEach((v, j) => assert.ok(Math.abs(shares[j] - (v / total) * 100) < 1, values.join()));
    }
    const r = computeCommitSizes([commit(1), commit(20), commit(200)]);
    assert.equal(Object.values(r.shares).reduce((a, b) => a + b, 0), 100);
  });

  test('is computeStats().commitSizes, right after biggestCommit', () => {
    const commits = [commit(4), commit(40)];
    const stats = computeStats(commits, { today: TODAY });
    assert.deepEqual(stats.commitSizes, computeCommitSizes(commits));
    const keys = Object.keys(stats);
    assert.equal(keys.indexOf('commitSizes'), keys.indexOf('biggestCommit') + 1);
    assert.deepEqual(computeStats([], { today: TODAY }).commitSizes, ZERO);
  });

  test('shownCommitSizes: null without anything to show, else counts and shares in bucket order', () => {
    for (const junk of [undefined, null, 'x', {}, ZERO, { tiny: -1, small: NaN, medium: Infinity }]) assert.equal(shownCommitSizes(junk), null, JSON.stringify(junk));
    assert.deepEqual(shownCommitSizes({ tiny: 1, small: 2.4, medium: 0, large: 1 }), [
      { id: 'tiny', count: 1, share: 25 },
      { id: 'small', count: 2, share: 50 },
      { id: 'medium', count: 0, share: 0 },
      { id: 'large', count: 1, share: 25 },
    ]);
  });
});

describe('stats.json', () => {
  test('stats.commitSizes is written after biggestCommit with the documented shape', () => {
    const stats = computeStats([commit(3), commit(30), commit(300), commit(3000)], { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    const keys = Object.keys(doc.stats);
    assert.equal(keys.indexOf('commitSizes'), keys.indexOf('biggestCommit') + 1);
    assert.deepEqual(doc.stats.commitSizes, { total: 4, tiny: 1, small: 1, medium: 1, large: 1, shares: { tiny: 25, small: 25, medium: 25, large: 25 } });
    const empty = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(empty.stats.commitSizes, ZERO);
  });
});

/** Same blocks (stack aside), each the same height (±0.2px of coordinate rounding). */
function assertSameShape(a, b, where) {
  const shape = (l) => l.blocks.filter((x) => x.kind !== 'stack').map((x) => ({ kind: x.kind, h: x.bottom - x.top }));
  const [sa, sb] = [shape(a), shape(b)];
  assert.deepEqual(sa.map((x) => x.kind), sb.map((x) => x.kind), `${where}: same blocks`);
  sa.forEach((x, i) => assert.ok(Math.abs(x.h - sb[i].h) <= 0.2, `${where}: ${x.kind} height ${x.h} vs ${sb[i].h}`));
}

const HISTORY = () => [commit(3), commit(5), commit(40), commit([f('src/b.js', 120, 30), f('package-lock.json', 9999)]), commit(2000), commit(7)];

describe('totals card', () => {
  test('shows the size mix as a stacked bar, without overlap, in every language and theme', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const expect = {
      en: { title: 'Commit sizes', labels: ['Tiny', 'Small', 'Medium', 'Large'], values: ['50%', '17%', '17%', '16%'] },
      tr: { title: 'Commit boyutları', labels: ['Minik', 'Küçük', 'Orta', 'Büyük'], values: ['%50', '%17', '%17', '%16'] },
    };
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of ['default', 'mono', 'neon']) {
        const { spec } = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, colorTheme }).find((c) => c.id === 'totals');
        assert.deepEqual(spec.chart.map((c) => c.kind), ['split', 'stack']);
        const stack = spec.chart[1];
        assert.equal(stack.title, expect[lang].title);
        assert.deepEqual(stack.segments.map((s) => s.label), expect[lang].labels);
        assert.deepEqual(stack.segments.map((s) => s.value), expect[lang].values);
        assert.deepEqual(stack.segments.map((s) => s.amount), [3, 1, 1, 1]);
        const layout = layoutCard(spec);
        assert.ok(layout.blocks.some((b) => b.kind === 'stack'), `${lang}/${colorTheme}: the bar fits`);
        const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
        for (const [i, b] of sorted.entries()) {
          assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${lang}/${colorTheme}: ${b.kind} inside the content area`);
          if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${lang}/${colorTheme}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
        }
        const svg = renderCard(spec);
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
        for (const v of expect[lang].values) assert.ok(svg.includes(`>${v}<`), `${lang}: ${v} drawn`);
      }
    }
    const card = buildCards(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'totals');
    assert.match(card.description, /Commit sizes\. Tiny \(under 10 lines\): 3 commits \(50%\)\. Small \(10–99 lines\): 1 commit \(17%\)\./);
    assert.match(card.svg, /<title>Large \(over 500 lines\): 1 commit \(16%\)<\/title>/);
  });

  test('a bucket with no commits takes no bar space; the bar fills the content width', () => {
    const stats = computeStats([commit(1), commit(2), commit(600)], { today: TODAY });
    const { spec } = buildCardSpecs(stats, { today: TODAY }).find((c) => c.id === 'totals');
    const svg = layoutCard(spec).blocks.find((b) => b.kind === 'stack').svg;
    const bars = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="32"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(bars.length, 2, 'tiny and large only');
    assert.equal(bars[0][0], 96);
    assert.ok(Math.abs(bars[1][0] + bars[1][1] - (1080 - 96)) <= 0.2, 'ends at the right edge');
    assert.ok(bars[0][1] > bars[1][1], 'two thirds vs one third');
  });

  test('without commits to count the card is exactly as before', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const without = { ...stats };
    delete without.commitSizes;
    for (const lang of ['en', 'tr']) {
      const before = buildCards(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals');
      for (const junk of [ZERO, null, {}, 'x', { tiny: NaN, large: -3 }]) {
        const a = buildCards({ ...stats, commitSizes: junk }, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals');
        assert.equal(a.svg, before.svg, `${lang}: ${JSON.stringify(junk)}`);
        assert.equal(a.description, before.description);
      }
      assert.doesNotMatch(before.svg, /Commit sizes|COMMIT SIZES|BOYUTLARI/);
      const { spec } = buildCardSpecs(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals');
      assert.equal(Array.isArray(spec.chart), false);
      assert.equal(spec.chart.kind, 'split');
    }
    // All-merge history: commits exist but no sizes to show.
    const merges = computeStats([commit(50, { parents: ['a', 'b'] })], { today: TODAY });
    assert.equal(merges.commitSizes.total, 0);
    const { spec } = buildCardSpecs(merges, { today: TODAY }).find((c) => c.id === 'totals');
    assert.equal(spec.chart.kind, 'split');
  });

  test('a cramped totals card (--year with several repos) drops the size bar first', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const crowded = {
      ...stats,
      totals: { ...stats.totals, authors: 3 },
      repos: ['api', 'web', 'cli', 'docs'].map((name, i) => ({ name, commits: 10 - i, linesAdded: 100, linesRemoved: 5, filesTouched: 3 })),
      yearOverYear: { previousYear: 2025, commits: { delta: 3 }, lines: { delta: 5 }, activeDays: { delta: 2 } },
    };
    for (const lang of ['en', 'tr']) {
      const { spec } = buildCardSpecs(crowded, { today: TODAY, lang }).find((c) => c.id === 'totals');
      assert.equal(spec.lines.length, 6, '--year rows are there');
      const kinds = [].concat(spec.chart).map((c) => c.kind);
      assert.equal(kinds.at(-1), 'stack', 'the size bar is the last chart');
      const { blocks } = layoutCard(spec);
      const sorted = [...blocks].sort((a, b) => a.top - b.top);
      for (const [i, b] of sorted.entries()) {
        assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${lang}: ${b.kind} inside`);
        if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${lang}: ${b.kind} overlaps`);
      }
      assert.ok(blocks.some((b) => b.kind === 'split'), 'the lines split stays');
      // Charts go from the end: the size bar before the per-repo bars.
      assert.equal(blocks.some((b) => b.kind === 'stack'), false, 'the size bar is left out');
      const { blocks: fewer } = layoutCard({ ...spec, chart: spec.chart.filter((c) => c.kind !== 'stack') });
      assert.deepEqual(blocks.map((b) => b.kind), fewer.map((b) => b.kind), 'same layout as without the size bar');
    }
  });

  test('the size bar is purely additive: single-repo --year (+ team) keeps the hero size, and drops the bar when it does not fit', () => {
    const team = [commit(3), commit(40, { email: 'b@x', author: 'B' }), commit(600)];
    const yoy = { previousYear: 2025, commits: { delta: 3 }, lines: { delta: 5 }, activeDays: { delta: 2 } };
    const base = computeStats(team, { today: TODAY });
    assert.equal(base.totals.authors, 2);
    const cases = [
      ['plain', { ...base, totals: { ...base.totals, authors: 1 } }, true],
      ['team', base, null],
      ['--year', { ...base, totals: { ...base.totals, authors: 1 }, yearOverYear: yoy }, null],
      ['--year + team', { ...base, yearOverYear: yoy }, false],
    ];
    const bigH = (layout) => {
      const b = layout.blocks.find((x) => x.kind === 'big');
      return b.bottom - b.top;
    };
    for (const [name, stats, expectStack] of cases) {
      for (const lang of ['en', 'tr']) {
        const without = { ...stats };
        delete without.commitSizes;
        const withSpec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
        const withoutSpec = buildCardSpecs(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
        const a = layoutCard(withSpec);
        const b = layoutCard(withoutSpec);
        const where = `${name}/${lang}`;
        assert.ok(Math.abs(bigH(a) - bigH(b)) <= 0.2, `${where}: same hero size (${bigH(a)} vs ${bigH(b)})`);
        assert.equal(a.blocks.find((x) => x.kind === 'big').svg.match(/font-size="[\d.]+"/)[0], b.blocks.find((x) => x.kind === 'big').svg.match(/font-size="[\d.]+"/)[0], `${where}: same hero font size`);
        const hasStack = a.blocks.some((x) => x.kind === 'stack');
        if (expectStack !== null) assert.equal(hasStack, expectStack, `${where}: stack shown?`);
        // Everything but the stack is the same set of blocks with the same heights.
        assertSameShape(a, b, where);
        if (!hasStack) {
          const before = buildCards(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals');
          const after = buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals');
          assert.equal(after.svg, before.svg, `${where}: byte-identical when the bar is left out`);
        }
      }
    }
  });

  test('layoutCard: an optional chart never makes anything else shrink', () => {
    const split = { kind: 'split', title: 'Lines', segments: [{ label: 'a', value: '+1', amount: 1 }, { label: 'r', value: '-1', amount: 1 }] };
    const stack = { kind: 'stack', optional: true, title: 'Mix', segments: [{ label: 'A', value: '50%', amount: 1 }, { label: 'B', value: '50%', amount: 1 }] };
    const rows = (k) => Array.from({ length: k }, (_, i) => ({ label: `row ${i}`, value: String(i) }));
    for (let k = 0; k <= 6; k++) {
      for (const subtitle of ['short', 'a much longer subtitle that wraps onto more than one line on the card for sure, and then some more words']) {
        const base = { big: '12,345', title: 'commits', subtitle, lines: rows(k) };
        const a = layoutCard({ ...base, chart: [split, stack] });
        const b = layoutCard({ ...base, chart: split });
        assertSameShape(a, b, `${k} rows`);
      }
    }
  });

  test('cardDescription summarizes a stack chart: non-empty segments, title else label: value', () => {
    const d = cardDescription({ chart: { kind: 'stack', title: 'Mix', segments: [{ label: 'A', value: '60%', amount: 3 }, { label: 'B', value: '0%', amount: 0 }, { label: 'C', value: '40%', amount: 2, title: 'C has 2' }] } });
    assert.equal(d, 'Mix. A: 60%. C has 2.');
  });
});

describe('recap', () => {
  test('a "Sizes" line with the mix, only when there is one', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const en = formatSummary(stats, { paths: { html: 'x.html' }, today: TODAY });
    assert.match(en, /\n {2}Sizes {8}50% tiny · 17% small · 17% medium · 16% large\n/);
    const tr = formatSummary(stats, { paths: { html: 'x.html' }, today: TODAY, lang: 'tr' });
    assert.match(tr, /\n {2}Boyutlar {7}%50 minik · %17 küçük · %17 orta · %16 büyük\n/);
    // Same order as the other lines: after "Biggest".
    assert.ok(en.indexOf('Sizes') > en.indexOf('Biggest'));
    for (const junk of [ZERO, null, undefined, {}]) {
      const s = formatSummary({ ...stats, commitSizes: junk }, { paths: { html: 'x.html' }, today: TODAY });
      assert.doesNotMatch(s, /Sizes/, JSON.stringify(junk));
    }
    // Card and recap agree (shownCommitSizes).
    const card = buildCards(stats, { today: TODAY }).find((c) => c.id === 'totals');
    for (const b of shownCommitSizes(stats.commitSizes)) assert.ok(card.svg.includes(`>${b.share}%<`));
  });
});
