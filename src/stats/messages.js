import { scrubEmails } from '../privacy.js';
import { localParts } from './time.js';

/** Words ignored by topWord: English filler, conventional-commit types, and the words
 * that have their own counters (fix / wip / oops families). Words shorter than 3 code
 * points are ignored too. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'in', 'for', 'on', 'with', 'is', 'it', 'this',
  'that', 'from', 'at', 'by', 'as', 'be', 'into', 'up', 'out', 'not', 'or', 'are', 'was',
  'but', 'its', 'when', 'all', 'some', 'now', 'use', 'via', 'also', 'more', 'than', 'too',
  'feat', 'chore', 'refactor', 'docs', 'test', 'tests', 'style', 'ci', 'build', 'perf',
]);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
// Unicode-aware whole-word boundaries: `\b` only knows ASCII, so "préfix" would match.
const FIX = /(?<![\p{L}\p{N}_])(?:hot|bug)?fix(?:e[sd]|ing)?(?![\p{L}\p{N}_])/iu;
const WIP = /(?<![\p{L}\p{N}_])wip(?![\p{L}\p{N}_])/iu;
const OOPS = /(?<![\p{L}\p{N}_])oo+ps+(?![\p{L}\p{N}_])/iu;
const COUNTED_WORD = /^(?:(?:hot|bug)?fix(?:e[sd]|ing)?|wip|oo+ps+)$/u;
const HAS_LETTER = /\p{L}/u;
/** git's autosquash prefixes (`git commit --fixup / --squash / --fixup=amend:`), exactly as git's autosquash matches them. */
const FIXUP = /^(?:fixup|squash|amend)! /u;
/** The non-enumerable key computeMessages keeps the exact (unrounded) fixup share under (see shownFixups). */
const EXACT = Symbol('messages.fixups.exactShare');
/** Subjects git generates for merges; they say nothing about the author's habits. */
const MERGE = /^Merge (?:(?:branch|branches|pull request|remote-tracking branch|tag|commit)\b|(['"]).+?\1 into\b)/;

/**
 * A merge commit: more than one parent when the commit carries `parents` (from git),
 * else (hand-built commits without parent info) a git-generated merge subject.
 */
export function isMergeCommit(c) {
  if (Array.isArray(c?.parents)) return c.parents.length > 1;
  return typeof c?.subject === 'string' && MERGE.test(c.subject.trim());
}

/**
 * Whether `subject` is one of git's autosquash subjects: it starts with `fixup! `,
 * `squash! ` or `amend! ` (the "!" followed by a space), exactly as `git commit --fixup`,
 * `--squash` and `--fixup=amend:` write them and `git rebase --autosquash` matches them:
 * case-sensitive ("Fixup! x" is not one), no leading whitespace, and a bare "fixup!" is
 * not one; `fixup! fixup! x` is one commit. Non-strings → false.
 */
export const isFixupSubject = (subject) => typeof subject === 'string' && FIXUP.test(subject);

/** A word is in a counted family if it, or any of its hyphen parts ("hot-fix"), is. */
const isCountedWord = (word) => word.split('-').some((part) => COUNTED_WORD.test(part));

const codePoints = (s) => [...s].length;

/**
 * Commit-message stats over each commit's subject line (trimmed), with anything shaped
 * like an email address (`name@host`) replaced by "…" first (see scrubEmails), so every
 * field below is computed from, and shows, the scrubbed subject. Merge commits (more than
 * one entry in `parents`; for commits without a `parents` array, subjects starting "Merge
 * branch / branches / pull request / remote-tracking branch / tag / commit" or "Merge
 * '...' into") are skipped by every field.
 * Returns `{shortest, longest, topWord, counts: {fix, wip, oops}, averageLength, fixups}`:
 * - shortest / longest: `{subject, hash, length}` (length in Unicode code points) or null
 *   when no commit has a non-empty subject. Ties go to the earliest commit by date;
 *   commits with an unparseable date come after dated ones; then input order.
 * - topWord: `{word, count}` — the most frequent lowercase word across all subjects
 *   (every occurrence counts), ignoring stopwords, conventional-commit types, the
 *   fix / wip / oops word families (also as a hyphen part: "hot-fix", "auto-fix"), words
 *   under 3 code points and words without a letter (e.g. "1234"); ties → alphabetical;
 *   null when no word qualifies.
 * - counts: number of commits whose subject contains, as a whole word, case-insensitive:
 *   fix — fix/fixes/fixed/fixing, optionally prefixed hot/bug (hotfix, bugfixes);
 *   wip — wip; oops — oops, ooops, oopss... (not "ops"). Word boundaries are Unicode-aware
 *   ("préfix" is not a fix). Each commit counts at most once per category.
 * - averageLength: mean length (code points) of non-empty subjects, rounded to 1 decimal;
 *   0 when there are none.
 * - fixups: `{commits, share}`: how many non-merge commits have an autosquash subject
 *   (`fixup!` / `squash!` / `amend!`, see isFixupSubject) that reached the history, and
 *   their share of every non-merge commit (also those without a subject, as stats.cleanups
 *   counts them), 3 decimals, at most 0.999 short of every commit (as stats.cleanups
 *   rounds its share); `{commits: 0, share: 0}` without any. The exact ratio rides along
 *   non-enumerably for shownFixups, so stats.json keeps exactly `{commits, share}`.
 * Invalid input policy: never throws; a missing / non-string subject is treated as empty
 * and is skipped by every field. Empty input → nulls and zeros.
 */
export function computeMessages(commits) {
  commits = commits ?? [];
  const entries = [];
  let nonMerge = 0;
  let fixups = 0;
  commits.forEach((c, index) => {
    if (isMergeCommit(c)) return;
    if (c && typeof c === 'object') {
      nonMerge += 1;
      if (isFixupSubject(c.subject)) fixups += 1;
    }
    // Email-shaped text is cut first (see scrubEmails), so no field (the shown subjects,
    // their lengths, the top word) is ever built from an address.
    const subject = typeof c?.subject === 'string' ? scrubEmails(c.subject).trim() : '';
    if (!subject) return;
    const t = localParts(c.date);
    entries.push({ subject, hash: c.hash ?? null, length: codePoints(subject), ms: t ? t.ms : Infinity, index });
  });
  // Deterministic tie order: earliest instant first, undated last, then input order.
  entries.sort((a, b) => (a.ms === b.ms ? a.index - b.index : a.ms < b.ms ? -1 : 1));

  let shortest = null;
  let longest = null;
  let totalLength = 0;
  const counts = { fix: 0, wip: 0, oops: 0 };
  const words = new Map();
  for (const e of entries) {
    if (!shortest || e.length < shortest.length) shortest = e;
    if (!longest || e.length > longest.length) longest = e;
    totalLength += e.length;
    if (FIX.test(e.subject)) counts.fix += 1;
    if (WIP.test(e.subject)) counts.wip += 1;
    if (OOPS.test(e.subject)) counts.oops += 1;
    for (const raw of e.subject.toLowerCase().match(WORD) ?? []) {
      const word = raw.replace(/['-]+$/, '');
      if (codePoints(word) < 3 || !HAS_LETTER.test(word) || STOPWORDS.has(word) || isCountedWord(word)) continue;
      words.set(word, (words.get(word) ?? 0) + 1);
    }
  }

  let topWord = null;
  for (const [word, count] of words) {
    if (!topWord || count > topWord.count || (count === topWord.count && word < topWord.word)) {
      topWord = { word, count };
    }
  }

  const pick = (e) => (e ? { subject: e.subject, hash: e.hash, length: e.length } : null);
  return {
    shortest: pick(shortest),
    longest: pick(longest),
    topWord,
    counts,
    averageLength: entries.length ? Math.round((totalLength / entries.length) * 10) / 10 : 0,
    fixups: fixupsStat(fixups, nonMerge),
  };
}

/** stats.messages.fixups for `fixups` of `total` non-merge commits (see computeMessages). */
function fixupsStat(fixups, total) {
  if (fixups === 0) return { commits: 0, share: 0 };
  const share = Math.min(Math.round((fixups / total) * 1000) / 1000, fixups < total ? 0.999 : 1);
  return Object.defineProperty({ commits: fixups, share }, EXACT, { value: fixups / total });
}

/**
 * stats.messages.fixups as the messages card, the recap and wrapped.md show it: `{commits,
 * pct}`, or null (no object, e.g. a stats.json from before the stat, or no fixup commit).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeMessages keeps, else from `share`; below 100 unless the share is exactly 1.
 * All outputs use this, so they agree.
 */
export function shownFixups(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const n = stat.commits;
  const commits = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  return { commits, pct: share * 100 };
}
