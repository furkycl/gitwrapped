// Viewer polish: CSP integrity, markup escaping, toolbar placement and the inline
// script's card actions / help dialog / keyboard handling, run in a vm with a DOM stub.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildCards } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { buildViewerHtml, CSP } from '../src/viewer.js';

const cards = buildCards(computeStats([], { today: '2024-03-14' }), { repoName: 'demo' });
const html = buildViewerHtml(cards, { title: 'demo' });

function sha(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}
function inline(page, tag) {
  return [...page.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}
function cspOf(page) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
  assert.ok(m, 'CSP meta present');
  return Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...srcs] = d.split(/\s+/);
    return [name, srcs];
  }));
}
const SCRIPT = inline(html, 'script')[0];

// ---------------------------------------------------------------------------
describe('CSP stays hash-based and local-only', () => {
  const hostile = buildViewerHtml(
    [{ id: 'x"><script>alert(1)</script>', svg: '<svg viewBox="0 0 10 10"><title>&lt;/style&gt;&lt;script&gt;</title></svg>' }],
    { title: '</title><script>alert(1)</script><style>' },
  );

  for (const [name, page] of [['normal page', html], ['hostile title/cards', hostile]]) {
    test(`${name}: exactly one inline <style> and <script>, and their sha256 hashes are in the CSP`, () => {
      const styles = inline(page, 'style');
      const scripts = inline(page, 'script');
      assert.equal(styles.length, 1);
      assert.equal(scripts.length, 1);
      const csp = cspOf(page);
      assert.deepEqual(csp['style-src'], [sha(styles[0])]);
      assert.deepEqual(csp['script-src'], [sha(scripts[0])]);
    });
  }

  test('directives: default-src none, img-src data: only, base-uri/form-action none, nothing else', () => {
    const csp = cspOf(html);
    assert.deepEqual(Object.keys(csp).sort(), ['base-uri', 'default-src', 'form-action', 'img-src', 'script-src', 'style-src']);
    assert.deepEqual(csp['default-src'], ["'none'"]);
    assert.deepEqual(csp['img-src'], ['data:']);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.deepEqual(csp['form-action'], ["'none'"]);
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`), 'exported CSP is what the page uses');
  });

  test('no external, wildcard or unsafe sources anywhere in the policy', () => {
    assert.doesNotMatch(CSP, /https?:|\*|'self'|unsafe-|blob:|wss?:|nonce-/);
    for (const srcs of Object.values(cspOf(html))) {
      for (const s of srcs) assert.match(s, /^('none'|data:|'sha256-[A-Za-z0-9+/]+=*')$/, s);
    }
  });
});

describe('inline script safety', () => {
  test('no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / Function', () => {
    assert.doesNotMatch(SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\(\s*['"]/);
  });
  test('no network APIs', () => {
    assert.doesNotMatch(SCRIPT, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(/);
  });
});

describe('markup structure and escaping', () => {
  test('the toolbar and help dialog are outside #story; the tap zones and pause button are inside', () => {
    const start = html.indexOf('<div class="story" id="story"');
    const end = html.indexOf('</main>');
    assert.ok(start > 0 && end > start);
    const story = html.slice(start, end);
    for (const id of ['dl-png', 'dl-svg', 'share', 'help-open', 'help', 'help-close']) {
      assert.ok(!story.includes(`id="${id}"`), `${id} not inside #story`);
      assert.ok(html.indexOf(`id="${id}"`) > end, `${id} after the story`);
    }
    assert.ok(!story.includes('role="toolbar"'));
    for (const id of ['prev', 'next', 'pause', 'status']) assert.ok(story.includes(`id="${id}"`), `${id} inside #story`);
  });

  test('titles and card ids with markup or quotes are escaped in every new attribute/text spot', () => {
    const evilTitle = `"'><script>alert(1)</script>&`;
    const page = buildViewerHtml(
      [{ id: `a"b'<c>&`, svg: '<svg viewBox="0 0 10 10"><title>Q &quot;x&quot; &lt;script&gt;alert(2)&lt;/script&gt; &amp; \'y\'</title></svg>' }],
      { title: evilTitle },
    );
    const esc = '&quot;&#39;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;';
    assert.ok(page.includes(`<title>${esc}</title>`));
    assert.ok(page.includes(`<h1 class="title">${esc}</h1>`));
    assert.ok(page.includes(`aria-label="${esc}"`), 'story aria-label');
    assert.ok(page.includes('data-card="a&quot;b&#39;&lt;c&gt;&amp;"'));
    const dataTitle = '&quot;x&quot; &lt;script&gt;alert(2)&lt;/script&gt; &amp; &#39;y&#39;';
    assert.ok(page.includes(`data-title="Q ${dataTitle}"`), 'data-title re-escaped for HTML');
    assert.ok(page.includes(`aria-label="Q ${dataTitle}"`), 'svg aria-label injected and escaped');
    assert.equal((page.match(/<script\b/g) ?? []).length, 1, 'no injected script element');
    assert.doesNotMatch(page, /alert\(1\)<\/script>|alert\(2\)<\/script>/);
  });
});

// ---------------------------------------------------------------------------
// DOM stub (adapted from test/e2e.test.js's boot(), with more knobs).
function boot({
  hash = '', reduced = true, png = 'ok', nav = undefined, modal = true, n = 8, cardIds = null,
} = {}) {
  let focused = null;
  function el(extra = {}) {
    const classes = new Set();
    const attrs = {};
    const listeners = {};
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c),
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k] ?? null,
      removeAttribute: (k) => { delete attrs[k]; },
      focus() { focused = this; },
      disabled: false,
      addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
      fire(type, ev = {}) {
        let prevented = false;
        const e = { type, target: this, preventDefault() { prevented = true; }, stopPropagation() {}, ...ev };
        for (const fn of listeners[type] ?? []) fn(e);
        return { prevented };
      },
      offsetWidth: 0,
      hidden: false,
      textContent: '',
      attrs,
      ...extra,
    };
  }
  const svgEl = { viewBox: { baseVal: { width: 1080, height: 1920 } }, cloneNode: () => el({ tag: 'svg' }) };
  const slides = Array.from({ length: n }, (_, i) => el({ i, querySelector: () => svgEl }));
  slides.forEach((s, i) => {
    s.setAttribute('data-title', `T${i + 1}`);
    const id = cardIds ? cardIds[i] : `c${i + 1}`;
    if (id !== null) s.setAttribute('data-card', id);
  });
  const bars = Array.from({ length: n }, () => el());
  const story = el({
    querySelectorAll: (sel) => (sel === '.slide' ? slides : bars),
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 90, bottom: 160, width: 90, height: 160 }),
  });
  const btn = () => { const b = el(); b.classList.add('btn'); return b; };
  const closes = [];
  const help = el({
    showModal() { if (!modal) throw new Error('no modal'); this.open = true; },
    close() { closes.push(1); this.open = false; this.fire('close'); },
    open: false,
  });
  const ids = {
    story, status: el(), pause: el(), prev: el(), next: el(), count: el(), help,
    'dl-png': btn(), 'dl-svg': btn(), share: btn(), 'help-open': btn(), 'help-close': btn(),
    'page-top': el(), 'page-main': el(), 'page-foot': el(), 'help-pause-row': el(),
  };
  ids.share.hidden = true; // as in the markup
  const saved = [];
  const created = [];
  const revoked = [];
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }
  let images = 0;
  class Image {
    constructor() { images++; if (png === 'image-throws') throw new Error('no Image'); }
    set src(v) {
      this.url = v;
      queueMicrotask(() => (png === 'decode-error' ? this.onerror() : this.onload()));
    }
  }
  const timers = [];
  const mq = el({ matches: reduced });
  const body = el({ appendChild() {} });
  const blobs = new Map();
  const doc = el({
    getElementById: (id) => ids[id],
    hidden: false,
    body,
    title: 'demo',
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          getContext: () => (png === 'no-context' ? null : { drawImage() {} }),
          toBlob: (cb, type) => {
            if (png === 'toblob-throws') throw new Error('tainted');
            queueMicrotask(() => cb(png === 'null-blob' ? null : new Blob(['png'], { type })));
          },
        };
      }
      const a = el({ tag });
      a.click = () => saved.push([a.download, blobs.get(a.href), a.href]);
      a.remove = () => {};
      return a;
    },
  });
  Object.defineProperty(doc, 'activeElement', { get: () => focused ?? body });
  let urls = 0;
  const ctx = {
    document: doc,
    XMLSerializer: class { serializeToString(node) { return `<svg xmlns="ns" data-tag="${node.tag}"/>`; } },
    URL: {
      createObjectURL: (b) => { const u = `blob:${++urls}`; blobs.set(u, b); created.push(u); return u; },
      revokeObjectURL: (u) => revoked.push(u),
    },
    Blob,
    Image,
    File: class extends Blob { constructor(parts, name, opts) { super(parts, opts); this.name = name; } },
    encodeURIComponent,
    Promise,
    String,
    ...(nav ? { navigator: nav } : {}),
    window: { matchMedia: () => mq, addEventListener() {} },
    location: { hash },
    history: { replaceState() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (id) timers[id - 1] = null; },
    Date,
  };
  vm.runInNewContext(SCRIPT, ctx);
  return {
    slides, story, doc, ids, help, saved, created, revoked, closes, body, mq,
    status: ids.status,
    get focused() { return focused; },
    get images() { return images; },
    get active() { return slides.findIndex((s) => s.classList.contains('active')); },
    get paused() { return story.classList.contains('paused'); },
    flushTimers() { const fns = timers.splice(0); for (const fn of fns) fn?.(); },
    settle() { return new Promise((res) => setImmediate(res)); },
    key(k, extra = {}) { return doc.fire('keydown', { key: k, target: focused ?? body, ...extra }); },
  };
}

function fakeNav({ share = () => Promise.resolve(), canShare = () => true } = {}) {
  const calls = [];
  const nav = { share: (d) => { calls.push(d); return share(d); } };
  if (canShare) nav.canShare = canShare;
  return { nav, calls };
}

describe('viewer script: downloads', () => {
  test('"D" (shift) also downloads; a second press while busy is ignored', async () => {
    const v = boot({ hash: '#2' });
    assert.equal(v.key('D').prevented, true);
    v.key('d');
    v.ids['dl-png'].fire('click');
    v.ids['dl-svg'].fire('click');
    await v.settle();
    assert.deepEqual(v.saved.map((s) => s[0]), ['02-c2.png']);
  });

  test('Download SVG names the file NN-<id>.svg, zero-padded, with image/svg+xml', () => {
    const v = boot({ hash: '#7' });
    v.ids['dl-svg'].fire('click');
    assert.equal(v.saved[0][0], '07-c7.svg');
    assert.equal(v.saved[0][1].type, 'image/svg+xml');
    assert.equal(v.status.textContent, 'Saved 07-c7.svg');
  });

  test('two-digit card numbers are not padded further (10-<id>)', () => {
    const v = boot({ n: 12, hash: '#10' });
    v.ids['dl-svg'].fire('click');
    assert.equal(v.saved[0][0], '10-c10.svg');
  });

  test('card ids are sanitized into safe filenames; a missing id falls back to "card"', () => {
    const v = boot({ n: 2, cardIds: ['../evil id<"x>.exe', null] });
    v.ids['dl-svg'].fire('click');
    v.key('ArrowRight');
    v.ids['dl-svg'].fire('click');
    const [a, b] = v.saved.map((s) => s[0]);
    assert.match(a, /^01-[A-Za-z0-9_-]+\.svg$/);
    assert.equal(a, '01--evil-id-x-exe.svg');
    assert.equal(b, '02-card.svg');
  });

  for (const png of ['decode-error', 'null-blob', 'no-context', 'toblob-throws', 'image-throws']) {
    test(`PNG failure (${png}) falls back to NN-<id>.svg, explains why, and re-enables the buttons`, async () => {
      const v = boot({ hash: '#4', png, reduced: false });
      v.key('d');
      await v.settle();
      assert.equal(v.saved.length, 1);
      assert.equal(v.saved[0][0], '04-c4.svg');
      assert.equal(v.saved[0][1].type, 'image/svg+xml');
      assert.match(v.status.textContent, /PNG not available.*04-c4\.svg/);
      assert.equal(v.ids['dl-png'].disabled, false);
      assert.equal(v.paused, false);
    });
  }

  test('every object URL created is revoked (PNG, SVG and fallback paths)', async () => {
    for (const png of ['ok', 'null-blob']) {
      const v = boot({ png });
      v.ids['dl-png'].fire('click');
      await v.settle();
      v.ids['dl-svg'].fire('click');
      v.key('ArrowRight');
      v.key('d');
      await v.settle();
      assert.equal(v.created.length, 3);
      assert.deepEqual(v.revoked, [], 'not revoked before the click has been handled');
      v.flushTimers();
      assert.deepEqual([...v.revoked].sort(), [...v.created].sort());
    }
  });
});

describe('viewer script: share', () => {
  test('hidden when navigator is missing or has no share(); clicking it then does nothing', async () => {
    for (const nav of [undefined, { canShare: () => true }]) {
      const v = boot({ nav });
      assert.equal(v.ids.share.hidden, true);
      v.ids.share.fire('click');
      await v.settle();
      assert.equal(v.ids.share.disabled, false);
      assert.equal(v.saved.length, 0);
    }
  });

  test('canShare(files) false / canShare missing → text-only share, never a url', async () => {
    for (const canShare of [() => false, null]) {
      const { nav, calls } = fakeNav({ canShare });
      const v = boot({ nav, hash: '#2' });
      assert.equal(v.ids.share.hidden, false);
      v.ids.share.fire('click');
      await v.settle();
      assert.equal(calls.length, 1);
      assert.deepEqual(Object.keys(calls[0]).sort(), ['text', 'title']);
      assert.equal(calls[0].title, 'demo');
      assert.equal(calls[0].text, 'demo — T2');
    }
  });

  test('PNG failure → text-only share (no files, no url)', async () => {
    const { nav, calls } = fakeNav();
    const v = boot({ nav, png: 'decode-error' });
    v.ids.share.fire('click');
    await v.settle();
    assert.equal(calls.length, 1);
    assert.ok(!('files' in calls[0]));
    assert.ok(!('url' in calls[0]));
  });

  test('a file share carries 0N-<id>.png and no url', async () => {
    const { nav, calls } = fakeNav();
    const v = boot({ nav, hash: '#5' });
    v.ids.share.fire('click');
    await v.settle();
    assert.equal(calls[0].files[0].name, '05-c5.png');
    assert.equal(calls[0].files[0].type, 'image/png');
    assert.ok(!('url' in calls[0]));
    assert.equal(v.status.textContent, '');
    assert.equal(v.ids.share.disabled, false);
  });

  for (const [label, share, msg] of [
    // The PNG was rendered after the click, so the activation may have expired: ask for a re-tap.
    ['rejects with NotAllowedError', () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })), 'Tap Share again to share the card'],
    ['throws synchronously', () => { throw new TypeError('bad data'); }, 'Sharing failed'],
  ]) {
    test(`share() that ${label} → "${msg}", buttons re-enabled, not paused`, async () => {
      const { nav } = fakeNav({ share });
      const v = boot({ nav, reduced: false });
      v.ids.share.fire('click');
      assert.equal(v.ids.share.disabled, true);
      assert.equal(v.paused, true);
      await v.settle();
      await v.settle();
      assert.equal(v.status.textContent, msg);
      assert.equal(v.ids.share.disabled, false);
      assert.equal(v.ids['dl-png'].disabled, false);
      assert.equal(v.paused, false);
    });
  }
});

describe('viewer script: help dialog', () => {
  for (const modal of [true, false]) {
    const mode = modal ? 'showModal' : 'fallback';

    test(`${mode}: Close button closes, returns focus to the opener, and resumes`, () => {
      const v = boot({ modal, reduced: false });
      v.ids['help-open'].focus();
      v.ids['help-open'].fire('click');
      assert.equal(v.focused, v.ids['help-close']);
      assert.equal(v.paused, true);
      v.ids['help-close'].fire('click');
      assert.equal(modal ? v.help.open : 'open' in v.help.attrs, false);
      assert.equal(v.focused, v.ids['help-open']);
      assert.equal(v.paused, false);
    });

    test(`${mode}: every shortcut except Esc is inert while open`, async () => {
      const v = boot({ modal, hash: '#3', reduced: false });
      v.key('?');
      for (const k of ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', ' ', 'Home', 'End', 'p', 'k', 'd', 'D', '?']) {
        const r = v.key(k);
        assert.equal(r.prevented, false, `${k} not swallowed`);
      }
      v.key(' ', { shiftKey: true });
      await v.settle();
      assert.equal(v.active, 2);
      assert.equal(v.saved.length, 0);
      assert.equal(v.status.textContent, '');
      assert.equal(v.paused, true, 'p while open did not toggle anything visible');
      if (modal) v.help.close(); else v.key('Escape');
      assert.equal(v.paused, false, 'p while open did not leave a user pause behind');
    });

    test(`${mode}: opened from the page body (no opener to refocus), "Esc"/close still works`, () => {
      const v = boot({ modal });
      v.key('?');
      assert.equal(v.focused, v.ids['help-close']);
      assert.doesNotThrow(() => { if (modal) v.help.close(); else v.key('Esc'); });
      assert.equal(modal ? v.help.open : 'open' in v.help.attrs, false);
      v.key('ArrowRight');
      assert.equal(v.active, 1, 'shortcuts work again');
    });
  }

  test('showModal: Esc is left to the browser (no double close)', () => {
    const v = boot({ modal: true });
    v.key('?');
    const r = v.key('Escape');
    assert.equal(r.prevented, false);
    assert.equal(v.closes.length, 0);
    assert.equal(v.help.open, true);
  });

  test('fallback: dialog gets the .fallback class and the open attribute; Esc is consumed', () => {
    const v = boot({ modal: false });
    v.key('?');
    assert.equal(v.help.classList.contains('fallback'), true);
    assert.equal(v.help.attrs.open, '');
    assert.equal(v.key('Escape').prevented, true);
    assert.equal('open' in v.help.attrs, false);
  });

  test('opening twice is a no-op and keeps the original opener', () => {
    const v = boot({ modal: false });
    v.ids['dl-svg'].focus();
    v.key('?');
    v.ids['help-open'].fire('click');
    v.key('Escape');
    assert.equal(v.focused, v.ids['dl-svg']);
  });
});

describe('viewer script: keyboard', () => {
  test('Alt/Ctrl/Meta combos are ignored entirely', async () => {
    const v = boot({ hash: '#3' });
    for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
      for (const k of ['ArrowRight', 'ArrowLeft', ' ', 'Home', 'End', 'd', '?', 'PageDown']) {
        assert.equal(v.key(k, { [mod]: true }).prevented, false, `${mod}+${k}`);
      }
    }
    await v.settle();
    assert.equal(v.active, 2);
    assert.equal(v.saved.length, 0);
    assert.equal(v.help.open, false);
  });

  test('Space / Shift+Space on any toolbar button or the pause button never navigates', () => {
    const v = boot({ hash: '#3', reduced: false });
    for (const id of ['dl-png', 'dl-svg', 'share', 'help-open', 'pause']) {
      for (const shiftKey of [false, true]) {
        const r = v.doc.fire('keydown', { key: ' ', shiftKey, target: v.ids[id] });
        assert.equal(r.prevented, false, `${id}: default activation kept`);
        const r2 = v.doc.fire('keydown', { key: 'Spacebar', shiftKey, target: v.ids[id] });
        assert.equal(r2.prevented, false);
      }
    }
    assert.equal(v.active, 2);
  });

  test('Space elsewhere navigates (incl. on a focused tap zone), and keyup on tap zones is swallowed', () => {
    const v = boot();
    v.key(' ');
    assert.equal(v.active, 1);
    v.doc.fire('keydown', { key: ' ', target: v.ids.prev });
    assert.equal(v.active, 2);
    v.doc.fire('keydown', { key: ' ', shiftKey: true, target: v.ids.next });
    assert.equal(v.active, 1);
    assert.equal(v.doc.fire('keyup', { key: ' ', target: v.ids.prev }).prevented, true);
    assert.equal(v.doc.fire('keyup', { key: ' ', target: v.ids['dl-png'] }).prevented, false);
  });

  test('arrow keys still navigate while a toolbar button has focus', () => {
    const v = boot();
    v.ids['dl-png'].focus();
    v.key('ArrowRight');
    assert.equal(v.active, 1);
  });

  test('shortcuts are ignored while typing in a text field (WCAG 2.1.4)', () => {
    const v = boot({ reduced: false });
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'DIV', isContentEditable: true }]) {
      for (const k of ['d', '?', 'p', 'ArrowRight', ' ']) {
        assert.equal(v.doc.fire('keydown', { key: k, target }).prevented, false, `${k} in ${target.tagName}`);
      }
    }
    assert.equal(v.images, 0, 'no download started');
    assert.equal(v.help.open, false);
    assert.equal(v.paused, false);
    assert.equal(v.active, 0);
    v.key('d');
    assert.equal(v.images, 1, 'D works elsewhere');
  });

  test('a tap still navigates by x position: left third back, the rest forward', () => {
    const v = boot({ hash: '#3' });
    const tap = (x) => {
      v.story.fire('pointerdown', { pointerId: 1, clientX: x, clientY: 80, pointerType: 'touch', target: v.slides[0] });
      v.story.fire('pointerup', { pointerId: 1, clientX: x, clientY: 80 });
    };
    tap(80);
    assert.equal(v.active, 3);
    tap(10);
    assert.equal(v.active, 2);
  });
});

describe('viewer script: no cards', () => {
  test('boots without throwing and disables every toolbar action', () => {
    const v = boot({ n: 0 });
    for (const id of ['dl-png', 'dl-svg', 'share', 'help-open']) assert.equal(v.ids[id].disabled, true, id);
    v.key('d');
    v.key('?');
    assert.equal(v.saved.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe('viewer polish fixes', () => {
  test('share: the current card PNG is pre-rendered, so a click shares the file synchronously', async () => {
    const { nav, calls } = fakeNav();
    const v = boot({ nav, hash: '#2' });
    v.flushTimers(); // the post-navigation pre-render
    await v.settle();
    v.ids.share.fire('click');
    assert.equal(calls.length, 1, 'navigator.share called inside the click');
    assert.equal(calls[0].files[0].name, '02-c2.png');
    assert.ok(!('url' in calls[0]));
    // Navigating replaces the cached card (only the current one is kept).
    await v.settle();
    v.key('ArrowRight');
    v.flushTimers();
    await v.settle();
    const before = v.images;
    v.ids.share.fire('click');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].files[0].name, '03-c3.png');
    assert.equal(v.images, before, 'no re-render on click');
  });

  test('share: focusing / pointing at the Share button warms the cache', async () => {
    for (const type of ['focus', 'pointerenter', 'pointerdown']) {
      const { nav, calls } = fakeNav();
      const v = boot({ nav });
      v.ids.share.fire(type);
      await v.settle();
      v.ids.share.fire('click');
      assert.equal(calls.length, 1, type);
      assert.equal(calls[0].files[0].name, '01-c1.png');
    }
  });

  test('share: NotAllowedError on a synchronous (cached) share says "Sharing failed"', async () => {
    const { nav } = fakeNav({ share: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
    const v = boot({ nav });
    v.ids.share.fire('focus');
    await v.settle();
    v.ids.share.fire('click');
    await v.settle();
    assert.equal(v.status.textContent, 'Sharing failed');
  });

  test('share: no pre-rendering at all when navigator.share is missing', async () => {
    const v = boot({ hash: '#3' });
    v.key('ArrowRight');
    v.flushTimers();
    await v.settle();
    assert.equal(v.images, 0);
  });

  test('held-down D / ? (key repeat) do nothing', async () => {
    const v = boot();
    v.key('d', { repeat: true });
    v.key('D', { repeat: true });
    v.key('?', { repeat: true });
    await v.settle();
    assert.equal(v.saved.length, 0);
    assert.equal(v.help.open, false);
  });

  test('fallback dialog: page regions inert + aria-hidden while open; story taps ignored', () => {
    const v = boot({ modal: false, reduced: false });
    const regions = ['page-top', 'page-main', 'page-foot'].map((id) => v.ids[id]);
    v.key('?');
    for (const r of regions) {
      assert.equal(r.attrs.inert, '');
      assert.equal(r.attrs['aria-hidden'], 'true');
    }
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, clientX: 80, clientY: 50 });
    assert.equal(v.active, 0, 'tap behind the dialog does not navigate');
    assert.equal(v.story.fire('click', { target: v.ids.next }).prevented, true, 'clicks on tap zones swallowed');
    v.ids['dl-svg'].fire('click');
    assert.equal(v.saved.length, 0, 'toolbar actions do nothing behind the dialog');
    v.doc.fire('focusin', { target: v.ids['dl-png'] });
    assert.equal(v.focused, v.ids['help-close'], 'focus is kept inside the fallback dialog');
    v.ids['dl-png'].focus(); // simulate focus leaving to the body
    v.body.focus();
    v.help.fire('focusout');
    v.flushTimers();
    assert.equal(v.focused, v.ids['help-close'], 'blurring to the body returns focus to the dialog');
    v.key('Escape');
    for (const r of regions) {
      assert.ok(!('inert' in r.attrs));
      assert.ok(!('aria-hidden' in r.attrs));
    }
  });

  test('showModal: page regions are left alone (the browser makes them inert)', () => {
    const v = boot({ modal: true });
    v.key('?');
    assert.ok(!('inert' in v.ids['page-main'].attrs));
  });

  for (const modal of [true, false]) {
    test(`help (${modal ? 'showModal' : 'fallback'}): with no usable opener, focus goes to the ? button`, () => {
      // Opened from the body…
      let v = boot({ modal });
      v.key('?');
      if (modal) v.help.close(); else v.key('Escape');
      assert.equal(v.focused, v.ids['help-open']);
      // …or from a control that is hidden by the time the dialog closes.
      v = boot({ modal });
      v.ids['dl-svg'].focus();
      v.key('?');
      v.ids['dl-svg'].hidden = true;
      v.ids['help-close'].fire('click');
      assert.equal(v.focused, v.ids['help-open']);
    });
  }

  test('pause toggles the user pause itself, even while another reason keeps the story paused', () => {
    const v = boot({ reduced: false });
    v.doc.hidden = true;
    v.doc.fire('visibilitychange');
    assert.equal(v.paused, true);
    v.key('p'); // user pause on top of the hidden-tab pause
    assert.equal(v.ids.pause.getAttribute('aria-label'), 'Play');
    v.doc.hidden = false;
    v.doc.fire('visibilitychange');
    assert.equal(v.paused, true, 'the user pause survives');
    v.key('p');
    assert.equal(v.paused, false);
    assert.equal(v.ids.pause.getAttribute('aria-label'), 'Pause');
  });

  test('help: the P / K row is hidden while auto-advance is off and follows the media query', () => {
    const v = boot({ reduced: true });
    const row = v.ids['help-pause-row'];
    assert.equal(row.hidden, true);
    v.mq.matches = false;
    v.mq.fire('change', { matches: false });
    assert.equal(row.hidden, false);
    v.mq.matches = true;
    v.mq.fire('change', { matches: true });
    assert.equal(row.hidden, true);
  });
});

describe('tap zones do not block card tooltips (loop 025)', () => {
  const css = inline(html, 'style')[0];

  test('hover-capable pointers: tap zones are pointer-events:none, the story shows the pointer cursor', () => {
    assert.ok(css.includes('@media (any-hover:hover){.story{cursor:pointer}.nav{pointer-events:none}}'));
    // Touch-only devices keep the tap zones as hit targets: the base rule has no pointer-events.
    const base = /\.nav\{[^}]*\}/.exec(css)[0];
    assert.doesNotMatch(base, /pointer-events/);
    // The tap zones are still in the markup, focusable buttons for keyboard / AT.
    assert.match(html, /<button type="button" class="nav prev" id="prev" aria-label="Previous card"><\/button>/);
    assert.match(html, /<button type="button" class="nav next" id="next" aria-label="Next card"><\/button>/);
  });

  test('a mouse click on the card itself (the SVG, not a tap zone) navigates by x-position', () => {
    const v = boot();
    const svg = v.slides[0];
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, target: svg, clientX: 80, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, target: svg, clientX: 80, clientY: 50 });
    assert.equal(v.active, 1, 'right two thirds: next');
    assert.equal(v.story.fire('click', { target: svg }).prevented, true, 'the follow-up click is swallowed');
    v.story.fire('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, target: v.slides[1], clientX: 10, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 2, target: v.slides[1], clientX: 10, clientY: 50 });
    assert.equal(v.active, 0, 'left third: previous');
  });

  test('keyboard arrows and tap-zone activation (keyboard / AT click) still navigate', () => {
    const v = boot();
    v.key('ArrowRight');
    assert.equal(v.active, 1);
    v.key('ArrowLeft');
    assert.equal(v.active, 0);
    v.ids.next.fire('click');
    assert.equal(v.active, 1);
    v.ids.prev.fire('click');
    assert.equal(v.active, 0);
  });
});

describe('tap zones vs tooltips: tester edge cases (loop 025)', () => {
  const css = inline(html, 'style')[0];

  test('the hover rule comes after the base .nav rules and nothing re-enables pointer-events on .nav', () => {
    const hoverAt = css.indexOf('@media (any-hover:hover){');
    assert.ok(hoverAt > css.indexOf('.nav.next{'), 'cascade: hover rule wins over base .nav rules');
    const navPe = [...css.matchAll(/\.nav[^{]*\{[^}]*pointer-events:([a-z]+)/g)].map((m) => m[1]);
    assert.deepEqual(navPe, ['none'], 'only the hover rule sets pointer-events on .nav');
    // The slides / story never swallow pointer events themselves (tooltips need the SVG hit).
    assert.doesNotMatch(css, /\.(slide|story)\{[^}]*pointer-events:none/);
  });

  test('a touch tap on the SVG (hybrid hover-capable device) still navigates', () => {
    const v = boot();
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'touch', target: v.slides[0], clientX: 70, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, target: v.slides[0], clientX: 70, clientY: 50 });
    assert.equal(v.active, 1);
  });

  test('right / middle mouse buttons on the SVG do not navigate', () => {
    const v = boot();
    for (const button of [1, 2]) {
      v.story.fire('pointerdown', { pointerId: 5 + button, pointerType: 'mouse', button, target: v.slides[0], clientX: 80, clientY: 50 });
      v.story.fire('pointerup', { pointerId: 5 + button, target: v.slides[0], clientX: 80, clientY: 50 });
    }
    assert.equal(v.active, 0);
  });

  test('a mouse drag over the SVG (e.g. selecting / moving to a tooltip) is not a tap', () => {
    const v = boot();
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, target: v.slides[0], clientX: 50, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, target: v.slides[0], clientX: 50, clientY: 75 });
    assert.equal(v.active, 0);
  });

  test('the left-third boundary: x exactly at width/3 goes forward, just below goes back', () => {
    const v = boot();
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, target: v.slides[0], clientX: 30, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, target: v.slides[0], clientX: 30, clientY: 50 });
    assert.equal(v.active, 1, 'x=30 of 90 → next (matches the 66.667% next zone)');
    v.story.fire('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, target: v.slides[1], clientX: 29, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 2, target: v.slides[1], clientX: 29, clientY: 50 });
    assert.equal(v.active, 0);
  });

  test('a mouse click on the SVG navigates exactly once (pointerup, then the swallowed click)', () => {
    const v = boot();
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, target: v.slides[0], clientX: 80, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 1, target: v.slides[0], clientX: 80, clientY: 50 });
    const r = v.story.fire('click', { target: v.slides[0] });
    assert.equal(r.prevented, true);
    assert.equal(v.active, 1, 'not advanced twice');
  });
});
