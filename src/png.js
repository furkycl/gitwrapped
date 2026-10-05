// PNG export: rasterizes the card SVGs with @resvg/resvg-js (a prebuilt native module,
// no network, no browser). The module is loaded lazily so that a missing or unsupported
// native binary only disables PNG output instead of breaking the whole CLI.
//
// Text uses the machine's installed fonts (loadSystemFonts). The cards ask for a system
// sans stack ending in `sans-serif`; resvg maps that generic family to SANS_FAMILY below,
// and falls back to whatever sans-serif fonts the system has when that one is missing.
//
// macOS: resvg-js 2.6.2 misplaces Apple Color Emoji (sbix bitmap) glyphs, drawing them
// hundreds of px to the right of their text (often past the card edge) while every other
// glyph lands where it should. No stable resvg-js release fixes it, so on darwin renderPng
// drops color-emoji clusters from the SVG's text before rasterizing (stripEmojiFromText).
// The SVG cards and wrapped.html are not touched and keep their emoji.

import { graphemes, isEmojiCluster } from './cards/svg.js';

const SANS_BY_PLATFORM = { linux: 'DejaVu Sans', darwin: 'Helvetica', win32: 'Segoe UI' };

/** The default sans-serif family for this platform (used when the SVG's fonts are missing). */
export const SANS_FAMILY = SANS_BY_PLATFORM[process.platform] ?? 'DejaVu Sans';

/** True when PNG text must lose its color emoji on `platform` (see the header comment). */
export function needsEmojiStrip(platform = process.platform) {
  return platform === 'darwin';
}

const KEYCAP = /^[0-9#*]️?⃣$/u;
// Code points that default to emoji presentation (✨ ⚡ ✅ ❌ ⭐ ☕ ⌛ ⏰ ...), so a font
// without the glyph falls back to the color emoji font even without U+FE0F.
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const SPECIAL_REF = new Set([0x26, 0x3c, 0x3e, 0x22, 0x27]); // & < > " '
const ASCII_SPACE = /^[ \t\n\r]+$/;
const TEXT_OPEN = /^<text\b/;
const TEXT_CLOSE = /^<\/text\s*>$/;

/**
 * A grapheme cluster drawn from a color emoji font: emoji (isEmojiCluster), flags,
 * keycaps (1️⃣ #️⃣) and Emoji_Presentation code points unless U+FE0E asks for text style.
 * Text-presentation symbols without U+FE0F (© ® ™ ↔ ✓ ☀ ♥ ‼ ⌘) are kept.
 */
function isColorEmoji(cluster) {
  if (isEmojiCluster(cluster) || KEYCAP.test(cluster)) return true;
  return EMOJI_PRESENTATION.test(cluster) && !cluster.includes('︎');
}

/** Decode numeric character references, except those for XML-special characters. */
function decodeNumericRefs(s) {
  return s.replace(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g, (ref, hex, dec) => {
    const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!(cp > 0 && cp <= 0x10ffff) || SPECIAL_REF.has(cp) || (cp >= 0xd800 && cp <= 0xdfff)) return ref;
    return String.fromCodePoint(cp);
  });
}

/**
 * Remove color-emoji clusters from one run of XML character data. A stretch of emoji and
 * ASCII whitespace (with at least one emoji) becomes one space when it had whitespace,
 * or nothing when it had none; at an edge where `trimStart` / `trimEnd` is set (the run
 * touches its <text> element's own start or end tag) it becomes nothing. Linear time.
 * Text without emoji is returned unchanged.
 */
function stripEmojiRun(raw, trimStart, trimEnd) {
  const clusters = graphemes(decodeNumericRefs(raw));
  const emoji = clusters.map(isColorEmoji);
  if (!emoji.includes(true)) return raw;
  let out = '';
  let i = 0;
  while (i < clusters.length) {
    if (!emoji[i] && !ASCII_SPACE.test(clusters[i])) {
      out += clusters[i++];
      continue;
    }
    // A stretch of emoji / whitespace clusters: [i, j).
    let j = i;
    let hasEmoji = false;
    let hasSpace = false;
    for (; j < clusters.length && (emoji[j] || ASCII_SPACE.test(clusters[j])); j++) {
      if (emoji[j]) hasEmoji = true;
      else hasSpace = true;
    }
    const atTrimmedEdge = (i === 0 && trimStart) || (j === clusters.length && trimEnd);
    if (!hasEmoji) out += clusters.slice(i, j).join('');
    else if (hasSpace && !atTrimmedEdge) out += ' ';
    i = j;
  }
  return out;
}

/**
 * Remove color-emoji grapheme clusters (ZWJ sequences, VS16, skin tones, keycaps, flags,
 * Emoji_Presentation symbols) from the character data of <text> and <tspan> elements of
 * `svg`. Markup (tag names, attributes, ids) and character data outside text elements are
 * left as is; entities such as &amp; stay intact, and numeric references to emoji
 * (&#x1F680;) are removed too. Whitespace is trimmed only at the start and end of a whole
 * <text> element's content; next to a child element it collapses to one space.
 *
 * Assumes card-generated SVG (src/cards/svg.js): '>' is escaped in attribute values and
 * text carries no CDATA sections (a CDATA section is passed through untouched).
 */
export function stripEmojiFromText(svg) {
  const parts = String(svg ?? '').split(/(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>)/);
  let depth = 0; // nesting depth of open <text>/<tspan> elements
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const tag = /^<(\/?)(text|tspan)\b[^>]*?(\/?)>$/.exec(part);
      if (tag && !tag[3]) depth = Math.max(0, depth + (tag[1] ? -1 : 1));
    } else if (depth > 0 && part) {
      const before = parts[i - 1] ?? '';
      const after = parts[i + 1] ?? '';
      parts[i] = stripEmojiRun(part, TEXT_OPEN.test(before), TEXT_CLOSE.test(after));
    }
  }
  return parts.join('');
}

let resvgPromise = null;

/**
 * Load @resvg/resvg-js once. Resolves to the Resvg class; rejects (with a short message)
 * when the package or its native binary for this platform is unavailable.
 */
export function loadResvg() {
  resvgPromise ??= import('@resvg/resvg-js').then(
    (mod) => {
      const Resvg = mod.Resvg ?? mod.default?.Resvg;
      if (typeof Resvg !== 'function') throw new Error('@resvg/resvg-js has no Resvg export');
      return Resvg;
    },
    (err) => {
      resvgPromise = null;
      const msg = String(err?.message ?? err).split('\n')[0];
      throw new Error(`could not load @resvg/resvg-js (${msg})`);
    },
  );
  return resvgPromise;
}

/**
 * Render an SVG string to a PNG Buffer, scaled to `width` px wide (aspect ratio kept).
 * Transparent areas stay transparent (the cards paint their own full-bleed background).
 * On macOS (`platform`, default process.platform) color emoji are left out of the text.
 */
export async function renderPng(svg, { width, platform = process.platform } = {}) {
  const Resvg = await loadResvg();
  const opts = {
    font: { loadSystemFonts: true, defaultFontFamily: SANS_FAMILY, sansSerifFamily: SANS_FAMILY },
  };
  if (width !== undefined) {
    if (!(Number.isInteger(width) && width > 0)) throw new TypeError('renderPng width must be a positive integer');
    opts.fitTo = { mode: 'width', value: width };
  }
  const source = needsEmojiStrip(platform) ? stripEmojiFromText(svg) : String(svg);
  const rendered = new Resvg(source, opts).render();
  return Buffer.from(rendered.asPng());
}

/** Width and height of a PNG buffer, read from its IHDR chunk (null if not a PNG). */
export function pngSize(buf) {
  const SIG = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.subarray(0, 8).toString('hex') !== SIG) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
