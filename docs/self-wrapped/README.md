# gitwrapped, Wrapped

This folder is what you get when you run gitwrapped on its own repo. Every commit here
was made by the autonomous agent loop that builds gitwrapped (see `.loop/`), so these
cards tell the story of the loop itself.

- **Generated:** 2026-10-10
- **Commits analyzed:** 224 (the full history at the time of the run)
- **Regenerate:** `npm run self-wrapped` (runs `gitwrapped . --out docs/self-wrapped`),
  then `npm run hero-gif` to rebuild the README's [`docs/hero.gif`](../hero.gif) from
  these cards

## The story

[`wrapped.html`](wrapped.html) is the full story viewer. GitHub shows HTML files as
source, so download it and open it in a browser, or paste its raw URL into an HTML
preview service.

The ten cards, as SVG (the repo has a single author after `.mailmap`, so there is no
team card (and so no "Bus factor" row), and its pairing with its `Co-authored-by:` co-author shows up as a "Paired" row
on the totals card instead, followed by a "Born / buried / renamed" row (246 / 2 / 6), which
leaves no spare room for a merges row or the "Cleanups" rows
(its 2 cleanup commits, 1%, are in the recap; the message hall of fame has no room for them either); its 9 PM power hour
(15 commits) is not tied, so the power-hour card has its quip ("After-hours hero.") and
busiest weekday, and its commits come from two UTC offsets, so it has a "2 time zones
mostly UTC+00:00" row, which leaves no room for a "Late nights" row (the 42 late-night
commits, 19%, latest 4:42 AM on Oct 8, 2026, are in the recap) or an "Office hours" row;
with two or more active days the streak card has a cadence row ("32 per active day ·
every day"), and, with no longest-break panel (it committed every day), room for a "3
coding sessions  longest 95h 22m" row (the longest of the 3 sessions ran 167 commits from
Oct 6, 2026; median 9h 32m); some commits landed on a weekend, so the activity card has a "Weekends 28
commits · 13%" row, followed by the "Office hours 84 commits · 38%" row the power-hour
card had no room for; its changes span several top-level folders, so the hot-files card
ends with a "Top folders" list (test/, src/, docs/), which leaves no spare room for a
"Tests" row there, so the languages card has the "Tests 55,021 lines · 64%" row instead,
or for a "Changed together" row (the pair, .loop/ROADMAP.md + .loop/STATE.md, 107 commits,
is in the recap), or for a "One-touch files" row (the 89 files changed by a single commit,
35%, are in the recap), or for a "Biggest grower" row (src/cards/index.js, net +3,071
lines, is in the recap as "Top grower"); its whole history is inside the window, so every
file started at zero lines and none shrank, and there is no "Biggest shrinker" row (and no
recap line); neither card has spare room for a "Docs" row after the "Tests" row (the
8,873 doc lines, 10%, are in the recap);
its whole history falls inside one calendar month, so there is no monthly timeline card;
the run has no `--since`, so there are no "vs prev." rows;
no commit has an emoji or reverts another, so the messages card has no Emoji or Reverts
row, and none has a `fixup!`, `squash!` or `amend!` subject, so there is no "fixup!" segment
(the card folds the fix / wip / oops counts into one row, which never takes it, anyway);
110 commits (49%) mention an issue, mostly the "(#NN)" pull-request numbers of the squash
merges, but the message hall of fame has no spare room for an "Issue refs" row, even with
the counts folded (the line is in the recap, with no top issue because none is mentioned
twice), nor for a "Subject length" row (a median of 27 characters, with 43 subjects, 19%,
over 72, is in the recap) or a "Message bodies" row (the 99 commits with a body, 44%, are
in the recap) or a "Top words" row ("turn" ×112, "card" ×29 and "stats" ×29, from the
"chore(loop): turn NNN" subjects, are in the recap as "Top words") or a "Typo fixes" row
(its 1 typo fix, "feat: typo fixes", <1%, is in the recap; the folded fix / wip / oops row
never takes a "· typos" segment); no commit only touched lockfiles and dependency manifests, so
there is no "Dependency bumps" row (and no recap line), none was committed more than an
hour after it was written (every commit, the 109 squash merges GitHub committed included, has its committer date equal to its author date), so
there is no "Rewritten commits" row (and no recap line), and no author is a bot, so there
is no "Bot commits" row (and no recap line); the repo has no tags, so the outro has no Releases panel; and the totals card has no
spare room for a merges row, so the outro has a "Merges" panel instead, in place of its
"Made with gitwrapped" line, with only the pull-request line ("You merged 109 pull
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
