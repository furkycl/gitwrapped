// The story-card set: turns computeStats() output into Wrapped-style SVG cards.
// Pure and deterministic. Every card copes with empty stats (0 commits, null peaks,
// no hot files, null messages) and never prints "null", "undefined" or "NaN".
import { renderCard } from './svg.js';
import { renderShareSvg } from './share.js';

export { renderCard, wrapText, escapeXml, measureText, truncateStart, THEMES, CARD_WIDTH, CARD_HEIGHT } from './svg.js';
export { renderShareSvg, SHARE_WIDTH, SHARE_HEIGHT } from './share.js';

/** Card ids in display order. */
export const CARD_IDS = Object.freeze(['intro', 'totals', 'peak-hour', 'streak', 'hot-files', 'messages', 'personality', 'outro']);

const EMPTY_LINE = 'No commits yet — go ship something!';

/** A finite number, else 0. */
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Integer with en-US thousands separators, e.g. 12345 → "12,345". Negatives use U+2212.
 * Huge values (≥ 1e21) are written out in full, never in scientific notation.
 * Non-numbers and non-finite values → "0".
 */
export function formatNumber(n) {
  const v = Math.round(num(n));
  // BigInt prints every digit of an integral double, where String() would switch to 1e+21.
  const digits = BigInt(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? `−${digits}` : digits;
}

/** A line count with a leading sign ("+12" / "−3"); 0 → "0". Negatives clamp to 0. */
const signedLines = (n, sign) => {
  const v = Math.max(0, Math.round(num(n)));
  return v === 0 ? '0' : `${sign}${formatNumber(v)}`;
};

/** "1 commit", "2,048 commits". */
const plural = (n, word, many = `${word}s`) => `${formatNumber(n)} ${num(n) === 1 ? word : many}`;

const basename = (path) => String(path).split('/').filter(Boolean).pop() ?? String(path);
const quote = (s) => `“${s}”`;
const text = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);

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
  return {
    eyebrow: 'gitwrapped presents',
    big: ctx.repoName,
    title: 'Wrapped',
    subtitle: parts.join(' '),
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
    { label: 'Lines added', value: signedLines(t.linesAdded, '+') },
    { label: 'Lines removed', value: signedLines(t.linesRemoved, '−') },
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
  };
}

function peakHour(s) {
  const h = s.habits ?? {};
  const label = text(h.peakHourLabel);
  if (!label) {
    return { eyebrow: 'Your power hour', big: 'Zzz', title: 'No power hour yet', subtitle: "Commit something and we'll find your golden hour." };
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
  };
}

function streak(s) {
  const longest = s.streaks?.longest ?? {};
  const current = s.streaks?.current ?? {};
  const len = num(longest.length);
  if (len === 0) {
    return { eyebrow: 'Your longest streak', big: '0', title: 'day streak', subtitle: 'No streak yet — one commit starts it.' };
  }
  const range = len > 1 && text(longest.start) && text(longest.end) ? `${longest.start} → ${longest.end}` : text(longest.start);
  const cur = num(current.length);
  return {
    eyebrow: 'Your longest streak',
    big: formatNumber(len),
    title: len === 1 ? 'day streak' : 'days in a row',
    subtitle: [
      range ? `${len === 1 ? 'On' : 'From'} ${range}.` : '',
      cur > 0 ? `You're on a ${formatNumber(cur)}-day streak right now. Keep it alive!` : 'No streak running right now — today is a great day to start one.',
    ].filter(Boolean).join(' '),
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
    lines: files.slice(0, 5).map((f) => ({ label: f.path, value: plural(f.commits, 'commit'), truncate: 'start' })),
  };
}

function messages(s) {
  const m = s.messages ?? {};
  const longest = text(m.longest?.subject);
  const shortest = text(m.shortest?.subject);
  if (!longest || !shortest) {
    return { eyebrow: 'Message hall of fame', big: '…', title: 'No commit messages yet', subtitle: EMPTY_LINE };
  }
  // A "favorite" word needs to show up at least twice; otherwise use the average-length copy.
  const word = num(m.topWord?.count) >= 2 ? text(m.topWord?.word) : null;
  const counts = m.counts ?? {};
  const oops = num(counts.oops);
  const quip = oops > 0
    ? `“Oops” happened ${oops === 1 ? 'once' : `${formatNumber(oops)} times`}. We've all been there.`
    : `Your messages average ${num(m.averageLength)} characters.`;
  // With a single commit, longest and shortest are the same message: show it once.
  const rows = [{ label: `Longest: ${quote(longest)}` }];
  if (shortest !== longest) rows.push({ label: `Shortest: ${quote(shortest)}` });
  return {
    eyebrow: 'Message hall of fame',
    big: word ? quote(word) : formatNumber(m.averageLength),
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
    lines: scores.map((x) => ({ label: x.name, value: `${Math.round(num(x.score) * 100)}%` })),
  };
}

function outro(s, ctx) {
  const commits = num(s.totals?.commits);
  const rows = [{ label: 'Commits', value: formatNumber(commits) }];
  const label = text(s.habits?.peakHourLabel);
  if (label) rows.push({ label: 'Power hour', value: label });
  const len = num(s.streaks?.longest?.length);
  if (len > 0) rows.push({ label: 'Best streak', value: plural(len, 'day') });
  const top = Array.isArray(s.hotFiles) ? text(s.hotFiles[0]?.path) : null;
  if (top) rows.push({ label: 'Hottest file', value: basename(top) });
  const name = text(s.personality?.archetype?.name);
  if (commits > 0 && name) rows.push({ label: 'Personality', value: name });
  return {
    eyebrow: "That's a wrap",
    big: 'Thanks!',
    title: commits > 0 ? `${ctx.repoName}, in one card` : EMPTY_LINE,
    subtitle: 'Made with gitwrapped. Share your cards and tag a teammate.',
    lines: commits > 0 ? rows : [],
  };
}

const BUILDERS = { intro, totals, 'peak-hour': peakHour, streak, 'hot-files': hotFiles, messages, personality, outro };
const CARD_THEMES = { intro: 'pulse', totals: 'ocean', 'peak-hour': 'cosmic', streak: 'ember', 'hot-files': 'mint', messages: 'neon', personality: 'sunset', outro: 'gold' };

function footerText(stats, { repoName, since }) {
  const t = stats.totals ?? {};
  if (since) return `${repoName} · since ${since}`;
  if (text(t.firstDay) && text(t.lastDay)) return t.firstDay === t.lastDay ? `${repoName} · ${t.firstDay}` : `${repoName} · ${t.firstDay} → ${t.lastDay}`;
  return repoName;
}

/**
 * Build the full card set from computeStats() output.
 * Options: `repoName` (default "your repo"), `since` and `author` (as passed to the
 * CLI; shown in the copy when given). Returns `[{id, svg}]` in CARD_IDS order.
 */
export function buildCards(stats, { repoName, since, author } = {}) {
  stats = stats ?? {};
  const ctx = { repoName: text(repoName) ?? 'your repo', since: text(since), author: text(author) };
  const footer = footerText(stats, ctx);
  return CARD_IDS.map((id) => ({
    id,
    svg: renderCard({ theme: CARD_THEMES[id], footer, idPrefix: `gw-${id}`, ...BUILDERS[id](stats, ctx) }),
  }));
}

/**
 * The 1200x630 share summary card (landscape, for link previews and social posts):
 * repo name, four stat tiles (commits, longest streak, power hour, personality) and the
 * hottest file. Same options as buildCards(); copes with empty stats. Returns an SVG string.
 */
export function renderShareCard(stats, { repoName, since, author } = {}) {
  stats = stats ?? {};
  const ctx = { repoName: text(repoName) ?? 'your repo', since: text(since), author: text(author) };
  const commits = num(stats.totals?.commits);
  const len = num(stats.streaks?.longest?.length);
  const top = (Array.isArray(stats.hotFiles) ? stats.hotFiles : []).find((f) => text(f?.path));
  return renderShareSvg({
    theme: 'pulse',
    idPrefix: 'gw-share',
    eyebrow: ctx.author ? `Git Wrapped · ${ctx.author}` : 'My Git Wrapped',
    title: ctx.repoName,
    tiles: [
      { label: 'Commits', value: formatNumber(commits) },
      { label: 'Best streak', value: plural(len, 'day') },
      { label: 'Power hour', value: text(stats.habits?.peakHourLabel) ?? 'None yet' },
      { label: 'Personality', value: commits > 0 ? (text(stats.personality?.archetype?.name) ?? 'Steady Shipper') : 'TBD' },
    ],
    file: top ? { label: 'Hottest file', path: top.path, value: plural(top.commits, 'commit') } : null,
    note: commits > 0 ? 'No hot files yet.' : EMPTY_LINE,
    footer: footerText(stats, ctx),
  });
}
