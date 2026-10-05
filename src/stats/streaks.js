import { epochDay, localParts } from './time.js';

const EMPTY = Object.freeze({ length: 0, start: null, end: null });

/** The machine's local calendar date as 'YYYY-MM-DD'. */
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Daily commit streaks over author-local calendar days (see time.js).
 * Returns `{longest: {length, start, end}, current: {length, start, end}}` where start /
 * end are dayKeys ('YYYY-MM-DD') and a run is a sequence of consecutive active days
 * (days with at least one commit).
 * - longest: the longest run; ties go to the earliest run.
 * - current: the run ending on the last active day, but only while it is still alive,
 *   i.e. that last day is `today`, the day before, or the day after `today`; otherwise
 *   length 0. The day after counts because days are author-local: an author in a timezone
 *   ahead of the machine can already be on tomorrow. Two or more days ahead (clock skew,
 *   future-dated commits) is not alive.
 *   For a past window (--until / --year) the CLI passes the window end as `today` with
 *   `todayComplete: true`: that day is over, so there is no grace day and the run is
 *   current only when it reaches the window end (current = the streak running when the
 *   window closed).
 * - No active days → both `{length: 0, start: null, end: null}`.
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
  if (days.size === 0) return { longest: { ...EMPTY }, current: { ...EMPTY } };

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

  const last = sorted[sorted.length - 1];
  const alive = last >= (todayComplete ? todayDay : todayDay - 1) && last <= todayDay + 1;
  const current = alive ? runs[runs.length - 1] : EMPTY;
  return { longest: { ...longest }, current: { ...current } };
}
