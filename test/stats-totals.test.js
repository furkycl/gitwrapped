import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, localParts } from '../src/stats/index.js';

const f = (path, added, removed, binary = false) => ({ path, added, removed, binary });

let seq = 0;
function commit(date, files = [], email = 'ada@example.com') {
  seq += 1;
  return {
    hash: seq.toString(16).padStart(40, '0'),
    author: 'Ada',
    email,
    date,
    subject: 'x',
    files,
    filesChanged: files.length,
    linesAdded: files.reduce((n, x) => n + x.added, 0),
    linesRemoved: files.reduce((n, x) => n + x.removed, 0),
  };
}

describe('localParts', () => {
  test('uses the offset in the string, not the machine timezone', () => {
    assert.deepEqual(localParts('2024-06-15T23:30:00+02:00'), {
      year: 2024, month: 6, day: 15, hour: 23, minute: 30, weekday: 6,
      dayKey: '2024-06-15', offsetMinutes: 120, ms: Date.parse('2024-06-15T21:30:00Z'),
    });
  });

  test('negative offset keeps the local day even when UTC is the next day', () => {
    const p = localParts('2024-03-10T20:15:00-08:00'); // 04:15Z on 03-11
    assert.equal(p.dayKey, '2024-03-10');
    assert.equal(p.hour, 20);
    assert.equal(p.weekday, 0);
    assert.equal(p.offsetMinutes, -480);
    assert.equal(p.ms, Date.parse('2024-03-11T04:15:00Z'));
  });

  test('Z means +00:00; fractional seconds and +0530 / half-hour offsets parse', () => {
    const z = localParts('2024-01-01T00:00:00Z');
    assert.equal(z.hour, 0);
    assert.equal(z.offsetMinutes, 0);
    assert.equal(z.weekday, 1);
    assert.equal(localParts('2024-01-01T00:00:00.123z').ms, Date.parse('2024-01-01T00:00:00.123Z') - 123);
    const ist = localParts('2024-03-12T16:20:00+05:30');
    assert.equal(ist.offsetMinutes, 330);
    assert.equal(ist.ms, Date.parse('2024-03-12T10:50:00Z'));
    assert.equal(localParts('2024-03-12T16:20:00+0530').offsetMinutes, 330);
  });

  test('invalid input returns null', () => {
    for (const bad of [undefined, null, 42, '', 'nope', '2024-06-15', '2024-06-15T10:00:00',
      '2024-02-30T10:00:00Z', '2024-13-01T10:00:00Z', '2024-06-15T24:00:00Z', '2024-06-15T10:00:00+25:00']) {
      assert.equal(localParts(bad), null, String(bad));
    }
    assert.equal(localParts('2024-02-29T10:00:00Z').day, 29); // leap day is fine
  });
});

describe('computeTotals', () => {
  test('empty input → zeros and nulls', () => {
    const empty = { commits: 0, activeDays: 0, linesAdded: 0, linesRemoved: 0, filesTouched: 0,
      firstCommitDate: null, lastCommitDate: null, firstDay: null, lastDay: null, authors: 0 };
    assert.deepEqual(computeTotals([]), empty);
    assert.deepEqual(computeTotals(), empty);
    assert.deepEqual(computeTotals(null), empty);
  });

  test('sums lines, dedupes paths across commits, counts binaries as files', () => {
    const commits = [
      commit('2024-06-16T09:00:00Z', [f('src/a.js', 1, 1), f('logo.png', 0, 0, true)]),
      commit('2024-06-15T10:00:00Z', [f('src/a.js', 10, 2), f('README.md', 3, 0)]),
      commit('2024-06-15T11:00:00Z', []),
    ];
    const t = computeTotals(commits);
    assert.equal(t.commits, 3);
    assert.equal(t.linesAdded, 14);
    assert.equal(t.linesRemoved, 3);
    assert.equal(t.filesTouched, 3);
    assert.equal(t.activeDays, 2);
  });

  test('active days use the author-local day, not UTC', () => {
    const commits = [
      commit('2024-06-15T23:30:00+02:00'), // 21:30Z on the 15th
      commit('2024-06-15T00:30:00+02:00'), // 22:30Z on the 14th, local day still the 15th
      commit('2024-06-15T20:00:00-08:00'), // 04:00Z on the 16th, local day the 15th
    ];
    assert.equal(computeTotals(commits).activeDays, 1);
    // Same instant, different local days.
    assert.equal(computeTotals([commit('2024-06-15T23:30:00+00:00'), commit('2024-06-16T01:30:00+02:00')]).activeDays, 2);
  });

  test('first/last are the earliest/latest instants, returned as the original strings', () => {
    const commits = [
      commit('2024-06-15T23:30:00+02:00'), // 21:30Z
      commit('2024-06-15T20:00:00-08:00'), // 04:00Z on the 16th → latest
      commit('2024-06-15T01:00:00+05:00'), // 20:00Z on the 14th → earliest
    ];
    const t = computeTotals(commits);
    assert.equal(t.firstCommitDate, '2024-06-15T01:00:00+05:00');
    assert.equal(t.lastCommitDate, '2024-06-15T20:00:00-08:00');
    // Days are the author-local days of those same commits (not the UTC days 06-14 / 06-16).
    assert.equal(t.firstDay, '2024-06-15');
    assert.equal(t.lastDay, '2024-06-15');
  });

  test('firstDay / lastDay are the earliest / latest local days', () => {
    const t = computeTotals([
      commit('2024-07-02T08:00:00+02:00'),
      commit('2024-06-30T23:30:00-07:00'), // 06:30Z on 07-01
      commit('2024-07-04T00:10:00+09:00'), // 15:10Z on 07-03 → latest
    ]);
    assert.equal(t.firstDay, '2024-06-30');
    assert.equal(t.lastDay, '2024-07-04');
    assert.equal(computeTotals([commit('garbage')]).firstDay, null);
  });

  test('filesTouched counts paths as git reports them: rename = two paths, deletes included', () => {
    // With --no-renames, `git mv a.js b.js` is a delete of a.js plus an add of b.js.
    const t = computeTotals([
      commit('2024-06-15T10:00:00Z', [f('a.js', 3, 0), f('gone.txt', 1, 0)]),
      commit('2024-06-16T10:00:00Z', [f('a.js', 0, 3), f('b.js', 3, 0)]), // rename a.js → b.js
      commit('2024-06-17T10:00:00Z', [f('gone.txt', 0, 1)]), // delete
    ]);
    assert.equal(t.filesTouched, 3); // a.js, b.js, gone.txt
  });

  test('authors are distinct lowercased emails', () => {
    const commits = [
      commit('2024-06-15T10:00:00Z', [], 'Ada@Example.com'),
      commit('2024-06-15T11:00:00Z', [], 'ada@example.com'),
      commit('2024-06-15T12:00:00Z', [], 'bob@example.com'),
    ];
    assert.equal(computeTotals(commits).authors, 2);
  });

  test('unparseable dates still count as commits/lines but not as days or first/last', () => {
    const commits = [commit('garbage', [f('a', 2, 1)]), commit('2024-06-15T10:00:00Z', [f('b', 1, 0)])];
    const t = computeTotals(commits);
    assert.equal(t.commits, 2);
    assert.equal(t.linesAdded, 3);
    assert.equal(t.filesTouched, 2);
    assert.equal(t.activeDays, 1);
    assert.equal(t.firstCommitDate, '2024-06-15T10:00:00Z');
    assert.equal(t.lastCommitDate, '2024-06-15T10:00:00Z');
  });

  test('does not mutate its input', () => {
    const commits = [commit('2024-06-15T10:00:00Z', [f('a', 1, 0)])];
    const copy = structuredClone(commits);
    computeTotals(commits);
    assert.deepEqual(commits, copy);
  });
});
