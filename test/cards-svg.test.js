import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  escapeXml, wrapText, measureText, truncateStart, renderCard, THEMES, CARD_WIDTH, CARD_HEIGHT,
} from '../src/cards/svg.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const INJECT = `<script>&"'`;
const INJECT_ESCAPED = '&lt;script&gt;&amp;&quot;&apos;';

// Deterministic PRNG for the property-style tests.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('escapeXml', () => {
  test('escapes all five XML entities', () => {
    assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
    assert.equal(escapeXml('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  });

  test('does not double-escape in a single pass', () => {
    assert.equal(escapeXml('&amp;'), '&amp;amp;');
  });

  test('strips control characters, keeps tab/LF/CR', () => {
    assert.equal(escapeXml('a\u0000b\u0001c\u0008d\u000Be\u000Cf\u001Fg\u007Fh\u0085i\u009Fj'), 'abcdefghij');
    assert.equal(escapeXml('a\tb\nc\rd'), 'a\tb\nc\rd');
    assert.equal(escapeXml('x￾y￿z'), 'xyz');
  });

  test('strips lone surrogates but keeps valid pairs (emoji)', () => {
    assert.equal(escapeXml('a\uD800b'), 'ab');
    assert.equal(escapeXml('a\uDC00b'), 'ab');
    assert.equal(escapeXml('\uDC00\uD800'), '');
    assert.equal(escapeXml('🚀 ship it 🎉'), '🚀 ship it 🎉');
    assert.equal(escapeXml('👩‍💻'), '👩‍💻');
    assert.equal(escapeXml('🇹🇷'), '🇹🇷');
    assert.equal(escapeXml('x\uD83D'), 'x'); // high half of an emoji, cut off
  });

  test('null/undefined → empty string, numbers stringified', () => {
    assert.equal(escapeXml(null), '');
    assert.equal(escapeXml(undefined), '');
    assert.equal(escapeXml(0), '0');
    assert.equal(escapeXml(42), '42');
  });
});

describe('measureText', () => {
  test('scales with font size and is additive', () => {
    assert.equal(measureText('', 40), 0);
    assert.equal(measureText(null, 40), 0);
    const a = measureText('hello', 40);
    assert.ok(a > 0);
    assert.ok(Math.abs(measureText('hello', 80) - 2 * a) < 1e-9);
    assert.ok(Math.abs(measureText('hellohello', 40) - 2 * a) < 1e-9);
  });

  test('wide glyphs are wider than narrow ones; emoji ~1.3em, CJK 1em', () => {
    assert.ok(measureText('MMMM', 10) > measureText('iiii', 10));
    assert.equal(measureText('🚀', 10), 13);
    assert.equal(measureText('🇹🇷', 10), 13); // a flag (regional-indicator pair) is one emoji
    assert.equal(measureText('👨‍👩‍👧‍👦', 10), 13); // a ZWJ family is one emoji
    assert.equal(measureText('李', 10), 10);
    assert.equal(measureText('©', 10), 8.4); // text-style symbol: normal symbol width
    assert.equal(measureText('❤️', 10), 13); // pictograph + U+FE0F
    assert.equal(measureText('é', 10), measureText('e', 10)); // combining mark is zero-width
  });
});

describe('wrapText', () => {
  const opts = { maxWidth: 400, fontSize: 40 };

  test('empty / whitespace-only text → [] (documented)', () => {
    assert.deepEqual(wrapText('', opts), []);
    assert.deepEqual(wrapText('   \n\t ', opts), []);
    assert.deepEqual(wrapText(null, opts), []);
    assert.deepEqual(wrapText(undefined, opts), []);
  });

  test('throws on non-positive maxWidth or fontSize', () => {
    assert.throws(() => wrapText('x', { maxWidth: 0, fontSize: 10 }), TypeError);
    assert.throws(() => wrapText('x', { maxWidth: 10, fontSize: -1 }), TypeError);
    assert.throws(() => wrapText('x'), TypeError);
  });

  test('short text stays on one line; whitespace collapses', () => {
    assert.deepEqual(wrapText('  hello   world  ', opts), ['hello world']);
  });

  test('wraps at word boundaries', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog again and again', opts);
    assert.ok(lines.length > 1);
    assert.equal(lines.join(' '), 'the quick brown fox jumps over the lazy dog again and again');
    for (const l of lines) assert.ok(measureText(l, 40) <= 400, l);
  });

  test('respects maxLines and ends the last line with …', () => {
    const text = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';
    const all = wrapText(text, opts);
    assert.ok(all.length > 2);
    const two = wrapText(text, { ...opts, maxLines: 2 });
    assert.equal(two.length, 2);
    assert.equal(two[0], all[0]);
    assert.ok(two[1].endsWith('…'), two[1]);
    for (const l of two) assert.ok(measureText(l, 40) <= 400, l);
    // Exactly at the limit: no ellipsis.
    const exact = wrapText(text, { ...opts, maxLines: all.length });
    assert.deepEqual(exact, all);
    assert.ok(!exact.at(-1).endsWith('…'));
  });

  test('maxLines 1 on a long text gives one ellipsized line', () => {
    const one = wrapText('a b c d e f g h i j k l m n o p q r s t u v w x y z '.repeat(5), { ...opts, maxLines: 1 });
    assert.equal(one.length, 1);
    assert.ok(one[0].endsWith('…'));
    assert.ok(measureText(one[0], 40) <= 400);
  });

  test('never exceeds maxWidth (property test, mixed content)', () => {
    const alphabet = ['a', 'b', 'm', 'W', 'i', 'l', '/', '-', '.', '0', '9', 'É', '🚀', '👩‍💻', '中', ' ', ' ', ' ', 'x', 'é'];
    const rand = rng(1234);
    for (let iter = 0; iter < 400; iter++) {
      const len = Math.floor(rand() * 120);
      let text = '';
      for (let i = 0; i < len; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
      const fontSize = 10 + Math.floor(rand() * 60);
      const maxWidth = 20 + Math.floor(rand() * 600);
      const maxLines = rand() < 0.5 ? Infinity : 1 + Math.floor(rand() * 4);
      const lines = wrapText(text, { maxWidth, fontSize, maxLines });
      assert.ok(lines.length <= maxLines);
      for (const l of lines) {
        assert.ok(l.length > 0, 'no empty lines');
        assert.ok(!LONE_SURROGATE.test(l), `lone surrogate in ${JSON.stringify(l)}`);
        const w = measureText(l, fontSize);
        if (w > maxWidth) {
          // Only allowed for a single unbreakable grapheme (optionally + '…').
          const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(l.replace(/…$/, ''))];
          assert.ok(graphemes.length <= 1, `line ${JSON.stringify(l)} width ${w} > ${maxWidth} (font ${fontSize})`);
        }
      }
    }
  });

  test('a single glyph wider than maxWidth is still emitted', () => {
    assert.deepEqual(wrapText('W', { maxWidth: 5, fontSize: 40 }), ['W']);
    assert.deepEqual(wrapText('WW', { maxWidth: 5, fontSize: 40 }), ['W', 'W']);
  });

  test('hard-breaks long paths right after a "/" when possible', () => {
    const path = 'src/components/dashboard/widgets/charts/LineChartWithTooltip.tsx';
    const lines = wrapText(path, { maxWidth: 500, fontSize: 40 });
    assert.ok(lines.length > 1);
    assert.equal(lines.join(''), path);
    // A '/' is preferred only when it keeps a reasonable chunk (≥ 1/3 of the line), so
    // "charts/LineChartWithTooltip.tsx" is hard-broken mid-name instead of after "charts/".
    assert.deepEqual(lines.slice(0, 2), ['src/components/', 'dashboard/widgets/']);
    for (const l of lines.slice(0, 2)) assert.ok(l.endsWith('/'), `expected break after '/': ${JSON.stringify(lines)}`);
    for (const l of lines) assert.ok(measureText(l, 40) <= 500);
  });

  test('long word without slashes is hard-broken and fully preserved', () => {
    const word = 'a'.repeat(200);
    const lines = wrapText(word, { maxWidth: 300, fontSize: 40 });
    assert.ok(lines.length > 1);
    assert.equal(lines.join(''), word);
  });

  test('does not split emoji / surrogate pairs / ZWJ sequences', () => {
    const fam = '👨‍👩‍👧‍👦';
    const text = `${'🚀'.repeat(30)}${fam.repeat(5)}${'🇹🇷'.repeat(10)}`;
    for (const maxWidth of [30, 41, 80, 123, 200]) {
      const lines = wrapText(text, { maxWidth, fontSize: 40 });
      assert.equal(lines.join(''), text);
      for (const l of lines) {
        assert.ok(!LONE_SURROGATE.test(l));
        assert.ok(!l.startsWith('‍') && !l.endsWith('‍'), 'no cut ZWJ sequence');
        assert.ok(!/^[\u{1F1E6}-\u{1F1FF}]([\u{1F1E6}-\u{1F1FF}]{2})*$/u.test(l), 'flags not split into single regional indicators');
      }
    }
  });

  test('ellipsized last line does not split an emoji', () => {
    const lines = wrapText('🚀🚀🚀🚀🚀🚀 🚀🚀🚀🚀🚀🚀 🚀🚀🚀🚀🚀🚀', { maxWidth: 260, fontSize: 40, maxLines: 1 });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].endsWith('…'));
    assert.ok(!LONE_SURROGATE.test(lines[0]));
  });
});

describe('truncateStart', () => {
  test('leaves short text alone and keeps the tail of long text', () => {
    assert.equal(truncateStart('src/app.js', { maxWidth: 800, fontSize: 40 }), 'src/app.js');
    const long = 'packages/very/deeply/nested/folder/structure/that/goes/on/forever/index.js';
    const out = truncateStart(long, { maxWidth: 500, fontSize: 40 });
    assert.ok(out.startsWith('…'));
    assert.ok(out.endsWith('index.js'));
    assert.ok(measureText(out, 40) <= 500);
    assert.ok(long.endsWith(out.slice(1)));
  });

  test('does not leave a lone surrogate', () => {
    const out = truncateStart('🚀'.repeat(50), { maxWidth: 300, fontSize: 40 });
    assert.ok(!LONE_SURROGATE.test(out));
    assert.equal(truncateStart(null, { maxWidth: 100, fontSize: 10 }), '');
  });
});

describe('renderCard', () => {
  const sample = {
    theme: 'ocean',
    eyebrow: 'The grand total',
    big: '1,234',
    title: 'commits',
    subtitle: 'That is a lot of commits per active day.',
    lines: [{ label: 'Lines added', value: '+99' }, 'plain row', { label: 'src/a/b/c.js', value: '3 commits', truncate: 'start' }],
    footer: 'repo · 2024-01-01 → 2024-03-01',
  };

  test('is a standalone 1080x1920 SVG', () => {
    const svg = renderCard(sample);
    assert.equal(CARD_WIDTH, 1080);
    assert.equal(CARD_HEIGHT, 1920);
    assert.ok(svg.startsWith('<svg'), svg.slice(0, 40));
    assert.match(svg, /^<svg[^>]*\swidth="1080"/);
    assert.match(svg, /^<svg[^>]*\sheight="1920"/);
    assert.match(svg, /^<svg[^>]*\sviewBox="0 0 1080 1920"/);
    assert.match(svg, /^<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.includes('<linearGradient'));
    assert.ok(svg.trimEnd().endsWith('</svg>'));
  });

  test('no external resources: no <image, no @import, no http except xmlns', () => {
    for (const svg of [renderCard(sample), renderCard({}), renderCard()]) {
      assert.ok(!svg.includes('<image'));
      assert.ok(!svg.includes('@import'));
      assert.ok(!/xlink:href|href=/.test(svg));
      const withoutNs = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
      assert.ok(!withoutNs.toLowerCase().includes('http'), 'unexpected http reference');
    }
  });

  test('deterministic', () => {
    assert.equal(renderCard(sample), renderCard({ ...sample, lines: [...sample.lines] }));
    assert.equal(renderCard({}), renderCard({}));
  });

  test('every user-supplied field is escaped', () => {
    const svg = renderCard({
      theme: 'pulse',
      eyebrow: `eb ${INJECT}`,
      big: INJECT,
      title: `title ${INJECT}`,
      subtitle: `sub ${INJECT}`,
      lines: [{ label: `label ${INJECT}`, value: `v${INJECT}` }, `row ${INJECT}`, { label: `path/${INJECT}`, truncate: 'start' }],
      footer: `foot ${INJECT}`,
    });
    assert.ok(!/<script/i.test(svg), 'raw <script must not appear');
    assert.ok(!svg.includes(INJECT));
    // eyebrow is upper-cased
    assert.ok(svg.includes('&lt;SCRIPT&gt;&amp;&quot;&apos;'));
    for (const prefix of ['', 'title ', 'sub ', 'label ', 'v', 'row ', 'path/', 'foot ']) {
      assert.ok(svg.includes(`${prefix}${INJECT_ESCAPED}`), `missing escaped field "${prefix}"`);
    }
    // no raw & that is not an entity
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(svg));
  });

  test('unknown or missing theme falls back to the default theme', () => {
    const def = renderCard({ ...sample, theme: 'pulse' });
    assert.equal(renderCard({ ...sample, theme: 'nope' }), def);
    assert.equal(renderCard({ ...sample, theme: undefined }), def);
    assert.equal(renderCard({ ...sample, theme: '__proto__' }), def);
    assert.equal(renderCard({ ...sample, theme: 'toString' }), def);
    assert.notEqual(renderCard({ ...sample, theme: 'ocean' }), def);
  });

  test('every theme renders its own gradient stops', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      const svg = renderCard({ theme: name, big: 'x' });
      for (const c of t.stops) assert.ok(svg.includes(`stop-color="${c}"`), `${name} ${c}`);
    }
  });

  test('draws at most 6 rows and skips empty rows', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ label: `row-${i}`, value: String(i) }));
    const svg = renderCard({ lines: [{ label: '', value: '' }, null, ...rows] });
    assert.ok(svg.includes('row-5'));
    assert.ok(!svg.includes('row-6'));
    assert.ok(!svg.includes('null'));
  });

  test('null/undefined fields render no "null"/"undefined" text', () => {
    const svg = renderCard({ eyebrow: null, title: undefined, big: null, subtitle: null, lines: null, footer: null });
    assert.ok(!/null|undefined|NaN/.test(svg));
    assert.ok(svg.includes('gitwrapped card'));
  });

  test('text coordinates stay inside the canvas, even with huge content', () => {
    const svg = renderCard({
      big: 'W'.repeat(300),
      title: 'word '.repeat(200),
      subtitle: 'another '.repeat(200),
      lines: Array.from({ length: 6 }, () => ({ label: 'x/'.repeat(100), value: '9'.repeat(60), truncate: 'start' })),
      footer: 'f'.repeat(300),
    });
    for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"/g)) {
      const [x, y] = [Number(m[1]), Number(m[2])];
      assert.ok(x >= 0 && x <= CARD_WIDTH, `x=${x}`);
      assert.ok(y >= 0 && y <= CARD_HEIGHT, `y=${y}`);
    }
  });

  test('font stack ends with the generic sans-serif family', () => {
    const m = renderCard(sample).match(/font-family="([^"]*)"/);
    assert.ok(m, 'font-family attribute present');
    assert.ok(m[1].endsWith(', sans-serif'), m[1]);
  });

  test('ids default to gw-<theme>; idPrefix overrides them', () => {
    const ids = (svg) => [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    const refs = (svg) => [...svg.matchAll(/url\(#([^)]*)\)/g)].map((m) => m[1]);
    const def = renderCard({ ...sample, theme: 'ocean' });
    assert.ok(ids(def).length > 0);
    for (const id of ids(def)) assert.ok(id.startsWith('gw-ocean-'), id);
    const custom = renderCard({ ...sample, theme: 'ocean', idPrefix: 'card-7' });
    assert.ok(ids(custom).length > 0);
    for (const id of ids(custom)) assert.ok(id.startsWith('card-7-'), id);
    for (const ref of refs(custom)) assert.ok(ids(custom).includes(ref), `dangling url(#${ref})`);
    // Distinct prefixes → disjoint id sets, even with the same theme.
    const other = renderCard({ ...sample, theme: 'ocean', idPrefix: 'card-8' });
    assert.ok(ids(other).every((id) => !ids(custom).includes(id)));
    // Empty / missing prefix keeps the default.
    assert.equal(renderCard({ ...sample, idPrefix: '' }), renderCard(sample));
    assert.equal(renderCard({ ...sample, idPrefix: null }), renderCard(sample));
  });

  test('idPrefix is sanitized into a valid XML id', () => {
    const svg = renderCard({ ...sample, idPrefix: `9 bad"id<${INJECT}` });
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) assert.match(id, /^[A-Za-z_][A-Za-z0-9_.-]*$/);
    assert.ok(!svg.includes(INJECT));
  });

  test('non-big text wraps within ~95% of the content width', () => {
    const wrap = (CARD_WIDTH - 2 * 96) * 0.95;
    const svg = renderCard({
      title: 'mmmm wwww '.repeat(12),
      subtitle: 'average everyday words making a fairly long subtitle line here '.repeat(3),
      lines: [{ label: 'a pretty long label that will need to be shortened somehow', value: '1,234' }, { label: 'src/'.repeat(40), truncate: 'start' }],
    });
    let checked = 0;
    for (const m of svg.matchAll(/<text x="96" y="[\d.]+" font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) {
      const size = Number(m[1]);
      if (size !== 72 && size !== 44 && size !== 40) continue;
      checked += 1;
      assert.ok(measureText(m[2], size) <= wrap, `${JSON.stringify(m[2])} at ${size}px`);
    }
    assert.ok(checked >= 4, `checked ${checked} lines`);
  });
});

describe('svg.js source', () => {
  test('regexes use \\u escapes instead of literal invisible / special characters', () => {
    const src = readFileSync(new URL('../src/cards/svg.js', import.meta.url), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (!/=\s*\/.*\/[gimsuy]*;/.test(line)) continue; // regex literal assignments
      const bad = [...line].filter((ch) => ch.codePointAt(0) > 0x7e);
      assert.deepEqual(bad.map((c) => c.codePointAt(0).toString(16)), [], `line ${i + 1}`);
    }
    // Invisible / format / combining characters must not appear anywhere in the source.
    assert.ok(!/[̀-ͯ​-‏⃐-⃿︀-️￾￿]/u.test(src));
  });

  test('escaped regexes keep the same behavior', () => {
    assert.equal(escapeXml('x￾y￿z'), 'xyz');
    assert.equal(measureText('é', 10), measureText('e', 10));
    assert.equal(measureText('​', 10), 0);
    assert.equal(measureText('️', 10), 0);
    assert.equal(measureText('가', 10), 10); // Hangul syllable: full width
    assert.equal(measureText('Ａ', 10), 10); // fullwidth A
    assert.equal(measureText('\u{20000}', 10), 10); // CJK ext. B
  });
});
