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
- Outputs SVG story cards + a swipeable HTML story (PNG export planned)

## Usage

```bash
gitwrapped [path] [--since YYYY-MM-DD] [--author email] [--out dir]
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
```

`wrapped.html` is a single self-contained file (no network requests, works offline
and from `file://`): one card at a time with story-style progress bars. Tap or click
the right side (or press →/Space) for the next card, the left side (or ←) to go back,
Home/End to jump, and swipe on touch screens. Pause the auto-advance by pressing and
holding the card, with the pause button in the top corner, or with P or K. Link to
a card with `wrapped.html#3`. Auto-advance is off when your system prefers reduced
motion.

`--since` keeps commits authored on or after that day; `--author` matches the commit
author's email exactly, case-insensitive. A repo (or filter) with no commits still
gets a card set. PNG export is not implemented yet. Requires Node.js >= 20 and `git`
on your PATH.

> 🚧 Under construction — this project is being built, commit by commit, by an
> autonomous AI agent loop. Follow progress in [`.loop/STATE.md`](.loop/STATE.md).
