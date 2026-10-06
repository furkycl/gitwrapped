import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog, readCommits } from '../src/git.js';
import { makeFixtureRepo, AUTHORS } from '../scripts/make-fixture-repo.js';

const US = '\x1f';
const header = (hash, subject = 's') => [hash, 'A', 'a@x', '2025-01-01T00:00:00Z', '', subject].join(US);

// %aI prints UTC as +00:00 on older git but as Z on git 2.55 (CI): compare instants.
const instant = (c) => ({ ...c, date: Date.parse(c.date) });

describe('parseLog with --numstat (-z byte layout)', () => {
  test('commit with files: "\\n" before the first entry, one NUL-terminated entry per file', () => {
    const out = `${header('h1')}\0\n3\t1\ta.txt\0` + `0\t2\tdir/b.js\0`;
    const [c] = parseLog(out);
    assert.deepEqual(c.files, [
      { path: 'a.txt', added: 3, removed: 1, binary: false },
      { path: 'dir/b.js', added: 0, removed: 2, binary: false },
    ]);
    assert.equal(c.filesChanged, 2);
    assert.equal(c.linesAdded, 3);
    assert.equal(c.linesRemoved, 3);
  });

  test('commits without files (empty, merge) are followed directly by the next header', () => {
    const out = `${header('h3', 'merge')}\0${header('h2', 'empty')}\0${header('h1', 'one')}\0\n1\t0\ta\0`;
    const commits = parseLog(out);
    assert.deepEqual(commits.map((c) => [c.hash, c.filesChanged]), [['h3', 0], ['h2', 0], ['h1', 1]]);
    assert.deepEqual(commits[0].files, []);
    assert.equal(commits[0].linesAdded, 0);
  });

  test('binary files ("-\\t-") count as 0 lines and are flagged', () => {
    const [c] = parseLog(`${header('h')}\0\n-\t-\tlogo.png\0` + `2\t0\tx\0`);
    assert.deepEqual(c.files[0], { path: 'logo.png', added: 0, removed: 0, binary: true });
    assert.equal(c.linesAdded, 2);
    assert.equal(c.filesChanged, 2);
  });

  test('raw paths with spaces, tabs, newlines, unicode and \\x1f are kept verbatim', () => {
    const paths = ['sp ace.txt', 'ta\tb', 'new\nline', 'trailing\n', 'ünï 李.txt', `a${US}b${US}c${US}d${US}e`];
    const out = `${header('h')}\0\n` + paths.map((p) => `1\t0\t${p}\0`).join('');
    const [c] = parseLog(out);
    assert.deepEqual(c.files.map((x) => x.path), paths);
  });

  test('rename form "a\\tr\\t\\0old\\0new\\0" uses the new path', () => {
    const out = `${header('h2')}\0\n0\t0\t\0old name.txt\0new name.txt\0` + `${header('h1')}\0`;
    const commits = parseLog(out);
    assert.equal(commits.length, 2);
    assert.deepEqual(commits[0].files, [{ path: 'new name.txt', added: 0, removed: 0, binary: false }]);
  });

  test('numstat-looking tokens before any header are ignored', () => {
    assert.deepEqual(parseLog('1\t2\tx\0'), []);
  });

  test('output without numstat still parses, with empty stats', () => {
    const [c] = parseLog(`${header('h')}\0`);
    assert.deepEqual([c.files, c.filesChanged, c.linesAdded, c.linesRemoved], [[], 0, 0, 0]);
  });
});

describe('readCommits file stats on the fixture repo', () => {
  let fx;
  let commits;

  before(async () => {
    fx = makeFixtureRepo();
    commits = await readCommits(fx.dir);
  });

  after(() => fx?.cleanup());

  test('matches the fixture description exactly (dates compared as instants)', () => {
    assert.equal(commits.length, 8);
    // The fixture description has no parent hashes: check those separately.
    for (const c of commits) assert.ok(Array.isArray(c.parents) && c.parents.length <= 1);
    // Nor co-authors: the fixture commits have no Co-authored-by trailers.
    for (const c of commits) assert.deepEqual(c.coAuthors, []);
    const noParents = ({ parents, coAuthors, ...c }) => c;
    assert.deepEqual(commits.map(noParents).map(instant), fx.commits.map(instant));
  });

  test('per-commit files and line counts', () => {
    const bySubject = Object.fromEntries(commits.map((c) => [c.subject, c]));
    assert.deepEqual(bySubject['feat: initial commit'].files.map((x) => [x.path, x.added, x.removed]), [
      ['README.md', 3, 0],
      ['package-lock.json', 4, 0],
      ['src/app.js', 5, 0],
    ]);
    assert.deepEqual(bySubject['chore: bump lockfile'].files, [
      { path: 'package-lock.json', added: 1, removed: 1, binary: false },
    ]);
    assert.deepEqual(bySubject['oops'].files, [{ path: 'README.md', added: 0, removed: 3, binary: false }]);
    assert.ok(bySubject['wip'].files.some((x) => x.path === 'notes/my notes.txt' && x.added === 2));
  });

  test('binary file is flagged and counts 0 lines', () => {
    const logo = commits.flatMap((c) => c.files).filter((x) => x.path === 'logo.png');
    assert.equal(logo.length, 2);
    for (const x of logo) assert.deepEqual(x, { path: 'logo.png', added: 0, removed: 0, binary: true });
  });

  test('empty commit has no files', () => {
    const c = commits.find((x) => x.subject === 'chore: empty commit');
    assert.deepEqual([c.files, c.filesChanged, c.linesAdded, c.linesRemoved], [[], 0, 0, 0]);
  });

  test('a rename is reported as delete + add (--no-renames)', () => {
    const c = commits[0];
    assert.equal(c.subject, 'refactor: move app to main');
    assert.deepEqual(c.files.map((x) => [x.path, x.added, x.removed]), [['src/app.js', 0, 7], ['src/main.js', 7, 0]]);
  });

  test('totals add up across the history', () => {
    const sum = (k) => commits.reduce((n, c) => n + c[k], 0);
    assert.equal(sum('filesChanged'), 12);
    assert.equal(sum('linesAdded'), 25);
    assert.equal(sum('linesRemoved'), 12);
    for (const c of commits) {
      assert.equal(c.filesChanged, c.files.length);
      assert.equal(c.linesAdded, c.files.reduce((n, x) => n + x.added, 0));
      assert.equal(c.linesRemoved, c.files.reduce((n, x) => n + x.removed, 0));
    }
  });

  test('hashes match git rev-list', () => {
    const revs = execFileSync('git', ['-C', fx.dir, 'rev-list', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(commits.map((c) => c.hash), revs);
  });

  test('filters keep their stats', async () => {
    const bob = await readCommits(fx.dir, { author: AUTHORS.bob.email });
    assert.equal(bob.length, 4);
    assert.deepEqual(bob, commits.filter((c) => c.email === AUTHORS.bob.email));
    const recent = await readCommits(fx.dir, { since: '2024-03-12T00:00:00Z' });
    assert.deepEqual(recent, commits.slice(0, 2));
  });

  test('diff.renames / diff.relative config does not change the result', async () => {
    const run = (args) => execFileSync('git', ['-C', fx.dir, ...args], { encoding: 'utf8' });
    run(['config', 'diff.renames', 'copies']);
    run(['config', 'diff.relative', 'true']);
    try {
      assert.deepEqual(await readCommits(join(fx.dir, 'src')), commits);
    } finally {
      run(['config', '--unset', 'diff.renames']);
      run(['config', '--unset', 'diff.relative']);
    }
  });
});

describe('makeFixtureRepo', () => {
  test('is deterministic: same hashes on every build', () => {
    const a = makeFixtureRepo();
    const b = makeFixtureRepo();
    try {
      assert.notEqual(a.dir, b.dir);
      assert.deepEqual(a.commits, b.commits);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  test('history shape: 2 authors, late-night and weekend commits, fix/wip/oops subjects', () => {
    const fx = makeFixtureRepo();
    try {
      assert.equal(new Set(fx.commits.map((c) => c.email)).size, 2);
      const subjects = fx.commits.map((c) => c.subject);
      for (const s of ['wip', 'oops']) assert.ok(subjects.includes(s));
      assert.ok(subjects.some((s) => s.startsWith('fix: ')));
      // Local wall-clock time is what the date string says before its offset.
      const local = fx.commits.map((c) => ({ hour: Number(c.date.slice(11, 13)), day: new Date(c.date.slice(0, 10)).getUTCDay() }));
      assert.ok(local.some((x) => x.hour >= 22 || x.hour < 5), 'late-night commit');
      assert.ok(local.some((x) => x.day === 0 || x.day === 6), 'weekend commit');
    } finally {
      fx.cleanup();
    }
  });

  test('CLI prints the repo path; cleanup removes it', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitwrapped-fixture-cli '));
    const target = join(root, 'my repo');
    try {
      const script = fileURLToPath(new URL('../scripts/make-fixture-repo.js', import.meta.url));
      const out = execFileSync(process.execPath, [script, target], { encoding: 'utf8' });
      assert.equal(out, `${target}\n`);
      assert.equal(execFileSync('git', ['-C', target, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '8');
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
    const fx = makeFixtureRepo();
    fx.cleanup();
    assert.equal(existsSync(fx.dir), false);
  });
});
