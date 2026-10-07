// Releases: the tagged commits among the analyzed ones. Pure function over readCommits()
// output (each tagged commit's `tags`, see readTags and mergeHistories in src/git.js).
// No git calls.
import { scrubEmails } from '../privacy.js';
import { localParts } from './time.js';

/** A tag name as shown: control / format characters dropped, emails cut (see scrubEmails), trimmed; '' when none. */
const tagName = (t) => (typeof t === 'string' ? scrubEmails(t.replace(/[\p{Cc}\p{Cf}]/gu, '')).trim() : '');

/** Plain code-unit order: -1 / 0 / 1 (the deterministic last tie-break). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Numeric-aware order ("v1.9.0" < "v1.10.0"), then code units, so it is total and stable. */
export const compareTagNames = (a, b) => a.localeCompare(b, 'en', { numeric: true }) || byCodeUnit(a, b);

/**
 * How specific a tag name is as a version: `[hasVersion, parts, final]`, compared
 * element by element (more is better): a name with a version number ("v1.2.3") beats an
 * alias without one ("latest", "stable"); more dotted number parts beat fewer ("v1.2.3"
 * over the floating "v1.2" and "v1"); a plain version beats one with a suffix ("v1.2.3"
 * over "v1.2.3-rc.1" on the same commit).
 */
function specificity(name) {
  const m = /^\D*?(\d+(?:\.\d+)*)(.*)$/su.exec(name);
  return m ? [1, m[1].split('.').length, m[2] === '' ? 1 : 0] : [0, 0, 0];
}

/**
 * The tag that names a commit with several: the most specific (see specificity), then
 * the highest by compareTagNames ("v1.10.0" over "v1.9.0"); the same name twice (a shared
 * commit tagged alike in two repos) → the first, the kept copy's own. Entries are
 * `{name, repo}`.
 */
function bestTag(entries) {
  let best = null;
  let bestKey = null;
  for (const e of entries) {
    const key = specificity(e.name);
    const d = best ? key.findIndex((k, i) => k !== bestKey[i]) : -1;
    const better = !best
      || (d >= 0 ? key[d] > bestKey[d] : compareTagNames(e.name, best.name) > 0);
    if (better) {
      best = e;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The releases shipped in the window (shape from src/git.js readCommits: a tagged commit
 * carries `tags`, the names of the tags pointing at it, lightweight or annotated, peeled
 * to the commit; after mergeHistories a tag may also be `{name, repo}`, from a copy of the
 * commit in another repo). Returns `{count, tags, first, latest}`:
 * - count: the number of tagged commits: one release per commit, however many tags point
 *   at it (floating "v1" / "v1.2" next to "v1.2.3", aliases such as "latest", a tag on a
 *   tag); merge commits count too (a release is often tagged on one);
 * - tags: the number of distinct tags on those commits (with several repos, a shared
 *   commit tagged alike in both counts each repo's tag);
 * - first / latest: the earliest / most recent of those commits as `{name, date}` (plus
 *   `repo` in a multi-repo run), or null when there are none:
 *   - name: the commit's most specific tag (see bestTag), with anything shaped like an
 *     email address replaced by "…" (see scrubEmails); in a multi-repo run prefixed with
 *     its repo label ("api/v1.2.0"), as file paths are;
 *   - date: the author-local day 'YYYY-MM-DD' of the tagged commit (null when the date is
 *     unparseable), as everywhere in stats;
 *   - repo: present only when the tag carries a repo label (mergeHistories in
 *     src/git.js), so single-repo stats are unchanged.
 * Commits are ordered by author instant (undated ones last), then by name (numeric-aware,
 * see compareTagNames), so first and latest are deterministic.
 * Invalid input policy: never throws, never mutates; non-object commits and
 * non-string / empty tag names are skipped. Empty input →
 * `{count: 0, tags: 0, first: null, latest: null}`.
 */
export function computeReleases(commits) {
  const all = [];
  let tags = 0;
  for (const c of commits ?? []) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.tags)) continue;
    const own = typeof c.repo === 'string' && c.repo.trim() ? c.repo : null;
    const seen = new Set();
    const entries = [];
    for (const raw of c.tags) {
      const obj = raw && typeof raw === 'object';
      const name = tagName(obj ? raw.name : raw);
      const repo = obj ? (typeof raw.repo === 'string' && raw.repo.trim() ? raw.repo : null) : own;
      const key = `${repo ?? ''}\0${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, repo });
    }
    if (entries.length === 0) continue;
    tags += entries.length;
    const best = bestTag(entries);
    const t = localParts(c.date);
    all.push({ name: best.repo ? `${best.repo}/${best.name}` : best.name, date: t ? t.dayKey : null, ms: t ? t.ms : Infinity, repo: best.repo });
  }
  if (all.length === 0) return { count: 0, tags: 0, first: null, latest: null };
  all.sort((a, b) => (a.ms === b.ms ? compareTagNames(a.name, b.name) : a.ms < b.ms ? -1 : 1));
  // The latest is the most recent dated release (an undated one only when none is dated).
  const dated = all.filter((r) => r.ms !== Infinity);
  const shown = ({ name, date, repo }) => (repo ? { name, date, repo } : { name, date });
  return { count: all.length, tags, first: shown(all[0]), latest: shown((dated.length ? dated : all).at(-1)) };
}

/**
 * The releases as shown on the outro card, the recap and wrapped.md: `{count, latest}`
 * (latest: `{name, date}` or null) when at least one release was found, else null.
 * Tolerates any shape (stats.json written by hand, older stats).
 */
export function shownReleases(r) {
  const count = typeof r?.count === 'number' && Number.isFinite(r.count) ? Math.floor(r.count) : 0;
  if (count <= 0) return null;
  const l = r.latest && typeof r.latest === 'object' ? r.latest : null;
  const name = l ? tagName(l.name) : '';
  return { count, latest: name ? { name, date: typeof l.date === 'string' ? l.date : null } : null };
}
