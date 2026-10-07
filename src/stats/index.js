// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeBiggestCommit, shownBiggestLines } from './biggest.js';
import { computeContributors, contributorName, hasTeamCard, shareLabel, TOP_CONTRIBUTORS } from './contributors.js';
import { computeFirstCommit, SHORT_HASH } from './first.js';
import { computeCoAuthors, shownCoAuthors, TOP_CO_AUTHORS } from './coauthors.js';
import { computeReleases, shownReleases } from './releases.js';
import { busiestOf, computeDaily, daysUpTo, longestGap, longestRun, shownBusiestDay, shownLongest, shownLongestBreak } from './daily.js';
import { computeFileLifecycle, computeHotFiles, isIgnoredPath, repoRelativePath, shownFileLifecycle } from './files.js';
import { computeTimeHabits } from './habits.js';
import { computeLanguages, languageBarRows, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER as OTHER_LANGUAGE, percentShares } from './languages.js';
import { computeMessages, isMergeCommit } from './messages.js';
import { computeMonths, monthsFromDays } from './months.js';
import { ARCHETYPES, computePersonality } from './personality.js';
import { computeStreaks, localToday } from './streaks.js';
import { computeRepos } from './repos.js';
import { COMMIT_SIZE_BUCKETS, COMMIT_SIZE_IDS, commitSizeOf, computeCommitSizes, shownCommitSizes, sizeShares } from './sizes.js';
import { computeTotals } from './totals.js';
import { COMMIT_TYPE_IDS, COMMIT_TYPES_MIN_SHARE, commitTypeOf, computeCommitTypes, foldCommitTypes, shownCommitTypes } from './types.js';
import { computeYearOverYear, yearOverYear } from './yoy.js';
import { computeReverts, isRevertCommit, isRevertSubject, shownReverts } from './reverts.js';
import { computeEmoji, EMOJI_MIN_SHARE, emojiIn, emojiKey, GITMOJI, isEmoji, shownEmoji, TOP_EMOJI } from './emoji.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeDaily, busiestOf, daysUpTo, longestGap, longestRun, shownBusiestDay, shownLongest, shownLongestBreak, computeFileLifecycle, shownFileLifecycle, computeHotFiles, isIgnoredPath, repoRelativePath, computeRepos, computeYearOverYear, yearOverYear };
export { computeLanguages, languageBarRows, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER_LANGUAGE, percentShares };
export { computeContributors, contributorName, hasTeamCard, shareLabel, TOP_CONTRIBUTORS };
export { computeFirstCommit, SHORT_HASH };
export { computeCoAuthors, shownCoAuthors, TOP_CO_AUTHORS };
export { computeReleases, shownReleases };
export { computeBiggestCommit, shownBiggestLines, computeMessages, computePersonality, isMergeCommit, ARCHETYPES, localToday };
export { computeMonths, monthsFromDays };
export { COMMIT_SIZE_BUCKETS, COMMIT_SIZE_IDS, commitSizeOf, computeCommitSizes, shownCommitSizes, sizeShares };
export { COMMIT_TYPE_IDS, COMMIT_TYPES_MIN_SHARE, commitTypeOf, computeCommitTypes, foldCommitTypes, shownCommitTypes };
export { computeReverts, isRevertCommit, isRevertSubject, shownReverts };
export { computeEmoji, EMOJI_MIN_SHARE, emojiIn, emojiKey, GITMOJI, isEmoji, shownEmoji, TOP_EMOJI };
export { dayKeyFromEpoch, epochDay, hourLabel, localParts, mondayOf, WEEKDAY_NAMES } from './time.js';

/**
 * All stats for a list of commits. `today` ('YYYY-MM-DD') and `todayComplete` (a past
 * window's end day, see streaks.js) are passed to computeStreaks; `today` defaults to the
 * machine's local date (the only non-deterministic input).
 * `personality` is derived from the other parts (see personality.js); its fix share is
 * of non-merge commits, and its Steady Shipper span ignores future-dated days (after
 * `today` + 1, see daily.js daysUpTo). `daily` is commits per author-local day (see daily.js);
 * `busiestDay` is the single author-local day with the most commits as `{day: 'YYYY-MM-DD',
 * commits}` (ties → the earliest day), or null without commits: a copy of daily.busiest
 * (the recap and wrapped.md leave out future-dated days, see daily.js shownBusiestDay);
 * `fileLifecycle` is how many files the commits added and deleted, `{added, deleted}`
 * (renames are neither; ignored paths left out as for hot files, see files.js);
 * `languages` is lines / files per language (see languages.js). `biggestCommit` is the
 * non-merge commit with the most lines changed, ignored paths left out as for hot files
 * (see biggest.js), or null. `commitSizes` is how many non-merge commits are tiny (< 10
 * lines), small (10-99), medium (100-500) or large (> 500), counted like biggestCommit,
 * with whole-percent shares (see sizes.js). `commitTypes` is the conventional-commit mix
 * (feat / fix / docs / refactor / test / chore / other) of non-merge commits with a
 * subject, and whether it is shown (see types.js). `emoji` is how many of those commits
 * have an emoji (Unicode or a gitmoji `:shortcode:`) in the subject, and the top three
 * (see emoji.js). `reverts` is how many non-merge commits revert another (a `Revert "…"` or `revert: …`
 * subject or a "This reverts commit <hash>" line, see reverts.js), their share, and how
 * many distinct commits they name; the Fixaholic reason mentions them.
 * `firstCommit` is the earliest non-merge commit by author date (`{date, subject, hash}`,
 * plus `repo` in a multi-repo run; emails scrubbed from the subject, see first.js), or null.
 * `coAuthors` is how many non-merge commits have a Co-authored-by co-author other than
 * their author, and who those co-authors are, by name only (see coauthors.js).
 * `releases` is how many of the commits tags point at (one release per tagged commit) and
 * how many tags, with the first and latest release (`{name, date}`, see releases.js).
 * `months` is commits per author-local calendar month, zero-filled from the first to the
 * last active month, with the peak month (see months.js).
 * `contributors` ranks who made the commits (see contributors.js). It is computed from
 * `team` when given (the unfiltered history of an --author run, so "you" can be ranked
 * against everyone), else from `commits`; `author` (the --author email) picks "you";
 * `teamTruncated` says whether that read was capped (contributors.truncated).
 * `repos` (the labels of a multi-repo run, see mergeHistories in src/git.js): with two or
 * more, `stats.repos` is the per-repo breakdown (see repos.js), as the last key; with
 * fewer the key is absent, so single-repo stats are unchanged.
 * `previousYear` (a --year run: `{year, commits, truncated}` with the previous calendar
 * year's commits, read with the same filters): `stats.yearOverYear` compares the two
 * years (see yoy.js), as the last key; it is absent when there is nothing to compare
 * (no previousYear, or either year has no commits), so other runs are unchanged.
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today, todayComplete, team, author, teamTruncated = false, repos, previousYear } = {}) {
  const daily = computeDaily(commits);
  const stats = {
    totals: computeTotals(commits),
    habits: computeTimeHabits(commits),
    streaks: computeStreaks(commits, { today, todayComplete }),
    daily,
    busiestDay: daily.busiest ? { ...daily.busiest } : null,
    months: computeMonths(commits),
    hotFiles: computeHotFiles(commits),
    fileLifecycle: computeFileLifecycle(commits),
    languages: computeLanguages(commits),
    contributors: computeContributors(team ?? commits, { author, truncated: teamTruncated }),
    messages: computeMessages(commits),
    biggestCommit: computeBiggestCommit(commits),
    commitSizes: computeCommitSizes(commits),
    commitTypes: computeCommitTypes(commits),
    emoji: computeEmoji(commits),
    reverts: computeReverts(commits),
    firstCommit: computeFirstCommit(commits),
    coAuthors: computeCoAuthors(commits),
    releases: computeReleases(commits),
  };
  const nonMergeCommits = (commits ?? []).filter((c) => !isMergeCommit(c)).length;
  stats.personality = computePersonality(stats, { nonMergeCommits, today: today ?? localToday() });
  if (Array.isArray(repos) && repos.length > 1) stats.repos = computeRepos(commits, repos);
  if (previousYear) {
    const yoy = computeYearOverYear(stats.totals, previousYear);
    if (yoy) stats.yearOverYear = yoy;
  }
  return stats;
}
