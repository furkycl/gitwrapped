// End-to-end tests for the languages stat / 07-languages card and --open, through the real
// binary (`node bin/gitwrapped.js ...`) against throwaway repos with mixed file types,
// lockfiles, build output, a binary file, a file name with spaces, a cross-language rename
// and a deleted file. --open is exercised with an injected opener via run() (no browser
// is ever launched) and, on macOS / Linux, with a fake opener script first on PATH.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_IDS } from '../src/cards/index.js';
import { HELP_TEXT, run } from '../src/cli.js';
import { pngSize } from '../src/png.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const WIN = process.platform === 'win32';
const TODAY = '2026-10-05';
const STEMS = CARD_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}`);

const ADA = { name: 'Ada', email: 'ada@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: WIN ? 'NUL' : '/dev/null', ...extra };
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `n` distinct lines of text (LF, trailing newline). */
const lines = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n') + '\n';

/**
 * A throwaway repo at <tmp>/<name>. Each step is {who, date, write?: {path: string|Buffer},
 * mv?: [from, to], rm?: [path], subject}. Returns the repo path; remove dirname(path).
 */
function makeRepo(prefix, steps, name = 'app') {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), name);
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const { who, date, write = {}, mv, rm, subject } of steps) {
    for (const [p, content] of Object.entries(write)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    if (mv) git(dir, ['mv', mv[0], mv[1]]);
    if (rm) git(dir, ['rm', '-q', ...rm]);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', subject], {
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

function bin(args, { env = {}, png = false, cwd = ROOT } = {}) {
  return spawnSync(process.execPath, [BIN, ...args, '--no-color', ...(png ? [] : ['--no-png'])], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv({ TZ: 'UTC', ...env }),
  });
}

function sink() {
  let text = '';
  return { write: (s) => { text += s; return true; }, get text() { return text; } };
}

const readJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
const langRows = (out) => readJson(out).stats.languages.languages.map((l) => [l.name, l.lines, l.files, l.share]);
const card7 = (out) => readFileSync(join(out, 'cards', '07-languages.svg'), 'utf8');
/** The visible <text> runs of an SVG, entity-decoded. */
const svgTexts = (svg) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&'));
/** The hbars rows of the languages card: "<label> <value>" from each bar's <title>. */
const barTitles = (svg) => [...svg.matchAll(/<title>([^<]*: [^<]* changed in [^<]*)<\/title>/g)].map((m) => m[1]);
const BARE_AMP = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/;

// Mixed history (all at noon UTC, far from any day boundary):
//  2024-06  Ada  legacy.rb (10)                                  → outside --year 2025
//  2025-02  Ada  src/app.ts 40, src/util.js 10, "tools/build script.py" 8, server/main.go 6,
//                LICENSE 3, package-lock.json 500 (ignored), dist/bundle.js 300 (ignored),
//                assets/logo.png (binary, ignored)
//  2025-03  Bob  scripts/gen.py 30
//  2025-04  Ada  git mv server/main.go server/main.rs (--no-renames: Go −6, Rust +6)
//  2025-05  Ada  git rm src/util.js (JavaScript −10)
//  2025-06  Ada  only package-lock.json changes (lockfile-only commit)
const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from([0, 0, 0, 0, 255, 0, 1, 2, 3, 0, 0, 7])]);
const HISTORY = [
  { who: ADA, date: '2024-06-01T12:00:00+00:00', subject: 'feat: legacy ruby', write: { 'legacy.rb': lines(10) } },
  {
    who: ADA,
    date: '2025-02-01T12:00:00+00:00',
    subject: 'feat: the stack',
    write: {
      'src/app.ts': lines(40),
      'src/util.js': lines(10),
      'tools/build script.py': lines(8),
      'server/main.go': lines(6),
      LICENSE: lines(3),
      'package-lock.json': lines(500),
      'dist/bundle.js': lines(300),
      'assets/logo.png': PNG_BYTES,
    },
  },
  { who: BOB, date: '2025-03-01T12:00:00+00:00', subject: 'feat: generator', write: { 'scripts/gen.py': lines(30) } },
  { who: ADA, date: '2025-04-01T12:00:00+00:00', subject: 'refactor: go to rust', mv: ['server/main.go', 'server/main.rs'] },
  { who: ADA, date: '2025-05-01T12:00:00+00:00', subject: 'chore: drop util', rm: ['src/util.js'] },
  { who: ADA, date: '2025-06-01T12:00:00+00:00', subject: 'chore: bump deps', write: { 'package-lock.json': lines(700, 'v') } },
];

let tmp;
let repo;
const out = (name) => join(tmp, name);

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gw-lang-e2e-'));
  repo = makeRepo('gw-lang-repo-', HISTORY);
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  if (repo) rmSync(dirname(repo), { recursive: true, force: true, maxRetries: 5 });
});

describe('bin: languages from a mixed repo', () => {
  test('stats.json languages block: ignored / binary paths skipped, rename + delete counted, shares sum to 100', () => {
    const o = out('all');
    const r = bin([repo, '--out', o, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    const l = readJson(o).stats.languages;
    assert.equal(l.basis, 'lines');
    // 10 + 40 + (10 + 10) + (8 + 30) + (6 + 6) + 6 + 3: lockfile, dist/ and the PNG never count.
    assert.equal(l.totalLines, 129);
    // legacy.rb, app.ts, util.js, build script.py, gen.py, main.go, main.rs, LICENSE.
    assert.equal(l.totalFiles, 8);
    assert.deepEqual(langRows(o), [
      ['TypeScript', 40, 1, 31],
      ['Python', 38, 2, 29],
      ['JavaScript', 20, 1, 16],
      ['Go', 12, 1, 9],
      ['Ruby', 10, 1, 8],
      ['Rust', 6, 1, 5],
      ['Other', 3, 1, 2],
    ]);
    assert.equal(l.languages.reduce((n, x) => n + x.share, 0), 100);
    assert.ok(r.stdout.includes('Top language TypeScript (31% of lines)'), r.stdout);
  });

  test('wrapped.html embeds the 10 cards in order; 07-languages shows the top language and percent', () => {
    const o = out('all');
    const page = readFileSync(join(o, 'wrapped.html'), 'utf8');
    const ids = [...page.matchAll(/<section class="slide[^"]*" id="card-(\d+)" data-card="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]]);
    assert.deepEqual(ids, CARD_IDS.map((id, i) => [i + 1, id]));
    assert.equal(CARD_IDS.length, 10);
    assert.equal(CARD_IDS[6], 'languages');
    assert.equal((page.match(/<svg\b/g) ?? []).length >= 10, true);
    for (const stem of STEMS) assert.ok(existsSync(join(o, 'cards', `${stem}.svg`)), stem);

    const svg = card7(o);
    const texts = svgTexts(svg);
    assert.ok(texts.includes('31%'), texts.join(' | '));
    // 31% is under half: "Led by", not "Mostly".
    assert.ok(texts.join(' ').includes('Led by TypeScript'), texts.join(' | '));
    assert.ok(texts.includes('YOUR LANGUAGES'));
    // Five language bars plus Other (Rust 5% + unknown 2% folded together).
    assert.deepEqual(barTitles(svg), [
      'TypeScript: 40 lines changed in 1 file (31%)',
      'Python: 38 lines changed in 2 files (29%)',
      'JavaScript: 20 lines changed in 1 file (16%)',
      'Go: 12 lines changed in 1 file (9%)',
      'Ruby: 10 lines changed in 1 file (8%)',
      'Other: 9 lines changed in 2 files (7%)',
    ]);
    // The same card is the one embedded as slide 7.
    const slide7 = page.split('<section').find((s) => s.includes('id="card-7"'));
    assert.ok(slide7.includes('Led by TypeScript'));
    assert.ok(!/NaN|undefined|\[object/.test(texts.join(' ')));
  });

  test('--year window drops languages only touched outside it', () => {
    const o = out('year');
    const r = bin([repo, '--out', o, '--json', '--year', '2025']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(langRows(o), [
      ['TypeScript', 40, 1, 34],
      ['Python', 38, 2, 32],
      ['JavaScript', 20, 1, 17],
      ['Go', 12, 1, 10],
      ['Rust', 6, 1, 5],
      ['Other', 3, 1, 2],
    ]);
    assert.ok(!svgTexts(card7(o)).some((t) => t.includes('Ruby')));
    assert.ok(svgTexts(card7(o)).includes('34%'));
  });

  test('--since / --until window: only the rename month → Go and Rust tied', () => {
    const o = out('april');
    const r = bin([repo, '--out', o, '--json', '--since', '2025-04-01', '--until', '2025-04-30']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(langRows(o), [['Go', 6, 1, 50], ['Rust', 6, 1, 50]]);
    const texts = svgTexts(card7(o));
    assert.ok(texts.includes('50%'));
    assert.ok(texts.join(' ').includes('Tied at the top: Go and Rust'), texts.join(' | '));
  });

  test('--author filter: only that author’s files count', () => {
    const bob = out('bob');
    let r = bin([repo, '--out', bob, '--json', '--author', 'bob@example.com']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(langRows(bob), [['Python', 30, 1, 100]]);
    let texts = svgTexts(card7(bob));
    assert.ok(texts.includes('100%'));
    assert.ok(texts.join(' ').includes('All Python, all the time'), texts.join(' | '));
    assert.ok(texts.join(' ').includes('You stuck to 1 language'), texts.join(' | '));

    const ada = out('ada-2025');
    r = bin([repo, '--out', ada, '--json', '--author', 'ada@example.com', '--year', '2025']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(langRows(ada), [
      ['TypeScript', 40, 1, 45],
      ['JavaScript', 20, 1, 22],
      ['Go', 12, 1, 14],
      ['Python', 8, 1, 9],
      ['Rust', 6, 1, 7],
      ['Other', 3, 1, 3],
    ]);
    texts = svgTexts(card7(ada));
    assert.ok(texts.includes('45%') && texts.join(' ').includes('Led by TypeScript'), texts.join(' | '));
  });

  test('a window with only the lockfile-only commit → no languages, friendly card, no recap line', () => {
    const o = out('lockonly');
    const r = bin([repo, '--out', o, '--json', '--since', '2025-06-01']);
    assert.equal(r.status, 0, r.stderr);
    const l = readJson(o).stats.languages;
    assert.deepEqual(l, { totalLines: 0, totalFiles: 0, basis: 'lines', languages: [] });
    assert.ok(!r.stdout.includes('Top language'), r.stdout);
    const texts = svgTexts(card7(o));
    assert.ok(texts.includes('None'), texts.join(' | '));
    assert.ok(texts.join(' ').includes('No code languages detected'));
    assert.deepEqual(barTitles(card7(o)), []);
  });

  test('PNG render of 07-languages succeeds (1080x1920)', () => {
    const o = out('png');
    const r = bin([repo, '--out', o], { png: true });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes('PNG export skipped'), r.stderr);
    const png = readFileSync(join(o, 'png', '07-languages.png'));
    assert.deepEqual(pngSize(png), { width: 1080, height: 1920 });
    for (const stem of STEMS) assert.ok(existsSync(join(o, 'png', `${stem}.png`)), stem);
  });
});

describe('bin: languages edge repos', () => {
  const extra = [];
  after(() => {
    for (const d of extra) rmSync(dirname(d), { recursive: true, force: true, maxRetries: 5 });
  });

  test('repo with only lockfiles / build output / binaries ever changed', () => {
    const r0 = makeRepo('gw-lang-lock-', [
      { who: ADA, date: '2025-01-01T12:00:00+00:00', subject: 'chore: lock', write: { 'package-lock.json': lines(50), 'yarn.lock': lines(20), 'dist/a.js': lines(9), 'img.png': PNG_BYTES } },
      { who: ADA, date: '2025-01-02T12:00:00+00:00', subject: 'chore: relock', write: { 'package-lock.json': lines(60, 'x'), 'node_modules/x/index.js': lines(4) } },
    ]);
    extra.push(r0);
    const o = out('lock-repo');
    const r = bin([r0, '--out', o, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJson(o).stats.languages.languages, []);
    const texts = svgTexts(card7(o));
    assert.ok(texts.includes('None'));
    assert.ok(!/NaN|undefined|\[object/.test(texts.join(' ')));
  });

  test('only unrecognized files → "None" and the files-changed line', () => {
    const r0 = makeRepo('gw-lang-other-', [
      { who: ADA, date: '2025-01-01T12:00:00+00:00', subject: 'docs: license', write: { LICENSE: lines(5), '.gitignore': lines(2) } },
    ]);
    extra.push(r0);
    const o = out('other-repo');
    const r = bin([r0, '--out', o, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(langRows(o), [['Other', 7, 2, 100]]);
    const all = svgTexts(card7(o)).join(' ');
    assert.ok(all.includes('None') && all.includes('No code languages detected'), all);
    assert.ok(all.includes('2 files changed'), all);
    assert.ok(!r.stdout.includes('Top language'), r.stdout);
  });

  test('a huge number of languages: 5 bars + Other, equal lines get equal shares, card still renders', () => {
    const exts = ['js', 'ts', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'cs', 'rb', 'php', 'sh', 'ps1', 'html', 'css', 'scss', 'vue', 'svelte', 'md', 'json', 'yml', 'toml', 'xml', 'sql', 'graphql', 'proto', 'dart', 'lua', 'r', 'scala', 'ex', 'erl', 'hs', 'ml', 'fs', 'clj', 'elm', 'jl', 'pl', 'groovy', 'zig', 'nim', 'cr', 'gleam', 'sol', 'tf', 'nix', 'cmake', 'asm', 'f90', 'vb', 'pas', 'glsl', 'cu', 'hbs', 'pug', 'liquid', 'prisma'];
    const write = Object.fromEntries(exts.map((e, i) => [`f${i}.${e}`, lines(i === 0 ? 200 : 1 + (i % 3))]));
    const r0 = makeRepo('gw-lang-many-', [{ who: ADA, date: '2025-01-01T12:00:00+00:00', subject: 'feat: everything', write }]);
    extra.push(r0);
    const o = out('many');
    const r = bin([r0, '--out', o, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const l = readJson(o).stats.languages;
    assert.equal(l.languages.length, exts.length);
    assert.equal(new Set(l.languages.map((x) => x.name)).size, exts.length);
    // Many languages tie at 1, 2 and 3 lines, and equal lines get equal shares, so the
    // total is the closest to 100 that allows (see percentShares), not exactly 100.
    const total = l.languages.reduce((n, x) => n + x.share, 0);
    assert.ok(Math.abs(total - 100) <= 10, String(total));
    for (const a of l.languages) for (const b of l.languages) if (a.lines === b.lines) assert.equal(a.share, b.share, `${a.name} vs ${b.name}`);
    assert.equal(l.languages[0].name, 'JavaScript');
    for (const x of l.languages) assert.ok(Number.isInteger(x.share) && x.share >= 0, JSON.stringify(x));
    // Shares are monotone in lines (an equal-lines tie may differ by 1 point, never more).
    for (let i = 1; i < l.languages.length; i++) assert.ok(l.languages[i].share <= l.languages[i - 1].share + (l.languages[i].lines === l.languages[i - 1].lines ? 1 : 0));
    const svg = card7(o);
    const bars = barTitles(svg);
    assert.equal(bars.length, 6, bars.join('\n'));
    assert.ok(bars[0].startsWith('JavaScript: 200 lines'), bars[0]);
    assert.ok(bars[5].startsWith('Other: '), bars[5]);
    // The bar percentages shown add up to 100 (Other = the sum of the folded shares).
    const shown = bars.map((b) => /\((<1|\d+)%\)$/.exec(b)[1]).map((v) => (v === '<1' ? 0 : Number(v)));
    assert.equal(shown.reduce((a, b) => a + b, 0), total);
    // The count is programming languages only: md is prose; json, yml, toml, xml, proto are data.
    assert.equal(l.languages.filter((x) => x.type === 'programming').length, exts.length - 6);
    assert.ok(svgTexts(svg).join(' ').includes(`You wrote code in ${exts.length - 6} languages`));
  });

  test('repo names with & < > are escaped in card text and the page', () => {
    // < and > are not allowed in Windows file names; & is.
    const name = WIN ? 'R&D app' : 'R&D <a>';
    const write = { 'a & b.py': lines(3) };
    if (!WIN) write['x<y>.ts'] = lines(1);
    const r0 = makeRepo('gw-lang-xml-', [{ who: ADA, date: '2025-01-01T12:00:00+00:00', subject: 'feat: <b> & "c"', write }], name);
    extra.push(r0);
    const o = out('xml');
    const r = bin([r0, '--out', o, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    for (const stem of STEMS) {
      const svg = readFileSync(join(o, 'cards', `${stem}.svg`), 'utf8');
      assert.ok(!BARE_AMP.test(svg), `${stem}: bare &`);
      // Every < opens a tag (no raw "<a>" or "<b>" leaked into text).
      for (const m of svg.matchAll(/<([^>]*)>/g)) assert.match(m[1], /^(?:\/?[A-Za-z][\w:-]*\b[^<]*|!--[\s\S]*--|\?xml[^<]*\?)$/, `${stem}: <${m[1]}>`);
    }
    const svg = card7(o);
    assert.ok(svg.includes(escaped), 'footer has the escaped repo name');
    assert.ok(svgTexts(svg).some((t) => t.includes(name)));
    const page = readFileSync(join(o, 'wrapped.html'), 'utf8');
    assert.ok(page.includes(`<title>gitwrapped · ${escaped}</title>`), page.slice(0, 400));
  });
});

describe('--open', () => {
  test('--help mentions --open', () => {
    const r = bin(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--open\s+Open <out>\/wrapped\.html in your default browser/);
    assert.ok(HELP_TEXT.includes('--open'));
  });

  test('run(): opener called once with the absolute wrapped.html path (relative --out)', async () => {
    const opened = [];
    const cwd = process.cwd();
    const base = mkdtempSync(join(tmpdir(), 'gw-open-rel-'));
    process.chdir(base);
    // process.cwd(), not `base`: on macOS the temp dir is a symlink (/var → /private/var).
    const here = process.cwd();
    let expected;
    try {
      expected = resolve(here, 'rel out', 'wrapped.html');
      const stderr = sink();
      const code = await run([repo, '--no-png', '--open', '--out', 'rel out'], {
        stdout: sink(), stderr, env: {}, today: TODAY,
        openFile: async (p) => { opened.push({ p, exists: existsSync(p) }); },
      });
      assert.equal(code, 0, stderr.text);
      assert.equal(stderr.text, '');
    } finally {
      process.chdir(cwd);
    }
    assert.equal(opened.length, 1);
    assert.ok(isAbsolute(opened[0].p), opened[0].p);
    assert.equal(opened[0].p, expected);
    assert.ok(opened[0].exists, 'wrapped.html is written before the opener runs');
    rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  });

  test('run(): without --open the opener is never called', async () => {
    let calls = 0;
    const code = await run([repo, '--no-png', '--out', out('noopen')], { stdout: sink(), stderr: sink(), env: {}, today: TODAY, openFile: () => { calls += 1; } });
    assert.equal(code, 0);
    assert.equal(calls, 0);
  });

  test('run(): a rejecting opener → exit 0 and one stderr warning with the path', async () => {
    const o = out('open-fail');
    const stderr = sink();
    const stdout = sink();
    const code = await run([repo, '--no-png', '--open', '--out', o], {
      stdout, stderr, env: {}, today: TODAY,
      openFile: () => Promise.reject(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })),
    });
    assert.equal(code, 0);
    assert.equal(stderr.text, `gitwrapped: could not open a browser (ENOENT); open ${resolve(o, 'wrapped.html')} yourself\n`);
    assert.ok(existsSync(join(o, 'wrapped.html')));
    assert.match(stdout.text, /^gitwrapped: 6 commits → /);
  });

  test('run(): a failed generation never calls the opener', async () => {
    let calls = 0;
    const stderr = sink();
    const code = await run([join(tmp, 'no-such-repo'), '--no-png', '--open', '--out', out('nope')], { stdout: sink(), stderr, env: {}, today: TODAY, openFile: () => { calls += 1; } });
    assert.notEqual(code, 0);
    assert.equal(calls, 0);
  });

  // The real default opener (spawned detached) with a fake `xdg-open` / `open` first on PATH.
  test('bin: the default opener gets the absolute path and never blocks the run', { skip: WIN ? 'opener is rundll32 on Windows' : false }, async () => {
    const fake = mkdtempSync(join(tmpdir(), 'gw-fake-opener-'));
    const log = join(fake, 'opened.txt');
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    writeFileSync(join(fake, cmd), `#!/bin/sh\nprintf '%s\\n' "$#" "$@" > "${log}.tmp" && mv "${log}.tmp" "${log}"\nexit 3\n`);
    chmodSync(join(fake, cmd), 0o755);
    try {
      const o = join(fake, 'my out & co');
      const r = bin([repo, '--out', o, '--open'], { env: { PATH: `${fake}${delimiter}${process.env.PATH}` } });
      assert.equal(r.status, 0, r.stderr);
      // The fake opener exits 3 right away: that is reported, and the run still succeeds.
      assert.match(r.stderr, /^gitwrapped: could not open a browser \((xdg-open|open) exited with code 3\); open .*wrapped\.html yourself\n$/);
      const deadline = Date.now() + 10_000;
      while (!existsSync(log) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50));
      assert.equal(readFileSync(log, 'utf8'), `1\n${join(o, 'wrapped.html')}\n`);
    } finally {
      rmSync(fake, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
