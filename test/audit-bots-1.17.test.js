// Follow-up to the 1.17 audit (#113), from a second cold audit: bot names. A bot author
// literally named "Unknown" became stats.bots.top although shownBots hides that name, so the
// recap, wrapped.md and the card showed no busiest bot while a named one existed; and a
// zero-width / format character in a bot's name was turned into a space, splitting it from
// the same bot without one ("dependabot [bot]"). Unit pins live in bot-commits*.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBots, shownBots } from '../src/stats/index.js';
import { isBotAuthor } from '../src/stats/bots.js';

describe('bots: "Unknown" and format characters in names', () => {
  const c = (author, email = 'x@example.com') => ({ author, email, subject: 'chore: x', parents: ['p'], files: [] });

  test('a bot named "Unknown" counts but never hides the busiest named bot', () => {
    const b = computeBots([c('Unknown', '1+ci[bot]@users.noreply.github.com'), c('Unknown', '1+ci[bot]@users.noreply.github.com'), c('Unknown', '1+ci[bot]@users.noreply.github.com'), c('dependabot[bot]'), c('Ada')]);
    assert.deepEqual({ ...b }, { commits: 4, share: 0.8, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.deepEqual(shownBots(b).top, { name: 'dependabot[bot]', commits: 1 });
  });

  test('only "Unknown" bots: counted, top null (as shownBots)', () => {
    const b = computeBots([c('Unknown', 'ci[bot]@x.io'), c('Ada')]);
    assert.deepEqual({ ...b }, { commits: 1, share: 0.5, top: null });
    assert.equal(shownBots(b).top, null);
  });

  test('zero-width / soft-hyphen / bidi characters in a bot name are dropped, not turned into spaces', () => {
    const b = computeBots([c('dependabot​[bot]'), c('Dependabot­[bot]'), c('‎dependabot[bot]'), c('renovate[bot]'), c('renovate[bot]')]);
    assert.deepEqual(b.top, { name: 'dependabot[bot]', commits: 3 });
    // A control character still separates words (as before).
    assert.deepEqual(computeBots([c('Renovate\tBot[bot]')]).top, { name: 'Renovate Bot[bot]', commits: 1 });
  });

  const E = '1+ci[bot]@users.noreply.github.com';
  const top = (authors) => computeBots(authors.map((a) => (Array.isArray(a) ? c(...a) : c(a, E)))).top;

  test('"Unknown" is dropped however it is padded, hidden or wrapped (only the exact shown name)', () => {
    for (const a of ['  Unknown  ', 'Unknown\t', '\nUnknown', 'Unk​nown', '​Unknown­', 'Unknown <u@x.io>', 'Unknown@x.io']) {
      const b = computeBots([c(a, E)]);
      assert.equal(b.commits, 1, JSON.stringify(a));
      assert.equal(b.top, null, JSON.stringify(a));
    }
  });

  test('"unknown" / "UNKNOWN" are real names (not the placeholder): top, and shownBots agrees', () => {
    for (const a of ['unknown', 'UNKNOWN']) {
      const b = computeBots([c(a, E)]);
      assert.deepEqual(b.top, { name: a, commits: 1 });
      assert.deepEqual(shownBots(b).top, { name: a, commits: 1 });
    }
    // "Unknown" spellings never join the case-insensitive group of another spelling.
    assert.deepEqual(top(['Unknown', 'Unknown', 'Unknown', 'unknown']), { name: 'unknown', commits: 1 });
  });

  test('a name made only of format / control characters is unnamed: counted, never top', () => {
    for (const a of ['​‍­', '﻿', '\u0000\t\n', '​\u0000‎', '']) {
      const b = computeBots([c(a, E), c('Ada')]);
      assert.deepEqual({ ...b }, { commits: 1, share: 0.5, top: null }, JSON.stringify(a));
      assert.equal(shownBots(b).top, null);
    }
  });

  test('format characters anywhere (leading BOM, trailing, inside) merge with the plain spelling', () => {
    assert.deepEqual(top([['﻿renovate[bot]'], ['renovate[bot]'], ['renovate[bot]​'], ['reno⁠vate[bot]']]), { name: 'renovate[bot]', commits: 4 });
  });

  test('an address used as a bot name is cut to its local part and merges with the plain name', () => {
    assert.deepEqual(top([['dependabot[bot]@users.noreply.github.com'], ['dependabot[bot]']]), { name: 'dependabot[bot]', commits: 2 });
  });

  test('ties between named bots ignore "Unknown" and go to code-unit order', () => {
    assert.deepEqual(top([['b[bot]'], ['a[bot]'], 'Unknown', 'Unknown']), { name: 'a[bot]', commits: 1 });
  });

  test('isBotAuthor ignores format characters the same way botName does', () => {
    for (const a of ['dependabot​[bot]', '​dependabot', 'x[bot]​', 'renovate­[bot]']) {
      assert.equal(isBotAuthor(a, 'x@example.com'), true, JSON.stringify(a));
      assert.notEqual(computeBots([c(a)]).top, null, JSON.stringify(a));
    }
  });

  test('shownBots hides "Unknown" in an older stats.json however it is padded', () => {
    for (const name of ['Unknown', ' Unknown ', 'Unknown​', '\tUnknown']) {
      assert.equal(shownBots({ commits: 3, share: 0.5, top: { name, commits: 2 } }).top, null, JSON.stringify(name));
    }
  });
});

describe('real git end-to-end via the CLI', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const BIN = join(ROOT, 'bin', 'gitwrapped.js');
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  let repo;
  let root;
  const commit = (k, subject, name, email) => {
    writeFileSync(join(repo, `f${k}.txt`), `${k}\n`);
    git(repo, ['add', '-A']);
    const d = `2026-03-${String(k + 1).padStart(2, '0')}T10:00:00+00:00`;
    git(repo, ['commit', '-q', '-m', subject], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
  };
  let outN = 0;
  const cli = (extra = []) => {
    const out = join(root, `out${++outN}`);
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const r = spawnSync(process.execPath, [BIN, repo, '--out', out, '--json', '--md', '--no-color', '--no-png', ...extra], { encoding: 'utf8', env, cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    return { stats: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats, md: readFileSync(join(out, 'wrapped.md'), 'utf8'), stdout: r.stdout };
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-audit117-'));
    repo = join(root, 'repo');
    git(root, ['init', '-q', '-b', 'main', repo]);
    commit(0, 'feat: start', 'Ada', 'ada@example.com');
    for (let k = 1; k <= 3; k++) commit(k, `ci: run ${k}`, 'Unknown', '41898282+github-actions[bot]@users.noreply.github.com');
    commit(4, 'chore: bump', 'dependabot​[bot]', '49699333+dependabot[bot]@users.noreply.github.com');
    commit(5, 'chore: bump again', 'dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('en: the busiest named bot is shown everywhere', () => {
    const r = cli();
    assert.deepEqual(r.stats.bots, { commits: 5, share: 0.833, top: { name: 'dependabot[bot]', commits: 2 } });
    assert.match(r.stdout, /Bot commits {2}5 commits \(83% of non-merge commits\) · top dependabot\[bot\] \(2 commits\)/);
    assert.match(r.md, /busiest: dependabot\\\[bot\\\] \\\(2 commits\\\)/);
    // ("Unknown" is still a contributor's name on the team card / table, just never the busiest bot.)
    assert.ok(!/Bot commits.*Unknown/.test(r.stdout) && !/busiest: Unknown/.test(r.md));
  });

  test('tr: the same busiest bot', () => {
    const r = cli(['--lang', 'tr']);
    assert.deepEqual(r.stats.bots.top, { name: 'dependabot[bot]', commits: 2 });
    assert.match(r.stdout, /Bot commit'leri {2}5 commit .* en çok dependabot\[bot\] \(2 commit\)/);
  });
});
