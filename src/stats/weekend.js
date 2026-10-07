// Weekend share: how many commits landed on a Saturday or Sunday, in each author's own
// local time. Derived from habits.byWeekday / byHour (see habits.js), the same counts the
// Weekend Warrior archetype scores (personality.js), so the two always agree.

/** Weekday indices of the weekend in habits.byWeekday (0 = Sunday, 6 = Saturday). */
export const WEEKEND_DAYS = Object.freeze([0, 6]);

const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const sumOf = (arr) => (Array.isArray(arr) ? arr.reduce((s, n) => s + count(n), 0) : 0);

/**
 * `{commits, dated}` from habits (computeTimeHabits output): `commits` is
 * byWeekday[0] + byWeekday[6], `dated` the commits with a parseable date (the sum of
 * byHour, as Weekend Warrior's share uses). Missing / malformed parts count as 0.
 */
export function weekendCounts(habits) {
  const byWeekday = Array.isArray(habits?.byWeekday) ? habits.byWeekday : [];
  const commits = WEEKEND_DAYS.reduce((s, i) => s + count(byWeekday[i]), 0);
  const dated = sumOf(habits?.byHour);
  return { commits, dated: Math.max(dated, commits) };
}

/**
 * A weekend share (0..1, of the dated commits) as a whole percent, the number Weekend
 * Warrior's reason and the weekend line both quote: Math.round(share × 100), but 99 when
 * the share is below 1 (never "100%" short of every commit). 0 for no / bad share.
 */
export function weekendPercent(share) {
  const v = typeof share === 'number' && Number.isFinite(share) && share > 0 ? Math.min(share, 1) : 0;
  const r = Math.round(v * 100);
  return r === 100 && v < 1 ? 99 : r;
}

/**
 * stats.weekend from habits: `{commits, share}`, `share` of the dated commits (0..1, 3
 * decimals, at most 0.999 short of every commit; 0 without commits). Like the power hour,
 * every commit with a parseable date counts, merge and future-dated commits included,
 * on the author's local weekday. Never throws.
 */
export function computeWeekend(habits) {
  const { commits, dated } = weekendCounts(habits);
  if (dated === 0) return { commits: 0, share: 0 };
  const share = Math.min(Math.round((commits / dated) * 1000) / 1000, commits < dated ? 0.999 : 1);
  return { commits, share };
}

/**
 * The weekend line as the activity card, the recap and wrapped.md show it, from stats
 * (computeStats output; read from `habits` so it matches Weekend Warrior exactly):
 * `{commits, percent}` (percent from weekendPercent) when at least one commit landed on a
 * weekend, else null.
 */
export function shownWeekend(stats) {
  const { commits, dated } = weekendCounts(stats?.habits);
  if (commits === 0 || dated === 0) return null;
  return { commits, percent: weekendPercent(commits / dated) };
}

/** "12%" / "%12" (via `pct`, the language's percent), "<1%" for a share that rounds to 0. */
export function weekendPercentLabel(percent, pct = (r) => `${r}%`) {
  return percent > 0 ? pct(percent) : `<${pct(1)}`;
}
