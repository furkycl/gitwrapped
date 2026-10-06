// --theme, in depth: CLI parsing, layout invariance across color themes (only colors may
// differ), default byte-identity, WCAG contrast of mono / neon, theme colors in the SVG
// output, the themed viewer's CSP, and end-to-end generate() / run() with a theme.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blendHex,
  buildCards,
  CARD_IDS, cardIdsFor,
  COLOR_THEME_NAMES,
  COLOR_THEMES,
  contrastRatio,
  getColorTheme,
  GRADIENT_NAMES,
  isColorTheme,
  relativeLuminance,
  renderCard,
  renderShareCard,
  THEMES,
} from '../src/cards/index.js';
import { parseHex } from '../src/cards/themes.js';
import { computeStats } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { buildViewerHtml, CSP, cspFor } from '../src/viewer.js';
import { generate, HELP_TEXT, parseCli, run } from '../src/cli.js';
import { loadResvg, pngSize, renderPng } from '../src/png.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

// The full card set of a team whose commits fall in one calendar month (the fixtures):
// every card but the monthly timeline (see cardIdsFor).
const TEAM_IDS = cardIdsFor({ contributors: { total: 2 } });

const TODAY = '2024-03-14';
const OTHER = ['mono', 'neon'];
const WHITE = '#ffffff';

function sink() {
  let data = '';
  return {
    write(s) {
      data += s;
      return true;
    },
    get data() {
      return data;
    },
  };
}

async function runCaptured(argv, opts = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await run(argv, { stdout, stderr, env: {}, ...opts });
  return { code, stdout: stdout.data, stderr: stderr.data };
}

/** `svg` with every color and opacity value blanked: what is left is the layout. */
const normalize = (svg) =>
  svg
    .replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, '#COLOR')
    .replace(/rgba?\([^)]*\)/g, 'rgba(COLOR)')
    .replace(/(stop-opacity|fill-opacity|opacity)="[\d.]+"/g, '$1="O"');

const hexColors = (s) => [...new Set(s.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [])].map((c) => c.toLowerCase());
const isGray = (hex) => {
  const [r, g, b] = parseHex(hex);
  return r === g && g === b;
};
const sha = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const inline = (page, tag) => [...page.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
function cspOf(page) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
  assert.ok(m, 'CSP meta present');
  return m[1];
}

let fixture;
let fixtureStats;
const tmps = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
};
before(async () => {
  fixture = makeFixtureRepo();
  fixtureStats = computeStats(await readCommits(fixture.dir), { today: TODAY });
});
after(() => {
  fixture?.cleanup();
  for (const d of tmps) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

// ---------------------------------------------------------------------------------------
describe('CLI: --theme', () => {
  test('valid names, case-insensitive and trimmed; default is omitted', () => {
    assert.equal(parseCli(['--theme', 'mono']).theme, 'mono');
    assert.equal(parseCli(['--theme', 'neon']).theme, 'neon');
    assert.equal(parseCli(['--theme', 'MONO']).theme, 'mono');
    assert.equal(parseCli(['--theme', ' neon ']).theme, 'neon');
    assert.equal(parseCli(['--theme=Neon']).theme, 'neon');
    assert.equal('theme' in parseCli(['--theme', 'default']), false);
    assert.equal('theme' in parseCli(['--theme', ' DEFAULT ']), false);
    assert.equal('theme' in parseCli([]), false);
    // Other options are unaffected.
    const o = parseCli(['--theme', 'mono', '--lang', 'tr', '--no-png', 'repo']);
    assert.equal(o.lang, 'tr');
    assert.equal(o.png, false);
    assert.equal(o.path, 'repo');
  });

  test('last --theme wins', () => {
    assert.equal(parseCli(['--theme', 'mono', '--theme', 'neon']).theme, 'neon');
  });

  test('invalid names list every valid theme', () => {
    for (const bad of ['pulse', 'dark', 'toString', '__proto__', 'mono2', 'neon,mono']) {
      assert.throws(() => parseCli(['--theme', bad]), (err) => {
        assert.match(err.message, /invalid --theme/);
        for (const n of COLOR_THEME_NAMES) assert.ok(err.message.includes(n), `${bad}: lists ${n}`);
        return true;
      });
    }
  });

  test('empty value and missing value are errors', () => {
    assert.throws(() => parseCli(['--theme', '']), /--theme requires a non-empty value/);
    assert.throws(() => parseCli(['--theme=']), /--theme requires a non-empty value/);
    assert.throws(() => parseCli(['--theme', '   ']), /--theme requires a non-empty value/);
    assert.throws(() => parseCli(['--theme']));
  });

  test('run(): invalid theme exits 2 with a usage hint, nothing generated', async () => {
    const r = await runCaptured(['--theme', 'rainbow', fixture.dir, '--out', join(tmp('gw-theme-bad-'), 'o')]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /gitwrapped: invalid --theme "rainbow": expected one of default, mono, neon/);
    assert.match(r.stderr, /--help/);
    assert.equal(r.stdout, '');
    const e = await runCaptured(['--theme', '']);
    assert.equal(e.code, 2);
    assert.match(e.stderr, /--theme requires a non-empty value/);
  });

  test('--help documents --theme and every theme name', () => {
    assert.match(HELP_TEXT, /--theme <name>/);
    for (const n of COLOR_THEME_NAMES) assert.match(HELP_TEXT, new RegExp(`\\b${n}\\b`));
  });
});

// ---------------------------------------------------------------------------------------
describe('themes.js API', () => {
  test('names, lookups, fallbacks', () => {
    assert.deepEqual([...COLOR_THEME_NAMES], ['default', 'mono', 'neon']);
    for (const n of COLOR_THEME_NAMES) assert.equal(isColorTheme(n), true);
    for (const n of ['MONO', 'pulse', 'toString', 'constructor', '', null, undefined, 1]) assert.equal(isColorTheme(n), false, String(n));
    assert.equal(getColorTheme('nope'), COLOR_THEMES.default);
    assert.equal(getColorTheme(undefined), COLOR_THEMES.default);
    assert.equal(getColorTheme('toString'), COLOR_THEMES.default);
    assert.equal(COLOR_THEMES.default.gradients, THEMES, 'svg.js THEMES is the default gradient set');
  });

  test('every theme defines every gradient with 3 valid hex stops, glow and angle', () => {
    for (const n of COLOR_THEME_NAMES) {
      const t = COLOR_THEMES[n];
      assert.deepEqual(Object.keys(t.gradients), [...GRADIENT_NAMES]);
      for (const [g, grad] of Object.entries(t.gradients)) {
        assert.equal(grad.stops.length, 3, `${n}/${g}`);
        for (const c of [...grad.stops, grad.glow, ...(grad.accent ? [grad.accent] : [])]) assert.match(c, /^#[0-9a-f]{6}$/, `${n}/${g}`);
        // Same angle per gradient name as default: the layout (gradient direction) never changes.
        assert.equal(grad.angle, COLOR_THEMES.default.gradients[g].angle, `${n}/${g} angle`);
      }
      for (const k of ['bg', 'muted', 'focus', 'dialog', 'glowCenter', 'glowCorner', 'glowTop', 'halo']) assert.ok(t.viewer[k], `${n} viewer.${k}`);
    }
  });

  test('tables are frozen', () => {
    assert.ok(Object.isFrozen(COLOR_THEMES));
    for (const n of COLOR_THEME_NAMES) {
      assert.ok(Object.isFrozen(COLOR_THEMES[n]));
      assert.ok(Object.isFrozen(COLOR_THEMES[n].gradients));
      for (const g of Object.values(COLOR_THEMES[n].gradients)) assert.ok(Object.isFrozen(g.stops));
    }
  });

  test('helpers: luminance, contrast, blend', () => {
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(relativeLuminance('#ffffff'), 1);
    assert.equal(relativeLuminance('#fff'), 1);
    assert.equal(contrastRatio('#000', '#fff'), 21);
    assert.equal(contrastRatio('#123456', '#abcdef'), contrastRatio('#abcdef', '#123456'));
    assert.equal(blendHex('#ffffff', '#000000', 0), '#000000');
    assert.equal(blendHex('#ffffff', '#000000', 1), '#ffffff');
    assert.equal(blendHex('#ffffff', '#000000', 0.5), '#808080');
    assert.throws(() => parseHex('red'));
    assert.throws(() => parseHex('#12345'));
  });
});

// ---------------------------------------------------------------------------------------
describe('contrast: mono and neon keep white text readable', () => {
  for (const name of OTHER) {
    const t = COLOR_THEMES[name];
    const peaks = { card: t.glowOpacity?.card ?? 0.55, share: t.glowOpacity?.share ?? 0.5 };

    test(`${name}: white ≥ 4.5:1 on every stop, under the 14% panel, under glows at peak`, () => {
      for (const [g, { stops, glow }] of Object.entries(t.gradients)) {
        for (const s of stops) {
          const backgrounds = [s, blendHex(WHITE, s, 0.14)];
          for (const op of Object.values(peaks)) {
            const lit = blendHex(glow, s, op);
            backgrounds.push(lit, blendHex(WHITE, lit, 0.14));
          }
          for (const bg of backgrounds) {
            const r = contrastRatio(WHITE, bg);
            assert.ok(r >= 4.5, `${name}/${g}: stop ${s} → ${bg} is ${r.toFixed(2)}:1`);
          }
        }
      }
    });

    test(`${name}: white ≥ 4.5:1 on the viewer bg and dialog; muted text ≥ 4.5:1 on bg`, () => {
      assert.ok(contrastRatio(WHITE, t.viewer.bg) >= 4.5);
      assert.ok(contrastRatio(WHITE, t.viewer.dialog) >= 4.5);
      assert.ok(contrastRatio(t.viewer.muted, t.viewer.bg) >= 4.5);
      assert.ok(contrastRatio(t.viewer.focus, t.viewer.bg) >= 3, 'focus ring ≥ 3:1 (non-text contrast)');
    });
  }

  test('mono gradients are grayscale (r = g = b), glows and stops alike, no accent', () => {
    for (const [g, grad] of Object.entries(COLOR_THEMES.mono.gradients)) {
      for (const c of [...grad.stops, grad.glow]) assert.ok(isGray(c), `mono/${g} ${c}`);
      assert.equal(grad.accent, undefined);
    }
    for (const k of ['bg', 'muted', 'focus', 'dialog']) assert.ok(isGray(COLOR_THEMES.mono.viewer[k]), `mono viewer.${k}`);
  });

  test('neon stops are dark (luminance < 0.05) and its glows / accents vivid', () => {
    for (const [g, grad] of Object.entries(COLOR_THEMES.neon.gradients)) {
      for (const s of grad.stops) assert.ok(relativeLuminance(s) < 0.05, `neon/${g} ${s}`);
      assert.ok(grad.accent, `neon/${g} has an accent`);
      // Vivid: the accent bar stands out from the darkest-to-lightest stop.
      for (const s of grad.stops) assert.ok(contrastRatio(grad.accent, s) >= 3, `neon/${g} accent on ${s}`);
      const [r, gg, b] = parseHex(grad.glow);
      assert.ok(Math.max(r, gg, b) - Math.min(r, gg, b) >= 150, `neon/${g} glow is saturated`);
    }
  });

  test('neon dims its glows below the default peaks', () => {
    assert.ok(COLOR_THEMES.neon.glowOpacity.card < 0.55);
    assert.ok(COLOR_THEMES.neon.glowOpacity.share < 0.5);
    assert.equal(COLOR_THEMES.default.glowOpacity, null);
  });
});

// ---------------------------------------------------------------------------------------
describe('layout invariance: only colors differ between themes', () => {
  const variants = [
    ['fixture (team, en)', () => fixtureStats, { repoName: 'demo', today: TODAY }],
    ['fixture (team, tr)', () => fixtureStats, { repoName: 'demo', today: TODAY, lang: 'tr' }],
    ['fixture with window + author', () => fixtureStats, { repoName: 'demo', today: TODAY, since: '2024-01-01', until: '2024-03-01', author: 'x@y.z' }],
    ['empty stats', () => computeStats([], { today: TODAY }), { today: TODAY }],
    ['null stats', () => null, {}],
  ];

  test('the fixture triggers the contributors card (team case)', () => {
    assert.deepEqual(buildCards(fixtureStats, { today: TODAY }).map((c) => c.id), [...TEAM_IDS]);
  });

  for (const [label, statsOf, opts] of variants) {
    test(`${label}: every card and the share card`, () => {
      const stats = statsOf();
      const base = buildCards(stats, opts);
      const baseShare = renderShareCard(stats, opts);
      for (const name of OTHER) {
        const cards = buildCards(stats, { ...opts, colorTheme: name });
        assert.deepEqual(cards.map((c) => c.id), base.map((c) => c.id), `${name}: same card set`);
        cards.forEach((c, i) => {
          assert.notEqual(c.svg, base[i].svg, `${name}/${c.id} changed`);
          assert.equal(normalize(c.svg), normalize(base[i].svg), `${name}/${c.id}: layout differs`);
          assert.equal(c.svg.length > 0, true);
        });
        const share = renderShareCard(stats, { ...opts, colorTheme: name });
        assert.notEqual(share, baseShare);
        assert.equal(normalize(share), normalize(baseShare), `${name}/share: layout differs`);
      }
    });
  }

  test('renderCard: every gradient name in every theme keeps the layout', () => {
    const spec = { eyebrow: 'Eyebrow', title: 'A title', big: '1,234', subtitle: 'sub', footer: 'foot', number: '03' };
    for (const g of GRADIENT_NAMES) {
      const base = renderCard({ ...spec, theme: g });
      for (const name of OTHER) {
        const svg = renderCard({ ...spec, theme: g, colorTheme: name });
        assert.equal(normalize(svg), normalize(base), `${name}/${g}`);
        for (const s of COLOR_THEMES[name].gradients[g].stops) assert.ok(svg.includes(`stop-color="${s}"`), `${name}/${g} uses ${s}`);
      }
    }
  });

  test('unknown colorTheme falls back to default output', () => {
    const base = buildCards(fixtureStats, { today: TODAY });
    for (const bad of ['MONO', 'pulse', 'toString', 42, null]) {
      assert.deepEqual(buildCards(fixtureStats, { today: TODAY, colorTheme: bad }), base, String(bad));
      assert.equal(renderShareCard(fixtureStats, { today: TODAY, colorTheme: bad }), renderShareCard(fixtureStats, { today: TODAY }));
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('default byte-identity', () => {
  for (const lang of ['en', 'tr']) {
    test(`${lang}: no theme ≡ 'default' for cards, share and viewer`, () => {
      const opts = { repoName: 'demo', today: TODAY, lang };
      const base = buildCards(fixtureStats, opts);
      const def = buildCards(fixtureStats, { ...opts, colorTheme: 'default' });
      assert.deepEqual(def, base);
      assert.equal(renderShareCard(fixtureStats, { ...opts, colorTheme: 'default' }), renderShareCard(fixtureStats, opts));
      assert.equal(buildViewerHtml(def, { title: 't', lang, colorTheme: 'default' }), buildViewerHtml(base, { title: 't', lang }));
      assert.equal(cspFor(lang, 'default'), cspFor(lang));
    });
  }

  test("CSP export is the en/default page's", () => {
    assert.equal(cspFor('en', 'default'), CSP);
    assert.equal(cspFor(), CSP);
  });

  test('default cards still carry the original pulse gradient and full-opacity glows', () => {
    const svg = buildCards(fixtureStats, { today: TODAY })[0].svg;
    assert.ok(svg.includes('stop-color="#ff3d77"'));
    assert.ok(svg.includes('stop-opacity="0.55"'));
    assert.ok(renderShareCard(fixtureStats, { today: TODAY }).includes('stop-opacity="0.5"'));
    assert.ok(svg.includes('rx="5" fill="#ffffff"'), 'white accent bar');
  });
});

// ---------------------------------------------------------------------------------------
describe('theme colors in the SVG output', () => {
  test('mono: no hex color other than grays (white included)', () => {
    const cards = buildCards(fixtureStats, { today: TODAY, colorTheme: 'mono' });
    const share = renderShareCard(fixtureStats, { today: TODAY, colorTheme: 'mono' });
    for (const svg of [...cards.map((c) => c.svg), share]) {
      const colors = hexColors(svg);
      assert.ok(colors.length > 1);
      for (const c of colors) assert.ok(isGray(c), `non-gray ${c}`);
      assert.doesNotMatch(svg, /rgba?\(/);
    }
  });

  test('neon: each card uses its gradient stops, glow, accent bar and dimmed glow opacity', () => {
    const cards = buildCards(fixtureStats, { today: TODAY, colorTheme: 'neon' });
    const defaults = new Set(Object.values(COLOR_THEMES.default.gradients).flatMap((g) => [...g.stops, g.glow]));
    for (const { id, svg } of cards) {
      // Which gradient: the one whose first stop appears.
      const g = Object.values(COLOR_THEMES.neon.gradients).find((x) => svg.includes(`stop-color="${x.stops[0]}"`));
      assert.ok(g, `${id}: uses a neon gradient`);
      for (const s of g.stops) assert.ok(svg.includes(`stop-color="${s}"`), `${id} stop ${s}`);
      assert.ok(svg.includes(`stop-color="${g.glow}" stop-opacity="${COLOR_THEMES.neon.glowOpacity.card}"`), `${id} glow`);
      assert.ok(svg.includes(`fill="${g.accent}"`), `${id} accent`);
      for (const c of hexColors(svg)) assert.ok(!defaults.has(c), `${id} leaks default color ${c}`);
    }
    const share = renderShareCard(fixtureStats, { today: TODAY, colorTheme: 'neon' });
    const p = COLOR_THEMES.neon.gradients.pulse;
    for (const s of p.stops) assert.ok(share.includes(`stop-color="${s}"`));
    assert.ok(share.includes(`stop-color="${p.glow}" stop-opacity="${COLOR_THEMES.neon.glowOpacity.share}"`));
    assert.ok(share.includes(`fill="${p.accent}"`));
  });

  test('cards of one theme use the same gradient name as the default (per card id)', () => {
    const def = buildCards(fixtureStats, { today: TODAY });
    for (const name of OTHER) {
      const cards = buildCards(fixtureStats, { today: TODAY, colorTheme: name });
      cards.forEach((c, i) => {
        const g = GRADIENT_NAMES.find((n) => def[i].svg.includes(`stop-color="${COLOR_THEMES.default.gradients[n].stops[0]}"`));
        assert.ok(g);
        assert.ok(c.svg.includes(`stop-color="${COLOR_THEMES[name].gradients[g].stops[1]}"`), `${name}/${c.id} → ${g}`);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('viewer under each theme', () => {
  for (const lang of ['en', 'tr']) {
    for (const name of COLOR_THEME_NAMES) {
      test(`${lang}/${name}: theme colors in CSS, style + script hashes in CSP`, () => {
        const cards = buildCards(fixtureStats, { today: TODAY, lang, colorTheme: name });
        const page = buildViewerHtml(cards, { title: 'gw', lang, colorTheme: name });
        const v = COLOR_THEMES[name].viewer;
        const styles = inline(page, 'style');
        const scripts = inline(page, 'script');
        assert.equal(styles.length, 1);
        assert.equal(scripts.length, 1);
        const css = styles[0];
        assert.ok(css.includes(`--bg:${v.bg};`));
        assert.ok(css.includes(`--muted:${v.muted};`));
        assert.ok(css.includes(`--focus:${v.focus};`));
        assert.ok(css.includes(`background:${v.dialog};`));
        for (const k of ['glowCenter', 'glowCorner', 'glowTop', 'halo']) assert.ok(css.includes(v[k]), `${k}`);
        const csp = cspOf(page);
        assert.equal(csp, cspFor(lang, name));
        assert.ok(csp.includes(`style-src ${sha(css)};`), 'style hash');
        assert.ok(csp.includes(`script-src ${sha(scripts[0])};`), 'script hash');
        assert.ok(page.includes(`<html lang="${lang}"`));
        // The embedded cards are the themed ones.
        for (const c of cards) assert.ok(page.includes(c.svg.match(/<linearGradient[^>]*>[\s\S]*?<\/linearGradient>/)[0]), c.id);
      });
    }
  }

  test('mono / neon CSS carries no default viewer colors; themes differ in CSP style only', () => {
    const def = COLOR_THEMES.default.viewer;
    for (const name of OTHER) {
      const css = inline(buildViewerHtml([], { colorTheme: name }), 'style')[0];
      for (const k of ['bg', 'muted', 'focus', 'dialog', 'glowCenter', 'glowCorner', 'glowTop', 'halo']) assert.ok(!css.includes(def[k]), `${name} leaks default ${k}`);
      const parts = (c) => Object.fromEntries(c.split('; ').map((d) => [d.split(' ')[0], d]));
      const a = parts(cspFor('en', name));
      const b = parts(CSP);
      assert.notEqual(a['style-src'], b['style-src']);
      assert.equal(a['script-src'], b['script-src']);
    }
  });

  test('CSS of themes differs only in colors', () => {
    const css = (n) => inline(buildViewerHtml([], { colorTheme: n }), 'style')[0];
    for (const name of OTHER) assert.equal(normalize(css(name)), normalize(css('default')));
  });

  test('unknown colorTheme → default page', () => {
    assert.equal(buildViewerHtml([], { colorTheme: 'bogus' }), buildViewerHtml([]));
    assert.equal(cspFor('en', 'bogus'), CSP);
  });
});

// ---------------------------------------------------------------------------------------
describe('end to end', () => {
  test('generate({theme: neon}) writes neon cards, share, viewer and passes them to the PNG renderer', async () => {
    const out = tmp('gw-theme-neon-');
    const seen = [];
    const fakePng = async (svg, { width }) => {
      seen.push({ svg, width });
      return Buffer.from('89504e470d0a1a0a', 'hex');
    };
    const r = await generate({ path: fixture.dir, out, theme: 'neon' }, { today: TODAY, renderPng: fakePng });
    const neon = COLOR_THEMES.neon.gradients;
    assert.equal(r.cardFiles.length, TEAM_IDS.length);
    for (const f of r.cardFiles) {
      const svg = readFileSync(f, 'utf8');
      assert.ok(Object.values(neon).some((g) => svg.includes(`stop-color="${g.stops[0]}"`)), f);
    }
    assert.ok(readFileSync(r.shareSvg, 'utf8').includes(`stop-color="${neon.pulse.stops[0]}"`));
    assert.ok(readFileSync(r.html, 'utf8').includes(`--bg:${COLOR_THEMES.neon.viewer.bg};`));
    assert.equal(seen.length, TEAM_IDS.length + 1);
    for (const { svg } of seen) assert.ok(Object.values(neon).some((g) => svg.includes(`stop-color="${g.stops[0]}"`)));
  });

  test('run --theme MONO --no-png: mono output on disk', async () => {
    const out = join(tmp('gw-theme-run-'), 'o');
    const r = await runCaptured([fixture.dir, '--theme', ' MONO ', '--no-png', '--out', out], { today: TODAY });
    assert.equal(r.code, 0, r.stderr);
    const files = readdirSync(join(out, 'cards'));
    assert.equal(files.length, TEAM_IDS.length);
    for (const f of files) for (const c of hexColors(readFileSync(join(out, 'cards', f), 'utf8'))) assert.ok(isGray(c), `${f}: ${c}`);
    assert.ok(readFileSync(join(out, 'wrapped.html'), 'utf8').includes(`--bg:${COLOR_THEMES.mono.viewer.bg};`));
  });

  test('default run and --theme default produce identical files', async () => {
    const a = tmp('gw-theme-defa-');
    const b = tmp('gw-theme-defb-');
    await generate({ path: fixture.dir, out: a, png: false }, { today: TODAY });
    await generate({ path: fixture.dir, out: b, png: false, theme: 'default' }, { today: TODAY });
    for (const f of ['wrapped.html', 'share.svg', ...readdirSync(join(a, 'cards')).map((x) => join('cards', x))]) {
      assert.equal(readFileSync(join(b, f), 'utf8'), readFileSync(join(a, f), 'utf8'), f);
    }
  });

  test('stats.json is identical across themes', async () => {
    const outs = {};
    for (const name of COLOR_THEME_NAMES) {
      outs[name] = tmp(`gw-theme-json-${name}-`);
      await generate({ path: fixture.dir, out: outs[name], png: false, json: true, theme: name }, { today: TODAY });
    }
    const base = readFileSync(join(outs.default, 'stats.json'), 'utf8');
    assert.ok(base.length > 10);
    for (const name of OTHER) assert.equal(readFileSync(join(outs[name], 'stats.json'), 'utf8'), base, name);
  });

  test('real PNG render of a mono card and the mono share image', async (t) => {
    try {
      await loadResvg();
    } catch (err) {
      t.skip(`resvg unavailable: ${err.message}`);
      return;
    }
    const card = buildCards(fixtureStats, { today: TODAY, colorTheme: 'mono' })[0].svg;
    const png = await renderPng(card, { width: 270 });
    assert.deepEqual(pngSize(png), { width: 270, height: 480 });
    const share = await renderPng(renderShareCard(fixtureStats, { today: TODAY, colorTheme: 'mono' }), { width: 300 });
    assert.equal(pngSize(share).width, 300);
  });
});
