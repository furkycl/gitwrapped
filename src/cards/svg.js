// Story-card renderer: 1080x1920 standalone SVG strings with a bold gradient style.
// Pure and deterministic (no randomness, no dates, no I/O). Text uses a system font
// stack only, so the SVGs need no external fonts, images or stylesheets.

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;

export const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PAD_X = 96;
const CONTENT_WIDTH = CARD_WIDTH - 2 * PAD_X;
// Non-big text wraps a little short of the content width: the width model is an
// approximation and bold faces can run wider than it predicts.
const WRAP_WIDTH = Math.floor(CONTENT_WIDTH * 0.95);
const ELLIPSIS = '…';

const theme = (stops, glow, angle) => Object.freeze({ stops: Object.freeze(stops), glow, angle });

/**
 * Named gradient themes. Each has `stops` (3 colors, top-left → bottom-right), `glow`
 * (the color of the soft decorative blobs) and `angle` (0 = diagonal, 1 = mostly
 * vertical). All are dark or saturated enough for white text.
 */
export const THEMES = Object.freeze({
  pulse: theme(['#ff3d77', '#9b2ff7', '#2a0a6b'], '#ffb3d1', 0),
  ocean: theme(['#00c6ff', '#0063e6', '#14125e'], '#7ae8ff', 1),
  cosmic: theme(['#8e2de2', '#4a00e0', '#10002f'], '#d59bff', 0),
  ember: theme(['#ff6a2f', '#e0245e', '#4a0d2e'], '#ffd166', 1),
  mint: theme(['#16b89a', '#0d6e78', '#0b1f3a'], '#9dffc9', 0),
  neon: theme(['#f72585', '#b5179e', '#3a0ca3'], '#4cc9f0', 1),
  sunset: theme(['#ff9a00', '#e52e71', '#5b0f4d'], '#ffe08a', 0),
  gold: theme(['#f7b42c', '#d35400', '#3b1206'], '#fff3b0', 1),
});

const DEFAULT_THEME = 'pulse';

// Characters not allowed in XML 1.0 (C0 controls except tab/LF/CR, U+FFFE/U+FFFF, lone
// surrogates), plus DEL and C1 controls, which are legal but never wanted on a card.
// With the `u` flag a valid surrogate pair is one code point, so only lone halves match.
const BAD_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF\uD800-\uDFFF]/gu;
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
const FULL_WIDTH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3fffd}]/u;
const LETTER = /\p{L}/u;

/** Width of one code point, in em. */
function charWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_WIDTHS[cp - 0x20] / 1000;
  if (ZERO_WIDTH.test(ch)) return 0;
  if (FULL_WIDTH.test(ch)) return 1;
  if (cp === 0x2026 || cp === 0x2014) return 1; // ellipsis, em dash
  if (cp < 0x20) return 0;
  // Other letters (accented Latin, Greek, Cyrillic ...) as a wide capital; symbols as '+'.
  return LETTER.test(ch) ? 0.85 : 0.84;
}

/** Approximate rendered width of `text` in px at `fontSize`. */
export function measureText(text, fontSize) {
  let em = 0;
  for (const ch of String(text ?? '')) em += charWidth(ch);
  return em * fontSize;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/** Split into grapheme clusters (so emoji sequences are never cut in half). */
function graphemes(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Longest prefix of `word` (as graphemes) that fits `maxWidth`; at least one grapheme. */
function hardBreak(word, maxWidth, fontSize) {
  const gs = graphemes(word);
  let width = 0;
  let n = 0;
  while (n < gs.length && width + measureText(gs[n], fontSize) <= maxWidth) {
    width += measureText(gs[n], fontSize);
    n += 1;
  }
  n = Math.max(1, n);
  // Prefer breaking right after a '/' (file paths), if that keeps a reasonable chunk.
  const slash = gs.slice(0, n).lastIndexOf('/');
  if (n < gs.length && slash >= Math.floor(n / 3) && slash < n - 1) n = slash + 1;
  return [gs.slice(0, n).join(''), gs.slice(n).join('')];
}

/** `line` shortened (from the end) so that `line + '…'` fits `maxWidth`. */
function ellipsize(line, maxWidth, fontSize) {
  const gs = graphemes(line.trimEnd());
  while (gs.length > 0 && measureText(gs.join('') + ELLIPSIS, fontSize) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ELLIPSIS;
}

/** `text` shortened from the start ('…' + tail) so that it fits `maxWidth`. */
export function truncateStart(text, { maxWidth, fontSize }) {
  text = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (measureText(text, fontSize) <= maxWidth) return text;
  const gs = graphemes(text);
  while (gs.length > 0 && measureText(ELLIPSIS + gs.join(''), fontSize) > maxWidth) gs.shift();
  return ELLIPSIS + gs.join('').trimStart();
}

/**
 * Greedy word wrap using the approximate width model. Whitespace is collapsed; words
 * wider than `maxWidth` are hard-broken (after a '/' when possible). With more lines
 * than `maxLines` (default unlimited) the last kept line ends with '…'.
 * Returns string[] ([] for empty text).
 */
export function wrapText(text, { maxWidth, fontSize, maxLines = Infinity } = {}) {
  if (!(maxWidth > 0) || !(fontSize > 0)) throw new TypeError('wrapText needs positive maxWidth and fontSize');
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    while (measureText(word, fontSize) > maxWidth) {
      const [head, rest] = hardBreak(word, maxWidth, fontSize);
      lines.push(head);
      word = rest;
    }
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1], maxWidth, fontSize);
  return kept;
}

// ---------------------------------------------------------------------------------------
// Layout

const BIG_MAX = 280;
const BIG_MIN = 72;
// The width model matches DejaVu Sans Bold; keep a little slack for rasterizer rounding.
const BIG_WEIGHT_FACTOR = 1.02;
const TITLE = { size: 72, lineHeight: 1.12, maxLines: 3 };
const SUBTITLE = { size: 44, lineHeight: 1.3, maxLines: 4 };
const LIST = { size: 40, rowHeight: 78, pad: 40, maxRows: 6 };
const GAP = 48;
const CONTENT_TOP = 300;
const CONTENT_BOTTOM = 1700;

/** Font size and lines for the big number/word: as large as fits, wrapping as a last resort. */
function fitBig(text, maxSize) {
  const em = measureText(text, 1) * BIG_WEIGHT_FACTOR;
  const size = Math.max(BIG_MIN, Math.min(maxSize, Math.floor(CONTENT_WIDTH / Math.max(em, 0.01))));
  if (em * size <= CONTENT_WIDTH) return { size, lines: [text] };
  return { size: BIG_MIN, lines: wrapText(text, { maxWidth: CONTENT_WIDTH / BIG_WEIGHT_FACTOR, fontSize: BIG_MIN, maxLines: 2 }) };
}

function normalizeRow(row) {
  if (row && typeof row === 'object') {
    return { label: String(row.label ?? ''), value: String(row.value ?? ''), truncate: row.truncate === 'start' ? 'start' : 'end' };
  }
  return { label: String(row ?? ''), value: '', truncate: 'end' };
}

/** Lay out the text blocks; each block has a height and a render(y) → svg string. */
function blocks({ big, title, subtitle, lines }, bigMax) {
  const out = [];
  if (big) {
    const { size, lines: bl } = fitBig(big, bigMax);
    const lh = size * 1.02;
    out.push({
      height: lh * bl.length,
      render: (y) => bl.map((l, i) =>
        textEl(PAD_X, y + size * 0.82 + i * lh, l, { size, weight: 900, spacing: -0.02 * size })).join(''),
    });
  }
  for (const [text, spec, extra] of [[title, TITLE, { weight: 800 }], [subtitle, SUBTITLE, { weight: 600, opacity: 0.9 }]]) {
    if (!text) continue;
    const tl = wrapText(text, { maxWidth: WRAP_WIDTH, fontSize: spec.size, maxLines: spec.maxLines });
    const lh = spec.size * spec.lineHeight;
    out.push({
      height: lh * tl.length,
      render: (y) => tl.map((l, i) => textEl(PAD_X, y + spec.size * 0.85 + i * lh, l, { size: spec.size, ...extra })).join(''),
    });
  }
  const rows = (Array.isArray(lines) ? lines : []).map(normalizeRow).filter((r) => r.label || r.value).slice(0, LIST.maxRows);
  if (rows.length > 0) {
    const height = rows.length * LIST.rowHeight + 2 * LIST.pad - (LIST.rowHeight - LIST.size * 1.2);
    out.push({
      height,
      render: (y) => {
        const parts = [`<rect x="${PAD_X - 32}" y="${y}" width="${CONTENT_WIDTH + 64}" height="${height}" rx="40" fill="#ffffff" fill-opacity="0.14"/>`];
        rows.forEach((row, i) => {
          const baseline = y + LIST.pad + LIST.size * 0.9 + i * LIST.rowHeight;
          const value = row.value ? wrapText(row.value, { maxWidth: WRAP_WIDTH * 0.55, fontSize: LIST.size, maxLines: 1 })[0] : '';
          const valueWidth = value ? measureText(value, LIST.size) + 32 : 0;
          const maxWidth = Math.max(LIST.size * 3, WRAP_WIDTH - valueWidth);
          const label = row.truncate === 'start'
            ? truncateStart(row.label, { maxWidth, fontSize: LIST.size })
            : (wrapText(row.label, { maxWidth, fontSize: LIST.size, maxLines: 1 })[0] ?? '');
          parts.push(textEl(PAD_X, baseline, label, { size: LIST.size, weight: 700 }));
          if (value) parts.push(textEl(PAD_X + CONTENT_WIDTH, baseline, value, { size: LIST.size, weight: 800, opacity: 0.85, anchor: 'end' }));
        });
        return parts.join('');
      },
    });
  }
  return out;
}

/** `text` on one line with letter `spacing` px, cut at the end with '…' to fit `maxWidth`. */
function fitSpaced(text, maxWidth, fontSize, spacing) {
  const width = (t) => measureText(t, fontSize) + spacing * Array.from(t).length;
  if (width(text) <= maxWidth) return text;
  const gs = graphemes(text);
  while (gs.length > 0 && width(gs.join('').trimEnd() + ELLIPSIS) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ELLIPSIS;
}

const totalHeight = (bs) => bs.reduce((h, b) => h + b.height, 0) + GAP * Math.max(0, bs.length - 1);

const round = (n) => Math.round(n * 10) / 10;

/** One <text> element (text XML-escaped, coordinates rounded to 0.1px). */
export function textEl(x, y, text, { size, weight = 700, opacity = 1, anchor = 'start', spacing = 0 }) {
  const attrs = [`x="${round(x)}"`, `y="${round(y)}"`, `font-size="${round(size)}"`, `font-weight="${weight}"`];
  if (opacity !== 1) attrs.push(`fill-opacity="${opacity}"`);
  if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
  if (spacing) attrs.push(`letter-spacing="${round(spacing)}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(text)}</text>`;
}

function background(id, t) {
  const [x2, y2] = t.angle ? ['0.35', '1'] : ['1', '1'];
  const stops = t.stops.map((c, i) => `<stop offset="${(i / (t.stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  return [
    '<defs>',
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#${id}-bg)"/>`,
    `<circle cx="930" cy="250" r="460" fill="url(#${id}-glow)"/>`,
    `<circle cx="110" cy="1650" r="560" fill="url(#${id}-glow)"/>`,
    `<circle cx="960" cy="1280" r="180" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="24"/>`,
  ].join('');
}

/** A valid XML id prefix (NCName-safe): letters, digits, '-', '_', '.'; starts with a letter. */
export function sanitizeIdPrefix(prefix) {
  const cleaned = String(prefix ?? '').replace(/[^A-Za-z0-9_.-]+/g, '-');
  if (!cleaned) return '';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `gw-${cleaned}`;
}

/**
 * Render one story card as a complete standalone SVG string (1080x1920).
 * All fields are optional strings except `lines`: an array of strings or
 * `{label, value, truncate}` rows (value right-aligned; truncate 'start' keeps the end
 * of long labels such as file paths). At most 6 rows are drawn.
 * `theme` is a THEMES key (unknown → 'pulse'). `footer` is small text next to the
 * "gitwrapped" brand. `idPrefix` prefixes every element id (default `gw-<theme>`);
 * pass a unique one per card when several SVGs are inlined into one HTML page.
 * All text is XML-escaped; output is deterministic.
 */
export function renderCard({ theme: themeName, eyebrow, title, big, subtitle, lines, footer, idPrefix } = {}) {
  const name = Object.hasOwn(THEMES, themeName ?? '') ? themeName : DEFAULT_THEME;
  const ids = sanitizeIdPrefix(idPrefix) || `gw-${name}`;
  const str = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
  const content = { big: str(big), title: str(title), subtitle: str(subtitle), lines };

  // Shrink the big text until everything fits between the eyebrow and the footer.
  const available = CONTENT_BOTTOM - CONTENT_TOP;
  let bigMax = BIG_MAX;
  let bs = blocks(content, bigMax);
  while (totalHeight(bs) > available && bigMax > BIG_MIN) {
    bigMax = Math.max(BIG_MIN, Math.floor(bigMax * 0.85));
    bs = blocks(content, bigMax);
  }
  // Sit slightly above the vertical center of the content area.
  let y = CONTENT_TOP + Math.max(0, (available - totalHeight(bs)) * 0.42);

  const body = [];
  const eb = str(eyebrow).toUpperCase();
  if (eb) {
    const line = fitSpaced(eb, CONTENT_WIDTH, 36, 5);
    body.push(`<rect x="${PAD_X}" y="150" width="72" height="10" rx="5" fill="#ffffff"/>`);
    body.push(textEl(PAD_X, 222, line, { size: 36, weight: 800, opacity: 0.9, spacing: 5 }));
  }
  for (const b of bs) {
    body.push(b.render(y));
    y += b.height + GAP;
  }
  body.push(textEl(PAD_X, 1820, 'gitwrapped', { size: 44, weight: 900, spacing: -1 }));
  const foot = str(footer);
  if (foot) {
    // Right of the brand, leaving a gap; shrinks (32 → 24px) before it is ellipsized.
    const maxWidth = CONTENT_WIDTH - (measureText('gitwrapped', 44) - 10) - 40;
    const size = Math.max(24, Math.min(32, Math.floor(maxWidth / Math.max(measureText(foot, 1), 0.01))));
    const [line] = wrapText(foot, { maxWidth, fontSize: size, maxLines: 1 });
    body.push(textEl(PAD_X + CONTENT_WIDTH, 1818, line, { size, weight: 600, opacity: 0.8, anchor: 'end' }));
  }

  const label = escapeXml([eb, content.big, content.title].filter(Boolean).join(' — ') || 'gitwrapped card');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    background(ids, THEMES[name]),
    `<g fill="#ffffff" font-family="${escapeXml(FONT_FAMILY)}">`,
    ...body,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
