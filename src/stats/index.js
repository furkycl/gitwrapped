// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeDaily } from './daily.js';
import { computeHotFiles, isIgnoredPath } from './files.js';
import { computeTimeHabits } from './habits.js';
import { computeLanguages, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER as OTHER_LANGUAGE, percentShares } from './languages.js';
import { computeMessages, isMergeCommit } from './messages.js';
import { ARCHETYPES, computePersonality } from './personality.js';
import { computeStreaks, localToday } from './streaks.js';
import { computeTotals } from './totals.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeDaily, computeHotFiles, isIgnoredPath };
export { computeLanguages, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER_LANGUAGE, percentShares };
export { computeMessages, computePersonality, isMergeCommit, ARCHETYPES, localToday };
export { dayKeyFromEpoch, epochDay, hourLabel, localParts, mondayOf, WEEKDAY_NAMES } from './time.js';

/**
 * All stats for a list of commits. `today` ('YYYY-MM-DD') and `todayComplete` (a past
 * window's end day, see streaks.js) are passed to computeStreaks; `today` defaults to the
 * machine's local date (the only non-deterministic input).
 * `personality` is derived from the other parts (see personality.js); its fix share is
 * of non-merge commits. `daily` is commits per author-local day (see daily.js);
 * `languages` is lines / files per language (see languages.js).
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today, todayComplete } = {}) {
  const stats = {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
    streaks: computeStreaks(commits, { today, todayComplete }),
    daily: computeDaily(commits),
    hotFiles: computeHotFiles(commits),
    languages: computeLanguages(commits),
    messages: computeMessages(commits),
  };
  const nonMergeCommits = (commits ?? []).filter((c) => !isMergeCommit(c)).length;
  stats.personality = computePersonality(stats, { nonMergeCommits });
  return stats;
}
