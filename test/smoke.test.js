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
    author: undefined,
    out: 'gitwrapped-out',
  });
});

test('run --version prints package version and exits 0', () => {
  const stdout = sink();
  const stderr = sink();
  assert.equal(run(['--version'], { stdout, stderr }), 0);
  assert.match(stdout.data, /^\d+\.\d+\.\d+\n$/);
});

test('run with an invalid flag exits 2 and writes to stderr', () => {
  const stdout = sink();
  const stderr = sink();
  assert.equal(run(['--nope'], { stdout, stderr }), 2);
  assert.match(stderr.data, /^gitwrapped: /);
  assert.equal(stdout.data, '');
});
