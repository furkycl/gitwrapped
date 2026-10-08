// The console recap printed after a run: a short Wrapped-style summary plus where the
// output went. Pure string building; colors are raw ANSI escapes (no dependencies).

import { shownBusiestDay, shownLongest, shownLongestBreak } from './stats/daily.js';
import { languageHeadline } from './stats/languages.js';
import { contributorShare, exactPercent, hasTeamCard, shareLabel, shownBusFactor } from './stats/contributors.js';
import { shownCoAuthors } from './stats/coauthors.js';
import { shownReleases } from './stats/releases.js';
import { scrubEmails } from './privacy.js';
import { DEFAULT_LANG, getStrings, languageLabel } from './i18n/index.js';
import { yearOverYear } from './stats/yoy.js';
import { previousPeriod } from './stats/period.js';
import { epochDay } from './stats/time.js';
import { shownBiggestLines } from './stats/biggest.js';
import { shownCommitSizes } from './stats/sizes.js';
import { shownCommitTypes } from './stats/types.js';
import { busFactorShareText, cleanupShareText, conventionalText, emojiShareText, fixupShareText, folderLabel, issueRefsShareText, mergeShareText, revertShareText, sizeShareText, testsShareText } from './cards/index.js';
import { shownMerges } from './stats/merges.js';
import { shownFolders } from './stats/folders.js';
import { shownTests } from './stats/tests.js';
import { shownCoChange } from './stats/cochange.js';
import { shownEmoji } from './stats/emoji.js';
import { shownReverts } from './stats/reverts.js';
import { shownCleanups } from './stats/cleanups.js';
import { issueRefLabel, shownIssueRefs } from './stats/issues.js';
import { shownFixups } from './stats/messages.js';
import { shownFileLifecycle } from './stats/files.js';
import { shownTimezones, utcLabel } from './stats/timezones.js';
import { shownWeekend, weekendPercentLabel } from './stats/weekend.js';
import { shownLateNights } from './stats/latenights.js';
import { shownOfficeHours } from './stats/officehours.js';
import { shownCadence } from './stats/cadence.js';

const EN = getStrings(DEFAULT_LANG);

const ESC = '\x1b[';
const STYLES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  magenta: [35, 39],
  cyan: [36, 39],
};

/**
 * Whether to color output written to `stream`, following the usual conventions:
 * `--no-color` (flag false) always wins; FORCE_COLOR set to anything but "" / "0" /
 * "false" forces color (and "0" / "false" disables it); a non-empty NO_COLOR disables it;
 * otherwise color only when the stream is a TTY and TERM is not "dumb".
 */
export function shouldUseColor({ stream, env = process.env, flag } = {}) {
  if (flag === false) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== '') return !/^(0|false)$/i.test(force);
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream?.isTTY);
}

function painter(color) {
  const paint = (style, s) => {
    if (!color) return String(s);
    const [on, off] = STYLES[style];
    return `${ESC}${on}m${s}${ESC}${off}m`;
  };
  return paint;
}

// C0 and C1 control characters (incl. ESC, CSI, BEL, CR): a commit message, file name or
// repo name could otherwise inject terminal escape sequences into the recap. Also the
// bidi embedding / override / isolate controls (U+202A-202E, U+2066-2069), which can make
// text display in a different order than it is stored ("Trojan Source"), and the Unicode
// line / paragraph separators (U+2028, U+2029).
const CONTROL = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/** `s` as a string with every control character removed (safe to print). */
export function stripControl(s) {
  return String(s ?? '').replace(CONTROL, '');
}

/**
 * A line count with a sign, like the cards: 12 → "+12" / "−12". 0, anything that rounds
 * to 0, a negative count (never valid) or not a number → "0", so the recap never prints
 * "−0", "+-3" or "−-3".
 */
function signed(n, sign, L = EN) {
  const s = num(Number.isFinite(n) && n > 0 ? n : 0, L);
  return s === '0' ? s : `${sign}${s}`;
}

/**
 * 1234567 → "1,234,567" (Turkish: "1.234.567"); anything not a finite number → "0";
 * never "-0" (−0.4 → "0").
 */
function num(n, L = EN) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  return L.num(r === 0 ? 0 : r);
}

/** "1 commit", "2 commits" (`unit` is a key of the string table's `units`). */
function plural(n, unit, L = EN) {
  const [one, many] = L.units[unit];
  return `${num(n, L)} ${n === 1 ? one : many}`;
}

/** How many repos the recap lists one per line before "…and N more". */
const RECAP_REPOS = 5;
/** Folders on the recap's "Top folders" line. */
const RECAP_FOLDERS = 3;

/** Keep the end of a long path: "…/deep/dir/file.js". */
function shortPath(p, max = 48) {
  const s = stripControl(p);
  const chars = [...s];
  return chars.length <= max ? s : `…${chars.slice(chars.length - max + 1).join('')}`;
}

/** Keep the start of a long word: "supercalifragi…" (max code points, incl. the "…"). */
function shortWord(w, max = 32) {
  const s = stripControl(w);
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** East Asian Wide / Fullwidth blocks (CJK, Hangul, kana, fullwidth forms), by code point. */
const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd]];

/**
 * How many terminal columns `s` takes: per grapheme, 2 for an emoji (emoji presentation,
 * a VS16 / ZWJ sequence, or a keycap) or an East Asian wide character, 0 for one made only of
 * combining marks / format characters, else 1. An approximation of wcwidth, enough to
 * line up recap columns.
 */
export function displayWidth(s) {
  let w = 0;
  for (const { segment: g } of SEGMENTER.segment(String(s ?? ''))) {
    const cp = g.codePointAt(0);
    if (/^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u.test(g)) continue;
    if (/\p{Emoji_Presentation}/u.test(g) || (/\p{Extended_Pictographic}/u.test(g) && /[\uFE0F\u200D]/u.test(g)) || /\u20E3/u.test(g) || WIDE.some(([a, b]) => cp >= a && cp <= b)) w += 2;
    else w += 1;
  }
  return w;
}

/**
 * One line of free text (a commit subject) for the recap: control / bidi characters become
 * spaces, whitespace runs collapse, then it is cut at whole grapheme clusters (never inside
 * a ZWJ emoji, flag or combining sequence) to at most `maxWidth` terminal columns
 * (displayWidth), the "…" included. '' when nothing is left.
 */
function shortText(s, maxWidth = 48) {
  const t = String(s ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (displayWidth(t) <= maxWidth) return t;
  let out = '';
  let w = 0;
  for (const { segment: g } of SEGMENTER.segment(t)) {
    const gw = displayWidth(g);
    if (w + gw > maxWidth - 1) break;
    out += g;
    w += gw;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Format the end-of-run recap. `stats` is computeStats() output; options:
 * - color: emit ANSI colors (default false; with false the result has no ESC chars)
 * - repoName: shown in the heading
 * - window: the requested date window ("2025", "since Jan 3, 2025"), shown in the heading
 * - streakAtWindowEnd: the current streak is relative to a past window's end, so it is
 *   labeled "at window end" instead of "current"
 * - paths: {html, cardsDir, cardCount, pngDir, pngCount, sharePng, shareSvg, statsJson,
 *   markdown} (pngDir / sharePng null when PNGs were not written; statsJson only with
 *   --json, markdown only with --md)
 * - notes: extra notice lines (e.g. the commit cap), shown in yellow
 * - today: 'YYYY-MM-DD'; when given, the busiest day, longest streak and break leave out
 *   future-dated days (after today + 1), as on the cards (see stats/daily.js shownLongest)
 * - lang: an src/i18n code (default 'en'); labels, units, numbers, the power hour and the
 *   personality are written in that language (notes are passed in already translated)
 * A multi-repo run (stats.repos with two or more rows) gets a "Repos" line and one line
 * per repo (commits and lines; the first five, then "…and N more").
 * A --year run with a comparison (stats.yearOverYear) gets a "vs <previous year>" line
 * with the change in commits, lines changed and active days; a --since run with one
 * (stats.previousPeriod) a "vs prev. N days" line, the change since the N days before.
 * A "Top folders" line shows the three most-changed top-level folders by lines changed
 * ("src/ (1,234 lines) · test/ (567 lines) · (root) (89 lines)"; stats.folders, see
 * stats/folders.js shownFolders) when there are two or more.
 * A "Tests" line shows the lines changed in test files and their share of all lines
 * changed ("1,234 lines (23% of lines changed)"; stats.tests, see stats/tests.js
 * shownTests) when at least one test line changed.
 * A "Co-changed" line shows the two files changed together in the most non-merge
 * commits ("src/a.js + src/b.js (12 commits)"; stats.coChange, see stats/cochange.js
 * shownCoChange) when a pair shares at least 3 commits.
 * A "Files" line shows how many files were added and deleted, and renamed when any were
 * (stats.fileLifecycle, see stats/files.js shownFileLifecycle), when there is at least one.
 * A "Busiest day" line shows the calendar day with the most commits and its commit count
 * (stats.busiestDay, ties → the earliest day; future-dated days left out with `today`, see
 * stats/daily.js shownBusiestDay) when there is one.
 * A "Time zones" line shows how many UTC offsets the commits' author dates have and the
 * most common one with its share of commits ("3 time zones · mostly UTC+03:00 (62% of
 * commits)"; "mostly" left out on a tie, see stats/timezones.js shownTimezones) when there
 * are two or more.
 * A "Weekends" line shows how many commits landed on an author-local Saturday or Sunday
 * and their share ("12 commits (8% of commits)", the percent Weekend Warrior quotes, see
 * stats/weekend.js shownWeekend) when there is at least one.
 * A "Late nights" line shows how many commits landed between 00:00 and 04:59 author-local
 * and their share, then the latest-ever commit time ("12 commits (4% of commits) · latest
 * 4:12 AM on Mar 3, 2024", see stats/latenights.js shownLateNights) when there is at least
 * one.
 * A "Break" line shows the longest break between two active days (stats.streaks.longestBreak,
 * future-dated days left out with `today` as on the streak card) when there is one.
 * A "Cadence" line shows commits per active day and the median gap between active days
 * ("2.4 commits per active day · every 3 days", see stats/cadence.js shownCadence) with two
 * or more active days.
 * A "First commit" line shows the first commit in the window (stats.firstCommit: subject,
 * day, short hash and, with several repos, its repo) when there is one.
 * A "Biggest" line shows the biggest commit (stats.biggestCommit: subject, lines added /
 * removed and its day) when there is one.
 * A "Sizes" line shows the commit size mix (stats.commitSizes: the share of tiny / small /
 * medium / large commits, see stats/sizes.js shownCommitSizes) when there is one.
 * A "Types" line shows the conventional-commit mix (stats.commitTypes: every type with
 * commits and the share of commits that follow the convention, see stats/types.js
 * shownCommitTypes) when it is shown: at least 20% of the commits use the convention.
 * An "Emoji" line shows the share of commits with an emoji in the subject and the top
 * three emoji with their commit counts (stats.emoji, see stats/emoji.js shownEmoji) when
 * at least 5% of the commits have one.
 * A "Reverts" line shows how many non-merge commits revert another and their share
 * (stats.reverts, see stats/reverts.js shownReverts) when there is at least one.
 * A "Cleanups" line shows how many non-merge commits removed more lines than they added,
 * their share of non-merge commits, and the biggest net deletion with its subject, lines
 * and day ("12 commits (8% of non-merge commits) · biggest "drop the old parser" (−4,210
 * lines · Mar 3, 2026)"; stats.cleanups, see stats/cleanups.js shownCleanups) when there
 * is at least one.
 * A "Fixups" line shows how many non-merge commits have a `fixup!` / `squash!` / `amend!`
 * subject and their share of non-merge commits ("3 commits (2% of non-merge commits)";
 * stats.messages.fixups, see stats/messages.js shownFixups) when there is at least one.
 * An "Issue refs" line shows how many non-merge commits mention an issue in the subject,
 * their share of non-merge commits and the most referenced issue ("42 commits (12% of
 * non-merge commits) · top #128 (9 commits)"; stats.issueRefs, see stats/issues.js
 * shownIssueRefs) when there is at least one.
 * A "Team" line (top contributor, or the --author's rank) appears exactly when the
 * contributors card is built (see hasTeamCard in stats/contributors.js), followed by a
 * "Bus factor" line ("2 people (58% of lines changed)": the fewest authors who made at
 * least half of the lines changed, stats.contributors.busFactor, see shownBusFactor) when
 * there is one.
 * A "Paired" line shows how many commits had a Co-authored-by co-author, their share of
 * the non-merge commits and the top co-author's name (stats.coAuthors, see
 * stats/coauthors.js shownCoAuthors) when at least one commit was paired.
 * A "Releases" line shows how many tags point at the commits and the latest one, with its
 * day (stats.releases, see stats/releases.js shownReleases) when there is at least one.
 * A "Merges" line shows how many pull requests were merged and how many merge commits
 * there are, with their share of all commits (stats.merges, see stats/merges.js
 * shownMerges) when there is at least one of either.
 * The first line is always `gitwrapped: N commits → <html>` (no color), so it is easy
 * to grep. Every text value is stripped of control characters (stripControl), so repo
 * data cannot inject terminal escapes. Returns the whole recap, newline-terminated.
 */
export function formatSummary(stats, { color = false, repoName, window, streakAtWindowEnd = false, paths = {}, notes = [], today, lang } = {}) {
  const L = getStrings(lang);
  const R = L.recap;
  const c = painter(color);
  const t = stats?.totals ?? {};
  const commits = Number.isFinite(t.commits) ? t.commits : 0;
  const lines = [];
  const sc = stripControl;
  lines.push(`gitwrapped: ${plural(commits, 'commit', L)} → ${sc(paths.html)}`.trimEnd());

  for (const note of notes) lines.push(c('yellow', `  ${sc(note)}`));

  // --since: the "vs prev. N days" line (stats.previousPeriod) can be wider than the label
  // column; then the whole column widens so the values still line up (only then: runs
  // without the comparison keep R.labelWidth).
  const pop = commits > 0 && !yearOverYear(stats) ? previousPeriod(stats) : null;
  const popLabel = pop ? R.vsPeriod(pop.days) : null;
  const labelWidth = popLabel ? Math.max(R.labelWidth, displayWidth(popLabel) + 1) : R.labelWidth;
  const label = (s) => c('dim', s.padEnd(labelWidth));
  if (commits === 0) {
    lines.push(c('yellow', `  ${R.noCommits}`));
  } else {
    const name = repoName ? `${sc(repoName)} ` : '';
    const win = window ? c('dim', ` · ${sc(window)}`) : '';
    lines.push(`  ${c('bold', c('magenta', `★ ${name}Wrapped`))}${win}`);
    const lineStats = `${c('green', signed(t.linesAdded, '+', L))} / ${c('red', signed(t.linesRemoved, '−', L))} ${R.lines}`;
    lines.push(`  ${c('bold', plural(commits, 'commit', L))} · ${plural(t.activeDays ?? 0, 'activeDay', L)} · ${lineStats}`);

    // A multi-repo run: commits and lines per repo, most commits first (stats.repos).
    const repos = (Array.isArray(stats?.repos) ? stats.repos : []).filter((r) => r?.name);
    if (repos.length > 1) {
      lines.push(`  ${label(R.repos)}${plural(repos.length, 'repo', L)}`);
      const shown = repos.length <= RECAP_REPOS + 1 ? repos : repos.slice(0, RECAP_REPOS);
      // Padded by terminal columns, so emoji / CJK labels line up too.
      const width = Math.max(...shown.map((r) => displayWidth(shortWord(r.name, 24))));
      for (const r of shown) {
        const name = shortWord(r.name, 24);
        const pad = ' '.repeat(Math.max(0, width - displayWidth(name)));
        lines.push(`    ${c('cyan', name)}${pad}  ${plural(r.commits ?? 0, 'commit', L)} ${c('dim', `· ${signed(r.linesAdded, '+', L)} / ${signed(r.linesRemoved, '−', L)} ${R.lines}`)}`);
      }
      if (shown.length < repos.length) lines.push(`    ${c('dim', R.moreRepos(repos.length - shown.length))}`);
    }

    // --year: the change since the previous year (stats.yearOverYear), as on the cards.
    const yoy = yearOverYear(stats);
    if (yoy) lines.push(`  ${label(R.vsYear(yoy.previousYear))}${c('cyan', L.yoy.changes(yoy.commits, yoy.lines, yoy.activeDays))}`);
    // --since: the change since the equal-length window before it (stats.previousPeriod).
    if (pop) lines.push(`  ${label(popLabel)}${c('cyan', L.yoy.changes(pop.commits, pop.lines, pop.activeDays))}`);

    const h = stats?.habits ?? {};
    if (h.peakHourLabel) {
      const tied = h.peakHourTied ? R.tied : '';
      // English keeps stats' own label ("2 AM"); other languages say the hour their way.
      const hour = L !== EN && Number.isInteger(h.peakHour) && h.peakHour >= 0 && h.peakHour < 24 ? L.hourLabel(h.peakHour) : sc(h.peakHourLabel);
      lines.push(`  ${label(R.powerHour)}${c('cyan', hour)} ${c('dim', `(${plural(h.peakHourCount, 'commit', L)}${tied})`)}`);
    }

    // The calendar day with the most commits over the whole window (future-dated days left
    // out with `today`); only when there is one. On a history longer than the activity
    // card's 53-week grid, the card's busiest day is that of the grid, so it can differ.
    const busiest = shownBusiestDay(stats, today);
    if (busiest) {
      const [y, mo, d] = busiest.day.split('-').map(Number);
      lines.push(`  ${label(R.busiestDay)}${c('cyan', L.date(d, mo, y))} ${c('dim', `(${plural(busiest.commits, 'commit', L)})`)}`);
    }

    // Commits from two or more time zones (UTC offsets, stats.timezones): how many, and
    // the most common one with its share (left out when two offsets tie for it).
    const tz = shownTimezones(stats?.timezones);
    if (tz) {
      const top = tz.top ? ` ${c('dim', `· ${R.mostly(utcLabel(tz.top))} (${R.ofCommits(shareLabel(exactPercent(tz), tz.commits, L.pct))})`)}` : '';
      lines.push(`  ${label(R.timezones)}${c('cyan', R.timezonesValue(tz.count))}${top}`);
    }

    // Commits on an author-local Saturday or Sunday (stats.weekend), the same count and
    // percent as Weekend Warrior's reason; only when there is at least one.
    const weekend = shownWeekend(stats);
    if (weekend) {
      lines.push(`  ${label(R.weekend)}${c('cyan', plural(weekend.commits, 'commit', L))} ${c('dim', `(${R.ofCommits(weekendPercentLabel(weekend.percent, L.pct))})`)}`);
    }

    // Commits between 00:00 and 04:59 author-local (stats.lateNights; counts from habits as
    // Night Owl's) and the latest-ever commit time; only when there is at least one.
    const late = shownLateNights(stats);
    if (late) {
      const [y, mo, d] = late.latest ? late.latest.date.split('-').map(Number) : [];
      const latest = late.latest ? ` · ${R.latestAt(L.clock(late.latest.hour, late.latest.minute), L.date(d, mo, y))}` : '';
      lines.push(`  ${label(R.lateNights)}${c('cyan', plural(late.commits, 'commit', L))} ${c('dim', `(${R.ofCommits(weekendPercentLabel(late.percent, L.pct))})${latest}`)}`);
    }

    // Commits on an author-local weekday between 09:00 and 17:59 (stats.officeHours), of
    // the same dated commits as the weekend line; only when there is at least one.
    const office = shownOfficeHours(stats);
    if (office) {
      lines.push(`  ${label(R.officeHours)}${c('cyan', plural(office.commits, 'commit', L))} ${c('dim', `(${R.ofCommits(weekendPercentLabel(office.percent, L.pct))})`)}`);
    }

    const s = stats?.streaks ?? {};
    // Like the cards: with `today`, future-dated days do not make the longest streak.
    const longest = shownLongest(stats, today)?.length ?? 0;
    if (longest > 0) {
      const current = s.current?.length ?? 0;
      const cur = current > 0 ? ` · ${streakAtWindowEnd ? R.atWindowEnd : R.current} ${plural(current, 'day', L)}` : '';
      lines.push(`  ${label(R.streak)}${R.longest} ${c('cyan', plural(longest, 'day', L))}${cur}`);
    }

    // The longest break between two active days, as on the streak card (future-dated days
    // left out with `today`); only when there is one.
    const pause = shownLongestBreak(stats, today);
    if (Number.isInteger(pause?.days) && pause.days > 0) {
      const day = (k) => (typeof k === 'string' && epochDay(k) !== null ? L.date(...k.split('-').map(Number).reverse()) : null);
      const from = day(pause.from);
      const to = day(pause.to);
      const when = from && to ? ` ${c('dim', `(${from} – ${to})`)}` : '';
      lines.push(`  ${label(R.breakLabel)}${R.longest} ${c('cyan', plural(pause.days, 'day', L))}${when}`);
    }

    // Commits per active day and the median gap between active days (stats.cadence, with
    // `today` future-dated days left out, as on the streak card); two or more active days.
    const cadence = shownCadence(stats, today);
    if (cadence) {
      lines.push(`  ${label(R.cadence)}${c('cyan', L.streak.cadencePerDay(cadence.perActiveDay))} ${c('dim', '·')} ${c('cyan', L.streak.cadenceEvery(cadence.medianGapDays))}`);
    }

    const hot = stats?.hotFiles?.[0];
    if (typeof hot?.path === 'string' && hot.path) {
      lines.push(`  ${label(R.hottestFile)}${c('cyan', shortPath(scrubEmails(hot.path)))} ${c('dim', `(${plural(hot.commits, 'commit', L)})`)}`);
    }

    // The most-changed top-level folders by lines changed (stats.folders): the first three,
    // only when there are two or more.
    const folders = shownFolders(stats?.folders);
    if (folders) {
      const list = folders.slice(0, RECAP_FOLDERS).map((f) => `${c('cyan', shortPath(folderLabel(f, L), 32))} ${c('dim', `(${R.folderLines(f.lines)})`)}`);
      lines.push(`  ${label(R.topFolders)}${list.join(c('dim', ' · '))}`);
    }

    // Lines changed in test files and their share of all lines changed (stats.tests), as
    // on the hot-files / languages card; only when a test line changed.
    const tests = shownTests(stats?.tests);
    if (tests) lines.push(`  ${label(R.tests)}${c('cyan', plural(tests.lines, 'line', L))} ${c('dim', `(${R.ofLinesChanged(testsShareText(tests, L))})`)}`);

    // The two files changed together in the most non-merge commits (stats.coChange), as on
    // the hot-files card but with their paths; only when a pair shares 3+ commits.
    const pair = shownCoChange(stats?.coChange);
    // Left out when the two paths would read alike (scrubbed or shortened to the same text).
    const shown = pair ? pair.files.map((p) => shortPath(p, 40)) : [];
    if (pair && shown[0] !== shown[1]) {
      const [a, b] = shown.map((p) => c('cyan', p));
      lines.push(`  ${label(R.coChange)}${a} ${c('dim', '+')} ${b} ${c('dim', `(${plural(pair.commits, 'commit', L)})`)}`);
    }

    // Files added, deleted and renamed in the window (stats.fileLifecycle); only when there are any.
    const lifecycle = shownFileLifecycle(stats?.fileLifecycle);
    if (lifecycle) lines.push(`  ${label(R.fileLifecycle)}${c('cyan', R.fileLifecycleValue(lifecycle.added, lifecycle.deleted, lifecycle.renamed))}`);

    const topLang = languageHeadline(stats?.languages);
    if (topLang) {
      const share = topLang.share > 0 ? L.pct(topLang.share) : `<${L.pct(1)}`;
      lines.push(`  ${label(R.topLanguage)}${c('cyan', shortWord(languageLabel(topLang.name, L)))} ${c('dim', `(${R.languageDetail(share, topLang.basis, topLang.tied.length - 1)})`)}`);
    }

    // Exactly when the contributors card is built (see hasTeamCard).
    const team = stats?.contributors ?? {};
    if (hasTeamCard(stats)) {
      const you = team.you;
      const lead = team.top?.[0];
      let detail = '';
      if (you?.rank > 0) detail = ` · ${R.youAre} ${c('cyan', `#${num(you.rank, L)}`)} ${c('dim', `(${R.ofCommits(shareLabel(contributorShare(you), you.commits, L.pct))})`)}`;
      else if (lead?.name) {
        const tied = team.top[1]?.commits === lead.commits ? R.tied : '';
        detail = ` · ${R.top} ${c('cyan', shortWord(lead.name))} ${c('dim', `(${shareLabel(contributorShare(lead), lead.commits, L.pct)}${tied})`)}`;
      }
      lines.push(`  ${label(R.team)}${plural(team.total, 'contributor', L)}${detail}`);
      // The smallest number of authors who made half the lines changed (contributors.busFactor).
      const bus = shownBusFactor(team.busFactor);
      if (bus) lines.push(`  ${label(R.busFactor)}${c('cyan', R.busFactorValue(bus.authors))} ${c('dim', `(${R.ofLinesChanged(busFactorShareText(bus, L))})`)}`);
    }

    // Commits with a Co-authored-by co-author (stats.coAuthors), as on the team / totals card.
    const paired = shownCoAuthors(stats?.coAuthors);
    if (paired) {
      const top = paired.top ? shortWord(scrubEmails(paired.top)) : '';
      const who = top ? ` · ${R.topCoAuthor} ${c('cyan', top)}` : '';
      lines.push(`  ${label(R.paired)}${plural(paired.paired, 'commit', L)} ${c('dim', `(${R.ofNonMerge(shareLabel(exactPercent(paired), paired.paired, L.pct))})`)}${who}`);
    }

    const m = stats?.messages ?? {};
    const words = [];
    // Same rule as the messages card: a "top" word has to show up at least twice.
    if (m.topWord?.word && m.topWord.count >= 2) {
      words.push(`"${shortWord(m.topWord.word)}" ${c('dim', `×${num(m.topWord.count, L)}`)}`);
    }
    const fixes = m.counts?.fix ?? 0;
    if (fixes > 0) words.push(`${plural(fixes, 'fix', L)}`);
    if (words.length > 0) lines.push(`  ${label(R.topWord)}${words.join(' · ')}`);

    // The first commit in the window (stats.firstCommit), as on the intro card.
    const first = stats?.firstCommit;
    if (first && typeof first === 'object') {
      const short = typeof first.subject === 'string' ? shortText(scrubEmails(first.subject), 48) : '';
      const subject = short ? `"${short}"` : L.messages.noSubject;
      // A valid 'YYYY-MM-DD' only (epochDay rejects other shapes and impossible dates).
      const day = typeof first.date === 'string' && epochDay(first.date) !== null ? first.date.split('-').map(Number) : null;
      const detail = [day ? L.date(day[2], day[1], day[0]) : '', shortText(scrubEmails(first.hash ?? ''), 12), shortText(first.repo, 24)].filter(Boolean).join(' · ');
      lines.push(`  ${label(R.firstCommit)}${c('cyan', subject)}${detail ? ` ${c('dim', `(${detail})`)}` : ''}`);
    }

    // Tags on the commits (stats.releases), as on the outro card.
    const rel = shownReleases(stats?.releases);
    if (rel) {
      const name = rel.latest ? shortText(rel.latest.name, 40) : '';
      const day = rel.latest && typeof rel.latest.date === 'string' && epochDay(rel.latest.date) !== null ? rel.latest.date.split('-').map(Number) : null;
      const when = day ? ` ${c('dim', `(${L.date(day[2], day[1], day[0])})`)}` : '';
      lines.push(`  ${label(R.releases)}${plural(rel.count, 'release', L)}${name ? ` · ${R.latest} ${c('cyan', name)}${when}` : ''}`);
    }

    // Merged pull requests and merge commits (stats.merges), as on the totals card.
    const merges = shownMerges(stats?.merges);
    if (merges) lines.push(`  ${label(R.merges)}${c('cyan', R.mergesValue(merges.pullRequests, merges.commits, mergeShareText(merges, L)))}`);

    // The biggest commit by lines changed (stats.biggestCommit), as on the messages card.
    const big = stats?.biggestCommit;
    const bigLines = shownBiggestLines(big);
    if (bigLines) {
      const short = typeof big.subject === 'string' ? shortText(scrubEmails(big.subject), 48) : '';
      const subject = short ? `"${short}"` : L.messages.noSubject;
      // A valid 'YYYY-MM-DD' only (epochDay rejects other shapes and impossible dates).
      const day = typeof big.date === 'string' && epochDay(big.date) !== null ? big.date.split('-').map(Number) : null;
      const when = day ? ` · ${L.date(day[2], day[1], day[0])}` : '';
      lines.push(`  ${label(R.biggest)}${c('cyan', subject)} ${c('dim', `(${signed(bigLines.added, '+', L)} / ${signed(bigLines.removed, '−', L)} ${R.lines}${when})`)}`);
    }

    // The commit size mix (stats.commitSizes), as on the totals card; only when there is one.
    const mix = shownCommitSizes(stats?.commitSizes);
    if (mix) lines.push(`  ${label(R.sizes)}${mix.map((b) => `${c('cyan', sizeShareText(b, mix, L))} ${R.sizeNames[b.id]}`).join(c('dim', ' · '))}`);

    // The conventional-commit mix (stats.commitTypes), as on the messages card; only when shown.
    const types = shownCommitTypes(stats?.commitTypes);
    if (types) {
      const names = L.messages.typeNames;
      const list = types.rows.map((r) => `${c('cyan', sizeShareText(r, types.rows, L))} ${names[r.id]}`).join(c('dim', ' · '));
      lines.push(`  ${label(R.types)}${list} ${c('dim', `(${R.conventional(conventionalText(types, L))})`)}`);
    }

    // Emoji in the subjects (stats.emoji), as on the messages card; only when shown.
    const emoji = shownEmoji(stats?.emoji);
    if (emoji) {
      const top = emoji.top.map((t) => `${t.emoji} ${c('cyan', L.num(t.count))}`).join(c('dim', ' · '));
      lines.push(`  ${label(R.emoji)}${L.messages.emojiShare(c('cyan', emojiShareText(emoji, L)))}${top ? ` ${c('dim', '·')} ${top}` : ''}`);
    }

    // Commits that revert another (stats.reverts), as on the messages card; only with any.
    const reverts = shownReverts(stats?.reverts);
    if (reverts) lines.push(`  ${label(R.reverts)}${plural(reverts.count, 'commit', L)} ${c('dim', `(${R.ofNonMerge(revertShareText(reverts, L))})`)}`);

    // Autosquash commits that reached the history (stats.messages.fixups), as on the
    // messages card; only with any.
    const fixups = shownFixups(stats?.messages?.fixups);
    if (fixups) lines.push(`  ${label(R.fixups)}${plural(fixups.commits, 'commit', L)} ${c('dim', `(${R.ofNonMerge(fixupShareText(fixups, L))})`)}`);

    // Commits that removed more lines than they added (stats.cleanups), as on the totals
    // card, with the biggest net deletion's subject, lines and day; only with any.
    const cleanups = shownCleanups(stats?.cleanups);
    if (cleanups) {
      const b = cleanups.biggest;
      let biggest = '';
      if (b) {
        const short = b.subject ? shortText(scrubEmails(b.subject), 40) : '';
        const subject = short ? `"${short}"` : L.messages.noSubject;
        // A valid 'YYYY-MM-DD' only (epochDay rejects other shapes and impossible dates).
        const day = typeof b.date === 'string' && epochDay(b.date) !== null ? b.date.split('-').map(Number) : null;
        const when = day ? ` · ${L.date(day[2], day[1], day[0])}` : '';
        biggest = ` ${c('dim', '·')} ${R.biggestCleanup} ${c('cyan', subject)} ${c('dim', `(${signed(b.net, '−', L)} ${R.lines}${when})`)}`;
      }
      lines.push(`  ${label(R.cleanups)}${plural(cleanups.commits, 'commit', L)} ${c('dim', `(${R.ofNonMerge(cleanupShareText(cleanups, L))})`)}${biggest}`);
    }

    // Commits that mention an issue (stats.issueRefs), as on the messages card, with the
    // most referenced one; only with any.
    const issues = shownIssueRefs(stats?.issueRefs);
    if (issues) {
      const t = issues.top;
      const top = t ? ` ${c('dim', '·')} ${R.topIssue(c('cyan', shortText(issueRefLabel(t), 40)), plural(t.commits, 'commit', L))}` : '';
      lines.push(`  ${label(R.issueRefs)}${plural(issues.commits, 'commit', L)} ${c('dim', `(${R.ofNonMerge(issueRefsShareText(issues, L))})`)}${top}`);
    }

    const a = stats?.personality?.archetype;
    if (a?.name) {
      // Other languages name the archetype by id from the string table (as the cards do).
      const local = L !== EN && typeof a.id === 'string' && Object.hasOwn(L.personality.archetypes, a.id) ? L.personality.archetypes[a.id] : null;
      const name = local ? local.name : sc(a.name);
      const roast = local ? local.roast : a.roast ? sc(a.roast) : '';
      lines.push(`  ${label(R.you)}${c('bold', c('magenta', name))}${roast ? c('dim', ` — ${roast}`) : ''}`);
    }
  }

  const out = [];
  if (paths.cardsDir) out.push(`  ${R.cardsIn(plural(paths.cardCount ?? 0, 'card', L), sc(paths.cardsDir))}`);
  if (paths.pngDir) out.push(`  ${R.cardsIn(plural(paths.pngCount ?? 0, 'png', L), sc(paths.pngDir))}`);
  const share = paths.sharePng ?? paths.shareSvg;
  if (share) out.push(`  ${R.shareImage} ${sc(share)}`);
  if (paths.statsJson) out.push(`  ${R.statsJson} ${sc(paths.statsJson)}`);
  if (paths.markdown) out.push(`  ${R.markdown} ${sc(paths.markdown)}`);
  if (out.length > 0) lines.push(c('dim', '  ─'.padEnd(20, '─')), ...out);

  return `${lines.join('\n')}\n`;
}
