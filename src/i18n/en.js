// English string table (the default). Every user-visible string of the cards, the share
// image, the HTML viewer and the terminal recap. tr.js has exactly the same keys and
// function signatures (test/i18n.test.js checks it). Functions take raw numbers / plain
// strings and do their own formatting; `units` are [singular, plural] word pairs.
import { formatDelta, formatInteger } from './format.js';

const num = (n) => formatInteger(n, ',');
const dec = (n) => (Math.round((typeof n === 'number' && Number.isFinite(n) ? n : 0) * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const plural = (n, [one, many]) => `${num(n)} ${n === 1 ? one : many}`;
/** A length with at most one decimal and its unit: "1 character", "48.5 characters". */
const decPlural = (n, [one, many]) => `${dec(n)} ${n === 1 ? one : many}`;
const delta = (n) => formatDelta(n, ',');
/** A signed change with its unit: "+42 commits", "−1 line", "±0 active days". */
const signedPlural = (n, [one, many]) => `${delta(n)} ${Math.abs(Math.round(n)) === 1 ? one : many}`;
/** The same, kept on one line on the cards (no-break spaces). */
const signedPluralNb = (n, unit) => signedPlural(n, unit).replace(/ /g, '\u00a0');
const yoyChanges = (commits, lines, days) => `${signedPlural(commits, UNITS.commit)}, ${signedPlural(lines, UNITS.line)}, ${signedPlural(days, UNITS.activeDay)}`;

const UNITS = {
  commit: ['commit', 'commits'],
  day: ['day', 'days'],
  file: ['file', 'files'],
  line: ['line', 'lines'],
  language: ['language', 'languages'],
  contributor: ['contributor', 'contributors'],
  time: ['time', 'times'],
  activeDay: ['active day', 'active days'],
  card: ['card', 'cards'],
  png: ['PNG', 'PNGs'],
  fix: ['fix', 'fixes'],
  repo: ['repo', 'repos'],
  release: ['release', 'releases'],
  person: ['person', 'people'],
};

/**
 * "12 pull requests merged" and "8 merge commits (6% of commits)", the parts there are
 * (a count of 0 is left out), joined with `sep`; `share` is already formatted.
 */
const mergesText = (prs, merges, share, sep) => [
  prs > 0 ? `${plural(prs, ['pull request', 'pull requests'])} merged` : '',
  merges > 0 ? `${plural(merges, ['merge commit', 'merge commits'])} (${share} of commits)` : '',
].filter(Boolean).join(sep);

/** Whole minutes as a short length: "0 min", "45 min", "3h", "3h 10m" (hours with separators). */
const sessionLength = (minutes) => {
  const m = Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 0;
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} min`;
  return m % 60 === 0 ? `${num(h)}h` : `${num(h)}h ${m % 60}m`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default {
  code: 'en',
  name: 'English',

  // --- formatting ----------------------------------------------------------------------
  /** Integer with thousands separators: 12345 → "12,345". */
  num,
  /** An average with at most one decimal: 1234.5 → "1,234.5". */
  dec,
  /** A signed change: 42 → "+42", -3 → "−3", 0 → "±0". */
  delta,
  /** A whole percent: 74 → "74%". */
  pct: (r) => `${r}%`,
  /** Upper-casing for eyebrows, captions and tile labels. */
  upper: (s) => String(s).toUpperCase(),
  /** compactNumber() parts: thousands separator, decimal point, K/M/B/T suffixes. */
  compact: { sep: ',', point: '.', suffixes: ['K', 'M', 'B', 'T'] },
  units: UNITS,
  months: MONTHS,
  /** Full month names, January first. */
  monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  /** Sunday first. */
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  /** One letter per weekday, Sunday first (the weekday bar chart). */
  weekLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  /** One letter per weekday, Monday first (the calendar header). */
  calendarWeekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  /** 0-23 → "12 AM" … "11 PM". */
  hourLabel: (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`,
  /** A clock time, hour 0-23 and minute 0-59 → "4:12 AM", "12:05 AM" (the late-nights line). */
  clock: (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`,
  /** Tick labels under the commits-by-hour chart. */
  hourTicks: { 0: '12a', 6: '6a', 12: '12p', 18: '6p', 23: '11p' },
  /** "Oct 4, 2026" (`year` as given). */
  date: (day, month, year) => `${MONTHS[month - 1]} ${day}, ${year}`,
  /** "Oct 4" (no year: the power-hour card's "Latest night" row when the full date is too long). */
  dayMonth: (day, month) => `${MONTHS[month - 1]} ${day}`,
  /** "Oct 4 – Oct 5, 2026". */
  sameYearRange: (d1, m1, d2, m2, year) => `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${year}`,
  /** A window with only a start: "since Jan 3, 2025". */
  since: (date) => `since ${date}`,
  /** A window with only an end: "until Mar 9, 2025". */
  until: (date) => `until ${date}`,
  /** "A and B", "A, B and C". */
  andList: (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`),

  // --- story cards ---------------------------------------------------------------------
  empty: 'No commits yet — go ship something!',
  yourRepo: 'your repo',
  calendarOf: (days) => `Commit calendar of ${plural(days, UNITS.activeDay)}`,

  /** A multi-repo run (`gitwrapped repoA repoB ...`). */
  repos: {
    /** What the cards call the repos together: "3 repos". */
    name: (n) => plural(n, UNITS.repo),
    /** The intro's line naming them; `list` is already joined ("api, web and 2 more"). */
    featuring: (list) => `Featuring ${list}.`,
    /** The last item of that list when not every repo is named. */
    andMore: (n) => `${num(n)} more`,
    /** The label of the bar folding the remaining repos together. */
    moreBar: (n) => `+${num(n)} more`,
    commitsByRepo: 'Commits by repo',
    commitsBarTitle: (name, commits, added, removed) => `${name}: ${plural(commits, UNITS.commit)}, ${added} / ${removed} lines`,
    filesByRepo: 'Files touched by repo',
    filesBarTitle: (name, files) => `${name}: ${plural(files, UNITS.file)} touched`,
  },

  intro: {
    eyebrow: 'gitwrapped presents',
    title: 'Wrapped',
    lead: "Your commits, your chaos, your story. Let's see what you've been up to.",
    starring: (who) => `Starring ${who}.`,
    yearTitle: (year) => `Your ${year} in git`,
    soFar: 'Your story so far',
    toUnwrap: (commits) => `${plural(commits, UNITS.commit)} to unwrap`,
    quietYear: 'A quiet year',
    noCommitsIn: (year) => `no commits in ${year}`,
    chapterOne: 'Chapter one',
    firstCommit: 'starts with your first commit',
    /** The first commit in the window (stats.firstCommit): caption above its quoted subject. */
    beganTitle: 'It all began with',
  },

  totals: {
    eyebrow: 'The grand total',
    activeDays: 'Active days',
    filesTouched: 'Files touched',
    contributors: 'Contributors',
    perDay: (value) => `That's ${value >= 100 ? num(value) : value} ${value === 1 ? 'commit' : 'commits'} per active day.`,
    everyOne: 'Every one of them counts.',
    linesChanged: 'Lines changed',
    linesAdded: 'Lines added',
    linesRemoved: 'Lines removed',
    /** The commit size mix (stats.commitSizes): caption, bucket names, hover text per bucket. */
    commitSizes: 'Commit sizes',
    sizes: { tiny: 'Tiny', small: 'Small', medium: 'Medium', large: 'Large' },
    sizeRanges: { tiny: 'under 10 lines', small: '10–99 lines', medium: '100–500 lines', large: 'over 500 lines' },
    sizeTitle: (name, range, commits, pct) => `${name} (${range}): ${plural(commits, UNITS.commit)} (${pct})`,
    /**
     * Files added / deleted in the window (stats.fileLifecycle), as one row: "12 / 3"; with
     * renames (when the row fits), "Born / buried / renamed" and "12 / 3 / 4".
     */
    fileLifecycle: 'Born / buried',
    fileLifecycleRenamed: 'Born / buried / renamed',
    fileLifecycleValue: (added, deleted, renamed = 0) => `${num(added)} / ${num(deleted)}${renamed > 0 ? ` / ${num(renamed)}` : ''}`,
    /**
     * The merges row (stats.merges): with both, "Merged PRs / merges" and "12 / 8"; only
     * pull requests (a squash-merge repo), "Merged PRs" and "12"; only merge commits,
     * "Merge commits" and "8 · 6%" (`share` already formatted).
     */
    mergesLabel: (prs, merges) => (prs > 0 ? (merges > 0 ? 'Merged PRs / merges' : 'Merged PRs') : 'Merge commits'),
    mergesValue: (prs, merges, share) => (prs > 0 ? (merges > 0 ? `${num(prs)} / ${num(merges)}` : num(prs)) : `${num(merges)} · ${share}`),
    /**
     * The cleanup rows (stats.cleanups), in spare room only, after the other rows:
     * "Cleanups" and "12 commits · 8%" (or "12 · 8%" when that would be cut), then
     * "Biggest cleanup" and "−4,210 lines · Mar 3, 2026" (else "−4,210 lines · Mar 3",
     * "−4,210 · Mar 3" or "−4,210 lines", the first one drawn whole).
     * `lines` / `pct` / `day` / `subject` come already formatted (subject quoted, or null).
     */
    cleanups: 'Cleanups',
    cleanupsValue: (commits, pct) => `${plural(commits, UNITS.commit)} · ${pct}`,
    cleanupsShort: (commits, pct) => `${num(commits)} · ${pct}`,
    cleanupsDescription: (commits, pct) => `${plural(commits, UNITS.commit)} removed more lines than they added (${pct} of non-merge commits)`,
    biggestCleanup: 'Biggest cleanup',
    cleanupLines: (minus) => `${minus} lines`,
    cleanupLinesOn: (lines, day) => `${lines} · ${day}`,
    biggestCleanupDescription: (lines, day, subject) => `Biggest cleanup: ${lines}${day ? ` on ${day}` : ''}${subject ? `, ${subject}` : ''}`,
    /**
     * The dependency-bumps row (stats.depBumps), in spare room only: last here, or else on
     * the messages card after the issue references: "Dependency bumps" and "5 commits · 2%"
     * (else "12 · 8%", else "Dep bumps" and "12 · 8%", the first one drawn whole).
     */
    depBumps: 'Dependency bumps',
    depBumpsLabelShort: 'Dep bumps',
    depBumpsValue: (commits, pct) => `${plural(commits, UNITS.commit)} · ${pct}`,
    depBumpsShort: (commits, pct) => `${num(commits)} · ${pct}`,
    depBumpsDescription: (commits, pct) => `${plural(commits, UNITS.commit)} only touched lockfiles or dependency manifests (${pct} of non-merge commits)`,
  },

  /**
   * A --year run compared with the previous year (stats.yearOverYear): row labels on the
   * totals card, and the change in commits / lines changed / active days as one phrase.
   */
  yoy: {
    commits: (year) => `Commits vs ${year}`,
    lines: (year) => `Lines vs ${year}`,
    activeDays: (year) => `Active days vs ${year}`,
    changes: yoyChanges,
    /** The outro's one-line summary; each change stays on one line (no-break spaces). */
    summary: (year, commits, lines, days) => `vs ${year}: ${signedPluralNb(commits, UNITS.commit)}, ${signedPluralNb(lines, UNITS.line)}\u00a0changed, ${signedPluralNb(days, UNITS.activeDay)}.`,
  },

  /**
   * A --since run compared with the equal-length window just before it
   * (stats.previousPeriod): row labels on the totals card (`short` drops the day count
   * when a row would not fit), and the outro's one-line summary.
   */
  period: {
    commits: (days, short) => (short ? 'Commits vs prev.' : `Commits vs prev. ${plural(days, UNITS.day)}`),
    lines: (days, short) => (short ? 'Lines vs prev.' : `Lines vs prev. ${plural(days, UNITS.day)}`),
    activeDays: (days, short) => (short ? 'Active days vs prev.' : `Active days vs prev. ${plural(days, UNITS.day)}`),
    summary: (days, commits, lines, active) => `vs previous ${plural(days, UNITS.day)}: ${signedPluralNb(commits, UNITS.commit)}, ${signedPluralNb(lines, UNITS.line)}\u00a0changed, ${signedPluralNb(active, UNITS.activeDay)}.`,
  },

  peak: {
    eyebrow: 'Your power hour',
    byHour: 'Commits by hour',
    byWeekday: 'By weekday',
    barTitle: (label, commits) => `${label}: ${plural(commits, UNITS.commit)}`,
    noneBig: 'Zzz',
    noneTitle: 'No power hour yet',
    noneSubtitle: "Commit something and we'll find your golden hour.",
    tied: (label, commits) => `${label} is tied for your power hour, with ${plural(commits, UNITS.commit)}.`,
    landed: (commits, label) => `${plural(commits, UNITS.commit)} landed in the ${label} hour.`,
    /** By hour: before 5, 9, 12, 14, 18, 22, and the rest. */
    quips: [
      'The bugs come out at night, and so do you.',
      'Pushing code before the standup. Respect.',
      'Peak-morning productivity. Textbook.',
      'Lunch break? Never heard of it.',
      'The afternoon grind is real.',
      'After-hours hero.',
      'Late-night shipping, as is tradition.',
    ],
    /**
     * The short quip a night power hour (22:00-04:59) gets in place of its own when that
     * makes room for the "Late nights" row below the subtitle.
     */
    nightQuip: 'Night owl.',
    dayTied: (day) => `${day} is tied for your busiest day.`,
    dayBusiest: (day) => `${day} is your busiest day.`,
    /**
     * The time-zone sentence (two or more UTC offsets, see stats/timezones.js): `top` is
     * the most common offset ("UTC+03:00"), or null when two offsets tie for it.
     */
    timezones: (n, top) => `Committed from ${num(n)} time zones${top ? `, mostly ${top}` : ''}.`,
    /**
     * The late-nights rows (stats.lateNights, commits between 00:00 and 04:59): "Late
     * nights" and "12 commits · 4%", then "Latest night" and "4:12 AM · Mar 3, 2024".
     */
    lateNights: 'Late nights',
    latestLabel: 'Latest night',
    latestValue: (time, day) => `${time} · ${day}`,
    titleTied: 'is one of your power hours',
    title: 'is when you commit the most',
  },

  streak: {
    eyebrow: 'Your longest streak',
    endOfYear: (year) => `at the end of ${year}`,
    onDay: (date) => `on ${date}`,
    chartTitle: 'Longest vs. current',
    chartTitleEnd: 'Longest vs. at window end',
    longest: 'Longest',
    current: 'Current',
    windowEnd: 'Window end',
    longestTitle: (days, range) => `Longest: ${plural(days, UNITS.day)}, ${range}`,
    zeroTitle: 'day streak',
    zeroSubtitle: 'No streak yet — one commit starts it.',
    titleOne: 'day streak',
    titleMany: 'days in a row',
    onRange: (range) => `On ${range}.`,
    fromRange: (range) => `From ${range}.`,
    wasOn: (days, end) => `You were on a ${num(days)}-day streak ${end}.`,
    wasNone: (end) => `No streak was running ${end}.`,
    isOn: (days) => `You're on a ${num(days)}-day streak right now. Keep it alive!`,
    isNone: 'No streak running right now — today is a great day to start one.',
    breakTitle: 'Longest break',
    breakValue: (days) => `${plural(days, UNITS.day)} off`,
    breakNote: (from, to) => `Between ${from} and ${to}`,
    /** The cadence (stats/cadence.js shownCadence): "2.4 commits per active day" (1 decimal). */
    cadencePerDay: (n) => `${dec(n)} ${dec(n) === '1' ? 'commit' : 'commits'} per active day`,
    /** The cadence row's label on the card (shorter, to leave room for the gap): "2.4 per active day". */
    cadenceRow: (n) => `${dec(n)} per active day`,
    /** The median gap between active days: "every day", "every 3 days", "every 2.5 days". */
    cadenceEvery: (days) => (dec(days) === '1' ? 'every day' : `every ${dec(days)} days`),
    /**
     * The coding-sessions row (stats/sessions.js shownSessions), in the forms tried in
     * turn: "42 coding sessions" / "42 sessions" and "longest 3h 10m", else "Sessions" and
     * "42". With a single session the value is just its length: "1 coding session" | "26h 41m".
     */
    sessionsRowLabel: (count) => plural(count, ['coding session', 'coding sessions']),
    sessionsRowShort: (count) => plural(count, ['session', 'sessions']),
    sessionsRowValue: (count, longest) => (count === 1 ? sessionLength(longest) : `longest ${sessionLength(longest)}`),
    sessionsLabel: 'Sessions',
    /** A session length in whole minutes: "0 min", "45 min", "3h", "3h 10m". */
    sessionLength: (minutes) => sessionLength(minutes),
    /**
     * The row's text description: "42 coding sessions, median 35 min, longest 3h 10m (14
     * commits)"; one session: "1 coding session, 26h 41m (50 commits)".
     */
    sessionsDescription: (count, median, longest, commits) => (count === 1
      ? `1 coding session, ${sessionLength(longest)} (${plural(commits, UNITS.commit)})`
      : `${plural(count, ['coding session', 'coding sessions'])}, median ${sessionLength(median)}, longest ${sessionLength(longest)} (${plural(commits, UNITS.commit)})`),
    /**
     * The recap / wrapped.md value: "42 sessions · median 35 min · longest 3h 10m (14
     * commits, Mar 2, 2026)"; one session: "1 session · 26h 41m (50 commits, Mar 2, 2026)".
     */
    sessionsValue: (count, median, longest, commits, day) => (count === 1
      ? `1 session · ${sessionLength(longest)} (${plural(commits, UNITS.commit)}, ${day})`
      : `${plural(count, ['session', 'sessions'])} · median ${sessionLength(median)} · longest ${sessionLength(longest)} (${plural(commits, UNITS.commit)}, ${day})`),
  },

  activity: {
    calendar: 'Your commit calendar',
    year: 'Your year in commits',
    last12: 'Your last 12 months',
    monthsTo: (month, year) => `12 months to ${MONTHS[month - 1]} ${year}`,
    title: (days) => (days === 1 ? 'active day' : 'active days'),
    busiest: (date, commits) => `Busiest day: ${date} with ${plural(commits, UNITS.commit)}.`,
    weeks: (weeks) => (weeks === 1 ? 'You showed up in 1 week.' : `You showed up in ${num(weeks)} different weeks.`),
  },

  /** The monthly timeline card (commits per calendar month). */
  monthly: {
    eyebrow: 'Month by month',
    /** The eyebrow when only the most recent `n` months are shown. */
    lastMonths: (n) => `Your last ${num(n)} months`,
    /** The eyebrow of a clipped timeline that ends before this month: "24 months to Apr 2019". */
    monthsTo: (n, month, year) => `${num(n)} months to ${MONTHS[month - 1]} ${year}`,
    /** The title when every active month has the same count (no peak to call out). */
    steadyTitle: (commits) => `${commits === 1 ? 'commit' : 'commits'} in every active month`,
    /** The big word: "Mar 2026". */
    big: (month, year) => `${MONTHS[month - 1]} ${year}`,
    title: 'was your peak month',
    titleTied: 'is tied for your peak month',
    /** The peak month's commits (the big word already names the month). */
    peak: (commits) => `${plural(commits, UNITS.commit)} in a single month.`,
    active: (active, total) => `You committed in ${num(active)} of ${num(total)} months.`,
    everyMonth: (total) => `You committed in every one of these ${num(total)} months.`,
    chartTitle: 'Commits per month',
    barTitle: (name, commits) => `${name}: ${plural(commits, UNITS.commit)}`,
  },

  hotFiles: {
    eyebrow: 'Your hot files',
    noneBig: 'Nothing',
    noneTitle: 'No hot files yet',
    noneSubtitle: 'Edit a file a few times and it will show up here.',
    titleTied: 'is one of your most-touched files',
    title: "is the file you can't stop touching",
    subtitle: (commits, added, removed) => `${plural(commits, UNITS.commit)}, ${added} / ${removed} lines.`,
    chartTitle: 'Most-touched files',
    barTitle: (path, commits, added, removed) => `${path}: ${plural(commits, UNITS.commit)}, ${added} / ${removed} lines`,
    /** The top-folders list (stats.folders), in spare room only: caption, then one bar per folder. */
    foldersTitle: 'Top folders',
    /** The name shown for the files at a repo's root (stats.folders' "(root)"). */
    rootFolder: '(root)',
    folderValue: (lines) => plural(lines, UNITS.line),
    folderBarTitle: (path, lines, added, removed, commits) => `${path}: ${plural(lines, UNITS.line)} changed (${added} / ${removed}) in ${plural(commits, UNITS.commit)}`,
    /**
     * The test-share row (stats.tests), on this card or else the languages card, in spare
     * room only: "Tests" and "1,234 lines · 23%" ("1,234 · 23%" when that would be cut).
     */
    tests: 'Tests',
    testsValue: (lines, pct) => `${plural(lines, UNITS.line)} · ${pct}`,
    testsShort: (lines, pct) => `${num(lines)} · ${pct}`,
    testsDescription: (lines, pct) => `${plural(lines, UNITS.line)} changed in tests (${pct} of lines changed)`,
    /**
     * The docs-share row (stats.docShare), right after the tests row, on the card that has
     * it (else the other one), in spare room only: "Docs" and "1,234 lines · 23%".
     */
    docs: 'Docs',
    docsValue: (lines, pct) => `${plural(lines, UNITS.line)} · ${pct}`,
    docsShort: (lines, pct) => `${num(lines)} · ${pct}`,
    docsDescription: (lines, pct) => `${plural(lines, UNITS.line)} changed in docs (${pct} of lines changed)`,
    /**
     * The co-change row (stats.coChange), in spare room only, after the other rows:
     * "Changed together" and "a.js + b.js · 12×" (the two file names, then the commits), or
     * when that would be cut "a.js + b.js" and "12× together", else "a.js + b.js" and "12×".
     */
    coChange: 'Changed together',
    coChangeValue: (a, b, commits) => `${a} + ${b} · ${num(commits)}×`,
    coChangePair: (a, b) => `${a} + ${b}`,
    coChangeTimes: (commits) => `${num(commits)}× together`,
    coChangeTimesShort: (commits) => `${num(commits)}×`,
    coChangeDescription: (a, b, commits) => `${a} and ${b} changed together in ${plural(commits, UNITS.commit)}`,
    /**
     * The one-touch files row (stats.oneTouch), in spare room only, after every other row:
     * "One-touch files" and "42 files · 31%", else "42 · 31%", else "One-touch" and "42 · 31%".
     */
    oneTouch: 'One-touch files',
    oneTouchLabelShort: 'One-touch',
    oneTouchValue: (files, pct) => `${plural(files, UNITS.file)} · ${pct}`,
    oneTouchShort: (files, pct) => `${num(files)} · ${pct}`,
    oneTouchDescription: (files, pct) => `${plural(files, UNITS.file)} changed in just one commit (${pct} of changed files)`,
  },

  languages: {
    eyebrow: 'Your languages',
    other: 'Other',
    /** Language names shown in another form than stats' (English) one; the rest are kept. */
    names: { Text: 'Text' },
    barTitle: (label, lines, files, pct) => `${label}: ${plural(lines, UNITS.line)} changed in ${plural(files, UNITS.file)} (${pct})`,
    shareOfFiles: 'Share of files touched',
    shareOfLines: 'Share of lines changed',
    noneBig: 'None',
    noneTitle: 'No code languages detected',
    noneFiles: (files) => `${plural(files, UNITS.file)} changed, none in a language we recognize. Mysterious.`,
    noneAtAll: 'Write some code and your languages will show up here.',
    tieMany: (n) => `${n}-way tie at the top`,
    tied: (list) => `Tied at the top: ${list}`,
    only: (name) => `All ${name}, all the time`,
    mostly: (name) => `Mostly ${name}`,
    ledBy: (name) => `Led by ${name}`,
    noCode: 'No code this time, just words and data.',
    oneLanguage: 'One language, total commitment.',
    polyglot: 'Polyglot energy.',
    /** "You wrote code in 3 languages across 12 files." (`code`: programming languages). */
    summary: (count, code, files) => `${count === 1 ? 'You stuck to 1 language' : `You wrote${code ? ' code' : ''} in ${plural(count, UNITS.language)}`} across ${plural(files, UNITS.file)}.`,
    quips: {
      JavaScript: 'Runs everywhere, including your commit log.',
      TypeScript: 'Types all the way down.',
      Python: 'Indentation is a lifestyle.',
      Go: 'if err != nil { keepShipping() }',
      Rust: 'The borrow checker approves.',
      Java: 'AbstractSingletonCommitFactoryBean energy.',
      Kotlin: 'Null safety, but make it fun.',
      Swift: 'Swift by name, swift by nature.',
      C: 'Living dangerously, one pointer at a time.',
      'C++': 'Template wizardry detected.',
      'C#': 'Semicolons and LINQ, a classic duo.',
      Ruby: 'Optimized for developer happiness.',
      PHP: 'Still powering half the web.',
      Shell: 'chmod +x and hope for the best.',
      HTML: 'Hypertext is still the best text.',
      CSS: 'Centering divs since day one.',
      SCSS: 'Nesting like a pro.',
      Markdown: 'Docs-driven development. Respect.',
      JSON: 'Config is code, apparently.',
      YAML: 'Indentation-sensitive config whisperer.',
      SQL: 'SELECT * FROM good_decisions.',
      Dart: 'Hot reload, hot streak.',
      Haskell: 'Pure, lazy, and proud of it.',
      Elixir: 'Let it crash, then commit again.',
    },
  },

  messages: {
    eyebrow: 'Message hall of fame',
    noneTitle: 'No commit messages yet',
    oops: (n) => `“Oops” happened ${n === 1 ? 'once' : `${num(n)} times`}. We've all been there.`,
    average: (avg) => `Your messages average ${avg} characters.`,
    longest: (quoted) => `Longest: ${quoted}`,
    shortest: (quoted) => `Shortest: ${quoted}`,
    favorite: (times) => `was your favorite word (${plural(times, UNITS.time)})`,
    averageTitle: 'characters per message, on average',
    fixCommits: '“fix” commits',
    wipCommits: '“wip” commits',
    oopsCommits: '“oops” commits',
    /** The biggest-commit panel: caption (with the day, when known), lines, a subject-less commit. */
    biggestTitle: (date) => (date ? `Biggest commit · ${date}` : 'Biggest commit'),
    biggestLines: (plus, minus) => `${plus} / ${minus} lines`,
    noSubject: '(no subject)',
    /**
     * The conventional-commit mix (stats.commitTypes): caption with the share of commits
     * that follow the convention, type names (the prefixes themselves), hover text per type.
     */
    typesTitle: (pct) => `Commit types · ${pct} conventional`,
    /** `rest`: the card's folded remainder (types beyond the top three); `none`: commits without a type prefix. */
    typeNames: { feat: 'feat', fix: 'fix', docs: 'docs', refactor: 'refactor', test: 'test', chore: 'chore', other: 'other', rest: 'the rest', none: 'no prefix' },
    typeTitle: (name, commits, pct) => `${name}: ${plural(commits, UNITS.commit)} (${pct})`,
    /**
     * The fix / wip / oops rows folded into one, to make room for the type mix (quoted:
     * they count words, not commit types; "commits" does not fit next to the counts at 40px).
     */
    counterCommits: '“fix” / “wip” / “oops”',
    counterValues: (fix, wip, oops) => `${fix} / ${wip} / ${oops}`,
    /** The emoji panel (stats.emoji): caption, then the share of commits with an emoji ("12% of commits"); the top emoji are its note. */
    emojiTitle: 'Emoji',
    emojiShare: (pct) => `${pct} of commits`,
    /** The reverts row (stats.reverts): caption, then the count and its share of non-merge commits ("3 · 2%"). */
    revertsTitle: 'Reverts',
    revertsValue: (count, pct) => `${num(count)} · ${pct}`,
    /**
     * Fixup commits (stats.messages.fixups) as a segment after the "fix" count
     * ("12 · 3 fixup!"), only when drawn whole.
     */
    fixupsValue: (value, count) => `${value} · ${num(count)} fixup!`,
    /**
     * The issue references row (stats.issueRefs), in spare room only, after every other
     * row: "Issue refs (top #128 ×9)" and "42 · 12%" (the count and its share of non-merge
     * commits), else "Issue refs" and "42 · 12% (#128 ×9)", else "Issue refs" and
     * "42 · 12%" when the longer forms would be cut; its hover text says it in words.
     */
    issueRefsTitle: (ref, times) => (ref ? `Issue refs (top ${ref} ×${num(times)})` : 'Issue refs'),
    issueRefsValue: (count, pct, ref, times) => `${num(count)} · ${pct}${ref ? ` (${ref} ×${num(times)})` : ''}`,
    issueRefsDescription: (count, pct, ref, times) => `${plural(count, UNITS.commit)} ${count === 1 ? 'mentions' : 'mention'} an issue (${pct} of non-merge commits)${ref ? `; most referenced: ${ref} (${plural(times, UNITS.commit)})` : ''}`,
    /**
     * The subject length row (stats.messages.subjectLength), in spare room only, after
     * every other row: "Subject length" and "48 · 12% over 72" (the median subject length
     * in characters, and the share of non-merge commits whose subject is longer than 72),
     * else "48 · 12% >72"; without such subjects just "median 48" / "48". Its
     * hover text says it in words.
     */
    subjectLengthTitle: 'Subject length',
    subjectLengthValue: (median, over72, pct) => (over72 > 0 ? `${dec(median)} · ${pct} over 72` : `median ${dec(median)}`),
    subjectLengthShort: (median, over72, pct) => `${dec(median)}${over72 > 0 ? ` · ${pct} >72` : ''}`,
    subjectLengthDescription: (median, over72, pct) => `Median subject length: ${decPlural(median, ['character', 'characters'])}; ${over72 > 0 ? `${plural(over72, UNITS.commit)} over 72 characters (${pct} of non-merge commits)` : 'no commit over 72 characters'}`,
    /**
     * The message bodies row (stats.messages.bodies), in spare room only, after every
     * other row (the subject length too): "Message bodies" and "42 · 31%" (how many
     * non-merge commits have a body beyond the subject, and their share), else "Bodies"
     * and "31%" when that would be cut; its hover text says it in words.
     */
    bodiesTitle: 'Message bodies',
    bodiesValue: (count, pct) => `${num(count)} · ${pct}`,
    bodiesShortTitle: 'Bodies',
    bodiesShort: (count, pct) => `${pct}`,
    bodiesDescription: (count, pct) => `${plural(count, UNITS.commit)} ${count === 1 ? 'has' : 'have'} a message body beyond the subject (${pct} of non-merge commits)`,
    /**
     * The top subject words row (stats.messages.topWords), in spare room only, after every
     * other row (the message bodies too): "Top words" and "parser ×5 · cache ×3 · login ×2"
     * (`words` is `[{word, count}]`, each count the commits whose subject uses the word),
     * or all of it as one label, "Top words: parser ×5 · cache ×3" (a label has more room);
     * fewer words when that would be cut; its hover text says it in words.
     */
    topWordsTitle: 'Top words',
    topWordsLabel: (words) => `Top words: ${words.map((w) => `${w.word} ×${num(w.count)}`).join(' · ')}`,
    topWordsValue: (words) => words.map((w) => `${w.word} ×${num(w.count)}`).join(' · '),
    topWordsDescription: (words) => `Most common words in commit subjects: ${words.map((w) => `${w.word} (${plural(w.count, UNITS.commit)})`).join(', ')}`,
  },

  personality: {
    eyebrow: 'Your commit personality',
    chartTitle: 'Your habit scores',
    archetypes: {
      'night-owl': { name: 'Night Owl', roast: 'Your best ideas arrive after midnight. So do your worst ones.' },
      'early-bird': { name: 'Early Bird', roast: 'You push code before the coffee is even brewed. Show-off.' },
      'friday-deployer': { name: 'Friday Deployer', roast: 'You ship on Fridays and call it courage. Your on-call rotation calls it something else.' },
      fixaholic: { name: 'Fixaholic', roast: 'Every bug you fix is a bug you lovingly wrote first.' },
      'weekend-warrior': { name: 'Weekend Warrior', roast: 'Weekends are for touching grass. You touched git instead.' },
      'steady-shipper': { name: 'Steady Shipper', roast: 'Reliable, consistent, low drama. Frankly, a little suspicious.' },
    },
    /** Reasons quote the real number behind an archetype; shares are whole percents. */
    reasons: {
      'night-owl': (pct) => `${pct}% of your commits land between 10 PM and 4 AM.`,
      'early-bird': (pct) => `${pct}% of your commits land between 5 AM and 9 AM.`,
      'friday-deployer': (pct) => `${pct}% of your commits land on a Friday.`,
      fixaholic: (pct, reverts) => `${pct}% of your commit messages are fixes${reverts > 0 ? `; ${reverts === 1 ? '1 commit reverts another' : `${num(reverts)} commits revert another`}` : ''}.`,
      'weekend-warrior': (pct) => `${pct}% of your commits land on a Saturday or Sunday.`,
      'steady-shipper': (activeDays, span, longest) => `You committed on ${activeDays} of ${span} ${span === 1 ? 'day' : 'days'}, with a longest streak of ${longest} ${longest === 1 ? 'day' : 'days'}.`,
    },
    notEnough: 'Not enough commits yet.',
  },

  contributors: {
    eyebrow: 'The team',
    unknown: 'Unknown',
    you: 'you',
    youRank: (rank) => `you · #${num(rank)}`,
    youName: (name) => `${name} (you)`,
    barTitle: (who, rank, commits, share, added, removed) => `${who}: #${num(rank)}, ${plural(commits, UNITS.commit)} (${share}), ${added} / ${removed} lines`,
    chartTitle: 'Top contributors by commits',
    ofTotal: (total) => `of ${plural(total, UNITS.contributor)}`,
    youMade: (share, commits, added, removed) => `You made ${share} of the commits: ${plural(commits, UNITS.commit)}, ${added} / ${removed} lines.`,
    teamwork: 'Teamwork makes the commits work.',
    several: 'Several people',
    shareLead: (who, commits) => `${who} share the lead with ${plural(commits, UNITS.commit)} each.`,
    leads: (name, share) => `${name} leads the pack with ${share} of the commits.`,
    title: 'contributors',
    /**
     * The bus-factor row (stats.contributors.busFactor), in spare room only: "Bus factor"
     * and "2 people · 58%" ("2 · 58%" when that would be cut).
     */
    busFactor: 'Bus factor',
    busFactorValue: (authors, pct) => `${plural(authors, UNITS.person)} · ${pct}`,
    busFactorShort: (authors, pct) => `${num(authors)} · ${pct}`,
    busFactorDescription: (authors, pct) => `${plural(authors, UNITS.person)} made ${pct} of the lines changed`,
  },

  /**
   * Commits with Co-authored-by trailers (stats.coAuthors): a panel on the team card (or,
   * without one, the totals card): caption, "12 commits paired", "Top co-author: Ada".
   */
  pairing: {
    title: 'Pair programming',
    paired: (n) => `${plural(n, UNITS.commit)} paired`,
    top: (name) => `Top co-author: ${name}`,
    /** The totals card's row (without a team card): label, with the top co-author when known. */
    row: (name) => (name ? `Paired (top: ${name})` : 'Paired commits'),
  },

  outro: {
    eyebrow: "That's a wrap",
    big: 'Thanks!',
    inOneCard: (repo) => `${repo}, in one card`,
    subtitle: 'Made with gitwrapped. Share your cards and tag a teammate.',
    commits: 'Commits',
    powerHour: 'Power hour',
    bestStreak: 'Best streak',
    personality: 'Personality',
    noneYet: 'None yet',
    tbd: 'TBD',
    hottestFile: 'Hottest file',
    /**
     * The optional releases panel (stats.releases: tags on the commits): caption, "You
     * shipped 3 releases", then "Latest: v1.5.0 · Oct 6, 2026".
     */
    releases: 'Releases',
    shipped: (n) => `You shipped ${plural(n, UNITS.release)}`,
    latest: (name) => `Latest: ${name}`,
    /**
     * The optional merges panel (stats.merges), when the totals card has no room for its
     * row: caption, "You merged 12 pull requests" (or "8 merge commits" without pull
     * requests), then "8 merge commits · 6% of commits" (or "6% of commits"; none without
     * merge commits). `share` is already formatted.
     */
    merges: 'Merges',
    mergedValue: (prs, merges) => (prs > 0 ? `You merged ${plural(prs, ['pull request', 'pull requests'])}` : plural(merges, ['merge commit', 'merge commits'])),
    mergedNote: (prs, merges, share) => (merges > 0 ? `${prs > 0 ? `${plural(merges, ['merge commit', 'merge commits'])} · ` : ''}${share} of commits` : null),
    /** mergedNote when it does not fit on one line: "8 merge commits · 6%" (or "6%"). */
    mergedNoteShort: (prs, merges, share) => (merges > 0 ? `${prs > 0 ? `${plural(merges, ['merge commit', 'merge commits'])} · ` : ''}${share}` : null),
  },

  share: {
    /** `year` is null outside a --year window. */
    eyebrow: (year) => `My ${year ? `${year} ` : ''}Git Wrapped`,
    eyebrowAuthor: (year, who) => `${year ? `${year} ` : ''}Git Wrapped · ${who}`,
    noHotFiles: 'No hot files yet.',
  },

  calendar: {
    less: 'Less',
    more: 'More',
    cell: (date, commits) => `${date}: ${commits === 1 ? '1 commit' : `${num(commits)} commits`}`,
  },

  // --- HTML viewer ---------------------------------------------------------------------
  viewer: {
    carousel: 'carousel',
    slide: 'slide',
    slideLabel: (i, n) => `${i} of ${n}`,
    card: (i) => `Card ${i}`,
    previous: 'Previous card',
    next: 'Next card',
    pause: 'Pause',
    play: 'Play',
    actions: 'Card actions',
    download: 'Download ',
    share: 'Share',
    shortcuts: 'Keyboard shortcuts',
    keyNext: 'Next card',
    keyPrevious: 'Previous card',
    keyFirstLast: 'First / last card',
    keyPause: 'Pause / play auto-advance',
    keyDownload: 'Download this card as PNG',
    keyHelp: 'Show this help',
    keyClose: 'Close this help',
    touch: 'On touch screens, tap the right side to go forward and the left side to go back, swipe to move, and press and hold to pause.',
    close: 'Close',
    // Live-region messages built in the browser (see viewer.js scriptFor).
    status: (i, n, title) => `Card ${i} of ${n}: ${title}`,
    saved: (file) => `Saved ${file}`,
    pngFallback: (name) => `PNG not available in this browser; saved ${name}.svg instead`,
    shareAgain: 'Tap Share again to share the card',
    shareFailed: 'Sharing failed',
  },

  // --- terminal recap ------------------------------------------------------------------
  recap: {
    /** Width the dim row labels are padded to. */
    labelWidth: 13,
    noCommits: 'No commits found: the cards are generated, but there is nothing to recap yet.',
    lines: 'lines',
    powerHour: 'Power hour',
    tied: ', tied',
    streak: 'Streak',
    longest: 'longest',
    current: 'current',
    atWindowEnd: 'at window end',
    /** The longest-break line: label, then "longest 12 days (Mar 3, 2025 – Mar 16, 2025)". */
    breakLabel: 'Break',
    /** The cadence line: label, then "2.4 commits per active day · every 3 days". */
    cadence: 'Cadence',
    /** The coding-sessions line: label, then "42 sessions · median 35 min · longest 3h 10m (14 commits, Mar 2, 2026)". */
    sessions: 'Sessions',
    /** The busiest-day line: label, "Oct 4, 2026", then "(12 commits)". */
    busiestDay: 'Busiest day',
    /** The time-zones line: label, "3 time zones", then "· mostly UTC+03:00 (62% of commits)". */
    timezones: 'Time zones',
    timezonesValue: (n) => plural(n, ['time zone', 'time zones']),
    mostly: (offset) => `mostly ${offset}`,
    /** The weekend line (stats.weekend): label, "12 commits", then "(8% of commits)". */
    weekend: 'Weekends',
    /**
     * The late-nights line (stats.lateNights): label, "12 commits", then "(4% of
     * commits) · latest 4:12 AM on Mar 3, 2024".
     */
    lateNights: 'Late nights',
    latestAt: (time, day) => `latest ${time} on ${day}`,
    /**
     * The office-hours line and card row (stats.officeHours, weekday commits between 09:00
     * and 17:59): label, "1,234 commits", then "(23% of commits)" (on a card row "95 commits ·
     * 23%", or "1,234 · 23%" when the full value would be cut).
     */
    officeHours: 'Office hours',
    hottestFile: 'Hottest file',
    /** The files born / buried line (stats.fileLifecycle): label, then "12 born · 3 buried" (" · 4 renamed" with any). */
    fileLifecycle: 'Files',
    fileLifecycleValue: (added, deleted, renamed = 0) => `${num(added)} born · ${num(deleted)} buried${renamed > 0 ? ` · ${num(renamed)} renamed` : ''}`,
    /** The top-folders line (stats.folders): label, then "src/ (1,234 lines) · test/ (567 lines) · (root) (89 lines)". */
    topFolders: 'Top folders',
    folderLines: (lines) => plural(lines, UNITS.line),
    /** The test-share line (stats.tests): label, "1,234 lines", then "(23% of lines changed)". */
    tests: 'Tests',
    /** The docs-share line (stats.docShare): label, "1,234 lines", then "(23% of lines changed)". */
    docs: 'Docs',
    /** The co-change line (stats.coChange): label, "src/a.js + src/b.js", then "(12 commits)" (fits labelWidth). */
    coChange: 'Co-changed',
    /** The one-touch files line (stats.oneTouch): label, "42 files", then "(31% of changed files)". */
    oneTouch: 'One-touch',
    ofChangedFiles: (share) => `${share} of changed files`,
    ofLinesChanged: (share) => `${share} of lines changed`,
    topLanguage: 'Top language',
    /** "(74% of lines, tied with 1 more)". */
    languageDetail: (share, basis, tiedMore) => `${share} ${basis === 'files' ? 'of files' : 'of lines'}${tiedMore > 0 ? `, tied with ${tiedMore} more` : ''}`,
    team: 'Team',
    /** The bus-factor line (stats.contributors.busFactor): label, "2 people", then "(58% of lines changed)". */
    busFactor: 'Bus factor',
    busFactorValue: (authors) => plural(authors, UNITS.person),
    repos: 'Repos',
    /** The year-over-year line's label: "vs 2024". */
    vsYear: (year) => `vs ${year}`,
    /** The period-over-period line's label: "vs prev. 30 days". */
    vsPeriod: (days) => `vs prev. ${plural(days, UNITS.day)}`,
    moreRepos: (n) => `…and ${num(n)} more`,
    youAre: "you're",
    ofCommits: (share) => `${share} of commits`,
    top: 'top:',
    topWord: 'Top word',
    /** The pairing line: label, "12 commits", "(31% of non-merge commits)", then "· top co-author: Ada". */
    paired: 'Paired',
    ofNonMerge: (share) => `${share} of non-merge commits`,
    topCoAuthor: 'top co-author:',
    /** The releases line: label, "3 releases", then "· latest: v1.5.0 (Oct 6, 2026)". */
    releases: 'Releases',
    latest: 'latest:',
    /** The merges line (stats.merges): label, then "12 pull requests merged · 8 merge commits (6% of commits)". */
    merges: 'Merges',
    mergesValue: (prs, merges, share) => mergesText(prs, merges, share, ' · '),
    /** The first-commit line: label, then the quoted subject and "(Mar 3, 2025 · 1a2b3c4)". */
    firstCommit: 'First commit',
    biggest: 'Biggest',
    /** The commit size line: label, then "62% tiny · 25% small · 10% medium · 3% large". */
    sizes: 'Sizes',
    sizeNames: { tiny: 'tiny', small: 'small', medium: 'medium', large: 'large' },
    /** The commit type line: label, "45% feat · 30% fix · 25% other", then "(62% of commits conventional)". */
    types: 'Types',
    conventional: (pct) => `${pct} of commits conventional`,
    /** The emoji line: label, "12% of commits", then "· ✨ 40 · 🐛 22 · 📝 9" (commits per emoji). */
    emoji: 'Emoji',
    /** The reverts line: label, "3 commits", then "(2% of non-merge commits)". */
    reverts: 'Reverts',
    /** The fixups line (stats.messages.fixups): label, "3 commits", then "(2% of non-merge commits)". */
    fixups: 'Fixups',
    /**
     * The cleanups line (stats.cleanups): label, "12 commits", "(8% of non-merge commits)",
     * then "· biggest "drop the old parser" (−4,210 lines · Mar 3, 2026)" when known.
     */
    cleanups: 'Cleanups',
    biggestCleanup: 'biggest',
    /** The issue references line (stats.issueRefs): label, "42 commits", "(12% of non-merge commits)", then "· top #128 (9 commits)". */
    issueRefs: 'Issue refs',
    topIssue: (ref, commits) => `top ${ref} (${commits})`,
    /** The dependency-bumps line (stats.depBumps): label, "12 commits", then "(8% of non-merge commits)". */
    depBumps: 'Dep bumps',
    /**
     * The subject length line (stats.messages.subjectLength): label, "median 48 chars ·
     * 3 commits over 72" (or "· none over 72"), then "(2% of non-merge commits)" when any.
     */
    subjects: 'Subjects',
    subjectLengthValue: (median, over72) => `median ${decPlural(median, ['char', 'chars'])} · ${over72 > 0 ? `${plural(over72, UNITS.commit)} over 72` : 'none over 72'}`,
    /** The message bodies line (stats.messages.bodies): label, "42 commits", then "(31% of non-merge commits)". */
    bodies: 'Bodies',
    /** The top subject words line (stats.messages.topWords): label, `"parser" ×5 · "cache" ×3`, then "(commits per word)". */
    topWords: 'Top words',
    topWordsNote: 'commits per word',
    you: 'You are',
    cardsIn: (count, dir) => `${count} in ${dir}`,
    shareImage: 'share image:',
    statsJson: 'stats JSON:',
    markdown: 'Markdown summary:',
    opening: (file) => `Opening ${file}…`,
  },

  // --- Markdown summary (--md, <out>/wrapped.md) ---------------------------------------
  markdown: {
    /** The top heading. */
    title: (repo) => `${repo} Wrapped`,
    noCommits: 'No commits found: nothing to sum up yet.',
    numbers: 'In numbers',
    commits: 'Commits',
    lines: 'Lines',
    /** After a "+N / −M" count. */
    linesWord: 'lines',
    files: 'Files',
    habits: 'When you commit',
    /** The weekday with the most commits (stats.habits.peakWeekday). */
    busiestWeekday: 'Busiest weekday',
    /** The calendar day with the most commits: "Oct 4, 2026 (12 commits)". */
    busiestDay: 'Busiest day',
    /** Commits on an author-local Saturday or Sunday (stats.weekend): "12 commits (8% of commits)". */
    weekend: 'Weekend commits',
    /**
     * Commits between 00:00 and 04:59 author-local (stats.lateNights): "12 commits (4% of
     * commits), latest at 4:12 AM on Mar 3, 2024".
     */
    lateNights: 'Late-night commits',
    latestAt: (time, day) => `latest at ${time} on ${day}`,
    /** Weekday commits between 09:00 and 17:59 author-local (stats.officeHours): "1,234 commits (23% of commits)". */
    officeHours: 'Office-hours commits',
    /** Files added / deleted / renamed in the window (stats.fileLifecycle): "12 files added, 3 deleted" (", 4 renamed" with any). */
    fileLifecycle: 'Files born / buried',
    fileLifecycleValue: (added, deleted, renamed = 0) => `${plural(added, UNITS.file)} added, ${num(deleted)} deleted${renamed > 0 ? `, ${num(renamed)} renamed` : ''}`,
    tied: 'tied',
    streaks: 'Streaks',
    longestStreak: 'Longest streak',
    currentStreak: 'Current streak',
    windowEndStreak: 'Streak at window end',
    longestBreak: 'Longest break',
    /** Commits per active day and the median gap between active days (stats.cadence). */
    cadence: 'Cadence',
    /** Coding sessions (stats.sessions): "42 sessions · median 35 min · longest 3h 10m (14 commits, Mar 2, 2026)". */
    sessions: 'Coding sessions',
    hotFiles: 'Hot files',
    file: 'File',
    /** The top-folders table (stats.folders). */
    topFolders: 'Top folders',
    folder: 'Folder',
    /** Lines changed in test files (stats.tests): "1,234 lines (23% of lines changed)". */
    tests: 'Test lines',
    /** Lines changed in documentation files (stats.docShare): "1,234 lines (23% of lines changed)". */
    docs: 'Doc lines',
    /** The co-change item after the hot-files table (stats.coChange): "src/a.js + src/b.js (12 commits)". */
    coChange: 'Changed together',
    /** The one-touch files item after the hot-files table (stats.oneTouch): "42 files (31% of changed files)". */
    oneTouch: 'One-touch files',
    languages: 'Languages',
    language: 'Language',
    contributor: 'Contributor',
    share: 'Share',
    /** The bus-factor item in the team section (stats.contributors.busFactor): "2 people (58% of lines changed)". */
    busFactor: 'Bus factor',
    repo: 'Repo',
    /** The conventional-commit mix section. */
    commitTypes: 'Commit types',
    /** The emoji section (stats.emoji): "12% of commits: ✨ 40 · 🐛 22 · 📝 9" (commits per emoji). */
    emoji: 'Emoji',
    /** The reverts item (stats.reverts): "3 commits (2% of non-merge commits)". */
    reverts: 'Reverts',
    /** The fixups item (stats.messages.fixups): "3 commits (2% of non-merge commits)". */
    fixups: 'Fixup commits',
    /**
     * The cleanups item (stats.cleanups): "12 commits (8% of non-merge commits); biggest:
     * “drop the old parser” · −4,210 lines (Mar 3, 2026)".
     */
    cleanups: 'Cleanups',
    biggestCleanup: 'biggest:',
    /** The issue references item (stats.issueRefs): "42 commits (12% of non-merge commits); most referenced: #128 (9 commits)". */
    issueRefs: 'Issue references',
    topIssue: 'most referenced:',
    /** The dependency-bumps item (stats.depBumps): "12 commits (8% of non-merge commits)". */
    depBumps: 'Dependency bumps',
    /**
     * The subject length item (stats.messages.subjectLength): "median 48 characters; 3
     * commits over 72 characters" (or "none over 72 characters"), then "(2% of non-merge
     * commits)" when any.
     */
    subjectLength: 'Subject length',
    subjectLengthValue: (median, over72) => `median ${decPlural(median, ['character', 'characters'])}; ${over72 > 0 ? `${plural(over72, UNITS.commit)} over 72 characters` : 'none over 72 characters'}`,
    /** The message bodies item (stats.messages.bodies): "42 commits (31% of non-merge commits)". */
    bodies: 'Message bodies',
    /** The top subject words item (stats.messages.topWords): "parser (5 commits), cache (3 commits), login (2 commits)". */
    topWords: 'Top subject words',
    topWordsValue: (words) => words.map((w) => `${w.word} (${plural(w.count, UNITS.commit)})`).join(', '),
    /** The pairing item (stats.coAuthors): "12 commits (31% of non-merge commits), top co-author: Ada". */
    paired: 'Paired',
    topCoAuthor: (name) => `top co-author: ${name}`,
    /** The releases item (stats.releases): "3 releases, latest: v1.5.0 (Oct 6, 2026)". */
    releases: 'Releases',
    latestRelease: (name) => `latest: ${name}`,
    /** The merges item (stats.merges): "12 pull requests merged, 8 merge commits (6% of commits)". */
    merges: 'Merges',
    mergesValue: (prs, merges, share) => mergesText(prs, merges, share, ', '),
    cards: 'Story cards',
    /** Alt text of each card image, by card id (src/cards CARD_IDS). */
    cardNames: {
      intro: 'Intro',
      totals: 'The grand total',
      'peak-hour': 'Power hour',
      streak: 'Longest streak',
      activity: 'Commit calendar',
      months: 'Month by month',
      'hot-files': 'Hot files',
      languages: 'Languages',
      contributors: 'The team',
      messages: 'Message hall of fame',
      personality: 'Commit personality',
      outro: "That's a wrap",
    },
    footer: 'Made with gitwrapped.',
  },

  /** Notes printed above the recap. `n` is the commit cap (already formatted). */
  notes: {
    truncatedFiltered: (n) => `Note: more than ${n} matching commits; only the most recent ${n} were analyzed.`,
    truncated: (n) => `Note: this repo has more than ${n} commits; only the most recent ${n} were analyzed.`,
    truncatedRepos: (n) => `Note: these repos have more than ${n} commits together; only the most recent ${n} were analyzed.`,
    /** --year: the previous year (`year`) hit the commit cap. */
    previousYearTruncated: (n, year) => `Note: ${year} has more than ${n} matching commits; the comparison with it counts only its most recent ${n}.`,
    previousPeriodTruncated: (n, days) => `Note: the previous ${num(days)}-day window has more than ${n} matching commits; the comparison with it counts only its most recent ${n}.`,
    /** --author: the team read hit the cap; `from` is the first day it covers (or null). */
    teamTruncated: (n, from) => `Note: the contributors card ranks only the most recent ${n} commits by everyone${from ? ` (from ${from})` : ''}, you included.`,
    /** --author: everyone's commits are over the cap, so the card ranks them since `from`, the day of your oldest analyzed commit. */
    teamSince: (n, from) => `Note: everyone's commits together are over ${n}, so the contributors card ranks only those since your oldest analyzed commit (${from}).`,
    shallow: 'Note: shallow clone: line counts for the oldest (boundary) commit are skipped, and older history is missing.',
    unborn: 'Note: the current branch (HEAD) has no commits yet, and gitwrapped only reads HEAD\'s history. Check out a branch with commits (e.g. git switch main) and run again.',
    /** A multi-repo run; `repos` is the joined list of labels ("api and web"). */
    unbornRepos: (repos) => `Note: the current branch (HEAD) has no commits yet in ${repos}, and gitwrapped only reads HEAD's history. Check out a branch with commits there (e.g. git switch main) and run again.`,
    authorNotEmail: (author) => `Note: no commits by "${author}". --author expects an email address (e.g. you@example.com).`,
    noMatch: (filters) => `Note: no commits match ${filters}.`,
  },
};
