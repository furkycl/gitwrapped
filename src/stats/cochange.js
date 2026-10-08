// Co-change pair: the two files most often changed in the same non-merge commit, over the
// same files as the hot files (src/stats/files.js): same ignore rules, and --exclude has
// already dropped its files (see excludeFiles).
import { scrubEmails } from '../privacy.js';
import { isIgnoredPath, repoRelativePath } from './files.js';
import { isMergeCommit } from './messages.js';

/** The fewest commits a pair must share to be shown (fewer is coincidence). */
export const CO_CHANGE_MIN_COMMITS = 3;

/**
 * Commits with more counted files than this are left out of the pair count: a sweeping
 * change (a rename across the tree, a reformat, a license header) says nothing about which
 * files belong together, and n files make n(n-1)/2 pairs, so big repos stay fast.
 */
export const CO_CHANGE_MAX_FILES = 30;

/**
 * stats.coChange (shape from src/git.js readCommits): `{files: [a, b], commits}`, the two
 * files changed together in the most non-merge commits, or null when no pair shares at
 * least CO_CHANGE_MIN_COMMITS (3) commits.
 * - files: the two paths, sorted (plain code-unit comparison); in a multi-repo run with
 *   their "<repo>/" label as for hot files; anything shaped like an email address replaced
 *   by "…" (see scrubEmails), counted by the real paths;
 * - commits: how many non-merge commits changed both.
 * - Files are counted exactly as for the hot files: ignored paths are skipped (see
 *   isIgnoredPath, checked relative to each repo's root, see repoRelativePath), --exclude
 *   has already dropped its files, and a path listed twice in one commit counts once.
 *   Files in different repos are never in the same commit, so never a pair.
 * - Merge commits (see isMergeCommit) are skipped, and so are commits with more than
 *   CO_CHANGE_MAX_FILES (30) counted files (sweeping changes).
 * - Ties (same commits): the pair whose first file sorts first, then whose second does.
 * Exact, in memory linear in the files touched (no table of every pair): files in fewer
 * than 3 counted commits are dropped first, the rest get numeric ids in sorted order, and
 * each file's partners are counted in one reused array (sum of squared commit sizes steps).
 * Invalid input policy: never throws, never mutates; non-object commits / files and files
 * without a string path are skipped. Empty input → null.
 */
export function computeCoChange(commits) {
  // Pass 1: each counted commit's distinct counted paths, and how many commits touch each path.
  const kept = [];
  const perPath = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.files) || isMergeCommit(c)) continue;
    const paths = new Set();
    for (const f of c.files) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue;
      if (isIgnoredPath(repoRelativePath(c, f.path))) continue;
      paths.add(f.path);
    }
    if (paths.size < 2 || paths.size > CO_CHANGE_MAX_FILES) continue;
    kept.push([...paths]);
    for (const p of paths) perPath.set(p, (perPath.get(p) ?? 0) + 1);
  }
  // A file in fewer than the minimum commits cannot be in a pair: drop it, and number the
  // rest in sorted order, so comparing ids is comparing paths.
  const names = [...perPath].filter(([, n]) => n >= CO_CHANGE_MIN_COMMITS).map(([p]) => p).sort(compare);
  if (names.length < 2) return null;
  const id = new Map(names.map((p, i) => [p, i]));
  const rows = [];
  for (const paths of kept) {
    const ids = [];
    for (const p of paths) {
      const i = id.get(p);
      if (i !== undefined) ids.push(i);
    }
    if (ids.length >= 2) rows.push(Int32Array.from(ids));
  }
  // Which rows (commits) each file is in, as one flat index (CSR).
  const n = names.length;
  const start = new Int32Array(n + 1);
  for (const r of rows) for (const i of r) start[i + 1] += 1;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n);
  const postings = new Int32Array(start[n]);
  rows.forEach((r, k) => {
    for (const i of r) postings[fill[i]++] = k;
  });
  // Pass 2: for each file a (in path order), how many commits it shares with each later file b.
  const shared = new Int32Array(n);
  const touched = new Int32Array(n);
  let best = null;
  for (let a = 0; a < n; a++) {
    let t = 0;
    for (let p = start[a]; p < start[a + 1]; p++) {
      for (const b of rows[postings[p]]) {
        if (b <= a) continue;
        if (shared[b]++ === 0) touched[t++] = b;
      }
    }
    for (let k = 0; k < t; k++) {
      const b = touched[k];
      const count = shared[b];
      shared[b] = 0;
      // a only grows, so a tie is won by the smaller b of the same a, else kept.
      if (count >= CO_CHANGE_MIN_COMMITS && (!best || count > best.commits || (count === best.commits && a === best.a && b < best.b))) {
        best = { a, b, commits: count };
      }
    }
  }
  return best ? { files: [scrubEmails(names[best.a]), scrubEmails(names[best.b])], commits: best.commits } : null;
}

/** Plain code-unit order (deterministic, locale-free). */
function compare(x, y) {
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * stats.coChange as the hot-files card, the recap and wrapped.md show it: `{files: [a, b],
 * commits}` (two non-empty strings, emails scrubbed again; commits a whole number of at
 * least CO_CHANGE_MIN_COMMITS), or null (also for a missing or malformed value).
 */
export function shownCoChange(stat) {
  if (!stat || typeof stat !== 'object' || !Array.isArray(stat.files) || stat.files.length !== 2) return null;
  const files = stat.files.map((p) => (typeof p === 'string' ? scrubEmails(p).trim() : ''));
  if (files.some((p) => p === '')) return null;
  const commits = stat.commits;
  if (!Number.isSafeInteger(commits) || commits < CO_CHANGE_MIN_COMMITS) return null;
  return { files, commits };
}
