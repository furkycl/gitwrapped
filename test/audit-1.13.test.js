// The 1.13.0 release pins: the CHANGELOG [1.13.0] section names the 1.13 work (middle-elided
// paths, issue references, fixup commits) and the fixes of the pre-1.13.0 audit (#93), and
// the compare links move on. The audit's regression tests themselves live next to the
// features (elided-paths*.test.js, issues-extra.test.js, fixups-extra.test.js).
// Written by the builder of loop turn 089.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('CHANGELOG [1.13.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.13.0] names middle-elided paths, issue references, fixup commits and the audit fixes', () => {
    const m = /^## \[1\.13\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.13.0] section');
    assert.match(m[1], /Middle-elided paths/);
    assert.match(m[1], /Issue references/);
    assert.match(m[1], /Fixup commits/);
    assert.match(m[1], /stats\.issueRefs/);
    assert.match(m[1], /stats\.messages\.fixups/);
    assert.match(m[1], /^### Fixed$/m);
    assert.match(m[1], /same shortened folder/);
    assert.match(m[1], /#12\/#13/);
    assert.match(m[1], /runs of spaces/);
  });

  // Empty at release time; later unreleased entries may sit between the two headings.
  test('[Unreleased] is the first section, and [1.13.0] the first release after it', () => {
    assert.match(text, /^## \[Unreleased\]\n(?:(?!^## )[\s\S])*?^## \[1\.13\.0\] - \d{4}-\d{2}-\d{2}$/m);
    assert.equal(/^## \[([^\]]+)\]/m.exec(text)?.[1], 'Unreleased');
  });

  test('compare links', () => {
    assert.match(text, /^\[Unreleased\]: \S+\/compare\/v1\.13\.0\.\.\.HEAD$/m);
    assert.match(text, /^\[1\.13\.0\]: \S+\/compare\/v1\.12\.0\.\.\.v1\.13\.0$/m);
    assert.match(text, /^\[1\.12\.0\]: \S+\/compare\/v1\.11\.0\.\.\.v1\.12\.0$/m);
  });
});
