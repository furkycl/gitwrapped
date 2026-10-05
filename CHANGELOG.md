# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- `--since` now compares each commit's author-local calendar day (the day the stats use)
  instead of the machine's local midnight, so a date window gives the same commits in
  every time zone.
- `--since` (and `--until`) dates before 1970 are rejected with a clear message.

### Fixed

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
