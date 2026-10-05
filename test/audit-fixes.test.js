// Regression tests for the loop-013 system audit fixes.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommits, readHistory } from '../src/git.js';
import { computeStats, computeMessages, isMergeCommit } from '../src/stats/index.js';
import { formatSummary, stripControl } from '../src/summary.js';
import { buildCards, measureText, wrapText } from '../src/cards/index.js';
import { buildViewerHtml } from '../src/viewer.js';
import { parseCli, run } from '../src/cli.js';

const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const STRIPPED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR'];
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
const tmpDirs = [];

function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

function git(cwd, args, env = {}) {
  const e = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@x.io',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@x.io',
    GIT_AUTHOR_DATE: '2024-01-01T12:00:00Z',
    GIT_COMMITTER_DATE: '2024-01-01T12:00:00Z',
    ...env,
  };
  for (const k of STRIPPED) delete e[k];
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: e, stdio: ['pipe', 'pipe', 'pipe'] });
}

function newRepo(prefix) {
  const dir = tmp(prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

let seq = 0;
/** Commit a change to `file` with the given author / committer dates (and author env). */
function commitAt(dir, subject, { author, committer = author, file = 'f.txt', env = {} } = {}) {
  seq += 1;
  writeFileSync(join(dir, file), `${subject} ${seq}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', subject], { GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer, ...env });
}

function sink() {
  let data = '';
  return { write(s) { data += s; return true; }, get data() { return data; } };
}

async function runCaptured(argv) {
  const stdout = sink();
  const stderr = sink();
  const code = await run(argv, { stdout, stderr, env: {}, today: '2024-12-31' });
  return { code, stdout: stdout.data, stderr: stderr.data };
}

// 1. --since: an older commit in the middle of history must not hide newer ones behind it.
describe('--since keeps every commit authored on/after the date', () => {
  let dir;
  before(() => {
    dir = newRepo('gw-since-');
    commitAt(dir, 'april', { author: '2024-04-01T12:00:00Z' });
    // An old commit (old author AND committer date) sits between two newer ones: plain
    // `git log --since` stops walking here and would drop "april".
    commitAt(dir, 'ancient', { author: '2023-01-01T12:00:00Z' });
    commitAt(dir, 'june', { author: '2024-06-01T12:00:00Z' });
  });

  test('commits behind an older commit are still found', async () => {
    const { commits, truncated } = await readHistory(dir, { since: '2024-03-01' });
    assert.deepEqual(commits.map((c) => c.subject), ['june', 'april']);
    assert.equal(truncated, false);
  });

  test('--max-commits still caps when --since is set', async () => {
    const { commits, truncated, limit } = await readHistory(dir, { since: '2024-03-01', limit: 1 });
    assert.deepEqual(commits.map((c) => c.subject), ['june']);
    assert.equal(truncated, true);
    assert.equal(limit, 1);
  });

  test('a rebased commit (old author date, new committer date) does not use up a capped slot', async () => {
    const d = newRepo('gw-since-rebased-');
    commitAt(d, 'keep', { author: '2024-04-01T12:00:00Z' });
    commitAt(d, 'rebased', { author: '2023-02-01T12:00:00Z', committer: '2024-07-01T12:00:00Z' });
    const { commits, truncated } = await readHistory(d, { since: '2024-03-01', limit: 1 });
    assert.deepEqual(commits.map((c) => c.subject), ['keep']);
    assert.equal(truncated, false);
  });
});

// 2. .mailmap
describe('.mailmap identities', () => {
  let dir;
  before(() => {
    dir = newRepo('gw-mailmap-');
    const old = { GIT_AUTHOR_NAME: 'ada', GIT_AUTHOR_EMAIL: 'ada@old.io' };
    const cur = { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@new.io' };
    commitAt(dir, 'one', { author: '2024-01-02T12:00:00Z', env: old });
    commitAt(dir, 'two', { author: '2024-01-03T12:00:00Z', env: cur });
    writeFileSync(join(dir, '.mailmap'), 'Ada Lovelace <ada@new.io> <ada@old.io>\n');
    commitAt(dir, 'three', { author: '2024-01-04T12:00:00Z', env: old, file: 'g.txt' });
  });

  test('--author with the canonical email matches every commit of that person', async () => {
    const { commits } = await readHistory(dir, { author: 'ADA@new.io' });
    assert.deepEqual(commits.map((c) => c.subject), ['three', 'two', 'one']);
    for (const c of commits) assert.deepEqual([c.author, c.email], ['Ada Lovelace', 'ada@new.io']);
  });

  test('contributor count is 1', async () => {
    const stats = computeStats(await readCommits(dir), { today: '2024-12-31' });
    assert.equal(stats.totals.authors, 1);
  });
});

// 3. stripControl in the recap
describe('summary strips control characters', () => {
  const evil = 'a\x1b[2J\x1b]0;x\x07b\x9b31m\x85c\x7f\r';

  test('stripControl removes C0, DEL and C1', () => {
    assert.equal(stripControl(evil), 'a[2J]0;xb31mc');
    assert.equal(stripControl(null), '');
  });

  test('file names and repo name with ESC/BEL/C1 do not reach the output', () => {
    const files = [{ path: `src/${evil}.js`, added: 2, removed: 0, binary: false }];
    const commits = ['2024-03-10', '2024-03-11'].map((d, i) => ({
      hash: `h${i}`, author: 'A', email: 'a@x', date: `${d}T10:00:00+00:00`, parents: ['p'],
      subject: `${evil} ${evil}`, files, filesChanged: 1, linesAdded: 2, linesRemoved: 0,
    }));
    const stats = computeStats(commits, { today: '2024-03-14' });
    const out = formatSummary(stats, { repoName: `repo${evil}`, paths: { html: `out/${evil}.html`, cardsDir: evil, cardCount: 8 } });
    assert.ok(!CONTROL.test(out), JSON.stringify(out));
    assert.match(out, /repoa\[2J/);
  });
});

// 4. wrapText on a huge unbroken word
test('wrapText: a 200k-char word with maxLines 3 is fast and ellipsized', () => {
  const t0 = performance.now();
  const lines = wrapText('x'.repeat(200_000), { maxWidth: 900, fontSize: 40, maxLines: 3 });
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `took ${ms} ms`);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith('…'));
  for (const l of lines) assert.ok(measureText(l, 40) <= 900);
});

// 5. shallow clones
describe('shallow clone', () => {
  let clone;
  before(() => {
    const src = newRepo('gw-shallow-src-');
    writeFileSync(join(src, 'big.txt'), 'line\n'.repeat(5000));
    git(src, ['add', '-A']);
    git(src, ['commit', '-q', '-m', 'big'], { GIT_AUTHOR_DATE: '2024-01-01T12:00:00Z' });
    commitAt(src, 'boundary', { author: '2024-01-02T12:00:00Z' });
    commitAt(src, 'tip', { author: '2024-01-03T12:00:00Z' });
    clone = join(tmp('gw-shallow-'), 'clone');
    git(tmpdir(), ['clone', '-q', '--depth', '2', `file://${src}`, clone]);
  });

  test('readHistory reports shallow and zeroes the boundary commit', async () => {
    const { commits, shallow } = await readHistory(clone);
    assert.equal(shallow, true);
    assert.deepEqual(commits.map((c) => c.subject), ['tip', 'boundary']);
    const b = commits[1];
    assert.deepEqual([b.files, b.filesChanged, b.linesAdded, b.linesRemoved], [[], 0, 0, 0]);
    assert.equal(commits[0].linesAdded, 1);
    const stats = computeStats(commits, { today: '2024-12-31' });
    assert.deepEqual([stats.totals.linesAdded, stats.totals.linesRemoved], [1, 1]);
  });

  test('a normal repo is not shallow', async () => {
    const d = newRepo('gw-notshallow-');
    commitAt(d, 'x', { author: '2024-01-01T12:00:00Z' });
    assert.equal((await readHistory(d)).shallow, false);
  });

  test('CLI prints the shallow note right after the first line', async () => {
    const { code, stdout } = await runCaptured([clone, '--no-png', '--no-color', '--out', tmp('gw-shallow-out-')]);
    assert.equal(code, 0);
    const lines = stdout.split('\n');
    assert.match(lines[0], /^gitwrapped: 2 commits/);
    assert.match(lines[1], /shallow clone/);
  });
});

// 7. emoji width
test('measureText: an emoji is 1.3em, wider than ASCII letters', () => {
  assert.equal(measureText('😀', 100), 130);
  assert.ok(measureText('😀', 100) > measureText('M', 100));
  assert.ok(measureText('😀', 100) > measureText('W', 100));
});

// 8. messages card / recap consistency
describe('messages copy', () => {
  const mk = (subject, i) => ({
    hash: `h${i}`, author: 'A', email: 'a@x', date: `2024-03-1${i}T10:00:00+00:00`, parents: ['p'],
    subject, files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0,
  });
  // Lengths 10 and 11 → average 10.5; every word is unique (top word count 1).
  const stats = computeStats([mk('abcd efghi', 1), mk('jklm nopqrs', 2)], { today: '2024-03-14' });

  test('headline average equals the subtitle average', () => {
    assert.equal(stats.messages.averageLength, 10.5);
    assert.equal(stats.messages.topWord.count, 1);
    const svg = buildCards(stats).find((c) => c.id === 'messages').svg;
    assert.match(svg, />10\.5</);
    assert.match(svg, /average 10\.5(<\/text><text[^>]*>| )characters/);
  });

  test('a repeating average (10.333…) is rounded the same in headline and subtitle', () => {
    const s = computeStats([mk('abcd efghi', 1), mk('jklm nopqr', 2), mk('stuv wxyzab', 3)], { today: '2024-03-14' });
    const svg = buildCards(s).find((c) => c.id === 'messages').svg;
    const big = /font-size="280"[^>]*>([^<]+)</.exec(svg)[1];
    const sub = /Your messages average ([\d.,]+)/.exec(svg)[1];
    assert.equal(big, '10.3');
    assert.equal(sub, big);
  });

  test('recap omits "Top word" when its count is 1', () => {
    const out = formatSummary(stats);
    assert.doesNotMatch(out, /Top word/i);
    assert.doesNotMatch(out, /"abcd"/);
  });
});

// 9. merges by parent count
describe('merge detection uses parents, not the subject', () => {
  let commits;
  before(async () => {
    const dir = newRepo('gw-merge-');
    commitAt(dir, 'base', { author: '2024-01-01T12:00:00Z' });
    git(dir, ['checkout', '-q', '-b', 'side']);
    commitAt(dir, 'side work', { author: '2024-01-02T12:00:00Z', file: 's.txt' });
    git(dir, ['checkout', '-q', 'main']);
    commitAt(dir, 'main work', { author: '2024-01-03T12:00:00Z', file: 'm.txt' });
    const longSubject = 'integrate the side branch with a very long custom subject line';
    git(dir, ['merge', '-q', '--no-ff', '-m', longSubject, 'side'], { GIT_AUTHOR_DATE: '2024-01-04T12:00:00Z', GIT_COMMITTER_DATE: '2024-01-04T12:00:00Z' });
    commitAt(dir, 'Merge branch foo', { author: '2024-01-05T12:00:00Z' });
    commits = await readCommits(dir);
  });

  const by = (s) => commits.find((c) => c.subject.startsWith(s));

  test('a 2-parent merge with a custom subject is a merge', () => {
    const m = by('integrate');
    assert.equal(m.parents.length, 2);
    assert.equal(isMergeCommit(m), true);
  });

  test('a 1-parent "Merge branch foo" squash is not a merge', () => {
    const s = by('Merge branch foo');
    assert.equal(s.parents.length, 1);
    assert.equal(isMergeCommit(s), false);
  });

  test('message stats skip the real merge and keep the squash', () => {
    const m = computeMessages(commits);
    assert.equal(m.longest.subject, 'Merge branch foo');
    assert.equal(m.shortest.subject, 'base');
    // 4 non-merge subjects: base, side work, main work, Merge branch foo.
    assert.equal(m.averageLength, (4 + 9 + 9 + 16) / 4);
  });
});

// 10. viewer: Space goes forward even on a focused tap zone
test('viewer script: Space-forward handling on tap zones', () => {
  const html = buildViewerHtml(buildCards(computeStats([], { today: '2024-03-14' })));
  assert.match(html, /e\.target === pauseBtn/);
  assert.match(html, /addEventListener\('keyup'/);
  // The tap zones take no pointer events (taps are placed by x position on the story).
  assert.match(html, /\.nav\{[^}]*pointer-events:none/);
  assert.doesNotMatch(html, /onButton/);
});

// 11. submodules
test('submodule bumps do not appear in hot files', async () => {
  const dir = newRepo('gw-submod-');
  commitAt(dir, 'base', { author: '2024-01-01T12:00:00Z' });
  for (const n of ['1', '2', '3']) {
    git(dir, ['update-index', '--add', '--cacheinfo', `160000,${n.repeat(40)},vendor/sub`]);
    git(dir, ['commit', '-q', '-m', `bump ${n}`]);
  }
  const commits = await readCommits(dir);
  assert.equal(commits.length, 4);
  const stats = computeStats(commits, { today: '2024-12-31' });
  assert.deepEqual(stats.hotFiles.map((f) => f.path), ['f.txt']);
});

// 12. CLI edge cases
describe('CLI audit fixes', () => {
  let repo;
  before(() => {
    repo = newRepo('gw-cli-');
    commitAt(repo, 'first', { author: '2024-01-01T12:00:00Z' });
    commitAt(repo, 'second', { author: '2024-01-02T12:00:00Z' });
  });

  test('an empty path argument means "."', () => {
    assert.equal(parseCli(['']).path, '.');
    const r = spawnSync(process.execPath, [BIN, '', '--no-png', '--no-color', '--out', tmp('gw-cli-out-')], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 2 commits/);
  });

  test('--author without "@" and no matches prints the email hint', async () => {
    const { code, stdout } = await runCaptured([repo, '--author', 'Ada', '--no-png', '--no-color', '--out', tmp('gw-cli-out-')]);
    assert.equal(code, 0);
    assert.match(stdout, /--author expects an email address/);
  });

  test('--author with "@" and no matches prints no email hint', async () => {
    const { stdout } = await runCaptured([repo, '--author', 'nobody@x.io', '--no-png', '--no-color', '--out', tmp('gw-cli-out-')]);
    assert.doesNotMatch(stdout, /expects an email/);
  });

  test('no git on PATH → "git not found on PATH", exit 1', () => {
    const emptyBin = tmp('gw-nopath-');
    const env = { ...process.env, PATH: emptyBin };
    for (const k of STRIPPED) delete env[k];
    const r = spawnSync(process.execPath, [BIN, repo, '--no-png', '--out', tmp('gw-cli-out-')], { encoding: 'utf8', env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /git not found on PATH/);
  });

  test('no git on PATH with --since → same error', () => {
    const env = { ...process.env, PATH: tmp('gw-nopath-') };
    const r = spawnSync(process.execPath, [BIN, repo, '--since', '2024-01-01', '--no-png', '--out', tmp('gw-cli-out-')], { encoding: 'utf8', env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /git not found on PATH/);
  });
});
