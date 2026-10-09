// The pre-1.16.0 audit: (1) top subject words cut hex hashes of 7 to 40 digits only, so a
// SHA-256 commit hash (64 hex digits) or any longer hex run in a subject was split into its
// letter runs and those counted as words ("abcdef", "deadbeef" ...), even reaching the top
// three; hex runs of any length from 7 digits (with a digit) are now cut; (2) the totals,
// per-repo and languages stats iterated `c.files ?? []`, so a commit whose `files` is a
// non-array object or number threw, while fileTouches (hot files, one-touch, the biggest
// grower) already skipped it; every files loop now guards with Array.isArray. The unit-level
// pins for the features live in top-words*.test.js, rewritten*.test.js and
// biggest-grower*.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLanguages, computeMessages, computeRepos, computeStats, computeTotals, subjectWords } from '../src/stats/index.js';

const SHA256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const commit = (i, subject, extra = {}) => ({
  hash: `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00+00:00`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [],
  filesChanged: 0,
  linesAdded: 0,
  linesRemoved: 0,
  parents: ['p'],
  ...extra,
});

describe('top subject words: hex runs longer than 40 digits are cut too', () => {
  test('a SHA-256 hash leaves no word behind', () => {
    assert.deepEqual([...subjectWords(`Revert to ${SHA256} parser`)], ['revert', 'parser']);
  });

  test('a 41-digit and a 100-digit hex run are cut, not split into letter runs; words and short runs stay', () => {
    const h41 = 'deadbeefcafe0123456789abcdef0123456789abc'; // 41 hex digits
    assert.equal(h41.length, 41);
    assert.deepEqual([...subjectWords(`fix cache ${h41}`)], ['fix', 'cache']);
    assert.deepEqual([...subjectWords(`bump ${'abc1'.repeat(25)} lock`)], ['bump', 'lock']);
    // Words without a digit and short runs are unchanged.
    assert.deepEqual([...subjectWords('decade facade deadbeef')], ['decade', 'facade', 'deadbeef']);
    assert.deepEqual([...subjectWords('abc123 parser')], ['abc', 'parser']);
  });

  test('a SHA-256 hash in many subjects never reaches stats.messages.topWords', () => {
    const commits = [0, 1, 2].map((i) => commit(i, `${i < 2 ? 'cache' : 'parser'}: pin ${SHA256}`));
    assert.deepEqual(computeMessages(commits).topWords, [{ word: 'pin', count: 3 }]);
  });
});

describe('a commit whose files is not an array never throws', () => {
  for (const files of [5, { path: 'a.js' }, true]) {
    test(`files = ${JSON.stringify(files)}`, () => {
      const commits = [commit(0, 'feat: odd', { files, repo: 'r1' }), commit(1, 'feat: ok', { files: [{ path: 'r2/a.js', added: 3, removed: 0 }], repo: 'r2' })];
      assert.equal(computeTotals(commits).filesTouched, 1);
      assert.equal(computeLanguages(commits).totalLines, 3);
      const repos = computeRepos(commits, ['r1', 'r2']);
      assert.equal(repos.find((r) => r.name === 'r1').filesTouched, 0);
      assert.equal(repos.find((r) => r.name === 'r2').filesTouched, 1);
      const stats = computeStats(commits, { today: '2026-04-01' });
      assert.equal(stats.totals.commits, 2);
      assert.equal(stats.biggestGrower.path, 'r2/a.js');
    });
  }
});

describe('top subject words: hex-run boundaries', () => {
  const W = (s) => [...subjectWords(s)];

  test('6 hex digits with a digit stay (letters kept), 7 are cut', () => {
    assert.deepEqual(W('abcde1 parser'), ['abcde', 'parser']); // 6: not a hash
    assert.deepEqual(W('abcdef1 parser'), ['parser']); // 7: a short hash
    assert.deepEqual(W('abcd123 parser'), ['parser']);
  });

  test('hex-letter words without a digit always count, at any length', () => {
    assert.deepEqual(W('deadbeef cafebabe facade decade'), ['deadbeef', 'cafebabe', 'facade', 'decade']);
    const long = 'abcdef'.repeat(10); // 60 hex letters, no digit
    assert.deepEqual(W(`${long} parser`), [long, 'parser']);
  });

  test('40, 41, 64 and 100 digit runs with a digit leave nothing behind', () => {
    for (const n of [40, 41, 64, 100, 1000]) {
      const run = ('facade1' + 'bead2cafe3').repeat(200).slice(0, n);
      assert.equal(run.length, n);
      assert.ok(/\d/.test(run));
      assert.deepEqual(W(`fix ${run} parser`), ['fix', 'parser'], `n=${n}`);
      assert.deepEqual(W(`fix ${run.toUpperCase()} parser`), ['fix', 'parser'], `upper n=${n}`);
    }
  });

  test('a SHA-256 hash next to punctuation is cut', () => {
    for (const wrapped of [`(${SHA256})`, `[${SHA256}]`, `${SHA256},`, `${SHA256}.`, `"${SHA256}"`, `'${SHA256}'`, `${SHA256}:`, `<${SHA256}>`, `@${SHA256}`, `/${SHA256}/`]) {
      assert.deepEqual(W(`see ${wrapped} parser`), ['see', 'parser'], wrapped);
    }
    assert.deepEqual(W(SHA256), []);
  });

  test('a hex run glued to a letter or digit-word is a token, not a hash (unchanged rule)', () => {
    // "g" is not hex: the 65-char token is no hash, so its letter runs count.
    assert.ok(W(`${SHA256}g`).length > 0);
  });

  test('a SHA-256 hash in a Revert wrapper or behind a conventional prefix is cut', () => {
    assert.deepEqual(W(`Revert "fix(cache): drop ${SHA256}"`), ['drop']);
    assert.deepEqual(W(`fixup! chore: bump ${SHA256}`), ['bump']);
  });

  test('linear time: a 200k-char hex / near-hex subject is read in well under 1 s', () => {
    const cases = [
      'abc1'.repeat(50_000), // one huge hash
      `${'abc1'.repeat(50_000)}g parser`, // near-hex: fails at the very end
      'abcdef'.repeat(33_334), // no digit at all
      `${'f'.repeat(199_999)}1`, // the only digit is last
      'abcdef1 '.repeat(25_000), // many short hashes
      `${'a1'.repeat(100_000)}_`, // ends on a word char
    ];
    for (const s of cases) {
      const t = performance.now();
      subjectWords(s);
      const ms = performance.now() - t;
      assert.ok(ms < 1000, `${s.slice(0, 12)}… took ${ms.toFixed(0)} ms`);
    }
  });
});

describe('top subject words: SHA-256 hashes through computeStats', () => {
  // A 64-digit hash whose letter runs are word-shaped: before the fix "facade", "bead",
  // "cafe" were counted once per commit and took the top three.
  const H64 = ('facade1' + 'bead2cafe3').repeat(4).slice(0, 64);

  test('multi-repo commits: no hex letter run reaches topWords', () => {
    const commits = [0, 1, 2, 3].map((i) => commit(i, `${['parser', 'login', 'cache', 'parser'][i]} ${H64}`, { repo: i % 2 ? 'web' : 'api' }));
    const top = computeStats(commits, { today: '2026-04-01' }).messages.topWords;
    assert.deepEqual(top, [{ word: 'parser', count: 2 }, { word: 'cache', count: 1 }, { word: 'login', count: 1 }]);
  });
});

describe('top subject words: real git end-to-end via the CLI', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const BIN = join(ROOT, 'bin', 'gitwrapped.js');
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const H64 = ('facade1' + 'bead2cafe3').repeat(4).slice(0, 64);
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
  let root;
  const repos = [];
  const mkRepo = (name, subjects) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    subjects.forEach((subject, k) => {
      writeFileSync(join(repo, `f${k}.txt`), `${k}\n`);
      git(repo, ['add', '-A']);
      const d = `2026-03-${String(k + 1).padStart(2, '0')}T10:00:00+00:00`;
      git(repo, ['commit', '-q', '-m', subject], { ...ADA, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
    });
    repos.push(repo);
  };
  let outN = 0;
  const cli = (paths, extra = []) => {
    const out = join(root, `out${++outN}`);
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const r = spawnSync(process.execPath, [BIN, ...paths, '--out', out, '--json', '--md', '--no-color', '--no-png', ...extra], { encoding: 'utf8', env, cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    return { topWords: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.topWords, md: readFileSync(join(out, 'wrapped.md'), 'utf8'), stdout: r.stdout };
  };
  const HEX_RUNS = ['facade', 'bead', 'cafe', 'abcdef', 'feaa'];
  const assertNoHex = ({ topWords, md, stdout }) => {
    for (const { word } of topWords) {
      assert.ok(!/^[a-f]+$/.test(word) || !H64.includes(word), `hex fragment "${word}" in topWords`);
      assert.ok(!HEX_RUNS.includes(word), word);
    }
    for (const w of HEX_RUNS) {
      assert.ok(!stdout.includes(`"${w}"`), `recap shows "${w}"`);
      assert.ok(!md.includes(`${w} \\(`), `wrapped.md shows "${w}"`);
    }
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-audit116-'));
    mkRepo('api', [`Revert to ${H64}`, `parser: pin ${H64}`, `cache ${H64} parser`, `chore: bump (${SHA256})`]);
    mkRepo('web', [`login ${H64}`, `parser tweak ${SHA256}.`]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('one repo: topWords has no hex fragment', () => {
    const r = cli([repos[0]]);
    assertNoHex(r);
    assert.deepEqual(r.topWords.map((w) => w.word), ['bump', 'cache', 'parser']);
  });

  test('two repos, --lang tr: topWords has no hex fragment', () => {
    const r = cli(repos, ['--lang', 'tr']);
    assertNoHex(r);
    assert.deepEqual(r.topWords, [{ word: 'parser', count: 2 }, { word: 'bump', count: 1 }, { word: 'cache', count: 1 }]);
  });
});
