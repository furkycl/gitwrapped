import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeStreaks, epochDay } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const at = (date) => ({ hash: 'h', author: 'A', email: 'a@x.io', date, subject: 's', files: [],
  filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
const days = (...keys) => keys.map((k) => at(`${k}T12:00:00Z`));
const run = (length, start, end) => ({ length, start, end });
const NONE = run(0, null, null);

describe('epochDay', () => {
  test('epoch 0 and neighbours', () => {
    assert.equal(epochDay('1970-01-01'), 0);
    assert.equal(epochDay('1970-01-02'), 1);
    assert.equal(epochDay('1969-12-31'), -1);
  });

  test('matches Date.UTC day counts, including leap days', () => {
    for (const k of ['2000-02-29', '2024-02-29', '2024-03-01', '2023-12-31', '2024-01-01', '1900-03-01', '2100-12-31']) {
      assert.equal(epochDay(k), Date.parse(`${k}T00:00:00Z`) / 86_400_000, k);
    }
    assert.equal(epochDay('2024-03-01') - epochDay('2024-02-28'), 2);
    assert.equal(epochDay('2023-03-01') - epochDay('2023-02-28'), 1);
    assert.equal(epochDay('2024-01-01') - epochDay('2023-12-31'), 1);
  });

  test('invalid input → null', () => {
    for (const bad of ['2023-02-29', '1900-02-29', '2024-02-30', '2024-13-01', '2024-00-10', '2024-04-31',
      '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', ' 2024-01-01', '', 'nope', null, undefined, 20240101, new Date(0)]) {
      assert.equal(epochDay(bad), null, String(bad));
    }
  });
});

describe('computeStreaks', () => {
  const today = '2024-06-30';

  test('empty input → zero-length runs with null days', () => {
    for (const input of [[], undefined, null]) {
      assert.deepEqual(computeStreaks(input, { today }), { longest: NONE, current: NONE });
    }
  });

  test('single active day', () => {
    assert.deepEqual(computeStreaks(days('2024-06-30'), { today }), {
      longest: run(1, '2024-06-30', '2024-06-30'),
      current: run(1, '2024-06-30', '2024-06-30'),
    });
  });

  test('gaps split runs; current is the last run', () => {
    const s = computeStreaks(days('2024-06-01', '2024-06-02', '2024-06-03', '2024-06-05', '2024-06-28', '2024-06-29'), { today });
    assert.deepEqual(s.longest, run(3, '2024-06-01', '2024-06-03'));
    assert.deepEqual(s.current, run(2, '2024-06-28', '2024-06-29'));
  });

  test('several commits on the same day count as one day', () => {
    const s = computeStreaks([
      at('2024-06-29T01:00:00Z'), at('2024-06-29T09:00:00Z'), at('2024-06-29T23:59:00Z'),
      at('2024-06-30T10:00:00Z'), at('2024-06-30T10:00:00Z'),
    ], { today });
    assert.deepEqual(s.longest, run(2, '2024-06-29', '2024-06-30'));
    assert.deepEqual(s.current, run(2, '2024-06-29', '2024-06-30'));
  });

  test('days are author-local, not UTC', () => {
    // 2024-06-10T20:00-08:00 is 06-11 04:00Z; 2024-06-12T01:00+09:00 is 06-11 16:00Z.
    // In UTC both fall on 06-11 (one day); author-locally they are 06-10 and 06-12.
    const s = computeStreaks([at('2024-06-10T20:00:00-08:00'), at('2024-06-12T01:00:00+09:00')], { today: '2024-06-12' });
    assert.deepEqual(s.longest, run(1, '2024-06-10', '2024-06-10'));
    assert.deepEqual(s.current, run(1, '2024-06-12', '2024-06-12'));
    // And two instants on different UTC days chain via their local days.
    const t = computeStreaks([at('2024-06-10T23:30:00-05:00'), at('2024-06-11T23:30:00-05:00')], { today: '2024-06-11' });
    assert.deepEqual(t.longest, run(2, '2024-06-10', '2024-06-11'));
  });

  test('runs cross month and year boundaries', () => {
    const s = computeStreaks(days('2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02'), { today: '2024-01-02' });
    assert.deepEqual(s.longest, run(4, '2023-12-30', '2024-01-02'));
    assert.deepEqual(s.current, s.longest);
    const m = computeStreaks(days('2024-04-30', '2024-05-01'), { today: '2024-05-01' });
    assert.deepEqual(m.longest, run(2, '2024-04-30', '2024-05-01'));
  });

  test('leap-year February chains 28 → 29 → Mar 1; non-leap 28 → Mar 1', () => {
    const leap = computeStreaks(days('2024-02-28', '2024-02-29', '2024-03-01'), { today: '2024-03-01' });
    assert.deepEqual(leap.longest, run(3, '2024-02-28', '2024-03-01'));
    const plain = computeStreaks(days('2023-02-28', '2023-03-01'), { today: '2023-03-01' });
    assert.deepEqual(plain.longest, run(2, '2023-02-28', '2023-03-01'));
    // Missing the leap day breaks the run.
    const gap = computeStreaks(days('2024-02-28', '2024-03-01'), { today: '2024-03-01' });
    assert.deepEqual(gap.longest, run(1, '2024-02-28', '2024-02-28'));
  });

  test('ties go to the earliest run', () => {
    const s = computeStreaks(days('2024-06-20', '2024-06-21', '2024-06-01', '2024-06-02', '2024-06-10', '2024-06-11'), { today });
    assert.deepEqual(s.longest, run(2, '2024-06-01', '2024-06-02'));
    assert.deepEqual(s.current, NONE); // last day 06-21, today 06-30
  });

  test('current is alive on today and the day before', () => {
    const input = days('2024-06-27', '2024-06-28');
    assert.deepEqual(computeStreaks(input, { today: '2024-06-28' }).current, run(2, '2024-06-27', '2024-06-28'));
    assert.deepEqual(computeStreaks(input, { today: '2024-06-29' }).current, run(2, '2024-06-27', '2024-06-28'));
    // across a month boundary
    assert.deepEqual(computeStreaks(days('2024-06-30'), { today: '2024-07-01' }).current, run(1, '2024-06-30', '2024-06-30'));
  });

  test('current is dead two days later or when the last day is after today', () => {
    const input = days('2024-06-27', '2024-06-28');
    assert.deepEqual(computeStreaks(input, { today: '2024-06-30' }).current, NONE);
    assert.deepEqual(computeStreaks(input, { today: '2024-06-27' }).current, NONE);
    assert.deepEqual(computeStreaks(input, { today: '2024-06-01' }).current, NONE);
    // longest is unaffected by today
    assert.deepEqual(computeStreaks(input, { today: '2024-06-01' }).longest, run(2, '2024-06-27', '2024-06-28'));
  });

  test('input order does not matter', () => {
    const keys = ['2024-06-03', '2024-06-29', '2024-06-01', '2024-06-30', '2024-06-02', '2024-06-15'];
    const s = computeStreaks(days(...keys), { today });
    assert.deepEqual(s, computeStreaks(days(...[...keys].sort()), { today }));
    assert.deepEqual(s.longest, run(3, '2024-06-01', '2024-06-03'));
    assert.deepEqual(s.current, run(2, '2024-06-29', '2024-06-30'));
  });

  test('unparseable dates are skipped', () => {
    const s = computeStreaks([at('nope'), at(null), at('2024-02-30T10:00:00Z'), at('2024-06-30T10:00:00'), ...days('2024-06-30')], { today });
    assert.deepEqual(s, { longest: run(1, '2024-06-30', '2024-06-30'), current: run(1, '2024-06-30', '2024-06-30') });
    assert.deepEqual(computeStreaks([at('nope')], { today }), { longest: NONE, current: NONE });
  });

  test('results are fresh objects (no shared frozen state)', () => {
    const a = computeStreaks([], { today });
    a.longest.length = 99;
    assert.deepEqual(computeStreaks([], { today }).longest, NONE);
  });

  test('invalid today throws TypeError', () => {
    for (const bad of ['2023-02-29', '2024-13-01', '24-06-30', '2024-06-30T00:00:00Z', '', null, 20240630, new Date()]) {
      assert.throws(() => computeStreaks(days('2024-06-30'), { today: bad }), TypeError, String(bad));
    }
    assert.throws(() => computeStreaks([], { today: 'nope' }), TypeError);
  });

  test('default today (machine local date) does not throw', () => {
    const s = computeStreaks(days('2024-06-30'));
    assert.deepEqual(s.longest, run(1, '2024-06-30', '2024-06-30'));
    assert.doesNotThrow(() => computeStreaks([]));
    assert.doesNotThrow(() => computeStreaks(undefined, {}));
    // A commit dated "now" in local time is current under the default today.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    assert.equal(computeStreaks(days(key)).current.length, 1);
  });
});

describe('streaks and hot files on the fixture repo (integration)', () => {
  let fixture;
  let commits;
  before(async () => {
    fixture = makeFixtureRepo();
    commits = await readCommits(fixture.dir);
  });
  after(() => fixture?.cleanup());

  test('streaks: 03-04..06 then 03-09..13; current alive on 03-14', () => {
    const { streaks } = computeStats(commits, { today: '2024-03-14' });
    assert.deepEqual(streaks.longest, run(5, '2024-03-09', '2024-03-13'));
    assert.deepEqual(streaks.current, run(5, '2024-03-09', '2024-03-13'));
    assert.deepEqual(computeStreaks(commits, { today: '2024-03-15' }).current, NONE);
  });

  test('hot files exclude the lockfile and keep the binary', () => {
    const { hotFiles } = computeStats(commits, { today: '2024-03-14' });
    assert.deepEqual(hotFiles, [
      { path: 'src/app.js', commits: 4, linesAdded: 8, linesRemoved: 8 },
      { path: 'README.md', commits: 2, linesAdded: 3, linesRemoved: 3 },
      { path: 'logo.png', commits: 2, linesAdded: 0, linesRemoved: 0 },
      { path: 'src/main.js', commits: 1, linesAdded: 7, linesRemoved: 0 },
      { path: 'notes/my notes.txt', commits: 1, linesAdded: 2, linesRemoved: 0 },
    ]);
  });

  test('readCommits output matches the fixture expectations', () => {
    const today = '2024-03-14';
    assert.deepEqual(computeStats(commits, { today }), computeStats(fixture.commits, { today }));
  });
});
