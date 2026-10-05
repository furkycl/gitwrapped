import { epochDay, localParts, mondayOf } from './time.js';

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
  let busiest = null;
  for (const d of days) if (!busiest || d.commits > busiest.commits) busiest = d; // strict: earliest wins ties
  const weeks = new Set(sorted.map(mondayOf));
  return { days, busiest: busiest ? { ...busiest } : null, activeWeeks: weeks.size };
}
