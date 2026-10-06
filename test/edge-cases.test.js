// Edge cases for the terminal recap, the commit cap and odd repo shapes: readHistory
// limits, --max-commits parsing, color decisions, summary formatting, and real-binary
// runs on empty / merge-only / detached / bare / unicode-path repos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHistory, quoteForShell, DEFAULT_LIMIT } from '../src/git.js';
import { bareRepoName, parseCli, run } from '../src/cli.js';
import { formatSummary, shouldUseColor } from '../src/summary.js';
import { computeStats } from '../src/stats/index.js';
import { CARD_IDS, cardIdsFor } from '../src/cards/index.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const TODAY = '2024-03-14';
const BAD_WORDS = /\b(null|undefined|NaN)\b/;

function cleanEnv(extra = {}) {
  const env = { ...process.env, TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}

function bin(args, { cwd, env = {} } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv(env) });
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(dir) {
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function commitAt(dir, subject, { author = '2024-03-01T10:00:00+00:00', committer = author, email = 't@example.com', file } = {}) {
  if (file) {
    writeFileSync(join(dir, file), `${subject}\n`);
    git(dir, ['add', '-A']);
  }
  git(dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', subject], {
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: author,
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: committer,
  });
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

let fixture;
let tmp;
before(() => {
  fixture = makeFixtureRepo();
  tmp = mkdtempSync(join(tmpdir(), 'gw-edge-'));
});
after(() => {
  fixture?.cleanup();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

// ---------------------------------------------------------------------------------------
describe('readHistory limit', () => {
  test('exactly `limit` commits → not truncated, all returned', async () => {
    const n = fixture.commits.length;
    const r = await readHistory(fixture.dir, { limit: n });
    assert.equal(r.truncated, false);
    assert.equal(r.limit, n);
    assert.deepEqual(r.commits.map((c) => c.hash), fixture.commits.map((c) => c.hash));
  });

  test('limit + 1 below the history size → truncated, newest `limit` in newest-first order', async () => {
    for (const limit of [1, 2, fixture.commits.length - 1]) {
      const r = await readHistory(fixture.dir, { limit });
      assert.equal(r.truncated, true, `limit ${limit}`);
      assert.deepEqual(r.commits.map((c) => c.hash), fixture.commits.slice(0, limit).map((c) => c.hash));
    }
  });

  test('limit larger than history → not truncated', async () => {
    const r = await readHistory(fixture.dir, { limit: 1_000_000 });
    assert.equal(r.truncated, false);
    assert.equal(r.commits.length, fixture.commits.length);
  });

  test('limit combined with --author: cap applies to the filtered commits', async () => {
    const bobs = fixture.commits.filter((c) => c.email === 'bob@example.com');
    assert.ok(bobs.length >= 3);
    const capped = await readHistory(fixture.dir, { author: 'BOB@example.com', limit: 2 });
    assert.equal(capped.truncated, true);
    assert.deepEqual(capped.commits.map((c) => c.hash), bobs.slice(0, 2).map((c) => c.hash));
    const exact = await readHistory(fixture.dir, { author: 'bob@example.com', limit: bobs.length });
    assert.equal(exact.truncated, false);
    assert.equal(exact.commits.length, bobs.length);
  });

  test('limit combined with --since (and --author)', async () => {
    // Fixture commits from 2024-03-09 on: chore lockfile, oops, empty, typo, refactor (5).
    const since = '2024-03-09';
    const min = Date.parse('2024-03-09T00:00:00Z');
    const process_tz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const matching = fixture.commits.filter((c) => Date.parse(c.date) >= min);
      const all = await readHistory(fixture.dir, { since });
      assert.deepEqual(all.commits.map((c) => c.hash), matching.map((c) => c.hash));
      const capped = await readHistory(fixture.dir, { since, limit: 2 });
      assert.equal(capped.truncated, true);
      assert.deepEqual(capped.commits.map((c) => c.hash), matching.slice(0, 2).map((c) => c.hash));
      const exact = await readHistory(fixture.dir, { since, limit: matching.length });
      assert.equal(exact.truncated, false);
      const both = await readHistory(fixture.dir, { since, author: 'ada@example.com', limit: 1 });
      const adas = matching.filter((c) => c.email === 'ada@example.com');
      assert.equal(both.truncated, adas.length > 1);
      assert.deepEqual(both.commits.map((c) => c.hash), adas.slice(0, 1).map((c) => c.hash));
    } finally {
      if (process_tz === undefined) delete process.env.TZ;
      else process.env.TZ = process_tz;
    }
  });

  test('--since + limit with a commit whose committer date is new but author date is old', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-rebased-'));
    t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
    initRepo(dir);
    const c1 = commitAt(dir, 'one', { author: '2024-01-01T10:00:00Z' });
    const c2 = commitAt(dir, 'two', { author: '2024-01-02T10:00:00Z' });
    // Cherry-picked/rebased old work: authored before --since, committed after.
    commitAt(dir, 'old', { author: '2023-06-01T10:00:00Z', committer: '2024-01-03T10:00:00Z' });
    const r = await readHistory(dir, { since: '2024-01-01T00:00:00Z', limit: 2 });
    assert.deepEqual(r.commits.map((c) => c.hash), [c2, c1]);
    assert.equal(r.truncated, false);
    const one = await readHistory(dir, { since: '2024-01-01T00:00:00Z', limit: 1 });
    assert.deepEqual(one.commits.map((c) => c.hash), [c2]);
    assert.equal(one.truncated, true);
  });

  test('invalid limits throw TypeError before running git', async () => {
    for (const limit of [0, -1, 1.5, '5', NaN, -Infinity, null, 2 ** 53]) {
      await assert.rejects(readHistory(fixture.dir, { limit }), TypeError, `limit ${String(limit)}`);
    }
    // Invalid limit wins even over a bad path (checked first).
    await assert.rejects(readHistory(join(tmp, 'nope'), { limit: 0 }), TypeError);
  });

  test('undefined limit means DEFAULT_LIMIT', async () => {
    const r = await readHistory(fixture.dir, { limit: undefined });
    assert.equal(r.limit, DEFAULT_LIMIT);
  });

  test('limit = Number.MAX_SAFE_INTEGER is accepted', async () => {
    const r = await readHistory(fixture.dir, { limit: Number.MAX_SAFE_INTEGER });
    assert.equal(r.commits.length, fixture.commits.length);
    assert.equal(r.truncated, false);
  });

  test('limit = Infinity means no cap (with and without --since)', async () => {
    const r = await readHistory(fixture.dir, { limit: Infinity });
    assert.equal(r.commits.length, fixture.commits.length);
    assert.equal(r.truncated, false);
    assert.equal(r.limit, Infinity);
    const s = await readHistory(fixture.dir, { limit: Infinity, since: '2000-01-01' });
    assert.equal(s.commits.length, fixture.commits.length);
    assert.equal(s.truncated, false);
  });
});

// ---------------------------------------------------------------------------------------
describe('--max-commits parsing', () => {
  test('accepted forms', () => {
    assert.equal(parseCli(['--max-commits=3']).maxCommits, 3);
    assert.equal(parseCli(['--max-commits', '3']).maxCommits, 3);
    assert.equal(parseCli(['--max-commits', ' 7 ']).maxCommits, 7);
    assert.equal(parseCli(['--max-commits', '007']).maxCommits, 7);
    assert.equal(parseCli(['--max-commits', '1000000000']).maxCommits, 1_000_000_000);
    assert.equal(parseCli([]).maxCommits, DEFAULT_LIMIT);
  });

  for (const v of ['0', '-5', 'abc', '1e3', '1.5', '+5', '0x10', '99999999999999999999', '9007199254740992', ' ']) {
    test(`--max-commits=${JSON.stringify(v)} is rejected`, () => {
      assert.throws(() => parseCli([`--max-commits=${v}`]), /--max-commits/);
    });
  }

  test('--max-commits with a missing value is rejected', () => {
    assert.throws(() => parseCli(['--max-commits']), /max-commits/);
  });

  test('--no-color sets color:false; absent leaves it undefined', () => {
    assert.equal(parseCli(['--no-color']).color, false);
    assert.equal('color' in parseCli([]), false);
  });
});

describe('bin: --max-commits', () => {
  const cases = [
    [['--max-commits', '0'], /invalid --max-commits "0"/],
    [['--max-commits', '-5'], /invalid --max-commits "-5"/],
    [['--max-commits', '-0'], /invalid --max-commits "-0"/],
    [['--since', '-5'], /invalid --since "-5"/],
    [['--since', '--no-png'], /--since requires a value/],
    [['--max-commits'], /--max-commits requires a value/],
    [['--max-commits=-5'], /invalid --max-commits "-5"/],
    [['--max-commits', 'abc'], /invalid --max-commits "abc"/],
    [['--max-commits', '1e3'], /invalid --max-commits "1e3"/],
    [['--max-commits', ''], /--max-commits requires a non-empty value/],
  ];
  for (const [args, re] of cases) {
    test(`${args.join(' ')} → exit 2, message on stderr, nothing written`, () => {
      const out = join(tmp, `mc-bad-${Math.random().toString(36).slice(2)}`);
      const r = bin([fixture.dir, '--out', out, '--no-png', ...args]);
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, re);
      assert.match(r.stderr, /--help/);
      assert.equal(existsSync(out), false);
    });
  }

  test('--max-commits=3 → 3 commits + truncation note', () => {
    const out = join(tmp, 'mc3');
    const r = bin([fixture.dir, '--out', out, '--no-png', '--max-commits=3']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 3 commits → /);
    assert.match(r.stdout, /more than 3 commits; only the most recent 3 were analyzed/);
  });

  test('a very large --max-commits is fine and adds no note', () => {
    const out = join(tmp, 'mcbig');
    const r = bin([fixture.dir, '--out', out, '--no-png', '--max-commits', '1000000000']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^gitwrapped: ${fixture.commits.length} commits → `));
    assert.doesNotMatch(r.stdout, /Note:/);
  });

  test('--max-commits 9007199254740991 (MAX_SAFE_INTEGER) is fine', () => {
    const r = bin([fixture.dir, '--out', join(tmp, 'mcmax'), '--no-png', '--max-commits', String(Number.MAX_SAFE_INTEGER)]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Note:/);
  });

  test('with --author / --since the truncation note speaks of matching commits', () => {
    const r = bin([fixture.dir, '--out', join(tmp, 'mcauthor'), '--no-png', '--author', 'bob@example.com', '--max-commits', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Note: more than 1 matching commits; only the most recent 1 were analyzed\./);
    assert.doesNotMatch(r.stdout, /this repo has more than/);
    const s = bin([fixture.dir, '--out', join(tmp, 'mcsince'), '--no-png', '--since', '2000-01-01', '--max-commits=2']);
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /Note: more than 2 matching commits; only the most recent 2 were analyzed\./);
  });
});

describe('quoteForShell / bareRepoName', () => {
  test('POSIX: single quotes, embedded quote escaped as \'\\\'\'', () => {
    assert.equal(quoteForShell('/srv/my repo', 'linux'), "'/srv/my repo'");
    assert.equal(quoteForShell("/srv/bob's repo", 'darwin'), "'/srv/bob'\\''s repo'");
  });

  test('win32: double quotes', () => {
    assert.equal(quoteForShell('C:/Users/me/my repo', 'win32'), '"C:/Users/me/my repo"');
    assert.equal(quoteForShell("C:/bob's", 'win32'), '"C:/bob\'s"');
  });

  test('bareRepoName strips ".git" and maps a .git dir to its parent', () => {
    assert.equal(bareRepoName('/srv/proj.git'), 'proj');
    assert.equal(bareRepoName('/srv/proj/.git'), 'proj');
    assert.equal(bareRepoName('/srv/proj/.git/'), 'proj');
    assert.equal(bareRepoName('/srv/proj'), 'proj');
    assert.equal(bareRepoName('/srv/.git.git'), '.git');
  });
});

// ---------------------------------------------------------------------------------------
describe('shouldUseColor precedence matrix', () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  const cases = [
    // [label, args, expected]
    ['--no-color beats FORCE_COLOR=2', { stream: tty, env: { FORCE_COLOR: '2' }, flag: false }, false],
    ['--no-color on plain TTY', { stream: tty, env: {}, flag: false }, false],
    ['flag undefined → auto TTY', { stream: tty, env: {}, flag: undefined }, true],
    ['FORCE_COLOR="" is unset: TTY → color', { stream: tty, env: { FORCE_COLOR: '' } }, true],
    ['FORCE_COLOR="" is unset: pipe → none', { stream: pipe, env: { FORCE_COLOR: '' } }, false],
    ['FORCE_COLOR="" falls through to NO_COLOR', { stream: tty, env: { FORCE_COLOR: '', NO_COLOR: '1' } }, false],
    ['FORCE_COLOR=0 on TTY', { stream: tty, env: { FORCE_COLOR: '0' } }, false],
    ['FORCE_COLOR=false on TTY', { stream: tty, env: { FORCE_COLOR: 'false' } }, false],
    ['FORCE_COLOR=FALSE (case-insensitive)', { stream: tty, env: { FORCE_COLOR: 'FALSE' } }, false],
    ['FORCE_COLOR=1 on pipe', { stream: pipe, env: { FORCE_COLOR: '1' } }, true],
    ['FORCE_COLOR=2 on pipe', { stream: pipe, env: { FORCE_COLOR: '2' } }, true],
    ['FORCE_COLOR=3 with no stream', { stream: undefined, env: { FORCE_COLOR: '3' } }, true],
    ['FORCE_COLOR=1 beats NO_COLOR', { stream: pipe, env: { FORCE_COLOR: '1', NO_COLOR: '1' } }, true],
    ['FORCE_COLOR=1 beats TERM=dumb', { stream: pipe, env: { FORCE_COLOR: '1', TERM: 'dumb' } }, true],
    ['FORCE_COLOR=0 beats a TTY even without NO_COLOR', { stream: tty, env: { FORCE_COLOR: '0', TERM: 'xterm' } }, false],
    ['NO_COLOR=1 on TTY', { stream: tty, env: { NO_COLOR: '1' } }, false],
    ['NO_COLOR=0 still disables (any non-empty value)', { stream: tty, env: { NO_COLOR: '0' } }, false],
    ['NO_COLOR="" is ignored', { stream: tty, env: { NO_COLOR: '' } }, true],
    ['TERM=dumb on TTY', { stream: tty, env: { TERM: 'dumb' } }, false],
    ['TERM=xterm-256color on TTY', { stream: tty, env: { TERM: 'xterm-256color' } }, true],
    ['TERM=xterm on pipe', { stream: pipe, env: { TERM: 'xterm' } }, false],
    ['isTTY undefined', { stream: {}, env: {} }, false],
    ['no arguments at all on a pipe-less call', { env: {} }, false],
  ];
  for (const [label, args, expected] of cases) {
    test(`${label} → ${expected}`, () => assert.equal(shouldUseColor(args), expected));
  }
});

// ---------------------------------------------------------------------------------------
const SGR = /\x1b\[(\d+)m/g;

/** Walk SGR codes per line; return the lines that end with a non-default style. */
function bleedingLines(out) {
  const bad = [];
  for (const line of out.split('\n')) {
    const st = { bold: false, dim: false, fg: false };
    for (const [, code] of line.matchAll(SGR)) {
      const n = Number(code);
      if (n === 0) Object.assign(st, { bold: false, dim: false, fg: false });
      else if (n === 1) st.bold = true;
      else if (n === 2) st.dim = true;
      else if (n === 22) Object.assign(st, { bold: false, dim: false });
      else if (n >= 30 && n <= 37) st.fg = true;
      else if (n === 39) st.fg = false;
      else bad.push(`unknown SGR ${n}: ${JSON.stringify(line)}`);
    }
    if (st.bold || st.dim || st.fg) bad.push(JSON.stringify(line));
  }
  return bad;
}

function c(date, subject, files = [{ path: 'src/a.js', added: 3, removed: 1, binary: false }], email = 'a@x') {
  const linesAdded = files.reduce((n, f) => n + f.added, 0);
  const linesRemoved = files.reduce((n, f) => n + f.removed, 0);
  return { hash: `${date}${subject}`, author: 'A', email, date, subject, files, filesChanged: files.length, linesAdded, linesRemoved };
}

const PATHS = { html: 'o/wrapped.html', cardsDir: 'o/cards', cardCount: 8, pngDir: 'o/png', pngCount: 8, sharePng: 'o/share.png', shareSvg: 'o/share.svg' };
const PATHS_NOPNG = { ...PATHS, pngDir: null, pngCount: 0, sharePng: null };

describe('formatSummary edge cases', () => {
  let scenarios;
  before(() => {
    scenarios = {
      fixture: computeStats(fixture.commits, { today: TODAY }),
      empty: computeStats([], { today: TODAY }),
      single: computeStats([c('2024-03-10T21:00:00+00:00', 'hello world')], { today: TODAY }),
      noFiles: computeStats([c('2024-03-10T21:00:00+00:00', 'x', [])], { today: TODAY }),
      oldOnly: computeStats([c('2020-01-01T08:00:00+00:00', 'ancient')], { today: TODAY }),
    };
  });

  test('color:false → zero ESC chars, no null/undefined/NaN, newline-terminated', () => {
    for (const [name, stats] of Object.entries(scenarios)) {
      for (const paths of [PATHS, PATHS_NOPNG, {}]) {
        for (const notes of [[], ['Note: capped.']]) {
          const out = formatSummary(stats, { color: false, repoName: 'r', paths, notes });
          assert.ok(!out.includes('\x1b'), `${name}: ESC found`);
          assert.doesNotMatch(out, BAD_WORDS, name);
          assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'), name);
        }
      }
    }
  });

  test('color:true → every line ends with all styles reset (no color bleed)', () => {
    for (const [name, stats] of Object.entries(scenarios)) {
      for (const paths of [PATHS, PATHS_NOPNG]) {
        const out = formatSummary(stats, { color: true, repoName: 'r', paths, notes: ['Note: capped.'] });
        assert.deepEqual(bleedingLines(out), [], name);
        assert.doesNotMatch(out, BAD_WORDS, name);
        assert.equal(out.replace(SGR, ''), formatSummary(stats, { color: false, repoName: 'r', paths, notes: ['Note: capped.'] }), name);
        // Only plain 0-39 SGR codes, never a stray ESC without a complete sequence.
        assert.equal((out.match(/\x1b/g) ?? []).length, (out.match(SGR) ?? []).length, name);
      }
    }
  });

  test('color:true → first line has no SGR at all', () => {
    const out = formatSummary(scenarios.fixture, { color: true, paths: PATHS });
    assert.ok(!out.split('\n')[0].includes('\x1b'));
  });

  test('pluralization: 1 commit / 1 active day / 1 day / 1 card / 1 PNG / 1 fix', () => {
    const stats = computeStats([c('2024-03-13T10:00:00+00:00', 'fix: one thing')], { today: TODAY });
    const out = formatSummary(stats, { paths: { ...PATHS, cardCount: 1, pngCount: 1 } });
    assert.match(out, /^gitwrapped: 1 commit → /);
    assert.match(out, /1 commit · 1 active day · /);
    assert.match(out, /longest 1 day\b/);
    assert.match(out, /1 card in /);
    assert.match(out, /1 PNG in /);
    assert.match(out, /1 fix\b/);
    assert.doesNotMatch(out, /\b1 (commits|days|active days|cards|PNGs|fixes)\b/);
    assert.doesNotMatch(out, /\b0 (commit|day|card|PNG)\b(?!s)/);
  });

  test('pluralization: zero counts are plural', () => {
    const out = formatSummary(scenarios.empty, { paths: { ...PATHS, cardCount: 0, pngCount: 0 } });
    assert.match(out, /^gitwrapped: 0 commits → /);
    assert.match(out, /0 cards in /);
    assert.match(out, /0 PNGs in /);
  });

  test('large numbers use thousands separators', () => {
    const big = [c('2024-03-13T10:00:00+00:00', 'big', [{ path: 'x', added: 1234567, removed: 7654321, binary: false }])];
    const out = formatSummary(computeStats(big, { today: TODAY }), { paths: PATHS });
    assert.match(out, /\+1,234,567 \/ −7,654,321 lines/);
  });

  test('long hot-file path is shortened (stays on a sane line length)', () => {
    const path = `${'very-long-directory-name/'.repeat(30)}file.js`;
    const out = formatSummary(computeStats([c('2024-03-13T10:00:00+00:00', 'x', [{ path, added: 1, removed: 0, binary: false }])], { today: TODAY }));
    const line = out.split('\n').find((l) => l.includes('Hottest file'));
    assert.ok(line.length <= 100, `${line.length}: ${line}`);
    assert.match(line, /…[^ ]*file\.js/);
  });

  test('long emoji/CJK hot-file path is shortened by code points (no broken surrogate)', () => {
    const path = `${'😀日本/'.repeat(40)}語.js`;
    const out = formatSummary(computeStats([c('2024-03-13T10:00:00+00:00', 'x', [{ path, added: 1, removed: 0, binary: false }])], { today: TODAY }));
    const line = out.split('\n').find((l) => l.includes('Hottest file'));
    assert.match(line, /語\.js/);
    assert.ok(line.isWellFormed(), 'no lone surrogates');
    assert.ok([...line].length <= 100, line);
  });

  test('emoji / CJK repo names render as-is', () => {
    for (const repoName of ['日本語のレポ', 'rocket 🚀 app', 'Ünïcødé-repo', '👩‍👩‍👧‍👦']) {
      for (const color of [false, true]) {
        const out = formatSummary(scenarios.fixture, { color, repoName, paths: PATHS });
        assert.ok(out.replace(SGR, '').includes(`★ ${repoName} Wrapped`), repoName);
        assert.ok(out.isWellFormed());
      }
    }
  });

  test('no line exceeds 200 chars for realistic input (fixture + long roast)', () => {
    for (const stats of Object.values(scenarios)) {
      const out = formatSummary(stats, { color: false, repoName: 'a-reasonably-long-repository-name', paths: PATHS, notes: ['Note: this repo has more than 50,000 commits; only the most recent 50,000 were analyzed.'] });
      for (const line of out.split('\n')) assert.ok(line.length <= 200, `${line.length}: ${line}`);
    }
  });

  test('a very long top word does not produce an absurdly long line', () => {
    const word = 'supercalifragilistic'.repeat(15);
    const stats = computeStats([c('2024-03-13T10:00:00+00:00', `${word} ${word}`), c('2024-03-12T10:00:00+00:00', word)], { today: TODAY });
    assert.equal(stats.messages.topWord.word, word);
    const out = formatSummary(stats, { paths: PATHS });
    for (const line of out.split('\n')) assert.ok(line.length <= 200, `${line.length}: ${line.slice(0, 60)}…`);
    const line = out.split('\n').find((l) => l.includes('Top word'));
    assert.ok(line.includes(`"${word.slice(0, 31)}…"`), line);
  });

  test('a long astral-plane top word is shortened by code points; short words are untouched', () => {
    const word = '𝒜'.repeat(50); // U+1D49C, a surrogate pair per letter
    const stats = computeStats([c('2024-03-13T10:00:00+00:00', `${word} ${word}`)], { today: TODAY });
    assert.equal(stats.messages.topWord.word, word);
    const out = formatSummary(stats, { paths: PATHS });
    const line = out.split('\n').find((l) => l.includes('Top word'));
    assert.ok(line.isWellFormed(), 'no lone surrogates');
    assert.ok(line.includes(`"${'𝒜'.repeat(31)}…"`), line);
    const exact = 'a'.repeat(32);
    const out2 = formatSummary(computeStats([c('2024-03-13T10:00:00+00:00', `${exact} ${exact}`)], { today: TODAY }), { paths: PATHS });
    assert.ok(out2.includes(`"${exact}"`), out2);
  });

  test('stats with odd values (NaN / Infinity / negative / missing fields) never print null/undefined/NaN', () => {
    const weird = {
      totals: { commits: 3, linesAdded: NaN, linesRemoved: Infinity, activeDays: undefined },
      habits: { peakHourLabel: '3 AM', peakHourCount: NaN },
      streaks: { longest: { length: 2 }, current: { length: NaN } },
      hotFiles: [{ path: 'a.js', commits: undefined }],
      messages: { topWord: { word: 'x', count: undefined }, counts: { fix: NaN } },
      personality: { archetype: { name: 'Night Owl' } },
    };
    for (const color of [false, true]) {
      const out = formatSummary(weird, { color, paths: {} });
      assert.doesNotMatch(out, BAD_WORDS);
      if (color) assert.deepEqual(bleedingLines(out), []);
    }
  });
});

describe('run: color through the CLI', () => {
  test('FORCE_COLOR=1 on a pipe → colored recap without bleed; TERM=dumb TTY → plain', async () => {
    const sink = (isTTY) => ({ data: '', isTTY, write(s) { this.data += s; return true; } });
    const out = join(tmp, 'color-run');
    const a = sink(false);
    assert.equal(await run([fixture.dir, '--out', out, '--no-png'], { stdout: a, stderr: sink(false), env: { FORCE_COLOR: '1' }, today: TODAY }), 0);
    assert.match(a.data, /\x1b\[/);
    assert.deepEqual(bleedingLines(a.data), []);
    const b = sink(true);
    assert.equal(await run([fixture.dir, '--out', out, '--no-png'], { stdout: b, stderr: sink(false), env: { TERM: 'dumb' }, today: TODAY }), 0);
    assert.ok(!b.data.includes('\x1b'));
  });

  test('bin: FORCE_COLOR=1 colors; --no-color and NO_COLOR keep it plain', () => {
    const out = join(tmp, 'color-bin');
    const forced = bin([fixture.dir, '--out', out, '--no-png'], { env: { FORCE_COLOR: '1' } });
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /\x1b\[/);
    assert.deepEqual(bleedingLines(forced.stdout), []);
    const flag = bin([fixture.dir, '--out', out, '--no-png', '--no-color'], { env: { FORCE_COLOR: '1' } });
    assert.ok(!flag.stdout.includes('\x1b'));
    const nc = bin([fixture.dir, '--out', out, '--no-png'], { env: { NO_COLOR: '1' } });
    assert.ok(!nc.stdout.includes('\x1b'));
  });
});

// ---------------------------------------------------------------------------------------
/**
 * The full card set in `out`: by default for a repo with at most one author (every card
 * but the contributors card); pass `team` for the two-author fixture (every card).
 */
function assertFullOutput(out, { team = false } = {}) {
  const count = team ? CARD_IDS.length : cardIdsFor({}).length;
  assert.equal(readdirSync(join(out, 'cards')).length, count);
  const page = readFileSync(join(out, 'wrapped.html'), 'utf8');
  assert.match(page, /^<!doctype html>/);
  assert.equal((page.match(/<svg\b/g) ?? []).length, count);
  for (const f of readdirSync(join(out, 'cards'))) {
    assert.doesNotMatch(readFileSync(join(out, 'cards', f), 'utf8').replace(/<[^>]*>/g, ' '), BAD_WORDS, f);
  }
}

describe('bin: odd repo shapes', () => {
  test('empty repo (git init only) → exit 0, 8 cards + wrapped.html, "No commits found"', () => {
    const dir = join(tmp, 'empty-repo');
    mkdirSync(dir);
    initRepo(dir);
    const out = join(tmp, 'empty-out');
    const r = bin([dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.ok(r.stdout.startsWith(`gitwrapped: 0 commits → ${join(out, 'wrapped.html')}\n`), r.stdout);
    assert.match(r.stdout, /No commits found/);
    assert.doesNotMatch(r.stdout, BAD_WORDS);
    assertFullOutput(out);
  });

  test('empty repo with PNGs on → still exits 0 with PNGs', () => {
    const dir = join(tmp, 'empty-repo-png');
    mkdirSync(dir);
    initRepo(dir);
    const out = join(tmp, 'empty-out-png');
    const r = bin([dir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /share image: .*\.png\n$/);
    assertFullOutput(out);
  });

  test('merge of two unrelated roots: all 3 commits counted, merge commit has no files', async () => {
    const dir = join(tmp, 'merge-repo');
    mkdirSync(dir);
    initRepo(dir);
    commitAt(dir, 'root a', { author: '2024-03-01T10:00:00Z', file: 'a.txt' });
    git(dir, ['checkout', '-q', '--orphan', 'other']);
    git(dir, ['rm', '-rq', '--cached', '.']);
    rmSync(join(dir, 'a.txt'));
    commitAt(dir, 'root b', { author: '2024-03-02T10:00:00Z', file: 'b.txt' });
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '-q', '--no-edit', '--allow-unrelated-histories', 'other'], {
      GIT_AUTHOR_DATE: '2024-03-03T10:00:00Z',
      GIT_COMMITTER_DATE: '2024-03-03T10:00:00Z',
    });
    const { commits } = await readHistory(dir);
    assert.equal(commits.length, 3);
    assert.match(commits[0].subject, /^Merge branch 'other'/);
    assert.deepEqual(commits[0].files, []);
    const out = join(tmp, 'merge-out');
    const r = bin([dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 3 commits → /);
    assertFullOutput(out);
  });

  test('detached HEAD → analyzes the history reachable from HEAD', () => {
    const dir = join(tmp, 'detached');
    mkdirSync(dir);
    initRepo(dir);
    for (let i = 0; i < 4; i++) commitAt(dir, `c${i}`, { author: `2024-03-0${i + 1}T10:00:00Z`, file: 'f.txt' });
    git(dir, ['checkout', '-q', '--detach', 'HEAD~2']);
    const out = join(tmp, 'detached-out');
    const r = bin([dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 2 commits → /);
    assert.match(r.stdout, /★ detached Wrapped/);
  });

  test('path with spaces and unicode in the dir name', () => {
    const dir = join(tmp, 'my repo ✨ 日本 (copy)');
    const fx = makeFixtureRepo({ dir });
    const out = join(tmp, 'out dir ünï 🚀');
    const r = bin([fx.dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith(`gitwrapped: ${fx.commits.length} commits → ${join(out, 'wrapped.html')}\n`), r.stdout);
    assert.match(r.stdout, /★ my repo ✨ 日本 \(copy\) Wrapped/);
    assertFullOutput(out, { team: true });
    assert.ok(readFileSync(join(out, 'cards', '01-intro.svg'), 'utf8').includes('日本'), 'repo name reaches the intro card');
  });

  test('"." from a subdirectory analyzes the whole repo; repo name is the top-level basename', () => {
    const sub = join(fixture.dir, 'notes');
    assert.ok(existsSync(sub));
    const out = join(tmp, 'subdir-out');
    const r = bin(['.', '--out', out, '--no-png'], { cwd: sub });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^gitwrapped: ${fixture.commits.length} commits → `));
    const top = basename(fixture.dir);
    assert.ok(r.stdout.includes(`★ ${top} Wrapped`), r.stdout);
    assert.doesNotMatch(r.stdout, /★ notes Wrapped/);
    // No path argument at all behaves the same.
    const r2 = bin(['--out', join(tmp, 'subdir-out2'), '--no-png'], { cwd: sub });
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(r2.stdout.includes(`★ ${top} Wrapped`), r2.stdout);
  });

  test('relative --out from a subdirectory is resolved against cwd', () => {
    const sub = join(fixture.dir, 'src');
    const r = bin(['..', '--out', 'rel-out', '--no-png'], { cwd: sub });
    try {
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(sub, 'rel-out', 'wrapped.html')));
    } finally {
      rmSync(join(sub, 'rel-out'), { recursive: true, force: true, maxRetries: 5 });
    }
  });

  test('bare repo: works (git log reads it); name is the dir basename without ".git"', () => {
    const bare = join(tmp, 'bare ✨.git');
    git(tmp, ['clone', '-q', '--bare', fixture.dir, bare]);
    const out = join(tmp, 'bare-out');
    const r = bin([bare, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^gitwrapped: ${fixture.commits.length} commits → `));
    // `rev-parse --show-toplevel` fails in a bare repo, so the heading falls back to the
    // folder name with its ".git" suffix stripped.
    assert.match(r.stdout, /★ bare ✨ Wrapped/);
    assertFullOutput(out, { team: true });
  });

  test('inside a .git directory → reported as not a repo or analyzed, never a crash', () => {
    const r = bin([join(fixture.dir, '.git'), '--out', join(tmp, 'dotgit-out'), '--no-png']);
    assert.ok(r.status === 0 || r.status === 1, `${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    if (r.status === 0) {
      const top = basename(fixture.dir);
      assert.ok(r.stdout.includes(`★ ${top} Wrapped`), r.stdout);
    }
  });

  test('missing path / file path via the binary → exit 1, specific message', () => {
    const missing = join(tmp, 'no such dir');
    let r = bin([missing, '--out', join(tmp, 'x1'), '--no-png']);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: path does not exist: ${missing}\n`);
    const file = join(tmp, 'a file.txt');
    writeFileSync(file, 'x');
    r = bin([file, '--out', join(tmp, 'x2'), '--no-png']);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `gitwrapped: not a directory: ${file}\n`);
    r = bin([join(file, 'child'), '--out', join(tmp, 'x3'), '--no-png']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /path does not exist/);
  });
});
