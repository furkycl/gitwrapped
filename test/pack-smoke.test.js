// Unit tests for the pure helpers of scripts/pack-smoke.js. The full smoke run (npm pack +
// npm install from the registry) is not run here: it needs network and is slow. CI runs it
// as its own job (`npm run pack-smoke`).
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARD_COUNT,
  binLinkPath,
  checkOutputDir,
  checkTarballFiles,
  installedBinScript,
  parsePackJson,
  pngSize,
  shellArg,
  shouldKeep,
} from '../scripts/pack-smoke.js';

const GOOD = ['LICENSE', 'README.md', 'CHANGELOG.md', 'package.json', 'bin/gitwrapped.js', 'src/cli.js', 'src/cards/index.js'];

test('checkTarballFiles accepts the runtime-only file list', () => {
  assert.deepEqual(checkTarballFiles(GOOD), []);
  assert.deepEqual(checkTarballFiles(GOOD.map((f) => `package/${f}`)), [], 'tolerates the package/ prefix');
  assert.deepEqual(checkTarballFiles(['bin\\gitwrapped.js', ...GOOD.filter((f) => f !== 'bin/gitwrapped.js')]), []);
});

test('checkTarballFiles flags dev files, stray files and missing runtime files', () => {
  const problems = checkTarballFiles([...GOOD, 'test/cli.test.js', 'docs/hero.gif', '.loop/LOOP.md', '.github/workflows/ci.yml', 'scripts/pack-smoke.js', 'notes.txt']);
  for (const f of ['test/cli.test.js', 'docs/hero.gif', '.loop/LOOP.md', '.github/workflows/ci.yml', 'scripts/pack-smoke.js']) {
    assert.ok(problems.includes(`must not ship ${f}`), f);
  }
  assert.ok(problems.includes('unexpected file notes.txt'));
  const nested = checkTarballFiles([...GOOD, 'src/node_modules/x/index.js', 'src/cli.test.js', 'bin/x.test.js']);
  assert.deepEqual(nested, ['must not ship src/node_modules/x/index.js', 'must not ship src/cli.test.js', 'must not ship bin/x.test.js']);
  assert.deepEqual(checkTarballFiles(GOOD.filter((f) => f !== 'bin/gitwrapped.js')), ['missing bin/gitwrapped.js']);
});

test('parsePackJson reads filename and files, skipping leading noise', () => {
  const json = JSON.stringify([{ filename: 'furkycl-gitwrapped-1.0.0.tgz', files: [{ path: 'package.json' }, { path: 'bin/gitwrapped.js' }] }]);
  assert.deepEqual(parsePackJson(`> prepack\nsome output\n${json}\n`), {
    filename: 'furkycl-gitwrapped-1.0.0.tgz',
    files: ['package.json', 'bin/gitwrapped.js'],
  });
  const noisy = `npm warn something [deprecated] here\n${json}`;
  assert.equal(parsePackJson(noisy).filename, 'furkycl-gitwrapped-1.0.0.tgz', 'skips noise lines containing [');
  assert.throws(() => parsePackJson('no json here'), /no JSON/);
  assert.throws(() => parsePackJson('inline [not at line start'), /no JSON/);
  assert.throws(() => parsePackJson('[{}]'), /unexpected shape/);
});

test('bin paths per platform', () => {
  assert.equal(binLinkPath('proj', 'linux'), join('proj', 'node_modules', '.bin', 'gitwrapped'));
  assert.equal(binLinkPath('proj', 'darwin'), join('proj', 'node_modules', '.bin', 'gitwrapped'));
  assert.equal(binLinkPath('proj', 'win32'), join('proj', 'node_modules', '.bin', 'gitwrapped.cmd'));
  assert.equal(installedBinScript('proj'), join('proj', 'node_modules', '@furkycl', 'gitwrapped', 'bin', 'gitwrapped.js'));
});

test('shellArg quotes only on Windows and only when needed', () => {
  assert.equal(shellArg('C:\\a b\\x.tgz', 'linux'), 'C:\\a b\\x.tgz');
  assert.equal(shellArg('C:\\tmp\\x.tgz', 'win32'), 'C:\\tmp\\x.tgz');
  assert.equal(shellArg('C:\\a b\\x.tgz', 'win32'), '"C:\\a b\\x.tgz"');
  assert.equal(shellArg('a&b', 'win32'), '"a&b"');
  assert.equal(shellArg('50%', 'linux'), '50%');
  assert.throws(() => shellArg('C:\\%TEMP%\\x.tgz', 'win32'), /contains % or "/);
  assert.throws(() => shellArg('a"b', 'win32'), /contains % or "/);
});

test('shouldKeep: --keep always, otherwise only failed runs in CI', () => {
  assert.equal(shouldKeep({ keepFlag: true, failed: false, env: {} }), true);
  assert.equal(shouldKeep({ keepFlag: false, failed: true, env: { CI: 'true' } }), true);
  assert.equal(shouldKeep({ keepFlag: false, failed: true, env: {} }), false);
  assert.equal(shouldKeep({ keepFlag: false, failed: false, env: { CI: 'true' } }), false);
});

function png(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('pngSize reads IHDR dimensions and rejects non-PNGs', () => {
  assert.deepEqual(pngSize(png(1080, 1920)), { width: 1080, height: 1920 });
  assert.equal(pngSize(Buffer.from('<svg/>')), null);
});

test('checkOutputDir passes a complete output and reports each missing piece', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'gw-pack-smoke-test-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.ok(checkOutputDir(out, 8).length >= 5, 'empty dir fails every check');

  mkdirSync(join(out, 'cards'));
  mkdirSync(join(out, 'png'));
  writeFileSync(join(out, 'wrapped.html'), '<!doctype html>');
  for (let i = 1; i <= CARD_COUNT; i++) {
    writeFileSync(join(out, 'cards', `${i}.svg`), '<svg/>');
    writeFileSync(join(out, 'png', `${i}.png`), png(1080, 1920));
  }
  writeFileSync(join(out, 'share.png'), png(1200, 630));
  writeFileSync(join(out, 'stats.json'), JSON.stringify({ stats: { totals: { commits: 8 } } }));
  assert.deepEqual(checkOutputDir(out, 8), []);

  assert.deepEqual(checkOutputDir(out, 9), ['stats.json totals.commits is 8, expected 9']);
  writeFileSync(join(out, 'png', '1.png'), png(10, 10));
  rmSync(join(out, 'cards', '1.svg'));
  assert.deepEqual(checkOutputDir(out, 8), ['expected 11 SVG cards, got 10', 'png/1.png is not a 1080x1920 PNG']);
});

test('package.json wires the pack-smoke script and CI runs it on every OS', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['pack-smoke'], 'node scripts/pack-smoke.js');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('\n  pack-smoke:'), 'ci.yml has a pack-smoke job');
  const job = ci.slice(ci.indexOf('\n  pack-smoke:'));
  assert.match(job, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(job, /timeout-minutes: 15/);
  assert.match(job, /run: npm run pack-smoke\n\s+env:\n\s+PACK_SMOKE_DIR: \$\{\{ runner\.temp \}\}\/pack-smoke/);
  assert.match(job, /if: failure\(\)\n\s+uses: actions\/upload-artifact@v4/);
  assert.match(job, /path: \$\{\{ runner\.temp \}\}\/pack-smoke/);
});

test('CARD_COUNT matches the CLI card list (the smoke check must follow added/removed cards)', async () => {
  // The fixture repo has two authors and all its commits in one month (no monthly timeline).
  const { cardIdsFor } = await import('../src/cards/index.js');
  assert.equal(CARD_COUNT, cardIdsFor({ contributors: { total: 2 } }).length);
});

test('the real `npm pack` file list passes checkTarballFiles (offline dry run)', () => {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(r.status, 0, r.stderr);
  const { files } = parsePackJson(r.stdout);
  assert.deepEqual(checkTarballFiles(files), []);
});

test('checkOutputDir: wrong share.png size, unreadable stats.json, non-PNG png file', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'gw-pack-smoke-test-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(join(out, 'cards'));
  mkdirSync(join(out, 'png'));
  writeFileSync(join(out, 'wrapped.html'), '<!doctype html>');
  for (let i = 1; i <= CARD_COUNT; i++) {
    writeFileSync(join(out, 'cards', `${i}.svg`), '<svg/>');
    writeFileSync(join(out, 'png', `${i}.png`), png(1080, 1920));
  }
  writeFileSync(join(out, 'cards', 'notes.txt'), 'not a card'); // non-.svg files are not counted
  writeFileSync(join(out, 'share.png'), png(1080, 1920));
  writeFileSync(join(out, 'stats.json'), '{not json');
  const problems = checkOutputDir(out, 8);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.equal(problems[0], 'share.png missing or not 1200x630');
  assert.match(problems[1], /^stats\.json unreadable: /);

  writeFileSync(join(out, 'share.png'), png(1200, 630));
  writeFileSync(join(out, 'stats.json'), JSON.stringify({ stats: { totals: { commits: 8 } } }));
  writeFileSync(join(out, 'png', '2.png'), '<svg/>');
  assert.deepEqual(checkOutputDir(out, 8), ['png/2.png is not a 1080x1920 PNG']);
});

test('pngSize rejects truncated PNGs', () => {
  assert.equal(pngSize(png(1080, 1920).subarray(0, 20)), null);
});
