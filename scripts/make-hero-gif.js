#!/usr/bin/env node
// Dev helper: builds docs/hero.gif, an animated story reel of the cards (like a screen
// recording of wrapped.html), for the README.
//
//   node scripts/make-hero-gif.js [--cards <dir>] [--out <file>] [--width <px>]
//   npm run hero-gif
//
// Defaults: --cards docs/self-wrapped/cards  --out docs/hero.gif  --width 360
// Run `npm run self-wrapped` first so the cards are current. Fully offline: the cards are
// rasterized with @resvg/resvg-js and encoded with gifenc (a devDependency, not shipped).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import gifenc from 'gifenc';
import { SANS_FAMILY, loadResvg } from '../src/png.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

export const DEFAULTS = Object.freeze({
  width: 360, // 1080x1920 cards → 360x640 frames
  holdMs: 1600, // how long each card stays on screen
  fadeFrames: 3, // crossfade frames between cards (0 = hard cut)
  fadeMs: 70, // delay of each crossfade frame
  colors: 256, // palette size per frame
  dither: true, // light ordered dither so gradients don't band
});

// 4x4 Bayer matrix, centered on 0 (values -7.5 … 7.5).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v - 7.5);

/**
 * Ordered (Bayer) dither: nudge each pixel by a small position-dependent offset before
 * palette mapping. Unlike error diffusion it stays stable from frame to frame and
 * compresses well. `strength` is the max offset per channel.
 */
export function orderedDither(rgba, width, strength = 4) {
  const out = new Uint8Array(rgba.length);
  const k = strength / 7.5;
  for (let p = 0, i = 0; i < rgba.length; p++, i += 4) {
    const d = BAYER4[((Math.floor(p / width) & 3) << 2) | (p % width & 3)] * k;
    out[i] = clamp(rgba[i] + d);
    out[i + 1] = clamp(rgba[i + 1] + d);
    out[i + 2] = clamp(rgba[i + 2] + d);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Rasterize one SVG to RGBA pixels at `width` px wide. */
async function rasterize(svg, width) {
  const Resvg = await loadResvg();
  const img = new Resvg(String(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: SANS_FAMILY, sansSerifFamily: SANS_FAMILY },
  }).render();
  return { width: img.width, height: img.height, rgba: new Uint8Array(img.pixels) };
}

/** Linear blend of two same-sized RGBA buffers, t in [0, 1]. */
function blend(a, b, t) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] + (b[i] - a[i]) * t);
  return out;
}

/** Composite onto black and force full opacity (GIF has 1-bit alpha; cards are opaque anyway). */
function opaque(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * a);
    out[i + 1] = Math.round(rgba[i + 1] * a);
    out[i + 2] = Math.round(rgba[i + 2] * a);
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Build the frame list (pixels + delay) for a looping reel: each card is held for holdMs,
 * with `fadeFrames` crossfade frames into the next card (and from the last back to the first).
 */
export function planFrames(images, { holdMs = DEFAULTS.holdMs, fadeFrames = DEFAULTS.fadeFrames, fadeMs = DEFAULTS.fadeMs } = {}) {
  const frames = [];
  const fades = images.length > 1 ? fadeFrames : 0;
  images.forEach((img, i) => {
    frames.push({ rgba: img, delay: holdMs, hold: true });
    const next = images[(i + 1) % images.length];
    for (let f = 1; f <= fades; f++) frames.push({ rgba: blend(img, next, f / (fades + 1)), delay: fadeMs, hold: false });
  });
  return frames;
}

/**
 * Turn an array of SVG strings into an animated, infinitely looping GIF.
 * Every frame gets its own quantized palette so the card gradients keep their colors.
 * Resolves to { gif: Uint8Array, width, height, frames }.
 */
export async function makeHeroGif(svgs, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (!Array.isArray(svgs) || svgs.length === 0) throw new TypeError('makeHeroGif needs at least one SVG');
  if (!(Number.isInteger(opts.width) && opts.width > 0)) throw new TypeError('width must be a positive integer');
  if (!(Number.isInteger(opts.fadeFrames) && opts.fadeFrames >= 0)) throw new TypeError('fadeFrames must be an integer >= 0');
  for (const key of ['holdMs', 'fadeMs']) {
    if (!(Number.isFinite(opts[key]) && opts[key] >= 0)) throw new TypeError(`${key} must be a number >= 0`);
  }
  if (!(Number.isInteger(opts.colors) && opts.colors >= 2 && opts.colors <= 256)) throw new TypeError('colors must be an integer from 2 to 256');

  const rendered = [];
  for (const svg of svgs) rendered.push(await rasterize(svg, opts.width));
  const { width, height } = rendered[0];
  for (const r of rendered) {
    if (r.width !== width || r.height !== height) throw new Error('all cards must have the same size');
  }

  const frames = planFrames(
    rendered.map((r) => opaque(r.rgba)),
    opts,
  );
  const gif = GIFEncoder();
  frames.forEach(({ rgba, delay, hold }, i) => {
    const palette = quantize(rgba, opts.colors);
    const index = applyPalette(opts.dither && hold ? orderedDither(rgba, width) : rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay, ...(i === 0 ? { repeat: 0 } : {}) });
  });
  gif.finish();
  return { gif: gif.bytes(), width, height, frames: frames.length };
}

/** Largest --width the CLI accepts (the cards' native width). */
export const MAX_WIDTH = 1080;

export const USAGE = 'usage: node scripts/make-hero-gif.js [--cards <dir>] [--out <file>] [--width <px>]\n' +
  '  --cards  folder of card SVGs (default docs/self-wrapped/cards)\n' +
  '  --out    GIF to write (default docs/hero.gif)\n' +
  `  --width  frame width in px, 1-${MAX_WIDTH} (default ${DEFAULTS.width})\n`;

/** Parse --cards / --out / --width. Relative paths resolve against `cwd`. */
export function parseArgs(argv, cwd = process.cwd()) {
  const out = { cards: resolve(cwd, 'docs/self-wrapped/cards'), out: resolve(cwd, 'docs/hero.gif'), width: DEFAULTS.width };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--cards' || arg === '--out' || arg === '--width') {
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i++;
      if (arg === '--width') {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0 || n > MAX_WIDTH) throw new Error(`--width must be an integer from 1 to ${MAX_WIDTH}`);
        out.width = n;
      } else {
        out[arg.slice(2)] = resolve(cwd, value);
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!existsSync(args.cards)) throw new Error(`cards folder not found: ${args.cards} (run npm run self-wrapped first)`);
  const files = readdirSync(args.cards)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  if (files.length === 0) throw new Error(`no .svg cards in ${args.cards} (run npm run self-wrapped first)`);
  const svgs = files.map((f) => readFileSync(join(args.cards, f), 'utf8'));
  const { gif, width, height, frames } = await makeHeroGif(svgs, { width: args.width });
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, gif);
  const kb = (gif.length / 1024).toFixed(0);
  process.stdout.write(`${args.out}: ${width}x${height}, ${frames} frames from ${files.length} cards, ${kb} KB\n`);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((err) => {
    process.stderr.write(`make-hero-gif: ${err.message}\n`);
    process.exitCode = 1;
  });
}
