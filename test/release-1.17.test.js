// The 1.17.0 release pins: the CHANGELOG [1.17.0] section names the 1.17 work (biggest
// shrinker, bot commits, typo fixes) and keeps the pre-1.17.0 audit (#113) as Fixed entries,
// since each fixes code that already shipped in 1.16.0 (the email scrub, the issue
// references' URL cut, the dependency-bumps / rewritten-commits row placements); the
// version moves to 1.17.0 everywhere it is tracked; the compare links move on; and the
// stats.json shapes of the 1.17 fields (and of the 1.16 grower / rewritten fields, which
// release-1.16 left unpinned) are pinned. The audit's regression tests live in
// audit-1.17.test.js, the features' own tests in biggest-shrinker*.test.js,
// bot-commits*.test.js and typo-fixes*.test.js.
// Written by the builder of loop turn 109.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStats } from '../src/stats/index.js';
import { buildStatsJson } from '../src/json.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('CHANGELOG [1.17.0]', () => {
  const text = read('../CHANGELOG.md');
  const section = /^## \[1\.17\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text)?.[1];

  test('[1.17.0] names biggest shrinker, bot commits and typo fixes', () => {
    assert.ok(section, 'a [1.17.0] section');
    const flat = section.replace(/\s+/g, ' ');
    assert.match(section, /^### Added$/m);
    assert.match(section, /^- Biggest shrinker:/m);
    assert.match(section, /^- Bot commits:/m);
    assert.match(section, /^- Typo fixes:/m);
    assert.ok(flat.includes('`stats.biggestShrinker {path, net, added, removed}`'));
    assert.ok(flat.includes('`stats.bots {commits, share, top: {name, commits}}`'));
    assert.ok(flat.includes('`stats.messages.typos {commits, share}`'));
  });

  test('the pre-1.17.0 audit fixes stay under ### Fixed (they fix code from 1.16.0)', () => {
    const fixed = /^### Fixed$([\s\S]*)/m.exec(section)?.[1];
    assert.ok(fixed, 'a ### Fixed list in [1.17.0]');
    const flat = fixed.replace(/\s+/g, ' ');
    assert.match(flat, /Email scrubbing .* is now linear, with exactly the same results/);
    assert.match(flat, /Issue references: cutting URLs .* is now linear, with exactly the same results/);
    assert.match(flat, /each is now worked out once per build/);
  });

  // Empty at release time; later unreleased entries may sit between the two headings.
  test('[Unreleased] is the first section, and [1.17.0] the first release after it', () => {
    assert.match(text, /^## \[Unreleased\]\n(?:(?!^## )[\s\S])*?^## \[1\.17\.0\] - \d{4}-\d{2}-\d{2}$/m);
    assert.equal(/^## \[([^\]]+)\]/m.exec(text)?.[1], 'Unreleased');
    assert.match(text, /^## \[1\.17\.0\] - \d{4}-\d{2}-\d{2}\n(?:(?!^## )[\s\S])*?^## \[1\.16\.0\] - /m);
  });

  test('compare links', () => {
    assert.match(text, /^\[Unreleased\]: \S+\/compare\/v1\.17\.0\.\.\.HEAD$/m);
    assert.match(text, /^\[1\.17\.0\]: \S+\/compare\/v1\.16\.0\.\.\.v1\.17\.0$/m);
    assert.match(text, /^\[1\.16\.0\]: \S+\/compare\/v1\.15\.0\.\.\.v1\.16\.0$/m);
  });
});

describe('version 1.17.0', () => {
  test('package.json, package-lock.json and the README stats.json example agree', () => {
    const pkg = JSON.parse(read('../package.json'));
    const lock = JSON.parse(read('../package-lock.json'));
    assert.equal(pkg.version, '1.17.0');
    assert.equal(lock.version, '1.17.0');
    assert.equal(lock.packages[''].version, '1.17.0');
    assert.ok(read('../README.md').includes('"generator": { "name": "@furkycl/gitwrapped", "version": "1.17.0" }'));
  });
});

describe('README stats.json example has the 1.17 fields', () => {
  const md = read('../README.md');

  test('stats key list and example shapes', () => {
    assert.match(md, /`biggestGrower`, `biggestShrinker`,/);
    assert.match(md, /`rewritten`, `bots`,/);
    assert.match(md, /"biggestShrinker": \{ "path": "[^"]+", "net": \d+, "added": \d+, "removed": \d+ \}/);
    assert.match(md, /"bots": \{ "commits": \d+, "share": [\d.]+, "top": \{ "name": "[^"]+", "commits": \d+ \} \}/);
    assert.match(md, /`stats\.messages\.typos`/);
  });
});

describe('stats.json shapes of the 1.16 / 1.17 fields', () => {
  const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
  const commit = (i, files, extra = {}) => ({
    hash: H(i),
    date: `2026-03-${String(1 + i).padStart(2, '0')}T10:00:00+00:00`,
    committerDate: `2026-03-${String(1 + i).padStart(2, '0')}T10:00:00+00:00`,
    subject: `feat: change ${i}`,
    author: 'Ada',
    email: 'ada@example.com',
    files: files.map(([path, added, removed]) => ({ path, added, removed })),
    parents: ['p'],
    ...extra,
  });
  const commits = [
    commit(1, [['src/new.js', 120, 4]]),
    commit(2, [['src/old.js', 3, 90]], { subject: 'fix: typo in the parser' }),
    commit(3, [['src/new.js', 5, 1]], { committerDate: '2026-03-04T13:00:00+00:00' }),
    commit(4, [['package.json', 1, 1]], {
      author: 'dependabot[bot]',
      email: '49699333+dependabot[bot]@users.noreply.github.com',
      subject: 'chore: bump x',
    }),
  ];
  const doc = JSON.parse(
    buildStatsJson({ stats: computeStats(commits, { today: '2026-04-01' }), repoName: 'demo', version: '1.17.0', asOf: '2026-04-01' }),
  );

  test('stats.biggestShrinker {path, net, added, removed}', () => {
    assert.deepEqual(doc.stats.biggestShrinker, { path: 'src/old.js', net: 87, added: 3, removed: 90 });
  });

  test('stats.biggestGrower {path, net, added, removed}', () => {
    assert.deepEqual(doc.stats.biggestGrower, { path: 'src/new.js', net: 120, added: 125, removed: 5 });
  });

  test('stats.bots {commits, share, top: {name, commits}}', () => {
    // 1 of the 4 non-merge commits; share a 0..1 fraction (3 decimals), not a percent.
    assert.deepEqual(doc.stats.bots, { commits: 1, share: 0.25, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.ok(!JSON.stringify(doc.stats.bots).includes('@'), 'no bot email');
  });

  test('stats.messages.typos {commits, share}', () => {
    assert.deepEqual(doc.stats.messages.typos, { commits: 1, share: 0.25 });
  });

  test('stats.rewritten {commits, share}', () => {
    assert.deepEqual(doc.stats.rewritten, { commits: 1, share: 0.25 });
  });
});
