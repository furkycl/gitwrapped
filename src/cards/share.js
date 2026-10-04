// Share summary card: one landscape 1200x630 SVG (the usual link-preview / social image
// size) in the same visual language as the story cards. Pure layout: buildShareCard() in
// index.js turns stats into the strings drawn here.
import { escapeXml, FONT_FAMILY, measureText, sanitizeIdPrefix, textEl, THEMES, truncateStart, wrapText } from './svg.js';

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

const PAD = 64;
const INNER = SHARE_WIDTH - 2 * PAD;
const TILE_GAP = 20;
const TILE_TOP = 236;
const TILE_HEIGHT = 196;
const TILE_PAD = 24;
const PILL_TOP = 456;
const PILL_HEIGHT = 64;
// measureText() is calibrated to DejaVu Sans Bold (a wide fallback face); keep a little
// slack for rasterizer rounding.
const WEIGHT_FACTOR = 1.02;

const str = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Approximate rendered width in px, with slack for heavy/wide fonts and letter `spacing`. */
const widthOf = (text, fontSize, spacing = 0) => measureText(text, fontSize) * WEIGHT_FACTOR + spacing * Array.from(String(text)).length;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
const graphemes = (t) => (segmenter ? Array.from(segmenter.segment(t), (x) => x.segment) : Array.from(t));

/** `text` on one line, cut at the end with '…' (never mid-grapheme) so it fits `maxWidth`. */
function fitLine(text, maxWidth, fontSize, spacing = 0) {
  const t = str(text);
  if (!t || widthOf(t, fontSize, spacing) <= maxWidth) return t;
  const gs = graphemes(t);
  while (gs.length > 0 && widthOf(`${gs.join('').trimEnd()}…`, fontSize, spacing) > maxWidth) gs.pop();
  return `${gs.join('').trimEnd()}…`;
}

/** Largest font size in [min, max] at which `text` fits `width`, or null if none does. */
function fitSize(text, width, max, min) {
  const em = measureText(text, 1) * WEIGHT_FACTOR;
  if (em <= 0) return max;
  const size = Math.min(max, Math.floor(width / em));
  return size >= min ? size : null;
}

function background(id, t) {
  const stops = t.stops.map((c, i) => `<stop offset="${(i / (t.stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  return [
    '<defs>',
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`,
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.5"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#${id}-bg)"/>`,
    `<circle cx="1080" cy="60" r="320" fill="url(#${id}-glow)"/>`,
    `<circle cx="80" cy="640" r="360" fill="url(#${id}-glow)"/>`,
    `<circle cx="1110" cy="560" r="110" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="16"/>`,
  ].join('');
}

function tile(x, width, { label, value }) {
  const inner = width - 2 * TILE_PAD;
  const parts = [`<rect x="${x}" y="${TILE_TOP}" width="${width}" height="${TILE_HEIGHT}" rx="28" fill="#ffffff" fill-opacity="0.14"/>`];
  const lab = fitLine(str(label).toUpperCase(), inner, 20, 2.5);
  if (lab) parts.push(textEl(x + TILE_PAD, TILE_TOP + 48, lab, { size: 20, weight: 800, opacity: 0.85, spacing: 2.5 }));
  const v = str(value) || '—';
  const size = fitSize(v, inner, 64, 36);
  if (size) {
    parts.push(textEl(x + TILE_PAD, TILE_TOP + 140, v, { size, weight: 900, spacing: -0.02 * size }));
  } else {
    const lines = wrapText(v, { maxWidth: inner / WEIGHT_FACTOR, fontSize: 34, maxLines: 2 });
    lines.forEach((l, i) => parts.push(textEl(x + TILE_PAD, TILE_TOP + 118 + i * 40, l, { size: 34, weight: 900 })));
  }
  return parts.join('');
}

/**
 * Render the share card. All fields are optional strings except `tiles` (up to 4
 * `{label, value}`) and `file` (`{label, path, value}` or null; `path` is shortened from
 * the start, `note` replaces the whole pill text when there is no file). Deterministic;
 * all text XML-escaped; every id starts with `idPrefix` (default `gw-share`).
 */
export function renderShareSvg({ theme: themeName, eyebrow, title, tiles, file, note, footer, idPrefix } = {}) {
  const t = Object.hasOwn(THEMES, themeName ?? '') ? THEMES[themeName] : THEMES.pulse;
  const ids = sanitizeIdPrefix(idPrefix) || 'gw-share';
  const body = [];

  const eb = str(eyebrow).toUpperCase();
  body.push(`<rect x="${PAD}" y="56" width="56" height="8" rx="4" fill="#ffffff"/>`);
  if (eb) {
    body.push(textEl(PAD, 112, fitLine(eb, INNER, 26, 4), { size: 26, weight: 800, opacity: 0.9, spacing: 4 }));
  }

  const name = str(title) || 'your repo';
  const size = fitSize(name, INNER, 88, 44);
  const nameLine = size ? name : fitLine(name, INNER, 44);
  body.push(textEl(PAD, 200, nameLine, { size: size ?? 44, weight: 900, spacing: -0.02 * (size ?? 44) }));

  const list = (Array.isArray(tiles) ? tiles : []).slice(0, 4);
  if (list.length > 0) {
    const w = Math.floor((INNER - TILE_GAP * (list.length - 1)) / list.length);
    list.forEach((tl, i) => body.push(tile(PAD + i * (w + TILE_GAP), w, tl ?? {})));
  }

  const pillText = 30;
  body.push(`<rect x="${PAD}" y="${PILL_TOP}" width="${INNER}" height="${PILL_HEIGHT}" rx="32" fill="#ffffff" fill-opacity="0.14"/>`);
  const baseline = PILL_TOP + PILL_HEIGHT / 2 + pillText * 0.36;
  const path = str(file?.path);
  if (path) {
    const label = str(file.label);
    const value = str(file.value);
    const labelText = fitLine(label.toUpperCase(), 280, 22, 2);
    const valueText = fitLine(value, 300, 26);
    const labelW = labelText ? widthOf(labelText, 22, 2) + 20 : 0;
    const valueW = valueText ? widthOf(valueText, 26) + 24 : 0;
    if (labelText) body.push(textEl(PAD + 32, baseline, labelText, { size: 22, weight: 800, opacity: 0.85, spacing: 2 }));
    const maxW = Math.max(pillText * 3, INNER - 64 - labelW - valueW);
    body.push(textEl(PAD + 32 + labelW, baseline, truncateStart(path, { maxWidth: maxW / WEIGHT_FACTOR, fontSize: pillText }), { size: pillText, weight: 800 }));
    if (valueText) body.push(textEl(PAD + INNER - 32, baseline, valueText, { size: 26, weight: 700, opacity: 0.85, anchor: 'end' }));
  } else {
    const line = fitLine(note, INNER - 64, 28);
    if (line) body.push(textEl(PAD + 32, baseline, line, { size: 28, weight: 700, opacity: 0.9 }));
  }

  body.push(textEl(PAD, 590, 'gitwrapped', { size: 36, weight: 900, spacing: -1 }));
  const foot = str(footer);
  if (foot) {
    const line = fitLine(foot, 640, 24);
    body.push(textEl(PAD + INNER, 588, line, { size: 24, weight: 600, opacity: 0.8, anchor: 'end' }));
  }

  const label = escapeXml([eb, name].filter(Boolean).join(' — '));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    background(ids, t),
    `<g fill="#ffffff" font-family="${escapeXml(FONT_FAMILY)}">`,
    ...body,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
