// Bot commits: non-merge commits whose author is a bot (dependabot, renovate, GitHub
// Actions, any "...[bot]" GitHub App). Read from each commit's author name and email as
// readCommits returns them (src/git.js reads %aN / %aE, so .mailmap is already applied: a
// bot mapped onto a person in .mailmap no longer counts, and a person mapped onto a bot
// identity does).
import { contributorName } from './contributors.js';
import { isMergeCommit } from './messages.js';
import { scrubEmails } from '../privacy.js';

/** The non-enumerable key computeBots keeps the exact (unrounded) share under. */
const EXACT = Symbol('bots.exactShare');

/**
 * Well-known bot names, matched at the start of the author name (case-insensitive) and
 * ending there as a word: a letter or digit right after breaks the match. So
 * "dependabot-preview", "renovate-bot", "Renovate Bot", "renovate.bot", "github-actions"
 * and "GitHub Actions" (a space or an underscore for the hyphen too) are bots, while
 * "Renovated", "Dependabotics", "githubactions", "Ada Renovate", "Ada (dependabot fan)" or
 * "my-renovate-bot" are not (the last one would be with a "[bot]" suffix).
 */
const BOT_NAME = /^(?:dependabot|renovate|github[-_ ]actions)(?![\p{L}\p{N}])/iu;

/** A "[bot]" suffix (case-insensitive), as GitHub Apps' accounts carry. */
const BOT_SUFFIX = /\[bot\]$/i;

/** Control and format characters (NUL, zero-width spaces, soft hyphens, ...). */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/** `s` with control / format characters removed, trimmed; '' for anything but a string. */
const clean = (s) => (typeof s === 'string' ? s.replace(INVISIBLE, '').trim() : '');

/**
 * Whether an author (`name`, `email`, as on a commit after .mailmap) is a bot. Control and
 * format characters are removed from both first, then: the trimmed name ends with "[bot]",
 * or the email does (whole, or its part before the last "@", as in
 * "49699333+dependabot[bot]@users.noreply.github.com"), or the name starts with
 * "dependabot", "renovate" or "github-actions" as a word (see BOT_NAME). Case-insensitive.
 * Non-strings count as empty; never throws.
 */
export function isBotAuthor(name, email) {
  const n = clean(name);
  const e = clean(email);
  if (BOT_SUFFIX.test(n) || BOT_NAME.test(n)) return true;
  if (!e) return false;
  if (BOT_SUFFIX.test(e)) return true;
  const at = e.lastIndexOf('@');
  return at > 0 && BOT_SUFFIX.test(e.slice(0, at).trim());
}

/**
 * A bot's name as shown: control / format characters turned into spaces, the author name
 * through contributorName (an address used as a name cut to its local part), any
 * email-like text cut (see scrubEmails), whitespace runs collapsed, trimmed; '' when
 * nothing is left (an unnamed bot).
 */
const botName = (name) => {
  const n = typeof name === 'string' ? name.replace(INVISIBLE, ' ') : '';
  return scrubEmails(contributorName(n) ?? '').replace(/\s+/g, ' ').trim();
};

/** Code-unit order of two strings (-1, 0, 1). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * stats.bots (shape from src/git.js readCommits): `{commits, share, top}`, or null when
 * there is no non-merge commit (nothing to take a share of; as stats.rewritten).
 * - commits: how many non-merge commits (see isMergeCommit) have a bot author (see
 *   isBotAuthor), unnamed bots included;
 * - share: commits / every non-merge commit, 3 decimals, at most 0.999 short of every
 *   commit (as stats.rewritten); the exact ratio rides along non-enumerably for
 *   shownBots, so stats.json keeps exactly `{commits, share, top}`;
 * - top: the busiest named bot as `{name, commits}`: bots are grouped by shown name (see
 *   botName) ignoring letter case, and a group is named by its most frequent spelling
 *   (ties → code-unit order); most commits first, ties → the name first in code-unit
 *   order. A bot without a name (nothing left of it, see botName) counts in `commits`
 *   but is never `top`; null when no bot commit has a name. No email is ever returned.
 * Invalid input policy: never throws, never mutates; non-object commits are skipped.
 * Empty input → null.
 */
export function computeBots(commits) {
  let total = 0;
  let bots = 0;
  // Lowercased name → {commits, spellings: Map(spelling → commits)}.
  const groups = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    if (!isBotAuthor(c.author, c.email)) continue;
    bots += 1;
    const name = botName(c.author);
    if (!name) continue;
    const key = name.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { commits: 0, spellings: new Map() };
      groups.set(key, g);
    }
    g.commits += 1;
    g.spellings.set(name, (g.spellings.get(name) ?? 0) + 1);
  }
  if (total === 0) return null;
  let top = null;
  for (const g of groups.values()) {
    let name = null;
    let best = 0;
    for (const [spelling, n] of g.spellings) {
      if (n > best || (n === best && byCodeUnits(spelling, name) < 0)) {
        name = spelling;
        best = n;
      }
    }
    const better = !top || g.commits > top.commits || (g.commits === top.commits && byCodeUnits(name, top.name) < 0);
    if (better) top = { name, commits: g.commits };
  }
  const share = Math.min(Math.round((bots / total) * 1000) / 1000, bots < total ? 0.999 : 1);
  return Object.defineProperty({ commits: bots, share, top }, EXACT, { value: bots / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.bots as the cards, the recap and wrapped.md show it: `{commits, pct, top}`, or
 * null (no object, or no bot commit, so nothing is shown for `{commits: 0}`).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeBots keeps (so a 3-decimal share is not rounded twice), else from
 *   `share`; below 100 unless the share is exactly 1 (as shownRewritten);
 * - top: `{name, commits}` (name scrubbed again, see botName; commits a positive whole
 *   number, at most `commits`), or null when missing, malformed, unnamed or "Unknown"
 *   (an older placeholder for an unnamed bot).
 * All outputs use this, so they agree.
 */
export function shownBots(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const t = stat.top && typeof stat.top === 'object' ? stat.top : null;
  const topName = t && typeof t.name === 'string' ? botName(t.name) : '';
  const topCommits = t ? Math.min(shownCount(t.commits), commits) : 0;
  const top = topName && topName !== 'Unknown' && topCommits > 0 ? { name: topName, commits: topCommits } : null;
  return { commits, pct: (ratio === 1 ? 1 : Math.min(raw, 0.999)) * 100, top };
}
