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

Nine 1080x1920 story cards:

1. **Intro**: the repo name, the date range in plain English ("Oct 4 – Oct 5, 2026") and how many commits there are to unwrap, plus whose story it is when you pass `--author`.
2. **Totals**: commits, a lines added vs. removed bar, active days and files touched (and contributors, when there is more than one).
3. **Power hour**: the hour of the day you commit the most, with a 24-hour bar chart and a Monday-to-Sunday weekday chart (hover a bar in `wrapped.html` for its count).
4. **Streak**: your longest run of consecutive days with a commit, with a longest vs. current bar comparison.
5. **Activity**: a GitHub-style calendar of commits per day (weeks as rows, Monday to Sunday, brighter the busier the day), with your number of active days and your busiest day. Hover a day in `wrapped.html` for its count. It covers up to the last 53 weeks of your history.
6. **Hot files**: the five files you edit most as a bar list (lockfiles and build output are ignored).
7. **Message hall of fame**: your favorite word, your longest and shortest messages, and how many "fix", "wip" and "oops" commits you made.
8. **Personality**: Night Owl, Early Bird, Friday Deployer, Fixaholic, Weekend Warrior or Steady Shipper, with a one-line roast and bars for your top habit scores.
9. **Outro**: a summary card to post: commits, power hour, best streak and personality tiles, plus your hottest file.

You also get:

- **`wrapped.html`**: one self-contained story viewer that works offline and from `file://`.
  It shows story-style progress bars. Tap or click the right side (or press → or Space)
  to go forward, and the left side (or ←) to go back. Home and End jump to the first and
  last card, and you can swipe on touch screens. To pause auto-advance, press and hold
  the card, use the pause button, or press P or K. You can link to a card with
  `wrapped.html#3`. Auto-advance is off when your system prefers reduced motion.
  A toolbar under the story shows which card you're on (for example `3 / 9`) and saves the
  current card. **PNG** (or press D) downloads it as a 1080x1920 `NN-<card>.png`, drawn
  in your browser. If the browser can't draw it, you get the SVG instead. **SVG**
  downloads `NN-<card>.svg`. **Share** appears only where the browser supports the
  system share sheet. It shares the PNG when it can, and otherwise the title text, never
  a link. Press **?** (or the ? button) for the list of keyboard shortcuts.
- **PNGs**: each card as a 1080x1920 PNG, plus a 1200x630 `share.png` summary for link
  previews and social posts.
- **Terminal recap**: commits, active days, lines, power hour, streak, hottest file,
  top word and personality, printed right after the run.

```
gitwrapped-out/
  wrapped.html          # the story: open it in any browser
  cards/01-intro.svg    # 01-intro … 09-outro, 1080x1920 SVG
  png/01-intro.png      # the same cards as PNG, ready to post
  share.png             # 1200x630 summary image
  share.svg             # the same summary as SVG
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
| `--since YYYY-MM-DD`  | Only include commits on or after this date (from your local midnight)                  |
| `--author <email>`    | Only include commits by this author email (exact, case-insensitive match against the email after `.mailmap` is applied) |
| `--out <dir>`         | Output directory (default: `gitwrapped-out`, created if needed)                        |
| `--max-commits <n>`   | Analyze at most the n most recent commits (default: 50000; also applies with `--since`) |
| `--no-png`            | Skip PNG rendering (faster; SVG + HTML only)                                           |
| `--no-color`          | Plain console output (also: `NO_COLOR=1`; `FORCE_COLOR=1` forces color)               |
| `-h`, `--help`        | Show help and exit                                                                     |
| `-v`, `--version`     | Show the version and exit                                                              |

On success, the first line of output is `gitwrapped: N commits → <out>/wrapped.html`, which
is easy to grep. The recap is in color on a terminal and plain when piped.

## Examples

```bash
# This year only
npx @furkycl/gitwrapped --since 2026-01-01

# Just you, in a shared repo
npx @furkycl/gitwrapped --author you@example.com

# Another repo, into a folder of your choice
npx @furkycl/gitwrapped ~/code/my-app --out ~/Desktop/my-app-wrapped

# Fast mode: skip PNG rendering
npx @furkycl/gitwrapped --no-png

# CI or logs: no color, first line is machine-friendly
NO_COLOR=1 npx @furkycl/gitwrapped --no-png | head -1
```

## Privacy

- **100% local.** gitwrapped reads `git log` and writes files. It makes no network
  requests and has no telemetry, accounts or API keys.
- **`wrapped.html` stays offline too.** It inlines all of its CSS, JS and SVG and ships
  a strict Content-Security-Policy (`default-src 'none'`, with hashed inline style and
  script), so the browser won't load anything from the network either.

## How it works

1. **Read.** One `git log --numstat` call (no shell, arguments passed directly) reads the
   hash, author, email (after `.mailmap`), date, parents, subject and per-file line
   counts of each commit.
2. **Stats.** Totals, time habits, streaks, commits per day, hot files, message stats and a rule-based
   personality are computed in plain JavaScript. Hours, weekdays and days use each
   commit's **author-local time**, so a 23:00 commit counts as 23:00 for the person
   who made it, whatever time zone you run gitwrapped in.
3. **Cards.** Each card is rendered as an SVG string with gradients and no external fonts.
4. **Output.** The SVGs are bundled into `wrapped.html` and rasterized to PNG with resvg.

## Edge cases and limits

- **Big repos:** only the 50,000 most recent commits are analyzed by default, and the
  recap says so. You can change this with `--max-commits n`. If `git log` output is
  still too large, gitwrapped asks you to narrow it with `--since` or `--author`.
- **`--since`** keeps every commit *authored* on or after the date, even ones that sit
  behind older commits in the history. On git 2.37+ git pre-filters with
  `--since-as-filter` a week before the date (committer dates can lag author dates), and
  the exact author-date filter runs in JavaScript. Older git does all the filtering in
  JavaScript, so `--max-commits` can't shorten the read there.
- **Authors** are counted by their `.mailmap` identity, so one person with two emails
  mapped together counts once, and `--author` matches the mapped email. If `--author`
  matches nothing and isn't an email address, the recap reminds you it expects one.
- **Empty repo** (no commits yet) or a filter that matches nothing: you still get a
  full card set with friendly empty copy. The recap says "No commits found" and the
  exit code is 0.
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
- **Known issue (macOS PNGs):** resvg 2.6.2 can draw a color emoji (e.g. 🚀 in a file
  name or repo name) far to the right of its text, sometimes past the card edge. The
  SVG cards and `wrapped.html` are not affected. A fix is tracked in the roadmap.

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
```

`npm run hero-gif` (`scripts/make-hero-gif.js`) rasterizes every `*.svg` card in
`--cards` (in file-name order) to 360x640 frames and encodes a looping GIF, offline. It
takes `--cards <dir>`, `--out <file>`, `--width <px>` (up to 1080) and `--help`. Frames use
your system fonts, so a rebuild on another OS can differ slightly. Its GIF encoder, [`gifenc`](https://github.com/mattdesl/gifenc), is a
dev dependency only and is not part of the published package.

Tests create throwaway git repos, so git needs a `user.name` and `user.email`. Keep the
project local-only, dependency-light, and plain ESM on Node >= 20.

## License

[MIT](LICENSE)
