import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HELP_TEXT } from '../src/cli.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function npmPackFiles() {
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
      timeout: 60_000,
    });
    return JSON.parse(out)[0].files.map((f) => f.path.replace(/\\/g, '/'));
  } catch (err) {
    if (err.code === 'ENOENT') return null; // npm not installed: skip
    throw err;
  }
}

test('package.json has the fields npm publish needs', () => {
  assert.equal(pkg.name, 'gitwrapped');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.description && pkg.description.length > 10);
  assert.ok(pkg.author);
  assert.deepEqual(pkg.repository, { type: 'git', url: 'git+https://github.com/furkycl/gitwrapped.git' });
  assert.equal(pkg.bugs?.url, 'https://github.com/furkycl/gitwrapped/issues');
  assert.equal(pkg.homepage, 'https://github.com/furkycl/gitwrapped#readme');
  assert.deepEqual(pkg.publishConfig, { access: 'public' });
  assert.equal(pkg.scripts?.prepublishOnly, 'npm test');
  for (const k of ['git', 'wrapped', 'cli', 'stats', 'year-in-review']) {
    assert.ok(pkg.keywords.includes(k), `keyword ${k}`);
  }
  // CLI-only package: no library entry point to keep in sync.
  assert.equal(pkg.main, undefined);
});

test('engines requires Node >= 20', () => {
  assert.equal(pkg.engines?.node, '>=20');
});

test('files whitelist ships only the runtime', () => {
  assert.deepEqual([...pkg.files].sort(), ['LICENSE', 'README.md', 'bin', 'src']);
});

test('bin target exists, has a node shebang and is executable', () => {
  assert.deepEqual(Object.keys(pkg.bin), ['gitwrapped']);
  const target = new URL(`../${pkg.bin.gitwrapped}`, import.meta.url);
  assert.ok(existsSync(target), `${pkg.bin.gitwrapped} exists`);
  assert.match(readFileSync(target, 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);
  if (process.platform !== 'win32') {
    assert.ok(statSync(target).mode & 0o111, 'bin file is executable');
  }
});

test('npm pack contains the runtime and nothing else', (t) => {
  const files = npmPackFiles();
  if (!files) {
    t.skip('npm is not available');
    return;
  }
  for (const f of ['bin/gitwrapped.js', 'src/cli.js', 'package.json', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(f), `pack includes ${f}`);
  }
  for (const f of files) {
    assert.doesNotMatch(f, /^(test|scripts|\.loop|\.github|docs|node_modules)\//, `pack must not include ${f}`);
    assert.ok(
      ['package.json', 'README.md', 'LICENSE'].includes(f) || /^(bin|src)\//.test(f),
      `unexpected file in pack: ${f}`,
    );
  }
});

test('README documents every CLI flag from --help', () => {
  const flags = new Set(HELP_TEXT.match(/(?<![\w-])--?[a-z][a-z-]*/g));
  assert.ok(flags.size >= 9, `found flags: ${[...flags].join(' ')}`);
  for (const flag of flags) {
    assert.ok(readme.includes(`\`${flag}`), `README mentions ${flag}`);
  }
});

test('README usage table lists no flag that --help does not know', () => {
  const tableFlags = readme
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .flatMap((l) => l.split('|')[1].match(/(?<![\w-])--?[a-z][a-z-]*/g) ?? []);
  assert.ok(tableFlags.length >= 9);
  for (const flag of tableFlags) {
    assert.ok(HELP_TEXT.includes(flag), `${flag} is a real option`);
  }
});
