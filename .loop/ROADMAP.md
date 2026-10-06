# ROADMAP

Legend: `[ ]` todo · `[x]` done · `[!]` blocked (reason on the same line)

## M1 — Skeleton
- [x] Init npm package `gitwrapped` (ESM, `bin: gitwrapped`), `npm test` with `node:test`, `.gitignore`, MIT LICENSE
- [x] CLI entry: `gitwrapped [path] [--since YYYY-MM-DD] [--author email] [--out dir]` with `--help` and `--version`
- [x] GitHub Actions CI: run `npm test` on push and PR (Node 20 and 22)

## M2 — Git parser
- [x] Read commits via `git log` with a stable delimiter format (hash, author, email, ISO date, subject)
- [x] Read per-commit file stats via `--numstat` (files changed, lines added/removed)
- [x] Fixture repos for tests: script that builds a tiny throwaway repo with known commits

## M3 — Stats engine
- [x] Totals: commits, active days, lines added/removed, files touched
- [x] Time habits: commits by hour and weekday, "peak hour"
- [x] Streaks: longest daily streak and current streak
- [x] Hot files: most-edited files (top 5), ignoring lockfiles and build output
- [x] Commit messages: shortest, longest, most repeated word, count of "fix"/"wip"/"oops"
- [x] Commit personality: rule-based archetypes (Night Owl, Early Bird, Friday Deployer, Fixaholic, Weekend Warrior, Steady Shipper) with a one-line roast each

## M4 — Cards
- [x] Card renderer: 1080x1920 SVG story cards, bold gradient style, no external fonts needed
- [x] Card set: intro, totals, peak hour, streak, hot files, message hall of fame, personality, outro
- [x] HTML viewer: one self-contained `wrapped.html` with tap/arrow-key story navigation
- [x] PNG export via `@resvg/resvg-js` (one PNG per card + a 1200x630 share summary)

## M5 — Polish & launch
- [x] Terminal output: short colorful summary in the console after generating
- [x] Edge cases: empty repo, single commit, huge repo (cap at 50k commits with notice), non-git folder error
- [x] README: hero GIF placeholder, install, usage, examples, "built by an autonomous agent loop" section
- [x] Run gitwrapped on this very repo and commit its cards to `docs/self-wrapped/`
- [x] `npm publish` readiness: package.json fields, files whitelist, `npm pack --dry-run` clean

## M6 — Launch polish (owner request, 2026-10-05)
- [x] System audit: cold review of the whole codebase, fix every real bug found (with tests)
- [x] Rename npm package to `@furkycl/gitwrapped` (`gitwrapped` on npm belongs to someone else); command stays `gitwrapped`
- [x] Card design v2: hour-of-day + weekday bar charts on the power-hour card, fuller layouts, no decoration overlapping content, no duplicated footer text
- [x] Activity heatmap card: GitHub-style calendar of commits per day
- [x] Viewer polish: wrapped.html design, card download/share actions, accessibility pass
- [x] Hero GIF in `docs/hero.gif`, regenerate `docs/self-wrapped/`, README refresh
- v1.0.0 readiness (split in turn 019):
  - [x] CI on Linux/macOS/Windows × Node 20/22, suite passes on all six
  - [x] Fix macOS PNG emoji misplacement (resvg-js 2.6.2 draws Apple Color Emoji ~830px off; see README known issue and test/png.test.js darwin swap) — e.g. strip/replace emoji in PNG text on darwin or upgrade resvg once 2.7 is stable; drop the test workaround
  - [x] CHANGELOG.md + tag-triggered npm publish workflow (`v*` tags, needs `NPM_TOKEN` secret) + version bump to 1.0.0

## M7 — Feature-complete 1.1 (owner request, 2026-10-05: keep improving, leave nothing missing)
- [x] `--until YYYY-MM-DD` and `--year YYYY` (calendar-year window, the classic "Wrapped"); cards/recap show the requested window; tests
- [x] `--json`: write `<out>/stats.json` with every computed stat (stable, documented shape); tests
- [x] Languages card: top languages by lines changed (extension → language map, ignores lockfiles/build output), new card in the story, viewer/PNG/hero updated; tests
- [x] `--open`: open `wrapped.html` in the default browser after generating (open/xdg-open/start, no network, failure is a warning); tests
- [x] Packed-tarball smoke test: CI job that `npm pack`s, installs the tarball in a temp dir and runs `gitwrapped` on a fixture repo on all three OSes
- 1.1.0 release prep (split in turn 024):
  - Fix the pre-1.1.0 cold audit findings (see STATE turn 024 note) — split in turn 025:
    - [x] HIGH/MED: --no-png stale-PNG cleanup outside owned out dir, symlinked output targets, future-dated commits vs current streak/activity window, viewer hover tooltips blocked by tap zones
    - [x] LOW: --author email privacy on images, --open non-zero exit, dormant-repo activity copy, steady-shipper span with mixed offsets, recap nits (−0, bidi chars), viewer a11y, future-dated commits still stretch the footer date range + steady-shipper span
  - [x] CHANGELOG 1.1.0 + version bump, regenerate docs/self-wrapped + hero GIF (10 cards), README in sync

## M8 — 1.2: more Wrapped (owner request, 2026-10-06: keep developing, do not finish the loop)
- [x] Contributors card for team repos: top contributors by commits/lines (after .mailmap), "you vs the team" when `--author` is set; skipped for single-author repos; stats.json + recap; tests
- [x] `--lang tr|en`: localized card, share image, viewer and recap text (English default, Turkish first translation, string table in src/i18n/); tests that every key exists in every language
- [x] `--theme`: alternative color themes for the cards (default gradient set + at least "mono" and "neon"), applied to SVG/PNG/share/viewer; layout and contrast tests
- [x] Multi-repo Wrapped: `gitwrapped repoA repoB ...` merges histories (per-repo breakdown on the totals/hot-files cards, repo-prefixed paths); tests
- [x] Year-over-year: with `--year`, compare against the previous year on the totals and outro cards (+/- commits, lines, active days); tests
- 1.2.0 release prep (split in turn 033):
  - [x] Cold audit of the 1.2 work (contributors, --lang, --theme, multi-repo, year-over-year; diff e33281b..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.2.0 + version bump, regenerate docs/self-wrapped + hero GIF, README in sync

## M9 — 1.3 (proposed by loop turn 034 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] `--exclude <glob>` (repeatable): drop matching paths from lines, files touched, hot files and languages (simple `*`/`**` matcher, no deps); stats.json `filters.exclude`; tests
- [x] Monthly timeline card: commits per month across the window (bars, peak month called out), localized en/tr, all themes; stats.json `stats.months`; tests
- [x] Biggest commit: largest commit by lines changed (subject, date, +/−) on the messages card and in stats.json/recap, ignoring the same paths as hot files; tests
- 1.3.0 release prep (split in turn 038):
  - [x] Cold audit of the 1.3 work (--exclude, monthly timeline card, biggest commit; diff 6bb9c58..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.3.0 + version bump, regenerate docs/self-wrapped (run `git fetch --unshallow` first — loop clones are shallow) + hero GIF, README in sync

## M10 — 1.4 (proposed by loop turn 039 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Longest break: the longest gap between two consecutive active days in the window (from/to dates, days) on the streak card, stats.json `stats.streaks.longestBreak` and recap; localized en/tr; tests
- [ ] `--md`: also write `<out>/wrapped.md`, a Markdown summary (headline numbers, peak hour, streaks, hot files, languages, personality; links the card SVGs) for READMEs and PR descriptions, localized via `--lang`, no emails; tests
- [ ] Commit size mix: share of tiny (<10 lines) / small / medium / large (>500 lines) non-merge commits (same ignore rules as hot files) on the totals or messages card, stats.json `stats.commitSizes`; tests
- [ ] 1.4.0 release prep: cold audit of the 1.4 work + fixes, CHANGELOG 1.4.0, bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync (split if too big)
