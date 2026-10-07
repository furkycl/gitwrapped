// Cold audit of the 1.9 work (relative --since/--until windows, merges / merged pull
// requests, late nights). Bugs fixed (regression tests below):
// - the power-hour card's "Late nights" row cut its value short when the full value was too
//   wide for a row (e.g. 1,000+ commits with a two-digit share: "1,020 commits ·…", the
//   percent lost): it now falls back to "1,020 · 20%";
// - the "Latest night" row's value never fit on a row in English ("4:12 AM · Mar 2,…"),
//   nor many Turkish ones ("04:12 · 28 Oca 2024"): the row now uses the year-less "4:12 AM ·
//   Mar 3" / "04:12 · 28 Oca" when the full date would be cut (latestNightValue), and is
//   left out only when neither fits; the recap and wrapped.md keep the full date;
// - the totals card's merges row cut its label from 10,000 pull requests / merges on
//   ("Merged PRs / mer…"): it is now only put there when drawn whole (rowFits), else the
//   outro's merges panel shows it (never both, never neither);
// - the outro's merges panel cut its Turkish note from 10 merge commits on
//   ("150 merge commit · commit'lerin %50…"): it now falls back to "150 merge commit · %50";
// - CHANGELOG named the row "Latest commit" (it is "Latest night") and implied late nights
//   were Night Owl's 22:00–03:59 hours.
// Plus the invariants the audit verified (relative-window math, a seeded fuzz over the
// three features: no NaN / undefined / email, en + tr, recap and wrapped.md agreeing).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStats, shownLateNights, shownMerges } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, latestNightValue, mergeShareText, mergesOnTotals } from '../src/cards/index.js';
import { CALLOUT_NOTE, escapeXml, measureText, renderCard, rowFits, rowValueFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { mergeHistories } from '../src/git.js';
import { parseCli, resolveRelativeDate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
const LANGS = { en, tr };
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const specOf = (stats, id, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === id).spec;
const svgOf = (stats, id, lang) => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === id).svg;
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));

describe('rowValueFits: whether a row value is drawn whole', () => {
  test('short values fit, long ones (cut with "…" by the rows block) do not', () => {
    assert.equal(rowValueFits(''), true);
    assert.equal(rowValueFits('999 commits · 99%'), true);
    assert.equal(rowValueFits('1,020 · 20%'), true);
    assert.equal(rowValueFits('1,000 commits · 21%'), false);
    assert.equal(rowValueFits('1.000 commit · %21'), false);
    assert.equal(rowValueFits('4:12 AM · Mar 3, 2024'), false);
  });

  test('agrees with what the rows block draws, with one cut-off as values grow', () => {
    let cutAt = null;
    for (let k = 1; k <= 30; k++) {
      const v = '8'.repeat(k);
      const fits = rowValueFits(v);
      const svg = renderCard({ title: 't', big: 'b', lines: [{ label: 'x', value: v }] });
      assert.equal(fits, svg.includes(`>${v}<`), `"${v}" (${k}): rowValueFits says ${fits}`);
      if (!fits && cutAt === null) cutAt = k;
      if (cutAt !== null) assert.equal(fits, false, `${k} chars fit after ${cutAt} did not`);
    }
    assert.ok(cutAt > 1 && cutAt <= 30, `cut-off at ${cutAt}`);
    // The widest value that fits is within the row's width budget; one char more is not.
    const widest = '8'.repeat(cutAt - 1);
    assert.ok(measureText(widest, 40) < measureText(`${widest}8`, 40));
    for (const v of ['1,000 commits · 9%', '999 commit · %21', '9,999,999 · 100%', '04:12 · 3 Mar 2024']) {
      assert.equal(rowValueFits(v), true, v);
      assert.ok(renderCard({ title: 't', big: 'b', lines: [{ label: 'x', value: v }] }).includes(`>${escapeXml(v)}<`), v);
    }
    for (const v of ['1,000 commits · 21%', '1.000 commit · %21', '1,020 commits · <1%']) assert.equal(rowValueFits(v), false, v);
  });

  test('null and undefined count as an empty value', () => {
    assert.equal(rowValueFits(null), true);
    assert.equal(rowValueFits(undefined), true);
  });

  test('Turkish "En geç commit" values: short ones fit (the row stays possible), long ones do not', () => {
    // "04:12 · 3 Mar 2024" is drawn whole; "04:12 · 28 Oca 2024" would be cut, so it is left out too.
    assert.equal(rowValueFits(tr.peak.latestValue(tr.clock(4, 12), tr.date(3, 3, 2024))), true);
    assert.equal(rowValueFits(tr.peak.latestValue(tr.clock(4, 12), tr.date(28, 1, 2024))), false);
    let fit = 0;
    for (let h = 0; h < 5; h++) for (let mo = 1; mo <= 12; mo++) for (const d of [1, 28]) {
      if (rowValueFits(tr.peak.latestValue(tr.clock(h, 7), tr.date(d, mo, 2024)))) fit++;
    }
    assert.ok(fit > 0 && fit < 120, `${fit} of 120 fit`);
  });

  test('every English "Latest night" value is too long for a row', () => {
    for (let h = 0; h < 5; h++) for (const m of [0, 7, 59]) for (let mo = 1; mo <= 12; mo++) {
      assert.equal(rowValueFits(en.peak.latestValue(en.clock(h, m), en.date(1, mo, 2024))), false);
    }
  });
});

describe('power-hour card: the late-nights row never cuts its value', () => {
  /** A clear 3 PM power hour, `mult` times over: 1,020 late-night commits at mult 170. */
  const clear = (mult) => {
    const cs = [];
    for (let k = 0; k < mult; k++) {
      for (let i = 0; i < 10; i++) cs.push(commit(`2026-03-${String(2 + 7 * (i % 4)).padStart(2, '0')}T15:${10 + i}:00+03:00`));
      for (let i = 1; i < 20; i++) cs.push(commit(`2026-04-${String(i).padStart(2, '0')}T${String((18 + i) % 24).padStart(2, '0')}:10:00+03:00`));
      cs.push(commit('2026-03-02T04:12:00+03:00'));
    }
    return statsOf(cs);
  };

  test('1,020 late-night commits: "1,020 · 20%", drawn whole (was "1,020 commits ·…")', () => {
    const s = clear(170);
    assert.equal(s.lateNights.commits, 1020);
    const row = (specOf(s, 'peak-hour', 'en').lines ?? []).find((r) => r.label === 'Late nights');
    assert.ok(row);
    assert.equal(row.value, '1,020 · 20%');
    const shown = texts(svgOf(s, 'peak-hour', 'en'));
    assert.ok(shown.includes('1,020 · 20%'), JSON.stringify(shown));
    assert.ok(!shown.some((t) => t.includes('…')), JSON.stringify(shown));
  });

  test('fewer late-night commits keep the "N commits · P%" form', () => {
    const s = clear(5);
    const row = (specOf(s, 'peak-hour', 'en').lines ?? []).find((r) => r.label === 'Late nights');
    assert.ok(row);
    const late = shownLateNights(s);
    assert.equal(row.value, `${late.commits} commits · ${late.percent}%`);
  });

  /** A spread-out history whose power-hour card has room for the late-nights row in en and tr. */
  const SPREAD = ['2026-04-17T21:27', '2026-04-21T21:52', '2026-02-07T08:02', '2026-02-19T19:14', '2026-05-08T04:36',
    '2026-06-26T21:14', '2026-07-04T19:20', '2026-03-20T02:50', '2026-04-08T14:28', '2026-06-27T10:58', '2026-01-17T15:09',
    '2026-06-22T14:03', '2026-09-14T10:49', '2026-07-05T21:19', '2026-01-07T01:45', '2026-07-17T00:24', '2026-08-13T04:13',
    '2026-02-17T13:18', '2026-06-04T20:06', '2026-09-04T06:05', '2026-07-13T16:01', '2026-01-01T02:29', '2026-01-28T07:09',
    '2026-02-10T11:30', '2026-09-20T14:09', '2026-03-23T18:29', '2026-01-21T17:03', '2026-02-09T05:15'];
  const spread = (mult) => {
    const cs = [];
    for (let k = 0; k < mult; k++) for (const d of SPREAD) cs.push(commit(`${d}:00+00:00`));
    return statsOf(cs);
  };
  const lateRow = (s, lang) => (specOf(s, 'peak-hour', lang).lines ?? []).find((r) => r.label === LANGS[lang].peak.lateNights);

  test('Turkish: "1.020 · %21" from 1,000 late-night commits on (was "1.020 commit ·…")', () => {
    const s = spread(170);
    assert.equal(s.lateNights.commits, 1020);
    assert.equal(rowValueFits('1.020 commit · %21'), false);
    assert.equal(lateRow(s, 'tr')?.value, '1.020 · %21');
    assert.equal(lateRow(s, 'en')?.value, '1,020 · 21%');
    for (const lang of ['en', 'tr']) {
      const shown = texts(svgOf(s, 'peak-hour', lang));
      assert.ok(shown.includes(lateRow(s, lang).value), `${lang}: ${JSON.stringify(shown)}`);
      assert.ok(!shown.some((t) => t.includes('…')), `${lang}: ${JSON.stringify(shown)}`);
    }
  });

  test('just under 1,000 the full "N commits · P%" form is kept in en and tr', () => {
    const s = spread(166);
    assert.equal(s.lateNights.commits, 996);
    assert.equal(lateRow(s, 'en')?.value, '996 commits · 21%');
    assert.equal(lateRow(s, 'tr')?.value, '996 commit · %21');
  });

  test('the short form is used only when the full one would be cut', () => {
    // "1,000 commits · 9%" fits on a row, so a one-digit percent keeps the full form.
    assert.equal(rowValueFits('1,000 commits · 9%'), true);
    for (const mult of [1, 100, 167, 200]) {
      const s = spread(mult);
      const late = shownLateNights(s);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const row = lateRow(s, lang);
        if (!row) continue;
        const pct = L.pct(late.percent);
        const full = lang === 'en' ? `${L.num(late.commits)} commit${late.commits === 1 ? '' : 's'} · ${pct}` : `${L.num(late.commits)} commit · ${pct}`;
        assert.equal(row.value, rowValueFits(full) ? full : `${L.num(late.commits)} · ${pct}`, `${mult} ${lang}`);
        assert.ok(rowValueFits(row.value), `${mult} ${lang}: "${row.value}" is cut`);
      }
    }
  });

  test('a "Latest night" row, when there is one, is drawn whole and uses latestNightValue', () => {
    for (const mult of [1, 5, 170]) {
      for (const s of [clear(mult), spread(mult)]) {
        for (const lang of ['en', 'tr']) {
          const row = (specOf(s, 'peak-hour', lang).lines ?? []).find((r) => r.label === LANGS[lang].peak.latestLabel);
          if (row) {
            assert.ok(rowValueFits(row.value), `${lang}: "${row.value}"`);
            assert.equal(row.value, latestNightValue(shownLateNights(s).latest, LANGS[lang]));
          }
          assert.ok(!texts(svgOf(s, 'peak-hour', lang)).some((t) => t.includes('…')));
        }
      }
    }
  });
});

describe('"Latest night" row value: full date when it fits, else without the year', () => {
  const at = (date, hour, minute) => ({ date, hour, minute });

  test('English: the full date never fits, so the year-less form is used', () => {
    assert.equal(rowValueFits('4:12 AM · Mar 3, 2024'), false);
    assert.equal(latestNightValue(at('2024-03-03', 4, 12), en), '4:12 AM · Mar 3');
    assert.equal(latestNightValue(at('2026-09-30', 0, 59), en), '12:59 AM · Sep 30');
    for (let h = 0; h < 5; h++) for (let mo = 1; mo <= 12; mo++) for (const d of [1, 28]) {
      const v = latestNightValue(at(`2024-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, h, 59), en);
      assert.ok(v && rowValueFits(v) && !v.includes('2024'), v);
    }
  });

  test('Turkish: the full date when it fits, else the year-less form', () => {
    assert.equal(latestNightValue(at('2024-03-03', 4, 12), tr), '04:12 · 3 Mar 2024');
    assert.equal(rowValueFits('04:12 · 28 Oca 2024'), false);
    assert.equal(latestNightValue(at('2024-01-28', 4, 12), tr), '04:12 · 28 Oca');
  });

  test('invalid input: null', () => {
    for (const bad of [null, undefined, {}, at('2024-02-30', 4, 0), at('2024-03-03', null, 0)]) assert.equal(latestNightValue(bad, en), null);
  });

  test('the recap and wrapped.md keep the full date', () => {
    const s = statsOf([commit('2024-03-03T04:12:00+03:00'), commit('2024-03-04T12:00:00+03:00')]);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /latest 4:12 AM on Mar 3, 2024/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /latest at 4:12 AM on Mar 3, 2024/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /en geç 3 Mar 2024 04:12/);
  });
});

describe('totals merges row: only when drawn whole, else the outro panel', () => {
  /** `n` commits, every other one a "Merge pull request #i" merge, one author, roomy totals card. */
  const merged = (count) => {
    const cs = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(Date.parse('2025-01-01T10:00:00Z') + i * 600e3).toISOString().slice(0, 19) + 'Z';
      cs.push(commit(d, { subject: i % 2 ? `Merge pull request #${i} from a/b` : 'work', parents: i % 2 ? ['a', 'b'] : ['p'] }));
    }
    return statsOf(cs);
  };
  const ctxOf = (lang) => ({ L: LANGS[lang], repos: undefined });
  const mergesRowOf = (s, lang) => (specOf(s, 'totals', lang).lines ?? []).find((r) => r.label === LANGS[lang].totals.mergesLabel(1, 1));
  const panelOf = (s, lang) => {
    const chart = specOf(s, 'outro', lang).chart;
    return (Array.isArray(chart) ? chart : []).find((c) => c?.kind === 'callout' && c.title === LANGS[lang].outro.merges);
  };

  test('rowFits: the label is cut next to a wide value', () => {
    assert.equal(rowFits({ label: 'Merged PRs / merges', value: '200 / 200' }), true);
    assert.equal(rowFits({ label: 'Merged PRs / merges', value: '10,001 / 10,001' }), false);
    assert.equal(rowFits({ label: 'Born / buried', value: '1,000 commits · 21%' }), false);
  });

  test('200 / 200: on the totals card, not on the outro', () => {
    const s = merged(400);
    for (const lang of ['en', 'tr']) {
      const row = mergesRowOf(s, lang);
      assert.ok(row, lang);
      assert.equal(row.value, LANGS[lang].totals.mergesValue(200, 200, ''));
      assert.equal(mergesOnTotals(s, ctxOf(lang)), true);
      assert.equal(panelOf(s, lang), undefined);
    }
  });

  test('10,001 / 10,001: the label would be cut ("Merged PRs / mer…"), so the outro panel shows it', () => {
    const s = merged(20002);
    assert.deepEqual(s.merges, { commits: 10001, share: 0.5, pullRequests: 10001 });
    for (const lang of ['en', 'tr']) {
      assert.equal(mergesRowOf(s, lang), undefined, lang);
      assert.equal(mergesOnTotals(s, ctxOf(lang)), false);
      assert.ok(panelOf(s, lang), `${lang}: the merges panel is on the outro`);
      assert.ok(!texts(svgOf(s, 'totals', lang)).some((t) => t.includes('…')));
    }
  });
});

describe('outro merges panel: the note is never cut', () => {
  /** 300 commits, half of them PR merges, paired and adding files (no room on the totals card). */
  const busy = () => {
    const cs = [];
    for (let i = 0; i < 300; i++) {
      const d = new Date(Date.parse('2025-01-01T10:00:00Z') + i * 3600e3 * 7).toISOString().slice(0, 19) + 'Z';
      cs.push(commit(d, {
        subject: i % 2 ? `Merge pull request #${i} from a/b` : `feat ${i}`,
        author: i % 3 ? 'Ada' : 'Bob',
        email: i % 3 ? 'ada@example.com' : 'bob@example.com',
        files: [{ path: `src/f${i % 50}.js`, added: 3, removed: 1 }],
        parents: i % 2 ? ['a', 'b'] : ['p'],
        coAuthors: i % 5 ? [] : [{ name: 'Cy', email: 'cy@example.com' }],
        born: i % 7 ? [] : [`src/n${i}.js`],
      }));
    }
    return statsOf(cs);
  };

  test('Turkish: "150 merge commit · %50" (was "… commit\'lerin %50…")', () => {
    const s = busy();
    assert.deepEqual(s.merges, { commits: 150, share: 0.5, pullRequests: 150 });
    const panel = (specOf(s, 'outro', 'tr').chart ?? []).find((c) => c?.kind === 'callout' && c.title === tr.outro.merges);
    assert.ok(panel, 'the merges panel is on the outro');
    assert.equal(panel.note, '150 merge commit · %50');
    assert.ok(measureText(panel.note, CALLOUT_NOTE.size) <= CALLOUT_NOTE.maxWidth);
    assert.ok(texts(svgOf(s, 'outro', 'tr')).includes('150 merge commit · %50'));
  });

  test('English keeps the full note, which fits', () => {
    const s = busy();
    const panel = (specOf(s, 'outro', 'en').chart ?? []).find((c) => c?.kind === 'callout' && c.title === en.outro.merges);
    assert.ok(panel);
    assert.equal(panel.note, '150 merge commits · 50% of commits');
    assert.ok(texts(svgOf(s, 'outro', 'en')).includes('150 merge commits · 50% of commits'));
  });

  test('the short notes', () => {
    assert.equal(en.outro.mergedNoteShort(3, 8, '6%'), '8 merge commits · 6%');
    assert.equal(en.outro.mergedNoteShort(0, 8, '6%'), '6%');
    assert.equal(en.outro.mergedNoteShort(3, 0, '<1%'), null);
    assert.equal(tr.outro.mergedNoteShort(3, 1234, '%6'), '1.234 merge commit · %6');
    assert.equal(tr.outro.mergedNoteShort(3, 0, '%6'), null);
    assert.equal(tr.outro.mergedNoteShort(0, 8, '%6'), '%6');
    assert.equal(en.outro.mergedNoteShort(3, 1, '<1%'), '1 merge commit · <1%');
    assert.equal(en.outro.mergedNoteShort(3, 1234567, '50%'), '1,234,567 merge commits · 50%');
  });

  const fitsNote = (t) => measureText(t, CALLOUT_NOTE.size) <= CALLOUT_NOTE.maxWidth;

  test('Turkish full note fits up to 9 merge commits and is cut from 10 on (two-digit share)', () => {
    assert.equal(fitsNote(tr.outro.mergedNote(1, 9, '%50')), true);
    assert.equal(fitsNote(tr.outro.mergedNote(1, 10, '%50')), false);
    assert.equal(fitsNote(tr.outro.mergedNoteShort(1, 10, '%50')), true);
  });

  test('English full note fits for any realistic count; short notes always fit', () => {
    for (const m of [1, 99, 99999]) for (const sh of ['<1%', '6%', '100%']) {
      assert.equal(fitsNote(en.outro.mergedNote(1, m, sh)), true, `${m} ${sh}`);
    }
    // Only absurd counts need the short form in English.
    assert.equal(fitsNote(en.outro.mergedNote(1, 9999999, '100%')), false);
    for (const L of [en, tr]) for (const sh of ['<1%', '%100', '100%']) {
      assert.equal(fitsNote(L.outro.mergedNoteShort(1, 123456789, sh)), true, sh);
      assert.equal(fitsNote(L.outro.mergedNoteShort(0, 123456789, sh)), true, sh);
    }
  });
});

describe('relative windows: the math the audit verified', () => {
  test('month-end clamp, leap days, 0 units, case and whitespace', () => {
    const cases = [
      ['1m', '2026-03-31', '2026-02-28'], ['1m', '2024-03-31', '2024-02-29'], ['1m', '2026-01-31', '2025-12-31'],
      ['13m', '2026-01-15', '2024-12-15'], ['1y', '2024-02-29', '2023-02-28'], ['4y', '2024-02-29', '2020-02-29'],
      ['0d', TODAY, TODAY], ['0m', '2026-02-28', '2026-02-28'], ['12w', '2026-01-05', '2025-10-13'],
      ['9999d', TODAY, '1999-05-23'], [' 6M ', TODAY, '2026-04-07'], ['007D', TODAY, '2026-09-30'],
    ];
    for (const [v, today, want] of cases) assert.equal(resolveRelativeDate(v, today), want, `${v} from ${today}`);
    for (const v of ['30 d', '-5d', '1.5m', '1e3d', '30', 'd', '10000d']) assert.equal(resolveRelativeDate(v, TODAY), null, v);
  });

  test('the 1970 boundary and the 9999 cap in parseCli', () => {
    assert.equal(parseCli(['--since', '56y'], { today: TODAY }).since, '1970-10-07');
    assert.throws(() => parseCli(['--since', '57y'], { today: TODAY }), /before 1970/);
    assert.throws(() => parseCli(['--since', '9999y'], { today: TODAY }), /before 1970/);
    assert.throws(() => parseCli(['--since', '10000d'], { today: TODAY }), /0 to 9999 units/);
    assert.throws(() => parseCli(['--since', '0d', '--until', '1d'], { today: TODAY }), /--since 2026-10-07 is after --until 2026-10-06/);
    const o = parseCli(['--since', '1y', '--until', '6m'], { today: TODAY });
    assert.deepEqual([o.since, o.until], ['2025-10-07', '2026-04-07']);
  });
});

describe('seeded fuzz: merges / late nights never leak or break, en + tr', () => {
  let seed = 19;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const offs = ['+00:00', '+03:00', '-05:00', '+14:00', '-12:00', '+05:30'];
  const subjects = ['feat: x (#12)', 'Merge pull request #7 from ada@example.com/x', "Merge branch 'main'", 'fix (#0)',
    'x (pull request #99)', 'Merge pull request #0012 from a/b', 'work', 'Revert "x (#12)" (#13)', 'y (#1234567890)'];
  const BAD = /NaN|undefined|\[object|example\.com/;
  const LEAK = ['pull requests', 'merge commits', 'Late nights', 'Latest night', 'of commits', 'Merged PRs', 'You merged', 'latest '];
  const start = Date.parse('2025-06-01T00:00:00Z');

  test('80 histories', () => {
    for (let it = 0; it < 80; it += 1) {
      const k = 1 + Math.floor(rnd() * 40);
      const list = [];
      for (let i = 0; i < k; i += 1) {
        const t = new Date(start + Math.floor(rnd() * 500) * 86400000 + Math.floor(rnd() * 86400000));
        let d = t.toISOString().slice(0, 19) + pick(offs);
        if (rnd() < 0.05) d = '2099-05-01T03:10:00Z';
        if (rnd() < 0.05) d = 'bad';
        list.push(commit(d, { subject: pick(subjects), parents: rnd() < 0.3 ? ['a', 'b'] : ['p'] }));
      }
      const multi = rnd() < 0.3;
      const commits = multi
        ? mergeHistories([{ label: 'api', commits: list.slice(0, k >> 1) }, { label: 'web', commits: list.slice(k >> 1) }]).commits
        : list;
      const ctx = `history ${it} (${k} commits${multi ? ', 2 repos' : ''})`;
      const stats = statsOf(commits, multi ? { repos: ['api', 'web'] } : {});
      const late = shownLateNights(stats);
      const merges = shownMerges(stats.merges);
      assert.equal(stats.lateNights.commits, late?.commits ?? 0, `${ctx}: stats.lateNights and the shown line agree`);

      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const opts = { repoName: 'demo', today: TODAY, lang };
        const recap = formatSummary(stats, opts);
        const md = buildMarkdown(stats, opts);
        const cards = buildCards(stats, opts);
        const outputs = [['recap', recap], ['wrapped.md', md], ...cards.map((c) => [`card ${c.id}`, c.svg])];
        for (const [what, text] of outputs) {
          assert.doesNotMatch(text, BAD, `${ctx} ${lang} ${what}: ${text.match(/.{0,30}(NaN|undefined|\[object|example\.com).{0,30}/)?.[0]}`);
          if (lang === 'tr') for (const w of LEAK) assert.ok(!text.includes(w), `${ctx} tr ${what}: English "${w}"`);
        }
        // Every 1.9 row on the power-hour and totals cards is drawn whole.
        for (const id of ['peak-hour', 'totals']) {
          for (const r of specOf(stats, id, lang).lines ?? []) {
            assert.ok(rowValueFits(r.value), `${ctx} ${lang} ${id}: "${r.value}" is cut`);
            if (r.label === LANGS[lang].peak.latestLabel || (id === 'totals' && merges && r.label === LANGS[lang].totals.mergesLabel(merges.pullRequests, merges.commits))) {
              assert.ok(rowFits(r), `${ctx} ${lang} ${id}: "${r.label}" / "${r.value}" is cut`);
            }
          }
        }

        // Recap and wrapped.md: the same late-nights line and merges values.
        const recapLate = recap.split('\n').find((l) => l.includes(`${L.recap.lateNights} `));
        const mdLate = md.split('\n').find((l) => l.includes(L.markdown.lateNights));
        assert.equal(Boolean(recapLate), Boolean(late), `${ctx} ${lang}: recap late nights`);
        assert.equal(Boolean(mdLate), Boolean(late), `${ctx} ${lang}: md late nights`);
        if (late) {
          const ofCommits = L.recap.ofCommits(late.percent > 0 ? L.pct(late.percent) : `<${L.pct(1)}`);
          for (const line of [recapLate, mdLate]) assert.ok(line.includes(ofCommits), `${ctx} ${lang}: "${ofCommits}" in ${line}`);
          if (late.latest) {
            const clock = L.clock(late.latest.hour, late.latest.minute);
            for (const line of [recapLate, mdLate]) assert.ok(line.includes(clock), `${ctx} ${lang}: ${clock} in ${line}`);
          }
        }
        const recapMerges = recap.split('\n').find((l) => l.includes(`${L.recap.merges} `));
        const mdMerges = md.split('\n').find((l) => l.includes(`**${L.markdown.merges}:**`) || l.includes(`**${L.markdown.merges.replace(/'/g, "\\'")}:**`));
        assert.equal(Boolean(recapMerges), Boolean(merges), `${ctx} ${lang}: recap merges`);
        assert.equal(Boolean(mdMerges), Boolean(merges), `${ctx} ${lang}: md merges`);
        if (merges) {
          const value = L.recap.mergesValue(merges.pullRequests, merges.commits, mergeShareText(merges, L));
          assert.ok(recapMerges.includes(value), `${ctx} ${lang}: ${value} in ${recapMerges}`);
          assert.equal(L.markdown.mergesValue(merges.pullRequests, merges.commits, mergeShareText(merges, L)), value.replace(/ · /g, ', '));
        }
      }
    }
  });
});

describe('CHANGELOG [Unreleased]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
  const unreleased = text.slice(text.indexOf('## [Unreleased]'), text.indexOf('## [1.8.0]')).replace(/\s+/g, ' ');

  test('names the "Latest night" row by its label', () => {
    assert.match(unreleased, /"Latest night" row/);
    assert.doesNotMatch(unreleased, /"Latest commit" row/);
    assert.equal(en.peak.latestLabel, 'Latest night');
  });

  test('does not say late nights are the Night Owl hours', () => {
    assert.doesNotMatch(unreleased, /same hours as the Night Owl personality \(22:00–03:59\)/);
  });
});
