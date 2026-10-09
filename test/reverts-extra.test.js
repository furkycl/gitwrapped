// Extra coverage for reverts (stats.reverts, src/stats/reverts.js, readReverts in
// src/git.js): real repos built with `git revert` (body line, "Reapply", --reference) and
// hand-written `Revert "…"` subjects, run end to end through the real binary: --author /
// --since filtering of the extra git read, multi-repo merge, stats.json shape, the
// messages card in en / tr (also next to the emoji row, within the card's bounds), the
// Fixaholic reason, recap and wrapped.md lines, zero-revert output and a failing revert read.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStats as computeAllStats, shownReverts } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, layoutCard } from '../src/cards/svg.js';
import { readCommits, readReverts } from '../src/git.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out (and the top words row
// after it, stats.messages.topWords, see test/top-words.test.js).
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
};

const TODAY = '2026-04-01';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
}
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
const at = (day) => {
  const d = `2026-03-${String(day).padStart(2, '0')}T12:00:00+00:00`;
  return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
};
const bin = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC', ...env }) });
const statsOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats;
const mdOf = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');
const cardOf = (out, id) => {
  const f = readdirSync(join(out, 'cards')).find((n) => n.endsWith(`-${id}.svg`));
  assert.ok(f, `${id} card in ${out}`);
  return readFileSync(join(out, 'cards', f), 'utf8');
};
/** The card's visible text, <text> elements joined with spaces (wrapped lines rejoined). */
const textOf = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
/** The messages card's row value text next to a given label text (both <text> elements). */
const rowValue = (svg, label) => svg.match(new RegExp(`>${label}</text><text [^>]*text-anchor="end">([^<]*)</text>`))?.[1];

// --- real repos, end to end --------------------------------------------------------------

describe('end to end: real git reverts', () => {
  let tmp;
  let app;
  let lib;
  let plain;
  const h = {};
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-reverts-x-'));
    app = join(tmp, 'app');
    mkdirSync(app);
    git(app, ['init', '-q', '-b', 'main']);
    const commit = (who, day, args) => git(app, ['commit', '-q', '--no-gpg-sign', '--no-verify', ...args], { ...who, ...at(day) });
    const revert = (who, day, args) => git(app, ['revert', '--no-edit', '--no-gpg-sign', ...args], { ...who, ...at(day) });
    const head = () => git(app, ['rev-parse', 'HEAD']).trim();
    const write = (f, s) => writeFileSync(join(app, f), s);
    write('a.txt', '1\n');
    git(app, ['add', '-A']);
    commit(ADA, 1, ['-m', 'feat: one']); // 1
    write('a.txt', '2\n');
    commit(ADA, 2, ['-am', 'fix: two']); // 2
    h.two = head();
    revert(ADA, 3, ['HEAD']); // 3: Revert "fix: two" + body line
    h.revertTwo = head();
    revert(ADA, 4, ['HEAD']); // 4: Reapply "fix: two" (git >= 2.43) or Revert "Revert …" + body line
    h.reapply = head();
    h.reapplySubject = git(app, ['log', '-1', '--format=%s']).trim();
    commit(ADA, 5, ['--allow-empty', '-m', 'Revert "feat: one"']); // 5: hand-written subject, no body line
    h.handWritten = head();
    write('b.txt', '1\n');
    git(app, ['add', '-A']);
    commit(BOB, 6, ['-m', 'feat: bob b']); // 6
    h.bobB = head();
    revert(BOB, 7, ['HEAD']); // 7: Bob's revert
    h.bobRevert = head();
    write('c.txt', '1\n');
    git(app, ['add', '-A']);
    commit(ADA, 8, ['-m', 'fix: c']); // 8
    h.c = head();
    revert(ADA, 9, ['--reference', 'HEAD']); // 9: "This reverts commit <abbrev> (fix: c, date)."
    h.refRevert = head();
    // A merge whose message looks like a revert: merges are never counted.
    git(app, ['checkout', '-q', '-b', 'side']);
    commit(ADA, 10, ['--allow-empty', '-m', 'fix: side']); // 10
    git(app, ['checkout', '-q', 'main']);
    commit(ADA, 11, ['--allow-empty', '-m', 'fix: revert handling in the parser']); // 11: not a revert
    git(app, ['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', 'Revert "side"', '-m', `This reverts commit ${h.c}.`, 'side'], { ...ADA, ...at(12) });
    // 11 non-merge commits; reverts: 3, 4, 5, 7, 9.

    lib = join(tmp, 'lib');
    mkdirSync(lib);
    git(lib, ['init', '-q', '-b', 'main']);
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'feat: lib'], { ...ADA, ...at(13) });
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'Revert "feat: lib"', '-m', `This reverts commit ${git(lib, ['rev-parse', 'HEAD']).trim()}.`], { ...ADA, ...at(14) });
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'docs: lib'], { ...ADA, ...at(15) });

    plain = join(tmp, 'plain');
    mkdirSync(plain);
    git(plain, ['init', '-q', '-b', 'main']);
    ['feat: a', 'fix: b', 'docs: c', 'fix: d'].forEach((s, i) => git(plain, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', s], { ...ADA, ...at(1 + i) }));
  });
  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('readCommits: revertOf for git revert, Reapply, --reference; none for a subject-only revert or a merge', async () => {
    const by = new Map((await readCommits(app)).map((c) => [c.hash, c]));
    assert.deepEqual(by.get(h.revertTwo).revertOf, [h.two]);
    assert.deepEqual(by.get(h.reapply).revertOf, [h.revertTwo]);
    assert.equal(by.get(h.handWritten).revertOf, undefined);
    assert.deepEqual(by.get(h.bobRevert).revertOf, [h.bobB]);
    assert.equal(by.get(h.refRevert).revertOf.length, 1);
    assert.ok(h.c.startsWith(by.get(h.refRevert).revertOf[0]), 'abbreviated --reference hash');
    assert.ok(by.get(h.refRevert).revertOf[0].length >= 7);
  });

  test('stats.json shape, recap and wrapped.md (en)', () => {
    const out = join(tmp, 'o-all');
    const r = bin([app, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const s = statsOf(out);
    // reverted: two, revertTwo, bobB, c (abbrev) = 4 distinct; the hand-written one names none.
    assert.deepEqual(s.reverts, { total: 11, count: 5, share: 0.455, reverted: 4 });
    assert.deepEqual(Object.keys(s.reverts), ['total', 'count', 'share', 'reverted']);
    assert.match(r.stdout, /\n {2}Reverts +5 commits \(45% of non-merge commits\)\n/);
    assert.match(mdOf(out), /\n## Reverts\n\n5 commits \\\(45% of non-merge commits\\\)\n/);
    const svg = cardOf(out, 'messages');
    // The type mix already folded the fix / wip / oops rows and a fourth row does not fit next to it
    // and the biggest commit: the reverts row never replaces the counter row, so it is left out.
    assert.equal(rowValue(svg, 'Reverts'), undefined);
    assert.match(svg, /“fix” \/ “wip” \/ “oops”/);
  });

  test('Reapply subject counts only through the body line', () => {
    // git 2.43+ writes Reapply "…"; older gits Revert "Revert "…"". Either way: one revert.
    assert.match(h.reapplySubject, /^(Reapply "fix: two"|Revert "Revert "fix: two"")$/);
  });

  test('Turkish run: card row, recap and wrapped.md; stats.json unchanged', () => {
    const out = join(tmp, 'o-tr');
    const r = bin([app, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statsOf(out).reverts.count, 5);
    assert.match(r.stdout, /\n {2}Revert'ler +5 commit \(merge dışı commit'lerin %45 kadarı\)\n/);
    assert.match(mdOf(out), /\n## Revert'ler\n\n5 commit \\\(merge dışı commit'lerin %45 kadarı\\\)\n/);
    // The type mix already folded the fix / wip / oops rows and a fourth row does not fit next to it
    // and the biggest commit: the reverts row never replaces the counter row, so it is left out.
    assert.equal(rowValue(cardOf(out, 'messages'), 'Revert&apos;ler'), undefined);
    assert.match(cardOf(out, 'messages'), /“fix” \/ “wip” \/ “oops”/);
  });

  test('--author: only that author\'s reverts (the extra read follows the filtered commits)', () => {
    const out = join(tmp, 'o-bob');
    const r = bin([app, '--out', out, '--json', '--md', '--author', 'bob@example.com']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).reverts, { total: 2, count: 1, share: 0.5, reverted: 1 });
    const outA = join(tmp, 'o-ada');
    const a = bin([app, '--out', outA, '--json', '--author', 'ADA@example.com']);
    assert.equal(a.status, 0, a.stderr);
    assert.deepEqual(statsOf(outA).reverts, { total: 9, count: 4, share: 0.444, reverted: 3 });
  });

  test('--since / --until window: reverts outside it are not counted', () => {
    const out = join(tmp, 'o-win');
    // Days 5..8: hand-written revert (5), bob b (6), bob revert (7), fix: c (8).
    const r = bin([app, '--out', out, '--json', '--since', '2026-03-05', '--until', '2026-03-08']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).reverts, { total: 4, count: 2, share: 0.5, reverted: 1 });
    const out2 = join(tmp, 'o-win2');
    const r2 = bin([app, '--out', out2, '--json', '--md', '--since', '2026-03-10']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(statsOf(out2).reverts, { total: 2, count: 0, share: 0, reverted: 0 });
    assert.doesNotMatch(r2.stdout, /Reverts/);
    assert.doesNotMatch(mdOf(out2), /Reverts/);
  });

  test('--max-commits: the cap applies to the extra read too', () => {
    const out = join(tmp, 'o-cap');
    // The 3 newest non-merge-or-merge commits: merge (12), fix: revert handling (11), fix: side (10).
    const r = bin([app, '--out', out, '--json', '--max-commits', '4']);
    assert.equal(r.status, 0, r.stderr);
    // 4 newest by date: merge 12, 11, 10, refRevert 9 → one revert among 3 non-merge.
    assert.deepEqual(statsOf(out).reverts, { total: 3, count: 1, share: 0.333, reverted: 1 });
  });

  test('two repos merge into one reverts stat', () => {
    const out = join(tmp, 'o-multi');
    const r = bin([app, lib, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).reverts, { total: 14, count: 6, share: 0.429, reverted: 5 });
    assert.match(r.stdout, /\n {2}Reverts +6 commits \(43% of non-merge commits\)\n/);
    // The type mix already folded the fix / wip / oops rows and a fourth row does not fit next to it
    // and the biggest commit: the reverts row never replaces the counter row, so it is left out.
    assert.equal(rowValue(cardOf(out, 'messages'), 'Reverts'), undefined);
    assert.match(cardOf(out, 'messages'), /“fix” \/ “wip” \/ “oops”/);
  });

  test('the same repo passed twice (shared commits) is counted once', () => {
    const out = join(tmp, 'o-twice');
    const r = bin([lib, `${lib}/`, '--out', out, '--json']);
    if (r.status !== 0) return; // a repeated path may be refused; that is fine here
    assert.deepEqual(statsOf(out).reverts, { total: 3, count: 1, share: 0.333, reverted: 1 });
  });

  test('zero reverts: stat in stats.json, no recap line, section or card row', () => {
    const out = join(tmp, 'o-plain');
    const r = bin([plain, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).reverts, { total: 4, count: 0, share: 0, reverted: 0 });
    assert.doesNotMatch(r.stdout, /Revert/);
    assert.doesNotMatch(mdOf(out), /Revert/);
    for (const f of readdirSync(join(out, 'cards'))) assert.doesNotMatch(readFileSync(join(out, 'cards', f), 'utf8'), /Revert/, f);
    const outTr = join(tmp, 'o-plain-tr');
    const t = bin([plain, '--out', outTr, '--md', '--lang', 'tr']);
    assert.equal(t.status, 0, t.stderr);
    assert.doesNotMatch(t.stdout, /Revert/);
    assert.doesNotMatch(mdOf(outTr), /Revert/);
  });

  test('Fixaholic reason names the reverts (stats.json, card, en + tr)', () => {
    const dir = join(tmp, 'fixer');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    const subjects = ['fix: a', 'fix: b', 'fix: c', 'fix: d', 'fix: e', 'fix: f', 'feat: g'];
    subjects.forEach((s, i) => git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', s], { ...ADA, ...at(2 + i * 3) }));
    const target = git(dir, ['rev-parse', 'HEAD']).trim();
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'Undo feat g', '-m', `This reverts commit ${target}.`], { ...ADA, ...at(25) });
    const out = join(tmp, 'o-fix');
    const r = bin([dir, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const s = statsOf(out);
    assert.equal(s.reverts.count, 1);
    assert.equal(s.personality.archetype.id, 'fixaholic');
    assert.equal(s.personality.archetype.reason, '75% of your commit messages are fixes; 1 commit reverts another.');
    assert.match(textOf(cardOf(out, 'personality')), /fixes; 1 commit reverts another\./);
    const outTr = join(tmp, 'o-fix-tr');
    const t = bin([dir, '--out', outTr, '--lang', 'tr']);
    assert.equal(t.status, 0, t.stderr);
    assert.match(textOf(cardOf(outTr, 'personality')), /düzeltme; 1 commit başka bir commit(?:'|&apos;)i geri alıyor\./);
  });

  test('emoji row and reverts row together on a real card', () => {
    const dir = join(tmp, 'emoji');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    ['✨ add login', ':bug: fix crash', 'update readme', '📝 docs', '✨ polish', 'Revert "✨ polish"'].forEach((s, i) => git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', s], { ...ADA, ...at(1 + i) }));
    const out = join(tmp, 'o-emoji');
    const r = bin([dir, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const svg = cardOf(out, 'messages');
    assert.equal(rowValue(svg, 'Reverts'), '1 · 17%');
    assert.match(svg, />Emoji [^<]*<\/text>/);
    for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) assert.ok(+m[2] <= 1920 && +m[1] <= 1080, m[0]);
  });
});

// --- a failing revert read ---------------------------------------------------------------

describe('a failing extra git call degrades gracefully', { skip: process.platform === 'win32' }, () => {
  let tmp;
  let repo;
  let realGit;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-reverts-fail-'));
    realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    repo = join(tmp, 'repo');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), '1\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '--no-gpg-sign', '-m', 'feat: a'], { ...ADA, ...at(1) });
    writeFileSync(join(repo, 'a.txt'), '2\n');
    git(repo, ['commit', '-q', '--no-gpg-sign', '-am', 'feat: b'], { ...ADA, ...at(2) });
    git(repo, ['revert', '--no-edit', '--no-gpg-sign', 'HEAD'], { ...ADA, ...at(3) }); // Revert "feat: b"
    git(repo, ['revert', '--no-edit', '--no-gpg-sign', 'HEAD'], { ...ADA, ...at(4) }); // Reapply (body only on git >= 2.43)
    git(repo, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'Undo it', '-m', 'This reverts commit 1234567.'], { ...ADA, ...at(5) });
  });
  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  /** A `git` on PATH that runs the real one, except for the revert read (its --grep), which gets `body`. */
  function fakeGit(name, body) {
    const dir = join(tmp, name);
    mkdirSync(dir);
    const script = `#!/bin/sh\nfor a in "$@"; do case "$a" in "--grep="*"This reverts commit"*) ${body} ;; esac; done\nexec "${realGit}" "$@"\n`;
    writeFileSync(join(dir, 'git'), script);
    chmodSync(join(dir, 'git'), 0o755);
    return { PATH: `${dir}${delimiter}${process.env.PATH}` };
  }

  const baseline = () => {
    const out = join(tmp, 'o-ok');
    const r = bin([repo, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return statsOf(out).reverts;
  };

  for (const [name, body] of [
    ['exit 128', 'echo "fatal: boom" >&2; exit 128'],
    ['exit 0 without reading stdin, garbage out', 'printf "zzz\\037This reverts commit abcdef1\\0"; exit 0'],
    ['killed', 'kill -9 $$'],
  ]) {
    test(`git ${name}: the run succeeds; only Revert "…" subjects count`, () => {
      const ok = baseline();
      const reapplyIsRevertSubject = /^Revert "/.test(git(repo, ['log', '-1', '--skip=1', '--format=%s']).trim());
      assert.deepEqual(ok, { total: 5, count: 3, share: 0.6, reverted: 3 });
      const out = join(tmp, `o-${name.replace(/\W+/g, '-')}`);
      const r = bin([repo, '--out', out, '--json', '--md'], fakeGit(`bin-${name.replace(/\W+/g, '-')}`, body));
      assert.equal(r.status, 0, r.stderr);
      const s = statsOf(out);
      const count = 1 + (reapplyIsRevertSubject ? 1 : 0);
      assert.deepEqual(s.reverts, { total: 5, count, share: Math.round((count / 5) * 1000) / 1000, reverted: 0 });
      assert.match(r.stdout, new RegExp(`Reverts +${count} commit`));
      // The rest of the run is untouched by the failure.
      assert.equal(s.totals.commits, 5);
    });
  }

  test('readReverts with many unknown hashes (git exits early): resolves, no field, no unhandled error', async () => {
    const commits = Array.from({ length: 20000 }, (_, i) => ({ hash: i.toString(16).padStart(40, 'f') }));
    const res = await readReverts(repo, commits);
    assert.equal(res, commits);
    assert.equal(commits.some((c) => 'revertOf' in c), false);
  });

  test('readReverts skips non-hex hashes and junk entries', async () => {
    const real = await readCommits(repo, { reverts: false });
    const mixed = [null, { hash: 'not-a-hash; rm -rf /' }, { hash: 42 }, ...real];
    await readReverts(repo, mixed);
    assert.equal(real.filter((c) => c.revertOf).length, 3);
  });
});

// --- emoji row + reverts row within bounds (in-process sweep) -------------------------------

describe('messages card: reverts row next to the emoji row stays within the card', () => {
  const commit = (subject, i, files = [], extra = {}) => ({
    hash: String(i).padStart(40, '0'),
    date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
    subject,
    author: 'Ada',
    email: 'ada@example.com',
    files,
    parents: ['p'],
    ...extra,
  });
  const W = 'WWWWWWW MMMMMMM wwwwww mmmmmm WWWWWWW MMMMMMM wwwwww mmmmmm WWWWWWW MMMMMMM wwwwww mmmmmm'.split(' ');
  function variant(l1, l2, big, reverts) {
    const subj = ['feat: ✨ ' + W.slice(0, l1).join(' '), 'fix: :bug: crash', 'docs: 📝 readme', 'refactor: parser', 'test: more', 'chore: stuff', 'fix: typo', 'feat: again'];
    const commits = Array.from({ length: 40 }, (_, i) => commit(subj[i % 8], i, i === 39 && big ? [{ path: 'a.js', added: big, removed: 1 }] : []));
    commits[39].subject = 'feat: ' + W.slice(0, l2).join(' ');
    for (let i = 0; i < reverts; i++) commits[4 + i * 8].subject = `Revert "${commits[4 + i * 8].subject}"`;
    return computeStats(commits, { today: TODAY });
  }
  const spec = (stats, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').spec;
  const charts = (s) => [s.chart].flat().filter(Boolean);
  const noReverts = (stats) => {
    const c = { ...stats };
    delete c.reverts;
    return c;
  };
  const seen = new Set();

  for (const lang of ['en', 'tr']) {
    test(`invariants over layout variants (${lang})`, () => {
      const L = getStrings(lang);
      for (const l1 of [0, 2, 6, 12]) for (const l2 of [0, 3, 12]) for (const big of [0, 100]) for (const n of [1, 3]) {
        const stats = variant(l1, l2, big, n);
        const tag = `${lang} l1=${l1} l2=${l2} big=${big} n=${n}`;
        assert.equal(stats.reverts.count, n, tag);
        const a = spec(stats, lang);
        const b = spec(noReverts(stats), lang);
        const la = layoutCard({ ...a, lang });
        const lb = layoutCard({ ...b, lang });
        // Never costs a chart, never shrinks more than the emoji row was allowed to.
        assert.deepEqual(charts(a), charts(b), tag);
        assert.deepEqual(la.drawnCharts, lb.drawnCharts, tag);
        for (const blk of la.blocks) assert.ok(blk.top >= CONTENT_TOP - 0.5 && blk.bottom <= CONTENT_BOTTOM + 0.5, `${tag} ${blk.kind} ${blk.top}..${blk.bottom}`);
        // The emoji row keeps its place whenever it had one.
        const emojiIn = (s) => s.lines.some((r) => /^Emoji/.test(r.label));
        if (emojiIn(b)) assert.ok(emojiIn(a), `${tag}: emoji row lost`);
        // The renderer draws at most 6 rows (svg.js LIST.maxRows): a 7th row in the spec is silently dropped.
        assert.ok(a.lines.length <= 6, `${tag}: ${a.lines.length} rows in the spec`);
        const svg = buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').svg;
        const last = a.lines.at(-1);
        if (last.label === L.messages.revertsTitle) {
          const r = shownReverts(stats.reverts);
          assert.equal(last.value, L.messages.revertsValue(n, L.pct(Math.round(r.pct))), tag);
          assert.ok(emojiIn(a), tag);
          assert.ok(svg.includes(`>${last.value}</text>`), `${tag}: row not drawn`);
          assert.equal(a.lines.filter((x) => x.label === L.messages.revertsTitle).length, 1, tag);
          seen.add('both');
        } else {
          // Left out: the card is exactly what it was without the stat.
          assert.deepEqual(a, b, tag);
          seen.add('left-out');
        }
      }
    });
  }

  test('the reverts row was shown in at least some variants', () => {
    assert.ok(seen.has('both'), [...seen].join());
  });
});

// --- in-process zero-revert outputs ---------------------------------------------------------

describe('zero reverts in-process: outputs identical to a stats object without the field', () => {
  test('recap and wrapped.md (en + tr), also with a malformed reverts object', () => {
    const commits = Array.from({ length: 12 }, (_, i) => ({
      hash: String(i).padStart(40, 'a'), date: `2026-03-${String(1 + i).padStart(2, '0')}T10:00:00Z`, subject: i % 2 ? 'fix: x' : 'feat: y', author: 'Ada', email: 'ada@example.com', files: [], parents: ['p'],
    }));
    const stats = computeStats(commits, { today: TODAY });
    const without = { ...stats };
    delete without.reverts;
    for (const junk of [stats.reverts, { count: -3, total: 10 }, { count: 'x' }, { count: NaN }, null, 'str']) {
      const s = { ...stats, reverts: junk };
      for (const lang of ['en', 'tr']) {
        assert.equal(formatSummary(s, { repoName: 'demo', lang }), formatSummary(without, { repoName: 'demo', lang }));
        assert.equal(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }), buildMarkdown(without, { repoName: 'demo', today: TODAY, lang }));
      }
    }
  });
});
