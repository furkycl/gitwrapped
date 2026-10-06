import { epochDay, localParts } from './time.js';

const EMPTY = Object.freeze({ length: 0, start: null, end: null });
const NO_BREAK = Object.freeze({ days: 0, from: null, to: null });

/**
 * The longest break in `sorted` (ascending, distinct epoch days): `{days, from, to}` where
 * `from` is the last active day before the gap, `to` the next active day after it (dayKeys
 * via `keyOf`), and `days` the number of idle days strictly between them (to − from − 1).
 * Ties → the earliest gap. Fewer than two days, or only consecutive days → `{days: 0,
 * from: null, to: null}`.
 */
export function longestBreakOf(sorted, keyOf) {
  let best = null;
  for (let i = 1; i < sorted.length; i++) {
    const idle = sorted[i] - sorted[i - 1] - 1;
    if (idle > 0 && (!best || idle > best.days)) best = { days: idle, from: sorted[i - 1], to: sorted[i] };
  }
  return best ? { days: best.days, from: keyOf(best.from), to: keyOf(best.to) } : { ...NO_BREAK };
}

/** The machine's local calendar date as 'YYYY-MM-DD'. */
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Daily commit streaks over author-local calendar days (see time.js).
 * Returns `{longest: {length, start, end}, current: {length, start, end}, longestBreak:
 * {days, from, to}}` where start /
 * end are dayKeys ('YYYY-MM-DD') and a run is a sequence of consecutive active days
 * (days with at least one commit).
 * - longest: the longest run; ties go to the earliest run.
 * - current: the run ending on the last active day up to the day after `today`, but only
 *   while it is still alive, i.e. that day is `today`, the day before, or the day after
 *   `today`; otherwise length 0. The day after counts because days are author-local: an
 *   author in a timezone ahead of the machine can already be on tomorrow. Days two or
 *   more days ahead (clock skew, future-dated commits) are ignored for the current
 *   streak, so one bad future date cannot reset a running streak.
 *   For a past window (--until / --year) the CLI passes the window end as `today` with
 *   `todayComplete: true`: that day is over, so there is no grace day and the run is
 *   current only when it reaches the window end (current = the streak running when the
 *   window closed).
 * - longestBreak: the longest gap between two consecutive active days, as `{days, from,
 *   to}`: `from` is the last active day before the gap, `to` the next active day after
 *   it, and `days` the idle days in between (to − from − 1, so Mar 3 → Mar 6 is 2 days).
 *   Ties go to the earliest gap. Fewer than two active days, or no gap at all →
 *   `{days: 0, from: null, to: null}`. Like longest it covers every active day, future-dated
 *   ones included (the cards and recap leave those out, see daily.js shownLongestBreak).
 * - No active days → longest / current `{length: 0, start: null, end: null}`.
 *
 * `today` ('YYYY-MM-DD') defaults to the machine's local calendar date. That default is
 * the only non-deterministic input to the stats engine, so tests should always pass it.
 * Invalid input policy: an invalid `today` (wrong type/shape, impossible date) throws a
 * TypeError; commits with an unparseable date are skipped.
 */
export function computeStreaks(commits, { today, todayComplete = false } = {}) {
  commits = commits ?? [];
  if (today === undefined) today = localToday();
  const todayDay = epochDay(today);
  if (todayDay === null) {
    throw new TypeError(`today must be a valid 'YYYY-MM-DD' date, got: ${JSON.stringify(today)}`);
  }

  const days = new Map(); // epoch day → dayKey
  for (const c of commits) {
    const t = localParts(c.date);
    if (!t) continue;
    days.set(epochDay(t.dayKey), t.dayKey);
  }
  if (days.size === 0) return { longest: { ...EMPTY }, current: { ...EMPTY }, longestBreak: { ...NO_BREAK } };

  // Split the sorted epoch days into runs of consecutive days.
  const sorted = [...days.keys()].sort((a, b) => a - b);
  const runs = [];
  let start = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] - sorted[i - 1] === 1) continue;
    const end = sorted[i - 1];
    runs.push({ length: end - start + 1, start: days.get(start), end: days.get(end) });
    start = sorted[i];
  }

  // Strictly greater: ties keep the earlier run.
  let longest = runs[0];
  for (const run of runs) if (run.length > longest.length) longest = run;

  // Future-dated days (clock skew, a bad GIT_AUTHOR_DATE) cannot end the current streak:
  // the current run is anchored on the last active day no later than the newest day that
  // can really be "now" (today, plus the author-timezone grace day unless today is over),
  // and days after that are ignored for it. The run is cut at that anchor, so future days
  // never lengthen it either. They still count everywhere else (longest, totals, ...).
  const maxDay = todayComplete ? todayDay : todayDay + 1;
  let i = sorted.length - 1;
  while (i >= 0 && sorted[i] > maxDay) i--;
  let current = EMPTY;
  if (i >= 0 && sorted[i] >= (todayComplete ? todayDay : todayDay - 1)) {
    let j = i;
    while (j > 0 && sorted[j] - sorted[j - 1] === 1) j--;
    current = { length: sorted[i] - sorted[j] + 1, start: days.get(sorted[j]), end: days.get(sorted[i]) };
  }
  const longestBreak = longestBreakOf(sorted, (e) => days.get(e));
  return { longest: { ...longest }, current: { ...current }, longestBreak };
}
