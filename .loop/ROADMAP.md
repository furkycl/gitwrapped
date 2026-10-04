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
- [ ] Streaks: longest daily streak and current streak
- [ ] Hot files: most-edited files (top 5), ignoring lockfiles and build output
- [ ] Commit messages: shortest, longest, most repeated word, count of "fix"/"wip"/"oops"
- [ ] Commit personality: rule-based archetypes (Night Owl, Early Bird, Friday Deployer, Fixaholic, Weekend Warrior, Steady Shipper) with a one-line roast each

## M4 — Cards
- [ ] Card renderer: 1080x1920 SVG story cards, bold gradient style, no external fonts needed
- [ ] Card set: intro, totals, peak hour, streak, hot files, message hall of fame, personality, outro
- [ ] HTML viewer: one self-contained `wrapped.html` with tap/arrow-key story navigation
- [ ] PNG export via `@resvg/resvg-js` (one PNG per card + a 1200x630 share summary)

## M5 — Polish & launch
- [ ] Terminal output: short colorful summary in the console after generating
- [ ] Edge cases: empty repo, single commit, huge repo (cap at 50k commits with notice), non-git folder error
- [ ] README: hero GIF placeholder, install, usage, examples, "built by an autonomous agent loop" section
- [ ] Run gitwrapped on this very repo and commit its cards to `docs/self-wrapped/`
- [ ] `npm publish` readiness: package.json fields, files whitelist, `npm pack --dry-run` clean
