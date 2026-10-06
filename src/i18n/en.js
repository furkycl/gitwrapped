// English string table (the default). Every user-visible string of the cards, the share
// image, the HTML viewer and the terminal recap. tr.js has exactly the same keys and
// function signatures (test/i18n.test.js checks it). Functions take raw numbers / plain
// strings and do their own formatting; `units` are [singular, plural] word pairs.
import { formatDelta, formatInteger } from './format.js';

const num = (n) => formatInteger(n, ',');
const plural = (n, [one, many]) => `${num(n)} ${n === 1 ? one : many}`;
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
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default {
  code: 'en',
  name: 'English',

  // --- formatting ----------------------------------------------------------------------
  /** Integer with thousands separators: 12345 → "12,345". */
  num,
  /** An average with at most one decimal: 1234.5 → "1,234.5". */
  dec: (n) => (Math.round((typeof n === 'number' && Number.isFinite(n) ? n : 0) * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }),
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
  /** Sunday first. */
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  /** One letter per weekday, Sunday first (the weekday bar chart). */
  weekLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  /** One letter per weekday, Monday first (the calendar header). */
  calendarWeekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  /** 0-23 → "12 AM" … "11 PM". */
  hourLabel: (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`,
  /** Tick labels under the commits-by-hour chart. */
  hourTicks: { 0: '12a', 6: '6a', 12: '12p', 18: '6p', 23: '11p' },
  /** "Oct 4, 2026" (`year` as given). */
  date: (day, month, year) => `${MONTHS[month - 1]} ${day}, ${year}`,
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
    dayTied: (day) => `${day} is tied for your busiest day.`,
    dayBusiest: (day) => `${day} is your busiest day.`,
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
      fixaholic: (pct) => `${pct}% of your commit messages are fixes.`,
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
    hottestFile: 'Hottest file',
    topLanguage: 'Top language',
    /** "(74% of lines, tied with 1 more)". */
    languageDetail: (share, basis, tiedMore) => `${share} ${basis === 'files' ? 'of files' : 'of lines'}${tiedMore > 0 ? `, tied with ${tiedMore} more` : ''}`,
    team: 'Team',
    repos: 'Repos',
    /** The year-over-year line's label: "vs 2024". */
    vsYear: (year) => `vs ${year}`,
    moreRepos: (n) => `…and ${num(n)} more`,
    youAre: "you're",
    ofCommits: (share) => `${share} of commits`,
    top: 'top:',
    topWord: 'Top word',
    you: 'You are',
    cardsIn: (count, dir) => `${count} in ${dir}`,
    shareImage: 'share image:',
    statsJson: 'stats JSON:',
    opening: (file) => `Opening ${file}…`,
  },

  /** Notes printed above the recap. `n` is the commit cap (already formatted). */
  notes: {
    truncatedFiltered: (n) => `Note: more than ${n} matching commits; only the most recent ${n} were analyzed.`,
    truncated: (n) => `Note: this repo has more than ${n} commits; only the most recent ${n} were analyzed.`,
    truncatedRepos: (n) => `Note: these repos have more than ${n} commits together; only the most recent ${n} were analyzed.`,
    /** --year: the previous year (`year`) hit the commit cap. */
    previousYearTruncated: (n, year) => `Note: ${year} has more than ${n} matching commits; the comparison with it counts only its most recent ${n}.`,
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
