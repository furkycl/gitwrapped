// PNG export: rasterizes the card SVGs with @resvg/resvg-js (a prebuilt native module,
// no network, no browser). The module is loaded lazily so that a missing or unsupported
// native binary only disables PNG output instead of breaking the whole CLI.
//
// Text uses the machine's installed fonts (loadSystemFonts). The cards ask for a system
// sans stack ending in `sans-serif`; resvg maps that generic family to SANS_FAMILY below,
// and falls back to whatever sans-serif fonts the system has when that one is missing.

const SANS_BY_PLATFORM = { linux: 'DejaVu Sans', darwin: 'Helvetica', win32: 'Segoe UI' };

/** The default sans-serif family for this platform (used when the SVG's fonts are missing). */
export const SANS_FAMILY = SANS_BY_PLATFORM[process.platform] ?? 'DejaVu Sans';

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
 */
export async function renderPng(svg, { width } = {}) {
  const Resvg = await loadResvg();
  const opts = {
    font: { loadSystemFonts: true, defaultFontFamily: SANS_FAMILY, sansSerifFamily: SANS_FAMILY },
  };
  if (width !== undefined) {
    if (!(Number.isInteger(width) && width > 0)) throw new TypeError('renderPng width must be a positive integer');
    opts.fitTo = { mode: 'width', value: width };
  }
  const rendered = new Resvg(String(svg), opts).render();
  return Buffer.from(rendered.asPng());
}

/** Width and height of a PNG buffer, read from its IHDR chunk (null if not a PNG). */
export function pngSize(buf) {
  const SIG = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.subarray(0, 8).toString('hex') !== SIG) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
