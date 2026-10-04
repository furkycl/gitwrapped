#!/usr/bin/env node
// Dev helper: renders the story cards for the fixture repo so they can be eyeballed.
//
//   node scripts/preview-cards.js [outDir]   # default ./cards-preview
//
// Builds the fixture repo, runs readCommits + computeStats + buildCards, writes one SVG
// per card (plus an empty-repo set under <outDir>/empty/), then deletes the fixture.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCards } from '../src/cards/index.js';
import { readCommits } from '../src/git.js';
import { computeStats } from '../src/stats/index.js';
import { makeFixtureRepo } from './make-fixture-repo.js';

const TODAY = '2024-03-14';

function writeCards(cards, dir) {
  mkdirSync(dir, { recursive: true });
  return cards.map(({ id, svg }, i) => {
    const file = join(dir, `${String(i + 1).padStart(2, '0')}-${id}.svg`);
    writeFileSync(file, svg);
    return file;
  });
}

const outDir = resolve(process.argv[2] ?? 'cards-preview');
const fixture = makeFixtureRepo();
try {
  const commits = await readCommits(fixture.dir);
  const stats = computeStats(commits, { today: TODAY });
  const files = [
    ...writeCards(buildCards(stats, { repoName: 'fixture' }), outDir),
    ...writeCards(buildCards(computeStats([], { today: TODAY }), { repoName: 'empty-repo' }), join(outDir, 'empty')),
  ];
  for (const file of files) process.stdout.write(`${file}\n`);
} finally {
  fixture.cleanup();
}
