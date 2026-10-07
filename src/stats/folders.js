// Top folders: the most-changed top-level directories by lines changed, over the same
// files as the hot files (src/stats/files.js): same ignore rules, and --exclude has
// already dropped its files (see excludeFiles).
import { scrubEmails } from '../privacy.js';
import { isIgnoredPath, repoRelativePath } from './files.js';

/** The folder name files at a repo's root are grouped under. */
export const ROOT_FOLDER = '(root)';

/** How many folders stats.folders keeps. */
export const TOP_FOLDERS = 5;

/** A line count as a non-negative finite number; anything else → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * The top-level folder of `path` (a file of commit `c`): its first directory, or
 * ROOT_FOLDER for a file at the repo root. In a multi-repo run (see mergeHistories in
 * src/git.js) paths carry a "<repo>/" prefix, which is kept: "api/src/x.js" → "api/src",
 * "api/README.md" → "api/(root)". Null for a non-string or empty path. A real directory
 * literally named "(root)" is merged with the root files (rare; accepted).
 */
export function folderOf(c, path) {
  if (typeof path !== 'string' || path === '') return null;
  const rel = repoRelativePath(c, path);
  const prefix = path.slice(0, path.length - rel.length);
  const cut = rel.indexOf('/');
  return `${prefix}${cut > 0 ? rel.slice(0, cut) : ROOT_FOLDER}`;
}

/**
 * The most-changed top-level folders (shape from src/git.js readCommits), as stats.folders:
 * up to `limit` (default TOP_FOLDERS) entries `{path, lines, added, deleted, commits}`:
 * - path: the folder (see folderOf): "src", "(root)" for files at the repo root; in a
 *   multi-repo run prefixed with the repo label ("api/src", "api/(root)");
 * - added / deleted: lines added / deleted in its files; lines = added + deleted;
 * - commits: how many commits touched at least one of its files.
 * - Files are counted exactly as for the hot files: ignored paths are skipped (see
 *   isIgnoredPath; relative to each repo's root in a multi-repo run), merges count as they
 *   do there (git gives them no files), renames are a delete plus an add.
 * - Folders with no lines changed (only binary files) are left out: they cannot rank by lines.
 * - Sorted by lines desc, then path asc (plain code-unit comparison of the real path).
 * - `path` is shown with anything shaped like an email address replaced by "…" (see
 *   scrubEmails); folders are still grouped and sorted by their real names.
 * Invalid input policy: never throws; non-object commits / files and files without a
 * string path are skipped, a missing or non-finite line count adds 0, a `limit` that is
 * not a non-negative integer is TOP_FOLDERS. Empty input → [].
 */
export function computeFolders(commits, { limit = TOP_FOLDERS } = {}) {
  if (!Number.isInteger(limit) || limit < 0) limit = TOP_FOLDERS;
  const byFolder = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.files)) continue;
    const seen = new Set();
    for (const f of c.files) {
      if (!f || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      const folder = folderOf(c, f.path);
      if (!folder) continue;
      let entry = byFolder.get(folder);
      if (!entry) {
        entry = { path: folder, lines: 0, added: 0, deleted: 0, commits: 0 };
        byFolder.set(folder, entry);
      }
      if (!seen.has(folder)) {
        seen.add(folder);
        entry.commits += 1;
      }
      entry.added += count(f.added);
      entry.deleted += count(f.removed);
    }
  }
  return [...byFolder.values()]
    .map((e) => ({ ...e, lines: e.added + e.deleted }))
    .filter((e) => e.lines > 0)
    .sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit)
    .map((e) => ({ path: scrubEmails(e.path), lines: e.lines, added: e.added, deleted: e.deleted, commits: e.commits }));
}

/**
 * stats.folders as the hot-files card, the recap and wrapped.md show it: the valid entries
 * (a non-empty path; positive whole `lines`; non-negative whole `added`, `deleted`,
 * `commits`, else 0), email-shaped text cut from each path again, in their order, each as
 * `{path, repo, name, root, lines, added, deleted, commits}` where `name` is the folder's
 * own name ("src", or ROOT_FOLDER), `repo` the multi-repo label before it ("" without one)
 * and `root` whether it is a repo's root files. Null with fewer than two (one folder says
 * nothing a "top folders" list could add) or a malformed value. stats.json keeps the raw list.
 */
export function shownFolders(folders) {
  if (!Array.isArray(folders)) return null;
  const whole = (n) => (Number.isSafeInteger(n) && n > 0 ? n : 0);
  const list = [];
  for (const f of folders) {
    if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue;
    const path = scrubEmails(f.path).trim();
    const lines = whole(f.lines);
    if (!path || lines === 0) continue;
    const cut = path.lastIndexOf('/');
    const name = path.slice(cut + 1);
    if (!name) continue;
    list.push({ path, repo: cut > 0 ? path.slice(0, cut) : '', name, root: name === ROOT_FOLDER, lines, added: whole(f.added), deleted: whole(f.deleted), commits: whole(f.commits) });
  }
  return list.length >= 2 ? list : null;
}
