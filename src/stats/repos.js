// Per-repo breakdown of a multi-repo run (`gitwrapped repoA repoB ...`). Pure function
// over merged history (see mergeHistories in src/git.js: every commit has `repo`).

/** A line count as a non-negative finite number; anything else → 0 (as in totals.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** A percent with one decimal: 1 of 3 → 33.3. */
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * One row per repo label in `names` (every repo of the run, also one without commits in
 * the window): `{name, commits, linesAdded, linesRemoved, filesTouched, share}`, counted
 * like totals.js (merges count as commits, every file counts, a missing line count adds
 * 0; filesTouched is distinct paths). `share` is the percent of all `commits` with one
 * decimal. Commits whose `repo` is not in `names` are left out of every row (but still
 * count toward the share's whole). Sorted by commits desc, then lines changed (added +
 * removed) desc, then the order of `names`. Empty `names` → [].
 */
export function computeRepos(commits, names = []) {
  const rows = new Map();
  (names ?? []).forEach((name, i) => {
    if (typeof name === 'string' && !rows.has(name)) rows.set(name, { i, name, commits: 0, linesAdded: 0, linesRemoved: 0, paths: new Set() });
  });
  let all = 0;
  for (const c of commits ?? []) {
    if (!c) continue;
    all += 1;
    const r = rows.get(c.repo);
    if (!r) continue;
    r.commits += 1;
    r.linesAdded += count(c.linesAdded);
    r.linesRemoved += count(c.linesRemoved);
    for (const f of c.files ?? []) if (f && typeof f.path === 'string') r.paths.add(f.path);
  }
  return [...rows.values()]
    .sort((a, b) => b.commits - a.commits || (b.linesAdded + b.linesRemoved) - (a.linesAdded + a.linesRemoved) || a.i - b.i)
    .map((r) => ({ name: r.name, commits: r.commits, linesAdded: r.linesAdded, linesRemoved: r.linesRemoved, filesTouched: r.paths.size, share: percent(r.commits, all) }));
}
