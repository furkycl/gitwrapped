import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { loadResvg, needsEmojiStrip, pngSize, renderPng, SANS_FAMILY, stripEmojiFromText } from '../src/png.js';
import { buildCards, CARD_IDS, cardIdsFor, measureText, renderCard, renderShareCard, renderShareSvg } from '../src/cards/index.js';
import { escapeXml, FONT_FAMILY } from '../src/cards/svg.js';
import { computeStats } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { run } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

// The full card set of a team whose commits fall in one calendar month (the fixtures):
// every card but the monthly timeline (see cardIdsFor).
const TEAM_IDS = cardIdsFor({ contributors: { total: 2 } });

const TODAY = '2024-03-14';
const INJECT = `<script>&"'`;
const INJECT_ESCAPED = '&lt;script&gt;&amp;&quot;&apos;';

// --- helpers ---------------------------------------------------------------------------

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

/** Path of DejaVu Sans Bold (the Linux fallback the width model is calibrated against), or null. */
function findDejaVuBold() {
  try {
    const f = execFileSync('fc-match', ['-f', '%{file}', 'DejaVu Sans:bold'], { encoding: 'utf8' }).trim();
    if (/DejaVuSans-Bold\.ttf$/.test(f) && existsSync(f)) return f;
  } catch {
    // no fontconfig
  }
  for (const f of ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf']) {
    if (existsSync(f)) return f;
  }
  return null;
}
const DEJAVU_BOLD = findDejaVuBold();

let hasXmllint = false;
try {
  execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  hasXmllint = true;
} catch {
  hasXmllint = false;
}

/** Minimal PNG decoder: 8-bit RGBA or RGB, non-interlaced, filter types 0-4. */
function decodePng(buf) {
  assert.ok(pngSize(buf), 'not a PNG');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('latin1');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  assert.ok(ihdr, 'no IHDR');
  assert.equal(ihdr.depth, 8, 'bit depth');
  assert.equal(ihdr.interlace, 0, 'interlace');
  const channels = { 6: 4, 2: 3 }[ihdr.color];
  assert.ok(channels, `unsupported color type ${ihdr.color}`);
  const { width, height } = ihdr;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  assert.equal(raw.length, height * (stride + 1), 'decompressed size');
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = 0; break;
        case 1: v = a; break;
        case 2: v = b; break;
        case 3: v = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad filter ${filter} on row ${y}`);
      }
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

/**
 * Bright (near-white, opaque) pixels outside [left, right): the cards draw text in white;
 * the decorative glows and rings never get this bright.
 */
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

/** Real rendered right edge (px) of `text` alone, via resvg's bounding box. */
function realWidth(text, { size, weight, family = escapeXml(FONT_FAMILY), font }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(size * text.length * 1.5) + 100}" height="${size * 2}">`
    + `<text x="0" y="${size * 1.5}" font-size="${size}" font-weight="${weight}" font-family="${family}">${escapeXml(text)}</text></svg>`;
  const bbox = new Resvg(svg, { font }).getBBox();
  return bbox ? bbox.x + bbox.width : 0;
}

const CALIBRATION_STRINGS = [
  'gitwrapped', 'Weekend Warrior', 'Steady Shipper', 'Friday Deployer', 'Night Owl', 'Early Bird', 'Fixaholic',
  'MMMMWWWW', 'mmmmwwww', 'refactor: move app to main', '0123456789', '9,007,199,254,740,991', '1,234 commits',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '“fix” commits', '“Oops” happened 3 times. We\'ve all been there.',
  'src/cards/svg.js', '+1,234 / −567 lines', 'GITWRAPPED PRESENTS', '%@&#?!', 'Zzz', '…',
];
const WEIGHTS = [600, 700, 800, 900];

const emptyStats = () => computeStats([], { today: TODAY });
function stressStats() {
  const s = emptyStats();
  const big = Number.MAX_SAFE_INTEGER;
  s.totals = { ...s.totals, commits: big, activeDays: 3, firstDay: '1970-01-01', lastDay: '2999-12-31' };
  s.habits = { ...s.habits, peakHour: 3, peakHourLabel: `3 AM ${INJECT}` };
  s.streaks = { longest: { length: 100000, start: '1970-01-01', end: '2243-10-17' }, current: { length: 1, start: 'a', end: 'b' } };
  s.hotFiles = [{ path: `${'deeply/nested/'.repeat(20)}🚀/file name & <stuff>.js`, commits: big, linesAdded: 1, linesRemoved: 1 }];
  s.personality = { archetype: { id: 'x', name: `Night Owl ${INJECT} 🦉 ${'w'.repeat(80)}`, roast: 'r', reason: 'r' }, scores: [] };
  return s;
}
const STRESS_OPTS = { repoName: `${'r'.repeat(150)}${INJECT}🚀${'R'.repeat(140)}`, since: `2020-01-01 ${INJECT}`, author: `Ada ${INJECT}` };

let fixture;
let fixtureStats;
before(async () => {
  fixture = makeFixtureRepo();
  fixtureStats = computeStats(await readCommits(fixture.dir), { today: TODAY });
});
after(() => fixture?.cleanup());

function sink() {
  let data = '';
  return { write(s) { data += s; return true; }, get data() { return data; } };
}
async function runCaptured(argv, opts = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await run(argv, { stdout, stderr, ...opts });
  return { code, stdout: stdout.data, stderr: stderr.data };
}

// --- pngSize / renderPng ---------------------------------------------------------------

describe('pngSize', () => {
  test('reads width/height from IHDR', () => {
    const buf = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(1080, 16);
    buf.writeUInt32BE(1920, 20);
    assert.deepEqual(pngSize(buf), { width: 1080, height: 1920 });
  });

  test('null for non-PNG input', () => {
    assert.equal(pngSize(Buffer.from('<svg/>')), null);
    assert.equal(pngSize(Buffer.alloc(0)), null);
    assert.equal(pngSize(Buffer.from('89504e470d0a1a0a', 'hex')), null, 'signature only');
    assert.equal(pngSize('not a buffer'), null);
    assert.equal(pngSize(null), null);
    const noIhdr = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(noIhdr, 0);
    noIhdr.write('IDAT', 12, 'latin1');
    assert.equal(pngSize(noIhdr), null);
  });

  test('SANS_FAMILY is a non-empty family name', () => {
    assert.equal(typeof SANS_FAMILY, 'string');
    assert.ok(SANS_FAMILY.length > 0);
  });
});

describe('renderPng', () => {
  test('returns a PNG of the requested width (aspect ratio kept)', async (t) => {
    if (!needResvg(t)) return;
    const svg = renderCard({ big: '42', title: 'commits' });
    const buf = await renderPng(svg, { width: 270 });
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(pngSize(buf), { width: 270, height: 480 });
    const img = decodePng(buf);
    assert.equal(img.width, 270);
    // The full-bleed gradient means no transparent pixels.
    for (let i = 3; i < img.pixels.length; i += 4 * 97) assert.equal(img.pixels[i], 255);
  });

  test('without width it keeps the SVG size', async (t) => {
    if (!needResvg(t)) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="#f00"/></svg>';
    const img = decodePng(await renderPng(svg));
    assert.deepEqual([img.width, img.height], [30, 20]);
    assert.deepEqual([...img.pixels.subarray(0, 4)], [255, 0, 0, 255]);
  });

  test('rejects a non-positive / non-integer width', async (t) => {
    if (!needResvg(t)) return;
    for (const width of [0, -5, 1.5, NaN, '100']) {
      await assert.rejects(renderPng('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', { width }), TypeError, String(width));
    }
  });
});

describe('stripEmojiFromText / needsEmojiStrip', () => {
  test('only macOS strips emoji', () => {
    assert.equal(needsEmojiStrip('darwin'), true);
    for (const p of ['linux', 'win32', 'freebsd']) assert.equal(needsEmojiStrip(p), false, p);
    assert.equal(needsEmojiStrip(), process.platform === 'darwin');
  });

  test('removes emoji clusters from text and collapses the whitespace left behind', () => {
    const cases = [
      ['src/🚀 app.js', 'src/ app.js'],
      ['🚀 Ship it 🚀', 'Ship it'],
      ['family 👨‍👩‍👧‍👦 time', 'family time'],
      ['a👍🏽b', 'ab'],
      ['love ❤️ git', 'love git'],
      ['✨ feat: sparkle ✨', 'feat: sparkle'],
      ['tests ✅ pass', 'tests pass'],
      ['done✅', 'done'],
      ['press 1️⃣ #️⃣ now', 'press now'],
      ['from 🇹🇷 and 🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'from and'],
      ['🚀', ''],
      ['plain © ™ → text 1 #', 'plain © ™ → text 1 #'],
    ];
    for (const [input, want] of cases) {
      assert.equal(stripEmojiFromText(`<text x="1">${escapeXml(input)}</text>`), `<text x="1">${escapeXml(want)}</text>`, input);
    }
  });

  test('leaves markup, entities and non-text content alone', () => {
    const svg = '<svg id="🚀"><desc>🚀 desc</desc><text data-x="🚀" fill="#fff">R&amp;D 🚀 &lt;ok&gt;</text><text/><text>x<tspan dy="1">&#x1F680;</tspan> &#38; y</text></svg>';
    assert.equal(
      stripEmojiFromText(svg),
      '<svg id="🚀"><desc>🚀 desc</desc><text data-x="🚀" fill="#fff">R&amp;D &lt;ok&gt;</text><text/><text>x<tspan dy="1"></tspan> &#38; y</text></svg>',
    );
    const card = renderCard({ big: '42', title: 'commits & more' });
    assert.equal(stripEmojiFromText(card), card, 'no emoji: unchanged');
  });

  test('renderPng on darwin renders the stripped SVG', async (t) => {
    if (!needResvg(t)) return;
    const svg = renderShareCard(stressStats(), STRESS_OPTS);
    const [mac, stripped] = await Promise.all([renderPng(svg, { width: 300, platform: 'darwin' }), renderPng(stripEmojiFromText(svg), { width: 300, platform: 'linux' })]);
    const pre = stripEmojiFromText(svg);
    assert.notEqual(pre, svg, 'the stress card has emoji to strip');
    const textOnly = (x) => (x.match(/<text\b[^>]*>[^<]*<\/text>/g) ?? []).join('');
    assert.ok(textOnly(svg).includes('🚀') && !textOnly(pre).includes('🚀'), 'the emoji is gone from the text');
    assert.ok(mac.equals(stripped));
  });
});

// --- width model calibration -----------------------------------------------------------

describe('width model vs real rendering (resvg)', () => {
  test('measureText ≥ real width in DejaVu Sans Bold (the wide Linux fallback)', (t) => {
    if (!needResvg(t)) return;
    if (!DEJAVU_BOLD) return t.skip('DejaVu Sans Bold not installed');
    const font = { loadSystemFonts: false, fontFiles: [DEJAVU_BOLD], defaultFontFamily: 'DejaVu Sans', sansSerifFamily: 'DejaVu Sans' };
    const size = 100;
    for (const s of CALIBRATION_STRINGS) {
      const real = realWidth(s, { size, weight: 800, family: 'DejaVu Sans', font });
      assert.ok(real > 0, `rendered nothing for ${s}`);
      const model = measureText(s, size);
      assert.ok(model >= real, `${JSON.stringify(s)}: model ${model.toFixed(1)} < real ${real.toFixed(1)}`);
      // ...and not wildly wide (layout would waste space).
      assert.ok(model <= real * 1.25 + size * 0.2, `${JSON.stringify(s)}: model ${model.toFixed(1)} ≫ real ${real.toFixed(1)}`);
    }
  });

  test('measureText ≥ real width with the cards\' font stack and system fonts, at every card weight', (t) => {
    if (!needResvg(t)) return;
    // One render for all strings (loading system fonts per render is slow): each string on
    // its own row, black on white; the rightmost dark pixel of a row is its real width.
    const size = 40;
    const rowH = 64;
    const rows = WEIGHTS.flatMap((weight) => CALIBRATION_STRINGS.map((s) => ({ s, weight })));
    const width = Math.ceil(Math.max(...rows.map((r) => measureText(r.s, size))) * 1.5) + 40;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rows.length * rowH}">`,
      `<rect width="${width}" height="${rows.length * rowH}" fill="#fff"/>`,
      `<g fill="#000" font-family="${escapeXml(FONT_FAMILY)}">`,
      ...rows.map((r, i) => `<text x="0" y="${i * rowH + 48}" font-size="${size}" font-weight="${r.weight}">${escapeXml(r.s)}</text>`),
      '</g></svg>',
    ].join('');
    const img = decodePng(Buffer.from(new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: SANS_FAMILY, sansSerifFamily: SANS_FAMILY } }).render().asPng()));
    rows.forEach((r, i) => {
      let real = 0;
      for (let y = i * rowH; y < (i + 1) * rowH; y++) {
        for (let x = img.width - 1; x > real; x--) {
          if (img.pixels[(y * img.width + x) * 4] < 160) {
            real = x + 1;
            break;
          }
        }
      }
      assert.ok(real > 0, `rendered nothing for ${r.s}`);
      const model = measureText(r.s, size);
      // +1: `real` is a whole pixel column (anti-aliased edge rounds up). The model is
      // calibrated to DejaVu Sans Bold (what Linux resolves this stack to); macOS/Windows
      // pick other faces, so there allow the 5% slack the card layout keeps for wrapped
      // text (WRAP_WIDTH). The padding tests below still check real overflow everywhere.
      const slack = process.platform === 'linux' ? 1 : 1 + model * 0.05;
      assert.ok(model + slack >= real,`${JSON.stringify(r.s)} @${r.weight}: model ${model.toFixed(1)} < real ${real}`);
    });
  });
});

describe('rendered PNGs keep text inside the padding', () => {
  // Cards are 1080 wide with 96px side padding; allow a few px for anti-aliasing and
  // glyph overhang.
  const SLACK = 6;
  const bbox = (hits) => hits.reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const check = async (svg, pad, label) => {
    const img = decodePng(await renderPng(svg));
    const outside = (im) => brightOutside(im, pad - SLACK, im.width - pad + SLACK);
    const hits = outside(img);
    if (hits.length === 0) return;
    // Say which <text> overflowed: re-render with only one text element at a time.
    const texts = [...svg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)].map((m) => m[0]);
    const culprits = [];
    for (const keep of texts) {
      const alone = svg.replace(/<text\b[^>]*>[^<]*<\/text>/g, (m) => (m === keep ? m : ''));
      const h = outside(decodePng(await renderPng(alone)));
      if (h.length > 0) culprits.push(`${keep} (${h.length}px, bbox ${bbox(h)})`);
    }
    assert.deepEqual(hits.slice(0, 5), [], `${label}: ${hits.length} bright pixels outside the padding, bbox ${bbox(hits)}; culprits: ${culprits.join(' | ') || 'none alone'}`);
  };

  test('story cards with text fitted to the full content width', async (t) => {
    if (!needResvg(t)) return;
    const cards = [
      ['intro gitwrapped', buildCards(fixtureStats, { repoName: 'gitwrapped' })[0].svg],
      ...buildCards(fixtureStats, { repoName: 'fixture' }).map((c) => [c.id, c.svg]),
      ['big Weekend Warrior', renderCard({ eyebrow: 'Your commit personality', big: 'Weekend Warrior', title: 'Weekends are for touching grass. You touched git instead.' })],
      ['big Friday Deployer', renderCard({ big: 'Friday Deployer', title: 'WWWW MMMM '.repeat(6), subtitle: 'mmmm wwww '.repeat(12) })],
      ['big MMMMWWWW', renderCard({ big: 'MMMMWWWW', lines: [{ label: `Longest: “${'refactor: move app to main '.repeat(3)}”` }, { label: 'WWWWWWWWWWWWWWWWWWWWWWWWW', value: '9,007,199,254' }] })],
      ['big digits', renderCard({ eyebrow: 'W'.repeat(60), big: '9,007,199', footer: `${'w'.repeat(40)} · 2024-03-04 → 2024-03-13` })],
      // Language names starting with "J" (its hook reaches left of the glyph origin).
      ['languages J', buildCards({ languages: { totalLines: 60, totalFiles: 4, basis: 'lines', languages: [
        { name: 'Java', lines: 30, files: 1, share: 50 }, { name: 'JSON', lines: 15, files: 1, share: 25 },
        { name: 'Julia', lines: 10, files: 1, share: 17 }, { name: 'JavaScript', lines: 5, files: 1, share: 8 }] } })[TEAM_IDS.indexOf('languages')].svg],
    ];
    for (const [label, svg] of cards) await check(svg, 96, label);
  });

  test('share card', async (t) => {
    if (!needResvg(t)) return;
    // The stress inputs carry emoji; on macOS renderPng leaves them out (resvg-js 2.6.2
    // misplaces Apple Color Emoji), elsewhere they are rasterized and checked as is.
    for (const [label, svg] of [
      ['fixture', renderShareCard(fixtureStats, { repoName: 'fixture' })],
      ['long', renderShareCard(fixtureStats, { repoName: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', author: 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm@example.com' })],
      ['stress', renderShareCard(stressStats(), STRESS_OPTS)],
    ]) {
      await check(svg, 64, label);
    }
  });
});

// --- share SVG -------------------------------------------------------------------------

describe('share SVG', () => {
  const scenarios = () => [
    ['fixture', renderShareCard(fixtureStats, { repoName: 'fixture' })],
    ['fixture+author+since', renderShareCard(fixtureStats, { repoName: 'fixture', author: 'Ada Lovelace', since: '2024-01-01' })],
    ['empty', renderShareCard(emptyStats(), { repoName: 'empty-repo' })],
    ['no args', renderShareCard()],
    ['null', renderShareCard(null)],
    ['{}', renderShareCard({})],
    ['stress', renderShareCard(stressStats(), STRESS_OPTS)],
    ['raw empty', renderShareSvg()],
    ['raw junk', renderShareSvg({ theme: 'nope', tiles: [null, {}, { label: null, value: undefined }], file: { path: '' }, note: null, footer: null })],
  ];

  test('1200x630 root with viewBox', () => {
    for (const [name, svg] of scenarios()) {
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630" viewBox="0 0 1200 630"/, name);
    }
  });

  test('no null / undefined / NaN / [object Object] in the output', () => {
    for (const [name, svg] of scenarios()) {
      const textOnly = svg.replace(/<[^>]*>/g, ' ');
      for (const bad of ['null', 'undefined', 'NaN', '[object Object]']) assert.ok(!textOnly.includes(bad), `${name}: ${bad}`);
      for (const m of svg.matchAll(/="([^"]*)"/g)) assert.ok(!/\b(?:NaN|undefined|null|Infinity)\b/.test(m[1]), `${name}: attr ${m[1]}`);
    }
  });

  test('every id is prefixed gw-share-', () => {
    for (const [name, svg] of scenarios()) {
      const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
      assert.ok(ids.length > 0, name);
      for (const id of ids) assert.ok(id.startsWith('gw-share-'), `${name}: ${id}`);
      for (const m of svg.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.includes(m[1]), `${name}: dangling url(#${m[1]})`);
    }
  });

  test('user text is escaped', () => {
    const svg = renderShareCard(fixtureStats, { repoName: `my${INJECT}repo`, author: `Ada ${INJECT}` });
    assert.ok(!/<script/i.test(svg));
    assert.ok(!svg.includes(INJECT));
    assert.ok(svg.includes(`my${INJECT_ESCAPED}repo`));
    const stress = renderShareCard(stressStats(), STRESS_OPTS);
    assert.ok(!/<script/i.test(stress));
    assert.ok(!stress.includes(INJECT));
  });

  test('shows the fixture numbers', () => {
    const svg = renderShareCard(fixtureStats, { repoName: 'fixture' });
    const textOnly = svg.replace(/<[^>]*>/g, ' ');
    assert.ok(textOnly.includes('fixture'));
    assert.ok(/>8</.test(svg), 'commit count');
    assert.ok(textOnly.includes('src/app.js'), 'hottest file');
  });

  test('well-formed XML (xmllint)', (t) => {
    if (!hasXmllint) return t.skip('xmllint not installed');
    for (const [name, svg] of scenarios()) {
      try {
        execFileSync('xmllint', ['--noout', '-'], { input: svg, stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (err) {
        assert.fail(`${name}: ${err.stderr}`);
      }
    }
  });

  test('deterministic', () => {
    assert.equal(renderShareCard(fixtureStats, { repoName: 'x' }), renderShareCard(fixtureStats, { repoName: 'x' }));
  });
});

// --- CLI PNG paths ---------------------------------------------------------------------

describe('CLI PNG export', () => {
  let out;
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'gw-png-'));
  });
  after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
  const svgFiles = TEAM_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`);

  test('renderer unavailable → SVG + HTML still written, exit 0, "PNG export skipped" on stderr', async () => {
    const dest = join(out, 'missing');
    const missing = async () => {
      throw new Error('could not load @resvg/resvg-js (simulated)\nsecond line');
    };
    const r = await runCaptured([fixture.dir, '--out', dest], { today: TODAY, renderPng: missing });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, 'gitwrapped: PNG export skipped: could not load @resvg/resvg-js (simulated)\n');
    assert.deepEqual(readdirSync(join(dest, 'cards')).sort(), svgFiles);
    assert.ok(existsSync(join(dest, 'wrapped.html')));
    assert.ok(existsSync(join(dest, 'share.svg')));
    assert.equal(existsSync(join(dest, 'png')), false);
    assert.equal(existsSync(join(dest, 'share.png')), false);
    assert.ok(r.stdout.includes(`share image: ${join(dest, 'share.svg')}`), r.stdout);
    assert.ok(!r.stdout.includes('PNGs in'), r.stdout);
  });

  test('renderer failing midway → no partial PNG set', async () => {
    const dest = join(out, 'midway');
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls > 3) throw new Error('boom');
      return Buffer.from('89504e470d0a1a0a', 'hex');
    };
    const r = await runCaptured([fixture.dir, '--out', dest], { today: TODAY, renderPng: flaky });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /PNG export skipped: boom/);
    assert.equal(existsSync(join(dest, 'png')), false);
    assert.equal(existsSync(join(dest, 'share.png')), false);
    assert.ok(existsSync(join(dest, 'wrapped.html')));
  });

  test('--no-png never calls the renderer and writes no png/', async () => {
    const dest = join(out, 'nopng');
    let calls = 0;
    const spy = async () => {
      calls += 1;
      return Buffer.alloc(0);
    };
    const r = await runCaptured([fixture.dir, '--out', dest, '--no-png'], { today: TODAY, renderPng: spy });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.equal(calls, 0);
    assert.equal(existsSync(join(dest, 'png')), false);
    assert.equal(existsSync(join(dest, 'share.png')), false);
    assert.deepEqual(readdirSync(join(dest, 'cards')).sort(), svgFiles);
  });

  test('injected renderer gets every card at 1080 and the share card at 1200', async () => {
    const dest = join(out, 'spy');
    const seen = [];
    const spy = async (svg, { width }) => {
      seen.push([width, /width="(\d+)" height="(\d+)"/.exec(svg).slice(1).join('x')]);
      return Buffer.from('89504e470d0a1a0a', 'hex');
    };
    const r = await runCaptured([fixture.dir, '--out', dest], { today: TODAY, renderPng: spy });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(seen, [...TEAM_IDS.map(() => [1080, '1080x1920']), [1200, '1200x630']]);
    assert.deepEqual(readdirSync(join(dest, 'png')).sort(), svgFiles.map((f) => f.replace(/\.svg$/, '.png')));
    assert.ok(existsSync(join(dest, 'share.png')));
    assert.ok(r.stdout.includes(`${TEAM_IDS.length} PNGs in ${join(dest, 'png')}`), r.stdout);
  });
});
