import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pngSize } from '../src/png.js';

// docs/self-wrapped is gitwrapped run on its own repo (`npm run self-wrapped`).
const root = fileURLToPath(new URL('..', import.meta.url));
const dir = new URL('../docs/self-wrapped/', import.meta.url);
const CARDS = [
  '01-intro',
  '02-totals',
  '03-peak-hour',
  '04-streak',
  '05-hot-files',
  '06-messages',
  '07-personality',
  '08-outro',
];

test('package.json has the self-wrapped script', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['self-wrapped'], 'node bin/gitwrapped.js . --out docs/self-wrapped --no-color');
});

test('self-wrapped wrapped.html inlines all 8 cards behind a CSP', () => {
  const html = readFileSync(new URL('wrapped.html', dir), 'utf8');
  assert.equal(html.match(/<svg[\s>]/g)?.length, 8);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
});

test('self-wrapped card SVGs exist and look well-formed', () => {
  for (const name of CARDS) {
    const svg = readFileSync(new URL(`cards/${name}.svg`, dir), 'utf8');
    assert.ok(svg.startsWith('<svg'), `${name}.svg starts with <svg`);
    assert.ok(svg.includes('viewBox="0 0 1080 1920"'), `${name}.svg is 1080x1920`);
    assert.ok(svg.trimEnd().endsWith('</svg>'), `${name}.svg is closed`);
  }
});

test('self-wrapped share.png is a 1200x630 PNG', () => {
  const buf = readFileSync(new URL('share.png', dir));
  assert.deepEqual(pngSize(buf), { width: 1200, height: 630 });
  assert.ok(existsSync(new URL('share.svg', dir)));
});

test('self-wrapped per-card PNGs are gitignored, not tracked', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('docs/self-wrapped/png/'));
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', 'docs/self-wrapped/png'], { cwd: root, encoding: 'utf8' });
  } catch {
    return; // not a git checkout (e.g. a tarball): nothing to check
  }
  assert.equal(tracked.trim(), '');
});
