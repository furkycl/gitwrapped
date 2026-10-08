// Extra edge cases for office hours (src/stats/officehours.js): odd and extreme UTC
// offsets at the 09:00 / 18:00 and Friday / Monday boundaries, an independent oracle over
// many offsets, the 0.999 / 1 / "<1%" edges, malformed stats.officeHours, huge counts on the
// cards (never a cut row, never on both cards), consistency of the recap, wrapped.md and
// card percent, multi-repo merges and window subsets (counts add up over disjoint windows).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { computeStats, computeOfficeHours, computeTimeHabits, shownOfficeHours, OFFICE_HOURS } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`,
  date,
  subject: 'feat: work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 1, removed: 0 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const without = (s) => {
  const copy = { ...s };
  delete copy.officeHours;
  return copy;
};
const specs = (s, lang = 'en') => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang });
const svgs = (s, lang = 'en') => Object.fromEntries(buildCards(s, { repoName: 'demo', today: TODAY, lang }).map((c) => [c.id, c.svg]));
const officeRows = (s, lang = 'en') =>
  specs(s, lang).flatMap((c) => (c.spec.lines ?? []).filter((r) => r.label === LANGS[lang].recap.officeHours).map((row) => ({ id: c.id, row })));
const one = (date) => computeOfficeHours([commit(date)]).commits;

// An independent oracle: shift the instant by the written offset, read UTC parts.
function oracle(iso) {
  const m = /([+-])(\d{2}):?(\d{2})$|Z$/.exec(iso);
  const off = !m || m[0] === 'Z' ? 0 : (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
  const d = new Date(Date.parse(iso) + off * 60000);
  const wd = d.getUTCDay();
  const h = d.getUTCHours();
  return wd >= 1 && wd <= 5 && h >= 9 && h <= 17;
}

describe('computeOfficeHours: odd and extreme offsets', () => {
  test('+05:30 (and +0530 without a colon): 09:00 local in, 08:59 out', () => {
    assert.equal(one('2026-03-02T09:00:00+05:30'), 1);
    assert.equal(one('2026-03-02T08:59:59+05:30'), 0);
    assert.equal(one('2026-03-02T09:00:00+0530'), 1);
    assert.equal(one('2026-03-02T08:59:00+0530'), 0);
    assert.equal(one('2026-03-06T17:59:00+0530'), 1);
    assert.equal(one('2026-03-06T18:00:00+0530'), 0);
  });

  test('-09:30: Friday 17:59 local (Saturday in UTC) in, Saturday 09:00 local out', () => {
    assert.equal(one('2026-03-06T17:59:00-09:30'), 1);
    assert.equal(one('2026-03-07T09:00:00-09:30'), 0);
    assert.equal(one('2026-03-06T18:00:00-0930'), 0);
  });

  test('+14:00 and -12:00: the local weekday decides, not the UTC one', () => {
    // Monday 09:00 in +14:00 is Sunday 19:00Z.
    assert.equal(one('2026-03-02T09:00:00+14:00'), 1);
    assert.equal(one('2026-03-02T09:00:00+1400'), 1);
    // Sunday 17:00 in +14:00 is Sunday 03:00Z: out.
    assert.equal(one('2026-03-01T17:00:00+14:00'), 0);
    // Friday 17:30 in -12:00 is Saturday 05:30Z: in.
    assert.equal(one('2026-03-06T17:30:00-12:00'), 1);
    // Saturday 10:00 in -12:00 is Saturday 22:00Z: out.
    assert.equal(one('2026-03-07T10:00:00-12:00'), 0);
  });

  test('a DST switch: the same wall-clock hour counts on both sides of it', () => {
    // Europe/Berlin moved from +01:00 to +02:00 on 2026-03-29; 09:15 local both days.
    const r = computeOfficeHours([commit('2026-03-27T09:15:00+01:00'), commit('2026-03-30T09:15:00+02:00'), commit('2026-03-30T08:15:00+02:00')]);
    assert.deepEqual(r, { commits: 2, share: 0.667 });
  });

  test('impossible offsets are skipped and do not count as dated', () => {
    assert.deepEqual(computeOfficeHours([commit('2026-03-02T10:00:00+24:00'), commit('2026-03-02T10:00:00+05:60'), commit('2026-03-02T10:00:00')]), { commits: 0, share: 0 });
    assert.deepEqual(computeOfficeHours([commit('2026-03-02T10:00:00+24:00'), commit('2026-03-02T10:00:00+01:00')]), { commits: 1, share: 1 });
  });

  test('matches an independent oracle over many offsets and hours, and the habits base', () => {
    const offsets = ['Z', '+00:00', '-00:00', '+05:30', '+0545', '-09:30', '+14:00', '-12:00', '+12:45', '-03:30', '+09:00'];
    const commits = [];
    for (let d = 1; d <= 9; d++) {
      for (let h = 0; h < 24; h++) {
        for (const off of offsets) commits.push(commit(`2026-03-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String((h * 7) % 60).padStart(2, '0')}:00${off}`));
      }
    }
    const expected = commits.filter((c) => oracle(c.date)).length;
    const r = computeOfficeHours(commits);
    assert.equal(r.commits, expected);
    const dated = computeTimeHabits(commits).byHour.reduce((a, b) => a + b, 0);
    assert.equal(dated, commits.length);
    assert.equal(r.share, Math.round((expected / dated) * 1000) / 1000);
    assert.equal(statsOf(commits).officeHours.commits, expected);
  });
});

describe('computeOfficeHours: share edges and huge counts', () => {
  test('every commit in office hours: share 1, percent 100; all but one: 0.999, 99%', () => {
    const all = Array.from({ length: 1500 }, (_, i) => commit(`2026-03-0${2 + (i % 5)}T${String(9 + (i % 9)).padStart(2, '0')}:00:00Z`));
    const s = statsOf(all);
    assert.deepEqual(s.officeHours, { commits: 1500, share: 1 });
    assert.deepEqual(shownOfficeHours(s), { commits: 1500, percent: 100 });
    const butOne = statsOf([...all, commit('2026-03-07T10:00:00Z')]);
    assert.deepEqual(butOne.officeHours, { commits: 1500, share: 0.999 });
    assert.deepEqual(shownOfficeHours(butOne), { commits: 1500, percent: 99 });
    assert.ok(formatSummary(butOne, { repoName: 'demo', today: TODAY }).includes('(99% of commits)'));
    assert.ok(formatSummary(s, { repoName: 'demo', today: TODAY }).includes('(100% of commits)'));
  });

  test('1,000,001 commits, all but one in office hours: 0.999, not 1', () => {
    const inside = commit('2026-03-02T10:00:00Z');
    const big = new Array(1_000_000).fill(inside);
    big.push(commit('2026-03-07T10:00:00Z'));
    assert.deepEqual(computeOfficeHours(big), { commits: 1_000_000, share: 0.999 });
  });

  test('one office-hours commit in thousands: share 0, but shown as "<1%" with habits', () => {
    const commits = [commit('2026-03-02T10:00:00Z'), ...Array.from({ length: 2500 }, () => commit('2026-03-07T22:00:00Z'))];
    const s = statsOf(commits);
    assert.deepEqual(s.officeHours, { commits: 1, share: 0 });
    assert.deepEqual(shownOfficeHours(s), { commits: 1, percent: 0 });
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /Office hours\s+1 commit \(<1% of commits\)/);
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY }).includes('- **Office-hours commits:** 1 commit (<1% of commits)\n'));
  });
});

describe('shownOfficeHours: malformed input', () => {
  const s = statsOf([commit('2026-03-02T10:00:00Z'), commit('2026-03-07T10:00:00Z')]);

  test('bad commits / share values and odd types are null, never throw', () => {
    const bads = [
      0, 1, true, [], [1, 0.5], 'commits', { commits: '1', share: 0.5 }, { commits: 1 }, { share: 0.5 }, { commits: 0, share: 0 },
      { commits: Infinity, share: 0.5 }, { commits: NaN, share: 0.5 }, { commits: Number.MAX_SAFE_INTEGER + 1, share: 0.5 },
      { commits: 1, share: -0.1 }, { commits: 1, share: Infinity }, { commits: 1, share: '0.5' }, { commits: 1, share: null },
      { commits: 3, share: 0.5 }, // more than the dated commits (2)
    ];
    for (const officeHours of bads) assert.equal(shownOfficeHours({ ...s, officeHours }), null, JSON.stringify(officeHours) ?? String(officeHours));
    for (const stats of [undefined, 0, 'x', [], {}, { officeHours: null }]) assert.equal(shownOfficeHours(stats), null);
  });

  test('without habits.byHour (or junk in it) the share is the base', () => {
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 0.25 } }), { commits: 5, percent: 25 });
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 0.9995 } }), { commits: 5, percent: 99 });
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 1 } }), { commits: 5, percent: 100 });
    assert.equal(shownOfficeHours({ officeHours: { commits: 5, share: 0 } }), null);
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 0.25 }, habits: { byHour: 'x' } }), { commits: 5, percent: 25 });
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 0.25 }, habits: { byHour: [null, 'x', -3, NaN, Infinity] } }), { commits: 5, percent: 25 });
    assert.deepEqual(shownOfficeHours({ officeHours: { commits: 5, share: 0.25 }, habits: { byHour: [10, 'x', -3] } }), { commits: 5, percent: 50 });
  });

  test('malformed officeHours renders no line and the same cards, never throws', () => {
    for (const officeHours of [null, 'x', { commits: -1, share: 2 }, { commits: 3, share: 0.5 }]) {
      const bad = { ...s, officeHours };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        assert.ok(!formatSummary(bad, { repoName: 'demo', today: TODAY, lang }).includes(L.recap.officeHours));
        assert.ok(!buildMarkdown(bad, { repoName: 'demo', today: TODAY, lang }).includes(L.markdown.officeHours));
        assert.deepEqual(svgs(bad, lang), svgs(without(s), lang));
      }
    }
  });
});

describe('zero office-hours commits: consistent everywhere', () => {
  test('no recap line, no wrapped.md item, no card row, cards identical; stats.json still {0, 0}', () => {
    const none = statsOf([commit('2026-03-07T10:00:00Z'), commit('2026-03-02T08:59:00Z'), commit('2026-03-02T18:00:00Z'), commit('2026-03-08T12:00:00+05:30')]);
    assert.deepEqual(none.officeHours, { commits: 0, share: 0 });
    assert.equal(shownOfficeHours(none), null);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      assert.ok(!formatSummary(none, { repoName: 'demo', today: TODAY, lang }).includes(L.recap.officeHours));
      assert.ok(!buildMarkdown(none, { repoName: 'demo', today: TODAY, lang }).includes(L.markdown.officeHours));
      assert.deepEqual(officeRows(none, lang), []);
      assert.deepEqual(svgs(none, lang), svgs(without(none), lang));
    }
    assert.deepEqual(JSON.parse(buildStatsJson({ stats: none, repoName: 'demo', version: '0.0.0', asOf: TODAY })).stats.officeHours, { commits: 0, share: 0 });
  });
});

describe('cards: huge counts, placement, tr strings', () => {
  const base = statsOf([commit('2026-03-02T10:10:00Z'), commit('2026-03-02T10:11:00Z'), commit('2026-03-03T13:12:00Z'), commit('2026-03-04T10:00:00Z')]);
  const inflate = (s, commits, dated) => ({
    ...s,
    officeHours: { commits, share: Math.min(Math.round((commits / dated) * 1000) / 1000, commits < dated ? 0.999 : 1) },
    habits: { ...s.habits, byHour: s.habits.byHour.map((v, i) => (i === 10 ? v + (dated - 4) : v)) },
  });

  test('1,000,000+ commits: a row that fits on at most one card, percent agrees with the recap', () => {
    const cases = [
      [1_000_000, 1_000_000],
      [1_000_000, 1_000_001],
      [9_999_999, 20_000_000],
      [123_456_789, 987_654_321],
      [4_294_967_296, 4_294_967_297],
      [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 1],
    ];
    for (const [commits, dated] of cases) {
      const big = inflate(base, commits, dated);
      const shown = shownOfficeHours(big);
      assert.ok(shown, `${commits}/${dated}`);
      if (commits < dated) assert.ok(shown.percent < 100, `${commits}/${dated}`);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const rows = officeRows(big, lang);
        assert.ok(rows.length <= 1, `${lang} ${commits}: on ${rows.map((r) => r.id)}`);
        for (const { row } of rows) {
          assert.ok(rowFits(row), `${lang} ${commits}: ${row.value}`);
          assert.ok(row.value.startsWith(L.num(commits)), row.value);
          assert.ok(row.value.endsWith(L.pct(shown.percent)), `${row.value} vs ${shown.percent}`);
        }
        // The recap and wrapped.md show the same count and percent, never throw.
        const recap = formatSummary(big, { repoName: 'demo', today: TODAY, lang });
        assert.ok(recap.includes(L.num(commits)), `${lang} ${commits}`);
        assert.ok(buildMarkdown(big, { repoName: 'demo', today: TODAY, lang }).includes(L.pct(shown.percent)));
        // Every SVG stays well-formed (no NaN / undefined leaking in).
        for (const svg of Object.values(svgs(big, lang))) assert.ok(!/NaN|undefined|Infinity/.test(svg));
      }
    }
  });

  test('never on both cards and always drawn whole, across hours, offsets and mixes, en and tr', () => {
    const offsets = ['Z', '+05:30', '-09:30', '+14:00'];
    for (let h = 0; h < 24; h += 1) {
      for (const off of offsets) {
        const hh = String(h).padStart(2, '0');
        const mixes = [
          [commit(`2026-03-02T${hh}:10:00${off}`), commit(`2026-03-03T${hh}:10:00${off}`), commit('2026-03-04T10:00:00Z')],
          [commit(`2026-03-02T${hh}:10:00${off}`), commit(`2026-03-07T${hh}:10:00${off}`), commit('2026-03-08T02:00:00Z'), commit('2026-03-05T16:59:00Z')],
        ];
        for (const commits of mixes) {
          const s = statsOf(commits);
          const shown = shownOfficeHours(s);
          for (const lang of ['en', 'tr']) {
            const rows = officeRows(s, lang);
            assert.ok(rows.length <= 1, `${lang} ${hh}${off}: ${rows.map((r) => r.id)}`);
            if (!shown) assert.equal(rows.length, 0);
            for (const { id, row } of rows) {
              assert.ok(['peak-hour', 'activity'].includes(id), id);
              assert.ok(rowFits(row), `${lang} ${hh}${off}`);
            }
          }
        }
      }
    }
  });

  test('tr strings: recap, wrapped.md and card row use Turkish labels, numbers and percent', () => {
    // 1,234 office-hours commits out of 2,000 dated: 62%.
    const s = inflate(base, 1234, 2000);
    const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(recap, /\n {2}Mesai saatleri\s+1\.234 commit \(commit'lerin %62 kadarı\)\n/);
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes("- **Mesai saatlerindeki commit'ler:** 1.234 commit (commit'lerin %62 kadarı)\n"));
    const rows = officeRows(s, 'tr');
    assert.equal(rows.length, 1);
    assert.ok(['1.234 commit · %62', '1.234 · %62'].includes(rows[0].row.value), rows[0].row.value);
    assert.ok(!recap.includes('Office hours'));
    // "<1%" in Turkish.
    const tiny = statsOf([commit('2026-03-02T10:00:00Z'), ...Array.from({ length: 300 }, () => commit('2026-03-07T22:00:00Z'))]);
    assert.ok(formatSummary(tiny, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes(`(commit'lerin <${tr.pct(1)} kadarı)`));
  });
});

describe('multi-repo and windows', () => {
  test('a merged multi-repo history counts each commit once (shared hashes deduplicated)', () => {
    const shared = commit('2026-03-02T10:00:00Z');
    const a = [shared, commit('2026-03-03T11:00:00+05:30'), commit('2026-03-07T10:00:00Z')];
    const b = [{ ...shared }, commit('2026-03-04T17:59:00-09:30'), commit('2026-03-04T18:00:00-09:30')];
    const merged = mergeHistories([
      { label: 'api', commits: a },
      { label: 'web', commits: b },
    ]);
    assert.equal(merged.commits.length, 5);
    const s = statsOf(merged.commits, { repos: ['api', 'web'] });
    assert.deepEqual(s.officeHours, { commits: 3, share: 0.6 });
    assert.deepEqual(shownOfficeHours(s), { commits: 3, percent: 60 });
    assert.ok(formatSummary(s, { repoName: 'demo', today: TODAY }).includes('3 commits (60% of commits)'));
  });

  test('disjoint windows add up to the whole, and each window agrees with its habits', () => {
    const offsets = ['Z', '+05:30', '-09:30', '+14:00', '-12:00'];
    const commits = [];
    for (let d = 1; d <= 28; d++) for (let h = 0; h < 24; h += 3) commits.push(commit(`2026-02-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:45:00${offsets[(d + h) % offsets.length]}`));
    // Windows on the author-local day, as --since / --until select commits.
    const dayOf = (c) => c.date.slice(0, 10);
    const windows = [
      ['2026-02-01', '2026-02-09'],
      ['2026-02-10', '2026-02-20'],
      ['2026-02-21', '2026-02-28'],
    ];
    const whole = statsOf(commits).officeHours.commits;
    let sum = 0;
    for (const [since, until] of windows) {
      const inWin = commits.filter((c) => dayOf(c) >= since && dayOf(c) <= until);
      const s = statsOf(inWin);
      sum += s.officeHours.commits;
      assert.equal(s.officeHours.commits, inWin.filter((c) => oracle(c.date)).length, `${since}..${until}`);
      const dated = s.habits.byHour.reduce((a, b) => a + b, 0);
      assert.equal(dated, inWin.length);
      assert.ok(s.officeHours.commits <= OFFICE_HOURS.reduce((a, i) => a + s.habits.byHour[i], 0));
    }
    assert.equal(sum, whole);
  });
});
