# gitwrapped

[![CI](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml)

**Spotify Wrapped, but for your git history.** Run one command in any repo and get a
set of shareable story cards. Everything runs locally, and you don't need an API key.

```bash
npx @furkycl/gitwrapped
```

<p align="center">
  <img src="docs/hero.gif" width="360" alt="gitwrapped's nine story cards playing one after another, like a story reel">
</p>

See gitwrapped's own Wrapped: [docs/self-wrapped/](docs/self-wrapped/) has the cards from
running it on this repo, plus the 1200x630 [`share.png`](docs/self-wrapped/share.png)
summary image it made for link previews.

## What you get

Ten 1080x1920 story cards:

1. **Intro**: the repo name, the date range in plain English ("Oct 4 – Oct 5, 2026") and how many commits there are to unwrap, plus whose story it is when you pass `--author`.
2. **Totals**: commits, a lines added vs. removed bar, active days and files touched (and contributors, when there is more than one).
3. **Power hour**: the hour of the day you commit the most, with a 24-hour bar chart and a Monday-to-Sunday weekday chart (hover a bar in `wrapped.html` for its count).
4. **Streak**: your longest run of consecutive days with a commit, with a longest vs. current bar comparison.
5. **Activity**: a GitHub-style calendar of commits per day (weeks as rows, Monday to Sunday, brighter the busier the day), with your number of active days and your busiest day. Hover a day in `wrapped.html` for its count. It covers up to the last 53 weeks of your history.
6. **Hot files**: the five files you edit most as a bar list. Lockfiles, build output (`dist/`, `build/`, ...), dependency folders, vendored code (a root `vendor/` or `third_party/`), minified files and test snapshots (`*.snap`, `__snapshots__/`) are ignored.
7. **Languages**: your top programming language and its share of the lines you changed ("72% · Mostly TypeScript", or "Led by" under half, with ties named), with bars for your top five languages plus "Other". Data formats (JSON, YAML, ...) and prose (Markdown, ...) show in the bars, but they only lead the card when there's no code at all. Languages come from file extensions and well-known names like `Dockerfile` and `Makefile` (about 85 built in); lockfiles, build output, vendored code, test snapshots and binary files are left out, as for hot files.
8. **Message hall of fame**: your favorite word, your longest and shortest messages, and how many "fix", "wip" and "oops" commits you made.
9. **Personality**: Night Owl, Early Bird, Friday Deployer, Fixaholic, Weekend Warrior or Steady Shipper, with a one-line roast and bars for your top habit scores.
10. **Outro**: a summary card to post: commits, power hour, best streak and personality tiles, plus your hottest file.

You also get:

- **`wrapped.html`**: one self-contained story viewer that works offline and from `file://`.
  It shows story-style progress bars. Tap or click the right side (or press → or Space)
  to go forward, and the left side (or ←) to go back. Home and End jump to the first and
  last card, and you can swipe on touch screens. To pause auto-advance, press and hold
  the card, use the pause button, or press P or K. You can link to a card with
  `wrapped.html#3`. Auto-advance is off when your system prefers reduced motion.
  A toolbar under the story shows which card you're on (for example `3 / 10`) and saves the
  current card. **PNG** (or press D) downloads it as a 1080x1920 `NN-<card>.png`, drawn
  in your browser. If the browser can't draw it, you get the SVG instead. **SVG**
  downloads `NN-<card>.svg`. **Share** appears only where the browser supports the
  system share sheet. It shares the PNG when it can, and otherwise the title text, never
  a link. Press **?** (or the ? button) for the list of keyboard shortcuts.
- **PNGs**: each card as a 1080x1920 PNG, plus a 1200x630 `share.png` summary for link
  previews and social posts.
- **Terminal recap**: commits, active days, lines, power hour, streak, hottest file,
  top language, top word and personality, printed right after the run.
- **JSON** (optional, `--json`): every computed stat in `stats.json`, for your own
  dashboards and scripts.

```
gitwrapped-out/
  wrapped.html          # the story: open it in any browser
  cards/01-intro.svg    # 01-intro … 10-outro, 1080x1920 SVG
  png/01-intro.png      # the same cards as PNG, ready to post
  share.png             # 1200x630 summary image
  share.svg             # the same summary as SVG
  stats.json            # only with --json: every stat as JSON
```

## Install

```bash
npx @furkycl/gitwrapped        # run without installing
npm i -g @furkycl/gitwrapped   # or install the `gitwrapped` command globally
```

The package is published under the `@furkycl` scope. The unscoped `gitwrapped` package
on npm is a different project. Either way, the installed command is `gitwrapped`.

Requirements:

- **Node.js >= 20**
- **`git`** on your PATH
- PNG export uses [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js), a prebuilt
  native module and the only dependency. If no prebuilt binary is available for your
  platform, gitwrapped prints `PNG export skipped: <reason>` and still writes the SVG
  cards and `wrapped.html`.

## Usage

```bash
gitwrapped [path] [options]
```

| Argument / option     | What it does                                                                           |
|-----------------------|----------------------------------------------------------------------------------------|
| `path`                | Path to the git repository (default: `.`; an empty path also means `.`)               |
| `--since YYYY-MM-DD`  | Only include commits made on or after this day (the author's local calendar day)       |
| `--until YYYY-MM-DD`  | Only include commits made on or before this day, inclusive (the author's local calendar day) |
| `--year YYYY`         | One calendar year, the classic Wrapped: same as `--since YYYY-01-01 --until YYYY-12-31` (can't be combined with them) |
| `--author <email>`    | Only include commits by this author email (exact, case-insensitive match against the email after `.mailmap` is applied) |
| `--out <dir>`         | Output directory (default: `gitwrapped-out`, created if needed)                        |
| `--max-commits <n>`   | Analyze at most the n most recent commits that match the other filters (default: 50000) |
| `--no-png`            | Skip PNG rendering (faster; SVG + HTML only)                                           |
| `--json`              | Also write every computed stat to `<out>/stats.json` (see [JSON output](#json-output)) |
| `--open`              | Open `<out>/wrapped.html` in your default browser when done and print `Opening <path>` (`open` on macOS, `xdg-open` on Linux, `rundll32 url.dll,FileProtocolHandler <file:// URL>` on Windows). If that fails, gitwrapped prints a one-line warning with the path and still exits 0 |
| `--no-color`          | Plain console output (also: `NO_COLOR=1`; `FORCE_COLOR=1` forces color)               |
| `-h`, `--help`        | Show help and exit                                                                     |
| `-v`, `--version`     | Show the version and exit                                                              |

On success, the first line of output is `gitwrapped: N commits → <out>/wrapped.html`, which
is easy to grep. The recap is in color on a terminal and plain when piped.

## Examples

```bash
# This year only
npx @furkycl/gitwrapped --since 2026-01-01

# Your 2025 in git (Jan 1 – Dec 31)
npx @furkycl/gitwrapped --year 2025

# A custom window: the first quarter
npx @furkycl/gitwrapped --since 2026-01-01 --until 2026-03-31

# Generate and open the story in your browser right away
npx @furkycl/gitwrapped --open

# Also export the raw numbers as JSON
npx @furkycl/gitwrapped --json

# Just you, in a shared repo
npx @furkycl/gitwrapped --author you@example.com

# Another repo, into a folder of your choice
npx @furkycl/gitwrapped ~/code/my-app --out ~/Desktop/my-app-wrapped

# Fast mode: skip PNG rendering
npx @furkycl/gitwrapped --no-png

# CI or logs: no color, first line is machine-friendly
NO_COLOR=1 npx @furkycl/gitwrapped --no-png | head -1
```

## JSON output

With `--json`, gitwrapped also writes `<out>/stats.json`: 2-space indented, with a fixed
key order and no generation timestamp, so the same history, options and `asOf` day give
the same file. It contains no paths from your machine (`repo` is just the folder name),
but it does contain commit subjects and hashes and repo-relative file paths (see
[Privacy](#privacy)).

| Key             | What it holds                                                                 |
|-----------------|-------------------------------------------------------------------------------|
| `schemaVersion` | `1`; bumped only when a key is removed or changes meaning                     |
| `generator`     | `{"name": "@furkycl/gitwrapped", "version": "<version>"}`                     |
| `repo`          | The repository's folder name                                                  |
| `asOf`          | `YYYY-MM-DD` the current streak is counted up to: today, or the end of a past `--until` / `--year` window |
| `filters`       | `{since, until, author, maxCommits}` as used (`--year` shows as since/until); dates and author are `null` when not set, `maxCommits` is the cap in effect |
| `truncated`     | `true` when `--max-commits` cut the history short                             |
| `stats`         | Every computed stat: `totals`, `habits`, `streaks`, `daily`, `hotFiles`, `languages`, `messages`, `personality` |

```json
{
  "schemaVersion": 1,
  "generator": { "name": "@furkycl/gitwrapped", "version": "1.0.0" },
  "repo": "my-app",
  "asOf": "2025-12-31",
  "filters": { "since": "2025-01-01", "until": "2025-12-31", "author": null, "maxCommits": 50000 },
  "truncated": false,
  "stats": {
    "totals": { "commits": 412, "activeDays": 131, "linesAdded": 30211, "...": "..." },
    "streaks": { "longest": { "length": 9, "start": "2025-03-02", "end": "2025-03-10" }, "...": "..." },
    "languages": {
      "totalLines": 41020, "totalFiles": 212, "basis": "lines",
      "languages": [{ "name": "TypeScript", "type": "programming", "lines": 29534, "files": 140, "share": 72 }, "..."]
    },
    "...": "..."
  }
}
```

`stats.languages` lists every language found, most lines first, with `"Other"` (file
types gitwrapped doesn't know) always last. `type` is `"programming"`, `"data"` (JSON,
YAML, TOML, XML, INI, CSV, Protocol Buffers), `"prose"` (Markdown, MDX, Text,
reStructuredText, AsciiDoc, TeX) or `"other"` (the Other row). `lines` is lines added plus
removed, `files` counts distinct paths, and `share` is a whole percent of `basis`
(`"lines"`, or `"files"` when no lines changed at all). Shares use largest-remainder
rounding, and languages with equal amounts always get equal shares: the shares add up to
exactly 100 unless a tie makes that impossible, and then to the closest total those
equal shares allow (three languages tied at 1 line each: 33 + 33 + 33). `.h` headers
count as C++ when the history has C++ sources and no `.c` files, else as C. Jupyter
notebooks (`.ipynb`) are JSON with outputs inside, so their line counts run high.

Without `--json` no stats.json is written, and one left over from an earlier `--json` run
is left as it is.

## Privacy

- **100% local.** gitwrapped reads `git log` and writes files. It makes no network
  requests and has no telemetry, accounts or API keys.
- **`wrapped.html` stays offline too.** It inlines all of its CSS, JS and SVG and ships
  a strict Content-Security-Policy (`default-src 'none'`, with hashed inline style and
  script), so the browser won't load anything from the network either.
- **What the output contains.** Cards, `wrapped.html` and (with `--json`) `stats.json`
  show commit subjects and repo-relative file paths; `stats.json` also lists commit
  hashes (the longest and shortest message) and, when you pass `--author`, that email.
  Check them before you share output from a private repo. No absolute paths from your machine are written.

## How it works

1. **Read.** One `git log --numstat` call (no shell, arguments passed directly) reads the
   hash, author, email (after `.mailmap`), date, parents, subject and per-file line
   counts of each commit. With `--until` / `--year` a cheap hashes-and-dates pass
   picks the commits in the window first.
2. **Stats.** Totals, time habits, streaks, commits per day, hot files, languages, message stats and a rule-based
   personality are computed in plain JavaScript. Hours, weekdays and days use each
   commit's **author-local time**, so a 23:00 commit counts as 23:00 for the person
   who made it, whatever time zone you run gitwrapped in.
3. **Cards.** Each card is rendered as an SVG string with gradients and no external fonts.
4. **Output.** The SVGs are bundled into `wrapped.html` and rasterized to PNG with resvg.

## Edge cases and limits

- **Big repos:** only the 50,000 most recent commits are analyzed by default, and the
  recap says so. You can change this with `--max-commits n`; with a date window or
  `--author` it counts only matching commits. If `git log` output is still too large,
  gitwrapped asks you to narrow it with `--since` / `--until` / `--year` or `--author`.
- **Dates are the author's.** `--since`, `--until` and `--year` compare each commit's
  *author* date, on the author's own calendar day (the day every card uses). A commit
  made at 00:30 on Jan 1 in Tokyo belongs to the new year, whatever time zone you run
  gitwrapped in, so a window gives the same result on every machine.
- **`--since`** keeps every commit authored on or after the day, even ones that sit
  behind older commits in the history. On git 2.37+ git pre-filters with
  `--since-as-filter` a week before the date (committer dates can lag author dates), and
  the exact filter runs in JavaScript. Older git does all the filtering in JavaScript,
  so `--max-commits` can't shorten the read there.
- **`--until` / `--year`** keep every commit authored on or before the end day. git's
  own `--until` checks the committer date, which can be any amount later than the
  author date after a rebase or squash merge, so it is not used. Instead a cheap first
  `git log` pass lists only hashes and author dates, the window and `--max-commits` are
  applied to that list, and only the selected commits are read in full. Dates before
  1970 are not supported (`--year` takes 1970 to 9999).
- **Current streak in a past window:** when the window ends before today, the streak is
  counted up to the window's last day, and that day is over: a streak is "at window
  end" only if it includes that day. The recap and streak card say so, and
  `stats.json` records the day as `asOf`.
- **Future-dated commits** (a wrong clock or author date): a day more than one day after
  today can't end or extend your current streak, and the activity calendar stops at
  tomorrow, so one bad date doesn't hide your real last 12 months. Those commits still
  count in the totals and the longest streak.
- **Output folder safety:** gitwrapped only deletes files (old card files, and with
  `--no-png` the PNGs of an earlier run) in a folder that already holds a `wrapped.html`
  from an earlier run, and only regular files with its own names. It won't write or
  delete through a symlink: if an output this run writes (`wrapped.html`, `share.svg`, a
  card SVG or the `cards/` folder; `share.png`, PNG cards and `png/` only when making PNGs;
  `stats.json` only with `--json`) is a symlink, the run stops with
  `refusing to write through a symlink: <path>` before writing anything. This check is
  best effort (made once, before writing). `--out` itself may be a symlink.
- **Authors** are counted by their `.mailmap` identity, so one person with two emails
  mapped together counts once, and `--author` matches the mapped email. If `--author`
  matches nothing and isn't an email address, the recap reminds you it expects one.
- **Empty repo** (no commits yet) or a filter that matches nothing (`--since`,
  `--until`, `--year`, `--author`): you still get a full card set with friendly empty
  copy. The recap says "No commits found", names the filters, and the exit code is 0.
- **No git:** if `git` isn't on your PATH, gitwrapped says so. On Windows, PATH has to
  point at `git.exe`; a `git.cmd` or `git.bat` wrapper can't be started directly.
- **Not a repo:** a missing path, a file, or a folder that isn't a git repository each
  exit with code 1 and a one-line error. If git refuses a repo owned by another user
  ("dubious ownership"), gitwrapped prints the `git config --global --add safe.directory`
  command that allows it.
- **Renames** are counted as a delete plus an add. Merge commits (more than one parent)
  are skipped in the message stats and in the Fixaholic share.
- **Submodules:** bumping a submodule is not counted as a file edit.
- **Shallow clones** (`git clone --depth`): the oldest fetched commit would otherwise
  count the whole tree as added, so its line counts are skipped and the recap says so.
- **Fonts:** cards use the system sans-serif stack. Missing fonts fall back to DejaVu
  Sans on Linux, Helvetica on macOS or Segoe UI on Windows, so PNGs can look slightly
  different from one machine to another.
- **macOS PNGs:** color emoji (e.g. 🚀 in a file or repo name) are left out of the PNG
  exports, because resvg 2.6.2 draws Apple Color Emoji far from their text. The SVG cards
  and `wrapped.html` keep them.

## Built by an autonomous agent loop

This repo is written by an AI agent working in a loop, one small pull request at a
time. Everything the agent knows lives in [`.loop/`](.loop/):

- [`.loop/LOOP.md`](.loop/LOOP.md) is the protocol. The owner writes it, and the agent
  never edits it.
- [`.loop/ROADMAP.md`](.loop/ROADMAP.md) lists the milestones and tasks. Each turn takes
  the first unchecked task (at most two per turn) and ticks it off when it's done.
- [`.loop/STATE.md`](.loop/STATE.md) is the turn log: date, task, PR, result and a note
  for the next turn. Each turn starts fresh with no memory, so this note is how one
  turn hands off to the next.

A scheduled task starts a new session every hour. Each turn creates a `loop/NNN-*`
branch and runs three subagents: a **builder** implements the task, a **tester** writes
`node:test` tests and runs `npm test`, and a **reviewer** reads the diff cold against
the task and the rules. The turn then opens a PR once tests pass (and waits for CI on Linux, macOS and Windows × Node 20 and 22),
squash-merges it, and records the result in `STATE.md`. A `.loop/STOP` file halts the
loop, and `.loop/DONE` marks the project finished.

## Contributing

```bash
git clone https://github.com/furkycl/gitwrapped.git
cd gitwrapped
npm ci
npm test                               # node:test, no extra test framework
node scripts/make-fixture-repo.js      # build the deterministic fixture repo, print its path
node scripts/preview-cards.js [dir]    # render fixture cards to ./cards-preview to eyeball them
npm run self-wrapped                   # regenerate docs/self-wrapped/ from this repo's history
npm run hero-gif                       # rebuild docs/hero.gif from docs/self-wrapped/cards
npm run pack-smoke                     # npm pack, install the tarball in a temp dir, run it on the fixture (needs registry access)
```

`npm run hero-gif` (`scripts/make-hero-gif.js`) rasterizes every `*.svg` card in
`--cards` (in file-name order) to 360x640 frames and encodes a looping GIF, offline. It
takes `--cards <dir>`, `--out <file>`, `--width <px>` (up to 1080) and `--help`. Frames use
your system fonts, so a rebuild on another OS can differ slightly. Its GIF encoder, [`gifenc`](https://github.com/mattdesl/gifenc), is a
dev dependency only and is not part of the published package.

Tests create throwaway git repos, so git needs a `user.name` and `user.email`. Keep the
project local-only, dependency-light, and plain ESM on Node >= 20.

### Releasing

Changes for each version are listed in [CHANGELOG.md](CHANGELOG.md).

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
2. Bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version` also
   updates `package-lock.json`).
3. Merge to `main`, then push a matching tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The tag starts the [Publish workflow](.github/workflows/publish.yml). It checks that the
tagged commit is on `main`, that the tag matches the `package.json` version and that
`CHANGELOG.md` has an entry for it, runs the tests, and publishes to npm with provenance.
A prerelease tag such as `v1.1.0-beta.1` is published under the `next` dist-tag instead
of `latest`.

Before the first release, the repo owner has to create an npm granular access token with
read and write access to the `@furkycl` scope (or all packages) and "bypass 2FA" enabled,
and save it as the `NPM_TOKEN` Actions secret. Granular write tokens expire, so rotate the
secret before it does.

## License

[MIT](LICENSE)
