// Stats engine: pure functions over readCommits() output. No git calls, no I/O.
import { computeBiggestCommit, shownBiggestLines } from './biggest.js';
import { computeBusFactor, computeContributors, contributorName, contributorShare, exactPercent, hasTeamCard, shareLabel, shownBusFactor, TOP_CONTRIBUTORS } from './contributors.js';
import { computeFirstCommit, SHORT_HASH } from './first.js';
import { computeCoAuthors, shownCoAuthors, TOP_CO_AUTHORS } from './coauthors.js';
import { computeReleases, shownReleases } from './releases.js';
import { computeMerges, pullRequestOf, shownMerges } from './merges.js';
import { busiestOf, computeDaily, daysUpTo, longestGap, longestRun, shownBusiestDay, shownLongest, shownLongestBreak } from './daily.js';
import { computeFileLifecycle, computeHotFiles, fileTouches, isIgnoredPath, repoRelativePath, shownFileLifecycle } from './files.js';
import { computeFolders, folderOf, ROOT_FOLDER, shownFolders, TOP_FOLDERS } from './folders.js';
import { computeTests, isTestPath, shownTests, TEST_DIRS } from './tests.js';
import { computeDocShare, DOC_DIRS, isDocPath, shownDocShare } from './docs.js';
import { CO_CHANGE_MAX_FILES, CO_CHANGE_MIN_COMMITS, computeCoChange, shownCoChange } from './cochange.js';
import { computeCleanups, shownCleanups } from './cleanups.js';
import { computeIssueRefs, issueRefLabel, issueRefsInSubject, shownIssueRefs } from './issues.js';
import { computeDepBumps, DEP_MANIFESTS, isDepPath, shownDepBumps } from './depbumps.js';
import { computeOneTouch, shownOneTouch } from './onetouch.js';
import { computeBiggestGrower, shownBiggestGrower } from './grower.js';
import { computeRewritten, isRewrittenCommit, REWRITE_GAP_MS, shownRewritten } from './rewritten.js';
import { computeTimeHabits } from './habits.js';
import { CADENCE_MIN_DAYS, computeCadence, medianGap, shownCadence } from './cadence.js';
import { computeSessions, SESSION_GAP_MINUTES, sessionsOf, shownSessions } from './sessions.js';
import { computeWeekend, shownWeekend, WEEKEND_DAYS, weekendCounts, weekendPercent, weekendPercentLabel } from './weekend.js';
import { computeLateNights, LATE_NIGHT_HOURS, lateNightCounts, NIGHT_ENDS, shownLateNights } from './latenights.js';
import { computeOfficeHours, OFFICE_DAYS, OFFICE_HOURS, shownOfficeHours } from './officehours.js';
import { computeTimezones, formatOffset, offsetMinutes, shownTimezones, utcLabel } from './timezones.js';
import { computeLanguages, languageBarRows, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER as OTHER_LANGUAGE, percentShares } from './languages.js';
import { computeMessages, hasMessageBody, isFixupSubject, isMergeCommit, shownBodies, shownFixups, shownSubjectLength, shownTopWords, subjectWords, SUBJECT_LIMIT, TOP_WORDS, TOP_WORDS_MIN } from './messages.js';
import { computeMonths, monthsFromDays } from './months.js';
import { ARCHETYPES, computePersonality } from './personality.js';
import { computeStreaks, localToday } from './streaks.js';
import { computeRepos } from './repos.js';
import { COMMIT_SIZE_BUCKETS, COMMIT_SIZE_IDS, commitSizeOf, computeCommitSizes, shownCommitSizes, sizeShares } from './sizes.js';
import { computeTotals } from './totals.js';
import { COMMIT_TYPE_IDS, COMMIT_TYPES_MIN_SHARE, commitTypeOf, computeCommitTypes, foldCommitTypes, shownCommitTypes } from './types.js';
import { computeYearOverYear, yearOverYear } from './yoy.js';
import { computePreviousPeriod, previousPeriod, previousWindow } from './period.js';
import { computeReverts, isRevertCommit, isRevertSubject, shownReverts } from './reverts.js';
import { computeEmoji, EMOJI_MIN_SHARE, emojiIn, emojiKey, GITMOJI, isEmoji, shownEmoji, TOP_EMOJI } from './emoji.js';

export { computeTotals, computeTimeHabits, computeStreaks, computeDaily, busiestOf, daysUpTo, longestGap, longestRun, shownBusiestDay, shownLongest, shownLongestBreak, computeFileLifecycle, shownFileLifecycle, computeHotFiles, fileTouches, isIgnoredPath, repoRelativePath, computeRepos, computeYearOverYear, yearOverYear, computePreviousPeriod, previousPeriod, previousWindow };
export { computeLanguages, languageBarRows, languageHeadline, languageOf, languageType, LANGUAGE_NAMES, OTHER_LANGUAGE, percentShares };
export { computeBusFactor, computeContributors, contributorName, contributorShare, exactPercent, hasTeamCard, shareLabel, shownBusFactor, TOP_CONTRIBUTORS };
export { computeFirstCommit, SHORT_HASH };
export { computeCoAuthors, shownCoAuthors, TOP_CO_AUTHORS };
export { computeFolders, folderOf, ROOT_FOLDER, shownFolders, TOP_FOLDERS };
export { computeTests, isTestPath, shownTests, TEST_DIRS };
export { computeDocShare, DOC_DIRS, isDocPath, shownDocShare };
export { CO_CHANGE_MAX_FILES, CO_CHANGE_MIN_COMMITS, computeCoChange, shownCoChange };
export { computeCleanups, shownCleanups };
export { computeIssueRefs, issueRefLabel, issueRefsInSubject, shownIssueRefs };
export { computeDepBumps, DEP_MANIFESTS, isDepPath, shownDepBumps };
export { computeOneTouch, shownOneTouch };
export { computeBiggestGrower, shownBiggestGrower };
export { computeRewritten, isRewrittenCommit, REWRITE_GAP_MS, shownRewritten };
export { CADENCE_MIN_DAYS, computeCadence, medianGap, shownCadence };
export { computeSessions, SESSION_GAP_MINUTES, sessionsOf, shownSessions };
export { computeWeekend, shownWeekend, WEEKEND_DAYS, weekendCounts, weekendPercent, weekendPercentLabel };
export { computeLateNights, LATE_NIGHT_HOURS, lateNightCounts, NIGHT_ENDS, shownLateNights };
export { computeOfficeHours, OFFICE_DAYS, OFFICE_HOURS, shownOfficeHours };
export { computeTimezones, formatOffset, offsetMinutes, shownTimezones, utcLabel };
export { computeReleases, shownReleases };
export { computeMerges, pullRequestOf, shownMerges };
export { computeBiggestCommit, shownBiggestLines, computeMessages, computePersonality, hasMessageBody, isFixupSubject, isMergeCommit, shownBodies, shownFixups, shownSubjectLength, shownTopWords, subjectWords, SUBJECT_LIMIT, TOP_WORDS, TOP_WORDS_MIN, ARCHETYPES, localToday };
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
 * `today` + 1, see daily.js daysUpTo). `timezones` is the commits' distinct author UTC
 * offsets, `{count, top: {offset, commits, share} | null, offsets: [{offset, commits}]}`,
 * every commit counted as for `habits` (see timezones.js). `weekend` is how many of
 * those commits landed on an author-local Saturday or Sunday and their share,
 * `{commits, share}` (from habits.byWeekday, as Weekend Warrior counts them, see
 * weekend.js). `lateNights` is how many of those commits landed between 00:00 and 04:59
 * author-local, their share, and the latest-ever commit time of day with the day ending at
 * 05:00 (commits dated after `today` + 1 left out of it), `{commits, share, latest: {date,
 * time} | null}` (see latenights.js). `officeHours` is how many of those commits landed on an
 * author-local Monday-Friday between 09:00 and 17:59 and their share, `{commits, share}`
 * (see officehours.js).
 * `cadence` is `{perActiveDay, medianGapDays}`: commits per active day (1
 * decimal) and the median calendar-day gap between consecutive active days (null with
 * fewer than two), over the same author-local days as totals.activeDays (see cadence.js).
 * `sessions` is the coding sessions, per author (as contributors are told apart) a run of
 * commits each at most two hours after the one before, `{count, medianMinutes, longest:
 * {minutes, commits, day}}` (a session lasts from its first commit to its last; every
 * commit counted as for `habits`; sessions starting after `today` + 1 left out of
 * `longest`), or null without a dated commit (see sessions.js).
 * `daily` is commits per author-local day (see daily.js);
 * `busiestDay` is the single author-local day with the most commits as `{day: 'YYYY-MM-DD',
 * commits}` (ties → the earliest day), or null without commits: a copy of daily.busiest
 * (the recap and wrapped.md leave out future-dated days, see daily.js shownBusiestDay);
 * `folders` is the most-changed top-level folders by lines changed, `[{path, lines, added,
 * deleted, commits}]` (top 5; files at a repo root are "(root)", multi-repo paths keep the
 * repo label; the same files as hot files, see folders.js);
 * `fileLifecycle` is how many files the commits added, deleted and renamed, `{added,
 * deleted, renamed}` (a rename is neither added nor deleted; ignored paths left out as
 * for hot files, see files.js);
 * `tests` is the lines changed in test files and their share of all lines changed,
 * `{lines, share}` (test/, tests/, __tests__/, spec/, specs/ directories; *.test.*, *.spec.*,
 * *_test.*, *_spec.*, *_tests.*, test_*.ext, conftest.py and FooTest.java-style files; the
 * same files as hot files), or null with no line changed (see tests.js);
 * `docShare` is the lines changed in documentation files and their share of all lines
 * changed, `{lines, share}` (docs/ and doc/ directories, case-sensitive; *.md, *.mdx,
 * *.rst and *.adoc files in any letter case; the same files as hot files; a file can count
 * as both a test and a doc), or null with no line changed (see docs.js);
 * `coChange` is the two files changed together in the most non-merge commits, `{files: [a,
 * b], commits}` (sorted paths, repo-labelled in a multi-repo run; the same files as hot
 * files; commits with more than 30 counted files left out), or null when no pair shares at
 * least 3 commits (see cochange.js);
 * `oneTouch` is how many distinct changed files exactly one non-merge commit touched and
 * their share of all changed files, `{files, share}` (the same files as hot files, counted
 * as hot files count commits; a rename is the old path plus the new one; repo-labelled
 * paths in a multi-repo run), or null without a changed file (see onetouch.js);
 * `biggestGrower` is the file with the largest net line growth (lines added − removed over
 * the non-merge commits), `{path, net, added, removed}` (the same files as hot files; ties
 * to the path that sorts first; repo-labelled in a multi-repo run), or null when no file
 * grew (see grower.js);
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
 * `cleanups` is how many non-merge commits removed more lines than they added (counted
 * like biggestCommit), their share of non-merge commits and the one with the largest net
 * deletion, `{commits, share, biggest: {hash, subject, date, linesAdded, linesRemoved,
 * net}}`, or null without a cleanup commit (see cleanups.js).
 * `issueRefs` is how many non-merge commits mention an issue in the subject (`#123`,
 * `GH-123` or a Jira-style `ABC-123`, not inside URLs or hashes), their share of non-merge
 * commits and the most referenced issue, `{commits, share, top: {ref, commits}}` (`top.repo`
 * too for a "#" ref in a multi-repo run), or null when none does (see issues.js).
 * `depBumps` is how many non-merge commits touched only lockfiles and dependency manifests
 * (package.json, go.mod, Cargo.toml, pyproject.toml, requirements*.txt, Gemfile,
 * composer.json, Pipfile, pubspec.yaml, mix.exs, Podfile, flake.nix, exact basenames; Go's
 * vendor/modules.txt by path; see isDepPath) and their share of non-merge commits, `{commits, share}`, or null without a
 * non-merge commit (see depbumps.js).
 * `rewritten` is how many non-merge commits have a committer date more than an hour after
 * their author date (rebased, amended or cherry-picked; instants compared, commits without
 * a committer date not counted) and their share of non-merge commits, `{commits, share}`,
 * or null without a non-merge commit (see rewritten.js).
 * `firstCommit` is the earliest non-merge commit by author date (`{date, subject, hash}`,
 * plus `repo` in a multi-repo run; emails scrubbed from the subject, see first.js), or null.
 * `coAuthors` is how many non-merge commits have a Co-authored-by co-author other than
 * their author, and who those co-authors are, by name only (see coauthors.js).
 * `releases` is how many of the commits tags point at (one release per tagged commit) and
 * how many tags, with the first and latest release (`{name, date}`, see releases.js).
 * `merges` is how many of the commits are merge commits (more than one parent), their
 * share of all commits, and how many distinct pull requests the subjects name
 * ("Merge pull request #N" or a trailing "(#N)", per repo with several), see merges.js.
 * `months` is commits per author-local calendar month, zero-filled from the first to the
 * last active month, with the peak month (see months.js).
 * `contributors` ranks who made the commits (see contributors.js). It is computed from
 * `team` when given (the unfiltered history of an --author run, so "you" can be ranked
 * against everyone), else from `commits`; `author` (the --author email) picks "you";
 * `teamTruncated` says whether that read was capped (contributors.truncated).
 * `contributors.busFactor` is the smallest number of authors who made at least half of the
 * lines changed in that same history, `{authors, share}` (the same files as hot files), or
 * null with fewer than two contributors or no line changed (see computeBusFactor).
 * `repos` (the labels of a multi-repo run, see mergeHistories in src/git.js): with two or
 * more, `stats.repos` is the per-repo breakdown (see repos.js), as the last key; with
 * fewer the key is absent, so single-repo stats are unchanged.
 * `previousYear` (a --year run: `{year, commits, truncated}` with the previous calendar
 * year's commits, read with the same filters): `stats.yearOverYear` compares the two
 * years (see yoy.js), as the last key; it is absent when there is nothing to compare
 * (no previousYear, or either year has no commits), so other runs are unchanged.
 * `previousPeriod` (a --since run without --year: `{since, until, commits, truncated}`
 * with the commits of the equal-length window just before [since, until], read with the
 * same filters): `stats.previousPeriod` compares the two windows (see period.js), as the
 * last key; absent when there is nothing to compare. A run never has both comparisons.
 * Later milestones add keys.
 */
export function computeStats(commits = [], { today, todayComplete, team, author, teamTruncated = false, repos, previousYear, previousPeriod: previousWindowCommits } = {}) {
  const daily = computeDaily(commits);
  const habits = computeTimeHabits(commits);
  const stats = {
    totals: computeTotals(commits),
    habits,
    timezones: computeTimezones(commits),
    weekend: computeWeekend(habits),
    lateNights: computeLateNights(commits, { today }),
    officeHours: computeOfficeHours(commits),
    streaks: computeStreaks(commits, { today, todayComplete }),
    cadence: computeCadence(daily.days),
    sessions: computeSessions(commits, { today }),
    daily,
    busiestDay: daily.busiest ? { ...daily.busiest } : null,
    months: computeMonths(commits),
    hotFiles: computeHotFiles(commits),
    folders: computeFolders(commits),
    fileLifecycle: computeFileLifecycle(commits),
    tests: computeTests(commits),
    docShare: computeDocShare(commits),
    coChange: computeCoChange(commits),
    oneTouch: computeOneTouch(commits),
    biggestGrower: computeBiggestGrower(commits),
    languages: computeLanguages(commits),
    contributors: computeContributors(team ?? commits, { author, truncated: teamTruncated }),
    messages: computeMessages(commits),
    biggestCommit: computeBiggestCommit(commits),
    commitSizes: computeCommitSizes(commits),
    commitTypes: computeCommitTypes(commits),
    emoji: computeEmoji(commits),
    reverts: computeReverts(commits),
    cleanups: computeCleanups(commits),
    issueRefs: computeIssueRefs(commits),
    depBumps: computeDepBumps(commits),
    rewritten: computeRewritten(commits),
    firstCommit: computeFirstCommit(commits),
    coAuthors: computeCoAuthors(commits),
    releases: computeReleases(commits),
    merges: computeMerges(commits),
  };
  const nonMergeCommits = (commits ?? []).filter((c) => !isMergeCommit(c)).length;
  stats.personality = computePersonality(stats, { nonMergeCommits, today: today ?? localToday() });
  if (Array.isArray(repos) && repos.length > 1) stats.repos = computeRepos(commits, repos);
  if (previousYear) {
    const yoy = computeYearOverYear(stats.totals, previousYear);
    if (yoy) stats.yearOverYear = yoy;
  } else if (previousWindowCommits) {
    const pop = computePreviousPeriod(stats.totals, previousWindowCommits);
    if (pop) stats.previousPeriod = pop;
  }
  return stats;
}
