// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeContributors, contributorName, hasTeamCard, shareLabel, TOP_CONTRIBUTORS } from './contributors.js';
import { computeDaily, daysUpTo, longestRun, shownLongest } from './daily.js';
import { computeHotFiles, isIgnoredPath } from './files.js';
import { computeTimeHabits } from './habits.js';
import { computeLanguages, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER as OTHER_LANGUAGE, percentShares } from './languages.js';
import { computeMessages, isMergeCommit } from './messages.js';
import { ARCHETYPES, computePersonality } from './personality.js';
import { computeStreaks, localToday } from './streaks.js';
import { computeTotals } from './totals.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeDaily, daysUpTo, longestRun, shownLongest, computeHotFiles, isIgnoredPath };
export { computeLanguages, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER_LANGUAGE, percentShares };
export { computeContributors, contributorName, hasTeamCard, shareLabel, TOP_CONTRIBUTORS };
export { computeMessages, computePersonality, isMergeCommit, ARCHETYPES, localToday };
export { dayKeyFromEpoch, epochDay, hourLabel, localParts, mondayOf, WEEKDAY_NAMES } from './time.js';

/**
 * All stats for a list of commits. `today` ('YYYY-MM-DD') and `todayComplete` (a past
 * window's end day, see streaks.js) are passed to computeStreaks; `today` defaults to the
 * machine's local date (the only non-deterministic input).
 * `personality` is derived from the other parts (see personality.js); its fix share is
 * of non-merge commits, and its Steady Shipper span ignores future-dated days (after
 * `today` + 1, see daily.js daysUpTo). `daily` is commits per author-local day (see daily.js);
 * `languages` is lines / files per language (see languages.js).
 * `contributors` ranks who made the commits (see contributors.js). It is computed from
 * `team` when given (the unfiltered history of an --author run, so "you" can be ranked
 * against everyone), else from `commits`; `author` (the --author email) picks "you";
 * `teamTruncated` says whether that read was capped (contributors.truncated).
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today, todayComplete, team, author, teamTruncated = false } = {}) {
  const stats = {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
    streaks: computeStreaks(commits, { today, todayComplete }),
    daily: computeDaily(commits),
    hotFiles: computeHotFiles(commits),
    languages: computeLanguages(commits),
    contributors: computeContributors(team ?? commits, { author, truncated: teamTruncated }),
    messages: computeMessages(commits),
  };
  const nonMergeCommits = (commits ?? []).filter((c) => !isMergeCommit(c)).length;
  stats.personality = computePersonality(stats, { nonMergeCommits, today: today ?? localToday() });
  return stats;
}
