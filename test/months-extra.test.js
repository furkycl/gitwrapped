// Extra edge cases for the monthly timeline (stats.months and the optional 'months' card),
// from the tester: end-to-end runs on fixture repos, windows and filters, multi-repo,
// languages, themes, the 24-month cap and month-boundary dates.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeMonths, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, CARD_IDS, cardIdsFor, COLOR_THEME_NAMES, hasMonthsCard, MAX_SHOWN_MONTHS, shownMonths } from '../src/cards/index.js';
import { generate, run } from '../src/cli.js';

const TODAY = '2026-10-06';

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

/** A throwaway repo at `dir`; steps: [{date, files?, email?, name?}] oldest first. */
function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    const files = s.files ?? { [`src/f${i}.js`]: `x${i}\n` };
    for (const [p, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    git(dir, ['add', '-A']);
    const who = { GIT_AUTHOR_NAME: s.name ?? 'Ada', GIT_AUTHOR_EMAIL: s.email ?? 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };
    git(dir, ['commit', '-q', '--allow-empty', '-m', `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
  return dir;
}

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'gw-months-x-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}

const capture = () => {
  let s = '';
  return { write: (x) => { s += x; }, get text() { return s; } };
};
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');
const stems = (ids) => ids.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}`);
const fakePng = async () => Buffer.from('png');
const BAD = /NaN|undefined|\[object /;

const c = (date, extra = {}) => ({ hash: `h${date}${Math.random()}`, date, subject: 'feat: x', author: 'Ada', email: 'a@x', files: [{ path: 'src/a.js', added: 1, removed: 0 }], ...extra });
const statsOf = (commits, today = TODAY) => computeStats(commits, { today });
const monthsSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'months')?.spec;

/** One commit on the 10th of every month from `start` ('YYYY-MM'), `n` months, commits = f(i). */
function series(start, n, f = () => 1) {
  const [y0, m0] = start.split('-').map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = y0 * 12 + m0 - 1 + i;
    const key = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
    for (let k = 0; k < f(i); k++) out.push(c(`${key}-${String(10 + (k % 15)).padStart(2, '0')}T12:00:00+00:00`));
  }
  return out;
}

describe('month boundaries (pure)', () => {
  test('author offset decides the month: -05:00 Jan 31 23:30 is January, +14:00 Mar 1 is March', () => {
    const m = computeMonths([c('2024-01-31T23:30:00-05:00'), c('2024-03-01T00:30:00+14:00')]);
    assert.deepEqual(m.months, [
      { month: '2024-01', commits: 1 },
      { month: '2024-02', commits: 0 },
      { month: '2024-03', commits: 1 },
    ]);
  });

  test('leap day Feb 29 counts for February', () => {
    const m = computeMonths([c('2024-02-29T12:00:00+00:00'), c('2024-02-29T23:59:59+00:00'), c('2024-03-01T00:00:00+00:00')]);
    assert.deepEqual(m.months, [{ month: '2024-02', commits: 2 }, { month: '2024-03', commits: 1 }]);
    assert.deepEqual(m.peak, { month: '2024-02', commits: 2 });
  });

  test('Dec → Jan across a year boundary: two months, card with Dec + year label', () => {
    const s = statsOf([c('2025-12-31T23:59:59+00:00'), c('2026-01-01T00:00:00+00:00'), c('2026-01-02T00:00:00+00:00')]);
    assert.deepEqual(s.months.months, [{ month: '2025-12', commits: 1 }, { month: '2026-01', commits: 2 }]);
    assert.equal(hasMonthsCard(s, { today: TODAY }), true);
    const spec = monthsSpec(s);
    assert.deepEqual(spec.chart.labels, ['Dec', '2026']);
    assert.equal(spec.big, 'Jan 2026');
    assert.deepEqual(spec.chart.titles, ['December 2025: 1 commit', 'January 2026: 2 commits']);
    assert.equal(spec.subtitle, '2 commits in a single month. You committed in every one of these 2 months.');
  });

  test('a long zero gap across several years is zero-filled', () => {
    const m = computeMonths([c('2020-06-15T12:00:00Z'), c('2023-06-15T12:00:00Z')]);
    assert.equal(m.months.length, 37);
    assert.equal(m.months.filter((x) => x.commits > 0).length, 2);
    assert.deepEqual(m.peak, { month: '2020-06', commits: 1 }, 'tie → earliest');
  });

  test('one month only → no card; empty history → no card', () => {
    assert.equal(hasMonthsCard(statsOf([c('2026-05-01T00:00:00Z'), c('2026-05-31T23:59:59Z')]), { today: TODAY }), false);
    assert.equal(hasMonthsCard(statsOf([]), { today: TODAY }), false);
    assert.ok(!buildCards(statsOf([]), { today: TODAY }).some((x) => x.id === 'months'));
  });

  test('a commit on today + 1 still counts, today + 2 is clipped', () => {
    const plusOne = statsOf([c('2026-09-20T12:00:00Z'), c('2026-10-07T12:00:00Z')]);
    assert.deepEqual(shownMonths(plusOne, TODAY).months.map((m) => m.month), ['2026-09', '2026-10']);
    // A next-month day only reachable as today + 1 at the month end.
    const eom = statsOf([c('2026-10-15T12:00:00Z'), c('2026-11-01T12:00:00Z')], '2026-10-31');
    assert.equal(hasMonthsCard(eom, { today: '2026-10-31' }), true);
    const eom2 = statsOf([c('2026-10-15T12:00:00Z'), c('2026-11-02T12:00:00Z')], '2026-10-31');
    assert.equal(hasMonthsCard(eom2, { today: '2026-10-31' }), false);
  });
});

describe('the 24-month cap (pure)', () => {
  test(`exactly ${MAX_SHOWN_MONTHS} months: no "last N" eyebrow; 25: the eyebrow and ${MAX_SHOWN_MONTHS} bars`, () => {
    const exact = monthsSpec(statsOf(series('2024-01', MAX_SHOWN_MONTHS)));
    assert.equal(exact.eyebrow, 'Month by month');
    assert.equal(exact.chart.values.length, MAX_SHOWN_MONTHS);
    const over = statsOf(series('2024-01', MAX_SHOWN_MONTHS + 1, (i) => (i === 0 ? 9 : 1)));
    // As of the last shown month: "your last 24 months".
    const spec = monthsSpec(over, { today: '2026-01-20' });
    assert.equal(spec.eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
    assert.equal(spec.chart.values.length, MAX_SHOWN_MONTHS);
    assert.equal(spec.chart.labels.length, MAX_SHOWN_MONTHS);
    assert.equal(spec.chart.titles.length, MAX_SHOWN_MONTHS);
    assert.equal(spec.chart.titles[0], 'February 2024: 1 commit', 'the oldest month is dropped');
    assert.equal(spec.chart.titles.at(-1), 'January 2026: 1 commit');
    // The 9-commit January 2024 is out of the shown window, so every shown month has 1
    // commit: steady copy, no peak called out, no bar highlighted.
    assert.equal(spec.big, '1');
    assert.equal(spec.title, 'commit in every active month');
    assert.equal(spec.chart.highlight.length, 0);
    assert.equal(spec.chart.peakLabel, '');
    assert.equal(over.months.months.length, MAX_SHOWN_MONTHS + 1, 'stats keep every month');
    assert.deepEqual(over.months.peak, { month: '2024-01', commits: 9 });
    // Turkish eyebrow too.
    assert.equal(monthsSpec(over, { lang: 'tr', today: '2026-01-20' }).eyebrow, `Son ${MAX_SHOWN_MONTHS} ay`);
    // As of October 2026 the timeline ended months ago: it names its last month.
    assert.equal(monthsSpec(over).eyebrow, `${MAX_SHOWN_MONTHS} months to Jan 2026`);
    assert.equal(monthsSpec(over, { lang: 'tr' }).eyebrow, `Oca 2026 itibarıyla ${MAX_SHOWN_MONTHS} ay`);
  });

  test('the rendered SVG of a 60-month history has exactly 24 bar titles', () => {
    const s = statsOf(series('2020-01', 60, (i) => (i % 4) + 1));
    const card = buildCards(s, { today: TODAY, repoName: 'demo' }).find((x) => x.id === 'months');
    const titles = [...card.svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]).filter((t) => /: \d+ commits?$/.test(t));
    assert.equal(titles.length, MAX_SHOWN_MONTHS, titles.join(' / '));
    assert.match(svgText(card.svg), /24 MONTHS TO DEC 2024/);
    assert.doesNotMatch(card.svg, BAD);
  });

  test('zero months inside the shown window: "N of 24" copy', () => {
    const s = statsOf(series('2023-01', 36, (i) => (i % 2 === 0 ? 2 : 0)));
    const spec = monthsSpec(s);
    assert.equal(spec.chart.values.length, MAX_SHOWN_MONTHS);
    assert.match(spec.subtitle, /You committed in 12 of 24 months\./);
  });
});

describe('end to end on fixture repos', () => {
  const STEPS = [
    { date: '2026-03-31T23:30:00-05:00' }, // March for the author (April 1 in UTC)
    { date: '2026-05-10T12:00:00+00:00' },
    { date: '2026-05-11T12:00:00+00:00' },
    { date: '2026-05-12T12:00:00+00:00' },
    { date: '2026-07-01T00:30:00+03:00' }, // July for the author (June 30 in UTC)
  ];

  test('PNG + JSON run: NN-months files contiguous, PNG count, html, stats.json shape', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), STEPS);
    const out = join(root, 'out');
    const r = await generate({ path: dir, out, png: true, json: true }, { today: TODAY, renderPng: fakePng });
    const ids = cardIdsFor({}).slice();
    ids.splice(ids.indexOf('activity') + 1, 0, 'months');
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), stems(ids).map((s) => `${s}.svg`));
    assert.deepEqual(readdirSync(join(out, 'png')).sort(), stems(ids).map((s) => `${s}.png`));
    assert.ok(existsSync(join(out, 'share.png')));
    assert.equal(r.pngFiles.length, ids.length);
    assert.ok(existsSync(join(out, 'cards', '06-months.svg')));
    const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
    assert.equal(html.match(/data-card="months"/g)?.length, 1);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.months, {
      months: [
        { month: '2026-03', commits: 1 },
        { month: '2026-04', commits: 0 },
        { month: '2026-05', commits: 3 },
        { month: '2026-06', commits: 0 },
        { month: '2026-07', commits: 1 },
      ],
      peak: { month: '2026-05', commits: 3 },
    });
    const svg = readFileSync(join(out, 'cards', '06-months.svg'), 'utf8');
    assert.match(svgText(svg), /May 2026/);
    assert.match(svg, /March 2026: 1 commit/);
    assert.match(svg, /July 2026: 1 commit/);
    assert.doesNotMatch(svg, BAD);
  });

  test('--lang tr via the CLI: Turkish month names in the card', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), STEPS);
    const out = join(root, 'out');
    const stdout = capture();
    const stderr = capture();
    const code = await run([dir, '--out', out, '--no-png', '--lang', 'tr', '--no-color'], { stdout, stderr, today: TODAY, openFile: () => {} });
    assert.equal(code ?? 0, 0, stderr.text);
    const svg = readFileSync(join(out, 'cards', '06-months.svg'), 'utf8');
    assert.match(svgText(svg), /May 2026/);
    assert.match(svgText(svg), /en yoğun ayındı/);
    assert.match(svg, /Mayıs 2026: 3 commit/);
    assert.match(svg, /Mart 2026: 1 commit/);
    assert.match(svg, /Temmuz 2026: 1 commit/);
    assert.match(svgText(svg), /AYLIK COMMIT/);
  });

  test('every color theme renders the months card', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), STEPS);
    for (const theme of COLOR_THEME_NAMES) {
      const out = join(root, `out-${theme}`);
      await generate({ path: dir, out, png: false, theme }, { today: TODAY });
      const svg = readFileSync(join(out, 'cards', '06-months.svg'), 'utf8');
      assert.doesNotMatch(svg, BAD, theme);
      assert.match(svg, /May 2026: 3 commits/, theme);
    }
  });

  test('--year keeps only that year; one month in the year → no card', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), [
      { date: '2024-12-31T23:00:00+00:00' },
      { date: '2025-02-10T12:00:00+00:00' },
      { date: '2025-04-10T12:00:00+00:00' },
      { date: '2025-04-11T12:00:00+00:00' },
      { date: '2026-01-01T01:00:00+00:00' },
    ]);
    const r = await generate({ path: dir, out: join(root, 'a'), png: false, json: true, since: '2025-01-01', until: '2025-12-31', year: 2025 }, { today: TODAY });
    assert.deepEqual(r.stats.months.months.map((m) => m.month), ['2025-02', '2025-03', '2025-04']);
    assert.deepEqual(r.stats.months.peak, { month: '2025-04', commits: 2 });
    assert.ok(r.cardFiles.some((f) => f.endsWith('-months.svg')));
    const doc = JSON.parse(readFileSync(join(root, 'a', 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.months, r.stats.months);
    // 2024: one December commit → no months card.
    const b = await generate({ path: dir, out: join(root, 'b'), png: false, since: '2024-01-01', until: '2024-12-31', year: 2024 }, { today: TODAY });
    assert.deepEqual(b.stats.months.months, [{ month: '2024-12', commits: 1 }]);
    assert.ok(!b.cardFiles.some((f) => f.endsWith('-months.svg')));
  });

  test('--exclude drops files, not commits: the months are unchanged', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), [
      { date: '2026-01-10T12:00:00Z', files: { 'dist/a.js': 'a\n' } },
      { date: '2026-02-10T12:00:00Z', files: { 'src/b.js': 'b\n' } },
    ]);
    const a = await generate({ path: dir, out: join(root, 'a'), png: false }, { today: TODAY });
    const b = await generate({ path: dir, out: join(root, 'b'), png: false, exclude: ['dist/**'] }, { today: TODAY });
    assert.deepEqual(b.stats.months, a.stats.months);
    assert.ok(b.cardFiles.some((f) => f.endsWith('06-months.svg')));
  });

  test('--author: months are the author\'s; a single-month author gets no card even with a team', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), [
      { date: '2026-01-10T12:00:00Z', email: 'ada@example.com' },
      { date: '2026-02-10T12:00:00Z', email: 'bob@example.com', name: 'Bob' },
      { date: '2026-03-10T12:00:00Z', email: 'bob@example.com', name: 'Bob' },
      { date: '2026-03-11T12:00:00Z', email: 'ada@example.com' },
    ]);
    const ada = await generate({ path: dir, out: join(root, 'ada'), png: false, author: 'ada@example.com' }, { today: TODAY });
    assert.deepEqual(ada.stats.months.months, [{ month: '2026-01', commits: 1 }, { month: '2026-02', commits: 0 }, { month: '2026-03', commits: 1 }]);
    assert.ok(ada.cardFiles.some((f) => f.endsWith('06-months.svg')));
    const solo = makeRepo(join(root, 'solo'), [
      { date: '2026-01-10T12:00:00Z', email: 'ada@example.com' },
      { date: '2026-02-10T12:00:00Z', email: 'bob@example.com', name: 'Bob' },
      { date: '2026-01-20T12:00:00Z', email: 'ada@example.com' },
    ]);
    const r = await generate({ path: solo, out: join(root, 'solo-out'), png: false, author: 'ada@example.com' }, { today: TODAY });
    assert.deepEqual(r.stats.months.months, [{ month: '2026-01', commits: 2 }]);
    const names = r.cardFiles.map((f) => f.split(/[\\/]/).pop());
    assert.ok(!names.some((f) => f.endsWith('-months.svg')));
    assert.ok(names.some((f) => f.endsWith('-contributors.svg')), 'contributors card still there');
    assert.deepEqual(names.map((f) => f.slice(0, 2)), names.map((_, i) => String(i + 1).padStart(2, '0')));
    // An author with no commits → no months.
    const none = await generate({ path: solo, out: join(root, 'none'), png: false, author: 'nobody@example.com' }, { today: TODAY });
    assert.deepEqual(none.stats.months, { months: [], peak: null });
    assert.ok(!none.cardFiles.some((f) => f.endsWith('-months.svg')));
  });

  test('multi-repo: two single-month repos merge into a two-month timeline', async (t) => {
    const root = tmpRoot(t);
    const a = makeRepo(join(root, 'a'), [{ date: '2026-01-10T12:00:00Z' }, { date: '2026-01-11T12:00:00Z' }]);
    const b = makeRepo(join(root, 'b'), [{ date: '2026-03-10T12:00:00Z' }]);
    const solo = await generate({ path: a, out: join(root, 'solo'), png: false }, { today: TODAY });
    assert.ok(!solo.cardFiles.some((f) => f.endsWith('-months.svg')));
    const r = await generate({ path: a, paths: [a, b], out: join(root, 'out'), png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.stats.months, {
      months: [{ month: '2026-01', commits: 2 }, { month: '2026-02', commits: 0 }, { month: '2026-03', commits: 1 }],
      peak: { month: '2026-01', commits: 2 },
    });
    assert.ok(r.cardFiles.some((f) => f.endsWith('06-months.svg')));
    const doc = JSON.parse(readFileSync(join(root, 'out', 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.months, r.stats.months);
  });

  test('a future-dated commit in a single-month repo: stats.json keeps it, no card', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), [{ date: '2026-10-01T12:00:00Z' }, { date: '2030-01-01T12:00:00Z' }]);
    const r = await generate({ path: dir, out: join(root, 'out'), png: false, json: true }, { today: TODAY });
    assert.equal(r.stats.months.months.length, 40);
    assert.ok(!r.cardFiles.some((f) => f.endsWith('-months.svg')));
  });

  test('a >24-month repo: card shows exactly 24 bars and the "24 months to <last month>" eyebrow', async (t) => {
    const root = tmpRoot(t);
    const steps = [];
    for (let i = 0; i < 30; i++) {
      const idx = 2024 * 12 + i;
      steps.push({ date: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-15T12:00:00Z` });
    }
    const dir = makeRepo(join(root, 'app'), steps);
    const r = await generate({ path: dir, out: join(root, 'out'), png: false, json: true }, { today: TODAY });
    assert.equal(r.stats.months.months.length, 30);
    const svg = readFileSync(join(root, 'out', 'cards', '06-months.svg'), 'utf8');
    const bars = [...svg.matchAll(/<title>([^<]*: \d+ commits?)<\/title>/g)];
    assert.equal(bars.length, MAX_SHOWN_MONTHS);
    assert.match(svgText(svg), /24 months to Jun 2026/i);
  });

  test('an empty repo: no months card, stats.months empty', async (t) => {
    const root = tmpRoot(t);
    const dir = join(root, 'empty');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    const r = await generate({ path: dir, out: join(root, 'out'), png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.stats.months, { months: [], peak: null });
    assert.ok(!r.cardFiles.some((f) => f.endsWith('-months.svg')));
    const doc = JSON.parse(readFileSync(join(root, 'out', 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.months, { months: [], peak: null });
  });

  test('card set with months and team equals CARD_IDS', async (t) => {
    const root = tmpRoot(t);
    const dir = makeRepo(join(root, 'app'), [
      { date: '2026-01-10T12:00:00Z' },
      { date: '2026-02-10T12:00:00Z', email: 'bob@example.com', name: 'Bob' },
    ]);
    const r = await generate({ path: dir, out: join(root, 'out'), png: false }, { today: TODAY });
    assert.deepEqual(r.cardFiles.map((f) => f.split(/[\\/]/).pop()), stems([...CARD_IDS]).map((s) => `${s}.svg`));
  });
});
