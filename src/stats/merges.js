// Merges: the merge commits among the analyzed ones and the pull requests merged in the
// window, read from commit subjects. Pure function over readCommits() output (each
// commit's `parents`, `subject` and, in a multi-repo run, `repo`). No git calls.
import { isMergeCommit } from './messages.js';

/** GitHub's merge-commit subject: "Merge pull request #12 from owner/branch". */
const GITHUB_MERGE = /^Merge pull request #(\d+)\b/;
/**
 * A pull request number at the very end of a subject: GitHub's squash / rebase merge
 * suffix "feat: x (#70)", and Bitbucket's "Merged in x (pull request #12)".
 */
const TRAILING_PR = /\((?:pull request )?#(\d+)\)$/;

/** Most significant digits a PR number may have (leading zeros aside); longer is noise. */
const MAX_DIGITS = 9;

/** `digits` as a PR number: a positive integer of at most MAX_DIGITS digits once leading zeros are dropped, else null. */
function prNumber(digits) {
  const d = typeof digits === 'string' ? digits.replace(/^0+/, '') : '';
  if (d === '' || d.length > MAX_DIGITS) return null;
  return Number(d);
}

/**
 * The pull request number `subject` names (see GITHUB_MERGE and TRAILING_PR), or null:
 * a positive integer, leading zeros ignored ("#007" is 7); "#0" and numbers with more than
 * nine digits (leading zeros aside) are not PR numbers. The merge-commit form is tried
 * first; when it has no valid number, a trailing "(#N)" still counts.
 */
export function pullRequestOf(subject) {
  if (typeof subject !== 'string') return null;
  const s = subject.trim();
  const merge = GITHUB_MERGE.exec(s);
  const fromMerge = merge ? prNumber(merge[1]) : null;
  if (fromMerge !== null) return fromMerge;
  const trailing = TRAILING_PR.exec(s);
  return trailing ? prNumber(trailing[1]) : null;
}

/**
 * stats.merges over the analyzed commits: `{commits, share, pullRequests}`.
 * - commits: merge commits (more than one parent; see isMergeCommit in messages.js, which
 *   falls back to a git-generated "Merge …" subject for commits without `parents`);
 * - share: commits / every analyzed commit (merges included), 3 decimals, at most 0.999
 *   short of every commit; 0 without commits;
 * - pullRequests: distinct pull requests named by the subjects of any analyzed commit,
 *   merge or not (see pullRequestOf): "Merge pull request #N from …" and a trailing
 *   "(#N)" squash suffix; the same number twice (a merge commit and the squash-style
 *   subject of the same PR, a cherry-pick, a backport) is one PR. With several repos
 *   (commits carry `repo`, see mergeHistories in src/git.js) numbers are counted per repo,
 *   since #12 in one repo and #12 in another are different PRs. A revert merged through a
 *   PR (`Revert "x (#70)" (#71)`) counts as its own PR (#71), and #70 still counts: the
 *   number of PRs merged, not the number still in.
 * Invalid input policy: never throws, never mutates; non-object entries are skipped.
 * Empty input → `{commits: 0, share: 0, pullRequests: 0}`.
 */
export function computeMerges(commits) {
  let total = 0;
  let merges = 0;
  const prs = new Set();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    total += 1;
    if (isMergeCommit(c)) merges += 1;
    const pr = pullRequestOf(c.subject);
    if (pr !== null) prs.add(`${typeof c.repo === 'string' ? c.repo : ''}\u0000${pr}`);
  }
  const share = total > 0 ? Math.min(Math.round((merges / total) * 1000) / 1000, merges < total ? 0.999 : 1) : 0;
  return { commits: merges, share, pullRequests: prs.size };
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The merges the totals card, the recap and wrapped.md show for `stats.merges`:
 * `{commits, pullRequests, pct}` (pct = share as a percent for shareLabel in
 * stats/contributors.js: below 100 unless the share is exactly 1, every commit a merge), or null when there is no object or neither a merge commit nor a
 * pull request. All outputs use this, so they agree.
 */
export function shownMerges(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  const pullRequests = shownCount(stat.pullRequests);
  if (commits === 0 && pullRequests === 0) return null;
  const raw = typeof stat.share === 'number' && Number.isFinite(stat.share) ? Math.min(Math.max(stat.share, 0), 1) : 0;
  // 1 (100%) only when every commit is a merge, i.e. a share of exactly 1 from computeMerges;
  // a malformed share above 1 is read as "almost all" (shown 99%, see shareLabel).
  const share = stat.share === 1 ? 1 : Math.min(raw, 0.999);
  return { commits, pullRequests, pct: commits > 0 ? share * 100 : 0 };
}
