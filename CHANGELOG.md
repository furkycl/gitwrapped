# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Top subject words: the three most common words in non-merge commit subjects, each
  counted once per commit, with how many commits use it (`stats.messages.topWords
  [{word, count}]`, `[]` without any). Leading `fixup!` / `squash!` / `amend!` markers,
  emoji, a `Revert "…"` wrapper and a Conventional Commits-shaped prefix (`fix(api)!:`,
  any `word:`), gitmoji shortcodes, URLs, issue references, hex hashes and numbers are
  left out; words are runs of Unicode letters, lowercased, at least 3 characters, not on
  a small English / Turkish stopword list; ties go alphabetically. The message hall of fame gets a
  "Top words: parser ×5 · cache ×3" row (fewer words when they would be cut, a single
  one as "Top words  parser ×5"; "En sık kelimeler" in Turkish) as its
  lowest-priority row, after the message bodies, only in spare room (it never folds,
  shrinks or displaces anything); the recap gets a "Top words" line ("Sık kelimeler")
  and `wrapped.md` a "Top subject words" section ("Konu satırlarında en sık geçen kelimeler").
  Only words used by at least 2 commits are shown; `stats.json` keeps the top three.
- Rewritten commits: non-merge commits whose committer date is more than an hour after
  their author date (rebased, amended or cherry-picked; the dates compared as instants),
  with their share of non-merge commits (`stats.rewritten {commits, share}`, or null
  without non-merge commits). The log read now also takes each commit's committer date.
  A "Rewritten commits" row ("Yeniden yazılan commit'ler") goes last on the totals card,
  else last on the message hall of fame, only in spare room (it never displaces a row);
  the recap gets a "Rewritten" line ("Yeniden yazılmış") and `wrapped.md` a "Rewritten
  commits" section. Without a rewritten commit every card is unchanged. Squash merges,
  `git am` and GitHub's "Rebase and merge" also commit again, so a repo that rebase-merges
  its pull requests can show a share close to 100%.
- Biggest grower: the file with the largest net line growth (lines added − removed) over
  the non-merge commits in the window, over the same files as the hot files (same ignore
  rules and `--exclude`; binary files add 0 lines; a rename removes the old path's lines and
  adds the new one's, as for hot files; repo-labelled paths with several repos; a tie goes
  to the path that sorts first) (`stats.biggestGrower {path, net, added, removed}`, or null
  when no file grew). The hot-files card gets a "Biggest grower  src/cli.js · +1,234" row
  (a longer path moves into the label, "Grower: src/…/stats/index.js  +1,234", shortened in
  the middle when needed, else just the file name; "En çok büyüyen" / "Büyüyen: …" in
  Turkish) after the one-touch row, only in spare room (it never displaces, folds or
  shrinks anything); the recap gets a "Top grower" line ("En çok büyüyen") and `wrapped.md`
  a "Biggest grower" item after the hot-files table ("En çok büyüyen dosya"). Without a
  growing file, or without room, every card is unchanged.

## [1.15.0] - 2026-10-09

### Added

- Coding sessions: per author (told apart as the contributors are, after `.mailmap`),
  commits no more than two hours apart form a session, from its first commit to its last
  (every dated commit counts, merges included). `stats.json` gets `stats.sessions`
  (`{count, medianMinutes, longest: {minutes, commits, day}}`, or null without a dated
  commit; the longest session's day is the author-local day it started, and sessions
  starting after tomorrow are not picked as the longest unless all are). When a session
  lasted a minute or more, the recap gets a "Sessions  42 sessions · median 35 min ·
  longest 3h 10m (14 commits, Mar 2, 2026)" line (a single session: "1 session · 26h 41m
  (50 commits, …)"; "Oturumlar", "42 oturum · medyan 35 dk · en uzun 3 sa 10 dk" in
  Turkish), `wrapped.md` a "Coding sessions" item ("Kodlama oturumları") in the streaks
  section, and the streak card a "42 coding sessions  longest 3h 10m" row ("42 oturum  en
  uzun 3 sa 10 dk" in Turkish: "42 kodlama oturumu" only fits next to a short value such as
  "en uzun 45 dk"), only in spare room (it never displaces, folds or shrinks
  anything; without room every card is unchanged). In practice the row lands on the streak
  card only when it has no longest-break panel; the power-hour fallback only happens when
  that card has no hour chart data (it is otherwise full).
- Message bodies: how many non-merge commits have a message body beyond the subject,
  with their share of non-merge commits (`stats.messages.bodies {commits, share}`, or null
  without non-merge commits or when git could not read the bodies). Blank lines are
  ignored, and so are paragraphs made only of trailers (`Signed-off-by:` and other `-by`
  tokens, `Change-Id:`, `Reviewed-on:`, …, and `Fixes:` / `Closes:` / `Cc:` / `Refs:` …
  only with reference values such as `#12`, `ABC-123`, a URL, a hash or `Name <email>`, so
  "Fixes: a race where …" or "Follow-up: …" still count as prose) and the "This reverts
  commit <hash>." paragraph `git revert` writes (the merge and `--reference` forms too); a revert with its
  own explanation still counts. The message hall of fame gets a "Message bodies  42 · 31%"
  row ("Bodies  31%" when that would be cut; "Mesaj gövdesi" / "Gövde" in Turkish) as its
  lowest-priority row, after the subject length, only in spare room (it never folds,
  shrinks or displaces anything); the recap gets a "Bodies" line ("Mesaj gövdeleri") and
  `wrapped.md` a "Message bodies" section ("Mesaj gövdeleri"). Bodies are read by one
  extra `git log` call without diffs, parsed as it streams so only a yes / no per commit
  is kept. Without a commit with a body, or without room, every card is unchanged.
- One-touch files: how many changed files exactly one non-merge commit in the window
  touched, with their share of all changed files, over the same files as the hot files
  (same ignore rules and `--exclude`; a rename is the old path plus the new one, as for hot
  files; repo-labelled paths with several repos) (`stats.oneTouch {files, share}`, or null
  without a changed file). The hot-files card gets a "One-touch files  42 files · 31%" row
  ("42 · 31%", else "One-touch  42 · 31%"; "Tek commit'lik  42 dosya · %31" /
  "Tek commit'lik  42 · %31" in Turkish) as its lowest-priority row, after every other row, only in spare room (it never
  displaces, folds or shrinks anything); the recap gets a "One-touch" line ("Tek commit'lik")
  and `wrapped.md` a "One-touch files" item after the hot-files table ("Tek commit'lik
  dosyalar"). Without a one-touch file, or without room, every card is unchanged.

## [1.14.0] - 2026-10-09

### Added

- Docs share: lines changed in documentation files (any file under a `docs/` or `doc/`
  folder, plus `*.md`, `*.mdx`, `*.rst` and `*.adoc` anywhere, extensions in any case)
  and their share of all lines changed, over the same files as the hot files (same ignore
  rules and `--exclude`) (`stats.docShare {lines, share}`, or null). A "Docs" row follows
  the "Tests" row on the hot-files or languages card when there is spare room (it never
  displaces a row); the recap gets a "Docs" line ("Dokümanlar") and `wrapped.md` a
  "Doc lines" item ("Doküman satırları"). A file such as `test/README.md` counts in both
  the test and the docs share. Without doc lines every card is unchanged.
- Dependency bumps: non-merge commits that only touched lockfiles (the ones hot files
  ignore) and dependency manifests (`package.json`, `go.mod`, `Cargo.toml`,
  `pyproject.toml`, `requirements*.txt`, `Gemfile`, `composer.json`, `Pipfile`,
  `pubspec.yaml`, `mix.exs`, `Podfile`, `flake.nix`, Go's `vendor/modules.txt` (vendored sources need `--exclude vendor/`); exact,
  case-sensitive names at any depth), with their share of non-merge commits
  (`stats.depBumps {commits, share}`, or null without non-merge commits). A "Dependency
  bumps" row ("Bağımlılık güncellemeleri") goes last on the totals card, else after the
  issue references on the message hall of fame (before the subject length row), only in
  spare room (it never displaces a row); the recap gets a "Dep bumps" line ("Bağımlılıklar") and
  `wrapped.md` a "Dependency bumps" section. `--exclude` drops files first. Without a
  dependency bump every card is unchanged.
- Subject length: the median length of non-merge commit subjects (trimmed, in Unicode
  code points; the mean of the two middle ones for an even count) and how many are longer
  than 72 characters, with their share of non-merge commits
  (`stats.messages.subjectLength {median, over72, share}`, or null without non-merge
  commits). The message hall of fame gets a "Subject length  48 · 12% over 72" row
  ("median 48" when no subject is over 72; "Konu uzunluğu" with "48 · 72 üstü %12" in
  Turkish) as its lowest-priority row, after every other row, only in spare room (it
  never folds, shrinks or displaces anything); the recap gets a "Subjects" line ("Konu
  satırları") and `wrapped.md` a "Subject length" section ("Konu satırı uzunluğu").
  Without room the card is unchanged.

## [1.13.0] - 2026-10-08

### Added

- Fixup commits: how many non-merge commits with a `fixup! `, `squash! ` or `amend! `
  subject (git's autosquash prefixes, matched exactly as git does) reached the history,
  and their share of non-merge commits (`stats.messages.fixups {commits, share}`). The
  messages card's "fix" row gets a "· 3 fixup!" segment when it is drawn whole (not when
  the fix / wip / oops counts are folded into one row); the recap gets a "Fixups" line
  ("Fixup'lar" in Turkish) and `wrapped.md` a "Fixup commits" section ("Fixup commit'leri").
  Without fixup commits every card, the recap and `wrapped.md` are unchanged (`stats.json`
  gains `messages.fixups {commits: 0, share: 0}`).
- Issue references: how many non-merge commits mention an issue in their subject (`#123`,
  `GH-123` or a Jira-style key such as `ABC-123`; not inside URLs, commit hashes or email
  addresses, and not `UTF-8`-style names), their share of non-merge commits and the most
  referenced issue (`stats.issueRefs {commits, share, top: {ref, commits}}`, or null). The
  message hall of fame gets an "Issue refs (top #128 ×9)  42 · 12%" row ("Issue atıfları"
  in Turkish) as its lowest-priority row, only in spare room (else with the fix / wip /
  oops counts folded); the recap and `wrapped.md` get an "Issue refs" / "Issue references"
  line. Without issue references every output is exactly as before.

### Changed

- Middle-elided paths on cards: a hot file's folder, the outro's hottest file and the
  co-change pair, when too long, are shortened as "first/…/file.js" (the first folder,
  in a multi-repo run the repo label, and the nearest folders that fit) before being cut
  from the start; the co-change row, which used to be left out when the two same-name
  paths did not fit, now tries these forms (keeping folders until the two names differ)
  before it is dropped. When the pair shares leading folders ("packages/core/…" and
  "packages/web/…"), it also tries names that start at the folder where the two differ
  ("core/…/index.js + web/…/index.js"), and a shorter value ("a.js + b.js  12×") as a last
  shape; a long pair can still be left out. Two listed hot files with the same name in
  folders that share leading folders get their folders shortened from where they differ
  ("core-x/…/forms/" and "web-y/…/forms/"), so they never read alike when that fits.
  Top folders are single folder names, so a long one keeps its cut in the middle.
  Tooltips, the recap, `wrapped.md` and `stats.json` keep the full paths.

### Fixed

- Two hot files with the same name could both show the same shortened folder
  ("packages/…/forms/") even when the folders from where they differ ("core/forms/",
  "web/forms/") fit; those are now tried first, and when nothing fits the part from
  where they differ is cut in the middle instead, keeping the start of the differing folder.
- Issue references: a mention right after another one and a `/` (`#12/#13`, `ABC-1/ABC-2`)
  now counts; `foo/#12` and `owner/repo#12` still don't.
- Card rows whose label or value has runs of spaces were never treated as fitting.

## [1.12.0] - 2026-10-08

### Added

- Co-change pair: the two files most often changed in the same non-merge commit (at least
  3 shared commits; the same files as hot files, so lockfiles, build output and anything
  you `--exclude` are left out; with several repos, repo-labelled paths; a tie goes to the
  pair that sorts first; commits with more than 30 counted files are skipped so big repos
  stay fast). The hot-files card gets a "Changed together  a.js + b.js · 12×" row (or
  "a.js + b.js  12× together" when that would be cut) in spare room only, after its other
  rows; cards without room are unchanged. The terminal recap gets a "Co-changed" line and
  `wrapped.md` a "Changed together" item after the hot-files table, both with the paths
  ("src/a.js + src/b.js (12 commits)"; the recap shortens long paths from the start, and
  leaves the line out when the two would then read alike), and `stats.json` gets `stats.coChange`
  (`{files, commits}`, or `null`). English and Turkish.
- Cleanup commits: the non-merge commits that removed more lines than they added (counted
  over the same files as hot files, so lockfiles, build output and anything you
  `--exclude` are left out; a commit with no counted line is not one), their share of the
  non-merge commits, and the one with the largest net deletion (a tie goes to the earliest
  commit). The totals card gets a "Cleanups  12 commits · 8%" row and a "Biggest cleanup
  −4,210 lines · Mar 3, 2026" row after it (shorter forms when those would be cut), in
  spare room only, after its other rows; when it can't take both, the message hall of fame
  gets them after its rows if it takes both (folding the fix / wip / oops counts into one
  row if that makes room), else the count row alone goes where it fits (totals first);
  never on both cards, and cards without room, or without cleanups, are unchanged. The terminal recap gets a "Cleanups" line and `wrapped.md` a "Cleanups"
  section after the reverts, both with the biggest one's subject, lines and day, and
  `stats.json` gets `stats.cleanups` (`{commits, share, biggest: {hash, subject, date,
  linesAdded, linesRemoved, net}}`, or `null`). English and Turkish.
- Renames: files renamed or moved in the window (git's rename detection, as already used
  to keep renames out of files born / buried; copies are not counted; the same files as
  hot files, judged by the new path, so a move into `vendor/` or an `--exclude`d folder
  does not count; merge commits skipped; with several repos, the sum). `stats.json` gets
  `stats.fileLifecycle.renamed` (`{added, deleted, renamed}`), the recap's "Files" line
  " · 4 renamed" and `wrapped.md`'s "Files born / buried" item ", 4 renamed" when there are
  any. The totals card's born / buried row becomes "Born / buried / renamed  12 / 3 / 4"
  when that is drawn whole, else stays as it was; without renames every card is unchanged.
  English and Turkish ("taşındı").

### Fixed

- Totals card: the "Born / buried" row was drawn cut when its value was too wide
  (millions of files added and deleted, "9,999,999 / 9,999,…"); it is now left off, as
  the merges row is (the counts are still in the recap, `wrapped.md` and `stats.json`).
- Totals card: the "Paired (top: …)" row drew a long top co-author name cut with "…";
  it now reads "Paired commits" when the name would be cut (the name is still in the
  recap, `wrapped.md` and `stats.json`).

## [1.11.0] - 2026-10-08

### Added

- Period over period: with `--since` (absolute or relative) and no `--year`, the window
  [`--since`, `--until` or today, whichever is earlier] of N days is compared with the N
  days just before it, read with the same filters and cap (a window starting after today
  is not compared). The totals card adds three signed rows ("Commits /
  Lines / Active days vs prev. 30 days", or "… vs prev." when a large number leaves no
  room), the outro opens with "vs previous 30 days: …", the terminal recap and
  `wrapped.md` get a "vs prev. 30 days" line, and `stats.json` gets `stats.previousPeriod`
  (`since`, `until`, `previousSince`, `previousUntil`, `days`, `commits`, `lines`,
  `activeDays` as `{current, previous, delta}`, `previousTruncated`). Nothing is added when
  either window has no commits or the earlier one would start before 1970; a capped
  earlier window gets a note and a failed read a one-line warning. English and Turkish.
  `--year` runs keep their year-over-year comparison and never get this one.
- Bus factor for team repos: the smallest number of contributors who together made at
  least half of the lines changed (after `.mailmap`, counted over the same files as hot
  files, so lockfiles, build output and `--exclude`d files are left out; with `--author`,
  over the whole team's history like the ranking). The team card gets a "Bus factor  2 people · 58%"
  row in spare room only (cards without room are unchanged), the terminal recap a
  "Bus factor" line after "Team", `wrapped.md` an item in the team section, and
  `stats.json` gets `stats.contributors.busFactor` (`{authors, share}`, or `null` with
  fewer than two contributors or no counted line changed). English and Turkish.

### Changed

- Broader test detection for the test share. Besides `test/`, `tests/`, `__tests__/` and
  `spec/` directories and `*.test.*`, `*.spec.*` and `*_test.*` names, a file now counts
  as a test when it is under a `specs/` directory, its name contains `_spec.` or `_tests.`
  (`foo_spec.rb`, `foo_spec.lua`, `foo_tests.rs`), it is a `test_<name>.<ext>` module
  (`test_utils.py`), it is `conftest.py`, or it is a `Test` / `Tests` class file in Java,
  Kotlin, Scala, Groovy, C#, F#, VB, Swift, PHP or Objective-C, or a `Spec` one in Kotlin,
  Scala, Groovy, Swift, PHP or Objective-C (`FooTest.java`,
  `UserTests.cs`, `LoginSpec.groovy`, `AppTests.swift`, `UserTest.php`). Matching stays
  case-sensitive (`Latest.java`, `FooTEST.java`, `FooTest.js`, `PodSpec.java`, `tests.js` and `testdata/`
  are still not tests). The test share on the cards, the recap, `wrapped.md` and
  `stats.tests` in `stats.json` may now be higher, notably for Python, Ruby, Rust, JVM, .NET,
  Swift and PHP repos.

### Fixed

- Merge share and contributor shares were rounded twice: the merge share (totals card,
  outro, terminal recap, `wrapped.md`) was a whole percent of its 3-decimal `share`, so 45
  merges of 10,000 commits read "1%" instead of "<1%" and 49 of 2,000 read "3%" instead of
  "2%"; a contributor's share on the team card, the recap and `wrapped.md` was a whole
  percent of its one-decimal `share`, so 49 of 2,000 commits (2.45%) read "3%" instead of
  "2%"; the top time zone's share on the recap and `wrapped.md` ("mostly UTC+03:00 (53% of
  commits)" for 1,049 of 2,000, 52.45%) and the paired share ("3% of non-merge commits"
  for 49 of 2,000) were rounded the same way. All are now rounded once from the exact
  ratio, as the test share and the bus factor already are. `stats.json` is unchanged.

## [1.10.0] - 2026-10-08

### Added

- Test share: the lines changed in test files and their share of all lines changed. A test
  file is one under a `test/`, `tests/`, `__tests__/` or `spec/` directory at any depth
  (exact, case-sensitive names), or one named like `*.test.*`, `*.spec.*` or `*_test.*`;
  the same files as hot files count (lockfiles, build output, … left out, `--exclude`
  applies), checked on the path inside each repo in a multi-repo run. `stats.json` gets
  `stats.tests` (`{lines, share}`, share with three decimals and never 1 short of every
  line; `null` when no line changed), the recap a "Tests  1,234 lines (23% of lines
  changed)" line, `wrapped.md` a "Test lines" item in its numbers, and the hot-files card a
  "Tests  1,234 lines · 23%" row ("Testler" in Turkish) in spare room only: every chart
  keeps its place and nothing shrinks, else the languages card gets the row on the same
  terms, else it is left off the cards. Cards without room for it are unchanged. The
  percent shown is rounded once, from the exact line ratio (not from `share`).
- Office hours: how many commits landed on a weekday (Monday to Friday) between 09:00 and
  17:59 in each author's own local time, counted over the same dated commits as the power
  hour (merges and future-dated ones included). `stats.json` gets `stats.officeHours`
  (`{commits, share}`, share of the dated commits with three decimals, never 1 short of
  every commit), the recap an "Office hours 1,234 commits (23% of commits)" line,
  `wrapped.md` an "Office-hours commits" item, and the power-hour card an "Office hours
  95 commits · 23%" row ("1,234 · 23%" when the full value would be cut; "Mesai saatleri"
  in Turkish) when it fits, with the big number at most one step smaller in all (as the
  late-nights row), else the activity card gets it after the weekend row in spare room,
  else it is left off the cards (Turkish cards usually have no room for it). Only shown
  with at least one office-hours commit; cards without room for it are unchanged.

### Changed

- Power-hour card: a night power hour (10 PM to 4 AM) with late-night commits now shows its
  "Late nights" row. The hour's own quip made the subtitle four lines long and left no
  room for the row, so it gives way to a short "Night owl." ("Tam bir gece kuşu." in
  Turkish), or to no quip when even that is too long, whichever lets the row fit (with the
  same one-shrink-step allowance as before) while the busiest weekday (when it showed) and
  the time zones still show; the "Latest night" row still follows only in spare room.
  Day and evening power hours, night ones without late-night commits, and cards the row
  already fitted on are unchanged.

### Fixed

- Power-hour card: the "Late nights" row was drawn cut when even its short value was too
  wide (a billion+ late-night commits, "1,000,000,000 · 14%"); it is now left off, as the
  office-hours and tests rows are, and a night power hour then keeps its own quip.
- Activity card: the "Weekends" row was drawn cut when its full value was too wide (e.g.
  1,200 weekend commits with a two-digit share, "1,200 commits ·…"); it now falls back to
  "1,200 · 19%" as the other rows do, and is left off when even that would be cut.

## [1.9.0] - 2026-10-08

### Added

- Relative windows: `--since` / `--until` also take `30d`, `12w`, `6m` or `1y` (N days,
  weeks, calendar months or calendar years before today's local date; N from 0 to 9999,
  any case). Months and years clamp to the target month's last day (2026-03-31 minus
  `1m` is 2026-02-28). The value is resolved to a `YYYY-MM-DD` day before anything else,
  so the cards, recap, notes and `stats.json` `filters` show the resolved dates, the
  "--since is after --until" check compares them, and `--year` still can't be combined
  with either. A result before 1970 is an error, and the "expected format" error now
  mentions the relative form. `--help` and the README describe it.

- Merges: the merge commits (more than one parent) in the window, their share of all
  commits, and how many pull requests were merged, read from subjects: GitHub's
  `Merge pull request #N from …` and a trailing `(#N)` squash / rebase suffix (Bitbucket's
  `(pull request #N)` too), deduped by number (per repo with several repos). `stats.json`
  gets `stats.merges` (`{commits, share, pullRequests}`), the recap a
  "Merges  12 pull requests merged · 8 merge commits (6% of commits)" line, `wrapped.md` a
  "Merges" item, and the totals card a "Merged PRs / merges  12 / 8" row ("Merged PRs" or
  "Merge commits  8 · 6%" when there is only one of the two) when there's spare room and
  the row is drawn whole (not with 10,000+ pull requests and merges), after the files born
  / buried row; nothing else shrinks for it and the card is unchanged otherwise. When the
  totals card has no room for it (common in team repos and with `--year`),
  the outro gets a "Merges" panel instead ("You merged 12 pull requests", "8 merge commits ·
  6% of commits", or "8 merge commits · 6%" when that line would be cut, as in Turkish),
  never both, after the releases panel and on the same terms (the subtitle
  gives way first; when both panels don't fit, releases win; byte-identical otherwise).
  A PR number may have at most nine digits after leading zeros; a `Merge pull request`
  subject with an out-of-range number falls back to its trailing `(#N)`.
  English and Turkish ("Merge'ler", "Birleşen PR / merge", "12 pull request birleştirdin").

- Late nights: how many commits landed between 00:00 and 04:59 author-local (every dated
  commit counts, as for the power hour), their share, and the latest-ever commit time of
  day, where the day ends at 05:00 (04:59 is the latest, 00:30 beats 23:59; ties go to the
  earliest commit; commits dated after tomorrow are left out of it). `stats.json` gets
  `stats.lateNights` (`{commits, share, latest: {date, time} | null}`, author-local day and `HH:MM`, no hash or email). With at least one
  late-night commit the recap gets a "Late nights  12 commits (4% of commits) · latest
  4:12 AM on Mar 3, 2024" line, `wrapped.md` a "Late-night commits" item, and the
  power-hour card a "Late nights  12 commits · 4%" row ("1,234 · 12%" when the full value
  would be cut, e.g. 1,000+ commits with a two-digit share, so the percent always shows)
  when it fits with the big number at most one step smaller (one step in all, shared with
  the time-zones row), then a "Latest night" row in spare room only (rare), with the date
  without its year when the full one would be cut ("4:12 AM · Mar 3" in English, where the
  full date never fits; "04:12 · 28 Oca" in Turkish only when needed); the recap and
  `wrapped.md` always show the full date. Byte-identical otherwise (a night power hour's
  longer subtitle usually leaves no room). `stats.lateNights` agrees with
  `stats.habits.byHour` (the same author-local hours), which the Night Owl personality
  also scores (its window is 22:00–03:59), so the two never disagree.
  English and Turkish ("Gece mesaisi", "en geç 3 Mar 2024 04:12").

## [1.8.0] - 2026-10-07

### Added

- Cadence: how many commits you make on a day you commit and how far apart your active
  days usually are. `stats.json` gets `stats.cadence` (`{perActiveDay, medianGapDays}`:
  commits per active day with 1 decimal, over the same author-local days as
  `totals.activeDays`, and the median calendar-day gap between consecutive active days,
  which can end in .5; `null` with fewer than two active days). With two or more active
  days the recap gets a "Cadence  2.4 commits per active day · every 3 days" line
  ("every day" for a gap of 1), `wrapped.md` a "Cadence" item, and the streak card a
  "2.4 per active day  every 3 days" row when there is room (same charts and break panel,
  the big number, text and bars at their usual size, though the bar chart may give up some
  spare spacing; the row shown whole; otherwise the card is unchanged). Days after
  tomorrow are left out of the shown cadence, as for the longest streak and break.
  English and Turkish ("Ritim", "Aktif gün başına 2,4 commit · 3 günde bir").

- Weekend share: how many commits landed on an author-local Saturday or Sunday, from the
  power hour's weekday counts (every commit, merges included), so it always agrees with
  the Weekend Warrior personality. `stats.json` gets `stats.weekend` (`{commits, share}`,
  share 0..1 with 3 decimals, over the commits that carry a date), the recap a
  "Weekends  12 commits (8% of commits)" line and `wrapped.md` a "Weekend commits" item (both with at least one weekend commit), and the
  activity card a "Weekends  12 commits · 8%" row when its grid covers every commit and
  there is room (the calendar's cells may get smaller, but never below their normal
  minimum size; otherwise the card is unchanged). English and Turkish ("Hafta sonu",
  "%8").

- Top folders: the most-changed top-level directories by lines changed (added + removed),
  over the same files as hot files (lockfiles, build output, … left out, `--exclude`
  applies). Files at a repo's root are grouped as "(root)"; with several repos each folder
  keeps its repo label (`api/src`, `api/(root)`). `stats.json` gets `stats.folders` (top 5,
  `[{path, lines, added, deleted, commits}]`, most lines first, ties by path), the recap a
  "Top folders  src/ (1,234 lines) · test/ (567 lines) · (root) (89 lines)" line,
  `wrapped.md` a "Top folders" table, and the hot-files card a small "Top folders" bar
  list (three, else two) under its charts, in spare room only: the hot-files list and the
  per-repo chart keep every bar at full size (at most the big file name gets one step
  smaller), and the card is unchanged when it doesn't fit. Shown only with two or more
  folders (`(root)` / `(kök)` in Turkish).

### Changed

- Weekend Warrior's reason never says "100%" unless every commit landed on a weekend
  (99% at most otherwise), matching the new weekend line.

## [1.7.0] - 2026-10-07

### Added

- Files born and buried: how many files were added and deleted in the window, read with
  one extra `git log --name-status --diff-filter=AD -M` call over the commits read (rename
  detection on, so a renamed or moved file is neither; merge commits get no diff, as for
  the line counts). Ignored paths (lockfiles, build output, …) and `--exclude`d files are
  left out as for hot files; several repos are summed. `stats.json` gets
  `stats.fileLifecycle` (`{added, deleted}`), the recap a "Files  12 born · 3 buried"
  line, `wrapped.md` a "Files born / buried" item, and the totals card a
  "Born / buried 12 / 3" row when there's spare room (after the pairing row; nothing else
  shrinks for it). English and Turkish.

- Time zones: the distinct UTC offsets of the commits' author dates (every commit counts,
  merges included, as for the power hour; `Z` and `-00:00` are `+00:00`) and the most
  common one. `stats.json` gets `stats.timezones` (`{count, top: {offset, commits, share}
  | null, offsets: [{offset, commits}]}`, most commits first, ties west to east). With two
  or more offsets the recap gets a "Time zones  3 time zones · mostly UTC+03:00 (62% of
  commits)" line, `wrapped.md` a "Time zones" item, and the power-hour card always
  shows them: "Committed from 3 time zones, mostly UTC+03:00." at the end of its subtitle
  or a "3 time zones · mostly UTC+03:00" row (both charts kept, the big number at most one
  step smaller), else the sentence in place of the hour's quip, then of the quip and the
  busiest-weekday sentence; "mostly" is left out when two offsets tie. With one offset
  everything is exactly as before. English and Turkish.

- Busiest day: the single calendar day (author-local, as for streaks) with the most
  commits, ties → the earliest day. `stats.json` gets `stats.busiestDay` (`{day:
  'YYYY-MM-DD', commits} | null`), the recap a "Busiest day  Mar 12, 2026 (9 commits)"
  line and `wrapped.md` a "Busiest day" item; both leave out future-dated days. The
  activity card is unchanged (its busiest day is that of its 53-week grid). English and
  Turkish.

### Changed

- `wrapped.md`: in Turkish, the busiest-weekday item is now "En yoğun hafta günü:
  <weekday>" (formerly "En yoğun gün: <weekday>"), and "En yoğun gün" now holds the
  busiest calendar date. In English the weekday item stays "Busiest weekday: <weekday>"
  and the new "Busiest day" item holds the calendar date.

## [1.6.0] - 2026-10-07

### Added

- Commit emoji: the share of commits with an emoji in the subject, Unicode (✨, a ZWJ
  sequence, skin tone, flag or keycap counts as one) or a [gitmoji](https://gitmoji.dev)
  shortcode (`:sparkles:` counts as ✨; unknown `:words:`, times like `10:30:00` and
  paths like `std::thread::spawn` don't), and the top three emoji. When at least 5% of the
  commits have one, the messages card gets an "Emoji ✨ 🐛 📝 · 12%" row (after the other
  rows when there's room, else with the fix / wip / oops rows folded into one, else in
  place of that folded row; the type mix and the biggest commit keep their room, and
  without emoji the card is exactly as before), the recap an "Emoji" line and
  `wrapped.md` an "Emoji" section, and `stats.json` gets `stats.emoji` (`{total, commits,
  share, distinct, top: [{emoji, count}], shown}`; an emoji counts once per commit, ties
  go to code point order). Merge commits are skipped. English and Turkish.

- Reverts: commits that revert another, by a `Revert "…"` subject (case-sensitive, as git
  writes it; a revert of a revert is one revert), a Conventional Commits `revert: …` /
  `revert(scope): …` subject (also after a gitmoji, `⏪ revert: …`), or a line starting
  `This reverts commit <hash>` in the message (read with one extra
  `git log --no-walk --stdin --grep` call over the commits read, so the main log format
  stays subject-only; skipped for the `--author` team read and the `--year` previous-year
  read). The messages card gets a "Reverts 3 · 2%" row (count and share of non-merge
  commits; after the emoji row, folding the fix / wip / oops rows if needed, never in
  their place, and left out when it doesn't fit), the Fixaholic reason names them ("…are
  fixes; 3 commits revert another."), the recap a "Reverts" line and `wrapped.md` a
  "Reverts" section, and `stats.json` gets `stats.reverts` (`{total, count, share,
  reverted}`; an abbreviated and a full hash of one reverted commit, or two abbreviations
  where one is a prefix of the other, count once). Merge commits are skipped. Without
  reverts every card, the recap and `wrapped.md` are exactly as before. English and Turkish.

- Releases: the commits in the window that tags point at (lightweight or annotated,
  peeled to their commit), one release per tagged commit however many tags it has
  (floating `v1` / `v1.2`, `latest`, a tag on a tag). The outro card gets a "Releases"
  panel ("You shipped 3 releases", "Latest: v1.5.0 · Oct 6, 2026"; a long tag name is cut
  in the middle so its version and the day show); to make room the subtitle gives way
  (the "Made with gitwrapped" line, then `--year`'s comparison), nothing else shrinks, and
  without tags the card is exactly as before. The recap gets a "Releases" line,
  `wrapped.md` a "Releases" item, and `stats.json` gets `stats.releases` (`{count, tags,
  first, latest}`, each of `first` / `latest` `{name, date}` or `null`; the name is the
  commit's most specific tag, `v1.2.3` over `v1.2` and `v1.2.3-rc.1`, `v1.10.0` over
  `v1.9.0`). Only tags on the analyzed commits count, so the window, `--author` and
  `--max-commits` apply; with several repos the counts are summed, tag names get their
  repo label in front ("api/v1.2.0"), and a commit two repos share keeps both repos'
  tags. One `git show-ref --tags -d` call per repo; a failing call means no releases,
  never a failed run. Email-shaped text in tag names is replaced with "…". English and
  Turkish.

### Fixed

- Commit types: a gitmoji in front of the conventional prefix (`✨ feat: x`,
  `:sparkles: feat: x`, `1️⃣ feat: x`) no longer makes the commit unconventional.

## [1.5.0] - 2026-10-07

### Added

- First commit: the intro card gets an "It all began with" panel with the first commit
  in the window (its quoted subject, day and short hash; with several repos, its repo),
  the recap a "First commit" line and `wrapped.md` a "First commit" item, and
  `stats.json` gets `stats.firstCommit` (`{date, subject, hash}` plus `repo` with several
  repos, or `null`). It is the earliest non-merge commit by author date that passes the
  filters; email-shaped text in its subject is replaced with "…". A long subject is cut
  with "…", and when the intro has no room the panel is left out and the card is exactly
  as before. English and Turkish.

- Co-authors: commits with `Co-authored-by:` trailers count as paired. The team card
  gets a "Pair programming" panel ("12 commits paired", "Top co-author: Grace Hopper").
  Without a team card, when the panel doesn't fit there, or with `--author` (where the
  pairing counts only your commits), the totals card gets a "Paired (top: …)" row with
  the count instead. Both only use spare room, so a card without them is exactly as
  before. The recap gets a "Paired" line (with the share of non-merge commits),
  `wrapped.md` a "Paired" item, and `stats.json` gets `stats.coAuthors` (`{paired,
  commits, share, total, top}`, the top five co-authors as `{name, commits}`).
  Co-authors go through `.mailmap` (one `git check-mailmap` call per repo, for the main
  history read only) and are shown by name only, never an email; a co-author who is the
  commit's own author, and merge commits, don't count. English and Turkish.

- Commit type mix: when at least 20% of the commits follow Conventional Commits
  (`type(scope)!: description`, case-insensitive), the messages card shows the share of
  feat / fix / docs / refactor / test / chore / other commits as a thin stacked bar (the
  top three types, any others folded into "the rest", with the share of conventional
  commits in its caption; a lone type is set against the commits without a prefix, and
  a single type on every commit draws no bar), the recap gets a "Types" line and
  `wrapped.md` a "Commit types" section, and `stats.json` gets `stats.commitTypes` (`{total, conventional, share,
  counts, shares, top, shown}`; shares are whole percents of the conventional commits
  that add up to 100). Only known types count (`perf`, `ci`, `build`, `style`, `revert`,
  `release` and `deps` go to "other"; `feature`, `bugfix` / `hotfix`, `doc` and `tests`
  are aliases), so a subject like "Update: readme" is not conventional. Merge commits
  are skipped. The bar only uses spare room: if it doesn't fit, the fix / wip / oops rows
  are folded into one row to make room, and if it still doesn't fit (or the mix isn't
  shown) the card is exactly as before. English and Turkish.

### Fixed

- No email address shows up in any output anymore: email-shaped text (`name@host`) in
  the longest / shortest message and the biggest commit's subject, in hot-file paths
  (`keys/ada@example.com.pub`) and in the repo labels of a multi-repo run is now
  replaced with "…" in `stats.json`, on the cards, the share image, `wrapped.html`
  (including its screen-reader descriptions and tooltips) and in the recap, as it
  already was in `wrapped.md`. The favorite word and the message lengths are counted
  from the scrubbed subjects.
- Versions and `@2x` asset names are no longer mistaken for email addresses: text after
  an `@` that starts with a digit is kept (`lodash@4.17.21`, `@babel/core@7.2`,
  `logo@2x.png`), in `wrapped.md` too.

## [1.4.0] - 2026-10-06

### Added

- Commit size mix: the totals card now shows the share of tiny (under 10 lines), small
  (10–99), medium (100–500) and large (over 500 lines changed) non-merge commits as one
  stacked bar, the recap gets a "Sizes" line, and `stats.json` gets `stats.commitSizes`
  (`{total, tiny, small, medium, large, shares}`; shares are whole percents that add up
  to 100). Lines are counted like the biggest commit: lockfiles, build output, vendored
  code and `--exclude`d files are left out, so a commit that only touched those is tiny.
  On the card, in the recap and in `wrapped.md` a size with commits never reads "0%"
  ("<1%" instead) and none reads 100% next to others (as on the languages card);
  `stats.json` keeps the raw shares. Every segment stays clearly brighter than the empty
  track, so an all-large mix doesn't look empty.
  The bar only uses spare room: without commits to count, or when the totals card is
  short of space (e.g. `--year`'s extra rows), it is left out and the card is exactly as
  before (nothing else shrinks for it). English and Turkish.
  A card's screen-reader description now covers only the charts actually drawn, so a
  chart left out for lack of room (this bar, or a per-repo chart) is left out of it too.
- Longest break: the streak card now shows the longest gap between two consecutive
  active days (idle days, and the active days before and after it) in a panel under
  the bars, the recap gets a "Break" line, and `stats.json` gets
  `stats.streaks.longestBreak` (`{days, from, to}`; `days` counts the idle days in
  between, ties go to the earliest gap, `{days: 0, from: null, to: null}` without one).
  Like the longest streak, the card and recap leave out future-dated days. Without a
  break the card is unchanged. English and Turkish.
- `--md`: also writes `<out>/wrapped.md`, a Markdown summary for READMEs and PR
  descriptions: headline numbers (and the year-over-year change with `--year`) with the
  commit size mix, power hour and busiest weekday, streaks and the longest break, the top
  five hot files and languages, the team by name (in a repo with several contributors),
  per-repo numbers, the biggest commit and the commit personality, then every card SVG as
  a relative image link. Localized with `--lang` (English and Turkish), the same numbers
  as the cards and the recap (the languages table has the languages card's rows), and
  never an email address (names only; `--author` by its local part; anything shaped like
  an address in subjects, paths or repo names is cut). Paths, names and subjects are
  escaped so they render as plain text, without links, @mentions, #references or math
  (`$`). The recap prints its path. Without `--md` an existing `wrapped.md` is left alone,
  and like `stats.json` it is never written through a symlink.

## [1.3.0] - 2026-10-06

### Added

- Biggest commit: the message hall of fame card now shows the commit with the most
  lines changed (its day, lines added / removed and subject), the recap gets a
  "Biggest" line, and `stats.json` gets `stats.biggestCommit` (`{hash, subject, date,
  linesAdded, linesRemoved, lines, files}`, or `null`). Lines count over the same files
  as hot files (lockfiles, build output, vendored and minified files left out, and
  `--exclude`d files too); merge commits are skipped and a tie goes to the earliest
  commit (on the same timestamp, the older one in git order). Without such a commit the
  card is unchanged. In English and Turkish.
- `--exclude <glob>` (repeatable) leaves matching files out of lines added / removed,
  files touched, hot files, languages and the biggest commit, and so out of the per-repo
  breakdown, the team card's lines and the year-over-year lines changed. Gitignore-like
  matching with no new dependencies: `*`, `?` and `**` (`**` crosses folders only as a
  whole path segment; inside a name, as in `src**.js`, it is a plain `*`); a pattern
  without a `/` matches a name at any depth (`*.min.js`, `fixtures`), one with a `/` is
  anchored at the repo root (`src/gen/*.js`), and a matching folder (`docs`, `docs/`,
  `docs/**`) drops everything under it. With several repos a pattern matches the path
  inside its repo, and a path pattern whose first segment has no wildcard (`api/src/`,
  `/web`) also the shown `<repo>/<path>`; a name pattern or one starting with a wildcard
  never matches a repo's label, so `*/generated/` drops the same files as with one repo.
  Commits are never dropped, so commit counts, active days, streaks and habits do not
  change. `stats.json` gets `filters.exclude` (`[]` when none).
- Monthly timeline card ("Month by month"), right after the activity calendar: commits
  per calendar month as bars, with the peak month called out (a tie goes to the earliest
  month) and how many months had commits. It only appears when the commits span two or
  more calendar months, so a history inside one month keeps the same cards as before;
  when it appears, the cards after it shift by one number (`06-months.svg`, hot files
  becomes 07, and so on), so a run now has 10 to 12 cards. It shows the most recent 24
  months at most ("24 months to Apr 2019" for a repo that went quiet more than a month
  ago, like the activity card). Author-local months like the other day-based stats;
  commits dated after tomorrow are left off the card. In English and Turkish, in every
  theme. `stats.json` gets `stats.months`: every month from the first to the last active
  one (`{month: "YYYY-MM", commits}`, zero-filled) and the `peak` month.

## [1.2.0] - 2026-10-06

### Added

- A team card (08, "The team") for repos with two or more contributors: the headcount
  and the top five contributors by commits (counted per email after `.mailmap`, shown by
  git author name only, never an email). With `--author` it ranks you against everyone
  in the same window ("#2 of 7 contributors", your share of commits and lines), reading
  the history a second time without the author filter. When `--max-commits` caps that
  read, everyone is read again from the day of your oldest analyzed commit (same
  filters, cap and repos), so you and the team are ranked over the same span; if that
  is still capped, the ranking covers everyone's most recent N commits, you included,
  and the recap says which of the two applies. Single-author repos, and an
  `--author` with no commits in the window, skip it, so a run has 10 or 11 cards, always
  numbered without gaps.
- `stats.contributors` in `stats.json` (`total`, `top`, `you`, `authorFilter`,
  `truncated`) and a "Team" line in the terminal recap.
- `--lang tr|en` (also `--lang=tr`): the cards, the 1200x630 share image, the PNGs, the
  `wrapped.html` viewer (labels, buttons, aria text, live-region messages,
  `<html lang>`) and the terminal recap in Turkish, with Turkish dates, 24-hour times,
  number and percent formats and Turkish upper-casing. English stays the default and
  its output is unchanged; an unknown code is an error (exit 2). `stats.json` is
  language-neutral and identical for every `--lang`. All strings live in one table per
  language under `src/i18n/`, and a test checks every key exists in every language.
  Language names are kept as they are except "Text" ("Metin" in Turkish) on the
  languages card and in the recap.
- `--theme default|mono|neon` (also `--theme=mono`): color themes for the story cards,
  the PNGs, the share image and the `wrapped.html` viewer chrome. `mono` is grayscale,
  `neon` near-black with one vivid neon glow and accent bar per card; only colors
  change, never the layout. `default` (and no `--theme`) output is byte-identical to
  before; an unknown name is an error (exit 2). Full-opacity white text keeps a WCAG contrast of at
  least 4.5:1 on every `mono` / `neon` background, also under panels and glows.
  `src/cards/themes.js` exports the tables (`COLOR_THEMES`) and `contrastRatio()`.
- Multi-repo Wrapped: `gitwrapped repoA repoB ...` merges several repos' histories into
  one story. Every repo is read with the same `--since` / `--until` / `--year` /
  `--author` filters; `--max-commits` caps the merged history in total. File paths are
  prefixed with the repo's label (its folder name; `app`, `app-2` on a clash), commits
  shared by two repos count once, and the same repository given twice (also as a
  worktree) is an error. The cards name the run "N repos", the intro names the repos,
  and the totals and hot-files cards add per-repo charts (commits and lines per repo,
  files touched per repo; top three plus "+N more" beyond four; the totals card compacts,
  then leaves out, its chart when space is short, e.g. with `--year`, so the commit count stays at
  140px or more; the numbers stay in the recap and `stats.json`). Contributors are
  counted across all the repos. Single-repo output is unchanged.
- In `stats.json` of a multi-repo run: `repo` is `null`, a top-level `repos` lists the
  labels, and `stats.repos` holds the per-repo breakdown (`name`, `commits`,
  `linesAdded`, `linesRemoved`, `filesTouched`, `share`). The terminal recap gets a
  "Repos" block with one line per repo, aligned by terminal columns (emoji and CJK
  labels included).
- Year over year: with `--year`, the year before is read too (same `--author`, repos,
  `.mailmap` and `--max-commits`) and compared on commits, lines changed and active
  days. The totals card adds three "vs <year>" rows with the signed change (`+42`,
  `−3`, `±0`), the outro card opens with a one-line summary, the recap gets a
  "vs <year>" line, and `stats.json` gets `stats.yearOverYear` (`year`, `previousYear`,
  `commits` / `lines` / `activeDays` as `{current, previous, delta}`,
  `previousTruncated`). Nothing is added when either year has no commits, and runs
  without `--year` are unchanged. When `--max-commits` cuts the previous year short the
  recap adds a note; when its read fails, a warning, and the run goes on without the
  comparison.
- Card text keeps no-break spaces (U+00A0) together when wrapping, measured as a space.

## [1.1.0] - 2026-10-06

### Added

- `--until YYYY-MM-DD`: only include commits authored on or before that day
  (inclusive). Combines with `--since`; `--since` after `--until` is an error. git's
  committer-date `--until` is not used: a cheap first `git log` pass of hashes and author
  dates picks the window (and the `--max-commits` cap inside it), and only those
  commits are read in full.
- `--year YYYY` (1970 to 9999): a calendar-year window, the classic Wrapped (same as
  `--since YYYY-01-01 --until YYYY-12-31`). The intro card reads "Your YYYY in git" and
  the share image "My YYYY Git Wrapped".
- Cards, the share image, the `wrapped.html` title and the terminal recap show the
  requested window (e.g. "my-app · 2025", "until Mar 9, 2025"). A long repo name is
  shortened in the footer before the window is.
- For a window that ended before today, the current streak is the one running on the
  window's last day (a complete day, so no grace day), shown as "at window end".
- When a date or author filter matches nothing, the recap names the filters, and an
  oversized `git log` suggests a narrower `--since` / `--until` / `--year` window.
- `--json`: also write `<out>/stats.json` with every computed stat, in a stable,
  documented shape (`schemaVersion`, `generator`, `repo`, `asOf`, `filters`,
  `truncated`, `stats`), with no generation timestamp and no machine paths.
- A **Languages** card (card 7 of 10, after hot files): your top programming language's
  share of the lines you changed ("72% · Mostly TypeScript", "Led by" under 50%, ties named
  as "Tied at the top: Go, JavaScript and Python" or "4-way tie at the top"), bars for
  the top five languages plus "Other", and a one-liner. Data formats and prose (JSON,
  YAML, Markdown, ...) appear in the bars but only lead when there's no code. No share
  reads 100% while other languages exist. Languages come from a built-in table of 86
  languages by file extension and well-known file names (`Dockerfile`, `Makefile`,
  `Gemfile`, `CMakeLists.txt`, ...), skipping the same paths as hot files plus binary
  files. The messages, personality and outro cards move to 08-10; re-running into an
  earlier output folder removes the old-numbered files.
- `stats.languages` in `stats.json` (`totalLines`, `totalFiles`, `basis`, and per
  language `name`, `type`, `lines`, `files`, `share`; equal amounts get equal shares), and
  a "Top language" line in the terminal recap.
- `--open`: open `<out>/wrapped.html` in the default browser when the run is done
  (`open` on macOS, `xdg-open` on Linux and others, `rundll32
  url.dll,FileProtocolHandler <file:// URL>` on Windows, which involves no `cmd.exe`
  quoting). It prints `Opening <path>…` first, starts the opener detached and waits at
  most 1.5 seconds for it, never for the browser. If the opener can't start or exits
  with an error in that time, gitwrapped prints a one-line warning with the path and
  still exits 0.
- CI: a `pack-smoke` job on Linux, macOS and Windows (`npm run pack-smoke`,
  `scripts/pack-smoke.js`) packs the tarball, installs it into a fresh temp project and
  runs the installed `gitwrapped` on the fixture repo, checking the tarball contents, the
  bin link, `--version`, the HTML, SVG cards, PNGs (so the native renderer resolves from
  the install) and `stats.json`.

### Changed

- Privacy: with `--author`, the intro card, share image and `wrapped.html` show only the
  part of the email before the first `@` ("Starring ada."), never an address or domain.
  For `Name <email>` only the name is shown, for a regex alternation (`a@x.io|b@y.io`)
  the first alternative's local part, and nothing at all for `@domain`. `stats.json`
  still records the full value in `filters.author`.
- `--since` now compares each commit's author-local calendar day (the day the stats use)
  instead of the machine's local midnight, so a date window gives the same commits in
  every time zone. `--since` and `--until` ignore surrounding whitespace, like `--year`,
  and dates before 1970 are rejected with a clear message.
- Hot files (and languages) also ignore vendored code in a repo-root `vendor/` or
  `third_party/` folder and test snapshots (`*.snap`, anything under `__snapshots__/`).
- `totals.firstDay` / `totals.lastDay` are now the earliest / latest author-local days,
  so `firstDay <= lastDay` always holds with mixed time-zone offsets (before, they were
  the days of the earliest / latest instants).
- The activity card of a repo that went quiet more than 30 days ago reads "12 months to
  <Mon YYYY>" instead of "Your last 12 months".
- Viewer accessibility: the story is a `region` with the "carousel" role description,
  the pause button uses only `aria-label` (no `aria-pressed` alongside it), single-key
  shortcuts are ignored while typing in a text field, and every card has a
  screen-reader text version of its content (linked with `aria-describedby`).
- An empty run on a HEAD without commits (a new or orphan branch) while other branches
  or tags exist adds a note that only HEAD is read, suggesting to check out a branch.

### Fixed

- A future-dated commit (clock skew, e.g. 2099) no longer resets the current streak or
  stretches the activity calendar past tomorrow, the date range on the cards (intro,
  footers, share image), the longest streak shown on the cards and in the recap, or the
  Steady Shipper span and streak: days after tomorrow are left out. `stats.json` and the
  totals still count them.
- The Steady Shipper span no longer drops to 0 days when offsets put the earliest
  commit's day after the latest one's.
- The recap prints `0` instead of `−0` / `+0` for zero (or rounded-to-zero, or invalid
  negative) line counts, like the cards.
- Bidi embedding / override / isolate controls (U+202A–202E, U+2066–2069) and the
  Unicode line / paragraph separators are stripped from the recap, the cards and the
  `wrapped.html` title / heading, so a commit message or repo name cannot visually
  reorder text. Card text measures them as zero width, so truncation matches what is
  drawn.
- `--since` in the first week of 1970 no longer sends git a pre-1970 bound it cannot parse.
- `--no-png` no longer deletes `share.png` / `png/NN-<card>.png` in an `--out` folder that
  gitwrapped did not create (one without a `wrapped.html` from an earlier run).
- Output is never written or deleted through a symlink inside `--out`: a symlinked output
  file or `cards/` / `png/` folder stops the run with a clear error before anything is
  written, and cleanup only removes regular files.
- In `wrapped.html`, hovering a calendar day or chart bar with a mouse shows its tooltip
  again (the tap zones no longer sit on top of the card for hover-capable pointers).

## [1.0.0] - 2026-10-05

First public release on npm as `@furkycl/gitwrapped`.

### Added

- `gitwrapped [path]` CLI, runnable with `npx @furkycl/gitwrapped`. Options: `--since YYYY-MM-DD`,
  `--author <email>`, `--out <dir>`, `--max-commits <n>`, `--no-png`, `--no-color`,
  `-h`/`--help` and `-v`/`--version`. Honors `NO_COLOR` and `FORCE_COLOR`.
- Git history reading with a single `git log --numstat` call: hash, author, `.mailmap`
  email, date, parents, subject and per-file line counts. Authors are counted by their
  `.mailmap` identity.
- Stats: totals (commits, lines added and removed, active days, files touched,
  contributors), time habits by hour and weekday in each commit's author-local time,
  longest and current streaks, commits per day, hot files (lockfiles and build output
  ignored), commit message stats, and a rule-based personality (Night Owl, Early Bird,
  Friday Deployer, Fixaholic, Weekend Warrior or Steady Shipper) with a one-line roast.
- Nine 1080x1920 SVG story cards: Intro, Totals, Power hour (24-hour and weekday charts),
  Streak, Activity (a GitHub-style calendar heatmap of up to 53 weeks), Hot files,
  Message hall of fame, Personality and Outro. No external fonts.
- `wrapped.html`: a self-contained offline story viewer with a strict
  Content-Security-Policy. Story progress bars, tap/click, keyboard and swipe navigation,
  pause and hold, `#N` deep links, reduced-motion support, per-card PNG and SVG download,
  a Share button where the system share sheet is available, accessibility labels, and a
  `?` shortcut help panel.
- PNG export of every card via `@resvg/resvg-js`, plus a 1200x630 `share.png` (and
  `share.svg`) summary image. If no prebuilt resvg binary is available, PNG export is
  skipped with a message and the SVG cards and `wrapped.html` are still written.
- Terminal recap after each run (commits, active days, lines, power hour, streak, hottest
  file, top word, personality), in color on a terminal and plain when piped. The first
  output line is `gitwrapped: N commits → <out>/wrapped.html`.
- Edge-case handling: an empty repo or a filter that matches nothing still produces a
  full card set and exits 0; single-commit repos work; at most 50,000 recent commits are
  analyzed by default (`--max-commits` changes this); a missing path, a file or a folder
  that is not a git repository exits 1 with a one-line error; missing `git` and
  "dubious ownership" errors get a clear message.
- CI on Linux, macOS and Windows with Node 20 and 22.

### Fixed

- `--since` keeps every commit authored on or after the date, even behind older commits.
- Merge commits are skipped in message stats and the Fixaholic share.
- Submodule bumps are not counted as file edits.
- In shallow clones, the oldest fetched commit's line counts are skipped instead of
  counting the whole tree as added.
- On macOS, color emoji are left out of PNG exports, because resvg drew Apple Color Emoji
  far from their text. SVG cards and `wrapped.html` keep them.

[Unreleased]: https://github.com/furkycl/gitwrapped/compare/v1.15.0...HEAD
[1.15.0]: https://github.com/furkycl/gitwrapped/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/furkycl/gitwrapped/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/furkycl/gitwrapped/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/furkycl/gitwrapped/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/furkycl/gitwrapped/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/furkycl/gitwrapped/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/furkycl/gitwrapped/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/furkycl/gitwrapped/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/furkycl/gitwrapped/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/furkycl/gitwrapped/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/furkycl/gitwrapped/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/furkycl/gitwrapped/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/furkycl/gitwrapped/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/furkycl/gitwrapped/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/furkycl/gitwrapped/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/furkycl/gitwrapped/releases/tag/v1.0.0
