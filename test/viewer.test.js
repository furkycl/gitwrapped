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

  test('page chrome: header/main/footer landmarks, visible title, card counter', () => {
    assert.match(html, /<header class="top" id="page-top">\n<h1 class="title">gitwrapped · demo<\/h1>\n<\/header>/);
    assert.match(html, /<main class="stage" id="page-main">/);
    assert.match(html, /<footer class="foot" id="page-foot">/);
    assert.match(html, new RegExp(`<p class="count" id="count" aria-hidden="true">1 / ${CARD_IDS.length}</p>`));
    assert.equal((html.match(/aria-live=/g) ?? []).length, 1, 'only the status region is live');
  });

  test('toolbar actions live outside the story (not under the tap zones)', () => {
    const storyEnd = html.indexOf('</main>');
    for (const id of ['dl-png', 'dl-svg', 'share', 'help-open']) {
      const at = html.indexOf(`id="${id}"`);
      assert.ok(at > storyEnd, `${id} is after </main>`);
    }
    // A group, not role="toolbar": arrow keys change cards rather than moving between buttons.
    assert.match(html, /<div class="actions" role="group" aria-label="Card actions">/);
    assert.doesNotMatch(html, /role="toolbar"/);
    // Accessible names: visually hidden "Download " + visible format.
    assert.match(html, /id="dl-png"[^>]*><span aria-hidden="true">&#8595;<\/span><span class="sr">Download <\/span>PNG<\/button>/);
    assert.match(html, /id="dl-svg"[^>]*><span aria-hidden="true">&#8595;<\/span><span class="sr">Download <\/span>SVG<\/button>/);
    assert.match(html, /id="share" hidden>Share<\/button>/);
    assert.match(html, /id="help-open" aria-label="Keyboard shortcuts" aria-haspopup="dialog"/);
  });

  test('help dialog lists the shortcuts and has a close button', () => {
    assert.match(html, /<dialog class="help" id="help" aria-labelledby="help-title">/);
    assert.match(html, /<h2 id="help-title">Keyboard shortcuts<\/h2>/);
    for (const k of ['Space', 'Home', 'End', 'P', 'K', 'D', '?', 'Esc']) assert.ok(html.includes(`<kbd>${k}</kbd>`), k);
    assert.match(html, /<button type="button" class="btn" id="help-close">Close<\/button>/);
    assert.match(html, /<div id="help-pause-row"><dt><kbd>P<\/kbd> <kbd>K<\/kbd><\/dt>/);
  });

  test('CSS: 44px touch targets, focus-visible rings, story leaves room for the toolbar', () => {
    assert.match(html, /\.btn\{[^}]*min-width:44px;height:44px/);
    assert.match(html, /\.btn:focus-visible\{outline:3px solid var\(--focus\)/);
    assert.match(html, /\.story\{--avail:calc\(100vh - var\(--head\) - var\(--foot\)/);
    assert.match(html, /@supports \(height:100dvh\)\{\.story\{--avail:calc\(100dvh/);
    assert.match(html, /dialog\.help:not\(\[open\]\)\{display:none\}/);
    // vh → svh → dvh fallbacks for the page and the story's available height
    assert.match(html, /body\{[^}]*height:100vh;height:100svh;height:100dvh;/);
    assert.match(html, /@supports \(height:100svh\)\{\.story\{--avail:calc\(100svh[^}]*\}\}\n@supports \(height:100dvh\)/);
    assert.match(html, /\.keys div\[hidden\]\{display:none\}/);
  });

  test('script: download/share helpers use blob URLs, revoke them, and no network APIs', () => {
    const script = html.slice(html.lastIndexOf('<script>'));
    assert.match(script, /new XMLSerializer\(\)\.serializeToString/);
    assert.match(script, /canvas\.toBlob/);
    assert.match(script, /URL\.revokeObjectURL/);
    assert.match(script, /'AbortError'/);
    assert.match(script, /case 'd': case 'D':\s+if \(!e\.repeat\) downloadPng\(\)/);
    assert.match(script, /case '\?':\s+if \(!e\.repeat\) openHelp\(\)/);
    assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|location\.href/);
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
