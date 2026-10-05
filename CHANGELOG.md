# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CI: a `pack-smoke` job on Linux, macOS and Windows (`npm run pack-smoke`,
  `scripts/pack-smoke.js`) packs the tarball, installs it into a fresh temp project and
  runs the installed `gitwrapped` on the fixture repo, checking the tarball contents, the
  bin link, `--version`, the HTML, SVG cards, PNGs (so the native renderer resolves from
  the install) and `stats.json`.
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
  reads 100% while other languages exist. Languages come from a built-in table of about
  85 languages by file extension and well-known file names (`Dockerfile`, `Makefile`,
  `Gemfile`, `CMakeLists.txt`, ...). The messages, personality and outro cards move to
  08-10; re-running into an earlier output folder removes the old-numbered files.
- `stats.languages` in `stats.json` (`totalLines`, `totalFiles`, `basis`, and per
  language `name`, `type`, `lines`, `files`, `share`; equal amounts get equal shares), and
  a "Top language" line in the terminal recap.
- `--open`: open `<out>/wrapped.html` in the default browser when the run is done and
  print `Opening <path>` (`open` on macOS, `xdg-open` on Linux and others, `rundll32
  url.dll,FileProtocolHandler <file:// URL>` on Windows, which involves no `cmd.exe`
  quoting). The opener is started detached and never blocks the run; if it can't start,
  gitwrapped prints a one-line warning with the path and still exits 0.

### Changed

- Hot files (and languages) also ignore vendored code in a repo-root `vendor/` or
  `third_party/` folder and test snapshots (`*.snap`, anything under `__snapshots__/`).

- `--since` now compares each commit's author-local calendar day (the day the stats use)
  instead of the machine's local midnight, so a date window gives the same commits in
  every time zone.
- `--since` (and `--until`) dates before 1970 are rejected with a clear message.
- Privacy: with `--author`, the intro card, share image and `wrapped.html` show only the
  part of the email before the `@` ("Starring ada."), never the full (or upper-cased)
  address. `stats.json` still records the full email in `filters.author`.
- `--open` prints `Opening <path>…` first, then waits up to 1.5 seconds for the opener
  command (`xdg-open`, `open`, `rundll32`) and warns when it exits with an error in that time, not only when it
  cannot be started. It never waits for the browser.
- `totals.firstDay` / `totals.lastDay` are now the earliest / latest author-local days,
  so `firstDay <= lastDay` always holds with mixed time-zone offsets (before, they were
  the days of the earliest / latest instants).
- The activity card of a repo that went quiet more than 30 days ago reads "12 months to
  <Mon YYYY>" instead of "Your last 12 months".
- `--since` / `--until` ignore surrounding whitespace, like `--year`.
- Viewer accessibility: the story is a `region` with the "carousel" role description,
  the pause button uses only `aria-label` (no `aria-pressed` alongside it), single-key
  shortcuts are ignored while typing in a text field, and every card has a
  screen-reader text version of its content (linked with `aria-describedby`).
- An empty run on a HEAD without commits (a new or orphan branch) while other branches
  or tags exist adds a note that only HEAD is read, suggesting to check out a branch.

### Fixed

- A `--no-png` run (or one without the PNG renderer) deleted `share.png` and
  `png/NN-<card>.png` from any `--out` folder, even one gitwrapped had never written.
  Stale PNGs are now only removed when the folder already holds a `wrapped.html`.
- Output never follows symlinks: if `wrapped.html`, `share.*`, `stats.json`, `cards/`,
  `png/` or a card file inside `--out` is a symlink, the run stops with an error before
  writing anything (a repo could otherwise commit `gitwrapped-out/share.svg -> ...` to
  overwrite another file). The default `gitwrapped-out` folder itself must not be a
  symlink either (a repo could commit one); a `--out` you pass may be one, and a broken
  one gets a clear error. On POSIX, output files are opened with `O_NOFOLLOW`. Cleanup
  never follows or deletes symlinks.
- Future-dated commits (e.g. 2099): the current streak is the run that reaches today or
  yesterday (or an author-local tomorrow), counted up to that day, instead of the run
  ending on the latest commit day, so one bad date no longer hides today's streak. The
  activity calendar ends today rather than being pushed into the future; those days
  still count in the totals (the activity card notes "+N future-dated days not shown").
- Hover tooltips on cards in `wrapped.html` (bar counts, calendar days) now show: the
  invisible tap-zone buttons no longer cover the card (taps are placed by position, as
  before: left third back, the rest forward). The buttons stay for keyboard and
  screen-reader users.
- The Steady Shipper span no longer drops to 0 days when offsets put the earliest
  commit's day after the latest one's.
- The recap prints `0` instead of `−0` / `+0` for zero lines, like the cards.
- Bidi embedding / override / isolate controls (U+202A–202E, U+2066–2069) and the
  Unicode line / paragraph separators are stripped from the recap and the cards, so a
  commit message cannot visually reorder text.
- README: the built-in language count is exact (86).
- `--since` in the first week of 1970 no longer sends git a pre-1970 bound it cannot parse.

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

[Unreleased]: https://github.com/furkycl/gitwrapped/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/furkycl/gitwrapped/releases/tag/v1.0.0
