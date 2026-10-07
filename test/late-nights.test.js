// Late nights: commits between 00:00 and 04:59 author-local and the latest-ever commit time
// (the day ending at 05:00), as stats.lateNights (computeLateNights, src/stats/latenights.js),
// in the recap, in wrapped.md and as rows on the power-hour card when there is room. The
// counts come from the same habits.byHour as the Night Owl personality, so they never
// disagree with it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { computeLateNights, computeStats, computeTimeHabits, LATE_NIGHT_HOURS, lateNightCounts, shownLateNights } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
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
const peakSpec = (stats, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'peak-hour').spec;
const peakSvg = (stats, lang) => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'peak-hour').svg;
const NONE = { commits: 0, share: 0, latest: null };

describe('computeLateNights', () => {
  test('empty or invalid input → zeros and a null latest, never throws', () => {
    assert.deepEqual(computeLateNights(), NONE);
    assert.deepEqual(computeLateNights(null), NONE);
    assert.deepEqual(computeLateNights('x'), NONE);
    assert.deepEqual(computeLateNights([null, 7, 'a', {}, { date: 'not a date' }, { date: '2024-02-30T01:00:00Z' }, { date: '2024-03-01T01:00:00' }]), NONE);
    assert.deepEqual(statsOf([]).lateNights, NONE);
    assert.deepEqual(computeStats().lateNights, NONE);
    assert.equal(shownLateNights(statsOf([])), null);
    assert.equal(shownLateNights(undefined), null);
  });

  test('00:00-04:59 in the author\'s own local time, whatever the UTC hour', () => {
    const s = statsOf([
      commit('2026-03-07T23:30:00-05:00'), // 23:30 local (04:30 UTC) → not late
      commit('2026-03-08T01:00:00+03:00'), // 01:00 local (22:00 UTC) → late
      commit('2026-03-08T04:59:00+00:00'), // 04:59 → late
      commit('2026-03-08T05:00:00+00:00'), // 05:00 → not late
      commit('2026-03-09T00:00:00+00:00'), // midnight → late
    ]);
    assert.deepEqual(s.lateNights, { commits: 3, share: 0.6, latest: { date: '2026-03-08', time: '04:59' } });
    assert.deepEqual(LATE_NIGHT_HOURS, [0, 1, 2, 3, 4]);
  });

  test('latest wraps at midnight: 00:30 is later than 23:59, 04:59 the latest, 05:00 the earliest', () => {
    assert.deepEqual(computeLateNights([commit('2026-01-01T23:59:00Z'), commit('2026-01-05T00:30:00Z')]).latest, { date: '2026-01-05', time: '00:30' });
    assert.deepEqual(computeLateNights([commit('2026-01-05T00:30:00Z'), commit('2026-01-01T23:59:00Z')]).latest, { date: '2026-01-05', time: '00:30' });
    assert.deepEqual(computeLateNights([commit('2026-01-01T04:59:59Z'), commit('2026-01-01T05:00:00Z'), commit('2026-01-02T03:00:00Z')]).latest, { date: '2026-01-01', time: '04:59' });
    // Without a late-night commit, the latest evening (or daytime) commit; 05:00 only alone.
    assert.deepEqual(computeLateNights([commit('2026-01-01T05:00:00Z'), commit('2026-01-02T18:15:00Z'), commit('2026-01-03T09:00:00Z')]).latest, { date: '2026-01-02', time: '18:15' });
    assert.deepEqual(computeLateNights([commit('2026-01-01T05:00:00Z')]), { commits: 0, share: 0, latest: { date: '2026-01-01', time: '05:00' } });
  });

  test('latest is the commit\'s own author-local day and minute', () => {
    // 02:10 local on the 8th is 23:10 UTC on the 7th: the local day is kept.
    assert.deepEqual(computeLateNights([commit('2026-03-08T02:10:00+03:00')]).latest, { date: '2026-03-08', time: '02:10' });
    assert.deepEqual(computeLateNights([commit('2026-03-07T21:40:00-05:00')]).latest, { date: '2026-03-07', time: '21:40' });
  });

  test('ties: commits in the same minute → the earliest one, whatever the order or seconds', () => {
    const a = commit('2025-06-01T03:07:00+02:00');
    const b = commit('2024-02-01T03:07:45-07:00'); // earlier instant, same local minute
    const c = commit('2026-01-01T03:07:10Z');
    assert.deepEqual(computeLateNights([a, b, c]).latest, { date: '2024-02-01', time: '03:07' });
    assert.deepEqual(computeLateNights([c, a, b]).latest, { date: '2024-02-01', time: '03:07' });
  });

  test('counts every dated commit like the power hour: merges and future-dated included', () => {
    const s = statsOf([
      commit('2026-03-07T01:00:00Z', { parents: ['a', 'b'] }), // a merge
      commit('2099-01-02T02:00:00Z'), // future-dated
      commit('2026-03-09T10:00:00Z'),
      commit('not a date'),
    ]);
    // The 2099 commit counts, but is never the latest-ever time (see the next test).
    assert.deepEqual(s.lateNights, { commits: 2, share: 0.667, latest: { date: '2026-03-07', time: '01:00' } });
    assert.equal(s.lateNights.commits, LATE_NIGHT_HOURS.reduce((sum, h) => sum + s.habits.byHour[h], 0));
  });

  test('latest leaves out commits dated after the day after today, unless every commit is', () => {
    const cs = [commit('2026-10-01T18:00:00Z'), commit('2026-10-08T03:00:00Z'), commit('2026-10-09T04:30:00Z')];
    // Today 2026-10-07: the 8th is the grace day (kept), the 9th is in the future.
    assert.deepEqual(computeLateNights(cs, { today: '2026-10-07' }).latest, { date: '2026-10-08', time: '03:00' });
    assert.deepEqual(computeLateNights(cs).latest, { date: '2026-10-09', time: '04:30' });
    assert.deepEqual(computeLateNights(cs, { today: 'bad' }).latest, { date: '2026-10-09', time: '04:30' });
    assert.deepEqual(computeLateNights(cs, { today: '2020-01-01' }).latest, { date: '2026-10-09', time: '04:30' });
    // Only future late nights: the count stays, the recap shows no (non-late) latest time.
    const s = computeStats([commit('2026-10-01T18:00:00Z'), commit('2099-01-01T02:00:00Z')], { today: '2026-10-07' });
    assert.deepEqual(s.lateNights, { commits: 1, share: 0.5, latest: { date: '2026-10-01', time: '18:00' } });
    assert.deepEqual(shownLateNights(s), { commits: 1, percent: 50, latest: null });
    const out = formatSummary(s, { repoName: 'demo', today: '2026-10-07' });
    assert.match(out, /\n {2}Late nights +1 commit \(50% of commits\)\n/);
    assert.doesNotMatch(out, /2099/);
  });

  test('share has 3 decimals, never 1 short of every commit', () => {
    const late = Array.from({ length: 999 }, () => commit('2026-01-01T02:00:00Z'));
    assert.equal(computeLateNights([...late, commit('2026-01-01T12:00:00Z')]).share, 0.999);
    const many = Array.from({ length: 1999 }, () => commit('2026-01-01T02:00:00Z'));
    assert.equal(computeLateNights([...many, commit('2026-01-01T12:00:00Z')]).share, 0.999);
    assert.equal(computeLateNights([commit('2026-01-01T02:00:00Z'), commit('2026-01-01T03:00:00Z')]).share, 1);
    assert.equal(computeLateNights([commit('2026-01-01T02:00:00Z'), commit('2026-01-01T13:00:00Z'), commit('2026-01-01T14:00:00Z')]).share, 0.333);
  });
});

describe('shownLateNights', () => {
  test('counts from habits.byHour (as Night Owl), latest from stats.lateNights', () => {
    const s = statsOf([commit('2026-03-08T02:10:00+03:00'), commit('2026-03-09T12:00:00Z'), commit('2026-03-10T12:00:00Z')]);
    assert.deepEqual(shownLateNights(s), { commits: 1, percent: 33, latest: { date: '2026-03-08', time: '02:10', hour: 2, minute: 10 } });
    assert.deepEqual(lateNightCounts(s.habits), { commits: 1, dated: 3 });
  });

  test('a percent never reads 100 short of every commit, and 0 for a tiny share (shown as "<1%")', () => {
    const habits = (late, other) => ({ byHour: [late, 0, 0, 0, 0, other, ...new Array(18).fill(0)] });
    assert.equal(shownLateNights({ habits: habits(999, 1) }).percent, 99);
    assert.equal(shownLateNights({ habits: habits(1, 999) }).percent, 0);
    assert.equal(shownLateNights({ habits: habits(3, 0) }).percent, 100);
    const s = statsOf([commit('2026-03-08T02:10:00Z'), ...Array.from({ length: 300 }, () => commit('2026-03-09T12:00:00Z'))]);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /\n {2}Late nights +1 commit \(<1% of commits\) · latest 2:10 AM on Mar 8, 2026\n/);
  });

  test('a missing or malformed latest is left out, the count still shows', () => {
    const habits = computeTimeHabits([commit('2026-03-08T02:10:00Z')]);
    assert.equal(shownLateNights({ habits }).latest, null);
    for (const latest of [null, 'x', { date: '2026-03-08' }, { date: '2026-02-30', time: '02:10' }, { date: '2026-03-08', time: '23:10' }, { date: '2026-03-08', time: '05:00' }, { date: '2026-03-08', time: '2:10' }]) {
      const shown = shownLateNights({ habits, lateNights: { commits: 1, share: 1, latest } });
      assert.equal(shown.commits, 1);
      assert.equal(shown.latest, null, JSON.stringify(latest));
    }
    assert.equal(shownLateNights({ habits: { byHour: 'x' } }), null);
  });

  test('never contradicts Night Owl: late nights ≤ Night Owl\'s hours (22-03) plus 4 AM', () => {
    const s = statsOf([
      commit('2026-03-01T22:00:00Z'), commit('2026-03-01T23:30:00Z'), commit('2026-03-02T00:10:00Z'),
      commit('2026-03-02T03:59:00Z'), commit('2026-03-02T04:30:00Z'), commit('2026-03-02T12:00:00Z'),
    ]);
    const owlHours = [22, 23, 0, 1, 2, 3].reduce((sum, h) => sum + s.habits.byHour[h], 0);
    assert.ok(s.lateNights.commits <= owlHours + s.habits.byHour[4]);
    assert.equal(s.personality.archetype.id, 'night-owl');
    // Night Owl quotes 22:00-03:59 (4 of 6 = 67%); late nights are 00:00-04:59 (3 of 6 = 50%).
    assert.match(s.personality.archetype.reason, /^67% /);
    assert.deepEqual(shownLateNights(s), { commits: 3, percent: 50, latest: { date: '2026-03-02', time: '04:30', hour: 4, minute: 30 } });
  });
});

describe('outputs', () => {
  const s = statsOf([
    commit('2024-03-03T04:12:00+03:00'),
    commit('2024-03-04T01:00:00+03:00'),
    ...Array.from({ length: 6 }, (_, i) => commit(`2024-03-0${i + 4}T14:00:00+03:00`)),
  ]);

  test('stats.json: lateNights right after weekend', () => {
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    const keys = Object.keys(doc.stats);
    assert.equal(keys[keys.indexOf('weekend') + 1], 'lateNights');
    assert.deepEqual(doc.stats.lateNights, { commits: 2, share: 0.25, latest: { date: '2024-03-03', time: '04:12' } });
  });

  test('recap and wrapped.md, en and tr', () => {
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /\n {2}Late nights +2 commits \(25% of commits\) · latest 4:12 AM on Mar 3, 2024\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Gece mesaisi +2 commit \(commit'lerin %25 kadarı\) · en geç 3 Mar 2024 04:12\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /\n- \*\*Late-night commits:\*\* 2 commits \(25% of commits\), latest at 4:12 AM on Mar 3, 2024\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n- \*\*Gece yarısından sonraki commit'ler:\*\* 2 commit \(commit'lerin %25 kadarı\), en geç 3 Mar 2024 04:12\n/);
  });

  test('no line without a late-night commit', () => {
    const day = statsOf([commit('2024-03-03T23:59:00Z'), commit('2024-03-04T05:00:00Z')]);
    assert.equal(shownLateNights(day), null);
    assert.doesNotMatch(formatSummary(day, { repoName: 'demo', today: TODAY }), /Late nights/);
    assert.doesNotMatch(buildMarkdown(day, { repoName: 'demo', today: TODAY }), /Late-night/);
    assert.doesNotMatch(formatSummary(day, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Gece mesaisi/);
  });

  test('strings: clock times and labels in en and tr', () => {
    assert.equal(en.clock(4, 12), '4:12 AM');
    assert.equal(en.clock(0, 5), '12:05 AM');
    assert.equal(en.clock(23, 59), '11:59 PM');
    assert.equal(tr.clock(4, 2), '04:02');
    assert.equal(en.recap.latestAt('4:12 AM', 'Mar 3, 2024'), 'latest 4:12 AM on Mar 3, 2024');
    assert.equal(tr.recap.latestAt('04:12', '3 Mar 2024'), 'en geç 3 Mar 2024 04:12');
    assert.equal(tr.markdown.latestAt('04:12', '3 Mar 2024'), 'en geç 3 Mar 2024 04:12');
    assert.equal(tr.peak.latestValue('04:12', '3 Mar 2024'), '04:12 · 3 Mar 2024');
    for (const L of [en, tr]) for (const k of ['lateNights', 'latestLabel']) assert.equal(typeof L.peak[k], 'string');
  });
});

describe('power-hour card', () => {
  /** 27 commits at 12:10 (+03:00) and around the clock, plus `extra`: room for a row in English. */
  const roomy = (extra = []) => {
    const cs = [];
    for (let i = 1; i < 28; i++) cs.push(commit(`2026-03-${String(i).padStart(2, '0')}T${String(i < 8 ? 12 : (12 + i) % 24).padStart(2, '0')}:10:00+03:00`));
    return statsOf([...cs, ...extra]);
  };
  const withoutLate = (stats) => {
    const { lateNights, ...rest } = stats;
    return rest;
  };

  test('byte-identical without a late-night commit', () => {
    const s = statsOf([commit('2026-03-02T10:00:00Z'), commit('2026-03-03T23:59:00Z'), commit('2026-03-04T05:00:00Z')]);
    assert.equal(s.lateNights.commits, 0);
    for (const lang of ['en', 'tr']) assert.equal(peakSvg(s, lang), peakSvg(withoutLate(s), lang));
  });

  test('a "Late nights" row in spare room, with nothing shrinking', () => {
    const s = roomy([commit('2026-03-02T04:12:00+03:00')]);
    assert.ok(s.lateNights.commits > 0);
    const spec = peakSpec(s, 'en');
    assert.ok(Array.isArray(spec.lines));
    const row = spec.lines.find((r) => r.label === 'Late nights');
    assert.ok(row, JSON.stringify(spec.lines));
    const shown = shownLateNights(s);
    assert.equal(row.value, `${shown.commits} commits · ${shown.percent}%`);
    const without = { ...spec, lines: spec.lines.filter((r) => r !== row && r.label !== 'Latest night') };
    const a = layoutCard({ ...spec, lang: 'en' });
    const b = layoutCard({ ...without, lang: 'en' });
    assert.equal(a.shrinkSteps, b.shrinkSteps);
    assert.deepEqual(a.drawnCharts, b.drawnCharts);
    assert.match(peakSvg(s, 'en'), /Late nights/);
  });

  /**
   * A clear power hour (10 commits at `peak`:xx, +03:00, on Mondays), 19 more around the
   * clock and one at 04:12; `tz`: every third of the spread from -05:00 (two time zones).
   */
  const clear = (peak, { tz = false } = {}) => {
    const cs = [];
    for (let i = 0; i < 10; i++) cs.push(commit(`2026-03-${String(2 + 7 * (i % 4)).padStart(2, '0')}T${String(peak).padStart(2, '0')}:${10 + i}:00+03:00`));
    for (let i = 1; i < 20; i++) cs.push(commit(`2026-04-${String(i).padStart(2, '0')}T${String((peak + 3 + i) % 24).padStart(2, '0')}:10:00${tz && i % 3 === 0 ? '-05:00' : '+03:00'}`));
    cs.push(commit('2026-03-02T04:12:00+03:00'));
    return statsOf(cs);
  };
  const steps = (spec, lang) => layoutCard({ ...spec, lang }).shrinkSteps;
  const isLate = (r) => r.label === en.peak.lateNights || r.label === tr.peak.lateNights;
  const isLatest = (r) => r.label === en.peak.latestLabel || r.label === tr.peak.latestLabel;

  test('the row may take one shrink step (the big number one step smaller), as the time-zones row', () => {
    const s = clear(13); // "10 commits landed in the 1 PM hour. Lunch break? …": no spare room
    const spec = peakSpec(s, 'en');
    const row = (spec.lines ?? []).find(isLate);
    assert.ok(row, JSON.stringify(spec.lines));
    const without = { ...spec, lines: spec.lines.filter((r) => !isLate(r) && !isLatest(r)) };
    assert.equal(steps(without, 'en'), 0);
    assert.equal(steps(spec, 'en'), 1);
    assert.deepEqual(layoutCard({ ...spec, lang: 'en' }).drawnCharts, layoutCard({ ...without, lang: 'en' }).drawnCharts);
    assert.match(peakSvg(s, 'en'), /Late nights/);
    assert.ok((peakSpec(s, 'tr').lines ?? []).some(isLate));
  });

  test('never more than one shrink step in all, shared with the time-zones row; "Latest night" in spare room only', () => {
    let shown = 0;
    for (const tz of [false, true]) {
      for (const lang of ['en', 'tr']) {
        for (let peak = 0; peak < 24; peak++) {
          const spec = peakSpec(clear(peak, { tz }), lang);
          const lines = spec.lines ?? [];
          if (!lines.some(isLate)) continue;
          shown += 1;
          assert.ok(steps(spec, lang) <= 1, `${lang} ${peak} tz=${tz}`);
          if (lines.some(isLatest)) assert.equal(steps(spec, lang), steps({ ...spec, lines: lines.filter((r) => !isLatest(r)) }, lang));
          // The time-zones row (when there is one) is still there.
          if (tz) assert.ok(lines.length >= 2);
        }
      }
    }
    assert.ok(shown >= 10, `shown on ${shown} cards`);
  });

  test('a night power hour: the row needs more than one step, so it is left out and nothing else changes', () => {
    // A night hour's quip makes a four-line subtitle: the row would take three shrink steps.
    for (const peak of [22, 23, 0, 1, 2, 3, 4]) {
      const s = clear(peak);
      for (const lang of ['en', 'tr']) {
        const spec = peakSpec(s, lang);
        assert.equal(spec.lines, undefined, `${lang} ${peak}`);
        assert.equal(steps(spec, lang), 0);
        assert.doesNotMatch(peakSvg(s, lang), /Late nights|Gece mesaisi/);
      }
    }
    const s = statsOf([
      commit('2026-03-02T02:00:00Z'), commit('2026-03-03T02:00:00Z'), commit('2026-03-04T02:00:00Z'),
      commit('2026-03-05T10:00:00Z'),
    ]);
    for (const lang of ['en', 'tr']) assert.equal(peakSpec(s, lang).lines, undefined);
  });
});

describe('end to end (real binary, fixture repo)', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const cleanEnv = (extra = {}) => {
    const env = { ...process.env };
    for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
    return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
  };
  let fx;
  let tmp;
  before(() => {
    fx = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gitwrapped-late-'));
  });
  after(() => {
    fx?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });
  const run = (name, args) => {
    const out = join(tmp, name);
    const r = spawnSync(process.execPath, [BIN, fx.dir, '--out', out, '--json', '--md', '--no-color', '--no-png', ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC' }), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.status, 0, r.stderr);
    const json = readFileSync(join(out, 'stats.json'), 'utf8');
    const card = readFileSync(join(out, 'cards', readdirSync(join(out, 'cards')).find((f) => f.endsWith('-peak-hour.svg'))), 'utf8');
    return { r, json, stats: JSON.parse(json).stats, md: readFileSync(join(out, 'wrapped.md'), 'utf8'), card };
  };

  test('stats.json, recap and wrapped.md (en): the 2:15 AM Sunday commit', () => {
    const { r, json, stats, md } = run('en', ['--since', '2024-01-01', '--until', '2024-12-31']);
    // 8 commits; one at 02:15 local (-08:00), the 23:45 one is not late but is earlier.
    assert.deepEqual(stats.lateNights, { commits: 1, share: 0.125, latest: { date: '2024-03-10', time: '02:15' } });
    assert.match(r.stdout, /\n {2}Late nights +1 commit \(13% of commits\) · latest 2:15 AM on Mar 10, 2024\n/);
    assert.match(md, /\n- \*\*Late-night commits:\*\* 1 commit \(13% of commits\), latest at 2:15 AM on Mar 10, 2024\n/);
    assert.doesNotMatch(json, /@example\.com/);
  });

  test('tr', () => {
    const { r, md } = run('tr', ['--since', '2024-01-01', '--until', '2024-12-31', '--lang', 'tr']);
    assert.match(r.stdout, /\n {2}Gece mesaisi +1 commit \(commit'lerin %13 kadarı\) · en geç 10 Mar 2024 02:15\n/);
    assert.match(md, /Gece yarısından sonraki commit'ler:\*\* 1 commit \(commit'lerin %13 kadarı\), en geç 10 Mar 2024 02:15/);
  });

  test('a window without late-night commits: zeros, no lines, an unchanged card', () => {
    const { r, stats, md, card } = run('day', ['--since', '2024-03-11', '--until', '2024-12-31']);
    assert.equal(stats.lateNights.commits, 0);
    assert.equal(stats.lateNights.share, 0);
    assert.match(stats.lateNights.latest.time, /^\d{2}:\d{2}$/);
    assert.doesNotMatch(r.stdout, /Late nights/);
    assert.doesNotMatch(md, /Late-night/);
    assert.doesNotMatch(card, /Late nights|Latest night/);
  });
});
