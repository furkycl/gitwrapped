// Office hours: how many commits landed on a weekday (Monday-Friday) between 09:00 and
// 17:59, in each author's own local time. Counted over the same commits as the power hour
// (habits.js): every commit with a parseable author date, merges and future-dated ones
// included, so the office-hours commits are a subset of habits.byHour[9..17] and of
// habits.byWeekday[1..5]. Hour and weekday are needed together, so this is counted from
// the commits themselves (habits keeps the two apart).
import { localParts } from './time.js';
import { weekendCounts, weekendPercent } from './weekend.js';

/** Weekday indices of the office week (0 = Sunday, 6 = Saturday): Monday to Friday. */
export const OFFICE_DAYS = Object.freeze([1, 2, 3, 4, 5]);
/** The author-local hours that count as office hours (09:00-17:59). */
export const OFFICE_HOURS = Object.freeze([9, 10, 11, 12, 13, 14, 15, 16, 17]);

/**
 * stats.officeHours from the commits: `{commits, share}`.
 * - commits: how many commits have an author-local weekday of Monday-Friday and an hour of
 *   9-17 (09:00-17:59);
 * - share: of the commits with a parseable date (0..1, 3 decimals, at most 0.999 short of
 *   every commit; 0 without dated commits), as stats.weekend and stats.lateNights.
 * Invalid input policy: never throws; non-object entries and unparseable dates are skipped.
 */
export function computeOfficeHours(commits) {
  let dated = 0;
  let office = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const t = localParts(c.date);
    if (!t) continue;
    dated += 1;
    if (OFFICE_DAYS.includes(t.weekday) && OFFICE_HOURS.includes(t.hour)) office += 1;
  }
  if (dated === 0) return { commits: 0, share: 0 };
  const share = Math.min(Math.round((office / dated) * 1000) / 1000, office < dated ? 0.999 : 1);
  return { commits: office, share };
}

/**
 * The office-hours line as the power-hour or activity card, the recap and wrapped.md show
 * it, from stats (computeStats output): `{commits, percent}` when at least one commit
 * landed in office hours, else null (also for a missing or malformed stats.officeHours).
 * `percent` is a whole percent of the dated commits (the sum of habits.byHour, the base
 * the weekend and late-nights lines use; stats.officeHours.share when habits is missing),
 * never 100 short of every commit (see weekend.js weekendPercent).
 */
export function shownOfficeHours(stats) {
  const o = stats?.officeHours;
  if (!o || typeof o !== 'object') return null;
  const { commits, share } = o;
  if (!Number.isSafeInteger(commits) || commits <= 0) return null;
  if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) return null;
  // The dated commits as the weekend line counts them (the sum of habits.byHour).
  const { dated } = weekendCounts(stats?.habits);
  if (dated > 0) return commits <= dated ? { commits, percent: weekendPercent(commits / dated) } : null;
  return share > 0 ? { commits, percent: weekendPercent(share) } : null;
}
