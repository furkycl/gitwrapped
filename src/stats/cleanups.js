// Cleanup commits: non-merge commits that remove more lines than they add, over the same
// files as the hot files (src/stats/files.js): same ignore rules, and --exclude has already
// dropped its files (see excludeFiles). The biggest one is the largest net deletion.
import { scrubEmails } from '../privacy.js';
import { isIgnoredPath, repoRelativePath } from './files.js';
import { isMergeCommit } from './messages.js';
import { localParts } from './time.js';

/** The non-enumerable key computeCleanups keeps the exact (unrounded) share under (see shownCleanups). */
const EXACT = Symbol('cleanups.exactShare');

/** A line count as a non-negative finite number; anything else → 0 (as in biggest.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * stats.cleanups (shape from src/git.js readCommits): `{commits, share, biggest}`, or null
 * when no commit is a cleanup (so also without non-merge commits).
 * - A cleanup is a non-merge commit (see isMergeCommit) whose counted lines removed are
 *   more than its counted lines added. Lines are counted exactly as for the biggest commit
 *   and the hot files: ignored paths add nothing (see isIgnoredPath, checked relative to
 *   each repo's root, see repoRelativePath), --exclude has already dropped its files, and a
 *   missing, negative or non-finite count adds 0. A commit with 0 counted lines (or as
 *   many added as removed) is not a cleanup.
 * - commits: how many cleanups;
 * - share: commits / every non-merge commit (also those with no counted line, as the
 *   reverts count them), 3 decimals, at most 0.999 short of every commit (as stats.merges
 *   and stats.tests round theirs); the exact ratio rides along non-enumerably for
 *   shownCleanups, so stats.json keeps exactly `{commits, share, biggest}`;
 * - biggest: the cleanup with the largest net deletion (removed − added), as
 *   `{hash, subject, date, linesAdded, linesRemoved, net}`, like stats.biggestCommit:
 *   subject trimmed with anything shaped like an email address replaced by "…" (see
 *   scrubEmails; null when missing / empty), date the author-local day 'YYYY-MM-DD' (null
 *   when unparseable), net = linesRemoved − linesAdded (a positive number of lines). Ties
 *   follow biggest.js: the earliest commit by date; undated after dated; on the same
 *   instant (or both undated) the later one in input order (git log is newest first, so
 *   the older commit).
 * Invalid input policy: never throws, never mutates; non-object commits / files and files
 * without a string path are skipped. Empty input → null.
 */
export function computeCleanups(commits) {
  let total = 0;
  let cleanups = 0;
  let best = null;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const f of Array.isArray(c.files) ? c.files : []) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      linesAdded += count(f.added);
      linesRemoved += count(f.removed);
    }
    if (!(linesRemoved > linesAdded)) continue;
    cleanups += 1;
    const net = linesRemoved - linesAdded;
    const t = localParts(c.date);
    const ms = t ? t.ms : Infinity;
    // Strictly more net deletion wins; on a tie the earlier instant wins, and on the same
    // instant the later one in input order (git log lists newest first, so the older commit).
    if (best && (net < best.net || (net === best.net && ms > best.ms))) continue;
    const raw = typeof c.subject === 'string' ? scrubEmails(c.subject).trim() : '';
    best = { hash: typeof c.hash === 'string' ? c.hash : null, subject: raw || null, date: t ? t.dayKey : null, linesAdded, linesRemoved, net, ms };
  }
  if (cleanups === 0) return null;
  const { ms, ...biggest } = best;
  const share = Math.min(Math.round((cleanups / total) * 1000) / 1000, cleanups < total ? 0.999 : 1);
  return Object.defineProperty({ commits: cleanups, share, biggest }, EXACT, { value: cleanups / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.cleanups as the totals card, the recap and wrapped.md show it: `{commits, pct,
 * biggest}`, or null (no object, or no cleanup commit).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeCleanups keeps (so a 3-decimal share is not rounded twice), else from
 *   `share`; below 100 unless the share is exactly 1 (every non-merge commit a cleanup);
 * - biggest: `{subject, date, net}` (subject emails scrubbed again, trimmed, null when
 *   empty; date the stat's 'YYYY-MM-DD' string or null; net a positive whole number), or
 *   null when the stat has no usable biggest cleanup (a missing or non-positive net).
 * All outputs use this, so they agree.
 */
export function shownCleanups(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  const b = stat.biggest;
  const net = b && typeof b === 'object' ? shownCount(b.net) : 0;
  const subject = net > 0 && typeof b.subject === 'string' ? scrubEmails(b.subject).trim() : '';
  const biggest = net > 0 ? { subject: subject || null, date: typeof b.date === 'string' ? b.date : null, net } : null;
  return { commits, pct: share * 100, biggest };
}
