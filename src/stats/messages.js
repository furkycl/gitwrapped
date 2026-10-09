import { scrubEmails } from '../privacy.js';
import { localParts } from './time.js';
import { stripLeadingEmoji } from './types.js';
import { isDepBumpCommit } from './depbumps.js';

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
/** The non-enumerable key computeMessages keeps the exact (unrounded) over-72 share under (see shownSubjectLength). */
const EXACT_OVER = Symbol('messages.subjectLength.exactShare');
/** The non-enumerable key computeMessages keeps the exact (unrounded) typo-fix share under (see shownTypos). */
const EXACT_TYPOS = Symbol('messages.typos.exactShare');
/**
 * A typo / spelling fix, as a whole word (Unicode-aware boundaries, combining marks
 * included, so "typography", "typology" or "typó" do not match), case-insensitive:
 * "typo", "typos", "spelling(s)", "misspell…" (misspell, misspelled, misspelling(s),
 * misspells, misspelt) and Turkish "yazım" (also as "yazim" / "YAZIM"; no suffix, so
 * "test yazımı", "writing of the tests", is not one). Hyphens and apostrophes are
 * boundaries ("typo-fix", "fix-typo", "typo'yu"). A word right after a "/", or right
 * before a "/" or a "." followed by a letter or digit, is part of a path, package, file
 * or domain name ("crate-ci/typos", "typos.toml", "example.com/typo") and does not count;
 * a sentence-final "typo." does. Dotted "İ" and "i" + U+0307 are read as "i" first (see
 * typoIn), so "SPELLİNG" and "YAZİM" count.
 */
const TYPO = /(?<![\p{L}\p{M}\p{N}_/])(?:typos?|spellings?|misspell\p{L}*|misspelt|yaz[ıi]m)(?![\p{L}\p{M}\p{N}_/]|\.[\p{L}\p{N}])/iu;
/** URLs (`scheme://…`, `www.…`) cut before TYPO is tried, as subjectWords cuts them (see NOT_WORDS). */
const URLS = /(?<![\p{L}\p{N}_+.-])[a-z][a-z0-9+.-]*:\/\/\S*|(?<![\p{L}\p{N}_])www\.\S*/giu;

/** Dotted capital I, or "i" with a combining dot above: read as "i" (Turkish keyboards upper-case "i" to "İ"). */
const DOTTED_I = /İ|i\u0307/gu;

/**
 * Whether an already email-scrubbed subject (see scrubEmails) mentions a typo / spelling
 * fix (see TYPO): NFC-normalized, URLs cut, dotted "İ" / "i̇" read as "i", then TYPO.
 */
function typoIn(scrubbed) {
  return TYPO.test(scrubbed.normalize('NFC').replace(URLS, ' ').replace(DOTTED_I, 'i'));
}

/**
 * Whether a commit subject mentions a typo / spelling fix (see TYPO): the subject
 * NFC-normalized, email-shaped text (see scrubEmails) and URLs cut first, so
 * "docs: link https://x.io/typo" or "typo@x.io" is not one. Non-strings → false.
 * computeMessages also skips dependency bumps (see isDepBumpCommit in depbumps.js).
 */
export function isTypoFixSubject(subject) {
  if (typeof subject !== 'string') return false;
  return typoIn(scrubEmails(subject));
}

/** The subject length git's own docs (and most style guides) suggest staying within. */
export const SUBJECT_LIMIT = 72;
/** The non-enumerable key computeMessages keeps the exact (unrounded) body share under (see shownBodies). */
const EXACT_BODIES = Symbol('messages.bodies.exactShare');
/** A `Token: value` line: a token of letters, digits and hyphens starting with a letter, optional blanks, a colon, then the value. */
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*)$/u;
/** People trailers (`Signed-off-by`, `Co-authored-by`, `Reviewed-by`, `Acked-by`, `Tested-by`, `Reported-by`, `Suggested-by`, `Helped-by`, …): any value. */
const BY_TOKEN = /^[a-z][a-z-]*-by$/u;
/** Well-known hyphenated git / Gerrit / tool trailers (lower case): any value. */
const KNOWN_TOKENS = new Set(['change-id', 'reviewed-on', 'git-svn-id', 'bug-url', 'message-id', 'closes-bug', 'partial-bug', 'related-bug', 'depends-on']);
/**
 * One-word trailer tokens (lower case) that count only with a reference-shaped value (see
 * isReferenceList): "Fixes: #12" is a trailer, "Fixes: a race where …" is prose.
 */
const REFERENCE_TOKENS = new Set(['cc', 'bcc', 'fixes', 'closes', 'resolves', 'refs', 'ref', 'references', 'related', 'bug', 'issue', 'link']);
/**
 * One reference word: `#123`, `owner/repo#123`, `GH-123` / `ABC-123`, a URL, a commit hash
 * (7 to 64 hex digits), a bare number, an email address, or `<email>`.
 */
const REFERENCE_WORD = /^(?:#\d+|[\w.-]+\/[\w.-]+#\d+|[A-Za-z][A-Za-z0-9_]*-\d+|[a-z][a-z0-9+.-]*:\/\/\S+|[0-9a-f]{7,64}|\d+|[^\s<>@]+@[^\s<>@]+|<[^\s<>]+>)$/iu;
/** `Name <email>` (the name optional). */
const NAME_EMAIL = /^(?:[^<>]*\S[ \t]*)?<[^\s<>]+>$/u;
/** The Linux kernel's `Fixes:` form: a commit hash and its quoted subject. */
const HASH_SUBJECT = /^[0-9a-f]{7,64}[ \t]+\(".*"\)$/iu;

/**
 * Whether a trailer value is a list of references (see REFERENCE_WORD, NAME_EMAIL,
 * HASH_SUBJECT): items separated by commas or semicolons, each one `Name <email>` or
 * whitespace-separated reference words; a final "." is allowed. Empty → false.
 */
function isReferenceList(value) {
  const v = value.trim().replace(/\.$/u, '');
  if (v === '') return false;
  if (HASH_SUBJECT.test(v)) return true;
  return v.split(/[,;]/u).every((piece) => {
    const p = piece.trim();
    if (p === '') return false;
    if (NAME_EMAIL.test(p)) return true;
    return p.split(/[ \t]+/u).every((w) => REFERENCE_WORD.test(w));
  });
}

/** The line `git cherry-pick -x` adds; git's trailer parser treats it as part of the trailer block too. */
const CHERRY_PICKED = /^\(cherry picked from commit [0-9a-f]{7,64}\)$/u;
/**
 * What `git revert` writes as the body (a whole paragraph, its lines joined by single
 * spaces first, however it is wrapped): "This reverts commit <hash>." and, for a merge,
 * "This reverts commit <hash>, reversing changes made to <hash>.". With `git revert
 * --reference` (git 2.41+) each hash is followed by " (<subject>, <YYYY-MM-DD>)", as its
 * `%h (%s, %ad)` reference format with a short date writes it.
 */
const REVERT_REF = String.raw`[0-9a-f]{7,64}(?: \(.*, \d{4}-\d{2}-\d{2}\))?`;
const REVERT_BOILERPLATE = new RegExp(String.raw`^This reverts commit ${REVERT_REF}(?:, reversing changes made to ${REVERT_REF})?\.$`, 'iu');
/**
 * The two `.*` subjects make REVERT_BOILERPLATE quadratic on a crafted paragraph, so longer
 * paragraphs (far beyond two real subjects) are prose without running it.
 */
const REVERT_MAX_LENGTH = 2048;

/**
 * Whether `line` (trimmed at the end) is a trailer line: `Token: value` with a people
 * token (`*-by`, any value), a well-known hyphenated token (`Change-Id`, `Reviewed-on`,
 * …, see KNOWN_TOKENS; any value), or a one-word token such as `Fixes` / `Cc`, or any
 * other hyphenated token, with a reference-shaped value (see isReferenceList); or git's
 * cherry-pick note. A hyphen alone does not make a trailer ("Follow-up: …",
 * "Trade-offs: …" are prose), nor does a word ("Note: …", "TODO: …"). Tokens are matched
 * case-insensitively.
 */
function isTrailerLine(line) {
  if (CHERRY_PICKED.test(line)) return true;
  const m = TRAILER_LINE.exec(line);
  if (!m) return false;
  const token = m[1].toLowerCase();
  if (BY_TOKEN.test(token) || KNOWN_TOKENS.has(token)) return true;
  // Any other hyphenated token (tool trailers such as `Claude-Session: https://…` or
  // `X-Ticket: ABC-1`) is one only with a reference-shaped value, like the one-word tokens.
  return (REFERENCE_TOKENS.has(token) || token.includes('-')) && isReferenceList(m[2]);
}

/** Whether a paragraph (its non-blank lines) is only trailers (folded lines too) or git's revert boilerplate. */
function isBoilerplate(para) {
  if (isTrailerLine(para[0]) && para.every((l, i) => i === 0 || isTrailerLine(l) || /^[ \t]/u.test(l))) return true;
  const text = para.join(' ').replace(/\s+/gu, ' ').trim();
  return text.length <= REVERT_MAX_LENGTH && REVERT_BOILERPLATE.test(text);
}

/**
 * Whether a commit message body (the message after its subject paragraph, as git's `%b`
 * prints it) says anything beyond the subject. Lines are split into paragraphs at blank
 * (empty or whitespace-only) lines. A paragraph is boilerplate when either
 * - it is a trailer block: its first line is a trailer line and every later line is a
 *   trailer line or a folded continuation (starting with a blank); see isTrailerLine for
 *   what a trailer line is (`Signed-off-by:`, `Co-authored-by:`, `Change-Id:`,
 *   `Fixes: #12`, git cherry-pick -x's "(cherry picked from commit …)" line); or
 * - it is what `git revert` writes: "This reverts commit <hash>." (", reversing changes
 *   made to <hash>." for a merge; with `--reference` each hash followed by "(<subject>,
 *   <YYYY-MM-DD>)"), however its lines are wrapped.
 * True when some paragraph is not boilerplate. This is deliberately not git's own trailer
 * parsing (which only reads the last paragraph, takes any `Token: value` and tolerates
 * some other lines in it): the question is whether a person wrote anything beyond the
 * subject, so trailer-shaped prose ("Fixes: a race where …", "Follow-up: …") counts, and
 * trailers or boilerplate in any paragraph do not. A whole message (subject included) is
 * not expected; non-strings → false. Pure function.
 */
export function hasMessageBody(body) {
  if (typeof body !== 'string' || body === '') return false;
  let para = [];
  const prose = () => para.length > 0 && !isBoilerplate(para);
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      if (prose()) return true;
      para = [];
    } else {
      para.push(line);
    }
  }
  return prose();
}

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

/** How many words stats.messages.topWords keeps. */
export const TOP_WORDS = 3;
/** The fewest commits a top word needs to be shown (cards, recap, wrapped.md); stats.json keeps the raw top 3. */
export const TOP_WORDS_MIN = 2;
/**
 * Small English + Turkish stopword lists for topWords (lower case, NFC). Words under 3
 * code points are dropped anyway, so the short ones ("a", "to", "ve", "bu") are listed
 * for completeness only.
 */
const TOP_WORDS_STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'for', 'with', 'without', 'from', 'into', 'onto',
  'to', 'of', 'in', 'on', 'at', 'by', 'as', 'is', 'it', 'be', 'up', 'out', 'off', 'via', 'per',
  'this', 'that', 'these', 'those', 'are', 'was', 'were', 'been', 'being', 'has', 'have', 'had',
  'not', 'all', 'any', 'its', "it's", 'our', 'your', 'you', 'they', 'them', 'their', 'there',
  'when', 'then', 'than', 'also', 'more', 'some', 'too', 'now', 'can', 'will', 'should', 'would',
  'which', 'what', 'who', 'only', 'just', 'about', 'over', 'after', 'before', 'again', 'so', 'if',
  'how', 'why', 'where', 'while', 'does', "don't", "doesn't",
  // Turkish
  've', 'ile', 'için', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'ki', 'mi', 'mı', 'mu', 'mü', 'ne',
  'ya', 'veya', 'ama', 'fakat', 'gibi', 'daha', 'çok', 'en', 'her', 'hem', 'olan', 'olarak',
  'sonra', 'önce', 'kadar', 'göre', 'diye', 'yani', 'ise', 'artık', 'bunu', 'buna', 'bunun',
  'şey', 'tüm', 'bütün',
]);
/**
 * A leading conventional-commit-shaped prefix (`type(scope)!: `): any word of ASCII
 * letters (not only the known types stats/types.js buckets), an optional `(scope)` and
 * `!`, a colon, then blanks or the end of the subject (stats/types.js also wants a
 * description after it). So a Go-style `pkg: message` loses `pkg` too.
 */
const CONVENTIONAL_PREFIX = /^[A-Za-z]+(?:\([^()]*\))?!?:(?:\s+|$)/u;
/** git's autosquash markers in front of a subject (`fixup! `, `squash! `, `amend! `, repeated). */
const AUTOSQUASH_MARKERS = /^(?:(?:fixup|squash|amend)!\s*)+/u;
/** The wrapper `git revert` writes around the reverted subject: `Revert "…"` (the closing quote optional). */
const REVERT_WRAPPER = /^Revert\s+"([\s\S]*?)"?$/u;
/** How many rounds of wrappers subjectWords cuts (a revert of a revert of a fixup is 3). */
const MAX_UNWRAP = 8;
/** A gitmoji `:shortcode:` anywhere in the subject. */
const SHORTCODE = /:[a-z0-9_+-]+:/gu;
/** Text that is never a word: URLs, `owner/repo#12`, `#12`, `GH-12`, Jira keys (`ABC-123`), and hex hashes (7 or more hex digits with at least one digit: SHA-1, SHA-256 and longer runs). */
const NOT_WORDS = [
  // The lookbehinds start a match only where a token starts, so a long run such as
  // "a.a.a.…" is scanned once, not once per position.
  /(?<![\p{L}\p{N}_+.-])[a-z][a-z0-9+.-]*:\/\/\S*|(?<![\p{L}\p{N}_])www\.\S*/giu,
  /(?<![\p{L}\p{N}_.-])[\p{L}\p{N}_.-]+\/[\p{L}\p{N}_.-]+#\d+/gu,
  /#\d+/gu,
  /(?<![\p{L}\p{N}_])gh-\d+(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]{1,9}-\d+(?![\p{L}\p{N}_])/gu,
  /(?<![\p{L}\p{N}_])(?=[0-9a-f]*\d)[0-9a-f]{7,}(?![\p{L}\p{N}_])/giu,
];
/** A word: a run of Unicode letters (with their combining marks), an inner apostrophe allowed ("don't", "readme'yi"). */
const LETTER_WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;

/**
 * The distinct words of one commit subject for stats.messages.topWords (see
 * computeMessages): the subject NFC-normalized and trimmed; then, repeated while anything
 * changes (at most 8 rounds), git's autosquash markers in front (`fixup! ` / `squash! ` / `amend! `), emoji
 * and `:shortcode:`s in front (stats/types.js stripLeadingEmoji) and a `Revert "…"`
 * wrapper cut; then a leading conventional-commit-shaped prefix (see CONVENTIONAL_PREFIX),
 * `:shortcode:`s anywhere, URLs / issue refs / hex hashes cut, then runs of letters (see LETTER_WORD) lowercased
 * with toLowerCase (dotted "İ" as "i" first, so "İYİ" is "iyi"; the result is
 * NFC-normalized again), keeping words of at least 3 code points that are not stopwords.
 * `’` is read as `'`. Non-strings → none.
 */
export function subjectWords(subject) {
  if (typeof subject !== 'string') return new Set();
  let s = subject.normalize('NFC').trim();
  // Wrappers in front of the subject, in any order and nesting ("fixup! ✨ feat: x",
  // 'Revert "fixup! feat: x"'), at most MAX_UNWRAP rounds (so a crafted subject of
  // thousands of nested reverts stays linear).
  for (let prev = null, round = 0; prev !== s && round < MAX_UNWRAP; round += 1) {
    prev = s;
    s = stripLeadingEmoji(s.replace(AUTOSQUASH_MARKERS, ''));
    const revert = REVERT_WRAPPER.exec(s);
    if (revert) s = revert[1].trim();
  }
  s = s.replace(CONVENTIONAL_PREFIX, '').replace(SHORTCODE, ' ');
  for (const re of NOT_WORDS) s = s.replace(re, ' ');
  const words = new Set();
  for (const raw of s.match(LETTER_WORD) ?? []) {
    const word = raw.replace(/İ/gu, 'i').toLowerCase().normalize('NFC').replace(/’/gu, "'");
    if (codePoints(word) < 3 || TOP_WORDS_STOPWORDS.has(word)) continue;
    words.add(word);
  }
  return words;
}

/** stats.messages.topWords from `counts` (word → commits): the top TOP_WORDS by commits, ties alphabetical. */
function topWordsStat(counts) {
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, TOP_WORDS)
    .map(([word, count]) => ({ word, count }));
}

/** A word as subjectWords returns one (letters, marks, inner apostrophes). */
const SHOWN_WORD = /^\p{L}[\p{L}\p{M}]*(?:'\p{L}[\p{L}\p{M}]*)*$/u;

/**
 * stats.messages.topWords as the messages card, the recap and wrapped.md show it: the
 * entries `{word, count}` with a word shaped as subjectWords makes one (letters, marks,
 * inner apostrophes; at least 3 code points) and a count of at least TOP_WORDS_MIN (2)
 * commits (rounded to a whole number), each word once, by count then alphabetically, at
 * most TOP_WORDS (3); null when none is left (no array, e.g. a stats.json from before the
 * stat, or every word in a single commit). Every output uses this, so they agree.
 */
export function shownTopWords(stat) {
  if (!Array.isArray(stat)) return null;
  const seen = new Map();
  for (const e of stat) {
    const word = e?.word;
    const n = e?.count;
    if (typeof word !== 'string' || !SHOWN_WORD.test(word) || codePoints(word) < 3) continue;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const count = Math.round(n);
    if (count < TOP_WORDS_MIN || seen.has(word)) continue;
    seen.set(word, count);
  }
  const top = topWordsStat(seen);
  return top.length > 0 ? top : null;
}

/**
 * Commit-message stats over each commit's subject line (trimmed), with anything shaped
 * like an email address (`name@host`) replaced by "…" first (see scrubEmails), so every
 * field below is computed from, and shows, the scrubbed subject. Merge commits (more than
 * one entry in `parents`; for commits without a `parents` array, subjects starting "Merge
 * branch / branches / pull request / remote-tracking branch / tag / commit" or "Merge
 * '...' into") are skipped by every field.
 * Returns `{shortest, longest, topWord, counts: {fix, wip, oops}, typos, averageLength, fixups, subjectLength, bodies, topWords}`:
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
 * - typos: `{commits, share}`: how many non-merge commits have a subject that mentions a
 *   typo / spelling fix (see isTypoFixSubject: "typo", "typos", "spelling", "misspell…",
 *   Turkish "yazım", as whole words, case-insensitive, URLs and email addresses cut
 *   first), each commit once, and their share of every non-merge commit, rounded as
 *   `fixups.share`; `{commits: 0, share: 0}` without any (also without a non-merge
 *   commit). The exact ratio rides along non-enumerably for shownTypos.
 * - averageLength: mean length (code points) of non-empty subjects, rounded to 1 decimal;
 *   0 when there are none.
 * - fixups: `{commits, share}`: how many non-merge commits have an autosquash subject
 *   (`fixup!` / `squash!` / `amend!`, see isFixupSubject) that reached the history, and
 *   their share of every non-merge commit (also those without a subject, as stats.cleanups
 *   counts them), 3 decimals, at most 0.999 short of every commit (as stats.cleanups
 *   rounds its share); `{commits: 0, share: 0}` without any. The exact ratio rides along
 *   non-enumerably for shownFixups, so stats.json keeps exactly `{commits, share}`.
 * - subjectLength: `{median, over72, share}` over every non-merge commit (also those
 *   without a subject, as length 0), each subject trimmed and measured in Unicode code
 *   points as git wrote it (not email-scrubbed: only the number is kept). median: the
 *   middle length, for an even count the mean of the two middle ones (so a whole number
 *   or exactly .5, kept as is); over72: how many subjects are longer than 72 code points;
 *   share: over72 over every non-merge commit, rounded as `fixups.share` (3 decimals, at
 *   most 0.999 unless all of them are; 0 without any). The exact ratio rides along
 *   non-enumerably for shownSubjectLength. Null without a non-merge commit.
 * - bodies: `{commits, share}`: how many non-merge commits have a message body beyond
 *   the subject (blank lines, trailers such as `Co-authored-by:` / `Signed-off-by:` and
 *   git's revert boilerplate ignored, see hasMessageBody), and their share of the
 *   non-merge commits whose body is known, rounded as `fixups.share`; `{commits: 0,
 *   share: 0}` without any. A commit's body is known when it carries a boolean `hasBody`
 *   (set by git.js readBodies: on every commit, or on none when git could not read the
 *   bodies), else a string `body` (hand-built input, checked with hasMessageBody). The
 *   exact ratio rides along non-enumerably for shownBodies. Null when no non-merge commit
 *   has a known body (there is none, or the bodies could not be read): unknown is never
 *   reported as 0.
 * - topWords: `[{word, count}]`, the TOP_WORDS (3) most common words in the (email-
 *   scrubbed) subjects, each counted once per commit ("test test test" counts 1), with
 *   how many commits use it; by count, ties alphabetical (code-unit order); `[]` when no
 *   word qualifies. A separate rule from topWord: see subjectWords (NFC; a leading
 *   conventional `type(scope)!:` prefix cut, so "fix" / "feat" count only when written
 *   in the subject itself; URLs, `#12`, `owner/repo#12`, `GH-12`, `ABC-123` and hex
 *   hashes with a digit cut; runs of Unicode letters with an inner apostrophe allowed,
 *   lowercased, at least 3 code points, an English + Turkish stopword list left out).
 *   Every count is kept here (also 1); the outputs show only words in at least
 *   TOP_WORDS_MIN (2) commits (see shownTopWords).
 * Invalid input policy: never throws; a missing / non-string subject is treated as empty
 * and is skipped by every field but fixups, subjectLength and bodies, which count every
 * non-merge commit (subjectLength as length 0). Empty input → nulls and zeros
 * (subjectLength and bodies null, topWords `[]`).
 */
export function computeMessages(commits) {
  commits = commits ?? [];
  const entries = [];
  let nonMerge = 0;
  let fixups = 0;
  let typos = 0;
  let bodies = 0;
  let known = 0;
  const lengths = [];
  commits.forEach((c, index) => {
    if (isMergeCommit(c)) return;
    // Email-shaped text is cut first (see scrubEmails), so no field (the shown subjects,
    // their lengths, the top word, the typo fixes) is ever built from an address.
    const scrubbed = typeof c?.subject === 'string' ? scrubEmails(c.subject) : '';
    if (c && typeof c === 'object') {
      nonMerge += 1;
      if (isFixupSubject(c.subject)) fixups += 1;
      // The subject is email-scrubbed once (scrubbing commutes with NFC: it cuts whole
      // whitespace-delimited tokens), and dependency bumps ("bump crate-ci/typos") never count.
      if (typeof c.subject === 'string' && !isDepBumpCommit(c) && typoIn(scrubbed)) typos += 1;
      lengths.push(typeof c.subject === 'string' ? codePoints(c.subject.trim()) : 0);
      // git.js readBodies sets a boolean hasBody (and leaves it out when git could not
      // read the bodies). The `body` string is a fallback for hand-built / JSON input and
      // tests (commits from git never carry it). A commit with neither is unknown, not
      // "no body".
      if (typeof c.hasBody === 'boolean' || typeof c.body === 'string') {
        known += 1;
        if (typeof c.hasBody === 'boolean' ? c.hasBody : hasMessageBody(c.body)) bodies += 1;
      }
    }
    const subject = scrubbed.trim();
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
  const commitWords = new Map();
  for (const e of entries) {
    for (const word of subjectWords(e.subject)) commitWords.set(word, (commitWords.get(word) ?? 0) + 1);
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
    typos: typosStat(typos, nonMerge),
    averageLength: entries.length ? Math.round((totalLength / entries.length) * 10) / 10 : 0,
    fixups: fixupsStat(fixups, nonMerge),
    subjectLength: subjectLengthStat(lengths),
    bodies: known === 0 ? null : bodiesStat(bodies, known),
    topWords: topWordsStat(commitWords),
  };
}

/** stats.messages.bodies for `bodies` of `total` (> 0) non-merge commits with a known body (see computeMessages). */
function bodiesStat(bodies, total) {
  if (bodies === 0) return { commits: 0, share: 0 };
  const share = Math.min(Math.round((bodies / total) * 1000) / 1000, bodies < total ? 0.999 : 1);
  return Object.defineProperty({ commits: bodies, share }, EXACT_BODIES, { value: bodies / total });
}

/**
 * stats.messages.bodies as the messages card, the recap and wrapped.md show it:
 * `{commits, pct}`, or null (no object, e.g. a stats.json from before the stat or a
 * history without a non-merge commit, or no commit with a body).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeMessages keeps, else from `share`; below 100 unless the share is exactly 1.
 * All outputs use this, so they agree.
 */
export function shownBodies(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const n = stat.commits;
  const commits = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  if (commits === 0) return null;
  const exact = stat[EXACT_BODIES];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  return { commits, pct: share * 100 };
}

/** stats.messages.subjectLength for the subject `lengths` of every non-merge commit (see computeMessages). */
function subjectLengthStat(lengths) {
  const total = lengths.length;
  if (total === 0) return null;
  const sorted = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(total / 2);
  const median = total % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const over72 = lengths.filter((n) => n > SUBJECT_LIMIT).length;
  if (over72 === 0) return { median, over72: 0, share: 0 };
  const share = Math.min(Math.round((over72 / total) * 1000) / 1000, over72 < total ? 0.999 : 1);
  return Object.defineProperty({ median, over72, share }, EXACT_OVER, { value: over72 / total });
}

/**
 * stats.messages.subjectLength as the messages card, the recap and wrapped.md show it:
 * `{median, over72, pct}`, or null (no object or no usable median, e.g. a stats.json from
 * before the stat, or a history without a non-merge commit).
 * - median: a finite number ≥ 0, as stored (shown with at most one decimal);
 * - over72: a whole number ≥ 0 (anything else → 0);
 * - pct: the over-72 share as a percent for shareLabel in stats/contributors.js, from the
 *   exact ratio computeMessages keeps, else from `share`; 0 when over72 is 0, below 100
 *   unless the share is exactly 1.
 * All outputs use this, so they agree.
 */
export function shownSubjectLength(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const median = stat.median;
  if (typeof median !== 'number' || !Number.isFinite(median) || median < 0) return null;
  const n = stat.over72;
  const over72 = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  if (over72 === 0) return { median, over72: 0, pct: 0 };
  const exact = stat[EXACT_OVER];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  return { median, over72, pct: share * 100 };
}

/** stats.messages.typos for `typos` of `total` non-merge commits (see computeMessages). */
function typosStat(typos, total) {
  if (typos === 0) return { commits: 0, share: 0 };
  const share = Math.min(Math.round((typos / total) * 1000) / 1000, typos < total ? 0.999 : 1);
  return Object.defineProperty({ commits: typos, share }, EXACT_TYPOS, { value: typos / total });
}

/**
 * stats.messages.typos as the messages card, the recap and wrapped.md show it: `{commits,
 * pct}`, or null (no object, e.g. a stats.json from before the stat, or no typo fix).
 * - commits: a positive whole number;
 * - pct: the share as a percent for shareLabel in stats/contributors.js, from the exact
 *   ratio computeMessages keeps, else from `share`; below 100 unless the share is exactly 1.
 * All outputs use this, so they agree.
 */
export function shownTypos(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const n = stat.commits;
  const commits = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  if (commits === 0) return null;
  const exact = stat[EXACT_TYPOS];
  const ratio = typeof exact === 'number' && Number.isFinite(exact) ? exact : stat.share;
  const raw = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const share = ratio === 1 ? 1 : Math.min(raw, 0.999);
  return { commits, pct: share * 100 };
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
