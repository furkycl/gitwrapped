// Merges: merge commits in the window, their share and the pull requests merged, as
// stats.merges (computeMerges, src/stats/merges.js), in the recap, in wrapped.md and as a
// row on the totals card (spare room only; the card is byte-identical otherwise).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMerges, computeStats, pullRequestOf, shownMerges } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, mergesOnTotals } from '../src/cards/index.js';
import { getStrings } from '../src/i18n/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (subject, extra = {}) => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date: '2026-10-01T12:00:00+03:00',
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const merge = (subject, extra = {}) => commit(subject, { parents: ['p1', 'p2'], files: [], ...extra });
const statsOf = (commits) => computeStats(commits, { today: TODAY });
const totalsOf = (stats, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
const totalsSvg = (stats, lang) => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').svg;
const outroOf = (stats, lang) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'outro').spec;
const outroSvg = (stats, lang, colorTheme) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, colorTheme }).find((c) => c.id === 'outro').svg;
const withoutMerges = (stats) => {
  const copy = { ...stats };
  delete copy.merges;
  return copy;
};
/** `stats` with a full totals card: --year's three rows on top of active days / files touched / contributors. */
const crowded = (stats) => ({ ...stats, totals: { ...stats.totals, authors: 3 }, yearOverYear: { previousYear: 2025, commits: { delta: 4 }, lines: { delta: -10 }, activeDays: { delta: 1 } } });
const panelsOf = (spec) => (Array.isArray(spec.chart) ? spec.chart : [spec.chart]).filter((c) => c.kind === 'callout');

describe('pullRequestOf', () => {
  test('GitHub merge subjects, trailing squash suffixes and Bitbucket suffixes', () => {
    assert.equal(pullRequestOf('Merge pull request #12 from ada/feature'), 12);
    assert.equal(pullRequestOf('feat: relative windows (#70)'), 70);
    assert.equal(pullRequestOf('feat: x (#70)  '), 70);
    assert.equal(pullRequestOf('Merged in feature (pull request #5)'), 5);
    assert.equal(pullRequestOf('Revert "feat: x (#70)" (#71)'), 71);
    assert.equal(pullRequestOf('fix #007 (#007)'), 7);
  });

  test('anything else is not a PR number', () => {
    assert.equal(pullRequestOf('x (#0000000000123)'), 123, 'the digit bound applies after leading zeros');
    assert.equal(pullRequestOf('Merge pull request #12345678901 from a/b (#42)'), 42, 'an out-of-bound merge number falls back to the trailing form');
    assert.equal(pullRequestOf('Merge pull request #0 from a/b'), null);
    for (const s of ['fix: issue #12', 'feat: x (#70) and more', 'Revert "feat: x (#70)"', '(#0)', '(#1234567890)', 'Merge branch \'x\'', '', null, 42, {}]) {
      assert.equal(pullRequestOf(s), null, String(s));
    }
  });
});

describe('computeMerges', () => {
  test('empty or malformed input → zeros, never throws', () => {
    const zero = { commits: 0, share: 0, pullRequests: 0 };
    assert.deepEqual(computeMerges([]), zero);
    assert.deepEqual(computeMerges(), zero);
    assert.deepEqual(computeMerges(null), zero);
    assert.deepEqual(computeMerges('x'), zero);
    assert.deepEqual(computeMerges([null, 3, 'x']), zero);
  });

  test('counts merge commits by parents, share of every commit, distinct PRs', () => {
    const commits = [
      commit('feat: a (#1)'),
      commit('feat: b (#2)'),
      commit('feat: b again, cherry-picked (#2)'),
      merge('Merge pull request #2 from ada/b'),
      merge("Merge branch 'main' into dev"),
      commit('chore: no PR'),
    ];
    assert.deepEqual(computeMerges(commits), { commits: 2, share: 0.333, pullRequests: 2 });
  });

  test('without parents, a git-generated merge subject counts (isMergeCommit fallback)', () => {
    const c = commit('Merge pull request #3 from x/y');
    delete c.parents;
    assert.deepEqual(computeMerges([c, commit('x')]), { commits: 1, share: 0.5, pullRequests: 1 });
  });

  test('share is never 1 short of every commit, and 1 when all are merges', () => {
    const many = [...Array.from({ length: 1999 }, () => merge('Merge x')), commit('y')];
    assert.equal(computeMerges(many).share, 0.999);
    assert.equal(computeMerges([merge('Merge x')]).share, 1);
  });

  test('multi-repo: the same number in two repos is two PRs', () => {
    const commits = [commit('a (#5)', { repo: 'api' }), commit('b (#5)', { repo: 'web' }), commit('c (#5)', { repo: 'web' })];
    assert.equal(computeMerges(commits).pullRequests, 2);
  });
});

describe('shownMerges', () => {
  test('null with nothing to show', () => {
    assert.equal(shownMerges(null), null);
    assert.equal(shownMerges({ commits: 0, share: 0, pullRequests: 0 }), null);
    assert.equal(shownMerges({ commits: 'x', pullRequests: -1 }), null);
  });
  test('pct stays below 100 unless every commit is a merge', () => {
    assert.equal(shownMerges({ commits: 3, share: 1.7, pullRequests: 0 }).pct < 100, true);
    assert.equal(shownMerges({ commits: 3, share: 0.9996, pullRequests: 0 }).pct < 100, true);
    assert.equal(shownMerges({ commits: 3, share: 1, pullRequests: 0 }).pct, 100);
  });
  test('pct from share', () => {
    assert.deepEqual(shownMerges({ commits: 3, share: 0.25, pullRequests: 4 }), { commits: 3, pullRequests: 4, pct: 25 });
    assert.deepEqual(shownMerges({ commits: 0, share: 0, pullRequests: 4 }), { commits: 0, pullRequests: 4, pct: 0 });
  });
});

describe('outputs', () => {
  const commits = [commit('feat: a (#1)'), commit('feat: b (#2)'), commit('feat: c'), merge('Merge pull request #3 from ada/c')];

  test('stats.json carries stats.merges', () => {
    const doc = JSON.parse(buildStatsJson({ stats: statsOf(commits), repoName: 'demo' }));
    assert.deepEqual(doc.stats.merges, { commits: 1, share: 0.25, pullRequests: 3 });
  });

  test('recap and wrapped.md lines, en and tr', () => {
    const stats = statsOf(commits);
    assert.match(formatSummary(stats, { today: TODAY }), /Merges\s+3 pull requests merged · 1 merge commit \(25% of commits\)/);
    assert.match(formatSummary(stats, { today: TODAY, lang: 'tr' }), /Merge'ler\s+3 pull request birleşti · 1 merge commit \(commit'lerin %25 kadarı\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /\*\*Merges:\*\* 3 pull requests merged, 1 merge commit \\\(25% of commits\\\)/);
    const none = statsOf([commit('x'), commit('y')]);
    assert.doesNotMatch(formatSummary(none, { today: TODAY }), /Merges/);
    assert.doesNotMatch(buildMarkdown(none, { repoName: 'demo', today: TODAY }), /Merges/);
  });

  test('totals card row when there is room, byte-identical without merges', () => {
    const stats = statsOf(commits);
    const row = (spec) => spec.lines.find((l) => /PR|Merge/.test(l.label));
    assert.deepEqual(row(totalsOf(stats)), { label: 'Merged PRs / merges', value: '3 / 1' });
    assert.deepEqual(row(totalsOf(stats, 'tr')), { label: 'Birleşen PR / merge', value: '3 / 1' });
    const onlyPrs = statsOf([commit('a (#1)'), commit('b (#2)')]);
    assert.deepEqual(row(totalsOf(onlyPrs)), { label: 'Merged PRs', value: '2' });
    const onlyMerges = statsOf([commit('a'), merge("Merge branch 'x'")]);
    assert.deepEqual(row(totalsOf(onlyMerges)), { label: 'Merge commits', value: '1 · 50%' });
    const zeroed = { ...stats, merges: { commits: 0, share: 0, pullRequests: 0 } };
    const without = { ...stats };
    delete without.merges;
    assert.equal(totalsSvg(zeroed), totalsSvg(without));
    assert.notEqual(totalsSvg(stats), totalsSvg(without));
  });

  test('outro carries the merges panel exactly when the totals card has no room for the row', () => {
    const stats = statsOf(commits);
    const L = getStrings('en');
    // Room on totals: the row is there, and the outro is as without merges.
    assert.equal(mergesOnTotals(stats, { L }), true);
    assert.equal(panelsOf(outroOf(stats)).length, 0);
    assert.equal(outroSvg(stats), outroSvg(withoutMerges(stats)));
    // No room on totals (b): the totals SVG is byte-identical to the one without merges,
    // and (a) the outro shows the panel instead, in en and tr.
    const full = crowded(stats);
    assert.equal(mergesOnTotals(full, { L }), false);
    assert.equal(totalsSvg(full), totalsSvg(withoutMerges(full)));
    assert.equal(totalsSvg(full, 'tr'), totalsSvg(withoutMerges(full), 'tr'));
    assert.deepEqual(panelsOf(outroOf(full)).map((p) => [p.title, p.value, p.note]), [['Merges', 'You merged 3 pull requests', '1 merge commit · 25% of commits']]);
    assert.deepEqual(panelsOf(outroOf(full, 'tr')).map((p) => [p.title, p.value, p.note]), [["Merge'ler", '3 pull request birleştirdin', "1 merge commit · commit'lerin %25 kadarı"]]);
    for (const theme of ['default', 'mono', 'neon']) assert.match(outroSvg(full, 'en', theme), /You merged 3 pull requests/);
    // Without pull requests: the merge-commit count is the value.
    const onlyMerges = crowded(statsOf([commit('a'), commit('b'), merge("Merge branch 'x'")]));
    assert.deepEqual(panelsOf(outroOf(onlyMerges)).map((p) => [p.value, p.note]), [['1 merge commit', '33% of commits']]);
  });

  test('outro byte-identical with nothing to show (c), and next to a releases panel', () => {
    const none = crowded(statsOf([commit('x'), commit('y')]));
    const zeroed = { ...none, merges: { commits: 0, share: 0, pullRequests: 0 } };
    assert.equal(outroSvg(zeroed), outroSvg(withoutMerges(none)));
    assert.equal(outroSvg(zeroed, 'tr'), outroSvg(withoutMerges(none), 'tr'));
    // With releases too: both panels when they fit, else the releases panel as before.
    const tagged = crowded(statsOf([commit('feat: a (#1)', { tags: ['v1.0.0'] }), commit('b'), merge('Merge pull request #2 from a/b')]));
    const titles = panelsOf(outroOf(tagged)).map((p) => p.title);
    assert.equal(titles[0], 'Releases');
    assert.ok(titles.length === 2 ? titles[1] === 'Merges' : titles.length === 1);
  });
});
