// Year-over-year comparison for a --year run: this year's headline totals next to the
// previous calendar year's (read with the same filters, see generate in src/cli.js).
import { computeTotals } from './totals.js';

/** A finite non-negative count, else 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** Lines changed: added plus removed, counted like totals (bad counts add 0). */
const linesChanged = (t) => count(t?.linesAdded) + count(t?.linesRemoved);

const pair = (current, previous) => ({ current, previous, delta: current - previous });

/**
 * This year's `totals` (computeTotals output) compared with the previous year's commits
 * (`previous.commits`, the same filters one calendar year earlier): `{year, previousYear,
 * commits, lines, activeDays, previousTruncated}`, each metric as `{current, previous,
 * delta}` (delta = current − previous; `lines` is lines changed, added + removed, as in
 * totals). `year` is the --year as a number and `previousYear` = year − 1;
 * `previousTruncated` is true when the previous year's read hit --max-commits (its
 * numbers then cover only its most recent commits).
 * Returns null when there is nothing to compare: no valid `year`, or either year has no
 * commits (a first year, or a year with no commits, gets no comparison at all).
 */
export function computeYearOverYear(totals, previous = {}) {
  const year = Number(previous?.year);
  if (!Number.isInteger(year)) return null;
  const now = totals ?? {};
  const before = computeTotals(previous?.commits ?? []);
  if (count(now.commits) === 0 || before.commits === 0) return null;
  return {
    year,
    previousYear: year - 1,
    commits: pair(count(now.commits), before.commits),
    lines: pair(linesChanged(now), linesChanged(before)),
    activeDays: pair(count(now.activeDays), before.activeDays),
    previousTruncated: Boolean(previous?.truncated),
  };
}

/**
 * The year-over-year comparison of a --year run (stats.yearOverYear, computeYearOverYear)
 * as `{previousYear, commits, lines, activeDays}` (the deltas as finite numbers), or null
 * when it is absent or malformed: the cards and the recap then look as without --year.
 */
export function yearOverYear(stats) {
  const y = stats?.yearOverYear;
  if (!y || typeof y !== 'object' || !Number.isInteger(y.previousYear)) return null;
  const d = (k) => (typeof y[k]?.delta === 'number' && Number.isFinite(y[k].delta) ? y[k].delta : null);
  const [commits, lines, activeDays] = [d('commits'), d('lines'), d('activeDays')];
  if (commits === null || lines === null || activeDays === null) return null;
  return { previousYear: y.previousYear, commits, lines, activeDays };
}
