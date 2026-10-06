// Card design v2: charts (bars / hbars / split / callout / tiles), the composed layout
// (no overlapping blocks, nothing below the footer line), the pretty date footer and
// the card-number watermark.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, buildCardSpecs, cardIdsFor, footerText, formatDateRange, formatDay, renderCard, renderShareCard, layoutCard } from '../src/cards/index.js';
import { compactNumber, CONTENT_BOTTOM, CONTENT_TOP, FOOTER_TOP, fitCount, measureText, truncateMiddle } from '../src/cards/svg.js';
import { computeStats, percentShares } from '../src/stats/index.js';

const TODAY = '2026-10-05';
const INJECT = `<script>&"'`;
const INJECT_ESCAPED = '&lt;script&gt;&amp;&quot;&apos;';
const byId = (cards) => Object.fromEntries(cards.map((c) => [c.id, c.svg]));
const stripTags = (svg) => svg.replace(/<[^>]*>/g, ' ');
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

function commit(date, subject, files = [{ path: 'src/app.js', added: 3, removed: 1 }]) {
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

function hugeStats() {
  const s = normalStats();
  const big = 9_007_199_254_740_991;
  s.totals = { ...s.totals, commits: big, linesAdded: big, linesRemoved: 123_456_789, activeDays: 99_999, filesTouched: 1e9, authors: 5000 };
  s.habits.byHour = s.habits.byHour.map((_, i) => i * 1_000_003);
  s.habits.byWeekday = [big, 1, 2, 3, 4, 5, big];
  s.habits.peakHourCount = big;
  s.streaks = { longest: { length: 123_456, start: '1970-01-01', end: '2308-01-01' }, current: { length: 99_999, start: 'a', end: 'b' } };
  s.hotFiles = s.hotFiles.map((f) => ({ ...f, commits: big }));
  return s;
}

function longPathStats() {
  const s = normalStats();
  s.hotFiles = [
    { path: `${'deeply/nested/'.repeat(30)}${'w'.repeat(200)}.js`, commits: 9, linesAdded: 1, linesRemoved: 1 },
    { path: `x/${'y'.repeat(500)}`, commits: 8, linesAdded: 1, linesRemoved: 1 },
    { path: `${INJECT}/evil ${INJECT}.js`, commits: 3, linesAdded: 1, linesRemoved: 0 },
  ];
  return s;
}

function emojiStats() {
  const s = normalStats();
  s.hotFiles = [{ path: '👩‍💻/🇹🇷/emoji-dir/🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀.js', commits: 2, linesAdded: 1, linesRemoved: 0 }];
  s.messages.topWord = { word: '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉', count: 4 };
  s.personality.archetype.name = 'Night Owl 🦉🦉🦉🦉🦉🦉🦉🦉🦉🦉';
  return s;
}

/** normalStats() with a hand-made languages stat: `[name, lines, files]` rows. */
function languageStats(rows, basis = 'lines') {
  const s = normalStats();
  const shares = percentShares(rows.map(([, lines, files]) => (basis === 'files' ? files : lines)));
  s.languages = {
    totalLines: rows.reduce((n, r) => n + r[1], 0),
    totalFiles: rows.reduce((n, r) => n + r[2], 0),
    basis,
    languages: rows.map(([name, lines, files], i) => ({ name, lines, files, share: shares[i] })),
  };
  return s;
}

/** normalStats() with a hand-made contributors stat (`you`: a row or null). */
function teamStats(top, total, you = null) {
  const s = normalStats();
  s.contributors = { total, top: top.map(([name, commits, added = 0, removed = 0], i) => ({ name, rank: i + 1, commits, added, removed, share: Math.round((commits / total) * 1000) / 10 })), you };
  return s;
}
const SIX_NAMES = ['Ada Lovelace', 'Grace Hopper', 'Linus T.', 'Margaret Hamilton', 'Dennis R.'];

const MANY_LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift', 'C++', 'Ruby', 'Other']
  .map((name, i) => [name, 9_007_199_254_740 - i * 1_000_000_000, 1e9 - i]);

const SCENARIOS = [
  ['normal', () => normalStats(), { repoName: 'demo' }],
  ['empty', () => computeStats([], { today: TODAY }), { repoName: 'empty-repo' }],
  ['huge', hugeStats, { repoName: 'W'.repeat(300), author: `Ada ${'M'.repeat(200)}` }],
  ['long paths', longPathStats, { repoName: `my${INJECT}repo`, since: '2026-01-01' }],
  ['emoji', emojiStats, { repoName: '🚀🚀🚀 rocket repo 🚀🚀🚀', author: '👩‍💻' }],
  ['window + long repo', () => normalStats(), { repoName: 'my-really-quite-long-repository-name'.repeat(3), since: '2025-01-03', until: '2025-03-09', author: 'ada@example.com', today: TODAY }],
  ['year + long repo', () => normalStats(), { repoName: 'R'.repeat(120), since: '2025-01-01', until: '2025-12-31', today: TODAY }],
  ['many languages', () => languageStats(MANY_LANGUAGES), { repoName: 'polyglot' }],
  ['long language names', () => languageStats([[`Protocol Buffers ${'W'.repeat(80)}`, 50, 3], [`${INJECT} ${'M'.repeat(120)}`, 50, 2], ['Jupyter Notebook', 1, 1], ['Other', 7, 900]]), { repoName: 'long' }],
  ['single language', () => languageStats([['Rust', 1234, 12]]), { repoName: 'one' }],
  ['no code languages', () => languageStats([['Other', 40, 3]]), { repoName: 'none' }],
  ['four-way tie + data', () => languageStats([['JSON', 900, 4], ['Go', 5, 1], ['Rust', 5, 1], ['Zig', 5, 1], ['C', 5, 1], ['YAML', 1, 1]]), { repoName: 'tie' }],
  ['languages by files', () => languageStats([['Markdown', 0, 3], ['Shell', 0, 1]], 'files'), { repoName: 'zero-lines' }],
  ['team of two', () => teamStats([['Ada', 3, 10, 2], ['Bob', 1, 0, 0]], 2), { repoName: 'team' }],
  ['team: you outside the top five', () => teamStats(SIX_NAMES.map((n, i) => [n, 100 - i]), 600, { name: 'Me', rank: 17, commits: 2, added: 1, removed: 1, share: 0.4 }), { repoName: 'team', author: 'me@x.io' }],
  ['team: long names, huge counts', () => teamStats([[`${'W'.repeat(200)} ${INJECT}`, 9_007_199_254_740_991, 1e21, 1e21], ['🚀'.repeat(60), 9_007_199_254_740_000]], 9_007_199_254_740_991, { name: 'M'.repeat(300), rank: 2, commits: 9_007_199_254_740_000, added: 1, removed: 1, share: 50 }), { repoName: 'big' }],
];

describe('footer keeps the date window whole', () => {
  test('a long repo name is ellipsized, the window label is not (cards and share image)', () => {
    for (const [opts, label] of [
      [SCENARIOS[5][2], 'Jan 3 – Mar 9, 2025'],
      [SCENARIOS[6][2], '2025'],
    ]) {
      const s = normalStats();
      for (const { id, spec } of buildCardSpecs(s, opts)) {
        const { line } = layoutCard(spec).footer;
        assert.ok(line.endsWith(`… · ${label}`), `${id}: ${line}`);
      }
      const share = renderShareCard(s, opts);
      assert.match(share, new RegExp(`… · ${label}</text>`));
    }
  });
});

// --- dates & footer --------------------------------------------------------------------

describe('pretty dates', () => {
  test('formatDay uses English month abbreviations', () => {
    assert.equal(formatDay('2026-10-04'), 'Oct 4, 2026');
    assert.equal(formatDay('2024-01-31'), 'Jan 31, 2024');
    assert.equal(formatDay('nope'), null);
    assert.equal(formatDay(null), null);
    assert.equal(formatDay('2024-13-01'), null);
  });

  test('formatDateRange: same day, same year, across years, bad input', () => {
    assert.equal(formatDateRange('2026-10-04', '2026-10-04'), 'Oct 4, 2026');
    assert.equal(formatDateRange('2026-10-04', '2026-10-05'), 'Oct 4 – Oct 5, 2026');
    assert.equal(formatDateRange('2025-12-30', '2026-01-02'), 'Dec 30, 2025 – Jan 2, 2026');
    assert.equal(formatDateRange(null, null), '');
    assert.equal(formatDateRange('x', 'y'), 'x – y');
  });

  test('footer is "<repo> · <range>", and only the range for the gitwrapped repo', () => {
    const s = normalStats();
    assert.equal(footerText(s, { repoName: 'demo' }), 'demo · Oct 4 – Oct 5, 2026');
    assert.equal(footerText(s, { repoName: 'gitwrapped' }), 'Oct 4 – Oct 5, 2026');
    assert.equal(footerText(s, { repoName: 'GitWrapped' }), 'Oct 4 – Oct 5, 2026');
    assert.equal(footerText(s, { repoName: 'demo', since: '2026-01-01' }), 'demo · since Jan 1, 2026');
    assert.equal(footerText(s, { repoName: 'demo', since: 'last week' }), 'demo · since last week');
    assert.equal(footerText({}, { repoName: 'demo' }), 'demo');
    assert.equal(footerText({}, { repoName: 'gitwrapped' }), '');
  });

  test('cards and share image never repeat "gitwrapped" in the footer for this repo', () => {
    const s = normalStats();
    for (const { svg } of buildCards(s, { repoName: 'gitwrapped' })) {
      assert.ok(svg.includes('>Oct 4 – Oct 5, 2026<'), 'pretty range alone');
      assert.ok(!svg.includes('gitwrapped · '));
    }
    const share = renderShareCard(s, { repoName: 'gitwrapped' });
    assert.ok(share.includes('>Oct 4 – Oct 5, 2026<'));
    assert.ok(!share.includes('gitwrapped · '));
    assert.ok(renderShareCard(s, { repoName: 'demo' }).includes('>demo · Oct 4 – Oct 5, 2026<'));
  });
});

// --- decoration --------------------------------------------------------------------------

describe('decoration', () => {
  test('no stroked ring on any card or on the share image', () => {
    for (const { svg } of buildCards(normalStats(), { repoName: 'demo' })) assert.ok(!svg.includes('stroke'), 'card has a stroke');
    assert.ok(!renderShareCard(normalStats(), { repoName: 'demo' }).includes('stroke'));
  });

  test('cards carry a faint card-number watermark 01..10', () => {
    buildCards(normalStats(), { repoName: 'demo' }).forEach(({ svg }, i) => {
      const n = String(i + 1).padStart(2, '0');
      assert.match(svg, new RegExp(`fill-opacity="0\\.12"[^>]*>${n}</text>`));
    });
    assert.ok(!renderCard({ big: 'x' }).includes('fill-opacity="0.12"'), 'no watermark without number');
  });
});

// --- layout ------------------------------------------------------------------------------

/** y extents of the drawable elements in an SVG fragment: text baselines, rects, path points. */
function yExtents(svg) {
  const out = [];
  for (const m of svg.matchAll(/<text [^>]*\by="([\d.-]+)" font-size="([\d.]+)"/g)) out.push({ top: +m[1] - +m[2] * 0.8, bottom: +m[1], what: 'text' });
  for (const m of svg.matchAll(/<rect [^>]*\by="([\d.-]+)" [^>]*\bheight="([\d.]+)"/g)) out.push({ top: +m[1], bottom: +m[1] + +m[2], what: 'rect' });
  for (const m of svg.matchAll(/<path d="([^"]*)"/g)) {
    const ys = [...m[1].matchAll(/M[\d.-]+ ([\d.-]+)|V([\d.-]+)|A[\d.]+ [\d.]+ 0 0 1 [\d.-]+ ([\d.-]+)/g)].map((x) => +(x[1] ?? x[2] ?? x[3]));
    out.push({ top: Math.min(...ys), bottom: Math.max(...ys), what: 'path' });
  }
  return out;
}

const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;

describe('layout', () => {
  for (const [name, make, opts] of SCENARIOS) {
    test(`${name}: blocks stay in the content area, never overlap, and draw inside their box`, () => {
      const cards = buildCards(make(), opts);
      assert.equal(cards.length, cardIdsFor(make()).length);
      assert.ok(cards.length === 10 || cards.length === 11, `${name}: ${cards.length} cards`);
      for (const { id, svg } of cards) {
        assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name}/${id}: bad number`);
      }
      // Re-run the layout with the same card input the builders produce.
      for (const { id, layout } of layoutsFor(make(), opts)) {
        const where = `${name}/${id}`;
        const { blocks } = layout;
        assert.ok(blocks.length > 0, `${where}: no blocks`);
        for (const b of blocks) {
          assert.ok(b.top >= CONTENT_TOP - 0.5, `${where}/${b.kind}: top ${b.top} above CONTENT_TOP`);
          assert.ok(b.bottom <= CONTENT_BOTTOM + 0.5, `${where}/${b.kind}: bottom ${b.bottom} below CONTENT_BOTTOM`);
          for (const e of yExtents(b.svg)) {
            assert.ok(e.top >= b.top - 2 && e.bottom <= b.bottom + 2, `${where}/${b.kind}: ${e.what} ${e.top}..${e.bottom} outside ${b.top}..${b.bottom}`);
          }
        }
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            assert.ok(!overlaps(blocks[i], blocks[j]), `${where}: ${blocks[i].kind} overlaps ${blocks[j].kind}`);
          }
        }
        assert.ok(CONTENT_BOTTOM < FOOTER_TOP, 'footer line below the content area');
        assert.ok(layout.footer.top >= CONTENT_BOTTOM);
        if (layout.eyebrow) assert.ok(layout.eyebrow.bottom <= CONTENT_TOP, `${where}: eyebrow`);
        if (layout.watermark) {
          assert.ok(layout.watermark.bottom <= CONTENT_TOP, `${where}: watermark reaches the content`);
          if (layout.eyebrow) assert.ok(!overlaps(layout.watermark, layout.eyebrow), `${where}: watermark overlaps the eyebrow`);
        }
      }
    });
  }

  test('rendered cards draw nothing between the content area and the footer', () => {
    for (const [name, make, opts] of SCENARIOS) {
      for (const { id, svg } of buildCards(make(), opts)) {
        const body = svg.slice(svg.indexOf('<g fill="#ffffff"'));
        const footerStart = body.lastIndexOf('>gitwrapped</text>');
        const content = body.slice(0, body.lastIndexOf('<text', footerStart));
        for (const e of yExtents(content)) assert.ok(e.bottom <= CONTENT_BOTTOM + 2, `${name}/${id}: ${e.what} ends at ${e.bottom}`);
      }
    }
  });

  test('charts that cannot fit are dropped instead of overflowing', () => {
    const bars = { kind: 'bars', title: 'x', values: [1, 2, 3] };
    const layout = layoutCard({ big: 'W'.repeat(40), title: 'word '.repeat(100), subtitle: 'more '.repeat(100), lines: Array.from({ length: 6 }, (_, i) => `row ${i}`), chart: [bars, bars, bars, bars] });
    const last = layout.blocks.at(-1);
    assert.ok(last.bottom <= CONTENT_BOTTOM);
    assert.ok(layout.blocks.filter((b) => b.kind === 'bars').length < 4);
    assert.ok(layout.blocks.some((b) => b.kind === 'rows'), 'rows kept');
  });
});

/** layoutCard() for each card, from the exact input buildCards() renders. */
function layoutsFor(stats, opts) {
  const svgs = byId(buildCards(stats, opts));
  return buildCardSpecs(stats, opts).map(({ id, spec }) => {
    assert.equal(renderCard(spec), svgs[id], `${id}: spec reproduces the card`);
    return { id, layout: layoutCard(spec) };
  });
}

// --- charts ------------------------------------------------------------------------------

describe('bars chart', () => {
  const spec = {
    kind: 'bars', title: 'Commits by hour', values: [0, 3, 6, 6, 1], labels: ['a', '', 'c', '', 'e'],
    titles: ['h0: 0 commits', 'h1: 3 commits', 'h2: 6 commits', 'h3: 6 commits', 'h4: 1 commit'], highlight: [2, 3], peakLabel: '6',
  };

  test('deterministic, with a <title> per bar', () => {
    const svg = renderCard({ chart: spec });
    assert.equal(svg, renderCard({ chart: structuredClone(spec) }));
    for (const t of spec.titles) assert.ok(titles(svg).includes(t), t);
  });

  test('highlighted bars are solid, others 0.35, zero values a 4px 0.15 stub', () => {
    const svg = renderCard({ chart: spec });
    const paths = [...svg.matchAll(/<path d="[^"]*"( fill-opacity="([\d.]+)")?>/g)];
    assert.equal(paths.length, 4, 'one path per non-zero bar');
    assert.deepEqual(paths.map((m) => m[2] ?? '1'), ['0.35', '1', '1', '0.35']);
    assert.match(svg, /<rect [^>]*height="4" fill-opacity="0\.15"><title>h0: 0 commits<\/title><\/rect>/);
    assert.match(svg, /height="2" fill-opacity="0\.3"\/>/, 'baseline');
  });

  test('bar tops are rounded and bottoms square on the baseline; ≥2px gaps', () => {
    const svg = renderCard({ chart: { kind: 'bars', values: Array.from({ length: 64 }, (_, i) => i + 1) } });
    const ds = [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+)V[\d.]+A([\d.]+) [\d.]+ 0 0 1 [\d.]+ [\d.]+H[\d.]+A[\d.]+ [\d.]+ 0 0 1 ([\d.]+) [\d.]+V([\d.]+)Z"/g)];
    assert.equal(ds.length, 64);
    for (const d of ds) {
      assert.equal(d[2], d[5], 'starts and ends on the baseline');
      assert.ok(+d[3] > 0 && +d[3] <= 6, `corner radius ${d[3]}`);
    }
    for (let i = 1; i < ds.length; i++) assert.ok(+ds[i][1] - +ds[i - 1][4] >= 1.9, `gap ${i}`);
  });

  test('value label above only the first peak; tick labels at 30px / 0.75', () => {
    const svg = renderCard({ chart: spec });
    const peakLabels = [...svg.matchAll(/font-size="30" font-weight="800" text-anchor="middle">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(peakLabels, ['6']);
    const ticks = [...svg.matchAll(/font-size="30" font-weight="700" fill-opacity="0.75" text-anchor="middle">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(ticks, ['a', 'c', 'e']);
  });

  test('all-zero and empty values', () => {
    const zero = renderCard({ chart: { kind: 'bars', values: [0, 0, 0], highlight: [0], titles: ['x', 'y', 'z'] } });
    assert.equal([...zero.matchAll(/height="4" fill-opacity="0.15"/g)].length, 3);
    assert.ok(!zero.includes('<path'));
    assert.ok(!/font-weight="800" text-anchor="middle"/.test(zero), 'no peak label');
    for (const values of [[], null, 'nope', [NaN, -1, Infinity]]) {
      const svg = renderCard({ chart: { kind: 'bars', values } });
      assert.ok(!/NaN|Infinity|undefined/.test(svg));
    }
    assert.equal(renderCard({ chart: { kind: 'bars', values: [] } }), renderCard({}));
  });

  test('every chart text is escaped', () => {
    const svg = renderCard({ chart: { kind: 'bars', title: INJECT, values: [1, 2], labels: [INJECT, 'x'], titles: [INJECT, INJECT], highlight: [1], peakLabel: INJECT } });
    assert.ok(!svg.includes(INJECT));
    assert.ok(!/<script/i.test(svg));
    assert.ok(svg.includes(INJECT_ESCAPED));
    assert.ok(svg.includes(`<title>${INJECT_ESCAPED}</title>`));
  });
});

describe('hbars chart', () => {
  test('bars proportional to the largest amount, with titles and escaping', () => {
    const svg = renderCard({ chart: { kind: 'hbars', title: 'Files', items: [
      { label: 'a.js', sub: 'src/', value: '10 commits', amount: 10, title: `src/a.js ${INJECT}` },
      { label: `b ${INJECT}`, value: '5 commits', amount: 5 },
      { label: 'zero', value: '0', amount: 0 },
    ] } });
    // Tracks (0.15) for every item; fills only for non-zero amounts (the largest solid).
    const fills = [...svg.matchAll(/<rect x="96" y="[\d.]+" width="([\d.]+)" height="18" rx="9"( fill-opacity="0.6")?\/>/g)].map((m) => [+m[1], m[2] ? 0.6 : 1]);
    assert.deepEqual(fills, [[888, 1], [444, 0.6]]);
    assert.equal([...svg.matchAll(/height="18" rx="9" fill-opacity="0.15"/g)].length, 3);
    assert.ok(svg.includes(`<title>src/a.js ${INJECT_ESCAPED}</title>`));
    assert.ok(svg.includes(`b ${INJECT_ESCAPED}`));
    assert.ok(svg.includes('>src/<'), 'dir shown after the basename');
    assert.ok(!svg.includes(INJECT));
  });

  test('long labels are shortened from the start and stay one line', () => {
    const long = `${'very/long/path/'.repeat(20)}file.js`;
    const svg = renderCard({ chart: { kind: 'hbars', items: [{ label: long, value: '1 commit', amount: 1, truncate: 'start' }] } });
    assert.match(svg, />…[^<]*file\.js</);
  });

  test('at most 6 items; empty items → no chart', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ label: `item-${i}`, value: String(i), amount: i }));
    const svg = renderCard({ chart: { kind: 'hbars', items } });
    assert.ok(svg.includes('item-5') && !svg.includes('item-6'));
    assert.equal(renderCard({ chart: { kind: 'hbars', items: [null, {}] } }), renderCard({}));
  });
});

describe('split chart', () => {
  test('two segments sized by share, labels under each end', () => {
    const svg = renderCard({ chart: { kind: 'split', title: 'Lines', segments: [{ label: 'Lines added', value: '+300', amount: 300 }, { label: 'Lines removed', value: '−100', amount: 100 }] } });
    const segs = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="32" rx="16"( fill-opacity="0.4")?>/g)].map((m) => +m[2]);
    assert.equal(segs.length, 2);
    assert.ok(Math.abs(segs[0] / segs[1] - 3) < 0.05, `${segs}`);
    assert.match(svg, /Lines added<\/text><text [^>]*>\+300<\/text>/);
    assert.match(svg, /Lines removed<\/text><text [^>]*text-anchor="end">−100<\/text>/);
  });

  test('zero total draws only the faint track; escaping', () => {
    const svg = renderCard({ chart: { kind: 'split', segments: [{ label: INJECT, value: '0', amount: 0 }, { label: 'b', value: '0', amount: -5 }] } });
    assert.equal([...svg.matchAll(/height="32" rx="16"/g)].length, 1);
    assert.match(svg, /height="32" rx="16" fill-opacity="0.15"/);
    assert.ok(!svg.includes(INJECT) && svg.includes(INJECT_ESCAPED));
    assert.equal(renderCard({ chart: { kind: 'split', segments: [{ amount: 1 }] } }), renderCard({}));
  });
});

describe('callout and tiles', () => {
  test('callout shows caption, value and note, escaped', () => {
    const svg = renderCard({ chart: { kind: 'callout', title: 'Your story', value: `Oct 4 ${INJECT}`, note: '3 commits to unwrap' } });
    assert.ok(svg.includes('>YOUR STORY<'));
    assert.ok(svg.includes(`Oct 4 ${INJECT_ESCAPED}`));
    assert.ok(svg.includes('>3 commits to unwrap<'));
  });

  test('tiles: up to 4 plus a wide row; long values wrap instead of overflowing', () => {
    const svg = renderCard({ chart: { kind: 'tiles', items: [{ label: 'A', value: '1' }, { label: 'B', value: 'Weekend Warrior Supreme' }, { label: 'C', value: '' }, { label: 'D', value: 'x' }, { label: 'E', value: 'nope' }], wide: { label: 'Hottest file', value: `${'a/'.repeat(80)}z.js`, note: '3 commits', truncate: 'start' } } });
    assert.ok(!svg.includes('>E<') && !svg.includes('nope'));
    assert.ok(svg.includes('>—<'), 'empty value shows a dash');
    assert.match(svg, />…[^<]*z\.js</);
    assert.ok(svg.includes('>HOTTEST FILE<'));
  });
});

// --- cards -------------------------------------------------------------------------------

describe('v2 cards', () => {
  test('power hour: 24 hour bars and 7 weekday bars (Monday first) with hover titles', () => {
    const svg = byId(buildCards(normalStats(), { repoName: 'demo' }))['peak-hour'];
    const t = titles(svg);
    assert.ok(t.includes('8 PM: 2 commits'), t.join('|'));
    assert.ok(t.includes('12 AM: 0 commits'));
    assert.ok(t.includes('11 PM: 1 commit'));
    const days = t.filter((x) => /day: /.test(x));
    assert.deepEqual(days.map((x) => x.split(':')[0]), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    for (const tick of ['12a', '6a', '12p', '6p', '11p']) assert.ok(svg.includes(`>${tick}<`), tick);
    assert.ok(svg.includes('>COMMITS BY HOUR<') && svg.includes('>BY WEEKDAY<'));
    assert.doesNotMatch(stripTags(svg), /\b1 commits\b/);
  });

  test('totals: lines added vs removed split bar', () => {
    const svg = byId(buildCards(normalStats(), { repoName: 'demo' })).totals;
    assert.ok(svg.includes('>LINES CHANGED<'));
    assert.match(svg, /Lines added<\/text><text [^>]*>\+56<\/text>/);
  });

  test('intro: date range callout and commit count', () => {
    const intro = byId(buildCards(normalStats(), { repoName: 'demo' })).intro;
    assert.ok(intro.includes('>Oct 4 – Oct 5, 2026<'));
    assert.ok(intro.includes('>4 commits to unwrap<'));
    const empty = byId(buildCards(computeStats([], { today: TODAY }))).intro;
    assert.ok(!empty.includes('to unwrap'));
  });

  test('hot files, personality and streak use horizontal bars; outro uses tiles', () => {
    const m = byId(buildCards(normalStats(), { repoName: 'demo' }));
    assert.ok(titles(m['hot-files']).some((x) => x.startsWith('test/a/b/c.test.js: 1 commit')));
    assert.ok(m['hot-files'].includes('>c.test.js<') && m['hot-files'].includes('>test/a/b/<'));
    assert.ok(m.streak.includes('>LONGEST VS. CURRENT<'));
    for (const label of ['COMMITS', 'POWER HOUR', 'BEST STREAK', 'PERSONALITY', 'HOTTEST FILE']) assert.ok(m.outro.includes(`>${label}<`), label);
  });
});

// --- fix round 1 -------------------------------------------------------------------------

describe('hbars scaleMax (personality scores scale to 100%)', () => {
  test('a 0.5 score fills half the bar even when it is the top score', () => {
    const items = [{ label: 'A', value: '50%', amount: 0.5 }, { label: 'B', value: '25%', amount: 0.25 }];
    const widths = (svg) => [...svg.matchAll(/<rect x="96" y="[\d.]+" width="([\d.]+)" height="40" rx="12"( fill-opacity="0.6")?\/>/g)].map((m) => +m[1]);
    assert.deepEqual(widths(renderCard({ chart: { kind: 'hbars', size: 'large', scaleMax: 1, items } })), [444, 222]);
    assert.deepEqual(widths(renderCard({ chart: { kind: 'hbars', size: 'large', items } })), [888, 444], 'default: relative to the largest');
    // Amounts above scaleMax are capped at the full width.
    assert.deepEqual(widths(renderCard({ chart: { kind: 'hbars', size: 'large', scaleMax: 1, items: [{ label: 'X', amount: 7 }] } })), [888]);
  });

  test('personality card: bars use scaleMax 1 and percentages are clamped', () => {
    const s = normalStats();
    s.personality.scores = [{ id: s.personality.archetype.id, name: 'Top', score: 0.4 }, { id: 'y', name: 'Next', score: 0.2 }];
    const spec = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'personality').spec;
    assert.equal(spec.chart.scaleMax, 1);
    assert.deepEqual(spec.chart.items.map((i) => i.value), ['40%', '20%']);
    s.personality.scores = [{ id: s.personality.archetype.id, name: 'Huge', score: 1e300 }];
    const huge = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'personality').spec;
    assert.equal(huge.chart.items[0].value, '100%');
  });
});

describe('shrink order and sentence-boundary cuts', () => {
  const longSubtitle = 'First sentence is short. Second sentence keeps going on and on about your commits for quite a while. '
    + 'Third sentence adds even more words to make the subtitle far too long for the card. Fourth sentence never fits anywhere at all.';

  test('power-hour card keeps both charts and ends the subtitle at a sentence', () => {
    const s = normalStats();
    const spec = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').spec;
    const layout = layoutCard({ ...spec, title: 'is one of your power hours and it is a very long title', subtitle: longSubtitle });
    assert.equal(layout.blocks.filter((b) => b.kind === 'bars').length, 2, 'both charts kept');
    const sub = layout.blocks.find((b) => b.kind === 'subtitle');
    const lines = [...sub.svg.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]);
    assert.ok(lines.at(-1).endsWith('.'), `ends at a sentence: ${lines.at(-1)}`);
    assert.ok(!lines.join(' ').includes('…'));
    assert.ok(lines.join(' ').startsWith('First sentence is short.'));
    for (const b of layout.blocks) assert.ok(b.bottom <= CONTENT_BOTTOM);
  });

  test('charts are compacted before subtitle lines are cut', () => {
    // 4 subtitle lines that fit only once the charts shrink to their compact minimums.
    const s = normalStats();
    const spec = buildCardSpecs(s, { repoName: 'demo' }).find((c) => c.id === 'peak-hour').spec;
    const sub = 'word '.repeat(60).trim();
    const layout = layoutCard({ ...spec, subtitle: sub });
    const subBlock = layout.blocks.find((b) => b.kind === 'subtitle');
    const lineCount = (subBlock.svg.match(/<text /g) ?? []).length;
    assert.equal(lineCount, 4, 'all 4 subtitle lines kept');
    assert.equal(layout.blocks.filter((b) => b.kind === 'bars').length, 2);
  });

  test('a single over-long sentence still gets the "…" cut', () => {
    const layout = layoutCard({ subtitle: 'word '.repeat(200) });
    const sub = layout.blocks.find((b) => b.kind === 'subtitle');
    assert.ok(sub.svg.includes('…'));
  });
});

describe('middle ellipsis for hot-file names', () => {
  test('truncateMiddle keeps both ends and fits', () => {
    const name = `component-${'x'.repeat(80)}-alpha.test.js`;
    const out = truncateMiddle(name, { maxWidth: 600, fontSize: 36 });
    assert.ok(out.includes('…'));
    assert.ok(out.startsWith('compon'), out);
    assert.ok(out.endsWith('alpha.test.js'));
    assert.ok(measureText(out, 36) <= 600);
    assert.equal(truncateMiddle('short.js', { maxWidth: 400, fontSize: 36 }), 'short.js');
    assert.equal(truncateMiddle(null, { maxWidth: 400, fontSize: 36 }), '');
  });

  test('hot-file rows with a shared long middle stay distinguishable', () => {
    const s = normalStats();
    const mid = 'very-long-shared-component-name-'.repeat(4);
    s.hotFiles = [
      { path: `src/alpha-${mid}button.js`, commits: 5, linesAdded: 1, linesRemoved: 0 },
      { path: `src/beta-${mid}button.js`, commits: 4, linesAdded: 1, linesRemoved: 0 },
    ];
    const svg = byId(buildCards(s, { repoName: 'demo' }))['hot-files'];
    const labels = [...svg.matchAll(/font-size="36" font-weight="800">([^<]*…[^<]*)</g)].map((m) => m[1]);
    assert.equal(labels.length, 2, labels.join(' | '));
    assert.ok(labels[0].startsWith('alpha-') && labels[1].startsWith('beta-'));
    for (const l of labels) assert.ok(l.endsWith('button.js'), l);
  });
});

describe('compact numbers', () => {
  test('compactNumber', () => {
    const cases = [[0, '0'], [999, '999'], [1000, '1.0K'], [12_345, '12.3K'], [999_499, '999K'], [999_500, '1.0M'], [99_949, '99.9K'], [99_950, '100K'], [4_500_000, '4.5M'],
      [99_999_999, '100M'], [123_456_789_012, '123B'], [9_999_999_999, '10.0B'], [Number.MAX_SAFE_INTEGER, '9,007T'], [1e21, '9,999T+'],
      [Number.MAX_VALUE, '9,999T+'], [-12_345, '−12.3K'], ['12,345', '12.3K'], ['−1,000', '−1.0K'], ['+123,456,789,012', '+123B'], [NaN, '0'], [Infinity, '0'], ['x', '0'], [null, '0']];
    for (const [n, want] of cases) assert.equal(compactNumber(n), want, String(n));
  });

  test('fitCount keeps fitting values, compacts counts with a unit, rejects other text', () => {
    assert.equal(fitCount('12', 200, 40), '12');
    assert.equal(fitCount('123,456,789 days', 260, 40), '123M days');
    assert.equal(fitCount('Weekend Warrior', 100, 40), null);
    // The split bar's line counts compact too, instead of '…'.
    const svg = renderCard({ chart: { kind: 'split', segments: [{ label: 'Lines added', value: '+123,456,789,012,345', amount: 2 }, { label: 'Lines removed', value: '−987,654,321,000,000', amount: 1 }] } });
    assert.ok(svg.includes('>+123T<') && svg.includes('>−988T<'), 'compact split values');
    assert.ok(!/>[+−][\d,]*…</.test(svg));
  });
});

describe('footer layout matches what is drawn', () => {
  test('layout.footer.line/size are the drawn footer text', () => {
    for (const footer of ['demo · Oct 4 – Oct 5, 2026', 'w'.repeat(300), '']) {
      const layout = layoutCard({ footer });
      const svg = renderCard({ footer });
      if (!footer) {
        assert.equal(layout.footer.line, '');
        continue;
      }
      assert.ok(svg.includes(`font-size="${layout.footer.size}" font-weight="600" fill-opacity="0.8" text-anchor="end">${layout.footer.line}<`), footer.slice(0, 20));
    }
  });
});
