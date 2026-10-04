import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES, computePersonality, computeStats } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const IDS = ['night-owl', 'early-bird', 'friday-deployer', 'fixaholic', 'weekend-warrior', 'steady-shipper'];
const TODAY = '2024-07-01';

let seq = 0;
const c = (date, subject = 'update things') => ({
  hash: `h${seq++}`, author: 'A', email: 'a@x.io', date, subject, files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0,
});
const personality = (commits) => computeStats(commits, { today: TODAY }).personality;

function assertWellFormed(p) {
  assert.equal(p.scores.length, IDS.length);
  assert.deepEqual([...p.scores.map((s) => s.id)].sort(), [...IDS].sort());
  for (const s of p.scores) {
    assert.ok(s.score >= 0 && s.score <= 1, `${s.id} score ${s.score} out of range`);
    assert.equal(Math.round(s.score * 100) / 100, s.score);
    assert.equal(s.name, ARCHETYPES.find((a) => a.id === s.id).name);
  }
  for (let i = 1; i < p.scores.length; i++) {
    const [prev, cur] = [p.scores[i - 1], p.scores[i]];
    assert.ok(prev.score >= cur.score, 'scores sorted desc');
    if (prev.score === cur.score) assert.ok(IDS.indexOf(prev.id) < IDS.indexOf(cur.id), 'ties in ARCHETYPES order');
  }
  const a = ARCHETYPES.find((x) => x.id === p.archetype.id);
  assert.equal(p.archetype.name, a.name);
  assert.equal(p.archetype.roast, a.roast);
  assert.equal(typeof p.archetype.reason, 'string');
  assert.ok(p.archetype.reason.length > 0);
}

describe('ARCHETYPES', () => {
  test('six ids in tie-break order', () => {
    assert.deepEqual(ARCHETYPES.map((a) => a.id), IDS);
  });

  test('frozen, entries frozen', () => {
    assert.ok(Object.isFrozen(ARCHETYPES));
    for (const a of ARCHETYPES) assert.ok(Object.isFrozen(a));
    assert.throws(() => { 'use strict'; ARCHETYPES.push({}); });
  });

  test('every archetype has a name and a non-empty single-line roast', () => {
    for (const a of ARCHETYPES) {
      assert.ok(typeof a.name === 'string' && a.name.length > 0);
      assert.ok(typeof a.roast === 'string' && a.roast.trim().length > 0, a.id);
      assert.ok(!/[\r\n]/.test(a.roast), `${a.id} roast must be one line`);
    }
  });
});

describe('computePersonality: each archetype can win (via computeStats)', () => {
  test('night owl: 23:00 / 01:00 / 02:00', () => {
    const p = personality([
      c('2024-06-11T23:00:00+02:00'), // Tue
      c('2024-06-13T01:00:00+02:00'), // Thu
      c('2024-06-18T02:00:00-05:00'), // Tue
    ]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'night-owl');
    assert.equal(p.scores[0].score, 1);
    assert.match(p.archetype.reason, /100%/);
  });

  test('early bird: 06:00', () => {
    const p = personality([c('2024-06-11T06:00:00Z'), c('2024-06-12T06:00:00Z'), c('2024-06-18T06:10:00+09:00')]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'early-bird');
    assert.match(p.archetype.reason, /100%/);
  });

  test('friday deployer: all Fridays', () => {
    const p = personality([c('2024-06-07T14:00:00Z'), c('2024-06-14T15:00:00Z'), c('2024-06-21T16:00:00Z')]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'friday-deployer');
    assert.match(p.archetype.reason, /100%/);
  });

  test('weekend warrior: Saturdays and Sundays', () => {
    const p = personality([
      c('2024-06-15T14:00:00Z'), // Sat
      c('2024-06-16T15:00:00Z'), // Sun
      c('2024-06-22T13:00:00Z'), // Sat
      c('2024-06-23T16:00:00Z'), // Sun
    ]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'weekend-warrior');
    assert.match(p.archetype.reason, /100%/);
  });

  test('fixaholic: every message is a fix, at normal weekday hours', () => {
    const p = personality([
      c('2024-06-10T10:00:00Z', 'fix: login'), // Mon
      c('2024-06-12T13:00:00Z', 'fix: logout'), // Wed
      c('2024-06-18T15:00:00Z', 'fix: crash on save'), // Tue
      c('2024-06-20T17:00:00Z', 'fix: typo'), // Thu
    ]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'fixaholic');
    assert.match(p.archetype.reason, /100%/);
  });

  test('steady shipper: 14 consecutive days at midday', () => {
    const commits = [];
    for (let d = 3; d <= 16; d++) commits.push(c(`2024-06-${String(d).padStart(2, '0')}T12:00:00Z`));
    const p = personality(commits);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'steady-shipper');
    assert.equal(p.scores[0].id, 'steady-shipper');
    assert.equal(p.scores[0].score, 1);
    assert.equal(p.archetype.reason, 'You committed on 14 of 14 days, with a longest streak of 14 days.');
  });
});

describe('computePersonality: calibration (uniform habits are not personalities)', () => {
  const pad = (n) => String(n).padStart(2, '0');
  /** One commit per hour in `hours` on every day from `start` for `nDays`, kept if `keep(weekday)`. */
  function uniform(start, nDays, hours, keep = () => true) {
    const commits = [];
    const t0 = Date.parse(`${start}T00:00:00Z`);
    for (let i = 0; i < nDays; i++) {
      const d = new Date(t0 + i * 86_400_000);
      if (!keep(d.getUTCDay())) continue;
      const day = d.toISOString().slice(0, 10);
      for (const h of hours) commits.push(c(`${day}T${pad(h)}:00:00Z`));
    }
    return commits;
  }
  const score = (p, id) => p.scores.find((s) => s.id === id).score;

  test('uniform Mon–Fri, 3 midday commits a day for 12 weeks → steady-shipper, not friday-deployer', () => {
    // 2024-04-01 is a Monday; 84 days → 60 weekdays, 180 commits, last on Fri 06-21.
    const p = personality(uniform('2024-04-01', 84, [11, 12, 13], (wd) => wd >= 1 && wd <= 5));
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'steady-shipper');
    // Friday share exactly 0.20 = the baseline → 0.
    assert.equal(score(p, 'friday-deployer'), 0);
    assert.equal(score(p, 'weekend-warrior'), 0);
    assert.equal(score(p, 'night-owl'), 0);
    assert.equal(score(p, 'early-bird'), 0);
    // 60 of 82 days, longest streak 5: 0.7 × 60/82 + 0.3 × 5/14 ≈ 0.62.
    assert.equal(score(p, 'steady-shipper'), 0.62);
  });

  test('uniform 7-day week for 12 weeks → not friday-deployer, steady-shipper wins', () => {
    const p = personality(uniform('2024-04-01', 84, [11, 12, 13]));
    assertWellFormed(p);
    assert.notEqual(p.archetype.id, 'friday-deployer');
    assert.equal(p.archetype.id, 'steady-shipper');
    assert.equal(score(p, 'friday-deployer'), 0); // 1/7 < 0.20
    assert.equal(score(p, 'weekend-warrior'), 0.39); // (2/7 − 0.15) / 0.35 ≈ 0.388
    assert.equal(score(p, 'steady-shipper'), 1);
  });

  test('uniform clock (every hour, 4 weeks) → not night-owl', () => {
    const p = personality(uniform('2024-04-01', 28, [...Array(24).keys()]));
    assertWellFormed(p);
    assert.notEqual(p.archetype.id, 'night-owl');
    assert.equal(p.archetype.id, 'steady-shipper');
    assert.equal(score(p, 'night-owl'), 0.38); // (6/24 − 0.10) / 0.40 = 0.375
    assert.equal(score(p, 'early-bird'), 0.22); // (4/24 − 0.08) / 0.40 ≈ 0.217
  });
});

describe('computePersonality: reason, ties, fallback', () => {
  test('reason quotes the real percentage', () => {
    const p = personality([c('2024-06-11T23:00:00Z'), c('2024-06-13T23:30:00Z'), c('2024-06-18T12:00:00Z')]);
    assert.equal(p.archetype.id, 'night-owl');
    // (2/3 − 0.10) / 0.40 ≈ 1.42 → clamped to 1, but the reason quotes the raw share.
    assert.equal(p.scores.find((s) => s.id === 'night-owl').score, 1);
    assert.match(p.archetype.reason, /\b67%/);
  });

  test('fixaholic percentage is of all commits', () => {
    const p = personality([
      c('2024-06-10T10:00:00Z', 'fix: a'),
      c('2024-06-12T10:00:00Z', 'fix: b'),
      c('2024-06-18T10:00:00Z', 'fix: c'),
      c('2024-06-20T10:00:00Z', 'docs: d'),
    ]);
    assert.equal(p.archetype.id, 'fixaholic');
    assert.match(p.archetype.reason, /\b75%/);
  });

  test('ties → ARCHETYPES order (night-owl beats fixaholic)', () => {
    const p = personality([
      c('2024-06-11T23:00:00Z', 'fix: a'),
      c('2024-06-13T23:00:00Z', 'fix: b'),
      c('2024-06-18T23:00:00Z', 'fix: c'),
    ]);
    assertWellFormed(p);
    assert.deepEqual(p.scores.slice(0, 2).map((s) => [s.id, s.score]), [['night-owl', 1], ['fixaholic', 1]]);
    assert.equal(p.archetype.id, 'night-owl');
  });

  test('ties → ARCHETYPES order (fixaholic beats weekend-warrior)', () => {
    const p = personality([
      c('2024-06-15T12:00:00Z', 'fix: a'),
      c('2024-06-16T12:00:00Z', 'fix: b'),
      c('2024-06-22T12:00:00Z', 'fix: c'),
    ]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'fixaholic');
    assert.equal(p.scores[1].id, 'weekend-warrior');
    assert.equal(p.scores[1].score, 1);
  });

  test('fewer than 3 dated commits → steady-shipper fallback', () => {
    const p = personality([c('2024-06-11T23:00:00Z'), c('2024-06-12T23:00:00Z'), c('not a date'), c(null)]);
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'steady-shipper');
    assert.equal(p.archetype.reason, 'Not enough commits yet.');
    assert.equal(p.scores[0].id, 'night-owl'); // scores are still reported
  });

  test('top score below 0.25 → steady-shipper', () => {
    // Night share 1/6: (1/6 − 0.10) / 0.40 ≈ 0.17.
    const p = computePersonality({
      totals: { commits: 6, activeDays: 0 },
      habits: { byHour: [...Array(24)].map((_, h) => (h === 23 ? 1 : h === 12 ? 5 : 0)), byWeekday: [0, 0, 0, 6, 0, 0, 0] },
    });
    assertWellFormed(p);
    assert.equal(p.scores[0].id, 'night-owl');
    assert.equal(p.scores[0].score, 0.17);
    assert.equal(p.archetype.id, 'steady-shipper');
  });

  test('top score of exactly 0.25 is enough', () => {
    // Night share 1/5: (0.20 − 0.10) / 0.40 = 0.25.
    const p = computePersonality({
      totals: { commits: 5, activeDays: 0 },
      habits: { byHour: [...Array(24)].map((_, h) => (h === 23 ? 1 : h === 12 ? 4 : 0)), byWeekday: [0, 0, 0, 5, 0, 0, 0] },
    });
    assert.equal(p.scores[0].score, 0.25);
    assert.equal(p.archetype.id, 'night-owl');
    assert.match(p.archetype.reason, /\b20%/);
  });

  test('empty / null / undefined input → steady-shipper, all scores 0', () => {
    for (const p of [computePersonality(), computePersonality(null), computePersonality({}), personality([]), computeStats(null, { today: TODAY }).personality]) {
      assertWellFormed(p);
      assert.equal(p.archetype.id, 'steady-shipper');
      assert.equal(p.archetype.reason, 'Not enough commits yet.');
      assert.deepEqual(p.scores.map((s) => s.id), IDS);
      assert.ok(p.scores.every((s) => s.score === 0));
    }
  });

  test('malformed parts do not throw', () => {
    const p = computePersonality({ totals: { commits: 'x', firstDay: 'nope' }, habits: { byHour: 'x', byWeekday: null }, messages: { counts: null } });
    assert.equal(p.archetype.id, 'steady-shipper');
  });
});

describe('personality on the fixture repo (integration)', () => {
  let fixture;
  let commits;
  before(async () => {
    fixture = makeFixtureRepo();
    commits = await readCommits(fixture.dir);
  });
  after(() => fixture?.cleanup());

  test('steady-shipper with the expected scores', () => {
    // 8 dated commits, none on a Friday or between 05 and 08.
    // Night: 23:45, 02:15 → 2/8 → (0.25 − 0.10) / 0.40 = 0.375 → 0.38.
    // Weekend: Sat 03-09, Sun 03-10 (-08:00) → 2/8 → (0.25 − 0.15) / 0.35 ≈ 0.29.
    // Fixes 2/8 → (0.25 − 0.15) / 0.45 ≈ 0.22.
    // Active 8 of 10 days (03-04..03-13), longest streak 5 → 0.7×0.8 + 0.3×5/14 ≈ 0.67.
    const { personality: p } = computeStats(commits, { today: '2024-03-14' });
    assertWellFormed(p);
    assert.equal(p.archetype.id, 'steady-shipper');
    assert.equal(p.archetype.reason, 'You committed on 8 of 10 days, with a longest streak of 5 days.');
    assert.deepEqual(p.scores.map((s) => [s.id, s.score]), [
      ['steady-shipper', 0.67],
      ['night-owl', 0.38],
      ['weekend-warrior', 0.29],
      ['fixaholic', 0.22],
      ['early-bird', 0],
      ['friday-deployer', 0],
    ]);
  });
});
