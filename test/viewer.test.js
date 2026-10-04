import { test, describe } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildCards, CARD_IDS } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { AUTO_ADVANCE_MS, CSP, buildViewerHtml, cspHash, escapeHtml, svgTitle } from '../src/viewer.js';

const cards = buildCards(computeStats([], { today: '2024-03-14' }), { repoName: 'demo' });

describe('buildViewerHtml', () => {
  const html = buildViewerHtml(cards, { title: 'gitwrapped · demo' });

  test('is a complete HTML5 document', () => {
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>gitwrapped · demo<\/title>/);
    assert.match(html, /<\/html>\n$/);
  });

  test('makes no external requests', () => {
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org\/2000\/svg")/);
    assert.doesNotMatch(html, /<(link|img|iframe)\b/i);
    assert.doesNotMatch(html, /\bsrc=/);
    assert.doesNotMatch(html, /@import|url\((?!#)/);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  });

  test('inlines every card SVG in order, first one active', () => {
    let pos = 0;
    for (const { svg } of cards) {
      const at = html.indexOf(svg.trim(), pos);
      assert.ok(at > pos, 'card svg inlined in order');
      pos = at;
    }
    const slides = [...html.matchAll(/<section class="slide( active)?" id="card-(\d+)" data-card="([^"]+)"/g)];
    assert.deepEqual(slides.map((m) => m[3]), CARD_IDS);
    assert.deepEqual(slides.map((m) => Boolean(m[1])), CARD_IDS.map((_, i) => i === 0));
    assert.equal((html.match(/class="bar[ "]/g) ?? []).length, CARD_IDS.length);
  });

  test('accessible: labelled SVGs, nav buttons, live status', () => {
    assert.equal((html.match(/<svg\b[^>]*role="img"[^>]*aria-label="[^"]+"/g) ?? []).length, CARD_IDS.length);
    assert.match(html, /<button type="button" class="nav prev" id="prev" aria-label="Previous card">/);
    assert.match(html, /<button type="button" class="nav next" id="next" aria-label="Next card">/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /:focus-visible/);
    assert.match(html, /prefers-reduced-motion/);
  });

  test('hides inactive cards without display:none', () => {
    assert.match(html, /\.slide\{[^}]*visibility:hidden/);
    assert.doesNotMatch(html, /\.slide[^{]*\{[^}]*display:none/);
  });

  test('escapes the title', () => {
    const evil = buildViewerHtml(cards, { title: '<script>alert("x")</script>&' });
    assert.match(evil, /<title>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;<\/title>/);
    assert.equal((evil.match(/<script>/g) ?? []).length, 1, 'only the viewer script tag');
  });

  test('JS never uses innerHTML / document.write / eval', () => {
    const script = html.slice(html.lastIndexOf('<script>'));
    assert.doesNotMatch(script, /innerHTML|outerHTML|document\.write|eval\(|new Function/);
    assert.match(script, /ArrowRight/);
    assert.match(script, /ArrowLeft/);
    assert.match(script, /'Home'/);
    assert.match(script, /'End'/);
    assert.match(script, /hashchange/);
  });

  test('CSP: hash-pinned inline style and script, no base/form, no unsafe-inline', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
    assert.equal(csp, CSP);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.match(csp, /(^|; )base-uri 'none'(;|$)/);
    assert.match(csp, /(^|; )form-action 'none'(;|$)/);
    const sha = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(styles.length, 1);
    assert.equal(scripts.length, 1);
    assert.match(csp, new RegExp(`style-src ${sha(styles[0]).replace(/[+/]/g, '\\$&')}(;|$)`));
    assert.match(csp, new RegExp(`script-src ${sha(scripts[0]).replace(/[+/]/g, '\\$&')}(;|$)`));
    assert.equal(cspHash('abc'), sha('abc'));
    // Hashes do not cover style="" attributes, so there must be none.
    assert.doesNotMatch(html, /\sstyle="/);
    assert.match(styles[0], new RegExp(`--dur:${AUTO_ADVANCE_MS}ms`));
  });

  test('touch/safe-area CSS: notch-safe bars and pause button, no callout or selection', () => {
    assert.match(html, /\.bars\{[^}]*top:calc\(10px \+ env\(safe-area-inset-top,0px\)\)/);
    assert.match(html, /\.bars\{[^}]*left:calc\([^)]*safe-area-inset-left/);
    assert.match(html, /\.bars\{[^}]*right:calc\([^)]*safe-area-inset-right/);
    assert.match(html, /\.pause\{[^}]*top:calc\([^)]*safe-area-inset-top/);
    assert.match(html, /\.pause\{[^}]*right:calc\([^)]*safe-area-inset-right/);
    assert.match(html, /\.story\{[^}]*-webkit-touch-callout:none/);
    assert.match(html, /\.story\{[^}]*(^|;)user-select:none/);
  });

  test('script: pointer capture, cancel/lost-capture handling, reduced-motion change listener', () => {
    const script = html.slice(html.lastIndexOf('<script>'));
    assert.match(script, /setPointerCapture\(e\.pointerId\)/);
    assert.match(script, /'pointercancel'/);
    assert.match(script, /'lostpointercapture'/);
    assert.match(script, /mq\.addEventListener\('change'/);
  });

  test('defaults: no cards and no title still give a valid page', () => {
    const empty = buildViewerHtml();
    assert.match(empty, /<title>gitwrapped<\/title>/);
    assert.doesNotMatch(empty, /<section/);
  });
});

test('svgTitle decodes the first <title>', () => {
  assert.equal(svgTitle('<svg><title>a &amp; b &lt;3</title></svg>'), 'a & b <3');
  assert.equal(svgTitle('<svg></svg>'), null);
  assert.equal(svgTitle(cards[0].svg), cards[0].svg.match(/aria-label="([^"]*)"/)[1].replace(/&amp;/g, '&'));
});

test('escapeHtml escapes the five special characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
