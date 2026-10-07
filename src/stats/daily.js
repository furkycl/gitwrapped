import { longestBreakOf } from './streaks.js';
import { epochDay, localParts, mondayOf } from './time.js';

/**
 * `days` ([{day: 'YYYY-MM-DD', ...}], e.g. computeDaily().days) without future-dated days:
 * only days up to the day after `today` are kept (the same author-timezone grace day as
 * the current streak in streaks.js and the activity calendar), so a commit dated 2099
 * (clock skew, a bad GIT_AUTHOR_DATE) does not stretch a date range. If every day is in
 * the future they are all kept (there is nothing better to show), and without a valid
 * `today` the list is returned as is. Entries with an invalid `day` are dropped.
 */
export function daysUpTo(days, today) {
  const list = (Array.isArray(days) ? days : []).filter((x) => epochDay(x?.day) !== null);
  const t = epochDay(today ?? '');
  if (t === null) return list;
  const kept = list.filter((x) => epochDay(x.day) <= t + 1);
  return kept.length > 0 ? kept : list;
}

/**
 * The longest run of consecutive days in `days` ([{day}], any order; invalid days are
 * skipped) as `{length, start, end}` (dayKeys; ties → the earliest run), or length 0
 * with null start / end when there are none. Same rule as streaks.js's longest.
 */
export function longestRun(days) {
  const sorted = [...new Set((Array.isArray(days) ? days : []).map((x) => epochDay(x?.day)).filter((e) => e !== null))].sort((a, b) => a - b);
  let best = null;
  let start = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] !== 1) start = i;
    const len = i - start + 1;
    if (!best || len > best.len) best = { len, from: sorted[start], to: sorted[i] };
  }
  if (!best) return { length: 0, start: null, end: null };
  const key = (e) => days.find((x) => epochDay(x?.day) === e).day;
  return { length: best.len, start: key(best.from), end: key(best.to) };
}

/**
 * The longest streak to show next to the other future-clamped numbers (cards, recap,
 * Steady Shipper): stats.streaks.longest, except that when `today` is given and
 * stats.daily.days has future-dated days (see daysUpTo), it is recomputed over the kept
 * days only, so a run of commits dated 2099 is never "your longest streak". The raw
 * stats.streaks (and stats.json) are left as they are.
 */
export function shownLongest(stats, today) {
  const raw = stats?.streaks?.longest ?? { length: 0, start: null, end: null };
  const all = daysUpTo(stats?.daily?.days, null);
  const kept = daysUpTo(all, today);
  if (kept.length === 0 || kept.length === all.length) return raw;
  return longestRun(kept);
}

/**
 * The longest break in `days` ([{day}], any order; invalid days are skipped) as `{days,
 * from, to}` (idle days between two consecutive active days; ties → the earliest gap), or
 * `{days: 0, from: null, to: null}`. Same rule as streaks.js's longestBreak.
 */
export function longestGap(days) {
  const list = Array.isArray(days) ? days : [];
  const sorted = [...new Set(list.map((x) => epochDay(x?.day)).filter((e) => e !== null))].sort((a, b) => a - b);
  return longestBreakOf(sorted, (e) => list.find((x) => epochDay(x?.day) === e).day);
}

/**
 * The longest break to show on the streak card and in the recap: stats.streaks.longestBreak,
 * except that when `today` is given and stats.daily.days has future-dated days (see
 * daysUpTo), it is recomputed over the kept days only, as shownLongest does, so a commit
 * dated 2099 never makes a decades-long "break". stats.json keeps the raw value.
 */
export function shownLongestBreak(stats, today) {
  const raw = stats?.streaks?.longestBreak ?? { days: 0, from: null, to: null };
  const all = daysUpTo(stats?.daily?.days, null);
  const kept = daysUpTo(all, today);
  if (kept.length === 0 || kept.length === all.length) return raw;
  return longestGap(kept);
}

/**
 * The day with the most commits in `days` ([{day: 'YYYY-MM-DD', commits}], any order) as a
 * fresh `{day, commits}` (ties → the earliest day), or null when there is none. Entries
 * with an invalid day or a commit count that is not a positive integer are skipped.
 */
export function busiestOf(days) {
  let best = null;
  for (const x of Array.isArray(days) ? days : []) {
    const e = epochDay(x?.day);
    if (e === null || !Number.isInteger(x.commits) || x.commits <= 0) continue;
    if (!best || x.commits > best.commits || (x.commits === best.commits && e < best.e)) best = { e, day: x.day, commits: x.commits };
  }
  return best ? { day: best.day, commits: best.commits } : null;
}

/**
 * The busiest calendar day to show in the recap and wrapped.md: stats.busiestDay (falling
 * back to stats.daily.busiest), except that when `today` is given and stats.daily.days has
 * future-dated days (see daysUpTo), it is recomputed over the kept days only, as
 * shownLongest does, so a burst of commits dated 2099 is never "your busiest day".
 * Returns `{day, commits}` or null (no active days, or no valid busiest day). stats.json
 * keeps the raw value.
 */
export function shownBusiestDay(stats, today) {
  const all = daysUpTo(stats?.daily?.days, null);
  const kept = daysUpTo(all, today);
  if (kept.length > 0 && kept.length < all.length) return busiestOf(kept);
  const raw = stats?.busiestDay !== undefined ? stats.busiestDay : stats?.daily?.busiest;
  return busiestOf(raw ? [raw] : []);
}

/**
 * Commits per author-local calendar day (the same days as streaks.js / totals.js).
 * Returns `{days, busiest, activeWeeks}`:
 * - days: `[{day: 'YYYY-MM-DD', commits}]`, active days only, sorted ascending.
 * - busiest: the day with the most commits as `{day, commits}` (ties → the earliest day);
 *   null when there are no active days.
 * - activeWeeks: distinct Monday-first weeks with at least one commit.
 * Pure and deterministic; commits with an unparseable date are skipped.
 */
export function computeDaily(commits) {
  const counts = new Map(); // epoch day → {day, commits}
  for (const c of commits ?? []) {
    const t = localParts(c?.date);
    if (!t) continue;
    const e = epochDay(t.dayKey);
    if (e === null) continue;
    const entry = counts.get(e);
    if (entry) entry.commits += 1;
    else counts.set(e, { day: t.dayKey, commits: 1 });
  }
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  const days = sorted.map((e) => ({ ...counts.get(e) }));
  const weeks = new Set(sorted.map(mondayOf));
  return { days, busiest: busiestOf(days), activeWeeks: weeks.size };
}
