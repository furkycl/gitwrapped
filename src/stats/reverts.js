import { isMergeCommit } from './messages.js';
import { stripLeadingEmoji } from './types.js';

/**
 * A subject git writes for a revert: `Revert "<subject>"` (a revert of a revert is
 * `Revert "Revert "…""`, still one revert). Case-sensitive, as git always writes it
 * ("revert \"x\" handling" is not a revert), with a straight or curly quote.
 */
const REVERT_SUBJECT = /^\s*Revert ["“]/;

/**
 * A Conventional Commits revert: the type `revert`, an optional "(scope)", an optional
 * "!", then ":" and a space followed by a description (`revert: drop the cache`,
 * `Revert(api)!: undo v2`; the type is case-insensitive, and emoji in front of it are
 * skipped, `⏪ revert: x` / `:rewind: revert: x`, as in stats/types.js).
 */
const CONVENTIONAL_REVERT = /^\s*revert(?:\([^()]*\))?!?:\s+\S/i;

/** Whether `subject` is a revert's subject (see REVERT_SUBJECT and CONVENTIONAL_REVERT). */
export const isRevertSubject = (subject) => typeof subject === 'string' && (REVERT_SUBJECT.test(subject) || CONVENTIONAL_REVERT.test(stripLeadingEmoji(subject)));

/**
 * How many distinct commits `hashes` (lowercase hex, full or abbreviated) name: a hash
 * that is a prefix of another one in the list (an abbreviated hash next to the full one,
 * or a shorter abbreviation of it) names the same commit, so it is not counted again.
 */
function distinctCommits(hashes) {
  const kept = [];
  for (const h of [...new Set(hashes)].sort((a, b) => b.length - a.length)) {
    if (!kept.some((k) => k.startsWith(h))) kept.push(h);
  }
  return kept.length;
}

/** The hashes a commit's message says it reverts (`revertOf`, set by readReverts in src/git.js), valid ones only. */
const targetsOf = (c) => (Array.isArray(c?.revertOf) ? c.revertOf.filter((h) => typeof h === 'string' && /^[0-9a-f]{7,64}$/i.test(h)).map((h) => h.toLowerCase()) : []);

/**
 * Whether commit `c` reverts another: its subject is `Revert "…"` or a conventional
 * `revert: …` / `revert(scope): …` (see isRevertSubject)
 * or its message has a "This reverts commit <hash>" line (`revertOf`, see readReverts in
 * src/git.js; a "Reapply" of a reverted commit has one too). Merge commits are not
 * checked here; computeReverts skips them.
 */
export const isRevertCommit = (c) => Boolean(c && typeof c === 'object') && (isRevertSubject(c.subject) || targetsOf(c).length > 0);

/**
 * Reverts over the non-merge commits (see isMergeCommit; the commits the other message
 * stats count). Returns `{total, count, share, reverted}`:
 * - total: non-merge commits; count: how many of them revert another (see isRevertCommit;
 *   each commit counts once, so `Revert "Revert "x""` is one revert);
 * - share: count / total, rounded to 3 decimals (0 without commits);
 * - reverted: how many distinct commits the counted reverts name in a "This reverts
 *   commit <hash>" line (an abbreviated hash and the full one, or two abbreviations where
 *   one is a prefix of the other, are one commit, see distinctCommits; 0 when only subjects say so).
 * Invalid input policy: never throws; non-object entries are skipped. Empty input → zeros.
 */
export function computeReverts(commits) {
  let total = 0;
  let count = 0;
  const targets = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    if (!isRevertCommit(c)) continue;
    count += 1;
    targets.push(...targetsOf(c));
  }
  return {
    total,
    count,
    share: total > 0 ? Math.round((count / total) * 1000) / 1000 : 0,
    reverted: distinctCommits(targets),
  };
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The reverts the messages card, the Fixaholic reason, the recap and wrapped.md show for
 * `stats.reverts`: `{count, total, pct}` (total at least count; pct = count / total as a
 * percent, unrounded, for shareLabel in stats/contributors.js), or null when there is no
 * object or no revert. All outputs use this, so they agree.
 */
export function shownReverts(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const count = shownCount(stat.count);
  if (count === 0) return null;
  const total = Math.max(count, shownCount(stat.total));
  return { count, total, pct: (count / total) * 100 };
}
