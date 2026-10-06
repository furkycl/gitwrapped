// Edge-case / regression tests for src/stats: offsets, calendar boundaries, bad input, scale.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeTimeHabits, computeTotals, localParts } from '../src/stats/index.js';

const at = (date, extra = {}) => ({ hash: 'h', author: 'A', email: 'a@x.io', date, subject: 's', files: [],
  filesChanged: 0, linesAdded: 0, linesRemoved: 0, ...extra });

describe('localParts: offsets and calendar boundaries', () => {
  test('unusual offsets (+05:45, -03:30, +14:00, -12:00) keep the local wall clock', () => {
    const cases = [
      ['2024-01-01T03:00:00+05:45', '2024-01-01', 3, 345, 1, '2023-12-31T21:15:00Z'],
      ['2024-12-31T22:00:00-03:30', '2024-12-31', 22, -210, 2, '2025-01-01T01:30:00Z'],
      ['2025-01-01T00:30:00+14:00', '2025-01-01', 0, 840, 3, '2024-12-31T10:30:00Z'],
      ['2024-12-31T23:59:59-12:00', '2024-12-31', 23, -720, 2, '2025-01-01T11:59:59Z'],
    ];
    for (const [iso, dayKey, hour, off, weekday, utc] of cases) {
      const p = localParts(iso);
      assert.equal(p.dayKey, dayKey, iso);
      assert.equal(p.hour, hour, iso);
      assert.equal(p.offsetMinutes, off, iso);
      assert.equal(p.weekday, weekday, iso);
      assert.equal(p.ms, Date.parse(utc), iso);
    }
  });

  test('+14:00 and -12:00 at the same instant land on different local days and years', () => {
    // Both are 2024-12-31T11:00Z.
    const east = '2025-01-01T01:00:00+14:00';
    const west = '2024-12-30T23:00:00-12:00';
    assert.equal(localParts(east).ms, localParts(west).ms);
    const t = computeTotals([at(east), at(west)]);
    assert.equal(t.activeDays, 2);
    const h = computeTimeHabits([at(east), at(west)]);
    assert.equal(h.byHour[1], 1);
    assert.equal(h.byHour[23], 1);
    assert.equal(h.byWeekday[3], 1); // Wed 2025-01-01
    assert.equal(h.byWeekday[1], 1); // Mon 2024-12-30
  });

  test('month boundary: local day differs from UTC day in both directions', () => {
    assert.equal(localParts('2024-03-31T23:30:00-05:00').dayKey, '2024-03-31'); // UTC is 04-01
    assert.equal(localParts('2024-04-01T00:30:00+05:00').dayKey, '2024-04-01'); // UTC is 03-31
  });

  test('leap day: valid in leap years only, correct weekday, crosses into March in UTC', () => {
    const p = localParts('2024-02-29T22:00:00-05:00'); // 03:00Z on 03-01
    assert.equal(p.dayKey, '2024-02-29');
    assert.equal(p.weekday, 4); // Thursday
    assert.equal(p.ms, Date.parse('2024-03-01T03:00:00Z'));
    assert.equal(localParts('2000-02-29T12:00:00Z').weekday, 2); // 2000 is a leap year (÷400)
    assert.equal(localParts('2023-02-29T12:00:00Z'), null);
    assert.equal(localParts('1900-02-29T12:00:00Z'), null); // 1900 is not (÷100)
    assert.equal(localParts('2024-04-31T12:00:00Z'), null);
    assert.equal(localParts('2024-02-00T12:00:00Z'), null);
  });

  test('weekday matches a known calendar', () => {
    const known = [
      ['2024-03-04', 1], // Monday
      ['2024-03-10', 0], // Sunday
      ['1970-01-01', 4], // Thursday
      ['1969-12-31', 3], // Wednesday (pre-epoch)
      ['2000-01-01', 6], // Saturday
      ['2038-01-19', 2], // Tuesday
      ['2026-10-04', 0], // Sunday
    ];
    for (const [d, wd] of known) assert.equal(localParts(`${d}T12:00:00Z`).weekday, wd, d);
  });

  test('DST is irrelevant: only the offset in the string matters', () => {
    // US spring-forward night 2024-03-10: -08:00 before, -07:00 after; both are the 10th, a Sunday.
    const before = localParts('2024-03-10T01:59:00-08:00');
    const after = localParts('2024-03-10T03:00:00-07:00');
    assert.equal(after.ms - before.ms, 60_000);
    assert.equal(before.hour, 1);
    assert.equal(after.hour, 3);
    assert.equal(before.weekday, 0);
    // An "impossible" local time under DST rules is still taken at face value.
    assert.equal(localParts('2024-03-10T02:30:00-08:00').hour, 2);
  });

  test('Z, z, +00:00, -00:00 and +0000 are the same instant and wall clock', () => {
    const forms = ['2024-06-15T10:00:00Z', '2024-06-15T10:00:00z', '2024-06-15T10:00:00+00:00',
      '2024-06-15T10:00:00-00:00', '2024-06-15T10:00:00+0000'];
    const parts = forms.map(localParts);
    for (const p of parts) assert.deepEqual(p, parts[0]);
    assert.equal(computeTotals(forms.map((d) => at(d))).activeDays, 1);
  });

  test('fractional seconds of any precision parse; ms is truncated to the second', () => {
    for (const s of ['2024-06-15T10:00:00.5Z', '2024-06-15T10:00:00.999999999+02:00']) {
      const p = localParts(s);
      assert.ok(p, s);
      assert.equal(p.ms % 1000, 0);
    }
  });

  test('years 0-99 are not remapped to 19xx (Date.UTC quirk)', () => {
    const p = localParts('0050-03-01T00:00:00Z');
    assert.ok(p);
    assert.equal(p.year, 50);
    assert.equal(p.dayKey, '0050-03-01');
    const ref = new Date(0);
    ref.setUTCFullYear(50, 2, 1);
    assert.equal(p.ms, ref.getTime());
    assert.equal(p.weekday, ref.getUTCDay());
  });

  test('ms and weekday agree with Date for a broad sweep of dates and offsets', () => {
    const offsets = ['Z', '+05:45', '-03:30', '+14:00', '-12:00', '+01:00', '-09:30'];
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const ms = Date.UTC(1971, 0, 1) + rnd(2_000_000) * 1_000_000; // ~1971..2033
      const iso = new Date(ms).toISOString().slice(0, 19) + offsets[i % offsets.length];
      const p = localParts(iso);
      assert.equal(p.ms, Date.parse(iso), iso);
      assert.equal(p.weekday, new Date(Date.parse(iso.slice(0, 19) + 'Z')).getUTCDay(), iso);
    }
  });
});

describe('robustness of totals and habits', () => {
  test('same email in different case counts once; empty/missing emails are ignored', () => {
    const commits = [at('2024-06-15T10:00:00Z', { email: 'ADA@EXAMPLE.COM' }),
      at('2024-06-15T10:00:00Z', { email: 'ada@example.com' }),
      at('2024-06-15T10:00:00Z', { email: 'Ada@Example.Com' }),
      at('2024-06-15T10:00:00Z', { email: '' }),
      at('2024-06-15T10:00:00Z', { email: undefined })];
    assert.equal(computeTotals(commits).authors, 1);
  });

  test('commits without files / counts (constructed objects) do not throw', () => {
    const t = computeTotals([{ date: '2024-06-15T10:00:00Z' }, { email: 'a@x' }, {}]);
    assert.equal(t.commits, 3);
    assert.equal(t.linesAdded, 0);
    assert.equal(t.linesRemoved, 0);
    assert.equal(t.filesTouched, 0);
    assert.equal(t.activeDays, 1);
    assert.equal(t.authors, 1);
    assert.equal(computeTimeHabits([{}, { date: '2024-06-15T10:00:00Z' }]).peakHour, 10);
  });

  test('NaN, non-number and negative line counts do not poison the sums', () => {
    const t = computeTotals([
      at('2024-06-15T10:00:00Z', { linesAdded: NaN, linesRemoved: '3' }),
      at('2024-06-15T10:00:00Z', { linesAdded: Infinity, linesRemoved: -4 }),
      at('2024-06-15T10:00:00Z', { linesAdded: 5, linesRemoved: 2 }),
    ]);
    assert.equal(t.linesAdded, 5);
    assert.equal(t.linesRemoved, 2);
    assert.equal(typeof t.linesRemoved, 'number');
  });

  test('file entries without a string path are not counted as files', () => {
    const t = computeTotals([at('2024-06-15T10:00:00Z', { files: [{ path: 'a' }, {}, null, { path: 'a' }] })]);
    assert.equal(t.filesTouched, 1);
  });

  test('neither function mutates its input', () => {
    const commits = [at('2024-06-15T23:30:00+02:00', { files: [{ path: 'a', added: 1, removed: 0, binary: false }],
      linesAdded: 1 }), at('garbage'), at('2024-01-01T00:00:00-12:00', { email: 'B@X.io' })];
    const copy = structuredClone(commits);
    computeStats(commits);
    assert.deepEqual(commits, copy);
    const frozen = Object.freeze(commits.map((c) => Object.freeze({ ...c, files: Object.freeze([...c.files]) })));
    assert.doesNotThrow(() => computeStats(frozen));
  });

  test('100k commits are processed quickly', () => {
    const base = Date.UTC(2020, 0, 1);
    const commits = Array.from({ length: 100_000 }, (_, i) => at(
      new Date(base + i * 3_600_000).toISOString().slice(0, 19) + '+03:00',
      { email: `u${i % 50}@x.io`, files: [{ path: `f${i % 1000}`, added: 1, removed: 1, binary: false }],
        linesAdded: 1, linesRemoved: 1 },
    ));
    const start = performance.now();
    const s = computeStats(commits);
    const elapsed = performance.now() - start;
    assert.equal(s.totals.commits, 100_000);
    assert.equal(s.totals.linesAdded, 100_000);
    assert.equal(s.totals.filesTouched, 1000);
    assert.equal(s.totals.authors, 50);
    assert.equal(s.totals.activeDays, Math.ceil(100_000 / 24));
    assert.equal(s.habits.byHour.reduce((a, b) => a + b, 0), 100_000);
    // A guard against accidental quadratic work, not a benchmark: ~1s on a dev machine,
    // but the Windows/Node 20 CI runner reached 2.1s once a dozen stats modules each made
    // their own pass. An O(n²) regression at 100k commits would take minutes.
    assert.ok(elapsed < 5000, `took ${elapsed.toFixed(0)}ms`);
  });
});
