import { localParts } from './time.js';

/** A line count as a non-negative finite number; anything else (missing, NaN, "3") → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Overall totals for a list of commits (shape from src/git.js readCommits).
 * Returns `{commits, activeDays, linesAdded, linesRemoved, filesTouched,
 * firstCommitDate, lastCommitDate, firstDay, lastDay, authors}`:
 * - activeDays: distinct author-local calendar days (see time.js).
 * - filesTouched: distinct paths across all commits, exactly as git reports them with
 *   --no-renames (see src/git.js): a rename counts as two paths (old and new), deleted
 *   files are included, and binary files are included.
 * - firstCommitDate / lastCommitDate: the original ISO strings of the earliest / latest
 *   instants (null when there are none); on equal instants the first one seen wins.
 * - firstDay / lastDay: the earliest / latest author-local dayKey ('YYYY-MM-DD') of any
 *   commit (null when there are none), so firstDay <= lastDay always holds. With mixed
 *   offsets these need not be the days of firstCommitDate / lastCommitDate.
 * - authors: number of distinct emails, compared lowercased.
 * - linesAdded / linesRemoved: a missing or non-finite / non-number count adds 0.
 * Commits with an unparseable date still count toward commits, lines, files and authors,
 * but not toward activeDays or first/last date. Empty input → zeros and nulls.
 */
export function computeTotals(commits) {
  commits = commits ?? [];
  const days = new Set();
  const paths = new Set();
  const emails = new Set();
  let linesAdded = 0;
  let linesRemoved = 0;
  let first = null;
  let last = null;
  let firstDay = null;
  let lastDay = null;
  for (const c of commits) {
    for (const f of c.files ?? []) if (f && typeof f.path === 'string') paths.add(f.path);
    linesAdded += count(c.linesAdded);
    linesRemoved += count(c.linesRemoved);
    if (c.email) emails.add(String(c.email).toLowerCase());
    const t = localParts(c.date);
    if (!t) continue;
    days.add(t.dayKey);
    if (!first || t.ms < first.ms) first = { ms: t.ms, date: c.date };
    if (!last || t.ms > last.ms) last = { ms: t.ms, date: c.date };
    // dayKeys are zero-padded 'YYYY-MM-DD', so string order is date order.
    if (firstDay === null || t.dayKey < firstDay) firstDay = t.dayKey;
    if (lastDay === null || t.dayKey > lastDay) lastDay = t.dayKey;
  }
  return {
    commits: commits.length,
    activeDays: days.size,
    linesAdded,
    linesRemoved,
    filesTouched: paths.size,
    firstCommitDate: first?.date ?? null,
    lastCommitDate: last?.date ?? null,
    firstDay,
    lastDay,
    authors: emails.size,
  };
}
