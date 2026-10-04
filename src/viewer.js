// Self-contained HTML story viewer: one file, inline CSS + JS + SVG, no external requests.

import { createHash } from 'node:crypto';

export const AUTO_ADVANCE_MS = 6000;

/** Escape a string for HTML text and double-quoted attribute contexts. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Decode the few XML entities escapeXml() produces, so a label can be re-escaped for HTML. */
function decodeXml(value) {
  return String(value).replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[e]);
}

/** The text of the first <title> in an SVG string, decoded, or null. */
export function svgTitle(svg) {
  const m = /<title>([\s\S]*?)<\/title>/.exec(String(svg));
  return m ? decodeXml(m[1]).trim() || null : null;
}

/** Ensure the root <svg> carries role="img" and an aria-label (cards already do). */
function accessibleSvg(svg, label) {
  const s = String(svg).replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
  return s.replace(/<svg\b([^>]*)>/, (whole, attrs) => {
    let a = attrs;
    if (!/\srole=/.test(a)) a += ' role="img"';
    if (!/\saria-label=/.test(a)) a += ` aria-label="${escapeHtml(label)}"`;
    return `<svg${a}>`;
  });
}

const CSS = `
:root{--dur:${AUTO_ADVANCE_MS}ms;color-scheme:dark;--bg:#07070b;--fg:#fff;--track:rgba(255,255,255,.35);--focus:#ffd84d}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
.stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
.story{position:relative;width:min(100vw,calc(100vh * 9 / 16));height:min(100vh,calc(100vw * 16 / 9));
  width:min(100vw,calc(100dvh * 9 / 16));height:min(100dvh,calc(100vw * 16 / 9));
  overflow:hidden;border-radius:12px;background:#000;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y}
.slide{position:absolute;inset:0;visibility:hidden;opacity:0;transition:opacity .25s ease}
.slide.active{visibility:visible;opacity:1}
.slide svg{display:block;width:100%;height:100%}
.bars{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:calc(10px + env(safe-area-inset-left,0px));right:calc(10px + env(safe-area-inset-right,0px));display:flex;gap:4px;z-index:3;pointer-events:none}
.bar{flex:1;height:4px;border-radius:2px;background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--fg)}
.bar.done i{width:100%}
.bar.current i{width:100%}
.auto .bar.current i{width:0;animation:fill var(--dur,6s) linear forwards}
.paused .bar.current i{animation-play-state:paused}
@keyframes fill{from{width:0}to{width:100%}}
.nav{position:absolute;top:0;bottom:0;z-index:2;margin:0;padding:0;border:0;background:transparent;cursor:pointer;color:inherit;-webkit-tap-highlight-color:transparent}
.nav.prev{left:0;width:33.333%}
.nav.next{right:0;width:66.667%}
.nav:focus{outline:none}
.nav:focus-visible{outline:3px solid var(--focus);outline-offset:-6px;border-radius:12px}
.pause{position:absolute;top:calc(22px + env(safe-area-inset-top,0px));right:calc(12px + env(safe-area-inset-right,0px));z-index:4;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.35);color:var(--fg);font:600 16px/1 system-ui,sans-serif;cursor:pointer}
.pause:focus{outline:none}
.pause:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.pause[hidden]{display:none}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:700px){.story{box-shadow:0 20px 60px rgba(0,0,0,.6)}}
@media (prefers-reduced-motion:reduce){.slide{transition:none}.auto .bar.current i{animation:none;width:100%}}
`;

// Runs in the browser. Uses only textContent/classList/attributes; never innerHTML.
const SCRIPT = `
(function () {
  'use strict';
  var story = document.getElementById('story');
  var slides = Array.prototype.slice.call(story.querySelectorAll('.slide'));
  var bars = Array.prototype.slice.call(story.querySelectorAll('.bar'));
  var status = document.getElementById('status');
  var pauseBtn = document.getElementById('pause');
  var n = slides.length;
  if (!n) return;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var auto = false;
  var current = -1;
  var paused = false;
  var userPaused = false;
  var down = null; // active press: {id, x, y, held}

  function setAuto(on) {
    auto = on && n > 1;
    story.classList.toggle('auto', auto);
    pauseBtn.hidden = !auto;
  }

  function fromHash() {
    var m = /^#(\\d+)$/.exec(location.hash);
    return m ? Math.min(Math.max(parseInt(m[1], 10), 1), n) - 1 : null;
  }

  function setPaused(p) {
    paused = p;
    story.classList.toggle('paused', p);
    pauseBtn.setAttribute('aria-label', p ? 'Play' : 'Pause');
    pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
    pauseBtn.textContent = p ? '\\u25B6' : '\\u275A\\u275A';
  }

  // Paused if the user toggled pause, is holding the story, or the tab is hidden.
  function syncPaused() {
    setPaused(userPaused || Boolean(down && down.held) || Boolean(document.hidden));
  }

  // announce: only user-initiated navigation updates the live region; auto-advance
  // and the initial render stay quiet so screen readers are not interrupted.
  function show(i, announce) {
    i = Math.min(Math.max(i, 0), n - 1);
    if (i === current) return;
    current = i;
    for (var k = 0; k < n; k++) {
      var on = k === i;
      slides[k].classList.toggle('active', on);
      slides[k].setAttribute('aria-hidden', on ? 'false' : 'true');
      bars[k].classList.toggle('done', k < i);
      bars[k].classList.remove('current');
    }
    void bars[i].offsetWidth; // restart the fill animation
    bars[i].classList.add('current');
    if (announce) status.textContent = 'Card ' + (i + 1) + ' of ' + n + ': ' + (slides[i].getAttribute('data-title') || '');
    var hash = '#' + (i + 1);
    if (location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (e) { /* file:// in some browsers */ }
    }
  }

  function next(announce) { if (current < n - 1) show(current + 1, announce); }
  function prev(announce) { if (current > 0) show(current - 1, announce); else restart(); }
  function restart() { var c = current; current = -1; show(c, false); }
  function userNext() { next(true); }
  function userPrev() { prev(true); }
  function togglePause() { userPaused = !paused; syncPaused(); }

  bars.forEach(function (bar, k) {
    bar.addEventListener('animationend', function () {
      if (k === current && auto && !paused) next(false);
    });
  });

  // Pointer: tap zones, hold to pause, horizontal swipe. The story captures the pointer
  // so a release outside it (or a lost capture) still ends the hold. Because a captured
  // pointer's click may be retargeted to the story, taps navigate here on pointerup and
  // the click that follows is swallowed; the buttons' own click handlers then only see
  // keyboard / assistive-tech activations.
  var holdTimer = null;
  var swallowClickUntil = 0;
  story.addEventListener('pointerdown', function (e) {
    if (e.target === pauseBtn || (e.pointerType === 'mouse' && e.button !== 0)) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, held: false };
    try { story.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      if (down && auto) { down.held = true; syncPaused(); }
    }, 250);
  });
  function endPointer(e, cancelled) {
    if (!down || (e && e.pointerId !== undefined && e.pointerId !== down.id)) return;
    clearTimeout(holdTimer);
    var d = down;
    down = null;
    if (d.held) syncPaused();
    if (cancelled) return;
    swallowClickUntil = Date.now() + 600;
    if (d.held) return; // a hold is not a tap
    var dx = e.clientX - d.x;
    var dy = e.clientY - d.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) userNext(); else userPrev();
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return; // a drag, not a tap
    var r = story.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (e.clientX < r.left + r.width / 3) userPrev(); else userNext();
  }
  story.addEventListener('pointerup', function (e) { endPointer(e, false); });
  story.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  story.addEventListener('lostpointercapture', function (e) { endPointer(e, true); });
  story.addEventListener('contextmenu', function (e) { if (down) e.preventDefault(); });
  story.addEventListener('click', function (e) {
    if (e.target === pauseBtn || Date.now() >= swallowClickUntil) return;
    swallowClickUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  document.getElementById('prev').addEventListener('click', userPrev);
  document.getElementById('next').addEventListener('click', userNext);
  pauseBtn.addEventListener('click', togglePause);

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    var onButton = t && t.tagName === 'BUTTON';
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': userNext(); break;
      case 'ArrowLeft': case 'PageUp': userPrev(); break;
      case ' ': case 'Spacebar':
        if (onButton) return; // let the focused button activate itself
        if (e.shiftKey) userPrev(); else userNext();
        break;
      case 'Home': show(0, true); break;
      case 'End': show(n - 1, true); break;
      case 'p': case 'P': case 'k': case 'K':
        if (!auto) return;
        togglePause(); break;
      default: return;
    }
    e.preventDefault();
  });

  window.addEventListener('hashchange', function () {
    var h = fromHash();
    if (h !== null) show(h, true);
  });
  document.addEventListener('visibilitychange', syncPaused);

  function onMotionChange() {
    var was = auto;
    setAuto(!(mq && mq.matches));
    if (auto !== was && current >= 0) restart(); // restart the bar under the new mode
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
    else if (mq.addListener) mq.addListener(onMotionChange);
  }

  setAuto(!(mq && mq.matches));
  syncPaused();
  var start = fromHash();
  show(start === null ? 0 : start, false);
})();
`;

/** CSP source for an inline element body: 'sha256-<base64>' of its exact text. */
export function cspHash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

export const CSP = [
  "default-src 'none'",
  `style-src ${cspHash(CSS)}`,
  `script-src ${cspHash(SCRIPT)}`,
  'img-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Build a complete, self-contained HTML5 story viewer for `cards` ([{id, svg}] from
 * buildCards). The SVG markup is inlined as-is (it is generated and escaped by us).
 * No external requests: no fonts, scripts, stylesheets or images by URL.
 */
export function buildViewerHtml(cards = [], { title } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const n = list.length;
  const docTitle = escapeHtml(String(title ?? '').trim() || 'gitwrapped');
  const slides = list
    .map(({ id, svg }, i) => {
      const label = svgTitle(svg) ?? `Card ${i + 1}`;
      return [
        `<section class="slide${i === 0 ? ' active' : ''}" id="card-${i + 1}" data-card="${escapeHtml(id ?? '')}"`,
        ` data-title="${escapeHtml(label)}" aria-roledescription="slide" aria-label="${escapeHtml(`${i + 1} of ${n}`)}"`,
        ` aria-hidden="${i === 0 ? 'false' : 'true'}">\n`,
        accessibleSvg(svg, label),
        '\n</section>',
      ].join('');
    })
    .join('\n');
  const bars = list.map((_, i) => `<span class="bar${i === 0 ? ' current' : ''}"><i></i></span>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="color-scheme" content="dark">
<title>${docTitle}</title>
<style>${CSS}</style>
</head>
<body>
<main class="stage">
<h1 class="sr">${docTitle}</h1>
<div class="story" id="story" aria-roledescription="carousel" aria-label="${docTitle}">
<div class="bars" aria-hidden="true">${bars}</div>
${slides}
<button type="button" class="nav prev" id="prev" aria-label="Previous card"></button>
<button type="button" class="nav next" id="next" aria-label="Next card"></button>
<button type="button" class="pause" id="pause" aria-label="Pause" aria-pressed="false">&#10074;&#10074;</button>
<p class="sr" id="status" aria-live="polite"></p>
</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
