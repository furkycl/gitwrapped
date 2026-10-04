// Author-local time helpers. All stats use the author's own wall-clock time: the UTC
// offset embedded in the commit's ISO 8601 date (as printed by git's %aI), never the
// machine's timezone. Results are deterministic and reflect when the author actually coded.

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))$/i;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysInMonth = (y, mo) => (mo === 2 && isLeap(y) ? 29 : MONTH_DAYS[mo - 1]);

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil). */
function daysFromCivil(y, mo, d) {
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Split an ISO 8601 date-time with an explicit offset ("Z" means +00:00) into the
 * author's local wall-clock parts:
 * `{year, month (1-12), day, hour, minute, weekday (0=Sunday..6), dayKey 'YYYY-MM-DD',
 *   offsetMinutes, ms (epoch milliseconds of the instant)}`.
 *
 * Invalid input policy: returns `null` (never throws) for anything that is not a string
 * in that shape, has no offset, or names an impossible date/time (e.g. 2024-02-30).
 * Stats functions skip a null date for their time-based fields only.
 */
export function localParts(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const m = ISO.exec(isoDate.trim());
  if (!m) return null;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  const hour = +m[4];
  const minute = +m[5];
  const second = m[6] === undefined ? 0 : +m[6];
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  // Rejects day overflow such as 2024-02-30.
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const offH = m[7] ? 0 : +m[9];
  const offM = m[7] ? 0 : +m[10];
  if (offH > 23 || offM > 59) return null;
  const offsetMinutes = (m[8] === '-' ? -1 : 1) * (offH * 60 + offM) || 0; // "-00:00" → 0, not -0
  // Pure arithmetic (no Date): fast, and correct for years 0-99, which Date.UTC maps to 19xx.
  const epochDay = daysFromCivil(year, month, day);
  const ms = ((epochDay * 24 + hour) * 60 + minute - offsetMinutes) * 60_000 + second * 1000;
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: (((epochDay + 4) % 7) + 7) % 7, // 1970-01-01 was a Thursday
    dayKey: `${m[1]}-${m[2]}-${m[3]}`,
    offsetMinutes,
    ms,
  };
}

/** 0-23 → "12 AM" (midnight), "9 AM", "12 PM" (noon), "11 PM". null/invalid → null. */
export function hourLabel(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const WEEKDAY_NAMES = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
