import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, run } from '../src/cli.js';

function sink() {
  let data = '';
  return { write: (s) => { data += s; }, get data() { return data; } };
}

test('parseCli returns defaults with no arguments', () => {
  assert.deepEqual(parseCli([]), {
    path: '.',
    since: undefined,
    until: undefined,
    year: undefined,
    author: undefined,
    out: 'gitwrapped-out',
    png: true,
    maxCommits: 50000,
  });
});

test('run --version prints package version and exits 0', async () => {
  const stdout = sink();
  const stderr = sink();
  assert.equal(await run(['--version'], { stdout, stderr }), 0);
  assert.match(stdout.data, /^\d+\.\d+\.\d+\n$/);
});

test('run with an invalid flag exits 2 and writes to stderr', async () => {
  const stdout = sink();
  const stderr = sink();
  assert.equal(await run(['--nope'], { stdout, stderr }), 2);
  assert.match(stderr.data, /^gitwrapped: /);
  assert.equal(stdout.data, '');
});
