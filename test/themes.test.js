// --theme sanity checks: the color-theme tables, contrast, default byte-identity and CLI parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendHex, COLOR_THEMES, COLOR_THEME_NAMES, contrastRatio, GRADIENT_NAMES } from '../src/cards/themes.js';
import { buildCards, renderShareCard } from '../src/cards/index.js';
import { buildViewerHtml, cspFor, CSP } from '../src/viewer.js';
import { parseCli } from '../src/cli.js';

test('contrastRatio matches the WCAG reference values', () => {
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrastRatio('#ffffff', '#767676') - 4.54) < 0.01);
});

test('every theme defines every gradient name', () => {
  assert.deepEqual(COLOR_THEME_NAMES, ['default', 'mono', 'neon']);
  for (const name of COLOR_THEME_NAMES) assert.deepEqual(Object.keys(COLOR_THEMES[name].gradients), [...GRADIENT_NAMES], name);
});

test('mono and neon: white text ≥ 4.5:1 on every stop, also under panels and glows', () => {
  for (const name of ['mono', 'neon']) {
    const t = COLOR_THEMES[name];
    for (const op of [t.glowOpacity?.card ?? 0.55, t.glowOpacity?.share ?? 0.5]) {
      for (const [g, { stops, glow }] of Object.entries(t.gradients)) {
        for (const s of stops) {
          const lit = blendHex(glow, s, op);
          for (const bg of [s, blendHex('#ffffff', s, 0.14), lit, blendHex('#ffffff', lit, 0.14)]) {
            assert.ok(contrastRatio('#ffffff', bg) >= 4.5, `${name}/${g} ${s} → ${bg}`);
          }
        }
      }
    }
  }
});

const stats = { totals: { commits: 3, activeDays: 2, firstDay: '2026-01-01', lastDay: '2026-01-02' } };

test("'default' is byte-identical to no theme; others change colors only", () => {
  const base = buildCards(stats, { today: '2026-01-02' });
  assert.deepEqual(buildCards(stats, { today: '2026-01-02', colorTheme: 'default' }), base);
  assert.equal(renderShareCard(stats, { colorTheme: 'default' }), renderShareCard(stats, {}));
  assert.equal(buildViewerHtml(base, { colorTheme: 'default' }), buildViewerHtml(base));
  assert.equal(cspFor('en', 'default'), CSP);
  const strip = (s) => s.replace(/#[0-9a-f]{6}/g, '#').replace(/stop-opacity="[\d.]+"/g, '');
  for (const name of ['mono', 'neon']) {
    const cards = buildCards(stats, { today: '2026-01-02', colorTheme: name });
    cards.forEach((c, i) => {
      assert.notEqual(c.svg, base[i].svg);
      assert.equal(strip(c.svg), strip(base[i].svg), `${name} ${c.id}`);
    });
    const share = renderShareCard(stats, { colorTheme: name });
    assert.equal(strip(share), strip(renderShareCard(stats, {})));
    assert.notEqual(cspFor('en', name), CSP);
    assert.ok(buildViewerHtml(cards, { colorTheme: name }).includes(`--bg:${COLOR_THEMES[name].viewer.bg};`));
  }
});

test('--theme parsing', () => {
  assert.equal(parseCli(['--theme', 'mono']).theme, 'mono');
  assert.equal(parseCli(['--theme=NEON']).theme, 'neon');
  assert.equal('theme' in parseCli(['--theme', 'default']), false);
  assert.equal('theme' in parseCli([]), false);
  assert.throws(() => parseCli(['--theme', 'pulse']), /invalid --theme "pulse": expected one of default, mono, neon/);
  assert.throws(() => parseCli(['--theme', ' ']), /--theme requires a non-empty value/);
});
