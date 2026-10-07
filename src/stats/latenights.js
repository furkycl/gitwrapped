// Late nights: how many commits landed between 00:00 and 04:59 in each author's own local
// time, and the latest-ever commit time of day, where the night wraps: a day is taken to
// end at 05:00, so 04:59 is the latest a commit can be and 00:30 is later than 23:59.
// Counted over the same commits as the power hour (habits.js): every commit with a
// parseable author date, merges and future-dated ones included. The Night Owl archetype
// (personality.js) scores hours 22-03 of the same habits.byHour, so the two never disagree:
// late nights are hours 0-4, which overlap Night Owl's 0-3 and add 4 AM.
import { epochDay, localParts } from './time.js';
import { weekendPercent } from './weekend.js';

/** The author-local hours that count as late night (00:00-04:59). */
export const LATE_NIGHT_HOURS = Object.freeze([0, 1, 2, 3, 4]);
/** The hour a "day" starts at for the latest-ever time: 05:00 (so 04:59 is the latest). */
export const NIGHT_ENDS = 5;

const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const pad2 = (n) => String(n).padStart(2, '0');
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `{commits, dated}` from habits (computeTimeHabits output): `commits` is byHour[0..4],
 * `dated` the commits with a parseable date (the sum of byHour, as Night Owl's share
 * uses). Missing / malformed parts count as 0.
 */
export function lateNightCounts(habits) {
  const byHour = Array.isArray(habits?.byHour) ? habits.byHour : [];
  const commits = LATE_NIGHT_HOURS.reduce((s, i) => s + count(byHour[i]), 0);
  const dated = byHour.reduce((s, n) => s + count(n), 0);
  return { commits, dated: Math.max(dated, commits) };
}

/** Minutes into the "night-wrapped" day that starts at 05:00: 05:00 → 0, 04:59 → 1439. */
const lateness = (hour, minute) => ((hour - NIGHT_ENDS + 24) % 24) * 60 + minute;

/**
 * stats.lateNights from the commits: `{commits, share, latest}`.
 * - commits: how many commits have an author-local hour of 0-4 (00:00-04:59);
 * - share: of the commits with a parseable date (0..1, 3 decimals, at most 0.999 short of
 *   every commit; 0 without commits), as stats.weekend;
 * - latest: the latest-ever commit time of day as `{date: 'YYYY-MM-DD', time: 'HH:MM'}`,
 *   both author-local (the commit's own calendar day and wall-clock minute), where the day
 *   ends at 05:00 (04:59 is the latest possible, 00:30 is later than 23:59); commits in
 *   the same minute tie and the earliest one (by instant) wins; null without a dated commit.
 *   With `today` ('YYYY-MM-DD'), commits dated after the day after today (clock skew, a bad
 *   GIT_AUTHOR_DATE) are not considered for it, unless every commit is (as daily.js
 *   daysUpTo), so "latest" is never a day in 2099; they still count in `commits` / `share`.
 * Invalid input policy: never throws; non-object entries and unparseable dates are skipped.
 */
export function computeLateNights(commits, { today } = {}) {
  let dated = 0;
  let late = 0;
  const limit = epochDay(today ?? '');
  let best = null; // the latest non-future commit: {key, ms, t}
  let bestAny = null; // the latest of all of them
  const later = (b, key, ms) => !b || key > b.key || (key === b.key && ms < b.ms);
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const t = localParts(c.date);
    if (!t) continue;
    dated += 1;
    if (t.hour < NIGHT_ENDS) late += 1;
    const key = lateness(t.hour, t.minute);
    if (later(bestAny, key, t.ms)) bestAny = { key, ms: t.ms, t };
    if ((limit === null || epochDay(t.dayKey) <= limit + 1) && later(best, key, t.ms)) best = { key, ms: t.ms, t };
  }
  best = best ?? bestAny;
  const share = dated === 0 ? 0 : Math.min(Math.round((late / dated) * 1000) / 1000, late < dated ? 0.999 : 1);
  return {
    commits: late,
    share,
    latest: best ? { date: best.t.dayKey, time: `${pad2(best.t.hour)}:${pad2(best.t.minute)}` } : null,
  };
}

/** A valid `{date: 'YYYY-MM-DD' (a real day), time: 'HH:MM'}` with the time in 00:00-04:59, else null. */
function lateTime(latest) {
  if (!latest || typeof latest !== 'object') return null;
  const { date, time } = latest;
  if (epochDay(date) === null || typeof time !== 'string') return null;
  const m = TIME.exec(time);
  if (!m || +m[1] >= NIGHT_ENDS) return null;
  return { date, time, hour: +m[1], minute: +m[2] };
}

/**
 * The late-nights line as the power-hour card, the recap and wrapped.md show it, from
 * stats (computeStats output): `{commits, percent, latest}` when at least one commit
 * landed between 00:00 and 04:59, else null. `commits` and `percent` (a whole percent,
 * never 100 short of every commit, see weekend.js weekendPercent) are read from
 * habits.byHour, the counts Night Owl scores; `latest` is stats.lateNights.latest with
 * its hour and minute (`{date, time, hour, minute}`), or null when it is missing or not a
 * late-night time.
 */
export function shownLateNights(stats) {
  const { commits, dated } = lateNightCounts(stats?.habits);
  if (commits === 0 || dated === 0) return null;
  return { commits, percent: weekendPercent(commits / dated), latest: lateTime(stats?.lateNights?.latest) };
}
