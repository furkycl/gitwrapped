import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeStreaks, longestGap, shownLongestBreak } from '../src/stats/index.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildStatsJson } from '../src/json.js';

const at = (date) => ({ hash: 'h', author: 'A', email: 'a@x.io', date, subject: 's', files: [],
  filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
const days = (...keys) => keys.map((k) => at(`${k}T12:00:00Z`));
const TODAY = '2025-12-31';
const brk = (commits, today = TODAY) => computeStreaks(commits, { today }).longestBreak;
const NO_BREAK = { days: 0, from: null, to: null };

describe('computeStreaks longestBreak', () => {
  test('no commits, one day, or one day many times → no break', () => {
    assert.deepEqual(brk([]), NO_BREAK);
    assert.deepEqual(brk(undefined), NO_BREAK);
    assert.deepEqual(brk(days('2025-03-01')), NO_BREAK);
    assert.deepEqual(brk(days('2025-03-01', '2025-03-01', '2025-03-01')), NO_BREAK);
  });

  test('only consecutive days → no break', () => {
    assert.deepEqual(brk(days('2025-03-01', '2025-03-02', '2025-03-03')), NO_BREAK);
    assert.deepEqual(brk(days('2024-12-31', '2025-01-01')), NO_BREAK);
  });

  test('days counts the idle days between the two active days', () => {
    // Mar 3 and Mar 6: Mar 4 and Mar 5 were idle.
    assert.deepEqual(brk(days('2025-03-03', '2025-03-06')), { days: 2, from: '2025-03-03', to: '2025-03-06' });
    // One idle day.
    assert.deepEqual(brk(days('2025-03-03', '2025-03-05')), { days: 1, from: '2025-03-03', to: '2025-03-05' });
  });

  test('the longest of several gaps, in any input order', () => {
    const keys = ['2025-01-01', '2025-01-05', '2025-01-06', '2025-02-01', '2025-02-03'];
    const expected = { days: 25, from: '2025-01-06', to: '2025-02-01' };
    assert.deepEqual(brk(days(...keys)), expected);
    assert.deepEqual(brk(days(...[...keys].reverse())), expected);
  });

  test('ties go to the earliest gap', () => {
    assert.deepEqual(brk(days('2025-01-01', '2025-01-04', '2025-01-07')), { days: 2, from: '2025-01-01', to: '2025-01-04' });
    assert.deepEqual(brk(days('2025-01-07', '2025-01-04', '2025-01-01')), { days: 2, from: '2025-01-01', to: '2025-01-04' });
  });

  test('crosses month, year and leap-day boundaries', () => {
    assert.deepEqual(brk(days('2024-02-27', '2024-03-01')), { days: 2, from: '2024-02-27', to: '2024-03-01' });
    assert.deepEqual(brk(days('2023-02-27', '2023-03-01')), { days: 1, from: '2023-02-27', to: '2023-03-01' });
    assert.deepEqual(brk(days('2024-12-30', '2025-01-02')), { days: 2, from: '2024-12-30', to: '2025-01-02' });
  });

  test('commits with an unparseable date are skipped', () => {
    const commits = [...days('2025-05-01'), at('not a date'), at(''), at(null), at(undefined), ...days('2025-05-11')];
    assert.deepEqual(brk(commits), { days: 9, from: '2025-05-01', to: '2025-05-11' });
    assert.deepEqual(brk([at('garbage'), ...days('2025-05-01')]), NO_BREAK);
  });

  test('days are author-local, not UTC', () => {
    // 23:30 at -05:00 on Mar 1 is Mar 2 in UTC; 00:30 at +09:00 on Mar 5 is Mar 4 in UTC.
    const commits = [at('2025-03-01T23:30:00-05:00'), at('2025-03-05T00:30:00+09:00')];
    assert.deepEqual(brk(commits), { days: 3, from: '2025-03-01', to: '2025-03-05' });
    // The same instants in UTC would be Mar 2 and Mar 4 (a one-day break).
    const utc = commits.map((c) => at(new Date(c.date).toISOString()));
    assert.deepEqual(brk(utc), { days: 1, from: '2025-03-02', to: '2025-03-04' });
  });

  test('two commits in different timezones on the same local day → no break', () => {
    assert.deepEqual(brk([at('2025-03-01T01:00:00+14:00'), at('2025-03-01T23:00:00-12:00')]), NO_BREAK);
  });

  test('is independent of today / todayComplete and includes future-dated days (raw value)', () => {
    const commits = days('2025-03-01', '2025-03-10', '2099-01-01');
    const a = computeStreaks(commits, { today: '2025-03-10' }).longestBreak;
    const b = computeStreaks(commits, { today: '2030-01-01', todayComplete: true }).longestBreak;
    assert.deepEqual(a, b);
    assert.equal(a.from, '2025-03-10');
    assert.equal(a.to, '2099-01-01');
  });

  test('returns a fresh object each call', () => {
    const x = brk([]);
    x.days = 5;
    assert.deepEqual(brk([]), NO_BREAK);
  });
});

describe('longestGap / shownLongestBreak', () => {
  test('longestGap matches computeStreaks over the same days', () => {
    const keys = ['2025-01-01', '2025-01-05', '2025-02-01', '2025-02-02'];
    assert.deepEqual(longestGap(keys.map((day) => ({ day }))), brk(days(...keys)));
    assert.deepEqual(longestGap([]), NO_BREAK);
    assert.deepEqual(longestGap(null), NO_BREAK);
    assert.deepEqual(longestGap([{ day: 'bad' }, { day: '2025-01-01' }]), NO_BREAK);
  });

  test('leaves out future-dated days (after today + 1)', () => {
    const stats = computeStats(days('2025-03-01', '2025-03-05', '2025-03-06', '2099-01-01'), { today: '2025-03-06' });
    assert.equal(stats.streaks.longestBreak.to, '2099-01-01');
    assert.deepEqual(shownLongestBreak(stats, '2025-03-06'), { days: 3, from: '2025-03-01', to: '2025-03-05' });
    // Without today the raw value is shown.
    assert.deepEqual(shownLongestBreak(stats), stats.streaks.longestBreak);
    // Tomorrow (author-timezone grace day) is still kept.
    const s2 = computeStats(days('2025-03-01', '2025-03-07'), { today: '2025-03-06' });
    assert.deepEqual(shownLongestBreak(s2, '2025-03-06'), { days: 5, from: '2025-03-01', to: '2025-03-07' });
  });

  test('missing stats → no break', () => {
    assert.deepEqual(shownLongestBreak(undefined, TODAY), NO_BREAK);
    assert.deepEqual(shownLongestBreak({}, TODAY), NO_BREAK);
  });
});

describe('longest break in stats.json, card and recap', () => {
  const commits = days('2025-03-01', '2025-03-02', '2025-03-10', '2025-03-11', '2025-03-12');
  const stats = computeStats(commits, { today: TODAY });

  test('stats.json has stats.streaks.longestBreak after longest and current', () => {
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'r', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(Object.keys(doc.stats.streaks), ['longest', 'current', 'longestBreak']);
    assert.deepEqual(doc.stats.streaks.longestBreak, { days: 7, from: '2025-03-02', to: '2025-03-10' });
  });

  const streakSpec = (s, lang) => buildCardSpecs(s, { today: TODAY, lang }).find((x) => x.id === 'streak').spec;

  test('the streak card gets a callout panel (en / tr)', () => {
    const en = streakSpec(stats, 'en');
    assert.ok(Array.isArray(en.chart));
    assert.equal(en.chart[0].kind, 'hbars');
    assert.deepEqual(en.chart[1], { kind: 'callout', title: 'Longest break', value: '7 days off', note: 'Between Mar 2, 2025 and Mar 10, 2025' });
    const tr = streakSpec(stats, 'tr');
    assert.deepEqual(tr.chart[1], { kind: 'callout', title: 'En uzun mola', value: '7 gün', note: '2 Mar 2025 ile 10 Mar 2025 arası' });
  });

  test('without a break the streak card has a single chart, as before', () => {
    const s = computeStats(days('2025-03-01', '2025-03-02'), { today: TODAY });
    const spec = streakSpec(s, 'en');
    assert.equal(Array.isArray(spec.chart), false);
    assert.equal(spec.chart.kind, 'hbars');
  });

  test('recap gets a Break line only when there is a break', () => {
    const en = formatSummary(stats, { today: TODAY, paths: { html: 'x' } });
    assert.match(en, /\n {2}Break {8}longest 7 days \(Mar 2, 2025 – Mar 10, 2025\)\n/);
    const tr = formatSummary(stats, { today: TODAY, lang: 'tr', paths: { html: 'x' } });
    assert.match(tr, /\n {2}Mola {13}en uzun 7 gün \(2 Mar 2025 – 10 Mar 2025\)\n/);
    const none = formatSummary(computeStats(days('2025-03-01'), { today: TODAY }), { today: TODAY, paths: { html: 'x' } });
    assert.doesNotMatch(none, /Break/);
  });
});
