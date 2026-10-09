// Coding sessions: per author, consecutive commits no more than two hours apart, as
// stats.sessions (computeSessions, src/stats/sessions.js), in the recap, in wrapped.md and
// as a row on the streak card (else the power-hour card), only in spare room.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessions, computeStats, SESSION_GAP_MINUTES, sessionsOf, shownSessions } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, sessionsCard } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
const LANGS = { en, tr };
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
const at = (dates, extra) => dates.map((d) => commit(d, extra));
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const specs = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang));
const specOf = (stats, id, lang = 'en') => specs(stats, lang).find((c) => c.id === id)?.spec;
const svgs = (stats, lang = 'en') => buildCards(stats, cardOpts(lang)).map((c) => [c.id, c.svg]);
const without = (s) => ({ ...s, sessions: null });
const isRow = (r, L = en) => typeof r?.description === 'string' && r.description.includes(L === en ? 'coding session' : 'kodlama oturum');

describe('computeSessions', () => {
  test('null without a dated commit; never throws', () => {
    assert.equal(computeSessions([]), null);
    assert.equal(computeSessions(), null);
    assert.equal(computeSessions(null), null);
    assert.equal(computeSessions('nope'), null);
    assert.equal(computeSessions([null, 5, 'x', {}, { date: 'garbage' }, { date: '2026-02-30T10:00:00Z' }]), null);
  });

  test('a single commit is one 0-minute session on its author-local day', () => {
    assert.deepEqual(computeSessions(at(['2026-03-02T10:00:00+03:00'])), { count: 1, medianMinutes: 0, longest: { minutes: 0, commits: 1, day: '2026-03-02' } });
  });

  test(`a gap of up to ${SESSION_GAP_MINUTES} minutes continues a session, a longer one starts a new one`, () => {
    assert.equal(SESSION_GAP_MINUTES, 120);
    const s = computeSessions(at(['2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z', '2026-03-02T13:00:00Z', '2026-03-02T15:00:01Z']));
    // 10:00-13:00 (the 120-minute gap included) is 180 minutes, 3 commits; 15:00:01 is alone.
    assert.deepEqual(s, { count: 2, medianMinutes: 90, longest: { minutes: 180, commits: 3, day: '2026-03-02' } });
  });

  test('input order does not matter; equal instants share a session', () => {
    const dates = ['2026-03-02T12:30:00Z', '2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z', '2026-03-02T11:15:00Z'];
    const a = computeSessions(at(dates));
    const b = computeSessions(at([...dates].reverse()));
    assert.deepEqual(a, b);
    assert.deepEqual(a, { count: 1, medianMinutes: 150, longest: { minutes: 150, commits: 4, day: '2026-03-02' } });
  });

  test('lengths are whole minutes, rounded down (seconds count)', () => {
    assert.deepEqual(computeSessions(at(['2026-03-02T10:00:00Z', '2026-03-02T10:00:59Z'])).longest, { minutes: 0, commits: 2, day: '2026-03-02' });
    assert.deepEqual(computeSessions(at(['2026-03-02T10:00:30Z', '2026-03-02T10:46:00Z'])).longest, { minutes: 45, commits: 2, day: '2026-03-02' });
  });

  test('per author: two people committing in the same hour never share a session', () => {
    const commits = [
      commit('2026-03-02T10:00:00Z'),
      commit('2026-03-02T10:30:00Z', { author: 'Bob', email: 'bob@example.com' }),
      commit('2026-03-02T11:00:00Z', { author: 'Bob', email: 'bob@example.com' }),
      commit('2026-03-02T13:00:00Z'),
    ];
    // Ada: 10:00 and 13:00 (3 h apart, two sessions); Bob: 10:30-11:00.
    assert.deepEqual(computeSessions(commits), { count: 3, medianMinutes: 0, longest: { minutes: 30, commits: 2, day: '2026-03-02' } });
  });

  test('authors are told apart as contributors are: email case ignored, else the name', () => {
    const commits = [
      commit('2026-03-02T10:00:00Z', { email: 'ADA@example.com', author: 'Ada L.' }),
      commit('2026-03-02T11:00:00Z', { email: ' ada@example.com ' }),
      commit('2026-03-02T10:10:00Z', { email: '', author: 'Nomail  Person' }),
      commit('2026-03-02T10:50:00Z', { email: '', author: 'nomail person' }),
    ];
    assert.deepEqual(computeSessions(commits), { count: 2, medianMinutes: 50, longest: { minutes: 60, commits: 2, day: '2026-03-02' } });
  });

  test('instants, not wall clocks: different UTC offsets an hour apart are one session', () => {
    const s = computeSessions(at(['2026-03-02T10:00:00+03:00', '2026-03-02T08:00:00+00:00']));
    assert.deepEqual(s.longest, { minutes: 60, commits: 2, day: '2026-03-02' });
  });

  test('the day is the author-local day of the session\'s first commit', () => {
    const s = computeSessions(at(['2026-03-01T23:30:00-05:00', '2026-03-02T01:00:00-05:00']));
    assert.deepEqual(s.longest, { minutes: 90, commits: 2, day: '2026-03-01' });
  });

  test('longest: most minutes, then most commits, then the earliest', () => {
    const tie = computeSessions(at([
      '2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z', // 60 min, 2 commits
      '2026-03-04T10:00:00Z', '2026-03-04T10:30:00Z', '2026-03-04T11:00:00Z', // 60 min, 3 commits
      '2026-03-06T10:00:00Z', '2026-03-06T10:20:00Z', '2026-03-06T11:00:00Z', // 60 min, 3 commits, later
    ]));
    assert.deepEqual(tie.longest, { minutes: 60, commits: 3, day: '2026-03-04' });
    const longer = computeSessions(at(['2026-03-02T10:00:00Z', '2026-03-02T10:30:00Z', '2026-03-02T10:31:00Z', '2026-03-05T10:00:00Z', '2026-03-05T10:40:00Z']));
    assert.deepEqual(longer.longest, { minutes: 40, commits: 2, day: '2026-03-05' });
  });

  test('median: odd count → the middle one, even → the mean of the middle two, rounded', () => {
    // Sessions of 10, 25 → 17.5 → 18.
    assert.equal(computeSessions(at(['2026-03-02T10:00:00Z', '2026-03-02T10:10:00Z', '2026-03-05T10:00:00Z', '2026-03-05T10:25:00Z'])).medianMinutes, 18);
    // 0, 10, 25 → 10.
    assert.equal(computeSessions(at(['2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z', '2026-03-02T10:10:00Z', '2026-03-05T10:00:00Z', '2026-03-05T10:25:00Z'])).medianMinutes, 10);
  });

  test('every dated commit counts: merges too, undated ones are skipped', () => {
    const commits = [
      commit('2026-03-02T10:00:00Z'),
      commit('2026-03-02T10:20:00Z', { parents: ['a', 'b'], subject: 'Merge branch x' }),
      commit('not a date'),
      commit('2026-03-02T10:40:00Z'),
    ];
    assert.deepEqual(computeSessions(commits), { count: 1, medianMinutes: 40, longest: { minutes: 40, commits: 3, day: '2026-03-02' } });
    assert.equal(sessionsOf(commits).length, 1);
  });

  test('with today, a session starting after today + 1 is not the longest unless all are; it still counts', () => {
    const commits = at(['2099-01-01T10:00:00Z', '2099-01-01T14:00:00Z', '2099-01-01T15:00:00Z', '2026-10-01T10:00:00Z', '2026-10-01T10:30:00Z', '2026-10-08T09:00:00Z', '2026-10-08T09:45:00Z']);
    // Today + 1 (2026-10-08) still counts, as for the streaks.
    assert.deepEqual(computeSessions(commits, { today: TODAY }), { count: 4, medianMinutes: 38, longest: { minutes: 45, commits: 2, day: '2026-10-08' } });
    assert.deepEqual(computeSessions(commits).longest, { minutes: 60, commits: 2, day: '2099-01-01' });
    assert.deepEqual(computeSessions(at(['2099-01-01T10:00:00Z', '2099-01-01T11:00:00Z']), { today: TODAY }).longest, { minutes: 60, commits: 2, day: '2099-01-01' });
  });

  test('stats.sessions is computed by computeStats and written to stats.json', () => {
    const s = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:10:00Z']));
    assert.deepEqual(s.sessions, { count: 1, medianMinutes: 70, longest: { minutes: 70, commits: 2, day: '2026-10-01' } });
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.sessions, s.sessions);
    assert.ok(Object.keys(doc.stats).indexOf('sessions') === Object.keys(doc.stats).indexOf('cadence') + 1);
    assert.equal(statsOf([]).sessions, null);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo', version: '0.0.0', asOf: TODAY })).stats.sessions, null);
  });
});

describe('shownSessions', () => {
  test('null when every session is under a minute (nothing to tell), or malformed', () => {
    assert.equal(shownSessions(statsOf(at(['2026-10-01T10:00:00Z', '2026-10-03T10:00:00Z']))), null);
    assert.equal(shownSessions({}), null);
    assert.equal(shownSessions(null), null);
    assert.equal(shownSessions({ sessions: { count: 2, medianMinutes: 5, longest: null } }), null);
    assert.equal(shownSessions({ sessions: { count: 2, medianMinutes: 5, longest: { minutes: 9, commits: 2, day: '2026-02-30' } } }), null);
    assert.equal(shownSessions({ sessions: { count: 0, medianMinutes: 5, longest: { minutes: 9, commits: 2, day: '2026-02-03' } } }), null);
    assert.equal(shownSessions({ sessions: { count: 2, medianMinutes: -1, longest: { minutes: 9, commits: 2, day: '2026-02-03' } } }), null);
    assert.equal(shownSessions({ sessions: { count: 2, medianMinutes: 5, longest: { minutes: 9.5, commits: 2, day: '2026-02-03' } } }), null);
  });

  test('a clean copy otherwise', () => {
    const sessions = { count: 2, medianMinutes: 5, longest: { minutes: 9, commits: 2, day: '2026-02-03', extra: 1 }, more: true };
    assert.deepEqual(shownSessions({ sessions }), { count: 2, medianMinutes: 5, longest: { minutes: 9, commits: 2, day: '2026-02-03' } });
  });
});

describe('strings', () => {
  test('session lengths in en and tr', () => {
    const cases = [[0, '0 min', '0 dk'], [45, '45 min', '45 dk'], [60, '1h', '1 sa'], [190, '3h 10m', '3 sa 10 dk'], [1601, '26h 41m', '26 sa 41 dk'], [60000, '1,000h', '1.000 sa'], [-5, '0 min', '0 dk']];
    for (const [m, e, t] of cases) {
      assert.equal(en.streak.sessionLength(m), e);
      assert.equal(tr.streak.sessionLength(m), t);
    }
  });

  test('recap / wrapped.md value and the row forms', () => {
    assert.equal(en.streak.sessionsValue(42, 35, 190, 14, 'Mar 2, 2026'), '42 sessions · median 35 min · longest 3h 10m (14 commits, Mar 2, 2026)');
    assert.equal(en.streak.sessionsValue(1, 0, 1, 2, 'Mar 2, 2026'), '1 session · 1 min (2 commits, Mar 2, 2026)');
    assert.equal(tr.streak.sessionsValue(42, 35, 190, 14, '2 Mar 2026'), '42 oturum · medyan 35 dk · en uzun 3 sa 10 dk (14 commit, 2 Mar 2026)');
    assert.equal(en.streak.sessionsRowLabel(1234), '1,234 coding sessions');
    assert.equal(en.streak.sessionsRowShort(1), '1 session');
    assert.equal(en.streak.sessionsRowValue(2, 190), 'longest 3h 10m');
    assert.equal(en.streak.sessionsRowValue(1, 1601), '26h 41m');
    assert.equal(tr.streak.sessionsRowLabel(1234), '1.234 kodlama oturumu');
    assert.equal(tr.streak.sessionsRowValue(2, 190), 'en uzun 3 sa 10 dk');
    assert.equal(tr.streak.sessionsRowValue(1, 1601), '26 sa 41 dk');
    assert.equal(en.streak.sessionsValue(1, 1601, 1601, 50, 'Oct 8, 2026'), '1 session · 26h 41m (50 commits, Oct 8, 2026)');
    assert.equal(tr.streak.sessionsValue(1, 1601, 1601, 50, '8 Eki 2026'), '1 oturum · 26 sa 41 dk (50 commit, 8 Eki 2026)');
    assert.equal(en.streak.sessionsDescription(1, 1601, 1601, 50), '1 coding session, 26h 41m (50 commits)');
    assert.equal(tr.streak.sessionsDescription(1, 1601, 1601, 50), '1 kodlama oturumu, 26 sa 41 dk (50 commit)');
    assert.equal(en.streak.sessionsDescription(42, 35, 190, 14), '42 coding sessions, median 35 min, longest 3h 10m (14 commits)');
    assert.equal(tr.streak.sessionsDescription(42, 35, 190, 14), '42 kodlama oturumu, medyan 35 dk, en uzun 3 sa 10 dk (14 commit)');
  });

  test('the short row forms fit a card row in both languages', () => {
    for (const L of [en, tr]) {
      assert.ok(rowFits({ label: L.streak.sessionsRowShort(9999), value: L.streak.sessionsRowValue(2, 99 * 60 + 59) }), L.code);
      assert.ok(rowFits({ label: L.streak.sessionsLabel, value: L.num(1234567) }), L.code);
    }
  });
});

describe('recap and wrapped.md', () => {
  // Three sessions: 10:00-13:10 (3 commits), 15:30 and the next morning alone → median 0, longest 190.
  const s = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-01T13:10:00Z', '2026-10-01T15:30:00Z', '2026-10-02T09:00:00Z']));

  test('the stat', () => {
    assert.deepEqual(s.sessions, { count: 3, medianMinutes: 0, longest: { minutes: 190, commits: 3, day: '2026-10-01' } });
  });

  test('recap line after the cadence, en and tr', () => {
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Cadence[^\n]*\n {2}Sessions {5}3 sessions · median 0 min · longest 3h 10m \(3 commits, Oct 1, 2026\)\n/);
    const outTr = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(outTr, /\n {2}Ritim[^\n]*\n {2}Oturumlar {8}3 oturum · medyan 0 dk · en uzun 3 sa 10 dk \(3 commit, 1 Eki 2026\)\n/);
  });

  test('wrapped.md item in the streaks section, en and tr', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /^- \*\*Cadence:\*\*[^\n]*\n- \*\*Coding sessions:\*\* 3 sessions · median 0 min · longest 3h 10m \(3 commits, Oct 1, 2026\)$/m);
    const mdTr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(mdTr, /^- \*\*Kodlama oturumları:\*\* 3 oturum · medyan 0 dk · en uzun 3 sa 10 dk \(3 commit, 1 Eki 2026\)$/m);
  });

  test('no line when every session is a single commit, without commits or without the stat', () => {
    for (const stats of [statsOf(at(['2026-10-01T10:00:00Z', '2026-10-03T10:00:00Z'])), statsOf([]), without(s)]) {
      for (const lang of ['en', 'tr']) {
        assert.doesNotMatch(formatSummary(stats, { repoName: 'demo', today: TODAY, lang }), /Sessions|Oturumlar/);
        assert.doesNotMatch(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang }), /Coding sessions|Kodlama oturum/);
      }
    }
  });
});

describe('cards', () => {
  // Three days in a row (no break panel): the streak card has room for the row.
  const s = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-01T13:10:00Z', '2026-10-02T09:00:00Z', '2026-10-03T09:00:00Z']));

  test('a row on the streak card when it has room, en and tr', () => {
    for (const [code, L] of Object.entries(LANGS)) {
      assert.equal(sessionsCard(s, { L, today: TODAY }), 'streak', code);
      const lines = specOf(s, 'streak', code).lines;
      const row = lines.at(-1);
      assert.ok(isRow(row, L), code);
      assert.equal(row.value, L.streak.sessionsRowValue(3, 190));
      assert.ok([L.streak.sessionsRowLabel(3), L.streak.sessionsRowShort(3)].includes(row.label), code);
      assert.ok(rowFits(row), code);
      assert.equal(row.description, L.streak.sessionsDescription(3, 0, 190, 3));
      // The rows before it are the card's own, unchanged; no other card gets the row.
      assert.deepEqual(lines.slice(0, -1), specOf(without(s), 'streak', code).lines ?? []);
      for (const { id, spec } of specs(s, code)) if (id !== 'streak') assert.ok(!(spec.lines ?? []).some((r) => isRow(r, L)), `${code} ${id}`);
    }
  });

  test('a single session: its length alone, no "longest" or median (card, recap, wrapped.md)', () => {
    const one = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-01T13:10:00Z']));
    assert.deepEqual(one.sessions, { count: 1, medianMinutes: 190, longest: { minutes: 190, commits: 3, day: '2026-10-01' } });
    for (const [code, L] of Object.entries(LANGS)) {
      assert.equal(sessionsCard(one, { L, today: TODAY }), 'streak', code);
      const row = specOf(one, 'streak', code).lines.at(-1);
      assert.deepEqual([row.label, row.value], [L.streak.sessionsRowLabel(1), L.streak.sessionLength(190)]);
      assert.doesNotMatch(row.value + row.description, /longest|median|en uzun|medyan/);
    }
    assert.match(formatSummary(one, { repoName: 'demo', today: TODAY }), /\n {2}Sessions {5}1 session · 3h 10m \(3 commits, Oct 1, 2026\)\n/);
    assert.match(buildMarkdown(one, { repoName: 'demo', today: TODAY, lang: 'tr' }), /^- \*\*Kodlama oturumları:\*\* 1 oturum · 3 sa 10 dk \(3 commit, 1 Eki 2026\)$/m);
  });

  test('the card description reads the row in words', () => {
    const spec = specOf(s, 'streak');
    assert.match(cardDescription({ ...spec, lang: 'en' }), /3 coding sessions, median 0 min, longest 3h 10m \(3 commits\)\./);
  });

  test('every other card is byte-identical with and without the stat', () => {
    for (const lang of ['en', 'tr']) {
      const a = svgs(s, lang);
      const b = svgs(without(s), lang);
      assert.deepEqual(a.map(([id]) => id), b.map(([id]) => id));
      for (let i = 0; i < a.length; i++) if (a[i][0] !== 'streak') assert.equal(a[i][1], b[i][1], `${lang} ${a[i][0]}`);
    }
  });

  test('all cards byte-identical when no session lasted a minute (or the stat is missing)', () => {
    const single = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-02T09:00:00Z', '2026-10-03T09:00:00Z']));
    assert.equal(sessionsCard(single, { L: en, today: TODAY }), null);
    for (const lang of ['en', 'tr']) assert.deepEqual(svgs(single, lang), svgs(without(single), lang));
  });

  test('the power-hour card when the streak card has no room (after its other rows)', () => {
    // A break panel fills the streak card; a power-hour card without an hour (a stats.json
    // without habits) has room.
    const full = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-01T13:10:00Z', '2026-10-02T09:00:00Z', '2026-10-04T09:00:00Z']));
    assert.equal(sessionsCard(full, { L: en, today: TODAY }), null);
    const x = { ...full, habits: {} };
    assert.equal(sessionsCard(x, { L: en, today: TODAY }), 'peak-hour');
    const lines = specOf(x, 'peak-hour').lines;
    assert.ok(isRow(lines.at(-1)));
    assert.deepEqual(lines.slice(0, -1), specOf(without(x), 'peak-hour').lines);
    assert.ok(!(specOf(x, 'streak').lines ?? []).some((r) => isRow(r)));
    assert.deepEqual(specOf(x, 'streak'), specOf(without(x), 'streak'));
  });

  test('across many histories: on at most one card, appended after unchanged rows, never displacing one', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const p2 = (v) => String(v).padStart(2, '0');
    const histories = [];
    for (let k = 0; k < 24; k++) {
      const dates = [];
      const gapP = rnd();
      let day = 1;
      for (let d = 0, nd = 1 + Math.floor(rnd() * 12); d < nd && day <= 28; d++) {
        let h = Math.floor(rnd() * 20);
        let m = Math.floor(rnd() * 60);
        for (let c = 0, nc = 1 + Math.floor(rnd() * 4); c < nc; c++) {
          dates.push(`2026-09-${p2(day)}T${p2(h)}:${p2(m)}:00${k % 2 ? '+03:00' : 'Z'}`);
          m += 20 + (k % 3) * 30;
          if (m >= 60) [h, m] = [Math.min(23, h + Math.floor(m / 60)), m % 60];
        }
        day += rnd() < gapP ? 2 + Math.floor(rnd() * 3) : 1;
      }
      histories.push(at(dates, k % 3 === 0 ? { author: `A${k}`, email: `a${k}@example.com` } : {}));
    }
    const placedOn = new Set();
    for (const commits of histories) {
      const stats = statsOf(commits);
      for (const [code, L] of Object.entries(LANGS)) {
        const placed = sessionsCard(stats, { L, today: TODAY });
        placedOn.add(placed);
        const a = specs(stats, code);
        const b = specs(without(stats), code);
        for (let i = 0; i < a.length; i++) {
          const la = a[i].spec.lines ?? [];
          const lb = b[i].spec.lines ?? [];
          if (a[i].id === placed) {
            assert.equal(la.length, lb.length + 1, `${code} ${a[i].id}`);
            assert.deepEqual(la.slice(0, -1), lb);
            assert.ok(isRow(la.at(-1), L));
            assert.ok(la.length <= 6);
          } else {
            assert.deepEqual(a[i].spec, b[i].spec, `${code} ${a[i].id}`);
          }
        }
      }
    }
    // Both outcomes occur: a row on the streak card, and no room anywhere.
    assert.ok(placedOn.has('streak') && placedOn.has(null), [...placedOn].join());
  });
});
