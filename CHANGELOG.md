# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `--exclude <glob>` (repeatable) leaves matching files out of lines added / removed,
  files touched, hot files and languages, and so out of the per-repo breakdown, the
  team card's lines and the year-over-year lines changed. Gitignore-like matching with
  no new dependencies: `*`, `?` and `**`; a pattern without a `/` matches a name at any
  depth (`*.min.js`, `fixtures`), one with a `/` is anchored at the repo root
  (`src/gen/*.js`), and a matching folder (`docs`, `docs/`, `docs/**`) drops everything
  under it. With several repos a pattern matches the path inside its repo, and a path
  pattern (with a `/`) also the shown `<repo>/<path>`. Commits are never dropped, so commit counts, active days, streaks
  and habits do not change. `stats.json` gets `filters.exclude` (`[]` when none).
- Monthly timeline card ("Month by month"), right after the activity calendar: commits
  per calendar month as bars, with the peak month called out (a tie goes to the earliest
  month) and how many months had commits. It only appears when the commits span two or
  more calendar months, so a history inside one month keeps the same cards as before; it
  shows the most recent 24 months at most. Author-local months like the other day-based
  stats; commits dated after tomorrow are left off the card. In English and Turkish, in
  every theme. `stats.json` gets `stats.months`: every month from the first to the last
  active one (`{month: "YYYY-MM", commits}`, zero-filled) and the `peak` month.

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

[Unreleased]: https://github.com/furkycl/gitwrapped/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/furkycl/gitwrapped/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/furkycl/gitwrapped/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/furkycl/gitwrapped/releases/tag/v1.0.0
