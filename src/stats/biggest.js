import { isIgnoredPath, repoRelativePath } from './files.js';
import { isMergeCommit } from './messages.js';
import { localParts } from './time.js';

/** A line count as a non-negative finite number; anything else → 0 (as in files.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * The biggest commit: the one with the most lines changed (added + removed), counted
 * over the same files as hot files: paths for which isIgnoredPath() is true (lockfiles,
 * build output, dependency folders, vendored code, minified files, snapshots; in a
 * multi-repo run checked relative to each repo's root, see repoRelativePath) add nothing.
 * Files removed by --exclude are already gone from the commits (see excludeFiles).
 * Returns `{hash, subject, date, linesAdded, linesRemoved, lines, files}` or null:
 * - subject: the trimmed subject line (null when missing / empty);
 * - date: the author-local day 'YYYY-MM-DD' (null when the date is unparseable);
 * - linesAdded / linesRemoved / lines: counted lines (lines = added + removed);
 * - files: how many distinct counted paths the commit touches.
 * Merge commits (see isMergeCommit) are skipped, and a commit whose counted lines are 0
 * cannot be the biggest (null when no commit has any). Ties go to the earliest commit by
 * date; commits with an unparseable date come after dated ones; on the same instant (or
 * both undated) the later one in input order wins: the input is newest first (git log,
 * or mergeHistories in src/git.js for several repos, which keeps equal instants repo by
 * repo in git's order), so that is the older commit in git order (in a multi-repo run,
 * the one from the later repo).
 * Invalid input policy: never throws; files without a string path are skipped, and a
 * missing, negative or non-finite line count adds 0. Empty input → null.
 */
export function computeBiggestCommit(commits) {
  let best = null;
  for (const c of commits ?? []) {
    if (!c || isMergeCommit(c) || !Array.isArray(c.files)) continue;
    let linesAdded = 0;
    let linesRemoved = 0;
    const paths = new Set();
    for (const f of c.files) {
      if (!f || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      paths.add(f.path);
      linesAdded += count(f.added);
      linesRemoved += count(f.removed);
    }
    const lines = linesAdded + linesRemoved;
    if (lines === 0) continue;
    const t = localParts(c.date);
    const ms = t ? t.ms : Infinity;
    // Strictly more lines wins; on a tie the earlier instant wins, and on the same instant
    // the later one in input order (git log lists newest first, so the older commit).
    if (best && (lines < best.lines || (lines === best.lines && ms > best.ms))) continue;
    const subject = typeof c.subject === 'string' && c.subject.trim() ? c.subject.trim() : null;
    best = { hash: typeof c.hash === 'string' ? c.hash : null, subject, date: t ? t.dayKey : null, linesAdded, linesRemoved, lines, files: paths.size, ms };
  }
  if (!best) return null;
  const { ms, ...out } = best;
  return out;
}

/** A shown line count: a finite positive number rounded to an integer, anything else 0. */
const shown = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The line counts the messages card and the recap show for `stats.biggestCommit`, as
 * `{added, removed}` (clamped to 0 and rounded, like the "+N / −M" text), or null when
 * there is nothing to show (no object, or both counts show as 0). Both outputs use this,
 * so they always agree on whether the biggest commit appears.
 */
export function shownBiggestLines(b) {
  if (!b || typeof b !== 'object') return null;
  const added = shown(b.linesAdded);
  const removed = shown(b.linesRemoved);
  return added + removed > 0 ? { added, removed } : null;
}
