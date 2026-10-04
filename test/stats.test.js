import { test, it, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { localParts, WEEKDAYS, computeTotals, computeTimeHabits, computeStats, activeDayList } from '../src/stats.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const STATS_URL = new URL('../src/stats.js', import.meta.url).href;

const commit = (date, extra = {}) => ({
  hash: 'x',
  author: 'A',
  email: 'a@example.com',
  date,
  subject: 's',
  files: [],
  filesChanged: 0,
  linesAdded: 0,
  linesRemoved: 0,
  ...extra,
});
const file = (path, added = 0, removed = 0, binary = false) => ({ path, added, removed, binary });

describe('WEEKDAYS', () => {
  test('Sunday-first, 7 names', () => {
    assert.deepEqual(WEEKDAYS, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });
});

describe('localParts', () => {
  test('Z suffix', () => {
    assert.deepEqual(localParts('2024-03-04T10:00:00Z'), { day: '2024-03-04', hour: 10, weekday: 1 });
  });

  test('+hh:mm offset keeps wall-clock fields', () => {
    assert.deepEqual(localParts('2024-03-06T23:45:00+01:00'), { day: '2024-03-06', hour: 23, weekday: 3 });
  });

  test('-hh:mm offset keeps wall-clock fields (not converted to UTC)', () => {
    // 2024-03-10T02:15-08:00 is 10:15 UTC, but locally 2am Sunday.
    assert.deepEqual(localParts('2024-03-10T02:15:00-08:00'), { day: '2024-03-10', hour: 2, weekday: 0 });
  });

  test('+hhmm offset without colon', () => {
    assert.deepEqual(localParts('2024-03-12T16:20:00+0530'), { day: '2024-03-12', hour: 16, weekday: 2 });
    assert.deepEqual(localParts('2024-03-12T16:20:00-0330'), { day: '2024-03-12', hour: 16, weekday: 2 });
  });

  test('fractional seconds and missing seconds', () => {
    assert.deepEqual(localParts('2024-03-04T10:00:00.123Z'), { day: '2024-03-04', hour: 10, weekday: 1 });
    assert.deepEqual(localParts('2024-03-04T10:00:00.123456789+02:00'), { day: '2024-03-04', hour: 10, weekday: 1 });
    assert.deepEqual(localParts('2024-03-04T10:00Z'), { day: '2024-03-04', hour: 10, weekday: 1 });
  });

  test('midnight and 23h boundaries', () => {
    assert.deepEqual(localParts('2024-03-04T00:00:00+14:00'), { day: '2024-03-04', hour: 0, weekday: 1 });
    assert.deepEqual(localParts('2024-03-04T23:59:59-12:00'), { day: '2024-03-04', hour: 23, weekday: 1 });
  });

  test('invalid strings return null', () => {
    for (const s of [
      '',
      'not a date',
      '2024-03-04',
      '2024-03-04T10:00:00', // no offset
      '2024-03-04 10:00:00Z', // space instead of T
      '2024-3-4T10:00:00Z',
      '2024-03-04T10:00:00+1',
      '2024-03-04T10:00:00+01:0',
      '2024-03-04T10:00:00z',
      ' 2024-03-04T10:00:00Z',
      '2024-03-04T10:00:00Z ',
      '2024-03-04T10:00:00ZZ',
      'Mon Mar 4 10:00:00 2024 +0100',
    ]) {
      assert.equal(localParts(s), null, s);
    }
  });

  test('out-of-range fields return null', () => {
    for (const s of [
      '2024-00-04T10:00:00Z',
      '2024-13-04T10:00:00Z',
      '2024-03-00T10:00:00Z',
      '2024-03-32T10:00:00Z',
      '2024-03-04T24:00:00Z', // hour 24 invalid
      '2024-03-04T10:60:00Z',
      '2024-03-04T10:00:61Z',
    ]) {
      assert.equal(localParts(s), null, s);
    }
  });

  test('impossible calendar dates rejected; real leap day accepted', () => {
    assert.equal(localParts('2023-02-30T10:00:00Z'), null);
    assert.equal(localParts('2023-02-29T10:00:00Z'), null);
    assert.equal(localParts('2024-04-31T10:00:00Z'), null);
    assert.equal(localParts('1900-02-29T10:00:00Z'), null);
    assert.deepEqual(localParts('2024-02-29T10:00:00Z'), { day: '2024-02-29', hour: 10, weekday: 4 });
    assert.deepEqual(localParts('2000-02-29T10:00:00Z'), { day: '2000-02-29', hour: 10, weekday: 2 });
  });

  test('non-string input returns null', () => {
    for (const v of [undefined, null, 0, 1709546400000, {}, [], new Date('2024-03-04T10:00:00Z'), true]) {
      assert.equal(localParts(v), null);
    }
  });

  test('weekday correctness for known dates', () => {
    const known = [
      ['1970-01-01', 4], // Thursday
      ['2000-01-01', 6], // Saturday
      ['2024-01-01', 1], // Monday
      ['2024-03-10', 0], // Sunday
      ['2024-12-25', 3], // Wednesday
      ['2025-07-04', 5], // Friday
      ['2026-10-04', 0], // Sunday
    ];
    for (const [day, weekday] of known) {
      const p = localParts(`${day}T12:00:00Z`);
      assert.equal(p.weekday, weekday, day);
      assert.equal(p.day, day);
    }
  });

  test('result does not depend on the machine timezone', () => {
    const script = `
      import(${JSON.stringify(STATS_URL)}).then((m) => {
        const dates = ['2024-03-10T02:15:00-08:00', '2024-03-06T23:45:00+01:00', '2024-03-12T00:30:00+05:30', '2024-03-04T10:00:00Z'];
        process.stdout.write(JSON.stringify({ parts: dates.map(m.localParts), habits: m.computeTimeHabits(dates.map((date) => ({ date }))) }));
      });`;
    const outputs = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((TZ) =>
      execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }),
    );
    for (const out of outputs) assert.equal(out, outputs[0]);
    const { parts } = JSON.parse(outputs[0]);
    assert.deepEqual(parts, [
      { day: '2024-03-10', hour: 2, weekday: 0 },
      { day: '2024-03-06', hour: 23, weekday: 3 },
      { day: '2024-03-12', hour: 0, weekday: 2 },
      { day: '2024-03-04', hour: 10, weekday: 1 },
    ]);
  });
});

describe('computeTotals', () => {
  test('empty input', () => {
    assert.deepEqual(computeTotals([]), {
      commits: 0,
      activeDays: 0,
      linesAdded: 0,
      linesRemoved: 0,
      filesTouched: 0,
      firstDay: null,
      lastDay: null,
    });
  });

  test('two commits on the same local day count as one active day', () => {
    const t = computeTotals([commit('2024-03-04T09:00:00+01:00'), commit('2024-03-04T23:59:00+01:00')]);
    assert.equal(t.commits, 2);
    assert.equal(t.activeDays, 1);
    assert.equal(t.firstDay, '2024-03-04');
    assert.equal(t.lastDay, '2024-03-04');
  });

  test('same UTC instant, different local days count separately', () => {
    // Both are 2024-03-05T07:00Z.
    const t = computeTotals([commit('2024-03-04T23:00:00-08:00'), commit('2024-03-05T08:00:00+01:00')]);
    assert.equal(t.activeDays, 2);
    assert.equal(t.firstDay, '2024-03-04');
    assert.equal(t.lastDay, '2024-03-05');
  });

  test('different UTC days, same local day count once', () => {
    const t = computeTotals([commit('2024-03-04T00:30:00+05:00'), commit('2024-03-04T23:30:00-05:00')]);
    assert.equal(t.activeDays, 1);
  });

  test('lines summed; filesTouched counts distinct paths, binaries included', () => {
    const t = computeTotals([
      commit('2024-03-04T10:00:00Z', {
        files: [file('a.js', 3, 1), file('logo.png', 0, 0, true)],
        linesAdded: 3,
        linesRemoved: 1,
      }),
      commit('2024-03-05T10:00:00Z', {
        files: [file('a.js', 2, 2), file('b/c d.txt', 1, 0)],
        linesAdded: 3,
        linesRemoved: 2,
      }),
      commit('2024-03-06T10:00:00Z', { files: [file('logo.png', 0, 0, true)] }),
    ]);
    assert.equal(t.linesAdded, 6);
    assert.equal(t.linesRemoved, 3);
    assert.equal(t.filesTouched, 3);
  });

  test('a commit touching only a binary file still counts it as touched', () => {
    const t = computeTotals([commit('2024-03-04T10:00:00Z', { files: [file('img.png', 0, 0, true)] })]);
    assert.equal(t.filesTouched, 1);
    assert.equal(t.linesAdded, 0);
  });

  test('firstDay/lastDay independent of input order', () => {
    const cs = [
      commit('2024-03-13T12:00:00Z'),
      commit('2023-12-31T23:00:00Z'),
      commit('2024-03-04T10:00:00+01:00'),
      commit('2025-01-01T00:00:00-10:00'),
    ];
    const a = computeTotals(cs);
    const b = computeTotals([...cs].reverse());
    const c = computeTotals([cs[2], cs[0], cs[3], cs[1]]);
    assert.equal(a.firstDay, '2023-12-31');
    assert.equal(a.lastDay, '2025-01-01');
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  });

  test('commits with bad dates still count toward commits, lines and files', () => {
    const t = computeTotals([
      commit('garbage', { linesAdded: 5, linesRemoved: 2, files: [file('x.js', 5, 2)] }),
      commit(undefined, { linesAdded: 1, files: [file('y.js', 1, 0)] }),
      commit('2023-02-30T10:00:00Z', { linesRemoved: 4 }),
      commit('2024-03-04T10:00:00Z', { linesAdded: 1, files: [file('x.js', 1, 0)] }),
    ]);
    assert.equal(t.commits, 4);
    assert.equal(t.linesAdded, 7);
    assert.equal(t.linesRemoved, 6);
    assert.equal(t.filesTouched, 2);
    assert.equal(t.activeDays, 1);
    assert.equal(t.firstDay, '2024-03-04');
    assert.equal(t.lastDay, '2024-03-04');
  });

  test('only undated commits → null first/last day, zero active days', () => {
    const t = computeTotals([commit('nope', { linesAdded: 2 })]);
    assert.equal(t.commits, 1);
    assert.equal(t.activeDays, 0);
    assert.equal(t.firstDay, null);
    assert.equal(t.lastDay, null);
    assert.equal(t.linesAdded, 2);
  });

  test('tolerates missing/odd fields without NaN', () => {
    const t = computeTotals([{ date: '2024-03-04T10:00:00Z' }, { linesAdded: NaN, linesRemoved: 'x', files: null }, null]);
    assert.equal(t.commits, 3);
    assert.equal(t.linesAdded, 0);
    assert.equal(t.linesRemoved, 0);
    assert.equal(t.filesTouched, 0);
    assert.equal(t.activeDays, 1);
  });

  test('TypeError on non-array', () => {
    for (const v of [undefined, null, {}, 'abc', 3]) assert.throws(() => computeTotals(v), TypeError);
  });
});

describe('computeTimeHabits', () => {
  test('no commits → zero histograms, null peaks', () => {
    const h = computeTimeHabits([]);
    assert.deepEqual(h.byHour, new Array(24).fill(0));
    assert.deepEqual(h.byWeekday, new Array(7).fill(0));
    assert.equal(h.peakHour, null);
    assert.equal(h.peakWeekday, null);
    assert.equal(h.peakHourCount, 0);
    assert.equal(h.peakWeekdayCount, 0);
  });

  test('only undated commits → null peaks', () => {
    const h = computeTimeHabits([commit('bad'), commit(null)]);
    assert.equal(h.peakHour, null);
    assert.equal(h.peakWeekday, null);
    assert.equal(h.byHour.reduce((a, b) => a + b, 0), 0);
  });

  test('histogram lengths and sums equal dated commit count', () => {
    const cs = [
      commit('2024-03-04T10:00:00Z'),
      commit('2024-03-04T10:30:00+09:00'),
      commit('2024-03-10T02:15:00-08:00'),
      commit('2024-03-09T23:59:00+01:00'),
      commit('bogus'),
      commit('2024-03-04T24:00:00Z'),
    ];
    const h = computeTimeHabits(cs);
    assert.equal(h.byHour.length, 24);
    assert.equal(h.byWeekday.length, 7);
    assert.equal(h.byHour.reduce((a, b) => a + b, 0), 4);
    assert.equal(h.byWeekday.reduce((a, b) => a + b, 0), 4);
    assert.equal(h.byHour[10], 2);
    assert.equal(h.byHour[2], 1);
    assert.equal(h.byHour[23], 1);
    assert.deepEqual(h.byWeekday, [1, 2, 0, 0, 0, 0, 1]);
    assert.equal(h.peakHour, 10);
    assert.equal(h.peakHourCount, 2);
    assert.equal(h.peakWeekday, 1);
    assert.equal(h.peakWeekdayCount, 2);
  });

  test('peak ties go to the lowest index', () => {
    // Hours 22 and 5 each twice; weekdays Saturday (6) and Tuesday (2) each twice.
    const h = computeTimeHabits([
      commit('2024-03-09T22:00:00Z'), // Sat
      commit('2024-03-09T22:10:00Z'), // Sat
      commit('2024-03-05T05:00:00Z'), // Tue
      commit('2024-03-05T05:10:00Z'), // Tue
    ]);
    assert.equal(h.peakHour, 5);
    assert.equal(h.peakHourCount, 2);
    assert.equal(h.peakWeekday, 2);
    assert.equal(h.peakWeekdayCount, 2);
  });

  test('peak tie including hour 0 / Sunday picks index 0', () => {
    const h = computeTimeHabits([commit('2024-03-10T00:00:00Z'), commit('2024-03-11T23:00:00Z')]);
    assert.equal(h.peakHour, 0);
    assert.equal(h.peakWeekday, 0);
  });

  test('strict max wins over earlier lower counts', () => {
    const h = computeTimeHabits([commit('2024-03-04T01:00:00Z'), commit('2024-03-04T20:00:00Z'), commit('2024-03-05T20:00:00Z')]);
    assert.equal(h.peakHour, 20);
    assert.equal(h.peakHourCount, 2);
  });

  test('TypeError on non-array', () => {
    assert.throws(() => computeTimeHabits(null), TypeError);
    assert.throws(() => computeTimeHabits({ length: 0 }), TypeError);
  });
});

describe('computeStats', () => {
  test('shape: {totals, time}', () => {
    const s = computeStats([commit('2024-03-04T10:00:00Z')]);
    assert.deepEqual(Object.keys(s).sort(), ['time', 'totals']);
    assert.deepEqual(Object.keys(s.totals).sort(), [
      'activeDays',
      'commits',
      'filesTouched',
      'firstDay',
      'lastDay',
      'linesAdded',
      'linesRemoved',
    ]);
    assert.deepEqual(Object.keys(s.time).sort(), [
      'byHour',
      'byWeekday',
      'peakHour',
      'peakHourCount',
      'peakWeekday',
      'peakWeekdayCount',
    ]);
  });

  test('empty input', () => {
    const s = computeStats([]);
    assert.deepEqual(s.totals, computeTotals([]));
    assert.deepEqual(s.time, computeTimeHabits([]));
  });

  test('TypeError on non-array', () => {
    for (const v of [undefined, null, {}, 'x', 1]) assert.throws(() => computeStats(v), TypeError);
  });

  test('does not mutate input', () => {
    const cs = [commit('2024-03-04T10:00:00Z', { files: [file('a', 1, 0)], linesAdded: 1 })];
    const copy = structuredClone(cs);
    computeStats(cs);
    assert.deepEqual(cs, copy);
  });
});

describe('integration: fixture repo → readCommits → computeStats', () => {
  let fixture;
  let commits;

  before(async () => {
    fixture = makeFixtureRepo();
    commits = await readCommits(fixture.dir);
  });

  after(() => {
    fixture?.cleanup();
  });

  test('fixture read back as 8 commits', () => {
    assert.equal(commits.length, 8);
  });

  test('totals', () => {
    // Derived by hand from STEPS in scripts/make-fixture-repo.js:
    // added   3+4+5, 2, 2, 1, 0, 0, 1, 7  = 25
    // removed 0, 0, 0, 1, 3, 0, 1, 7      = 12
    // paths: README.md, package-lock.json, src/app.js, logo.png, notes/my notes.txt, src/main.js
    // days: 03-04, 05, 06, 09, 10, 11, 12, 13 (all distinct local days)
    assert.deepEqual(computeStats(commits).totals, {
      commits: 8,
      activeDays: 8,
      linesAdded: 25,
      linesRemoved: 12,
      filesTouched: 6,
      firstDay: '2024-03-04',
      lastDay: '2024-03-13',
    });
  });

  test('time habits in author local time', () => {
    // Local hours: 10, 14, 23, 11, 2, 9, 16, 12 (one each).
    // Weekdays: Mon 03-04, Tue 03-05, Wed 03-06, Sat 03-09, Sun 03-10, Mon 03-11, Tue 03-12, Wed 03-13.
    const byHour = new Array(24).fill(0);
    for (const h of [10, 14, 23, 11, 2, 9, 16, 12]) byHour[h]++;
    assert.deepEqual(computeStats(commits).time, {
      byHour,
      byWeekday: [1, 2, 2, 2, 0, 0, 1],
      peakHour: 2,
      peakWeekday: 1,
      peakHourCount: 1,
      peakWeekdayCount: 2,
    });
  });

  test('matches stats computed from the fixture expectations, and is order-independent', () => {
    const fromRepo = computeStats(commits);
    assert.deepEqual(computeStats(fixture.commits), fromRepo);
    assert.deepEqual(computeStats([...commits].reverse()), fromRepo);
  });
});

describe('review fixes', () => {
  it('rejects out-of-range offsets', () => {
    assert.equal(localParts('2024-01-01T00:00:00+99:99'), null);
    assert.equal(localParts('2024-01-01T00:00:00+15:00'), null);
    assert.equal(localParts('2024-01-01T00:00:00+05:60'), null);
    assert.equal(localParts('2024-01-01T00:00:00+14:00')?.hour, 0);
  });
  it('accepts years below 100', () => {
    assert.deepEqual(localParts('0000-01-01T00:00:00Z'), { day: '0000-01-01', hour: 0, weekday: 6 });
    assert.equal(localParts('0099-02-29T00:00:00Z'), null);
  });
  it('treats negative line counts as 0', () => {
    const t = computeTotals([{ date: '2024-01-01T00:00:00Z', linesAdded: -5, linesRemoved: -1, files: [] }]);
    assert.equal(t.linesAdded, 0);
    assert.equal(t.linesRemoved, 0);
  });
  it('activeDayList returns sorted distinct local days', () => {
    const c = (date) => ({ date, files: [] });
    assert.deepEqual(
      activeDayList([c('2024-03-02T23:00:00-08:00'), c('2024-03-01T10:00:00Z'), c('2024-03-02T01:00:00Z'), c('bad')]),
      ['2024-03-01', '2024-03-02'],
    );
    assert.deepEqual(activeDayList([]), []);
    assert.throws(() => activeDayList(null), TypeError);
  });
});
