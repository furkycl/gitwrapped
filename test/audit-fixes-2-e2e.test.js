// End-to-end checks for the loop-025 audit fixes, through the real binary
// (`node bin/gitwrapped.js`) on throwaway repos: output symlink safety (with --json /
// --no-png combos, dangling links, a symlinked --out), a first run into a user's folder
// deleting nothing, future-dated commits vs the current streak and calendar, --author on
// images, --open with a fake opener, and the viewer's CSP / a11y / escaping.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const tmpDirs = [];
function tmp(prefix = 'gw-a2e2e-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

function gitEnv(extra = {}) {
  const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return env;
}
const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });

/** A repo with one commit per entry: {date, subject?, email?, file?}. */
function makeRepo(commits) {
  const dir = tmp('gw-a2e2e-repo-');
  git(dir, ['init', '-q', '-b', 'main']);
  commits.forEach((c, i) => {
    const file = c.file ?? 'f.txt';
    writeFileSync(join(dir, file), `${i}\n`, { flag: 'a' });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', c.subject ?? `commit ${i}`], {
      GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: c.email ?? 'a@x.io', GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: c.email ?? 'a@x.io', GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00',
    });
  });
  return dir;
}

function cli(args, { env = {}, cwd } = {}) {
  const copy = { ...process.env, TZ: 'UTC', ...env };
  delete copy.FORCE_COLOR;
  delete copy.NO_COLOR;
  return spawnSync(process.execPath, [BIN, ...args, '--no-color'], { encoding: 'utf8', env: copy, cwd });
}

/** symlinkSync, or false when this platform / user may not create symlinks (Windows). */
function trySymlink(target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (err) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes(err?.code)) return false;
    throw err;
  }
}

/** Every file / link under `dir`, relative, sorted (does not follow symlinks). */
function listTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

let simpleRepo;
const repo = () => (simpleRepo ??= makeRepo([
  { date: '2026-01-05T12:00:00+00:00' },
  { date: '2026-01-06T12:00:00+00:00' },
]));

// ---------------------------------------------------------------------------
describe('output symlinks (real CLI)', () => {
  const VICTIM = 'precious\n';
  /** A fresh out dir next to a victim file / dir; returns paths. */
  function setup() {
    const base = tmp('gw-a2e2e-sl-');
    const out = join(base, 'out');
    mkdirSync(out);
    const victim = join(base, 'victim.txt');
    writeFileSync(victim, VICTIM);
    const vdir = join(base, 'vdir');
    mkdirSync(vdir);
    writeFileSync(join(vdir, '01-intro.png'), VICTIM);
    writeFileSync(join(vdir, '01-intro.svg'), VICTIM);
    return { base, out, victim, vdir };
  }

  // [name, link path inside out, link target kind, extra args, expect refusal]
  const CASES = [
    ['share.svg, --no-png', 'share.svg', 'file', ['--no-png'], true],
    ['wrapped.html, --no-png --json', 'wrapped.html', 'file', ['--no-png', '--json'], true],
    ['stats.json with --json', 'stats.json', 'file', ['--no-png', '--json'], true],
    ['stats.json without --json is left alone', 'stats.json', 'file', ['--no-png'], false],
    ['share.png with PNGs on', 'share.png', 'file', [], true],
    ['share.png with --no-png is left alone', 'share.png', 'file', ['--no-png'], false],
    ['cards/<file>.svg', 'cards/03-peak-hour.svg', 'file', ['--no-png'], true],
    ['cards/ as a dir symlink', 'cards', 'dir', ['--no-png', '--json'], true],
    ['png/<file>.png with PNGs on', 'png/01-intro.png', 'file', [], true],
    ['png/ as a dir symlink with PNGs on', 'png', 'dir', [], true],
    ['png/ as a dir symlink with --no-png is left alone', 'png', 'dir', ['--no-png'], false],
    ['dangling cards/', 'cards', 'dangling', ['--no-png'], true],
    ['dangling card file', 'cards/01-intro.svg', 'dangling', ['--no-png'], true],
    ['dangling wrapped.html', 'wrapped.html', 'dangling', ['--no-png', '--json'], true],
  ];
  for (const [name, rel, kind, args, refused] of CASES) {
    test(name, (t) => {
      const { base, out, victim, vdir } = setup();
      const link = join(out, rel);
      mkdirSync(join(link, '..'), { recursive: true });
      const target = kind === 'file' ? victim : kind === 'dir' ? vdir : join(base, 'missing', 'nowhere');
      if (!trySymlink(target, link, kind === 'dir' ? 'dir' : 'file')) return t.skip('symlinks not available');
      const r = cli([repo(), '--out', out, ...args]);
      if (refused) {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /refusing to write through a symlink/);
        assert.ok(r.stderr.includes(rel.split('/').pop()), r.stderr);
        // Nothing written at all, not even the files checked before the link.
        assert.ok(!existsSync(join(out, 'share.svg')) || lstatSync(join(out, 'share.svg')).isSymbolicLink());
      } else {
        assert.equal(r.status, 0, r.stderr);
      }
      assert.equal(readFileSync(victim, 'utf8'), VICTIM);
      assert.deepEqual(readdirSync(vdir).sort(), ['01-intro.png', '01-intro.svg']);
      assert.equal(readFileSync(join(vdir, '01-intro.png'), 'utf8'), VICTIM);
      assert.ok(!existsSync(join(base, 'missing')), 'a dangling link target was created');
      assert.ok(lstatSync(link).isSymbolicLink(), 'the symlink itself was removed');
    });
  }

  test('--out pointing to a symlinked directory is allowed and writes into the target', (t) => {
    const base = tmp('gw-a2e2e-outlink-');
    const real = join(base, 'real');
    mkdirSync(real);
    if (!trySymlink(real, join(base, 'out'), 'dir')) return t.skip('symlinks not available');
    const r = cli([repo(), '--out', join(base, 'out'), '--no-png', '--json']);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['wrapped.html', 'share.svg', 'stats.json']) assert.ok(existsSync(join(real, f)), f);
    assert.equal(readdirSync(join(real, 'cards')).length, 10);
  });

  test('second run into an owned folder: cleanup never follows or deletes symlinks', (t) => {
    const { out, victim, vdir } = setup();
    assert.equal(cli([repo(), '--out', out, '--no-png']).status, 0);
    if (!trySymlink(vdir, join(out, 'png'), 'dir')) return t.skip('symlinks not available');
    trySymlink(victim, join(out, 'share.png'), 'file');
    trySymlink(victim, join(out, 'cards', '08-intro.svg'), 'file'); // old-numbered name
    const r = cli([repo(), '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(victim, 'utf8'), VICTIM);
    assert.deepEqual(readdirSync(vdir).sort(), ['01-intro.png', '01-intro.svg']);
    for (const l of ['png', 'share.png', 'cards/08-intro.svg']) assert.ok(lstatSync(join(out, l)).isSymbolicLink(), l);
  });

  // The default --out "gitwrapped-out" is resolved against the cwd, which is usually the
  // analyzed repo. A repo can commit `gitwrapped-out` itself as a symlink (e.g. ->
  // ../elsewhere): the run refuses it (only a --out the user typed may be a symlink).
  test('a committed gitwrapped-out symlink (default --out) does not write or delete elsewhere', (t) => {
    const base = tmp('gw-a2e2e-evil-');
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(join(elsewhere, 'png'), { recursive: true });
    writeFileSync(join(elsewhere, 'share.svg'), VICTIM);
    writeFileSync(join(elsewhere, 'wrapped.html'), VICTIM);
    writeFileSync(join(elsewhere, 'share.png'), VICTIM);
    writeFileSync(join(elsewhere, 'png', '01-intro.png'), VICTIM);
    const src = join(base, 'src');
    mkdirSync(src);
    git(src, ['init', '-q', '-b', 'main']);
    if (!trySymlink('../elsewhere', join(src, 'gitwrapped-out'), 'dir')) return t.skip('symlinks not available');
    writeFileSync(join(src, 'a.txt'), 'a\n');
    git(src, ['add', '-A']);
    git(src, ['commit', '-q', '-m', 'init'], { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x.io', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x.io' });
    const clone = join(base, 'clone');
    git(base, ['clone', '-q', src, clone]);
    assert.ok(lstatSync(join(clone, 'gitwrapped-out')).isSymbolicLink());
    const r = cli(['--no-png'], { cwd: clone });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to write through a symlink: gitwrapped-out \(the default output folder is a symlink/);
    assert.deepEqual(listTree(elsewhere), ['png/01-intro.png', 'share.png', 'share.svg', 'wrapped.html']);
    for (const f of listTree(elsewhere)) assert.equal(readFileSync(join(elsewhere, f), 'utf8'), VICTIM, f);
  });
});

// ---------------------------------------------------------------------------
describe('a first run into a non-empty folder deletes nothing', () => {
  const NAMES = [
    'share.png', 'share.gif', 'stats.json', 'notes.txt', 'index.html', '.hidden',
    'cards/07-messages.svg', 'cards/08-intro.svg', 'cards/99-intro.svg', 'cards/01-intro.png', 'cards/x.svg',
    'png/01-intro.png', 'png/07-messages.png', 'png/11-outro.png', 'png/10-outro.png', 'png/a.png',
  ];
  for (const args of [['--no-png'], ['--no-png', '--json'], []]) {
    test(`args: ${args.join(' ') || '(PNGs on)'}`, () => {
      const out = tmp('gw-a2e2e-user-');
      for (const n of NAMES) {
        mkdirSync(join(out, n, '..'), { recursive: true });
        writeFileSync(join(out, n), 'mine\n');
      }
      const r = cli([repo(), '--out', out, ...args]);
      assert.equal(r.status, 0, r.stderr);
      const after = listTree(out);
      for (const n of NAMES) assert.ok(after.includes(n), `deleted ${n}`);
      // Files the run does not write keep their content.
      for (const n of NAMES.filter((x) => !(args.length === 0 && x === 'png/10-outro.png') && !(args.length === 0 && x === 'png/01-intro.png') && !(args.length === 0 && x === 'share.png') && !(args.includes('--json') && x === 'stats.json'))) {
        assert.equal(readFileSync(join(out, n), 'utf8'), 'mine\n', n);
      }
    });
  }
});

// ---------------------------------------------------------------------------
describe('future-dated commits (real CLI, TZ=UTC)', () => {
  test('a commit dated author-local tomorrow extends the current streak; 2099 and +2 days do not', () => {
    const now = Date.now();
    const yesterday = isoDay(now - DAY);
    const today = isoDay(now);
    const tomorrow = isoDay(now + DAY);
    const plus2 = isoDay(now + 2 * DAY);
    const plus3 = isoDay(now + 3 * DAY);
    const dir = makeRepo([
      { date: `${yesterday}T12:00:00+00:00` },
      { date: `${today}T00:30:00+00:00` },
      { date: `${tomorrow}T01:00:00+14:00` }, // already tomorrow where the author is
      { date: `${plus3}T12:00:00+00:00` },
      { date: '2099-06-01T12:00:00+00:00' },
    ]);
    const out = tmp();
    const r = cli([dir, '--out', out, '--no-png', '--json']);
    assert.equal(r.status, 0, r.stderr);
    // The machine's date can roll over between makeRepo and the run: skip then.
    const j = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    if (j.asOf !== today) return;
    assert.deepEqual(j.stats.streaks.current, { length: 3, start: yesterday, end: tomorrow });
    assert.match(r.stdout, /current 3 days/);
    assert.equal(j.stats.totals.lastDay, '2099-06-01');
    const cal = readFileSync(join(out, 'cards', '05-activity.svg'), 'utf8');
    assert.ok(cal.includes(`<title>${dayLabel(tomorrow)}: 1 commit</title>`), 'tomorrow is on the calendar');
    assert.ok(!cal.includes(dayLabel(plus3)), 'a day 3 days ahead is not on the calendar');
    assert.ok(!cal.includes(dayLabel(plus2)));
    // (The footer's date range still ends in 2099: the totals count that day.)
    assert.ok(!/<title>[^<]*2099[^<]*<\/title>/.test(cal), '2099 is not on the calendar');
  });

  test('only a far-future commit after a gap: no current streak', () => {
    const now = Date.now();
    const dir = makeRepo([
      { date: `${isoDay(now - 3 * DAY)}T12:00:00+00:00` },
      { date: '2099-06-01T12:00:00+00:00' },
    ]);
    const out = tmp();
    const r = cli([dir, '--out', out, '--no-png', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(j.stats.streaks.current.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe('--author on images shows only the local part (real CLI)', () => {
  const EMAILS = ['a@b@c.com', '@x.com', 'noat', 'Ada@Example.COM'];
  let dir;
  const authorRepo = () => (dir ??= makeRepo(EMAILS.map((email, i) => ({ date: `2026-01-0${i + 1}T12:00:00+00:00`, email, subject: 'work' }))));
  const images = (out) => [
    readFileSync(join(out, 'wrapped.html'), 'utf8'),
    readFileSync(join(out, 'share.svg'), 'utf8'),
    ...readdirSync(join(out, 'cards')).map((f) => readFileSync(join(out, 'cards', f), 'utf8')),
  ].join('\n');
  const CASES = [
    ['a@b@c.com', 'Starring a@b.', ['c.com']],
    ['noat', 'Starring noat.', []],
    ['ada@example.com', 'Starring ada.', ['example.com', 'EXAMPLE.COM']],
    // Nothing before the "@": shown as given (documented); it is a filter, not an address.
    ['@x.com', 'Starring @x.com.', []],
  ];
  for (const [author, starring, hidden] of CASES) {
    test(author, () => {
      const out = tmp();
      const r = cli([authorRepo(), '--out', out, '--no-png', '--json', '--author', author]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 commit\b/);
      const all = images(out);
      assert.ok(all.includes(starring), `${starring} missing`);
      for (const h of hidden) assert.ok(!all.toLowerCase().includes(h.toLowerCase()), `${h} leaked`);
      const j = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
      assert.equal(j.filters.author, author);
    });
  }
});

// ---------------------------------------------------------------------------
describe('--open with a fake xdg-open (real CLI)', { skip: process.platform === 'win32' || process.platform === 'darwin' ? 'xdg-open is the Linux opener' : false }, () => {
  function fakeOpener(script) {
    const bin = tmp('gw-a2e2e-bin-');
    const f = join(bin, 'xdg-open');
    writeFileSync(f, `#!/bin/sh\n${script}\n`);
    chmodSync(f, 0o755);
    return { PATH: `${bin}${delimiter}${process.env.PATH}`, marker: join(bin, 'ran') };
  }

  test('an opener that exits 3 after 3 s: no warning, and the CLI does not wait for it', () => {
    const { PATH, marker } = fakeOpener('');
    writeFileSync(join(PATH.split(delimiter)[0], 'xdg-open'), `#!/bin/sh\necho "$1" > '${marker}'\nsleep 3\nexit 3\n`);
    const out = tmp();
    const t0 = Date.now();
    const r = cli([repo(), '--out', out, '--no-png', '--open'], { env: { PATH } });
    const took = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /Opening .*wrapped\.html/);
    assert.ok(took < 2800, `took ${took} ms`);
    assert.ok(readFileSync(marker, 'utf8').trim().endsWith('wrapped.html'));
  });

  test('an opener that exits 3 right away: a warning, exit 0', () => {
    const { PATH } = fakeOpener('exit 3');
    const r = cli([repo(), '--out', tmp(), '--no-png', '--open'], { env: { PATH } });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /could not open a browser \(xdg-open exited with code 3\); open .*wrapped\.html yourself/);
    // 'Opening ...' is printed before the opener reports, then the warning follows.
    assert.match(r.stdout, /Opening .*wrapped\.html…\n$/);
  });

  test('an opener that succeeds quickly: "Opening", no warning, fast', () => {
    const { PATH } = fakeOpener('exit 0');
    const t0 = Date.now();
    const r = cli([repo(), '--out', tmp(), '--no-png', '--open'], { env: { PATH } });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /Opening /);
    assert.ok(Date.now() - t0 < 1400, 'waited for the full timeout although the opener exited');
  });
});

// ---------------------------------------------------------------------------
describe('viewer: CSP, nav zones, descriptions, escaping (real CLI)', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  let html;
  let out;
  const page = () => {
    if (html) return html;
    const evilName = process.platform === 'win32' ? 'evil.js' : `${PAYLOAD}.js`;
    const dir = makeRepo([1, 2, 3].map((i) => ({
      date: `2026-01-0${i}T12:00:00+00:00`,
      subject: `${PAYLOAD} fix: ${i} \u202Edesrever\u202C </p><script>alert(3)</script>`,
      file: i === 2 ? 'b&"\'.py' : evilName,
    })));
    out = tmp();
    const r = cli([dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(r.stdout), 'bidi controls in the recap');
    html = readFileSync(join(out, 'wrapped.html'), 'utf8');
    return html;
  };
  const unattr = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

  test('CSP hashes match the inline <style> and <script> exactly', () => {
    const h = page();
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(h);
    assert.ok(m, 'no CSP meta');
    const csp = unattr(m[1]);
    const styles = [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((x) => x[1]);
    const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
    assert.equal(styles.length, 1);
    assert.equal(scripts.length, 1);
    assert.equal((h.match(/<script\b/gi) ?? []).length, 1, 'an extra <script> element');
    assert.ok(csp.includes(`style-src ${sha(styles[0])}`), 'style hash');
    assert.ok(csp.includes(`script-src ${sha(scripts[0])}`), 'script hash');
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });

  test('the nav tap zones ignore the pointer; nothing turns it back on', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(page())[1];
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((x) => ({ sel: x[1].trim(), body: x[2] }));
    const base = rules.find((r) => r.sel === '.nav');
    assert.ok(base, 'no .nav rule');
    assert.match(base.body, /(^|;)pointer-events:none(;|$)/);
    for (const r of rules) {
      if (/\.nav\b|#prev|#next|button/.test(r.sel) && /pointer-events/.test(r.body)) {
        assert.match(r.body, /pointer-events:none/, `${r.sel} re-enables the pointer`);
      }
    }
    // The buttons themselves stay (keyboard / screen readers).
    assert.match(page(), /<button type="button" class="nav prev" id="prev" aria-label="Previous card"><\/button>/);
    assert.match(page(), /<button type="button" class="nav next" id="next" aria-label="Next card"><\/button>/);
  });

  test('every card has aria-describedby pointing to an existing element with text', () => {
    const h = page();
    const svgs = [...h.matchAll(/<svg\b([^>]*)>/g)].map((x) => x[1]).filter((a) => /\srole="img"/.test(a));
    assert.equal(svgs.length, 10);
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
    for (const a of svgs) {
      const d = /\saria-describedby="([^"]+)"/.exec(a);
      assert.ok(d, `no aria-describedby: ${a.slice(0, 80)}`);
      const el = new RegExp(`<p class="sr" id="${d[1]}" aria-hidden="true">([^<]*)</p>`).exec(h);
      assert.ok(el, `no element #${d[1]}`);
      assert.ok(el[1].trim().length > 10, `empty description #${d[1]}`);
    }
    assert.match(h, /id="story" role="region" aria-roledescription="carousel"/);
    assert.ok(!h.includes('aria-pressed'));
  });

  test('commit subjects and file names are escaped everywhere; no injected tags', () => {
    const h = page();
    assert.ok(!h.includes('<img'), 'unescaped <img');
    assert.ok(!/<script>alert/.test(h), 'unescaped <script>');
    assert.ok(!/<\/p><script/.test(h));
    assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'payload not present escaped');
    const tags = new Set([...h.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map((x) => x[1].toLowerCase()));
    for (const t of ['img', 'iframe', 'object', 'embed', 'a', 'foreignobject']) assert.ok(!tags.has(t), `<${t}>`);
    assert.ok(!/[\u202A-\u202E\u2066-\u2069\u2028\u2029]/.test(h), 'bidi controls in wrapped.html');
    for (const f of readdirSync(join(out, 'cards'))) {
      const svg = readFileSync(join(out, 'cards', f), 'utf8');
      assert.ok(!svg.includes('<img') && !svg.includes('<script'), f);
      assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(svg), `bidi in ${f}`);
    }
    // The descriptions carry the escaped payload (proves they include file paths / messages).
    const descs = [...h.matchAll(/<p class="sr" id="card-\d+-desc" aria-hidden="true">([^<]*)<\/p>/g)].map((x) => x[1]).join(' ');
    if (process.platform !== 'win32') assert.ok(descs.includes('&lt;img src=x onerror=alert(1)&gt;.js'));
    assert.ok(descs.includes('b&amp;&quot;&#39;.py') || descs.includes('b&amp;&quot;&apos;.py'), descs.slice(0, 300));
  });
});
