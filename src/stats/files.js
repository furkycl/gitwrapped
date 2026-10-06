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
 * Ties: cards should check `result[0].commits === result[1]?.commits` before calling the
 * top file "the one you can't stop touching".
 */
export function computeHotFiles(commits, { limit = 5 } = {}) {
  commits = commits ?? [];
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError(`limit must be a non-negative integer, got: ${JSON.stringify(limit)}`);
  }
  const byPath = new Map();
  for (const c of commits) {
    const seen = new Set();
    for (const f of c.files ?? []) {
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
  return [...byPath.values()]
    .sort(
      (a, b) =>
        b.commits - a.commits ||
        b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, limit);
}
