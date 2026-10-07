// Cadence: how many commits you make on a day you commit (commits per active day) and how
// far apart your active days usually are (the median gap between consecutive active days).
// Read from stats.daily.days (see daily.js), the same author-local days as
// totals.activeDays and the streak card, so the numbers always agree with them.
import { daysUpTo } from './daily.js';
import { epochDay } from './time.js';

/** At least this many active days before the cadence is shown (one gap needs two). */
export const CADENCE_MIN_DAYS = 2;

const EMPTY = Object.freeze({ perActiveDay: 0, medianGapDays: null });

/** A commit count as a positive finite number, else 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * `days` ([{day: 'YYYY-MM-DD', commits}], any order) as sorted distinct epoch days with
 * their commit totals: entries with an invalid day or no positive commit count are skipped,
 * and the same day listed twice is merged.
 */
function activeDays(days) {
  const byDay = new Map();
  for (const x of Array.isArray(days) ? days : []) {
    const e = epochDay(x?.day);
    const c = count(x?.commits);
    if (e === null || c === 0) continue;
    byDay.set(e, (byDay.get(e) ?? 0) + c);
  }
  const sorted = [...byDay.keys()].sort((a, b) => a - b);
  return { sorted, commits: sorted.reduce((s, e) => s + byDay.get(e), 0) };
}

/**
 * The median of the calendar-day differences between consecutive days of `sorted`
 * (ascending, distinct epoch days): consecutive days → 1, Mon → Thu → 3. An even number of
 * gaps takes the mean of the two middle ones (so it may end in .5). null with fewer than
 * two days.
 */
export function medianGap(sorted) {
  if (!Array.isArray(sorted) || sorted.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * stats.cadence from `days` (stats.daily.days, [{day, commits}]): `{perActiveDay,
 * medianGapDays}`.
 * - perActiveDay: commits per active day, rounded to 1 decimal. Active days are the
 *   distinct author-local days with a commit, exactly totals.activeDays; the commits are
 *   the ones on those days (every commit with a parseable date, merges and future-dated
 *   ones included, as for totals.activeDays and the streaks). 0 without active days.
 * - medianGapDays: the median calendar-day gap between consecutive active days (see
 *   medianGap; 1 for back-to-back days, may be x.5); null with fewer than two active days.
 * No active days → `{perActiveDay: 0, medianGapDays: null}`. Never throws.
 */
export function computeCadence(days) {
  const { sorted, commits } = activeDays(days);
  if (sorted.length === 0) return { ...EMPTY };
  return { perActiveDay: Math.round((commits / sorted.length) * 10) / 10, medianGapDays: medianGap(sorted) };
}

/**
 * The cadence as the streak card, the recap and wrapped.md show it, from stats
 * (computeStats output): computed from stats.daily.days like stats.cadence, except that
 * with `today` future-dated days (after today + 1, see daily.js daysUpTo) are left out, as
 * for the longest streak and break shown next to it (stats.json keeps the raw value).
 * `{perActiveDay, medianGapDays, activeDays}` with at least CADENCE_MIN_DAYS active days
 * (so there is a gap to tell), else null. Never throws.
 */
export function shownCadence(stats, today) {
  const kept = daysUpTo(stats?.daily?.days, today);
  const { sorted } = activeDays(kept);
  if (sorted.length < CADENCE_MIN_DAYS) return null;
  const { perActiveDay, medianGapDays } = computeCadence(kept);
  if (!(perActiveDay > 0) || !(medianGapDays > 0)) return null;
  return { perActiveDay, medianGapDays, activeDays: sorted.length };
}
