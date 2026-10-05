// The story-card set: turns computeStats() output into Wrapped-style SVG cards.
// Pure and deterministic. Every card copes with empty stats (0 commits, null peaks,
// no hot files, null messages) and never prints "null", "undefined" or "NaN".
import { calendarWindow, formatNumber, renderCard } from './svg.js';

export { formatNumber };
import { renderShareSvg } from './share.js';
import { epochDay, hourLabel, mondayOf, WEEKDAY_NAMES } from '../stats/time.js';

export { renderCard, layoutCard, wrapText, escapeXml, measureText, truncateStart, THEMES, CARD_WIDTH, CARD_HEIGHT } from './svg.js';
export { renderShareSvg, SHARE_WIDTH, SHARE_HEIGHT } from './share.js';

/** Card ids in display order. */
export const CARD_IDS = Object.freeze(['intro', 'totals', 'peak-hour', 'streak', 'activity', 'hot-files', 'messages', 'personality', 'outro']);

const EMPTY_LINE = 'No commits yet — go ship something!';

/** A finite number, else 0. */
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);


/** A line count with a leading sign ("+12" / "−3"); 0 → "0". Negatives clamp to 0. */
const signedLines = (n, sign) => {
  const v = Math.max(0, Math.round(num(n)));
  return v === 0 ? '0' : `${sign}${formatNumber(v)}`;
};

/** "1 commit", "2,048 commits". */
const plural = (n, word, many = `${word}s`) => `${formatNumber(n)} ${num(n) === 1 ? word : many}`;

const basename = (path) => String(path).split('/').filter(Boolean).pop() ?? String(path);
/** The directory part of a path, with its trailing '/' ('' for a top-level file). */
const dirname = (path) => {
  const parts = String(path).split('/').filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → {year, month (1-12), day}, or null when it is not that shape. */
function parseDay(s) {
  const key = typeof s === 'string' ? s.trim() : '';
  if (epochDay(key) === null) return null; // wrong shape or impossible date (Feb 31)
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day, key };
}

/** 'YYYY-MM-DD' → "Oct 4, 2026" (English month names, no locale lookup); else null. */
export function formatDay(s) {
  const d = parseDay(s);
  return d ? `${MONTHS[d.month - 1]} ${d.day}, ${d.year}` : null;
}

/**
 * A human date range from two 'YYYY-MM-DD' days, earliest first whatever the argument
 * order: "Oct 4, 2026" (same day), "Oct 4 – Oct 5, 2026" (same year),
 * "Dec 30, 2025 – Jan 2, 2026". One valid day and one missing/invalid → that day alone;
 * neither valid → the given strings as they are (shown once if equal); both missing → ''.
 */
export function formatDateRange(first, last) {
  let a = parseDay(first);
  let b = parseDay(last);
  if (a && b && epochDay(a.key) > epochDay(b.key)) [a, b] = [b, a];
  if (!a || !b) {
    const one = a ?? b;
    if (one) return formatDay(one.key);
    const raw = [first, last].map((x) => (typeof x === 'string' ? text(x) : null)).filter(Boolean);
    return [...new Set(raw)].join(' – ');
  }
  if (a.key === b.key) return formatDay(a.key);
  if (a.year === b.year) return `${MONTHS[a.month - 1]} ${a.day} – ${MONTHS[b.month - 1]} ${b.day}, ${b.year}`;
  return `${formatDay(a.key)} – ${formatDay(b.key)}`;
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
const formatAverage = (n) => (Math.round(num(n) * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

function hourQuip(hour) {
  if (hour === null || hour === undefined) return '';
  if (hour < 5) return 'The bugs come out at night, and so do you.';
  if (hour < 9) return 'Pushing code before the standup. Respect.';
  if (hour < 12) return 'Peak-morning productivity. Textbook.';
  if (hour < 14) return 'Lunch break? Never heard of it.';
  if (hour < 18) return 'The afternoon grind is real.';
  if (hour < 22) return 'After-hours hero.';
  return 'Late-night shipping, as is tradition.';
}

function intro(s, ctx) {
  const commits = num(s.totals?.commits);
  const parts = [];
  if (commits === 0) parts.push(EMPTY_LINE);
  else parts.push("Your commits, your chaos, your story. Let's see what you've been up to.");
  if (ctx.author) parts.push(`Starring ${ctx.author}.`);
  const range = formatDateRange(s.totals?.firstDay, s.totals?.lastDay);
  const story = ctx.year ? `Your ${ctx.year} in commits` : 'Your story so far';
  return {
    eyebrow: ctx.year ? `gitwrapped presents · ${ctx.year}` : 'gitwrapped presents',
    big: ctx.repoName,
    title: ctx.year ? `${ctx.year} Wrapped` : 'Wrapped',
    titleSize: ctx.year ? 96 : 136, // "2025 Wrapped" stays on one line at 96
    subtitle: parts.join(' '),
    chart: commits > 0
      ? { kind: 'callout', title: story, value: range || plural(commits, 'commit'), note: `${plural(commits, 'commit')} to unwrap` }
      : { kind: 'callout', title: story, value: 'Chapter one', note: 'starts with your first commit' },
  };
}

function totals(s) {
  const t = s.totals ?? {};
  const commits = num(t.commits);
  if (commits === 0) {
    return { eyebrow: 'The grand total', big: '0', title: 'commits', subtitle: EMPTY_LINE };
  }
  const days = num(t.activeDays);
  const perDay = days > 0 ? Math.round((commits / days) * 10) / 10 : 0;
  const rows = [
    { label: 'Active days', value: formatNumber(days) },
    { label: 'Files touched', value: formatNumber(t.filesTouched) },
  ];
  if (num(t.authors) > 1) rows.push({ label: 'Contributors', value: formatNumber(t.authors) });
  return {
    eyebrow: 'The grand total',
    big: formatNumber(commits),
    title: commits === 1 ? 'commit' : 'commits',
    subtitle: perDay > 0
      ? `That's ${perDay >= 100 ? formatNumber(perDay) : perDay} ${perDay === 1 ? 'commit' : 'commits'} per active day.`
      : 'Every one of them counts.',
    lines: rows,
    chart: {
      kind: 'split',
      title: 'Lines changed',
      segments: [
        { label: 'Lines added', value: signedLines(t.linesAdded, '+'), amount: Math.max(0, num(t.linesAdded)) },
        { label: 'Lines removed', value: signedLines(t.linesRemoved, '−'), amount: Math.max(0, num(t.linesRemoved)) },
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

const HOUR_TICKS = { 0: '12a', 6: '6a', 12: '12p', 18: '6p', 23: '11p' };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const WEEK_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The commits-by-hour and by-weekday bar charts for the power-hour card. */
function habitCharts(h) {
  const hours = counts(h.byHour, 24);
  const week = counts(h.byWeekday, 7);
  const days = WEEK_ORDER.map((d) => week[d]);
  const bar = (values, labelOf, titles) => {
    const hl = peaks(values);
    return { values, labels: values.map((_, i) => labelOf(i)), titles, highlight: hl, peakLabel: hl.length ? formatNumber(values[hl[0]]) : '' };
  };
  return [
    { kind: 'bars', title: 'Commits by hour', maxBarHeight: 240, ...bar(hours, (i) => HOUR_TICKS[i] ?? '', hours.map((v, i) => `${hourLabel(i)}: ${plural(v, 'commit')}`)) },
    { kind: 'bars', title: 'By weekday', maxBarHeight: 150, ...bar(days, (i) => WEEK_LETTERS[WEEK_ORDER[i]], days.map((v, i) => `${WEEKDAY_NAMES[WEEK_ORDER[i]]}: ${plural(v, 'commit')}`)) },
  ];
}

function peakHour(s) {
  const h = s.habits ?? {};
  const label = text(h.peakHourLabel);
  if (!label) {
    return { eyebrow: 'Your power hour', big: 'Zzz', title: 'No power hour yet', subtitle: "Commit something and we'll find your golden hour.", chart: habitCharts(h) };
  }
  const parts = [];
  if (h.peakHourTied) parts.push(`${label} is tied for your power hour, with ${plural(h.peakHourCount, 'commit')}. ${hourQuip(h.peakHour)}`);
  else parts.push(`${plural(h.peakHourCount, 'commit')} landed in the ${label} hour. ${hourQuip(h.peakHour)}`);
  const day = text(h.peakWeekdayName);
  if (day) parts.push(h.peakWeekdayTied ? `${day} is tied for your busiest day.` : `${day} is your busiest day.`);
  return {
    eyebrow: 'Your power hour',
    big: label,
    title: h.peakHourTied ? 'is one of your power hours' : 'is when you commit the most',
    subtitle: parts.join(' '),
    chart: habitCharts(h),
  };
}

/**
 * How to talk about the "current" streak. Normally it is the streak alive today; with
 * `ctx.streakAsOf` (a window that ended in the past) it is the streak alive on that day.
 */
function currentStreakCopy(cur, ctx) {
  const end = ctx.streakAsOf ? formatDay(ctx.streakAsOf) : null;
  if (!end) {
    return {
      label: 'Current',
      chartTitle: 'Longest vs. current',
      line: cur > 0 ? `You're on a ${formatNumber(cur)}-day streak right now. Keep it alive!` : 'No streak running right now — today is a great day to start one.',
    };
  }
  const year = ctx.year && ctx.streakAsOf === `${ctx.year}-12-31` ? ctx.year : null;
  return {
    label: year ? `End of ${year}` : 'At window end',
    chartTitle: year ? `Longest vs. end of ${year}` : 'Longest vs. at window end',
    line: cur > 0
      ? (year ? `You ended ${year} on a ${formatNumber(cur)}-day streak.` : `You were on a ${formatNumber(cur)}-day streak on ${end}.`)
      : `No streak running on ${end}.`,
  };
}

function streak(s, ctx = {}) {
  const longest = s.streaks?.longest ?? {};
  const current = s.streaks?.current ?? {};
  const len = num(longest.length);
  const cur = num(current.length);
  const copy = currentStreakCopy(cur, ctx);
  const chart = {
    kind: 'hbars',
    size: 'large',
    title: copy.chartTitle,
    items: [
      { label: 'Longest', value: plural(len, 'day'), amount: len },
      { label: copy.label, value: plural(cur, 'day'), amount: cur },
    ],
  };
  if (len === 0) {
    return { eyebrow: 'Your longest streak', big: '0', title: 'day streak', subtitle: 'No streak yet — one commit starts it.', chart };
  }
  const range = len > 1 && text(longest.start) && text(longest.end)
    ? formatDateRange(longest.start, longest.end)
    : (formatDay(longest.start) ?? text(longest.start));
  chart.items[0].title = range ? `Longest: ${plural(len, 'day')}, ${range}` : '';
  return {
    eyebrow: 'Your longest streak',
    big: formatNumber(len),
    title: len === 1 ? 'day streak' : 'days in a row',
    subtitle: [
      range ? `${len === 1 ? 'On' : 'From'} ${range}.` : '',
      copy.line,
    ].filter(Boolean).join(' '),
    chart,
  };
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

function activity(s) {
  const d = s.daily ?? {};
  let days = (Array.isArray(d.days) ? d.days : [])
    .filter((x) => parseDay(x?.day) && num(x?.commits) > 0)
    .map((x) => ({ day: parseDay(x.day).key, commits: num(x.commits) }));
  if (days.length === 0) {
    return { eyebrow: 'Your commit calendar', big: '0', title: 'active days', subtitle: EMPTY_LINE, chart: { kind: 'calendar', days: [] } };
  }
  const win = calendarWindow(days);
  let busiest = d.busiest && parseDay(d.busiest.day) && num(d.busiest.commits) > 0 ? d.busiest : null;
  let weeks = num(d.activeWeeks);
  let eyebrow;
  if (win.clipped) {
    // The grid shows the most recent 53 weeks only: the headline counts that window too.
    days = days.filter((x) => epochDay(x.day) >= win.start);
    ({ busiest, activeWeeks: weeks } = dailySummary(days));
    eyebrow = 'Your last 12 months';
  } else {
    const epochs = days.map((x) => epochDay(x.day));
    const span = Math.max(...epochs) - Math.min(...epochs) + 1;
    eyebrow = span >= 300 ? 'Your year in commits' : 'Your commit calendar';
  }
  const parts = [];
  if (busiest) parts.push(`Busiest day: ${formatDay(busiest.day)} with ${plural(busiest.commits, 'commit')}.`);
  if (weeks > 0) parts.push(weeks === 1 ? 'You showed up in 1 week.' : `You showed up in ${formatNumber(weeks)} different weeks.`);
  return {
    eyebrow,
    big: formatNumber(days.length),
    title: days.length === 1 ? 'active day' : 'active days',
    subtitle: parts.join(' '),
    chart: { kind: 'calendar', days },
  };
}

function hotFiles(s) {
  const files = (Array.isArray(s.hotFiles) ? s.hotFiles : []).filter((f) => text(f?.path));
  if (files.length === 0) {
    return { eyebrow: 'Your hot files', big: 'Nothing', title: 'No hot files yet', subtitle: 'Edit a file a few times and it will show up here.' };
  }
  const [top] = files;
  const tied = files.length > 1 && num(files[1].commits) === num(top.commits);
  return {
    eyebrow: 'Your hot files',
    big: basename(top.path),
    title: tied ? 'is one of your most-touched files' : "is the file you can't stop touching",
    subtitle: `${plural(top.commits, 'commit')}, ${signedLines(top.linesAdded, '+')} / ${signedLines(top.linesRemoved, '−')} lines.`,
    chart: {
      kind: 'hbars',
      title: 'Most-touched files',
      items: files.slice(0, 5).map((f) => ({
        label: basename(f.path),
        sub: dirname(f.path),
        value: plural(f.commits, 'commit'),
        amount: num(f.commits),
        truncate: 'middle',
        title: `${f.path}: ${plural(f.commits, 'commit')}, ${signedLines(f.linesAdded, '+')} / ${signedLines(f.linesRemoved, '−')} lines`,
      })),
    },
  };
}

function messages(s) {
  const m = s.messages ?? {};
  const longest = clip(text(m.longest?.subject));
  const shortest = clip(text(m.shortest?.subject));
  if (!longest || !shortest) {
    return { eyebrow: 'Message hall of fame', big: '…', title: 'No commit messages yet', subtitle: EMPTY_LINE };
  }
  // A "favorite" word needs to show up at least twice; otherwise use the average-length copy.
  const word = num(m.topWord?.count) >= 2 ? clip(text(m.topWord?.word)) : null;
  const counts = m.counts ?? {};
  const oops = num(counts.oops);
  const quip = oops > 0
    ? `“Oops” happened ${oops === 1 ? 'once' : `${formatNumber(oops)} times`}. We've all been there.`
    : `Your messages average ${formatAverage(m.averageLength)} characters.`;
  // With a single commit, longest and shortest are the same message: show it once.
  const rows = [{ label: `Longest: ${quote(longest)}` }];
  if (shortest !== longest) rows.push({ label: `Shortest: ${quote(shortest)}` });
  return {
    eyebrow: 'Message hall of fame',
    // Same rounding as the subtitle, so the two numbers always agree.
    big: word ? quote(word) : formatAverage(m.averageLength),
    title: word ? `was your favorite word (${plural(m.topWord.count, 'time')})` : 'characters per message, on average',
    subtitle: quip,
    lines: [
      ...rows,
      { label: '“fix” commits', value: formatNumber(counts.fix) },
      { label: '“wip” commits', value: formatNumber(counts.wip) },
      { label: '“oops” commits', value: formatNumber(oops) },
    ],
  };
}

function personality(s) {
  const a = s.personality?.archetype ?? {};
  const all = Array.isArray(s.personality?.scores) ? s.personality.scores : [];
  // Score bars only back up the headline when it is the top scorer; with too few commits
  // (or no standout habit) the headline is the steady-shipper fallback and bars like
  // "Weekend Warrior 100%" under it would contradict the card.
  const consistent = all[0]?.id === undefined || a.id === undefined || all[0].id === a.id;
  const scores = (consistent ? all : [])
    .filter((x) => text(x?.name) && num(x.score) > 0)
    .slice(0, 3);
  return {
    eyebrow: 'Your commit personality',
    big: text(a.name) ?? 'Steady Shipper',
    title: text(a.roast) ?? '',
    subtitle: text(a.reason) ?? '',
    chart: scores.length > 0
      ? {
        kind: 'hbars',
        size: 'large',
        title: 'Your habit scores',
        scaleMax: 1,
        items: scores.map((x) => {
          const share = Math.min(1, Math.max(0, num(x.score)));
          const pct = `${Math.round(share * 100)}%`;
          return { label: x.name, value: pct, amount: share, title: `${x.name}: ${pct}` };
        }),
      }
      : null,
  };
}

/** The four headline stats shared by the outro card and the share image. */
function summaryTiles(s) {
  const commits = num(s.totals?.commits);
  return [
    { label: 'Commits', value: formatNumber(commits) },
    { label: 'Power hour', value: text(s.habits?.peakHourLabel) ?? 'None yet' },
    { label: 'Best streak', value: plural(num(s.streaks?.longest?.length), 'day') },
    { label: 'Personality', value: commits > 0 ? (text(s.personality?.archetype?.name) ?? 'Steady Shipper') : 'TBD' },
  ];
}

function outro(s, ctx) {
  const commits = num(s.totals?.commits);
  const top = (Array.isArray(s.hotFiles) ? s.hotFiles : []).find((f) => text(f?.path));
  return {
    eyebrow: "That's a wrap",
    big: 'Thanks!',
    title: commits > 0 ? `${ctx.repoName}, in one card` : EMPTY_LINE,
    subtitle: 'Made with gitwrapped. Share your cards and tag a teammate.',
    chart: {
      kind: 'tiles',
      items: summaryTiles(s),
      wide: top ? { label: 'Hottest file', value: top.path, note: plural(top.commits, 'commit'), truncate: 'start' } : null,
    },
  };
}

const BUILDERS = { intro, totals, 'peak-hour': peakHour, streak, activity, 'hot-files': hotFiles, messages, personality, outro };
const CARD_THEMES = { intro: 'pulse', totals: 'ocean', 'peak-hour': 'cosmic', streak: 'ember', activity: 'cosmic', 'hot-files': 'mint', messages: 'neon', personality: 'sunset', outro: 'gold' };

/** A requested window as footer text, or null when none was requested. */
function windowText({ since, until, year }) {
  if (year) return String(year);
  const day = (d) => formatDay(d) ?? d;
  // formatDateRange's compact same-year form ("Jan 1 – Mar 31, 2025") keeps the footer
  // from being cut off; cross-year windows get both years.
  if (since && until) return parseDay(since) && parseDay(until) ? formatDateRange(since, until) : `${day(since)} – ${day(until)}`;
  if (since) return `since ${day(since)}`;
  if (until) return `through ${day(until)}`;
  return null;
}

/**
 * Footer text: "<repo> · <window>", where the window is the requested one ("2025" with
 * --year, "Jan 1 – Mar 31, 2025" with --since and --until, "since <date>",
 * "through <date>") or else the actual first–last commit range. The repo name is left
 * out when it is "gitwrapped", which the footer brand already says.
 */
export function footerText(stats, { repoName, since, until, year } = {}) {
  const t = stats?.totals ?? {};
  const range = windowText({ since, until, year }) ?? formatDateRange(t.firstDay, t.lastDay);
  const repo = String(repoName ?? '').toLowerCase() === 'gitwrapped' ? '' : String(repoName ?? '');
  return [repo, range].filter(Boolean).join(' · ');
}

/** Normalized card context from the buildCards() options. */
function cardContext({ repoName, since, until, year, author, streakAsOf }) {
  const y = Number.isInteger(year) || (typeof year === 'string' && /^\d{4}$/.test(year.trim())) ? String(year).trim() : null;
  return {
    repoName: text(repoName) ?? 'your repo',
    since: text(since),
    until: text(until),
    year: y,
    author: text(author),
    streakAsOf: parseDay(streakAsOf)?.key ?? null,
  };
}

/**
 * Build the full card set from computeStats() output.
 * Options: `repoName` (default "your repo"), `since`, `until`, `year` and `author` (as
 * passed to the CLI; shown in the copy when given), and `streakAsOf` ('YYYY-MM-DD': the
 * stats' "current" streak was measured on that past day, the end of the window). Returns `[{id, svg}]` in CARD_IDS order.
 */
export function buildCards(stats, opts = {}) {
  return buildCardSpecs(stats, opts).map(({ id, spec }) => ({ id, svg: renderCard(spec) }));
}

/**
 * The renderCard() input for every card (same arguments as buildCards), as
 * `[{id, spec}]`; buildCards() renders exactly these. Useful for layout checks.
 */
export function buildCardSpecs(stats, opts = {}) {
  stats = stats ?? {};
  const ctx = cardContext(opts);
  const footer = footerText(stats, ctx);
  return CARD_IDS.map((id, i) => ({
    id,
    spec: { theme: CARD_THEMES[id], footer, number: String(i + 1).padStart(2, '0'), idPrefix: `gw-${id}`, ...BUILDERS[id](stats, ctx) },
  }));
}

/**
 * The 1200x630 share summary card (landscape, for link previews and social posts):
 * repo name, four stat tiles (commits, longest streak, power hour, personality) and the
 * hottest file. Same options as buildCards(); copes with empty stats. Returns an SVG string.
 */
export function renderShareCard(stats, opts = {}) {
  stats = stats ?? {};
  const ctx = cardContext(opts);
  const commits = num(stats.totals?.commits);
  const top = (Array.isArray(stats.hotFiles) ? stats.hotFiles : []).find((f) => text(f?.path));
  const [c, hour, streakTile, persona] = summaryTiles(stats);
  return renderShareSvg({
    theme: 'pulse',
    idPrefix: 'gw-share',
    eyebrow: ctx.author
      ? `Git Wrapped${ctx.year ? ` ${ctx.year}` : ''} · ${ctx.author}`
      : (ctx.year ? `My ${ctx.year} Git Wrapped` : 'My Git Wrapped'),
    title: ctx.repoName,
    tiles: [c, streakTile, hour, persona],
    file: top ? { label: 'Hottest file', path: top.path, value: plural(top.commits, 'commit') } : null,
    note: commits > 0 ? 'No hot files yet.' : EMPTY_LINE,
    footer: footerText(stats, ctx),
  });
}
