// End-to-end checks for the pre-1.1.0 audit LOW fixes, through the real binary
// (`node bin/gitwrapped.js`) on throwaway repos: --author on images, --open with a fake
// opener, the viewer's CSP / a11y / escaping, and future-dated commits vs the footer date
// range. (The HIGH/MED fixes are covered by audit-fixes-025.test.js.)
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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

let simpleRepo;
const repo = () => (simpleRepo ??= makeRepo([
  { date: '2026-01-05T12:00:00+00:00' },
  { date: '2026-01-06T12:00:00+00:00' },
]));

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
    // Only the local part before the first "@" is shown.
    ['a@b@c.com', 'Starring a.', ['b@c', 'c.com', 'Starring a@']],
    ['noat', 'Starring noat.', []],
    ['ada@example.com', 'Starring ada.', ['example.com', 'EXAMPLE.COM']],
    // Nothing before the "@": the author is left out of the images entirely.
    ['@x.com', null, ['x.com', 'Starring']],
  ];
  for (const [author, starring, hidden] of CASES) {
    test(author, () => {
      const out = tmp();
      const r = cli([authorRepo(), '--out', out, '--no-png', '--json', '--author', author]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 commit\b/);
      const all = images(out);
      if (starring) assert.ok(all.includes(starring), `${starring} missing`);
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
describe('viewer: CSP, descriptions, escaping (real CLI)', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  const ODD_NAME = process.platform === 'win32' ? "b&'.py" : 'b&"\'.py';
  let html;
  let out;
  const page = () => {
    if (html) return html;
    // Windows file names cannot contain < > " (among others): there the payload rides in
    // the commit subject only, and the odd file name keeps just & and '.
    const evilName = process.platform === 'win32' ? 'evil.js' : `${PAYLOAD}.js`;
    const dir = makeRepo([1, 2, 3].map((i) => ({
      date: `2026-01-0${i}T12:00:00+00:00`,
      subject: `${PAYLOAD} fix: ${i} \u202Edesrever\u202C </p><script>alert(3)</script>`,
      file: i === 2 ? ODD_NAME : evilName,
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
    const odd = process.platform === 'win32' ? 'b&amp;' : 'b&amp;&quot;';
    assert.ok(descs.includes(`${odd}&#39;.py`) || descs.includes(`${odd}&apos;.py`), descs.slice(0, 300));
  });
});

// ---------------------------------------------------------------------------
describe('future-dated commits vs the date range (real CLI, TZ=UTC)', () => {
  test('a 2099 commit does not reach the card footers, the intro range or the share image', () => {
    const DAY = 86400000;
    const now = Date.now();
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const dir = makeRepo([
      { date: `${day(now - 2 * DAY)}T12:00:00+00:00` },
      { date: `${day(now - DAY)}T12:00:00+00:00` },
      { date: '2099-06-01T12:00:00+00:00' },
    ]);
    const out = tmp();
    const r = cli([dir, '--out', out, '--no-png', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(j.stats.totals.lastDay, '2099-06-01', 'stats.json keeps the raw day');
    assert.equal(j.stats.totals.commits, 3);
    // The machine's date can roll over between makeRepo and the run: skip then.
    if (j.asOf !== day(now)) return;
    const files = [join(out, 'share.svg'), ...readdirSync(join(out, 'cards')).map((f) => join(out, 'cards', f))];
    for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /2099/, f);
    const steady = j.stats.personality.scores.find((x) => x.id === 'steady-shipper');
    assert.ok(steady.score >= 0.7, `steady-shipper ${steady.score}`); // 2 of 2 days
  });
});
