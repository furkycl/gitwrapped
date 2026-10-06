import { scrubEmails } from '../privacy.js';
import { isMergeCommit } from './messages.js';
import { localParts } from './time.js';

/** How many hex digits of the hash the first commit keeps (git's usual short hash). */
export const SHORT_HASH = 7;

/**
 * The first commit in the window: the earliest non-merge commit by author date, as
 * `{date, subject, hash}` plus `repo` (its label) in a multi-repo run, or null:
 * - date: the author-local day 'YYYY-MM-DD' (as everywhere in stats; null when the date
 *   is unparseable);
 * - subject: the trimmed subject line with anything shaped like an email address
 *   (`name@host`) replaced by "…" (see scrubEmails); null when missing / empty;
 * - hash: the first SHORT_HASH characters of the hash (null when missing, or not made of
 *   letters and digits only, so no email or other text can pass as one);
 * - repo: present only when the commit carries a `repo` label (mergeHistories in
 *   src/git.js), so single-repo stats are unchanged.
 * Merge commits (see isMergeCommit) are skipped, as for the biggest commit. Commits with
 * an unparseable date come after dated ones; on the same instant (or both undated) the
 * later one in input order wins: the input is newest first (git log, or mergeHistories,
 * which keeps equal instants repo by repo in git's order), so that is the older commit in
 * git order (in a multi-repo run, the one from the later repo), as in computeBiggestCommit.
 * Invalid input policy: never throws; non-object entries are skipped. Empty input, or
 * only merge commits → null.
 */
export function computeFirstCommit(commits) {
  let best = null;
  for (const c of commits ?? []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    const t = localParts(c.date);
    const ms = t ? t.ms : Infinity;
    // Strictly earlier wins; on the same instant the later one in input order (git order).
    if (best && ms > best.ms) continue;
    best = { c, t, ms };
  }
  if (!best) return null;
  const { c, t } = best;
  const raw = typeof c.subject === 'string' ? scrubEmails(c.subject).trim() : '';
  // Git hashes are hex; anything else that is not plain letters / digits is not shown.
  const hash = typeof c.hash === 'string' && /^[0-9a-z]+$/i.test(c.hash.trim()) ? c.hash.trim().slice(0, SHORT_HASH) : null;
  const out = { date: t ? t.dayKey : null, subject: raw || null, hash };
  if (typeof c.repo === 'string' && c.repo.trim()) out.repo = c.repo;
  return out;
}
