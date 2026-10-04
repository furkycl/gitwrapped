// Stats engine: pure functions over the commit objects produced by readCommits()
// in src/git.js. Input order does not matter.
//
// Design decision: every day / hour / weekday is computed in the AUTHOR'S LOCAL TIME,
// i.e. the wall-clock fields written in the ISO 8601 author date ("2024-03-10T02:15:00-08:00"
// falls in hour 2 of 2024-03-10, a Sunday), never converted to the machine's timezone.
// "Z" means UTC. Results are therefore deterministic on any machine, and "you commit at
// 2am" means 2am where the author was. Commits whose date cannot be parsed still count
// toward commit, line and file totals but are skipped for day/hour/weekday stats.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))$/;

/**
 * Wall-clock parts of an ISO 8601 date string, in the string's own offset:
 * `{day: 'YYYY-MM-DD', hour: 0-23, weekday: 0-6 (0 = Sunday)}`, or null if unparseable.
 */
export function localParts(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO.exec(iso);
  if (!m) return null;
  const [y, mo, d, h, mi, s = '0'] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return null;
  // Real-world UTC offsets are within ±14:00.
  if (m[7] !== undefined && (Number(m[7]) > 14 || Number(m[8]) > 59)) return null;
  // setUTCFullYear (not Date.UTC) so years 0-99 are not mapped to 1900-1999.
  const utc = new Date(0);
  utc.setUTCFullYear(y, mo - 1, d);
  // Reject impossible days such as 2023-02-30 (the setter would roll them over).
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return { day: `${m[1]}-${m[2]}-${m[3]}`, hour: h, weekday: utc.getUTCDay() };
}

function assertArray(commits) {
  if (!Array.isArray(commits)) throw new TypeError('commits must be an array');
}

const num = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Sorted distinct local days ('YYYY-MM-DD') with at least one dated commit. */
export function activeDayList(commits) {
  assertArray(commits);
  const days = new Set();
  for (const c of commits) {
    const parts = localParts(c?.date);
    if (parts) days.add(parts.day);
  }
  return [...days].sort();
}

/**
 * Totals: `{commits, activeDays, linesAdded, linesRemoved, filesTouched, firstDay, lastDay}`.
 * activeDays counts distinct local days; filesTouched counts distinct paths across all
 * commits (a rename counts as two paths, since readCommits uses --no-renames);
 * firstDay/lastDay are local 'YYYY-MM-DD' (null when no commit has a valid date).
 * `commits` is the array length: every entry counts, even a malformed one.
 * Missing, non-finite or negative line counts count as 0.
 */
export function computeTotals(commits) {
  assertArray(commits);
  const paths = new Set();
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const c of commits) {
    linesAdded += num(c?.linesAdded);
    linesRemoved += num(c?.linesRemoved);
    for (const f of Array.isArray(c?.files) ? c.files : []) {
      if (typeof f?.path === 'string') paths.add(f.path);
    }
  }
  const sorted = activeDayList(commits);
  return {
    commits: commits.length,
    activeDays: sorted.length,
    linesAdded,
    linesRemoved,
    filesTouched: paths.size,
    firstDay: sorted[0] ?? null,
    lastDay: sorted.at(-1) ?? null,
  };
}

/** Index of the largest count (ties → lowest index), or null if all counts are 0. */
function peakIndex(counts) {
  let best = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && (best === -1 || counts[i] > counts[best])) best = i;
  }
  return best === -1 ? null : best;
}

/**
 * Time habits in the author's local time:
 * `{byHour: number[24], byWeekday: number[7] (0 = Sunday), peakHour, peakWeekday,
 * peakHourCount, peakWeekdayCount}`. Peaks are null (counts 0) with no dated commits;
 * ties go to the earliest hour / lowest weekday index.
 */
export function computeTimeHabits(commits) {
  assertArray(commits);
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  for (const c of commits) {
    const parts = localParts(c?.date);
    if (!parts) continue;
    byHour[parts.hour]++;
    byWeekday[parts.weekday]++;
  }
  const peakHour = peakIndex(byHour);
  const peakWeekday = peakIndex(byWeekday);
  return {
    byHour,
    byWeekday,
    peakHour,
    peakWeekday,
    peakHourCount: peakHour === null ? 0 : byHour[peakHour],
    peakWeekdayCount: peakWeekday === null ? 0 : byWeekday[peakWeekday],
  };
}

/** Aggregate entry point; later stats (streaks, files, messages, ...) extend this object. */
export function computeStats(commits) {
  assertArray(commits);
  return { totals: computeTotals(commits), time: computeTimeHabits(commits) };
}
