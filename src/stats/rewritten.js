// Rewritten commits: non-merge commits whose committer date is more than an hour after their
// author date, the mark a rebase, an amend or a cherry-pick leaves (git keeps the author
// date and stamps a new committer date). Read from each commit's `date` (author) and
// `committerDate` (see parseLog in src/git.js); a commit without a committer date (a
// hand-made record or an older stats input) is never rewritten.
import { isMergeCommit } from './messages.js';

/** How much later than the author date (ms) the committer date must be, strictly, to count: one hour. */
export const REWRITE_GAP_MS = 60 * 60 * 1000;

/** The non-enumerable key computeRewritten keeps the exact (unrounded) share under. */
const EXACT = Symbol('rewritten.exactShare');

/**
 * Whether commit `c` was rewritten: both its author date (`date`) and committer date
 * (`committerDate`) parse as instants and the committer date is strictly more than
 * REWRITE_GAP_MS later (instants are compared, so time zones don't matter; exactly one
 * hour does not count, nor does a committer date before the author date). False for a
 * missing or unparseable date or a non-object; never throws. Merges are not excluded here
 * (see computeRewritten).
 */
export function isRewrittenCommit(c) {
  if (!c || typeof c !== 'object' || typeof c.date !== 'string' || typeof c.committerDate !== 'string') return false;
  const authored = Date.parse(c.date);
  const committed = Date.parse(c.committerDate);
  return Number.isFinite(authored) && Number.isFinite(committed) && committed - authored > REWRITE_GAP_MS;
}

/**
 * stats.rewritten (shape from src/git.js readCommits): `{commits, share}`, or null when
 * there is no non-merge commit (nothing to take a share of; as stats.depBumps).
 * `{commits: 0, share: 0}` when there are non-merge commits but none was rewritten.
 * - commits: how many non-merge commits (see isMergeCommit) were rewritten (see
 *   isRewrittenCommit: committer date more than an hour after the author date);
 * - share: commits / every non-merge commit (also those without a committer date), 3
 *   decimals, at most 0.999 short of every commit (as stats.depBumps); the exact ratio
 *   rides along non-enumerably for shownRewritten, so stats.json keeps exactly
 *   `{commits, share}`.
 * Invalid input policy: never throws, never mutates; non-object commits are skipped.
 * Empty input → null.
 */
export function computeRewritten(commits) {
  let total = 0;
  let rewritten = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    if (isRewrittenCommit(c)) rewritten += 1;
  }
  if (total === 0) return null;
  const share = Math.min(Math.round((rewritten / total) * 1000) / 1000, rewritten < total ? 0.999 : 1);
  return Object.defineProperty({ commits: rewritten, share }, EXACT, { value: rewritten / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.rewritten as the cards, the recap and wrapped.md show it: `{commits, pct}`, or
 * null (no object, or no rewritten commit, so nothing is shown for `{commits: 0}`).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeRewritten keeps (so a 3-decimal share is not rounded twice), else from
 *   `share`; below 100 unless the share is exactly 1 (as shownDepBumps).
 * All outputs use this, so they agree.
 */
export function shownRewritten(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return { commits, pct: (ratio === 1 ? 1 : Math.min(raw, 0.999)) * 100 };
}
