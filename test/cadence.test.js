// Cadence: commits per active day and the median gap between active days, as
// stats.cadence (computeCadence, src/stats/cadence.js), in the recap, in wrapped.md and as
// a row on the streak card (only when there is room). The active days are exactly
// totals.activeDays (author-local days, every dated commit counted).
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { CADENCE_MIN_DAYS, computeCadence, computeStats, medianGap, shownCadence } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, COLOR_THEME_NAMES } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, renderCardWithLayout } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const dayAt = (start, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
/** `per` commits at noon UTC on each of the day offsets `offsets` from `start`. */
const onDays = (offsets, per = 1, start = '2026-08-01') => offsets.flatMap((i) => Array.from({ length: per }, () => commit(`${dayAt(start, i)}T12:00:00Z`)));
const days = (list) => list.map(([day, commits]) => ({ day, commits }));
const streakSpec = (stats, lang = 'en', extra = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, ...extra }).find((c) => c.id === 'streak').spec;
const streakSvg = (stats, lang = 'en', extra = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, ...extra }).find((c) => c.id === 'streak').svg;
/**
 * The streak card's spec without the cadence row (the streak card has no other rows, so
 * that is the card as it was before cadence existed), and its SVG rendered the way
 * buildCards renders every card.
 */
const noCadenceSpec = (stats, lang = 'en') => {
  const { lines, ...rest } = streakSpec(stats, lang);
  return rest;
};
const noCadenceSvg = (stats, lang = 'en') => renderCardWithLayout(noCadenceSpec(stats, lang)).svg;
/** Asserts the streak card is exactly the card without a cadence row. */
const assertUnchanged = (stats, lang, label) => {
  const spec = streakSpec(stats, lang);
  assert.ok(!Object.hasOwn(spec, 'lines'), `${label}: no rows key at all`);
  assert.deepEqual(spec, noCadenceSpec(stats, lang), `${label}: same spec`);
  assert.equal(streakSvg(stats, lang), noCadenceSvg(stats, lang), `${label}: byte-identical`);
  assert.doesNotMatch(streakSvg(stats, lang), /per active day|Aktif günde/, label);
};

describe('computeCadence', () => {
  test('empty or malformed input → {perActiveDay: 0, medianGapDays: null}, never throws', () => {
    const none = { perActiveDay: 0, medianGapDays: null };
    for (const bad of [undefined, null, [], 'x', 7, {}, [null], [{ day: 'nope', commits: 3 }], [{ day: '2026-02-30', commits: 1 }], [{ day: '2026-03-01', commits: 0 }], [{ day: '2026-03-01', commits: -2 }], [{ day: '2026-03-01', commits: NaN }], [{ day: '2026-03-01', commits: '4' }]]) {
      assert.deepEqual(computeCadence(bad), none, JSON.stringify(bad));
    }
    assert.deepEqual(statsOf([]).cadence, none);
    assert.deepEqual(computeStats().cadence, none);
    assert.equal(shownCadence(statsOf([]), TODAY), null);
    assert.equal(shownCadence(undefined), null);
    assert.equal(shownCadence({ daily: { days: 'x' } }), null);
  });

  test('a single active day: commits per day, no gap', () => {
    assert.deepEqual(computeCadence(days([['2026-03-01', 5]])), { perActiveDay: 5, medianGapDays: null });
    const s = statsOf(onDays([0], 3));
    assert.deepEqual(s.cadence, { perActiveDay: 3, medianGapDays: null });
    assert.equal(shownCadence(s, TODAY), null);
  });

  test('consecutive days → gap 1', () => {
    assert.deepEqual(computeCadence(days([['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-03', 3]])), { perActiveDay: 2, medianGapDays: 1 });
    // Across a month and a year boundary.
    assert.deepEqual(computeCadence(days([['2025-12-31', 1], ['2026-01-01', 1]])), { perActiveDay: 1, medianGapDays: 1 });
    assert.deepEqual(computeCadence(days([['2024-02-28', 1], ['2024-02-29', 1], ['2024-03-01', 1]])), { perActiveDay: 1, medianGapDays: 1 });
  });

  test('gaps are calendar-day differences; odd count → the middle gap', () => {
    // Gaps 1, 3, 10 → median 3.
    assert.deepEqual(computeCadence(days([['2026-03-01', 1], ['2026-03-02', 1], ['2026-03-05', 1], ['2026-03-15', 1]])), { perActiveDay: 1, medianGapDays: 3 });
    // Mon → Thu is 3.
    assert.equal(computeCadence(days([['2026-03-02', 1], ['2026-03-05', 1]])).medianGapDays, 3);
  });

  test('even count → the mean of the two middle gaps (may be .5)', () => {
    // Gaps 1, 2 → 1.5.
    assert.equal(computeCadence(days([['2026-03-01', 1], ['2026-03-02', 1], ['2026-03-04', 1]])).medianGapDays, 1.5);
    // Gaps 1, 1, 7, 30 → (1 + 7) / 2 = 4.
    assert.equal(computeCadence(days([['2026-03-01', 1], ['2026-03-02', 1], ['2026-03-03', 1], ['2026-03-10', 1], ['2026-04-09', 1]])).medianGapDays, 4);
    assert.equal(medianGap([0, 1, 3, 6, 10]), 2.5); // gaps 1, 2, 3, 4
    assert.equal(medianGap([5]), null);
    assert.equal(medianGap(null), null);
  });

  test('any order, duplicate days merged; perActiveDay rounded to 1 decimal', () => {
    assert.deepEqual(computeCadence(days([['2026-03-05', 2], ['2026-03-01', 3], ['2026-03-05', 2]])), { perActiveDay: 3.5, medianGapDays: 4 });
    // 7 commits over 3 days = 2.333… → 2.3; 5 over 3 = 1.666… → 1.7.
    assert.equal(computeCadence(days([['2026-03-01', 3], ['2026-03-02', 2], ['2026-03-03', 2]])).perActiveDay, 2.3);
    assert.equal(computeCadence(days([['2026-03-01', 3], ['2026-03-02', 1], ['2026-03-03', 1]])).perActiveDay, 1.7);
  });

  test('the same days and commits as totals.activeDays: author-local, merges and future-dated counted, undated left out', () => {
    const s = statsOf([
      commit('2026-03-01T23:30:00-05:00'), // Mar 1 local (Mar 2 UTC)
      commit('2026-03-02T01:00:00+03:00'), // Mar 2 local (Mar 1 UTC)
      commit('2026-03-02T10:00:00Z', { parents: ['a', 'b'] }), // a merge
      commit('2027-01-01T10:00:00Z'), // future-dated
      commit('not a date'),
    ]);
    assert.equal(s.totals.activeDays, 3);
    assert.equal(s.totals.commits, 5);
    // 4 dated commits on 3 days; gaps 1 and 305 → 153.
    assert.deepEqual(s.cadence, { perActiveDay: 1.3, medianGapDays: 153 });
    // The shown cadence leaves the future-dated day out, as for the longest break.
    assert.deepEqual(shownCadence(s, TODAY), { perActiveDay: 1.5, medianGapDays: 1, activeDays: 2 });
    // Without `today` (or with a later one) it is the raw value.
    assert.deepEqual(shownCadence(s), { perActiveDay: 1.3, medianGapDays: 153, activeDays: 3 });
  });

  test('every day in the future → kept as is (nothing better to show)', () => {
    const s = statsOf(onDays([0, 2], 1, '2030-01-01'));
    assert.deepEqual(shownCadence(s, TODAY), { perActiveDay: 1, medianGapDays: 2, activeDays: 2 });
  });

  test('several repos: commits on the same author-local day share one active day', () => {
    const a = [commit('2026-03-01T10:00:00Z', { repo: 'api' }), commit('2026-03-03T10:00:00Z', { repo: 'api' })];
    const b = [commit('2026-03-01T18:00:00Z', { repo: 'web' }), commit('2026-03-04T10:00:00Z', { repo: 'web' })];
    const s = statsOf([...a, ...b], { repos: [{ label: 'api' }, { label: 'web' }] });
    assert.equal(s.totals.activeDays, 3);
    assert.deepEqual(s.cadence, { perActiveDay: 1.3, medianGapDays: 1.5 });
  });

  test('a window is whatever commits computeStats gets: a past --until window', () => {
    const s = statsOf(onDays([0, 1, 5, 6, 10], 2), { today: '2026-08-11', todayComplete: true });
    assert.deepEqual(s.cadence, { perActiveDay: 2, medianGapDays: 2.5 });
  });

  test('stats.cadence follows stats.streaks and is in stats.json', () => {
    const s = statsOf(onDays([0, 3], 2));
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('streaks') + 1], 'cadence');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 2, medianGapDays: 3 });
    const one = JSON.parse(buildStatsJson({ stats: statsOf(onDays([0])), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(one.stats.cadence, { perActiveDay: 1, medianGapDays: null });
  });
});

describe('shownCadence', () => {
  test(`needs ${CADENCE_MIN_DAYS} or more active days`, () => {
    assert.equal(CADENCE_MIN_DAYS, 2);
    assert.equal(shownCadence(statsOf(onDays([0], 9)), TODAY), null);
    assert.deepEqual(shownCadence(statsOf(onDays([0, 1], 1)), TODAY), { perActiveDay: 1, medianGapDays: 1, activeDays: 2 });
  });
});

describe('strings', () => {
  test('en and tr wording, decimals in each language', () => {
    assert.equal(en.streak.cadencePerDay(2.4), '2.4 commits per active day');
    assert.equal(en.streak.cadencePerDay(1), '1 commit per active day');
    assert.equal(en.streak.cadencePerDay(1234.5), '1,234.5 commits per active day');
    assert.equal(en.streak.cadenceEvery(1), 'every day');
    assert.equal(en.streak.cadenceEvery(3), 'every 3 days');
    assert.equal(en.streak.cadenceEvery(2.5), 'every 2.5 days');
    assert.equal(en.streak.cadenceRow(2.4), '2.4 per active day');
    assert.equal(tr.streak.cadencePerDay(2.4), 'Aktif gün başına 2,4 commit');
    assert.equal(tr.streak.cadencePerDay(1234.5), 'Aktif gün başına 1.234,5 commit');
    assert.equal(tr.streak.cadenceEvery(1), 'her gün');
    assert.equal(tr.streak.cadenceEvery(3), '3 günde bir');
    assert.equal(tr.streak.cadenceEvery(2.5), '2,5 günde bir');
    assert.equal(tr.streak.cadenceRow(2.4), 'Aktif günde 2,4 commit');
  });
});

describe('recap and wrapped.md', () => {
  const s = statsOf([...onDays([0, 1, 2], 3), ...onDays([5, 8], 1)]); // 11 commits / 5 days; gaps 1, 1, 3, 3 → 2

  test('recap line after the break, en and tr', () => {
    assert.deepEqual(s.cadence, { perActiveDay: 2.2, medianGapDays: 2 });
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Break {8}longest 2 days[^\n]*\n {2}Cadence {6}2\.2 commits per active day · every 2 days\n/);
    const outTr = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(outTr, /\n {2}Ritim {12}Aktif gün başına 2,2 commit · 2 günde bir\n/);
  });

  test('wrapped.md item in the streaks section, en and tr', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /^- \*\*Longest break:\*\*[^\n]*\n- \*\*Cadence:\*\* 2\.2 commits per active day · every 2 days$/m);
    const mdTr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(mdTr, /^- \*\*Ritim:\*\* Aktif gün başına 2,2 commit · 2 günde bir$/m);
  });

  test('"every day" for back-to-back days', () => {
    const daily = statsOf(onDays([0, 1, 2, 3], 2));
    assert.match(formatSummary(daily, { repoName: 'demo', today: TODAY }), /Cadence {6}2 commits per active day · every day\n/);
    assert.match(buildMarkdown(daily, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\*\*Ritim:\*\* Aktif gün başına 2 commit · her gün$/m);
  });

  test('no line with a single active day or without commits', () => {
    for (const st of [statsOf(onDays([0], 4)), statsOf([])]) {
      assert.doesNotMatch(formatSummary(st, { repoName: 'demo', today: TODAY }), /Cadence/);
      assert.doesNotMatch(buildMarkdown(st, { repoName: 'demo', today: TODAY }), /Cadence/);
      assert.doesNotMatch(formatSummary(st, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Ritim/);
    }
  });

  test('the recap leaves future-dated days out with today', () => {
    const st = statsOf([...onDays([0, 1]), commit('2031-01-01T10:00:00Z')]);
    assert.match(formatSummary(st, { repoName: 'demo', today: TODAY }), /Cadence {6}1 commit per active day · every day\n/);
  });
});

describe('streak card', () => {
  /** Asserts the row is drawn whole, inside the content area, with no overlap and no extra shrink. */
  const assertRowFits = (stats, lang, label) => {
    const spec = streakSpec(stats, lang);
    const L = lang === 'tr' ? tr : en;
    const c = shownCadence(stats, TODAY);
    assert.deepEqual(spec.lines, [{ label: L.streak.cadenceRow(c.perActiveDay), value: L.streak.cadenceEvery(c.medianGapDays), description: `${L.streak.cadencePerDay(c.perActiveDay)} · ${L.streak.cadenceEvery(c.medianGapDays)}` }], label);
    const layout = layoutCard({ ...spec, lang });
    const base = layoutCard({ ...noCadenceSpec(stats, lang), lang });
    assert.notEqual(streakSvg(stats, lang), noCadenceSvg(stats, lang), `${label}: the row changes the card`);
    // The big number, title, subtitle and break panel keep their size; only the bar chart
    // may give up some spare spacing.
    // (Block edges are rounded to 0.1px, so a height may differ by that rounding.)
    const sizes = (l) => l.blocks.filter((b) => !['rows', 'hbars'].includes(b.kind)).map((b) => [b.kind, b.bottom - b.top]);
    const [after, before] = [sizes(layout), sizes(base)];
    assert.deepEqual(after.map(([k]) => k), before.map(([k]) => k), `${label}: same blocks`);
    for (const [i, [kind, h]] of after.entries()) assert.ok(Math.abs(h - before[i][1]) <= 0.11, `${label}: ${kind} the same size (${h} vs ${before[i][1]})`);
    assert.deepEqual(layout.drawnCharts, base.drawnCharts, `${label}: same charts`);
    assert.ok(layout.shrinkSteps <= base.shrinkSteps, `${label}: nothing smaller`);
    const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
    for (const [i, b] of sorted.entries()) {
      assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} inside`);
      if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} no overlap`);
    }
    const svg = streakSvg(stats, lang);
    assert.ok(svg.includes(`>${spec.lines[0].label}<`), `${label}: whole label`);
    assert.ok(svg.includes(`>${spec.lines[0].value}<`), `${label}: whole value`);
  };

  test('a cadence row when there is room, en and tr', () => {
    const s = statsOf(onDays([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3));
    const specEn = streakSpec(s);
    assert.deepEqual(specEn.lines.map(({ label, value }) => ({ label, value })), [{ label: '3 per active day', value: 'every day' }]);
    assert.deepEqual(streakSpec(s, 'tr').lines.map(({ label, value }) => ({ label, value })), [{ label: 'Aktif günde 3 commit', value: 'her gün' }]);
    assertRowFits(s, 'en', 'daily en');
    assertRowFits(s, 'tr', 'daily tr');
    // With a break panel too.
    const gaps = statsOf(onDays([0, 3, 6, 9, 12, 15], 2));
    assert.deepEqual(streakSpec(gaps).lines.map(({ label, value }) => ({ label, value })), [{ label: '2 per active day', value: 'every 3 days' }]);
    assert.deepEqual(streakSpec(gaps, 'tr').lines.map(({ label, value }) => ({ label, value })), [{ label: 'Aktif günde 2 commit', value: '3 günde bir' }]);
    assertRowFits(gaps, 'en', 'gaps en');
    assertRowFits(gaps, 'tr', 'gaps tr');
    const half = statsOf([...onDays([0, 1, 3], 2), ...onDays([5], 1)]); // gaps 1, 2, 2 → 2; 7/4 = 1.8
    assert.deepEqual(streakSpec(half).lines.map(({ label, value }) => ({ label, value })), [{ label: '1.8 per active day', value: 'every 2 days' }]);
    assertRowFits(half, 'en', 'half en');
    // (its Turkish subtitle runs three lines, so the row would not fit there; see below)
    const tr15 = statsOf([...onDays([0, 6], 2), ...onDays([3, 9], 1)]); // 6 / 4 = 1.5; gaps 3, 3, 3
    assert.deepEqual(streakSpec(tr15, 'tr').lines.map(({ label, value }) => ({ label, value })), [{ label: 'Aktif günde 1,5 commit', value: '3 günde bir' }]);
    assertRowFits(tr15, 'tr', '1.5 tr');
  });

  test('the card description reads the row in the recap\'s wording, en and tr', () => {
    const s = statsOf(onDays([0, 1, 2], 2));
    const desc = (lang) => buildCards(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'streak').description;
    assert.match(desc('en'), /2 commits per active day · every day\./);
    assert.doesNotMatch(desc('en'), /per active day:/);
    assert.match(desc('tr'), /Aktif gün başına 2 commit · her gün\./);
    assert.doesNotMatch(desc('tr'), /Aktif günde 2 commit:/);
    // Other rows still read "label: value".
    assert.match(buildCards(s, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'streak').description, /Longest/);
  });

  test('byte-identical with a single active day or without commits', () => {
    for (const s of [statsOf(onDays([0], 4)), statsOf([])]) {
      assertUnchanged(s, 'en', 'en');
      assertUnchanged(s, 'tr', 'tr');
    }
  });

  test('byte-identical when the row does not fit (it would shrink the big number)', () => {
    // Turkish subtitle runs three lines: the row only fits with the big number smaller.
    const s = statsOf([...onDays([0, 1, 2, 3, 4]), ...onDays([0, 7, 14, 21])]);
    assert.ok(shownCadence(s, TODAY));
    assertUnchanged(s, 'tr', 'tr');
    // The row would have needed the big number one or more steps smaller.
    const withRow = layoutCard({ ...noCadenceSpec(s, 'tr'), lines: [{ label: tr.streak.cadenceRow(1), value: tr.streak.cadenceEvery(1) }], lang: 'tr' });
    assert.ok(withRow.shrinkSteps > layoutCard({ ...noCadenceSpec(s, 'tr'), lang: 'tr' }).shrinkSteps);
  });

  test('either a fitting row or the card exactly as before, across many histories (en, tr)', () => {
    let shown = 0;
    let skipped = 0;
    for (const per of [1, 2, 7, 13]) {
      for (const step of [1, 2, 3, 9]) {
        for (const count of [2, 3, 6, 15]) {
          const offsets = Array.from({ length: count }, (_, i) => i * step + (i % 3 === 2 ? 1 : 0));
          const s = statsOf(onDays(offsets, per));
          for (const lang of ['en', 'tr']) {
            const label = `per ${per} step ${step} count ${count} ${lang}`;
            const spec = streakSpec(s, lang);
            if (spec.lines) {
              shown++;
              assertRowFits(s, lang, label);
            } else {
              skipped++;
              assertUnchanged(s, lang, label);
            }
          }
        }
      }
    }
    assert.ok(shown > 0 && skipped > 0, `shown ${shown}, skipped ${skipped}`);
  });

  test('the same layout in every color theme', () => {
    const s = statsOf(onDays([0, 2, 4, 6, 8], 2));
    for (const lang of ['en', 'tr']) {
      let base;
      for (const colorTheme of COLOR_THEME_NAMES) {
        const spec = streakSpec(s, lang, { colorTheme });
        assert.equal(spec.lines?.length, 1, `${lang} ${colorTheme}`);
        const geo = layoutCard({ ...spec, lang }).blocks.map((b) => [b.kind, b.top, b.bottom]);
        if (!base) base = geo;
        else assert.deepEqual(geo, base, `${lang} ${colorTheme}`);
      }
    }
  });

  test('other cards get no cadence row', () => {
    const s = statsOf(onDays([0, 1, 2], 2));
    for (const { id, spec } of buildCardSpecs(s, { repoName: 'demo', today: TODAY })) {
      if (id === 'streak') continue;
      for (const l of spec.lines ?? []) assert.doesNotMatch(`${l.label} ${l.value}`, /per active day/, id);
    }
  });
});

describe('cadence: CLI end to end', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  /** dates as empty commits. */
  const repo = (name, dates) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const [i, date] of dates.entries()) {
      git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${i}`], {
        GIT_AUTHOR_NAME: 'ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_COMMITTER_DATE: date,
      });
    }
    return dir;
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
  const md = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');
  const streakCard = (out) => readFileSync(join(out, 'cards', '04-streak.svg'), 'utf8');

  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'gw-cadence-')); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  // Author-local days Mar 1, 2, 4, 7 (gaps 1, 2, 3 → 2); 6 commits / 4 days = 1.5.
  const base = [
    '2026-03-01T23:30:00-05:00', // Mar 1 local (Mar 2 UTC)
    '2026-03-02T01:00:00+03:00', // Mar 2 local (Mar 1 UTC)
    '2026-03-02T15:00:00Z',
    '2026-03-04T10:00:00Z',
    '2026-03-04T11:00:00Z',
    '2026-03-07T10:00:00Z',
  ];

  test('en: stats.json, recap, wrapped.md and the streak card agree', () => {
    const out = join(tmp, 'en-out');
    const r = bin([repo('en', base), '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 4);
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 1.5, medianGapDays: 2 });
    assert.match(r.stdout, /\n {2}Cadence {6}1\.5 commits per active day · every 2 days\n/);
    assert.match(md(out), /^- \*\*Cadence:\*\* 1\.5 commits per active day · every 2 days$/m);
    const card = streakCard(out);
    assert.ok(card.includes('>1.5 per active day<'), 'streak card row');
    assert.ok(card.includes('>every 2 days<'));
  });

  test('tr: the same in Turkish', () => {
    // Mar 1, 4, 7, 10 (gaps 3, 3, 3); 6 commits / 4 days = 1.5. (With `base` the Turkish
    // subtitle runs three lines and the card has no room for the row.)
    const dates = ['2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z', '2026-03-04T10:00:00Z', '2026-03-07T10:00:00Z', '2026-03-07T11:00:00Z', '2026-03-10T10:00:00Z'];
    const out = join(tmp, 'tr-out');
    const r = bin([repo('tr', dates), '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.cadence, { perActiveDay: 1.5, medianGapDays: 3 });
    assert.match(r.stdout, /\n {2}Ritim {12}Aktif gün başına 1,5 commit · 3 günde bir\n/);
    assert.match(md(out), /^- \*\*Ritim:\*\* Aktif gün başına 1,5 commit · 3 günde bir$/m);
    const card = streakCard(out);
    assert.ok(card.includes('>Aktif günde 1,5 commit<'));
    assert.ok(card.includes('>3 günde bir<'));
    assert.doesNotMatch(card, /per active day/);
  });

  test('tr: no room on the streak card → the card is left as is, the recap still has the line', () => {
    const out = join(tmp, 'tr-base-out');
    const r = bin([repo('tr-base', base), '--out', out, '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ritim {12}Aktif gün başına 1,5 commit · 2 günde bir/);
    assert.doesNotMatch(streakCard(out), /Aktif günde/);
  });

  test('--since: days before the window are left out', () => {
    const out = join(tmp, 'since-out');
    const r = bin([repo('since', ['2026-02-01T10:00:00Z', '2026-02-02T10:00:00Z', ...base.slice(3)]), '--out', out, '--json', '--since', '2026-03-03']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.cadence, { perActiveDay: 1.5, medianGapDays: 3 });
    assert.match(r.stdout, /Cadence +1\.5 commits per active day · every 3 days/);
  });

  test('several repos: active days merged across repos', () => {
    const a = repo('multi-a', ['2026-03-01T10:00:00Z', '2026-03-03T10:00:00Z']);
    const b = repo('multi-b', ['2026-03-01T18:00:00Z', '2026-03-04T10:00:00Z']);
    const out = join(tmp, 'multi-out');
    const r = bin([a, b, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 3);
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 1.3, medianGapDays: 1.5 });
    assert.match(r.stdout, /Cadence {6}1\.3 commits per active day · every 1\.5 days/);
  });

  test('a single active day: null gap in stats.json, no line anywhere', () => {
    const out = join(tmp, 'one-out');
    const r = bin([repo('one', ['2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z']), '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.cadence, { perActiveDay: 2, medianGapDays: null });
    assert.doesNotMatch(r.stdout, /Cadence/);
    assert.doesNotMatch(md(out), /Cadence/);
    assert.doesNotMatch(streakCard(out), /per active day/);
  });
});
