// Who made the commits: contributors ranked by commits, for the team card.
// Pure function over readCommits() output. Names only: no email ever leaves this module.

/** How many contributors `top` lists. */
export const TOP_CONTRIBUTORS = 5;

/** A line count as a non-negative finite number; anything else → 0 (as in totals.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** A percent with one decimal: 1 of 3 → 33.3. */
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * A contributor's `share` (a percent, maybe with a decimal) as a whole percent for
 * display: "<1%" for a contributor with commits whose share rounds to 0, and never "100%"
 * short of everything (99.6 → "99%"). Used by the card and the terminal recap.
 * `pct` writes a whole percent (default "74%"; Turkish passes "%74"), "<1%" being
 * `<${pct(1)}`.
 */
export function shareLabel(share, commits, pct = (r) => `${r}%`) {
  const v = typeof share === 'number' && Number.isFinite(share) && share > 0 ? share : 0;
  const r = Math.round(v);
  if (r === 0 && (v > 0 || (typeof commits === 'number' && commits > 0))) return `<${pct(1)}`;
  return pct(r === 100 && v < 100 ? 99 : r);
}

/**
 * Whether the contributors card (and the recap's Team line) is shown for `stats`
 * (computeStats() output): at least two contributors in the history it ranks (the
 * unfiltered one with --author), and with --author (`authorFilter`) that author must be
 * one of them: an --author that matches nobody gets no team card.
 */
export function hasTeamCard(stats) {
  const c = stats?.contributors;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!(n(c?.total) >= 2)) return false;
  return c.authorFilter !== true || n(c.you?.commits) > 0;
}

/**
 * A git author name as it may be shown or exported: trimmed, and never an email address.
 * A name that is really an address ("ada@example.com", or "Ada <ada@example.com>" typed
 * as the name) keeps only the part before the "<" / "@", like authorName() on the cards.
 * Empty → null.
 */
export function contributorName(name) {
  let n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  const lt = n.indexOf('<');
  if (lt > 0) n = n.slice(0, lt).trim();
  else if (lt === 0) n = n.slice(1).replace(/>.*$/s, '').trim();
  const at = n.indexOf('@');
  if (at >= 0) n = n.slice(0, at).trim();
  return n || null;
}

/**
 * Contributors of `commits` (shape from src/git.js readCommits; names and emails are
 * already mailmapped there, %aN / %aE). Returns `{total, top, you}`:
 * - One contributor per identity: the email, lowercased (the same key totals.authors
 *   counts); a commit with an empty email is keyed by its name instead (case and
 *   runs of whitespace ignored). `total` is the
 *   number of identities (so it equals totals.authors unless some commits have no email).
 * - `name`: the identity's most frequent (mailmapped) name, ties → the alphabetically
 *   first; passed through contributorName(), so an address used as a name is cut to its
 *   local part. "Unknown" when there is no name at all.
 * - `commits` counts every commit, merges included, and `added` / `removed` are the
 *   commits' line counts with nothing left out: both exactly as in totals.js, so the
 *   contributors' commits and lines add up to the totals of the same history.
 * - `share`: percent of all commits, one decimal (31.25 → 31.3).
 * - `top`: the first TOP_CONTRIBUTORS, sorted by commits desc, then lines changed
 *   (added + removed) desc, then name, then identity (deterministic). `rank` is the
 *   1-based position in that order.
 * - `you`: with `author` (an --author email), the contributor whose email matches it
 *   exactly, case-insensitively (the same match as the git filter), as
 *   `{name, rank, commits, added, removed, share}`; null without `author` or when nobody
 *   matches.
 * - `authorFilter`: true when an --author was given (non-empty). Then a null `you` means
 *   that email has no commits here, and the contributors card is skipped.
 * - `truncated`: the given `truncated` flag (the read behind `commits` hit the
 *   --max-commits cap), as a boolean.
 * No email is ever returned. Empty input → `{total: 0, top: [], you: null,
 * authorFilter: false, truncated: false}`.
 */
export function computeContributors(commits, { author, truncated = false } = {}) {
  const byKey = new Map();
  let all = 0;
  for (const c of commits ?? []) {
    if (!c) continue;
    all += 1;
    const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
    const rawName = typeof c.author === 'string' ? c.author.replace(/\s+/g, ' ').trim() : '';
    // A NUL prefix keeps name keys apart from email keys.
    const key = email || `\0${rawName.toLowerCase()}`;
    let e = byKey.get(key);
    if (!e) {
      e = { key, email, names: new Map(), commits: 0, added: 0, removed: 0 };
      byKey.set(key, e);
    }
    e.commits += 1;
    e.added += count(c.linesAdded);
    e.removed += count(c.linesRemoved);
    const name = contributorName(rawName);
    if (name) e.names.set(name, (e.names.get(name) ?? 0) + 1);
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
    return { key: e.key, email: e.email, name: name ?? 'Unknown', commits: e.commits, added: e.added, removed: e.removed };
  });
  people.sort((a, b) => b.commits - a.commits
    || (b.added + b.removed) - (a.added + a.removed)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const row = (p, i) => ({ name: p.name, rank: i + 1, commits: p.commits, added: p.added, removed: p.removed, share: percent(p.commits, all) });
  const want = typeof author === 'string' ? author.trim().toLowerCase() : '';
  const at = want ? people.findIndex((p) => p.email !== '' && p.email === want) : -1;
  return {
    total: people.length,
    top: people.slice(0, TOP_CONTRIBUTORS).map(row),
    you: at >= 0 ? row(people[at], at) : null,
    authorFilter: want !== '',
    truncated: Boolean(truncated),
  };
}
