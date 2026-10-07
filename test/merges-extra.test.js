// Extra coverage for merges (stats.merges, src/stats/merges.js): a real throwaway repo
// (scripts/make-fixture-repo.js plus real `git merge --no-ff` merges, squash-style
// "(#N)" subjects and a "Merge pull request #N from x/y" subject) run end to end through
// the real binary: stats.json, recap and wrapped.md in en / tr, --author filtering,
// multi-repo dedupe (per repo, and a shared clone counted once), edge subjects, share
// rounding / caps, no email anywhere, and a byte-identical totals card with nothing to show.
// Written by the tester of loop turn 066.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { computeMerges, computeStats, pullRequestOf, shownMerges } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, mergeShareText } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { mergeHistories, readCommits } from '../src/git.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2024-12-31';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
}
// Timeouts: a stalled child process fails the test with a message instead of hanging the run.
const CHILD_TIMEOUT = 60_000;
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT });
const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
const at = (day) => {
  const d = `2024-03-${String(day).padStart(2, '0')}T12:00:00+00:00`;
  return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
};
const WINDOW = ['--since', '2024-01-01', '--until', '2024-12-31'];
const bin = (args, env = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args, ...WINDOW, '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC', ...env }), stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT });
  assert.equal(r.error, undefined, `gitwrapped ${args.join(' ')}: ${r.error}`);
  return r;
};
const statsOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats;
const mdOf = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');
const cardOf = (out, id) => {
  const f = readdirSync(join(out, 'cards')).find((name) => name.endsWith(`-${id}.svg`));
  assert.ok(f, `${id} card in ${out}`);
  return readFileSync(join(out, 'cards', f), 'utf8');
};
/** Every file the run wrote, as text (cards, stats.json, wrapped.md, the viewer). */
function allOutput(dir) {
  const parts = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) parts.push(allOutput(p));
    else if (!/\.(png|gif)$/.test(name.name)) parts.push(readFileSync(p, 'utf8'));
  }
  return parts.join('\n');
}

/**
 * Adds, on top of the fixture repo's 8 plain commits (Ada 4, Bob 4; no merges, no PR
 * numbers), 8 commits: 2 real `--no-ff` merges (Bob's "Merge pull request #7 from
 * bob/feature", Ada's default "Merge branch 'side'"), squash subjects (#3) and (#4), a
 * backport repeating (#4), and subjects that name no PR ("(#12) trailing text", "fix #13").
 */
function addMerges(dir) {
  const commit = (who, day, msg) => git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', msg], { ...who, ...at(day) });
  const write = (f, s) => writeFileSync(join(dir, f), s);
  commit(ADA, 14, 'feat: squash one (#3)');
  commit(ADA, 15, 'fix: squash two (#4)');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write('feature.txt', 'bob\n');
  git(dir, ['add', '-A']);
  commit(BOB, 16, 'feat: bob work');
  git(dir, ['checkout', '-q', 'main']);
  write('main.txt', 'ada\n');
  git(dir, ['add', '-A']);
  commit(ADA, 16, 'chore: (#12) trailing text');
  git(dir, ['merge', '-q', '--no-ff', '--no-gpg-sign', '--no-verify', '-m', 'Merge pull request #7 from bob/feature', 'feature'], { ...BOB, ...at(17) });
  git(dir, ['checkout', '-q', '-b', 'side']);
  write('side.txt', 'side\n');
  git(dir, ['add', '-A']);
  commit(ADA, 18, 'docs: side note, fix #13');
  git(dir, ['checkout', '-q', 'main']);
  commit(ADA, 18, 'ci: backport (#4)');
  git(dir, ['merge', '-q', '--no-ff', '--no-gpg-sign', '--no-verify', '--no-edit', 'side'], { ...ADA, ...at(19) });
}

// --- real repo, end to end -----------------------------------------------------------------

describe('end to end: real merges', () => {
  let tmp;
  let app;
  let lib;
  let clone;
  let plain;
  const fixtures = [];
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-merges-x-'));
    const fx = makeFixtureRepo({ dir: join(tmp, 'app') });
    fixtures.push(fx);
    app = fx.dir;
    addMerges(app);
    // A second repo with the same PR numbers (#3 squash, #4 real merge): different PRs.
    lib = join(tmp, 'lib');
    mkdirSync(lib);
    git(lib, ['init', '-q', '-b', 'main']);
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'feat: lib (#3)'], { ...ADA, ...at(20) });
    git(lib, ['checkout', '-q', '-b', 'x']);
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'feat: x'], { ...BOB, ...at(21) });
    git(lib, ['checkout', '-q', 'main']);
    git(lib, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'chore: y'], { ...ADA, ...at(21) });
    git(lib, ['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', 'Merge pull request #4 from bob/x', 'x'], { ...BOB, ...at(22) });
    // A second clone of app: shares every commit, so nothing is counted twice.
    clone = join(tmp, 'clone');
    git(tmp, ['clone', '-q', app, clone]);
    // The bare fixture repo: no merges, no PR numbers.
    const fx2 = makeFixtureRepo({ dir: join(tmp, 'plain') });
    fixtures.push(fx2);
    plain = fx2.dir;
  });
  after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

  test('readCommits sees both real merges with two parents', async () => {
    const commits = await readCommits(app, { since: '2024-01-01', until: '2024-12-31' });
    assert.equal(commits.length, 16);
    const merges = commits.filter((c) => c.parents.length > 1).map((c) => c.subject);
    assert.deepEqual(merges, ["Merge branch 'side'", 'Merge pull request #7 from bob/feature']);
  });

  test('stats.json, recap and wrapped.md (en)', () => {
    const out = join(tmp, 'o-en');
    const r = bin([app, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const s = statsOf(out);
    // 2 merges of 16 commits; PRs #3, #4 (twice), #7; "(#12) trailing text" and "fix #13" name none.
    assert.deepEqual(s.merges, { commits: 2, share: 0.125, pullRequests: 3 });
    assert.deepEqual(Object.keys(s.merges), ['commits', 'share', 'pullRequests']);
    // 12.5% rounds half up to 13%.
    assert.match(r.stdout, /\n {2}Merges +3 pull requests merged · 2 merge commits \(13% of commits\)\n/);
    assert.match(mdOf(out), /\n- \*\*Merges:\*\* 3 pull requests merged, 2 merge commits \\\(13% of commits\\\)\n/);
    // Recap line placement: after the releases slot, before the biggest commit.
    const lines = r.stdout.split('\n');
    const mi = lines.findIndex((l) => /^ {2}Merges /.test(l));
    const bi = lines.findIndex((l) => /^ {2}Biggest /.test(l));
    assert.ok(mi > 0 && (bi < 0 || mi < bi), r.stdout);
  });

  test('cards: the merges show on the totals card or the outro, never both', () => {
    const out = join(tmp, 'o-en-card');
    assert.equal(bin([app, '--out', out]).status, 0);
    const svg = cardOf(out, 'totals');
    const outro = cardOf(out, 'outro');
    // The fixture's totals card is full (born / buried, size mix, ...), so the row may not fit.
    if (/Merged PRs/.test(svg)) {
      assert.match(svg, />Merged PRs \/ merges<\/text><text [^>]*>3 \/ 2<\/text>/);
      assert.doesNotMatch(outro, /You merged|merge commits/);
    } else {
      assert.doesNotMatch(svg, /Merge commits|Merged PRs/);
      assert.match(outro, /You merged 3 pull requests/);
    }
  });

  test('Turkish run: recap and wrapped.md; stats.json unchanged', () => {
    const out = join(tmp, 'o-tr');
    const r = bin([app, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).merges, { commits: 2, share: 0.125, pullRequests: 3 });
    assert.match(r.stdout, /\n {2}Merge'ler +3 pull request birleşti · 2 merge commit \(commit'lerin %13 kadarı\)\n/);
    assert.match(mdOf(out), /\*\*Merge'ler:\*\* 3 pull request birleşti, 2 merge commit \\\(commit'lerin %13 kadarı\\\)\n/);
  });

  test('--author: only that author\'s merges and PR subjects', () => {
    const outA = join(tmp, 'o-ada');
    const a = bin([app, '--out', outA, '--json', '--md', '--author', 'ada@example.com']);
    assert.equal(a.status, 0, a.stderr);
    // Ada: 4 fixture + 6 new = 10 commits; one merge (side); PRs #3, #4.
    assert.deepEqual(statsOf(outA).merges, { commits: 1, share: 0.1, pullRequests: 2 });
    assert.match(a.stdout, /\n {2}Merges +2 pull requests merged · 1 merge commit \(10% of commits\)\n/);
    const outB = join(tmp, 'o-bob');
    const b = bin([app, '--out', outB, '--json', '--md', '--author', 'BOB@example.com']);
    assert.equal(b.status, 0, b.stderr);
    // Bob: 4 fixture + 2 new = 6 commits; one merge, which names #7.
    assert.deepEqual(statsOf(outB).merges, { commits: 1, share: 0.167, pullRequests: 1 });
    assert.match(b.stdout, /\n {2}Merges +1 pull request merged · 1 merge commit \(17% of commits\)\n/);
    assert.match(mdOf(outB), /\*\*Merges:\*\* 1 pull request merged, 1 merge commit \\\(17% of commits\\\)/);
  });

  test('--since / --until: a window without merges or PRs has zeros and no line', () => {
    const out = join(tmp, 'o-early');
    const r = spawnSync(process.execPath, [BIN, app, '--out', out, '--json', '--md', '--since', '2024-03-01', '--until', '2024-03-13', '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC' }), stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT });
    assert.equal(r.error, undefined, String(r.error));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).merges, { commits: 0, share: 0, pullRequests: 0 });
    assert.doesNotMatch(r.stdout, /Merges/);
    assert.doesNotMatch(mdOf(out), /Merges/);
    assert.doesNotMatch(cardOf(out, 'totals'), /Merged PRs|Merge commits/);
  });

  test('multi-repo: the same PR numbers in two repos are different PRs', () => {
    const out = join(tmp, 'o-multi');
    const r = bin([app, lib, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    // app: 16 commits, 2 merges, PRs #3 #4 #7; lib: 4 commits, 1 merge, PRs #3 #4.
    assert.deepEqual(statsOf(out).merges, { commits: 3, share: 0.15, pullRequests: 5 });
    assert.match(r.stdout, /\n {2}Merges +5 pull requests merged · 3 merge commits \(15% of commits\)\n/);
  });

  test('multi-repo: a second clone shares every commit, so nothing is counted twice', () => {
    const out = join(tmp, 'o-clone');
    const r = bin([app, clone, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).merges, { commits: 2, share: 0.125, pullRequests: 3 });
  });

  test('mergeHistories in process agrees with the binary', async () => {
    const a = await readCommits(app, { since: '2024-01-01', until: '2024-12-31' });
    const l = await readCommits(lib, { since: '2024-01-01', until: '2024-12-31' });
    const { commits } = mergeHistories([{ label: 'app', commits: a }, { label: 'lib', commits: l }]);
    assert.deepEqual(computeMerges(commits), { commits: 3, share: 0.15, pullRequests: 5 });
    // Without labels the numbers collide: #3 and #4 once each.
    assert.equal(computeMerges([...a, ...l]).pullRequests, 3);
  });

  test('no email anywhere in any output (en and tr, --author)', () => {
    for (const [name, args] of [['o-mail-en', []], ['o-mail-tr', ['--lang', 'tr']], ['o-mail-a', ['--author', 'bob@example.com']], ['o-mail-m', [lib]]]) {
      const out = join(tmp, name);
      const r = bin([app, ...args, '--out', out, '--json', '--md']);
      assert.equal(r.status, 0, r.stderr);
      for (const text of [r.stdout, allOutput(out)]) {
        // stats.json echoes the --author filter the user typed (filters.author); nothing else may.
        const rest = text.replace(/"author": "bob@example\.com"/g, '');
        const at = rest.search(/@example\.com/);
        assert.equal(at, -1, `${name}: ${JSON.stringify(rest.slice(Math.max(0, at - 120), at + 40))}`);
      }
    }
  });

  test('a repo without merges or PRs: zeros, no line, totals card without the row', () => {
    const out = join(tmp, 'o-plain');
    const r = bin([plain, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsOf(out).merges, { commits: 0, share: 0, pullRequests: 0 });
    assert.doesNotMatch(r.stdout, /Merges/);
    assert.doesNotMatch(mdOf(out), /Merges/);
    assert.doesNotMatch(cardOf(out, 'totals'), /Merged PRs|Merge commits/);
  });
});

// --- pullRequestOf edge subjects -------------------------------------------------------------

describe('pullRequestOf (extra)', () => {
  test('only a trailing (#N) or a leading "Merge pull request #N" counts', () => {
    const cases = [
      ['(#12) trailing text', null],
      ['#12', null],
      ['fix #12', null],
      ['x (#12)', 12],
      ['x(#12)', 12],
      ['(#12)', 12],
      ['x (#12) (#12)', 12],
      ['x (#12)(#13)', 13],
      ['x (#12).', null],
      ['x (# 12)', null],
      ['x (#12 )', null],
      ['x (PR #12)', null],
      ['x (pull request #12)', 12],
      ['x (#-1)', null],
      ['x (#1e3)', null],
      ['x (#１２)', null], // full-width digits are not ASCII digits
      ['  x (#12)  ', 12],
      ['\tx (#12)\n', 12],
      ['x (#12) ', 12], // NBSP is trimmed by String#trim
      ['Merge pull request #12 from a/b', 12],
      ['  Merge pull request #12 from a/b', 12],
      ['Merge pull request #12', 12],
      ['Merge pull request #12from', null],
      ['merge pull request #12 from a/b', null],
      ['Merge pull request #12 from a/b (#13)', 12], // the merge form wins
      ['Revert "Merge pull request #5 from a/b"', null],
      ['Revert "x (#5)"', null],
    ];
    for (const [s, want] of cases) assert.equal(pullRequestOf(s), want, JSON.stringify(s));
  });

  test('(#0), huge numbers and nine-digit boundary', () => {
    assert.equal(pullRequestOf('x (#0)'), null);
    assert.equal(pullRequestOf('x (#000)'), null);
    assert.equal(pullRequestOf('Merge pull request #0 from a/b'), null);
    assert.equal(pullRequestOf('x (#999999999)'), 999999999);
    assert.equal(pullRequestOf('x (#1000000000)'), null);
    assert.equal(pullRequestOf('x (#99999999999999999999999)'), null);
    assert.equal(pullRequestOf('Merge pull request #12345678901 from a/b'), null);
    assert.equal(pullRequestOf('x (#007)'), 7);
  });

  test('non-strings → null, never throws', () => {
    for (const v of [undefined, null, 12, {}, [], true, Symbol.for('x')]) assert.equal(pullRequestOf(v), null);
  });
});

// --- computeMerges / shownMerges --------------------------------------------------------------

describe('computeMerges (extra)', () => {
  let i = 0;
  const c = (subject, parents = 1, extra = {}) => ({ hash: `h${++i}`, subject, parents: Array.from({ length: parents }, (_, k) => `p${k}`), ...extra });

  test('dedupe: squash subject, merge subject, cherry-pick and backport of one PR are one', () => {
    const r = computeMerges([c('feat: a (#5)'), c('Merge pull request #5 from x/a', 2), c('feat: a (#5)'), c('backport: a (#5)'), c('x (#05)')]);
    assert.deepEqual(r, { commits: 1, share: 0.2, pullRequests: 1 });
  });

  test('octopus merges count once; a root commit (no parents) is not a merge', () => {
    assert.deepEqual(computeMerges([c('Merge branches a, b and c', 4), c('root', 0)]), { commits: 1, share: 0.5, pullRequests: 0 });
  });

  test('parents array wins over the subject: a "Merge …" subject with one parent is not a merge', () => {
    assert.equal(computeMerges([c("Merge branch 'x'", 1)]).commits, 0);
  });

  test('share: rounding to 3 decimals, never 1 short of every commit, 1 when all are merges', () => {
    const many = (m, t) => [...Array.from({ length: m }, () => c('m', 2)), ...Array.from({ length: t - m }, () => c('n'))];
    assert.equal(computeMerges(many(1, 3)).share, 0.333);
    assert.equal(computeMerges(many(2, 3)).share, 0.667);
    assert.equal(computeMerges(many(1, 8)).share, 0.125);
    assert.equal(computeMerges(many(1, 2001)).share, 0); // rounds to 0 but commits stays 1
    assert.equal(computeMerges(many(1, 2001)).commits, 1);
    assert.equal(computeMerges(many(1999, 2000)).share, 0.999);
    assert.equal(computeMerges(many(5, 5)).share, 1);
    for (let t = 1; t <= 40; t++) {
      for (let m = 0; m <= t; m++) {
        const { share } = computeMerges(many(m, t));
        assert.ok(share >= 0 && share <= 1, `${m}/${t}`);
        if (m < t) assert.ok(share < 1, `${m}/${t}`);
        assert.equal(share, Math.round(share * 1000) / 1000);
      }
    }
  });

  test('skips non-objects in the total, ignores a non-string repo label, never mutates', () => {
    const input = [null, 'x', c('a (#1)', 1, { repo: 5 }), c('b (#1)')];
    const copy = structuredClone(input);
    assert.deepEqual(computeMerges(input), { commits: 0, share: 0, pullRequests: 1 });
    assert.deepEqual(input, copy);
  });

  test('stats.json serializes stats.merges in place', () => {
    const stats = computeStats([c('a (#1)'), c('Merge pull request #2 from a/b', 2, { date: '2024-03-01T00:00:00Z' })], { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo' }));
    assert.deepEqual(doc.stats.merges, { commits: 1, share: 0.5, pullRequests: 2 });
  });
});

describe('shownMerges / mergeShareText (extra)', () => {
  test('share text: "<1%" for a tiny share, never 100% short of every commit', () => {
    const L = getStrings('en');
    assert.equal(mergeShareText(shownMerges({ commits: 1, share: 0, pullRequests: 0 }), L), '<1%');
    assert.equal(mergeShareText(shownMerges({ commits: 1, share: 0.004, pullRequests: 0 }), L), '<1%');
    assert.equal(mergeShareText(shownMerges({ commits: 1999, share: 0.999, pullRequests: 0 }), L), '99%');
    assert.equal(mergeShareText(shownMerges({ commits: 5, share: 1, pullRequests: 0 }), L), '100%');
    assert.equal(mergeShareText(shownMerges({ commits: 5, share: 0.125, pullRequests: 0 }), getStrings('tr')), '%13');
  });

  test('malformed share is clamped; malformed counts are dropped', () => {
    assert.deepEqual(shownMerges({ commits: 2, share: -1, pullRequests: 0 }), { commits: 2, pullRequests: 0, pct: 0 });
    assert.deepEqual(shownMerges({ commits: 2, share: 'x', pullRequests: 3 }), { commits: 2, pullRequests: 3, pct: 0 });
    assert.deepEqual(shownMerges({ commits: 2, share: NaN, pullRequests: NaN }), { commits: 2, pullRequests: 0, pct: 0 });
    assert.equal(shownMerges({ commits: Infinity, share: 0.5, pullRequests: -3 }), null);
    assert.equal(shownMerges('x'), null);
    assert.equal(shownMerges([]), null);
  });

  test('pull requests only: pct 0 and no share text in the outputs', () => {
    const stats = computeStats([{ hash: 'a1', subject: 'feat (#9)', parents: ['p'], date: '2024-03-01T10:00:00Z', author: 'Ada', email: 'ada@example.com', files: [] }], { today: TODAY });
    assert.deepEqual(stats.merges, { commits: 0, share: 0, pullRequests: 1 });
    assert.match(formatSummary(stats, { today: TODAY }), /\n {2}Merges +1 pull request merged\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\*\*Merge'ler:\*\* 1 pull request birleşti\n/);
  });
});

// --- totals card ---------------------------------------------------------------------------

describe('totals card (extra)', () => {
  const totals = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'totals');

  test('byte-identical without merges to show (fixture history, en and tr, every theme input)', () => {
    const fx = makeFixtureRepo();
    try {
      const stats = computeStats(fx.commits.map((c) => ({ ...c, parents: ['p'] })), { today: TODAY });
      assert.deepEqual(stats.merges, { commits: 0, share: 0, pullRequests: 0 });
      const without = { ...stats };
      delete without.merges;
      for (const lang of ['en', 'tr']) {
        assert.equal(totals(stats, { lang }).svg, totals(without, { lang }).svg, lang);
        assert.equal(totals(stats, { lang }).description, totals(without, { lang }).description, lang);
        for (const bad of [null, 'x', { commits: 0, pullRequests: 0, share: 0.5 }, { commits: -1, pullRequests: NaN }]) {
          assert.equal(totals({ ...stats, merges: bad }, { lang }).svg, totals(without, { lang }).svg, `${lang} ${JSON.stringify(bad)}`);
        }
      }
    } finally {
      fx.cleanup();
    }
  });

  test('the row is last, and never displaces another row', () => {
    let k = 0;
    const commits = Array.from({ length: 6 }, (_, j) => ({
      hash: `h${++k}`,
      subject: j < 3 ? `feat: x (#${j + 1})` : 'chore: y',
      parents: j === 5 ? ['a', 'b'] : ['a'],
      date: `2024-03-0${j + 1}T10:00:00Z`,
      author: 'Ada',
      email: 'ada@example.com',
      files: j === 5 ? [] : [{ path: `src/f${j}.js`, added: 2, removed: 1 }],
    }));
    const stats = computeStats(commits, { today: TODAY });
    const without = { ...stats };
    delete without.merges;
    for (const lang of ['en', 'tr']) {
      const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((x) => x.id === 'totals').spec;
      const base = buildCardSpecs(without, { repoName: 'demo', today: TODAY, lang }).find((x) => x.id === 'totals').spec;
      assert.deepEqual(spec.lines.slice(0, base.lines.length), base.lines, lang);
      assert.equal(spec.lines.length, base.lines.length + 1, lang);
      const T = getStrings(lang).totals;
      assert.deepEqual(spec.lines.at(-1), { label: T.mergesLabel(3, 1), value: T.mergesValue(3, 1, '') });
    }
  });
});
