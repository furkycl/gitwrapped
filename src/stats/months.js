import { computeDaily } from './daily.js';

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_KEY = /^(\d{4})-(\d{2})-\d{2}$/;

/** 'YYYY-MM' → a month index (year * 12 + month - 1), or null for anything else. */
function monthIndex(key) {
  const m = typeof key === 'string' ? MONTH_KEY.exec(key) : null;
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return +m[1] * 12 + (+m[2] - 1);
}

/** A month index → 'YYYY-MM'. */
const monthKey = (i) => `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;

/**
 * Commits per calendar month from per-day counts (`[{day: 'YYYY-MM-DD', commits}]`, e.g.
 * computeDaily().days; any order, invalid entries skipped). Returns `{months, peak}`:
 * - months: `[{month: 'YYYY-MM', commits}]`, ascending, contiguous and zero-filled from the
 *   first to the last month with commits (like the activity calendar, the range is the
 *   active span, not the requested --since / --until window); [] when there are none.
 * - peak: the month with the most commits as `{month, commits}` (ties → the earliest
 *   month); null when there are no commits.
 */
export function monthsFromDays(days) {
  const counts = new Map(); // month index → commits
  for (const d of Array.isArray(days) ? days : []) {
    const m = typeof d?.day === 'string' ? DAY_KEY.exec(d.day) : null;
    const n = typeof d?.commits === 'number' && Number.isFinite(d.commits) ? d.commits : 0;
    if (!m || n <= 0) continue;
    const i = monthIndex(`${m[1]}-${m[2]}`);
    if (i === null) continue;
    counts.set(i, (counts.get(i) ?? 0) + n);
  }
  if (counts.size === 0) return { months: [], peak: null };
  const keys = [...counts.keys()];
  const first = Math.min(...keys);
  const last = Math.max(...keys);
  const months = [];
  let peak = null;
  for (let i = first; i <= last; i++) {
    const entry = { month: monthKey(i), commits: counts.get(i) ?? 0 };
    months.push(entry);
    if (!peak || entry.commits > peak.commits) peak = entry; // strict: earliest wins ties
  }
  return { months, peak: { ...peak } };
}

/**
 * Commits per author-local calendar month (the same days as daily.js / streaks.js: the
 * month in the commit's own UTC offset, never the machine's timezone). See monthsFromDays
 * for the shape. Every commit counts, future-dated ones included (like stats.daily);
 * the cards leave days after today + 1 out (see shownMonths in src/cards/index.js).
 * Pure and deterministic; commits with an unparseable date are skipped.
 */
export function computeMonths(commits) {
  return monthsFromDays(computeDaily(commits).days);
}

export { monthIndex };
