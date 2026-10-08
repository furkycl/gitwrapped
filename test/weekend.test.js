// Weekend share: how many commits landed on an author-local Saturday or Sunday, as
// stats.weekend (computeWeekend, src/stats/weekend.js), in the recap, in wrapped.md and as
// a row on the activity card (when its grid shows every commit and there is room). The
// count and percent always agree with the Weekend Warrior personality.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeTimeHabits, computeWeekend, shownWeekend, weekendPercent, weekendPercentLabel, WEEKEND_DAYS } from '../src/stats/index.js';
import { personalityReason } from '../src/stats/personality.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CALENDAR_MIN_CELL, CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
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
const statsOf = (commits) => computeStats(commits, { today: TODAY });
/** `stats` without stats.officeHours, for the activity-card tests that look at the weekend row alone (the office-hours row: test/office-hours.test.js). */
const noOffice = (stats) => {
  const copy = { ...stats };
  delete copy.officeHours;
  return copy;
};
const day = (epochMs) => new Date(epochMs).toISOString().slice(0, 10);
/** One commit a day at noon (+03:00) for `count` days ending on `last` ('YYYY-MM-DD'). */
const daily = (count, last = '2026-10-06', offset = '+03:00') => Array.from({ length: count }, (_, i) =>
  commit(`${day(Date.parse(`${last}T00:00:00Z`) - i * 86400000)}T12:00:00${offset}`));
const activitySpec = (stats, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'activity').spec;
const activitySvg = (stats, lang) => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'activity').svg;
/** `stats` as it would be without any weekend commit (what the cards drew before). */
const noWeekend = (stats) => ({ ...stats, habits: { ...stats.habits, byWeekday: stats.habits.byWeekday.map((v, i) => (WEEKEND_DAYS.includes(i) ? 0 : v)) } });

describe('computeWeekend', () => {
  test('empty or missing input → zero', () => {
    const none = { commits: 0, share: 0 };
    assert.deepEqual(computeWeekend(), none);
    assert.deepEqual(computeWeekend(null), none);
    assert.deepEqual(computeWeekend({}), none);
    assert.deepEqual(computeWeekend({ byWeekday: 'x', byHour: 7 }), none);
    assert.deepEqual(statsOf([]).weekend, none);
    assert.deepEqual(computeStats().weekend, none);
    assert.equal(shownWeekend(statsOf([])), null);
    assert.equal(shownWeekend(undefined), null);
  });

  test('Saturday and Sunday in the author\'s own local time, whatever the UTC day', () => {
    const s = statsOf([
      commit('2026-03-07T22:00:00-05:00'), // Saturday local (Sunday in UTC) → weekend
      commit('2026-03-08T01:00:00+03:00'), // Sunday local (Saturday in UTC) → weekend
      commit('2026-03-06T23:00:00-05:00'), // Friday local (Saturday in UTC) → not
      commit('2026-03-09T01:00:00+03:00'), // Monday local (Sunday in UTC) → not
    ]);
    assert.deepEqual(s.weekend, { commits: 2, share: 0.5 });
    assert.deepEqual(shownWeekend(s), { commits: 2, percent: 50 });
  });

  test('counts every dated commit like the power hour: merges and future-dated included', () => {
    const s = statsOf([
      commit('2026-03-07T10:00:00Z', { parents: ['a', 'b'] }), // a merge, Saturday
      commit('2027-01-02T10:00:00Z'), // future-dated, Saturday
      commit('2026-03-09T10:00:00Z'),
      commit('not a date'),
    ]);
    assert.deepEqual(s.weekend, { commits: 2, share: 0.667 });
    assert.equal(s.weekend.commits, s.habits.byWeekday[0] + s.habits.byWeekday[6]);
  });

  test('share has 3 decimals, never 1 short of every commit', () => {
    const hours = (total) => [total, ...new Array(23).fill(0)];
    assert.deepEqual(computeWeekend({ byWeekday: [999, 1, 0, 0, 0, 0, 0], byHour: hours(1000) }), { commits: 999, share: 0.999 });
    assert.deepEqual(computeWeekend({ byWeekday: [1999, 1, 0, 0, 0, 0, 0], byHour: hours(2000) }), { commits: 1999, share: 0.999 });
    assert.deepEqual(computeWeekend({ byWeekday: [3, 0, 0, 0, 0, 0, 4], byHour: hours(7) }), { commits: 7, share: 1 });
    assert.deepEqual(computeWeekend({ byWeekday: [1, 2, 0, 0, 0, 0, 0], byHour: hours(3) }), { commits: 1, share: 0.333 });
  });

  test('stats.weekend follows stats.timezones and is in stats.json', () => {
    const s = statsOf([commit('2026-03-07T09:00:00Z')]);
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('timezones') + 1], 'weekend');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.weekend, { commits: 1, share: 1 });
  });
});

describe('weekend percent', () => {
  test('whole percent, 99 at most short of every commit, "<1%" for a share that rounds to 0', () => {
    assert.equal(weekendPercent(0.084), 8);
    assert.equal(weekendPercent(0.125), 13);
    assert.equal(weekendPercent(0.996), 99);
    assert.equal(weekendPercent(1), 100);
    assert.equal(weekendPercent(0), 0);
    assert.equal(weekendPercent(NaN), 0);
    assert.equal(weekendPercentLabel(8, en.pct), '8%');
    assert.equal(weekendPercentLabel(8, tr.pct), '%8');
    assert.equal(weekendPercentLabel(0, en.pct), '<1%');
    assert.equal(weekendPercentLabel(0, tr.pct), '<%1');
  });
});

describe('consistency with Weekend Warrior', () => {
  test('the same count and percent as the archetype\'s reason, en and tr', () => {
    let checked = 0;
    for (const total of [5, 7, 9, 13, 27, 40, 201]) {
      for (let weekend = 1; weekend <= total; weekend += Math.max(1, Math.floor(total / 9))) {
        // Weekdays at 2 PM (no night / morning habit), the rest on Saturdays and Sundays,
        // with mixed offsets: the weekday is always the author's own.
        const commits = Array.from({ length: total }, (_, i) => {
          const offset = ['+03:00', '-05:00', '+00:00'][i % 3];
          if (i < weekend) return commit(`2026-03-${i % 2 ? '07' : '08'}T14:00:00${offset}`);
          return commit(`2026-03-${String(2 + (i % 4)).padStart(2, '0')}T14:00:00${offset}`);
        });
        const s = statsOf(commits);
        const shown = shownWeekend(s);
        assert.equal(shown.commits, weekend);
        assert.equal(s.weekend.commits, weekend);
        if (s.personality.archetype.id !== 'weekend-warrior') continue;
        checked += 1;
        assert.equal(personalityReason(s.personality, en), en.personality.reasons['weekend-warrior'](shown.percent));
        assert.match(personalityReason(s.personality, en), new RegExp(`^${shown.percent}% `));
        assert.match(personalityReason(s.personality, tr), new RegExp(`%${shown.percent} `));
        assert.match(formatSummary(s, { repoName: 'demo', paths: {} }), new RegExp(`Weekends {5}${weekend} commits? \\(${shown.percent}% of commits\\)`));
      }
    }
    assert.ok(checked >= 10, `checked ${checked} Weekend Warriors`);
  });

  test('a Weekend Warrior short of every commit never reads "100%"', () => {
    const commits = [...Array.from({ length: 299 }, () => commit('2026-03-07T14:00:00Z')), commit('2026-03-09T14:00:00Z')];
    const s = statsOf(commits);
    assert.equal(s.personality.archetype.id, 'weekend-warrior');
    assert.equal(personalityReason(s.personality, en), '99% of your commits land on a Saturday or Sunday.');
    assert.deepEqual(shownWeekend(s), { commits: 299, percent: 99 });
    assert.deepEqual(s.weekend, { commits: 299, share: 0.997 });
  });

  test('stats.weekend comes from habits.byWeekday', () => {
    const commits = daily(40);
    assert.deepEqual(computeWeekend(computeTimeHabits(commits)), statsOf(commits).weekend);
  });
});

describe('recap and wrapped.md', () => {
  const s = statsOf([...daily(10), commit('2026-03-07T10:00:00Z', { parents: ['a', 'b'] })]);
  // 10 days ending on Tue 2026-10-06: Sun Sep 27th, Sat 3rd and Sun 4th, plus the merge
  // on a Saturday.

  test('recap line, en and tr', () => {
    assert.deepEqual(s.weekend, { commits: 4, share: 0.364 });
    const out = formatSummary(s, { repoName: 'demo', paths: {} });
    assert.match(out, /\n {2}Weekends {5}4 commits \(36% of commits\)\n/);
    const outTr = formatSummary(s, { repoName: 'demo', paths: {}, lang: 'tr' });
    assert.match(outTr, /\n {2}Hafta sonu {7}4 commit \(commit'lerin %36 kadarı\)\n/);
    assert.ok(out.indexOf('Weekends') > out.indexOf('Busiest day'));
  });

  test('wrapped.md item, en and tr', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /- \*\*Weekend commits:\*\* 4 commits \(36% of commits\)\n/);
    const mdTr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(mdTr, /- \*\*Hafta sonu commit'leri:\*\* 4 commit \(commit'lerin %36 kadarı\)\n/);
  });

  test('no line without a weekend commit', () => {
    const weekdays = statsOf([commit('2026-03-09T10:00:00Z'), commit('2026-03-10T10:00:00Z')]);
    assert.deepEqual(weekdays.weekend, { commits: 0, share: 0 });
    assert.doesNotMatch(formatSummary(weekdays, { repoName: 'demo', paths: {} }), /Weekend/);
    assert.doesNotMatch(formatSummary(weekdays, { repoName: 'demo', paths: {}, lang: 'tr' }), /Hafta sonu/);
    assert.doesNotMatch(buildMarkdown(weekdays, { repoName: 'demo', today: TODAY }), /Weekend/);
    assert.doesNotMatch(buildMarkdown(weekdays, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Hafta sonu/);
  });

  test('a share that rounds to 0 reads "<1%"', () => {
    const st = statsOf([...Array.from({ length: 200 }, () => commit('2026-03-09T10:00:00Z')), commit('2026-03-07T10:00:00Z')]);
    assert.equal(st.weekend.commits, 1);
    assert.match(formatSummary(st, { repoName: 'demo', paths: {} }), /Weekends {5}1 commit \(<1% of commits\)/);
    assert.match(formatSummary(st, { repoName: 'demo', paths: {}, lang: 'tr' }), /1 commit \(commit'lerin <%1 kadarı\)/);
  });
});

describe('activity card', () => {
  /** Blocks inside the content area and not overlapping. */
  function assertLayoutOk(spec, lang, label) {
    const layout = layoutCard({ ...spec, lang });
    const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
    for (const [i, b] of sorted.entries()) {
      assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} inside the content area`);
      if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap`);
    }
    return layout;
  }

  test('a weekend row when the grid shows every commit, en and tr', () => {
    for (const count of [7, 60, 150, 200]) {
      const s = noOffice(statsOf(daily(count)));
      const w = shownWeekend(s);
      assert.ok(w);
      const spec = activitySpec(s, 'en');
      assert.deepEqual(spec.lines, [{ label: 'Weekends', value: `${w.commits} commits · ${w.percent}%` }]);
      const specTr = activitySpec(s, 'tr');
      assert.deepEqual(specTr.lines, [{ label: 'Hafta sonu', value: `${w.commits} commit · %${w.percent}` }]);
      for (const [lang, sp] of [['en', spec], ['tr', specTr]]) {
        const layout = assertLayoutOk(sp, lang, `${count} days ${lang}`);
        // No shrink step for it and the calendar is still drawn.
        const before = layoutCard({ ...activitySpec(noWeekend(s), lang), lang });
        assert.deepEqual(layout.drawnCharts, before.drawnCharts);
        assert.ok(layout.shrinkSteps <= before.shrinkSteps);
        // The calendar's cells may get smaller, never below their normal minimum.
        const cell = layout.blocks.find((b) => b.kind === 'calendar').cell;
        assert.ok(cell >= CALENDAR_MIN_CELL, `${count} days ${lang}: cell ${cell} ≥ ${CALENDAR_MIN_CELL}`);
        assert.ok(cell <= before.blocks.find((b) => b.kind === 'calendar').cell);
      }
      assert.match(activitySvg(s, 'en'), /Weekends/);
    }
  });

  test('no row (byte-identical) when it would push the calendar cells below their minimum', () => {
    const s = statsOf(daily(365));
    assert.ok(shownWeekend(s));
    for (const lang of ['en', 'tr']) {
      const spec = activitySpec(s, lang);
      assert.equal(spec.lines, undefined, lang);
      assert.equal(activitySvg(s, lang), activitySvg(noWeekend(s), lang));
      // With the row the cells would have dropped below the minimum.
      const forced = layoutCard({ ...spec, lines: [{ label: 'Weekends', value: '104 commits · 28%' }], lang });
      assert.ok(forced.blocks.find((b) => b.kind === 'calendar').cell < CALENDAR_MIN_CELL, lang);
    }
  });

  test('byte-identical without a weekend commit', () => {
    const s = noOffice(statsOf(daily(7).filter((c) => ![0, 6].includes(new Date(c.date).getUTCDay()))));
    assert.equal(s.weekend.commits, 0);
    assert.equal(activitySpec(s, 'en').lines, undefined);
    for (const lang of ['en', 'tr']) assert.equal(activitySvg(s, lang), activitySvg(noWeekend(s), lang));
  });

  test('byte-identical when the grid is clipped to 53 weeks or leaves out future-dated days', () => {
    const clipped = statsOf(daily(400));
    const future = statsOf([...daily(30), commit('2027-01-02T10:00:00Z')]);
    for (const s of [clipped, future]) {
      assert.ok(s.weekend.commits > 0);
      for (const lang of ['en', 'tr']) {
        assert.equal(activitySpec(s, lang).lines, undefined);
        assert.equal(activitySvg(s, lang), activitySvg(noWeekend(s), lang));
      }
    }
  });

  test('the power-hour card gets no weekend row', () => {
    const spec = buildCardSpecs(statsOf(daily(30)), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'peak-hour').spec;
    assert.ok(!(spec.lines ?? []).some((r) => r.label === 'Weekends'));
  });
});
