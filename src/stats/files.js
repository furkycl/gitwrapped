import { scrubEmails } from '../privacy.js';

/** Lockfiles, matched by exact (case-sensitive) basename. */
const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
  'mix.lock',
  'pubspec.lock',
  'Podfile.lock',
  'packages.lock.json',
  'flake.lock',
  'uv.lock',
]);

/** Whether `name` (a file's basename) is a lockfile (exact, case-sensitive; see LOCKFILES). */
export const isLockfileName = (name) => typeof name === 'string' && LOCKFILES.has(name);

/** Dependency / tool cache directories: unambiguous, matched at any depth. */
const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '__pycache__',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '__snapshots__',
]);

/**
 * Generic build-output directory names. These are also common real source folder names
 * (e.g. `src/build/`), so they only count at the repo root or at the root of a monorepo
 * package (`packages/<name>/dist/`, `apps/<name>/build/`).
 */
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'coverage', 'target']);
const MONOREPO_ROOTS = new Set(['packages', 'apps']);

/**
 * Vendored third-party code. `vendor/` is also a common app folder name in some
 * frameworks deeper in the tree, so only the repo-root folder counts.
 */
const ROOT_VENDOR_DIRS = new Set(['vendor', 'third_party']);

/** Minified bundles and JS/CSS source maps, matched against the basename. */
const GENERATED = /\.(?:min\.js|min\.css|(?:js|mjs|cjs|css)\.map|snap)$/;

/** A line count as a non-negative finite number; anything else → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * True for paths that should not count as "hot files" (or toward languages):
 * - lockfiles, by basename;
 * - anything under a dependency / cache directory at any depth (`node_modules`, `.next`,
 *   `__pycache__`, jest `__snapshots__`, ...);
 * - anything under a repo-root `vendor/` or `third_party/` directory (vendored code);
 * - anything under a generic build directory (`dist`, `build`, `out`, `coverage`, `target`)
 *   at the repo root or a monorepo package root (`packages/x/dist/...`);
 * - minified files, JS/CSS source maps and test snapshots (`*.min.js`, `*.min.css`,
 *   `*.js.map`, `*.css.map`, `*.snap`).
 * Only directory segments are checked against the directory rules, never the file name.
 * Paths use '/' as git prints them.
 * Invalid input policy: a non-string or empty path → true (ignored, never throws).
 */
export function isIgnoredPath(path) {
  if (typeof path !== 'string' || path === '') return true;
  const segments = path.split('/');
  const base = segments[segments.length - 1];
  if (LOCKFILES.has(base) || GENERATED.test(base)) return true;
  const dirs = segments.slice(0, -1);
  if (dirs.some((s) => ALWAYS_IGNORED_DIRS.has(s))) return true;
  if (BUILD_DIRS.has(dirs[0]) || ROOT_VENDOR_DIRS.has(dirs[0])) return true;
  return MONOREPO_ROOTS.has(dirs[0]) && dirs.length >= 3 && BUILD_DIRS.has(dirs[2]);
}

/**
 * A file path of commit `c` as it is inside its own repo: in a multi-repo run (see
 * mergeHistories in src/git.js) paths carry a "<repo>/" prefix, which is cut off here so
 * the root-level rules of isIgnoredPath (dist/, vendor/, packages/x/build/) still apply
 * at each repo's root. Without `c.repo` the path is returned as it is.
 */
export function repoRelativePath(c, path) {
  const repo = typeof c?.repo === 'string' && c.repo ? `${c.repo}/` : '';
  return repo && typeof path === 'string' && path.startsWith(repo) ? path.slice(repo.length) : path;
}

/**
 * The most-edited files (shape from src/git.js readCommits).
 * Returns up to `limit` (default 5) entries `{path, commits, linesAdded, linesRemoved}`:
 * - commits: number of commits touching the path (a path listed twice in one commit
 *   counts once for that commit; its line counts are still summed).
 * - Sorted by commits desc, then linesAdded + linesRemoved desc, then path asc
 *   (plain code-unit comparison, so output is deterministic).
 * - Ignored paths (see isIgnoredPath; in a multi-repo run checked relative to each
 *   repo's root, see repoRelativePath) are skipped. Binary files still count: they are
 *   edited files, they just contribute 0 lines.
 * - Paths are as git reports them with --no-renames: a rename counts as a delete of
 *   the old path plus an add of the new one.
 * Invalid input policy: files without a string path are skipped; a missing or
 * non-finite line count adds 0; `limit` must be a non-negative integer (else TypeError).
 * Empty input → [].
 * - `path` is shown with anything shaped like an email address (`name@host`) replaced
 *   by "…" (see scrubEmails; "keys/ada@example.com.pub" → "keys/…"); files are still
 *   counted and sorted by their real paths.
 * Ties: cards should check `result[0].commits === result[1]?.commits` before calling the
 * top file "the one you can't stop touching".
 */
export function computeHotFiles(commits, { limit = 5 } = {}) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError(`limit must be a non-negative integer, got: ${JSON.stringify(limit)}`);
  }
  return [...fileTouches(commits).values()]
    .sort(
      (a, b) =>
        b.commits - a.commits ||
        b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, limit)
    .map((e) => ({ ...e, path: scrubEmails(e.path) }));
}

/**
 * Every changed file of `commits`, as hot files count them (see computeHotFiles): a Map
 * from the path as git reports it (repo-labelled in a multi-repo run, so the same path in
 * two repos is two files) to `{path, commits, linesAdded, linesRemoved}`, in first-seen
 * order. Ignored paths (isIgnoredPath, relative to each repo's root) and files without a
 * string path are skipped; a path listed twice in one commit counts once for that commit.
 * Paths are as git reports them with --no-renames (a rename is the old path plus the new
 * one). Every commit given is counted (merges carry no files, see readCommits). Never throws.
 */
export function fileTouches(commits) {
  const byPath = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const seen = new Set();
    for (const f of Array.isArray(c.files) ? c.files : []) {
      if (!f || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      let entry = byPath.get(f.path);
      if (!entry) {
        entry = { path: f.path, commits: 0, linesAdded: 0, linesRemoved: 0 };
        byPath.set(f.path, entry);
      }
      if (!seen.has(f.path)) {
        seen.add(f.path);
        entry.commits += 1;
      }
      entry.linesAdded += count(f.added);
      entry.linesRemoved += count(f.removed);
    }
  }
  return byPath;
}

/**
 * `commits` with the files matched by `isExcluded` (a path predicate, see compileExcludes
 * in src/glob.js) removed, for --exclude. Each path is checked as it is inside its own
 * repo (repoRelativePath) and, in a multi-repo run, also as shown ("<repo>/<path>", with
 * `{labelled: true}`, which only path patterns whose first segment is literal, such as
 * `api/docs/` or `/web`, match; name patterns such as `docs` or `api*` and patterns
 * starting with a wildcard such as `*` + `/generated/` never match a repo's label): a match
 * on either drops the file. A commit that loses files is copied with `files`,
 * `filesChanged`, `linesAdded` and `linesRemoved` recomputed from the files it keeps (a
 * missing or non-finite count adds 0); other commits are kept as they are (same object).
 * Commits are never dropped, even when every file is excluded: commit counts, active
 * days, streaks and time habits do not change. The input is not modified.
 * The commit's `born` / `buried` paths (when present) drop the same files, and its
 * `renamed` entries drop those whose new path (`to`) is dropped (as computeFileLifecycle
 * judges a rename by where the file went).
 * `isExcluded` null / undefined → `commits` itself.
 */
export function excludeFiles(commits, isExcluded) {
  if (!isExcluded || !Array.isArray(commits)) return commits;
  return commits.map((c) => {
    if (!c) return c;
    const dropped = (path) => typeof path === 'string' && (isExcluded(repoRelativePath(c, path)) || (c.repo && isExcluded(path, { labelled: true })));
    // Files born / buried (see readLifecycle in src/git.js) follow the same rule.
    const lifecycle = {};
    for (const key of ['born', 'buried']) {
      if (!Array.isArray(c[key])) continue;
      const kept = c[key].filter((p) => !dropped(p));
      if (kept.length !== c[key].length) lifecycle[key] = kept;
    }
    if (Array.isArray(c.renamed)) {
      const kept = c.renamed.filter((r) => !dropped(r?.to));
      if (kept.length !== c.renamed.length) lifecycle.renamed = kept;
    }
    const changed = Object.keys(lifecycle).length > 0;
    if (!Array.isArray(c.files) || c.files.length === 0) return changed ? { ...c, ...lifecycle } : c;
    const keep = c.files.filter((f) => !(f && dropped(f.path)));
    if (keep.length === c.files.length) return changed ? { ...c, ...lifecycle } : c;
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const f of keep) {
      linesAdded += count(f?.added);
      linesRemoved += count(f?.removed);
    }
    return { ...c, ...lifecycle, files: keep, filesChanged: keep.length, linesAdded, linesRemoved };
  });
}

/**
 * Files born, buried and renamed in the window: `{added, deleted, renamed}`, how many
 * files the commits added, deleted and renamed (the `born` / `buried` paths and `renamed`
 * entries of readLifecycle in src/git.js; a rename is neither added nor deleted). Each
 * add, delete or rename counts once per commit, so a file added, deleted and added again
 * counts as 2 added and 1 deleted, and a file renamed in two commits counts as 2
 * renamed. Ignored paths are skipped as for hot files (see isIgnoredPath; relative to
 * each repo's root in a multi-repo run, see repoRelativePath), and --exclude has already
 * dropped its files (see excludeFiles). A rename is judged by its new path (`to`): one into an ignored path
 * (say, into vendor/) does not count, one out of it does (the file is now counted
 * where it was not before). Merge commits never count (git gives them no diff, as for the
 * line counts). Commits without the fields (lifecycle not read) add nothing. Never
 * throws; `{added: 0, deleted: 0, renamed: 0}` for none.
 */
export function computeFileLifecycle(commits) {
  let added = 0;
  let deleted = 0;
  let renamed = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || (Array.isArray(c.parents) && c.parents.length > 1)) continue;
    const counted = (paths) => (Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p !== '' && !isIgnoredPath(repoRelativePath(c, p))).length : 0);
    added += counted(c.born);
    deleted += counted(c.buried);
    if (Array.isArray(c.renamed)) renamed += counted(c.renamed.map((r) => r?.to));
  }
  return { added, deleted, renamed };
}

/**
 * stats.fileLifecycle as the cards, recap and wrapped.md show it: `{added, deleted,
 * renamed}` (each a non-negative integer, else 0; a stats.json without `renamed`, from
 * before renames were counted, reads as 0), or null when no file was added, deleted or
 * renamed (or the value is missing / malformed), so nothing is shown.
 */
export function shownFileLifecycle(lifecycle) {
  if (!lifecycle || typeof lifecycle !== 'object') return null;
  const whole = (n) => (Number.isSafeInteger(n) && n > 0 ? n : 0);
  const added = whole(lifecycle.added);
  const deleted = whole(lifecycle.deleted);
  const renamed = whole(lifecycle.renamed);
  return added + deleted + renamed > 0 ? { added, deleted, renamed } : null;
}
