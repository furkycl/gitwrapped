// End-to-end tests through the real binary (`node bin/gitwrapped.js ...`) against the
// deterministic fixture repo, plus static checks on the viewer's inline script.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CARD_IDS } from '../src/cards/index.js';
import { buildCards } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { buildViewerHtml } from '../src/viewer.js';
import { pngSize } from '../src/png.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const CARD_FILES = CARD_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`);

function withoutColorEnv(env) {
  const copy = { ...env };
  delete copy.FORCE_COLOR;
  delete copy.NO_COLOR;
  return copy;
}

// TZ=UTC so a bare --since date means UTC midnight regardless of the machine's zone.
// PNG rendering is slow-ish, so runs pass --no-png unless `png: true` (the full run).
function bin(args, env = {}, { png = false } = {}) {
  return spawnSync(process.execPath, [BIN, ...args, ...(png ? [] : ['--no-png'])], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...withoutColorEnv(process.env), TZ: 'UTC', ...env },
  });
}

let fixture;
let tmp;
before(() => {
  fixture = makeFixtureRepo();
  tmp = mkdtempSync(join(tmpdir(), 'gw-e2e-'));
});
after(() => {
  fixture?.cleanup();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

/** The inline SVGs in page order, as they appear in the HTML. */
function embeddedSvgs(page) {
  return [...page.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
}

describe('bin: full run on the fixture repo', () => {
  let r;
  let out;
  let page;
  before(() => {
    out = join(tmp, 'full');
    r = bin([fixture.dir, '--out', out], {}, { png: true });
    page = existsSync(join(out, 'wrapped.html')) ? readFileSync(join(out, 'wrapped.html'), 'utf8') : '';
  });

  test('exits 0 with a summary on stdout and nothing on stderr', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^gitwrapped: 8 commits → /);
    assert.ok(r.stdout.includes(join(out, 'wrapped.html')), r.stdout);
    assert.ok(r.stdout.includes(`9 cards in ${join(out, 'cards')}\n`), r.stdout);
    assert.ok(!r.stdout.includes('\x1b'), 'no ANSI escapes when piped');
  });

  test('writes cards/01-intro.svg .. 09-outro.svg', () => {
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), CARD_FILES);
    assert.equal(CARD_FILES[0], '01-intro.svg');
    assert.equal(CARD_FILES[4], '05-activity.svg');
    assert.equal(CARD_FILES[8], '09-outro.svg');
    for (const f of CARD_FILES) {
      assert.ok(statSync(join(out, 'cards', f)).size > 0, `${f} is non-empty`);
    }
  });

  test('writes png/01-intro.png .. 09-outro.png at 1080x1920 and share.png at 1200x630', () => {
    const pngs = CARD_FILES.map((f) => f.replace(/\.svg$/, '.png'));
    assert.deepEqual(readdirSync(join(out, 'png')).sort(), pngs);
    for (const f of pngs) assert.deepEqual(pngSize(readFileSync(join(out, 'png', f))), { width: 1080, height: 1920 }, f);
    assert.deepEqual(pngSize(readFileSync(join(out, 'share.png'))), { width: 1200, height: 630 });
    assert.match(readFileSync(join(out, 'share.svg'), 'utf8'), /^<svg [^>]*width="1200" height="630"/);
    assert.ok(r.stdout.includes(`share image: ${join(out, 'share.png')}`), r.stdout);
    assert.ok(r.stdout.includes(`9 PNGs in ${join(out, 'png')}`), r.stdout);
  });

  test('wrapped.html inlines all 9 SVGs', () => {
    assert.match(page, /^<!doctype html>/);
    assert.equal((page.match(/<svg\b/g) ?? []).length, 9);
    assert.equal(embeddedSvgs(page).length, 9);
  });

  test('wrapped.html makes no external requests and has a CSP', () => {
    assert.doesNotMatch(page, /src="http/i);
    assert.doesNotMatch(page, /href="http/i);
    assert.doesNotMatch(page, /url\(\s*['"]?http/i);
    assert.doesNotMatch(page, /@import/i);
    assert.doesNotMatch(page, /<script\b[^>]*\bsrc\s*=/i);
    assert.doesNotMatch(page, /<link\b/i);
    assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'[^"]*">/);
  });

  test('cards/*.svg are byte-identical to the SVGs embedded in the HTML (modulo injected a11y attrs)', () => {
    const embedded = embeddedSvgs(page);
    CARD_FILES.forEach((f, i) => {
      const file = readFileSync(join(out, 'cards', f), 'utf8');
      // The viewer only adds role/aria-label when missing; cards already carry both,
      // so the inlined markup should equal the file (minus an XML prolog / trailing ws).
      const normalized = file.replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
      assert.equal(embedded[i], normalized, `${f} matches embedded card ${i + 1}`);
    });
  });

  test('slides are in CARD_IDS order', () => {
    const ids = [...page.matchAll(/<section class="slide[^"]*" id="card-\d+" data-card="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, CARD_IDS);
  });

  test('running twice into the same --out overwrites cleanly', () => {
    const before = Object.fromEntries(CARD_FILES.map((f) => [f, readFileSync(join(out, 'cards', f))]));
    const htmlBefore = readFileSync(join(out, 'wrapped.html'));
    // Leave junk in a card to prove it is overwritten, not appended to.
    writeFileSync(join(out, 'cards', CARD_FILES[0]), 'garbage');
    const r2 = bin([fixture.dir, '--out', out]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stderr, '');
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), CARD_FILES);
    for (const f of CARD_FILES) assert.ok(readFileSync(join(out, 'cards', f)).equals(before[f]), `${f} identical on rerun`);
    assert.ok(readFileSync(join(out, 'wrapped.html')).equals(htmlBefore), 'wrapped.html identical on rerun');
  });
});

describe('bin: filtering', () => {
  // Fixture author dates in UTC (oldest first):
  //   03-04 09:00 ada | 03-05 13:30 bob | 03-06 22:45 ada | 03-09 10:00 bob
  //   03-10 10:15 ada | 03-11 09:00 bob | 03-12 10:50 ada | 03-13 12:00 bob
  const cases = [
    [['--author', 'bob@example.com'], 4],
    [['--author', 'ADA@Example.com'], 4],
    [['--since', '2024-03-10'], 4],
    [['--since', '2024-03-12'], 2],
    [['--since', '2024-03-14'], 0],
    [['--since', '2024-03-10', '--author', 'bob@example.com'], 2],
  ];
  for (const [args, n] of cases) {
    test(`${args.join(' ')} → ${n} commits`, (t) => {
      const out = mkdtempSync(join(tmp, 'filter-'));
      t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
      const r = bin([fixture.dir, ...args, '--out', out]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`^gitwrapped: ${n} commits? → `));
      assert.deepEqual(readdirSync(join(out, 'cards')).sort(), CARD_FILES);
      assert.ok(existsSync(join(out, 'wrapped.html')));
    });
  }

  test('a filtered run reports a different total than the full run in the HTML', (t) => {
    const outAll = mkdtempSync(join(tmp, 'all-'));
    const outBob = mkdtempSync(join(tmp, 'bob-'));
    t.after(() => {
      rmSync(outAll, { recursive: true, force: true, maxRetries: 5 });
      rmSync(outBob, { recursive: true, force: true, maxRetries: 5 });
    });
    assert.equal(bin([fixture.dir, '--out', outAll]).status, 0);
    assert.equal(bin([fixture.dir, '--author', 'bob@example.com', '--out', outBob]).status, 0);
    const a = readFileSync(join(outAll, 'cards', '02-totals.svg'), 'utf8');
    const b = readFileSync(join(outBob, 'cards', '02-totals.svg'), 'utf8');
    assert.notEqual(a, b);
  });
});

describe('bin: errors', () => {
  test('an existing dir that is not a git repo → exit 1, "not a git repository", out not created', (t) => {
    const dir = mkdtempSync(join(tmp, 'norepo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
    const out = join(dir, 'out');
    const r = bin([dir, '--out', out], { GIT_CEILING_DIRECTORIES: tmp });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gitwrapped: not a git repository/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    assert.equal(existsSync(out), false);
  });

  test('--out pointing at an existing FILE → exit 1, one-line message, no stack trace', (t) => {
    const file = join(tmp, 'out-is-a-file');
    writeFileSync(file, 'keep me');
    t.after(() => rmSync(file, { force: true }));
    const r = bin([fixture.dir, '--out', file]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gitwrapped: /);
    assert.equal(r.stderr, `gitwrapped: output path is not a directory: ${file}\n`);
    assert.equal(r.stderr.trim().split('\n').length, 1, `single line: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    assert.equal(readFileSync(file, 'utf8'), 'keep me', 'file untouched');
  });

  test('--out below an existing file → exit 1, no stack trace', (t) => {
    const file = join(tmp, 'parent-is-a-file');
    writeFileSync(file, 'x');
    t.after(() => rmSync(file, { force: true }));
    const r = bin([fixture.dir, '--out', join(file, 'sub')]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: output path is not a directory: ${file} (needed for ${join(file, 'sub')})\n`);
  });

  test('wrapped.html path occupied by a directory → exit 1, no stack trace', (t) => {
    const out = mkdtempSync(join(tmp, 'occupied-'));
    t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
    mkdirSync(join(out, 'wrapped.html'));
    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: cannot write ${join(out, 'wrapped.html')}: a directory is in the way\n`);
    assert.equal(existsSync(join(out, 'cards')), false, 'no half-written card set');
  });

  test('<out>/png occupied by a file → exit 1 before anything is written (PNG export on)', (t) => {
    const out = mkdtempSync(join(tmp, 'pngfile-'));
    t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
    writeFileSync(join(out, 'png'), 'x');
    const r = bin([fixture.dir, '--out', out], {}, { png: true });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: cannot write PNGs: ${join(out, 'png')} exists and is not a directory\n`);
    assert.equal(existsSync(join(out, 'cards')), false);
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });

  test('<out>/cards occupied by a file → exit 1, clear message, nothing written', (t) => {
    const out = mkdtempSync(join(tmp, 'cardsfile-'));
    t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
    writeFileSync(join(out, 'cards'), 'x');
    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: cannot write cards: ${join(out, 'cards')} exists and is not a directory\n`);
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });

  test('a card file occupied by a directory → exit 1 before anything is written', (t) => {
    const out = mkdtempSync(join(tmp, 'cardisdir-'));
    t.after(() => rmSync(out, { recursive: true, force: true, maxRetries: 5 }));
    mkdirSync(join(out, 'cards', CARD_FILES[3]), { recursive: true });
    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: cannot write ${join(out, 'cards', CARD_FILES[3])}: a directory is in the way\n`);
    assert.deepEqual(readdirSync(join(out, 'cards')), [CARD_FILES[3]]);
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });

  test('--out under a non-directory pseudo path fails fast instead of hanging', { skip: !existsSync('/proc/self') }, () => {
    const r = spawnSync(process.execPath, [BIN, fixture.dir, '--out', '/proc/self/gw-nope/out'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' }, timeout: 15000,
    });
    assert.equal(r.error, undefined, 'did not time out');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^gitwrapped: (output directory is not writable|cannot create output directory)/);
    assert.equal(r.stderr.trim().split('\n').length, 1);
  });
});

describe('viewer inline script', () => {
  const cards = buildCards(computeStats([], { today: '2024-03-14' }), { repoName: 'demo' });
  const html = buildViewerHtml(cards, { title: 'demo' });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  test('there is exactly one inline script and it parses', () => {
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'viewer-inline.js' }));
  });

  test('the script passes `node --check`', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-check-'));
    t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
    const file = join(dir, 'viewer.cjs');
    writeFileSync(file, scripts[0]);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  test('script is not prematurely closed by card content', () => {
    // Everything after the single <script> open tag up to </body> is the script + close.
    assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  });

  test('hash deep link: reads location.hash, parses #N, writes back via replaceState', () => {
    const s = scripts[0];
    assert.match(s, /location\.hash/);
    assert.match(s, /hashchange/);
    assert.match(s, /history\.replaceState/);
    // The regex in the source must survive the template literal as /^#(\d+)$/.
    assert.ok(s.includes('/^#(\\d+)$/'), 'hash regex keeps its backslash');
  });

  // Minimal DOM stub: enough for the IIFE to run, with listeners recorded so tests can
  // dispatch events. `reduced` is the prefers-reduced-motion match.
  function boot({ hash = '', reduced = true, png = 'ok', share = null, modal = true } = {}) {
    let focused = null;
    function el(extra = {}) {
      const classes = new Set();
      const attrs = {};
      const listeners = {};
      return {
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          toggle: (c, on) => (on ?? !classes.has(c) ? classes.add(c) : classes.delete(c)),
          contains: (c) => classes.has(c),
        },
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => attrs[k] ?? null,
        removeAttribute: (k) => { delete attrs[k]; },
        focus() { focused = this; },
        disabled: false,
        addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
        fire(type, ev = {}) {
          const e = { type, target: this, preventDefault() {}, stopPropagation() {}, ...ev };
          for (const fn of listeners[type] ?? []) fn(e);
          return e;
        },
        offsetWidth: 0,
        hidden: false,
        textContent: '',
        attrs,
        ...extra,
      };
    }
    const n = 8;
    const svgEl = { viewBox: { baseVal: { width: 1080, height: 1920 } }, cloneNode: () => el({ tag: 'svg' }) };
    const slides = Array.from({ length: n }, (_, i) => el({ i, querySelector: () => svgEl }));
    slides.forEach((s, i) => { s.setAttribute('data-title', `T${i + 1}`); s.setAttribute('data-card', `c${i + 1}`); });
    const bars = Array.from({ length: n }, () => el());
    const captured = [];
    const story = el({
      querySelectorAll: (sel) => (sel === '.slide' ? slides : bars),
      setPointerCapture: (id) => captured.push(id),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 90, bottom: 160, width: 90, height: 160 }),
    });
    const status = el();
    const pause = el();
    const help = el({
      showModal() { if (!modal) throw new Error('no modal'); this.open = true; },
      close() { this.open = false; this.fire('close'); },
      open: false,
    });
    const ids = {
      story, status, pause, prev: el(), next: el(), count: el(), help,
      'dl-png': el(), 'dl-svg': el(), share: el(), 'help-open': el(), 'help-close': el(),
    };
    const saved = []; // [filename, blob] from <a download> clicks
    const revoked = [];
    let urls = 0;
    class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }
    class Image {
      set src(v) {
        this.url = v;
        queueMicrotask(() => (png === 'decode-error' ? this.onerror() : this.onload()));
      }
    }
    const shares = [];
    const replaced = [];
    const timers = [];
    const mq = el({ matches: reduced });
    const body = el({ appendChild() {} });
    const doc = el({
      getElementById: (id) => ids[id],
      hidden: false,
      body,
      title: 'demo',
      createElement(tag) {
        if (tag === 'canvas') {
          return {
            getContext: () => ({ drawImage() {} }),
            toBlob: (cb, type) => queueMicrotask(() => cb(png === 'null-blob' ? null : new Blob(['png'], { type }))),
          };
        }
        const a = el({ tag });
        a.click = () => saved.push([a.download, blobs.get(a.href)]);
        a.remove = () => {};
        return a;
      },
    });
    // (a getter inside el()'s spread would be evaluated once, so define it afterwards)
    Object.defineProperty(doc, 'activeElement', { get: () => focused ?? body });
    const blobs = new Map();
    const ctx = {
      document: doc,
      XMLSerializer: class { serializeToString(node) { return `<svg xmlns="ns" data-tag="${node.tag}"/>`; } },
      URL: {
        createObjectURL: (b) => { const u = `blob:${++urls}`; blobs.set(u, b); return u; },
        revokeObjectURL: (u) => revoked.push(u),
      },
      Blob,
      Image,
      File: class extends Blob { constructor(parts, name, opts) { super(parts, opts); this.name = name; } },
      encodeURIComponent,
      Promise,
      String,
      ...(share ? { navigator: { share: (d) => { shares.push(d); return share(d); }, canShare: () => true } } : {}),
      window: { matchMedia: () => mq, addEventListener() {} },
      location: { hash },
      history: { replaceState: (_a, _b, h) => replaced.push(h) },
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout: (id) => { if (id) timers[id - 1] = null; },
      Date,
    };
    vm.runInNewContext(scripts[0], ctx);
    return {
      slides, bars, story, status, pause, doc, mq, captured, replaced, ids, help, saved, revoked, shares,
      get focused() { return focused; },
      get active() { return slides.findIndex((s) => s.classList.contains('active')); },
      get paused() { return story.classList.contains('paused'); },
      flushTimers() { const fns = timers.splice(0); for (const fn of fns) fn?.(); },
      settle() { return new Promise((res) => setImmediate(res)); },
      key(k) { doc.fire('keydown', { key: k, target: { tagName: 'BODY' } }); },
    };
  }

  test('deep link logic clamps #N into range (run with a tiny DOM stub)', () => {
    assert.equal(boot().active, 0);
    assert.equal(boot({ hash: '#3' }).active, 2);
    assert.equal(boot({ hash: '#99' }).active, 7);
    assert.equal(boot({ hash: '#0' }).active, 0);
    assert.equal(boot({ hash: '#abc' }).active, 0);
    assert.deepEqual(boot().replaced, ['#1']);
    assert.deepEqual(boot({ hash: '#5' }).replaced, []);
  });

  test('live region announces user navigation only, not the initial render or auto-advance', () => {
    const v = boot({ hash: '#3', reduced: false });
    assert.equal(v.status.textContent, '', 'initial render is quiet');
    v.bars[2].fire('animationend');
    assert.equal(v.active, 3, 'auto-advanced');
    assert.equal(v.status.textContent, '', 'auto-advance is quiet');
    v.key('ArrowRight');
    assert.equal(v.active, 4);
    assert.equal(v.status.textContent, 'Card 5 of 8: T5');
    v.key('Home');
    assert.equal(v.status.textContent, 'Card 1 of 8: T1');
  });

  test('hold pauses; pointer capture is taken; lostpointercapture / pointercancel end the hold', () => {
    for (const end of ['lostpointercapture', 'pointercancel']) {
      const v = boot({ reduced: false });
      v.story.fire('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 80, clientY: 50 });
      assert.deepEqual(v.captured, [7]);
      v.flushTimers();
      assert.equal(v.paused, true, 'held → paused');
      v.story.fire(end, { pointerId: 7, clientX: 500, clientY: 500 });
      assert.equal(v.paused, false, `${end} → resumed`);
      assert.equal(v.active, 0, `${end} does not navigate`);
    }
  });

  test('a hold released by pointerup resumes without navigating; a tap navigates by zone', () => {
    const v = boot({ reduced: false });
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 50 });
    v.flushTimers();
    v.story.fire('pointerup', { pointerId: 1, clientX: 80, clientY: 50 });
    assert.equal(v.paused, false);
    assert.equal(v.active, 0);
    v.story.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 2, clientX: 80, clientY: 50 });
    assert.equal(v.active, 1, 'right-zone tap → next');
    assert.equal(v.status.textContent, 'Card 2 of 8: T2');
    v.story.fire('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 3, clientX: 10, clientY: 50 });
    assert.equal(v.active, 0, 'left-zone tap → prev');
    v.story.fire('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 80, clientY: 50 });
    v.story.fire('pointerup', { pointerId: 4, clientX: 20, clientY: 55 });
    assert.equal(v.active, 1, 'leftward swipe → next');
  });

  test('visibilitychange keeps the story paused while it is still held', () => {
    const v = boot({ reduced: false });
    v.story.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 50 });
    v.flushTimers();
    v.doc.hidden = true;
    v.doc.fire('visibilitychange');
    assert.equal(v.paused, true);
    v.doc.hidden = false;
    v.doc.fire('visibilitychange');
    assert.equal(v.paused, true, 'still held → still paused');
    v.story.fire('pointerup', { pointerId: 1, clientX: 80, clientY: 50 });
    assert.equal(v.paused, false);
    v.key('p');
    v.doc.hidden = true;
    v.doc.fire('visibilitychange');
    v.doc.hidden = false;
    v.doc.fire('visibilitychange');
    assert.equal(v.paused, true, 'user pause survives visibility changes');
  });

  test('reacts to prefers-reduced-motion changes', () => {
    const v = boot({ reduced: true });
    assert.equal(v.story.classList.contains('auto'), false);
    assert.equal(v.pause.hidden, true);
    v.mq.matches = false;
    v.mq.fire('change', { matches: false });
    assert.equal(v.story.classList.contains('auto'), true);
    assert.equal(v.pause.hidden, false);
    v.mq.matches = true;
    v.mq.fire('change', { matches: true });
    assert.equal(v.story.classList.contains('auto'), false);
    assert.equal(v.pause.hidden, true);
  });

  test('counter shows N / total and follows navigation', () => {
    const v = boot({ hash: '#2' });
    assert.equal(v.ids.count.textContent, '2 / 8');
    v.key('End');
    assert.equal(v.ids.count.textContent, '8 / 8');
  });

  test('"d" downloads the current card as NN-<id>.png, then revokes the blob URL', async () => {
    const v = boot({ hash: '#3', reduced: false });
    v.key('d');
    assert.equal(v.paused, true, 'auto-advance pauses while the action runs');
    assert.equal(v.ids['dl-png'].disabled, true);
    await v.settle();
    assert.equal(v.saved.length, 1);
    assert.equal(v.saved[0][0], '03-c3.png');
    assert.equal(v.saved[0][1].type, 'image/png');
    assert.equal(v.paused, false);
    assert.equal(v.ids['dl-png'].disabled, false);
    assert.equal(v.active, 2, 'an action does not navigate');
    assert.equal(v.status.textContent, 'Saved 03-c3.png');
    v.flushTimers();
    assert.deepEqual(v.revoked, ['blob:1']);
  });

  for (const png of ['decode-error', 'null-blob']) {
    test(`PNG failure (${png}) falls back to downloading the SVG`, async () => {
      const v = boot({ png });
      v.ids['dl-png'].fire('click');
      await v.settle();
      assert.equal(v.saved.length, 1);
      assert.equal(v.saved[0][0], '01-c1.svg');
      assert.equal(v.saved[0][1].type, 'image/svg+xml');
    });
  }

  test('Download SVG keeps the XML prolog and the serialized xmlns', () => {
    const v = boot({ hash: '#9' });
    v.ids['dl-svg'].fire('click');
    assert.equal(v.saved[0][0], '08-c8.svg');
    const text = v.saved[0][1].parts.join('');
    assert.match(text, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns=/);
  });

  test('Share is hidden without navigator.share; with it, prefers the PNG file and swallows AbortError', async () => {
    assert.equal(boot().ids.share.hidden, true);
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const v = boot({ share: () => Promise.reject(abort) });
    assert.equal(v.ids.share.hidden, false);
    v.ids.share.fire('click');
    await v.settle();
    assert.equal(v.shares.length, 1);
    assert.equal(v.shares[0].files[0].name, '01-c1.png');
    assert.equal(v.shares[0].text, 'demo — T1');
    assert.ok(!('url' in v.shares[0]), 'never shares a URL');
    assert.equal(v.status.textContent, '', 'AbortError is silent');
    assert.equal(v.ids.share.disabled, false);
  });

  for (const modal of [true, false]) {
    test(`"?" opens the help dialog (${modal ? 'showModal' : 'fallback'}); shortcuts are inert until Esc; focus returns`, () => {
      const v = boot({ reduced: false, modal });
      v.ids['help-open'].focus();
      v.key('?');
      assert.equal(modal ? v.help.open : v.help.attrs.open, modal ? true : '');
      assert.equal(v.focused, v.ids['help-close']);
      assert.equal(v.paused, true, 'auto-advance pauses behind the dialog');
      v.key('ArrowRight');
      v.key('d');
      assert.equal(v.active, 0);
      assert.equal(v.saved.length, 0);
      if (modal) v.help.close(); // the browser closes a modal dialog on Esc
      else v.key('Escape');
      assert.equal(v.help.attrs.open, undefined);
      assert.equal(v.focused, v.ids['help-open']);
      assert.equal(v.paused, false);
      v.key('ArrowRight');
      assert.equal(v.active, 1);
    });
  }

  test('Space on a toolbar button activates it instead of navigating; modifiers are ignored', () => {
    const v = boot();
    const btn = v.ids['dl-svg'];
    btn.classList.add('btn');
    v.doc.fire('keydown', { key: ' ', target: btn });
    assert.equal(v.active, 0);
    v.doc.fire('keydown', { key: 'd', ctrlKey: true, target: btn });
    v.doc.fire('keydown', { key: '?', metaKey: true, target: btn });
    assert.equal(v.help.open, false);
  });
});

describe('stale PNG cleanup', () => {
  test('a --no-png run removes PNGs left by an earlier run', async () => {
    const { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { makeFixtureRepo } = await import('../scripts/make-fixture-repo.js');
    const { generate } = await import('../src/cli.js');
    const fx = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-stale-'));
    try {
      mkdirSync(join(out, 'png'));
      writeFileSync(join(out, 'png', '01-intro.png'), 'old');
      writeFileSync(join(out, 'png', 'keep-me.txt'), 'user file');
      writeFileSync(join(out, 'share.png'), 'old');
      await generate({ path: fx.dir, out, png: false }, { today: '2024-03-14' });
      assert.equal(existsSync(join(out, 'share.png')), false);
      assert.equal(existsSync(join(out, 'png', '01-intro.png')), false);
      assert.equal(existsSync(join(out, 'png', 'keep-me.txt')), true);
      assert.equal(existsSync(join(out, 'share.svg')), true);
    } finally {
      rmSync(out, { recursive: true, force: true, maxRetries: 5 });
      fx.cleanup();
    }
  });
});
