import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCli, run, HELP_TEXT, readVersion } from '../src/cli.js';
import { CARD_IDS } from '../src/cards/index.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function sink() {
  let data = '';
  return {
    write(s) {
      data += s;
      return true;
    },
    get data() {
      return data;
    },
  };
}

async function runCaptured(argv, opts = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await run(argv, { stdout, stderr, env: {}, ...opts });
  return { code, stdout: stdout.data, stderr: stderr.data };
}

const DEFAULTS = { path: '.', since: undefined, author: undefined, out: 'gitwrapped-out', png: true, maxCommits: 50000 };

describe('parseCli', () => {
  test('defaults with no arguments', () => {
    assert.deepEqual(parseCli([]), DEFAULTS);
  });

  test('positional path', () => {
    assert.deepEqual(parseCli(['../repo']), { ...DEFAULTS, path: '../repo' });
  });

  test('--since with separate value', () => {
    assert.equal(parseCli(['--since', '2025-01-15']).since, '2025-01-15');
  });

  test('--since=value form', () => {
    assert.equal(parseCli(['--since=2025-01-15']).since, '2025-01-15');
  });

  test('--author with separate value and = form', () => {
    assert.equal(parseCli(['--author', 'a@b.com']).author, 'a@b.com');
    assert.equal(parseCli(['--author=a@b.com']).author, 'a@b.com');
  });

  test('--no-png turns PNG export off', () => {
    assert.equal(parseCli(['--no-png']).png, false);
    assert.deepEqual(parseCli(['repo', '--no-png', '--out', 'o']), { ...DEFAULTS, path: 'repo', out: 'o', png: false });
    assert.throws(() => parseCli(['--no-png=yes']), /--no-png/);
  });

  test('--out with separate value and = form', () => {
    assert.equal(parseCli(['--out', 'dist']).out, 'dist');
    assert.equal(parseCli(['--out=dist']).out, 'dist');
  });

  test('all flags together with a path, in any order', () => {
    const expected = { path: 'repo', since: '2024-06-01', author: 'x@y.z', out: 'o', png: true, maxCommits: 50000 };
    assert.deepEqual(
      parseCli(['repo', '--since', '2024-06-01', '--author', 'x@y.z', '--out', 'o']),
      expected,
    );
    assert.deepEqual(
      parseCli(['--out=o', '--author=x@y.z', 'repo', '--since=2024-06-01']),
      expected,
    );
  });

  test('--help and -h', () => {
    assert.deepEqual(parseCli(['--help']), { help: true });
    assert.deepEqual(parseCli(['-h']), { help: true });
  });

  test('--version and -v', () => {
    assert.deepEqual(parseCli(['--version']), { version: true });
    assert.deepEqual(parseCli(['-v']), { version: true });
  });

  test('help takes precedence over other valid options', () => {
    assert.deepEqual(parseCli(['repo', '--since', '2025-01-01', '-h']), { help: true });
  });

  describe('--since validation', () => {
    for (const bad of ['2025-1-5', '25-01-05', '2025/01/05', '20250105', 'yesterday', '2025-01-05T00:00', ' 2025-01-05']) {
      test(`rejects bad format ${JSON.stringify(bad)}`, () => {
        assert.throws(() => parseCli(['--since', bad]), /invalid --since .*YYYY-MM-DD/);
      });
    }

    for (const impossible of ['2025-02-30', '2025-13-01', '2025-00-10', '2025-04-31', '2025-01-00', '2023-02-29']) {
      test(`rejects impossible date ${impossible}`, () => {
        assert.throws(() => parseCli(['--since', impossible]), /not a real calendar date/);
      });
    }

    test('accepts leap day 2024-02-29', () => {
      assert.equal(parseCli(['--since', '2024-02-29']).since, '2024-02-29');
    });

    test('accepts leap day 2000-02-29 but rejects 1900-02-29', () => {
      assert.equal(parseCli(['--since=2000-02-29']).since, '2000-02-29');
      assert.throws(() => parseCli(['--since=1900-02-29']), /not a real calendar date/);
    });

    test('accepts month/year boundaries', () => {
      assert.equal(parseCli(['--since', '2025-12-31']).since, '2025-12-31');
      assert.equal(parseCli(['--since', '2025-01-01']).since, '2025-01-01');
    });
  });

  test('unknown long flag throws', () => {
    assert.throws(() => parseCli(['--bogus']), /Unknown option '--bogus'/);
  });

  test('unknown short flag throws', () => {
    assert.throws(() => parseCli(['-x']), /Unknown option '-x'/);
  });

  test('unknown flag error has Node verbose suffix stripped', () => {
    assert.throws(
      () => parseCli(['--bogus']),
      (err) => {
        assert.doesNotMatch(err.message, /positional argument/);
        return true;
      },
    );
  });

  test('two positionals throw', () => {
    assert.throws(() => parseCli(['a', 'b']), /at most one path, got 2/);
  });

  test('missing value for --since throws', () => {
    assert.throws(() => parseCli(['--since']), /--since/);
  });

  test('flag-looking value for --since is rejected with a single-line message', () => {
    // `--since --author x` is ambiguous; the user-facing message should be one line
    // (parseCli strips Node's verbose suffix for other errors).
    assert.throws(
      () => parseCli(['--since', '--author', 'x']),
      (err) => {
        assert.match(err.message, /--since/);
        assert.doesNotMatch(err.message, /\n/, `message should be single-line, got: ${JSON.stringify(err.message)}`);
        return true;
      },
    );
  });

  for (const name of ['since', 'author', 'out']) {
    test(`empty --${name}= value throws`, () => {
      assert.throws(() => parseCli([`--${name}=`]), new RegExp(`--${name} requires a non-empty value`));
    });
    test(`empty --${name} "" value throws`, () => {
      assert.throws(() => parseCli([`--${name}`, '']), new RegExp(`--${name} requires a non-empty value`));
    });
    test(`whitespace-only --${name} value throws`, () => {
      assert.throws(() => parseCli([`--${name}`, '   ']), new RegExp(`--${name} requires a non-empty value`));
    });
  }
});

describe('run', () => {
  test('--help prints HELP_TEXT to stdout and exits 0', async () => {
    for (const flag of ['--help', '-h']) {
      const r = await runCaptured([flag]);
      assert.equal(r.code, 0);
      assert.equal(r.stdout, HELP_TEXT);
      assert.equal(r.stderr, '');
    }
  });

  test('HELP_TEXT documents every option', () => {
    for (const s of ['Usage: gitwrapped', '--since', '--author', '--out', '--no-png', '-h, --help', '-v, --version', 'YYYY-MM-DD']) {
      assert.ok(HELP_TEXT.includes(s), `HELP_TEXT missing ${s}`);
    }
  });

  test('--version / -v prints package.json version and exits 0', async () => {
    for (const flag of ['--version', '-v']) {
      const r = await runCaptured([flag]);
      assert.equal(r.code, 0);
      assert.equal(r.stdout, `${PKG.version}\n`);
      assert.equal(r.stderr, '');
    }
  });

  test('readVersion matches package.json', () => {
    assert.equal(readVersion(), PKG.version);
    assert.match(readVersion(), /^\d+\.\d+\.\d+/);
  });

  test('generates cards and wrapped.html for the fixture repo', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-out-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true });
    });
    const dest = join(out, 'nested', 'dir');
    const r = await runCaptured([fixture.dir, '--out', dest, '--no-png'], { today: '2024-03-14' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    const html = join(dest, 'wrapped.html');
    assert.ok(r.stdout.startsWith(`gitwrapped: ${fixture.commits.length} commits → ${html}\n`), r.stdout);
    const expected = CARD_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`);
    assert.deepEqual(readdirSync(join(dest, 'cards')).sort(), expected);
    assert.ok(r.stdout.includes(`${CARD_IDS.length} cards in ${join(dest, 'cards')}\n`), r.stdout);
    assert.ok(!r.stdout.includes(expected[0]), 'card files are not listed one by one');
    assert.ok(!r.stdout.includes('\x1b'), 'no ANSI escapes when not a TTY');
    const page = readFileSync(html, 'utf8');
    assert.match(page, /^<!doctype html>/);
    assert.equal((page.match(/<svg\b/g) ?? []).length, CARD_IDS.length);
    assert.match(page, /<title>gitwrapped · [^<]+<\/title>/);
    assert.match(readFileSync(join(dest, 'share.svg'), 'utf8'), /^<svg [^>]*width="1200" height="630"/);
    assert.ok(r.stdout.includes(`share image: ${join(dest, 'share.svg')}`), r.stdout);
    assert.equal(existsSync(join(dest, 'png')), false, '--no-png writes no PNGs');
    assert.equal(existsSync(join(dest, 'share.png')), false);
  });

  test('--author with no matching commits still generates cards and exits 0', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-out-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true });
    });
    const r = await runCaptured([fixture.dir, '--author', 'nobody@example.com', '--out', out, '--no-png']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 0 commits → /);
    assert.ok(existsSync(join(out, 'wrapped.html')));
    assert.equal(readdirSync(join(out, 'cards')).length, CARD_IDS.length);
  });

  test('a path that is not a git repo exits 1 with a message on stderr', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-norepo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, 'out');
    const r = await runCaptured([dir, '--out', out]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `gitwrapped: not a git repository: ${dir}\n`);
    assert.equal(existsSync(out), false, 'nothing is written on error');
  });

  test('a missing path or a file path exits 1 with a specific message', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-norepo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, 'out');
    const missing = join(dir, 'missing');
    let r = await runCaptured([missing, '--out', out]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `gitwrapped: path does not exist: ${missing}\n`);
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    r = await runCaptured([file, '--out', out]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `gitwrapped: not a directory: ${file}\n`);
    assert.equal(existsSync(out), false, 'nothing is written on error');
  });

  test('an empty repo (git init, no commits) exits 0 with a "No commits found" notice', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-empty-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    spawnSync('git', ['init', '-q', dir]);
    const out = join(dir, 'out');
    const r = await runCaptured([dir, '--out', out, '--no-png']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.ok(r.stdout.startsWith(`gitwrapped: 0 commits → ${join(out, 'wrapped.html')}\n`), r.stdout);
    assert.match(r.stdout, /No commits found/);
    assert.doesNotMatch(r.stdout, /null|undefined|NaN/);
    assert.equal(readdirSync(join(out, 'cards')).length, CARD_IDS.length);
  });

  test('--max-commits caps the history and prints a notice', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-out-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true });
    });
    const r = await runCaptured([fixture.dir, '--out', out, '--no-png', '--max-commits', '3'], { today: '2024-03-14' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 3 commits → /);
    assert.ok(r.stdout.includes('Note: this repo has more than 3 commits; only the most recent 3 were analyzed.'), r.stdout);
    const all = await runCaptured([fixture.dir, '--out', out, '--no-png', '--max-commits', String(fixture.commits.length)], { today: '2024-03-14' });
    assert.match(all.stdout, new RegExp(`^gitwrapped: ${fixture.commits.length} commits → `));
    assert.doesNotMatch(all.stdout, /Note:/, 'exactly the cap is not truncated');
  });

  test('color: FORCE_COLOR colors the recap, --no-color and NO_COLOR keep it plain', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-out-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true });
    });
    const args = [fixture.dir, '--out', out, '--no-png'];
    const forced = await runCaptured(args, { env: { FORCE_COLOR: '1' }, today: '2024-03-14' });
    assert.match(forced.stdout, /\x1b\[/);
    assert.ok(forced.stdout.startsWith(`gitwrapped: ${fixture.commits.length} commits → `), 'first line stays plain');
    const flag = await runCaptured([...args, '--no-color'], { env: { FORCE_COLOR: '1' }, today: '2024-03-14' });
    assert.ok(!flag.stdout.includes('\x1b'));
    const tty = Object.assign(sink(), { isTTY: true });
    assert.equal(await run(args, { stdout: tty, stderr: sink(), env: {}, today: '2024-03-14' }), 0);
    assert.match(tty.data, /\x1b\[/, 'a TTY gets color by default');
    const ttyNo = Object.assign(sink(), { isTTY: true });
    assert.equal(await run(args, { stdout: ttyNo, stderr: sink(), env: { NO_COLOR: '1' }, today: '2024-03-14' }), 0);
    assert.match(ttyNo.data, /^gitwrapped: /);
    assert.ok(!ttyNo.data.includes('\x1b'), 'NO_COLOR disables color on a TTY');
  });

  test('a non-Error throw is reported as its string value', async (t) => {
    const fixture = makeFixtureRepo();
    const out = mkdtempSync(join(tmpdir(), 'gw-out-'));
    t.after(() => {
      fixture.cleanup();
      rmSync(out, { recursive: true, force: true });
    });
    const boom = { toJSON() { throw 'boom'; }, toString() { throw 'boom'; } }; // eslint-disable-line no-throw-literal
    const r = await runCaptured([fixture.dir, '--out', out, '--no-png'], { today: boom });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'gitwrapped: boom\n');
    assert.equal(readdirSync(out).length, 0, 'nothing written');
  });

  const errorCases = [
    [['--bogus'], /Unknown option '--bogus'/],
    [['a', 'b'], /at most one path/],
    [['--since', '2025-02-30'], /not a real calendar date/],
    [['--since', 'nope'], /YYYY-MM-DD/],
    [['--out='], /--out requires a non-empty value/],
    [['--since'], /--since/],
    [['--max-commits', '0'], /invalid --max-commits "0"/],
    [['--max-commits', '-3'], /--max-commits/],
    [['--max-commits', '1.5'], /invalid --max-commits/],
    [['--max-commits', 'lots'], /invalid --max-commits/],
    [['--no-color=yes'], /--no-color/],
  ];
  for (const [argv, re] of errorCases) {
    test(`run ${JSON.stringify(argv)} exits 2 with error on stderr only`, async () => {
      const r = await runCaptured(argv);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^gitwrapped: /);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Run "gitwrapped --help" for usage\.\n$/);
    });
  }
});

describe('end-to-end bin', () => {
  function spawnBin(args) {
    return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8' });
  }

  test('--version exits 0 and prints version', () => {
    const r = spawnBin(['--version']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${PKG.version}\n`);
    assert.equal(r.stderr, '');
  });

  test('--help exits 0 and prints usage', () => {
    const r = spawnBin(['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, HELP_TEXT);
  });

  test('--bogus exits 2 with stderr message', () => {
    const r = spawnBin(['--bogus']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^gitwrapped: Unknown option '--bogus'/);
  });
});

describe('package metadata', () => {
  test('package.json has bin, type module, engines >=20, test script', () => {
    assert.equal(PKG.name, 'gitwrapped');
    assert.equal(PKG.type, 'module');
    assert.equal(PKG.bin?.gitwrapped, 'bin/gitwrapped.js');
    assert.equal(PKG.engines?.node, '>=20');
    assert.equal(PKG.license, 'MIT');
    assert.match(PKG.scripts?.test ?? '', /node --test/);
  });

  test('bin file starts with a node shebang', () => {
    const src = readFileSync(BIN, 'utf8');
    assert.ok(src.startsWith('#!/usr/bin/env node\n'), 'bin/gitwrapped.js must start with shebang');
  });

  test('LICENSE is MIT and .gitignore ignores node_modules', () => {
    assert.match(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'), /^MIT License/);
    assert.match(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8'), /^node_modules\/?$/m);
  });
});

test('--author and --out values are trimmed', async () => {
  const { parseCli } = await import('../src/cli.js');
  const r = parseCli(['--author', ' a@b.c ', '--out', ' dist ']);
  assert.equal(r.author, 'a@b.c');
  assert.equal(r.out, 'dist');
});
