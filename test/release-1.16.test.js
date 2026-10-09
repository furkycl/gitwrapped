// The 1.16.0 release pins: the CHANGELOG [1.16.0] section names the 1.16 work (top subject
// words, rewritten commits, biggest grower) with the user-visible fix of the pre-1.16.0
// audit (#108: hex runs of 7 or more digits, SHA-256 hashes too, are cut from the top
// words) folded into its entry, and the compare links move on. The audit's regression tests
// themselves live in audit-1.16.test.js and next to the features (top-words*.test.js,
// rewritten*.test.js, biggest-grower*.test.js).
// Written by the builder of loop turn 104.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('CHANGELOG [1.16.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.16.0] names top subject words, rewritten commits, biggest grower and the audit fix', () => {
    const m = /^## \[1\.16\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.16.0] section');
    const flat = m[1].replace(/\s+/g, ' ');
    assert.match(m[1], /^### Added$/m);
    assert.match(m[1], /Top subject words/);
    assert.match(m[1], /Rewritten commits/);
    assert.match(m[1], /Biggest grower/);
    assert.ok(flat.includes('`stats.messages.topWords [{word, count}]`'));
    assert.match(m[1], /stats\.rewritten/);
    assert.match(m[1], /stats\.biggestGrower/);
    // pre-1.16.0 audit (#108): hex hashes of any length from 7 digits are cut
    assert.ok(flat.includes('hex hashes (7 or more hex digits with at least one digit, so SHA-256 hashes too)'));
    assert.ok(!flat.includes('7 to 40'));
  });

  // Empty at release time; later unreleased entries may sit between the two headings.
  test('[Unreleased] is the first section, and [1.16.0] the first release after it', () => {
    assert.match(text, /^## \[Unreleased\]\n(?:(?!^## )[\s\S])*?^## \[1\.16\.0\] - \d{4}-\d{2}-\d{2}$/m);
    assert.equal(/^## \[([^\]]+)\]/m.exec(text)?.[1], 'Unreleased');
  });

  test('compare links', () => {
    assert.match(text, /^\[Unreleased\]: \S+\/compare\/v1\.16\.0\.\.\.HEAD$/m);
    assert.match(text, /^\[1\.16\.0\]: \S+\/compare\/v1\.15\.0\.\.\.v1\.16\.0$/m);
    assert.match(text, /^\[1\.15\.0\]: \S+\/compare\/v1\.14\.0\.\.\.v1\.15\.0$/m);
  });
});
