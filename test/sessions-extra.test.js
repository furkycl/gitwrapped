// Extra edge cases for coding sessions (src/stats/sessions.js): gap boundaries, interleaved
// authors, identities, offsets, unsorted / undated input, median and longest tie-breaks,
// future-dated sessions, en/tr lengths, the recap / wrapped.md / cards in en and tr, a
// brute-force cross-check against a naive reference and the CLI on real git repos.
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeSessions, computeStats, epochDay, localParts, sessionsOf, shownSessions } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, sessionsCard } from '../src/cards/index.js';
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
const at = (dates, extra) => dates.map((d) => commit(d, extra));
const bob = { author: 'Bob', email: 'bob@example.com' };
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const T0 = Date.parse('2026-03-02T10:00:00Z');
const MIN = 60_000;
const BAD = /NaN|Infinity|undefined|\[object Object\]/;

describe('computeSessions: gap boundaries', () => {
  test('exactly 120 minutes apart → one session; 121 → two', () => {
    assert.deepEqual(computeSessions(at([iso(T0), iso(T0 + 120 * MIN)])), { count: 1, medianMinutes: 120, longest: { minutes: 120, commits: 2, day: '2026-03-02' } });
    assert.deepEqual(computeSessions(at([iso(T0), iso(T0 + 121 * MIN)])), { count: 2, medianMinutes: 0, longest: { minutes: 0, commits: 1, day: '2026-03-02' } });
  });

  test('120 min + 1 second is a new session; chains of 120-minute gaps never break', () => {
    assert.equal(computeSessions(at([iso(T0), iso(T0 + 120 * MIN + 1000)])).count, 2);
    const chain = Array.from({ length: 13 }, (_, i) => iso(T0 + i * 120 * MIN)); // 24 hours
    assert.deepEqual(computeSessions(at(chain)), { count: 1, medianMinutes: 1440, longest: { minutes: 1440, commits: 13, day: '2026-03-02' } });
  });

  test('a session spanning midnight and several days keeps its first commit\'s day', () => {
    const chain = Array.from({ length: 40 }, (_, i) => iso(Date.parse('2026-03-02T22:00:00Z') + i * 100 * MIN));
    const s = computeSessions(at(chain));
    assert.deepEqual(s, { count: 1, medianMinutes: 3900, longest: { minutes: 3900, commits: 40, day: '2026-03-02' } });
  });
});

describe('computeSessions: authors and identities', () => {
  test('interleaved authors: one author\'s commits separated by another\'s still join', () => {
    const commits = [
      commit(iso(T0)),
      commit(iso(T0 + 30 * MIN), bob),
      commit(iso(T0 + 60 * MIN)),
      commit(iso(T0 + 90 * MIN), bob),
      commit(iso(T0 + 150 * MIN)),
    ];
    // Ada 10:00-12:30 (3 commits); Bob 10:30-11:30 (2 commits).
    assert.deepEqual(computeSessions(commits), { count: 2, medianMinutes: 105, longest: { minutes: 150, commits: 3, day: '2026-03-02' } });
  });

  test('another author\'s commits never bridge a gap', () => {
    // Ada at 10:00 and 13:00; Bob in between every hour — Ada still has two sessions.
    const commits = [commit(iso(T0)), commit(iso(T0 + 180 * MIN)), ...[60, 120].map((m) => commit(iso(T0 + m * MIN), bob))];
    const s = sessionsOf(commits);
    assert.equal(s.length, 3);
    assert.deepEqual(computeSessions(commits).longest, { minutes: 60, commits: 2, day: '2026-03-02' });
  });

  test('same email in different case, different names → one person', () => {
    const commits = [
      commit(iso(T0), { email: 'Ada@Example.COM', author: 'Ada Lovelace' }),
      commit(iso(T0 + 50 * MIN), { email: 'ada@example.com', author: 'A. L.' }),
    ];
    assert.deepEqual(computeSessions(commits), { count: 1, medianMinutes: 50, longest: { minutes: 50, commits: 2, day: '2026-03-02' } });
  });

  test('same name, different emails → two people (email wins over name)', () => {
    const commits = [commit(iso(T0), { email: 'a@one.io' }), commit(iso(T0 + 10 * MIN), { email: 'a@two.io' })];
    assert.equal(computeSessions(commits).count, 2);
  });

  test('missing author / email fields do not throw and group together', () => {
    const commits = [{ date: iso(T0) }, { date: iso(T0 + 20 * MIN), author: null, email: 42 }];
    assert.deepEqual(computeSessions(commits), { count: 1, medianMinutes: 20, longest: { minutes: 20, commits: 2, day: '2026-03-02' } });
  });
});

describe('computeSessions: dates', () => {
  test('different UTC offsets, close instants → one session; same wall clock, far instants → two', () => {
    const close = at(['2026-03-02T23:50:00+14:00', '2026-03-01T22:00:00-12:00']); // 09:50Z and 10:00Z on 03-02
    const a = localParts(close[0].date).ms;
    const b = localParts(close[1].date).ms;
    assert.equal(Math.abs(a - b), 10 * MIN);
    const s = computeSessions(close);
    assert.equal(s.count, 1);
    assert.equal(s.longest.minutes, 10);
    // The day is the author-local day of the earlier instant.
    assert.equal(s.longest.day, a < b ? '2026-03-02' : '2026-03-01');
    // Same wall clock, offsets 5 hours apart → instants 5 hours apart.
    assert.equal(computeSessions(at(['2026-03-02T10:00:00+05:00', '2026-03-02T10:00:00Z'])).count, 2);
  });

  test('unsorted input in any permutation gives the same result', () => {
    const dates = ['2026-03-02T10:00:00Z', '2026-03-02T11:59:00Z', '2026-03-02T14:00:00Z', '2026-03-02T15:00:00Z', '2026-03-03T09:00:00Z', '2026-03-02T09:30:00Z'];
    const want = computeSessions(at(dates));
    for (let k = 0; k < 30; k++) {
      const shuffled = dates.map((d, i) => [Math.sin(k * 97 + i * 13), d]).sort((x, y) => x[0] - y[0]).map(([, d]) => d);
      const rotated = [...dates.slice(k % dates.length), ...dates.slice(0, k % dates.length)];
      assert.deepEqual(computeSessions(at(shuffled)), want);
      assert.deepEqual(computeSessions(at(rotated)), want);
    }
    // 09:30-11:59 (3), 14:00-15:00 (2), next day alone (1) → 149, 60, 0.
    assert.deepEqual(want, { count: 3, medianMinutes: 60, longest: { minutes: 149, commits: 3, day: '2026-03-02' } });
  });

  test('unparseable dates are skipped and do not break or bridge a session', () => {
    const commits = [
      commit('2026-03-02T10:00:00Z'),
      commit('2026-03-02T11:00:00'), // no offset
      commit('2026-13-02T11:00:00Z'),
      commit('2026-03-02T24:00:00Z'),
      commit(''),
      commit(undefined),
      commit(1772445600000),
      commit('2026-03-02T11:30:00Z'),
    ];
    assert.deepEqual(computeSessions(commits), { count: 1, medianMinutes: 90, longest: { minutes: 90, commits: 2, day: '2026-03-02' } });
    // An undated commit between two 3-hour-apart commits does not join them.
    assert.equal(computeSessions([commit('2026-03-02T10:00:00Z'), commit('bad'), commit('2026-03-02T13:00:00Z')]).count, 2);
  });

  test('empty / all-undated input → null, in computeStats and stats.json too', () => {
    for (const input of [[], [commit('nope')], [commit(null), commit('2026-02-29T10:00:00Z')]]) {
      assert.equal(computeSessions(input), null);
      const s = statsOf(input);
      assert.equal(s.sessions, null);
      assert.equal(shownSessions(s), null);
      const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
      assert.ok('sessions' in doc.stats);
      assert.equal(doc.stats.sessions, null);
    }
  });

  test('sessionsOf does not mutate its input', () => {
    const commits = at(['2026-03-02T12:00:00Z', '2026-03-02T10:00:00Z']);
    const copy = structuredClone(commits);
    sessionsOf(commits);
    computeSessions(commits, { today: TODAY });
    assert.deepEqual(commits, copy);
  });
});

describe('computeSessions: median and longest', () => {
  test('median with an even count: mean of the two middle ones, .5 rounds up', () => {
    // Sessions 0, 1, 4, 100 → (1 + 4) / 2 = 2.5 → 3.
    const s = computeSessions(at([
      '2026-03-01T10:00:00Z',
      '2026-03-02T10:00:00Z', '2026-03-02T10:01:00Z',
      '2026-03-03T10:00:00Z', '2026-03-03T10:04:00Z',
      '2026-03-04T10:00:00Z', '2026-03-04T11:40:00Z',
    ]));
    assert.equal(s.count, 4);
    assert.equal(s.medianMinutes, 3);
    // Two sessions 0 and 1 → 0.5 → 1.
    assert.equal(computeSessions(at(['2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z', '2026-03-02T10:01:00Z'])).medianMinutes, 1);
  });

  test('median is order-independent of authors and counts one-commit sessions as 0', () => {
    const commits = [
      ...at(['2026-03-02T10:00:00Z', '2026-03-02T12:00:00Z']), // Ada 120
      ...at(['2026-03-02T10:00:00Z'], bob), // Bob 0
      ...at(['2026-03-05T10:00:00Z', '2026-03-05T10:30:00Z'], bob), // Bob 30
    ];
    assert.equal(computeSessions(commits).medianMinutes, 30);
    assert.equal(computeSessions([...commits].reverse()).medianMinutes, 30);
  });

  test('longest ties: same minutes and commits → the earliest start, across authors and offsets', () => {
    const commits = [
      ...at(['2026-03-05T10:00:00Z', '2026-03-05T11:00:00Z'], bob),
      // Ada's session starts earlier as an instant though later on the wall clock.
      ...at(['2026-03-05T14:00:00+05:00', '2026-03-05T15:00:00+05:00']),
    ];
    assert.deepEqual(computeSessions(commits).longest, { minutes: 60, commits: 2, day: '2026-03-05' });
    const s = sessionsOf(commits).sort((a, b) => a.start - b.start);
    assert.equal(s[0].start, Date.parse('2026-03-05T09:00:00Z'));
    // Ties by minutes, more commits wins even when later.
    const more = computeSessions([...commits, ...at(['2026-03-09T10:00:00Z', '2026-03-09T10:10:00Z', '2026-03-09T11:00:00Z'])]);
    assert.deepEqual(more.longest, { minutes: 60, commits: 3, day: '2026-03-09' });
  });

  test('longest by minutes rounds down: 60m59s ties 60m00s, then commits decide', () => {
    const s = computeSessions(at([
      '2026-03-02T10:00:00Z', '2026-03-02T11:00:59Z',
      '2026-03-04T10:00:00Z', '2026-03-04T10:30:00Z', '2026-03-04T11:00:00Z',
    ]));
    assert.deepEqual(s.longest, { minutes: 60, commits: 3, day: '2026-03-04' });
  });
});

describe('computeSessions: future-dated commits with today', () => {
  test('a future session is never the longest when a real one exists, but counts', () => {
    const commits = at(['2099-05-01T10:00:00Z', '2099-05-01T12:00:00Z', '2026-10-06T10:00:00Z', '2026-10-06T10:05:00Z']);
    assert.deepEqual(computeSessions(commits, { today: TODAY }), { count: 2, medianMinutes: 63, longest: { minutes: 5, commits: 2, day: '2026-10-06' } });
  });

  test('today + 1 is allowed, today + 2 is not', () => {
    const commits = at(['2026-10-09T10:00:00Z', '2026-10-09T12:00:00Z', '2026-10-08T10:00:00Z', '2026-10-08T10:30:00Z', '2026-10-01T10:00:00Z']);
    assert.deepEqual(computeSessions(commits, { today: TODAY }).longest, { minutes: 30, commits: 2, day: '2026-10-08' });
    assert.deepEqual(computeSessions(commits, { today: '2026-10-08' }).longest, { minutes: 120, commits: 2, day: '2026-10-09' });
  });

  test('a future-day check uses the author-local day of the session\'s first commit', () => {
    // 2026-10-08T23:30-05:00 is 10-09 in UTC but 10-08 author-local: allowed with today 10-07.
    const commits = at(['2026-10-08T23:30:00-05:00', '2026-10-09T00:30:00-05:00', '2026-10-01T10:00:00Z', '2026-10-01T10:10:00Z']);
    assert.deepEqual(computeSessions(commits, { today: TODAY }).longest, { minutes: 60, commits: 2, day: '2026-10-08' });
  });

  test('an invalid today is ignored (no filter)', () => {
    const commits = at(['2099-05-01T10:00:00Z', '2099-05-01T12:00:00Z', '2026-10-06T10:00:00Z', '2026-10-06T10:05:00Z']);
    for (const today of ['garbage', '2026-02-30', '', null, 5]) {
      assert.equal(computeSessions(commits, { today }).longest.day, '2099-05-01', String(today));
    }
  });
});

// A naive reference: per identity, connect every pair of commits at most 120 minutes apart
// (union-find, O(n²)); its components are the sessions (pairs within the gap imply every
// consecutive gap between them is within it, and consecutive gaps connect a chain).
function reference(commits, today) {
  const items = [];
  for (const c of commits) {
    const t = localParts(c?.date);
    if (!t) continue;
    const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
    const name = typeof c.author === 'string' ? c.author.replace(/\s+/g, ' ').trim().toLowerCase() : '';
    items.push({ key: email || `name:${name}`, ms: t.ms, dayKey: t.dayKey });
  }
  if (items.length === 0) return null;
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].key === items[j].key && Math.abs(items[i].ms - items[j].ms) <= 120 * MIN) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  const sessions = [...groups.values()].map((g) => {
    const first = g.reduce((a, b) => (b.ms < a.ms ? b : a));
    const last = Math.max(...g.map((x) => x.ms));
    return { start: first.ms, minutes: Math.floor((last - first.ms) / MIN), commits: g.length, day: first.dayKey };
  });
  const lengths = sessions.map((s) => s.minutes).sort((a, b) => a - b);
  const median = lengths.length % 2 ? lengths[(lengths.length - 1) / 2] : Math.round((lengths[lengths.length / 2 - 1] + lengths[lengths.length / 2]) / 2);
  const cmp = (a, b) => b.minutes - a.minutes || b.commits - a.commits || a.start - b.start;
  const limit = today ? epochDay(today) : null;
  const eligible = sessions.filter((s) => limit === null || epochDay(s.day) <= limit + 1);
  const best = [...(eligible.length ? eligible : sessions)].sort(cmp)[0];
  return { count: sessions.length, medianMinutes: median, longest: { minutes: best.minutes, commits: best.commits, day: best.day } };
}

describe('computeSessions: brute-force cross-check', () => {
  test('matches a naive union-find reference on random histories', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const offsets = ['Z', '+03:00', '-05:00', '+05:30', '-12:00', '+14:00'];
    const people = [
      { author: 'Ada', email: 'ada@example.com' },
      { author: 'Ada L', email: 'ADA@example.com' },
      { author: 'Bob', email: 'bob@example.com' },
      { author: 'Cy  Name', email: '' },
      { author: 'cy name', email: '  ' },
    ];
    const fmt = (ms, off) => {
      const sign = off === 'Z' ? 1 : off[0] === '-' ? -1 : 1;
      const offMin = off === 'Z' ? 0 : sign * (+off.slice(1, 3) * 60 + +off.slice(4, 6));
      return new Date(ms + offMin * MIN).toISOString().slice(0, 19) + off;
    };
    for (let k = 0; k < 300; k++) {
      const count = Math.floor(rnd() * 25);
      const base = Date.parse('2026-09-01T00:00:00Z') + Math.floor(rnd() * 30) * 86400000;
      const commits = [];
      let t = base;
      for (let i = 0; i < count; i++) {
        // Gaps clustered around the 120-minute boundary, plus some long and zero ones.
        const g = pick([0, 1, 59, 119, 120, 121, 30, 90, 240, 1440, 120 * 60 + 1, 119 * 60 + 59]);
        t += rnd() < 0.5 ? g * MIN : g * 1000 * (rnd() < 0.3 ? 60 : 1);
        const date = rnd() < 0.05 ? 'garbage' : fmt(t, pick(offsets));
        commits.push(commit(date, pick(people)));
      }
      // Occasionally future-dated.
      if (rnd() < 0.2) commits.push(commit('2099-01-01T10:00:00Z'), commit('2099-01-01T11:59:00Z'));
      const shuffled = commits.map((c) => [rnd(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
      for (const today of [undefined, TODAY, '2026-09-10']) {
        const got = computeSessions(shuffled, { today });
        assert.deepEqual(got, reference(shuffled, today), `history ${k} today ${today}`);
        if (got) {
          assert.equal(got.count, sessionsOf(shuffled).length);
          assert.equal(sessionsOf(shuffled).reduce((a, s) => a + s.commits, 0), shuffled.filter((c) => localParts(c.date)).length);
        }
      }
    }
  });
});

describe('strings: session lengths', () => {
  test('boundaries in en and tr', () => {
    const cases = [
      [0, '0 min', '0 dk'], [1, '1 min', '1 dk'], [59, '59 min', '59 dk'], [60, '1h', '1 sa'],
      [61, '1h 1m', '1 sa 1 dk'], [119, '1h 59m', '1 sa 59 dk'], [120, '2h', '2 sa'], [1440, '24h', '24 sa'],
      [1441, '24h 1m', '24 sa 1 dk'],
    ];
    for (const [m, e, t] of cases) {
      assert.equal(en.streak.sessionLength(m), e, `en ${m}`);
      assert.equal(tr.streak.sessionLength(m), t, `tr ${m}`);
    }
  });

  test('junk input reads as 0, never NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity, 1.5, '60', null, undefined, {}, -1]) {
      assert.equal(en.streak.sessionLength(bad), '0 min');
      assert.equal(tr.streak.sessionLength(bad), '0 dk');
    }
  });

  test('plurals in en (1 session, 1 commit) and none in tr', () => {
    assert.equal(en.streak.sessionsValue(1, 1, 1, 2, 'Mar 2, 2026'), '1 session · 1 min (2 commits, Mar 2, 2026)');
    assert.equal(en.streak.sessionsRowLabel(1), '1 coding session');
    assert.equal(en.streak.sessionsRowShort(2), '2 sessions');
    assert.equal(tr.streak.sessionsRowShort(2), '2 oturum');
    assert.equal(tr.streak.sessionsValue(1, 61, 61, 2, '2 Mar 2026'), '1 oturum · 1 sa 1 dk (2 commit, 2 Mar 2026)');
  });
});

describe('recap and wrapped.md: extra', () => {
  // Ada 10:00-11:01 (2 commits), Bob 09:00-09:59 (2 commits) on another day: 2 sessions, median 60 (59, 61 → 60).
  const s = statsOf([
    ...at(['2026-09-14T10:00:00Z', '2026-09-14T11:01:00Z']),
    ...at(['2026-09-20T09:00:00+03:00', '2026-09-20T09:59:00+03:00'], bob),
  ]);

  test('the stat', () => {
    assert.deepEqual(s.sessions, { count: 2, medianMinutes: 60, longest: { minutes: 61, commits: 2, day: '2026-09-14' } });
  });

  test('recap and wrapped.md lines in en and tr', () => {
    const want = {
      en: '2 sessions · median 1h · longest 1h 1m (2 commits, Sep 14, 2026)',
      tr: '2 oturum · medyan 1 sa · en uzun 1 sa 1 dk (2 commit, 14 Eyl 2026)',
    };
    for (const lang of ['en', 'tr']) {
      const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang });
      assert.ok(recap.includes(want[lang]), `${lang} recap:\n${recap}`);
      assert.equal(recap.split(want[lang]).length, 2, `${lang}: one recap line`);
      const md = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang });
      const label = lang === 'en' ? 'Coding sessions' : 'Kodlama oturumları';
      assert.ok(md.includes(`- **${label}:** ${want[lang]}`), `${lang} md`);
      assert.doesNotMatch(recap, BAD);
    }
  });

  test('colored recap carries the same text', () => {
    const plain = formatSummary(s, { repoName: 'demo', today: TODAY });
    const colored = formatSummary(s, { repoName: 'demo', today: TODAY, color: true });
    // eslint-disable-next-line no-control-regex
    assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), plain);
  });

  test('a hand-edited stats.json with a bad sessions value shows nothing and never throws', () => {
    const bads = [
      'x', 5, [], { count: 2 }, { count: 2, medianMinutes: 5, longest: { minutes: 10, commits: 1, day: '2026-09-14' } },
      { count: 2, medianMinutes: 5, longest: { minutes: 10, commits: 2, day: 'yesterday' } },
      { count: 2, medianMinutes: 5, longest: { minutes: 0, commits: 2, day: '2026-09-14' } },
      { count: '2', medianMinutes: 5, longest: { minutes: 10, commits: 2, day: '2026-09-14' } },
    ];
    for (const sessions of bads) {
      const x = { ...s, sessions };
      assert.equal(shownSessions(x), null, JSON.stringify(sessions));
      for (const lang of ['en', 'tr']) {
        assert.doesNotMatch(formatSummary(x, { repoName: 'demo', today: TODAY, lang }), /Sessions|Oturumlar/);
        assert.doesNotMatch(buildMarkdown(x, { repoName: 'demo', today: TODAY, lang }), /Coding sessions|Kodlama oturum/);
        const opts = { repoName: 'demo', today: TODAY, lang };
        assert.deepEqual(buildCards(x, opts).map((c) => c.svg), buildCards({ ...s, sessions: null }, opts).map((c) => c.svg));
      }
    }
  });
});

describe('cards: extra', () => {
  test('cards are byte-identical with sessions null vs without the key at all, en and tr', () => {
    const s = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-02T09:00:00Z']));
    const { sessions, ...noKey } = s;
    assert.ok(sessions);
    for (const lang of ['en', 'tr']) {
      const opts = { repoName: 'demo', today: TODAY, lang };
      assert.deepEqual(buildCards({ ...s, sessions: null }, opts).map((c) => c.svg), buildCards(noKey, opts).map((c) => c.svg));
      assert.equal(sessionsCard({ ...s, sessions: null }, { L: lang === 'en' ? en : tr, today: TODAY }), null);
    }
  });

  test('sessionsCard tolerates empty / null stats', () => {
    for (const st of [null, undefined, {}]) {
      assert.equal(sessionsCard(st, { L: en, today: TODAY }), null);
    }
  });

  test('a huge session count / length still renders without NaN and in a fitting form', () => {
    const s = statsOf(at(['2026-10-01T10:00:00Z', '2026-10-01T11:30:00Z', '2026-10-02T09:00:00Z']));
    const x = { ...s, sessions: { count: 123456789, medianMinutes: 59999, longest: { minutes: 9_999_999, commits: 99999, day: '2026-10-01' } } };
    for (const lang of ['en', 'tr']) {
      const opts = { repoName: 'demo', today: TODAY, lang };
      const cards = buildCards(x, opts);
      for (const c of cards) assert.doesNotMatch(c.svg, /NaN|Infinity|undefined/, `${lang} ${c.id}`);
      const where = sessionsCard(x, { L: lang === 'en' ? en : tr, today: TODAY });
      if (where) {
        const spec = buildCardSpecs(x, opts).find((c) => c.id === where).spec;
        assert.ok(spec.lines.at(-1).description.includes(lang === 'en' ? 'coding session' : 'kodlama oturum'));
      }
    }
  });
});

describe('sessions: CLI on real git repos', () => {
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
  /** entries: [date, name, email]. */
  const repo = (name, entries, mailmap) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    if (mailmap) {
      writeFileSync(join(dir, '.mailmap'), mailmap);
      git(dir, ['add', '.mailmap']);
    }
    for (const [i, [date, who, email]] of entries.entries()) {
      git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${i}`], {
        GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
      });
    }
    return dir;
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
  const md = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');

  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'gw-sessions-extra-')); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('stats.json, wrapped.md and the recap from a real repo: interleaved authors, 120 vs 121 min, offsets', () => {
    const dir = repo('basic', [
      ['2026-03-02T10:00:00+00:00', 'Ada', 'ada@example.com'],
      ['2026-03-02T10:30:00+00:00', 'Bob', 'bob@example.com'],
      ['2026-03-02T15:00:00+03:00', 'Ada', 'ADA@example.com'], // 12:00Z, 120 min after 10:00Z
      ['2026-03-02T14:01:00+00:00', 'Ada', 'ada@example.com'], // 121 min after 12:00Z: new session
      ['2026-03-02T11:00:00+00:00', 'Bob', 'bob@example.com'],
    ]);
    const out = join(tmp, 'basic-out');
    const r = bin([dir, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    // Ada 10:00-12:00 (2), Ada 14:01 (1), Bob 10:30-11:00 (2) → 120, 0, 30.
    assert.deepEqual(doc.stats.sessions, { count: 3, medianMinutes: 30, longest: { minutes: 120, commits: 2, day: '2026-03-02' } });
    assert.match(md(out), /- \*\*Coding sessions:\*\* 3 sessions · median 30 min · longest 2h \(2 commits, Mar 2, 2026\)/);
    assert.match(r.stdout, /Sessions\s+3 sessions · median 30 min · longest 2h \(2 commits, Mar 2, 2026\)/);
  });

  test('.mailmap merges two emails into one person, so their commits share a session (tr)', () => {
    const entries = [
      ['2026-03-02T10:00:00+00:00', 'Ada', 'ada@old.io'],
      ['2026-03-02T11:00:00+00:00', 'Ada Lovelace', 'ada@new.io'],
    ];
    const plain = repo('nomap', entries);
    const mapped = repo('map', entries, 'Ada Lovelace <ada@new.io> <ada@old.io>\n');
    const o1 = join(tmp, 'nomap-out');
    const o2 = join(tmp, 'map-out');
    const r1 = bin([plain, '--out', o1, '--json']);
    const r2 = bin([mapped, '--out', o2, '--json', '--md', '--lang', 'tr']);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(statsJson(o1).stats.sessions, { count: 2, medianMinutes: 0, longest: { minutes: 0, commits: 1, day: '2026-03-02' } });
    assert.deepEqual(statsJson(o2).stats.sessions, { count: 1, medianMinutes: 60, longest: { minutes: 60, commits: 2, day: '2026-03-02' } });
    assert.match(md(o2), /- \*\*Kodlama oturumları:\*\* 1 oturum · 1 sa \(2 commit, 2 Mar 2026\)/);
    // No line when no session lasted a minute.
    assert.doesNotMatch(r1.stdout, /Sessions/);
  });

  test('--author narrows the sessions to that person', () => {
    const dir = repo('author', [
      ['2026-03-02T10:00:00+00:00', 'Ada', 'ada@example.com'],
      ['2026-03-02T10:45:00+00:00', 'Ada', 'ada@example.com'],
      ['2026-03-02T10:00:00+00:00', 'Bob', 'bob@example.com'],
      ['2026-03-02T11:59:00+00:00', 'Bob', 'bob@example.com'],
    ]);
    const out = join(tmp, 'author-out');
    const r = bin([dir, '--out', out, '--json', '--author', 'ada@example.com']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.sessions, { count: 1, medianMinutes: 45, longest: { minutes: 45, commits: 2, day: '2026-03-02' } });
  });

  test('several repos: one person\'s commits across repos join one session', () => {
    const a = repo('multi-a', [['2026-03-02T10:00:00+00:00', 'Ada', 'ada@example.com']]);
    const b = repo('multi-b', [['2026-03-02T11:30:00+00:00', 'Ada', 'ada@example.com']]);
    const out = join(tmp, 'multi-out');
    const r = bin([a, b, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.sessions, { count: 1, medianMinutes: 90, longest: { minutes: 90, commits: 2, day: '2026-03-02' } });
  });
});
