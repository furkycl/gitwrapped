// Color themes (`--theme`): which concrete colors the cards, the share image and the
// viewer page are drawn in. Only colors change between themes, never the layout.
//
// Two separate ideas, kept apart in naming:
// - a *gradient* is one card's background (`spec.theme`: 'pulse', 'ocean', … 'neon'),
//   picked per card in index.js (CARD_THEMES);
// - a *color theme* ('default', 'mono', 'neon') is the palette set those gradient names
//   resolve to. 'default' is the original gradient set, byte for byte.
// Pure data plus two small WCAG helpers, so tests can check contrast programmatically.

const gradient = (stops, glow, angle, accent) => Object.freeze({ stops: Object.freeze(stops), glow, angle, ...(accent ? { accent } : {}) });

/**
 * The default gradients. Each has `stops` (3 colors, top-left → bottom-right), `glow`
 * (the color of the soft decorative blobs) and `angle` (0 = diagonal, 1 = mostly
 * vertical). Optional `accent` (other color themes only) colors the small accent bar
 * above the eyebrow; without it the bar is white.
 */
export const DEFAULT_GRADIENTS = Object.freeze({
  pulse: gradient(['#ff3d77', '#9b2ff7', '#2a0a6b'], '#ffb3d1', 0),
  ocean: gradient(['#00c6ff', '#0063e6', '#14125e'], '#7ae8ff', 1),
  cosmic: gradient(['#8e2de2', '#4a00e0', '#10002f'], '#d59bff', 0),
  ember: gradient(['#ff6a2f', '#e0245e', '#4a0d2e'], '#ffd166', 1),
  mint: gradient(['#16b89a', '#0d6e78', '#0b1f3a'], '#9dffc9', 0),
  neon: gradient(['#f72585', '#b5179e', '#3a0ca3'], '#4cc9f0', 1),
  sunset: gradient(['#ff9a00', '#e52e71', '#5b0f4d'], '#ffe08a', 0),
  gold: gradient(['#f7b42c', '#d35400', '#3b1206'], '#fff3b0', 1),
});

/** The gradient names every color theme defines (the keys of DEFAULT_GRADIENTS). */
export const GRADIENT_NAMES = Object.freeze(Object.keys(DEFAULT_GRADIENTS));

// Grayscale: the same gradient names, from charcoal to near-black (a little lighter or
// darker per card so consecutive cards still read as different slides).
const MONO_GRADIENTS = Object.freeze({
  pulse: gradient(['#474747', '#242424', '#0a0a0a'], '#707070', 0),
  ocean: gradient(['#404040', '#1f1f1f', '#080808'], '#6b6b6b', 1),
  cosmic: gradient(['#383838', '#1a1a1a', '#050505'], '#666666', 0),
  ember: gradient(['#454545', '#282828', '#0d0d0d'], '#6e6e6e', 1),
  mint: gradient(['#3d3d3d', '#1f1f1f', '#070707'], '#6a6a6a', 0),
  neon: gradient(['#3b3b3b', '#1c1c1c', '#030303'], '#686868', 1),
  sunset: gradient(['#4a4a4a', '#2b2b2b', '#0f0f0f'], '#727272', 0),
  gold: gradient(['#424242', '#242424', '#0a0a0a'], '#6c6c6c', 1),
});

// Near-black backgrounds with one vivid neon glow (and matching accent bar) per card.
const NEON_GRADIENTS = Object.freeze({
  pulse: gradient(['#1d0420', '#0c0312', '#030106'], '#ff2bd6', 0, '#ff2bd6'),
  ocean: gradient(['#03182a', '#020b16', '#010308'], '#00e5ff', 1, '#00e5ff'),
  cosmic: gradient(['#160634', '#090318', '#020107'], '#b026ff', 0, '#c45cff'),
  ember: gradient(['#260c03', '#120507', '#050102'], '#ff6b1a', 1, '#ff7a2e'),
  mint: gradient(['#031d12', '#020e0b', '#010403'], '#39ff88', 0, '#39ff88'),
  neon: gradient(['#200428', '#0b0216', '#020105'], '#ff3df2', 1, '#ff3df2'),
  sunset: gradient(['#250716', '#10030b', '#040103'], '#ff2e63', 0, '#ff4d7a'),
  gold: gradient(['#211803', '#0e0a02', '#030201'], '#ffd600', 1, '#ffd600'),
});

/** Viewer page colors of the default theme (the original wrapped.html CSS, verbatim). */
const DEFAULT_VIEWER = Object.freeze({
  bg: '#07070b',
  muted: '#c4c4d4',
  focus: '#ffd84d',
  dialog: '#15151f',
  // body background: three soft radial glows (center, bottom right, top left).
  glowCenter: 'rgba(124,92,255,.24)',
  glowCorner: 'rgba(255,61,119,.12)',
  glowTop: 'rgba(0,200,255,.08)',
  // the story frame's halo on wide screens.
  halo: 'rgba(124,92,255,.28)',
});

/**
 * Color themes by name. Each has `gradients` (every GRADIENT_NAMES key → {stops, glow,
 * angle, accent?}), `viewer` (the page chrome colors: bg, muted, focus, dialog,
 * glowCenter, glowCorner, glowTop, halo) and `glowOpacity` ({card, share}: peak opacity
 * of the decorative glows; null keeps the default 0.55 / 0.5).
 */
export const COLOR_THEMES = Object.freeze({
  default: Object.freeze({ gradients: DEFAULT_GRADIENTS, viewer: DEFAULT_VIEWER, glowOpacity: null }),
  mono: Object.freeze({
    gradients: MONO_GRADIENTS,
    viewer: Object.freeze({
      bg: '#0a0a0a',
      muted: '#c8c8c8',
      focus: '#ffffff',
      dialog: '#1a1a1a',
      glowCenter: 'rgba(255,255,255,.10)',
      glowCorner: 'rgba(255,255,255,.05)',
      glowTop: 'rgba(255,255,255,.04)',
      halo: 'rgba(255,255,255,.12)',
    }),
    glowOpacity: null,
  }),
  neon: Object.freeze({
    gradients: NEON_GRADIENTS,
    viewer: Object.freeze({
      bg: '#030306',
      muted: '#c9c9e0',
      focus: '#39ff88',
      dialog: '#0d0d16',
      glowCenter: 'rgba(255,43,214,.20)',
      glowCorner: 'rgba(0,229,255,.14)',
      glowTop: 'rgba(57,255,136,.08)',
      halo: 'rgba(255,43,214,.32)',
    }),
    // Vivid glows are brighter than the default pastel ones; a lower peak keeps white
    // text readable where a glow sits behind it.
    glowOpacity: Object.freeze({ card: 0.36, share: 0.33 }),
  }),
});

/** Valid `--theme` names, default first. */
export const COLOR_THEME_NAMES = Object.freeze(Object.keys(COLOR_THEMES));
export const DEFAULT_COLOR_THEME = 'default';

/** True for a known color theme name (own keys only: 'toString' is not a theme). */
export function isColorTheme(name) {
  return typeof name === 'string' && Object.hasOwn(COLOR_THEMES, name);
}

/** The color theme object for `name`; unknown or missing → the default theme. */
export function getColorTheme(name) {
  return COLOR_THEMES[isColorTheme(name) ? name : DEFAULT_COLOR_THEME];
}

/** sRGB '#rrggbb' or '#rgb' → [r, g, b] in 0..255. Throws on anything else. */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) throw new Error(`not a hex color: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG 2.x relative luminance (0 = black, 1 = white) of a hex color. */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio (1..21) between two hex colors; order does not matter. */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` drawn at `opacity` (0..1) over `bottom`, as '#rrggbb' (for overlay contrast). */
export function blendHex(top, bottom, opacity) {
  const a = parseHex(top);
  const b = parseHex(bottom);
  return `#${a.map((v, i) => Math.round(v * opacity + b[i] * (1 - opacity)).toString(16).padStart(2, '0')).join('')}`;
}
