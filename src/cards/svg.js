// Story-card renderer: 1080x1920 standalone SVG strings with a bold gradient style.
// Pure and deterministic (no randomness, no dates, no I/O). Text uses a system font
// stack only, so the SVGs need no external fonts, images or stylesheets.
import { dayKeyFromEpoch, epochDay, mondayOf } from '../stats/time.js';
import { formatInteger, getStrings } from '../i18n/index.js';
import { DEFAULT_GRADIENTS, getColorTheme } from './themes.js';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

export const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PAD_X = 96;
const CONTENT_WIDTH = CARD_WIDTH - 2 * PAD_X;
// Non-big text wraps a little short of the content width: the width model is an
// approximation and bold faces can run wider than it predicts.
const WRAP_WIDTH = Math.floor(CONTENT_WIDTH * 0.95);
const ELLIPSIS = '…';
/** The default string table (see src/i18n). */
const EN = getStrings('en');

/**
 * The default gradients by name ('pulse', 'ocean', …), see themes.js. Each has `stops`
 * (3 colors, top-left → bottom-right), `glow` and `angle`. Other color themes (`--theme`)
 * map the same names to other colors (COLOR_THEMES in themes.js).
 */
export const THEMES = DEFAULT_GRADIENTS;

const DEFAULT_THEME = 'pulse';

// Characters not allowed in XML 1.0 (C0 controls except tab/LF/CR, U+FFFE/U+FFFF, lone
// surrogates), plus DEL and C1 controls, which are legal but never wanted on a card, and
// the bidi embedding / override / isolate controls (U+202A-202E, U+2066-2069) and line /
// paragraph separators (U+2028/2029), which could reorder or break a card's text.
// With the `u` flag a valid surrogate pair is one code point, so only lone halves match.
const BAD_XML_CLASS = '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFFFE\\uFFFF\\uD800-\\uDFFF]';
const BAD_XML_CHARS = new RegExp(BAD_XML_CLASS, 'gu');
// One character escapeXml() strips: it is never drawn, so it measures 0 wide.
const STRIPPED_CHAR = new RegExp(`^${BAD_XML_CLASS}$`, 'u');
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escape text for XML content or attribute values; strips XML-invalid control characters. */
export function escapeXml(s) {
  return String(s ?? '')
    .replace(BAD_XML_CHARS, '')
    .replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

// ---------------------------------------------------------------------------------------
// Text measurement: per-glyph advance widths (in em) of DejaVu Sans Bold, the Linux
// fallback sans and one of the widest common sans faces. Calibrating against it makes the
// model err wide for the narrower faces browsers and other platforms pick (Helvetica,
// Segoe UI, Roboto, Arial ...), so fitted text never runs past the card padding.
// test/png.test.js checks the model against real resvg-rendered widths.

// Advance widths in 1/1000 em for ASCII 0x20 (space) .. 0x7E (~).
const ASCII_WIDTHS = [
  348, 456, 521, 838, 696, 1002, 872, 306, 457, 457, 523, 838, 380, 415, 380, 365,
  696, 696, 696, 696, 696, 696, 696, 696, 696, 696, 400, 400, 838, 838, 838, 580,
  1000, 774, 762, 734, 830, 683, 683, 821, 837, 372, 372, 775, 637, 995, 837, 850,
  733, 850, 770, 720, 682, 812, 774, 1103, 771, 724, 725, 457, 365, 457, 838, 500,
  500, 675, 716, 593, 716, 678, 435, 716, 712, 343, 343, 665, 343, 1042, 712, 687,
  716, 716, 493, 595, 478, 712, 652, 924, 645, 652, 582, 712, 365, 712, 838,
];
const ZERO_WIDTH = /[\u0300-\u036F\u200B-\u200F\u20D0-\u20FF\uFE00-\uFE0F]|\p{M}/u;
const PICTO = /\p{Extended_Pictographic}/u;
const PICTO_OR_RI = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const RI = /\p{Regional_Indicator}/u;
const FULL_WIDTH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3fffd}]/u;
const LETTER = /\p{L}/u;
/** A color emoji renders wider than a CJK ideograph in most emoji fonts: ~1.3em. */
const EMOJI_WIDTH = 1.3;

/**
 * Runs of whitespace that text layout collapses to one space and breaks lines at: every
 * whitespace character except the no-break space (U+00A0), which keeps "+5\u00a0days"
 * together on one line.
 */
const SPACES = /[^\S\u00a0]+/g;

/** Width of one code point, in em (emoji clusters are handled by measureText). */
function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_WIDTHS[cp - 0x20] / 1000;
  if (cp === 0xa0) return ASCII_WIDTHS[0] / 1000; // no-break space: as wide as a space
  if (ZERO_WIDTH.test(ch) || STRIPPED_CHAR.test(ch)) return 0;
  if (FULL_WIDTH.test(ch)) return 1;
  if (cp === 0x2026 || cp === 0x2014) return 1; // ellipsis, em dash
  if (cp < 0x20) return 0;
  // Other letters (accented Latin, Greek, Cyrillic ...) as a wide capital; symbols
  // (including text-style pictographs such as (c), (R), TM and arrows) as '+'.
  return LETTER.test(ch) ? 0.85 : 0.84;
}

/**
 * True for a grapheme cluster that renders as one color emoji: it has a pictograph at
 * U+1F000 or above, a pictograph followed by U+FE0F (emoji presentation), or a
 * regional indicator (flags). Also used by src/png.js to drop emoji on macOS.
 */
export function isEmojiCluster(cluster) {
  const cps = Array.from(cluster);
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (RI.test(ch)) return true;
    if (PICTO.test(ch) && (ch.codePointAt(0) >= 0x1f000 || cps[i + 1] === '\uFE0F')) return true;
  }
  return false;
}

/** Width of one grapheme cluster, in em: an emoji counts EMOJI_WIDTH once. */
function clusterWidth(cluster) {
  if (isEmojiCluster(cluster)) return EMOJI_WIDTH;
  let em = 0;
  for (const ch of cluster) em += charWidth(ch);
  return em;
}

/**
 * Approximate rendered width of `text` in px at `fontSize`. Text with pictographs or
 * regional indicators is measured per grapheme cluster, so a ZWJ family or a flag
 * counts as one emoji.
 */
export function measureText(text, fontSize) {
  const s = String(text ?? '');
  let em = 0;
  if (PICTO_OR_RI.test(s)) {
    for (const g of graphemeIter(s)) em += clusterWidth(g);
  } else {
    for (const ch of s) em += charWidth(ch);
  }
  return em * fontSize;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** Split into grapheme clusters (so emoji sequences are never cut in half). */
export function graphemes(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Iterate the grapheme clusters of `text` lazily (stops early when the caller does). */
function* graphemeIter(text) {
  if (segmenter) for (const s of segmenter.segment(text)) yield s.segment;
  else yield* text;
}

/**
 * Hard-break `word` (wider than `maxWidth`) into chunks that each fit, pushing full
 * chunks onto `lines` until `lines` holds `limit` lines. Each chunk is the longest prefix
 * that fits (at least one grapheme), cut right after a '/' (file paths) when that keeps a
 * reasonable chunk. Returns the last, fitting remainder ('' when the limit was reached
 * first). Reads the word once, and only as far as the kept lines need.
 */
function hardBreak(word, maxWidth, fontSize, lines, limit) {
  let chunk = []; // graphemes of the current chunk
  let width = 0;
  let slash = -1; // index in `chunk` of the last '/'
  for (const g of graphemeIter(word)) {
    if (lines.length >= limit) return '';
    const w = measureText(g, fontSize);
    if (chunk.length > 0 && width + w > maxWidth) {
      // Break; carry the part after a reasonable '/' over to the next chunk.
      const cut = slash >= Math.floor(chunk.length / 3) && slash < chunk.length - 1 ? slash + 1 : chunk.length;
      lines.push(chunk.slice(0, cut).join(''));
      chunk = chunk.slice(cut);
      width = measureText(chunk.join(''), fontSize);
      slash = chunk.lastIndexOf('/');
      if (lines.length >= limit) return '';
      // The carried part plus `g` may still be too wide (only when `g` is huge): flush it.
      if (chunk.length > 0 && width + w > maxWidth) {
        lines.push(chunk.join(''));
        chunk = [];
        width = 0;
        slash = -1;
        if (lines.length >= limit) return '';
      }
    }
    chunk.push(g);
    width += w;
    if (g === '/') slash = chunk.length - 1;
  }
  return chunk.join('');
}

/** `line` shortened (from the end) so that `line + '…'` fits `maxWidth`. */
function ellipsize(line, maxWidth, fontSize) {
  const gs = graphemes(line.trimEnd());
  while (gs.length > 0 && measureText(gs.join('') + ELLIPSIS, fontSize) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ELLIPSIS;
}

/** `text` shortened from the start ('…' + tail) so that it fits `maxWidth`. */
/**
 * `text` on one line within `maxWidth` (as measured by `width`), keeping the part from
 * the last `sep` on whole and cutting the part before it with '…' first: a footer like
 * "my-long-repo · Jan 3 – Mar 9, 2025" keeps its date window. When there is no `sep`, or
 * the tail alone does not fit, returns `fallback(text)`.
 */
export function fitKeepTail(text, { maxWidth, width, fallback, sep = ' · ' }) {
  text = String(text ?? '');
  if (width(text) <= maxWidth) return text;
  const i = text.lastIndexOf(sep);
  if (i <= 0) return fallback(text);
  const tail = text.slice(i);
  const gs = graphemes(text.slice(0, i));
  const fits = (n) => width(`${gs.slice(0, n).join('').trimEnd()}${ELLIPSIS}${tail}`) <= maxWidth;
  // Binary search the longest head that fits (width grows with the head length).
  let lo = 0;
  let hi = gs.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${gs.slice(0, lo).join('').trimEnd()}${ELLIPSIS}${tail}` : fallback(text);
}

export function truncateStart(text, { maxWidth, fontSize }) {
  text = String(text ?? '').replace(SPACES, ' ').trim();
  if (measureText(text, fontSize) <= maxWidth) return text;
  // Keep graphemes from the end while they fit next to the ellipsis (linear).
  const gs = graphemes(text);
  let width = measureText(ELLIPSIS, fontSize);
  let start = gs.length;
  while (start > 0 && width + measureText(gs[start - 1], fontSize) <= maxWidth) {
    start -= 1;
    width += measureText(gs[start], fontSize);
  }
  return ELLIPSIS + gs.slice(start).join('').trimStart();
}

/**
 * `text` shortened in the middle (head + '…' + tail) so that it fits `maxWidth`; keeps
 * both ends, so names that share a prefix or a suffix stay distinguishable.
 */
export function truncateMiddle(text, { maxWidth, fontSize }) {
  text = String(text ?? '').replace(SPACES, ' ').trim();
  if (measureText(text, fontSize) <= maxWidth) return text;
  const gs = graphemes(text);
  const budget = maxWidth - measureText(ELLIPSIS, fontSize);
  let head = 0;
  let tail = gs.length;
  let used = 0;
  const take = (fromEnd, limit) => {
    while (head < tail) {
      const w = measureText(fromEnd ? gs[tail - 1] : gs[head], fontSize);
      if (used + w > limit) return;
      used += w;
      if (fromEnd) tail -= 1;
      else head += 1;
    }
  };
  // ~60% of the room for the end (the extension and the distinctive suffix), the rest
  // for the start, then any leftover back to the end.
  take(true, budget * 0.6);
  take(false, budget);
  take(true, budget);
  return gs.slice(0, head).join('').trimEnd() + ELLIPSIS + gs.slice(tail).join('').trimStart();
}

/**
 * Integer with en-US thousands separators, e.g. 12345 → "12,345". Negatives use U+2212.
 * Huge values (≥ 1e21) are written out in full, never in scientific notation.
 * Non-numbers and non-finite values → "0".
 */
export function formatNumber(n) {
  return formatInteger(n, ',');
}

const escapeRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A count in compact form for tight spots: 950 → "950", 12,345 → "12.3K",
 * 4,500,000 → "4.5M", 123,456,789,012 → "123B", 9,007,199,254,740,991 → "9,007T";
 * 10,000T and up → "9,999T+". Accepts a number or an en-US formatted string
 * ("12,345"; a leading '+', '−' or '-' is kept). Never scientific notation; anything that is
 * not a finite count → "0".
 */
export function compactNumber(n, lang) {
  const { sep, point, suffixes: SUFFIXES } = getStrings(lang).compact;
  let neg = false;
  let plus = false;
  if (typeof n === 'string') {
    const m = new RegExp(`^([+\\u2212-])?(\\d{1,3}(?:${escapeRe(sep)}\\d{3})*|\\d+)$`).exec(n.trim());
    if (!m) return '0';
    if (m[1] === '+') plus = true;
    else neg = Boolean(m[1]);
    n = Number(m[2].split(sep).join(''));
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 0) {
    neg = true;
    n = -n;
  }
  const sign = neg ? '−' : plus ? '+' : '';
  if (n < 1000) return `${sign}${Math.round(n)}`;
  let unit = 0;
  let v = n / 1000;
  while (unit < SUFFIXES.length - 1 && Math.round(v) >= 1000) {
    v /= 1000;
    unit += 1;
  }
  const last = unit === SUFFIXES.length - 1;
  if (last && v >= 9999.5) return `${sign}9${sep}999${SUFFIXES[unit]}+`;
  const r = Math.round(v * 10) / 10;
  const shown = r < 100 ? r.toFixed(1).replace('.', point) : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${sign}${shown}${SUFFIXES[unit]}`;
}

/** A count with an optional unit after it ("12,345" / "12,345 days"), per language. */
const numberValue = (sep) => new RegExp(`^([+\\u2212-]?\\d{1,3}(?:${escapeRe(sep)}\\d{3})*)(\\s.*)?$`);

/**
 * A tile value that fits `maxWidth` at `size`: as is when it fits, else, for a count
 * ("12,345" or "12,345 days"), the count in compact form; null when neither fits.
 */
export function fitCount(value, maxWidth, size, factor = 1.02, lang) {
  const w = (t) => measureText(t, size) * factor;
  if (w(value) <= maxWidth) return value;
  const m = numberValue(getStrings(lang).compact.sep).exec(value);
  if (!m) return null;
  const compact = `${compactNumber(m[1], lang)}${m[2] ?? ''}`;
  return w(compact) <= maxWidth ? compact : null;
}

/**
 * Greedy word wrap using the approximate width model. Whitespace is collapsed; words
 * wider than `maxWidth` are hard-broken (after a '/' when possible). With more lines
 * than `maxLines` (default unlimited) the last kept line ends with '…'.
 * Returns string[] ([] for empty text).
 */
export function wrapText(text, { maxWidth, fontSize, maxLines = Infinity } = {}) {
  if (!(maxWidth > 0) || !(fontSize > 0)) throw new TypeError('wrapText needs positive maxWidth and fontSize');
  const words = String(text ?? '').split(SPACES).filter(Boolean);
  // One line past maxLines is enough to know the text must be ellipsized: stop there, so
  // a huge input costs no more than the lines that are kept.
  const limit = Math.max(1, maxLines) + 1;
  const lines = [];
  let line = '';
  for (const word of words) {
    if (lines.length >= limit) break;
    // A word wider than the whole text box can be (all kept lines) is not measured in full.
    const wordWidth = word.length > 4096 ? Infinity : measureText(word, fontSize);
    if (line && measureText(line, fontSize) + measureText(' ', fontSize) + wordWidth <= maxWidth) {
      line = `${line} ${word}`;
      continue;
    }
    if (!line && wordWidth <= maxWidth) {
      line = word;
      continue;
    }
    if (line) lines.push(line);
    line = wordWidth > maxWidth ? hardBreak(word, maxWidth, fontSize, lines, limit) : word;
  }
  if (line && lines.length < limit) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1], maxWidth, fontSize);
  return kept;
}

// ---------------------------------------------------------------------------------------
// Layout
//
// A card is: eyebrow (top), an optional faint card-number watermark (top-right, above
// the eyebrow line), the content area and the footer. The content area holds a "head"
// group (big word, title, subtitle) that starts near the top, and a "body" group (rows
// and charts) that sits at the bottom of the area, so cards use their full height.
// layoutCard() returns every block's box; renderCard() draws them.

const BIG_MAX = 280;
const BIG_MIN = 72;
const BIG_ONE_WORD_MIN = 56;
// The width model matches DejaVu Sans Bold; keep a little slack for rasterizer rounding.
const BIG_WEIGHT_FACTOR = 1.02;
const TITLE = { size: 72, lineHeight: 1.12, maxLines: 3 };
const SUBTITLE = { size: 44, lineHeight: 1.3, maxLines: 4 };
const LIST = { size: 40, rowHeight: 78, pad: 40, maxRows: 6 };
const GAP = 48;
/** Top of the content area (below the eyebrow). */
export const CONTENT_TOP = 290;
/** Bottom of the content area: nothing but the footer is drawn below this line. */
export const CONTENT_BOTTOM = 1716;
const FOOTER_BASELINE = 1820;
/** Top of the footer text (cap height of the 44px brand above its baseline). */
export const FOOTER_TOP = FOOTER_BASELINE - 44;
const EYEBROW = { size: 36, minSize: 28, spacing: 5, baseline: 222 };
const WATERMARK = { size: 160, baseline: 186, opacity: 0.12 };

// Chart typography.
const CAPTION = { size: 28, spacing: 3, height: 50 };
const TICK = { size: 30 };
const MAX_CHART_ITEMS = 6;

const clampNum = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const s1 = (v) => (v === null || v === undefined ? '' : String(v).replace(SPACES, ' ').trim());
/** Heavy-weight width estimate (see BIG_WEIGHT_FACTOR). */
const heavyWidth = (text, size) => measureText(text, size) * BIG_WEIGHT_FACTOR;

/** Font size and lines for the big number/word: as large as fits, wrapping as a last resort. */
function fitBig(text, maxSize) {
  const em = measureText(text, 1) * BIG_WEIGHT_FACTOR;
  // One word (a huge number, a long file name) may go a little smaller before it wraps.
  const min = /\s/.test(text) ? BIG_MIN : BIG_ONE_WORD_MIN;
  const size = Math.max(min, Math.min(maxSize, Math.floor(CONTENT_WIDTH / Math.max(em, 0.01))));
  if (em * size <= CONTENT_WIDTH) return { size, lines: [text] };
  return { size: BIG_MIN, lines: wrapText(text, { maxWidth: CONTENT_WIDTH / BIG_WEIGHT_FACTOR, fontSize: BIG_MIN, maxLines: 2 }) };
}

/** `text` on one line at the largest size in [min, max] that fits, else ellipsized at `min`. */
function fitOneLine(text, maxWidth, max, min) {
  const em = measureText(text, 1) * BIG_WEIGHT_FACTOR;
  const size = Math.min(max, Math.floor(maxWidth / Math.max(em, 0.001)));
  if (size >= min) return { size, line: text };
  return { size: min, line: wrapText(text, { maxWidth: maxWidth / BIG_WEIGHT_FACTOR, fontSize: min, maxLines: 1 })[0] ?? '' };
}

/** One line cut at the end with '…' (heavy-weight widths) to fit `maxWidth`. */
const fitEnd = (text, maxWidth, size) => (text ? wrapText(text, { maxWidth: maxWidth / BIG_WEIGHT_FACTOR, fontSize: size, maxLines: 1 })[0] ?? '' : '');

function normalizeRow(row) {
  if (row && typeof row === 'object') {
    return { label: String(row.label ?? ''), value: String(row.value ?? ''), truncate: row.truncate === 'start' ? 'start' : 'end' };
  }
  return { label: String(row ?? ''), value: '', truncate: 'end' };
}

/** `label` for a row: shortened from the start or the end to fit `maxWidth`. */
function fitLabel(label, maxWidth, size, truncate) {
  if (truncate === 'start') return truncateStart(label, { maxWidth: maxWidth / BIG_WEIGHT_FACTOR, fontSize: size });
  if (truncate === 'middle') return truncateMiddle(label, { maxWidth: maxWidth / BIG_WEIGHT_FACTOR, fontSize: size });
  return fitEnd(label, maxWidth, size);
}

/** Small-caps chart caption (upper-cased, letter-spaced) at the top of a block. */
function caption(y, text, L = EN) {
  const t = fitSpaced(L.upper(s1(text)), CONTENT_WIDTH, CAPTION.size, CAPTION.spacing);
  return t ? textEl(PAD_X, y + CAPTION.size * 0.76, t, { size: CAPTION.size, weight: 800, opacity: 0.75, spacing: CAPTION.spacing }) : '';
}

const TRUNCATE_MODES = new Set(['start', 'middle', 'end']);

const titleEl = (t) => (t ? `<title>${escapeXml(t)}</title>` : '');

/**
 * Wrap `text` into at most `maxLines` lines. When it does not fit, drop whole trailing
 * sentences rather than cut one mid-way with '…' (falls back to the '…' cut when even
 * the first sentence is too long).
 */
function wrapAtSentence(text, opts, maxLines) {
  const all = wrapText(text, { ...opts, maxLines: maxLines + 1 });
  if (all.length <= maxLines) return all;
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let n = sentences.length - 1; n >= 1; n--) {
    const lines = wrapText(sentences.slice(0, n).join(' '), { ...opts, maxLines: maxLines + 1 });
    if (lines.length <= maxLines) return lines;
  }
  return wrapText(text, { ...opts, maxLines });
}

// --- head blocks ---------------------------------------------------------------------

function headBlocks({ big, title, subtitle, titleSize }, { bigMax, titleLines, subtitleLines }) {
  const out = [];
  if (big) {
    const { size, lines: bl } = fitBig(big, bigMax);
    const lh = size * 1.02;
    out.push({
      kind: 'big',
      height: lh * bl.length,
      render: (y) => bl.map((l, i) =>
        textEl(PAD_X, y + size * 0.82 + i * lh, l, { size, weight: 900, spacing: -0.02 * size })).join(''),
    });
  }
  const titleSpec = titleSize > TITLE.size ? { size: titleSize, lineHeight: 1.04 } : TITLE;
  const titleExtra = titleSize > TITLE.size ? { weight: 900, spacing: -0.02 * titleSize } : { weight: 800 };
  const specs = [['title', title, titleSpec, titleLines, titleExtra], ['subtitle', subtitle, SUBTITLE, subtitleLines, { weight: 600, opacity: 0.9 }]];
  for (const [kind, text, spec, maxLines, extra] of specs) {
    if (!text) continue;
    const wrapOpts = { maxWidth: spec === TITLE || spec === SUBTITLE ? WRAP_WIDTH : WRAP_WIDTH / BIG_WEIGHT_FACTOR, fontSize: spec.size };
    const tl = wrapAtSentence(text, wrapOpts, maxLines);
    const lh = spec.size * spec.lineHeight;
    out.push({
      kind,
      height: lh * tl.length,
      render: (y) => tl.map((l, i) => textEl(PAD_X, y + spec.size * 0.85 + i * lh, l, { size: spec.size, ...extra })).join(''),
    });
  }
  return out;
}

// --- body blocks: rows + charts --------------------------------------------------------

/** The widest a row's value is drawn uncut (rowsBlock ends a longer one with "…"). */
const ROW_VALUE_MAX_WIDTH = WRAP_WIDTH * 0.55;

/** Whether rowsBlock draws `value` (a row's value) whole, without cutting it. */
export function rowValueFits(value) {
  const v = String(value ?? '');
  return v === '' || wrapText(v, { maxWidth: ROW_VALUE_MAX_WIDTH, fontSize: LIST.size, maxLines: 1 })[0] === v;
}

/** A row (`{label, value, truncate}`, see normalizeRow) as rowsBlock draws it: its label and value text, either possibly cut. */
function drawnRow(row) {
  const value = row.value ? wrapText(row.value, { maxWidth: ROW_VALUE_MAX_WIDTH, fontSize: LIST.size, maxLines: 1 })[0] : '';
  const valueWidth = value ? measureText(value, LIST.size) + 32 : 0;
  const maxWidth = Math.max(LIST.size * 3, WRAP_WIDTH - valueWidth);
  const label = row.truncate === 'start'
    ? truncateStart(row.label, { maxWidth, fontSize: LIST.size })
    : (wrapText(row.label, { maxWidth, fontSize: LIST.size, maxLines: 1 })[0] ?? '');
  return { label, value };
}

/** Whether rowsBlock draws `row` (`{label, value}`) whole: neither its label nor its value cut. */
export function rowFits(row) {
  const r = normalizeRow(row);
  const drawn = drawnRow(r);
  return drawn.label === r.label && (drawn.value ?? '') === r.value;
}

function rowsBlock(lines) {
  const rows = (Array.isArray(lines) ? lines : []).map(normalizeRow).filter((r) => r.label || r.value).slice(0, LIST.maxRows);
  if (rows.length === 0) return null;
  const height = rows.length * LIST.rowHeight + 2 * LIST.pad - (LIST.rowHeight - LIST.size * 1.2);
  return {
    kind: 'rows',
    height,
    render: (y) => {
      const parts = [`<rect x="${PAD_X - 32}" y="${round(y)}" width="${CONTENT_WIDTH + 64}" height="${round(height)}" rx="40" fill="#ffffff" fill-opacity="0.14"/>`];
      rows.forEach((row, i) => {
        const baseline = y + LIST.pad + LIST.size * 0.9 + i * LIST.rowHeight;
        const { label, value } = drawnRow(row);
        parts.push(textEl(PAD_X, baseline, label, { size: LIST.size, weight: 700 }));
        if (value) parts.push(textEl(PAD_X + CONTENT_WIDTH, baseline, value, { size: LIST.size, weight: 800, opacity: 0.85, anchor: 'end' }));
      });
      return parts.join('');
    },
  };
}

/** Path of a bar with rounded top corners and a square bottom on the baseline. */
function barPath(x, w, base, h, r) {
  r = Math.min(r, w / 2, h);
  const top = base - h;
  return `M${round(x)} ${round(base)}V${round(top + r)}A${round(r)} ${round(r)} 0 0 1 ${round(x + r)} ${round(top)}`
    + `H${round(x + w - r)}A${round(r)} ${round(r)} 0 0 1 ${round(x + w)} ${round(top + r)}V${round(base)}Z`;
}

/** x for a centered label of `width` at `cx`, kept inside the content area. */
const clampCenter = (cx, width) => Math.min(PAD_X + CONTENT_WIDTH - width / 2, Math.max(PAD_X + width / 2, cx));

/**
 * Vertical bar chart. Spec: `{kind: 'bars', title, values: number[], labels: string[]
 * (tick labels; '' for none), titles: string[] (hover text per bar), highlight: index[],
 * peakLabel: string (shown above the first highlighted bar), maxBarHeight}`.
 */
function barsBlock(spec, compact = false, L = EN) {
  const values = (Array.isArray(spec.values) ? spec.values : []).slice(0, 64).map(clampNum);
  if (values.length === 0) return null;
  const n = values.length;
  const max = Math.max(0, ...values);
  const hl = new Set((Array.isArray(spec.highlight) ? spec.highlight : []).filter((i) => Number.isInteger(i) && i >= 0 && i < n && values[i] > 0));
  const peak = [...hl].sort((a, b) => a - b)[0];
  const peakLabel = peak === undefined ? '' : s1(spec.peakLabel) || String(values[peak]);
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const titles = Array.isArray(spec.titles) ? spec.titles : [];
  const cap = s1(spec.title);
  const capH = cap ? CAPTION.height : 0;
  const peakH = 44;
  const tickH = labels.some((l) => s1(l)) ? 50 : 14;
  const minBar = compact ? 56 : 90;
  const maxBar = Math.max(minBar, Number.isFinite(spec.maxBarHeight) ? spec.maxBarHeight : 260);
  const fixed = capH + peakH + tickH;
  return {
    kind: 'bars',
    height: fixed + minBar,
    maxHeight: max > 0 ? fixed + maxBar : fixed + minBar,
    render: (y, height) => {
      const barArea = height - fixed;
      const base = y + capH + peakH + barArea;
      const slot = CONTENT_WIDTH / n;
      const gap = Math.max(2, Math.round(slot * (n > 12 ? 0.24 : 0.3)));
      const w = slot - gap;
      const parts = [caption(y, cap, L)];
      values.forEach((v, i) => {
        const x = PAD_X + i * slot + gap / 2;
        const t = titleEl(s1(titles[i]));
        if (v === 0 || max === 0) {
          parts.push(`<rect x="${round(x)}" y="${round(base - 4)}" width="${round(w)}" height="4" fill-opacity="0.15">${t}</rect>`);
          return;
        }
        const h = Math.max(6, (v / max) * barArea);
        const op = hl.has(i) ? '' : ' fill-opacity="0.35"';
        parts.push(`<path d="${barPath(x, w, base, h, 6)}"${op}>${t}</path>`);
      });
      parts.push(`<rect x="${PAD_X}" y="${round(base)}" width="${CONTENT_WIDTH}" height="2" fill-opacity="0.3"/>`);
      if (peak !== undefined) {
        const lbl = fitEnd(peakLabel, CONTENT_WIDTH / 2, TICK.size);
        const cx = clampCenter(PAD_X + (peak + 0.5) * slot, heavyWidth(lbl, TICK.size));
        const top = base - Math.max(6, (values[peak] / max) * barArea);
        parts.push(textEl(cx, top - 14, lbl, { size: TICK.size, weight: 800, anchor: 'middle' }));
      }
      labels.slice(0, n).forEach((l, i) => {
        const t = fitEnd(s1(l), Math.max(slot * 3, 60), TICK.size);
        if (!t) return;
        const cx = clampCenter(PAD_X + (i + 0.5) * slot, heavyWidth(t, TICK.size));
        parts.push(textEl(cx, base + 12 + TICK.size * 0.8, t, { size: TICK.size, weight: 700, opacity: 0.75, anchor: 'middle' }));
      });
      return parts.join('');
    },
  };
}

/**
 * Horizontal bar list. Spec: `{kind: 'hbars', title, items: [{label, sub, value, amount,
 * title, truncate, subWhole}]}`: label (bold) with an optional dimmer `sub` after it (with
 * `subWhole: true` it is left out rather than shortened when it does not fit), `value` right
 * aligned, and a bar proportional to `amount` / the largest amount. At most 6 items.
 */
function hbarsBlock(spec, compact = false, L = EN) {
  const items = (Array.isArray(spec.items) ? spec.items : [])
    .filter((it) => it && (s1(it.label) || s1(it.value)))
    .slice(0, MAX_CHART_ITEMS)
    .map((it) => ({ label: s1(it.label), sub: s1(it.sub), subWhole: it.subWhole === true, value: s1(it.value), amount: clampNum(it.amount), title: s1(it.title), truncate: TRUNCATE_MODES.has(it.truncate) ? it.truncate : 'end' }));
  if (items.length === 0) return null;
  const cap = s1(spec.title);
  const capH = cap ? CAPTION.height : 0;
  const large = spec.size === 'large';
  const LABEL = large ? 44 : 36;
  const SUB = 28;
  const BAR = large ? 40 : 18;
  const ITEM = Math.round(LABEL * 0.8 + 16 + BAR);
  const minGap = compact ? 16 : 26;
  const maxGap = large ? 56 : 44;
  const n = items.length;
  // Bars are scaled to `scaleMax` when given (e.g. 1 for 0..1 scores), else to the largest amount.
  const scale = clampNum(spec.scaleMax) || Math.max(0, ...items.map((it) => it.amount));
  const largest = Math.max(0, ...items.map((it) => it.amount));
  return {
    kind: 'hbars',
    height: capH + n * ITEM + (n - 1) * minGap,
    maxHeight: capH + n * ITEM + (n - 1) * maxGap,
    render: (y, height) => {
      const gap = n > 1 ? (height - capH - n * ITEM) / (n - 1) : 0;
      const parts = [caption(y, cap, L)];
      items.forEach((it, i) => {
        const top = y + capH + i * (ITEM + gap);
        const baseline = top + LABEL * 0.8;
        const value = fitEnd(it.value, CONTENT_WIDTH * 0.4, LABEL);
        const valueW = value ? heavyWidth(value, LABEL) + 28 : 0;
        const room = CONTENT_WIDTH - valueW;
        const label = fitLabel(it.label, room, LABEL, it.truncate);
        const g = [titleEl(it.title)];
        g.push(textEl(PAD_X, baseline, label, { size: LABEL, weight: 800 }));
        const subX = PAD_X + heavyWidth(label, LABEL) + 14;
        const subRoom = PAD_X + room - subX;
        if (it.sub && subRoom >= 80) {
          const sub = truncateStart(it.sub, { maxWidth: subRoom / BIG_WEIGHT_FACTOR, fontSize: SUB });
          if (sub && sub !== ELLIPSIS && (!it.subWhole || sub === it.sub)) g.push(textEl(subX, baseline, sub, { size: SUB, weight: 600, opacity: 0.6 }));
        }
        if (value) g.push(textEl(PAD_X + CONTENT_WIDTH, baseline, value, { size: LABEL, weight: 800, opacity: 0.85, anchor: 'end' }));
        const barY = top + ITEM - BAR;
        const rx = Math.min(BAR / 2, 12);
        g.push(`<rect x="${PAD_X}" y="${round(barY)}" width="${CONTENT_WIDTH}" height="${BAR}" rx="${rx}" fill-opacity="0.15"/>`);
        if (it.amount > 0 && scale > 0) {
          const w = Math.max(BAR, Math.min(1, it.amount / scale) * CONTENT_WIDTH);
          const op = it.amount === largest ? '' : ' fill-opacity="0.6"';
          g.push(`<rect x="${PAD_X}" y="${round(barY)}" width="${round(w)}" height="${BAR}" rx="${rx}"${op}/>`);
        }
        parts.push(`<g>${g.join('')}</g>`);
      });
      return parts.join('');
    },
  };
}

/**
 * One 100% bar split in two. Spec: `{kind: 'split', title, segments: [{label, value,
 * amount}, {label, value, amount}]}`: the first segment is solid (left), the second
 * translucent (right); labels sit under each end.
 */
function splitBlock(spec, compact = false, L = EN) {
  const segs = (Array.isArray(spec.segments) ? spec.segments : []).slice(0, 2)
    .map((sg) => ({ label: s1(sg?.label), value: s1(sg?.value), amount: clampNum(sg?.amount) }));
  if (segs.length < 2) return null;
  const cap = s1(spec.title);
  const capH = cap ? CAPTION.height : 0;
  const BAR = 32;
  const VALUE = 44;
  const LABEL = 28;
  const height = capH + BAR + 20 + VALUE * 0.76 + 14 + LABEL * 0.76 + 8;
  return {
    kind: 'split',
    height,
    render: (y) => {
      const parts = [caption(y, cap, L)];
      const barY = y + capH;
      const [a, b] = segs;
      const total = a.amount + b.amount;
      const titleText = segs.map((sg) => [sg.value, sg.label].filter(Boolean).join(' ')).join(' / ');
      if (total === 0) {
        parts.push(`<rect x="${PAD_X}" y="${round(barY)}" width="${CONTENT_WIDTH}" height="${BAR}" rx="${BAR / 2}" fill-opacity="0.15">${titleEl(titleText)}</rect>`);
      } else {
        const gap = a.amount > 0 && b.amount > 0 ? 8 : 0;
        const usable = CONTENT_WIDTH - gap;
        let wa = (a.amount / total) * usable;
        if (a.amount > 0) wa = Math.max(BAR, Math.min(usable - (b.amount > 0 ? BAR : 0), wa));
        const wb = usable - wa;
        if (wa > 0) parts.push(`<rect x="${PAD_X}" y="${round(barY)}" width="${round(wa)}" height="${BAR}" rx="${BAR / 2}">${titleEl(titleText)}</rect>`);
        if (wb > 0) parts.push(`<rect x="${round(PAD_X + wa + gap)}" y="${round(barY)}" width="${round(wb)}" height="${BAR}" rx="${BAR / 2}" fill-opacity="0.4">${titleEl(titleText)}</rect>`);
      }
      const vBase = barY + BAR + 20 + VALUE * 0.76;
      const lBase = vBase + 14 + LABEL * 0.76;
      const half = CONTENT_WIDTH / 2 - 16;
      [[a, PAD_X, 'start'], [b, PAD_X + CONTENT_WIDTH, 'end']].forEach(([sg, x, anchor]) => {
        const label = fitEnd(sg.label, half, LABEL);
        const value = fitCount(sg.value, half, VALUE, BIG_WEIGHT_FACTOR, L.code) ?? fitEnd(sg.value, half, VALUE);
        if (label) parts.push(textEl(x, lBase, label, { size: LABEL, weight: 700, opacity: 0.75, anchor }));
        if (value) parts.push(textEl(x, vBase, value, { size: VALUE, weight: 900, anchor }));
      });
      return parts.join('');
    },
  };
}

/** Fill opacities of a stacked bar's segments, first (solid) to last (faintest); even the last stays well above the 0.15 empty track, so an all-large mix never looks empty. */
const STACK_OPACITY = [1, 0.75, 0.55, 0.4];

/**
 * One 100% bar split into up to 4 segments, left to right, each fainter than the last.
 * Spec: `{kind: 'stack', title, segments: [{label, value, amount, title}]}` (2-4 segments):
 * zero-amount segments take no bar space (non-zero ones are at least 12px wide); under the
 * bar every segment gets an equal column with a swatch and its label, and its value
 * (e.g. "62%") above. `title` is the hover text of the segment and its column.
 * `inline: true` is a shorter variant: a thinner bar, and each segment's value and label
 * on one smaller line ("62% feat") after its swatch, side by side at their natural widths
 * at the largest size (30 → 24px) where they all fit, else in equal columns (cut to fit).
 */
function stackBlock(spec, compact = false, L = EN) {
  const segs = (Array.isArray(spec.segments) ? spec.segments : []).slice(0, STACK_OPACITY.length)
    .map((sg) => ({ label: s1(sg?.label), value: s1(sg?.value), amount: clampNum(sg?.amount), title: s1(sg?.title) }));
  if (segs.length < 2) return null;
  const cap = s1(spec.title);
  const capH = cap ? CAPTION.height : 0;
  const inline = spec.inline === true;
  const BAR = inline ? 28 : 32;
  const VALUE = 44;
  const LABEL = 28;
  const INLINE = 30;
  const SWATCH = 20;
  const MIN_W = 12;
  const GAP_X = 6;
  const height = inline ? capH + BAR + 18 + INLINE * 0.76 + 8 : capH + BAR + 20 + VALUE * 0.76 + 14 + LABEL * 0.76 + 8;
  return {
    kind: 'stack',
    height,
    render: (y) => {
      const parts = [caption(y, cap, L)];
      const barY = y + capH;
      const live = segs.map((sg, i) => ({ ...sg, i })).filter((sg) => sg.amount > 0);
      const total = live.reduce((a, sg) => a + sg.amount, 0);
      if (total === 0) {
        parts.push(`<rect x="${PAD_X}" y="${round(barY)}" width="${CONTENT_WIDTH}" height="${BAR}" rx="${BAR / 2}" fill-opacity="0.15"/>`);
      } else {
        const usable = CONTENT_WIDTH - GAP_X * (live.length - 1);
        const widths = live.map((sg) => Math.max(MIN_W, (sg.amount / total) * usable));
        // The widest segment gives back what the minimum widths added.
        const widest = widths.indexOf(Math.max(...widths));
        widths[widest] -= widths.reduce((a, b) => a + b, 0) - usable;
        let x = PAD_X;
        live.forEach((sg, k) => {
          const w = widths[k];
          const op = STACK_OPACITY[sg.i] === 1 ? '' : ` fill-opacity="${STACK_OPACITY[sg.i]}"`;
          parts.push(`<rect x="${round(x)}" y="${round(barY)}" width="${round(w)}" height="${BAR}" rx="${round(Math.min(BAR / 2, w / 2))}"${op}>${titleEl(sg.title)}</rect>`);
          x += w + GAP_X;
        });
      }
      const colW = CONTENT_WIDTH / segs.length;
      const room = colW - 16;
      if (inline) {
        const base = barY + BAR + 18 + INLINE * 0.76;
        // Each item at its natural width, left to right, at the largest size (30 → 24px)
        // where they all fit on the line; else equal columns at 24px, each item cut to fit.
        const GAP_ITEM = 28;
        const vw = (v, size) => (v ? measureText(v, size) * BIG_WEIGHT_FACTOR + 10 : 0);
        const naturalAt = (size) => segs.map((sg) => SWATCH + 10 + vw(sg.value, size) + measureText(sg.label, size) * BIG_WEIGHT_FACTOR);
        const fits = (size) => naturalAt(size).reduce((a, w) => a + w, 0) + GAP_ITEM * (segs.length - 1) <= CONTENT_WIDTH;
        const flowSize = [INLINE, 28, 26, 24].find(fits);
        const flow = flowSize !== undefined;
        const size = flow ? flowSize : 24;
        const natural = naturalAt(size);
        let fx = PAD_X;
        segs.forEach((sg, i) => {
          const x = flow ? fx : PAD_X + i * colW;
          fx += natural[i] + GAP_ITEM;
          const g = [titleEl(sg.title)];
          const op = STACK_OPACITY[i] === 1 ? '' : ` fill-opacity="${STACK_OPACITY[i]}"`;
          g.push(`<rect x="${round(x)}" y="${round(base - size * 0.76 + (size * 0.76 - SWATCH) / 2)}" width="${SWATCH}" height="${SWATCH}" rx="${SWATCH / 4}"${op}/>`);
          const tx = x + SWATCH + 10;
          const value = flow ? sg.value : fitEnd(sg.value, room - SWATCH - 10, size);
          if (value) g.push(textEl(tx, base, value, { size, weight: 900 }));
          const w = vw(value, size);
          const label = flow ? sg.label : fitEnd(sg.label, room - SWATCH - 10 - w, size);
          if (label) g.push(textEl(tx + w, base, label, { size, weight: 700, opacity: 0.75 }));
          parts.push(`<g>${g.join('')}</g>`);
        });
        return parts.join('');
      }
      const vBase = barY + BAR + 20 + VALUE * 0.76;
      const lBase = vBase + 14 + LABEL * 0.76;
      segs.forEach((sg, i) => {
        const x = PAD_X + i * colW;
        const g = [titleEl(sg.title)];
        const value = fitEnd(sg.value, room, VALUE);
        if (value) g.push(textEl(x, vBase, value, { size: VALUE, weight: 900 }));
        const op = STACK_OPACITY[i] === 1 ? '' : ` fill-opacity="${STACK_OPACITY[i]}"`;
        g.push(`<rect x="${round(x)}" y="${round(lBase - LABEL * 0.76 + (LABEL * 0.76 - SWATCH) / 2)}" width="${SWATCH}" height="${SWATCH}" rx="${SWATCH / 4}"${op}/>`);
        const label = fitEnd(sg.label, room - SWATCH - 10, LABEL);
        if (label) g.push(textEl(x + SWATCH + 10, lBase, label, { size: LABEL, weight: 700, opacity: 0.75 }));
        parts.push(`<g>${g.join('')}</g>`);
      });
      return parts.join('');
    },
  };
}

const PANEL_FILL = 'fill="#ffffff" fill-opacity="0.14"';

/** A callout's note line: its font size and the widest text (measureText) drawn uncut. */
export const CALLOUT_NOTE = Object.freeze({ size: 34, maxWidth: CONTENT_WIDTH / BIG_WEIGHT_FACTOR });

/**
 * A translucent panel with a caption, one big fitted value and a note line.
 * Spec: `{kind: 'callout', title, value, note}`.
 */
function calloutBlock(spec, compact = false, L = EN) {
  const cap = L.upper(s1(spec.title));
  const value = s1(spec.value);
  const note = s1(spec.note);
  if (!value && !note) return null;
  const PAD = 48;
  const inner = CONTENT_WIDTH;
  let h = PAD;
  const capBase = h + CAPTION.size * 0.76;
  if (cap) h += CAPTION.size + 26;
  const fit = value ? fitOneLine(value, inner, 64, 40) : null;
  const valBase = h + (fit ? fit.size * 0.76 : 0);
  if (fit) h += fit.size * 0.76 + 26;
  const noteBase = h + CALLOUT_NOTE.size * 0.76;
  if (note) h += CALLOUT_NOTE.size * 0.76 + 14;
  h += PAD - 14;
  return {
    kind: 'callout',
    height: h,
    render: (y) => {
      const parts = [`<rect x="${PAD_X - 40}" y="${round(y)}" width="${CONTENT_WIDTH + 80}" height="${round(h)}" rx="44" ${PANEL_FILL}/>`];
      if (cap) parts.push(textEl(PAD_X, y + capBase, fitSpaced(cap, inner, CAPTION.size, CAPTION.spacing), { size: CAPTION.size, weight: 800, opacity: 0.75, spacing: CAPTION.spacing }));
      if (fit) parts.push(textEl(PAD_X, y + valBase, fit.line, { size: fit.size, weight: 900, spacing: -0.01 * fit.size }));
      if (note) parts.push(textEl(PAD_X, y + noteBase, fitEnd(note, inner, CALLOUT_NOTE.size), { size: CALLOUT_NOTE.size, weight: 700, opacity: 0.85 }));
      return parts.join('');
    },
  };
}

/**
 * A grid of stat tiles (2 per row) plus an optional full-width `wide` tile.
 * Spec: `{kind: 'tiles', items: [{label, value}] (up to 4), wide: {label, value, note,
 * truncate} | null}`.
 */
function tilesBlock(spec, compact = false, L = EN) {
  const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 4).map((t) => ({ label: L.upper(s1(t?.label)), value: s1(t?.value) || '—' }));
  const wide = spec.wide && (s1(spec.wide.value) || s1(spec.wide.label))
    ? { label: L.upper(s1(spec.wide.label)), value: s1(spec.wide.value), note: s1(spec.wide.note), truncate: spec.wide.truncate === 'start' ? 'start' : 'end' }
    : null;
  if (items.length === 0 && !wide) return null;
  const TILE_H = 196;
  const WIDE_H = 150;
  const GUTTER = 24;
  const rows = Math.ceil(items.length / 2);
  const height = rows * TILE_H + Math.max(0, rows - 1) * GUTTER + (wide ? (rows ? GUTTER : 0) + WIDE_H : 0);
  const X0 = PAD_X - 24;
  const FULL = CONTENT_WIDTH + 48;
  const TW = (FULL - GUTTER) / 2;
  const TP = 32; // inner padding
  const tileInner = TW - 2 * TP;
  // One value size for all tiles (the largest every fitting value allows, 44..72px);
  // values that do not fit at 44px wrap onto two lines instead.
  // Counts that do not fit even at 44px switch to compact form (12.3K) rather than wrap.
  for (const t of items) t.value = fitCount(t.value, tileInner, 44, BIG_WEIGHT_FACTOR, L.code) ?? t.value;
  const fits = items.map((t) => Math.min(72, Math.floor(tileInner / Math.max(measureText(t.value, 1) * BIG_WEIGHT_FACTOR, 0.001))));
  const shared = Math.min(72, ...fits.filter((f) => f >= 44));
  return {
    kind: 'tiles',
    height,
    render: (y) => {
      const parts = [];
      items.forEach((t, i) => {
        const x = X0 + (i % 2) * (TW + GUTTER);
        const ty = y + Math.floor(i / 2) * (TILE_H + GUTTER);
        parts.push(`<rect x="${round(x)}" y="${round(ty)}" width="${round(TW)}" height="${TILE_H}" rx="36" ${PANEL_FILL}/>`);
        const lab = fitSpaced(t.label, tileInner, 24, 2.5);
        if (lab) parts.push(textEl(x + TP, ty + 56, lab, { size: 24, weight: 800, opacity: 0.8, spacing: 2.5 }));
        if (fits[i] >= 44) {
          parts.push(textEl(x + TP, ty + 152, t.value, { size: shared, weight: 900, spacing: -0.02 * shared }));
        } else {
          const ls = wrapText(t.value, { maxWidth: tileInner / BIG_WEIGHT_FACTOR, fontSize: 42, maxLines: 2 });
          const y0 = ls.length > 1 ? ty + 116 : ty + 150;
          ls.forEach((l, j) => parts.push(textEl(x + TP, y0 + j * 48, l, { size: 42, weight: 900 })));
        }
      });
      if (wide) {
        const wy = y + rows * (TILE_H + GUTTER);
        const inner = FULL - 2 * TP;
        parts.push(`<rect x="${X0}" y="${round(wy)}" width="${FULL}" height="${WIDE_H}" rx="36" ${PANEL_FILL}/>`);
        const lab = fitSpaced(wide.label, inner, 24, 2.5);
        if (lab) parts.push(textEl(X0 + TP, wy + 54, lab, { size: 24, weight: 800, opacity: 0.8, spacing: 2.5 }));
        const note = fitCount(wide.note, inner * 0.4, 34, BIG_WEIGHT_FACTOR, L.code) ?? fitEnd(wide.note, inner * 0.4, 34);
        const noteW = note ? heavyWidth(note, 34) + 28 : 0;
        const value = fitLabel(wide.value, inner - noteW, 48, wide.truncate);
        if (value) parts.push(textEl(X0 + TP, wy + 118, value, { size: 48, weight: 900, spacing: -0.5 }));
        if (note) parts.push(textEl(X0 + FULL - TP, wy + 118, note, { size: 34, weight: 700, opacity: 0.85, anchor: 'end' }));
      }
      return parts.join('');
    },
  };
}

// --- calendar heatmap ------------------------------------------------------------------

/** The calendar's normal (non-compact) minimum cell size, in px. */
export const CALENDAR_MIN_CELL = 26;

const CAL = {
  minWeeks: 8,
  maxWeeks: 53,
  maxCell: 72,
  minCell: CALENDAR_MIN_CELL,
  minCellCompact: 12,
  gapRatio: 0.18,
  radiusRatio: 0.22,
  head: { size: 26, opacity: 0.75, height: 42 },
  month: { size: 24, opacity: 0.7, gap: 10 },
  legend: { size: 24, swatch: 24, gap: 6, height: 26, space: 28 },
  panelGap: 28,
  maxPanels: 4,
  empty: 0.08,
  levels: [0.3, 0.5, 0.75, 1],
};
/** 'YYYY-MM-DD' → "Oct 4, 2026" / "4 Eki 2026" (the year as written, 4 digits). */
function calDate(key, L = EN) {
  const [y, m, d] = key.split('-');
  return L.date(+d, +m, y);
}

/** Month (1-12) of an epoch day; null outside years 0-9999. */
const monthOf = (e) => {
  const key = dayKeyFromEpoch(e);
  return key ? +key.slice(5, 7) : null;
};

/**
 * Month labels for rows `first`..`last - 1` of a window starting on Monday `start`:
 * `[{row, month (1-12)}]`. A row is labelled when it holds the 1st of a month (exactly
 * when its Sunday falls on day 1-7). The first row is labelled with its Monday's month
 * too, unless a 1st-of-month label follows within `minGap` rows (they would collide).
 */
export function calendarMonthLabels(start, first, last, minGap) {
  const out = [];
  for (let w = first; w < last; w++) {
    const sunday = dayKeyFromEpoch(start + w * 7 + 6);
    if (sunday && +sunday.slice(8) <= 7) out.push({ row: w, month: +sunday.slice(5, 7) });
  }
  const month = monthOf(start + first * 7);
  if (first < last && month && !(out.length > 0 && out[0].row - first < minGap)) out.unshift({ row: first, month });
  return out;
}

/**
 * Heat level (index into CAL.levels) per count: the busiest count is always the top
 * level; the rest split at the nearest-rank quartiles of all active-day counts. All
 * counts equal → every day is the top level.
 */
export function calendarLevels(counts) {
  const sorted = [...counts].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (p) => sorted[Math.max(0, Math.ceil(p * n) - 1)];
  const [q1, q2, q3, max] = [q(0.25), q(0.5), q(0.75), sorted[n - 1]];
  return (c) => (c >= max || c > q3 ? 3 : c > q2 ? 2 : c > q1 ? 1 : 0);
}

/**
 * The calendar window for active `days` ([{day, commits}]): Monday-first weeks from the
 * week of the first active day to the week of the last, at most CAL.maxWeeks (the most
 * recent ones) and at least CAL.minWeeks (padded with older weeks). Returns
 * `{start (epoch day of the first Monday), weeks, counts: Map(epoch day → commits),
 * clipped}`; with no valid days, start is null and the window is CAL.minWeeks empty weeks.
 */
export function calendarWindow(days) {
  const counts = new Map();
  for (const d of Array.isArray(days) ? days : []) {
    const e = epochDay(typeof d?.day === 'string' ? d.day.trim() : null);
    const c = clampNum(d?.commits);
    if (e === null || c <= 0 || dayKeyFromEpoch(e) === null) continue;
    counts.set(e, (counts.get(e) ?? 0) + c);
  }
  if (counts.size === 0) return { start: null, weeks: CAL.minWeeks, counts, clipped: false };
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of counts.keys()) {
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  const endMonday = mondayOf(hi);
  const span = (endMonday - mondayOf(lo)) / 7 + 1;
  const weeks = Math.min(CAL.maxWeeks, Math.max(CAL.minWeeks, span));
  return { start: endMonday - (weeks - 1) * 7, weeks, counts, clipped: span > CAL.maxWeeks };
}

/**
 * GitHub-style commit calendar. Spec: `{kind: 'calendar', title, days: [{day:
 * 'YYYY-MM-DD', commits}]}` (active days; see calendarWindow for the window). Rows are
 * weeks (oldest on top), the 7 columns are weekdays Monday first. Long windows are split
 * into side-by-side panels of consecutive weeks so the cells stay large. Cells are white
 * squares whose opacity encodes the day's heat level (CAL.levels; empty days CAL.empty);
 * active cells carry a "<date>: N commits" <title>. Month names mark the row holding the
 * 1st of each month (and each panel's first row), and a Less → More legend sits under
 * the grid on the right.
 */
function calendarBlock(spec, compact = false, L = EN) {
  const win = calendarWindow(spec.days);
  const { weeks, counts } = win;
  const levelOf = calendarLevels(counts.size ? [...counts.values()] : [1]);
  const cap = s1(spec.title);
  const capH = cap ? CAPTION.height : 0;
  const hasDates = win.start !== null;
  const gutter = hasDates ? Math.ceil(Math.max(...L.months.map((m) => heavyWidth(m, CAL.month.size)))) + CAL.month.gap : 0;
  const pitchRatio = 1 + CAL.gapRatio;
  const gridW = (cell) => 7 * cell + 6 * cell * CAL.gapRatio;
  const gridH = (rows, cell) => rows * cell * pitchRatio - cell * CAL.gapRatio;
  const fixed = capH + CAL.head.height + CAL.legend.space + CAL.legend.height;
  // Largest cell the width allows with `p` panels (capped at CAL.maxCell).
  const widthCell = (p) => Math.min(CAL.maxCell, (CONTENT_WIDTH - p * gutter - (p - 1) * CAL.panelGap) / p / gridW(1));
  const rowsOf = (p) => Math.ceil(weeks / p);
  const heightFor = (p, cell) => fixed + gridH(rowsOf(p), cell);
  const panelOptions = Array.from({ length: Math.min(CAL.maxPanels, weeks) }, (_, i) => i + 1).filter((p) => widthCell(p) >= CAL.minCellCompact);
  /** Best {panels, cell} for a block of `height`: the biggest cells, fewer panels unless 10% bigger. */
  const choose = (height) => {
    let best = null;
    for (const p of panelOptions) {
      const cell = Math.min(widthCell(p), (height - fixed) / (rowsOf(p) * pitchRatio - CAL.gapRatio));
      if (!best || cell > best.cell * 1.1) best = { panels: p, cell };
    }
    return best;
  };
  const minCell = compact ? CAL.minCellCompact : CAL.minCell;
  const minHeight = Math.min(...panelOptions.map((p) => heightFor(p, Math.min(minCell, widthCell(p)))));
  const maxHeight = Math.max(...panelOptions.map((p) => heightFor(p, widthCell(p))));
  /** The cell size drawn in a block of `height` (as render draws it). */
  const cellFor = (height) => Math.floor(choose(height).cell * 10) / 10;
  return {
    kind: 'calendar',
    height: minHeight,
    maxHeight: Math.max(minHeight, maxHeight),
    cellFor,
    render: (y, height) => {
      const { panels } = choose(height);
      const cell = cellFor(height);
      const gap = Math.floor(cell * CAL.gapRatio * 10) / 10;
      const pitch = cell + gap;
      const rx = round(cell * CAL.radiusRatio);
      const rows = rowsOf(panels);
      const panelW = gutter + 7 * cell + 6 * gap;
      const totalW = panels * panelW + (panels - 1) * CAL.panelGap;
      const used = capH + CAL.head.height + rows * pitch - gap + CAL.legend.space + CAL.legend.height;
      const x0 = PAD_X + (CONTENT_WIDTH - totalW) / 2;
      const top = y + Math.max(0, (height - used) / 2);
      const parts = [caption(top, cap, L)];
      const gridTop = top + capH + CAL.head.height;
      for (let p = 0; p < panels; p++) {
        const px = x0 + p * (panelW + CAL.panelGap);
        const gx = px + gutter;
        const first = p * rows;
        const last = Math.min(weeks, first + rows);
        if (first >= last) continue;
        // Weekday letters shrink with small cells so they never run together.
        const headSize = Math.round(Math.min(CAL.head.size, Math.max(18, pitch * 0.78)));
        L.calendarWeekdays.forEach((d, col) => {
          parts.push(textEl(gx + col * pitch + cell / 2, gridTop - 16, d, { size: headSize, weight: 800, opacity: CAL.head.opacity, anchor: 'middle' }));
        });
        const labels = hasDates ? calendarMonthLabels(win.start, first, last, Math.ceil((2 * CAL.month.size + 8) / pitch)) : [];
        for (const { row, month } of labels) {
          const ry = gridTop + (row - first) * pitch;
          parts.push(textEl(px, ry + cell / 2 + CAL.month.size * 0.36, L.months[month - 1], { size: CAL.month.size, weight: 700, opacity: CAL.month.opacity }));
        }
        for (let w = first; w < last; w++) {
          const ry = gridTop + (w - first) * pitch;
          const monday = hasDates ? win.start + w * 7 : null;
          for (let col = 0; col < 7; col++) {
            const e = hasDates ? monday + col : null;
            const n = e === null ? 0 : counts.get(e) ?? 0;
            const op = n > 0 ? CAL.levels[levelOf(n)] : CAL.empty;
            const t = n > 0 ? titleEl(L.calendar.cell(calDate(dayKeyFromEpoch(e), L), n)) : '';
            parts.push(`<rect x="${round(gx + col * pitch)}" y="${round(ry)}" width="${cell}" height="${cell}" rx="${rx}" fill-opacity="${op}">${t}</rect>`);
          }
        }
      }
      // Legend: "Less ▢▢▢▢▢ More", right-aligned under the grid.
      const LG = CAL.legend;
      const ly = gridTop + rows * pitch - gap + LG.space;
      const right = x0 + totalW;
      const moreW = heavyWidth(L.calendar.more, LG.size);
      const swEnd = right - moreW - 12;
      const ops = [CAL.empty, ...CAL.levels];
      const swStart = swEnd - ops.length * LG.swatch - (ops.length - 1) * LG.gap;
      const base = ly + LG.height / 2 + LG.size * 0.36;
      parts.push(textEl(swStart - 12, base, L.calendar.less, { size: LG.size, weight: 700, opacity: CAL.month.opacity, anchor: 'end' }));
      ops.forEach((op, i) => {
        parts.push(`<rect x="${round(swStart + i * (LG.swatch + LG.gap))}" y="${round(ly + (LG.height - LG.swatch) / 2)}" width="${LG.swatch}" height="${LG.swatch}" rx="${round(LG.swatch * CAL.radiusRatio)}" fill-opacity="${op}"/>`);
      });
      parts.push(textEl(right, base, L.calendar.more, { size: LG.size, weight: 700, opacity: CAL.month.opacity, anchor: 'end' }));
      return parts.join('');
    },
  };
}

const CHARTS = { bars: barsBlock, hbars: hbarsBlock, split: splitBlock, stack: stackBlock, callout: calloutBlock, tiles: tilesBlock, calendar: calendarBlock };

/**
 * Chart blocks for `chart` (one spec or an array); `compact` asks for smaller minimums;
 * `L` is the string table (src/i18n) for upper-casing, numbers and calendar labels.
 */
function chartBlocks(chart, compact = false, L = EN) {
  const list = Array.isArray(chart) ? chart : chart ? [chart] : [];
  return list.map((c, index) => {
    const block = c && Object.hasOwn(CHARTS, c.kind) ? CHARTS[c.kind](c, compact, L) : null;
    if (block && c.optional === true) block.optional = true;
    // Which chart spec it draws (see layoutCard's drawnCharts).
    if (block) block.index = index;
    return block;
  }).filter(Boolean);
}

/** `text` on one line with letter `spacing` px, cut at the end with '…' to fit `maxWidth`. */
function fitSpaced(text, maxWidth, fontSize, spacing) {
  const width = (t) => measureText(t, fontSize) + spacing * Array.from(t).length;
  if (width(text) <= maxWidth) return text;
  const gs = graphemes(text);
  while (gs.length > 0 && width(gs.join('').trimEnd() + ELLIPSIS) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ELLIPSIS;
}

const sumHeight = (bs, key = 'height') => bs.reduce((h, b) => h + b[key], 0) + GAP * Math.max(0, bs.length - 1);

const round = (n) => Math.round(n * 10) / 10;

/** One <text> element (text XML-escaped, coordinates rounded to 0.1px). */
export function textEl(x, y, text, { size, weight = 700, opacity = 1, anchor = 'start', spacing = 0 }) {
  const attrs = [`x="${round(x)}"`, `y="${round(y)}"`, `font-size="${round(size)}"`, `font-weight="${weight}"`];
  if (opacity !== 1) attrs.push(`fill-opacity="${opacity}"`);
  if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
  if (spacing) attrs.push(`letter-spacing="${round(spacing)}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(text)}</text>`;
}

function background(id, t, glowOpacity = 0.55) {
  const [x2, y2] = t.angle ? ['0.35', '1'] : ['1', '1'];
  const stops = t.stops.map((c, i) => `<stop offset="${(i / (t.stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  return [
    '<defs>',
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${t.glow}" stop-opacity="${glowOpacity}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#${id}-bg)"/>`,
    `<circle cx="930" cy="250" r="460" fill="url(#${id}-glow)"/>`,
    `<circle cx="110" cy="1650" r="560" fill="url(#${id}-glow)"/>`,
  ].join('');
}

/** A valid XML id prefix (NCName-safe): letters, digits, '-', '_', '.'; starts with a letter. */
export function sanitizeIdPrefix(prefix) {
  const cleaned = String(prefix ?? '').replace(/[^A-Za-z0-9_.-]+/g, '-');
  if (!cleaned) return '';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `gw-${cleaned}`;
}

/** Eyebrow text and size: shrinks (36 → 28px) before it is ellipsized. */
function fitEyebrow(eb) {
  const width = (t, size) => measureText(t, size) + EYEBROW.spacing * Array.from(t).length;
  for (let size = EYEBROW.size; size >= EYEBROW.minSize; size -= 2) {
    if (width(eb, size) <= CONTENT_WIDTH) return { size, line: eb };
  }
  return { size: EYEBROW.minSize, line: fitSpaced(eb, CONTENT_WIDTH, EYEBROW.minSize, EYEBROW.spacing) };
}

/**
 * The footer: the "gitwrapped" brand bottom-left and `text` right-aligned after it,
 * shrinking (32 → 24px) before it is ellipsized. `line`/`size` are what is drawn.
 */
function fitFooter(text) {
  const box = { top: FOOTER_TOP, bottom: FOOTER_BASELINE + 12, left: PAD_X, right: PAD_X + CONTENT_WIDTH, text, line: '', size: 0 };
  if (!text) return box;
  const maxWidth = CONTENT_WIDTH - (measureText('gitwrapped', 44) - 10) - 40;
  const size = Math.max(24, Math.min(32, Math.floor(maxWidth / Math.max(measureText(text, 1), 0.01))));
  // An over-long repo name is cut before the date window after the last " · ".
  const line = fitKeepTail(text, {
    maxWidth,
    width: (t) => measureText(t, size),
    fallback: (t) => wrapText(t, { maxWidth, fontSize: size, maxLines: 1 })[0] ?? '',
  });
  return { ...box, line, size };
}

/**
 * Compute the layout of a card (same input as renderCard). Returns
 * `{blocks: [{kind, group: 'head'|'body', top, bottom, svg}], eyebrow, watermark, footer}`
 * where eyebrow / watermark / footer are `{top, bottom, left, right}` boxes (or null).
 * Every block lies within [CONTENT_TOP, CONTENT_BOTTOM] and no two blocks overlap.
 * `drawnCharts` lists the indices (into `chart`, a single spec being index 0) of the charts
 * actually drawn, in order: charts left out for lack of room, and specs that draw nothing
 * (an unknown kind, too few segments, ...), are not in it. `fitsAsIs` is true when
 * everything fit at full size: no optional chart was left out and nothing was shrunk,
 * compacted or dropped to make room. `shrinkSteps` counts the steps taken after any
 * optional charts were left out (0 when it fit; the first steps shrink the big word, by
 * 15% each, before charts compact or text loses lines).
 */
export function layoutCard({ eyebrow, title, big, subtitle, titleSize, bigMin, lines, chart, number, footer, lang } = {}) {
  const L = getStrings(lang);
  // `bigMin`: a floor the big word keeps while charts are compacted or dropped (default
  // BIG_MIN: no floor); it shrinks further only when even the text-only layout is too tall.
  const bigFloor = Number.isFinite(bigMin) ? Math.min(BIG_MAX, Math.max(BIG_MIN, Math.round(bigMin))) : BIG_MIN;
  // A display-size title (e.g. the intro's "Wrapped"): 73..160px; anything else → 72px.
  const tSize = Number.isFinite(titleSize) ? Math.min(160, Math.max(TITLE.size, Math.round(titleSize))) : TITLE.size;
  const content = { big: s1(big), title: s1(title), subtitle: s1(subtitle), titleSize: tSize };
  const available = CONTENT_BOTTOM - CONTENT_TOP;
  const rows = rowsBlock(lines);
  let compact = false;
  let charts = chartBlocks(chart, false, L);
  const opts = { bigMax: BIG_MAX, titleLines: TITLE.maxLines, subtitleLines: SUBTITLE.maxLines };
  const build = () => {
    const head = headBlocks(content, opts);
    const body = [rows, ...charts].filter(Boolean);
    return { head, body, total: sumHeight(head) + sumHeight(body) + (head.length && body.length ? GAP : 0) };
  };
  // Shrink until everything fits: the big word first, then compact charts (smaller
  // minimum heights), then fewer subtitle / title lines, then drop charts from the end
  // (the text-only layout always fits). A `bigMin` floor holds the big word until the
  // charts are gone.
  let l = build();
  // Whether everything fit as it is: no optional chart left out, nothing shrunk or dropped.
  const fitsAsIs = l.total <= available;
  // Optional charts (`optional: true`) are purely additive: they are left out, last first,
  // unless they fit as they are, before anything else shrinks.
  while (l.total > available && charts.some((b) => b.optional)) {
    const i = charts.findLastIndex((b) => b.optional);
    charts = charts.filter((_, j) => j !== i);
    l = build();
  }
  let shrinkSteps = 0;
  while (l.total > available) {
    shrinkSteps += 1;
    if (opts.bigMax > bigFloor) opts.bigMax = Math.max(bigFloor, Math.floor(opts.bigMax * 0.85));
    else if (!compact && charts.length > 0) {
      compact = true;
      // Any optional chart is gone by now (they all fit, or none is left), so none comes back.
      charts = chartBlocks(chart, true, L).filter((b) => !b.optional);
    } else if (opts.subtitleLines > 2) opts.subtitleLines -= 1;
    else if (opts.titleLines > 2) opts.titleLines -= 1;
    else if (charts.length > 0) {
      charts = charts.slice(0, -1);
      // With a floor, the room a dropped chart frees goes back to the big word first.
      if (bigFloor > BIG_MIN) opts.bigMax = BIG_MAX;
    } else if (opts.bigMax > BIG_MIN) opts.bigMax = Math.max(BIG_MIN, Math.floor(opts.bigMax * 0.85));
    else break;
    l = build();
  }
  const { head, body } = l;
  // Hand spare room to flexible charts (up to their max height), first come first served.
  let spare = available - l.total;
  for (const b of body) {
    b.h = b.height;
    if (b.maxHeight > b.height && spare > 0) {
      const add = Math.min(spare, b.maxHeight - b.height);
      b.h += add;
      spare -= add;
    }
  }
  for (const b of head) b.h = b.height;
  const blocks = [];
  const place = (list, group, y) => {
    for (const b of list) {
      // A calendar also says the cell size it drew (see calendarBlock).
      blocks.push({ kind: b.kind, group, top: round(y), bottom: round(y + b.h), svg: b.render(y, b.h), ...(b.cellFor ? { cell: b.cellFor(b.h) } : {}) });
      y += b.h + GAP;
    }
  };
  if (body.length === 0) {
    place(head, 'head', CONTENT_TOP + spare * 0.3);
  } else {
    // Head near the top, body resting on the bottom; most spare room goes between them.
    const headTop = CONTENT_TOP + Math.min(spare * 0.3, 140);
    const bodyH = sumHeight(body, 'h');
    place(head, 'head', headTop);
    place(body, 'body', CONTENT_BOTTOM - Math.min(spare * 0.1, 24) - bodyH);
  }

  const eb = L.upper(s1(eyebrow));
  const ebFit = eb ? fitEyebrow(eb) : null;
  const num = s1(number);
  const markWidth = num ? heavyWidth(num, WATERMARK.size) : 0;
  return {
    blocks,
    eyebrow: ebFit
      ? { ...ebFit, top: EYEBROW.baseline - ebFit.size * 0.76, bottom: EYEBROW.baseline, left: PAD_X, right: PAD_X + measureText(ebFit.line, ebFit.size) + EYEBROW.spacing * Array.from(ebFit.line).length }
      : null,
    watermark: num
      ? { text: num, top: WATERMARK.baseline - WATERMARK.size * 0.73, bottom: WATERMARK.baseline, left: PAD_X + CONTENT_WIDTH - markWidth, right: PAD_X + CONTENT_WIDTH }
      : null,
    footer: fitFooter(s1(footer)),
    drawnCharts: body.filter((b) => b !== rows).map((b) => b.index),
    fitsAsIs,
    shrinkSteps,
  };
}

/**
 * Render one story card as a complete standalone SVG string (1080x1920).
 * All fields are optional strings except:
 * - `lines`: an array of strings or `{label, value, truncate}` rows (value right-aligned;
 *   truncate 'start' keeps the end of long labels such as file paths). At most 6 rows.
 * - `chart`: one chart spec or an array of them, drawn below the rows; kinds are
 *   'bars' (vertical bar chart), 'hbars' (horizontal bar list), 'split' (one bar split
 *   in two), 'stack' (one bar split in up to four), 'callout' (a panel with one big value), 'tiles' (2x2 stat tiles) and 'calendar'
 *   (a commits-per-day heatmap). See
 *   the *Block functions above for each spec. Charts that do not fit are dropped, last first.
 *   A chart with `optional: true` is purely additive: unless the card fits with it before
 *   anything shrinks, it is left out first, and the card is laid out exactly as without it.
 * `number` is a short card number ("03") drawn as a faint watermark top-right.
 * `bigMin` (px) is a floor the big word keeps while charts are compacted and dropped
 * (default: none, it may shrink to 72px first).
 * `lang` (an src/i18n code, default 'en') sets the upper-casing rules, the number format
 * of compacted counts and the calendar's month / weekday / legend labels.
 * `theme` is a gradient name, a THEMES key (unknown → 'pulse'). `colorTheme` is a color
 * theme from themes.js ('default', 'mono', 'neon'; unknown → 'default') that the gradient
 * name resolves in; only colors change, never the layout. `footer` is small text right of the
 * "gitwrapped" brand. `idPrefix` prefixes every element id (default `gw-<theme>`);
 * pass a unique one per card when several SVGs are inlined into one HTML page.
 * All text is XML-escaped; output is deterministic.
 */
export function renderCard(opts = {}) {
  return renderCardWithLayout(opts).svg;
}

/**
 * renderCard() plus which charts its layout drew: `{svg, drawnCharts}` (see layoutCard),
 * so a card's description can match what is drawn without laying it out twice.
 */
export function renderCardWithLayout(opts = {}) {
  opts = opts ?? {};
  const name = Object.hasOwn(THEMES, opts.theme ?? '') ? opts.theme : DEFAULT_THEME;
  const palette = getColorTheme(opts.colorTheme);
  const grad = palette.gradients[name];
  const ids = sanitizeIdPrefix(opts.idPrefix) || `gw-${name}`;
  const layout = layoutCard(opts);

  const body = [];
  if (layout.watermark) {
    body.push(textEl(PAD_X + CONTENT_WIDTH, WATERMARK.baseline, layout.watermark.text, { size: WATERMARK.size, weight: 900, opacity: WATERMARK.opacity, anchor: 'end', spacing: -4 }));
  }
  const eb = layout.eyebrow;
  if (eb) {
    body.push(`<rect x="${PAD_X}" y="150" width="72" height="10" rx="5" fill="${grad.accent ?? '#ffffff'}"/>`);
    body.push(textEl(PAD_X, EYEBROW.baseline, eb.line, { size: eb.size, weight: 800, opacity: 0.9, spacing: EYEBROW.spacing }));
  }
  for (const b of layout.blocks) body.push(b.svg);
  body.push(textEl(PAD_X, FOOTER_BASELINE, 'gitwrapped', { size: 44, weight: 900, spacing: -1 }));
  const { line: footLine, size: footSize } = layout.footer;
  if (footLine) body.push(textEl(PAD_X + CONTENT_WIDTH, FOOTER_BASELINE - 2, footLine, { size: footSize, weight: 600, opacity: 0.8, anchor: 'end' }));

  const label = escapeXml([eb ? getStrings(opts.lang).upper(s1(opts.eyebrow)) : '', s1(opts.big), s1(opts.title)].filter(Boolean).join(' — ') || 'gitwrapped card');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    background(ids, grad, palette.glowOpacity?.card),
    `<g fill="#ffffff" font-family="${escapeXml(FONT_FAMILY)}">`,
    ...body,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
  return { svg, drawnCharts: layout.drawnCharts };
}
