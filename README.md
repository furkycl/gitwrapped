# gitwrapped 🎁

[![CI](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml)

**Spotify Wrapped, but for your git history.**

```bash
npx gitwrapped
```

Run it inside any repo and get a set of shareable story cards: your peak coding hour,
your longest streak, the file you just can't stop touching, your weirdest commit
message, and your commit personality.

- 100% local: reads `git log`, nothing leaves your machine
- No API keys, no accounts
- Outputs a swipeable HTML story, SVG + PNG story cards, and a 1200x630 share image

## Usage

```bash
gitwrapped [path] [--since YYYY-MM-DD] [--author email] [--out dir]
           [--max-commits n] [--no-png] [--no-color]
gitwrapped --help      # -h
gitwrapped --version   # -v
```

Run it on a repo (`path` defaults to `.`) and it writes into `--out`
(default `gitwrapped-out`, created if needed):

```
gitwrapped-out/
  wrapped.html          # the story: open it in any browser
  cards/01-intro.svg    # one 1080x1920 SVG per card
  ...
  cards/08-outro.svg
  png/01-intro.png      # the same cards as 1080x1920 PNGs, ready to post
  ...
  png/08-outro.png
  share.png             # 1200x630 summary image (link previews, social posts)
  share.svg             # the same summary as SVG
```

`wrapped.html` is a single self-contained file (no network requests, works offline
and from `file://`): one card at a time with story-style progress bars. Tap or click
the right side (or press →/Space) for the next card, the left side (or ←) to go back,
Home/End to jump, and swipe on touch screens. Pause the auto-advance by pressing and
holding the card, with the pause button in the top corner, or with P or K. Link to
a card with `wrapped.html#3`. Auto-advance is off when your system prefers reduced
motion.

`--since` keeps commits authored on or after that day; `--author` matches the commit
author's email exactly, case-insensitive. Requires Node.js >= 20 and `git` on your PATH.

When it is done, gitwrapped prints a short recap in the terminal: commits, active
days, lines added/removed, power hour, streaks, hottest file, top word and your commit
personality, then where the output went. The first line is always
`gitwrapped: N commits → <out>/wrapped.html`, easy to grep. The recap is colored on a
terminal; `--no-color` or `NO_COLOR=1` turns color off and `FORCE_COLOR=1` forces it
(piped output is plain by default).

Edge cases:

- **Empty repo** (`git init`, no commits yet) or a filter that matches nothing: you
  still get a full card set with friendly empty copy, the recap says
  "No commits found", and the exit code is 0.
- **Huge repo:** only the 50,000 most recent commits are analyzed, and the recap says
  so. Change the cap with `--max-commits n`.
- **Not a repo:** a missing path, a file, or a folder that is not a git repository
  each exit 1 with a one-line error (`path does not exist`, `not a directory`,
  `not a git repository`). If git refuses a repo owned by another user ("dubious
  ownership"), gitwrapped prints the `git config --global --add safe.directory`
  command that allows it.

PNGs are rendered locally with [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js)
(a prebuilt native module, the only dependency). Text uses your system's fonts: the
cards ask for the usual system sans-serif stack, and anything missing falls back to
DejaVu Sans on Linux, Helvetica on macOS or Segoe UI on Windows (or whatever sans-serif
font is installed), so PNGs can look slightly different from machine to machine.
`--no-png` skips PNG rendering for a faster run (SVG + HTML only). If the renderer is
not available on your platform, gitwrapped prints `PNG export skipped: <reason>` and
still writes everything else.

> 🚧 Under construction — this project is being built, commit by commit, by an
> autonomous AI agent loop. Follow progress in [`.loop/STATE.md`](.loop/STATE.md).
