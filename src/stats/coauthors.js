// Pairing: commits with `Co-authored-by:` trailers, and who the co-authors are.
// Pure function over readCommits() output. Names only: no email ever leaves this module.
import { contributorName, TOP_CONTRIBUTORS } from './contributors.js';
import { isMergeCommit } from './messages.js';

/** How many co-authors `top` lists (as many as the team card's top contributors). */
export const TOP_CO_AUTHORS = TOP_CONTRIBUTORS;

/** A percent with one decimal: 1 of 3 → 33.3 (as contributors' share). */
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Whitespace runs collapsed, trimmed; '' for anything but a string. */
const flat = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/**
 * An identity key: the email, lowercased; without an email the name instead (case and
 * whitespace runs ignored, after a NUL so it never equals an email), as in
 * computeContributors. '' when there is neither.
 */
const identity = (name, email) => {
  const e = flat(email).toLowerCase();
  if (e) return e;
  const n = flat(name).toLowerCase();
  return n ? `\0${n}` : '';
};

/**
 * Who paired on the commits (shape from src/git.js readCommits: each commit's
 * `coAuthors`, its Co-authored-by trailers, already mailmapped there). Returns
 * `{paired, commits, share, total, top}`:
 * - Merge commits (see isMergeCommit) are skipped; `commits` is the number of the others.
 * - A co-author is one identity, keyed like a contributor: the email, lowercased, or the
 *   name when there is no email. A co-author with the commit's own author's identity, and
 *   the same co-author listed twice on one commit, count once / not at all, so `paired`
 *   is the number of commits with at least one co-author other than their author.
 * - `share`: `paired` as a percent of `commits`, one decimal (0 when there are none).
 * - `total`: the number of distinct co-authors.
 * - `top`: the first TOP_CO_AUTHORS co-authors as `{name, commits}` (commits: how many
 *   paired commits list them), sorted by commits desc, then name, then identity
 *   (deterministic). `name` is the identity's most frequent name, ties → the
 *   alphabetically first, passed through contributorName() (an address used as a name is
 *   cut to its local part); "Unknown" when there is none.
 * Bots (e.g. "Claude <noreply@anthropic.com>") count like anyone else. No email is ever
 * returned. Never throws; non-object commits and malformed co-authors are skipped. Empty
 * input → `{paired: 0, commits: 0, share: 0, total: 0, top: []}`.
 */
export function computeCoAuthors(commits) {
  const byKey = new Map();
  let paired = 0;
  let all = 0;
  for (const c of commits ?? []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    all += 1;
    const own = identity(c.author, c.email);
    const seen = new Set();
    for (const p of Array.isArray(c.coAuthors) ? c.coAuthors : []) {
      if (!p || typeof p !== 'object') continue;
      const key = identity(p.name, p.email);
      if (!key || key === own || seen.has(key)) continue;
      seen.add(key);
      let e = byKey.get(key);
      if (!e) {
        e = { key, names: new Map(), commits: 0 };
        byKey.set(key, e);
      }
      e.commits += 1;
      const name = contributorName(p.name);
      if (name) e.names.set(name, (e.names.get(name) ?? 0) + 1);
    }
    if (seen.size > 0) paired += 1;
  }
  const people = [...byKey.values()].map((e) => {
    let name = null;
    let best = 0;
    for (const [n, k] of e.names) {
      if (k > best || (k === best && n < name)) {
        name = n;
        best = k;
      }
    }
    return { key: e.key, name: name ?? 'Unknown', commits: e.commits };
  });
  people.sort((a, b) => b.commits - a.commits
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    paired,
    commits: all,
    share: percent(paired, all),
    total: people.length,
    top: people.slice(0, TOP_CO_AUTHORS).map(({ name, commits: n }) => ({ name, commits: n })),
  };
}

/**
 * The pairing as shown on the cards, the recap and wrapped.md: `{paired, share, top}`
 * (top: the first co-author's name, or null) when at least one commit was paired, else
 * null. Tolerates any shape (stats.json written by hand, older stats).
 */
export function shownCoAuthors(co) {
  const paired = typeof co?.paired === 'number' && Number.isFinite(co.paired) ? Math.floor(co.paired) : 0;
  if (paired <= 0) return null;
  const first = Array.isArray(co.top) ? co.top[0] : null;
  const share = typeof co.share === 'number' && Number.isFinite(co.share) && co.share > 0 ? co.share : 0;
  return { paired, share, top: contributorName(first?.name) };
}
