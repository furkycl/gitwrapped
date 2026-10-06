// Regression tests for the loop-043 audit fixes (pre-1.4.0): commit size shares on the card,
// in the recap and in wrapped.md follow the languages card's rule (a size with commits never
// reads "0%", none reads 100% next to others; stats.json keeps the raw shares), every
// stacked-bar segment stays clearly visible, a dropped optional chart is left out of the
// card's description too, escapeMarkdown escapes "$", wrapped.md lists the size mix, and the
// Turkish longest break reads "N gün".
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeStats, shownCommitSizes } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, sizeShareText } from '../src/cards/index.js';
import { renderCard, renderCardWithLayout } from '../src/cards/svg.js';
import { buildMarkdown, escapeMarkdown } from '../src/markdown.js';
import { formatSummary } from '../src/summary.js';
import { generate } from '../src/cli.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-10-06';
const EN = getStrings('en');
const TR = getStrings('tr');

let n = 0;
/** A non-merge commit as readCommits() returns it, `added` lines in src/a.js. */
function commit(date, added = 2) {
  n += 1;
  const files = [{ path: 'src/a.js', added, removed: 0, binary: false }];
  return { hash: `c43-${n}`, author: 'Ada', email: 'ada@example.com', date, parents: ['p'], subject: `feat: ${n}`, files, filesChanged: 1, linesAdded: added, linesRemoved: 0 };
}
const day = (i) => `2026-03-${String((i % 28) + 1).padStart(2, '0')}T10:00:00+00:00`;

/** Stats of a small real history with commitSizes replaced by the given counts. */
function statsWithSizes([tiny, small, medium, large]) {
  const stats = computeStats([0, 1, 2, 3, 4].map((i) => commit(day(i))), { today: TODAY });
  const total = tiny + small + medium + large;
  stats.commitSizes = { total, tiny, small, medium, large, shares: { tiny: 0, small: 0, medium: 0, large: 0 } };
  return stats;
}

const mixOf = (counts) => shownCommitSizes({ tiny: counts[0], small: counts[1], medium: counts[2], large: counts[3] });
const texts = (counts, L = EN) => {
  const mix = mixOf(counts);
  return mix.map((b) => sizeShareText(b, mix, L));
};

const totalsSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'totals').spec;
const totalsCard = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'totals');
const stackOf = (spec) => (Array.isArray(spec.chart) ? spec.chart : [spec.chart]).find((c) => c?.kind === 'stack');

/** Asserts a list of shown size texts against the rule, given the bucket counts. */
function assertRule(values, counts, L, label) {
  const zero = L.pct(0);
  const full = L.pct(100);
  const withCommits = counts.filter((c) => c > 0).length;
  counts.forEach((c, i) => {
    if (c > 0) assert.notEqual(values[i], zero, `${label}: bucket ${i} has commits but reads ${zero}`);
    if (c > 0 && withCommits > 1) assert.notEqual(values[i], full, `${label}: bucket ${i} reads ${full} next to others`);
  });
}

// --- 1. sizeShareText ------------------------------------------------------------------------

describe('sizeShareText: the languages card rule for commit size shares', () => {
  test('[200, 1, 0, 0] → 99%, <1%, 0%, 0% (raw shares are 100 / 0)', () => {
    assert.deepEqual(mixOf([200, 1, 0, 0]).map((b) => b.share), [100, 0, 0, 0]);
    assert.deepEqual(texts([200, 1, 0, 0]), ['99%', '<1%', '0%', '0%']);
  });

  test('all large [0, 0, 0, 5] → 100% for large, 0% elsewhere', () => {
    assert.deepEqual(texts([0, 0, 0, 5]), ['0%', '0%', '0%', '100%']);
  });

  test('[1000, 0, 0, 1] → 99%, 0%, 0%, <1%', () => {
    assert.deepEqual(texts([1000, 0, 0, 1]), ['99%', '0%', '0%', '<1%']);
  });

  test('equal counts read the same: [1, 200, 0, 1] → <1%, 99%, 0%, <1%', () => {
    assert.deepEqual(texts([1, 200, 0, 1]), ['<1%', '99%', '0%', '<1%']);
    assert.deepEqual(texts([1, 200, 0, 1], TR), ['<%1', '%99', '%0', '<%1']);
  });

  test('exactly 1% reads "1%", not "<1%"', () => {
    assert.deepEqual(texts([1, 99, 0, 0]), ['1%', '99%', '0%', '0%']);
  });

  test('ordinary mixes read their raw shares', () => {
    assert.deepEqual(texts([1, 1, 1, 1]), ['25%', '25%', '25%', '25%']);
    assert.deepEqual(texts([3, 1, 0, 0]), ['75%', '25%', '0%', '0%']);
  });

  test('Turkish puts the percent sign first', () => {
    assert.deepEqual(texts([200, 1, 0, 0], TR), ['%99', '<%1', '%0', '%0']);
    assert.deepEqual(texts([0, 0, 0, 5], TR), ['%0', '%0', '%0', '%100']);
    assert.deepEqual(texts([1000, 0, 0, 1], TR), ['%99', '%0', '%0', '<%1']);
  });

  test('defaults to English', () => {
    const mix = mixOf([200, 1, 0, 0]);
    assert.equal(sizeShareText(mix[0], mix), '99%');
  });
});

describe('commit size shares on the totals card, in the recap and in wrapped.md', () => {
  const CASES = [[200, 1, 0, 0], [1000, 0, 0, 1], [0, 0, 0, 5], [0, 300, 0, 1], [1, 0, 999, 0], [7, 3, 0, 0]];

  for (const counts of CASES) {
    for (const lang of ['en', 'tr']) {
      const L = getStrings(lang);
      test(`${lang} [${counts}]: card values and hover titles follow the rule`, () => {
        const spec = totalsSpec(statsWithSizes(counts), { lang });
        const stack = stackOf(spec);
        assert.ok(stack, 'the size mix is on the card');
        const values = stack.segments.map((s) => s.value);
        assertRule(values, counts, L, 'card');
        stack.segments.forEach((s, i) => assert.ok(s.title.includes(values[i]), `hover title "${s.title}" carries "${values[i]}"`));
        assert.deepEqual(values, texts(counts, L));
      });

      test(`${lang} [${counts}]: recap line follows the rule`, () => {
        const text = formatSummary(statsWithSizes(counts), { today: TODAY, lang, repoName: 'demo' });
        const line = text.split('\n').find((l) => l.includes(L.recap.sizes));
        assert.ok(line, 'recap has the sizes line');
        const values = Object.values(L.recap.sizeNames).map((name) => {
          const m = line.match(new RegExp(`(\\S+) ${name}(?: |$)`));
          assert.ok(m, `${name} in "${line}"`);
          return m[1];
        });
        assertRule(values, counts, L, 'recap');
        assert.deepEqual(values, texts(counts, L));
      });

      test(`${lang} [${counts}]: wrapped.md line follows the rule`, () => {
        const md = buildMarkdown(statsWithSizes(counts), { repoName: 'demo', today: TODAY, lang });
        const line = md.split('\n').find((l) => l.includes(`**${L.totals.commitSizes}:**`));
        assert.ok(line, 'wrapped.md has the commit sizes line');
        const expected = mixOf(counts).map((b, i) => `${escapeMarkdown(texts(counts, L)[i])} ${L.recap.sizeNames[b.id]}`).join(' · ');
        assert.equal(line, `- **${L.totals.commitSizes}:** ${expected}`);
        const values = texts(counts, L);
        assertRule(values, counts, L, 'md');
      });
    }
  }

  test('the rendered totals card shows "99%" and "<1%", never "100%", for [200, 1, 0, 0]', () => {
    const { svg, description } = totalsCard(statsWithSizes([200, 1, 0, 0]));
    assert.match(svg, />99%</);
    assert.match(svg, />&lt;1%</);
    assert.doesNotMatch(svg, />100%</);
    assert.match(description, /Commit sizes/);
    assert.match(description, /\(99%\)/);
    assert.match(description, /\(<1%\)/);
    assert.doesNotMatch(description, /100%/);
  });

  test('the rendered totals card shows "<1%" for one large commit in 1001', () => {
    const { svg } = totalsCard(statsWithSizes([1000, 0, 0, 1]));
    assert.match(svg, />&lt;1%</);
    assert.match(svg, />99%</);
    assert.doesNotMatch(svg, />100%</);
  });

  test('stats.commitSizes keeps the raw shares (100 / 0)', () => {
    const commits = [...Array.from({ length: 200 }, (_, i) => commit(day(i), 1)), commit(day(5), 20)];
    const stats = computeStats(commits, { today: TODAY });
    assert.deepEqual(stats.commitSizes, { total: 201, tiny: 200, small: 1, medium: 0, large: 0, shares: { tiny: 100, small: 0, medium: 0, large: 0 } });
    // ...while every human-facing output adjusts them.
    assert.match(formatSummary(stats, { today: TODAY }), /99% tiny · <1% small · 0% medium · 0% large/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /99% tiny · \\<1% small · 0% medium · 0% large/);
  });
});

// --- 2. STACK_OPACITY ------------------------------------------------------------------------

describe('stacked bar opacities: every segment clearly visible', () => {
  // Only the size mix's part of the card (the split chart above has a bar too).
  const mixPart = (svg) => {
    const i = svg.indexOf('COMMIT SIZES');
    assert.ok(i >= 0, 'the size mix is drawn');
    return svg.slice(i);
  };
  const barOps = (svg) => [...mixPart(svg).matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="32" rx="[\d.]+"( fill-opacity="([\d.]+)")?>/g)].map((m) => (m[2] === undefined ? 1 : Number(m[2])));
  const swatchOps = (svg) => [...mixPart(svg).matchAll(/<rect x="[\d.]+" y="[\d.]+" width="20" height="20" rx="5"( fill-opacity="([\d.]+)")?\/>/g)].map((m) => (m[2] === undefined ? 1 : Number(m[2])));

  test('a mix with every size: four bar segments, each at least 0.4, fading left to right', () => {
    const { svg } = totalsCard(statsWithSizes([4, 3, 2, 1]));
    const ops = barOps(svg);
    assert.equal(ops.length, 4);
    for (const op of ops) assert.ok(op >= 0.4, `segment opacity ${op} >= 0.4`);
    for (let i = 1; i < ops.length; i++) assert.ok(ops[i] < ops[i - 1], 'each fainter than the last');
  });

  test('swatches use the same opacities as the bar segments', () => {
    const { svg } = totalsCard(statsWithSizes([4, 3, 2, 1]));
    assert.deepEqual(swatchOps(svg), barOps(svg));
    for (const op of swatchOps(svg)) assert.ok(op >= 0.4);
  });

  test('an all-large mix draws one bar clearly brighter than the 0.15 empty track', () => {
    const { svg } = totalsCard(statsWithSizes([0, 0, 0, 5]));
    const ops = barOps(svg);
    assert.equal(ops.length, 1);
    assert.ok(ops[0] >= 0.4, `large segment opacity ${ops[0]} >= 0.4`);
    assert.ok(ops[0] >= 0.15 * 2.5);
    // Four swatches, the large one the same as its bar.
    const sw = swatchOps(svg);
    assert.equal(sw.length, 4);
    assert.equal(sw[3], ops[0]);
  });
});

// --- 3. drawnCharts and the card description ---------------------------------------------

describe('layout: a dropped optional chart is left out of the description', () => {
  const thisYear = () => [0, 1, 2, 3, 4].map((i) => commit(day(i)));
  const lastYear = () => [commit('2025-03-01T10:00:00+00:00')];
  const yearStats = () => computeStats(thisYear(), { today: TODAY, previousYear: { year: 2026, commits: lastYear() } });
  const yearOpts = { since: '2026-01-01', until: '2026-12-31' };

  test('--year with a previous year: the size mix is dropped (not in drawnCharts)', () => {
    const spec = totalsSpec(yearStats(), yearOpts);
    assert.ok(stackOf(spec), 'the spec still carries the optional size mix');
    const layout = layoutCard(spec);
    assert.deepEqual(layout.drawnCharts, [0]);
    assert.ok(!layout.blocks.some((b) => b.kind === 'stack'), 'nothing of it is drawn');
    assert.deepEqual(renderCardWithLayout(spec).drawnCharts, [0]);
  });

  test('--year with a previous year: the description does not mention commit sizes (en + tr)', () => {
    const en = totalsCard(yearStats(), yearOpts);
    assert.doesNotMatch(en.svg, /COMMIT SIZES|Commit sizes/i);
    assert.doesNotMatch(en.description, /Commit sizes|Tiny/);
    assert.match(en.description, /Lines changed/, 'the split chart is still described');
    assert.match(en.description, /vs 2025/);
    const tr = totalsCard(yearStats(), { ...yearOpts, lang: 'tr' });
    assert.doesNotMatch(tr.description, new RegExp(TR.totals.commitSizes));
  });

  test('without --year the same history draws the mix and describes it', () => {
    const stats = computeStats(thisYear(), { today: TODAY });
    const spec = totalsSpec(stats);
    const layout = layoutCard(spec);
    assert.deepEqual(layout.drawnCharts, [0, 1]);
    assert.ok(layout.blocks.some((b) => b.kind === 'stack'));
    const card = totalsCard(stats);
    assert.match(card.description, /Commit sizes\. Tiny \(under 10 lines\): 5 commits \(100%\)\./);
    assert.match(totalsCard(stats, { lang: 'tr' }).description, new RegExp(TR.totals.commitSizes));
  });

  test('renderCard returns exactly renderCardWithLayout(...).svg', () => {
    const specs = [
      ...buildCardSpecs(yearStats(), { repoName: 'demo', today: TODAY, ...yearOpts }).map((c) => c.spec),
      ...buildCardSpecs(computeStats(thisYear(), { today: TODAY }), { repoName: 'demo', today: TODAY, lang: 'tr' }).map((c) => c.spec),
      {},
    ];
    for (const spec of specs) assert.equal(renderCard(spec), renderCardWithLayout(spec).svg);
    assert.equal(renderCard(), renderCardWithLayout().svg);
    assert.deepEqual(renderCardWithLayout(null).drawnCharts, []);
  });

  test('buildCards svgs equal renderCard of the specs', () => {
    const opts = { repoName: 'demo', today: TODAY, ...yearOpts };
    const stats = yearStats();
    const cards = buildCards(stats, opts);
    const specs = buildCardSpecs(stats, opts);
    assert.deepEqual(cards.map((c) => c.svg), specs.map((s) => renderCard(s.spec)));
  });

  test('layoutCard without charts reports no drawn charts', () => {
    assert.deepEqual(layoutCard({ title: 'x', big: '1' }).drawnCharts, []);
    assert.deepEqual(layoutCard().drawnCharts, []);
  });

  test('drawnCharts: a single chart spec is index 0; specs that draw nothing are skipped', () => {
    const split = { kind: 'split', title: 'Split', segments: [{ label: 'a', value: '1', amount: 1 }, { label: 'b', value: '2', amount: 2 }] };
    assert.deepEqual(layoutCard({ big: '1', chart: split }).drawnCharts, [0]);
    const junk = { kind: 'nope', title: 'Junk' };
    const oneSeg = { kind: 'stack', title: 'One', segments: [{ label: 'a', value: '1', amount: 1 }] };
    assert.deepEqual(layoutCard({ big: '1', chart: [junk, split, null, oneSeg] }).drawnCharts, [1]);
  });

  test('a required chart dropped from the end (8 repos + --year) is left out of the description', () => {
    const base = yearStats();
    const repos = Array.from({ length: 8 }, (_, i) => ({ name: `repo-${i}`, commits: 10 - i, linesAdded: 100, linesRemoved: 5, filesTouched: 3 }));
    const stats = { ...base, repos };
    const spec = totalsSpec(stats, yearOpts);
    const charts = spec.chart;
    const repoIdx = charts.findIndex((c) => c.title === EN.repos.commitsByRepo);
    assert.ok(repoIdx > 0, 'the spec carries the per-repo chart');
    const { drawnCharts } = layoutCard(spec);
    assert.ok(!drawnCharts.includes(repoIdx), 'the per-repo chart is dropped');
    const card = totalsCard(stats, yearOpts);
    assert.doesNotMatch(card.svg, /COMMITS BY REPO/);
    assert.doesNotMatch(card.description, /Commits by repo/);
    assert.doesNotMatch(card.description, /repo-0/);
    assert.match(card.description, /Lines changed/);
  });

  test('every card: the description mentions a chart title only when the SVG draws it', () => {
    const stats = { ...yearStats(), repos: Array.from({ length: 8 }, (_, i) => ({ name: `repo-${i}`, commits: 10 - i, linesAdded: 1, linesRemoved: 0, filesTouched: 1 })) };
    const opts = { repoName: 'demo', today: TODAY, ...yearOpts };
    const specs = buildCardSpecs(stats, opts);
    buildCards(stats, opts).forEach((card, k) => {
      const spec = specs[k].spec;
      const list = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
      const drawn = layoutCard(spec).drawnCharts;
      list.forEach((c, i) => {
        if (!c?.title || drawn.includes(i)) return;
        assert.ok(!card.description.includes(`${c.title}.`), `${card.id}: undrawn "${c.title}" not described`);
      });
    });
  });
});

// --- 3b. end to end: wrapped.html and wrapped.md ---------------------------------------------

describe('end to end: --year drop and the size mix in wrapped.html / wrapped.md', () => {
  const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };

  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw043-'));
    repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    const dates = ['2025-06-01T10:00:00+00:00', ...[1, 2, 3, 4, 5].map((d) => `2026-03-0${d}T10:00:00+00:00`)];
    for (const [i, date] of dates.entries()) {
      // One new one-line file per commit: every commit is tiny.
      const p = join(repo, 'src', `f${i}.js`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `line ${i}\n`);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    }
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

  const totalsDesc = (html) => {
    const m = html.match(/data-card="totals"[\s\S]*?<p class="sr" id="card-\d+-desc" aria-hidden="true">([^<]*)<\/p>/);
    assert.ok(m, 'the totals slide has a description');
    return m[1];
  };

  test('--year 2026: wrapped.html totals description leaves the dropped size mix out', async () => {
    const out = join(root, 'year');
    const r = await generate({ path: repo, out, year: '2026', since: '2026-01-01', until: '2026-12-31', png: false, md: true, json: true }, { today: TODAY });
    assert.ok(r.stats.yearOverYear, 'the year-over-year rows are there');
    const desc = totalsDesc(readFileSync(join(out, 'wrapped.html'), 'utf8'));
    assert.match(desc, /vs 2025/);
    assert.doesNotMatch(desc, /Commit sizes/);
    // wrapped.md is independent of the card's room: it still lists the mix.
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /^- \*\*Commit sizes:\*\* 100% tiny · 0% small · 0% medium · 0% large$/m);
    // stats.json: raw counts and shares.
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const sizes = json.stats?.commitSizes ?? json.commitSizes;
    assert.deepEqual(sizes, { total: 5, tiny: 5, small: 0, medium: 0, large: 0, shares: { tiny: 100, small: 0, medium: 0, large: 0 } });
  });

  test('no --year: wrapped.html totals description mentions the drawn size mix', async () => {
    const out = join(root, 'all');
    await generate({ path: repo, out, png: false }, { today: TODAY });
    const desc = totalsDesc(readFileSync(join(out, 'wrapped.html'), 'utf8'));
    assert.match(desc, /Commit sizes\. Tiny \(under 10 lines\): 6 commits \(100%\)\./);
  });
});

// --- 4. escapeMarkdown "$" -------------------------------------------------------------------

describe('escapeMarkdown escapes "$"', () => {
  test('SvelteKit-style paths never render as math', () => {
    assert.equal(escapeMarkdown('src/routes/$lib/$types.ts'), 'src/routes/\\$lib/\\$types.ts');
    assert.equal(escapeMarkdown('$x$'), '\\$x\\$');
    assert.equal(escapeMarkdown('$$a$$'), '\\$\\$a\\$\\$');
  });

  test('a hot file path with "$" is escaped in wrapped.md', () => {
    const c = commit(day(1), 3);
    c.files = [{ path: 'src/routes/$lib/$types.ts', added: 3, removed: 0, binary: false }];
    const md = buildMarkdown(computeStats([c], { today: TODAY }), { repoName: 'demo', today: TODAY });
    assert.match(md, /src\/routes\/\\\$lib\/\\\$types\.ts/);
    assert.doesNotMatch(md, /[^\\]\$lib/);
  });
});

// --- 5. wrapped.md "In numbers": commit sizes ------------------------------------------------

describe('wrapped.md: the commit size mix in "In numbers"', () => {
  const section = (md, heading) => {
    const start = md.indexOf(`## ${heading}`);
    assert.ok(start >= 0, `has ## ${heading}`);
    const next = md.indexOf('\n## ', start + 1);
    return md.slice(start, next < 0 ? undefined : next);
  };

  test('English: the line sits in "In numbers"', () => {
    const md = buildMarkdown(statsWithSizes([3, 1, 0, 0]), { repoName: 'demo', today: TODAY });
    const nums = section(md, EN.markdown.numbers);
    assert.match(nums, /^- \*\*Commit sizes:\*\* 75% tiny · 25% small · 0% medium · 0% large$/m);
  });

  test('Turkish: localized label, names and percent format', () => {
    const md = buildMarkdown(statsWithSizes([3, 1, 0, 0]), { repoName: 'demo', today: TODAY, lang: 'tr' });
    const nums = section(md, TR.markdown.numbers);
    assert.match(nums, /^- \*\*Commit boyutları:\*\* %75 minik · %25 küçük · %0 orta · %0 büyük$/m);
    assert.doesNotMatch(md, /Commit sizes|tiny/);
  });

  test('no mix, no line: 0 commits', () => {
    for (const lang of ['en', 'tr']) {
      const md = buildMarkdown(computeStats([], { today: TODAY }), { repoName: 'demo', today: TODAY, lang });
      assert.doesNotMatch(md, new RegExp(getStrings(lang).totals.commitSizes));
    }
  });

  test('no mix, no line: commits but commitSizes missing or all zero', () => {
    const missing = statsWithSizes([0, 0, 0, 0]);
    delete missing.commitSizes;
    const zero = statsWithSizes([0, 0, 0, 0]);
    for (const stats of [missing, zero]) {
      const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
      assert.match(md, new RegExp(`## ${EN.markdown.numbers}`));
      assert.doesNotMatch(md, /Commit sizes/);
    }
  });
});

// --- 6. Turkish longest break ----------------------------------------------------------------

describe('Turkish longest break value', () => {
  test('reads "N gün"', () => {
    assert.equal(TR.streak.breakValue(7), '7 gün');
    assert.equal(TR.streak.breakValue(1), '1 gün');
    assert.equal(TR.streak.breakValue(12345), '12.345 gün');
    assert.doesNotMatch(TR.streak.breakValue(7), /günlük|mola/);
  });

  test('the streak card callout carries it', () => {
    const commits = [commit('2026-03-01T10:00:00+00:00'), commit('2026-03-02T10:00:00+00:00'), commit('2026-03-10T10:00:00+00:00')];
    const spec = buildCardSpecs(computeStats(commits, { today: TODAY }), { repoName: 'demo', today: TODAY, lang: 'tr' }).find((c) => c.id === 'streak').spec;
    const callout = spec.chart.find((c) => c.kind === 'callout');
    assert.equal(callout.value, '7 gün');
  });
});
