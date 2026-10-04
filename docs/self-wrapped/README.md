# gitwrapped, Wrapped

This folder is what you get when you run gitwrapped on its own repo. Every commit here
was made by the autonomous agent loop that builds gitwrapped (see `.loop/`), so these
cards tell the story of the loop itself.

- **Generated:** 2026-10-04
- **Commits analyzed:** 26 (the full history at the time of the run)
- **Regenerate:** `npm run self-wrapped` (runs `gitwrapped . --out docs/self-wrapped`)

## The story

[`wrapped.html`](wrapped.html) is the full story viewer. GitHub shows HTML files as
source, so download it and open it in a browser, or paste its raw URL into an HTML
preview service.

The eight cards, as SVG:

![Intro](cards/01-intro.svg)
![Totals](cards/02-totals.svg)
![Power hour](cards/03-peak-hour.svg)
![Streak](cards/04-streak.svg)
![Hot files](cards/05-hot-files.svg)
![Message hall of fame](cards/06-messages.svg)
![Personality](cards/07-personality.svg)
![Outro](cards/08-outro.svg)

## Share image

![Share image](share.png)

[`share.png`](share.png) is 1200x630, with an SVG copy in [`share.svg`](share.svg). The
per-card PNGs (`png/`) are gitignored to keep the repo small; `npm run self-wrapped`
writes them locally.
