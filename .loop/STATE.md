# STATE

Next turn: 004

| Turn | Date (UTC) | Task | PR | Result | Note for next turn |
|------|------------|------|----|--------|--------------------|
| 000 | 2026-10-04 | Loop bootstrap | — | done | Start with M1. |
| 001 | 2026-10-04 | M1: npm package init + CLI entry | https://github.com/furkycl/gitwrapped/pull/1 | done (63 tests, Node 20+22) | Next: GitHub Actions CI. Node 20 `node --test` runs every .js under test/, so put the M2 fixture-repo script in scripts/. Remote branch loop/001-package-and-cli could not be deleted (proxy 403); owner should delete it. |
| 002 | 2026-10-04 | M1: GitHub Actions CI + M2: read commits via git log | https://github.com/furkycl/gitwrapped/pull/3 | done (102 tests, Node 20+22 locally) | CI on main went red after merge (git 2.55 prints UTC %aI as Z); fixed test-only in https://github.com/furkycl/gitwrapped/pull/4, CI green. Wait for PR CI before merging. Next: --numstat file stats. src/git.js uses `git log -z` + \x1f fields; extend LOG_FORMAT/parseLog rather than a second git call if feasible. Remote branch deletion is blocked by proxy 403 (loop/001-*, loop/002-ci-git-log, loop/002b-ci-date-fix) — owner should delete them. Duplicate PR #2 was closed unmerged. |
| 003 | 2026-10-04 | M2: per-commit numstat file stats + fixture repo script | https://github.com/furkycl/gitwrapped/pull/5 | done (148 tests, CI green Node 20+22) | M2 complete. Next: M3 totals. Use scripts/make-fixture-repo.js (makeFixtureRepo → {dir, cleanup, commits}; expected stats in `commits`) for stats tests. Renames show as delete+add (--no-renames). For huge repos (M5) consider streaming via spawn; numstat output can exceed maxBuffer. |
