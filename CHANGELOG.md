# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-10-07

### Added

- First commit: the intro card gets an "It all began with" panel with the first commit
  in the window (its quoted subject, day and short hash; with several repos, its repo),
  the recap a "First commit" line and `wrapped.md` a "First commit" item, and
  `stats.json` gets `stats.firstCommit` (`{date, subject, hash}` plus `repo` with several
  repos, or `null`). It is the earliest non-merge commit by author date that passes the
  filters; email-shaped text in its subject is replaced with "…". A long subject is cut
  with "…", and when the intro has no room the panel is left out and the card is exactly
  as before. English and Turkish.

- Co-authors: commits with `Co-authored-by:` trailers count as paired. The team card
  gets a "Pair programming" panel ("12 commits paired", "Top co-author: Grace Hopper").
  Without a team card, when the panel doesn't fit there, or with `--author` (where the
  pairing counts only your commits), the totals card gets a "Paired (top: …)" row with
  the count instead. Both only use spare room, so a card without them is exactly as
  before. The recap gets a "Paired" line (with the share of non-merge commits),
  `wrapped.md` a "Paired" item, and `stats.json` gets `stats.coAuthors` (`{paired,
  commits, share, total, top}`, the top five co-authors as `{name, commits}`).
  Co-authors go through `.mailmap` (one `git check-mailmap` call per repo, for the main
  history read only) and are shown by name only, never an email; a co-author who is the
  commit's own author, and merge commits, don't count. English and Turkish.

- Commit type mix: when at least 20% of the commits follow Conventional Commits
  (`type(scope)!: description`, case-insensitive), the messages card shows the share of
  feat / fix / docs / refactor / test / chore / other commits as a thin stacked bar (the
  top three types, any others folded into "the rest", with the share of conventional
  commits in its caption; a lone type is set against the commits without a prefix, and
  a single type on every commit draws no bar), the recap gets a "Types" line and
  `wrapped.md` a "Commit types" section, and `stats.json` gets `stats.commitTypes` (`{total, conventional, share,
  counts, shares, top, shown}`; shares are whole percents of the conventional commits
  that add up to 100). Only known types count (`perf`, `ci`, `build`, `style`, `revert`,
  `release` and `deps` go to "other"; `feature`, `bugfix` / `hotfix`, `doc` and `tests`
  are aliases), so a subject like "Update: readme" is not conventional. Merge commits
  are skipped. The bar only uses spare room: if it doesn't fit, the fix / wip / oops rows
  are folded into one row to make room, and if it still doesn't fit (or the mix isn't
  shown) the card is exactly as before. English and Turkish.

### Fixed

- No email address shows up in any output anymore: email-shaped text (`name@host`) in
  the longest / shortest message and the biggest commit's subject, in hot-file paths
  (`keys/ada@example.com.pub`) and in the repo labels of a multi-repo run is now
  replaced with "…" in `stats.json`, on the cards, the share image, `wrapped.html`
  (including its screen-reader descriptions and tooltips) and in the recap, as it
  already was in `wrapped.md`. The favorite word and the message lengths are counted
  from the scrubbed subjects.
- Versions and `@2x` asset names are no longer mistaken for email addresses: text after
  an `@` that starts with a digit is kept (`lodash@4.17.21`, `@babel/core@7.2`,
  `logo@2x.png`), in `wrapped.md` too.

## [1.4.0] - 2026-10-06

### Added

- Commit size mix: the totals card now shows the share of tiny (under 10 lines), small
  (10–99), medium (100–500) and large (over 500 lines changed) non-merge commits as one
  stacked bar, the recap gets a "Sizes" line, and `stats.json` gets `stats.commitSizes`
  (`{total, tiny, small, medium, large, shares}`; shares are whole percents that add up
  to 100). Lines are counted like the biggest commit: lockfiles, build output, vendored
  code and `--exclude`d files are left out, so a commit that only touched those is tiny.
  On the card, in the recap and in `wrapped.md` a size with commits never reads "0%"
  ("<1%" instead) and none reads 100% next to others (as on the languages card);
  `stats.json` keeps the raw shares. Every segment stays clearly brighter than the empty
  track, so an all-large mix doesn't look empty.
  The bar only uses spare room: without commits to count, or when the totals card is
  short of space (e.g. `--year`'s extra rows), it is left out and the card is exactly as
  before (nothing else shrinks for it). English and Turkish.
  A card's screen-reader description now covers only the charts actually drawn, so a
  chart left out for lack of room (this bar, or a per-repo chart) is left out of it too.
- Longest break: the streak card now shows the longest gap between two consecutive
  active days (idle days, and the active days before and after it) in a panel under
  the bars, the recap gets a "Break" line, and `stats.json` gets
  `stats.streaks.longestBreak` (`{days, from, to}`; `days` counts the idle days in
  between, ties go to the earliest gap, `{days: 0, from: null, to: null}` without one).
  Like the longest streak, the card and recap leave out future-dated days. Without a
  break the card is unchanged. English and Turkish.
- `--md`: also writes `<out>/wrapped.md`, a Markdown summary for READMEs and PR
  descriptions: headline numbers (and the year-over-year change with `--year`) with the
  commit size mix, power hour and busiest weekday, streaks and the longest break, the top
  five hot files and languages, the team by name (in a repo with several contributors),
  per-repo numbers, the biggest commit and the commit personality, then every card SVG as
  a relative image link. Localized with `--lang` (English and Turkish), the same numbers
  as the cards and the recap (the languages table has the languages card's rows), and
  never an email address (names only; `--author` by its local part; anything shaped like
  an address in subjects, paths or repo names is cut). Paths, names and subjects are
  escaped so they render as plain text, without links, @mentions, #references or math
  (`$`). The recap prints its path. Without `--md` an existing `wrapped.md` is left alone,
  and like `stats.json` it is never written through a symlink.

## [1.3.0] - 2026-10-06

### Added

- Biggest commit: the message hall of fame card now shows the commit with the most
  lines changed (its day, lines added / removed and subject), the recap gets a
  "Biggest" line, and `stats.json` gets `stats.biggestCommit` (`{hash, subject, date,
  linesAdded, linesRemoved, lines, files}`, or `null`). Lines count over the same files
  as hot files (lockfiles, build output, vendored and minified files left out, and
  `--exclude`d files too); merge commits are skipped and a tie goes to the earliest
  commit (on the same timestamp, the older one in git order). Without such a commit the
  card is unchanged. In English and Turkish.
- `--exclude <glob>` (repeatable) leaves matching files out of lines added / removed,
  files touched, hot files, languages and the biggest commit, and so out of the per-repo
  breakdown, the team card's lines and the year-over-year lines changed. Gitignore-like
  matching with no new dependencies: `*`, `?` and `**` (`**` crosses folders only as a
  whole path segment; inside a name, as in `src**.js`, it is a plain `*`); a pattern
  without a `/` matches a name at any depth (`*.min.js`, `fixtures`), one with a `/` is
  anchored at the repo root (`src/gen/*.js`), and a matching folder (`docs`, `docs/`,
  `docs/**`) drops everything under it. With several repos a pattern matches the path
  inside its repo, and a path pattern whose first segment has no wildcard (`api/src/`,
  `/web`) also the shown `<repo>/<path>`; a name pattern or one starting with a wildcard
  never matches a repo's label, so `*/generated/` drops the same files as with one repo.
  Commits are never dropped, so commit counts, active days, streaks and habits do not
  change. `stats.json` gets `filters.exclude` (`[]` when none).
- Monthly timeline card ("Month by month"), right after the activity calendar: commits
  per calendar month as bars, with the peak month called out (a tie goes to the earliest
  month) and how many months had commits. It only appears when the commits span two or
  more calendar months, so a history inside one month keeps the same cards as before;
  when it appears, the cards after it shift by one number (`06-months.svg`, hot files
  becomes 07, and so on), so a run now has 10 to 12 cards. It shows the most recent 24
  months at most ("24 months to Apr 2019" for a repo that went quiet more than a month
  ago, like the activity card). Author-local months like the other day-based stats;
  commits dated after tomorrow are left off the card. In English and Turkish, in every
  theme. `stats.json` gets `stats.months`: every month from the first to the last active
  one (`{month: "YYYY-MM", commits}`, zero-filled) and the `peak` month.

## [1.2.0] - 2026-10-06

### Added

- A team card (08, "The team") for repos with two or more contributors: the headcount
  and the top five contributors by commits (counted per email after `.mailmap`, shown by
  git author name only, never an email). With `--author` it ranks you against everyone
  in the same window ("#2 of 7 contributors", your share of commits and lines), reading
  the history a second time without the author filter. When `--max-commits` caps that
  read, everyone is read again from the day of your oldest analyzed commit (same
  filters, cap and repos), so you and the team are ranked over the same span; if that
  is still capped, the ranking covers everyone's most recent N commits, you included,
  and the recap says which of the two applies. Single-author repos, and an
  `--author` with no commits in the window, skip it, so a run has 10 or 11 cards, always
  numbered without gaps.
- `stats.contributors` in `stats.json` (`total`, `top`, `you`, `authorFilter`,
  `truncated`) and a "Team" line in the terminal recap.
- `--lang tr|en` (also `--lang=tr`): the cards, the 1200x630 share image, the PNGs, the
  `wrapped.html` viewer (labels, buttons, aria text, live-region messages,
  `<html lang>`) and the terminal recap in Turkish, with Turkish dates, 24-hour times,
  number and percent formats and Turkish upper-casing. English stays the default and
  its output is unchanged; an unknown code is an error (exit 2). `stats.json` is
  language-neutral and identical for every `--lang`. All strings live in one table per
  language under `src/i18n/`, and a test checks every key exists in every language.
  Language names are kept as they are except "Text" ("Metin" in Turkish) on the
  languages card and in the recap.
- `--theme default|mono|neon` (also `--theme=mono`): color themes for the story cards,
  the PNGs, the share image and the `wrapped.html` viewer chrome. `mono` is grayscale,
  `neon` near-black with one vivid neon glow and accent bar per card; only colors
  change, never the layout. `default` (and no `--theme`) output is byte-identical to
  before; an unknown name is an error (exit 2). Full-opacity white text keeps a WCAG contrast of at
  least 4.5:1 on every `mono` / `neon` background, also under panels and glows.
  `src/cards/themes.js` exports the tables (`COLOR_THEMES`) and `contrastRatio()`.
- Multi-repo Wrapped: `gitwrapped repoA repoB ...` merges several repos' histories into
  one story. Every repo is read with the same `--since` / `--until` / `--year` /
  `--author` filters; `--max-commits` caps the merged history in total. File paths are
  prefixed with the repo's label (its folder name; `app`, `app-2` on a clash), commits
  shared by two repos count once, and the same repository given twice (also as a
  worktree) is an error. The cards name the run "N repos", the intro names the repos,
  and the totals and hot-files cards add per-repo charts (commits and lines per repo,
  files touched per repo; top three plus "+N more" beyond four; the totals card compacts,
  then leaves out, its chart when space is short, e.g. with `--year`, so the commit count stays at
  140px or more; the numbers stay in the recap and `stats.json`). Contributors are
  counted across all the repos. Single-repo output is unchanged.
- In `stats.json` of a multi-repo run: `repo` is `null`, a top-level `repos` lists the
  labels, and `stats.repos` holds the per-repo breakdown (`name`, `commits`,
  `linesAdded`, `linesRemoved`, `filesTouched`, `share`). The terminal recap gets a
  "Repos" block with one line per repo, aligned by terminal columns (emoji and CJK
  labels included).
- Year over year: with `--year`, the year before is read too (same `--author`, repos,
  `.mailmap` and `--max-commits`) and compared on commits, lines changed and active
  days. The totals card adds three "vs <year>" rows with the signed change (`+42`,
  `−3`, `±0`), the outro card opens with a one-line summary, the recap gets a
  "vs <year>" line, and `stats.json` gets `stats.yearOverYear` (`year`, `previousYear`,
  `commits` / `lines` / `activeDays` as `{current, previous, delta}`,
  `previousTruncated`). Nothing is added when either year has no commits, and runs
  without `--year` are unchanged. When `--max-commits` cuts the previous year short the
  recap adds a note; when its read fails, a warning, and the run goes on without the
  comparison.
- Card text keeps no-break spaces (U+00A0) together when wrapping, measured as a space.

## [1.1.0] - 2026-10-06

### Added

- `--until YYYY-MM-DD`: only include commits authored on or before that day
  (inclusive). Combines with `--since`; `--since` after `--until` is an error. git's
  committer-date `--until` is not used: a cheap first `git log` pass of hashes and author
  dates picks the window (and the `--max-commits` cap inside it), and only those
  commits are read in full.
- `--year YYYY` (1970 to 9999): a calendar-year window, the classic Wrapped (same as
  `--since YYYY-01-01 --until YYYY-12-31`). The intro card reads "Your YYYY in git" and
  the share image "My YYYY Git Wrapped".
- Cards, the share image, the `wrapped.html` title and the terminal recap show the
  requested window (e.g. "my-app · 2025", "until Mar 9, 2025"). A long repo name is
  shortened in the footer before the window is.
- For a window that ended before today, the current streak is the one running on the
  window's last day (a complete day, so no grace day), shown as "at window end".
- When a date or author filter matches nothing, the recap names the filters, and an
  oversized `git log` suggests a narrower `--since` / `--until` / `--year` window.
- `--json`: also write `<out>/stats.json` with every computed stat, in a stable,
  documented shape (`schemaVersion`, `generator`, `repo`, `asOf`, `filters`,
  `truncated`, `stats`), with no generation timestamp and no machine paths.
- A **Languages** card (card 7 of 10, after hot files): your top programming language's
  share of the lines you changed ("72% · Mostly TypeScript", "Led by" under 50%, ties named
  as "Tied at the top: Go, JavaScript and Python" or "4-way tie at the top"), bars for
  the top five languages plus "Other", and a one-liner. Data formats and prose (JSON,
  YAML, Markdown, ...) appear in the bars but only lead when there's no code. No share
  reads 100% while other languages exist. Languages come from a built-in table of 86
  languages by file extension and well-known file names (`Dockerfile`, `Makefile`,
  `Gemfile`, `CMakeLists.txt`, ...), skipping the same paths as hot files plus binary
  files. The messages, personality and outro cards move to 08-10; re-running into an
  earlier output folder removes the old-numbered files.
- `stats.languages` in `stats.json` (`totalLines`, `totalFiles`, `basis`, and per
  language `name`, `type`, `lines`, `files`, `share`; equal amounts get equal shares), and
  a "Top language" line in the terminal recap.
- `--open`: open `<out>/wrapped.html` in the default browser when the run is done
  (`open` on macOS, `xdg-open` on Linux and others, `rundll32
  url.dll,FileProtocolHandler <file:// URL>` on Windows, which involves no `cmd.exe`
  quoting). It prints `Opening <path>…` first, starts the opener detached and waits at
  most 1.5 seconds for it, never for the browser. If the opener can't start or exits
  with an error in that time, gitwrapped prints a one-line warning with the path and
  still exits 0.
- CI: a `pack-smoke` job on Linux, macOS and Windows (`npm run pack-smoke`,
  `scripts/pack-smoke.js`) packs the tarball, installs it into a fresh temp project and
  runs the installed `gitwrapped` on the fixture repo, checking the tarball contents, the
  bin link, `--version`, the HTML, SVG cards, PNGs (so the native renderer resolves from
  the install) and `stats.json`.

### Changed

- Privacy: with `--author`, the intro card, share image and `wrapped.html` show only the
  part of the email before the first `@` ("Starring ada."), never an address or domain.
  For `Name <email>` only the name is shown, for a regex alternation (`a@x.io|b@y.io`)
  the first alternative's local part, and nothing at all for `@domain`. `stats.json`
  still records the full value in `filters.author`.
- `--since` now compares each commit's author-local calendar day (the day the stats use)
  instead of the machine's local midnight, so a date window gives the same commits in
  every time zone. `--since` and `--until` ignore surrounding whitespace, like `--year`,
  and dates before 1970 are rejected with a clear message.
- Hot files (and languages) also ignore vendored code in a repo-root `vendor/` or
  `third_party/` folder and test snapshots (`*.snap`, anything under `__snapshots__/`).
- `totals.firstDay` / `totals.lastDay` are now the earliest / latest author-local days,
  so `firstDay <= lastDay` always holds with mixed time-zone offsets (before, they were
  the days of the earliest / latest instants).
- The activity card of a repo that went quiet more than 30 days ago reads "12 months to
  <Mon YYYY>" instead of "Your last 12 months".
- Viewer accessibility: the story is a `region` with the "carousel" role description,
  the pause button uses only `aria-label` (no `aria-pressed` alongside it), single-key
  shortcuts are ignored while typing in a text field, and every card has a
  screen-reader text version of its content (linked with `aria-describedby`).
- An empty run on a HEAD without commits (a new or orphan branch) while other branches
  or tags exist adds a note that only HEAD is read, suggesting to check out a branch.

### Fixed

- A future-dated commit (clock skew, e.g. 2099) no longer resets the current streak or
  stretches the activity calendar past tomorrow, the date range on the cards (intro,
  footers, share image), the longest streak shown on the cards and in the recap, or the
  Steady Shipper span and streak: days after tomorrow are left out. `stats.json` and the
  totals still count them.
- The Steady Shipper span no longer drops to 0 days when offsets put the earliest
  commit's day after the latest one's.
- The recap prints `0` instead of `−0` / `+0` for zero (or rounded-to-zero, or invalid
  negative) line counts, like the cards.
- Bidi embedding / override / isolate controls (U+202A–202E, U+2066–2069) and the
  Unicode line / paragraph separators are stripped from the recap, the cards and the
  `wrapped.html` title / heading, so a commit message or repo name cannot visually
  reorder text. Card text measures them as zero width, so truncation matches what is
  drawn.
- `--since` in the first week of 1970 no longer sends git a pre-1970 bound it cannot parse.
- `--no-png` no longer deletes `share.png` / `png/NN-<card>.png` in an `--out` folder that
  gitwrapped did not create (one without a `wrapped.html` from an earlier run).
- Output is never written or deleted through a symlink inside `--out`: a symlinked output
  file or `cards/` / `png/` folder stops the run with a clear error before anything is
  written, and cleanup only removes regular files.
- In `wrapped.html`, hovering a calendar day or chart bar with a mouse shows its tooltip
  again (the tap zones no longer sit on top of the card for hover-capable pointers).

## [1.0.0] - 2026-10-05

First public release on npm as `@furkycl/gitwrapped`.

### Added

- `gitwrapped [path]` CLI, runnable with `npx @furkycl/gitwrapped`. Options: `--since YYYY-MM-DD`,
  `--author <email>`, `--out <dir>`, `--max-commits <n>`, `--no-png`, `--no-color`,
  `-h`/`--help` and `-v`/`--version`. Honors `NO_COLOR` and `FORCE_COLOR`.
- Git history reading with a single `git log --numstat` call: hash, author, `.mailmap`
  email, date, parents, subject and per-file line counts. Authors are counted by their
  `.mailmap` identity.
- Stats: totals (commits, lines added and removed, active days, files touched,
  contributors), time habits by hour and weekday in each commit's author-local time,
  longest and current streaks, commits per day, hot files (lockfiles and build output
  ignored), commit message stats, and a rule-based personality (Night Owl, Early Bird,
  Friday Deployer, Fixaholic, Weekend Warrior or Steady Shipper) with a one-line roast.
- Nine 1080x1920 SVG story cards: Intro, Totals, Power hour (24-hour and weekday charts),
  Streak, Activity (a GitHub-style calendar heatmap of up to 53 weeks), Hot files,
  Message hall of fame, Personality and Outro. No external fonts.
- `wrapped.html`: a self-contained offline story viewer with a strict
  Content-Security-Policy. Story progress bars, tap/click, keyboard and swipe navigation,
  pause and hold, `#N` deep links, reduced-motion support, per-card PNG and SVG download,
  a Share button where the system share sheet is available, accessibility labels, and a
  `?` shortcut help panel.
- PNG export of every card via `@resvg/resvg-js`, plus a 1200x630 `share.png` (and
  `share.svg`) summary image. If no prebuilt resvg binary is available, PNG export is
  skipped with a message and the SVG cards and `wrapped.html` are still written.
- Terminal recap after each run (commits, active days, lines, power hour, streak, hottest
  file, top word, personality), in color on a terminal and plain when piped. The first
  output line is `gitwrapped: N commits → <out>/wrapped.html`.
- Edge-case handling: an empty repo or a filter that matches nothing still produces a
  full card set and exits 0; single-commit repos work; at most 50,000 recent commits are
  analyzed by default (`--max-commits` changes this); a missing path, a file or a folder
  that is not a git repository exits 1 with a one-line error; missing `git` and
  "dubious ownership" errors get a clear message.
- CI on Linux, macOS and Windows with Node 20 and 22.

### Fixed

- `--since` keeps every commit authored on or after the date, even behind older commits.
- Merge commits are skipped in message stats and the Fixaholic share.
- Submodule bumps are not counted as file edits.
- In shallow clones, the oldest fetched commit's line counts are skipped instead of
  counting the whole tree as added.
- On macOS, color emoji are left out of PNG exports, because resvg drew Apple Color Emoji
  far from their text. SVG cards and `wrapped.html` keep them.

[Unreleased]: https://github.com/furkycl/gitwrapped/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/furkycl/gitwrapped/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/furkycl/gitwrapped/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/furkycl/gitwrapped/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/furkycl/gitwrapped/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/furkycl/gitwrapped/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/furkycl/gitwrapped/releases/tag/v1.0.0
