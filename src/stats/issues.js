// Issue references: non-merge commits whose subject mentions an issue (`#123`, `GH-123`,
// or a Jira-style key such as `ABC-123`), their share, and the most referenced issue.
// Subjects only (git log's %s, as the other message stats); no git calls.
import { scrubEmails } from '../privacy.js';
import { isMergeCommit } from './messages.js';

/** The non-enumerable key computeIssueRefs keeps the exact (unrounded) share under (see shownIssueRefs). */
const EXACT = Symbol('issueRefs.exactShare');

/**
 * Text that is never searched for references, replaced by a space first: URLs (a scheme and
 * "://" up to the next whitespace, or "www." up to it: "https://x.y/issues/12#34" is a link,
 * not a mention), and hex hashes (7–64 hex digits with at least one letter and one digit,
 * standing alone, lowercase only as git prints them, and not followed by "-" and a digit:
 "deadbeef1" is a commit hash, "ABC1234-5" is still a key). Email
 * addresses are cut by scrubEmails before that. URLs are the matches of
 * `\b[a-z][a-z0-9+.-]*:\/\/\S*` or `\bwww\.\S*` (one regex, flags `giu`), cut by cutUrls
 * (in linear time).
 */
const HEX_HASH = /(?<![\p{L}\p{N}_])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,64}(?![\p{L}\p{N}_]|-\d)/gu;

/** One code unit tests for cutUrls, with the URL regex's own flags (so "ſ" / "K" fold as they do there). */
const URL_WORD = /^\w$/iu;
const URL_SCHEME_START = /^[a-z]$/iu;
const URL_SCHEME = /^[a-z0-9+.-]$/iu;
const URL_SPACE = /^\s$/u;
/** "www." where the URL regex's second branch can start (a word boundary before it). */
const URL_WWW = /\bwww\./giu;

/**
 * `s` with every URL (the regex in HEX_HASH's comment) replaced by a space, exactly
 * as `s.replace(thatRegex, ' ')` does, in linear time: the regex retried
 * its scheme part from every letter of a long "a-a-a-…" run with no "://" after it (a
 * 100,000-character subject took seconds). Here each run before a "://" is scanned once:
 * the leftmost scheme start in it is its first letter with a non-word character (or
 * nothing) before it; the "www." branch is found by URL_WWW; the earlier start wins (the
 * scheme branch on a tie, as in the regex), and the match runs to the next whitespace.
 */
export function cutUrls(s) {
  const isWord = (i) => i >= 0 && URL_WORD.test(s[i]);
  const toSpace = (i) => {
    while (i < s.length && !URL_SPACE.test(s[i])) i += 1;
    return i;
  };
  let out = '';
  let i = 0;
  // The next scheme match start at or after `i` (and the "://" it ends at), cached.
  let scheme = null;
  let from = 0;
  // The next "www." match at or after `i`, cached (undefined: not looked for yet; null: none).
  let www;
  const nextScheme = () => {
    for (let q = s.indexOf('://', Math.max(from, i)); q >= 0; q = s.indexOf('://', q + 1)) {
      let r = q;
      while (r > i && URL_SCHEME.test(s[r - 1])) r -= 1;
      for (let p = r; p < q; p += 1) {
        if (URL_SCHEME_START.test(s[p]) && !isWord(p - 1)) return { start: p, rest: q + 3 };
      }
    }
    return null;
  };
  for (;;) {
    if (!scheme || scheme.start < i) {
      scheme = nextScheme();
      from = scheme ? scheme.rest - 3 : s.length;
    }
    if (www !== null && (www === undefined || www.index < i)) {
      URL_WWW.lastIndex = i;
      www = URL_WWW.exec(s);
    }
    const useScheme = scheme && (!www || scheme.start <= www.index);
    if (!useScheme && !www) break;
    const start = useScheme ? scheme.start : www.index;
    const end = toSpace(useScheme ? scheme.rest : www.index + 4);
    out += `${s.slice(i, start)} `;
    i = end;
  }
  return out + s.slice(i);
}

/**
 * A GitHub-style `#123` (1–7 digits, the first 1–9): not after a letter, digit, "_", "/",
 * "&" or another "#" ("a#1", "foo/#12", the HTML entity "&#123;", "##1" are not mentions;
 * a "/" right after another reference does not count, see issueRefsInSubject: "#12/#13"),
 * and not followed by a letter, digit or "_" ("#123abc"). A squash-merge subject's PR
 * number ("feat: x (#12)") counts: GitHub numbers issues and PRs alike.
 */
const HASH_REF = /(?<![\p{L}\p{N}_&#])#([1-9]\d{0,6})(?![\p{L}\p{N}_])/gu;

/**
 * `GH-123` (any case), GitHub's other spelling of `#123`, normalized to it. Not after a
 * letter, digit, "_", "-", "." or "/" (unless that "/" follows another reference, as for
 * HASH_REF), not followed by a letter, digit or "_", nor by "." or "-" and a digit (a
 * version, "gh-1.2").
 */
const GH_REF = /(?<![\p{L}\p{N}_\-.])gh-([1-9]\d{0,6})(?![\p{L}\p{N}_]|[.-]\d)/giu;

/**
 * A Jira-style key `ABC-123`: an uppercase project key (a letter, then 1–9 uppercase
 * letters or digits), "-", and a number (1–7 digits, the first 1–9). Same boundaries as
 * GH_REF ("x.ABC-1", "path/ABC-1", "ABC-1.2", "ABC-1-2" and "ABC-12x" are not keys), and
 * also not after "#". Lowercase keys ("abc-123") are not keys.
 */
const JIRA_REF = /(?<![\p{L}\p{N}_\-.#])([A-Z][A-Z0-9]{1,9})-([1-9]\d{0,6})(?![\p{L}\p{N}_]|[.-]\d)/gu;

/**
 * Key-shaped names that are not issue trackers: encodings, hashes, standards, security
 * advisories and ciphers ("UTF-8", "SHA-256", "ISO-8601", "RFC-2119", "CVE-2024", "PEP-8",
 * "ES-2020", "AES-256", "RSA-2048", "TLS-13"…), versions and platforms ("X86-64", "WIN-32",
 * "IE-11", "IPV-6", "LATIN-1", "CP-1252", "BASE-64", "MD-5"), quarters and halves
 * ("Q3-2024", "H1-2025", "FY-2025"), plus GH (GitHub, see GH_REF).
 */
const NOT_ISSUE_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'CWE', 'GHSA', 'PEP', 'ES', 'ECMA', 'HTTP', 'TLS', 'SSL', 'AES', 'RSA', 'COVID', 'SHA1', 'SHA2', 'SHA3', 'MD', 'MD4', 'MD5', 'BASE', 'LATIN', 'CP', 'X86', 'WIN', 'IE', 'IPV', 'FY', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'GH']);

/** A normalized reference as issueRefsInSubject returns it: "#123" or "ABC-123". */
const REF = /^(?:#[1-9]\d{0,6}|[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})$/;

/**
 * The issues a commit subject mentions, as distinct normalized references in the order
 * they first appear: `#123` and `GH-123` → "#123", a Jira-style key → "ABC-123" (see
 * HASH_REF, GH_REF, JIRA_REF; URLs, hex hashes and email addresses are skipped, see
 * HEX_HASH and cutUrls; NOT_ISSUE_KEYS are not keys). [] for anything but a string. Pure function.
 */
export function issueRefsInSubject(subject) {
  if (typeof subject !== 'string' || subject === '') return [];
  const s = cutUrls(scrubEmails(subject)).replace(HEX_HASH, ' ');
  const found = [];
  for (const m of s.matchAll(HASH_REF)) found.push([m.index, `#${m[1]}`, m.index + m[0].length]);
  for (const m of s.matchAll(GH_REF)) found.push([m.index, `#${m[1]}`, m.index + m[0].length]);
  for (const m of s.matchAll(JIRA_REF)) if (!NOT_ISSUE_KEYS.has(m[1])) found.push([m.index, `${m[1]}-${m[2]}`, m.index + m[0].length]);
  found.sort((a, b) => a[0] - b[0]);
  // The patterns leave "/" to here: a reference right after "/" counts only when that "/"
  // directly follows another counted reference ("#12/#13", "ABC-1/ABC-2"), never after a
  // path ("foo/#12", "owner/repo#12" is cut by the letter before "#").
  const ends = new Set();
  const refs = [];
  for (const [index, ref, end] of found) {
    if (s[index - 1] === '/' && !ends.has(index - 1)) continue;
    ends.add(end);
    refs.push(ref);
  }
  return [...new Set(refs)];
}

/**
 * The order of two counted references on equal commits: "#" refs first, by number (then
 * by repo label, unlabeled first), then Jira-style keys by project key (plain string
 * order, they are uppercase ASCII) and number.
 */
function refOrder(a, b) {
  const ah = a.ref.startsWith('#');
  const bh = b.ref.startsWith('#');
  if (ah !== bh) return ah ? -1 : 1;
  if (ah) return Number(a.ref.slice(1)) - Number(b.ref.slice(1)) || (a.repo ?? '').localeCompare(b.repo ?? '', 'en');
  const [ak, an] = a.ref.split('-');
  const [bk, bn] = b.ref.split('-');
  return ak < bk ? -1 : ak > bk ? 1 : Number(an) - Number(bn);
}

/**
 * stats.issueRefs: `{commits, share, top: {ref, commits}}`, or null when no non-merge
 * commit's subject references an issue (so also for empty input).
 * - Only non-merge commits count (see isMergeCommit: "Merge pull request #12" is a merge),
 *   and only their subject (see issueRefsInSubject).
 * - commits: how many of them reference at least one issue (once each, however many);
 * - share: commits / every non-merge commit, 3 decimals, at most 0.999 short of every
 *   commit (as stats.cleanups); the exact ratio rides along non-enumerably for
 *   shownIssueRefs, so stats.json keeps exactly `{commits, share, top}`;
 * - top: the most referenced issue, `{ref, commits}`: ref as issueRefsInSubject gives it,
 *   commits how many commits mention it (a commit mentioning it twice counts once). With
 *   several repos (commits carry `repo`, see mergeHistories in src/git.js) "#" refs are
 *   counted per repo, since #12 in one repo and #12 in another are different issues, and
 *   such a top also has `repo` (its label); Jira-style keys are shared across repos. Ties
 *   go by refOrder: the lowest "#" number first, then Jira keys by key and number.
 * Invalid input policy: never throws, never mutates; non-object entries are skipped.
 */
export function computeIssueRefs(commits) {
  let total = 0;
  let referencing = 0;
  const counts = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    total += 1;
    const refs = issueRefsInSubject(c.subject);
    if (refs.length === 0) continue;
    referencing += 1;
    const repo = typeof c.repo === 'string' && c.repo.trim() ? c.repo : null;
    for (const ref of refs) {
      const scoped = ref.startsWith('#') ? repo : null;
      const key = `${scoped ?? ''}\u0000${ref}`;
      const entry = counts.get(key) ?? { ref, repo: scoped, commits: 0 };
      entry.commits += 1;
      counts.set(key, entry);
    }
  }
  if (referencing === 0) return null;
  let best = null;
  for (const e of counts.values()) if (!best || e.commits > best.commits || (e.commits === best.commits && refOrder(e, best) < 0)) best = e;
  const top = { ref: best.ref, commits: best.commits, ...(best.repo !== null ? { repo: best.repo } : {}) };
  const share = Math.min(Math.round((referencing / total) * 1000) / 1000, referencing < total ? 0.999 : 1);
  return Object.defineProperty({ commits: referencing, share, top }, EXACT, { value: referencing / total });
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * stats.issueRefs as the messages card, the recap and wrapped.md show it: `{commits, pct,
 * top}`, or null (no object, or no referencing commit).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeIssueRefs keeps, else from `share`; below 100 unless the share is exactly 1;
 * - top: `{ref, commits, repo}` (ref a valid reference, see REF; commits a whole number
 *   of at least 2, at most `commits`; repo the label with emails scrubbed, trimmed, or
 *   null), or null when the stat has no usable top, or when it is mentioned by a single
 *   commit (every issue then ties, so a "most referenced" one would say nothing).
 * All outputs use this, so they agree.
 */
export function shownIssueRefs(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  if (commits === 0) return null;
  const exact = stat[EXACT];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  const t = stat.top;
  const topCommits = t && typeof t === 'object' ? Math.min(shownCount(t.commits), commits) : 0;
  let top = null;
  if (topCommits >= 2 && typeof t.ref === 'string' && REF.test(t.ref)) {
    const repo = t.ref.startsWith('#') && typeof t.repo === 'string' ? scrubEmails(t.repo).trim() : '';
    top = { ref: t.ref, commits: topCommits, repo: repo || null };
  }
  return { commits, pct: share * 100, top };
}

/** A shownIssueRefs() top as written: "#128", "web#128" (with a repo label), "ABC-12". */
export const issueRefLabel = (top) => (top ? `${top.repo ?? ''}${top.ref}` : '');
