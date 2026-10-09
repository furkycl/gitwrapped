// The 1.15.0 release pins: the CHANGELOG [1.15.0] section names the 1.15 work (coding
// sessions, message bodies, one-touch files) with the fixes of the pre-1.15.0 audit (#103)
// folded into those entries, and the compare links move on. The audit's regression tests
// themselves live in audit-1.15.test.js and next to the features (sessions*.test.js,
// message-bodies*.test.js, one-touch*.test.js).
// Written by the builder of loop turn 099.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('CHANGELOG [1.15.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.15.0] names coding sessions, message bodies, one-touch files and the audit fixes', () => {
    const m = /^## \[1\.15\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.15.0] section');
    const flat = m[1].replace(/\s+/g, ' ');
    assert.match(m[1], /^### Added$/m);
    assert.match(m[1], /Coding sessions/);
    assert.match(m[1], /Message bodies/);
    assert.match(m[1], /One-touch files/);
    assert.match(m[1], /stats\.sessions/);
    assert.match(m[1], /stats\.messages\.bodies/);
    assert.match(m[1], /stats\.oneTouch/);
    // pre-1.15.0 audit (#103): the --reference revert form, the Turkish rows as drawn
    assert.match(m[1], /the merge and `--reference` forms too/);
    assert.ok(flat.includes(`"Tek commit'lik 42 dosya · %31"`));
    assert.ok(flat.includes('"42 oturum en uzun 3 sa 10 dk"'));
  });

  test('compare links', () => {
    assert.match(text, /^\[1\.15\.0\]: \S+\/compare\/v1\.14\.0\.\.\.v1\.15\.0$/m);
    assert.match(text, /^\[1\.14\.0\]: \S+\/compare\/v1\.13\.0\.\.\.v1\.14\.0$/m);
  });
});
