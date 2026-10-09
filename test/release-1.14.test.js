// The 1.14.0 release pins: the CHANGELOG [1.14.0] section names the 1.14 work (docs share,
// dependency bumps, subject length) with the fixes of the pre-1.14.0 audit (#98) folded into
// those entries, and the compare links move on. The audit's regression tests themselves live
// in audit-1.14.test.js and next to the features (dep-bumps*.test.js, subject-length*.test.js).
// Written by the builder of loop turn 094.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('CHANGELOG [1.14.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.14.0] names docs share, dependency bumps, subject length and the audit fixes', () => {
    const m = /^## \[1\.14\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.14.0] section');
    assert.match(m[1], /^### Added$/m);
    assert.match(m[1], /Docs share/);
    assert.match(m[1], /Dependency bumps/);
    assert.match(m[1], /Subject length/);
    assert.match(m[1], /stats\.docShare/);
    assert.match(m[1], /stats\.depBumps/);
    assert.match(m[1], /stats\.messages\.subjectLength/);
    // pre-1.14.0 audit (#98): the long form that fits, the extra manifests, the row placement
    assert.match(m[1], /48 · 12% over 72/);
    assert.match(m[1], /48 · 72 üstü %12/);
    assert.match(m[1], /`composer\.json`/);
    assert.match(m[1], /`vendor\/modules\.txt`/);
    assert.match(m[1], /before the subject length row/);
  });

  test('compare links', () => {
    assert.match(text, /^\[1\.14\.0\]: \S+\/compare\/v1\.13\.0\.\.\.v1\.14\.0$/m);
    assert.match(text, /^\[1\.13\.0\]: \S+\/compare\/v1\.12\.0\.\.\.v1\.13\.0$/m);
  });
});
