import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_IDS } from '../src/cards/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = join(root, 'scripts', 'make-hero-gif.js');

// Minimal GIF parser: logical screen size, NETSCAPE loop, per-frame delays (ms) and
// image descriptor sizes, and whether the stream ends with the 0x3B trailer.
function parseGif(buf) {
  const b = Buffer.from(buf);
  const sig = b.toString('latin1', 0, 6);
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  const packed = b[10];
  let p = 13;
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
  const frames = [];
  let loop = null;
  let pendingDelay = null;
  let trailer = false;
  const skipSubBlocks = () => {
    while (b[p] !== 0) p += b[p] + 1;
    p++;
  };
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) {
      trailer = p === b.length;
      break;
    }
    if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        assert.equal(b[p], 4, 'GCE block size');
        pendingDelay = b.readUInt16LE(p + 2) * 10;
        p += 5;
        assert.equal(b[p++], 0, 'GCE terminator');
      } else if (label === 0xff) {
        const id = b.toString('latin1', p + 1, p + 12);
        if (id === 'NETSCAPE2.0') loop = b.readUInt16LE(p + 14);
        p += 1 + b[p];
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (tag === 0x2c) {
      const fw = b.readUInt16LE(p + 4);
      const fh = b.readUInt16LE(p + 6);
      const ipacked = b[p + 8];
      p += 9;
      if (ipacked & 0x80) p += 3 * (1 << ((ipacked & 7) + 1));
      p++; // LZW min code size
      skipSubBlocks();
      frames.push({ width: fw, height: fh, delay: pendingDelay });
      pendingDelay = null;
    } else {
      throw new Error(`unexpected GIF block 0x${tag.toString(16)} at ${p - 1}`);
    }
  }
  return { sig, width, height, loop, frames, trailer };
}

function card(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="192" viewBox="0 0 108 192"><rect width="108" height="192" fill="${color}"/><circle cx="54" cy="96" r="30" fill="#ffffff" fill-opacity="0.5"/><rect x="10" y="10" width="20" height="20" fill="#000"/><title>${label}</title></svg>`;
}
const SVGS = [card('#ff3d77', 'a'), card('#2a0a6b', 'b'), card('#00c2a8', 'c')];

test('importing make-hero-gif has no side effects and exports the API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-hero-import-'));
  try {
    // Import from a cwd where the default --out would land, then check nothing was written.
    const before = existsSync(join(root, 'docs', 'hero.gif')) ? statSync(join(root, 'docs', 'hero.gif')).mtimeMs : null;
    const mod = await import('../scripts/make-hero-gif.js');
    assert.equal(typeof mod.makeHeroGif, 'function');
    assert.equal(typeof mod.planFrames, 'function');
    assert.equal(typeof mod.orderedDither, 'function');
    assert.equal(typeof mod.parseArgs, 'function');
    assert.ok(Object.isFrozen(mod.DEFAULTS));
    assert.equal(mod.DEFAULTS.width, 360);
    const after = existsSync(join(root, 'docs', 'hero.gif')) ? statSync(join(root, 'docs', 'hero.gif')).mtimeMs : null;
    assert.equal(after, before, 'import must not rewrite docs/hero.gif');
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('makeHeroGif encodes a looping GIF89a with the planned frames and delays', async () => {
  const { makeHeroGif, DEFAULTS } = await import('../scripts/make-hero-gif.js');
  const res = await makeHeroGif(SVGS, { width: 54 });
  assert.equal(res.width, 54);
  assert.equal(res.height, 96);
  assert.ok(res.gif instanceof Uint8Array);
  const gif = parseGif(res.gif);
  assert.equal(gif.sig, 'GIF89a');
  assert.equal(gif.width, 54);
  assert.equal(gif.height, 96);
  assert.equal(gif.loop, 0, 'NETSCAPE2.0 loop count 0 = forever');
  assert.equal(gif.trailer, true, 'ends with 0x3B trailer');
  const per = 1 + DEFAULTS.fadeFrames;
  assert.equal(res.frames, SVGS.length * per);
  assert.equal(gif.frames.length, res.frames);
  gif.frames.forEach((f, i) => {
    assert.equal(f.width, 54);
    assert.equal(f.height, 96);
    assert.equal(f.delay, i % per === 0 ? DEFAULTS.holdMs : DEFAULTS.fadeMs, `frame ${i} delay`);
  });
});

test('makeHeroGif honours holdMs / fadeFrames / fadeMs options', async () => {
  const { makeHeroGif } = await import('../scripts/make-hero-gif.js');
  const res = await makeHeroGif(SVGS.slice(0, 2), { width: 27, holdMs: 500, fadeFrames: 1, fadeMs: 40 });
  const gif = parseGif(res.gif);
  assert.equal(res.frames, 4);
  assert.deepEqual(
    gif.frames.map((f) => f.delay),
    [500, 40, 500, 40],
  );
  const cut = await makeHeroGif(SVGS, { width: 27, fadeFrames: 0 });
  assert.equal(cut.frames, 3);
  assert.equal(parseGif(cut.gif).frames.length, 3);
});

test('makeHeroGif with a single card: one held frame, still loops', async () => {
  const { makeHeroGif, DEFAULTS } = await import('../scripts/make-hero-gif.js');
  const res = await makeHeroGif([SVGS[0]], { width: 27 });
  const gif = parseGif(res.gif);
  assert.equal(res.frames, 1);
  assert.equal(gif.frames.length, 1);
  assert.equal(gif.frames[0].delay, DEFAULTS.holdMs);
  assert.equal(gif.trailer, true);
});

test('makeHeroGif is deterministic', async () => {
  const { makeHeroGif } = await import('../scripts/make-hero-gif.js');
  const a = await makeHeroGif(SVGS, { width: 54 });
  const b = await makeHeroGif(SVGS, { width: 54 });
  assert.deepEqual(Buffer.from(a.gif), Buffer.from(b.gif));
});

test('makeHeroGif rejects bad input', async () => {
  const { makeHeroGif } = await import('../scripts/make-hero-gif.js');
  await assert.rejects(makeHeroGif([]), TypeError);
  await assert.rejects(makeHeroGif('nope'), TypeError);
  await assert.rejects(makeHeroGif(SVGS, { width: 0 }), TypeError);
  await assert.rejects(makeHeroGif(SVGS, { width: 1.5 }), TypeError);
  await assert.rejects(makeHeroGif(SVGS, { fadeFrames: -1 }), TypeError);
  const wide = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';
  await assert.rejects(makeHeroGif([SVGS[0], wide], { width: 27 }), /same size/);
});

test('planFrames: holds, crossfades and wrap-around', async () => {
  const { planFrames } = await import('../scripts/make-hero-gif.js');
  const black = new Uint8Array([0, 0, 0, 255]);
  const white = new Uint8Array([200, 100, 50, 255]);
  const frames = planFrames([black, white], { holdMs: 1000, fadeFrames: 1, fadeMs: 50 });
  assert.equal(frames.length, 4);
  assert.deepEqual(
    frames.map((f) => [f.delay, f.hold]),
    [
      [1000, true],
      [50, false],
      [1000, true],
      [50, false],
    ],
  );
  assert.equal(frames[0].rgba, black);
  assert.deepEqual([...frames[1].rgba], [100, 50, 25, 255]); // halfway black → white
  assert.deepEqual([...frames[3].rgba], [100, 50, 25, 255]); // last fades back to the first
  // one image: no fade frames; zero images: empty list
  assert.equal(planFrames([black]).length, 1);
  assert.deepEqual(planFrames([]), []);
  // defaults: 1 hold + 3 fades per card
  assert.equal(planFrames([black, white]).length, 8);
});

test('orderedDither keeps alpha, clamps, and is bounded by strength', async () => {
  const { orderedDither } = await import('../scripts/make-hero-gif.js');
  const w = 4;
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([128, 0, 255, 77], i);
  const out = orderedDither(rgba, w, 4);
  assert.equal(out.length, rgba.length);
  assert.notEqual(out, rgba);
  let varied = false;
  for (let i = 0; i < out.length; i += 4) {
    assert.ok(Math.abs(out[i] - 128) <= 4);
    assert.ok(out[i + 1] >= 0 && out[i + 1] <= 4);
    assert.ok(out[i + 2] >= 251 && out[i + 2] <= 255);
    assert.equal(out[i + 3], 77);
    if (out[i] !== 128) varied = true;
  }
  assert.ok(varied);
  assert.deepEqual([...rgba.slice(0, 4)], [128, 0, 255, 77], 'input untouched');
});

test('parseArgs: defaults, flags, and errors', async () => {
  const { parseArgs } = await import('../scripts/make-hero-gif.js');
  const cwd = resolve('/tmp/somewhere');
  assert.deepEqual(parseArgs([], cwd), {
    cards: resolve(cwd, 'docs/self-wrapped/cards'),
    out: resolve(cwd, 'docs/hero.gif'),
    width: 360,
  });
  assert.deepEqual(parseArgs(['--cards', 'c', '--out', 'x/y.gif', '--width', '120'], cwd), {
    cards: resolve(cwd, 'c'),
    out: resolve(cwd, 'x/y.gif'),
    width: 120,
  });
  assert.throws(() => parseArgs(['--bogus'], cwd), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(['stray'], cwd), /unknown argument/);
  assert.throws(() => parseArgs(['--out'], cwd), /--out needs a value/);
  assert.throws(() => parseArgs(['--cards', '--out', 'a'], cwd), /--cards needs a value/);
  assert.throws(() => parseArgs(['--width', '0'], cwd), /--width must be an integer from 1 to/);
  assert.throws(() => parseArgs(['--width', '12.5'], cwd), /--width must be an integer from 1 to/);
  assert.throws(() => parseArgs(['--width', 'abc'], cwd), /--width must be an integer from 1 to/);
});

test('CLI writes a GIF from a cards dir; bad args exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-hero-cli-'));
  try {
    const cards = join(dir, 'cards');
    mkdirSync(cards, { recursive: true });
    SVGS.forEach((svg, i) => writeFileSync(join(cards, `0${i + 1}-c.svg`), svg));
    writeFileSync(join(cards, 'notes.txt'), 'ignored');
    const out = join(dir, 'nested', 'hero.gif');
    const ok = spawnSync(process.execPath, [script, '--cards', cards, '--out', out, '--width', '54'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /54x96, 12 frames from 3 cards/);
    const gif = parseGif(readFileSync(out));
    assert.equal(gif.sig, 'GIF89a');
    assert.equal(gif.frames.length, 12);

    const bad = spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown argument: --nope/);

    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    const none = spawnSync(process.execPath, [script, '--cards', empty, '--out', join(dir, 'x.gif')], { encoding: 'utf8' });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /no \.svg cards/);
    assert.equal(existsSync(join(dir, 'x.gif')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('docs/hero.gif is a looping 360x640 GIF89a under 3 MB with one hold frame per card', () => {
  const path = join(root, 'docs', 'hero.gif');
  const buf = readFileSync(path);
  assert.ok(buf.length < 3 * 1024 * 1024, `hero.gif is ${buf.length} bytes`);
  const gif = parseGif(buf);
  assert.equal(gif.sig, 'GIF89a');
  assert.equal(gif.width, 360);
  assert.equal(gif.height, 640);
  assert.equal(gif.loop, 0);
  assert.equal(gif.trailer, true);
  const cards = readdirSync(join(root, 'docs', 'self-wrapped', 'cards')).filter((f) => f.endsWith('.svg'));
  assert.equal(cards.length, CARD_IDS.length);
  assert.equal(gif.frames.length, cards.length * 4);
  assert.equal(gif.frames.filter((f) => f.delay === 1600).length, cards.length);
});

test('package.json: hero-gif script, gifenc is dev-only, scripts/docs not published', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['hero-gif'], 'node scripts/make-hero-gif.js');
  assert.ok(pkg.devDependencies?.gifenc, 'gifenc in devDependencies');
  assert.equal(pkg.dependencies?.gifenc, undefined);
  for (const f of pkg.files) assert.ok(!/^(scripts|docs)\b/.test(f), `files whitelist has ${f}`);
  // the shipped code must not import gifenc
  const scan = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scan(join(d, e.name)) : [join(d, e.name)]));
  for (const f of [...scan(join(root, 'src')), ...scan(join(root, 'bin'))]) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /gifenc/, `${f} must not use gifenc`);
  }
});

test('README shows docs/hero.gif, drops the TODO, and its local image paths exist', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /<img src="docs\/hero\.gif"/);
  assert.doesNotMatch(readme, /TODO/);
  const paths = [
    ...[...readme.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...readme.matchAll(/\]\(((?:docs|\.loop)\/[^)\s#]*)\)/g)].map((m) => m[1]),
  ].filter((p) => !/^https?:/.test(p));
  assert.ok(paths.includes('docs/hero.gif'));
  for (const p of paths) assert.ok(existsSync(join(root, p)), `README references missing ${p}`);
});

test('docs/self-wrapped/README.md commit count matches the intro card', () => {
  const md = readFileSync(join(root, 'docs', 'self-wrapped', 'README.md'), 'utf8');
  const intro = readFileSync(join(root, 'docs', 'self-wrapped', 'cards', '01-intro.svg'), 'utf8');
  const mdCount = Number(md.match(/\*\*Commits analyzed:\*\* (\d+)/)?.[1]);
  const cardCount = Number(intro.match(/>(\d+) commits to unwrap</)?.[1]);
  assert.ok(mdCount > 0);
  assert.equal(mdCount, cardCount);
  assert.match(md, /\[`docs\/hero\.gif`\]\(\.\.\/hero\.gif\)/);
});

test('hero gif: rejects bad holdMs, fadeMs and colors', async () => {
  const mod = await import('../scripts/make-hero-gif.js');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
  for (const bad of [{ holdMs: -1 }, { fadeMs: Number.NaN }, { holdMs: '5' }, { colors: 1 }, { colors: 300 }, { colors: 2.5 }]) {
    await assert.rejects(mod.makeHeroGif([svg], { width: 10, ...bad }), TypeError, JSON.stringify(bad));
  }
});

test('hero gif: caps --width and supports --help', async () => {
  const mod = await import('../scripts/make-hero-gif.js');
  assert.throws(() => mod.parseArgs(['--width', String(mod.MAX_WIDTH + 1)]), /--width/);
  assert.equal(mod.parseArgs(['--width', String(mod.MAX_WIDTH)]).width, mod.MAX_WIDTH);
  assert.equal(mod.parseArgs(['--help']).help, true);
  assert.equal(mod.parseArgs(['-h']).help, true);
  assert.match(mod.USAGE, /--cards/);
});
