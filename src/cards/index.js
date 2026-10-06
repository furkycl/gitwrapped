// The story-card set: turns computeStats() output into Wrapped-style SVG cards.
// Pure and deterministic. Every card copes with empty stats (0 commits, null peaks,
// no hot files, null messages) and never prints "null", "undefined" or "NaN".
import { calendarWindow, formatNumber, renderCard } from './svg.js';

export { formatNumber };
import { renderShareSvg } from './share.js';
import { dayKeyFromEpoch as dayKeyOf, epochDay, mondayOf, WEEKDAY_NAMES } from '../stats/time.js';
import { languageHeadline, OTHER as OTHER_LANGUAGE } from '../stats/languages.js';
import { daysUpTo, shownLongest } from '../stats/daily.js';
import { hasTeamCard, shareLabel, TOP_CONTRIBUTORS } from '../stats/contributors.js';
import { personalityReason } from '../stats/personality.js';
import { DEFAULT_LANG, getStrings } from '../i18n/index.js';

export { renderCard, layoutCard, wrapText, escapeXml, measureText, truncateStart, THEMES, CARD_WIDTH, CARD_HEIGHT } from './svg.js';
export { renderShareSvg, SHARE_WIDTH, SHARE_HEIGHT } from './share.js';

/**
 * Every card id, in display order. Optional cards (OPTIONAL_CARD_IDS) are left out of a
 * run when they do not apply, so a card set is CARD_IDS or a subsequence of it: see
 * cardIdsFor(). Cards are numbered by their position in the actual set (01, 02, ...).
 */
export const CARD_IDS = Object.freeze(['intro', 'totals', 'peak-hour', 'streak', 'activity', 'hot-files', 'languages', 'contributors', 'messages', 'personality', 'outro']);

/** When each optional card applies (see hasTeamCard in stats/contributors.js). */
const APPLIES = {
  contributors: hasTeamCard,
};

/** Cards shown only when they apply (see cardIdsFor). */
export const OPTIONAL_CARD_IDS = Object.freeze(Object.keys(APPLIES));

/**
 * The ids of the cards built for `stats`, in display order: CARD_IDS without the
 * optional cards that do not apply (the contributors card for a single-author history,
 * or for an --author with no commits; see hasTeamCard).
 */
export function cardIdsFor(stats) {
  return CARD_IDS.filter((id) => !APPLIES[id] || APPLIES[id](stats));
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

function intro(s, ctx) {
  const { L } = ctx;
  const I = L.intro;
  const commits = num(s.totals?.commits);
  const parts = [];
  if (commits === 0) parts.push(L.empty);
  else parts.push(I.lead);
  const who = authorName(ctx.author);
  if (who) parts.push(I.starring(who));
  const shown = shownDayRange(s, ctx.today);
  const range = formatDateRange(shown.firstDay, shown.lastDay, L.code);
  const year = windowYear(ctx.since, ctx.until);
  const title = year ? I.yearTitle(year) : I.soFar;
  return {
    eyebrow: I.eyebrow,
    big: ctx.repoName,
    title: I.title,
    titleSize: 136,
    subtitle: parts.join(' '),
    chart: commits > 0
      ? { kind: 'callout', title, value: range || plural(commits, 'commit', L), note: I.toUnwrap(commits) }
      : year
        ? { kind: 'callout', title, value: I.quietYear, note: I.noCommitsIn(year) }
        : { kind: 'callout', title, value: I.chapterOne, note: I.firstCommit },
  };
}

function totals(s, { L }) {
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
  return {
    eyebrow: T.eyebrow,
    big: L.num(commits),
    title: commits === 1 ? L.units.commit[0] : L.units.commit[1],
    subtitle: perDay > 0 ? T.perDay(perDay) : T.everyOne,
    lines: rows,
    chart: {
      kind: 'split',
      title: T.linesChanged,
      segments: [
        { label: T.linesAdded, value: signedLines(t.linesAdded, '+', L), amount: Math.max(0, num(t.linesAdded)) },
        { label: T.linesRemoved, value: signedLines(t.linesRemoved, '−', L), amount: Math.max(0, num(t.linesRemoved)) },
      ],
    },
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
  const parts = [];
  if (h.peakHourTied) parts.push(`${P.tied(label, h.peakHourCount)} ${hourQuip(h.peakHour, L)}`);
  else parts.push(`${P.landed(h.peakHourCount, label)} ${hourQuip(h.peakHour, L)}`);
  const day = peakDayText(h, L);
  if (day) parts.push(h.peakWeekdayTied ? P.dayTied(day) : P.dayBusiest(day));
  return {
    eyebrow: P.eyebrow,
    big: label,
    title: h.peakHourTied ? P.titleTied : P.title,
    subtitle: parts.join(' '),
    chart: habitCharts(h, L),
  };
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
  return {
    eyebrow: S.eyebrow,
    big: L.num(len),
    title: len === 1 ? S.titleOne : S.titleMany,
    subtitle: [
      range ? (len === 1 ? S.onRange(range) : S.fromRange(range)) : '',
      streakNow(cur, end, L),
    ].filter(Boolean).join(' '),
    chart,
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
  let busiest = null;
  const weeks = new Set();
  for (const x of [...days].sort((a, b) => epochDay(a.day) - epochDay(b.day))) {
    if (!busiest || x.commits > busiest.commits) busiest = x;
    weeks.add(mondayOf(epochDay(x.day)));
  }
  return { busiest, activeWeeks: weeks.size };
}

/** Days a window must end before "today" to count as a dormant repo's final months. */
const DORMANT_DAYS = 30;

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
    const asOf = epochDay(ctx.asOf ?? '');
    const lastDay = Math.max(...days.map((x) => epochDay(x.day)));
    const end = parseDay(dayKeyOf(lastDay));
    eyebrow = asOf !== null && end && asOf - lastDay > DORMANT_DAYS
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

function hotFiles(s, { L }) {
  const H = L.hotFiles;
  const files = (Array.isArray(s.hotFiles) ? s.hotFiles : []).filter((f) => text(f?.path));
  if (files.length === 0) {
    return { eyebrow: H.eyebrow, big: H.noneBig, title: H.noneTitle, subtitle: H.noneSubtitle };
  }
  const [top] = files;
  const tied = files.length > 1 && num(files[1].commits) === num(top.commits);
  return {
    eyebrow: H.eyebrow,
    big: basename(top.path),
    title: tied ? H.titleTied : H.title,
    subtitle: H.subtitle(top.commits, signedLines(top.linesAdded, '+', L), signedLines(top.linesRemoved, '−', L)),
    chart: {
      kind: 'hbars',
      title: H.chartTitle,
      items: files.slice(0, 5).map((f) => ({
        label: basename(f.path),
        sub: dirname(f.path),
        value: plural(f.commits, 'commit', L),
        amount: num(f.commits),
        truncate: 'middle',
        title: H.barTitle(f.path, f.commits, signedLines(f.linesAdded, '+', L), signedLines(f.linesRemoved, '−', L)),
      })),
    },
  };
}

/** A whole-number share as text; a non-zero amount that rounds to 0% reads "<1%". */
const pctText = (share, amount, L = EN) => (num(share) === 0 && num(amount) > 0 ? `<${L.pct(1)}` : L.pct(Math.round(num(share))));

/**
 * Up to five languages as bars (the headline language always among them), the rest and
 * unknown file types folded into one "Other" bar. No bar reads 100% while others exist.
 */
function languageBars(h, L) {
  const G = L.languages;
  const { rows, basis } = h;
  const known = rows.filter((l) => l.name !== 'Other');
  let top = known.slice(0, 5);
  if (!top.some((l) => l.name === h.name)) top = [...top.slice(0, 4), known.find((l) => l.name === h.name)];
  const rest = rows.filter((l) => !top.includes(l));
  const cap = (share) => (rows.length > 1 ? Math.min(99, share) : share);
  const row = (label, amount, files, lines, share) => {
    const pct = pctText(cap(share), amount, L);
    return { label, sub: plural(files, 'file', L), value: pct, amount, title: G.barTitle(label, lines, files, pct) };
  };
  const items = top.map((l) => row(l.name, l[basis], l.files, l.lines, l.share));
  if (rest.length > 0) {
    const sum = (k) => rest.reduce((n, l) => n + l[k], 0);
    items.push(row(G.other, sum(basis), sum('files'), sum('lines'), sum('share')));
  }
  return { kind: 'hbars', title: basis === 'files' ? G.shareOfFiles : G.shareOfLines, items };
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
  else if (h.tied.length > 1) title = G.tied(L.andList(h.tied));
  else if (h.only) title = G.only(h.name);
  else title = h.rawShare >= 50 ? G.mostly(h.name) : G.ledBy(h.name);
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

function messages(s, { L }) {
  const M = L.messages;
  const m = s.messages ?? {};
  const longest = clip(text(m.longest?.subject));
  const shortest = clip(text(m.shortest?.subject));
  if (!longest || !shortest) {
    return { eyebrow: M.eyebrow, big: '…', title: M.noneTitle, subtitle: L.empty };
  }
  // A "favorite" word needs to show up at least twice; otherwise use the average-length copy.
  const word = num(m.topWord?.count) >= 2 ? clip(text(m.topWord?.word)) : null;
  const counts = m.counts ?? {};
  const oops = num(counts.oops);
  const quip = oops > 0 ? M.oops(oops) : M.average(formatAverage(m.averageLength, L));
  // With a single commit, longest and shortest are the same message: show it once.
  const rows = [{ label: M.longest(quote(longest)) }];
  if (shortest !== longest) rows.push({ label: M.shortest(quote(shortest)) });
  return {
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
  };
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
 * names (after .mailmap) only, never an email.
 */
function contributors(s, { L }) {
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
  const top = (Array.isArray(s.hotFiles) ? s.hotFiles : []).find((f) => text(f?.path));
  return {
    eyebrow: O.eyebrow,
    big: O.big,
    title: commits > 0 ? O.inOneCard(ctx.repoName) : L.empty,
    subtitle: O.subtitle,
    chart: {
      kind: 'tiles',
      items: summaryTiles(s, ctx),
      wide: top ? { label: O.hottestFile, value: top.path, note: plural(top.commits, 'commit', L), truncate: 'start' } : null,
    },
  };
}

const BUILDERS = { intro, totals, 'peak-hour': peakHour, streak, activity, 'hot-files': hotFiles, languages, contributors, messages, personality, outro };
const CARD_THEMES = { intro: 'pulse', totals: 'ocean', 'peak-hour': 'cosmic', streak: 'ember', activity: 'cosmic', 'hot-files': 'mint', languages: 'ocean', contributors: 'ember', messages: 'neon', personality: 'sunset', outro: 'gold' };

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
 * `repoName` (default "your repo"), `since`, `until` and `author` (as passed
 * to the CLI; shown in the copy when given), and `today` ('YYYY-MM-DD', the date the
 * stats' current streak is relative to): when `until` is before `today`, the streak card
 * talks about the streak at the end of the window instead of "right now". Returns
 * `[{id, svg, description}]` for cardIdsFor(stats), in CARD_IDS order; `description` is
 * the card's content as plain text (see cardDescription).
 */
export function buildCards(stats, opts = {}) {
  return buildCardSpecs(stats, opts).map(({ id, spec }) => ({ id, svg: renderCard(spec), description: cardDescription(spec) }));
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
    else if (c.kind === 'hbars') items.push(plain(c.title), ...(c.items ?? []).map((x) => plain(x?.title) || pair(x?.label, x?.value)));
    else if (c.kind === 'bars') items.push(plain(c.title), ...(c.titles ?? []).filter((t, i) => num(c.values?.[i]) > 0).map(plain));
    else if (c.kind === 'tiles') items.push(...(c.items ?? []).map((x) => pair(x?.label, x?.value)), ...(c.wide ? [pair(c.wide.label, `${plain(c.wide.value)} (${plain(c.wide.note)})`)] : []));
    else if (c.kind === 'calendar') items.push(plain(c.title) || L.calendarOf((c.days ?? []).length));
    for (const x of items) add(x);
  }
  return out.join(' ');
}

/**
 * The renderCard() input for every card of the set (same arguments as buildCards), as
 * `[{id, spec}]` for cardIdsFor(stats), numbered 01, 02, ... in that order;
 * buildCards() renders exactly these. Useful for layout checks.
 */
export function buildCardSpecs(stats, { repoName, since, until, author, today, lang } = {}) {
  stats = stats ?? {};
  const L = getStrings(lang);
  const ctx = { L, lang: L.code, repoName: text(repoName) ?? L.yourRepo, since: text(since), until: text(until), author: text(author), today: text(today) };
  // The day the cards are "as of": today, or the end of a window that ended before it.
  const t = parseDay(ctx.today);
  const u = parseDay(ctx.until);
  ctx.asOf = t && u && u.key < t.key ? u.key : (t?.key ?? null);
  const footer = footerText(stats, ctx);
  return cardIdsFor(stats).map((id, i) => ({
    id,
    spec: { theme: CARD_THEMES[id], footer, number: String(i + 1).padStart(2, '0'), idPrefix: `gw-${id}`, ...(L === EN ? {} : { lang: L.code }), ...BUILDERS[id](stats, ctx) },
  }));
}

/**
 * The 1200x630 share summary card (landscape, for link previews and social posts):
 * repo name, four stat tiles (commits, longest streak, power hour, personality) and the
 * hottest file. Same options as buildCards(); copes with empty stats. Returns an SVG string.
 */
export function renderShareCard(stats, { repoName, since, until, author, today, lang } = {}) {
  stats = stats ?? {};
  const L = getStrings(lang);
  const ctx = { L, lang: L.code, repoName: text(repoName) ?? L.yourRepo, since: text(since), until: text(until), author: text(author), today: text(today) };
  const year = windowYear(ctx.since, ctx.until);
  const commits = num(stats.totals?.commits);
  const top = (Array.isArray(stats.hotFiles) ? stats.hotFiles : []).find((f) => text(f?.path));
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
  });
}
