# gitwrapped

[![CI](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml)

**Spotify Wrapped, but for your git history.** Run one command in any repo and get a
set of shareable story cards. Everything runs locally, and you don't need an API key.

```bash
npx @furkycl/gitwrapped
```

<p align="center">
  <img src="docs/hero.gif" width="360" alt="gitwrapped's ten story cards playing one after another, like a story reel">
</p>

See gitwrapped's own Wrapped: [docs/self-wrapped/](docs/self-wrapped/) has the cards from
running it on this repo, plus the 1200x630 [`share.png`](docs/self-wrapped/share.png)
summary image it made for link previews.

## What you get

Ten 1080x1920 story cards, plus a monthly timeline when your commits span two or more
calendar months and a team card in a repo with more than one contributor (up to twelve):

1. **Intro**: the repo name, the date range in plain English ("Oct 4 – Oct 5, 2026") and how many commits there are to unwrap, plus whose story it is when you pass `--author` (the part of the email before the `@` only: "Starring ada."), and where it all began: an "It all began with" panel with the first commit in the window, its quoted subject on one line ("“Initial commit”") and its day and short hash below ("Jan 3, 2025 · 1a2b3c4"; with several repos, its repo too). Merge commits are skipped. The subject is shortened to fit its line (first a smaller font, then cut with "…"), a long repo label is cut with "…" so the day and hash always show, and when the card has no room for the panel it is left out (it is still in the recap, `wrapped.md` and `stats.json`).
2. **Totals**: commits, a lines added vs. removed bar, active days and files touched (and contributors, when there is more than one), plus your commit size mix: the share of tiny (under 10 lines), small (10–99), medium (100–500) and large (over 500 lines changed) commits as one stacked bar. The bar only uses spare room: when the card is short of space (with `--year`'s three extra rows, say) it is left out, and nothing else on the card shrinks for it (the mix is still in the recap and `stats.json`). Sizes count the same files as hot files (lockfiles, build output and the rest are left out, and so is anything you `--exclude`) and skip merge commits. When some of your commits were paired (a `Co-authored-by:` trailer, see the team card) and the team card is not there to show it (or has no room for it, or you passed `--author`), a "Paired (top: Ada)" row with their count is added ("Paired commits" when a long name would be cut), again only when it fits without anything else shrinking. After it, when files were added or deleted in the window, a "Born / buried 12 / 3" row follows on the same terms (spare room only, and only when drawn whole; it never takes the place of the pairing row or anything else, and it is always in the recap, `wrapped.md` and `stats.json`). When files were also renamed or moved, it becomes "Born / buried / renamed 12 / 3 / 4" ("Doğan / gömülen / taşınan" in Turkish) when that is drawn whole, else it stays the plain born / buried row (renames alone give a "0 / 0 / 4" row, or none when that would be cut). Last, when pull requests were merged or there are merge commits in the window (see `stats.merges` below), a "Merged PRs / merges 12 / 8" row (or "Merged PRs 12" in a squash-merge repo, "Merge commits 8 · 6%" without PR numbers) follows, again in spare room only. When the totals card has no room for it (a team repo with the pairing and born / buried rows, `--year`'s comparison rows), or the row would be cut (10,000+ pull requests and merges), the outro shows it instead (never both). After all of those, when some of your non-merge commits removed more lines than they added (cleanups, see `stats.cleanups` below), a "Cleanups  12 commits · 8%" row ("12 · 8%" when that would be cut) gives their count and share of your non-merge commits, followed by a "Biggest cleanup  −4,210 lines · Mar 3, 2026" row with the largest net deletion ("−4,210 lines · Mar 3", "−4,210 · Mar 3" or "−4,210 lines" when the longer forms would be cut; "Temizlikler" and "En büyük temizlik" in Turkish). Both only use spare room, after every other row (the second only when the first is drawn), and they go on one card only: here when this card takes both, else on the message hall of fame when it takes both (see below), else the count row alone here, else alone there; a card without them is exactly as before, and when neither card has room they are left off the cards (the cleanups, with the biggest one's subject, are still in the recap, `wrapped.md` and `stats.json`). Last of all, when some of your non-merge commits only touched lockfiles and dependency manifests (dependency bumps, see `stats.depBumps` below), a "Dependency bumps  5 commits · 2%" row ("12 · 8%", else "Dep bumps  12 · 8%" when the longer forms would be cut; "Bağımlılık güncellemeleri", else "Bağımlılıklar" in Turkish) gives their count and share of your non-merge commits. It is the lowest-priority row of the totals card but one: it goes here, after every other row, when there is spare room (every chart drawn at the same size), else on the message hall of fame after the issue references (only the subject length row comes after it there) when that fits as well as the card did without it (every chart still drawn, nothing folded or shrunk); it never displaces a row, and without room on either card (or without a dependency bump) every card is exactly as before (the count is still in the recap, `wrapped.md` and `stats.json`). After it, when some of your non-merge commits were committed more than an hour after they were written (rebased, amended or cherry-picked, see `stats.rewritten` below), a "Rewritten commits  1 commit · 8%" row ("12 · 8%", else "Rewritten  12 · 8%" when the longer forms would be cut; "Yeniden yazılan commit'ler", else "Yeniden yazılmış" in Turkish) gives their count and share of your non-merge commits. It is the lowest-priority row of the totals card and of the message hall of fame: it goes here, after every other row (the dependency bumps included), when there is spare room (every chart drawn at the same size), else last on the message hall of fame (after the top words) when that fits as well as the card did without it; it never displaces a row, and without room on either card (or without a rewritten commit) every card is exactly as before (the count is still in the recap, `wrapped.md` and `stats.json`).
3. **Power hour**: the hour of the day you commit the most, with a 24-hour bar chart and a Monday-to-Sunday weekday chart (hover a bar in `wrapped.html` for its count). Hours are each commit's own local time. When your commits came from two or more time zones (UTC offsets), the card always says so, in the first of these that fits: "Committed from 3 time zones, mostly UTC+03:00." at the end of the subtitle, or a "3 time zones · mostly UTC+03:00" row (both charts kept, the big number at most one step smaller); else the sentence takes the place of the hour's quip, then of the quip and the busiest-weekday sentence (the hour's sentence always stays). "mostly" is left out when two offsets tie. With a single time zone the card is unchanged. When at least one commit landed between midnight and 04:59 (author-local), a "Late nights  12 commits · 4%" row ("1,234 · 12%" when the full value would be cut, e.g. 1,000+ commits with a two-digit share, so the percent always shows; no row when even that would be cut) follows when it fits like the time-zones row: both charts kept and the big number at most one step smaller (one step in all, shared with the time-zones row; a card that had already shrunk gets no more), with the title and subtitle unchanged. After it, a "Latest night  4:12 AM · Mar 3, 2024" row with your latest-ever commit time is added only in spare room (nothing shrinks for it, so it is rare); when the full date would be cut on the row it is shown without its year ("4:12 AM · Mar 3": always in English, in Turkish only for longer dates such as "04:12 · 28 Oca"). The recap, `wrapped.md` and `stats.json` always have the full date. Otherwise the card is exactly as before. A night power hour's own quip (10 PM to 4 AM) makes the subtitle four lines long, which leaves no room for the row, so when there are late-night commits it gives way to a short "Night owl." ("Tam bir gece kuşu." in Turkish), or to no quip when even that is too long, whichever lets the row fit while the busiest weekday (when it showed) and the time zones still show; otherwise the card keeps its own quip and has no row. The recap, `wrapped.md` and `stats.json` always have the late nights. When at least one commit landed on a weekday between 09:00 and 17:59 (author-local), an "Office hours  95 commits · 23%" row ("1,234 · 23%" when the full value would be cut, e.g. 1,000+ commits with a two-digit share, so the percent always shows; "Mesai saatleri" in Turkish) comes last when it fits on the same terms as the late-nights row: both charts kept and the big number at most one step smaller in all; when it doesn't fit here, the activity card gets it instead (see below), and it is never on both. The row only ever uses spare room, so it is often left off: Turkish cards (longer subtitles) usually have no room for it on either card, and a long or busy history may leave neither card room. The recap, `wrapped.md` and `stats.json` always have the office hours.
4. **Streak**: your longest run of consecutive days with a commit, with a longest vs. current bar comparison and your longest break (the most days without a commit between two active days) when you took one. With two or more active days, a "2.4 per active day  every 3 days" row adds your cadence (commits per active day and the median gap between your active days, "every day" when it is 1), only when there is room for it: the same charts and panels drawn, the big number, text and bars at their usual size (the bar chart may give up some spare spacing between its bars) and the row shown whole; otherwise the card is exactly as before (the cadence is always in the recap, `wrapped.md` and `stats.json`). When one of your coding sessions (see `stats.sessions` below) lasted a minute or more, a "42 coding sessions  longest 3h 10m" row ("42 sessions" as the label, else "Sessions  42", when the longer forms would be cut; with a single session just its length, "1 coding session  26h 41m"; "42 kodlama oturumu", "42 oturum", "Oturumlar" in Turkish, the longest value "en uzun 3 sa 10 dk"; the long Turkish label only fits next to a short value such as "en uzun 45 dk", so it is usually "42 oturum  en uzun 3 sa 10 dk") comes last, only in spare room: at most six rows, every chart and panel still drawn and nothing shrinking (the bar chart may give up some spare height), so it never displaces or changes another row. In practice it lands here only when the card has no longest-break panel (a card with one is full). Otherwise the power-hour card gets it after its own rows on the same terms, but in practice that only happens when the power-hour card has no hour chart data (e.g. a `stats.json` without `habits`): with its two charts that card has no spare room for it. It is never on both. Without room the cards are exactly as before (the sessions are always in the recap, `wrapped.md` and `stats.json`).
5. **Activity**: a GitHub-style calendar of commits per day (weeks as rows, Monday to Sunday, brighter the busier the day), with your number of active days and your busiest day. Hover a day in `wrapped.html` for its count. It covers up to the last 53 weeks of your history, and so does its busiest day: on a history longer than about a year it is the busiest day of the weeks on the grid, while the recap, `wrapped.md` and `stats.json` give the busiest day of the whole window. For a repo that went quiet more than a month ago it says "12 months to Apr 2021" instead of "Your last 12 months". When you made at least one weekend commit and the grid shows your whole history (no more than 53 weeks, nothing dated in the future), a "Weekends  12 commits · 8%" row ("1,234 · 8%" when the full value would be cut, e.g. 1,000+ commits with a two-digit share, so the percent always shows; no row when even that would be cut) adds how many commits landed on a Saturday or Sunday (author-local), only when there is room for it: the calendar's cells may get smaller to make room, but never below their normal minimum size, and nothing else shrinks; otherwise the card is exactly as before. When the power-hour card has no room for its "Office hours" row (see above), it goes here instead, after the weekend row, on the same terms (the whole history on the grid, the calendar's cells never below their minimum, nothing else shrinking); when neither card has room it is left off the cards (it is still in the recap, `wrapped.md` and `stats.json`).
6. **Month by month** (only when your commits span two or more calendar months): commits per month as a bar chart, from your first active month to your last (months without commits show as empty bars), with the peak month among the months shown called out ("Mar 2026 was your peak month"; a tie goes to the earliest month, and when every active month has the same count it says so instead) and how many of those months had commits. It shows your most recent 24 months at most ("Your last 24 months", or "24 months to Apr 2019" for a repo that went quiet more than a month ago, like the activity card); `stats.json` keeps every month, and its `peak` is over all of them. Months are the author's own calendar months, like the activity calendar, and commits dated after tomorrow are left off. A history inside one calendar month skips this card, and the cards after it then move up a number.
7. **Hot files**: the five files you edit most as a bar list (each file's folder dimmed after its name; a folder too long for its bar is shortened in the middle, keeping its first folder and the nearest ones: "packages/…/src/lib/", and only then cut from the start; two listed files with the same name show their folders from where their paths differ: "core/forms/" and "web/forms/", shortened in the middle when too long: "core-x/…/forms/" and "web-y/…/forms/"). Lockfiles, build output (`dist/`, `build/`, ...), dependency folders, vendored code (a root `vendor/` or `third_party/`), minified files and test snapshots (`*.snap`, `__snapshots__/`) are ignored. When your changes span two or more top-level folders, a small "Top folders" list follows: the three (else two) folders with the most lines changed, files at the repo root shown as "(root)". It only uses spare room: the hot-files list (and, with several repos, the per-repo chart) keeps every bar at full size (the big file name may get one step smaller), and when it doesn't fit the card is exactly as before (the folders are still in the recap, `wrapped.md` and `stats.json`). When some of the lines you changed were in tests (files under a `test/`, `tests/`, `__tests__/`, `spec/` or `specs/` folder at any depth, or named like `*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `*_tests.*`, `test_<name>.<ext>` (`test_utils.py`), `conftest.py`, or `FooTest.java` / `UserTests.cs` / `LoginSpec.groovy`-style class files; case-sensitive), a "Tests" row gives their count and share of all lines changed ("Tests  1,234 lines · 23%"). It only uses spare room: every chart keeps its place and nothing shrinks; when it doesn't fit here, the languages card gets it on the same terms, and when neither has room it is left off the cards (it is still in the recap, `wrapped.md` and `stats.json`). Likewise, when some of the lines you changed were in documentation (any file under a `docs/` or `doc/` folder at any depth, case-sensitive, or a `*.md`, `*.mdx`, `*.rst` or `*.adoc` file anywhere, in any letter case; a `.txt` only counts under a docs folder), a "Docs" row right after the "Tests" row gives their count and share ("Docs  567 lines · 8%"; "Dokümanlar" in Turkish). It goes on the card that has the "Tests" row (this one when neither has it), else the other one, and only in spare room, after every other row is placed: it never takes the place of the tests row, the top folders or the co-change pair, and when neither card has room it is only in the recap, `wrapped.md` and `stats.json`. A file can be both a test and a doc (`test/README.md`) and then counts toward both. Last, when two files were changed together in at least 3 of the same commits, a "Changed together" row names the pair changed together most often and how many times ("Changed together  a.js + b.js · 12×", with folders from the end added until the two differ when both have the same name; "a.js + b.js  12× together" when the first form would be cut; else "a.js + b.js  12×"; when none of these fits, long paths are shortened in the middle, keeping the first folder (or, when both share leading folders, the first folder where they differ) and the nearest ones while the two still differ: "api/…/index.js + web/…/index.js", "core/…/index.js + web/…/index.js" for `packages/core/…` and `packages/web/…`; "Birlikte değişenler" in Turkish). A pair too long for even the shortest of these is left off the card. It only uses spare room, after the other rows (it never takes the place of the top folders or the tests row): when it doesn't fit, or even the shorter form would be cut, the card is exactly as without it (the pair, with its paths, is still in the recap, `wrapped.md` and `stats.json`; the recap shortens long paths from the start). Last of all, when some changed files were touched by just one non-merge commit in the window (see `stats.oneTouch` below), a "One-touch files  42 files · 31%" row gives how many and their share of all changed files ("42 · 31%", else "One-touch  42 · 31%" when the longer forms would be cut; "Tek commit'lik  42 dosya · %31", else "Tek commit'lik  42 · %31" in Turkish). It is the card's lowest-priority row: it is appended after every other row (the docs row and the co-change pair included) only when the card has room for it as it is (at most 6 rows, every chart still drawn, nothing shrinking more), so it never displaces a row; without room, or when no file was touched only once, the card is exactly as without it (the count is still in the recap, `wrapped.md` and `stats.json`). The card's charts usually fill it, so the row mostly shows on small histories. After it, on the same terms (only in spare room, never displacing a row), a "Biggest grower" row names the file with the largest net line growth (see `stats.biggestGrower` below) and its net lines ("Biggest grower  src/cli.js · +1,234" when the path is short; else the path moves into the label: "Grower: src/stats/index.js  +1,234", shortened in the middle when needed, keeping its first folder and the nearest ones: "Grower: src/…/stats/index.js  +1,234", else just the file name; "En çok büyüyen" / "Büyüyen: …" in Turkish; a path too long for even its file name to fit leaves the row off); it is still in the recap, `wrapped.md` and `stats.json` when the card has no room. Last of all, on the same terms (only in spare room, after the grower row, never displacing a row, the grower's included), a "Biggest shrinker" row names the file with the largest net line loss (see `stats.biggestShrinker` below) and the lines it lost ("Biggest shrinker  src/old.js · −1,234"; else "Shrinker: src/…/legacy/old.js  −1,234", shortened in the middle when needed, else just the file name; "En çok küçülen" / "Küçülen: …" in Turkish; a path too long for even its file name to fit leaves the row off); it is still in the recap, `wrapped.md` and `stats.json` when the card has no room.
8. **Languages**: your top programming language and its share of the lines you changed ("72% · Mostly TypeScript", or "Led by" under half, with ties named), with bars for your top five languages plus "Other". Data formats (JSON, YAML, ...) and prose (Markdown, ...) show in the bars, but they only lead the card when there's no code at all. Languages come from file extensions and well-known names like `Dockerfile` and `Makefile` (86 built in); lockfiles, build output, vendored code, test snapshots and binary files are left out, as for hot files. When the hot-files card has no room for the "Tests" row (see above), it goes here instead, in spare room only; the "Docs" row follows it here on the same terms (or comes here alone when the hot-files card has no room for it).
9. **The team** (only when the history has two or more contributors): how many people committed and the top five by commits as bars ("Ada Lovelace leads the pack with 54% of the commits"). With `--author` it ranks you against everyone in the same window: "#2 of 7 contributors", your share of the commits and lines, and a "you" marker on your bar (a sixth bar when you're outside the top five). Contributors are counted per email after `.mailmap`, and only their git author names are shown, never an email. A single-author repo skips this card, and so does an `--author` with no commits in the window (there's no "you" to rank); the cards after it then move up a number. When commits carry `Co-authored-by:` trailers (pair programming, GitHub's co-authored commits, AI assistants), a "Pair programming" panel follows the bars: "12 commits paired" and the top co-author by name ("Top co-author: Grace Hopper"). A commit counts as paired when it lists at least one co-author other than its own author; merge commits are skipped. Co-authors go through `.mailmap` like authors and are shown by name only, never an email. The panel only uses spare room: when it doesn't fit, the card is exactly as without it and the totals card gets a row instead (when that fits); either way the pairing is in the recap, `wrapped.md` and `stats.json`. With `--author` the pairing counts only your commits (a commit where you are only a co-author does not count), so it goes on the totals card, not on the team card, which is everyone's. Last, a "Bus factor" row gives the smallest number of people who together made at least half of the lines changed and their share ("Bus factor  2 people · 58%"; lines counted over the same files as hot files, so lockfiles, build output and anything you `--exclude` are left out, and over the same history as the ranking, so with `--author` it is the whole team's). It only uses spare room: when it doesn't fit (say, below five bars and the pairing panel), the card is exactly as without it (the bus factor is still in the recap, `wrapped.md` and `stats.json`).
10. **Message hall of fame**: your favorite word, your longest and shortest messages, and how many "fix", "wip" and "oops" commits you made, plus your biggest commit: the one with the most lines changed, with its day, lines added / removed and subject. It counts the same files as hot files (lockfiles, build output and the rest are left out, and so is anything you `--exclude`) and skips merge commits; a tie goes to the earliest commit. When at least 20% of your commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix(api)!: ...`), the card also shows your commit type mix as a thin stacked bar: the top three types and any others folded into "the rest", each with its share of those commits, and the share of commits that follow the convention in its caption. When you only ever use one type, the bar sets it against the commits without a prefix ("no prefix"), as shares of all commits; with a single type on every commit there is nothing to compare and no bar. The bar only uses spare room; when there isn't enough, the fix / wip / oops counts are folded into one row ("“fix” / “wip” / “oops”: 5 / 0 / 2") to make room, and when it still doesn't fit, the card is left as it was (the mix is still in the recap, `wrapped.md` and `stats.json`). When at least 5% of your commits have an emoji in the subject (a Unicode emoji like ✨ or a [gitmoji](https://gitmoji.dev) shortcode like `:sparkles:`), the card also gets an emoji row: your top three emoji and the share of commits with one ("Emoji ✨ 🐛 📝 · 12%"). It never costs the type mix or the biggest commit their room: it goes after the other rows when there's spare room, else the fix / wip / oops counts are folded into one row to make room (the big word may also get one step smaller), and when even that doesn't fit, it takes the place of the fix / wip / oops row (those counts stay in `stats.json`). When some of your commits revert another (a `Revert "…"` subject or a conventional `revert: …` one, or a line starting "This reverts commit <hash>" in the message, as `git revert` writes), the card also gets a "Reverts" row with their count and share of your non-merge commits ("Reverts 3 · 2%"), as its last row (after the emoji row). It only uses spare room: it goes after the other rows, else the fix / wip / oops counts are folded into one row to make room (the big word may also get one step smaller); it never takes the place of the fix / wip / oops row, the type mix or the biggest commit, so when it doesn't fit it is left off the card (the reverts are still in the recap, `wrapped.md` and `stats.json`). Without reverts the card is exactly as before. When the totals card has no room for its cleanup rows (see above), they go here instead, after every other row: as they are, else with the fix / wip / oops counts folded into one row to make room (folded wins when only it fits both rows), only when every chart is still drawn and nothing shrinks more than it did; they never take the place of anything else, and without room the card is exactly as before. Then, when some of your non-merge commits mention an issue in their subject (`#123`, `GH-123` or a Jira-style key such as `ABC-123`, see `stats.issueRefs` below), an "Issue refs (top #128 ×9)  42 · 12%" row gives how many and their share of your non-merge commits, with the most referenced issue and how many commits mention it ("Issue refs  42 · 12% (#128 ×9)" when the label would be cut, "Issue refs  42 · 12%" when that would be too, or when no issue is mentioned by two or more commits; "Issue atıfları" and "en çok" in Turkish). It is the lowest-priority row apart from the dependency bumps, the subject length and the message bodies: it goes after every other row (the cleanup rows included), else with the fix / wip / oops counts folded into one row to make room (the big word may also get one step smaller, when nothing shrank yet), only when every chart is still drawn; it never takes the place of anything, so when it doesn't fit it is left off the card (the issue references are still in the recap, `wrapped.md` and `stats.json`). Without issue references the card is exactly as before. When some of your non-merge commits are `fixup!` / `squash!` / `amend!` commits that reached the history (see `stats.messages.fixups` below), the "fix" row gets a "· 3 fixup!" segment ("“fix” commits  12 · 3 fixup!"), only when it is drawn whole; when it would be cut, or the fix / wip / oops counts are folded into one row, the card is exactly as before (the fixups are still in the recap, `wrapped.md` and `stats.json`). When the Totals card has no room for its dependency-bumps row (see card 2), that row can go here instead, after the issue references, in spare room only: at most 6 rows, the same charts drawn, nothing shrunk or folded for it. Near the end, a "Subject length" row gives your median subject length and the share of your non-merge commits whose subject is longer than 72 characters ("Subject length  48 · 12% over 72", else "48 · 12% >72" when that would be cut; just "median 48" when no subject is over 72; "Konu uzunluğu" with "48 · 72 üstü %12", else "48 · >72: %12", or "medyan 48", in Turkish; see `stats.messages.subjectLength` below). It is the lowest-priority row but one (only the message bodies row comes after it) and only uses spare room: it goes after every other row (the issue references and dependency bumps included) when the card has room for it as it is (at most 6 rows, the same charts drawn, nothing shrunk or folded for it); it never takes the place of anything, so when it doesn't fit the card is exactly as without it (the subject length is still in the recap, `wrapped.md` and `stats.json`). Then, when some of your non-merge commits have a message body (anything after the subject beyond blank lines, trailers such as `Co-authored-by:` / `Signed-off-by:` and the "This reverts commit …" line `git revert` writes; see `stats.messages.bodies` below), a "Message bodies" row gives how many and their share of your non-merge commits ("Message bodies  42 · 31%", else "Bodies  31%" when that would be cut; "Mesaj gövdesi" / "Gövde" in Turkish). It is the lowest-priority row but one, below the subject length: it is appended after every other row only when the card has room for it as it is (at most 6 rows, the same charts drawn, nothing shrunk or folded for it), so it never takes the place of anything, and without room (or without a commit with a body, or when the bodies could not be read) the card is exactly as without it (the bodies are still in the recap, `wrapped.md` and `stats.json`). Last of all, a "Top words" row gives the (up to three) most common words in your non-merge commit subjects, each with how many commits use it, as one line ("Top words: parser ×5 · cache ×3 · login ×2"), with fewer words when that would be cut ("Top words: parser ×5 · cache ×3"; a single word as "Top words  parser ×5"; in practice two short words fit; "En sık kelimeler" in Turkish; see `stats.messages.topWords` below). Only words used by at least 2 commits are shown, and a lone word that is already the card's big favorite word is not repeated. It is the lowest-priority row of the card's own, below the message bodies, on the same terms: appended only when the card has room for it as it is, it never takes the place of anything, and without room (or without a word used twice) the card is exactly as without it (the words are still in the recap, `wrapped.md` and `stats.json`). When the Totals card has no room for its rewritten-commits row (see card 2), that row can go here instead, after the top words, in spare room only: at most 6 rows, the same charts drawn, nothing shrunk or folded for it.
11. **Personality**: Night Owl, Early Bird, Friday Deployer, Fixaholic, Weekend Warrior or Steady Shipper, with a one-line roast and bars for your top habit scores. A Fixaholic's reason also counts your reverts, when you have any ("62% of your commit messages are fixes; 3 commits revert another.").
12. **Outro**: a summary card to post: commits, power hour, best streak and personality tiles, plus your hottest file (a long path is shortened in the middle the same way: "src/…/handlers/user.go"). When tags point at commits in the window (your releases: one per tagged commit, see `stats.releases` below), a "Releases" panel follows: "You shipped 3 releases" and the latest one with its day ("Latest: v1.5.0 · Oct 6, 2026"; a long tag name is cut in the middle with "…", so its start, its version at the end and the day always show). To make room for it the subtitle gives way, and nothing else shrinks: first the "Made with gitwrapped" line goes, then, with `--year`, the comparison with the year before (it is still on the totals card and in the recap). When the totals card has no room for its merges row (see below), a "Merges" panel can follow too, on the same terms: "You merged 12 pull requests" with "8 merge commits · 6% of commits" below (or "8 merge commits" and "6% of commits" without pull request numbers; when that line is too long to show whole, as in Turkish, it ends with just the percent: "8 merge commits · 6%"); when both panels don't fit, the releases panel is kept. Without tags or merges the card is exactly as before.

You also get:

- **`wrapped.html`**: one self-contained story viewer that works offline and from `file://`.
  It shows story-style progress bars. Tap or click the right side (or press → or Space)
  to go forward, and the left side (or ←) to go back. Home and End jump to the first and
  last card, and you can swipe on touch screens. To pause auto-advance, press and hold
  the card, use the pause button, or press P or K. You can link to a card with
  `wrapped.html#3`. Auto-advance is off when your system prefers reduced motion.
  A toolbar under the story shows which card you're on (for example `3 / 11`) and saves the
  current card. **PNG** (or press D) downloads it as a 1080x1920 `NN-<card>.png`, drawn
  in your browser. If the browser can't draw it, you get the SVG instead. **SVG**
  downloads `NN-<card>.svg`. **Share** appears only where the browser supports the
  system share sheet. It shares the PNG when it can, and otherwise the title text, never
  a link. Press **?** (or the ? button) for the list of keyboard shortcuts. Single-key
  shortcuts never fire with Ctrl, Alt or Cmd held, or while typing in a text field.
  Screen readers get each card's content as text too (its headline, numbers and lists).
- **PNGs**: each card as a 1080x1920 PNG, plus a 1200x630 `share.png` summary for link
  previews and social posts.
- **Terminal recap**: commits, active days, lines, power hour, busiest day of the
  whole window (e.g. `Busiest day  Oct 2, 2026 (14 commits)`), time zones (with two or
  more UTC offsets, e.g. `Time zones  3 time zones · mostly UTC+03:00 (62% of commits)`),
  weekend commits (with at least one, e.g. `Weekends  12 commits (8% of commits)`),
  late nights (with at least one commit between 00:00 and 04:59, e.g.
  `Late nights  12 commits (4% of commits) · latest 4:12 AM on Mar 3, 2024`),
  office hours (with at least one weekday commit between 09:00 and 17:59, e.g.
  `Office hours 1,234 commits (23% of commits)`),
  streak, longest break, cadence (with two or more active days, e.g.
  `Cadence  2.4 commits per active day · every 3 days`), coding sessions (when a session
  lasted a minute or more, e.g.
  `Sessions  42 sessions · median 35 min · longest 3h 10m (14 commits, Mar 2, 2026)`;
  a single session just `Sessions  1 session · 26h 41m (50 commits, Oct 8, 2026)`),
  hottest file, top folders (with two or more, e.g.
  `Top folders  src/ (1,234 lines) · test/ (567 lines) · (root) (89 lines)`),
  tests (when any test file changed, e.g. `Tests  1,234 lines (23% of lines changed)`),
  docs (when any doc file changed, e.g. `Docs  567 lines (8% of lines changed)`),
  co-changed files (when two files were changed together in 3+ commits, e.g.
  `Co-changed  README.md + src/cli.js (12 commits)`),
  one-touch files (when a changed file was touched by just one non-merge commit, e.g.
  `One-touch  42 files (31% of changed files)`),
  top grower (the file with the largest net line growth, when a file grew, e.g.
  `Top grower  src/cli.js (+1,500 / −266, net +1,234 lines)`),
  top shrinker (the file with the largest net line loss, when a file shrank, e.g.
  `Top shrinker src/old.js (−1,500 / +266, net −1,234 lines)`),
  files born / buried (files added and deleted, e.g. `Files  12 born · 3 buried`, plus
  ` · 4 renamed` when files were renamed or moved),
  top language, first commit, team (in a repo with more than one contributor: the top contributor, or
  with `--author` your rank, e.g. `Team  7 contributors · you're #2 (31% of commits)`),
  bus factor (right after the team line, when lines changed: the fewest people who made half
  of them, e.g. `Bus factor  2 people (58% of lines changed)`),
  pairing (when commits have `Co-authored-by:` trailers, e.g.
  `Paired  12 commits (31% of non-merge commits) · top co-author: Grace Hopper`),
  releases (when tags point at commits in the window, e.g.
  `Releases  3 releases · latest: v1.5.0 (Oct 6, 2026)`),
  merges (when there are merge commits or pull request numbers in the subjects, e.g.
  `Merges  12 pull requests merged · 8 merge commits (6% of commits)`),
  top word, biggest commit, commit size mix, commit type mix (when you use Conventional
  Commits, e.g. `Types  60% feat · 30% fix · 10% other (85% of commits conventional)`),
  emoji (when at least 5% of the commits have one, e.g.
  `Emoji  12% of commits · ✨ 40 · 🐛 22 · 📝 9`), reverts (when any commit reverts
  another, e.g. `Reverts  3 commits (2% of non-merge commits)`), fixups (when a non-merge
  commit is a `fixup!` / `squash!` / `amend!` commit, e.g. `Fixups  3 commits (2% of
  non-merge commits)`), subject length (e.g. `Subjects  median 48 chars · 3 commits over
  72 (2% of non-merge commits)`), message bodies (when a non-merge commit has a body
  beyond the subject, e.g. `Bodies  42 commits (31% of non-merge commits)`), top subject
  words (when a word is in at least 2 non-merge commit subjects, e.g. `Top words  "parser"
  ×5 · "cache" ×3 · "login" ×2 (commits per word)`), cleanups (when a non-merge
  commit removed more lines than it added, e.g. `Cleanups  12 commits (8% of non-merge
  commits) · biggest "drop the old parser" (−4,210 lines · Mar 3, 2026)`), issue references
  (when a non-merge commit's subject mentions an issue, e.g. `Issue refs  42 commits (12% of
  non-merge commits) · top #128 (9 commits)`), dependency bumps (when a non-merge commit only touched lockfiles
  and dependency manifests, e.g. `Dep bumps  12 commits (8% of non-merge commits)`), rewritten commits (when a
  non-merge commit was committed more than an hour after it was written, e.g. `Rewritten  9 commits (6% of
  non-merge commits)`) and personality, printed
  right after the run.
- **JSON** (optional, `--json`): every computed stat in `stats.json`, for your own
  dashboards and scripts.
- **Markdown** (optional, `--md`): a `wrapped.md` summary to paste into a README or a PR
  description (see [Markdown summary](#markdown-summary)).

```
gitwrapped-out/
  wrapped.html          # the story: open it in any browser
  cards/01-intro.svg    # 01-intro … 10-outro (up to 12-outro with the months / team cards), 1080x1920 SVG
  png/01-intro.png      # the same cards as PNG, ready to post
  share.png             # 1200x630 summary image
  share.svg             # the same summary as SVG
  stats.json            # only with --json: every stat as JSON
  wrapped.md            # only with --md: a Markdown summary linking the card SVGs
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
gitwrapped [path...] [options]
```

| Argument / option     | What it does                                                                           |
|-----------------------|----------------------------------------------------------------------------------------|
| `path`                | Path to the git repository (default: `.`; an empty path also means `.`). Give several paths for one Wrapped of all of them (see [Several repos at once](#several-repos-at-once)) |
| `--since YYYY-MM-DD`  | Only include commits made on or after this day (the author's local calendar day). Also a relative window: `30d`, `12w`, `6m` or `1y` before today (see [Relative windows](#relative-windows)). Without `--year`, the window is compared with the same number of days just before it (see [Period over period](#period-over-period)) |
| `--until YYYY-MM-DD`  | Only include commits made on or before this day, inclusive (the author's local calendar day). Also relative: `30d`, `12w`, `6m`, `1y` |
| `--year YYYY`         | One calendar year, the classic Wrapped: same as `--since YYYY-01-01 --until YYYY-12-31` (can't be combined with them), plus a comparison with the year before (see [Year over year](#year-over-year)) |
| `--author <email>`    | Only include commits by this author email (exact, case-insensitive match against the email after `.mailmap` is applied) |
| `--exclude <glob>`    | Leave matching files out of lines added/removed, files touched, hot files, one-touch files, the biggest grower and shrinker, top folders, the test and docs shares, the co-change pair, languages, the biggest commit, cleanups, dependency bumps, the commit size mix and files born / buried / renamed (a rename counts by its new path) (and the per-repo, per-contributor and year-over-year lines). Repeatable. Commits still count: a commit that only touched excluded files still counts toward commits, active days, streaks and habits (see [Excluding files](#excluding-files)) |
| `--out <dir>`         | Output directory (default: `gitwrapped-out`, created if needed)                        |
| `--lang <code>`       | Language of the cards, share image, viewer and terminal recap: `en` (English, default) or `tr` (Türkçe). Also `--lang=tr`; an unknown code is an error. `stats.json` and file names stay the same in every language |
| `--theme <name>`      | Color theme of the cards, share image, PNGs and viewer: `default` (the colorful gradients), `mono` (grayscale) or `neon` (near-black with neon glows). Also `--theme=mono`; an unknown name is an error. Only colors change: the layout, `stats.json` and file names are the same in every theme |
| `--max-commits <n>`   | Analyze at most the n most recent commits that match the other filters (default: 50000; with several repos, in total) |
| `--no-png`            | Skip PNG rendering (faster; SVG + HTML only)                                           |
| `--json`              | Also write every computed stat to `<out>/stats.json` (see [JSON output](#json-output)) |
| `--md`                | Also write a Markdown summary to `<out>/wrapped.md`, in the `--lang` language (see [Markdown summary](#markdown-summary)) |
| `--open`              | Open `<out>/wrapped.html` in your default browser when done, printing `Opening <path>…` first (`open` on macOS, `xdg-open` on Linux, `rundll32 url.dll,FileProtocolHandler <file:// URL>` on Windows). It waits at most 1.5 seconds for that command (never for the browser): if it can't be started or exits with an error in that time, gitwrapped prints a one-line warning with the path and still exits 0 |
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

# The last 90 days
npx @furkycl/gitwrapped --since 90d

# Generate and open the story in your browser right away
npx @furkycl/gitwrapped --open

# Also export the raw numbers as JSON
npx @furkycl/gitwrapped --json

# Just you, in a shared repo
npx @furkycl/gitwrapped --author you@example.com

# Kartlar Türkçe: cards, viewer and recap in Turkish
npx @furkycl/gitwrapped --lang tr

# Grayscale or neon cards instead of the default gradients
npx @furkycl/gitwrapped --theme mono
npx @furkycl/gitwrapped --theme neon

# Another repo, into a folder of your choice
npx @furkycl/gitwrapped ~/code/my-app --out ~/Desktop/my-app-wrapped

# Leave generated code and docs out of the line counts
npx @furkycl/gitwrapped --exclude 'src/generated/**' --exclude docs/ --exclude '*.min.js'

# Several repos in one Wrapped
npx @furkycl/gitwrapped ~/code/api ~/code/web ~/code/docs --year 2025

# Fast mode: skip PNG rendering
npx @furkycl/gitwrapped --no-png

# CI or logs: no color, first line is machine-friendly
NO_COLOR=1 npx @furkycl/gitwrapped --no-png | head -1
```

## Relative windows

`--since` and `--until` also take a window relative to today: `<N>d` (days), `<N>w`
(weeks), `<N>m` (calendar months) or `<N>y` (calendar years), N from 0 to 9999, case
doesn't matter. `--since 90d` means "from the day 90 days before today".

- "Today" is your machine's local date, and the result is a plain calendar day, read
  like any `YYYY-MM-DD` (the author's local day): the result depends only on your
  machine's local date, not on the time of day or DST. N goes from 0 to 9999.
- Months and years keep the day of month and clamp it to the target month's last day:
  on 2026-03-31, `1m` is 2026-02-28; on 2024-02-29, `1y` is 2023-02-28.
- `--until` works too (`--since 1y --until 3m`: from a year ago to three months ago),
  and you can mix forms (`--since 2026-01-01 --until 30d`).
- The resolved dates are what you see everywhere: the cards, the recap, notes such as
  "no commits match --since 2026-09-07", and `filters` in `stats.json`. A window that
  resolves before 1970 is an error, and like `--since` / `--until`, a relative window
  can't be combined with `--year`.

## Excluding files

`--exclude <glob>` (repeatable) drops matching files before any stat is computed: lines
added / removed, files touched, hot files, one-touch files, the biggest grower and shrinker, top folders, the test and docs shares, the co-change pair, languages, the biggest commit, cleanups, dependency bumps, the commit size
mix, files born / buried / renamed (by the new path), the per-repo breakdown, the team card's lines, the bus factor and the year-over-year lines changed all leave them out. Commits are never
dropped: a commit that only touched excluded files still counts toward commits, active
days, streaks, time habits and the team card's commit counts. Matching is
gitignore-like and case-sensitive:

- `*` matches anything except `/`, `?` one character except `/`, `**` as a whole path
  segment anything including `/` (`**/x` also matches `x` at the root; inside a name,
  as in `src**.js`, it is a plain `*`). Everything else is literal (no
  `[abc]`, `{a,b}` or `!` negation).
- A pattern without a `/` matches a file or folder name at any depth: `*.min.js`,
  `fixtures`, `CHANGELOG.md`.
- A pattern with a `/` inside, or starting with `/` or `./`, is anchored at the repo
  root: `src/generated/*.js`, `/README.md`.
- A pattern that matches a folder drops everything inside it: `docs`, `docs/` and
  `docs/**` all exclude `docs/guide/intro.md`. A trailing `/` only matches folders.
- Backslashes count as `/` (Windows), surrounding spaces are ignored, and an empty
  pattern is an error. Quote patterns with `*` so your shell does not expand them.
- With several repos, a pattern is tried against the path inside its repo
  (`src/x.js`, so `src/` excludes every repo's `src/`). A pattern with a `/` inside or a
  leading `/` is also tried against the shown path with the repo's label
  (`api/src/x.js`, so `api/src/` excludes only that repo's, and `/web` a whole repo's
  files), when its first segment has no wildcard. A name pattern, or a pattern that
  starts with a wildcard, never matches a label: `docs` drops `docs/` folders in every
  repo, not a repo called `docs`, and `*/generated/` drops the same files as with one
  repo.

`stats.json` echoes the patterns as `filters.exclude`.

## Year over year

With `--year`, gitwrapped also reads the year before with the same filters (`--author`,
`--exclude`, every repo given, `.mailmap`, `--max-commits`) and compares the two:

- the totals card adds three rows: commits, lines changed (added + removed) and active
  days vs the previous year, as signed changes (`+42`, `−1,203`, `±0`);
- the outro card opens with one line, e.g. "vs 2024: +42 commits, −1,203 lines
  changed, +5 active days." (unless the card needs that room for its releases panel);
- the terminal recap gets a `vs 2024` line, and `stats.json` a `yearOverYear` object
  (see [JSON output](#json-output)).

When either year has no commits (your first year in the repo, or a quiet one) there is
nothing to compare, and nothing is added. A `--since` / `--until` window that covers
exactly one calendar year gets the period-over-period comparison below instead, never
both.

## Period over period

With `--since` (an absolute date or a relative window like `30d`) and no `--year`,
gitwrapped compares the window with the same number of days just before it: for
`--since 2026-09-09` on 2026-10-08 (30 days, today included), that is 2026-08-10 to
2026-09-08. `--since 30d` covers 31 days, today included, so it is compared with the 31
days before. The window ends at `--until`, or today without it; an `--until` after today
counts only up to today (`--since 2026-10-01 --until 2026-12-31` on 2026-10-08 compares
8 days with the 8 before), and a window that starts after today is not compared. The
days are plain calendar days (month lengths and leap days count as they fall), so a
whole calendar year given as `--since 2025-01-01 --until 2025-12-31` is compared with
the 365 days before it, 2024-01-02 to 2024-12-31 after a leap year: use `--year 2025`
for a calendar year-over-year comparison. The earlier window is
read with the same filters as for [Year over year](#year-over-year), and:

- the totals card adds three rows, e.g. "Commits vs prev. 30 days" (just "Commits vs
  prev." when a large number leaves no room for the day count);
- the outro card opens with one line, e.g. "vs previous 30 days: +12 commits, −340
  lines changed, +3 active days.";
- the terminal recap and `wrapped.md` get a `vs prev. 30 days` line, and `stats.json` a
  `previousPeriod` object (see [JSON output](#json-output)).

When either window has no commits, or the earlier one would start before 1970, nothing
is added. If `--max-commits` cuts the earlier window short the recap says so, and if its
read fails gitwrapped prints a one-line warning and leaves the comparison out.

## Several repos at once

Pass more than one path to merge their histories into a single Wrapped:

```bash
npx @furkycl/gitwrapped ~/code/api ~/code/web ~/code/docs
```

- Every repo is read with the same `--since` / `--until` / `--year` / `--author` /
  `--exclude` filters, then the commits are merged, newest first (by author date).
- `--max-commits n` caps the merged history at n commits in total: each repo is read
  with the same cap (cut in git's log order), then the commits are merged and cut again
  to the n most recent by author date.
- File paths are prefixed with the repo's label (`api/src/server.js`), so hot files,
  top folders (`api/src`, `api/(root)`), languages and "files touched" never mix up two
  repos' `src/index.js`. A repo's label is
  the folder name of its top level; two repos with the same folder name become `app` and
  `app-2`. Lockfiles and build output are still ignored at each repo's own root.
- The cards call the run "3 repos" (intro, footer, outro, share image), the intro names
  the repos, and the totals and hot-files cards add a per-repo breakdown (commits and
  lines per repo; files touched per repo): up to four repos, or the top three plus
  "+N more". The per-repo chart usually leaves no spare room for the commit size bar,
  so it is left out there. When the totals card is short of space (with `--year`'s three
  extra rows, say) its per-repo chart is left out too so the commit count stays big; the
  per-repo numbers and the size mix are still in the recap and `stats.json`. The terminal recap lists each repo's
  commits and lines.
- Contributors (and `--author`'s "you vs the team") are counted across all the repos.
- Every path must be a git repository (the error names the one that isn't), and two
  paths of the same repository (`. ./src`, or a `git worktree` of a repo already given)
  are an error; both are checked before any history is read. A commit that appears in two
  repos (a fork, or a second clone) is counted once, under the first repo given.

## Card language (`--lang`)

`--lang tr` writes every card, the share image, the `wrapped.html` viewer (its buttons,
labels, screen-reader text and `<html lang="tr">`) and the terminal recap in Turkish:
Turkish month and weekday names ("4 Eki 2026", "Çarşamba"), 24-hour times ("23:00"),
`12.345` for thousands, `10,5` for decimals and `%74` for percents, and Turkish
upper-casing (i → İ) on the eyebrows and labels. Language names stay as they are,
except generic ones like "Text" ("Metin"). English is the default. Error messages
stay in English, and so does `stats.json`: its keys and values (archetype names, hour
labels, language names) are the same whatever `--lang` says. The strings live in `src/i18n/` (one table
per language, same keys); adding a language means adding a table there and registering it in `src/i18n/index.js`.

## Color themes (`--theme`)

`--theme` picks the colors of every story card, the PNGs, the share image and the
`wrapped.html` viewer (its background, glows and focus ring):

- `default`: a different bold gradient per card (what you get without `--theme`).
- `mono`: grayscale, charcoal to near-black, for a quiet black-and-white story.
- `neon`: near-black backgrounds with one vivid neon glow and accent per card.

Themes change colors only, never the layout, so every card says the same thing in
every theme. Full-opacity white text keeps a WCAG contrast of at least 4.5:1 on every
`mono` and `neon` background, including under the translucent panels and glows. The theme tables
live in `src/cards/themes.js`.

## JSON output

With `--json`, gitwrapped also writes `<out>/stats.json`: 2-space indented, with a fixed
key order and no generation timestamp, so the same history, options and `asOf` day give
the same file. It contains no paths from your machine (`repo` is just the folder name),
but it does contain commit subjects and hashes, tag names and repo-relative file paths (see
[Privacy](#privacy)).

| Key             | What it holds                                                                 |
|-----------------|-------------------------------------------------------------------------------|
| `schemaVersion` | `1`; bumped only when a key is removed or changes meaning                     |
| `generator`     | `{"name": "@furkycl/gitwrapped", "version": "<version>"}`                     |
| `repo`          | The repository's folder name (`null` when several repos were given)           |
| `repos`         | Only with several repos: their labels, in the order given (e.g. `["api", "web", "api-2"]`) |
| `asOf`          | `YYYY-MM-DD` the current streak is counted up to: today, or the end of a past `--until` / `--year` window |
| `filters`       | `{since, until, author, maxCommits, exclude}` as used (`--year` shows as since/until); dates and author are `null` when not set, `maxCommits` is the cap in effect, `exclude` the `--exclude` patterns in order (`[]` when none) |
| `truncated`     | `true` when `--max-commits` cut the history short                             |
| `stats`         | Every computed stat: `totals`, `habits`, `timezones`, `weekend`, `lateNights`, `officeHours`, `streaks`, `cadence`, `sessions`, `daily`, `busiestDay`, `months`, `hotFiles`, `folders`, `fileLifecycle`, `tests`, `docShare`, `coChange`, `oneTouch`, `biggestGrower`, `biggestShrinker`, `languages`, `contributors`, `messages`, `biggestCommit`, `commitSizes`, `commitTypes`, `emoji`, `reverts`, `cleanups`, `issueRefs`, `depBumps`, `rewritten`, `firstCommit`, `coAuthors`, `releases`, `merges`, `personality`, `repos` with several repos, `yearOverYear` with `--year`, and `previousPeriod` with `--since` (no `--year`) |

```json
{
  "schemaVersion": 1,
  "generator": { "name": "@furkycl/gitwrapped", "version": "1.16.0" },
  "repo": "my-app",
  "asOf": "2025-12-31",
  "filters": { "since": "2025-01-01", "until": "2025-12-31", "author": null, "maxCommits": 50000, "exclude": [] },
  "truncated": false,
  "stats": {
    "totals": { "commits": 412, "activeDays": 131, "linesAdded": 30211, "...": "..." },
    "timezones": {
      "count": 2, "top": { "offset": "+03:00", "commits": 301, "share": 0.731 },
      "offsets": [{ "offset": "+03:00", "commits": 301 }, { "offset": "-05:00", "commits": 111 }]
    },
    "weekend": { "commits": 33, "share": 0.08 },
    "lateNights": { "commits": 18, "share": 0.044, "latest": { "date": "2024-03-03", "time": "04:12" } },
    "officeHours": { "commits": 95, "share": 0.231 },
    "busiestDay": { "day": "2025-03-04", "commits": 14 },
    "folders": [{ "path": "src", "lines": 18452, "added": 14210, "deleted": 4242, "commits": 301 }, "..."],
    "fileLifecycle": { "added": 57, "deleted": 12, "renamed": 9 },
    "tests": { "lines": 9311, "share": 0.214 },
    "docShare": { "lines": 3120, "share": 0.072 },
    "coChange": { "files": ["README.md", "src/cli.js"], "commits": 12 },
    "oneTouch": { "files": 142, "share": 0.38 },
    "biggestGrower": { "path": "src/cli.js", "net": 1234, "added": 1500, "removed": 266 },
    "biggestShrinker": { "path": "src/legacy.js", "net": 410, "added": 12, "removed": 422 },
    "merges": { "commits": 25, "share": 0.061, "pullRequests": 31 },
    "cleanups": {
      "commits": 48, "share": 0.117,
      "biggest": { "hash": "1a2b3c4d…", "subject": "chore: drop the old parser", "date": "2025-03-03", "linesAdded": 12, "linesRemoved": 4222, "net": 4210 }
    },
    "issueRefs": { "commits": 42, "share": 0.102, "top": { "ref": "#128", "commits": 9 } },
    "depBumps": { "commits": 37, "share": 0.09 },
    "rewritten": { "commits": 25, "share": 0.061 },
    "streaks": {
      "longest": { "length": 9, "start": "2025-03-02", "end": "2025-03-10" },
      "current": { "length": 0, "start": null, "end": null },
      "longestBreak": { "days": 23, "from": "2025-07-04", "to": "2025-07-28" }
    },
    "cadence": { "perActiveDay": 3.1, "medianGapDays": 1.5 },
    "sessions": { "count": 412, "medianMinutes": 35, "longest": { "minutes": 190, "commits": 14, "day": "2025-03-02" } },
    "languages": {
      "totalLines": 41020, "totalFiles": 212, "basis": "lines",
      "languages": [{ "name": "TypeScript", "type": "programming", "lines": 29534, "files": 140, "share": 72 }, "..."]
    },
    "contributors": {
      "total": 7,
      "top": [{ "name": "Ada Lovelace", "rank": 1, "commits": 221, "added": 18022, "removed": 4410, "share": 53.6 }, "..."],
      "you": null,
      "authorFilter": false,
      "truncated": false,
      "busFactor": { "authors": 2, "share": 0.584 }
    },
    "...": "..."
  }
}
```

`stats.streaks` holds `longest` and `current` (`{length, start, end}`, author-local
`YYYY-MM-DD` days) and `longestBreak`, the longest gap between two consecutive active days:
`{days, from, to}` where `from` is the last active day before the gap, `to` the next active
day after it, and `days` the idle days in between (so `2025-07-04` → `2025-07-28` is 23
days). A tie goes to the earliest gap; with fewer than two active days or no gap it is
`{"days": 0, "from": null, "to": null}`.

`stats.cadence` is `{"perActiveDay": x, "medianGapDays": y}`: `perActiveDay` is the
commits per active day (1 decimal), over the same author-local days as
`totals.activeDays` and the commits on them (every commit with a parseable date, merge
commits and future-dated ones included); `medianGapDays` is the median number of calendar
days between consecutive active days (back-to-back days are 1 apart, Monday → Thursday 3;
with an even number of gaps the mean of the middle two, so it can end in `.5`), `null`
with fewer than two active days (`{"perActiveDay": 0, "medianGapDays": null}` without
commits). The streak card, the recap and `wrapped.md` show it with two or more active
days, leaving out days after tomorrow as for the longest streak and break.

`stats.sessions` is your coding sessions, `{"count": n, "medianMinutes": m, "longest":
{"minutes": x, "commits": c, "day": "YYYY-MM-DD"}}`, or `null` without a commit with a
parseable date. A session is a run of one author's commits (authors told apart as the
contributors are, after `.mailmap`) where each commit is at most two hours (120 minutes)
after the one before it, so two people committing in the same hour never share one. It
lasts from its first commit to its last, in whole minutes (a one-commit session is 0
minutes). Every commit with a parseable date counts, merge commits and future-dated ones
included, as for the power hour. `count` is how many sessions there are, `medianMinutes`
their median length (with an even count the mean of the middle two, rounded to a whole
minute), and `longest` the longest one (a tie goes to the one with more commits, then the
earliest) with its commits and the author-local day of its first commit; sessions that
start after tomorrow are left out of `longest` unless every one does. The cards, the recap
and `wrapped.md` show it only when the longest session lasted a minute or more (with every
session a single commit there is nothing to tell).

`stats.busiestDay` is the single author-local calendar day with the most commits in the
window, as `{"day": "YYYY-MM-DD", "commits": n}` (a tie goes to the earliest day; `null`
without commits). It is the same day as `stats.daily.busiest`, and it counts every commit,
including ones dated in the future (the activity card, the recap and `wrapped.md` leave
those days out, see below). The recap and `wrapped.md` show this day; on a history longer
than about a year the activity card shows the busiest day of the last 53 weeks on its grid
instead, so the two can differ.

`stats.timezones` is the time zones the commits were made from: the UTC offset in each
commit's author date (git records the author's offset, so this is where their clock was,
not where your machine is). `offsets` is `[{"offset": "+03:00", "commits": n}]`, one per
distinct offset, most commits first (a tie goes to the lower offset, west to east);
offsets are always `+HH:MM` / `-HH:MM` (`Z` and `-00:00` are `+00:00`; half-hour offsets
such as `+05:30` are their own). `count` is how many there are and `top` is the first one
as `{"offset", "commits", "share"}` (`share` of the commits, `0`..`1` with 3 decimals, at
most `0.999` when there is more than one offset), or `null` without commits
(`{"count": 0, "top": null, "offsets": []}`). Like the power hour
it counts every commit in the window, merge commits included; with several repos it is
over all of them. The power-hour card, the recap and `wrapped.md` only mention time zones
when there are two or more.

`stats.weekend` is how many commits landed on a Saturday or Sunday, in each author's own
local time (the weekday of the commit's author date in its own offset), as
`{"commits": n, "share": x}`: `share` is of the commits that carry a date (the same base as
the power hour), `0`..`1` with 3 decimals, at most `0.999` unless every dated commit is a
weekend one (`{"commits": 0, "share": 0}` without commits). Like the power hour it counts
every dated commit in the window, merge commits and future-dated ones included, so it is
the same count the Weekend Warrior personality scores;
the recap, `wrapped.md` and the activity card quote the same whole percent as Weekend
Warrior's reason (never "100%" short of every commit, "<1%" for a share that rounds to 0), and only when there is at least one weekend commit.

`stats.lateNights` is how many commits landed between 00:00 and 04:59 in each author's own
local time, as `{"commits": n, "share": x, "latest": {"date": "YYYY-MM-DD", "time": "HH:MM"}}`.
`commits` and `share` work like `stats.weekend`: every dated commit counts (merges and
future-dated ones included), `share` is of the dated commits, `0`..`1` with 3 decimals and
at most `0.999` unless every commit is a late-night one. `latest` is your latest-ever commit
time of day, where the night wraps: the day is taken to end at 05:00, so 04:59 is the latest
possible and 00:30 is later than 23:59. It is that commit's own author-local day and
`HH:MM` (no hash, no email); commits in the same minute tie and the earliest of them wins.
Commits dated after tomorrow (clock skew) still count in `commits` and `share` but are left
out of `latest`, unless every commit is (so when every late-night commit is future-dated,
`commits` can be 1 or more while `latest` is an evening time).
Without a late-night commit `latest` is your latest evening (or daytime) commit, and it is
`null` without dated commits (`{"commits": 0, "share": 0, "latest": null}`). Late nights
(00:00–04:59) are not the Night Owl personality's window (22:00–03:59): both are counted from
the same hours of `stats.habits.byHour`, so they never disagree, but they overlap only from
midnight to 03:59, and the two percents can differ. The power-hour card (with room), the
recap and `wrapped.md` show the late nights only when there is at least one, with the same
whole percent rule as the weekend line ("<1%" for a share that rounds to 0).

`stats.officeHours` is how many commits landed on a weekday (Monday to Friday) between
09:00 and 17:59 in each author's own local time, as `{"commits": n, "share": x}`. It works
like `stats.weekend`: every dated commit counts (merges and future-dated ones included, the
same commits as `stats.habits.byHour`), `share` is of the dated commits, `0`..`1` with 3
decimals and at most `0.999` unless every commit is an office-hours one
(`{"commits": 0, "share": 0}` without dated commits). A commit at `07:00Z` made in `+03:00`
is a 10:00 one. The power-hour card (else the activity card, with room), the recap and
`wrapped.md` show it only when there is at least one, with the same whole percent rule as
the weekend line.

`stats.fileLifecycle` is how many files were born, buried and renamed in the window, as
`{"added": n, "deleted": n, "renamed": n}`: the files the commits added, deleted and
renamed or moved (all `0` when none; `renamed` is new in 1.12, so read a missing one as
`0`). It is read with one extra `git log --name-status --diff-filter=ADR -M` call over the commits
read (so the window, `--author` and `--max-commits` apply), with rename detection on, so a
renamed or moved file is neither added nor deleted but renamed (copies are not counted;
a rename is counted by its new path, so a move into an ignored folder such as `vendor/`
or an `--exclude`d one does not count, and a move out of one does; a rename edited beyond git's
similarity threshold, or one in a commit too big for git's `diff.renameLimit`, still counts
as one delete and one add; if that extra git call fails, all three counts fall back to `0`). Each add, delete or rename counts
once per commit, so a file added, deleted and added again is 2 added and 1 deleted. The
same files as hot files count (lockfiles, build output, vendored code, minified files and
snapshots are left out, and so is anything you `--exclude`); merge commits are skipped (git
gives them no diff, as for the line counts), and so are a shallow clone's boundary
commits. With several repos it is the sum over all of them.

`stats.folders` is the most-changed top-level folders by lines changed, the top five as
`[{"path", "lines", "added", "deleted", "commits"}]`: `path` is the folder's name at the
repo root (`"src"`), or `"(root)"` for the files at the repo root itself; with several
repos it starts with the repo's label (`"api/src"`, `"api/(root)"`). `added` / `deleted`
are the lines added and deleted in its files, `lines` their sum, and `commits` how many
commits touched at least one of its files. The same files as hot files count (lockfiles,
build output, vendored code, minified files and snapshots are left out, and so is
anything you `--exclude`); a folder with no lines changed (only binary files) is left out.
Most lines first, a tie going to the path that sorts first (`[]` without changes). In
`path` anything shaped like an email address is replaced with "…". The hot-files card,
the recap and `wrapped.md` only show folders when there are two or more.

`stats.tests` is the lines changed in test files: `{"lines", "share"}`, `lines` the lines
added plus deleted in them and `share` their share of all lines changed (0 to 1, three
decimals; never 1 unless every changed line is in a test; the cards, recap and
`wrapped.md` round the exact line ratio to a whole percent, not this rounded `share`). A test file is one under a
directory named exactly `test`, `tests`, `__tests__`, `spec` or `specs` at any depth, or one
whose name contains `.test.`, `.spec.`, `_test.`, `_spec.` or `_tests.` (`app.test.js`,
`user.spec.ts`, `db_test.go`, `user_spec.rb`, `parser_tests.rs`), starts with `test_` and
has an extension (`test_utils.py`), is exactly `conftest.py`, or ends in `Test` or `Tests`
after a letter or digit with a `.java`, `.kt`, `.scala`, `.groovy`, `.cs`, `.fs`, `.vb`,
`.swift`, `.php`, `.m` or `.mm` extension (`FooTest.java`, `UserTests.cs`), or in `Spec`
with a `.kt`, `.scala`, `.groovy`, `.swift`, `.php`, `.m` or `.mm` one (`LoginSpec.groovy`;
`PodSpec.java` is not a test). Every rule is case-sensitive, so `Test/`, `testing/`, `testdata/`,
`Latest.java` and `FooTest.js` don't count, and a file named `tests.js` or `spec.rb` isn't a
test either; with several repos the path inside
each repo is checked, so a repo labelled `test` is not all tests. The same files as hot
files count (lockfiles, build output, vendored code, minified files and snapshots are left
out, and so is anything you `--exclude`). `null` when no line changed at all; `{"lines": 0,
"share": 0}` when lines changed but none in tests (the cards, recap and `wrapped.md` then
show nothing).

`stats.docShare` is the same for documentation files: `{"lines", "share"}` with the same
rounding, or `null` when no line changed at all. A doc file is one under a directory named
exactly `docs` or `doc` at any depth (case-sensitive, so `Docs/` and `documentation/` don't
count; every file under one counts, `docs/notes.txt` and `docs/conf.py` too), or one whose
name ends in `.md`, `.mdx`, `.rst` or `.adoc` in any letter case (`README.md`,
`CHANGELOG.MD`). A `.txt` file outside a docs directory is not a doc. A file can be both a
test and a doc (`test/README.md`) and then counts toward both shares. The same files as hot
files count (ignored paths and anything you `--exclude` are left out; with several repos the
path inside each repo is checked).

`stats.coChange` is the two files changed together in the most non-merge commits:
`{"files": [a, b], "commits"}`, the two paths sorted (plain code-unit order; with several
repos each starts with its repo's label, as in `hotFiles`) and how many commits changed
both. The same files as hot files count (lockfiles, build output, vendored code, minified
files and snapshots are left out, and so is anything you `--exclude`); a file listed twice
in one commit counts once, merge commits are skipped, and so are commits with more than 30
counted files (sweeping renames or reformats say little about which files belong together,
and leaving them out keeps big repos fast). A tie goes to the pair whose first file sorts
first, then whose second does. `null` when no two files share at least 3 commits. In the
paths anything shaped like an email address is replaced with "…".

`stats.oneTouch` is how many of the files changed in the window were touched by exactly one
non-merge commit: `{"files", "share"}`. The same files as hot files count (lockfiles, build
output, vendored code, minified files and snapshots are left out, and so is anything you
`--exclude`), and a file's touches are counted as hot files count its commits (a file listed
twice in one commit is one touch). Renames follow hot files too: git's diff is read without
rename detection, so a rename is the old path plus the new one, and a file renamed once and
not otherwise touched in the window counts as two one-touch files. With several repos each path keeps its
repo's label, so `README.md` in two repos is two files. `share` is `files` over every
distinct changed file (3 decimals, at most `0.999` unless every file was touched once).
`{"files": 0, "share": 0}` when every changed file was touched more than once (the cards,
recap and `wrapped.md` then show nothing); `null` when no file changed.

`stats.biggestGrower` is the file that grew the most: the largest net line growth (lines
added minus lines removed) over the non-merge commits in the window, `{"path", "net",
"added", "removed"}` (`added` / `removed` are that file's totals, `net` their difference).
The same files as hot files count (lockfiles, build output, vendored code, minified files and
snapshots are left out, and so is anything you `--exclude`); binary files add 0 lines. Renames
follow hot files: git's diff is read without rename detection, so a rename removes every line
of the old path and adds every line of the new one, and a file moved in the window can show
as the biggest grower. With several repos the path starts with its repo's
label, as in `hotFiles`. A tie goes to the path that sorts first (plain code-unit order).
`null` when no file grew (every file's net is 0 or less, or no file changed). In the path
anything shaped like an email address is replaced with "…".

`stats.biggestShrinker` is its mirror, the file that shrank the most: the largest net line
loss (lines removed minus lines added) over the non-merge commits in the window,
`{"path", "net", "added", "removed"}` (`added` / `removed` are that file's totals, `net` the
lines lost, `removed − added`, always positive). It counts the same files as
`stats.biggestGrower` (and hot files), treats renames the same way (a file moved in the
window shows its old path losing every line, so it can be the biggest shrinker), labels paths
with their repo with several repos and breaks a tie the same way (the path that sorts first).
A file deleted in the window counts with every line it lost. `null` when no file shrank
(every file's net loss is 0 or less, or no file changed). In the path anything shaped like an
email address is replaced with "…".

`stats.months` is commits per author-local calendar month: `months` is
`[{"month": "YYYY-MM", "commits": n}]`, oldest first, contiguous from the first to the last
month with commits (months without commits are listed with `0`; `[]` when there are no
commits), and `peak` is the month with the most commits as `{month, commits}` (a tie goes
to the earliest month; `null` without commits). It counts every commit, including ones
dated in the future, and covers every month, not just the 24 the card shows.

`stats.biggestCommit` is the commit with the most lines changed, as
`{"hash", "subject", "date": "YYYY-MM-DD", "linesAdded", "linesRemoved", "lines", "files"}`
(`date` is the author's local day, `lines` is added + removed and `files` the files it
counted), or `null` when no commit changed a line. `hash`, `subject` and `date` can each
be `null` (no hash, an empty subject, an unparseable date); in `subject` anything shaped
like an email address is replaced with "…". Lines are counted over the
same files as hot files, so lockfiles, build output, vendored code, minified files and
snapshots don't make a commit big, and `--exclude`d files are left out too; merge commits
are skipped, and a tie goes to the earliest commit. History is read with `--no-renames`,
so a commit that moves or renames large files counts their lines as removed and added
again, and can be the biggest commit.

`stats.firstCommit` is the first commit in the window, as
`{"date": "YYYY-MM-DD", "subject", "hash"}` (plus `"repo"`, its repo's label, when you pass
several repos), or `null` when there are no commits. It is the earliest commit by author
date among the commits read (so `--since` / `--until` / `--year`, `--author` and the other
filters apply; when the history is capped by `--max-commits`, or the clone is shallow, it
is the earliest commit read, not the repo's very first), merge commits skipped as for the biggest commit; commits at the same
instant go to the one git lists last. `date` is the author's local day, `hash` the first 7
characters of the commit hash, and in `subject` anything shaped like an email address is
replaced with "…". `date`, `subject` and `hash` can each be `null`.

`stats.commitSizes` is the commit size mix:
`{"total", "tiny", "small", "medium", "large", "shares": {"tiny", "small", "medium", "large"}}`.
`total` is the number of non-merge commits, and each one is counted in exactly one bucket
by its lines changed (added + removed): `tiny` under 10 lines (0–9, so a commit that only
touched ignored or binary files is tiny), `small` 10–99, `medium` 100–500 and `large`
over 500. Lines are counted over the same files as `biggestCommit` (and hot files), so
lockfiles, build output and `--exclude`d files don't count. `shares` are whole percents of
`total` (largest-remainder rounding, so they always add up to exactly 100; all `0` without
commits). The totals card shows the mix only when there is at least one such commit.
The card, the recap and `wrapped.md` show a size with under 1% of the commits as "<1%"
(never "0%"), and cap a size at 99% while another has commits; `stats.json` keeps the raw
shares.

`stats.messages.fixups` is how many autosquash commits reached your history:
`{"commits", "share"}`. A fixup commit is a non-merge commit whose subject starts with
`fixup! `, `squash! ` or `amend! ` (the `!` followed by a space), exactly as
`git commit --fixup`, `--squash` and `--fixup=amend:` write them and
`git rebase --autosquash` matches them: case-sensitive (`Fixup! x` is not one), with no
leading whitespace, and a bare `fixup!` is not one; `fixup! fixup! x` counts once.
`share` is `commits` over every non-merge commit (3 decimals, at most `0.999` unless all
of them are). Without any, it is `{"commits": 0, "share": 0}` and the cards, the recap
("Fixups") and `wrapped.md` ("Fixup commits"; "Fixup'lar" / "Fixup commit'leri" in
Turkish) show nothing new. With several repos the commits of every repo are counted
together.

`stats.messages.subjectLength` is how long your commit subjects are:
`{"median", "over72", "share"}`. Every non-merge commit counts, its subject trimmed and
measured in Unicode code points (a commit without a subject counts as 0). `median` is the
middle length; with an even number of commits, the mean of the two middle ones (so a
whole number or exactly `.5`). `over72` is how many subjects are longer than 72
characters (the length git's documentation and most style guides suggest staying within),
and `share` is `over72` over every non-merge commit (3 decimals, at most `0.999` unless all
of them are; `0` without any). `null` without a non-merge commit (the cards, the recap and
`wrapped.md` then show nothing). With several repos the commits of every repo are counted
together.

`stats.messages.bodies` is how often you explain a commit beyond its subject:
`{"commits", "share"}`. A non-merge commit has a body when its message says anything
after the subject (the first paragraph, as git's `%s` / `%b` split it) once blank lines,
trailers and `git revert`'s boilerplate are left out. The body is split into paragraphs
at blank lines, and a paragraph is left out when it is
- a trailer block: its first line is a trailer and every other line is a trailer or a
  folded continuation (starting with a space or tab). A trailer is a `Token: value` line
  whose token is a people token ending in `-by` (`Signed-off-by`, `Co-authored-by`,
  `Reviewed-by`, `Acked-by`, `Tested-by`, `Reported-by`, `Suggested-by`, `Helped-by`, ...)
  or one of `Change-Id`, `Reviewed-on`, `git-svn-id`, `Bug-Url`, `Message-Id`,
  `Closes-Bug`, `Partial-Bug`, `Related-Bug`, `Depends-On` (any value); or one of `Cc`,
  `Bcc`, `Fixes`, `Closes`, `Resolves`, `Refs`, `Ref`, `References`, `Related`, `Bug`,
  `Issue`, `Link`, or any other hyphenated token (tool trailers such as
  `X-Ticket: ABC-1`), whose value is a list of references (`#123`, `owner/repo#123`,
  `GH-123`, `ABC-123`, a URL, a commit hash, a bare number, an email or `Name <email>`,
  separated by commas, or the kernel's `Fixes: <hash> ("subject")`). Tokens match in any
  case; `git cherry-pick -x`'s `(cherry picked from commit …)` line counts as a trailer
  too. So `Fixes: #12` is a trailer, but `Fixes: a race where …`, `Follow-up: …`,
  `Trade-offs: …` and `Note: …` are prose; or
- what `git revert` writes: `This reverts commit <hash>.` (`This reverts commit <hash>,
  reversing changes made to <hash>.` for a merge; with `git revert --reference` each
  hash is followed by `(<subject>, <YYYY-MM-DD>)`), however its lines are wrapped (a
  paragraph over 2,048 characters is always prose). A revert with its own explanation
  paragraph still has a body.

A commit counts when any paragraph is left. This is not git's own trailer parsing (git
only reads the last paragraph, takes any `Token: value` and tolerates some other lines
in it): the question is whether someone wrote anything beyond the subject. `share` is
`commits` over the non-merge commits (3 decimals, at most `0.999` unless all of them
are); without any it is `{"commits": 0, "share": 0}` and the cards, the recap ("Bodies";
"Mesaj gövdeleri" in Turkish) and `wrapped.md` ("Message bodies"; "Mesaj gövdeleri")
show nothing new. The bodies are read with one extra `git log` call over the selected
commits (no diff, its output parsed as it streams in), so `--author`, the window,
`.mailmap` and `--max-commits` apply as everywhere else; only a yes / no per commit is
kept, never the text. `null` without a non-merge commit, or when git could not read the
bodies (unknown is never reported as 0). With several repos the commits of every repo are
counted together.

`stats.messages.topWords` is the words you use most in commit subjects: up to three
`{"word", "count"}` entries, most common first, ties in alphabetical (code-unit) order,
`[]` when no word qualifies. It is a separate rule from `topWord` (the card's big
favorite word, which counts every occurrence and leaves out conventional-commit types
and the fix / wip / oops words). `count` is how many non-merge commits use the word: each
subject counts a word once ("test test test" counts 1). Each subject (with
email-shaped text cut, as everywhere) is read like this:
- Unicode NFC-normalized; then git's `fixup! ` / `squash! ` / `amend! ` markers, emoji
  and gitmoji `:shortcode:`s in front, and a `Revert "…"` wrapper are cut (nested ones
  too, so `Revert "fixup! ✨ feat: add parser"` gives "add" and "parser");
- a leading Conventional Commits-shaped prefix is cut (`feat:`, `fix(api)!:`: ASCII
  letters, an optional `(scope)` and `!`, a colon, then a space or the end), so `fix` or
  `feat` count only when written in the subject itself. Any leading `word:` or
  `word(scope):` counts as such a prefix, not only the known types, so a Go-style
  `pkg: message` subject loses `pkg`;
- gitmoji `:shortcode:`s anywhere, URLs, issue references (`#123`, `owner/repo#12`, `GH-12`, Jira-style `ABC-123`) and
  hex hashes (7 or more hex digits with at least one digit, so SHA-256 hashes too) are cut;
- words are runs of Unicode letters (with their combining marks; an inner apostrophe
  keeps one word: "don't", "README'yi"), so numbers and other tokens without letters
  never count ("utf8" counts as "utf"); lowercased the same way in every language (a
  dotted "İ" becomes "i", so "İYİ" is "iyi", but an undotted "I" also becomes "i", not
  "ı": "KIRMIZI" is "kirmizi"), and kept only with at least 3 characters (code points) and when not on a small
  English and Turkish stopword list ("the", "and", "for", "with", "from", "into", "how",
  "why", "does", "don't", …;
  "ve", "ile", "için", "bir", "bu", "da", "de", …).

Merge commits are skipped. `stats.json` keeps the top three whatever their counts; the
messages card ("Top words"; "En sık kelimeler" in Turkish), the recap ("Top words";
"Sık kelimeler") and `wrapped.md` ("Top subject words"; "Konu satırlarında en sık geçen
kelimeler") only show words used by at least 2 commits (the recap and `wrapped.md` cut a
word over 24 characters with "…"), and nothing without one. With several repos the commits of every repo
are counted together.

`stats.commitTypes` is the Conventional Commits mix:
`{"total", "conventional", "share", "counts": {"feat", "fix", "docs", "refactor", "test", "chore", "other"}, "shares": {...same keys}, "top", "shown"}`.
`total` is the number of non-merge commits with a subject (the commits the messages card
counts), and `conventional` how many of them follow the convention: the subject starts
with a type, an optional `(scope)`, an optional `!` and then `: ` and a description
(`feat: dark mode`, `fix(api)!: drop v1`; case doesn't matter). Emoji in front of the type,
as gitmoji users write them (`✨ feat: dark mode`, `:sparkles: feat: dark mode`,
`1️⃣ feat: …`), are skipped. Recognized types are
`feat`, `fix`, `docs`, `refactor`, `test` and `chore`, the aliases `feature` / `features`
(feat), `bugfix` / `hotfix` (fix), `doc` (docs) and `tests` (test), and `perf`, `ci`,
`build`, `style`, `revert`, `release` and `deps`, which count as `other`. Any other word
before the colon (`Update: readme`, `WIP: ...`) is not conventional and is in no bucket,
so `counts` add up to `conventional`. `share` is `conventional / total` (3 decimals),
`shares` are whole percents of `conventional` (largest remainder, adding up to exactly
100; all `0` without conventional commits), `top` is the type with the most commits (ties
in the order above; `null` without any), and `shown` is `true` when at least 20% of the
commits are conventional: only then do the messages card, the recap and `wrapped.md`
show the mix. Like the size mix, they show a type under 1% as "<1%" and cap one at 99%
while another has commits.

`stats.emoji` is how you use emoji in commit subjects:
`{"total", "commits", "share", "distinct", "top": [{"emoji", "count"}], "shown"}`.
`total` is the number of non-merge commits with a subject (as for `commitTypes`), and
`commits` how many of them have at least one emoji in the subject. An emoji is a Unicode
emoji (a ZWJ sequence like 👩‍💻, a skin tone like 👍🏽, a flag like 🇹🇷 or a keycap like 1️⃣
counts as one; text-style symbols like ©, ™, → or ♻, and pictographs such as 🅰 that are text by default, count only
with U+FE0F) or a
[gitmoji](https://gitmoji.dev) shortcode like `:sparkles:` or `:bug:` (the gitmoji list
and a few common aliases such as `:+1:` and `:heart:`; any other `:word:` is not an
emoji). A shortcode that is part of other text doesn't count either: right after a letter
or digit (`10:100:00`), right after a lone `:` (`std::thread::spawn`, `crate::lock::Mutex`;
`:recycle::fire:` is still two), right before `:` and a letter or digit (`:lock::Mutex`)
or inside brackets (`arr[:100:]`). A shortcode is the same emoji as its Unicode form, and an emoji with or
without U+FE0F is one emoji, so `:sparkles:`, ✨ and ✨️ all count as ✨. `share` is
`commits / total` (3 decimals), `distinct` how many different emoji were used, and `top`
the three emoji used by the most commits, most first, with `count` the number of commits
whose subject has it (an emoji repeated in one subject counts once); ties go to the lower
emoji in code point order, and `emoji` is its fully qualified form (with U+FE0F when any
use had it). Without any emoji, `commits`, `share` and `distinct` are `0` and `top` is
`[]`. `shown` is `true` when at least 5% of the commits have an emoji: only then do the
messages card, the recap and `wrapped.md` show it, as a whole percent capped at 99% while
some commit has none.

`stats.reverts` is how often you revert: `{"total", "count", "share", "reverted"}`.
`total` is the number of non-merge commits, and `count` how many of them revert another
commit: the subject starts with `Revert "` (what `git revert` writes, capitalized; a
revert of a revert, `Revert "Revert "…""`, is still one revert) or is a Conventional
Commits revert (`revert: …`, `revert(scope): …`, any case, also after a gitmoji such as
`⏪ revert: …`) or a line of the message
starts with `This reverts commit <hash>` (a mention in the middle of a line doesn't count; `git revert` also writes it for a "Reapply"; read with one extra
`git log --grep` call over the commits read, so only those messages are read). `share`
is `count / total` (3 decimals) and `reverted` how many distinct commits those lines name
(an abbreviated hash and the full one, or two abbreviations where one is a prefix of the
other, are one commit; `0` when only subjects say so). Without reverts, `count`, `share` and `reverted` are `0`, and the
messages card, the recap and `wrapped.md` are exactly as before.

`stats.cleanups` is your cleanup commits: the non-merge commits that removed more lines
than they added, `{"commits", "share", "biggest"}`. Lines are counted over the same files
as hot files and the biggest commit (lockfiles, build output, vendored code, minified
files and snapshots are left out, and so is anything you `--exclude`); a commit with no
counted line, or as many added as removed, is not a cleanup. `share` is `commits` over
every non-merge commit (3 decimals, at most `0.999` unless every one is a cleanup).
`biggest` is the cleanup with the largest net deletion, `{"hash", "subject", "date",
"linesAdded", "linesRemoved", "net"}` like `stats.biggestCommit` (`date` the author-local
day, `net` = `linesRemoved − linesAdded`; anything shaped like an email address in the
subject is replaced with "…"); a tie goes to the earliest commit. `null` when no commit is
a cleanup (the cards, recap and `wrapped.md` then show nothing).

`stats.issueRefs` is how often your commit subjects mention an issue: `{"commits",
"share", "top": {"ref", "commits"}}`. Only non-merge commits count ("Merge pull request
#12" is a merge), and only their subject. A mention is `#123` (1–7 digits, not starting
with 0; not right after a letter, digit, `_`, `/`, `&` or `#`, so `a#1`, `foo/#12` and the
HTML entity `&#123;` don't count, nor `#123abc`; a `/` right after another mention is fine, so
`#12/#13` counts both), `GH-123` in any case (the same issue as
`#123`), or a Jira-style key: an uppercase project key of 2–10 letters and digits starting
with a letter, `-` and a number (`ABC-123`; not inside a path, a dotted name or a version
such as `ABC-1.2`, and not the encodings, hashes, standards and advisories `UTF`, `SHA`,
`ISO`, `RFC`, `CVE`, `CWE`, `GHSA`, `PEP`, `ES`, `ECMA`, `HTTP`, `TLS`, `SSL`, `AES`,
`RSA`, `COVID`, versions and platforms such as `X86`, `WIN`, `IE`, `IPV`, `LATIN`, `CP`,
`BASE`, `MD`/`MD5`, `SHA1`–`SHA3`, and periods `Q1`–`Q4`, `H1`, `H2`, `FY`, so `UTF-8`,
`SHA-256`, `X86-64` and `Q3-2024` don't count). URLs (`https://…`, `www.…`), lowercase
commit hashes (7–64 hex digits) and email addresses are skipped first. A squash-merged
subject's PR number (`feat: x (#12)`) counts too: GitHub numbers issues and pull requests
alike. `commits` is how many commits mention at least one issue (once each), `share` is
`commits` over every non-merge commit (3 decimals, at most `0.999` unless all of them do),
and `top` the issue mentioned by the most commits (a commit naming it twice counts once),
as `#123` or `ABC-123`; a tie goes to the lowest `#` number, then to Jira-style keys by key
and number. With several repos, `#` numbers are counted per repo (`#12` in two repos is
two issues) and such a `top` also has `repo`, its label; Jira-style keys are shared. The
cards, the recap and `wrapped.md` name the top issue only when two or more commits mention
it. `null` when no commit mentions an issue (the cards, recap and `wrapped.md` then show
nothing). Mentions in the message body, cross-repo mentions (`owner/repo#12`) and
lowercase keys (`abc-123`) are not counted.

`stats.depBumps` is how many of your non-merge commits were dependency bumps: `{"commits",
"share"}`. A dependency bump touched at least one file, and every file it touched is a
lockfile (the ones hot files ignore: `package-lock.json`, `npm-shrinkwrap.json`,
`yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`,
`poetry.lock`, `Pipfile.lock`, `composer.lock`, `go.sum`, `mix.lock`, `pubspec.lock`,
`Podfile.lock`, `packages.lock.json`, `flake.lock`, `uv.lock`) or a dependency manifest
(`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `Gemfile`, `composer.json`,
`Pipfile`, `pubspec.yaml`, `mix.exs`, `Podfile`, `flake.nix`, a `requirements*.txt` such
as `requirements-dev.txt`, or Go's `vendor/modules.txt` from `go mod vendor`, in a
`vendor` folder at any depth). Files are matched by their exact name at any depth
(`packages/web/package.json` counts), case-sensitive like the lockfiles (`Package.json`
does not). A `go mod vendor` commit that also rewrites the vendored sources
(`vendor/github.com/…`) is not counted unless those are left out with `--exclude vendor/`.
Line counts don't matter: a lockfile's lines are left out of
every line stat, but its name still counts here. `share` is `commits` over every non-merge
commit (also those without files; 3 decimals, at most `0.999` unless every one is a bump).
Files you `--exclude` are dropped first, so a commit that touched `src/` and
`package.json` is a bump with `--exclude src/`, and excluding a lockfile leaves out the
bumps that only touched it. `{"commits": 0, "share": 0}` when no commit is a bump (the
cards, recap and `wrapped.md` then show nothing); `null` without non-merge commits.

`stats.rewritten` is how many of your non-merge commits were rewritten: `{"commits",
"share"}`. A commit counts when its committer date is more than an hour after its author
date, which is what a rebase, an `--amend` or a cherry-pick leaves behind (git keeps the
author date and stamps a new committer date); exactly one hour later does not count. The
two dates are compared as instants, so the time zones they were written in don't matter.
`share` is `commits` over every non-merge commit (3 decimals, at most `0.999` unless
every one was rewritten). `{"commits": 0, "share": 0}` when none was (the cards, recap and
`wrapped.md` then show nothing); `null` without non-merge commits. A squash merge or a
patch applied by someone else with `git am` also gets a new committer date, so it counts
too when it landed more than an hour after it was written. So does GitHub's "Rebase and
merge", which commits every commit of the pull request again: in a repo that merges that
way, the share can be close to 100%.

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

`stats.contributors` ranks who made the commits: `total` is the number of distinct
contributors (one per email, compared lowercased, after `.mailmap`; a commit with no
email counts under its author name), and `top` lists the first five, sorted by commits,
then lines changed (`added` + `removed`), then name. `rank` is the position in that
order and `share` the percent of all commits with one decimal. Commits and lines are
counted the same way as in `totals` (merges count as commits, every file's lines count,
lockfiles included), so they add up to the totals. Each contributor's `name` is their most
frequent git author name (after `.mailmap`); emails are never included. `you` is `null`
unless you pass `--author`: then the history is read a second time without the author
filter (same window and `--max-commits`), `contributors` describes that whole team, and
`you` is your entry (`{name, rank, commits, added, removed, share}`, matched by exact
email like the filter). When `--author` matches no commits, the second read is skipped:
`contributors` is then `{"total": 0, "top": [], "you": null, ...}` and there's no team
card. `you` can also be `null` (and the team card left out) when that second read hits
`--max-commits` and none of your commits are among everyone's most recent ones (see
below). `authorFilter` is `true` when `--author` was given. `truncated` is `true` when the
history the contributors were counted in hit `--max-commits` (the second, unfiltered
read with `--author`; otherwise the same read as the top-level `truncated`), so the
ranking covers only the most recent commits. With `--author`, a capped team read is
read once more from the day of your oldest commit in the run (same filters, cap and
repos), so you and everyone else are counted over the same span: if everyone's commits
since then fit the cap, the ranking covers exactly those (and `you` has the commits
`totals` counts); if not, it covers everyone's most recent `--max-commits` commits, and
`you` counts only your commits among them (it can then be less than `totals`, or
`null`). Either way the recap says which in a note, whenever the team card is shown.
Everything else in `stats` still covers only your commits.
`busFactor` is the smallest number of contributors who together made at least half of the
lines changed in that same history (the whole team's with `--author`): `{"authors",
"share"}`, contributors taken by lines changed, most first, and `authors` the fewest whose
lines add up to at least half of all (exactly: twice theirs ≥ all), `share` their lines over
all lines changed (0.5 to 1, three decimals, at most 0.999 short of every line). Lines are
counted over the same files as hot files (lockfiles, build output, vendored code and anything
you `--exclude` left out; binary files and merges add nothing), per contributor as above (one
per email after `.mailmap`). It is `null` with fewer than two contributors or when no counted
line changed. The team card shows it as a row in spare room only; the recap and `wrapped.md`
show it with the team.

`stats.coAuthors` counts pairing from `Co-authored-by:` commit trailers (the key in any
case, as git matches trailers): `{"paired", "commits", "share", "total", "top": [{"name",
"commits"}]}`. `commits` is the number of non-merge commits (merges are skipped), `paired`
how many of them list at least one co-author other than their own author, and `share`
that as a percent of `commits` with one decimal. Co-authors go through `.mailmap` (and
`mailmap.file`) like authors, each repo's own with several repos, and are counted per
email, compared lowercased (by name when a trailer has no email); one listed twice on a
commit counts once. `total` is the number of distinct co-authors and `top` lists the
first five by paired commits, then name; each `name` is that co-author's most frequent
name (a name that is itself an address is cut to the part before the `@`). Bots and AI
assistants count like anyone else. Emails are never included. Only trailers in the
message's last paragraph count, as git reads them. Like every stat but `contributors`,
it covers the commits read with your filters: with `--author`, only your commits (a commit
where you are only a co-author does not count). With no co-authors it is
`{"paired": 0, "commits": N, "share": 0, "total": 0, "top": []}`.

`stats.releases` counts your releases: the commits read with your filters that tags point
at, lightweight or annotated (peeled to the commit they tag, through tags of tags too):
`{"count", "tags", "first": {"name", "date"}, "latest": {"name", "date"}}`. `count` is
the number of tagged commits, one release per commit however many tags it has (floating
`v1` / `v1.2` next to `v1.2.3`, aliases such as `latest` or `stable`, a tag on a tag);
a tag on a merge commit counts too. `tags` is the number of tags on those commits.
`first` and `latest` are the earliest and most recent of those commits by author date
(ties by name), `date` that commit's author-local day `YYYY-MM-DD`, and `name` its most
specific tag: a name with a version number beats one without, more version parts beat
fewer (`v1.2.3` over `v1.2`), a plain version beats one with a suffix (`v1.2.3` over
`v1.2.3-rc.1`), and then the highest wins, comparing numbers as numbers (`v1.10.0` over
`v1.9.0`). Since only tags on the analyzed commits count, `--since` / `--until` /
`--year`, `--author` and `--max-commits` apply to releases too: a tag on someone else's
commit, or outside the window, is left out. With several repos the counts are summed and
names get the repo label in front (`"api/v1.2.0"`, like file paths), with a `repo` key on
`first` and `latest`; a commit two repos share (a fork) is one release, with both repos'
tags (named after the first repo's tag when both tag it). Email-shaped text in a tag name
is replaced with "…". With no tags it is
`{"count": 0, "tags": 0, "first": null, "latest": null}`.

`stats.merges` is `{"commits", "share", "pullRequests"}`. `commits` is the number of merge
commits (more than one parent) among the commits read with your filters, and `share` their
share of all those commits (0 to 1, 3 decimals, never 1 while some commit is not a merge;
`0` without commits). `pullRequests` is how many distinct pull requests the subjects of
those commits name, merge commits or not: GitHub's `Merge pull request #12 from …` and a
`(#12)` at the very end of a subject, as GitHub's squash and rebase merges write it
(Bitbucket's `(pull request #12)` too). The same number twice (a merge commit and a squashed
subject, a cherry-pick or backport) is one pull request; with several repos numbers count
per repo (`#12` in two repos is two). A revert merged through a pull request
(`Revert "x (#70)" (#71)`) is a pull request of its own and does not take `#70` back out.
Only subjects are read, so a merge without a number in its subject (a plain
`Merge branch 'x'`, GitLab's merge requests) counts as a merge commit but not as a pull
request. These are numbers read from subjects, not checked against a forge: in a repo that
does not squash-merge, a subject ending in an issue reference like `fix crash (#12)` counts
too. With `--author`, only that author's commits count (the merge commits they made and
the pull requests in their subjects), so a `Merge pull request #N` commit counts for whoever
merged it, not for the pull request's author.

With several repos, `stats.repos` is the per-repo breakdown, most commits first:
`[{"name": "api", "commits": 120, "linesAdded": 9100, "linesRemoved": 2300,
"filesTouched": 64, "share": 61.2}, ...]` (counted like `totals`; `share` is the percent
of all commits with one decimal; a repo with no commits in the window is listed with
zeros). File paths everywhere in `stats` carry the repo prefix (`api/src/server.js`).
With a single repo there is no `repos` key at all, and the file is the same as before.

With `--year`, `stats.yearOverYear` (the last key of `stats`) compares that year with
the one before: `{"year": 2025, "previousYear": 2024, "commits": {"current": 412,
"previous": 370, "delta": 42}, "lines": {...}, "activeDays": {...},
"previousTruncated": false}`. `lines` is lines changed (added + removed, as in
`totals`), each `delta` is `current - previous`, and `previousTruncated` is `true` when
the previous year hit `--max-commits`. The key is absent without `--year`, and also when
either year has no commits (a repo's first year, or a quiet year): there is nothing to
compare.

With `--since` and no `--year`, `stats.previousPeriod` (the last key of `stats`) compares
the window with the equal-length one just before it: `{"since": "2026-09-09", "until":
"2026-10-08", "previousSince": "2026-08-10", "previousUntil": "2026-09-08", "days": 30,
"commits": {"current": 41, "previous": 29, "delta": 12}, "lines": {...}, "activeDays":
{...}, "previousTruncated": false}`. `until` is `--until`, or the run's day when there
is no `--until` or it is later; the metrics and `previousTruncated` work as in `yearOverYear`. The key
is absent when either window has no commits or the earlier one would start before 1970,
and a `--year` run never has it.

Without `--json` no stats.json is written, and one left over from an earlier `--json` run
is left as it is.

## Markdown summary

With `--md`, gitwrapped also writes `<out>/wrapped.md`, a short Markdown summary for a
README, a PR description or release notes:

- a title with the repo name and the date window (or first – last active day), and with
  `--author` the name part of that address ("Starring ada.");
- the headline numbers (commits, active days, lines added / removed, files touched, files
  born / buried when any were added, deleted or renamed (", 4 renamed" with renames), the lines changed in tests and their share
  when any test file changed, the lines changed in docs and their share when any doc file changed; with `--year` the change since the year before), the commit size mix, the first commit and,
  when commits have `Co-authored-by:` trailers, how many were paired and the top co-author,
  and, when tags point at your commits, how many releases you shipped and the latest one,
  and, with any merge commit or pull request number, how many pull requests were merged and
  how many merge commits there are;
- the power hour, busiest weekday and busiest day (the date with the most commits), the
  time zones (with two or more UTC offsets: how many and the most common one), the
  weekend commits (with at least one: how many landed on a Saturday or Sunday and their
  share), the late nights (with at least one: how many commits landed between 00:00 and
  04:59, their share and the latest-ever commit time), the longest streak, the current one (when a streak is running), the longest break
  and the cadence (with two or more active days: commits per active day and the median gap
  between active days), then the coding sessions (when a session lasted a minute or more:
  how many, the median length and the longest one with its commits and day);
- tables of the top five hot files (followed by the two files changed together most often,
  when they share 3+ commits, and the one-touch files: how many changed files only one
  non-merge commit touched and their share, when there are any, the biggest grower: the
  file with the largest net line growth, when a file grew, and the biggest shrinker: the file
  with the largest net line loss, when a file shrank), top folders (with two or more) and languages, and, in a repo with more than one
  contributor, the top five contributors by name (with `--author`, you marked as "(you)") and
  the bus factor (the fewest people who made half of the lines changed);
- with several repos, a per-repo table; the biggest commit; the commit type mix (when at
  least 20% of the commits follow Conventional Commits); your emoji (the share of commits
  with one and the top three, when at least 5% of the commits have one); your reverts
  (how many commits revert another and their share, when there are any); your subject
  length (the median subject length and how many non-merge commits have a subject over 72
  characters, with their share); your message bodies (how many non-merge commits have a
  body beyond the subject and their share, when there are any); your top subject words
  (up to three words with how many non-merge commits use each, when a word is in at least
  2); your cleanups
  (how many non-merge commits removed more lines than they added, their share and the
  biggest net deletion, when there are any); your issue references (how many non-merge
  commits mention an issue, their share and the most referenced issue, when there are
  any); your dependency bumps (how many non-merge commits only touched lockfiles and
  dependency manifests and their share, when there are any); your rewritten commits (how
  many non-merge commits were committed more than an hour after they were written, and
  their share, when there are any); your commit personality;
- every story card as an image, linked by its relative path (`cards/01-intro.svg`, ...).
  Those images only show where the `cards/` folder sits next to `wrapped.md` (the output
  folder itself, or a README / docs page you commit together with `cards/`). Pasted into
  a PR description or an issue, the text works but the card images won't load; upload
  the PNGs there instead.

It is written in the `--lang` language, with the same numbers as the cards and the recap
(the languages table has the same rows as the languages card). It never contains an
email address: contributors appear by name only, `--author` only by the part before the
`@`, and anything shaped like an address (`name@host`) in a commit subject, file path or
repo name is replaced with "…". File paths, names and commit subjects are escaped so they
show as plain text: a `|` in a path can't break a table, URLs don't become links, and an
invisible word joiner after every `@` and `#` keeps GitHub from turning `@someone` into a
mention or `#12` into an issue link; `$` is escaped too, so `$lib/$types.ts` never renders
as math. Like `stats.json`, it is only
written with `--md`, and one left over from an earlier `--md` run is left as it is.

```bash
npx @furkycl/gitwrapped --year 2025 --md --no-png
```

## Privacy

- **100% local.** gitwrapped reads `git log` and writes files. It makes no network
  requests and has no telemetry, accounts or API keys.
- **`wrapped.html` stays offline too.** It inlines all of its CSS, JS and SVG and ships
  a strict Content-Security-Policy (`default-src 'none'`, with hashed inline style and
  script), so the browser won't load anything from the network either.
- **What the output contains.** Cards, `wrapped.html` and (with `--json`) `stats.json`
  show commit subjects, repo-relative file paths and tag names (the latest release, and in
  `stats.json` the first one too). Anything shaped like an email address
  (`name@host`) in commit subjects, file paths, tag names and the repo labels of a multi-repo run
  is replaced with "…" in every output (cards, share image, `wrapped.html`, `stats.json`,
  the recap and `wrapped.md`). Text after an `@` that starts
  with a digit is not an address and is kept: versions like `lodash@4.17.21` and `@2x`
  asset names like `logo@2x.png`. `stats.json` also lists commit hashes (the longest and
  shortest message, the biggest commit; the first commit's short hash) and, when you pass
  `--author`, that email in `filters.author`. In a repo with more than one contributor,
  the team card, the recap and `stats.json` also show the git author names (after
  `.mailmap`) of the top five contributors (and yours, with `--author`), never their
  emails (a name that is itself an address is cut to the part before the `@`). The same
  goes for co-authors from `Co-authored-by:` trailers: the cards, the recap, `wrapped.md`
  and `stats.json` show the top co-author's name (and `stats.json` the top five), never
  an email. The cards, share image and `wrapped.html` show only the part of the
  `--author` email before the first `@` ("ada" for `ada@example.com`), never an address
  or domain: for `Name <email>` just the name, for a regex alternation (`a@x.io|b@y.io`)
  the first alternative's local part, and for `@example.com` no author at all.
  Check the output before you share it from a private repo. No absolute paths from your
  machine are written.

## How it works

1. **Read.** One `git log --numstat` call (no shell, arguments passed directly) reads the
   hash, author, email (after `.mailmap`), date, parents, `Co-authored-by:` trailers,
   subject and per-file line counts of each commit. With `--until` / `--year` a cheap
   hashes-and-dates pass picks the commits in the window first. When any commit has a
   co-author, one `git check-mailmap --stdin` call per repo maps them through `.mailmap`
   (not for the extra reads of `--author` and `--year`, whose co-authors are not used).
   One `git show-ref --tags -d` call per repo lists the tags (peeled to their commits) for
   the releases, again for the main read only; when it fails, there are just no releases.
2. **Stats.** Totals, time habits, streaks, commits per day, hot files, languages, contributors, message stats and a rule-based
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
- **`--year` reads the year before too:** with the same `--author`, repos, `.mailmap`
  and `--max-commits`, for the year-over-year comparison (skipped when the year itself
  has no commits). If the cap cuts that year short, the recap says so and its numbers
  cover only its most recent commits (`previousTruncated` in `stats.json`). If that
  extra read fails, gitwrapped prints a one-line warning, leaves the comparison out and
  still writes everything else.
- **`--since` reads the window before it too** (without `--year`): the same number of
  days just before `--since`, with the same filters and cap, for the period-over-period
  comparison; skipped, capped and failed reads are handled as for `--year`.
- **`--author` reads the history twice:** once for your commits and once for everyone's
  (same window and `--max-commits`), so the team card can rank you. If the cap cuts the
  second read short, everyone is read a third time from the day of your oldest analyzed
  commit: you're ranked against everyone's commits since then when they fit the cap, or
  else within the most recent commits by everyone (your own counted there too, so the
  card can show fewer of yours than the totals, or be left out). The recap says which.
  When the author has no commits in the window, the second read is skipped.
- **Two contributor counts:** the totals card's "Contributors" counts distinct emails
  only, while the team card also counts commits with no email (one contributor per
  author name), so the two numbers can differ in a history with email-less commits.
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
  tomorrow, so one bad date doesn't hide your real last 12 months. Nor does it stretch
  the date range on the cards (intro, footers, share image), and days after tomorrow
  never make the longest streak, longest break, cadence or busiest day shown on the cards, in the recap
  and in `wrapped.md`, or the Steady Shipper span and streak. Those commits still count in the
  totals, and `stats.json` keeps the raw values (`totals.lastDay`, `streaks.longest`,
  `streaks.longestBreak`, `cadence`, `busiestDay`). The longest coding session
  (`sessions.longest`, in `stats.json` too) skips sessions that start after tomorrow
  in the same way; as for the longest streak and break, when every session (or day) is
  future-dated there is nothing else to pick, so the raw value is used. Future-dated
  sessions still count in `sessions.count` and `sessions.medianMinutes`.
- **Output folder safety:** gitwrapped only deletes files (old card files, and with
  `--no-png` the PNGs of an earlier run) in a folder that already holds a `wrapped.html`
  from an earlier run, and only regular files with its own names. It won't write or
  delete through a symlink: if an output this run writes (`wrapped.html`, `share.svg`, a
  card SVG or the `cards/` folder; `share.png`, PNG cards and `png/` only when making PNGs;
  `stats.json` only with `--json`, `wrapped.md` only with `--md`) is a symlink, the run stops with
  `refusing to write through a symlink: <path>` before writing anything. This check is
  best effort (made once, before writing). `--out` itself may be a symlink.
- **Authors** are counted by their `.mailmap` identity, so one person with two emails
  mapped together counts once, and `--author` matches the mapped email. If `--author`
  matches nothing and isn't an email address, the recap reminds you it expects one.
- **Empty repo** (no commits yet) or a filter that matches nothing (`--since`,
  `--until`, `--year`, `--author`): you still get a full card set with friendly empty
  copy. The recap says "No commits found", names the filters, and the exit code is 0.
- **Only the current branch is read** (`git log` from HEAD). If HEAD has no commits
  yet (a new or orphan branch) but other branches or tags exist, the recap says so and
  suggests checking out a branch with history.
- **No git:** if `git` isn't on your PATH, gitwrapped says so. On Windows, PATH has to
  point at `git.exe`; a `git.cmd` or `git.bat` wrapper can't be started directly.
- **Not a repo:** a missing path, a file, or a folder that isn't a git repository each
  exit with code 1 and a one-line error. If git refuses a repo owned by another user
  ("dubious ownership"), gitwrapped prints the `git config --global --add safe.directory`
  command that allows it.
- **Renames** are counted as a delete plus an add in line counts, files touched, hot
  files, one-touch files, the biggest grower and shrinker, languages, folders, the test and docs shares and the co-change pair (only files born /
  buried / renamed detect them). Merge commits (more than one parent)
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
