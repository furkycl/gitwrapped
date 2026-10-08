// Docs share: how many of the changed lines were in documentation files, over the same
// files as the hot files, top folders and test share (src/stats/files.js, tests.js): same
// ignore rules, and --exclude has already dropped its files (see excludeFiles).
import { isIgnoredPath, repoRelativePath } from './files.js';
import { shownTests } from './tests.js';

/**
 * Directory names that make every file under them a doc file (any directory segment, not
 * the file name itself; exact and case-sensitive, as TEST_DIRS in tests.js).
 */
export const DOC_DIRS = Object.freeze(['docs', 'doc']);

const DOC_DIR_SET = new Set(DOC_DIRS);

/**
 * Doc file extensions, matched case-insensitively ("README.md", "NOTES.MD", "guide.Rst"),
 * after a non-empty name (a file named just ".md" is not a doc by its name).
 */
const DOC_EXT = /.\.(?:md|mdx|rst|adoc)$/i;

/** The non-enumerable key computeDocShare keeps the exact (unrounded) share under. */
const EXACT = Symbol('docShare.exactShare');

/** A line count as a non-negative finite number; anything else → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Whether `path` (relative to its repo's root, "/"-separated, see repoRelativePath) is a
 * documentation file; either rule is enough:
 * - a directory segment named exactly `docs` or `doc` (DOC_DIRS, case-sensitive like the
 *   test directories: "Docs/", "documentation/" or "docsite/" do not count, nor does a
 *   file literally named "docs"); every file under one counts, so "docs/notes.txt" and
 *   "docs/conf.py" are docs;
 * - a file name ending in .md, .mdx, .rst or .adoc, in any letter case ("README.md",
 *   "CHANGELOG.MD", "guide.Rst"; not ".md" alone).
 * A .txt (or any other file) outside a docs directory is not a doc. A file can be both a
 * test and a doc ("test/README.md"): it then counts toward both shares.
 * False for a non-string or empty path; never throws.
 */
export function isDocPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  const segments = path.split('/');
  if (DOC_EXT.test(segments[segments.length - 1])) return true;
  return segments.slice(0, -1).some((s) => DOC_DIR_SET.has(s));
}

/**
 * stats.docShare (shape from src/git.js readCommits): `{lines, share}`, or null when no
 * counted file has a changed line (nothing to take a share of), exactly as stats.tests
 * (see tests.js computeTests):
 * - lines: lines added + deleted in doc files (see isDocPath);
 * - share: lines / all counted lines changed (0..1, 3 decimals, at most 0.999 short of
 *   every line; 0 when no doc line changed).
 * - Files are counted as for the hot files: ignored paths skipped (see isIgnoredPath),
 *   both checks on the path relative to each repo's root in a multi-repo run (see
 *   repoRelativePath), so a repo labelled "docs" is not all docs.
 * Invalid input policy: never throws, never mutates; malformed commits / files skipped, a
 * missing or non-finite line count adds 0. Empty input → null.
 */
export function computeDocShare(commits) {
  let all = 0;
  let docs = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.files)) continue;
    for (const f of c.files) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue;
      const rel = repoRelativePath(c, f.path);
      if (isIgnoredPath(rel)) continue;
      const lines = count(f.added) + count(f.removed);
      all += lines;
      if (isDocPath(rel)) docs += lines;
    }
  }
  if (all === 0) return null;
  const share = Math.min(Math.round((docs / all) * 1000) / 1000, docs < all ? 0.999 : 1);
  // The exact ratio, for shownDocShare only: non-enumerable, so stats.json keeps exactly
  // `{lines, share}`.
  return Object.defineProperty({ lines: docs, share }, EXACT, { value: docs / all });
}

/**
 * stats.docShare as the hot-files / languages card, the recap and wrapped.md show it:
 * `{lines, percent}` when at least one doc line changed, else null (also for a missing or
 * malformed value); the same rules as shownTests (tests.js), the percent rounded once from
 * the exact ratio computeDocShare keeps, else from `share`.
 */
export function shownDocShare(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const exact = stat[EXACT];
  return shownTests(typeof exact === 'number' && Number.isFinite(exact) ? { lines: stat.lines, share: exact } : { lines: stat.lines, share: stat.share });
}
