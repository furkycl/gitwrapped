import { hourLabel, localParts, WEEKDAY_NAMES } from './time.js';

/** Index of the largest count; ties → lowest index; all zero → null. */
function peakIndex(counts) {
  let best = null;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && (best === null || counts[i] > counts[best])) best = i;
  }
  return best;
}

/** True when more than one bucket shares the (non-zero) maximum count. */
function isTied(counts, peak) {
  if (peak === null) return false;
  return counts.filter((n) => n === counts[peak]).length > 1;
}

/**
 * When the author(s) commit, in each author's own local time (see time.js).
 * Returns:
 * - byHour: number[24], byWeekday: number[7] (0=Sunday)
 * - peakHour / peakWeekday: index with the most commits; ties go to the earliest
 *   hour / weekday; null when nothing was counted.
 * - peakHourCount / peakWeekdayCount: commits at the peak (0 when nothing was counted).
 * - peakHourTied / peakWeekdayTied: true when another hour / weekday has the same count,
 *   so the "peak" is only the earliest of several (cards should avoid strong claims).
 * - peakHourLabel: e.g. "11 PM", "12 AM" (midnight); peakWeekdayName: e.g. "Monday";
 *   both null when nothing was counted.
 * Commits with an unparseable date are skipped. Empty input → zeros/nulls/false.
 */
export function computeTimeHabits(commits) {
  commits = commits ?? [];
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  for (const c of commits) {
    const t = localParts(c.date);
    if (!t) continue;
    byHour[t.hour] += 1;
    byWeekday[t.weekday] += 1;
  }
  const peakHour = peakIndex(byHour);
  const peakWeekday = peakIndex(byWeekday);
  return {
    byHour,
    byWeekday,
    peakHour,
    peakHourCount: peakHour === null ? 0 : byHour[peakHour],
    peakHourTied: isTied(byHour, peakHour),
    peakHourLabel: hourLabel(peakHour),
    peakWeekday,
    peakWeekdayCount: peakWeekday === null ? 0 : byWeekday[peakWeekday],
    peakWeekdayTied: isTied(byWeekday, peakWeekday),
    peakWeekdayName: peakWeekday === null ? null : WEEKDAY_NAMES[peakWeekday],
  };
}
