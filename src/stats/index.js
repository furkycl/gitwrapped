// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeHotFiles, isIgnoredPath } from './files.js';
import { computeTimeHabits } from './habits.js';
import { computeStreaks } from './streaks.js';
import { computeTotals } from './totals.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeHotFiles, isIgnoredPath };
export { epochDay, hourLabel, localParts, WEEKDAY_NAMES } from './time.js';

/**
 * All stats for a list of commits. `today` ('YYYY-MM-DD') is passed to computeStreaks
 * and defaults to the machine's local date (the only non-deterministic input).
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today } = {}) {
  return {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
    streaks: computeStreaks(commits, { today }),
    hotFiles: computeHotFiles(commits),
  };
}
