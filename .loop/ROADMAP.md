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
- [x] `--md`: also write `<out>/wrapped.md`, a Markdown summary (headline numbers, peak hour, streaks, hot files, languages, personality; links the card SVGs) for READMEs and PR descriptions, localized via `--lang`, no emails; tests
- [x] Commit size mix: share of tiny (<10 lines) / small / medium / large (>500 lines) non-merge commits (same ignore rules as hot files) on the totals or messages card, stats.json `stats.commitSizes`; tests
- 1.4.0 release prep (split in turn 043):
  - [x] Cold audit of the 1.4 work (longest break, --md, commit size mix; diff 97545d0..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.4.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M11 — 1.5 (proposed by loop turn 044 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Conventional-commit mix: share of feat/fix/docs/refactor/test/chore/other subjects (`type(scope)!:` prefix, case-insensitive) on the messages card when ≥20% of commits use the convention, stats.json `stats.commitTypes`, recap and wrapped.md; en/tr; tests
- [x] First commit: the first commit in the window (day, subject, short hash) on the intro card ("It all began with …") and in stats.json `stats.firstCommit`, recap and wrapped.md; emails never shown; en/tr; tests
- [x] Co-authors: count `Co-authored-by:` trailers per commit (after .mailmap, names only) — "N commits paired" on the totals or team card, top co-author, stats.json `stats.coAuthors`; en/tr; tests
- 1.5.0 release prep (split as before):
  - [x] Cold audit of the 1.5 work (diff 1.4.0 release commit..main) + fix every real bug found, with tests — known lead from turn 046: `stats.messages` longest/shortest subjects (stats.json) and the viewer's screen-reader text (wrapped.html) still carry raw emails, and the biggest-commit card/recap subject is not scrubbed; route them through src/privacy.js scrubEmails
  - [x] CHANGELOG 1.5.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M12 — 1.6 (proposed by loop turn 050 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Releases shipped: tags (lightweight + annotated, peeled to their commit) pointing at analyzed commits in the window — count, first and latest tag name + day — on the outro card ("You shipped N releases"), stats.json `stats.releases`, recap and wrapped.md; multi-repo summed (repo-prefixed names); en/tr; tests
- [x] Commit emoji: share of subjects with an emoji (incl. `:gitmoji:` shortcodes) and the top 3 emoji on the messages card when ≥5% of commits use one, stats.json `stats.emoji`, recap and wrapped.md; en/tr; tests
- [x] Reverts: commits that revert another (`Revert "…"` subject or `This reverts commit <hash>` body), count + share, folded into the messages card and the Fixaholic roast, stats.json `stats.reverts`, recap and wrapped.md; en/tr; tests
- 1.6.0 release prep (split as before):
  - [x] Cold audit of the 1.6 work (diff 1.5.0 release commit..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.6.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M13 — 1.7 (proposed by loop turn 054 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Busiest day: the single day with the most commits in the window (author-local day, count, ties → earliest) called out on the activity card, stats.json `stats.busiestDay`, recap and wrapped.md; en/tr; tests
- [x] Files born and buried: files added vs deleted in the window (from `--name-status`/`--diff-filter=AD` in the same log read or one extra call, same ignore rules as hot files, renames not counted) as a row on the totals card when there's room, stats.json `stats.fileLifecycle {added, deleted}`, recap and wrapped.md; en/tr; tests
- [x] Time zones: distinct author UTC offsets in the window and the most common one, "Committed from N time zones" on the power-hour card when N ≥ 2, stats.json `stats.timezones`, recap and wrapped.md; en/tr; tests
- 1.7.0 release prep (split as before):
  - [x] Cold audit of the 1.7 work (diff 1.6.0 release commit..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.7.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M14 — 1.8 (proposed by loop turn 059 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Top folders: the most-changed top-level directories by lines changed (same ignore rules / `--exclude` as hot files, root files grouped as "(root)", multi-repo repo-prefixed) as a row or small list on the hot-files card when there's room, stats.json `stats.folders`, recap and wrapped.md; en/tr; tests
- [x] Weekend share: share of commits on Saturday/Sunday (author-local) as a line on the power-hour or activity card when it fits, stats.json `stats.weekend {commits, share}`, recap and wrapped.md; consistent with the Weekend Warrior fact; en/tr; tests
- [x] Cadence: average commits per active day and median gap (days) between active days on the streak card when there's room, stats.json `stats.cadence {perActiveDay, medianGapDays}`, recap and wrapped.md; en/tr; tests
- 1.8.0 release prep (split as before):
  - [x] Cold audit of the 1.8 work (diff 1.7.0 release commit..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.8.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M15 — 1.9 (proposed by loop turn 064 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Relative windows: `--since`/`--until` also accept `30d`, `12w`, `6m`, `1y` (relative to today, author-local), mutually exclusive with `--year` as today; cards/recap show the resolved dates; `--help`/README; tests
- [x] Merges: merge commits in the window — count, share, and pull requests merged (`Merge pull request #N` / `(#N)` squash subjects, deduped) on the totals or outro card when there's room, stats.json `stats.merges {commits, share, pullRequests}`, recap and wrapped.md; en/tr; tests
- [x] Late nights: share of commits between 00:00 and 04:59 author-local and the latest-ever commit time (day + HH:MM, no emails) on the power-hour card when there's room, consistent with the Night Owl fact, stats.json `stats.lateNights {commits, share, latest}`, recap and wrapped.md; en/tr; tests
- 1.9.0 release prep (split as before):
  - [x] Cold audit of the 1.9 work (diff 1.8.0 release commit..main) + fix every real bug found, with tests
  - [x] CHANGELOG 1.9.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync

## M16 — 1.10 (proposed by loop turn 069 per the M8 owner note "do not finish the loop"; owner may prune)
- [x] Night power hour: when the power hour is at night (22–04) the quip makes a 4-line subtitle and the Late nights row never fits — swap/shorten the night quip (e.g. fold the late-nights fact into the subtitle) so night owls actually see their late-night stat on the power-hour card; byte-identical for day power hours; en/tr; tests
- [x] Test share: share of changed lines in test files (`test/`, `tests/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`, `*_test.*`, same ignore rules / `--exclude` as hot files) as a row on the hot-files or languages card when there's room, stats.json `stats.tests {lines, share}`, recap and wrapped.md; en/tr; tests
- [ ] Office hours: share of weekday commits between 09:00 and 17:59 author-local vs outside, as a row on the activity or power-hour card when there's room, consistent with habits.byHour/byWeekday, stats.json `stats.officeHours {commits, share}`, recap and wrapped.md; en/tr; tests
- 1.10.0 release prep (split as before):
  - [ ] Cold audit of the 1.10 work (diff 1.9.0 release commit..main) + fix every real bug found, with tests
  - [ ] CHANGELOG 1.10.0 + version bump, regenerate docs/self-wrapped (`git fetch --unshallow` first) + hero GIF, README in sync
