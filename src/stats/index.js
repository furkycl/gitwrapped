// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeTimeHabits } from './habits.js';
import { computeTotals } from './totals.js';

export { computeTotals, computeTimeHabits };
export { hourLabel, localParts, WEEKDAY_NAMES } from './time.js';

/** All stats for a list of commits. Later milestones add keys (streaks, hotFiles, ...). */
export function computeStats(commits = []) {
  return {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
  };
}
