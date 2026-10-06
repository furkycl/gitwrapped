// Card design v2, tester additions: PNG rasterization of every card (normal / empty /
// stress), the HTML viewer with the v2 cards (unique ids, resolvable url(#id) refs, CSP),
// formatDateRange edge cases vs. totals.firstDay/lastDay, huge counts in tiles and the
// share image, and the exact hour / weekday chart mapping.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadResvg, pngSize, renderPng } from '../src/png.js';
import { buildCards, buildCardSpecs, CARD_IDS, cardIdsFor, footerText, formatDateRange, formatDay, formatNumber, renderShareCard } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { hourLabel } from '../src/stats/time.js';
import { buildViewerHtml, CSP } from '../src/viewer.js';
import { generate } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';
const INJECT = `<script>&"'`;

let Resvg = null;
let resvgError = null;
try {
  Resvg = await loadResvg();
} catch (err) {
  resvgError = err.message;
}

function commit(date, subject = 'feat: x', files = [{ path: 'src/app.js', added: 3, removed: 1 }]) {
  return {
    hash: `${date}-${subject}`, author: 'A', email: 'a@x', date, subject, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

const normalStats = () => computeStats([
  commit('2026-10-04T20:10:00+03:00', 'feat: start'),
  commit('2026-10-04T20:40:00+03:00', 'fix: bug', [{ path: 'README.md', added: 10, removed: 2 }]),
  commit('2026-10-04T23:05:00+03:00', 'feat: more'),
  commit('2026-10-05T09:00:00+03:00', 'chore: tidy', [{ path: 'test/a/b/c.test.js', added: 40, removed: 0 }]),
], { today: TODAY });

const emptyStats = () => computeStats([], { today: TODAY });

function stressStats() {
  const s = normalStats();
  const big = Number.MAX_SAFE_INTEGER;
  s.totals = { ...s.totals, commits: big, linesAdded: 1e21, linesRemoved: big, activeDays: 1, filesTouched: 1e300, authors: 1e6, firstDay: '1970-01-01', lastDay: '2999-12-31' };
  s.habits.byHour = s.habits.byHour.map((_, i) => (i % 2 ? big : 1));
  s.habits.byWeekday = [big, 1, 2, 3, 4, 5, big];
  s.habits.peakHourCount = big;
  s.habits.peakHourLabel = `3 AM ${INJECT}`;
  s.streaks = { longest: { length: big, start: '1970-01-01', end: '2999-12-31' }, current: { length: big, start: 'a', end: 'b' } };
  s.hotFiles = [
    { path: `${'deeply/nested/'.repeat(30)}🚀/file name & <stuff>.js`, commits: big, linesAdded: 1e21, linesRemoved: big },
    { path: `x/${'y'.repeat(400)}`, commits: 1, linesAdded: 1, linesRemoved: 0 },
  ];
  s.personality = {
    archetype: { id: 'x', name: `Night Owl ${INJECT} 🦉 ${'w'.repeat(80)}`, roast: 'r '.repeat(200), reason: 'q '.repeat(200) },
    scores: [{ id: 'x', name: 'Night Owl', score: 1 }, { id: 'y', name: 'Early Bird', score: 0.5 }],
  };
  // A huge team, long / hostile names, and "you" outside the top five (a sixth row).
  const person = (name, rank) => ({ name, rank, commits: big, added: 1e21, removed: big, share: 100 / 6 });
  s.contributors = {
    total: big,
    top: [person(`${'Ada '.repeat(60)}${INJECT} 🚀`, 1), person('W'.repeat(300), 2), person(INJECT, 3), person('Bob', 4), person('Cy', 5)],
    you: { ...person(`You ${'y'.repeat(200)}`, big), share: 0.01 },
  };
  return s;
}
const STRESS_OPTS = { repoName: `${'r'.repeat(150)}${INJECT}🚀${'R'.repeat(140)}`, since: `2020-01-01 ${INJECT}`, author: `Ada ${INJECT}` };

const SCENARIOS = [
  ['normal', normalStats, { repoName: 'demo' }],
  ['empty', emptyStats, { repoName: 'empty-repo' }],
  ['stress', stressStats, STRESS_OPTS],
];

const BAD = /\b(?:NaN|undefined|Infinity|null)\b|\[object Object\]|\d(?:\.\d+)?e[+-]?\d/;
const textNodes = (svg) => [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1]).filter((t) => t.trim());
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

// --- (1) PNG rasterization ---------------------------------------------------------------

describe('PNG rendering of every v2 card', () => {
  for (const [name, make, opts] of SCENARIOS) {
    test(`${name}: all cards rasterize to 1080x1920, share to 1200x630`, async (t) => {
      if (!Resvg) {
        t.skip(`resvg unavailable: ${resvgError}`);
        return;
      }
      const cards = buildCards(make(), opts);
      // The stress stats have a team (11 cards), normal and empty ones a single author (10).
      assert.deepEqual(cards.map((c) => c.id), name === 'stress' ? [...CARD_IDS] : cardIdsFor({}));
      for (const { id, svg } of cards) {
        const png = await renderPng(svg, { width: 1080 });
        assert.deepEqual(pngSize(png), { width: 1080, height: 1920 }, `${name}/${id}`);
        assert.ok(png.length > 10_000, `${name}/${id}: suspiciously small PNG (${png.length} bytes)`);
      }
      const share = await renderPng(renderShareCard(make(), opts), { width: 1200 });
      assert.deepEqual(pngSize(share), { width: 1200, height: 630 });
    });
  }
});

// --- (2) the HTML viewer -----------------------------------------------------------------

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

function checkViewer(html, where, cardIds = CARD_IDS) {
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `${where}: duplicate ids`);
  // Every in-page url(#x) / href="#x" reference resolves to an id that exists.
  const refs = [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= cardIds.length * 3, `${where}: gradient refs`);
  for (const r of refs) assert.ok(ids.includes(r), `${where}: url(#${r}) has no target`);
  // Card SVG ids are all per-card prefixed.
  for (const id of cardIds) {
    assert.ok(ids.includes(`gw-${id}-bg`), `${where}: gw-${id}-bg`);
    assert.ok(ids.includes(`gw-${id}-glow`), `${where}: gw-${id}-glow`);
  }
  // CSP: the exact exported policy, pinned to the one inline style and script.
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(csp, CSP);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(styles.length, 1, `${where}: one <style>`);
  assert.equal(scripts.length, 1, `${where}: one <script> (no injected script from user text)`);
  assert.ok(csp.includes(`style-src ${sha(styles[0])}`), `${where}: style hash`);
  assert.ok(csp.includes(`script-src ${sha(scripts[0])}`), `${where}: script hash`);
  // CSP hashes do not cover style="" or on*="" attributes; the new charts must add none.
  assert.doesNotMatch(html, /\sstyle="/, `${where}: style attribute`);
  assert.doesNotMatch(html, /\son[a-z]+="/i, `${where}: event handler attribute`);
  assert.doesNotMatch(html, /<(?:image|use|foreignObject|a)\b/i, `${where}: external-capable element`);
}

describe('viewer with v2 cards', () => {
  for (const [name, make, opts] of SCENARIOS) {
    test(`${name}: unique ids, resolvable refs, valid CSP`, () => {
      const cards = buildCards(make(), opts);
      const html = buildViewerHtml(cards, { title: `gitwrapped · ${opts.repoName}` });
      checkViewer(html, name, cards.map((c) => c.id));
      for (const { svg } of cards) assert.ok(html.includes(svg.trim().slice(svg.indexOf('<defs>'), svg.indexOf('</defs>'))), `${name}: svg inlined`);
    });
  }

  describe('generated wrapped.html (CLI)', () => {
    let fixture;
    let out;
    before(() => {
      fixture = makeFixtureRepo();
      out = mkdtempSync(join(tmpdir(), 'gw-v2-'));
    });
    after(() => {
      fixture?.cleanup();
      if (out) rmSync(out, { recursive: true, force: true, maxRetries: 5 });
    });

    test('every id in wrapped.html is unique and the CSP matches', async () => {
      await generate({ path: fixture.dir, out, png: false }, { today: '2024-03-14' });
      const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
      checkViewer(html, 'wrapped.html');
      assert.equal((html.match(/<section class="slide/g) ?? []).length, CARD_IDS.length);
      // The v2 charts made it into the page.
      for (const cap of ['COMMITS BY HOUR', 'BY WEEKDAY', 'LINES CHANGED', 'LONGEST VS. CURRENT', 'HOTTEST FILE']) assert.ok(html.includes(`>${cap}<`), cap);
    });
  });
});

// --- (3) formatDateRange -----------------------------------------------------------------

describe('formatDateRange edge cases', () => {
  test('same day, same month, same year, cross-year', () => {
    assert.equal(formatDateRange('2026-10-04', '2026-10-04'), 'Oct 4, 2026');
    assert.equal(formatDateRange('2026-10-01', '2026-10-31'), 'Oct 1 – Oct 31, 2026');
    assert.equal(formatDateRange('2026-01-01', '2026-12-31'), 'Jan 1 – Dec 31, 2026');
    assert.equal(formatDateRange('2025-12-31', '2026-01-01'), 'Dec 31, 2025 – Jan 1, 2026');
    assert.equal(formatDateRange('1999-02-28', '2000-02-29'), 'Feb 28, 1999 – Feb 29, 2000');
    assert.equal(formatDateRange(' 2026-10-04 ', '2026-10-04\n'), 'Oct 4, 2026', 'surrounding whitespace');
  });

  test('invalid input never throws and never prints null/undefined/NaN', () => {
    const bad = [null, undefined, '', '   ', 'nope', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '26-10-04', '2026-10-04T10:00:00Z', 42, {}, [], NaN];
    for (const a of bad) {
      for (const b of [...bad, '2026-10-04']) {
        const r = formatDateRange(a, b);
        assert.equal(typeof r, 'string');
        assert.doesNotMatch(r, /null|undefined|NaN|\[object/, `${String(a)} / ${String(b)} → ${r}`);
      }
    }
    assert.equal(formatDateRange(null, undefined), '');
    assert.equal(formatDateRange('', '  '), '');
    assert.equal(formatDateRange('same', 'same'), 'same', 'identical unparsed text shown once');
    assert.equal(formatDay('2026-10-04T10:00:00Z'), null, 'a full timestamp is not a day');
  });

  test('day comes from the commit\'s own offset, not the machine TZ', () => {
    // 23:30 on Dec 31 at -05:00 is already Jan 1 in UTC; 00:10 on Jan 3 at +14:00 is
    // still Jan 2 (10:10Z) in UTC. A UTC (or machine-TZ) day would give "Jan 1 – Jan 2, 2026".
    const s = computeStats([
      commit('2025-12-31T23:30:00-05:00'),
      commit('2026-01-02T05:00:00+00:00'),
      commit('2026-01-03T00:10:00+14:00'),
    ], { today: '2026-01-05' });
    assert.equal(s.totals.firstDay, '2025-12-31');
    assert.equal(s.totals.lastDay, '2026-01-03');
    const expected = 'Dec 31, 2025 – Jan 3, 2026';
    assert.equal(formatDateRange(s.totals.firstDay, s.totals.lastDay), expected);
    assert.equal(footerText(s, { repoName: 'demo' }), `demo · ${expected}`);
    const intro = buildCards(s, { repoName: 'demo' })[0].svg;
    assert.ok(intro.includes(`>${expected}<`), 'intro callout');
    // The cards module is pure: the result is the same whatever process.env.TZ says.
    const before = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata']) {
        process.env.TZ = tz;
        assert.equal(formatDateRange(s.totals.firstDay, s.totals.lastDay), expected, tz);
        assert.equal(buildCards(s, { repoName: 'demo' })[0].svg, intro, `${tz}: intro card identical`);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  test('a single commit far from UTC: one local day, shown once', () => {
    const s = computeStats([commit('2026-03-01T00:30:00+13:00')], { today: '2026-03-02' });
    assert.equal(s.totals.firstDay, '2026-03-01');
    assert.equal(footerText(s, { repoName: 'demo' }), 'demo · Mar 1, 2026');
  });

  test('offsets can make firstDay later than lastDay: the range is still ordered', () => {
    // Earliest instant (10:30Z) is local Jan 2 at +14:00; latest (11:00Z) is local Jan 1 at -12:00.
    const s = computeStats([commit('2026-01-02T00:30:00+14:00'), commit('2026-01-01T23:00:00-12:00')], { today: '2026-01-05' });
    // firstDay / lastDay are the min / max local days, not the earliest instant's day.
    assert.equal(s.totals.firstDay, '2026-01-01');
    assert.equal(s.totals.lastDay, '2026-01-02');
    assert.equal(footerText(s, { repoName: 'demo' }), 'demo · Jan 1 – Jan 2, 2026');
    assert.equal(formatDateRange('2026-10-05', '2026-10-04'), 'Oct 4 – Oct 5, 2026');
  });

  test('impossible days such as Feb 31 are not formatted as dates', () => {
    assert.equal(formatDay('2026-02-31'), null);
    assert.equal(formatDay('2023-02-29'), null);
    assert.equal(formatDay('2024-02-29'), 'Feb 29, 2024');
    assert.equal(formatDateRange('2026-02-31', '2026-03-01'), 'Mar 1, 2026');
  });

  test('one valid day plus a missing one shows that day, formatted', () => {
    assert.equal(formatDateRange('2026-10-04', null), 'Oct 4, 2026');
    assert.equal(formatDateRange(undefined, '2026-10-04'), 'Oct 4, 2026');
    assert.equal(formatDateRange('nope', '2026-10-04'), 'Oct 4, 2026');
  });
});

// --- (4) huge counts ---------------------------------------------------------------------

describe('huge and hostile counts in tiles and the share image', () => {
  const variants = {
    'MAX_SAFE_INTEGER': Number.MAX_SAFE_INTEGER,
    '1e21': 1e21,
    'MAX_VALUE': Number.MAX_VALUE,
    Infinity: Infinity,
    '-Infinity': -Infinity,
    NaN: NaN,
    negative: -5,
    string: '12',
    object: {},
  };
  for (const [name, v] of Object.entries(variants)) {
    test(`${name}: outro tiles and share image stay clean`, () => {
      const s = normalStats();
      s.totals = { ...s.totals, commits: v, linesAdded: v, linesRemoved: v, activeDays: v, filesTouched: v, authors: v };
      s.streaks = { longest: { length: v, start: '2026-10-04', end: '2026-10-05' }, current: { length: v } };
      s.habits.peakHourCount = v;
      s.habits.byHour = s.habits.byHour.map(() => v);
      s.habits.byWeekday = s.habits.byWeekday.map(() => v);
      s.hotFiles = [{ path: 'src/app.js', commits: v, linesAdded: v, linesRemoved: v }];
      const share = renderShareCard(s, { repoName: 'demo', author: 'Ada' });
      for (const t of textNodes(share)) assert.doesNotMatch(t, BAD, `share text: ${t}`);
      for (const m of share.matchAll(/="([^"]*)"/g)) assert.doesNotMatch(m[1], /NaN|undefined|Infinity|null/, `share attr ${m[1]}`);
      for (const { id, svg } of buildCards(s, { repoName: 'demo' })) {
        for (const t of textNodes(svg)) assert.doesNotMatch(t, BAD, `${id} text: ${t}`);
        for (const m of svg.matchAll(/="([^"]*)"/g)) assert.doesNotMatch(m[1], /NaN|undefined|Infinity|null/, `${id} attr ${m[1]}`);
      }
    });
  }

  test('1e21 commits: the outro tile value has every digit', () => {
    const s = normalStats();
    s.totals = { ...s.totals, commits: 1e21 };
    const full = '1,000,000,000,000,000,000,000';
    assert.equal(formatNumber(1e21), full);
    const outro = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'outro').spec;
    assert.equal(outro.chart.items[0].value, full);
  });

  // Counts are shown in full on one line when they fit, else in compact form (12.3K);
  // never wrapped over two lines and never cut with '…'.
  const tileValue = (svg, label) => {
    const m = new RegExp(`>${label}</text><text [^>]*>([^<]*)</text>(<text [^>]*>([^<]*)</text>)?`).exec(svg);
    assert.ok(m, `${label} tile`);
    return { value: m[1], next: m[3] };
  };
  for (const [n, share] of [[9_999, '9,999'], [999_999, '999,999'], [99_999_999, '100M'], [9_999_999_999, '10.0B'], [Number.MAX_SAFE_INTEGER, '9,007T'], [1e21, '9,999T+']]) {
    test(`${formatNumber(n)} commits: one line, full or compact, in the outro tile and share tile`, () => {
      const s = normalStats();
      s.totals = { ...s.totals, commits: n };
      const outro = tileValue(buildCards(s, { repoName: 'demo' }).at(-1).svg, 'COMMITS');
      assert.ok([formatNumber(n), share].includes(outro.value), `outro: ${outro.value}`);
      assert.ok(!outro.value.includes('…'));
      assert.notEqual(outro.next?.startsWith(','), true, 'outro value not wrapped');
      const sh = tileValue(renderShareCard(s, { repoName: 'demo' }), 'COMMITS');
      assert.ok([formatNumber(n), share].includes(sh.value), `share: ${sh.value}`);
      assert.ok(!sh.value.includes('…'));
    });
  }

  test('MAX_SAFE_INTEGER commits on the share tile use the compact form, not "…"', () => {
    const s = normalStats();
    s.totals = { ...s.totals, commits: Number.MAX_SAFE_INTEGER };
    const svg = renderShareCard(s, { repoName: 'demo' });
    assert.ok(svg.includes('>9,007T<'));
    assert.ok(!svg.includes('9,007,199,254,74…'));
  });

  test('personality scores above 1 are clamped to 100%, never "1e+23%" / "Infinity%"', () => {
    for (const score of [1e21, Number.MAX_VALUE]) {
      const s = normalStats();
      s.personality.scores = [{ id: s.personality.archetype.id, name: 'X', score }];
      const svg = buildCards(s, { repoName: 'demo' }).find((c) => c.id === 'personality').svg;
      assert.doesNotMatch(svg, /e\+\d|Infinity/);
      assert.ok(svg.includes('>100%<'));
    }
  });

  test('MAX_SAFE_INTEGER hot-file commits in the outro wide tile', () => {
    const s = normalStats();
    s.hotFiles = [{ path: 'src/app.js', commits: Number.MAX_SAFE_INTEGER, linesAdded: 1, linesRemoved: 1 }];
    const outro = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'outro').spec;
    assert.equal(outro.chart.wide.note, '9,007,199,254,740,991 commits');
  });
});

// --- (5) hour / weekday charts -----------------------------------------------------------

describe('power-hour charts use habits.byHour / byWeekday exactly', () => {
  // 6 commits at 20:xx, 1 at 08:xx, 3 at 13:xx (author-local), on known weekdays.
  // 2026-10-04 is a Sunday, 2026-10-05 a Monday, 2026-10-10 a Saturday.
  const s = computeStats([
    ...Array.from({ length: 6 }, (_, i) => commit(`2026-10-04T20:0${i}:00-07:00`, `night ${i}`)),
    commit('2026-10-05T08:15:00+09:00', 'morning'),
    ...Array.from({ length: 3 }, (_, i) => commit(`2026-10-10T13:0${i}:00+00:00`, `lunch ${i}`)),
  ], { today: '2026-10-11' });
  const spec = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').spec;
  const svg = buildCards(s, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').svg;
  const [hours, week] = spec.chart;

  test('stats sanity: byHour / byWeekday are what the commits say', () => {
    assert.equal(s.habits.byHour[20], 6);
    assert.equal(s.habits.byHour[8], 1);
    assert.equal(s.habits.byHour[13], 3);
    assert.deepEqual(s.habits.byWeekday, [6, 1, 0, 0, 0, 0, 3]);
  });

  test('24 hour bars, values equal to byHour, titles "8 PM: 6 commits" / "8 AM: 1 commit"', () => {
    assert.equal(hours.kind, 'bars');
    assert.deepEqual(hours.values, s.habits.byHour);
    assert.equal(hours.values.length, 24);
    assert.deepEqual(hours.titles, s.habits.byHour.map((v, h) => `${hourLabel(h)}: ${v} ${v === 1 ? 'commit' : 'commits'}`));
    assert.deepEqual(hours.highlight, [20]);
    assert.equal(hours.peakLabel, '6');
    const t = titles(svg);
    const hourTitles = t.filter((x) => /^\d{1,2} [AP]M: /.test(x));
    assert.equal(hourTitles.length, 24);
    assert.ok(hourTitles.includes('8 PM: 6 commits'));
    assert.ok(hourTitles.includes('8 AM: 1 commit'));
    assert.ok(hourTitles.includes('1 PM: 3 commits'));
    assert.ok(hourTitles.includes('12 AM: 0 commits'));
    assert.ok(hourTitles.includes('12 PM: 0 commits'));
    assert.ok(!t.some((x) => /\b1 commits\b/.test(x)), 'singular for one');
    // 3 non-zero hours → 3 bar paths in the hour chart, + 3 non-zero weekdays (Mon, Sat, Sun).
    assert.equal((svg.match(/<path d=/g) ?? []).length, 3 + 3);
  });

  test('weekday bars are Monday-first, mapped from byWeekday (0 = Sunday)', () => {
    assert.deepEqual(week.values, [1, 0, 0, 0, 0, 3, 6]);
    assert.deepEqual(week.labels, ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    assert.deepEqual(week.titles, ['Monday: 1 commit', 'Tuesday: 0 commits', 'Wednesday: 0 commits', 'Thursday: 0 commits', 'Friday: 0 commits', 'Saturday: 3 commits', 'Sunday: 6 commits']);
    assert.deepEqual(week.highlight, [6], 'Sunday (last) is the peak');
    for (const x of week.titles) assert.ok(titles(svg).includes(x), x);
  });

  test('ties highlight every peak bar; the value label goes above the first', () => {
    const t = normalStats();
    t.habits.byHour = Array.from({ length: 24 }, (_, h) => (h === 3 || h === 22 ? 5 : 1));
    t.habits.byWeekday = [2, 2, 0, 0, 0, 0, 0];
    const [h, w] = buildCardSpecs(t, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').spec.chart;
    assert.deepEqual(h.highlight, [3, 22]);
    assert.deepEqual(w.highlight, [0, 6], 'Monday and Sunday');
  });

  test('missing / short / garbage byHour and byWeekday → 24 and 7 zero-safe bars', () => {
    for (const [byHour, byWeekday] of [[undefined, undefined], [[1, 2], [3]], ['x', null], [Array(30).fill(NaN), Array(9).fill(-1)]]) {
      const t = normalStats();
      t.habits.byHour = byHour;
      t.habits.byWeekday = byWeekday;
      const [h, w] = buildCardSpecs(t, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').spec.chart;
      assert.equal(h.values.length, 24);
      assert.equal(w.values.length, 7);
      assert.ok([...h.values, ...w.values].every((v) => Number.isFinite(v) && v >= 0));
      const svg2 = buildCards(t, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').svg;
      assert.doesNotMatch(svg2, /NaN|undefined|Infinity/);
    }
  });
});
