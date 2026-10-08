// The UTC offsets the commits were made from: each commit's author date carries the
// author's own offset (git's %aI, see time.js), so a run says how many time zones the
// work came from and which one most of it did.
import { EXACT_PERCENT } from './contributors.js';
import { localParts } from './time.js';

const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/** Offset minutes → "+03:00" / "-05:00" / "+05:30"; 0 is "+00:00" (never "-00:00"). */
export function formatOffset(minutes) {
  if (!Number.isInteger(minutes)) return null;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** "+03:00" → 180, "-05:30" → -330; anything else (not "+HH:MM" / "-HH:MM") → null. */
export function offsetMinutes(offset) {
  const m = typeof offset === 'string' ? OFFSET.exec(offset) : null;
  if (!m || +m[2] > 23 || +m[3] > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) || 0;
}

/**
 * Time zones (UTC offsets) of the commits' author dates. Like the power hour
 * (habits.js), every commit counts, merges included, and a commit with an unparseable
 * date is skipped. Returns `{count, top, offsets}`:
 * - offsets: `[{offset: '+03:00', commits}]`, one per distinct offset, most commits first
 *   (ties → the lower offset first, so "-05:00" before "+00:00" before "+03:00");
 *   "Z" and "-00:00" are "+00:00";
 * - count: how many distinct offsets;
 * - top: the first of them as `{offset, commits, share}` (share of the counted commits,
 *   0..1 rounded to 3 decimals, at most 0.999 short of every commit), or null without
 *   commits.
 * Invalid input policy: never throws; non-object entries are skipped. Empty → zeros.
 */
export function computeTimezones(commits) {
  const counts = new Map(); // offset minutes → commits
  let total = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const t = localParts(c.date);
    if (!t) continue;
    total += 1;
    counts.set(t.offsetMinutes, (counts.get(t.offsetMinutes) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const offsets = sorted.map(([m, n]) => ({ offset: formatOffset(m), commits: n }));
  const first = offsets[0];
  // Never a share of 1 short of every commit (1999 of 2000 is 0.999, not 1).
  const share = first ? Math.min(Math.round((first.commits / total) * 1000) / 1000, first.commits < total ? 0.999 : 1) : 0;
  return {
    count: offsets.length,
    top: first ? { offset: first.offset, commits: first.commits, share } : null,
    offsets,
  };
}

/** "+03:00" → "UTC+03:00", "-05:00" → "UTC−05:00" (a real minus sign, as for removed lines). */
export const utcLabel = (offset) => `UTC${String(offset).replace(/^-/, '−')}`;

/**
 * The time zones as shown on the power-hour card, the recap and wrapped.md:
 * `{count, top, share, commits}` when the commits came from two or more offsets, where
 * `top` is the most common offset ("+03:00") or null when another offset has as many
 * commits (no single "mostly"), and `share` its share as a percent (0..99.9, one
 * decimal: there are always other offsets, so never 100; the exact percent is kept under
 * EXACT_PERCENT for display, see exactPercent in contributors.js); null for fewer than two offsets or a malformed stat. stats.json keeps the raw
 * value.
 */
export function shownTimezones(tz) {
  if (!tz || typeof tz !== 'object') return null;
  const list = (Array.isArray(tz.offsets) ? tz.offsets : []).filter((o) => offsetMinutes(o?.offset) !== null && Number.isInteger(o.commits) && o.commits > 0);
  if (list.length < 2) return null;
  const sorted = [...list].sort((a, b) => b.commits - a.commits || offsetMinutes(a.offset) - offsetMinutes(b.offset));
  const tied = sorted[1].commits === sorted[0].commits;
  const total = sorted.reduce((n, o) => n + o.commits, 0);
  const shown = {
    count: list.length,
    top: tied ? null : sorted[0].offset,
    commits: sorted[0].commits,
    // At most 99.9 short of every commit, so shareLabel never shows "100%" for it.
    share: Math.min(Math.round((sorted[0].commits / total) * 1000) / 10, 99.9),
  };
  // The exact percent rides along non-enumerably (see exactPercent in contributors.js), so
  // the shown whole percent is rounded once (1,049 of 2,000 reads "52%", not "53%" via 52.5).
  return Object.defineProperty(shown, EXACT_PERCENT, { value: Math.min((sorted[0].commits / total) * 100, 99.9) });
}
