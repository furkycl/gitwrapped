# STATE

Next turn: 003

| Turn | Date (UTC) | Task | PR | Result | Note for next turn |
|------|------------|------|----|--------|--------------------|
| 000 | 2026-10-04 | Loop bootstrap | — | done | Start with M1. |
| 001 | 2026-10-04 | M1: npm package init + CLI entry | https://github.com/furkycl/gitwrapped/pull/1 | done (63 tests, Node 20+22) | Next: GitHub Actions CI. Node 20 `node --test` runs every .js under test/, so put the M2 fixture-repo script in scripts/. Remote branch loop/001-package-and-cli could not be deleted (proxy 403); owner should delete it. |
| 002 | 2026-10-04 | M1: GitHub Actions CI + M2: read commits via git log | https://github.com/furkycl/gitwrapped/pull/3 | done (102 tests, Node 20+22 locally) | Next: --numstat file stats. src/git.js uses `git log -z` + \x1f fields; extend LOG_FORMAT/parseLog rather than a second git call if feasible. Remote branch deletion is blocked by proxy 403 (loop/001-*, loop/002-ci-git-log) — owner should delete them. Duplicate PR #2 was closed unmerged. |
