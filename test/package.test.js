import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('package.json is an ES module package', () => {
  assert.equal(pkg.type, 'module');
});

test('package name is gitwrapped with a semver version', () => {
  assert.equal(pkg.name, 'gitwrapped');
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/);
});

test('bin.gitwrapped points at an existing file', () => {
  assert.equal(typeof pkg.bin, 'object');
  assert.equal(typeof pkg.bin.gitwrapped, 'string');
  const target = new URL(pkg.bin.gitwrapped, root);
  assert.ok(existsSync(target), `${pkg.bin.gitwrapped} does not exist`);
  assert.ok(statSync(target).isFile());
});

test('engines.node requires >=20', () => {
  assert.equal(typeof pkg.engines?.node, 'string');
  const m = /^>=\s*(\d+)/.exec(pkg.engines.node);
  assert.ok(m, `unexpected engines.node: ${pkg.engines.node}`);
  assert.ok(Number(m[1]) >= 20);
});

test('license is MIT', () => {
  assert.equal(pkg.license, 'MIT');
});

test('has a test script', () => {
  assert.equal(typeof pkg.scripts?.test, 'string');
  assert.match(pkg.scripts.test, /node --test/);
});

test('has no runtime dependencies', () => {
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});

test('published files include bin and src', () => {
  if (pkg.files) {
    assert.ok(pkg.files.includes('bin'));
    assert.ok(pkg.files.includes('src'));
  }
});

test('LICENSE exists and is MIT', () => {
  const p = new URL('LICENSE', root);
  assert.ok(existsSync(p));
  assert.match(readFileSync(p, 'utf8'), /MIT License/);
});

test('.gitignore exists and ignores node_modules', () => {
  const p = new URL('.gitignore', root);
  assert.ok(existsSync(p));
  assert.match(readFileSync(p, 'utf8'), /^node_modules\/?$/m);
});
