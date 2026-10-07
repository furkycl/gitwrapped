// The story-card set: turns computeStats() output into Wrapped-style SVG cards.
// Pure and deterministic. Every card copes with empty stats (0 commits, null peaks,
// no hot files, null messages) and never prints "null", "undefined" or "NaN".
import { CALLOUT_NOTE, calendarWindow, escapeXml, formatNumber, graphemes, layoutCard as layoutOf, measureText, renderCardWithLayout, truncateMiddle } from './svg.js';

export { formatNumber };
import { renderShareSvg } from './share.js';
import { dayKeyFromEpoch as dayKeyOf, epochDay, mondayOf, WEEKDAY_NAMES } from '../stats/time.js';
import { languageBarRows, languageHeadline, OTHER as OTHER_LANGUAGE } from '../stats/languages.js';
import { busiestOf, daysUpTo, shownLongest, shownLongestBreak } from '../stats/daily.js';
import { monthIndex, monthsFromDays } from '../stats/months.js';
import { hasTeamCard, shareLabel, TOP_CONTRIBUTORS } from '../stats/contributors.js';
import { shownCoAuthors } from '../stats/coauthors.js';
import { shownTimezones, utcLabel } from '../stats/timezones.js';
import { shownReleases } from '../stats/releases.js';
import { scrubEmails } from '../privacy.js';
import { personalityReason } from '../stats/personality.js';
import { yearOverYear } from '../stats/yoy.js';
import { shownBiggestLines } from '../stats/biggest.js';
import { shownCommitSizes } from '../stats/sizes.js';
import { foldCommitTypes, shownCommitTypes } from '../stats/types.js';
import { shownEmoji } from '../stats/emoji.js';
import { shownReverts } from '../stats/reverts.js';
import { shownFileLifecycle } from '../stats/files.js';
import { sizeShares } from '../stats/sizes.js';
import { DEFAULT_LANG, getStrings, languageLabel } from '../i18n/index.js';
import { DEFAULT_COLOR_THEME, isColorTheme } from './themes.js';

export { renderCard, layoutCard, wrapText, escapeXml, measureText, truncateStart, THEMES, CARD_WIDTH, CARD_HEIGHT } from './svg.js';
export { renderShareSvg, SHARE_WIDTH, SHARE_HEIGHT } from './share.js';
export { COLOR_THEMES, COLOR_THEME_NAMES, DEFAULT_COLOR_THEME, GRADIENT_NAMES, isColorTheme, getColorTheme, contrastRatio, relativeLuminance, blendHex } from './themes.js';

/**
 * Every card id, in display order. Optional cards (OPTIONAL_CARD_IDS) are left out of a
 * run when they do not apply, so a card set is CARD_IDS or a subsequence of it: see
 * cardIdsFor(). Cards are numbered by their position in the actual set (01, 02, ...).
 */
export const CARD_IDS = Object.freeze(['intro', 'totals', 'peak-hour', 'streak', 'activity', 'months', 'hot-files', 'languages', 'contributors', 'messages', 'personality', 'outro']);

/**
 * When each optional card applies: `(stats, {today}) => boolean` (see hasTeamCard in
 * stats/contributors.js and hasMonthsCard below).
 */
const APPLIES = {
  months: (stats, opts) => hasMonthsCard(stats, opts),
  contributors: hasTeamCard,
};

/** Cards shown only when they apply (see cardIdsFor). */
export const OPTIONAL_CARD_IDS = Object.freeze(Object.keys(APPLIES));

/**
 * The ids of the cards built for `stats`, in display order: CARD_IDS without the
 * optional cards that do not apply (the monthly timeline when the commits fall in a single
 * calendar month, see hasMonthsCard; the contributors card for a single-author history,
 * or for an --author with no commits, see hasTeamCard). `today` ('YYYY-MM-DD', as for
 * buildCards) leaves future-dated days out of the month count.
 */
export function cardIdsFor(stats, { today } = {}) {
  return CARD_IDS.filter((id) => !APPLIES[id] || APPLIES[id](stats, { today: text(today) }));
}

/** The most months the monthly timeline card shows (the most recent ones; stats.json keeps all). */
export const MAX_SHOWN_MONTHS = 24;

/**
 * The months the monthly timeline card is drawn from, as `{months, peak}` (see
 * stats/months.js), built from stats.daily: with a valid `today`, days after today + 1
 * (future-dated commits) are left out, like on the activity calendar, so a commit dated
 * 2099 does not stretch the timeline; when every day is in the future nothing is left
 * (and the card is not built). Only without stats.daily is stats.months used as it is
 * (invalid entries dropped).
 */
export function shownMonths(stats, today) {
  const all = daysUpTo(stats?.daily?.days, null);
  if (all.length > 0) {
    const t = epochDay(text(today) ?? '');
    return monthsFromDays(t === null ? all : all.filter((x) => epochDay(x.day) <= t + 1));
  }
  const raw = Array.isArray(stats?.months?.months) ? stats.months.months : null;
  if (!raw) return monthsFromDays(all);
  const months = raw
    .filter((m) => monthIndex(m?.month) !== null)
    .map((m) => ({ month: m.month, commits: Math.max(0, num(m.commits)) }))
    .sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  return { months, peak: peakMonth(months) };
}

/** The month with the most commits (ties → the earliest), or null when none has any. */
function peakMonth(months) {
  let peak = null;
  for (const m of months) if (m.commits > 0 && (!peak || m.commits > peak.commits)) peak = m;
  return peak ? { ...peak } : null;
}

/**
 * Whether the monthly timeline card applies: the commits (future-dated days left out
 * with `today`, see shownMonths) span at least two calendar months.
 */
export function hasMonthsCard(stats, { today } = {}) {
  const { months } = shownMonths(stats, today);
  return months.length >= 2 && months.some((m) => m.commits > 0);
}

/** The default string table (see src/i18n). */
const EN = getStrings(DEFAULT_LANG);

/** A finite number, else 0. */
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);


/** A line count with a leading sign ("+12" / "−3"); 0 → "0". Negatives clamp to 0. */
const signedLines = (n, sign, L = EN) => {
  const v = Math.max(0, Math.round(num(n)));
  return v === 0 ? '0' : `${sign}${L.num(v)}`;
};

/** "1 commit", "2,048 commits" (`unit` is a key of the string table's `units`). */
const plural = (n, unit, L = EN) => `${L.num(n)} ${num(n) === 1 ? L.units[unit][0] : L.units[unit][1]}`;

const basename = (path) => String(path).split('/').filter(Boolean).pop() ?? String(path);
/** The directory part of a path, with its trailing '/' ('' for a top-level file). */
const dirname = (path) => {
  const parts = String(path).split('/').filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
};

/** 'YYYY-MM-DD' → {year, month (1-12), day}, or null when it is not that shape. */
function parseDay(s) {
  const key = typeof s === 'string' ? s.trim() : '';
  if (epochDay(key) === null) return null; // wrong shape or impossible date (Feb 31)
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day, key };
}

/**
 * 'YYYY-MM-DD' → "Oct 4, 2026" (`lang` 'tr': "4 Eki 2026"; month names from the string
 * table, no locale lookup); else null.
 */
export function formatDay(s, lang) {
  const d = parseDay(s);
  return d ? getStrings(lang).date(d.day, d.month, d.year) : null;
}

/**
 * A human date range from two 'YYYY-MM-DD' days, earliest first whatever the argument
 * order: "Oct 4, 2026" (same day), "Oct 4 – Oct 5, 2026" (same year),
 * "Dec 30, 2025 – Jan 2, 2026". One valid day and one missing/invalid → that day alone;
 * neither valid → the given strings as they are (shown once if equal); both missing → ''.
 */
export function formatDateRange(first, last, lang) {
  let a = parseDay(first);
  let b = parseDay(last);
  if (a && b && epochDay(a.key) > epochDay(b.key)) [a, b] = [b, a];
  if (!a || !b) {
    const one = a ?? b;
    if (one) return formatDay(one.key, lang);
    const raw = [first, last].map((x) => (typeof x === 'string' ? text(x) : null)).filter(Boolean);
    return [...new Set(raw)].join(' – ');
  }
  if (a.key === b.key) return formatDay(a.key, lang);
  if (a.year === b.year) return getStrings(lang).sameYearRange(a.day, a.month, b.day, b.month, b.year);
  return `${formatDay(a.key, lang)} – ${formatDay(b.key, lang)}`;
}
const quote = (s) => `“${s}”`;
const text = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);

/** Cap very long text (a 100 KB commit subject) at MAX_TEXT code points before layout; null stays null. */
const MAX_TEXT = 500;
const clip = (s) => {
  if (s === null || s.length <= MAX_TEXT) return s;
  // Count code points (not UTF-16 units) up to one past the cap; never split a pair.
  const cps = [];
  for (const ch of s) {
    cps.push(ch);
    if (cps.length > MAX_TEXT) break;
  }
  // At most MAX_TEXT code points, the ellipsis included.
  return cps.length <= MAX_TEXT ? s : `${cps.slice(0, MAX_TEXT - 1).join('')}…`;
};

/** An average with at most one decimal, e.g. 42.53 → "42.5", 23 → "23", 1234.5 → "1,234.5". */
const formatAverage = (n, L = EN) => L.dec(num(n));

/** Upper bounds (exclusive) of the hours each quip in the string table's peak.quips covers. */
const QUIP_HOURS = [5, 9, 12, 14, 18, 22];

function hourQuip(hour, L) {
  if (hour === null || hour === undefined) return '';
  const i = QUIP_HOURS.findIndex((h) => hour < h);
  return L.peak.quips[i === -1 ? QUIP_HOURS.length : i];
}

/**
 * The calendar year when `since`..`until` is exactly Jan 1 – Dec 31 of one year (what
 * --year YYYY expands to), as 'YYYY'; else null.
 */
export function windowYear(since, until) {
  const a = parseDay(since);
  const b = parseDay(until);
  if (!a || !b || a.year !== b.year) return null;
  return a.month === 1 && a.day === 1 && b.month === 12 && b.day === 31 ? String(a.year) : null;
}

/**
 * The requested date window as short text, or null when neither bound is given:
 * "2025" (a whole calendar year), "Jan 3 – Mar 9, 2025", "since Jan 3, 2025",
 * "until Mar 9, 2025". `lang` (an src/i18n code) picks the language ('tr': "3 Oca 2025 ve
 * sonrası").
 */
export function windowLabel({ since, until, lang } = {}) {
  since = text(since);
  until = text(until);
  const L = getStrings(lang);
  if (since && until) return windowYear(since, until) ?? formatDateRange(since, until, lang);
  if (since) return L.since(formatDay(since, lang) ?? since);
  if (until) return L.until(formatDay(until, lang) ?? until);
  return null;
}

/**
 * How an --author value appears on images, so a shared card never publishes an email
 * address or its domain: the local part before the first "@" ("ada@example.com" →
 * "ada", "a@b@c.com" → "a"); for "Name <email>" just the name ("Ada L. <ada@x.io>" →
 * "Ada L."); for a regex alternation ("a@x.io|b@y.io", "a@x.io\\|b@y.io") the first
 * alternative. A value without "@" is shown as given; null when nothing is left
 * ("@example.com"), and the cards then leave the author out.
 */
export function authorName(author) {
  let a = text(author);
  if (!a) return null;
  a = a.split(/\\?\|/)[0].trim();
  const lt = a.indexOf('<');
  if (lt > 0) a = a.slice(0, lt).trim();
  else if (lt === 0) a = a.slice(1).replace(/>.*$/s, '').trim();
  const at = a.indexOf('@');
  if (at >= 0) a = a.slice(0, at).trim();
  return a || null;
}

/**
 * The first and last active day the cards show as the date range: totals.firstDay /
 * lastDay, except that with `today` future-dated days (after today + 1, see daysUpTo)
 * are left out, like on the activity calendar, so a commit dated 2099 does not stretch
 * "Mar 1 – Oct 5, 2026" to 2099. The totals still count those commits.
 */
export function shownDayRange(stats, today) {
  const t = stats?.totals ?? {};
  const all = daysUpTo(stats?.daily?.days, null);
  const kept = daysUpTo(all, today);
  if (kept.length === 0 || kept.length === all.length) return { firstDay: t.firstDay, lastDay: t.lastDay };
  const epochs = kept.map((x) => epochDay(x.day));
  return { firstDay: dayKeyOf(Math.min(...epochs)), lastDay: dayKeyOf(Math.max(...epochs)) };
}

/**
 * The per-repo rows of a multi-repo run (stats.repos, see stats/repos.js), or null for a
 * single repo (no rows, or just one): cards then look exactly as they always did.
 */
export function repoRows(stats) {
  const rows = (Array.isArray(stats?.repos) ? stats.repos : []).filter((r) => text(r?.name));
  return rows.length > 1 ? rows : null;
}

/**
 * The name the cards, share image, viewer title and recap use for the run: "3 repos"
 * (in `lang`) for a multi-repo run (see repoRows), else `repoName` (default "your repo").
 */
export function displayRepoName(stats, { repoName, lang } = {}) {
  const L = getStrings(lang);
  const rows = repoRows(stats);
  return rows ? L.repos.name(rows.length) : (text(repoName) ?? L.yourRepo);
}

/** How many repos a breakdown names before folding the rest into "+N more". */
const SHOWN_REPOS = 3;

/**
 * At most SHOWN_REPOS + 1 rows: every repo when that many or fewer, else the first
 * SHOWN_REPOS and one folded row `{name: "+N more", ...sums}` (numeric keys summed).
 */
function foldRepos(rows, L) {
  if (rows.length <= SHOWN_REPOS + 1) return rows.map((r) => ({ ...r, name: clip(text(r.name)) }));
  const rest = rows.slice(SHOWN_REPOS);
  const sum = (k) => rest.reduce((n, r) => n + num(r[k]), 0);
  return [
    ...rows.slice(0, SHOWN_REPOS).map((r) => ({ ...r, name: clip(text(r.name)) })),
    { name: L.repos.moreBar(rest.length), more: true, commits: sum('commits'), linesAdded: sum('linesAdded'), linesRemoved: sum('linesRemoved'), filesTouched: sum('filesTouched') },
  ];
}

/** The intro's "Featuring a, b and c." line: up to SHOWN_REPOS names, then "N more". */
function featuring(rows, L) {
  const names = rows.map((r) => clip(text(r.name)));
  const list = names.length <= SHOWN_REPOS + 1 ? names : [...names.slice(0, SHOWN_REPOS), L.repos.andMore(names.length - SHOWN_REPOS)];
  return L.repos.featuring(L.andList(list));
}

/**
 * The intro's optional "It all began with" panel (stats.firstCommit, see stats/first.js):
 * the quoted subject (shrunk, then cut with "…" to fit one line), with its day, short hash
 * and, in a multi-repo run, its repo below; null without one. It is `optional`, so when
 * it does not fit the card is laid out exactly as without it.
 */
/**
 * The began panel's note: `head` ("day · hash") and then " · repo" when it fits on the note
 * line; a long repo label is cut with "…" instead (keeping at least one character), and
 * left out when even that does not fit, so the day and hash always show whole.
 */
function withRepo(head, repo) {
  if (!repo) return head;
  return fitNoteSlot((r) => (head ? `${head} · ${r}` : r), repo) ?? head;
}

function beganCallout(s, L) {
  const f = s.firstCommit;
  if (!f || typeof f !== 'object') return null;
  // Control / bidi characters dropped first, so a subject made only of them reads as none.
  // Email-shaped text is cut again here (stats already does), so no input can show one.
  const subject = clip(text(typeof f.subject === 'string' ? plain(scrubEmails(f.subject)) : null));
  const head = [formatDay(f.date, L.code), text(typeof f.hash === 'string' ? scrubEmails(f.hash) : null)].filter(Boolean).join(' · ');
  const note = withRepo(head, clip(text(typeof f.repo === 'string' ? plain(f.repo) : null)));
  return { kind: 'callout', optional: true, title: L.intro.beganTitle, value: subject ? quote(subject) : L.messages.noSubject, note };
}

function intro(s, ctx) {
  const { L } = ctx;
  const I = L.intro;
  const commits = num(s.totals?.commits);
  const lead = commits === 0 ? L.empty : I.lead;
  const who = authorName(ctx.author);
  const starring = who ? [I.starring(who)] : [];
  // A multi-repo run names its repos first; the lead moves last, so it is the sentence
  // dropped when the subtitle runs out of lines.
  const parts = ctx.repos ? [featuring(ctx.repos, L), ...starring, lead] : [lead, ...starring];
  const shown = shownDayRange(s, ctx.today);
  const range = formatDateRange(shown.firstDay, shown.lastDay, L.code);
  const year = windowYear(ctx.since, ctx.until);
  const title = year ? I.yearTitle(year) : I.soFar;
  const began = commits > 0 ? beganCallout(s, L) : null;
  const main = { kind: 'callout', title, value: range || plural(commits, 'commit', L), note: I.toUnwrap(commits) };
  return {
    eyebrow: I.eyebrow,
    big: ctx.repoName,
    title: I.title,
    titleSize: 136,
    subtitle: parts.join(' '),
    chart: commits > 0
      ? (began ? [began, main] : main)
      : year
        ? { kind: 'callout', title, value: I.quietYear, note: I.noCommitsIn(year) }
        : { kind: 'callout', title, value: I.chapterOne, note: I.firstCommit },
  };
}

/** The most list rows a card draws (see renderCard's `lines`). */
const MAX_ROWS = 6;

/** The smallest big number (px) the totals card of a multi-repo run shrinks to. */
const TOTALS_BIG_MIN = 140;

function totals(s, { L, repos }) {
  const T = L.totals;
  const t = s.totals ?? {};
  const commits = num(t.commits);
  if (commits === 0) {
    return { eyebrow: T.eyebrow, big: '0', title: L.units.commit[1], subtitle: L.empty };
  }
  const days = num(t.activeDays);
  const perDay = days > 0 ? Math.round((commits / days) * 10) / 10 : 0;
  const rows = [
    { label: T.activeDays, value: L.num(days) },
    { label: T.filesTouched, value: L.num(t.filesTouched) },
  ];
  if (num(t.authors) > 1) rows.push({ label: T.contributors, value: L.num(t.authors) });
  // --year: the change since the previous year (at most 6 rows in all).
  const yoy = yearOverYear(s);
  if (yoy) {
    rows.push(
      { label: L.yoy.commits(yoy.previousYear), value: L.delta(yoy.commits) },
      { label: L.yoy.lines(yoy.previousYear), value: L.delta(yoy.lines) },
      { label: L.yoy.activeDays(yoy.previousYear), value: L.delta(yoy.activeDays) },
    );
  }
  const split = {
    kind: 'split',
    title: T.linesChanged,
    segments: [
      { label: T.linesAdded, value: signedLines(t.linesAdded, '+', L), amount: Math.max(0, num(t.linesAdded)) },
      { label: T.linesRemoved, value: signedLines(t.linesRemoved, '−', L), amount: Math.max(0, num(t.linesRemoved)) },
    ],
  };
  // The commit size mix (stats.commitSizes) as a stacked bar, only when there is one;
  // without it the card is exactly as before.
  const sizes = sizeStack(s, L);
  // A multi-repo run adds commits per repo (the split chart stays first: when space is
  // short, charts are dropped from the end, so the size mix, last, goes before the repo bars).
  const charts = [split, ...(repos ? [repoCommitBars(repos, L)] : []), ...(sizes ? [sizes] : [])];
  const spec = {
    eyebrow: T.eyebrow,
    big: L.num(commits),
    title: commits === 1 ? L.units.commit[0] : L.units.commit[1],
    subtitle: perDay > 0 ? T.perDay(perDay) : T.everyOne,
    lines: rows,
    // The commit count stays the hero: in a multi-repo run it keeps at least 140px while
    // the charts are compacted or dropped (--year adds three rows).
    chart: charts.length === 1 ? split : charts,
    ...(repos ? { bigMin: TOTALS_BIG_MIN } : {}),
  };
  // Commits with a co-author (stats.coAuthors) as one more row, when the team card does not
  // show them (see pairingOnTeam) and the row fits in spare room only.
  const row = pairingOnTeam(s, L) ? null : pairedRow(s, L);
  const withPaired = row ? withSpareRow(spec, row, L) : spec;
  // Files born / buried (stats.fileLifecycle) after it, again in spare room only: it never
  // displaces the pairing row or anything else (it is always in the recap, wrapped.md and
  // stats.json).
  const lifecycle = lifecycleRow(s, L);
  return lifecycle ? withSpareRow(withPaired, lifecycle, L) : withPaired;
}

/**
 * The totals card's files born / buried row (stats.fileLifecycle, see shownFileLifecycle):
 * "Files born / buried" and "12 / 3"; null when no file was added or deleted.
 */
function lifecycleRow(s, L) {
  const lc = shownFileLifecycle(s.fileLifecycle);
  if (!lc) return null;
  return { label: L.totals.fileLifecycle, value: L.totals.fileLifecycleValue(lc.added, lc.deleted) };
}

/**
 * The totals card's pairing row (stats.coAuthors, see shownCoAuthors): "Paired
 * (top: Ada)" and the count; null when no commit was paired.
 */
function pairedRow(s, L) {
  const co = shownCoAuthors(s.coAuthors);
  if (!co) return null;
  const top = co.top ? clip(text(plain(scrubEmails(co.top)))) : null;
  return { label: L.pairing.row(top), value: L.num(co.paired) };
}

/**
 * `spec` with `row` added after its rows when that changes nothing else: there is room
 * for another row, the same charts are drawn and no other block (the big number, title,
 * subtitle, charts) shrinks or grows; else `spec` unchanged.
 */
function withSpareRow(spec, row, L) {
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (lines.length >= MAX_ROWS) return spec;
  const next = { ...spec, lines: [...lines, row] };
  const heights = (l) => l.blocks.filter((b) => b.kind !== 'rows').map((b) => Math.round((b.bottom - b.top) * 10));
  const before = layoutOf({ ...spec, lang: L.code });
  const after = layoutOf({ ...next, lang: L.code });
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  return same(before.drawnCharts, after.drawnCharts) && same(heights(before), heights(after)) ? next : spec;
}

/**
 * The commit size mix (see shownCommitSizes) as a 4-segment stacked bar for the totals
 * card: tiny → large, each with its share; null when there is nothing to show.
 */
function sizeStack(s, L) {
  const mix = shownCommitSizes(s.commitSizes);
  if (!mix) return null;
  const T = L.totals;
  return {
    kind: 'stack',
    // Purely additive: left out when the card is short of space, before anything shrinks.
    optional: true,
    title: T.commitSizes,
    segments: mix.map((b) => {
      const pct = sizeShareText(b, mix, L);
      return { label: T.sizes[b.id], value: pct, amount: b.count, title: T.sizeTitle(T.sizes[b.id], T.sizeRanges[b.id], b.count, pct) };
    }),
  };
}

/** Commits per repo as bars (the totals card of a multi-repo run). */
function repoCommitBars(repos, L) {
  return {
    kind: 'hbars',
    title: L.repos.commitsByRepo,
    items: foldRepos(repos, L).map((r) => {
      const added = signedLines(r.linesAdded, '+', L);
      const removed = signedLines(r.linesRemoved, '−', L);
      return { label: r.name, sub: `${added} / ${removed}`, subWhole: true, value: plural(r.commits, 'commit', L), amount: num(r.commits), title: L.repos.commitsBarTitle(r.name, r.commits, added, removed) };
    }),
  };
}

/** Distinct files touched per repo as bars (the hot-files card of a multi-repo run). */
function repoFileBars(repos, L) {
  return {
    kind: 'hbars',
    title: L.repos.filesByRepo,
    items: foldRepos(repos, L).map((r) => ({ label: r.name, value: plural(r.filesTouched, 'file', L), amount: num(r.filesTouched), title: L.repos.filesBarTitle(r.name, r.filesTouched) })),
  };
}

/** `n` finite non-negative counts from `arr` (missing / bad entries → 0). */
const counts = (arr, n) => Array.from({ length: n }, (_, i) => Math.max(0, num(Array.isArray(arr) ? arr[i] : 0)));
/** Indices holding the (non-zero) maximum. */
const peaks = (values) => {
  const max = Math.max(0, ...values);
  return max > 0 ? values.flatMap((v, i) => (v === max ? [i] : [])) : [];
};

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** An hour (0-23) as the language says it ("9 PM", "21:00"); `fallback` for anything else. */
const hourText = (hour, L, fallback) => (Number.isInteger(hour) && hour >= 0 && hour < 24 ? L.hourLabel(hour) : fallback);

/** The commits-by-hour and by-weekday bar charts for the power-hour card. */
function habitCharts(h, L) {
  const hours = counts(h.byHour, 24);
  const week = counts(h.byWeekday, 7);
  const days = WEEK_ORDER.map((d) => week[d]);
  const bar = (values, labelOf, titles) => {
    const hl = peaks(values);
    return { values, labels: values.map((_, i) => labelOf(i)), titles, highlight: hl, peakLabel: hl.length ? L.num(values[hl[0]]) : '' };
  };
  const P = L.peak;
  const dayName = (d) => (L === EN ? WEEKDAY_NAMES[d] : L.weekdays[d]);
  return [
    { kind: 'bars', title: P.byHour, maxBarHeight: 240, ...bar(hours, (i) => L.hourTicks[i] ?? '', hours.map((v, i) => P.barTitle(hourText(i, L, ''), v))) },
    { kind: 'bars', title: P.byWeekday, maxBarHeight: 150, ...bar(days, (i) => L.weekLetters[WEEK_ORDER[i]], days.map((v, i) => P.barTitle(dayName(WEEK_ORDER[i]), v))) },
  ];
}

/** The power hour as shown: stats' label in English, else the hour in the card's language. */
function peakHourText(h, L) {
  const label = text(h?.peakHourLabel);
  if (!label || L === EN) return label;
  return hourText(h.peakHour, L, label);
}

/** The busiest weekday's name: stats' own in English, else from the string table. */
function peakDayText(h, L) {
  const day = text(h?.peakWeekdayName);
  if (!day || L === EN) return day;
  return Number.isInteger(h.peakWeekday) && L.weekdays[h.peakWeekday] ? L.weekdays[h.peakWeekday] : day;
}

function peakHour(s, { L }) {
  const P = L.peak;
  const h = s.habits ?? {};
  const label = peakHourText(h, L);
  if (!label) {
    return { eyebrow: P.eyebrow, big: P.noneBig, title: P.noneTitle, subtitle: P.noneSubtitle, chart: habitCharts(h, L) };
  }
  const lead = h.peakHourTied ? P.tied(label, h.peakHourCount) : P.landed(h.peakHourCount, label);
  const parts = [`${lead} ${hourQuip(h.peakHour, L)}`];
  const day = peakDayText(h, L);
  const busiest = day ? (h.peakWeekdayTied ? P.dayTied(day) : P.dayBusiest(day)) : null;
  if (busiest) parts.push(busiest);
  const spec = {
    eyebrow: P.eyebrow,
    big: label,
    title: h.peakHourTied ? P.titleTied : P.title,
    subtitle: parts.join(' '),
    chart: habitCharts(h, L),
  };
  // Commits from two or more time zones (stats.timezones): one more sentence or one row,
  // always shown (see withTimezones); without it the card is exactly as before.
  const tz = shownTimezones(s.timezones);
  return tz ? withTimezones(spec, tz, { lead, busiest }, L) : spec;
}

/** The text a layout's subtitle block draws, its lines joined with spaces (XML-escaped). */
const subtitleText = (layout) => {
  const svg = layout.blocks.find((b) => b.kind === 'subtitle')?.svg ?? '';
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ').replace(/\s+/g, ' ').trim();
};

/**
 * The power-hour card `spec` with its time zones (a shownTimezones() value), always: in
 * the first of these that fits, where fitting means the same charts are drawn, nothing
 * shrinks more than allowed and an added sentence shows whole (the subtitle drops whole
 * trailing sentences that do not fit, see wrapAtSentence in svg.js):
 * 1. "Committed from 3 time zones, mostly UTC+03:00." at the end of the subtitle, else a
 *    "3 time zones · mostly UTC+03:00" row below it, with nothing shrinking;
 * 2. the same with the big word one step (15%) smaller, when nothing had shrunk (as for the
 *    messages card's emoji row);
 * 3. the sentence in place of the hour's quip, then in place of the quip and the weekday
 *    sentence, each with nothing shrinking, then one step smaller as in 2;
 * 4. as a last resort, the quip and weekday sentence replaced by the sentence, else the
 *    row, with whatever shrinking (or charts left out) the layout needs to fit it.
 * "mostly" is left out when two offsets tie for the most commits.
 */
function withTimezones(spec, tz, { lead, busiest }, L) {
  const top = tz.top ? utcLabel(tz.top) : null;
  const sentence = L.peak.timezones(tz.count, top);
  const shownSentence = escapeXml(sentence).replace(/\s+/g, ' ');
  const base = layoutOf({ ...spec, lang: L.code });
  const shows = (candidate, l) => candidate.subtitle === spec.subtitle || subtitleText(l).includes(shownSentence);
  const fits = (candidate, more) => {
    const l = layoutOf({ ...candidate, lang: L.code });
    return l.drawnCharts.length === base.drawnCharts.length && l.drawnCharts.every((x, i) => x === base.drawnCharts[i])
      && l.shrinkSteps <= base.shrinkSteps + more && shows(candidate, l);
  };
  const withSubtitle = (text) => ({ ...spec, subtitle: text ? `${text} ${sentence}` : sentence });
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  const row = { label: L.recap.timezonesValue(tz.count), value: top ? L.recap.mostly(top) : '' };
  const withRow = { ...spec, lines: [...lines.slice(0, MAX_ROWS - 1), row] };
  const appended = withSubtitle(spec.subtitle);
  const noQuip = withSubtitle([lead, busiest].filter(Boolean).join(' '));
  const leadOnly = withSubtitle(lead);
  const steps = base.shrinkSteps === 0 ? [0, 1] : [0];
  for (const more of steps) for (const c of [appended, withRow]) if (fits(c, more)) return c;
  for (const c of [noQuip, leadOnly]) for (const more of steps) if (fits(c, more)) return c;
  // Last resort: the layout shrinks (or leaves out charts) as it needs to.
  if (shows(leadOnly, layoutOf({ ...leadOnly, lang: L.code }))) return leadOnly;
  return withRow;
}

/**
 * "at the end of 2025" / "on Mar 9, 2025" when the window ended before `ctx.today` (so the
 * current streak is the one running when it closed), else null.
 */
function windowEnd(ctx) {
  const end = parseDay(ctx.until);
  const today = parseDay(ctx.today);
  if (!end || !today || epochDay(end.key) >= epochDay(today.key)) return null;
  const year = windowYear(ctx.since, ctx.until);
  const S = ctx.L.streak;
  return year ? S.endOfYear(year) : S.onDay(formatDay(ctx.until, ctx.L.code) ?? ctx.until);
}

function streak(s, ctx) {
  const { L } = ctx;
  const S = L.streak;
  // Future-dated days (after today + 1) never make the longest streak shown (daily.js).
  const longest = shownLongest(s, ctx.today) ?? {};
  const current = s.streaks?.current ?? {};
  const len = num(longest.length);
  const cur = num(current.length);
  const end = windowEnd(ctx);
  const chart = {
    kind: 'hbars',
    size: 'large',
    title: end ? S.chartTitleEnd : S.chartTitle,
    items: [
      { label: S.longest, value: plural(len, 'day', L), amount: len },
      { label: end ? S.windowEnd : S.current, value: plural(cur, 'day', L), amount: cur },
    ],
  };
  if (len === 0) {
    return { eyebrow: S.eyebrow, big: '0', title: S.zeroTitle, subtitle: S.zeroSubtitle, chart };
  }
  const range = len > 1 && text(longest.start) && text(longest.end)
    ? formatDateRange(longest.start, longest.end, L.code)
    : (formatDay(longest.start, L.code) ?? text(longest.start));
  chart.items[0].title = range ? S.longestTitle(len, range) : '';
  const pause = breakCallout(s, ctx);
  return {
    eyebrow: S.eyebrow,
    big: L.num(len),
    title: len === 1 ? S.titleOne : S.titleMany,
    subtitle: [
      range ? (len === 1 ? S.onRange(range) : S.fromRange(range)) : '',
      streakNow(cur, end, L),
    ].filter(Boolean).join(' '),
    chart: pause ? [chart, pause] : chart,
  };
}

/**
 * The streak card's longest-break panel (stats.streaks.longestBreak, future-dated days
 * left out as for the longest streak, see stats/daily.js shownLongestBreak): caption,
 * "N days off" and the two active days around the gap; null without a break (then the
 * card is exactly as before).
 */
function breakCallout(s, { L, today }) {
  const S = L.streak;
  const b = shownLongestBreak(s, today);
  const days = Number.isInteger(b?.days) ? b.days : 0;
  if (days <= 0) return null;
  const from = formatDay(b.from, L.code);
  const to = formatDay(b.to, L.code);
  return {
    kind: 'callout',
    title: S.breakTitle,
    value: S.breakValue(days),
    note: from && to ? S.breakNote(from, to) : '',
  };
}

/** The current-streak sentence; `end` ("at the end of 2025") phrases it for a past window. */
function streakNow(cur, end, L) {
  const S = L.streak;
  if (end) return cur > 0 ? S.wasOn(cur, end) : S.wasNone(end);
  return cur > 0 ? S.isOn(cur) : S.isNone;
}

/** Busiest day (ties → earliest) and distinct Monday-first weeks of `days` ([{day, commits}]). */
function dailySummary(days) {
  const weeks = new Set(days.map((x) => mondayOf(epochDay(x.day))));
  return { busiest: busiestOf(days), activeWeeks: weeks.size };
}

/** Days a window must end before "today" to count as a dormant repo's final months. */
const DORMANT_DAYS = 30;

/**
 * Whether a history whose last active day is `lastDay` (an epoch day) went quiet as of
 * `asOf` ('YYYY-MM-DD'): it ended more than DORMANT_DAYS before. Used by the activity and
 * months cards, so both agree. An invalid `asOf` or `lastDay` → false.
 */
function wentQuiet(lastDay, asOf) {
  const a = epochDay(asOf ?? '');
  return a !== null && Number.isFinite(lastDay) && a - lastDay > DORMANT_DAYS;
}

function activity(s, ctx = { L: EN }) {
  const d = s.daily ?? {};
  let days = (Array.isArray(d.days) ? d.days : [])
    .filter((x) => parseDay(x?.day) && num(x?.commits) > 0)
    .map((x) => ({ day: parseDay(x.day).key, commits: num(x.commits) }));
  const { L } = ctx;
  const A = L.activity;
  if (days.length === 0) {
    return { eyebrow: A.calendar, big: '0', title: A.title(0), subtitle: L.empty, chart: { kind: 'calendar', days: [] } };
  }
  // Future-dated days (clock skew) would stretch the grid past today and push real weeks
  // out of the 53-week window. The calendar ends at the day after `ctx.today` at the
  // latest (the same author-timezone grace day as the current streak, see streaks.js);
  // later days are left off the grid (unless every day is in the future: then there is
  // nothing better to show).
  const todayKey = parseDay(ctx.today)?.key;
  let dropped = false;
  if (todayKey) {
    const maxDay = epochDay(todayKey) + 1;
    const kept = days.filter((x) => epochDay(x.day) <= maxDay);
    if (kept.length > 0 && kept.length < days.length) {
      days = kept;
      dropped = true;
    }
  }
  const win = calendarWindow(days);
  let busiest = d.busiest && parseDay(d.busiest.day) && num(d.busiest.commits) > 0 ? d.busiest : null;
  let weeks = num(d.activeWeeks);
  if (dropped) ({ busiest, activeWeeks: weeks } = dailySummary(days));
  let eyebrow;
  if (win.clipped) {
    // The grid shows the most recent 53 weeks only: the headline counts that window too.
    days = days.filter((x) => epochDay(x.day) >= win.start);
    ({ busiest, activeWeeks: weeks } = dailySummary(days));
    // A repo that went quiet long ago: its grid ends well before today, so "your last 12
    // months" would be wrong; name the month the window ends instead.
    const lastDay = Math.max(...days.map((x) => epochDay(x.day)));
    const end = parseDay(dayKeyOf(lastDay));
    eyebrow = end && wentQuiet(lastDay, ctx.asOf)
      ? A.monthsTo(end.month, end.year)
      : A.last12;
  } else {
    const epochs = days.map((x) => epochDay(x.day));
    const span = Math.max(...epochs) - Math.min(...epochs) + 1;
    eyebrow = span >= 300 ? A.year : A.calendar;
  }
  const parts = [];
  if (busiest) parts.push(A.busiest(formatDay(busiest.day, L.code), busiest.commits));
  if (weeks > 0) parts.push(A.weeks(weeks));
  return {
    eyebrow,
    big: L.num(days.length),
    title: A.title(days.length),
    subtitle: parts.join(' '),
    chart: { kind: 'calendar', days },
  };
}

/**
 * stats.hotFiles with a non-empty string path, email-shaped text in each path cut again
 * (stats already does, see stats/files.js), so no input can show an address.
 */
const shownHotFiles = (s) => (Array.isArray(s?.hotFiles) ? s.hotFiles : [])
  .filter((f) => typeof f?.path === 'string' && text(scrubEmails(f.path)))
  .map((f) => ({ ...f, path: scrubEmails(f.path) }));

function hotFiles(s, { L, repos }) {
  const H = L.hotFiles;
  const files = shownHotFiles(s);
  if (files.length === 0) {
    return { eyebrow: H.eyebrow, big: H.noneBig, title: H.noneTitle, subtitle: H.noneSubtitle, ...(repos ? { chart: repoFileBars(repos, L) } : {}) };
  }
  const [top] = files;
  const tied = files.length > 1 && num(files[1].commits) === num(top.commits);
  return {
    eyebrow: H.eyebrow,
    big: basename(top.path),
    title: tied ? H.titleTied : H.title,
    subtitle: H.subtitle(top.commits, signedLines(top.linesAdded, '+', L), signedLines(top.linesRemoved, '−', L)),
    chart: hotFileCharts(files, repos, L),
  };
}

/**
 * The hot-files card's charts: the most-touched files (paths of a multi-repo run start
 * with the repo label, shown dimmed after the file name), plus, for several repos, the
 * files touched per repo; then the file list is cut to 3 so both fit.
 */
function hotFileCharts(files, repos, L) {
  const H = L.hotFiles;
  const list = {
    kind: 'hbars',
    title: H.chartTitle,
    items: files.slice(0, repos ? 3 : 5).map((f) => ({
      label: basename(f.path),
      sub: dirname(f.path),
      value: plural(f.commits, 'commit', L),
      amount: num(f.commits),
      truncate: 'middle',
      title: H.barTitle(f.path, f.commits, signedLines(f.linesAdded, '+', L), signedLines(f.linesRemoved, '−', L)),
    })),
  };
  return repos ? [list, repoFileBars(repos, L)] : list;
}

/** A whole-number share as text; a non-zero amount that rounds to 0% reads "<1%". */
export const pctText = (share, amount, L = EN) => (num(share) === 0 && num(amount) > 0 ? `<${L.pct(1)}` : L.pct(Math.round(num(share))));

/**
 * One bucket of a shownCommitSizes() mix as text, by the languages card's rule: a bucket
 * with commits never reads "0%" (under 1% of the commits reads "<1%", so equal counts
 * always read the same), and none reads 100% while another bucket has commits (capped at
 * 99%). Card, recap and wrapped.md all use this; stats.json keeps the raw shares.
 */
export const sizeShareText = (b, mix, L = EN) => {
  const count = num(b.count);
  if (count <= 0) return L.pct(0);
  const total = mix.reduce((a, x) => a + Math.max(0, num(x.count)), 0);
  if ((count / total) * 100 < 1) return `<${L.pct(1)}`;
  const others = mix.some((x) => x !== b && num(x.count) > 0);
  return L.pct(others ? Math.min(99, Math.round(num(b.share))) : Math.round(num(b.share)));
};

/**
 * Up to five languages as bars (the headline language always among them), the rest and
 * unknown file types folded into one "Other" bar. No bar reads 100% while others exist.
 * The rows come from languageBarRows (stats/languages.js), shared with wrapped.md.
 */
function languageBars(h, L) {
  const G = L.languages;
  const items = languageBarRows(h).map((r) => {
    const label = r.other ? G.other : languageLabel(r.name, L);
    const pct = pctText(r.share, r.amount, L);
    return { label, sub: plural(r.files, 'file', L), value: pct, amount: r.amount, title: G.barTitle(label, r.lines, r.files, pct) };
  });
  return { kind: 'hbars', title: h.basis === 'files' ? G.shareOfFiles : G.shareOfLines, items };
}

function languages(s, { L }) {
  const G = L.languages;
  const l = s.languages ?? {};
  const h = languageHeadline(l);
  const eyebrow = G.eyebrow;
  if (!h) {
    const files = (Array.isArray(l.languages) ? l.languages : []).reduce((n, x) => n + num(x?.files), 0);
    return {
      eyebrow,
      big: G.noneBig,
      title: G.noneTitle,
      subtitle: files > 0 ? G.noneFiles(files) : G.noneAtAll,
    };
  }
  // The share is the headline number (a language name as the big word would start with a
  // glyph like "J" whose hook reaches past the left padding at that size).
  let title;
  if (h.tied.length > 3) title = G.tieMany(h.tied.length);
  else if (h.tied.length > 1) title = G.tied(L.andList(h.tied.map((n) => languageLabel(n, L))));
  else if (h.only) title = G.only(languageLabel(h.name, L));
  else title = h.rawShare >= 50 ? G.mostly(languageLabel(h.name, L)) : G.ledBy(languageLabel(h.name, L));
  const code = h.rows.some((x) => x.type === 'programming');
  const quip = (Object.hasOwn(G.quips, h.name) ? G.quips[h.name] : null) ?? (!code ? G.noCode : h.count === 1 ? G.oneLanguage : G.polyglot);
  // Count files in the same pool as the language count (programming languages when there
  // is code, else the known data / prose ones), so "N languages across M files" agree.
  const pool = h.rows.filter((x) => x.name !== OTHER_LANGUAGE && (!code || x.type === 'programming'));
  const files = pool.reduce((n, x) => n + x.files, 0);
  return {
    eyebrow,
    big: pctText(h.share, h.amount, L),
    title,
    subtitle: `${quip} ${G.summary(h.count, code, files)}`,
    chart: languageBars(h, L),
  };
}

/**
 * The messages card's biggest-commit panel (stats.biggestCommit, see stats/biggest.js):
 * caption with the day, "+N / −M lines", and the subject; null without one (then the card
 * is exactly as before).
 */
function biggestCallout(s, L) {
  const M = L.messages;
  const b = s.biggestCommit;
  const shown = shownBiggestLines(b);
  if (!shown) return null;
  // Control / bidi characters dropped first, so a subject made only of them reads as none.
  // Email-shaped text is cut again here (stats already does), so no input can show one.
  const subject = clip(text(typeof b.subject === 'string' ? plain(scrubEmails(b.subject)) : null));
  return {
    kind: 'callout',
    title: M.biggestTitle(formatDay(b.date, L.code)),
    value: M.biggestLines(signedLines(shown.added, '+', L), signedLines(shown.removed, '−', L)),
    note: subject ? quote(subject) : M.noSubject,
  };
}

/**
 * The share of commits that follow the convention in a shownCommitTypes() mix, as text:
 * a whole percent, capped at 99% while some commit does not follow it (the mix is only
 * shown from 20%, so it never reads "<1%"). Card, recap and wrapped.md all use this.
 */
export const conventionalText = (mix, L = EN) => {
  const conventional = num(mix?.conventional);
  const total = Math.max(conventional, num(mix?.total));
  if (total <= 0) return L.pct(0);
  const pct = Math.round((conventional / total) * 100);
  return L.pct(conventional < total ? Math.min(99, pct) : pct);
};

/**
 * The conventional-commit mix (see shownCommitTypes) as a stacked bar for the messages
 * card: the top three types and the rest folded into "the rest" (foldCommitTypes), each
 * with its share of the conventional commits; a lone type is paired with the commits
 * without a prefix ("no prefix"), both as shares of all commits. Null when the mix is not
 * shown, or when every commit has the same type (nothing to compare). Never a 0% segment.
 */
function typeStack(s, L) {
  const mix = shownCommitTypes(s.commitTypes);
  if (!mix) return null;
  const M = L.messages;
  let rows = foldCommitTypes(mix.rows, 4);
  if (rows.length === 1) {
    // A lone type is set against the commits without a prefix, both as shares of all
    // commits (so they agree with the caption); with none, a one-segment bar would say
    // nothing the caption doesn't, so there is no bar.
    const none = mix.total - mix.conventional;
    if (none <= 0) return null;
    const shares = sizeShares([rows[0].count, none]);
    rows = [{ ...rows[0], share: shares[0] }, { id: 'none', count: none, share: shares[1] }];
  }
  return {
    kind: 'stack',
    // The short variant (one line of "62% feat" under a thin bar), so it fits more often.
    inline: true,
    // Purely additive: left out when the card is short of space, before anything shrinks.
    optional: true,
    title: M.typesTitle(conventionalText(mix, L)),
    segments: rows.map((r) => {
      const pct = sizeShareText(r, rows, L);
      return { label: M.typeNames[r.id], value: pct, amount: r.count, title: M.typeTitle(M.typeNames[r.id], r.count, pct) };
    }),
  };
}

/** `{chart}` for a list of chart specs (null entries left out): one spec alone, else the list; {} for none. */
const chartField = (list) => {
  const charts = list.filter(Boolean);
  return charts.length === 0 ? {} : { chart: charts.length === 1 ? charts[0] : charts };
};

/** Whether the layout of `spec` draws its chart at `index` (see layoutCard's drawnCharts). */
const draws = (spec, index, L) => layoutOf({ ...spec, lang: L.code }).drawnCharts.includes(index);

/**
 * The messages card with the conventional-commit mix (see typeStack) added when it fits:
 * as it is, else with the "fix" / "wip" / "oops" rows folded into one ("“fix” / “wip” /
 * “oops”: 5 / 0 / 2") to make room; when it fits neither way, `spec` unchanged.
 * So a card without the mix is exactly what it was before the mix existed.
 */
function withTypeMix(spec, types, folded, L) {
  const list = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
  const charts = chartField([...list, types]);
  const index = list.length;
  const plain = { ...spec, ...charts };
  if (draws(plain, index, L)) return plain;
  if (folded) {
    const compact = { ...spec, lines: folded, ...charts };
    if (draws(compact, index, L)) return compact;
  }
  return spec;
}

/**
 * The share of commits with an emoji in a shownEmoji() stat, as text: a whole percent,
 * capped at 99% while some commit has none (shown from 5%, so never "<1%"). Card, recap
 * and wrapped.md all use this.
 */
export const emojiShareText = (e, L = EN) => conventionalText({ conventional: e?.commits, total: e?.total }, L);

/**
 * The messages card's emoji row (stats.emoji, see shownEmoji): "Emoji ✨ 🐛 📝" (the top
 * three emoji) with the share of commits that have one ("12%") as its value; null when the
 * stat is not shown (under 5% of the commits). The share is the value, so a PNG that drops
 * color emoji (macOS, see src/png.js) still reads "Emoji · 12%".
 */
function emojiRow(s, L) {
  const e = shownEmoji(s.emoji);
  if (!e) return null;
  const M = L.messages;
  return { label: [M.emojiTitle, ...e.top.map((t) => t.emoji)].join(' '), value: emojiShareText(e, L) };
}

/**
 * The share of non-merge commits that are reverts in a shownReverts() stat, as text (see
 * shareLabel): a whole percent; "<1%" when it rounds to 0% (under 0.5%), since a revert
 * never reads "0%"; capped at 99% while some commit is not a revert. Card, recap and
 * wrapped.md all use this.
 */
export const revertShareText = (r, L = EN) => shareLabel(r?.pct, r?.count, L.pct);

/**
 * The messages card's reverts row (stats.reverts, see shownReverts): "Reverts" with the
 * count and its share of non-merge commits ("3 · 2%") as its value; null without reverts.
 */
function revertsRow(s, L) {
  const r = shownReverts(s.reverts);
  if (!r) return null;
  const M = L.messages;
  return { label: M.revertsTitle, value: M.revertsValue(r.count, revertShareText(r, L)) };
}

/**
 * Whether `candidate` (a messages card spec) fits as well as `base` did: at most
 * MAX_ROWS rows (the layout would silently drop more), every chart `base` drew still
 * drawn, and nothing shrunk more than `base` did plus `more` steps.
 */
function fitsLike(candidate, base, more, L) {
  if (!Array.isArray(candidate.lines) || candidate.lines.length > MAX_ROWS) return false;
  const l = layoutOf({ ...candidate, lang: L.code });
  const b = layoutOf({ ...base, lang: L.code });
  return l.drawnCharts.length === b.drawnCharts.length && l.drawnCharts.every((x, i) => x === b.drawnCharts[i]) && l.shrinkSteps <= b.shrinkSteps + more;
}

/**
 * The messages card (with the type mix when it fits, see withTypeMix) with the emoji row
 * (see emojiRow) as its last row, in the first of these that fits (see fitsLike):
 * 1. after the rows as they are;
 * 2. with the "fix" / "wip" / "oops" rows folded into one;
 * 3. either of those with the big word one step (15%) smaller;
 * 4. in place of the folded counter row (the type mix and the biggest commit keep their
 *    room; the counts stay in stats.json), as is, else with that one step.
 * The one step of 3 / 4 is taken only when nothing shrank. Without rows (no subjects),
 * `spec` unchanged; so is a card without the row, which is exactly what it was before.
 */
function withEmoji(spec, row, folded, L) {
  if (!Array.isArray(spec.lines) || !Array.isArray(folded) || folded.length === 0) return spec;
  const base = layoutOf({ ...spec, lang: L.code });
  const fits = (candidate, more) => fitsLike(candidate, spec, more, L);
  const appended = { ...spec, lines: [...spec.lines, row] };
  const compact = spec.lines !== folded ? { ...spec, lines: [...folded, row] } : null;
  const replaced = { ...spec, lines: [...folded.slice(0, -1), row] };
  const steps = base.shrinkSteps === 0 ? [0, 1] : [0];
  for (const more of steps) {
    if (fits(appended, more)) return appended;
    if (compact && fits(compact, more)) return compact;
  }
  for (const more of steps) if (fits(replaced, more)) return replaced;
  return spec;
}

/**
 * The messages card `spec` (as withEmoji left it) with the reverts row (see revertsRow)
 * as its last row, in the first of these that fits (see fitsLike):
 * 1. after the rows as they are;
 * 2. with the "fix" / "wip" / "oops" rows folded into one, when they are not yet
 *    (`unfolded`: the rows had the three counters; `emoji`: the emoji row, kept after them);
 * 3. either of those with the big word one step (15%) smaller, when nothing shrank.
 * It never takes the place of the counter row or of anything else: when it fits neither
 * way, `spec` unchanged (the reverts are still in the recap, wrapped.md and stats.json).
 */
function withReverts(spec, row, { folded, unfolded, emoji }, L) {
  if (!Array.isArray(spec.lines) || !Array.isArray(folded) || folded.length === 0) return spec;
  const base = layoutOf({ ...spec, lang: L.code });
  const appended = { ...spec, lines: [...spec.lines, row] };
  const compact = unfolded ? { ...spec, lines: [...folded, ...(emoji && spec.lines.includes(emoji) ? [emoji] : []), row] } : null;
  const steps = base.shrinkSteps === 0 ? [0, 1] : [0];
  for (const more of steps) {
    if (fitsLike(appended, spec, more, L)) return appended;
    if (compact && fitsLike(compact, spec, more, L)) return compact;
  }
  return spec;
}

function messages(s, { L }) {
  const spec = messagesCard(s, L);
  const types = typeStack(s, L);
  const card = types ? withTypeMix(spec.card, types, spec.folded, L) : spec.card;
  const emoji = emojiRow(s, L);
  const withRow = emoji ? withEmoji(card, emoji, spec.folded, L) : card;
  const reverts = revertsRow(s, L);
  if (!reverts) return withRow;
  // The three counter rows are still there when neither the type mix nor the emoji row folded them.
  const unfolded = Array.isArray(card.lines) && card.lines !== spec.folded && withRow.lines?.length === card.lines.length + (withRow === card ? 0 : 1) && withRow.lines.slice(0, card.lines.length).every((x, i) => x === card.lines[i]);
  return withReverts(withRow, reverts, { folded: spec.folded, unfolded, emoji }, L);
}

/** The messages card without the type mix (`card`), and its rows with the three counters folded into one (`folded`, null without rows). */
function messagesCard(s, L) {
  const M = L.messages;
  const m = s.messages ?? {};
  // Email-shaped text is cut again here (stats already does), so no input can show one.
  const subject = (e) => (typeof e?.subject === 'string' ? scrubEmails(e.subject) : null);
  const longest = clip(text(subject(m.longest)));
  const shortest = clip(text(subject(m.shortest)));
  const biggest = biggestCallout(s, L);
  if (!longest || !shortest) {
    return { card: { eyebrow: M.eyebrow, big: '…', title: M.noneTitle, subtitle: L.empty, ...(biggest ? { chart: biggest } : {}) }, folded: null };
  }
  // A "favorite" word needs to show up at least twice; otherwise use the average-length copy.
  const word = num(m.topWord?.count) >= 2 ? clip(text(m.topWord?.word)) : null;
  const counts = m.counts ?? {};
  const oops = num(counts.oops);
  const quip = oops > 0 ? M.oops(oops) : M.average(formatAverage(m.averageLength, L));
  // With a single commit, longest and shortest are the same message: show it once.
  const rows = [{ label: M.longest(quote(longest)) }];
  if (shortest !== longest) rows.push({ label: M.shortest(quote(shortest)) });
  const folded = [...rows, { label: M.counterCommits, value: M.counterValues(L.num(counts.fix), L.num(counts.wip), L.num(oops)) }];
  const card = {
    eyebrow: M.eyebrow,
    // Same rounding as the subtitle, so the two numbers always agree.
    big: word ? quote(word) : formatAverage(m.averageLength, L),
    title: word ? M.favorite(m.topWord.count) : M.averageTitle,
    subtitle: quip,
    lines: [
      ...rows,
      { label: M.fixCommits, value: L.num(counts.fix) },
      { label: M.wipCommits, value: L.num(counts.wip) },
      { label: M.oopsCommits, value: L.num(oops) },
    ],
    ...(biggest ? { chart: biggest } : {}),
  };
  return { card, folded };
}

/**
 * The archetype as shown: name, roast and reason from stats in English, else from the
 * string table by archetype id (the reason re-phrased from computePersonality's numbers,
 * see personalityReason; stats' own text when the id or the numbers are unknown).
 */
function archetypeText(p, L) {
  const a = p?.archetype ?? {};
  const local = L !== EN && typeof a.id === 'string' && Object.hasOwn(L.personality.archetypes, a.id) ? L.personality.archetypes[a.id] : null;
  if (!local) return { name: text(a.name), roast: text(a.roast), reason: text(a.reason) };
  return { name: local.name, roast: local.roast, reason: personalityReason(p, L) ?? text(a.reason) };
}

/** An archetype score's name in the card's language (by id), else as stats has it. */
const scoreName = (x, L) => (L !== EN && typeof x?.id === 'string' && Object.hasOwn(L.personality.archetypes, x.id) ? L.personality.archetypes[x.id].name : x.name);

function personality(s, { L }) {
  const Y = L.personality;
  const a = s.personality?.archetype ?? {};
  const shown = archetypeText(s.personality, L);
  const all = Array.isArray(s.personality?.scores) ? s.personality.scores : [];
  // Score bars only back up the headline when it is the top scorer; with too few commits
  // (or no standout habit) the headline is the steady-shipper fallback and bars like
  // "Weekend Warrior 100%" under it would contradict the card.
  const consistent = all[0]?.id === undefined || a.id === undefined || all[0].id === a.id;
  const scores = (consistent ? all : [])
    .filter((x) => text(x?.name) && num(x.score) > 0)
    .slice(0, 3);
  return {
    eyebrow: Y.eyebrow,
    big: shown.name ?? Y.archetypes['steady-shipper'].name,
    title: shown.roast ?? '',
    subtitle: shown.reason ?? '',
    chart: scores.length > 0
      ? {
        kind: 'hbars',
        size: 'large',
        title: Y.chartTitle,
        scaleMax: 1,
        items: scores.map((x) => {
          const share = Math.min(1, Math.max(0, num(x.score)));
          const pct = L.pct(Math.round(share * 100));
          const name = scoreName(x, L);
          return { label: name, value: pct, amount: share, title: `${name}: ${pct}` };
        }),
      }
      : null,
  };
}

/** A contributor's display name (clipped like other free text), "Unknown" when missing. */
const personName = (p, L = EN) => clip(text(p?.name)) ?? L.contributors.unknown;

/** One contributor as a bar row; `you` marks the --author's row. */
function contributorRow(p, you, L) {
  const C = L.contributors;
  const name = personName(p, L);
  const share = shareLabel(p?.share, p?.commits, L.pct);
  return {
    label: name,
    sub: you ? (num(p.rank) > TOP_CONTRIBUTORS ? C.youRank(p.rank) : C.you) : '',
    value: plural(p?.commits, 'commit', L),
    amount: num(p?.commits),
    title: C.barTitle(you ? C.youName(name) : name, p?.rank, p?.commits, share, signedLines(p?.added, '+', L), signedLines(p?.removed, '−', L)),
  };
}

/**
 * The team card (only built when there are 2+ contributors, see cardIdsFor): the top
 * contributors by commits; with --author, where "you" rank among them. Shows git author
 * names (after .mailmap) only, never an email. When commits were paired (stats.coAuthors)
 * and there is room, a pairing panel follows the bars (see pairedCallout).
 */
function contributors(s, { L }) {
  const spec = teamCard(s, L);
  return teamWithPairing(spec, s, L) ?? spec;
}

/** The team card without the pairing panel. */
function teamCard(s, L) {
  const C = L.contributors;
  const c = s.contributors ?? {};
  const total = num(c.total);
  const top = (Array.isArray(c.top) ? c.top : []).filter((p) => p && num(p.commits) > 0).slice(0, TOP_CONTRIBUTORS);
  const you = c.you && num(c.you.commits) > 0 && num(c.you.rank) > 0 ? c.you : null;
  const isYou = (p) => you !== null && num(p.rank) === num(you.rank);
  const items = top.map((p) => contributorRow(p, isYou(p), L));
  // "You" outside the top five get a sixth row of their own.
  if (you && !top.some(isYou)) items.push(contributorRow(you, true, L));
  const chart = items.length > 0 ? { kind: 'hbars', title: C.chartTitle, items } : null;
  const eyebrow = C.eyebrow;
  if (you) {
    const share = shareLabel(you.share, you.commits, L.pct);
    return {
      eyebrow,
      big: `#${L.num(you.rank)}`,
      title: C.ofTotal(total),
      subtitle: C.youMade(share, you.commits, signedLines(you.added, '+', L), signedLines(you.removed, '−', L)),
      chart,
    };
  }
  const lead = top[0];
  const tied = top.filter((p) => num(p.commits) === num(lead?.commits));
  let subtitle = C.teamwork;
  if (lead && tied.length > 1) {
    const who = tied.length > 3 ? C.several : L.andList(tied.map((p) => personName(p, L)));
    subtitle = C.shareLead(who, lead.commits);
  } else if (lead) {
    subtitle = C.leads(personName(lead, L), shareLabel(lead.share, lead.commits, L.pct));
  }
  return {
    eyebrow,
    big: L.num(total),
    title: C.title,
    subtitle,
    chart,
  };
}

/**
 * The pairing panel (stats.coAuthors, see shownCoAuthors): "Pair programming", "12 commits
 * paired" and, when known, "Top co-author: Ada" (a name only, never an email); null when no
 * commit was paired. It is `optional`, so a card it does not fit is laid out exactly as
 * without it.
 */
function pairedCallout(s, L) {
  const co = shownCoAuthors(s.coAuthors);
  if (!co) return null;
  const P = L.pairing;
  const top = co.top ? clip(text(plain(scrubEmails(co.top)))) : null;
  return { kind: 'callout', optional: true, title: P.title, value: P.paired(co.paired), note: top ? P.top(top) : null };
}

/**
 * The team card with the pairing panel (see pairedCallout) after its bars, or null when
 * there is no panel or it does not fit (then `spec` is used as it is). Not with --author
 * (contributors.authorFilter): the team card is everyone's, but stats.coAuthors counts
 * only that author's commits, so the totals card (also theirs) shows it instead.
 */
function teamWithPairing(spec, s, L) {
  if (s.contributors?.authorFilter === true) return null;
  const paired = pairedCallout(s, L);
  if (!paired) return null;
  const list = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
  const withPanel = { ...spec, ...chartField([...list, paired]) };
  return draws(withPanel, list.length, L) ? withPanel : null;
}

/**
 * Whether the pairing panel goes on the team card: the card is built (see hasTeamCard),
 * there is no --author filter and the panel fits on it. Otherwise the totals card gets a pairing row instead (when it
 * fits there, see pairedRow).
 */
function pairingOnTeam(s, L) {
  return hasTeamCard(s) && teamWithPairing(teamCard(s, L), s, L) !== null;
}

/** The four headline stats shared by the outro card and the share image. */
function summaryTiles(s, ctx) {
  const { L } = ctx;
  const O = L.outro;
  const commits = num(s.totals?.commits);
  return [
    { label: O.commits, value: L.num(commits) },
    { label: O.powerHour, value: peakHourText(s.habits, L) ?? O.noneYet },
    { label: O.bestStreak, value: plural(num(shownLongest(s, ctx.today)?.length), 'day', L) },
    { label: O.personality, value: commits > 0 ? (archetypeText(s.personality, L).name ?? L.personality.archetypes['steady-shipper'].name) : O.tbd },
  ];
}

function outro(s, ctx) {
  const { L } = ctx;
  const O = L.outro;
  const commits = num(s.totals?.commits);
  const [top] = shownHotFiles(s);
  // --year: one sentence on the change since the previous year, first (when the subtitle
  // runs out of lines, trailing sentences are dropped).
  const yoy = commits > 0 ? yearOverYear(s) : null;
  const tiles = {
    kind: 'tiles',
    items: summaryTiles(s, ctx),
    wide: top ? { label: O.hottestFile, value: top.path, note: plural(top.commits, 'commit', L), truncate: 'start' } : null,
  };
  const yoySentence = yoy ? L.yoy.summary(yoy.previousYear, yoy.commits, yoy.lines, yoy.activeDays) : null;
  const spec = {
    eyebrow: O.eyebrow,
    big: O.big,
    title: commits > 0 ? O.inOneCard(ctx.repoName) : L.empty,
    subtitle: yoySentence ? `${yoySentence} ${O.subtitle}` : O.subtitle,
    chart: tiles,
  };
  const released = commits > 0 ? releasesCallout(s, L) : null;
  return released ? withReleases(spec, tiles, released, yoySentence, L) ?? spec : spec;
}

/**
 * The outro with the releases panel after its tiles, or null when it fits nowhere (then
 * the card is exactly as without it). The panel is `optional`, so it is only drawn when
 * nothing else shrinks for it; to make room, the subtitle gives way first: as it is, then
 * without the static "Made with gitwrapped…" line (keeping --year's comparison sentence),
 * then with no subtitle at all (the comparison is still on the totals card and the recap).
 */
function withReleases(spec, tiles, panel, yoySentence, L) {
  const { subtitle, ...rest } = spec;
  const subtitles = [subtitle, ...(yoySentence ? [yoySentence] : []), null];
  for (const sub of subtitles) {
    const next = { ...rest, ...(sub ? { subtitle: sub } : {}), chart: [tiles, panel] };
    if (draws(next, 1, L)) return next;
  }
  return null;
}

/**
 * A callout note `make(value)` on one line (CALLOUT_NOTE): as it is when it fits; else
 * with `value` cut so that the rest of the note always shows whole: in the middle
 * (`middle`, head + "…" + tail, so a tag keeps its repo prefix and its version at the end)
 * or at the end ("…", keeping at least one character). Null when even that does not fit.
 */
function fitNoteSlot(make, value, { middle = false } = {}) {
  const size = CALLOUT_NOTE.size;
  const fits = (t) => measureText(t, size) <= CALLOUT_NOTE.maxWidth;
  if (fits(make(value))) return make(value);
  if (middle) {
    for (let room = CALLOUT_NOTE.maxWidth - measureText(make(''), size); room > 0; room -= 4) {
      const cut = truncateMiddle(value, { maxWidth: room, fontSize: size });
      if (graphemes(cut).length > 1 && fits(make(cut))) return make(cut);
    }
    return null;
  }
  const gs = graphemes(value);
  while (gs.length > 1) {
    gs.pop();
    const stub = gs.join('').trimEnd();
    if (stub && fits(make(`${stub}…`))) return make(`${stub}…`);
  }
  return null;
}

/**
 * The outro's optional releases panel (stats.releases, see shownReleases): "Releases",
 * "You shipped 3 releases" and "Latest: v1.5.0 · Oct 6, 2026" (a long tag name cut in the
 * middle with "…", so its version and the day always show); null when no tag points at
 * the commits.
 */
function releasesCallout(s, L) {
  const r = shownReleases(s.releases);
  if (!r) return null;
  const O = L.outro;
  const name = r.latest ? clip(text(plain(r.latest.name))) : null;
  const day = r.latest ? formatDay(r.latest.date, L.code) : '';
  const make = (n) => [O.latest(n), day].filter(Boolean).join(' · ');
  const note = name ? fitNoteSlot(make, name, { middle: true }) ?? make('…') : null;
  return { kind: 'callout', optional: true, title: O.releases, value: O.shipped(r.count), note };
}

/** 'YYYY-MM' → {year, month (1-12)}. */
const monthParts = (key) => {
  const i = monthIndex(key);
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/**
 * The monthly timeline card (only built when the commits span 2+ calendar months, see
 * cardIdsFor): commits per month as bars, the most recent MAX_SHOWN_MONTHS at most, with
 * the peak month (ties → the earliest) called out.
 */
function months(s, ctx) {
  const { L } = ctx;
  const M = L.monthly;
  const all = shownMonths(s, ctx.today).months;
  const list = all.slice(-MAX_SHOWN_MONTHS);
  const clipped = list.length < all.length;
  const peak = peakMonth(list);
  const longName = (key) => {
    const p = monthParts(key);
    return `${L.monthNames[p.month - 1]} ${p.year}`;
  };
  const values = list.map((m) => m.commits);
  // Tick labels: every `step`-th month of the year (step divides 12, so January is always
  // labelled), January as its year, the others by their short name. A label needs about
  // 100px (a year such as "2025" is ~84px at the 30px bold tick size, plus a gap); the
  // chart is 888px (the content width) wide.
  const need = 100 / (888 / Math.max(1, list.length));
  const step = [1, 2, 3, 4, 6, 12].find((k) => k >= need) ?? 12;
  const labels = list.map((m) => {
    const p = monthParts(m.month);
    if ((p.month - 1) % step !== 0) return '';
    return p.month === 1 ? String(p.year) : L.months[p.month - 1];
  });
  const active = list.filter((m) => m.commits > 0).length;
  const tiedCount = peak ? list.filter((m) => m.commits === peak.commits).length : 0;
  // Every active month the same: no peak to call out ("3 commits in every active month").
  const steady = tiedCount > 1 && tiedCount === active;
  // Every month tied for the peak is highlighted; the count goes above the earliest.
  const highlight = peak && !steady ? list.flatMap((m, i) => (m.commits === peak.commits ? [i] : [])) : [];
  const chart = {
    kind: 'bars',
    title: M.chartTitle,
    maxBarHeight: 560,
    values,
    labels,
    titles: list.map((m) => M.barTitle(longName(m.month), m.commits)),
    highlight,
    peakLabel: peak && !steady ? L.num(peak.commits) : '',
  };
  // A clipped timeline of a repo that went quiet (its last active day more than
  // DORMANT_DAYS before the cards' "as of" day, the same test as the activity card) names
  // its last month instead of saying "your last 24 months".
  let eyebrow = M.eyebrow;
  if (clipped) {
    const lastKey = list[list.length - 1].month;
    const end = monthParts(lastKey);
    // The last active day of that month from stats.daily; without day data, the month's
    // last day.
    const inLast = (Array.isArray(s.daily?.days) ? s.daily.days : [])
      .filter((x) => num(x?.commits) > 0 && typeof x?.day === 'string' && x.day.startsWith(`${lastKey}-`))
      .map((x) => epochDay(x.day))
      .filter((e) => e !== null);
    const nextMonth = end.month === 12 ? `${end.year + 1}-01-01` : `${end.year}-${String(end.month + 1).padStart(2, '0')}-01`;
    const lastDay = inLast.length > 0 ? Math.max(...inLast) : epochDay(nextMonth) - 1;
    eyebrow = wentQuiet(lastDay, ctx.asOf) ? M.monthsTo(list.length, end.month, end.year) : M.lastMonths(list.length);
  }
  if (!peak) return { eyebrow, big: '0', title: L.units.commit[1], subtitle: L.empty, chart };
  const activeText = active === list.length ? M.everyMonth(list.length) : M.active(active, list.length);
  if (steady) {
    return { eyebrow, big: L.num(peak.commits), title: M.steadyTitle(peak.commits), subtitle: activeText, chart };
  }
  const p = monthParts(peak.month);
  return {
    eyebrow,
    big: M.big(p.month, p.year),
    title: tiedCount > 1 ? M.titleTied : M.title,
    subtitle: `${M.peak(peak.commits)} ${activeText}`,
    chart,
  };
}

const BUILDERS = { intro, totals, 'peak-hour': peakHour, streak, activity, months, 'hot-files': hotFiles, languages, contributors, messages, personality, outro };
/** Each card's gradient name (resolved in the run's color theme, see themes.js). */
const CARD_THEMES = { intro: 'pulse', totals: 'ocean', 'peak-hour': 'cosmic', streak: 'ember', activity: 'cosmic', months: 'neon', 'hot-files': 'mint', languages: 'ocean', contributors: 'ember', messages: 'neon', personality: 'sunset', outro: 'gold' };

/**
 * Footer text: "<repo> · <date range>", or the requested window when --since / --until
 * were given ("<repo> · since <date>", "<repo> · 2025", see windowLabel). The repo
 * name is left out when it is "gitwrapped", which the footer brand already says.
 * With `today` ('YYYY-MM-DD'), future-dated days do not stretch the range (shownDayRange).
 * `lang` picks the date format (see src/i18n).
 */
export function footerText(stats, { repoName, since, until, today, lang }) {
  const t = shownDayRange(stats, today);
  const range = windowLabel({ since, until, lang }) ?? formatDateRange(t.firstDay, t.lastDay, lang);
  const repo = repoName.toLowerCase() === 'gitwrapped' ? '' : repoName;
  return [repo, range].filter(Boolean).join(' · ');
}

/**
 * Build the full card set from computeStats() output.
 * Options: `lang` (an src/i18n code, default 'en': every string on the cards),
 * `colorTheme` (a themes.js color theme, default 'default': the colors only; specs carry
 * it only when it is not the default, so default output is unchanged),
 * `repoName` (default "your repo"), `since`, `until` and `author` (as passed
 * to the CLI; shown in the copy when given), and `today` ('YYYY-MM-DD', the date the
 * stats' current streak is relative to): when `until` is before `today`, the streak card
 * talks about the streak at the end of the window instead of "right now". Returns
 * `[{id, svg, description}]` for cardIdsFor(stats), in CARD_IDS order; `description` is
 * the card's content as plain text (see cardDescription).
 * A multi-repo run (stats.repos with 2+ rows, see repoRows) is named "N repos" instead of
 * `repoName`, the intro names the repos, and the totals / hot-files cards get a per-repo
 * chart; single-repo cards are unchanged.
 */
export function buildCards(stats, opts = {}) {
  return buildCardSpecs(stats, opts).map(({ id, spec }) => {
    const { svg, drawnCharts } = renderCardWithLayout(spec);
    // The description covers exactly the charts drawn: charts the layout left out for lack
    // of room (see layoutCard) are left out of it too.
    return { id, svg, description: cardDescription(onlyCharts(spec, drawnCharts)) };
  });
}

/** `spec` with only the charts at `indices` (into spec.chart; a single spec is index 0). */
function onlyCharts(spec, indices) {
  const list = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
  return { ...spec, chart: indices.map((i) => list[i]) };
}

/** Text for a description: control / bidi characters dropped, whitespace collapsed. */
const plain = (v) => (v === null || v === undefined ? '' : String(v)
  .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim());

/** "Label: value" (or whichever of the two is present). */
const pair = (label, value) => [plain(label), plain(value)].filter(Boolean).join(': ');

/**
 * A plain-text version of a card spec for assistive tech (the viewer links it to the
 * card with aria-describedby): eyebrow, headline, subtitle, list rows and the chart's
 * values, as sentences. The calendar is summarized by its active-day count.
 * `spec.lang` (an src/i18n code) picks the language of the few words added here.
 */
export function cardDescription(spec = {}) {
  const L = getStrings(spec.lang);
  const out = [];
  const add = (x) => {
    const t = plain(x);
    if (t) out.push(/[.!?…”]$/.test(t) ? t : `${t}.`);
  };
  add(spec.eyebrow);
  // "1,234 commits" reads as one phrase; a title that is its own sentence (a roast) is not.
  if ((L === EN ? /^[A-Z]\S*\s/ : /^\p{Lu}\S*\s/u).test(plain(spec.title))) {
    add(spec.big);
    add(spec.title);
  } else {
    add([plain(spec.big), plain(spec.title)].filter(Boolean).join(' '));
  }
  add(spec.subtitle);
  for (const l of Array.isArray(spec.lines) ? spec.lines : []) add(pair(l?.label, l?.value));
  const charts = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
  for (const c of charts) {
    const items = [];
    if (c.kind === 'callout') items.push(pair(c.title, c.value), plain(c.note));
    else if (c.kind === 'split') items.push(plain(c.title), ...(c.segments ?? []).map((x) => pair(x?.label, x?.value)));
    else if (c.kind === 'stack') items.push(plain(c.title), ...(c.segments ?? []).filter((x) => num(x?.amount) > 0).map((x) => plain(x?.title) || pair(x?.label, x?.value)));
    else if (c.kind === 'hbars') items.push(plain(c.title), ...(c.items ?? []).map((x) => plain(x?.title) || pair(x?.label, x?.value)));
    else if (c.kind === 'bars') items.push(plain(c.title), ...(c.titles ?? []).filter((t, i) => num(c.values?.[i]) > 0).map(plain));
    else if (c.kind === 'tiles') items.push(...(c.items ?? []).map((x) => pair(x?.label, x?.value)), ...(c.wide ? [pair(c.wide.label, `${plain(c.wide.value)} (${plain(c.wide.note)})`)] : []));
    else if (c.kind === 'calendar') items.push(plain(c.title) || L.calendarOf((c.days ?? []).length));
    for (const x of items) add(x);
  }
  return out.join(' ');
}

/** `{colorTheme}` for a known non-default color theme, else nothing (default specs stay as they were). */
const colorThemeField = (name) => (isColorTheme(name) && name !== DEFAULT_COLOR_THEME ? { colorTheme: name } : {});

/**
 * The renderCard() input for every card of the set (same arguments as buildCards), as
 * `[{id, spec}]` for cardIdsFor(stats), numbered 01, 02, ... in that order;
 * buildCards() renders exactly these. Useful for layout checks.
 */
export function buildCardSpecs(stats, { repoName, since, until, author, today, lang, colorTheme } = {}) {
  stats = stats ?? {};
  const L = getStrings(lang);
  const repos = repoRows(stats);
  const ctx = { L, lang: L.code, repoName: displayRepoName(stats, { repoName, lang }), repos, since: text(since), until: text(until), author: text(author), today: text(today) };
  // The day the cards are "as of": today, or the end of a window that ended before it.
  const t = parseDay(ctx.today);
  const u = parseDay(ctx.until);
  ctx.asOf = t && u && u.key < t.key ? u.key : (t?.key ?? null);
  const footer = footerText(stats, ctx);
  return cardIdsFor(stats, { today: ctx.today }).map((id, i) => ({
    id,
    spec: { theme: CARD_THEMES[id], footer, number: String(i + 1).padStart(2, '0'), idPrefix: `gw-${id}`, ...(L === EN ? {} : { lang: L.code }), ...colorThemeField(colorTheme), ...BUILDERS[id](stats, ctx) },
  }));
}

/**
 * The 1200x630 share summary card (landscape, for link previews and social posts):
 * repo name, four stat tiles (commits, longest streak, power hour, personality) and the
 * hottest file. Same options as buildCards(); copes with empty stats. Returns an SVG string.
 */
export function renderShareCard(stats, { repoName, since, until, author, today, lang, colorTheme } = {}) {
  stats = stats ?? {};
  const L = getStrings(lang);
  const ctx = { L, lang: L.code, repoName: displayRepoName(stats, { repoName, lang }), since: text(since), until: text(until), author: text(author), today: text(today) };
  const year = windowYear(ctx.since, ctx.until);
  const commits = num(stats.totals?.commits);
  const [top] = shownHotFiles(stats);
  const [c, hour, streakTile, persona] = summaryTiles(stats, ctx);
  return renderShareSvg({
    theme: 'pulse',
    idPrefix: 'gw-share',
    eyebrow: authorName(ctx.author) ? L.share.eyebrowAuthor(year, authorName(ctx.author)) : L.share.eyebrow(year),
    title: ctx.repoName,
    tiles: [c, streakTile, hour, persona],
    file: top ? { label: L.outro.hottestFile, path: top.path, value: plural(top.commits, 'commit', L) } : null,
    note: commits > 0 ? L.share.noHotFiles : L.empty,
    footer: footerText(stats, ctx),
    ...(L === EN ? {} : { lang: L.code }),
    ...colorThemeField(colorTheme),
  });
}
