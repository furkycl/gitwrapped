// Who made the commits: contributors ranked by commits, for the team card.
// Pure function over readCommits() output. Names only: no email ever leaves this module.
import { isIgnoredPath, repoRelativePath } from './files.js';
import { weekendPercent } from './weekend.js';

/** How many contributors `top` lists. */
export const TOP_CONTRIBUTORS = 5;

/** A line count as a non-negative finite number; anything else → 0 (as in totals.js). */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** The non-enumerable key computeBusFactor keeps the exact (unrounded) share under (see shownBusFactor). */
const EXACT = Symbol('busFactor.exactShare');

/**
 * The identity a commit counts under: its email, lowercased (the same key totals.authors
 * counts), or, for a commit with an empty email, its name (case and runs of whitespace
 * ignored) behind a NUL prefix that keeps name keys apart from email keys. Names and
 * emails are already mailmapped by src/git.js.
 */
function identityKey(c) {
  const email = typeof c?.email === 'string' ? c.email.trim().toLowerCase() : '';
  const rawName = typeof c?.author === 'string' ? c.author.replace(/\s+/g, ' ').trim() : '';
  return email || `\0${rawName.toLowerCase()}`;
}

/**
 * The bus factor of `commits` (shape from src/git.js readCommits): the smallest number of
 * authors who together made at least half of the lines changed, as `{authors, share}`, or
 * null when there are fewer than two identities (no team) or no counted line changed.
 * - Identities are exactly the contributors' (see identityKey; after .mailmap).
 * - Lines changed are each commit's lines added + deleted in the files the hot files count:
 *   ignored paths (lockfiles, build output, vendored code, see isIgnoredPath, checked
 *   relative to each repo's root in a multi-repo run, see repoRelativePath) are left out,
 *   and --exclude has already dropped its files; merges add nothing (git gives them no
 *   files), binary files add 0 lines.
 * - Authors are taken by counted lines, most first; `authors` is the smallest k whose k
 *   largest totals add up to at least half of all counted lines (exact integer comparison:
 *   2 × theirs ≥ all). Ties cannot change k (only the sorted totals matter).
 * - `share`: those k authors' lines / all counted lines (0.5..1, 3 decimals, at most 0.999
 *   short of every line, as stats.tests rounds its share).
 * Invalid input policy: never throws, never mutates; non-object commits / files and files
 * without a string path are skipped, a missing or non-finite line count adds 0.
 */
export function computeBusFactor(commits) {
  const byKey = new Map();
  let all = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const key = identityKey(c);
    let lines = 0;
    for (const f of Array.isArray(c.files) ? c.files : []) {
      if (!f || typeof f !== 'object' || typeof f.path !== 'string') continue;
      if (isIgnoredPath(repoRelativePath(c, f.path))) continue;
      lines += count(f.added) + count(f.removed);
    }
    byKey.set(key, (byKey.get(key) ?? 0) + lines);
    all += lines;
  }
  if (byKey.size < 2 || all === 0) return null;
  const totals = [...byKey.values()].sort((a, b) => b - a);
  let k = 0;
  let cum = 0;
  while (k < totals.length && 2 * cum < all) cum += totals[k++];
  const share = Math.min(Math.round((cum / all) * 1000) / 1000, cum < all ? 0.999 : 1);
  // The exact ratio, for shownBusFactor only: non-enumerable, so stats.json keeps exactly
  // `{authors, share}`.
  return Object.defineProperty({ authors: k, share }, EXACT, { value: cum / all });
}

/**
 * stats.contributors.busFactor as the team card, the recap and wrapped.md show it:
 * `{authors, percent}` (a whole percent of the lines changed, never 100 short of every
 * line, rounded once from the exact ratio computeBusFactor keeps, else from `share`), or
 * null for a missing or malformed value.
 */
export function shownBusFactor(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const authors = Number.isSafeInteger(stat.authors) && stat.authors > 0 ? stat.authors : 0;
  if (authors === 0) return null;
  const exact = stat[EXACT];
  const share = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof share === 'number' && Number.isFinite(share) ? Math.min(Math.max(share, 0), 1) : 0;
  return { authors, percent: weekendPercent(share === 1 ? 1 : Math.min(raw, 0.999)) };
}

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
 *   that email has no commits in `commits` (none in the window, or none among a capped
 *   team read's commits), and the contributors card is skipped.
 * - `truncated`: the given `truncated` flag (the read behind `commits` hit the
 *   --max-commits cap), as a boolean.
 * - `busFactor`: the smallest number of authors who made at least half of the lines
 *   changed in the same commits, `{authors, share}`, or null (see computeBusFactor).
 * No email is ever returned. Empty input → `{total: 0, top: [], you: null,
 * authorFilter: false, truncated: false, busFactor: null}`.
 */
export function computeContributors(commits, { author, truncated = false } = {}) {
  const byKey = new Map();
  let all = 0;
  for (const c of commits ?? []) {
    if (!c) continue;
    all += 1;
    const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
    const rawName = typeof c.author === 'string' ? c.author.replace(/\s+/g, ' ').trim() : '';
    const key = identityKey(c);
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
    busFactor: computeBusFactor(commits),
  };
}
