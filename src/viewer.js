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
function accessibleSvg(svg, label, describedBy) {
  const s = String(svg).replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
  return s.replace(/<svg\b([^>]*)>/, (whole, attrs) => {
    let a = attrs;
    if (!/\srole=/.test(a)) a += ' role="img"';
    if (!/\saria-label=/.test(a)) a += ` aria-label="${escapeHtml(label)}"`;
    if (describedBy && !/\saria-describedby=/.test(a)) a += ` aria-describedby="${escapeHtml(describedBy)}"`;
    return `<svg${a}>`;
  });
}

const CSS = `
:root{--dur:${AUTO_ADVANCE_MS}ms;color-scheme:dark;--bg:#07070b;--fg:#fff;--muted:#c4c4d4;--track:rgba(255,255,255,.35);--focus:#ffd84d;--btn:rgba(255,255,255,.1);--btn-hover:rgba(255,255,255,.18);--line:rgba(255,255,255,.14);
  --head:0px;--foot:60px;--side:0px;--gap:0px;--sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px)}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column;height:100vh;height:100svh;height:100dvh;padding-top:var(--sat);
  background:radial-gradient(55% 45% at 50% 42%,rgba(124,92,255,.24),transparent 72%),radial-gradient(35% 35% at 85% 95%,rgba(255,61,119,.12),transparent 70%),radial-gradient(35% 35% at 12% 8%,rgba(0,200,255,.08),transparent 70%),var(--bg)}
.top{flex:none;height:var(--head);padding:0 16px;display:flex;align-items:center;justify-content:center;gap:12px;min-width:0}
.title{margin:0;font-size:15px;font-weight:600;letter-spacing:.02em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stage{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:var(--gap) var(--side)}
.story{--avail:calc(100vh - var(--head) - var(--foot) - var(--sat) - var(--sab) - 2 * var(--gap));
  position:relative;flex:none;width:min(calc(100vw - 2 * var(--side)),calc(var(--avail) * 9 / 16));height:min(var(--avail),calc((100vw - 2 * var(--side)) * 16 / 9));
  overflow:hidden;border-radius:12px;background:#000;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y}
@supports (height:100svh){.story{--avail:calc(100svh - var(--head) - var(--foot) - var(--sat) - var(--sab) - 2 * var(--gap))}}
@supports (height:100dvh){.story{--avail:calc(100dvh - var(--head) - var(--foot) - var(--sat) - var(--sab) - 2 * var(--gap))}}
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
.nav{position:absolute;top:0;bottom:0;z-index:2;margin:0;padding:0;border:0;background:transparent;color:inherit;pointer-events:none;-webkit-tap-highlight-color:transparent}
.nav.prev{left:0;width:33.333%}
.nav.next{right:0;width:66.667%}
.nav:focus{outline:none}
.nav:focus-visible{outline:3px solid var(--focus);outline-offset:-6px;border-radius:12px}
.pause{position:absolute;top:calc(22px + env(safe-area-inset-top,0px));right:calc(12px + env(safe-area-inset-right,0px));z-index:4;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.45);color:var(--fg);font:600 16px/1 system-ui,sans-serif;cursor:pointer}
.pause:focus{outline:none}
.pause:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.pause[hidden]{display:none}
.foot{flex:none;height:calc(var(--foot) + var(--sab));padding:0 max(12px,env(safe-area-inset-right,0px)) var(--sab) max(12px,env(safe-area-inset-left,0px));display:flex;align-items:center;justify-content:center;gap:12px}
.count{margin:0;min-width:3.5em;font-size:14px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;text-align:center}
.actions{display:flex;gap:8px;align-items:center}
.btn{min-width:44px;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:22px;background:var(--btn);color:var(--fg);font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.btn:hover{background:var(--btn-hover)}
.btn:disabled{opacity:.55;cursor:progress}
.btn[hidden]{display:none}
.btn.icon{padding:0;width:44px}
.btn:focus{outline:none}
.btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
dialog.help:not([open]){display:none}
dialog.help{max-width:min(440px,calc(100vw - 32px));max-height:calc(100% - 32px);overflow:auto;padding:20px 22px;border:1px solid var(--line);border-radius:16px;background:#15151f;color:var(--fg);box-shadow:0 24px 80px rgba(0,0,0,.7)}
dialog.help.fallback{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;margin:0}
dialog.help::backdrop{background:rgba(0,0,0,.6)}
.help h2{margin:0 0 12px;font-size:18px}
.keys{margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:center;font-size:14px}
.keys div{display:contents}
.keys div[hidden]{display:none}
.keys dt{margin:0;white-space:nowrap}
.keys dd{margin:0;color:var(--muted)}
kbd{display:inline-block;min-width:1.8em;padding:2px 6px;border:1px solid rgba(255,255,255,.3);border-bottom-width:2px;border-radius:6px;background:rgba(255,255,255,.08);font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;color:var(--fg)}
.help p{margin:14px 0 0;font-size:14px;line-height:1.45;color:var(--muted)}
.help .btn{margin-top:16px;float:right}
@media (min-width:600px) and (min-height:520px){:root{--head:48px;--foot:68px;--side:16px;--gap:8px}.story{border-radius:18px;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 70px rgba(0,0,0,.65),0 0 140px rgba(124,92,255,.28)}}
@media (max-width:599px),(max-height:519px){.top{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0)}.btn{padding:0 11px}}
@media (max-width:359px){.foot{gap:6px}.actions{gap:6px}.btn{padding:0 8px;font-size:13px}.count{min-width:2.8em;font-size:13px}}
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
  var countEl = document.getElementById('count');
  var pngBtn = document.getElementById('dl-png');
  var svgBtn = document.getElementById('dl-svg');
  var shareBtn = document.getElementById('share');
  var helpBtn = document.getElementById('help-open');
  var help = document.getElementById('help');
  var helpClose = document.getElementById('help-close');
  var pauseRow = document.getElementById('help-pause-row');
  // Page regions made inert behind the fallback (non-modal) help dialog.
  var regions = ['page-top', 'page-main', 'page-foot'].map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  var actionBtns = [pngBtn, svgBtn, shareBtn];
  var n = slides.length;
  if (!n) {
    actionBtns.concat([helpBtn]).forEach(function (b) { b.disabled = true; });
    return;
  }
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var auto = false;
  var current = -1;
  var paused = false;
  var userPaused = false;
  var busy = false; // a download/share is running
  var helpOpen = false;
  var helpOpener = null;
  var down = null; // active press: {id, x, y, held}
  var nav = typeof navigator === 'undefined' ? {} : navigator;

  function setAuto(on) {
    auto = on && n > 1;
    story.classList.toggle('auto', auto);
    pauseBtn.hidden = !auto;
    if (pauseRow) pauseRow.hidden = !auto; // the P / K help row only applies with auto-advance
  }

  function fromHash() {
    var m = /^#(\\d+)$/.exec(location.hash);
    return m ? Math.min(Math.max(parseInt(m[1], 10), 1), n) - 1 : null;
  }

  function setPaused(p) {
    paused = p;
    story.classList.toggle('paused', p);
    pauseBtn.setAttribute('aria-label', p ? 'Play' : 'Pause');
    pauseBtn.textContent = p ? '\\u25B6' : '\\u275A\\u275A';
  }

  // Paused if the user toggled pause, is holding the story, the tab is hidden, the help
  // dialog is open or a download/share is running.
  function syncPaused() {
    setPaused(userPaused || Boolean(down && down.held) || Boolean(document.hidden) || helpOpen || busy);
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
    countEl.textContent = (i + 1) + ' / ' + n;
    schedulePrerender();
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
  function togglePause() { userPaused = !userPaused; syncPaused(); }

  bars.forEach(function (bar, k) {
    bar.addEventListener('animationend', function () {
      if (k === current && auto && !paused) next(false);
    });
  });

  // ---- Card actions: download PNG / SVG, share. Built from the inline SVG, all local.
  function cardName(i) {
    var id = (slides[i].getAttribute('data-card') || 'card').replace(/[^A-Za-z0-9_-]+/g, '-');
    return String(i + 1).padStart(2, '0') + '-' + id;
  }

  // The current card as a standalone SVG document (XML prolog + xmlns from XMLSerializer).
  function cardSvg(i) {
    var svg = slides[i].querySelector('svg');
    var clone = svg.cloneNode(true);
    clone.removeAttribute('aria-describedby'); // points into this page only
    var box = svg.viewBox && svg.viewBox.baseVal;
    var w = (box && box.width) || 1080;
    var h = (box && box.height) || 1920;
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(w));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(h));
    var xml = new XMLSerializer().serializeToString(clone);
    return { xml: '<?xml version="1.0" encoding="UTF-8"?>\\n' + xml, width: w, height: h };
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Rasterize the card: data: URL image (img-src data: is allowed) -> canvas -> PNG blob.
  // Calls back with null on any failure (decode error, tainted canvas, toBlob null).
  function cardPng(card, cb) {
    var done = false;
    function finish(blob) { if (!done) { done = true; cb(blob || null); } }
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = card.width;
          canvas.height = card.height;
          var ctx = canvas.getContext('2d');
          if (!ctx) return finish(null);
          ctx.drawImage(img, 0, 0, card.width, card.height);
          canvas.toBlob(function (b) { finish(b); }, 'image/png');
        } catch (e) { finish(null); }
      };
      img.onerror = function () { finish(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(card.xml);
    } catch (e) { finish(null); }
  }

  function svgBlob(card) { return new Blob([card.xml], { type: 'image/svg+xml' }); }

  function say(msg) { status.textContent = msg; }

  function setBusy(b) {
    busy = b;
    actionBtns.forEach(function (btn) { btn.disabled = b; });
    syncPaused();
  }

  function downloadSvg() {
    if (busy || helpOpen) return;
    var name = cardName(current) + '.svg';
    saveBlob(svgBlob(cardSvg(current)), name);
    say('Saved ' + name);
  }

  function downloadPng() {
    if (busy || helpOpen) return;
    var i = current;
    var card = cardSvg(i);
    setBusy(true);
    cardPng(card, function (blob) {
      setBusy(false);
      if (blob) {
        saveBlob(blob, cardName(i) + '.png');
        say('Saved ' + cardName(i) + '.png');
      } else {
        saveBlob(svgBlob(card), cardName(i) + '.svg');
        say('PNG not available in this browser; saved ' + cardName(i) + '.svg instead');
      }
    });
  }

  // Share. Safari only allows navigator.share() during the click's user activation, so
  // the current card's PNG is rendered ahead of time (only while share is available, only
  // the current card is kept) and a click with the PNG ready shares synchronously.
  var pngCache = null; // {i, ready, blob, waiters}
  var prerenderTimer = null;
  function prerender(i, cb) {
    if (pngCache && pngCache.i === i) {
      if (cb) { if (pngCache.ready) cb(pngCache.blob); else pngCache.waiters.push(cb); }
      return;
    }
    var entry = { i: i, ready: false, blob: null, waiters: cb ? [cb] : [] };
    pngCache = entry;
    cardPng(cardSvg(i), function (blob) {
      entry.ready = true;
      entry.blob = blob;
      var ws = entry.waiters;
      entry.waiters = [];
      ws.forEach(function (w) { w(blob); });
    });
  }
  function schedulePrerender() {
    if (!nav.share) return;
    clearTimeout(prerenderTimer);
    prerenderTimer = setTimeout(function () { prerender(current); }, 400);
  }
  function warmShare() { if (nav.share && n) prerender(current); }

  function share() {
    if (busy || helpOpen || !nav.share) return;
    var i = current;
    var title = document.title;
    var text = title + ' \u2014 ' + (slides[i].getAttribute('data-title') || 'Card ' + (i + 1));
    function shareData(blob) {
      if (blob && typeof File === 'function' && nav.canShare) {
        var file = new File([blob], cardName(i) + '.png', { type: 'image/png' });
        if (nav.canShare({ files: [file] })) return { files: [file], title: title, text: text };
      }
      return { title: title, text: text };
    }
    // late: the PNG was not ready, so the click's user activation may have expired.
    function run(blob, late) {
      function failed(err) {
        setBusy(false);
        if (err && err.name === 'AbortError') return;
        // The PNG is cached now, so the next tap shares synchronously.
        if (late && err && err.name === 'NotAllowedError') say('Tap Share again to share the card');
        else say('Sharing failed');
      }
      var p;
      try { p = nav.share(shareData(blob)); } catch (err) { failed(err); return; }
      Promise.resolve(p).then(function () { setBusy(false); }, failed);
    }
    setBusy(true);
    if (pngCache && pngCache.i === i && pngCache.ready) run(pngCache.blob, false);
    else prerender(i, function (blob) { run(blob, true); });
  }

  pngBtn.addEventListener('click', downloadPng);
  svgBtn.addEventListener('click', downloadSvg);
  shareBtn.hidden = !nav.share;
  shareBtn.addEventListener('click', share);
  ['focus', 'pointerenter', 'pointerdown'].forEach(function (t) { shareBtn.addEventListener(t, warmShare); });

  // ---- Keyboard shortcuts dialog. <dialog>.showModal when supported, else a plain
  // open attribute (Esc handled below). Focus returns to whatever opened it.
  var nativeDialog = typeof help.showModal === 'function';
  var helpModal = false;
  if (!nativeDialog) help.classList.add('fallback');
  function openHelp() {
    if (helpOpen) return;
    helpOpener = document.activeElement;
    helpOpen = true;
    syncPaused();
    helpModal = false;
    if (nativeDialog) { try { help.showModal(); helpModal = true; } catch (e) { /* fall through */ } }
    if (!helpModal) {
      help.classList.add('fallback');
      help.setAttribute('open', '');
      setInert(true);
    }
    helpClose.focus();
  }
  function afterHelpClosed() {
    if (!helpOpen) return;
    helpOpen = false;
    helpModal = false;
    setInert(false);
    syncPaused();
    var back = helpOpener;
    helpOpener = null;
    // Never leave focus on the body or on something hidden: fall back to the ? button.
    if (focusable(back)) back.focus();
    if (!focusable(back) || document.activeElement !== back) helpBtn.focus();
  }
  function focusable(el) {
    return Boolean(el && el !== document.body && typeof el.focus === 'function' && !el.hidden && !el.disabled &&
      (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0));
  }
  function setInert(on) {
    regions.forEach(function (el) {
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }
  function closeHelp() {
    if (helpModal) help.close(); // fires 'close'
    else { help.removeAttribute('open'); afterHelpClosed(); }
  }
  help.addEventListener('close', afterHelpClosed);
  // Fallback dialog has no focus trap of its own: keep focus inside it while open.
  document.addEventListener('focusin', function (e) {
    if (helpOpen && !helpModal && e.target !== help && !(help.contains && help.contains(e.target))) helpClose.focus();
  });
  help.addEventListener('focusout', function () {
    setTimeout(function () {
      if (helpOpen && !helpModal && (!document.activeElement || document.activeElement === document.body)) helpClose.focus();
    }, 0);
  });
  helpBtn.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);

  // Pointer: tap zones, hold to pause, horizontal swipe. The .nav buttons ignore the
  // pointer (pointer-events:none, so the card's own <title> tooltips show on hover); a tap
  // is placed by its x position instead: left third back, the rest forward. The buttons
  // stay for keyboard and screen-reader users. The story captures the pointer
  // so a release outside it (or a lost capture) still ends the hold. Because a captured
  // pointer's click may be retargeted to the story, taps navigate here on pointerup and
  // the click that follows is swallowed; the buttons' own click handlers then only see
  // keyboard / assistive-tech activations. The toolbar lives outside the story.
  var holdTimer = null;
  var swallowClickUntil = 0;
  story.addEventListener('pointerdown', function (e) {
    if (helpOpen || e.target === pauseBtn || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
    if (helpOpen) { e.stopPropagation(); e.preventDefault(); return; } // fallback dialog: story is inert
    if (e.target === pauseBtn || Date.now() >= swallowClickUntil) return;
    swallowClickUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  prevBtn.addEventListener('click', userPrev);
  nextBtn.addEventListener('click', userNext);
  pauseBtn.addEventListener('click', togglePause);
  function isSpace(e) { return e.key === ' ' || e.key === 'Spacebar'; }
  // Toolbar buttons keep their own Space/Enter activation.
  function isToolbarControl(t) { return Boolean(t && t.classList && t.classList.contains('btn')); }
  // Single-character shortcuts (P, K, D, ?) never fire while typing in a text field.
  function isEditable(t) {
    if (!t) return false;
    var tag = String(t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(t.isContentEditable);
  }

  document.addEventListener('keydown', function (e) {
    // Shortcuts never take a modified key (browser / OS / assistive-tech shortcuts).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (helpOpen) {
      // Only Esc while the dialog is open; a native modal dialog closes itself on Esc.
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (!helpModal) { closeHelp(); e.preventDefault(); }
      }
      return;
    }
    if (isEditable(e.target)) return;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': userNext(); break;
      case 'ArrowLeft': case 'PageUp': userPrev(); break;
      case ' ': case 'Spacebar':
        if (e.target === pauseBtn || isToolbarControl(e.target)) return; // let buttons activate themselves
        // Anywhere else, even on a focused tap zone, Space goes forward (Shift+Space back).
        if (e.shiftKey) userPrev(); else userNext();
        break;
      case 'Home': show(0, true); break;
      case 'End': show(n - 1, true); break;
      case 'p': case 'P': case 'k': case 'K':
        if (!auto) return;
        togglePause(); break;
      case 'd': case 'D':
        if (!e.repeat) downloadPng(); // holding D must not save a file per key repeat
        break;
      case '?':
        if (!e.repeat) openHelp();
        break;
      default: return;
    }
    e.preventDefault();
  });
  // Buttons activate on Space keyup: stop the tap zones from also navigating then.
  document.addEventListener('keyup', function (e) {
    if (isSpace(e) && (e.target === prevBtn || e.target === nextBtn)) e.preventDefault();
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
 * A card's optional `description` (plain text, see cardDescription) becomes a visually
 * hidden paragraph the SVG points to with aria-describedby.
 * No external requests: no fonts, scripts, stylesheets or images by URL.
 */
export function buildViewerHtml(cards = [], { title } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const n = list.length;
  const docTitle = escapeHtml(String(title ?? '').trim() || 'gitwrapped');
  const slides = list
    .map(({ id, svg, description }, i) => {
      const label = svgTitle(svg) ?? `Card ${i + 1}`;
      const desc = typeof description === 'string' ? description.trim() : '';
      const descId = desc ? `card-${i + 1}-desc` : null;
      return [
        `<section class="slide${i === 0 ? ' active' : ''}" id="card-${i + 1}" data-card="${escapeHtml(id ?? '')}"`,
        ` data-title="${escapeHtml(label)}" aria-roledescription="slide" aria-label="${escapeHtml(`${i + 1} of ${n}`)}"`,
        ` aria-hidden="${i === 0 ? 'false' : 'true'}">\n`,
        accessibleSvg(svg, label, descId),
        // aria-hidden: read once, as the SVG's description, not again as page text.
        desc ? `\n<p class="sr" id="${descId}" aria-hidden="true">${escapeHtml(desc)}</p>` : '',
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
<header class="top" id="page-top">
<h1 class="title">${docTitle}</h1>
</header>
<main class="stage" id="page-main">
<div class="story" id="story" role="region" aria-roledescription="carousel" aria-label="${docTitle}">
<div class="bars" aria-hidden="true">${bars}</div>
${slides}
<button type="button" class="nav prev" id="prev" aria-label="Previous card"></button>
<button type="button" class="nav next" id="next" aria-label="Next card"></button>
<button type="button" class="pause" id="pause" aria-label="Pause">&#10074;&#10074;</button>
<p class="sr" id="status" aria-live="polite"></p>
</div>
</main>
<footer class="foot" id="page-foot">
<p class="count" id="count" aria-hidden="true">${n ? `1 / ${n}` : '0 / 0'}</p>
<div class="actions" role="group" aria-label="Card actions">
<button type="button" class="btn" id="dl-png" aria-keyshortcuts="D"><span aria-hidden="true">&#8595;</span><span class="sr">Download </span>PNG</button>
<button type="button" class="btn" id="dl-svg"><span aria-hidden="true">&#8595;</span><span class="sr">Download </span>SVG</button>
<button type="button" class="btn" id="share" hidden>Share</button>
<button type="button" class="btn icon" id="help-open" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts="Shift+?">?</button>
</div>
</footer>
<dialog class="help" id="help" aria-labelledby="help-title">
<h2 id="help-title">Keyboard shortcuts</h2>
<dl class="keys">
<div><dt><kbd>&#8594;</kbd> <kbd>Space</kbd></dt><dd>Next card</dd></div>
<div><dt><kbd>&#8592;</kbd> <kbd>Shift</kbd>+<kbd>Space</kbd></dt><dd>Previous card</dd></div>
<div><dt><kbd>Home</kbd> <kbd>End</kbd></dt><dd>First / last card</dd></div>
<div id="help-pause-row"><dt><kbd>P</kbd> <kbd>K</kbd></dt><dd>Pause / play auto-advance</dd></div>
<div><dt><kbd>D</kbd></dt><dd>Download this card as PNG</dd></div>
<div><dt><kbd>?</kbd></dt><dd>Show this help</dd></div>
<div><dt><kbd>Esc</kbd></dt><dd>Close this help</dd></div>
</dl>
<p>On touch screens, tap the right side to go forward and the left side to go back, swipe to move, and press and hold to pause.</p>
<button type="button" class="btn" id="help-close">Close</button>
</dialog>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
