// One-touch files: the changed files that exactly one non-merge commit in the window touched.
// Counted over the same files as hot files (see fileTouches in files.js: ignored paths left
// out, --exclude has already dropped its files, see excludeFiles; renames are the old path
// plus the new one, as git reports them with --no-renames).
import { fileTouches } from './files.js';
import { isMergeCommit } from './messages.js';

/** The non-enumerable key computeOneTouch keeps the exact (unrounded) share under. */
const EXACT = Symbol('oneTouch.exactShare');

/**
 * stats.oneTouch (shape from src/git.js readCommits): `{files, share}`, or null when no
 * file changed (no non-merge commit, or none touched a counted file).
 * - files: how many distinct changed files exactly one non-merge commit (see
 *   isMergeCommit) touched, a file's touches counted as computeHotFiles counts its commits
 *   (a path listed twice in one commit is one touch); in a multi-repo run paths keep their
 *   repo label, so the same path in two repos is two files;
 * - share: files / every distinct changed file, 3 decimals, at most 0.999 short of every
 *   file (as stats.depBumps); the exact ratio rides along non-enumerably for
 *   shownOneTouch, so stats.json keeps exactly `{files, share}`.
 * `{files: 0, share: 0}` when every changed file was touched more than once.
 * Invalid input policy: never throws, never mutates; non-object commits are skipped.
 */
export function computeOneTouch(commits) {
  const nonMerge = (Array.isArray(commits) ? commits : []).filter((c) => c && typeof c === 'object' && !isMergeCommit(c));
  let total = 0;
  let once = 0;
  for (const entry of fileTouches(nonMerge).values()) {
    total += 1;
    if (entry.commits === 1) once += 1;
  }
  if (total === 0) return null;
  const share = Math.min(Math.round((once / total) * 1000) / 1000, once < total ? 0.999 : 1);
  return Object.defineProperty({ files: once, share }, EXACT, { value: once / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.oneTouch as the cards, the recap and wrapped.md show it: `{files, pct}`, or null
 * (no object, or no one-touch file, so nothing is shown for `{files: 0}`).
 * - files: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeOneTouch keeps (so a 3-decimal share is not rounded twice), else from
 *   `share`; below 100 unless the share is exactly 1 (as shownDepBumps).
 * All outputs use this, so they agree.
 */
export function shownOneTouch(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const files = shownCount(stat.files);
  if (files === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return { files, pct: (ratio === 1 ? 1 : Math.min(raw, 0.999)) * 100 };
}
