// Period-over-period comparison for a --since run (without --year): the window's headline
// totals next to those of the equal-length window just before it (read with the same
// filters, see generate in src/cli.js). Like yoy.js, but for any window.
import { comparisonDeltas, compareTotals } from './yoy.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/** 'YYYY-MM-DD' → days since 1970-01-01 (UTC calendar math, no DST), or null when not a real date. */
function epochDayOf(ymd) {
  const m = DATE_ONLY.exec(typeof ymd === 'string' ? ymd : '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / MS_PER_DAY);
}

/** Days since 1970-01-01 → 'YYYY-MM-DD'. */
function ymdOf(epochDay) {
  const t = new Date(epochDay * MS_PER_DAY);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The window a --since run is compared with: for the inclusive window [since, until]
 * ('YYYY-MM-DD' calendar days) of N days, the N days just before it, [since − N, since − 1].
 * Returns `{since, until, previousSince, previousUntil, days: N}`, or null when either
 * bound is not a valid date, `until` is before `since`, or the previous window would
 * start before 1970-01-01.
 */
export function previousWindow(since, until) {
  const a = epochDayOf(since);
  const b = epochDayOf(until);
  if (a === null || b === null || b < a) return null;
  const days = b - a + 1;
  if (a - days < 0) return null;
  return { since, until, previousSince: ymdOf(a - days), previousUntil: ymdOf(a - 1), days };
}

/**
 * This window's `totals` (computeTotals output) compared with the previous window's commits:
 * `previous` is `{since, until, commits, truncated}` (`since` / `until` the current window,
 * `commits` read over previousWindow(since, until) with the same filters). Returns
 * `{since, until, previousSince, previousUntil, days, commits, lines, activeDays,
 * previousTruncated}`, each metric as `{current, previous, delta}` (as in yoy.js), or null
 * when there is nothing to compare: no valid window, or either window has no commits.
 */
export function computePreviousPeriod(totals, previous = {}) {
  const w = previousWindow(previous?.since, previous?.until);
  if (!w) return null;
  const cmp = compareTotals(totals, previous?.commits);
  if (!cmp) return null;
  return { ...w, ...cmp, previousTruncated: Boolean(previous?.truncated) };
}

/**
 * The period-over-period comparison of a --since run (stats.previousPeriod,
 * computePreviousPeriod) as `{days, commits, lines, activeDays}` (the deltas as finite
 * numbers), or null when it is absent or malformed: the cards and the recap then look as
 * without it.
 */
export function previousPeriod(stats) {
  const p = stats?.previousPeriod;
  if (!p || typeof p !== 'object' || !Number.isSafeInteger(p.days) || p.days < 1) return null;
  const deltas = comparisonDeltas(p);
  return deltas ? { days: p.days, ...deltas } : null;
}
