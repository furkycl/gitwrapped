// Dependency bumps: non-merge commits that only touched lockfiles and dependency manifests
// (package.json, go.mod, Cargo.toml, ...). Read from the commit's file list (the numstat
// paths, see parseLog in src/git.js), which names every file a commit touched, lockfiles
// included: their line counts are ignored elsewhere (see isIgnoredPath), their names are not.
// --exclude has already dropped its files (see excludeFiles).
import { isLockfileName, repoRelativePath } from './files.js';
import { isMergeCommit } from './messages.js';

/**
 * Dependency manifests, matched by exact (case-sensitive) basename, as the lockfiles are
 * (see LOCKFILES in files.js), each the manifest of one of those lockfiles;
 * `requirements*.txt` is DEP_REQUIREMENTS, and Go's `vendor/modules.txt` is GO_VENDOR_MANIFEST.
 */
export const DEP_MANIFESTS = Object.freeze([
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
  'Pipfile',
  'pubspec.yaml',
  'mix.exs',
  'Podfile',
  'flake.nix',
]);

const MANIFEST_SET = new Set(DEP_MANIFESTS);

/** pip requirement files: "requirements.txt", "requirements-dev.txt", "requirements_test.txt" (case-sensitive). */
const DEP_REQUIREMENTS = /^requirements[^/]*\.txt$/;

/** Go's vendoring manifest: `modules.txt` directly in a `vendor` folder (`go mod vendor`), at any depth (case-sensitive). */
const GO_VENDOR_MANIFEST = 'vendor/modules.txt';

/** The non-enumerable key computeDepBumps keeps the exact (unrounded) share under. */
const EXACT = Symbol('depBumps.exactShare');

/**
 * Whether `path` (relative to its repo's root, "/"-separated) is a lockfile or a dependency
 * manifest, by its basename only, at any depth ("packages/web/package.json" counts):
 * - a lockfile (the list isIgnoredPath skips: package-lock.json, yarn.lock, pnpm-lock.yaml,
 *   Cargo.lock, go.sum, poetry.lock, uv.lock, ...);
 * - package.json, go.mod, Cargo.toml, pyproject.toml, Gemfile, composer.json, Pipfile,
 *   pubspec.yaml, mix.exs, Podfile, flake.nix (DEP_MANIFESTS);
 * - requirements*.txt (requirements.txt, requirements-dev.txt, ...);
 * - Go's vendor/modules.txt (by its last two path parts: "vendor/modules.txt" or
 *   "svc/vendor/modules.txt", not a bare "modules.txt").
 * Exact and case-sensitive, as the lockfiles are matched ("Package.json", "gemfile" and
 * "Requirements.txt" do not count). False for a non-string or empty path; never throws.
 */
export function isDepPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (isLockfileName(base) || MANIFEST_SET.has(base) || DEP_REQUIREMENTS.test(base)) return true;
  return path === GO_VENDOR_MANIFEST || path.endsWith(`/${GO_VENDOR_MANIFEST}`);
}

/**
 * Whether commit `c` (not checked for being a merge) is a dependency bump: it touched at
 * least one file, every one of them a lockfile or dependency manifest (see isDepPath, on
 * the repo-relative path, see repoRelativePath). Non-objects → false; never throws.
 */
export function isDepBumpCommit(c) {
  if (!c || typeof c !== 'object') return false;
  const files = Array.isArray(c.files) ? c.files : [];
  return files.length > 0 && files.every((f) => f && typeof f === 'object' && isDepPath(repoRelativePath(c, f.path)));
}

/**
 * stats.depBumps (shape from src/git.js readCommits): `{commits, share}`, or null when
 * there is no non-merge commit (nothing to take a share of; as stats.tests and
 * stats.docShare are null without a changed line). `{commits: 0, share: 0}` when there are
 * non-merge commits but none is a dependency bump.
 * - A dependency bump is a non-merge commit (see isMergeCommit) that touched at least one
 *   file, every one of them a lockfile or dependency manifest (see isDepPath, on the path
 *   relative to each repo's root in a multi-repo run, see repoRelativePath). Line counts
 *   do not matter (a binary bun.lockb counts). A commit without files (an empty commit, or
 *   one whose every file --exclude dropped) is not one; files --exclude dropped are not
 *   looked at, so excluding a lockfile also leaves its bumps out.
 * - commits: how many dependency bumps;
 * - share: commits / every non-merge commit (also those without files), 3 decimals, at most
 *   0.999 short of every commit (as stats.cleanups); the exact ratio rides along
 *   non-enumerably for shownDepBumps, so stats.json keeps exactly `{commits, share}`.
 * Invalid input policy: never throws, never mutates; non-object commits are skipped, files
 * without a string path make a commit not a bump. Empty input → null.
 */
export function computeDepBumps(commits) {
  let total = 0;
  let bumps = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    if (isDepBumpCommit(c)) bumps += 1;
  }
  if (total === 0) return null;
  const share = Math.min(Math.round((bumps / total) * 1000) / 1000, bumps < total ? 0.999 : 1);
  return Object.defineProperty({ commits: bumps, share }, EXACT, { value: bumps / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.depBumps as the cards, the recap and wrapped.md show it: `{commits, pct}`, or null
 * (no object, or no dependency bump, so nothing is shown for `{commits: 0}`).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeDepBumps keeps (so a 3-decimal share is not rounded twice), else from
 *   `share`; below 100 unless the share is exactly 1 (as shownCleanups).
 * All outputs use this, so they agree.
 */
export function shownDepBumps(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return { commits, pct: (ratio === 1 ? 1 : Math.min(raw, 0.999)) * 100 };
}
