import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HELP_TEXT } from '../src/cli.js';

const binPath = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function runBin(args) {
  return spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8' });
}

test('bin starts with a node shebang', () => {
  const firstLine = readFileSync(binPath, 'utf8').split('\n')[0];
  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('bin --help exits 0 and prints help', () => {
  const r = runBin(['--help']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, HELP_TEXT);
  assert.equal(r.stderr, '');
});

test('bin -h exits 0', () => {
  const r = runBin(['-h']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, HELP_TEXT);
});

test('bin --version exits 0 and prints package version', () => {
  const r = runBin(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${pkg.version}\n`);
});

test('bin -v exits 0', () => {
  const r = runBin(['-v']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('bin with unknown flag exits 2 with stderr message', () => {
  const r = runBin(['--bogus']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /gitwrapped: unknown option --bogus/);
  assert.match(r.stderr, /Run gitwrapped --help for usage/);
});

test('bin with invalid date exits 2', () => {
  const r = runBin(['--since', '2026-02-30']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid --since date/);
});

test('bin with valid args exits 0', () => {
  const r = runBin(['.', '--since', '2024-02-29']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});
