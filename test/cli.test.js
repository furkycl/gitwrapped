import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs, main, HELP_TEXT, getVersion } from '../src/cli.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function capture() {
  let out = '';
  return { write: (s) => { out += s; return true; }, get text() { return out; } };
}

function run(argv) {
  const stdout = capture();
  const stderr = capture();
  const code = main(argv, { stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

describe('parseArgs', () => {
  test('applies defaults', () => {
    assert.deepEqual(parseArgs([]), {
      path: '.', since: null, author: null, out: 'gitwrapped-out', help: false, version: false,
    });
  });

  test('reads all flags and the path', () => {
    const o = parseArgs(['repo', '--since', '2026-01-31', '--author', 'a@b.c', '--out', 'x']);
    assert.deepEqual(o, {
      path: 'repo', since: '2026-01-31', author: 'a@b.c', out: 'x', help: false, version: false,
    });
  });

  test('accepts flags before the path', () => {
    const o = parseArgs(['--out', 'dist', '../other']);
    assert.equal(o.path, '../other');
    assert.equal(o.out, 'dist');
  });

  test('accepts --flag=value syntax', () => {
    const o = parseArgs(['--since=2025-06-01', '--author=me@x.io', '--out=o']);
    assert.equal(o.since, '2025-06-01');
    assert.equal(o.author, 'me@x.io');
    assert.equal(o.out, 'o');
  });

  test('--since alone', () => {
    assert.equal(parseArgs(['--since', '2024-01-01']).since, '2024-01-01');
  });

  test('--author alone', () => {
    const o = parseArgs(['--author', 'dev@example.com']);
    assert.equal(o.author, 'dev@example.com');
    assert.equal(o.since, null);
  });

  test('--out alone', () => {
    assert.equal(parseArgs(['--out', 'cards']).out, 'cards');
  });

  test('--help and -h', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
  });

  test('--version and -v', () => {
    assert.equal(parseArgs(['--version']).version, true);
    assert.equal(parseArgs(['-v']).version, true);
  });

  test('accepts a valid leap day', () => {
    assert.equal(parseArgs(['--since', '2024-02-29']).since, '2024-02-29');
    assert.equal(parseArgs(['--since', '0099-01-01']).since, '0099-01-01');
  });

  for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2025-02-29', '2026-00-10', '2026-01-00',
    '2026-1-1', '2026/01/01', 'yesterday', ' 2026-01-01', '2026-01-01T00:00']) {
    test(`rejects invalid --since date ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseArgs(['--since', bad]), /invalid --since date/);
    });
  }

  test('rejects multiple positionals', () => {
    assert.throws(() => parseArgs(['a', 'b']), /at most one path, got 2: a b/);
    assert.throws(() => parseArgs(['a', 'b', 'c']), /got 3/);
  });

  test('rejects unknown long and short flags', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
    assert.throws(() => parseArgs(['-x']), /unknown option -x/);
  });

  for (const flag of ['--since', '--author', '--out']) {
    test(`rejects ${flag} with missing value`, () => {
      assert.throws(() => parseArgs([flag]), /argument missing/);
    });
    test(`rejects ${flag} with empty value`, () => {
      assert.throws(() => parseArgs([`${flag}=`]), new RegExp(`${flag} requires a non-empty value`));
      assert.throws(() => parseArgs([flag, '']), new RegExp(`${flag} requires a non-empty value`));
    });
  }

  test('rejects a value that looks like a flag', () => {
    assert.throws(() => parseArgs(['--since', '-v']), /ambiguous/);
  });

  test('rejects a value for boolean flags', () => {
    assert.throws(() => parseArgs(['--help=x']), Error);
  });

  test('always throws plain Error instances', () => {
    try {
      parseArgs(['--nope']);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
    }
  });
});

describe('getVersion', () => {
  test('matches package.json', () => {
    assert.equal(getVersion(), pkg.version);
  });
});

describe('HELP_TEXT', () => {
  test('documents every option', () => {
    for (const s of ['Usage: gitwrapped', '[path]', '--since', 'YYYY-MM-DD', '--author', '--out',
      '-h, --help', '-v, --version']) {
      assert.ok(HELP_TEXT.includes(s), `missing ${s}`);
    }
    assert.ok(HELP_TEXT.endsWith('\n'));
  });
});

describe('main', () => {
  test('--help prints help to stdout, returns 0', () => {
    const r = run(['--help']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, HELP_TEXT);
    assert.equal(r.stderr, '');
  });

  test('-h prints help', () => {
    const r = run(['-h']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, HELP_TEXT);
  });

  test('--version prints package version', () => {
    const r = run(['--version']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `${pkg.version}\n`);
    assert.equal(r.stderr, '');
  });

  test('-v prints package version', () => {
    const r = run(['-v']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, `${pkg.version}\n`);
  });

  test('--help wins over --version', () => {
    assert.equal(run(['--version', '--help']).stdout, HELP_TEXT);
  });

  test('--help with other valid options still prints help', () => {
    const r = run(['repo', '--out', 'x', '--help']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, HELP_TEXT);
  });

  test('no args returns 0 and reports defaults', () => {
    const r = run([]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /path=\./);
    assert.match(r.stdout, /since=any/);
    assert.match(r.stdout, /author=any/);
    assert.match(r.stdout, /out=gitwrapped-out/);
    assert.equal(r.stderr, '');
  });

  test('reports parsed options', () => {
    const r = run(['r', '--since', '2024-02-29', '--author', 'a@b.c', '--out', 'o']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /path=r, since=2024-02-29, author=a@b\.c, out=o/);
  });

  for (const argv of [
    ['--since', 'nope'],
    ['--since', '2026-02-30'],
    ['--nope'],
    ['-x'],
    ['a', 'b'],
    ['--author'],
    ['--out='],
  ]) {
    test(`returns 2 with hint on stderr for ${JSON.stringify(argv)}`, () => {
      const r = run(argv);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^gitwrapped: /);
      assert.match(r.stderr, /Run gitwrapped --help for usage\.\n$/);
    });
  }

  test('bad input returns 2 even if --help is also given', () => {
    const r = run(['--help', '--nope']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown option --nope/);
  });
});
