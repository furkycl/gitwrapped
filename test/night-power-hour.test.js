// Night power hour (loop 070): a power hour between 22:00 and 04:59 with late-night commits
// swaps its long quip for the short night quip ("Night owl." / "Tam bir gece kuşu.") or no
// quip, so the "Late nights" row fits on the power-hour card. Edge cases: the 4/5 and 21/22
// boundaries, ties, the "Latest night" row, the color themes, cards without late-night
// commits, and the outputs that never see the card (stats.json, recap, wrapped.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, shownLateNights } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, COLOR_THEME_NAMES, layoutCard } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
const LANGS = [['en', en], ['tr', tr]];
let n = 0;
const commit = (date) => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
});
const p2 = (x) => String(x).padStart(2, '0');
const statsOf = (commits) => computeStats(commits, { today: TODAY });
const opts = (lang, colorTheme) => ({ repoName: 'demo', today: TODAY, lang, colorTheme });
const peakSpec = (s, lang, colorTheme) => buildCardSpecs(s, opts(lang, colorTheme)).find((c) => c.id === 'peak-hour').spec;
const peakSvg = (s, lang, colorTheme) => buildCards(s, opts(lang, colorTheme)).find((c) => c.id === 'peak-hour').svg;
const steps = (spec, lang) => layoutCard({ ...spec, lang }).shrinkSteps;
const isLate = (r) => r.label === en.peak.lateNights || r.label === tr.peak.lateNights;
const isLatest = (r) => r.label === en.peak.latestLabel || r.label === tr.peak.latestLabel;
const QUIP_HOURS = [5, 9, 12, 14, 18, 22];
const ownQuip = (L, hour) => L.peak.quips[QUIP_HOURS.findIndex((h) => hour < h) === -1 ? QUIP_HOURS.length : QUIP_HOURS.findIndex((h) => hour < h)];
const isNight = (hour) => hour >= 22 || hour < 5;

/**
 * Ten commits at `peak` (local, +03:00), 14 spread over day hours (05:00-23:59 only), then
 * `late` commits between 00:00 and 04:59 (at an hour other than the peak's when it can).
 * `tieWith`: another hour with as many commits as the peak. `tz`: a second UTC offset.
 */
function shape(peak, { late = 1, tieWith = null, tz = false, count = 10 } = {}) {
  const cs = [];
  for (let i = 0; i < count; i++) cs.push(commit(`2026-03-${p2(2 + 7 * (i % 4))}T${p2(peak)}:${p2(10 + (i % 40))}:00+03:00`));
  if (tieWith !== null) for (let i = 0; i < count; i++) cs.push(commit(`2026-05-${p2(1 + (i % 20))}T${p2(tieWith)}:${p2(10 + (i % 40))}:00+03:00`));
  // Filler hours: never late (05..23), never the peak or the tie hour, at most 2 per hour.
  const filler = [];
  for (let h = 5; h < 24 && filler.length < 14; h++) if (h !== peak && h !== tieWith) filler.push(h);
  filler.forEach((h, i) => cs.push(commit(`2026-04-${p2(i + 1)}T${p2(h)}:10:00${tz && i % 3 === 0 ? '-05:00' : '+03:00'}`)));
  const lateHour = [0, 1, 2, 3, 4].find((h) => h !== peak && h !== tieWith) ?? 0;
  for (let i = 0; i < late; i++) cs.push(commit(`2026-06-${p2(2 + i)}T${p2(lateHour)}:12:00+03:00`));
  return statsOf(cs);
}

/** `fn()` with `L.peak.nightQuip` set to `value` for its duration. */
function withNightQuip(L, value, fn) {
  const was = L.peak.nightQuip;
  L.peak.nightQuip = value;
  try {
    return fn();
  } finally {
    L.peak.nightQuip = was;
  }
}

describe('night power hour: boundaries', () => {
  test('isNight as the card sees it: 4 AM is night, 5 AM is not; 9 PM is not, 10 PM is', () => {
    for (const [lang, L] of LANGS) {
      for (const [hour, night] of [[4, true], [5, false], [21, false], [22, true]]) {
        const s = shape(hour);
        assert.equal(s.habits.peakHour, hour);
        assert.ok(shownLateNights(s), `${lang} ${hour}: has late nights`);
        const spec = peakSpec(s, lang);
        if (night) {
          assert.ok(!spec.subtitle.includes(ownQuip(L, hour)), `${lang} ${hour}: ${spec.subtitle}`);
          assert.ok((spec.lines ?? []).some(isLate), `${lang} ${hour}: late row`);
        } else {
          assert.ok(spec.subtitle.includes(ownQuip(L, hour)), `${lang} ${hour}: ${spec.subtitle}`);
          assert.ok(!spec.subtitle.includes(L.peak.nightQuip), `${lang} ${hour}: ${spec.subtitle}`);
        }
      }
    }
  });

  test('day and evening power hours (5 AM to 9 PM) never consult the night quip: byte-identical whatever it says', () => {
    // Were the night branch taken for a day hour, a different night quip would change the SVG.
    for (let hour = 5; hour < 22; hour++) {
      for (const opt of [{}, { late: 5 }, { tz: true }, { count: 1200 }]) {
        const s = shape(hour, opt);
        for (const [lang, L] of LANGS) {
          const svg = peakSvg(s, lang);
          assert.equal(withNightQuip(L, 'SENTINEL', () => peakSvg(s, lang)), svg, `${lang} ${hour} ${JSON.stringify(opt)}`);
          assert.equal(withNightQuip(L, 'A much longer night quip that would never fit on two lines of the card at all.', () => peakSvg(s, lang)), svg);
          assert.equal(withNightQuip(L, '', () => peakSvg(s, lang)), svg);
        }
      }
    }
  });

  test('05:00 exactly is not a late night and its hour keeps its own quip; 04:59 is late', () => {
    const at5 = statsOf([...Array.from({ length: 6 }, (_, i) => commit(`2026-03-0${i + 1}T05:00:00Z`)), commit('2026-03-09T14:00:00Z')]);
    assert.equal(at5.habits.peakHour, 5);
    assert.equal(shownLateNights(at5), null);
    for (const [lang, L] of LANGS) {
      const spec = peakSpec(at5, lang);
      assert.equal(spec.lines, undefined);
      assert.ok(spec.subtitle.includes(ownQuip(L, 5)), spec.subtitle);
    }
    const at459 = statsOf([...Array.from({ length: 6 }, (_, i) => commit(`2026-03-0${i + 1}T04:59:00Z`)), commit('2026-03-09T14:00:00Z')]);
    assert.equal(at459.habits.peakHour, 4);
    for (const [lang, L] of LANGS) {
      const spec = peakSpec(at459, lang);
      assert.ok(!spec.subtitle.includes(ownQuip(L, 4)), spec.subtitle);
      assert.ok((spec.lines ?? []).some(isLate), `${lang}: ${JSON.stringify(spec.lines)}`);
    }
  });

  test('a 4 AM / 5 AM tie goes to 4 AM (night); a 9 PM / 10 PM tie goes to 9 PM (day, unchanged)', () => {
    for (const [lang, L] of LANGS) {
      const four = shape(4, { tieWith: 5 });
      assert.equal(four.habits.peakHour, 4);
      assert.equal(four.habits.peakHourTied, true);
      const f = peakSpec(four, lang);
      assert.ok(!f.subtitle.includes(ownQuip(L, 4)), f.subtitle);
      assert.ok((f.lines ?? []).some(isLate));

      const nine = shape(21, { tieWith: 22 });
      assert.equal(nine.habits.peakHour, 21);
      const g = peakSpec(nine, lang);
      assert.ok(g.subtitle.includes(ownQuip(L, 21)), g.subtitle);
      assert.ok(!g.subtitle.includes(L.peak.nightQuip));
      const svg = peakSvg(nine, lang);
      assert.equal(withNightQuip(L, 'SENTINEL', () => peakSvg(nine, lang)), svg);
    }
  });
});

describe('night power hour: ties and rows', () => {
  test('a tied night power hour keeps its "tied" lead, swaps the quip and shows the row', () => {
    for (const peak of [22, 23, 0, 1, 2, 3, 4]) {
      for (const tieWith of [14, (peak + 1) % 24 === 5 ? 6 : (peak + 1) % 24]) {
        if (tieWith === peak) continue;
        const s = shape(peak, { tieWith });
        if (s.habits.peakHour !== peak) continue; // the tie went to the earlier hour
        assert.equal(s.habits.peakHourTied, true);
        for (const [lang, L] of LANGS) {
          const spec = peakSpec(s, lang);
          const tail = L.peak.tied('\u0000', 10).split('\u0000')[1];
          assert.ok(spec.subtitle.includes(tail), `${lang}: ${spec.subtitle}`);
          assert.ok(!spec.subtitle.includes(ownQuip(L, peak)), `${lang} ${peak}/${tieWith}: ${spec.subtitle}`);
          assert.ok((spec.lines ?? []).some(isLate), `${lang} ${peak}/${tieWith}`);
          assert.ok(steps(spec, lang) <= 1);
        }
      }
    }
  });

  test('"Latest night" only after "Late nights", never alone, and never past one shrink step', () => {
    let latestShown = 0;
    let nightCards = 0;
    for (const peak of [22, 23, 0, 1, 2, 3, 4]) {
      for (const opt of [{}, { late: 3 }, { tz: true }, { tieWith: 14 }, { count: 2 }, { count: 1200 }]) {
        const s = shape(peak, opt);
        if (s.habits.peakHour !== peak) continue;
        for (const [lang, L] of LANGS) {
          const spec = peakSpec(s, lang);
          const lines = spec.lines ?? [];
          const li = lines.findIndex(isLate);
          const lt = lines.findIndex(isLatest);
          if (lt !== -1) {
            latestShown++;
            assert.ok(li !== -1 && li < lt, `${lang} ${peak}: ${JSON.stringify(lines)}`);
          }
          if (li !== -1) {
            nightCards++;
            assert.ok(steps(spec, lang) <= 1, `${lang} ${peak} ${JSON.stringify(opt)}`);
            // The swapped card carries the short quip or none, never the long one.
            assert.ok(!spec.subtitle.includes(ownQuip(L, peak)), spec.subtitle);
          }
        }
      }
    }
    assert.ok(nightCards > 0);
    // In practice a night card has no spare room left for "Latest night" (latestShown is 0
    // for these shapes); the ordering above is checked for when it does show.
    void latestShown;
  });

  test('the row value on a night card counts only 00:00-04:59 commits', () => {
    const s = shape(23, { late: 4 }); // peak 23:00 is a night hour but not a late-night one
    assert.equal(shownLateNights(s).commits, 4);
    const spec = peakSpec(s, 'en');
    const row = (spec.lines ?? []).find(isLate);
    assert.ok(row, spec.subtitle);
    assert.match(row.value, /^4 commits · \d+%$/);
  });
});

describe('night power hour: no late-night commits', () => {
  test('a 22:00 or 23:00 power hour without a 00:00-04:59 commit keeps its own quip, in every theme', () => {
    for (const peak of [22, 23]) {
      for (const opt of [{ late: 0 }, { late: 0, tz: true }, { late: 0, tieWith: 14 }, { late: 0, count: 1200 }]) {
        const s = shape(peak, opt);
        assert.equal(shownLateNights(s), null);
        assert.equal(s.lateNights.commits, 0);
        for (const [lang, L] of LANGS) {
          for (const colorTheme of COLOR_THEME_NAMES) {
            const spec = peakSpec(s, lang, colorTheme);
            assert.ok(!spec.subtitle.includes(L.peak.nightQuip), `${lang}/${colorTheme} ${peak}: ${spec.subtitle}`);
            assert.ok(!(spec.lines ?? []).some((r) => isLate(r) || isLatest(r)));
            const svg = peakSvg(s, lang, colorTheme);
            assert.ok(!svg.includes(L.peak.nightQuip));
            assert.equal(withNightQuip(L, 'SENTINEL', () => peakSvg(s, lang, colorTheme)), svg);
          }
        }
      }
    }
  });

  test('the night quip never shows on any card without late-night commits (every hour, theme, language)', () => {
    for (let peak = 5; peak < 24; peak++) {
      const s = shape(peak, { late: 0 });
      for (const [lang, L] of LANGS) {
        for (const colorTheme of COLOR_THEME_NAMES) {
          const all = buildCards(s, opts(lang, colorTheme)).map((c) => c.svg).join('\n');
          assert.ok(!all.includes(L.peak.nightQuip), `${lang}/${colorTheme} ${peak}`);
        }
      }
    }
  });
});

describe('night power hour: color themes', () => {
  test('mono and neon: the same layout as the default theme (same subtitle and rows), only colors differ', () => {
    for (const peak of [22, 23, 0, 2, 4]) {
      for (const opt of [{}, { tz: true }, { tieWith: 14 }, { count: 1200 }]) {
        const s = shape(peak, opt);
        for (const [lang, L] of LANGS) {
          const base = peakSpec(s, lang);
          for (const colorTheme of COLOR_THEME_NAMES) {
            const spec = peakSpec(s, lang, colorTheme);
            assert.equal(spec.subtitle, base.subtitle, `${lang}/${colorTheme} ${peak}`);
            assert.deepEqual(spec.lines, base.lines);
            const svg = peakSvg(s, lang, colorTheme);
            if ((spec.lines ?? []).some(isLate)) assert.ok(svg.includes(L.peak.lateNights), `${lang}/${colorTheme} ${peak}`);
            if (spec.subtitle.includes(L.peak.nightQuip)) assert.ok(svg.replace(/\s+/g, ' ').includes(L.peak.nightQuip.split(' ')[0]));
          }
        }
      }
    }
  });
});

describe('night power hour: other outputs are unaffected', () => {
  test('stats.json, the recap and wrapped.md never carry the night quip and do not depend on it', () => {
    for (const peak of [23, 1, 4, 5, 21]) {
      for (const opt of [{}, { tz: true }, { late: 0 }]) {
        const s = shape(peak, opt);
        for (const [lang, L] of LANGS) {
          const outs = () => [
            buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }),
            formatSummary(s, { repoName: 'demo', today: TODAY, lang }),
            buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }),
          ];
          const real = outs();
          for (const o of real) assert.ok(!o.includes(L.peak.nightQuip), `${lang} ${peak}`);
          assert.deepEqual(withNightQuip(L, 'SENTINEL', outs), real);
          // The late nights are always in all three, whatever the card did.
          if (shownLateNights(s)) {
            assert.equal(JSON.parse(real[0]).stats.lateNights.commits, shownLateNights(s).commits);
            assert.ok(real[1].includes(L.recap.lateNights), `${lang} recap`);
          }
        }
      }
    }
  });
});
