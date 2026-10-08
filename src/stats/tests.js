// Test share: how many of the changed lines were in test files, over the same files as
// the hot files and top folders (src/stats/files.js): same ignore rules, and --exclude has
// already dropped its files (see excludeFiles).
import { isIgnoredPath, repoRelativePath } from './files.js';
import { weekendPercent } from './weekend.js';

/** Directory names that make every file under them a test file (any path segment, case-sensitive). */
export const TEST_DIRS = Object.freeze(['test', 'tests', '__tests__', 'spec']);

const TEST_DIR_SET = new Set(TEST_DIRS);

/** File-name markers of a test file: "foo.test.js", "foo.spec.ts", "foo_test.go". */
const TEST_NAME = /\.test\.|\.spec\.|_test\./;

/** The non-enumerable key computeTests keeps the exact (unrounded) share under (see shownTests). */
const EXACT = Symbol('tests.exactShare');

/** A line count as a non-negative finite number; anything else → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Whether `path` (relative to its repo's root, "/"-separated, see repoRelativePath) is a
 * test file: a directory segment named exactly test, tests, __tests__ or spec (TEST_DIRS;
 * case-sensitive, so "Test/" or "testing/" do not count), or a file name containing
 * ".test.", ".spec." or "_test." (foo.test.js, foo.spec.ts, foo_test.go). Only the file's
 * own name is matched by the name rule, and only its directories by the directory rule (a
 * file literally named "test" is not a test file). False for a non-string or empty path.
 */
export function isTestPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  const segments = path.split('/');
  const base = segments[segments.length - 1];
  if (TEST_NAME.test(base)) return true;
  return segments.slice(0, -1).some((s) => TEST_DIR_SET.has(s));
}

/**
 * stats.tests (shape from src/git.js readCommits): `{lines, share}`, or null when no
 * counted file has a changed line (nothing to take a share of).
 * - lines: lines added + deleted in test files (see isTestPath);
 * - share: lines / all counted lines changed (0..1, 3 decimals, at most 0.999 short of
 *   every line, as stats.weekend and stats.merges round theirs; 0 when no test line changed).
 * - Files are counted exactly as for the hot files and top folders: ignored paths are
 *   skipped (see isIgnoredPath) and both checks run on the path relative to each repo's
 *   root in a multi-repo run (see repoRelativePath), so a repo labelled "test" does not
 *   make all its files tests; merges count as they do there (git gives them no files),
 *   renames are a delete plus an add, binary files add 0 lines.
 * Invalid input policy: never throws, never mutates; non-object commits / files and files
 * without a string path are skipped, a missing or non-finite line count adds 0. Empty
 * input → null.
 */
export function computeTests(commits) {
  let all = 0;
  let tests = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.files)) continue;
    for (const f of c.files) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue;
      const rel = repoRelativePath(c, f.path);
      if (isIgnoredPath(rel)) continue;
      const lines = count(f.added) + count(f.removed);
      all += lines;
      if (isTestPath(rel)) tests += lines;
    }
  }
  if (all === 0) return null;
  const share = Math.min(Math.round((tests / all) * 1000) / 1000, tests < all ? 0.999 : 1);
  // The exact ratio, for shownTests only: non-enumerable, so stats.json (and any spread or
  // JSON copy) keeps exactly `{lines, share}`.
  return Object.defineProperty({ lines: tests, share }, EXACT, { value: tests / all });
}

/**
 * stats.tests as the hot-files / languages card, the recap and wrapped.md show it:
 * `{lines, percent}` (lines a positive whole number; percent a whole percent, never 100
 * short of every line, see weekend.js weekendPercent: 0 means "<1%") when at least one test
 * line changed, else null (also for a missing or malformed value). Only a share of
 * exactly 1 reads 100%. The percent is rounded once, from the exact ratio computeTests
 * keeps (non-enumerable, never in stats.json), else from `share`.
 */
export function shownTests(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const lines = Number.isSafeInteger(stat.lines) && stat.lines > 0 ? stat.lines : 0;
  if (lines === 0) return null;
  // The percent comes from the exact ratio when computeTests recorded it (as the weekend,
  // office hours and late nights do from their counts), so a 3-decimal share is not rounded
  // twice (0.45% would read "1%"); else (e.g. a share from elsewhere) from `share`.
  const exact = stat[EXACT];
  const share = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof share === 'number' && Number.isFinite(share) ? Math.min(Math.max(share, 0), 1) : 0;
  return { lines, percent: weekendPercent(share === 1 ? 1 : Math.min(raw, 0.999)) };
}
