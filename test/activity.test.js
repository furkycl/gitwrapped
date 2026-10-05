// Activity heatmap: computeDaily (commits per author-local day), the 'calendar' chart
// block (window, cells, levels, titles, month labels, legend) and the 'activity' card
// (copy, empty state, layout in normal / empty / dense / multi-year cases).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { buildCards, buildCardSpecs, CARD_IDS, formatDay, layoutCard, renderCard } from '../src/cards/index.js';
import { calendarLevels, calendarMonthLabels, calendarWindow, CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { computeDaily, computeStats, dayKeyFromEpoch, epochDay, mondayOf } from '../src/stats/index.js';

const TODAY = '2026-10-05';
const at = (date) => ({ hash: date, author: 'A', email: 'a@x', date, subject: 'feat: x', files: [{ path: 'src/a.js', added: 1, removed: 0 }], filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
const pad = (n) => String(n).padStart(2, '0');

/** Seeded LCG so "random" data is the same on every run. */
function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** Commits on `nDays` days from `start` ('YYYY-MM-DD'), each day active with probability `p`. */
function synth(start, nDays, p, seed = 7) {
  const r = rng(seed);
  const out = [];
  const e0 = epochDay(start);
  for (let i = 0; i < nDays; i++) {
    if (r() > p) continue;
    const n = 1 + Math.floor(r() ** 3 * 30);
    const day = dayKeyFromEpoch(e0 + i);
    for (let k = 0; k < n; k++) out.push(at(`${day}T${pad(8 + (k % 14))}:00:00+00:00`));
  }
  return out;
}

const cellRects = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill-opacity="([\d.]+)">(?:<title>([^<]*)<\/title>)?<\/rect>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], op: +m[5], title: m[6] ?? null }));
const calendarSvg = (days, extra = {}) => layoutCard({ chart: { kind: 'calendar', days, ...extra } }).blocks.find((b) => b.kind === 'calendar').svg;
const monthLabels = (svg) => [...svg.matchAll(/font-size="24" font-weight="700" fill-opacity="0.7">([A-Z][a-z]{2})</g)].map((m) => m[1]);

describe('time helpers', () => {
  test('dayKeyFromEpoch inverts epochDay', () => {
    for (const k of ['1970-01-01', '1969-12-31', '2000-02-29', '2024-02-29', '2026-10-05', '0001-01-01', '9999-12-31']) {
      assert.equal(dayKeyFromEpoch(epochDay(k)), k);
    }
    for (let e = -1000; e < 30000; e += 37) assert.equal(epochDay(dayKeyFromEpoch(e)), e);
    for (const bad of [1.5, NaN, Infinity, null, '3', 1e17]) assert.equal(dayKeyFromEpoch(bad), null, String(bad));
  });

  test('mondayOf gives the Monday of the week', () => {
    assert.equal(dayKeyFromEpoch(mondayOf(epochDay('2026-10-05'))), '2026-10-05'); // a Monday
    assert.equal(dayKeyFromEpoch(mondayOf(epochDay('2026-10-04'))), '2026-09-28'); // Sunday
    assert.equal(dayKeyFromEpoch(mondayOf(epochDay('1970-01-01'))), '1969-12-29');
  });
});

describe('computeDaily', () => {
  test('empty input', () => {
    assert.deepEqual(computeDaily([]), { days: [], busiest: null, activeWeeks: 0 });
    assert.deepEqual(computeDaily(), { days: [], busiest: null, activeWeeks: 0 });
    assert.deepEqual(computeDaily([at('nope'), at(null), {}, null]), { days: [], busiest: null, activeWeeks: 0 });
  });

  test('counts per author-local day, sorted ascending, active days only', () => {
    const d = computeDaily([
      at('2026-10-05T01:00:00+09:00'), // Oct 4 16:00 UTC, but Oct 5 for the author
      at('2026-10-04T23:30:00-05:00'), // Oct 5 UTC, Oct 4 for the author
      at('2026-10-04T10:00:00Z'),
      at('2026-09-01T10:00:00Z'),
      at('2026-02-30T10:00:00Z'), // impossible date: skipped
    ]);
    assert.deepEqual(d.days, [{ day: '2026-09-01', commits: 1 }, { day: '2026-10-04', commits: 2 }, { day: '2026-10-05', commits: 1 }]);
    assert.deepEqual(d.busiest, { day: '2026-10-04', commits: 2 });
    assert.equal(d.activeWeeks, 3); // Tue Sep 1, Sun Oct 4 and Mon Oct 5 are three Monday-first weeks
  });

  test('activeWeeks counts Monday-first weeks', () => {
    // Sunday Oct 4 and Monday Oct 5 are in different weeks; Mon Sep 28 shares Oct 4's week.
    assert.equal(computeDaily([at('2026-10-04T10:00:00Z'), at('2026-10-05T10:00:00Z')]).activeWeeks, 2);
    assert.equal(computeDaily([at('2026-09-28T10:00:00Z'), at('2026-10-04T10:00:00Z')]).activeWeeks, 1);
  });

  test('busiest: ties go to the earliest day, regardless of input order', () => {
    const commits = [at('2026-10-05T10:00:00Z'), at('2026-10-05T11:00:00Z'), at('2026-01-02T10:00:00Z'), at('2026-01-02T11:00:00Z')];
    assert.deepEqual(computeDaily(commits).busiest, { day: '2026-01-02', commits: 2 });
    assert.deepEqual(computeDaily([...commits].reverse()).busiest, { day: '2026-01-02', commits: 2 });
  });

  test('deterministic and part of computeStats', () => {
    const commits = synth('2025-10-06', 365, 0.8);
    assert.deepEqual(computeDaily(commits), computeDaily([...commits].reverse()));
    const s = computeStats(commits, { today: TODAY });
    assert.deepEqual(s.daily, computeDaily(commits));
    assert.equal(s.daily.days.length, s.totals.activeDays);
    assert.equal(s.daily.days.reduce((n, d) => n + d.commits, 0), commits.length);
    assert.deepEqual(computeStats([], { today: TODAY }).daily, { days: [], busiest: null, activeWeeks: 0 });
  });
});

describe('calendar window and levels', () => {
  const days = (...keys) => keys.map((day) => ({ day, commits: 1 }));

  test('at least 8 weeks, ending with the week of the last active day', () => {
    const w = calendarWindow(days('2026-10-04', '2026-10-01'));
    assert.equal(w.weeks, 8);
    assert.equal(dayKeyFromEpoch(w.start + 7 * 7), '2026-09-28'); // last row: Mon Sep 28 .. Sun Oct 4
    assert.equal(dayKeyFromEpoch(w.start), '2026-08-10');
    assert.equal(w.clipped, false);
  });

  test('covers the full range up to 53 weeks, then keeps the most recent 53', () => {
    const w = calendarWindow(days('2026-01-05', '2026-10-05'));
    assert.equal(dayKeyFromEpoch(w.start), '2026-01-05');
    assert.equal(w.weeks, 40);
    const year = calendarWindow(days('2025-10-06', '2026-10-05'));
    assert.equal(year.weeks, 53);
    assert.equal(year.clipped, false);
    const long = calendarWindow(days('2019-03-03', '2026-10-05'));
    assert.equal(long.weeks, 53);
    assert.equal(long.clipped, true);
    assert.equal(dayKeyFromEpoch(long.start + 52 * 7), '2026-10-05');
  });

  test('bad entries are ignored; nothing valid → 8 empty weeks', () => {
    const w = calendarWindow([{ day: 'nope', commits: 3 }, { day: '2026-02-30', commits: 1 }, { day: '2026-10-05', commits: 0 }, { day: '2026-10-05', commits: NaN }, null]);
    assert.deepEqual({ start: w.start, weeks: w.weeks, size: w.counts.size }, { start: null, weeks: 8, size: 0 });
    assert.equal(calendarWindow(undefined).weeks, 8);
  });

  test('levels: quartiles of active-day counts, busiest always on top, all equal → top', () => {
    const lv = calendarLevels([1, 2, 3, 4]);
    assert.deepEqual([1, 2, 3, 4].map(lv), [0, 1, 2, 3]);
    const skew = calendarLevels([1, 1, 1, 1, 1, 2, 3, 10]);
    assert.deepEqual([1, 2, 3, 10].map(skew), [0, 2, 3, 3]); // q1 = q2 = 1, q3 = 2
    assert.deepEqual([5, 5].map(calendarLevels([5, 5])), [3, 3]);
    assert.deepEqual([1, 2].map(calendarLevels([1, 2])), [0, 3]);
  });
});

describe('calendar block', () => {
  const sample = [{ day: '2026-10-04', commits: 24 }, { day: '2026-10-05', commits: 1 }, { day: '2026-09-15', commits: 3 }, { day: '2026-09-01', commits: 2 }];

  test('deterministic', () => {
    assert.equal(calendarSvg(sample), calendarSvg(sample));
    assert.equal(calendarSvg(sample), calendarSvg([...sample].reverse()));
  });

  test('weeks x 7 cells plus 5 legend swatches; active cells titled, empty ones not', () => {
    const rects = cellRects(calendarSvg(sample));
    const weeks = calendarWindow(sample).weeks;
    assert.equal(weeks, 8);
    const cells = rects; // legend swatches are self-closing, so not matched
    assert.equal(cells.length, weeks * 7);
    const legend = [...calendarSvg(sample).matchAll(/<rect [^>]*width="24" height="24"[^>]*fill-opacity="([\d.]+)"\/>/g)].map((m) => +m[1]);
    assert.deepEqual(legend, [0.08, 0.3, 0.5, 0.75, 1]);
    const titled = cells.filter((c) => c.title);
    assert.deepEqual(titled.map((c) => c.title).sort(), ['Oct 4, 2026: 24 commits', 'Oct 5, 2026: 1 commit', 'Sep 1, 2026: 2 commits', 'Sep 15, 2026: 3 commits'].sort());
    for (const c of cells) assert.equal(c.op, c.title ? c.op : 0.08);
    const op = Object.fromEntries(titled.map((c) => [c.title.split(':')[0], c.op]));
    assert.equal(op['Oct 4, 2026'], 1);
    assert.equal(op['Oct 5, 2026'], 0.3);
    assert.ok([0.3, 0.5, 0.75, 1].includes(op['Sep 1, 2026']));
  });

  test('rows are weeks (oldest on top), columns Monday-first, cells square and inside the content width', () => {
    const cells = cellRects(calendarSvg(sample));
    const xs = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
    const ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
    assert.equal(xs.length, 7);
    assert.equal(ys.length, 8);
    for (const c of cells) {
      assert.equal(c.w, c.h);
      assert.ok(c.w <= 72);
      assert.ok(c.x >= 96 && c.x + c.w <= 96 + 888 + 0.5, `x ${c.x}`);
    }
    const find = (t) => cells.find((c) => c.title?.startsWith(t));
    // Oct 5 2026 is a Monday (first column, last row); Oct 4 is the Sunday before it.
    assert.equal(find('Oct 5,').x, xs[0]);
    assert.equal(find('Oct 5,').y, ys[7]);
    assert.equal(find('Oct 4,').x, xs[6]);
    assert.equal(find('Oct 4,').y, ys[6]);
    assert.ok(find('Sep 1,').y < find('Sep 15,').y);
    // Short range: big cells, centred.
    const left = xs[0];
    const right = xs[6] + cells[0].w;
    assert.ok(cells[0].w >= 60, `cell ${cells[0].w}`);
    assert.ok(Math.abs((96 + 888 - right) - (left - 96)) < 120, 'roughly centred');
  });

  test('weekday header, month labels and legend text', () => {
    const svg = calendarSvg(sample);
    const head = [...svg.matchAll(/text-anchor="middle">([A-Z])</g)].map((m) => m[1]).join('');
    assert.equal(head, 'MTWTFSS');
    assert.deepEqual(monthLabels(svg), ['Aug', 'Sep', 'Oct']);
    assert.ok(svg.includes('>Less<') && svg.includes('>More<'));
  });

  test('a full year: 53 rows split into side-by-side panels, every month labelled', () => {
    const daily = computeDaily(synth('2025-10-06', 365, 0.85)).days;
    const svg = calendarSvg(daily);
    const cells = cellRects(svg);
    assert.equal(cells.length, 53 * 7);
    const months = monthLabels(svg);
    for (const m of ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']) assert.ok(months.includes(m), m);
    const heads = (svg.match(/text-anchor="middle">M</g) ?? []).length;
    assert.ok(heads >= 2, `panels: ${heads}`);
    for (const c of cells) assert.ok(c.x >= 96 && c.x + c.w <= 984.5);
    assert.ok(cells[0].w >= 20, `cell ${cells[0].w}`);
  });

  test('calendarMonthLabels: rows holding a 1st, plus the first row unless a label follows too soon', () => {
    const start = epochDay('2026-08-10'); // Monday
    // Rows: Aug 10, 17, 24, 31 (holds Sep 1), Sep 7, 14, 21, 28 (holds Oct 1)
    assert.deepEqual(calendarMonthLabels(start, 0, 8, 1), [{ row: 0, month: 8 }, { row: 3, month: 9 }, { row: 7, month: 10 }]);
    // The first row (Aug 24) is two rows from Sep: dropped when labels need 3 rows.
    assert.deepEqual(calendarMonthLabels(start, 2, 8, 3), [{ row: 3, month: 9 }, { row: 7, month: 10 }]);
    assert.deepEqual(calendarMonthLabels(start, 2, 8, 1), [{ row: 2, month: 8 }, { row: 3, month: 9 }, { row: 7, month: 10 }]);
    // A row starting on the 1st itself (Mon Jun 1, 2026) is labelled once.
    assert.deepEqual(calendarMonthLabels(epochDay('2026-06-01'), 0, 2, 1), [{ row: 0, month: 6 }]);
    assert.deepEqual(calendarMonthLabels(start, 3, 3, 1), []);
  });

  test('cell titles keep a 4-digit year', () => {
    const svg = calendarSvg([{ day: '0999-03-04', commits: 2 }]);
    assert.ok(svg.includes('<title>Mar 4, 0999: 2 commits</title>'), svg.slice(0, 200));
  });

  test('an empty calendar: 8 weeks of empty cells, no titles or month labels', () => {
    const svg = calendarSvg([]);
    const cells = cellRects(svg);
    assert.equal(cells.length, 56);
    assert.ok(cells.every((c) => c.op === 0.08 && c.title === null));
    assert.deepEqual(monthLabels(svg), []);
  });
});

// --- the activity card -----------------------------------------------------------------

const yearCommits = () => synth('2025-10-06', 365, 0.85);
const SCENARIOS = [
  ['normal', () => computeStats([at('2026-10-04T20:10:00+03:00'), at('2026-10-04T21:10:00+03:00'), at('2026-10-05T09:00:00+03:00')], { today: TODAY }), { repoName: 'demo' }],
  ['empty', () => computeStats([], { today: TODAY }), { repoName: 'empty-repo' }],
  ['dense', () => computeStats(yearCommits(), { today: TODAY }), { repoName: 'dense' }],
  ['multi-year', () => computeStats(synth('2019-03-03', 2700, 0.4, 3), { today: TODAY }), { repoName: 'old' }],
  ['mid', () => computeStats(synth('2026-04-01', 150, 0.6, 5), { today: TODAY }), { repoName: 'mid' }],
];
const activitySpec = (stats, opts) => buildCardSpecs(stats, opts).find((c) => c.id === 'activity').spec;

describe('activity card', () => {
  test('sits after streak as card 05 with a theme unlike its neighbours', () => {
    assert.equal(CARD_IDS.indexOf('activity'), CARD_IDS.indexOf('streak') + 1);
    const specs = buildCardSpecs(computeStats([], { today: TODAY }), { repoName: 'x' });
    const i = specs.findIndex((c) => c.id === 'activity');
    assert.equal(specs[i].spec.number, '05');
    assert.notEqual(specs[i].spec.theme, specs[i - 1].spec.theme);
    assert.notEqual(specs[i].spec.theme, specs[i + 1].spec.theme);
  });

  test('copy: active days, busiest day, weeks; calendar eyebrow for short ranges', () => {
    const s = SCENARIOS[0][1]();
    const spec = activitySpec(s, { repoName: 'demo' });
    assert.equal(spec.eyebrow, 'Your commit calendar');
    assert.equal(spec.big, '2');
    assert.equal(spec.title, 'active days');
    assert.equal(spec.subtitle, 'Busiest day: Oct 4, 2026 with 2 commits. You showed up in 2 different weeks.');
    assert.equal(spec.chart.kind, 'calendar');
    assert.ok(!spec.chart.title);
    const one = activitySpec(computeStats([at('2026-10-05T09:00:00Z')], { today: TODAY }), {});
    assert.equal(one.title, 'active day');
    assert.equal(one.subtitle, 'Busiest day: Oct 5, 2026 with 1 commit. You showed up in 1 week.');
  });

  test('eyebrow: calendar under ~300 days, year for ~1 year, last 12 months when clipped', () => {
    const eyebrow = (commits) => activitySpec(computeStats(commits, { today: TODAY }), {}).eyebrow;
    assert.equal(eyebrow(synth('2026-04-01', 150, 1)), 'Your commit calendar');
    assert.equal(eyebrow(synth('2025-12-15', 290, 1)), 'Your commit calendar');
    assert.equal(eyebrow(synth('2025-10-06', 365, 1)), 'Your year in commits');
    assert.equal(eyebrow(synth('2025-11-01', 300, 1)), 'Your year in commits');
    assert.equal(eyebrow(synth('2024-01-01', 700, 1)), 'Your last 12 months');
    const dense = activitySpec(SCENARIOS[2][1](), {});
    assert.ok(!dense.chart.title);
  });

  test('clipped range: headline counts only the days inside the 53-week window', () => {
    // An old, very busy year, then a quieter recent year.
    const old = Array.from({ length: 50 }, () => at('2024-03-05T10:00:00Z'));
    const recent = synth('2025-10-06', 365, 0.5, 11);
    const s = computeStats([...old, ...recent], { today: TODAY });
    const spec = activitySpec(s, {});
    const win = calendarWindow(s.daily.days);
    assert.equal(win.clipped, true);
    const shown = s.daily.days.filter((d) => epochDay(d.day) >= win.start);
    assert.ok(shown.length < s.daily.days.length);
    assert.equal(spec.eyebrow, 'Your last 12 months');
    assert.equal(spec.big, String(shown.length));
    assert.deepEqual(spec.chart.days, shown);
    const top = shown.reduce((a, d) => (d.commits > a.commits ? d : a));
    assert.ok(spec.subtitle.startsWith(`Busiest day: ${formatDay(top.day)} with`), spec.subtitle);
    assert.ok(!spec.subtitle.includes('Mar 5, 2024'), spec.subtitle);
    assert.ok(spec.subtitle.includes(`with ${top.commits} commit`), spec.subtitle);
    const weeks = new Set(shown.map((d) => mondayOf(epochDay(d.day)))).size;
    assert.ok(spec.subtitle.endsWith(`You showed up in ${weeks} different weeks.`), spec.subtitle);
    // Every cell title matches the shown data: nothing older than the window.
    const svg = renderCard(spec);
    assert.ok(!svg.includes('2024:'));
    assert.ok(!svg.includes('THE LAST 12 MONTHS'), 'the eyebrow says it; no extra caption');
  });

  test('empty stats: friendly empty state with an empty 8-week grid', () => {
    const spec = activitySpec(computeStats([], { today: TODAY }), {});
    assert.equal(spec.big, '0');
    assert.equal(spec.subtitle, 'No commits yet — go ship something!');
    const svg = buildCards(computeStats([], { today: TODAY }))[CARD_IDS.indexOf('activity')].svg;
    assert.equal(cellRects(svg).length, 56);
    assert.ok(!/NaN|undefined|null/.test(svg));
  });

  test('copes with missing or junk daily stats', () => {
    for (const daily of [undefined, null, {}, { days: 'x' }, { days: [{ day: 'bad', commits: 3 }], busiest: { day: 'bad' }, activeWeeks: NaN }]) {
      const spec = activitySpec({ daily }, {});
      assert.equal(spec.big, '0');
      assert.ok(!/NaN|undefined|null/.test(renderCard(spec)));
    }
  });

  for (const [name, make, opts] of SCENARIOS) {
    test(`${name}: layout stays in the content area without collisions`, () => {
      const layout = layoutCard(activitySpec(make(), opts));
      const { blocks } = layout;
      const cal = blocks.find((b) => b.kind === 'calendar');
      assert.ok(cal, 'calendar kept');
      for (const b of blocks) {
        assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${b.kind} ${b.top}..${b.bottom}`);
      }
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${blocks[i].kind}/${blocks[j].kind}`);
      }
      // Everything the calendar draws lies inside its box and inside the content width.
      for (const m of cal.svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
        const [x, y, w, h] = m.slice(1).map(Number);
        assert.ok(y >= cal.top - 0.5 && y + h <= cal.bottom + 0.5, `rect y ${y}`);
        assert.ok(x >= 96 - 0.5 && x + w <= 984 + 0.5, `rect x ${x}`);
      }
      const texts = [...cal.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
      for (const [x, y, size] of texts) {
        assert.ok(y - size * 0.8 >= cal.top - 2 && y <= cal.bottom + 2, `text y ${y}`);
        assert.ok(x >= 96 - 0.5 && x <= 984 + 0.5, `text x ${x}`);
      }
      // Month labels never overlap each other or the cells.
      const cells = cellRects(cal.svg);
      const labels = [...cal.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="24" font-weight="700" fill-opacity="0.7">([A-Z][a-z]{2})</g)].map((m) => ({ x: +m[1], y: +m[2] }));
      for (const l of labels) {
        for (const c of cells) assert.ok(!(l.x < c.x + c.w && c.x < l.x + 50 && l.y - 18 < c.y + c.h && c.y < l.y), 'label overlaps a cell');
      }
      for (let i = 1; i < labels.length; i++) {
        if (labels[i].x === labels[i - 1].x) assert.ok(labels[i].y - labels[i - 1].y >= 24, 'labels too close');
      }
      // The legend sits below the grid.
      const legendTop = Math.min(...[...cal.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="24" height="24"/g)].map((m) => +m[1]));
      assert.ok(legendTop >= Math.max(...cells.map((c) => c.y + c.h)), 'legend below the grid');
    });
  }
});

describe('re-running into an older output folder', () => {
  test('old-numbered card files (e.g. 05-hot-files) are removed; unrelated files stay', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-renumber-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true, maxRetries: 5 });
    });
    mkdirSync(join(out, 'cards'), { recursive: true });
    mkdirSync(join(out, 'png'), { recursive: true });
    for (const f of ['05-hot-files.svg', '08-outro.svg', 'notes.svg', '05-mine.svg']) writeFileSync(join(out, 'cards', f), 'old');
    for (const f of ['05-hot-files.png', 'keep.png']) writeFileSync(join(out, 'png', f), 'old');
    writeFileSync(join(out, 'wrapped.html'), 'old'); // an earlier run's marker
    const fakePng = async () => Buffer.from('89504e470d0a1a0a', 'hex');
    await generate({ path: fixture.dir, out }, { today: TODAY, renderPng: fakePng });
    const expected = CARD_IDS.map((id, i) => `${pad(i + 1)}-${id}`);
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), [...expected.map((f) => `${f}.svg`), '05-mine.svg', 'notes.svg'].sort());
    assert.deepEqual(readdirSync(join(out, 'png')).sort(), [...expected.map((f) => `${f}.png`), 'keep.png'].sort());
    // Without PNGs, every known card PNG goes (old numbering included); others stay.
    writeFileSync(join(out, 'png', '05-hot-files.png'), 'old');
    await generate({ path: fixture.dir, out, png: false }, { today: TODAY });
    assert.deepEqual(readdirSync(join(out, 'png')), ['keep.png']);
  });

  test('without an earlier wrapped.html nothing old is deleted', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-nomarker-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true, maxRetries: 5 });
    });
    mkdirSync(join(out, 'cards'), { recursive: true });
    mkdirSync(join(out, 'png'), { recursive: true });
    writeFileSync(join(out, 'cards', '05-hot-files.svg'), 'old');
    writeFileSync(join(out, 'png', '08-outro.png'), 'old');
    const fakePng = async () => Buffer.from('89504e470d0a1a0a', 'hex');
    await generate({ path: fixture.dir, out }, { today: TODAY, renderPng: fakePng });
    assert.ok(readdirSync(join(out, 'cards')).includes('05-hot-files.svg'));
    assert.ok(readdirSync(join(out, 'png')).includes('08-outro.png'));
    // --no-png into a fresh folder with old names: still kept.
    const out2 = mkdtempSync(join(tmpdir(), 'gw-nomarker2-'));
    t.after(() => rmSync(out2, { recursive: true, force: true, maxRetries: 5 }));
    mkdirSync(join(out2, 'png'), { recursive: true });
    writeFileSync(join(out2, 'png', '05-hot-files.png'), 'old');
    await generate({ path: fixture.dir, out: out2, png: false }, { today: TODAY });
    assert.deepEqual(readdirSync(join(out2, 'png')), ['05-hot-files.png']);
  });
});
