// Biggest grower: the file with the largest net line growth (lines added − lines removed)
// over the non-merge commits in the window. Counted over the same files as hot files (see
// fileTouches in files.js: ignored paths left out, --exclude has already dropped its files,
// see excludeFiles; renames are the old path plus the new one, as git reports them with
// --no-renames; binary files add 0 lines).
import { scrubEmails } from '../privacy.js';
import { fileTouches } from './files.js';
import { isMergeCommit } from './messages.js';

/**
 * stats.biggestGrower (shape from src/git.js readCommits): `{path, net, added, removed}`,
 * or null when no file grew (no non-merge commit, no counted file, or every file's net
 * growth is 0 or less).
 * - path: the file's path as hot files show it (repo-labelled in a multi-repo run, so the
 *   same path in two repos is two files), anything shaped like an email address replaced by
 *   "…" (see scrubEmails); files are told apart and ordered by their real paths;
 * - added / removed: the file's lines added and removed over the non-merge commits (see
 *   isMergeCommit), summed as computeHotFiles sums them (a missing or non-finite count, and
 *   a binary file, adds 0);
 * - net: added − removed, always > 0.
 * The file with the largest net wins; a tie goes to the path that sorts first (plain
 * code-unit order). Invalid input policy: never throws, never mutates; non-object commits
 * are skipped.
 */
export function computeBiggestGrower(commits) {
  const nonMerge = (Array.isArray(commits) ? commits : []).filter((c) => c && typeof c === 'object' && !isMergeCommit(c));
  let best = null;
  for (const entry of fileTouches(nonMerge).values()) {
    const net = entry.linesAdded - entry.linesRemoved;
    if (!(net > 0)) continue;
    if (!best || net > best.net || (net === best.net && entry.path < best.entry.path)) best = { entry, net };
  }
  if (!best) return null;
  const { entry, net } = best;
  return { path: scrubEmails(entry.path), net, added: entry.linesAdded, removed: entry.linesRemoved };
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.biggestGrower as the hot-files card, the recap and wrapped.md show it: `{path,
 * net, added, removed}` (a non-empty path, emails scrubbed again; whole numbers, net at
 * least 1), or null (no object, an empty path, or no growth). All outputs use this, so
 * they agree.
 */
export function shownBiggestGrower(stat) {
  if (!stat || typeof stat !== 'object' || typeof stat.path !== 'string') return null;
  const path = scrubEmails(stat.path).trim();
  const net = shownCount(stat.net);
  if (path === '' || net === 0) return null;
  return { path, net, added: shownCount(stat.added), removed: shownCount(stat.removed) };
}
