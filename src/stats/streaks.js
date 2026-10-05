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
 * - current: the run that reaches the latest active day among the day after `today`,
 *   `today` and the day before (the anchor), counted up to that anchor; length 0 when none
 *   of them is active. The day after counts because days are author-local: an author in a
 *   timezone ahead of the machine can already be on tomorrow. Days two or more ahead
 *   (clock skew, future-dated commits) never count: a commit dated 2099 does not hide or
 *   stretch the streak running today.
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

  // The current streak is anchored at the latest active day among tomorrow, today and
  // yesterday (only today and tomorrow when today is complete), and runs back from it.
  // Anything after the anchor is ignored, so a future-dated commit (2099) neither keeps a
  // streak alive nor stretches it.
  const anchors = todayComplete ? [todayDay + 1, todayDay] : [todayDay + 1, todayDay, todayDay - 1];
  const anchor = anchors.find((e) => days.has(e));
  let current = EMPTY;
  if (anchor !== undefined) {
    const run = runs.find((r) => epochDay(r.start) <= anchor && anchor <= epochDay(r.end));
    current = { length: anchor - epochDay(run.start) + 1, start: run.start, end: days.get(anchor) };
  }
  return { longest: { ...longest }, current: { ...current } };
}
