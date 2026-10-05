// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeHotFiles, isIgnoredPath } from './files.js';
import { computeTimeHabits } from './habits.js';
import { computeMessages, isMergeCommit } from './messages.js';
import { ARCHETYPES, computePersonality } from './personality.js';
import { computeStreaks } from './streaks.js';
import { computeTotals } from './totals.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeHotFiles, isIgnoredPath };
export { computeMessages, computePersonality, isMergeCommit, ARCHETYPES };
export { epochDay, hourLabel, localParts, WEEKDAY_NAMES } from './time.js';

/**
 * All stats for a list of commits. `today` ('YYYY-MM-DD') is passed to computeStreaks
 * and defaults to the machine's local date (the only non-deterministic input).
 * `personality` is derived from the other parts (see personality.js); its fix share is
 * of non-merge commits.
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today } = {}) {
  const stats = {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
    streaks: computeStreaks(commits, { today }),
    hotFiles: computeHotFiles(commits),
    messages: computeMessages(commits),
  };
  const nonMergeCommits = (commits ?? []).filter((c) => !isMergeCommit(c)).length;
  stats.personality = computePersonality(stats, { nonMergeCommits });
  return stats;
}
