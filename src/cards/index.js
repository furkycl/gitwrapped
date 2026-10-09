// The story-card set: turns computeStats() output into Wrapped-style SVG cards.
// Pure and deterministic. Every card copes with empty stats (0 commits, null peaks,
// no hot files, null messages) and never prints "null", "undefined" or "NaN".
import { CALENDAR_MIN_CELL, CALLOUT_NOTE, calendarWindow, escapeXml, formatNumber, graphemes, layoutCard as layoutOf, measureText, elidedPathForms, renderCardWithLayout, rowFits, rowValueFits, truncateMiddle } from './svg.js';

export { formatNumber };
import { renderShareSvg } from './share.js';
import { dayKeyFromEpoch as dayKeyOf, epochDay, mondayOf, WEEKDAY_NAMES } from '../stats/time.js';
import { languageBarRows, languageHeadline, OTHER as OTHER_LANGUAGE } from '../stats/languages.js';
import { busiestOf, daysUpTo, shownLongest, shownLongestBreak } from '../stats/daily.js';
import { monthIndex, monthsFromDays } from '../stats/months.js';
import { contributorShare, hasTeamCard, shareLabel, shownBusFactor, TOP_CONTRIBUTORS } from '../stats/contributors.js';
import { shownCoAuthors } from '../stats/coauthors.js';
import { shownTimezones, utcLabel } from '../stats/timezones.js';
import { shownLateNights } from '../stats/latenights.js';
import { shownOfficeHours } from '../stats/officehours.js';
import { shownWeekend, weekendPercentLabel } from '../stats/weekend.js';
import { shownCadence } from '../stats/cadence.js';
import { shownSessions } from '../stats/sessions.js';
import { shownReleases } from '../stats/releases.js';
import { scrubEmails } from '../privacy.js';
import { personalityReason } from '../stats/personality.js';
import { yearOverYear } from '../stats/yoy.js';
import { previousPeriod } from '../stats/period.js';
import { shownBiggestLines } from '../stats/biggest.js';
import { shownCommitSizes } from '../stats/sizes.js';
import { foldCommitTypes, shownCommitTypes } from '../stats/types.js';
import { shownEmoji } from '../stats/emoji.js';
import { shownReverts } from '../stats/reverts.js';
import { shownFileLifecycle } from '../stats/files.js';
import { shownMerges } from '../stats/merges.js';
import { shownFolders } from '../stats/folders.js';
import { shownTests } from '../stats/tests.js';
import { shownDocShare } from '../stats/docs.js';
import { shownCoChange } from '../stats/cochange.js';
import { shownCleanups } from '../stats/cleanups.js';
import { issueRefLabel, shownIssueRefs } from '../stats/issues.js';
import { shownDepBumps } from '../stats/depbumps.js';
import { shownFixups, shownSubjectLength } from '../stats/messages.js';
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

/** Whether `hour` (0-23) is a night hour, 22:00-04:59: the two night quips' hours. */
const isNightHour = (hour) => Number.isInteger(hour) && (hour >= QUIP_HOURS[QUIP_HOURS.length - 1] || hour < QUIP_HOURS[0]);

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

/**
 * The totals card's comparison rows: --year's change since the previous year
 * (stats.yearOverYear), else a --since run's change since the equal-length window before
 * it (stats.previousPeriod), with the day count in the labels when all three rows fit
 * whole and the short labels otherwise; [] without either.
 */
function comparisonRows(s, L) {
  const yoy = yearOverYear(s);
  if (yoy) {
    return [
      { label: L.yoy.commits(yoy.previousYear), value: L.delta(yoy.commits) },
      { label: L.yoy.lines(yoy.previousYear), value: L.delta(yoy.lines) },
      { label: L.yoy.activeDays(yoy.previousYear), value: L.delta(yoy.activeDays) },
    ];
  }
  const p = previousPeriod(s);
  if (!p) return [];
  const P = L.period;
  const rows = (short) => [
    { label: P.commits(p.days, short), value: L.delta(p.commits) },
    { label: P.lines(p.days, short), value: L.delta(p.lines) },
    { label: P.activeDays(p.days, short), value: L.delta(p.activeDays) },
  ];
  const full = rows(false);
  return full.every((r) => rowFits(r)) ? full : rows(true);
}

/** The most list rows a card draws (see renderCard's `lines`). */
const MAX_ROWS = 6;

/** The smallest big number (px) the totals card of a multi-repo run shrinks to. */
const TOTALS_BIG_MIN = 140;

function totals(s, ctx) {
  const spec = totalsWithCleanups(s, ctx);
  // The dependency-bumps row (stats.depBumps) last of all, in spare room only (see depBumpsCard).
  return depBumpsCard(s, ctx) === 'totals' ? withSpareRow(spec, depBumpsRow(s, ctx.L), ctx.L) : spec;
}

/** The totals card without the dependency-bumps row (see totals, depBumpsCard). */
function totalsWithCleanups(s, ctx) {
  // The cleanup rows (stats.cleanups) go here or on the messages card, never both (see
  // cleanupsPlacement); without them the card is exactly totalsBase.
  const place = cleanupsPlacement(s, ctx);
  return place?.card === 'totals' ? place.spec : totalsBase(s, ctx);
}

/**
 * A dependency-bumps share (shownDepBumps output) as shown: a whole percent of the
 * non-merge commits, "<1%" when it rounds to 0, never "100%" short of every commit (see
 * shareLabel). Used by the cards, the recap and wrapped.md, so they agree.
 */
export const depBumpShareText = (d, L = EN) => shareLabel(d?.pct, d?.commits, L.pct);

/**
 * The dependency-bumps row (stats.depBumps, see shownDepBumps) in its first form drawn
 * whole (see rowFits): "Dependency bumps" and "5 commits · 2%", else "Dependency bumps"
 * and "12 · 8%", else "Dep bumps" and "12 · 8%"; null without a dependency bump (also for
 * `{commits: 0}`), or when even the shortest form would be cut. The hover text says it in words.
 */
function depBumpsRow(s, L) {
  const d = shownDepBumps(s?.depBumps);
  if (!d) return null;
  const T = L.totals;
  const pct = depBumpShareText(d, L);
  const description = T.depBumpsDescription(d.commits, pct);
  const forms = [
    [T.depBumps, T.depBumpsValue(d.commits, pct)],
    [T.depBumps, T.depBumpsShort(d.commits, pct)],
    [T.depBumpsLabelShort, T.depBumpsShort(d.commits, pct)],
  ];
  return forms.map(([label, value]) => ({ label, value, description })).find((row) => rowFits(row)) ?? null;
}

/**
 * Which card shows the dependency-bumps row: 'totals', 'messages' or null (no row, or no
 * room on either). It is placed after every other row of the totals card (the cleanup and
 * merges rows included), else after the issue references on the messages card (only the
 * subject length row comes after it there), in spare room only, so it never displaces a
 * row or shrinks anything:
 * 1. the totals card, as its last row on withSpareRow's terms (every chart drawn at the
 *    same height);
 * 2. else the messages card, after the issue references when that fits as well as the card did
 *    without it (see fitsLike: at most 6 rows, every chart still drawn, no extra shrink
 *    step, nothing folded).
 * Without the row, or without room on either, every card is byte-identical to before.
 */
export function depBumpsCard(s, ctx) {
  const row = depBumpsRow(s ?? {}, ctx.L);
  if (!row) return null;
  const t = totalsWithCleanups(s ?? {}, ctx);
  if (Array.isArray(t.lines) && withSpareRow(t, row, ctx.L) !== t) return 'totals';
  const m = messagesWithoutDepBumps(s ?? {}, ctx);
  if (Array.isArray(m.lines) && withLastRow(m, row, ctx.L) !== m) return 'messages';
  return null;
}

/**
 * The messages card `spec` with `row` (the dependency-bumps row, or a subject length row
 * form) as its last row when that fits as well as `spec` (see fitsLike: at most 6 rows,
 * every chart still drawn, no extra shrink step, nothing folded), else `spec` itself.
 */
function withLastRow(spec, row, L) {
  if (!Array.isArray(spec.lines) || spec.lines.length >= MAX_ROWS) return spec;
  const next = { ...spec, lines: [...spec.lines, row] };
  return fitsLike(next, spec, 0, L) ? next : spec;
}

/** The totals card without the cleanup rows. */
function totalsBase(s, { L, repos }) {
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
  // --year: the change since the previous year; --since: since the window before it
  // (at most 6 rows in all).
  rows.push(...comparisonRows(s, L));
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
  // Files born / buried (and renamed when that fits, see lifecycleRow; stats.fileLifecycle)
  // after it, again in spare room only: it never displaces the pairing row or anything else
  // (it is always in the recap, wrapped.md and stats.json).
  const lifecycle = lifecycleRow(s, L);
  const withLifecycle = lifecycle ? withSpareRow(withPaired, lifecycle, L) : withPaired;
  // Merged pull requests and merge commits (stats.merges) last, on the same terms.
  const merges = mergesRow(s, L);
  // Only when drawn whole (with 10,000+ pull requests and merges the label would be cut);
  // else the outro shows the merges panel (see mergesOnTotals).
  return merges && rowFits(merges) ? withSpareRow(withLifecycle, merges, L) : withLifecycle;
}

/** How many of the cleanup `rows` (see cleanupsRows) a card `spec` draws (by identity). */
const cleanupRowsIn = (spec, rows) => (Array.isArray(spec?.lines) ? spec.lines.filter((r) => r === rows.count || (rows.biggest && r === rows.biggest)).length : 0);

/**
 * Where the cleanup rows (stats.cleanups, see cleanupsRows) go: `{card: 'totals' |
 * 'messages', spec}` (that card's spec with them), or null (no cleanups, or no room). Never
 * on both cards. In order:
 * 1. the totals card, when it takes every row (the count row, then the biggest cleanup;
 *    each after the other rows in spare room only, see withSpareRow);
 * 2. else the messages card, when it takes every row (after its other rows, else with the
 *    fix / wip / oops counts folded, see withLastRows);
 * 3. else the totals card with the count row alone, when it fits;
 * 4. else the messages card with the count row alone, when it fits.
 */
function cleanupsPlacement(s, ctx) {
  const rows = cleanupsRows(s ?? {}, ctx.L);
  if (!rows) return null;
  const all = rows.biggest ? 2 : 1;
  const tBase = totalsBase(s ?? {}, ctx);
  // A totals card without rows (no commits) never gets them.
  const onTotals = { card: 'totals', spec: Array.isArray(tBase.lines) ? withCleanups(tBase, rows, (spec, row) => withSpareRow(spec, row, ctx.L)) : tBase };
  const t = cleanupRowsIn(onTotals.spec, rows);
  if (t === all) return onTotals;
  const m = messagesBase(s ?? {}, ctx);
  const onMessages = m && Array.isArray(m.card.lines) && Array.isArray(m.parts.folded) ? { card: 'messages', spec: withLastRows(m.card, rows, m.parts, ctx.L) } : null;
  const n = onMessages ? cleanupRowsIn(onMessages.spec, rows) : 0;
  if (n === all) return onMessages;
  if (t > 0) return onTotals;
  return n > 0 ? onMessages : null;
}

/**
 * `spec` with the cleanup rows (see cleanupsRows) added by `add(spec, row)` (which returns
 * `spec` itself when the row has no room): the count row, then the biggest cleanup only
 * when the count row was added. Used for the totals and messages cards (see cleanupsPlacement).
 */
function withCleanups(spec, rows, add) {
  const withCount = add(spec, rows.count);
  if (withCount === spec || !rows.biggest) return withCount;
  return add(withCount, rows.biggest);
}

/**
 * A cleanups share (shownCleanups output) as shown: a whole percent of the non-merge
 * commits, "<1%" when it rounds to 0, never "100%" short of every commit (see shareLabel).
 * Used by the totals card, the recap and wrapped.md, so they agree.
 */
export const cleanupShareText = (c, L = EN) => shareLabel(c?.pct, c?.commits, L.pct);

/**
 * The cleanup rows (stats.cleanups, see shownCleanups) for the totals card, or the
 * messages card when it has no room (see withLastRows), each in the first form drawn
 * whole (see rowFits), or null:
 * - count: "Cleanups" and "12 commits · 8%", else "12 · 8%" (the share of non-merge
 *   commits always shows); no rows at all when even that would be cut;
 * - biggest: "Biggest cleanup" and "−4,210 lines · Mar 3, 2026", else the year-less
 *   "−4,210 lines · Mar 3", else "−4,210 · Mar 3", else "−4,210 lines" (also without a
 *   known day); null without one, or when even that would be cut. Its
 *   subject is in its description (and in the recap and wrapped.md), not on the row.
 * Null without cleanup commits.
 */
function cleanupsRows(s, L) {
  const c = shownCleanups(s?.cleanups);
  if (!c) return null;
  const T = L.totals;
  const pct = cleanupShareText(c, L);
  const full = T.cleanupsValue(c.commits, pct);
  const count = { label: T.cleanups, value: rowValueFits(full) ? full : T.cleanupsShort(c.commits, pct), description: T.cleanupsDescription(c.commits, pct) };
  if (!rowFits(count)) return null;
  const b = c.biggest;
  let biggest = null;
  if (b) {
    const minus = signedLines(b.net, '−', L);
    const lines = T.cleanupLines(minus);
    const d = parseDay(b.date);
    const day = d ? L.date(d.day, d.month, d.year) : null;
    const subject = b.subject ? clip(text(plain(scrubEmails(b.subject)))) : null;
    const description = T.biggestCleanupDescription(lines, day, subject ? quote(subject) : null);
    // The full day, else the year-less one (as the "Latest night" row), else that day
    // with the bare count, else no day.
    const short = d ? L.dayMonth(d.day, d.month) : null;
    const values = d ? [T.cleanupLinesOn(lines, day), T.cleanupLinesOn(lines, short), T.cleanupLinesOn(minus, short)] : [];
    biggest = [...values, lines]
      .map((value) => ({ label: T.biggestCleanup, value, description }))
      .find((r) => rowFits(r)) ?? null;
  }
  return { count, biggest };
}

/**
 * A merge-commit share (shownMerges output) as shown: a whole percent of all commits, "<1%"
 * when it rounds to 0, never "100%" short of every commit (see shareLabel). Used by the
 * totals card, the recap and wrapped.md, so they agree.
 */
export const mergeShareText = (m, L = EN) => shareLabel(m?.pct, m?.commits, L.pct);

/**
 * The totals card's merges row (stats.merges, see shownMerges): "Merged PRs / merges" and
 * "12 / 8", "Merged PRs" and "12" without merge commits, or "Merge commits" and "8 · 6%"
 * without pull requests; null with neither.
 */
function mergesRow(s, L) {
  const m = shownMerges(s.merges);
  if (!m) return null;
  return { label: L.totals.mergesLabel(m.pullRequests, m.commits), value: L.totals.mergesValue(m.pullRequests, m.commits, mergeShareText(m, L)) };
}

/**
 * The totals card's files born / buried row (stats.fileLifecycle, see shownFileLifecycle):
 * "Born / buried" and "12 / 3"; with renames, "Born / buried / renamed" and "12 / 3 / 4"
 * when that is drawn whole (see rowFits), else the born / buried row (null when no file
 * was added or deleted either). Null when no file was added, deleted or renamed, or when
 * even the born / buried row would be cut (7-digit counts): the row is only ever drawn
 * whole. Without renames the row is exactly the born / buried one.
 */
function lifecycleRow(s, L) {
  const lc = shownFileLifecycle(s.fileLifecycle);
  if (!lc) return null;
  const T = L.totals;
  if (lc.renamed > 0) {
    const row = { label: T.fileLifecycleRenamed, value: T.fileLifecycleValue(lc.added, lc.deleted, lc.renamed) };
    if (rowFits(row)) return row;
  }
  if (lc.added + lc.deleted === 0) return null;
  const row = { label: T.fileLifecycle, value: T.fileLifecycleValue(lc.added, lc.deleted) };
  return rowFits(row) ? row : null;
}

/**
 * The totals card's pairing row (stats.coAuthors, see shownCoAuthors): "Paired
 * (top: Ada)" and the count, else "Paired commits" when the name would be cut (see
 * rowFits); null when no commit was paired or even that would be cut.
 */
function pairedRow(s, L) {
  const co = shownCoAuthors(s.coAuthors);
  if (!co) return null;
  const top = co.top ? clip(text(plain(scrubEmails(co.top)))) : null;
  const value = L.num(co.paired);
  const named = { label: L.pairing.row(top), value };
  if (!top || rowFits(named)) return rowFits(named) ? named : null;
  const plainRow = { label: L.pairing.row(null), value };
  return rowFits(plainRow) ? plainRow : null;
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

function peakHour(s, ctx) {
  const spec = peakHourWithoutSessions(s, ctx);
  // The coding-sessions row when the streak card has no room for it (see sessionsCard).
  return sessionsCard(s, ctx) === 'peak-hour' ? withSessionsRow(spec, sessionsRows(s, ctx.L), ctx.L) : spec;
}

/** The power-hour card without the coding-sessions row (see peakHour, sessionsCard). */
function peakHourWithoutSessions(s, ctx) {
  const spec = peakHourBase(s, ctx);
  // Weekday commits between 09:00 and 17:59 (stats.officeHours) as the last row, in spare
  // room only (see withRoomyRow): every chart still drawn, and with the late-nights row's
  // allowance of one shrink step in all (a step the time-zones or late-nights rows already
  // took is shared; a card that had shrunk more gets no more); else the card is exactly as
  // before and the activity card gets the row instead, when it has room.
  const row = officeHoursRow(s, ctx.L);
  return row ? withRoomyRow(spec, row, ctx.L, 1) : spec;
}

/**
 * The office-hours row (stats.officeHours, see shownOfficeHours) for the power-hour or
 * activity card: "Office hours" and "95 commits · 23%", or "1,234 · 23%" when the full
 * value would be cut on the row (so the percent always shows); null without an
 * office-hours commit, or when even the short value would be cut (never a cut row).
 */
function officeHoursRow(s, L) {
  const o = shownOfficeHours(s);
  if (!o) return null;
  const pct = weekendPercentLabel(o.percent, L.pct);
  const full = `${plural(o.commits, 'commit', L)} · ${pct}`;
  const row = { label: L.recap.officeHours, value: rowValueFits(full) ? full : `${L.num(o.commits)} · ${pct}` };
  return rowFits(row) ? row : null;
}

/**
 * Whether the power-hour card shows the office-hours row (it is only added in spare room),
 * so the activity card shows it exactly when the power-hour card does not.
 */
export function officeHoursOnPeak(s, ctx) {
  const row = officeHoursRow(s ?? {}, ctx.L);
  if (!row) return false;
  const lines = peakHourWithoutSessions(s ?? {}, ctx).lines;
  return Array.isArray(lines) && lines.some((r) => r?.label === row.label && r?.value === row.value);
}

function peakHourBase(s, { L }) {
  const P = L.peak;
  const h = s.habits ?? {};
  const label = peakHourText(h, L);
  if (!label) {
    return { eyebrow: P.eyebrow, big: P.noneBig, title: P.noneTitle, subtitle: P.noneSubtitle, chart: habitCharts(h, L) };
  }
  const lead = h.peakHourTied ? P.tied(label, h.peakHourCount) : P.landed(h.peakHourCount, label);
  const day = peakDayText(h, L);
  const busiest = day ? (h.peakWeekdayTied ? P.dayTied(day) : P.dayBusiest(day)) : null;
  const late = shownLateNights(s);
  const card = (quip) => peakHourCard(s, { label, lead, quip, busiest, late }, L);
  const { withTz, withLate } = card(hourQuip(h.peakHour, L));
  // A night power hour's quip makes the subtitle four lines long, which leaves no room for
  // the "Late nights" row: then the short night quip takes its place, else no quip at all,
  // but only when that makes the row fit (else, and for every other card, the card is
  // exactly as before).
  if (late && withLate === withTz && isNightHour(h.peakHour)) {
    // Only the quip may give way: the busiest weekday (when the card showed it) and the
    // time zones (always) must still show.
    const tz = shownTimezones(s.timezones);
    const keeps = (c) => (!busiest || !drawsSentence(withTz, busiest, L) || drawsSentence(c, busiest, L))
      && (!tz || drawsSentence(c, P.timezones(tz.count, tz.top ? utcLabel(tz.top) : null), L) || (c.lines ?? []).some((r) => r.label === L.recap.timezonesValue(tz.count)));
    for (const quip of [P.nightQuip, '']) {
      const short = card(quip);
      if (short.withLate !== short.withTz && keeps(short.withLate)) return withLatest(short.withLate, late, L);
    }
  }
  return withLate === withTz ? withTz : withLatest(withLate, late, L);
}

/**
 * The power-hour card for the hour `label` with `quip` after `lead` in its subtitle (then
 * `busiest`), as `{withTz, withLate}`: the card with its time zones (always, see
 * withTimezones), and that card with the "Late nights" row for `late` (a shownLateNights()
 * value) when the row fits, else `withTz` itself (also without late-night commits).
 */
function peakHourCard(s, { label, lead, quip, busiest, late }, L) {
  const P = L.peak;
  const h = s.habits ?? {};
  const parts = [quip ? `${lead} ${quip}` : lead];
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
  const withTz = tz ? withTimezones(spec, tz, { lead, busiest }, L) : spec;
  // Commits between 00:00 and 04:59 (stats.lateNights) as a row, with the same allowance as
  // the time-zones row (the big word at most one step smaller, shared with it); without
  // late-night commits, or without room, the card is exactly as before.
  if (!late) return { withTz, withLate: withTz };
  // "12 commits · 4%", or "1,234 · 12%" when the full value would be cut short on the row
  // (e.g. 1,000+ commits with a two-digit share), so the percent always shows; when even
  // the short value would be cut (a billion+ commits), no row (never a cut one).
  const pct = weekendPercentLabel(late.percent, L.pct);
  const full = `${plural(late.commits, 'commit', L)} · ${pct}`;
  const row = { label: P.lateNights, value: rowValueFits(full) ? full : `${L.num(late.commits)} · ${pct}` };
  if (!rowFits(row)) return { withTz, withLate: withTz };
  // One shrink step in all: when the card had not shrunk (before any time-zones row), the
  // late-nights row may take one; a step the time-zones row already took is shared, and a
  // card that had shrunk before gets no more.
  const before = layoutOf({ ...spec, lang: L.code }).shrinkSteps;
  const allowed = Math.max(layoutOf({ ...withTz, lang: L.code }).shrinkSteps, before === 0 ? 1 : before);
  return { withTz, withLate: withRoomyRow(withTz, row, L, allowed) };
}

/** `spec` (with its "Late nights" row) with the "Latest night" row after it in spare room only (see withRoomyRow). */
function withLatest(spec, late, L) {
  const latest = latestNightValue(late.latest, L);
  return latest ? withRoomyRow(spec, { label: L.peak.latestLabel, value: latest }, L) : spec;
}

/**
 * The power-hour card's "Latest night" row value for `latest` (shownLateNights(...).latest,
 * `{date, hour, minute}`): "4:12 AM · Mar 3, 2024" when a row draws it whole, else the
 * year-less "4:12 AM · Mar 3" (an English date is always too long for a row), else null
 * (no row). The recap and wrapped.md always show the full date.
 */
export function latestNightValue(latest, L = EN) {
  const d = parseDay(latest?.date);
  if (!d || !Number.isInteger(latest.hour) || !Number.isInteger(latest.minute)) return null;
  const time = L.clock(latest.hour, latest.minute);
  return [L.date(d.day, d.month, d.year), L.dayMonth(d.day, d.month)].map((day) => L.peak.latestValue(time, day)).find(rowValueFits) ?? null;
}

/**
 * `spec` with `row` as its last row when that fits: the same charts drawn (and at most 6
 * rows) with at most `maxSteps` shrink steps (default: no more than `spec` itself takes,
 * so the big word, title and subtitle keep their size and lines; flexible charts may give
 * back the extra height they had, down to their natural one, as for the time-zones row),
 * else `spec` itself (so the card is byte-identical).
 */
function withRoomyRow(spec, row, L, maxSteps) {
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (lines.length >= MAX_ROWS) return spec;
  const next = { ...spec, lines: [...lines, row] };
  const base = layoutOf({ ...spec, lang: L.code });
  const l = layoutOf({ ...next, lang: L.code });
  const same = l.drawnCharts.length === base.drawnCharts.length && l.drawnCharts.every((x, i) => x === base.drawnCharts[i]);
  return same && l.shrinkSteps <= Math.max(base.shrinkSteps, maxSteps ?? 0) ? next : spec;
}

/** Whether the card `spec` draws `sentence` whole in its subtitle (see subtitleText). */
const drawsSentence = (spec, sentence, L) => subtitleText(layoutOf({ ...spec, lang: L.code })).includes(escapeXml(sentence).replace(/\s+/g, ' '));

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
  const spec = streakWithoutSessions(s, ctx);
  // Coding sessions (stats.sessions) as the last row, in spare room only (see sessionsCard).
  return sessionsCard(s, ctx) === 'streak' ? withSessionsRow(spec, sessionsRows(s, ctx.L), ctx.L) : spec;
}

/**
 * The coding-sessions row (stats.sessions, see shownSessions) in each form drawn whole
 * (see rowFits), longest first: "42 coding sessions" and "longest 3h 10m", then "42
 * sessions" with the same value, then "Sessions" and just "42" (a single session: "1
 * coding session" and just its length, "26h 41m"). The hover text says it
 * in words (median and the longest session's commits too). Null without a session that
 * lasted a minute or more (shownSessions), or when even the short form would be cut.
 */
function sessionsRows(s, L) {
  const r = shownSessions(s);
  if (!r) return null;
  const S = L.streak;
  const description = S.sessionsDescription(r.count, r.medianMinutes, r.longest.minutes, r.longest.commits);
  const longest = S.sessionsRowValue(r.count, r.longest.minutes);
  const forms = [[S.sessionsRowLabel(r.count), longest], [S.sessionsRowShort(r.count), longest], [S.sessionsLabel, L.num(r.count)]];
  const rows = forms.map(([label, value]) => ({ label, value, description })).filter((row) => rowFits(row));
  return rows.length > 0 ? rows : null;
}

/**
 * `spec` with the first of `rows` (see sessionsRows) that fits as its last row: room for
 * another row (at most 6), every chart still drawn and no shrink step more than `spec`
 * takes (see fitsLike), so no other row is moved, folded or left out and the big number
 * and text keep their size (a flexible chart may give up some of its spare height, as for
 * the cadence row). A card without rows yet gets its first one on the same terms. Else
 * `spec` itself, so the card is byte-identical to one without the stat.
 */
function withSessionsRow(spec, rows, L) {
  const lines = Array.isArray(spec?.lines) ? spec.lines : [];
  if (!Array.isArray(rows) || lines.length >= MAX_ROWS || (spec.lines !== undefined && !Array.isArray(spec.lines))) return spec;
  for (const row of rows) {
    const next = { ...spec, lines: [...lines, row] };
    if (fitsLike(next, spec, 0, L)) return next;
  }
  return spec;
}

/**
 * Which card shows the coding-sessions row (stats.sessions): 'streak' when the streak card
 * has spare room for it (see withSessionsRow), else 'peak-hour' when the power-hour card
 * has (after its other rows), else null (the sessions are still in the recap, wrapped.md
 * and stats.json). Never both, and never in place of another row.
 */
export function sessionsCard(s, ctx) {
  const rows = sessionsRows(s ?? {}, ctx.L);
  if (!rows) return null;
  const st = streakWithoutSessions(s ?? {}, ctx);
  if (withSessionsRow(st, rows, ctx.L) !== st) return 'streak';
  const p = peakHourWithoutSessions(s ?? {}, ctx);
  return withSessionsRow(p, rows, ctx.L) !== p ? 'peak-hour' : null;
}

/** The streak card without the coding-sessions row (see streak, sessionsCard). */
function streakWithoutSessions(s, ctx) {
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
  const spec = {
    eyebrow: S.eyebrow,
    big: L.num(len),
    title: len === 1 ? S.titleOne : S.titleMany,
    subtitle: [
      range ? (len === 1 ? S.onRange(range) : S.fromRange(range)) : '',
      streakNow(cur, end, L),
    ].filter(Boolean).join(' '),
    chart: pause ? [chart, pause] : chart,
  };
  // Commits per active day and the usual gap between active days (stats/cadence.js), as
  // one row, only when there is room for it (see withCadence).
  const cadence = shownCadence(s, ctx.today);
  return cadence ? withCadence(spec, cadence, L) : spec;
}

/** The rows a layout draws, as XML-escaped text (each row's label and value, in order). */
const rowsText = (layout) => {
  const svg = layout.blocks.find((b) => b.kind === 'rows')?.svg ?? '';
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
};

/**
 * The streak card `spec` with a cadence row ("2.4 per active day" · "every 3 days", from
 * a shownCadence() value) after its rows when it fits: room for another row, the
 * same charts drawn (the break panel too), no more shrink steps than before (the big
 * number, text and bars keep their size; the bar chart may give up some of its spare
 * spacing between bars) and the row's label and value
 * drawn whole. Else `spec` unchanged, so the card is exactly what it was before.
 */
function withCadence(spec, cadence, L) {
  const S = L.streak;
  const row = {
    label: S.cadenceRow(cadence.perActiveDay),
    value: S.cadenceEvery(cadence.medianGapDays),
    // The card's text description reads the recap's wording ("2.4 commits per active day · every 3 days").
    description: `${S.cadencePerDay(cadence.perActiveDay)} · ${S.cadenceEvery(cadence.medianGapDays)}`,
  };
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (lines.length >= MAX_ROWS) return spec;
  const next = { ...spec, lines: [...lines, row] };
  if (!fitsLike(next, spec, 0, L)) return spec;
  const drawn = rowsText(layoutOf({ ...next, lang: L.code }));
  const whole = [row.label, row.value].map((t) => escapeXml(t));
  return drawn.slice(-2).every((t, i) => t === whole[i]) && drawn.length === 2 * next.lines.length ? next : spec;
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
  const spec = {
    eyebrow,
    big: L.num(days.length),
    title: A.title(days.length),
    subtitle: parts.join(' '),
    chart: { kind: 'calendar', days },
  };
  // Commits on a weekend (stats.weekend) as a row, only when the grid shows every commit
  // (not clipped to 53 weeks, no future-dated day left off) and there is room for it
  // with the calendar's cells kept at their normal minimum size or larger.
  const weekend = win.clipped || dropped ? null : weekendRow(s, L);
  const withWeekend = weekend ? withCalendarRow(spec, weekend, L) : spec;
  // Weekday commits between 09:00 and 17:59 (stats.officeHours) after it, on the same
  // terms, when the power-hour card had no room for the row (see officeHoursOnPeak); else
  // the card is exactly as before.
  const office = win.clipped || dropped ? null : officeHoursRow(s, L);
  return office && !officeHoursOnPeak(s, ctx) ? withCalendarRow(withWeekend, office, L) : withWeekend;
}

/**
 * The activity card's weekend row (see stats/weekend.js shownWeekend): "Weekends" and
 * "12 commits · 8%", the percent Weekend Warrior quotes, or "1,234 · 8%" when the full
 * value would be cut on the row (so the percent always shows); null without a weekend
 * commit, or when even the short value would be cut (never a cut row).
 */
function weekendRow(s, L) {
  const w = shownWeekend(s);
  if (!w) return null;
  const pct = weekendPercentLabel(w.percent, L.pct);
  const full = `${plural(w.commits, 'commit', L)} · ${pct}`;
  const row = { label: L.recap.weekend, value: rowValueFits(full) ? full : `${L.num(w.commits)} · ${pct}` };
  return rowFits(row) ? row : null;
}

/**
 * The activity card `spec` with `row` added after its rows when it fits: room for another
 * row, the same charts drawn, no more shrink steps than before, and the calendar's cells
 * still at least their normal minimum size (CALENDAR_MIN_CELL): the calendar may give up
 * spare height, so its cells can get smaller, but never below that. Else `spec` unchanged.
 */
function withCalendarRow(spec, row, L) {
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (lines.length >= MAX_ROWS) return spec;
  const next = { ...spec, lines: [...lines, row] };
  if (!fitsLike(next, spec, 0, L)) return spec;
  const cells = layoutOf({ ...next, lang: L.code }).blocks.filter((b) => b.kind === 'calendar').map((b) => b.cell);
  return cells.length > 0 && cells.every((c) => Number.isFinite(c) && c >= CALENDAR_MIN_CELL) ? next : spec;
}

/**
 * stats.hotFiles with a non-empty string path, email-shaped text in each path cut again
 * (stats already does, see stats/files.js), so no input can show an address.
 */
const shownHotFiles = (s) => (Array.isArray(s?.hotFiles) ? s.hotFiles : [])
  .filter((f) => typeof f?.path === 'string' && text(scrubEmails(f.path)))
  .map((f) => ({ ...f, path: scrubEmails(f.path) }));

function hotFiles(s, ctx) {
  const spec = hotFilesBase(s, ctx);
  return docsCard(s, ctx) === 'hot-files' ? withDocsRow(spec, docsRow(s, ctx.L), s, ctx.L) : spec;
}

/** The hot-files card without the docs-share row (see hotFiles, docsCard). */
function hotFilesBase(s, { L, repos }) {
  const H = L.hotFiles;
  const files = shownHotFiles(s);
  if (files.length === 0) {
    return { eyebrow: H.eyebrow, big: H.noneBig, title: H.noneTitle, subtitle: H.noneSubtitle, ...(repos ? { chart: repoFileBars(repos, L) } : {}) };
  }
  const [top] = files;
  const tied = files.length > 1 && num(files[1].commits) === num(top.commits);
  const spec = {
    eyebrow: H.eyebrow,
    big: basename(top.path),
    title: tied ? H.titleTied : H.title,
    subtitle: H.subtitle(top.commits, signedLines(top.linesAdded, '+', L), signedLines(top.linesRemoved, '−', L)),
    chart: hotFileCharts(files, repos, L),
  };
  // The most-changed top-level folders (stats.folders, two or more) as a small list after
  // the other charts, in spare room only (see withFolders); without it the card is exactly
  // as before.
  const folders = shownFolders(s.folders);
  const withList = folders ? withFolders(spec, folders, L) : spec;
  // The test share (stats.tests) as a row, after the folders are placed and in spare room
  // only (see withRoomyRow): every chart still drawn, nothing shrinking; else the card is
  // exactly as before and the languages card gets the row instead, when it has room.
  const row = testsRow(s, L);
  const withTests = row ? withRoomyRow(withList, row, L) : withList;
  // The co-change pair (stats.coChange) last, on the same terms: in spare room only, after
  // every other row, so it never takes their place; else the card is exactly as before.
  const pair = coChangeRow(s, L);
  return pair ? withRoomyRow(withTests, pair, L) : withTests;
}

/**
 * The co-change row (stats.coChange, see stats/cochange.js shownCoChange) for the
 * hot-files card, in the first form drawn whole (the row is only ever drawn whole), trying
 * the names in steps:
 * 1. the file names (when both have the same name, folders from the end until they
 *    differ: "lib/index.js + src/index.js");
 * 2. then, for same-name files, both paths middle-elided from their first folder
 *    ("api/…/index.js + web/…/index.js", the most kept folders first, alike names skipped);
 * 3. then, when the paths share leading folders, the same from the first folder where they
 *    differ ("packages/a/src/index.js" → "a/…/index.js").
 * Each step tries its names in coChangeRow's row shapes, in order: "Changed together" and
 * "a.js + b.js · 12×", else "a.js + b.js" and "12× together", else "a.js + b.js" and "12×".
 * Null without a pair, or when nothing fits. The full paths are in its description, the
 * recap and wrapped.md.
 */
function coChangeRow(s, L) {
  const pair = shownCoChange(s?.coChange);
  if (!pair) return null;
  const H = L.hotFiles;
  const [a, b] = pair.files;
  // The file names, with segments added from the end until the two differ
  // ("packages/a/src/index.js" + "packages/b/src/index.js" → "a/src/index.js + b/src/index.js").
  const tail = (p, n) => String(p).split('/').filter(Boolean).slice(-n).join('/') || String(p);
  const depth = Math.max(a.split('/').length, b.split('/').length);
  let short = [basename(a), basename(b)];
  for (let n = 2; short[0] === short[1] && n <= depth; n++) short = [tail(a, n), tail(b, n)];
  // Paths that still read alike (only "a/x" and "a//x"-style spellings): no row.
  if (short[0] === short[1]) return null;
  const description = H.coChangeDescription(a, b, pair.commits);
  return coChangeRowFor(short[0], short[1], pair.commits, description, H) ?? elidedCoChangeRow(a, b, pair.commits, description, H);
}

/** The first co-change row shape (see coChangeRow) that names `x` and `y` whole, or null. */
function coChangeRowFor(x, y, commits, description, H) {
  const rows = [
    { label: H.coChange, value: H.coChangeValue(x, y, commits), description },
    { label: H.coChangePair(x, y), value: H.coChangeTimes(commits), description },
    { label: H.coChangePair(x, y), value: H.coChangeTimesShort(commits), description },
  ];
  return rows.find((r) => rowFits(r)) ?? null;
}

/**
 * coChangeRow's steps 2 and 3: the two paths middle-elided (elidedPathForms) from their
 * first folder, then from the first folder where they differ; within a step, for k from
 * the deepest elision down to 1 (a path with no elided form that keeps k segments is shown
 * whole), skipping a k where the two names read alike. Only for same-name files: else the
 * file names (step 1) are already the shortest names that differ.
 */
function elidedCoChangeRow(a, b, commits, description, H) {
  if (basename(a) !== basename(b)) return null;
  const segs = [a, b].map((p) => String(p).split('/').filter(Boolean));
  let shared = 0;
  while (shared < Math.min(segs[0].length, segs[1].length) - 1 && segs[0][shared] === segs[1][shared]) shared++;
  const starts = shared > 0 ? [0, shared] : [0];
  for (const from of starts) {
    const names = segs.map((sg) => {
      const whole = sg.slice(from).join('/');
      const forms = elidedPathForms(whole); // forms[i] keeps the last (forms.length − i) segments
      return { forms, at: (k) => (k <= forms.length ? forms[forms.length - k] : whole) };
    });
    for (let k = Math.max(...names.map((n) => n.forms.length)); k >= 1; k--) {
      const [x, y] = names.map((n) => n.at(k));
      if (x === y) continue; // alike names: keep fewer folders only if they then differ
      const row = coChangeRowFor(x, y, commits, description, H);
      if (row) return row;
    }
  }
  return null;
}

/**
 * The test-share row (stats.tests, see shownTests) for the hot-files or languages card:
 * "Tests" and "1,234 lines · 23%", or "1,234 · 23%" when the full value would be cut on
 * the row (so the percent always shows); null without a changed test line, or when even
 * the short value would be cut (the row is only ever drawn whole).
 */
function testsRow(s, L) {
  const t = shownTests(s?.tests);
  if (!t) return null;
  const H = L.hotFiles;
  const pct = testsShareText(t, L);
  const full = H.testsValue(t.lines, pct);
  const row = { label: H.tests, value: rowValueFits(full) ? full : H.testsShort(t.lines, pct), description: H.testsDescription(t.lines, pct) };
  // Even the short value can be cut (a billion+ lines): then no row, never a cut one.
  return rowFits(row) ? row : null;
}

/**
 * A shownTests() value's share as shown: a whole percent of the lines changed, "<1%" when
 * it rounds to 0, never "100%" short of every line. Used by the cards, the recap and
 * wrapped.md, so they agree.
 */
export const testsShareText = (t, L = EN) => weekendPercentLabel(t?.percent ?? 0, L.pct);

/**
 * Whether the hot-files card shows the test-share row (it is only added in spare room), so
 * the languages card shows it exactly when the hot-files card does not.
 */
export function testsOnHotFiles(s, ctx) {
  const row = testsRow(s ?? {}, ctx.L);
  if (!row) return false;
  const lines = hotFilesBase(s ?? {}, ctx).lines;
  return Array.isArray(lines) && lines.some((r) => r?.label === row.label && r?.value === row.value);
}

/**
 * The docs-share row (stats.docShare, see shownDocShare) for the hot-files or languages
 * card, as testsRow: "Docs" and "1,234 lines · 23%", or "1,234 · 23%" when the full value
 * would be cut; null without a changed doc line, or when even the short value would be cut.
 */
function docsRow(s, L) {
  const d = shownDocShare(s?.docShare);
  if (!d) return null;
  const H = L.hotFiles;
  const pct = testsShareText(d, L);
  const full = H.docsValue(d.lines, pct);
  const row = { label: H.docs, value: rowValueFits(full) ? full : H.docsShort(d.lines, pct), description: H.docsDescription(d.lines, pct) };
  return rowFits(row) ? row : null;
}

/**
 * `spec` (a hot-files or languages card without the docs row) with the docs `row` right
 * after its "Tests" row, or, without one, before the hot-files card's co-change row, else
 * last, when that fits on withRoomyRow's terms (at most 6 rows, the same charts drawn,
 * nothing shrinking more); else `spec` itself. Every row already on the card stays: the
 * docs row only ever takes spare room.
 */
function withDocsRow(spec, row, s, L) {
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (!row || lines.length >= MAX_ROWS) return spec;
  const same = (a, b) => a && b && a.label === b.label && a.value === b.value;
  const tests = testsRow(s, L);
  const pair = coChangeRow(s, L);
  let at = lines.findIndex((r) => same(r, tests));
  if (at >= 0) at += 1;
  else at = lines.findIndex((r) => same(r, pair));
  if (at < 0) at = lines.length;
  const next = { ...spec, lines: [...lines.slice(0, at), row, ...lines.slice(at)] };
  const base = layoutOf({ ...spec, lang: L.code });
  const l = layoutOf({ ...next, lang: L.code });
  const fits = l.drawnCharts.length === base.drawnCharts.length && l.drawnCharts.every((x, i) => x === base.drawnCharts[i]);
  return fits && l.shrinkSteps <= base.shrinkSteps ? next : spec;
}

/**
 * Which card shows the docs-share row: 'hot-files', 'languages' or null (no row, or no
 * room on either). The card the "Tests" row is on is tried first (the hot-files card when
 * neither has it, as for the tests row), then the other; on each it only takes spare room
 * (see withDocsRow), after every other row is placed, so it never displaces one.
 */
export function docsCard(s, ctx) {
  const row = docsRow(s ?? {}, ctx.L);
  if (!row) return null;
  const hot = shownHotFiles(s ?? {}).length > 0 ? hotFilesBase(s ?? {}, ctx) : null;
  const lang = languagesBase(s ?? {}, ctx);
  const tests = testsRow(s ?? {}, ctx.L);
  const testsOnLanguages = !!tests && Array.isArray(lang.lines) && lang.lines.some((r) => r?.label === tests.label && r?.value === tests.value);
  const candidates = [['hot-files', hot], ['languages', lang.chart ? lang : null]];
  if (testsOnLanguages) candidates.reverse();
  for (const [id, spec] of candidates) {
    if (spec && withDocsRow(spec, row, s ?? {}, ctx.L) !== spec) return id;
  }
  return null;
}

/** How many folders the hot-files card lists at most (stats.folders keeps five). */
const CARD_FOLDERS = 3;

/** A shownFolders() entry's name as shown: "src/", or the language's "(root)". */
const folderName = (f, L) => (f.root ? L.hotFiles.rootFolder : `${clip(text(f.name) ?? '')}/`);

/**
 * A shownFolders() entry as the recap and wrapped.md name it: "src/", the language's
 * "(root)", and in a multi-repo run with the repo label first ("api/src/", "api/(root)").
 */
export const folderLabel = (f, L = EN) => `${f.repo ? `${f.repo}/` : ''}${folderName(f, L)}`;

/**
 * The top-folders list for the hot-files card: one bar per folder by lines changed, the
 * folder's name in bold and, in a multi-repo run, its repo label dimmed after it (as the
 * hot files show their folder). withFolders only adds it where it fits.
 */
function folderBars(folders, L) {
  const H = L.hotFiles;
  return {
    kind: 'hbars',
    title: H.foldersTitle,
    items: folders.map((f) => {
      const name = folderName(f, L);
      const full = folderLabel(f, L);
      return {
        label: name,
        ...(f.repo ? { sub: f.repo } : {}),
        value: H.folderValue(f.lines),
        amount: f.lines,
        // A top folder is a single segment (the repo label is its `sub`): no folders to
        // elide as hot files' paths are ("first/…/near"), so a long name keeps the middle cut.
        truncate: 'middle',
        title: H.folderBarTitle(full, f.lines, signedLines(f.added, '+', L), signedLines(f.deleted, '−', L), f.commits),
      };
    }),
  };
}

/**
 * The hot-files card `spec` with the top folders (a shownFolders() value) as a small bar
 * list after its charts, in the first of these that fits: the first CARD_FOLDERS folders,
 * then the first two, with nothing shrinking; then the same with the big word one step
 * (15%) smaller, when nothing had shrunk (as for the messages card's emoji row). Fitting
 * means every chart the card drew is still drawn, at full size (the hot-files list keeps
 * all its files, as does the per-repo chart; only the spare space between their bars can
 * get tighter), and the list itself is drawn. Else `spec` unchanged, so a card without
 * room for it is exactly what it was (the folders are still in the recap, wrapped.md and
 * stats.json).
 */
function withFolders(spec, folders, L) {
  const charts = Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : [];
  const base = layoutOf({ ...spec, lang: L.code });
  const drawn = [...base.drawnCharts, charts.length];
  const steps = base.shrinkSteps === 0 ? [0, 1] : [0];
  for (const more of steps) {
    for (const n of [CARD_FOLDERS, 2]) {
      const candidate = { ...spec, chart: [...charts, folderBars(folders.slice(0, n), L)] };
      const l = layoutOf({ ...candidate, lang: L.code });
      if (l.shrinkSteps <= base.shrinkSteps + more && l.drawnCharts.length === drawn.length && l.drawnCharts.every((x, i) => x === drawn[i])) return candidate;
    }
  }
  return spec;
}

/**
 * The hot-files card's charts: the most-touched files (paths of a multi-repo run start
 * with the repo label, shown dimmed after the file name), plus, for several repos, the
 * files touched per repo; then the file list is cut to 3 so both fit. A folder too long for
 * its bar is middle-elided ("packages/…/src/lib/"), keeping its first folder (the repo label
 * in a multi-repo run) and the nearest ones.
 */
function hotFileCharts(files, repos, L) {
  const H = L.hotFiles;
  const shown = files.slice(0, repos ? 3 : 5);
  const list = {
    kind: 'hbars',
    title: H.chartTitle,
    items: shown.map((f) => ({
      label: basename(f.path),
      sub: dirname(f.path),
      subTruncate: 'path',
      ...sameNameSubForms(f.path, shown.map((g) => g.path)),
      value: plural(f.commits, 'commit', L),
      amount: num(f.commits),
      truncate: 'middle',
      title: H.barTitle(f.path, f.commits, signedLines(f.linesAdded, '+', L), signedLines(f.linesRemoved, '−', L)),
    })),
  };
  return repos ? [list, repoFileBars(repos, L)] : list;
}

/**
 * For a hot file whose name another listed file shares, with leading folders in common,
 * (`{subForms}`, else `{}`): shorter forms of its folder that tell the two apart, tried
 * before the usual middle elision (which keeps the first folder, and could make both read
 * "packages/…/forms/"). First the elided forms from the first folder that still keep the
 * folder where they differ, then the folder from that one on ("core/forms/") and its
 * elided forms ("core-x/…/forms/"). When none fits, `subCut` (that tail) is cut in the
 * middle, never the usual elision or a start cut, which could hide the folder where they differ.
 */
function sameNameSubForms(path, paths) {
  const dir = dirname(path);
  const segs = dir.split('/').filter(Boolean);
  let shared = 0;
  for (const other of paths) {
    if (other === path || basename(other) !== basename(path)) continue;
    const o = dirname(other).split('/').filter(Boolean);
    let d = 0;
    while (d < Math.min(segs.length, o.length) && segs[d] === o[d]) d++;
    shared = Math.max(shared, d);
  }
  if (shared === 0 || shared >= segs.length) return {};
  // elidedPathForms(dir)[i] keeps the last (segs.length − 2 − i) folders; keep folder `shared`.
  const keeping = elidedPathForms(dir).filter((_, i) => segs.length - 2 - i >= segs.length - shared);
  const tail = `${segs.slice(shared).join('/')}/`;
  return { subForms: [...keeping, tail, ...elidedPathForms(tail)], subCut: tail };
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

function languages(s, ctx) {
  const spec = languagesBase(s, ctx);
  return docsCard(s, ctx) === 'languages' ? withDocsRow(spec, docsRow(s, ctx.L), s, ctx.L) : spec;
}

/** The languages card without the docs-share row (see languages, docsCard). */
function languagesBase(s, ctx) {
  const spec = languagesCard(s, ctx);
  // The test share (stats.tests) when the hot-files card had no room for it (see
  // testsOnHotFiles), on the same terms: in spare room only, else the card is unchanged.
  const row = spec.chart ? testsRow(s, ctx.L) : null;
  return row && !testsOnHotFiles(s, ctx) ? withRoomyRow(spec, row, ctx.L) : spec;
}

function languagesCard(s, { L }) {
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

function messages(s, ctx) {
  const without = messagesWithoutDepBumps(s, ctx);
  // The dependency-bumps row (stats.depBumps) when the totals card has no room for it (see depBumpsCard).
  const spec = depBumpsCard(s, ctx) === 'messages' ? withLastRow(without, depBumpsRow(s, ctx.L), ctx.L) : without;
  // The subject length row (stats.messages.subjectLength) last of all, appended in spare
  // room only (its longest form that fits): it never folds, shrinks or displaces anything.
  for (const row of subjectLengthRows(s, ctx.L) ?? []) {
    const next = withLastRow(spec, row, ctx.L);
    if (next !== spec) return next;
  }
  return spec;
}

/**
 * The share of non-merge commits with a subject over 72 characters (shownSubjectLength
 * output) as shown: a whole percent, "<1%" when it rounds to 0 with any, never "100%"
 * short of every commit (see shareLabel). Used by the messages card, the recap and
 * wrapped.md, so they agree.
 */
export const subjectLengthShareText = (r, L = EN) => shareLabel(r?.pct, r?.over72, L.pct);

/**
 * The messages card's subject length row (stats.messages.subjectLength, see
 * shownSubjectLength) in each form drawn whole (see rowFits), longest first:
 * "Subject length" and "48 · 12% over 72" (the median subject length, and the share of
 * non-merge commits whose subject is longer than 72 characters; just "median 48" when
 * none is), then "48 · 12% >72" ("48"). Null without the stat (no non-merge commit, or a
 * stats.json from before it), or when even the short form would be cut. The hover text
 * says it in words. It is the card's lowest-priority row: messages() appends it after
 * every other row (issue references and dependency bumps included), on withLastRow's
 * terms, so it never folds, shrinks or displaces anything.
 */
function subjectLengthRows(s, L) {
  const r = shownSubjectLength(s?.messages?.subjectLength);
  if (!r) return null;
  const M = L.messages;
  const pct = subjectLengthShareText(r, L);
  const description = M.subjectLengthDescription(r.median, r.over72, pct);
  const forms = [
    [M.subjectLengthTitle, M.subjectLengthValue(r.median, r.over72, pct)],
    [M.subjectLengthTitle, M.subjectLengthShort(r.median, r.over72, pct)],
  ];
  const rows = forms.map(([label, value]) => ({ label, value, description })).filter((row) => rowFits(row));
  return rows.length > 0 ? rows : null;
}

/** The messages card without the dependency-bumps row (see messages, depBumpsCard). */
function messagesWithoutDepBumps(s, ctx) {
  // The cleanup rows (stats.cleanups) go here or on the totals card, never both (see
  // cleanupsPlacement); without them the card is exactly messagesBase's.
  const place = cleanupsPlacement(s, ctx);
  const base = messagesBase(s, ctx);
  const spec = place?.card === 'messages' ? place.spec : base.card;
  // The issue references row (stats.issueRefs) after the rows so far, in spare room only.
  const rows = issueRefsRows(s, ctx.L);
  return rows ? withIssueRefs(spec, rows, base.parts, ctx.L) : spec;
}

/**
 * A fixup-commits share (stats/messages.js shownFixups output) as shown: a whole percent
 * of the non-merge commits, "<1%" when it rounds to 0, never "100%" short of every commit
 * (see shareLabel). Used by the messages card, the recap and wrapped.md, so they agree.
 */
export const fixupShareText = (f, L = EN) => shareLabel(f?.pct, f?.commits, L.pct);

/**
 * An issue-references share (shownIssueRefs output) as shown: a whole percent of the
 * non-merge commits, "<1%" when it rounds to 0, never "100%" short of every commit (see
 * shareLabel). Used by the messages card, the recap and wrapped.md, so they agree.
 */
export const issueRefsShareText = (r, L = EN) => shareLabel(r?.pct, r?.commits, L.pct);

/**
 * The messages card's issue references row (stats.issueRefs, see shownIssueRefs) in each
 * form drawn whole (see rowFits), longest first: "Issue refs (top #128 ×9)" and "42 · 12%"
 * (the count, its share of non-merge commits, and the most referenced issue, "web#128"
 * with a repo label), then "Issue refs" and "42 · 12% (#128 ×9)", then "Issue refs" and
 * "42 · 12%" (the only form without a shown top, see shownIssueRefs). Null without
 * referencing commits, or when even the short form would be cut. The hover text has it all.
 */
function issueRefsRows(s, L) {
  const r = shownIssueRefs(s?.issueRefs);
  if (!r) return null;
  const M = L.messages;
  const pct = issueRefsShareText(r, L);
  const ref = r.top ? text(plain(issueRefLabel(r.top))) : null;
  const times = r.top ? r.top.commits : 0;
  const description = M.issueRefsDescription(r.commits, pct, ref, times);
  const forms = [
    ...(ref ? [[M.issueRefsTitle(ref, times), M.issueRefsValue(r.commits, pct, null, 0)], [M.issueRefsTitle(null, 0), M.issueRefsValue(r.commits, pct, ref, times)]] : []),
    [M.issueRefsTitle(null, 0), M.issueRefsValue(r.commits, pct, null, 0)],
  ];
  const rows = forms.map(([label, value]) => ({ label, value, description })).filter((row) => rowFits(row));
  return rows.length > 0 ? rows : null;
}

/**
 * The messages card `spec` (as messages() built it, cleanup rows included) with the issue
 * references row after every other row, in the first of these that fits as well as `spec`
 * did (see fitsLike: at most 6 rows, every chart still drawn), each with the longest row
 * form that fits (see issueRefsRows):
 * 1. after the rows as they are;
 * 2. with the "fix" / "wip" / "oops" rows folded into one (`parts.folded`'s last row, in
 *    the place of the first of them), when they are all still there (`parts.card`'s last
 *    three rows; the rows after them are kept);
 * 3. either of those with the big word one step (15%) smaller, when nothing shrank.
 * It never takes the place of any row or chart, so without room (or without rows: no
 * subjects) the card is `spec` itself, byte-identical.
 */
function withIssueRefs(spec, rows, parts, L) {
  if (!Array.isArray(spec.lines) || !Array.isArray(parts?.folded)) return spec;
  const layouts = [spec.lines];
  const counters = Array.isArray(parts.card?.lines) ? parts.card.lines.slice(-3) : [];
  const at = spec.lines.indexOf(counters[0]);
  if (counters.length === 3 && at >= 0 && counters.every((r, i) => spec.lines[at + i] === r)) {
    layouts.push([...spec.lines.slice(0, at), parts.folded.at(-1), ...spec.lines.slice(at + 3)]);
  }
  const steps = layoutOf({ ...spec, lang: L.code }).shrinkSteps === 0 ? [0, 1] : [0];
  for (const more of steps) {
    for (const lines of layouts) {
      for (const row of rows) {
        const next = { ...spec, lines: [...lines, row] };
        if (fitsLike(next, spec, more, L)) return next;
      }
    }
  }
  return spec;
}

/** The messages card without the cleanup rows (`card`), and messagesCard's parts (`parts`: its card and folded rows). */
function messagesBase(s, { L }) {
  const spec = messagesCard(s, L);
  const types = typeStack(s, L);
  const card = types ? withTypeMix(spec.card, types, spec.folded, L) : spec.card;
  const emoji = emojiRow(s, L);
  const withRow = emoji ? withEmoji(card, emoji, spec.folded, L) : card;
  const reverts = revertsRow(s, L);
  // The three counter rows are still there when neither the type mix nor the emoji row folded them.
  const unfolded = reverts && Array.isArray(card.lines) && card.lines !== spec.folded && withRow.lines?.length === card.lines.length + (withRow === card ? 0 : 1) && withRow.lines.slice(0, card.lines.length).every((x, i) => x === card.lines[i]);
  return { card: reverts ? withReverts(withRow, reverts, { folded: spec.folded, unfolded, emoji }, L) : withRow, parts: spec };
}

/**
 * The messages card `spec` (as withReverts left it) with the cleanup rows (see
 * cleanupsRows, withCleanups) after its rows, each fitting as well as `spec` did (see
 * fitsLike: at most 6 rows, every chart still drawn, nothing shrinking more than on
 * `spec`), in two layouts:
 * a. after the rows as they are;
 * b. with the "fix" / "wip" / "oops" rows folded into one (`parts.folded`'s last row, in
 *    the place of the first of them), when they are all still there (`parts.card`'s last
 *    three rows; the rows after them, emoji and reverts, are kept).
 * The first layout that takes every row wins; else the first that takes the count row
 * alone (a before b); without room either way, `spec` itself (so the card is byte-identical).
 */
function withLastRows(spec, rows, parts, L) {
  const add = (base) => withCleanups(base, rows, (sp, row) => {
    const next = { ...sp, lines: [...sp.lines, row] };
    return fitsLike(next, spec, 0, L) ? next : sp;
  });
  const all = rows.biggest ? 2 : 1;
  const appended = add(spec);
  if (cleanupRowsIn(appended, rows) === all) return appended;
  const counters = Array.isArray(parts.card?.lines) ? parts.card.lines.slice(-3) : [];
  const at = spec.lines.indexOf(counters[0]);
  if (counters.length !== 3 || at < 0 || !counters.every((r, i) => spec.lines[at + i] === r)) return appended;
  const compact = { ...spec, lines: [...spec.lines.slice(0, at), parts.folded.at(-1), ...spec.lines.slice(at + 3)] };
  const withRows = add(compact);
  // Every row folded beats the count row alone unfolded; else as few changes as possible.
  if (cleanupRowsIn(withRows, rows) === all || appended === spec) return withRows === compact ? spec : withRows;
  return appended;
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
  // Fixup commits (stats.messages.fixups) as a "· 3 fixup!" segment on the "fix" row, only
  // when it is drawn whole (else the row as before). The folded counter row never has room.
  const fixups = shownFixups(m.fixups);
  const fixRow = { label: M.fixCommits, value: L.num(counts.fix) };
  const fixWithFixups = fixups ? { ...fixRow, value: M.fixupsValue(fixRow.value, fixups.commits) } : null;
  const card = {
    eyebrow: M.eyebrow,
    // Same rounding as the subtitle, so the two numbers always agree.
    big: word ? quote(word) : formatAverage(m.averageLength, L),
    title: word ? M.favorite(m.topWord.count) : M.averageTitle,
    subtitle: quip,
    lines: [
      ...rows,
      fixWithFixups && rowFits(fixWithFixups) ? fixWithFixups : fixRow,
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
  const share = shareLabel(contributorShare(p), p?.commits, L.pct);
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
 * and there is room, a pairing panel follows the bars (see pairedCallout), then, in spare
 * room only, a "Bus factor" row (see busFactorRow).
 */
function contributors(s, { L }) {
  const spec = teamCard(s, L);
  const withPanel = teamWithPairing(spec, s, L) ?? spec;
  // The bus factor (stats.contributors.busFactor) as a row, after the pairing panel is
  // placed and in spare room only (see withRoomyRow): every chart still drawn, nothing
  // shrinking; else the card is exactly as before.
  const row = busFactorRow(s, L);
  return row ? withRoomyRow(withPanel, row, L) : withPanel;
}

/**
 * The bus-factor row (stats.contributors.busFactor, see shownBusFactor) for the team card:
 * "Bus factor" and "2 people · 58%", or "2 · 58%" when the full value would be cut; null
 * without a bus factor, or when even the short value would be cut (never a cut row).
 */
function busFactorRow(s, L) {
  const b = shownBusFactor(s?.contributors?.busFactor);
  if (!b) return null;
  const C = L.contributors;
  const pct = busFactorShareText(b, L);
  const full = C.busFactorValue(b.authors, pct);
  const row = { label: C.busFactor, value: rowValueFits(full) ? full : C.busFactorShort(b.authors, pct), description: C.busFactorDescription(b.authors, pct) };
  return rowFits(row) ? row : null;
}

/**
 * A shownBusFactor() value's share as shown: a whole percent of the lines changed (never
 * "100%" short of every line). Used by the card, the recap and wrapped.md, so they agree.
 */
export const busFactorShareText = (b, L = EN) => weekendPercentLabel(b?.percent ?? 0, L.pct);

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
    const share = shareLabel(contributorShare(you), you.commits, L.pct);
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
    subtitle = C.leads(personName(lead, L), shareLabel(contributorShare(lead), lead.commits, L.pct));
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
  // --year: one sentence on the change since the previous year (--since: since the window
  // before it), first (when the subtitle runs out of lines, trailing sentences are dropped).
  const yoy = commits > 0 ? yearOverYear(s) : null;
  const pop = commits > 0 && !yoy ? previousPeriod(s) : null;
  const tiles = {
    kind: 'tiles',
    items: summaryTiles(s, ctx),
    wide: top ? { label: O.hottestFile, value: top.path, note: plural(top.commits, 'commit', L), truncate: 'path' } : null,
  };
  const yoySentence = yoy
    ? L.yoy.summary(yoy.previousYear, yoy.commits, yoy.lines, yoy.activeDays)
    : pop ? L.period.summary(pop.days, pop.commits, pop.lines, pop.activeDays) : null;
  const spec = {
    eyebrow: O.eyebrow,
    big: O.big,
    title: commits > 0 ? O.inOneCard(ctx.repoName) : L.empty,
    subtitle: yoySentence ? `${yoySentence} ${O.subtitle}` : O.subtitle,
    chart: tiles,
  };
  const released = commits > 0 ? releasesCallout(s, L) : null;
  // Merged pull requests and merge commits (stats.merges), only when the totals card had
  // no room for its row (never on both cards).
  const merged = commits > 0 && !mergesOnTotals(s, ctx) ? mergesCallout(s, L) : null;
  // Both panels when they fit, else the releases panel alone (as before merges existed),
  // else the merges panel alone; with neither, the card is exactly as without them.
  const tries = [released && merged ? [released, merged] : null, released ? [released] : null, merged ? [merged] : null].filter(Boolean);
  for (const panels of tries) {
    const next = withPanels(spec, tiles, panels, yoySentence, L);
    if (next) return next;
  }
  return spec;
}

/**
 * The outro with `panels` (the releases and / or merges callouts) after its tiles, or null
 * when they do not all fit (then the card is exactly as without them). The panels are
 * `optional`, so they are only drawn when nothing else shrinks for them; to make room, the
 * subtitle gives way first: as it is, then without the static "Made with gitwrapped…" line
 * (keeping --year's comparison sentence), then with no subtitle at all (the comparison is
 * still on the totals card and the recap).
 */
function withPanels(spec, tiles, panels, yoySentence, L) {
  const { subtitle, ...rest } = spec;
  const subtitles = [subtitle, ...(yoySentence ? [yoySentence] : []), null];
  for (const sub of subtitles) {
    const next = { ...rest, ...(sub ? { subtitle: sub } : {}), chart: [tiles, ...panels] };
    if (panels.every((_, i) => draws(next, i + 1, L))) return next;
  }
  return null;
}

/**
 * Whether the totals card shows the merges row (see mergesRow; it is only added in spare
 * room), so the outro shows the merges panel exactly when the totals card does not.
 */
export function mergesOnTotals(s, ctx) {
  const row = mergesRow(s ?? {}, ctx.L);
  if (!row) return false;
  const lines = totalsBase(s ?? {}, ctx).lines;
  return Array.isArray(lines) && lines.some((r) => r?.label === row.label && r?.value === row.value);
}

/**
 * The outro's optional merges panel (stats.merges, see shownMerges): "Merges", "You merged
 * 12 pull requests" (or "8 merge commits" without pull requests) and "8 merge commits ·
 * 6% of commits" (or "6% of commits"); null with nothing to show.
 */
function mergesCallout(s, L) {
  const m = shownMerges(s.merges);
  if (!m) return null;
  const O = L.outro;
  const share = mergeShareText(m, L);
  // The note on one line, uncut: "8 merge commits · 6% of commits", else the shorter
  // "8 merge commits · 6%" (Turkish's longer phrase is cut from 10 merge commits on).
  const full = O.mergedNote(m.pullRequests, m.commits, share);
  const note = full && measureText(full, CALLOUT_NOTE.size) > CALLOUT_NOTE.maxWidth ? O.mergedNoteShort(m.pullRequests, m.commits, share) : full;
  return { kind: 'callout', optional: true, title: O.merges, value: O.mergedValue(m.pullRequests, m.commits), note };
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
  // A row may carry its own `description` (a sentence that reads better than "label: value").
  for (const l of Array.isArray(spec.lines) ? spec.lines : []) add(plain(l?.description) || pair(l?.label, l?.value));
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
