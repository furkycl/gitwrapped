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
    - [ ] HIGH/MED: --no-png stale-PNG cleanup outside owned out dir, symlinked output targets, future-dated commits vs current streak/activity window, viewer hover tooltips blocked by tap zones
    - [ ] LOW: --author email privacy on images, --open non-zero exit, dormant-repo activity copy, steady-shipper span with mixed offsets, recap nits (−0, bidi chars), viewer a11y
  - [ ] CHANGELOG 1.1.0 + version bump, regenerate docs/self-wrapped + hero GIF (10 cards), README in sync
