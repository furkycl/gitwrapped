import { isIgnoredPath, repoRelativePath } from './files.js';
import { isMergeCommit } from './messages.js';

/** A line count as a non-negative finite number; anything else → 0 (as in files.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Commit size buckets by lines changed (added + removed), bounds inclusive:
 * - tiny: fewer than 10 lines (0-9; a commit that changes no counted line is tiny);
 * - small: 10-99 lines;
 * - medium: 100-500 lines;
 * - large: more than 500 lines (501+).
 * `max` is each bucket's largest line count (Infinity for large).
 */
export const COMMIT_SIZE_BUCKETS = Object.freeze([
  Object.freeze({ id: 'tiny', max: 9 }),
  Object.freeze({ id: 'small', max: 99 }),
  Object.freeze({ id: 'medium', max: 500 }),
  Object.freeze({ id: 'large', max: Infinity }),
]);

/** The bucket ids in order: tiny, small, medium, large. */
export const COMMIT_SIZE_IDS = Object.freeze(COMMIT_SIZE_BUCKETS.map((b) => b.id));

/**
 * Whole percents of `values` (non-negative counts) that always add up to exactly 100 when
 * any value is positive (largest remainder; a remainder tie goes to the earlier value),
 * all 0 otherwise. Unlike languages.js percentShares, equal counts can differ by 1 (three
 * equal buckets: 34 + 33 + 33), so the size bar always fills exactly 100%.
 */
export function sizeShares(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  const order = values.map((_, i) => i).sort((a, b) => (exact[b] - shares[b]) - (exact[a] - shares[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

/** The bucket id for `lines` changed (see COMMIT_SIZE_BUCKETS). */
export function commitSizeOf(lines) {
  const n = count(lines);
  return COMMIT_SIZE_BUCKETS.find((b) => n <= b.max).id;
}

/**
 * The commit size mix: how many non-merge commits (see isMergeCommit) fall in each size
 * bucket (COMMIT_SIZE_BUCKETS: tiny < 10 lines, small 10-99, medium 100-500, large > 500).
 * Lines are added + removed, counted over the same files as hot files and the biggest
 * commit: paths for which isIgnoredPath() is true (lockfiles, build output, dependency
 * folders, vendored code, minified files, snapshots; in a multi-repo run checked relative
 * to each repo's root, see repoRelativePath) add nothing, and files removed by --exclude
 * are already gone from the commits. A commit with no counted lines (only ignored or
 * binary files, or none at all) is tiny.
 * Returns `{total, tiny, small, medium, large, shares: {tiny, small, medium, large}}`:
 * total is the number of commits counted; shares are whole percents of total (see
 * sizeShares: largest remainder, always adding up to exactly 100), all 0 when total is 0.
 * Invalid input policy (as in biggest.js): never throws; non-object entries are skipped,
 * a commit without a files array counts as tiny, files without a string path are skipped,
 * and a missing, negative or non-finite line count adds 0. Empty input → all zeros.
 */
export function computeCommitSizes(commits) {
  const out = { total: 0, tiny: 0, small: 0, medium: 0, large: 0 };
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    let lines = 0;
    for (const f of Array.isArray(c.files) ? c.files : []) {
      if (!f || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      lines += count(f.added) + count(f.removed);
    }
    out[commitSizeOf(lines)] += 1;
    out.total += 1;
  }
  const shares = sizeShares(COMMIT_SIZE_IDS.map((id) => out[id]));
  out.shares = Object.fromEntries(COMMIT_SIZE_IDS.map((id, i) => [id, shares[i]]));
  return out;
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shown = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The size mix the totals card and the recap show for `stats.commitSizes`, as
 * `[{id, count, share}]` in bucket order (tiny → large; counts clamped and rounded, shares
 * recomputed from those counts with sizeShares), or null when there is nothing to show
 * (no object, or every count shows as 0). Both outputs use this, so they always agree.
 */
export function shownCommitSizes(sizes) {
  if (!sizes || typeof sizes !== 'object') return null;
  const counts = COMMIT_SIZE_IDS.map((id) => shown(sizes[id]));
  if (counts.every((n) => n === 0)) return null;
  const shares = sizeShares(counts);
  return COMMIT_SIZE_IDS.map((id, i) => ({ id, count: counts[i], share: shares[i] }));
}
