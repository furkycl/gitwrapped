// Office hours: commits on an author-local weekday (Monday-Friday) between 09:00 and 17:59,
// counted by computeOfficeHours (src/stats/officehours.js) over the same dated commits as
// habits.byHour, shown as stats.officeHours, a recap line, a wrapped.md item and a row on
// the power-hour card (else the activity card), only when it fits.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeOfficeHours, computeTimeHabits, OFFICE_DAYS, OFFICE_HOURS, shownOfficeHours } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
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
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject: 'feat: work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 1, removed: 0 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits) => computeStats(commits, { today: TODAY });
const without = (s) => {
  const copy = { ...s };
  delete copy.officeHours;
  return copy;
};
const specs = (s, lang = 'en') => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang });
const specOf = (s, id, lang) => specs(s, lang).find((c) => c.id === id).spec;
const svgOf = (s, id, lang = 'en') => buildCards(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === id).svg;
const officeRow = (spec, L = en) => (spec.lines ?? []).find((r) => r.label === L.recap.officeHours);

// 2026-03-02 is a Monday, 2026-03-06 a Friday, 2026-03-07 a Saturday.
// Three commits in the 13:00 hour (Mon, Mon, Tue) and one Wednesday 10:00 commit: the
// power-hour card has room for the row in English.
const peakFixture = () => [commit('2026-03-02T13:10:00Z'), commit('2026-03-02T13:11:00Z'), commit('2026-03-03T13:12:00Z'), commit('2026-03-04T10:00:00Z')];
// The same at 10:00: the morning quip leaves no room there, the activity card gets it.
const activityFixture = () => [commit('2026-03-02T10:10:00Z'), commit('2026-03-02T10:11:00Z'), commit('2026-03-03T10:12:00Z'), commit('2026-03-04T10:00:00Z')];

describe('computeOfficeHours', () => {
  test('constants: Monday-Friday, 09-17, frozen', () => {
    assert.deepEqual([...OFFICE_DAYS], [1, 2, 3, 4, 5]);
    assert.deepEqual([...OFFICE_HOURS], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.ok(Object.isFrozen(OFFICE_DAYS) && Object.isFrozen(OFFICE_HOURS));
  });

  test('boundaries: Fri 17:59 in, Fri 18:00 out, Mon 08:59 out, Mon 09:00 in, Sat 10:00 out', () => {
    const one = (date) => computeOfficeHours([commit(date)]).commits;
    assert.equal(one('2026-03-06T17:59:59Z'), 1);
    assert.equal(one('2026-03-06T18:00:00Z'), 0);
    assert.equal(one('2026-03-02T08:59:59Z'), 0);
    assert.equal(one('2026-03-02T09:00:00Z'), 1);
    assert.equal(one('2026-03-07T10:00:00Z'), 0);
    assert.equal(one('2026-03-08T10:00:00Z'), 0); // Sunday
  });

  test("author-local time: the commit's own offset decides hour and weekday", () => {
    // 07:00Z in +03:00 is 10:00 local.
    assert.equal(computeOfficeHours([commit('2026-03-02T10:00:00+03:00')]).commits, 1);
    // 20:00 local in -05:00 (01:00Z the next day): out.
    assert.equal(computeOfficeHours([commit('2026-03-02T20:00:00-05:00')]).commits, 0);
    // Saturday 01:00Z, but Friday 17:00 in -08:00: in.
    assert.equal(computeOfficeHours([commit('2026-03-06T17:00:00-08:00')]).commits, 1);
  });

  test('unparseable dates and non-object entries are skipped, never throws', () => {
    const r = computeOfficeHours([commit('nope'), null, 42, commit(undefined), commit('2026-03-02T10:00:00Z'), commit('2026-03-07T10:00:00Z')]);
    assert.deepEqual(r, { commits: 1, share: 0.5 });
    for (const bad of [undefined, null, 'x', {}, [], [null]]) assert.deepEqual(computeOfficeHours(bad), { commits: 0, share: 0 });
  });

  test('share: 3 decimals, at most 0.999 short of every commit, 1 when all', () => {
    assert.deepEqual(computeOfficeHours([commit('2026-03-02T10:00:00Z'), commit('2026-03-02T11:00:00Z'), commit('2026-03-07T10:00:00Z')]), { commits: 2, share: 0.667 });
    const many = Array.from({ length: 2000 }, () => commit('2026-03-02T10:00:00Z'));
    assert.deepEqual(computeOfficeHours([...many, commit('2026-03-07T10:00:00Z')]), { commits: 2000, share: 0.999 });
    assert.deepEqual(computeOfficeHours(many), { commits: 2000, share: 1 });
  });

  test('merges and future-dated commits count, as in habits; a subset of byHour[9..17] and byWeekday[1..5]', () => {
    const commits = [];
    for (let d = 1; d <= 14; d++) for (const h of [3, 8, 9, 12, 17, 18, 23]) commits.push(commit(`2026-03-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:30:00+02:00`));
    commits.push(commit('2099-01-05T10:00:00Z', { parents: ['a', 'b'] })); // a future Monday merge
    const s = statsOf(commits);
    const h = computeTimeHabits(commits);
    // Ten weekdays in March 1-14 (Mon 2 - Fri 13) × three office hours, plus the merge.
    assert.equal(s.officeHours.commits, 10 * 3 + 1);
    const dated = h.byHour.reduce((a, b) => a + b, 0);
    assert.equal(s.officeHours.share, Math.round((s.officeHours.commits / dated) * 1000) / 1000);
    assert.ok(s.officeHours.commits <= OFFICE_HOURS.reduce((a, i) => a + h.byHour[i], 0));
    assert.ok(s.officeHours.commits <= OFFICE_DAYS.reduce((a, i) => a + h.byWeekday[i], 0));
  });
});

describe('shownOfficeHours', () => {
  test('null without an office-hours commit or a dated commit, and for malformed stats', () => {
    assert.equal(shownOfficeHours(statsOf([])), null);
    assert.equal(shownOfficeHours(statsOf([commit('2026-03-07T10:00:00Z')])), null);
    const s = statsOf([commit('2026-03-02T10:00:00Z')]);
    for (const officeHours of [undefined, null, 'x', {}, { commits: -1, share: 0.5 }, { commits: 1.5, share: 0.5 }, { commits: 1, share: 2 }, { commits: 1, share: NaN }, { commits: 99, share: 0.5 }]) {
      assert.equal(shownOfficeHours({ ...s, officeHours }), null, JSON.stringify(officeHours));
    }
    assert.equal(shownOfficeHours(null), null);
  });

  test('whole percent of the dated commits, never 100 short of every commit', () => {
    const s = statsOf([commit('2026-03-02T10:00:00Z'), commit('2026-03-07T10:00:00Z'), commit('2026-03-02T22:00:00Z')]);
    assert.deepEqual(shownOfficeHours(s), { commits: 1, percent: 33 });
    const big = { ...s, officeHours: { commits: 999, share: 0.999 }, habits: { ...s.habits, byHour: [1000, ...new Array(23).fill(0)] } };
    assert.deepEqual(shownOfficeHours(big), { commits: 999, percent: 99 });
    assert.deepEqual(shownOfficeHours(statsOf([commit('2026-03-02T10:00:00Z')])), { commits: 1, percent: 100 });
  });
});

describe('stats.json, recap and wrapped.md', () => {
  const s = statsOf([commit('2026-03-02T10:00:00Z'), commit('2026-03-03T11:00:00Z'), commit('2026-03-07T10:00:00Z'), commit('2026-03-04T21:00:00Z')]);

  test('stats.json has stats.officeHours after lateNights', () => {
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.officeHours, { commits: 2, share: 0.5 });
    const keys = Object.keys(doc.stats);
    assert.equal(keys.indexOf('officeHours'), keys.indexOf('lateNights') + 1);
    assert.deepEqual(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo' })).stats.officeHours, { commits: 0, share: 0 });
  });

  test('recap line in en and tr, after the weekend line', () => {
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Office hours\s+2 commits \(50% of commits\)\n/);
    assert.ok(out.indexOf('Office hours') > out.indexOf('Weekends'));
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Mesai saatleri\s+2 commit \(commit'lerin %50 kadarı\)\n/);
    // Padded to the label width like every row.
    assert.ok(out.includes(`  ${en.recap.officeHours.padEnd(en.recap.labelWidth)}`));
  });

  test('wrapped.md item in en and tr', () => {
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY }).includes('- **Office-hours commits:** 2 commits (50% of commits)\n'));
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes("- **Mesai saatlerindeki commit'ler:** 2 commit (commit'lerin %50 kadarı)\n"));
  });

  test('no line anywhere without an office-hours commit', () => {
    const none = statsOf([commit('2026-03-07T10:00:00Z'), commit('2026-03-02T22:00:00Z')]);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      assert.ok(!formatSummary(none, { repoName: 'demo', today: TODAY, lang }).includes(L.recap.officeHours));
      assert.ok(!buildMarkdown(none, { repoName: 'demo', today: TODAY, lang }).includes(L.markdown.officeHours));
    }
  });
});

describe('cards', () => {
  test('the power-hour card gets the row when it has room, the activity card then does not', () => {
    const s = statsOf(peakFixture());
    const peak = specOf(s, 'peak-hour', 'en');
    assert.deepEqual(officeRow(peak), { label: 'Office hours', value: '4 commits · 100%' });
    assert.equal(officeRow(specOf(s, 'activity', 'en')), undefined);
    // Both charts still drawn, at most one shrink step.
    const l = layoutCard({ ...peak, lang: 'en' });
    const base = layoutCard({ ...specOf(without(s), 'peak-hour', 'en'), lang: 'en' });
    assert.deepEqual(l.drawnCharts, base.drawnCharts);
    assert.ok(l.shrinkSteps <= Math.max(base.shrinkSteps, 1));
    assert.ok(svgOf(s, 'peak-hour').includes('Office hours'));
    // The activity card is byte-identical to one without office hours.
    assert.equal(svgOf(s, 'activity'), svgOf(without(s), 'activity'));
  });

  test('else the activity card gets it after the weekend row, en and tr', () => {
    const s = statsOf([...activityFixture(), commit('2026-03-07T10:00:00Z')]);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      assert.equal(officeRow(specOf(s, 'peak-hour', lang), L), undefined, lang);
      const lines = specOf(s, 'activity', lang).lines;
      assert.deepEqual(lines.map((r) => r.label), [L.recap.weekend, L.recap.officeHours], lang);
      assert.equal(lines[1].value, lang === 'en' ? '4 commits · 80%' : '4 commit · %80');
      assert.equal(svgOf(s, 'peak-hour', lang), svgOf(without(s), 'peak-hour', lang), lang);
    }
  });

  test('never on both cards, always drawn whole', () => {
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      const s = statsOf([commit(`2026-03-02T${hh}:10:00Z`), commit(`2026-03-02T${hh}:11:00Z`), commit(`2026-03-03T${hh}:12:00Z`), commit('2026-03-04T10:00:00Z')]);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const rows = ['peak-hour', 'activity'].map((id) => officeRow(specOf(s, id, lang), L)).filter(Boolean);
        assert.equal(rows.length, 1, `${lang} ${hh}:00`);
        assert.ok(rowFits(rows[0]), `${lang} ${hh}:00`);
      }
    }
  });

  test('large counts: the short value whenever the full one would be cut, no row when even that would be', () => {
    const s = statsOf(activityFixture());
    const dated = 4;
    const big = (commits) => ({ ...s, officeHours: { commits, share: 0.5 }, habits: { ...s.habits, byHour: s.habits.byHour.map((v, i) => (i === 10 ? v + commits * 2 - dated : v)) } });
    const rowsOf = (st, L, lang) => ['peak-hour', 'activity'].map((id) => officeRow(specOf(st, id, lang), L)).filter(Boolean);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      // Up to 123,456,789 the activity card draws the short value (the full one never fits).
      for (const commits of [1234, 123456, 12345678, 123456789]) {
        const rows = rowsOf(big(commits), L, lang);
        assert.equal(rows.length, 1, `${lang} ${commits}`);
        assert.equal(rows[0].value, `${L.num(commits)} · ${L.pct(50)}`, `${lang} ${commits}`);
        assert.ok(rowFits(rows[0]));
        assert.ok(officeRow(specOf(big(commits), 'activity', lang), L), `${lang} ${commits}: on the activity card`);
      }
      // From 1,234,567,890 even the short value would be cut: no row on either card, and
      // both cards are byte-identical to ones without office hours.
      for (const commits of [1234567890, 1234567890123]) {
        const st = big(commits);
        assert.equal(rowsOf(st, L, lang).length, 0, `${lang} ${commits}`);
        for (const id of ['peak-hour', 'activity']) assert.equal(svgOf(st, id, lang), svgOf(without(st), id, lang), `${lang} ${commits} ${id}`);
      }
    }
  });

  test('activity: no row (byte-identical) when a future-dated day is left off the grid', () => {
    const s = statsOf([...activityFixture(), commit('2027-01-04T10:00:00Z')]);
    assert.ok(shownOfficeHours(s));
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      assert.equal(officeRow(specOf(s, 'activity', lang), L), undefined, lang);
      assert.equal(officeRow(specOf(s, 'peak-hour', lang), L), undefined, lang);
      assert.equal(svgOf(s, 'activity', lang), svgOf(without(s), 'activity', lang), lang);
    }
  });

  test('power hour: no second shrink step when the late-nights or time-zones row took the one allowed', () => {
    const fourteen = [commit('2026-03-02T14:10:00Z'), commit('2026-03-02T14:11:00Z'), commit('2026-03-03T14:12:00Z'), commit('2026-03-04T10:00:00Z')];
    const cases = {
      'late nights': statsOf([...fourteen, commit('2026-03-05T02:00:00Z')]),
      'time zones': statsOf([commit('2026-03-02T19:10:00Z'), commit('2026-03-02T19:11:00Z'), commit('2026-03-03T19:12:00Z'), commit('2026-03-04T10:00:00Z'), commit('2026-03-04T11:00:00+05:00')]),
    };
    for (const [name, s] of Object.entries(cases)) {
      const base = specOf(without(s), 'peak-hour', 'en');
      assert.equal(layoutCard({ ...base, lang: 'en' }).shrinkSteps, 1, `${name}: the row before took one step`);
      // The office-hours row would need more: it is left off, the card byte-identical.
      const forced = layoutCard({ ...base, lines: [...base.lines, { label: 'Office hours', value: '4 commits · 80%' }], lang: 'en' });
      assert.ok(forced.shrinkSteps > 1, name);
      assert.equal(officeRow(specOf(s, 'peak-hour', 'en')), undefined, name);
      assert.equal(svgOf(s, 'peak-hour'), svgOf(without(s), 'peak-hour'), name);
      // The activity card takes it instead.
      assert.ok(officeRow(specOf(s, 'activity', 'en')), name);
    }
  });

  test('Turkish on realistic histories (pins current behavior: usually no room on the power-hour card)', () => {
    // Six weeks, one or two commits a day (+03:00), peak at 14:00 or 20:00: the Turkish
    // power-hour card has no room, the activity card takes the row after the weekend row.
    const sixWeeks = (peak) => {
      const out = [];
      for (let i = 0; i < 42; i++) {
        const day = new Date(Date.parse('2026-02-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
        const hours = [peak, peak, 10, 15, 21];
        for (let k = 0; k < 1 + (i % 2); k++) out.push(commit(`${day}T${String(hours[(i + k) % 5]).padStart(2, '0')}:${String((i * 7 + k) % 60).padStart(2, '0')}:00+03:00`));
      }
      return statsOf(out);
    };
    for (const peak of [14, 20]) {
      const s = sixWeeks(peak);
      assert.equal(officeRow(specOf(s, 'peak-hour', 'tr'), tr), undefined, `${peak}`);
      const lines = specOf(s, 'activity', 'tr').lines;
      assert.deepEqual(lines.map((r) => r.label), ['Hafta sonu', 'Mesai saatleri'], `${peak}`);
      const o = shownOfficeHours(s);
      assert.equal(lines[1].value, `${o.commits} commit · %${o.percent}`);
    }
    // At 20:00 the English power-hour card has room (its subtitle is shorter).
    assert.ok(officeRow(specOf(sixWeeks(20), 'peak-hour', 'en')));
    // Six months of daily commits (a calendar too full for another row): neither card.
    const hist = [];
    for (let i = 0; i < 180; i++) {
      const day = new Date(Date.parse('2025-10-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
      const hours = [9, 11, 14, 16, 20, 23];
      for (let k = 0; k < 1 + (i % 3); k++) hist.push(commit(`${day}T${String(hours[(i + k * 2) % 6]).padStart(2, '0')}:${String((i * 7 + k) % 60).padStart(2, '0')}:00+03:00`));
    }
    const s = statsOf(hist);
    assert.ok(shownOfficeHours(s));
    for (const id of ['peak-hour', 'activity']) assert.equal(svgOf(s, id, 'tr'), svgOf(without(s), id, 'tr'), id);
    // The recap and wrapped.md still have it.
    assert.ok(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes('Mesai saatleri'));
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes(tr.markdown.officeHours));
  });

  test('cards without the row are byte-identical (no office-hours commit, clipped calendar)', () => {
    const none = statsOf([commit('2026-03-07T10:00:00Z'), commit('2026-03-02T22:00:00Z'), commit('2026-03-03T07:00:00Z')]);
    for (const lang of ['en', 'tr']) {
      for (const id of ['peak-hour', 'activity']) assert.equal(svgOf(none, id, lang), svgOf(without(none), id, lang), `${lang} ${id}`);
    }
    // A history longer than the 53-week grid: no row on the activity card.
    const day = (i) => new Date(Date.parse('2026-03-02T00:00:00Z') - i * 7 * 86400000).toISOString().slice(0, 10);
    const long = statsOf(Array.from({ length: 60 }, (_, i) => commit(`${day(i)}T10:00:00Z`)));
    assert.ok(shownOfficeHours(long));
    assert.equal(svgOf(long, 'activity'), svgOf(without(long), 'activity'));
  });
});
