# gitwrapped, Wrapped

This folder is what you get when you run gitwrapped on its own repo. Every commit here
was made by the autonomous agent loop that builds gitwrapped (see `.loop/`), so these
cards tell the story of the loop itself.

- **Generated:** 2026-10-08
- **Commits analyzed:** 163 (the full history at the time of the run)
- **Regenerate:** `npm run self-wrapped` (runs `gitwrapped . --out docs/self-wrapped`),
  then `npm run hero-gif` to rebuild the README's [`docs/hero.gif`](../hero.gif) from
  these cards

## The story

[`wrapped.html`](wrapped.html) is the full story viewer. GitHub shows HTML files as
source, so download it and open it in a browser, or paste its raw URL into an HTML
preview service.

The ten cards, as SVG (the repo has a single author after `.mailmap`, so there is no
team card (and so no "Bus factor" row), and its pairing with its `Co-authored-by:` co-author shows up as a "Paired" row
on the totals card instead, which leaves no spare room for a "Born / buried" row (the 190
files born and 2 buried are in the recap) or a merges row; its 8 PM power hour is tied
(and is not a night power hour, so its quip does not give way), and its commits come from
two UTC offsets, so the power-hour card ends its subtitle with "Committed from 2 time
zones, mostly UTC+00:00." and has no room left for a "Late nights" row (the 29 late-night
commits, 18%, latest 4:42 AM on Oct 8, 2026, are in the recap) or an "Office hours" row;
with two or more active days the streak card has a cadence row ("32.6 per active day ·
every day"); some commits landed on a Sunday, so the activity card has a "Weekends 24
commits · 15%" row, followed by the "Office hours 60 commits · 37%" row the power-hour
card had no room for; its changes span several top-level folders, so the hot-files card
ends with a "Top folders" list (test/, src/, docs/), which leaves no spare room for a
"Tests" row there, so the languages card has the "Tests 38,582 lines · 62%" row instead;
its whole history falls inside one calendar month, so there is no monthly timeline card;
the run has no `--since`, so there are no "vs prev." rows;
no commit has an emoji or reverts another, so the messages card has no Emoji or Reverts
row; the repo has no tags, so the outro has no Releases panel; and the totals card has no
spare room for a merges row, so the outro has a "Merges" panel instead, in place of its
"Made with gitwrapped" line, with only the pull-request line ("You merged 79 pull
requests") because every pull request was squash-merged and there are no merge commits):

![Intro](cards/01-intro.svg)
![Totals](cards/02-totals.svg)
![Power hour](cards/03-peak-hour.svg)
![Streak](cards/04-streak.svg)
![Activity](cards/05-activity.svg)
![Hot files](cards/06-hot-files.svg)
![Languages](cards/07-languages.svg)
![Message hall of fame](cards/08-messages.svg)
![Personality](cards/09-personality.svg)
![Outro](cards/10-outro.svg)

## Share image

![Share image](share.png)

[`share.png`](share.png) is 1200x630, with an SVG copy in [`share.svg`](share.svg). The
per-card PNGs (`png/`) are gitignored to keep the repo small; `npm run self-wrapped`
writes them locally.
