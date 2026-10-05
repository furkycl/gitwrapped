// Edge cases for the macOS emoji workaround in src/png.js (stripEmojiFromText /
// needsEmojiStrip / renderPng({platform})), run against real card output.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { loadResvg, needsEmojiStrip, pngSize, renderPng, stripEmojiFromText } from '../src/png.js';
import { buildCards, renderCard, renderShareCard } from '../src/cards/index.js';
import { escapeXml, graphemes, isEmojiCluster } from '../src/cards/svg.js';
import { computeStats } from '../src/stats/index.js';

const TODAY = '2024-03-14';

let Resvg = null;
let resvgError = null;
try {
  Resvg = await loadResvg();
} catch (err) {
  resvgError = err.message;
}
const needResvg = (t) => {
  if (!Resvg) t.skip(`resvg unavailable: ${resvgError}`);
  return Boolean(Resvg);
};

// --- helpers ---------------------------------------------------------------------------

const wrap = (s, attrs = ' x="1"') => `<text${attrs}>${s}</text>`;
const strip1 = (raw) => stripEmojiFromText(wrap(raw)).slice(wrap('').indexOf('>') + 1, -'</text>'.length);

/** Every tag in `svg`, in order. */
const tags = (svg) => svg.match(/<[^>]*>/g) ?? [];

/** Character data of <text>/<tspan> elements (innermost runs). */
function textRuns(svg) {
  const runs = [];
  const parts = svg.split(/(<[^>]*>)/);
  let depth = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1) {
      const m = /^<(\/?)(text|tspan)\b[^>]*?(\/?)>$/.exec(p);
      if (m && !m[3]) depth += m[1] ? -1 : 1;
    } else if (depth > 0) runs.push(p); // empty runs too, so indexes line up
  }
  return runs;
}

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const hasColorEmoji = (s) => graphemes(decode(s)).some((g) => isEmojiCluster(g) || /^[0-9#*]️?⃣$/u.test(g) || (/\p{Emoji_Presentation}/u.test(g) && !g.includes('\uFE0E')));
/** Pictographs at U+1F000+ (always color emoji) left in the string. */
const HIGH_PICTO = /[\u{1F000}-\u{1FFFF}]/u;

const ROCKET = '🚀';
const EMOJI_SAMPLES = ['🚀', '🦉', '🎉', '👨‍👩‍👧‍👦', '👍🏽', '❤️', '🇹🇷', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '1️⃣', '#️⃣', '🧑🏿‍💻', '🏳️‍🌈'];

function emojiStats() {
  const s = computeStats([], { today: TODAY });
  s.totals = { ...s.totals, commits: 1234, activeDays: 12, firstDay: '2024-01-01', lastDay: '2024-03-13', linesAdded: 999, linesRemoved: 12 };
  s.habits = { ...s.habits, peakHour: 3, peakHourLabel: '3 AM 🌙' };
  s.streaks = { longest: { length: 7, start: '2024-01-01', end: '2024-01-07' }, current: { length: 2, start: '2024-03-12', end: '2024-03-13' } };
  s.hotFiles = [
    { path: `src/${ROCKET}/launch & <go>.js`, commits: 40, linesAdded: 10, linesRemoved: 2 },
    { path: 'docs/🎉 party/ünïcödé 日本語.md', commits: 12, linesAdded: 1, linesRemoved: 1 },
    { path: '👨‍👩‍👧‍👦.txt', commits: 3, linesAdded: 1, linesRemoved: 0 },
  ];
  s.messages = {
    shortest: { subject: '🐛' },
    longest: { subject: '✨ feat: add 🚀 launch & <rocket> support for 日本語 users — café 👍🏽' },
    topWord: { word: '🔥', count: 5 },
    counts: { fix: 3, wip: 1, oops: 2 },
    averageLength: 42,
  };
  s.personality = { archetype: { id: 'night-owl', name: 'Night Owl 🦉', roast: 'You code at 3 AM 🌙 & ship 🚢', reason: 'r' }, scores: [] };
  return s;
}
const EMOJI_OPTS = { repoName: `${ROCKET} rocket-app 🇹🇷`, author: 'Ada 👩‍💻 Lovelace <ada@ex.com>', since: '2024-01-01' };

function emojiCards() {
  const s = emojiStats();
  return [
    ...buildCards(s, EMOJI_OPTS).map((c) => [c.id, c.svg]),
    ['share', renderShareCard(s, EMOJI_OPTS)],
    ['card', renderCard({ eyebrow: '🎉 & 🎉', big: '🚀', title: 'R&D 🚀 <x>', subtitle: 'ünï 日本 🇯🇵', lines: [{ label: '❤️ love', value: '1️⃣' }] })],
  ];
}

// --- string-level properties -----------------------------------------------------------

describe('stripEmojiFromText on real card output', () => {
  test('the fixtures really do carry emoji into <text> nodes (sanity)', () => {
    for (const [id, svg] of emojiCards()) {
      if (['activity', 'streak', 'totals'].includes(id)) continue; // no free text from the inputs
      assert.ok(textRuns(svg).some(hasColorEmoji), `${id}: expected emoji in text`);
    }
  });

  test('markup is byte-identical: same tags, same order, same attributes', () => {
    for (const [id, svg] of emojiCards()) {
      const out = stripEmojiFromText(svg);
      assert.deepEqual(tags(out), tags(svg), id);
      const opens = (s) => (s.match(/<text\b/g) ?? []).length;
      const closes = (s) => (s.match(/<\/text>/g) ?? []).length;
      assert.equal(opens(out), closes(out), `${id}: balanced <text>`);
      assert.equal(opens(out), opens(svg), id);
      assert.equal((out.match(/<tspan\b/g) ?? []).length, (svg.match(/<tspan\b/g) ?? []).length, `${id}: tspans`);
    }
  });

  test('no color emoji left in any text node; nothing changes outside text nodes', () => {
    for (const [id, svg] of emojiCards()) {
      const out = stripEmojiFromText(svg);
      for (const run of textRuns(out)) {
        assert.ok(!hasColorEmoji(run), `${id}: emoji left in ${JSON.stringify(run)}`);
        assert.ok(!HIGH_PICTO.test(decode(run)), `${id}: high pictograph left in ${JSON.stringify(run)}`);
      }
      // Non-text character data (<title>, <desc>, whitespace between elements) untouched.
      const outsideText = (s) => s.replace(/<(text|tspan)\b[^>]*>[\s\S]*?<\/\1>/g, '<T/>');
      assert.equal(outsideText(out), outsideText(svg), `${id}: non-text content changed`);
    }
  });

  test('hot-file <title> tooltip keeps its emoji (only rendered text is stripped)', () => {
    const svg = buildCards(emojiStats(), EMOJI_OPTS).find((c) => c.id === 'hot-files').svg;
    const out = stripEmojiFromText(svg);
    const titles = (s) => s.match(/<title>[^<]*<\/title>/g) ?? [];
    assert.ok(titles(svg).some((t) => t.includes(ROCKET)), 'fixture has an emoji tooltip');
    assert.deepEqual(titles(out), titles(svg));
  });

  test('text runs are only ever shortened by removing emoji (non-emoji text preserved in order)', () => {
    for (const [id, svg] of emojiCards()) {
      const before = textRuns(svg);
      const after = textRuns(stripEmojiFromText(svg));
      assert.equal(after.length, before.length, id);
      before.forEach((b, i) => {
        // Drop emoji and all whitespace from both; what remains must be identical.
        const norm = (s) => graphemes(decode(s)).filter((g) => !hasColorEmoji(g) && !/^\s+$/u.test(g)).join('');
        assert.equal(norm(after[i]), norm(b), `${id}: run ${i}`);
        if (!hasColorEmoji(b)) assert.equal(after[i], b, `${id}: emoji-free run changed`);
      });
    }
  });

  test('idempotent: strip(strip(x)) === strip(x)', () => {
    const inputs = [
      ...emojiCards().map(([, svg]) => svg),
      wrap('a &#x1F680; b &#128640; c'),
      wrap('🚀🚀 🚀'),
      wrap(' 🚀 x 🚀 '),
      '<svg><text>a<tspan>🚀</tspan> b</text></svg>',
      '',
    ];
    for (const x of inputs) {
      const once = stripEmojiFromText(x);
      assert.equal(stripEmojiFromText(once), once, x.slice(0, 80));
    }
  });

  test('emoji-free card output is returned unchanged (identity)', () => {
    const s = computeStats([], { today: TODAY });
    for (const c of buildCards(s, { repoName: 'plain & simple <repo>' })) assert.equal(stripEmojiFromText(c.svg), c.svg, c.id);
    const share = renderShareCard(s, { repoName: 'café 日本語 © ™' });
    assert.equal(stripEmojiFromText(share), share);
  });
});

describe('stripEmojiFromText: character data edge cases', () => {
  test('text made only of emoji (any kind, any count, any whitespace) becomes empty', () => {
    for (const e of EMOJI_SAMPLES) {
      assert.equal(strip1(e), '', e);
      assert.equal(strip1(`  ${e}  ${e}\n${e} `), '', `spaced ${e}`);
      assert.equal(strip1(e.repeat(5)), '', `x5 ${e}`);
    }
    assert.equal(strip1(EMOJI_SAMPLES.join('')), '');
    assert.equal(strip1(EMOJI_SAMPLES.join(' ')), '');
  });

  test('every sample emoji is removed between words, leaving one space', () => {
    for (const e of EMOJI_SAMPLES) {
      assert.equal(strip1(`a ${e} b`), 'a b', e);
      assert.equal(strip1(`a${e}b`), 'ab', e);
      assert.equal(strip1(`a ${e}${e} ${e} b`), 'a b', e);
    }
  });

  test('emoji next to escaped entities keeps the entities intact', () => {
    const cases = [
      ['R&amp;D🚀', 'R&amp;D'],
      ['🚀&amp;', '&amp;'],
      ['&lt;🚀&gt;', '&lt;&gt;'],
      ['&lt; 🚀 &gt;', '&lt; &gt;'],
      ['&quot;🎉&quot; &apos;x&apos;', '&quot;&quot; &apos;x&apos;'],
      ['a &amp; 🚀 &amp; b', 'a &amp; &amp; b'],
      ['&#38;🚀&#x26;&#60;&#x3C;', '&#38;&#x26;&#60;&#x3C;'], // refs to & < stay refs
      ['&amp;#x1F680;', '&amp;#x1F680;'], // escaped text that merely looks like a ref
    ];
    for (const [input, want] of cases) assert.equal(strip1(input), want, input);
    // Matches escapeXml output end to end.
    for (const raw of ['x & 🚀 < y', '"🚀"', "it's 🚀 > all"]) {
      const out = strip1(escapeXml(raw));
      assert.ok(!out.includes(ROCKET), raw);
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(out), `${raw}: bare & in ${out}`);
    }
  });

  test('numeric character references to emoji are removed; malformed refs left alone', () => {
    assert.equal(strip1('go &#x1F680; now'), 'go now');
    assert.equal(strip1('go &#128640; now'), 'go now');
    assert.equal(strip1('&#x1f680;'), '');
    assert.equal(strip1('&#x2764;&#xFE0F; x'), 'x'); // ❤️ spelled as refs
    assert.equal(strip1('&#x1F680 no semicolon'), '&#x1F680 no semicolon');
    assert.equal(strip1('&#xD83D;&#xDE80;'), '&#xD83D;&#xDE80;'); // surrogate refs are invalid XML; not decoded
    assert.equal(strip1('&#x110000; 🚀'), '&#x110000;');
  });

  test('CJK, accented, RTL and combining text is preserved', () => {
    const cases = [
      ['日本語 🚀 テスト', '日本語 テスト'],
      ['中文🎉한국어', '中文한국어'],
      ['café naïve Ünïcödé 🚀', 'café naïve Ünïcödé'],
      ['é 🚀 ä', 'é ä'], // decomposed accents
      ['שלום 🚀 مرحبا', 'שלום مرحبا'],
      ['Ελληνικά — Кириллица 🚀…', 'Ελληνικά — Кириллица …'], // space before the emoji is kept as one
      ['Ελληνικά🚀…', 'Ελληνικά…'],
    ];
    for (const [input, want] of cases) assert.equal(strip1(input), want, input);
    for (const s of ['日本語テスト', 'café', 'é', 'שלום']) assert.equal(strip1(s), s);
  });

  test('text-presentation pictographs (© ® ™ ↔ ✓ ☀ ♥ ‼) are kept; their VS16 forms are removed', () => {
    // Documented behaviour: without U+FE0F these code points are Extended_Pictographic but
    // default to text presentation and are drawn from the text font, so they stay.
    const textStyle = '© ® ™ ↔ ↕ ✓ ☀ ♥ ‼ ⁉ ℹ ⌘';
    assert.equal(strip1(textStyle), textStyle);
    assert.equal(strip1('©️ ®️ ™️ ↔️ x'), 'x');
    // Text-presentation selector U+FE0E keeps them as text.
    assert.equal(strip1('♥︎ ok'), '♥︎ ok');
    // Bare digits, '#' and '*' are not keycaps.
    assert.equal(strip1('1 # * 2'), '1 # * 2');
    assert.equal(strip1('1⃣ #️⃣'), '');
  });

  test('Emoji_Presentation code points below U+1F000 are removed even without VS16; FE0E keeps them', () => {
    // ✨ (gitmoji "feat"), ⚡ ✅ ❌ ⭐ ☕ ⏰ ⌛ default to EMOJI presentation (Emoji_Presentation=Yes)
    // and have no glyph in Helvetica, so on macOS they fall back to Apple Color Emoji too.
    const eps = ['✨', '⚡', '✅', '❌', '⭐', '☕', '⏰', '⌛'];
    for (const e of eps) {
      assert.equal(strip1(`a ${e} b`), 'a b', e);
      assert.equal(strip1(`a ${e}\uFE0E b`), `a ${e}\uFE0E b`, `${e} text style`);
    }
  });

  test('whitespace is trimmed only at the edges of the whole <text> content', () => {
    const cases = [
      ['<text>Top: 🚀 <tspan>x</tspan></text>', '<text>Top: <tspan>x</tspan></text>'],
      ['<text><tspan>x</tspan> 🚀 end</text>', '<text><tspan>x</tspan> end</text>'],
      ['<text>a<tspan> 🚀 </tspan>b</text>', '<text>a<tspan> </tspan>b</text>'],
      ['<text> 🚀 a 🚀 </text>', '<text>a</text>'],
      ['<text>a<tspan>🚀</tspan>b</text>', '<text>a<tspan></tspan>b</text>'],
    ];
    for (const [input, want] of cases) assert.equal(stripEmojiFromText(input), want, input);
  });

  test('only ASCII whitespace collapses; NBSP is kept as text', () => {
    assert.equal(strip1('a\u00A0🚀\u00A0b'), 'a\u00A0\u00A0b');
    assert.equal(strip1('a \t\n🚀\n\t b'), 'a b');
  });

  test('long whitespace runs and many emoji strip quickly', () => {
    // Card text is capped at 500 code points (MAX_TEXT); these inputs are far larger.
    const big = `a${' '.repeat(20000)}🚀${' '.repeat(20000)}x ${'w🚀 👍🏽 '.repeat(2000)}b`;
    const t0 = performance.now();
    assert.equal(strip1(big), `a x ${'w '.repeat(2000)}b`);
    assert.equal(strip1(`a${' \t'.repeat(20000)}🚀`), 'a');
    const spaces = `a${' '.repeat(20000)}b`;
    assert.equal(strip1(`${spaces}🚀`), spaces, 'whitespace without emoji is kept verbatim');
    const plain = `${'word '.repeat(10000)}end`;
    assert.equal(strip1(plain), plain);
    assert.ok(performance.now() - t0 < 10000, `too slow: ${Math.round(performance.now() - t0)} ms`);
  });

  test('nested tspans, self-closing text, comments and CDATA', () => {
    const svg = '<svg><!-- 🚀 <text>🚀</text> --><text>a <tspan>🚀<tspan>b 🚀</tspan></tspan> c</text>'
      + '<text/><desc>🚀</desc><![CDATA[🚀]]><text><![CDATA[x 🚀]]></text></svg>';
    const out = stripEmojiFromText(svg);
    assert.equal(
      out,
      '<svg><!-- 🚀 <text>🚀</text> --><text>a <tspan><tspan>b </tspan></tspan> c</text>'
        + '<text/><desc>🚀</desc><![CDATA[🚀]]><text><![CDATA[x 🚀]]></text></svg>',
    );
  });

  test('<textPath> and other text* elements are not mistaken for <text>', () => {
    const svg = '<svg><textPath>🚀</textPath><texts>🚀</texts></svg>';
    assert.equal(stripEmojiFromText(svg), svg);
  });

  test('non-string and empty input', () => {
    assert.equal(stripEmojiFromText(''), '');
    assert.equal(stripEmojiFromText(null), '');
    assert.equal(stripEmojiFromText(undefined), '');
    assert.equal(stripEmojiFromText(42), '42');
    assert.equal(stripEmojiFromText('🚀 no markup'), '🚀 no markup');
  });

  test('needsEmojiStrip is a strict platform check', () => {
    for (const p of ['Darwin', 'darwin ', 'macos', 'ios', '', null]) assert.equal(needsEmojiStrip(p), false, String(p));
    assert.equal(needsEmojiStrip('darwin'), true);
  });
});

// --- rendering -------------------------------------------------------------------------

/** Minimal PNG decoder: 8-bit RGBA or RGB, non-interlaced (same as test/png.test.js). */
function decodePng(buf) {
  assert.ok(pngSize(buf), 'not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  assert.ok(ihdr && ihdr.depth === 8 && ihdr.interlace === 0, 'unsupported PNG');
  const channels = { 6: 4, 2: 3 }[ihdr.color];
  assert.ok(channels, `unsupported color type ${ihdr.color}`);
  const { width, height } = ihdr;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = 0;
      if (filter === 1) v = a;
      else if (filter === 2) v = b;
      else if (filter === 3) v = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      line[i] = (line[i] + v) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

/** Bright (near-white, opaque) pixels outside the columns [left, right). */
function brightOutside(img, left, right) {
  const hits = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x >= left && x < right) continue;
      const d = (y * img.width + x) * 4;
      const p = img.pixels;
      if (p[d] >= 235 && p[d + 1] >= 235 && p[d + 2] >= 235 && p[d + 3] >= 250) hits.push([x, y]);
    }
  }
  return hits;
}

describe('renderPng with platform darwin', () => {
  const SLACK = 6;

  test('emoji-heavy share card keeps all bright pixels within the padding', async (t) => {
    if (!needResvg(t)) return;
    const s = emojiStats();
    const heavy = { repoName: `${'🚀'.repeat(30)} ${'🎉🇹🇷👨‍👩‍👧‍👦'.repeat(10)}`, author: `${'👩‍💻'.repeat(20)} Ada`, since: '2024-01-01' };
    for (const [label, svg] of [['emoji', renderShareCard(s, EMOJI_OPTS)], ['heavy', renderShareCard(s, heavy)]]) {
      const img = decodePng(await renderPng(svg, { platform: 'darwin' }));
      assert.equal(img.width, 1200, label);
      const hits = brightOutside(img, 64 - SLACK, img.width - 64 + SLACK);
      assert.deepEqual(hits.slice(0, 5), [], `${label}: ${hits.length} bright pixels outside the padding`);
    }
  });

  test('emoji-heavy story cards keep all bright pixels within the padding', async (t) => {
    if (!needResvg(t)) return;
    for (const [id, svg] of emojiCards()) {
      if (id === 'share') continue;
      const img = decodePng(await renderPng(svg, { platform: 'darwin', width: 540 }));
      const pad = 96 / 2; // rendered at half size
      const hits = brightOutside(img, pad - SLACK, img.width - pad + SLACK);
      assert.deepEqual(hits.slice(0, 5), [], `${id}: ${hits.length} bright pixels outside the padding`);
    }
  });

  test('darwin output equals rendering the pre-stripped SVG; non-darwin keeps emoji', async (t) => {
    if (!needResvg(t)) return;
    const svg = renderShareCard(emojiStats(), EMOJI_OPTS);
    const [mac, pre, linux, linuxRaw] = await Promise.all([
      renderPng(svg, { width: 400, platform: 'darwin' }),
      renderPng(stripEmojiFromText(svg), { width: 400, platform: 'linux' }),
      renderPng(svg, { width: 400, platform: 'linux' }),
      renderPng(svg, { width: 400, platform: 'win32' }),
    ]);
    const stripped = stripEmojiFromText(svg);
    assert.notEqual(stripped, svg, 'the strip changed the SVG');
    assert.ok(textRuns(svg).join('').includes(ROCKET) && !textRuns(stripped).join('').includes(ROCKET), 'the emoji is gone from the text');
    assert.ok(!mac.equals(linux), 'darwin output differs from the unstripped render');
    assert.ok(mac.equals(pre), 'darwin renders the stripped SVG');
    assert.ok(linux.equals(linuxRaw), 'linux and win32 render the same unstripped SVG');
  });

  test('an emoji-only text node renders as nothing on darwin (no stray glyph)', async (t) => {
    if (!needResvg(t)) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#000"/>'
      + `<text x="10" y="40" font-size="32" fill="#fff">${EMOJI_SAMPLES.join('')}</text></svg>`;
    const img = decodePng(await renderPng(svg, { platform: 'darwin' }));
    assert.equal(brightOutside(img, 0, 0).length, 0);
  });
});
