import { isMergeCommit } from './messages.js';
import { sizeShares } from './sizes.js';

/**
 * The conventional-commit type buckets, in display order (ties are broken in this order):
 * feat, fix, docs, refactor, test, chore, and other (a known conventional type that is
 * none of the six: perf, ci, build, style, revert, release, deps).
 */
export const COMMIT_TYPE_IDS = Object.freeze(['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'other']);

/**
 * The share of commits (conventional / counted) from which the cards, the recap and
 * wrapped.md show the type mix: below it the repo does not really use the convention, and
 * a "feat 100%" from three stray subjects would say nothing.
 */
export const COMMIT_TYPES_MIN_SHARE = 0.2;

/**
 * Which bucket each recognized type word (lowercased) goes to. Only these words count as
 * conventional, so subjects like "Update: readme", "Note: ..." or "WIP: ..." do not.
 * Aliases: feature / features → feat; bugfix / hotfix → fix; doc → docs; tests → test.
 */
const TYPE_BUCKET = new Map([
  ['feat', 'feat'], ['feature', 'feat'], ['features', 'feat'],
  ['fix', 'fix'], ['bugfix', 'fix'], ['hotfix', 'fix'],
  ['docs', 'docs'], ['doc', 'docs'],
  ['refactor', 'refactor'],
  ['test', 'test'], ['tests', 'test'],
  ['chore', 'chore'],
  ['perf', 'other'], ['ci', 'other'], ['build', 'other'], ['style', 'other'],
  ['revert', 'other'], ['release', 'other'], ['deps', 'other'],
]);

/** `type(scope)!: description`: a word, an optional scope, an optional "!", a colon and a space. */
const CONVENTIONAL = /^([a-z]+)(?:\([^()]*\))?!?:\s+\S/i;

/**
 * The conventional-commit bucket of a subject line ('feat', 'fix', 'docs', 'refactor',
 * 'test', 'chore' or 'other'), or null when it does not follow the convention: the
 * (trimmed) subject has to start with a known type word (see TYPE_BUCKET, compared
 * case-insensitively), an optional "(scope)", an optional "!" (breaking change), then ":"
 * and a space followed by a description. "feat(ui)!: dark mode" → 'feat',
 * "PERF: faster" → 'other', "Fix typo" → null, "feat:" → null.
 */
export function commitTypeOf(subject) {
  if (typeof subject !== 'string') return null;
  const m = CONVENTIONAL.exec(subject.trim());
  return m ? (TYPE_BUCKET.get(m[1].toLowerCase()) ?? null) : null;
}

/**
 * The conventional-commit mix over the non-merge commits (see isMergeCommit) with a
 * non-empty subject (the commits the messages card counts).
 * Returns `{total, conventional, share, counts: {feat, fix, docs, refactor, test, chore,
 * other}, shares: {...same keys}, top, shown}`:
 * - total: commits counted; conventional: how many of them follow the convention
 *   (see commitTypeOf); counts: conventional commits per bucket (they add up to
 *   conventional; other subjects are in no bucket);
 * - share: conventional / total, rounded to 3 decimals (0 without commits);
 * - shares: whole percents of conventional (sizeShares: largest remainder, adding up to
 *   exactly 100), all 0 without conventional commits;
 * - top: the bucket with the most commits (ties → COMMIT_TYPE_IDS order), null without any;
 * - shown: whether the cards / recap / wrapped.md show the mix: at least one conventional
 *   commit and conventional / total ≥ COMMIT_TYPES_MIN_SHARE.
 * Invalid input policy (as in sizes.js): never throws; non-object entries and commits
 * without a string subject are skipped. Empty input → zeros, top null, shown false.
 */
export function computeCommitTypes(commits) {
  const counts = Object.fromEntries(COMMIT_TYPE_IDS.map((id) => [id, 0]));
  let total = 0;
  let conventional = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    if (typeof c.subject !== 'string' || !c.subject.trim()) continue;
    total += 1;
    const type = commitTypeOf(c.subject);
    if (!type) continue;
    conventional += 1;
    counts[type] += 1;
  }
  const values = COMMIT_TYPE_IDS.map((id) => counts[id]);
  const shares = sizeShares(values);
  let top = null;
  COMMIT_TYPE_IDS.forEach((id) => {
    if (counts[id] > 0 && (!top || counts[id] > counts[top])) top = id;
  });
  return {
    total,
    conventional,
    share: total > 0 ? Math.round((conventional / total) * 1000) / 1000 : 0,
    counts,
    shares: Object.fromEntries(COMMIT_TYPE_IDS.map((id, i) => [id, shares[i]])),
    top,
    shown: conventional > 0 && conventional / total >= COMMIT_TYPES_MIN_SHARE,
  };
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The type mix the messages card, the recap and wrapped.md show for `stats.commitTypes`,
 * or null when it is not shown: no object, no conventional commit, or conventional
 * commits under COMMIT_TYPES_MIN_SHARE of `total` (recomputed from the counts, so a
 * hand-edited `shown` flag cannot disagree with them).
 * Returns `{conventional, total, rows: [{id, count, share}]}`: rows are the buckets with
 * commits, most first (ties in COMMIT_TYPE_IDS order), with 'other' always last; shares
 * are whole percents of the conventional commits, recomputed from the shown counts with
 * sizeShares. All three outputs use this, so they always agree.
 */
export function shownCommitTypes(types) {
  if (!types || typeof types !== 'object') return null;
  const src = types.counts && typeof types.counts === 'object' ? types.counts : {};
  const counts = COMMIT_TYPE_IDS.map((id) => shownCount(src[id]));
  const conventional = counts.reduce((a, b) => a + b, 0);
  const total = Math.max(conventional, shownCount(types.total));
  if (conventional === 0 || conventional / total < COMMIT_TYPES_MIN_SHARE) return null;
  const shares = sizeShares(counts);
  const rows = COMMIT_TYPE_IDS.map((id, i) => ({ id, count: counts[i], share: shares[i], i }))
    .filter((r) => r.count > 0)
    .sort((a, b) => (a.id === 'other') - (b.id === 'other') || b.count - a.count || a.i - b.i)
    .map(({ i, ...r }) => r);
  return { conventional, total, rows };
}

/**
 * At most `max` rows of a shownCommitTypes() mix for a stacked bar: the first max - 1
 * named types as they are, and everything after them (more named types, and the 'other'
 * bucket when there is one) folded into one 'rest' row (counts and shares summed, so the
 * kept rows read exactly as in the recap and the shares still add up to 100). A 'rest'
 * row always holds at least two rows, one of them a named type, so it never stands for
 * the 'other' bucket alone. Fewer rows stay as they are.
 */
export function foldCommitTypes(rows, max = 4) {
  if (!Array.isArray(rows) || rows.length <= max) return rows;
  const kept = rows.filter((r) => r.id !== 'other').slice(0, max - 1);
  const rest = rows.filter((r) => !kept.includes(r));
  const sum = (key) => rest.reduce((a, r) => a + r[key], 0);
  return [...kept, { id: 'rest', count: sum('count'), share: sum('share') }];
}
