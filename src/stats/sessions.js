// Coding sessions: per author, a run of commits each no more than two hours after the one
// before it. A session lasts from its first commit to its last (a one-commit session is 0
// minutes). Counted over the same commits as the power hour and the late nights (habits.js,
// latenights.js): every commit with a parseable author date, merges and future-dated ones
// included; unparseable dates are skipped. Authors are told apart as the contributors are
// (contributors.js identityKey: the mailmapped email, lowercased, else the name), so two
// people committing in the same hour never share a session; one person's commits to
// several repos of a multi-repo run do.
import { identityKey } from './contributors.js';
import { epochDay, localParts } from './time.js';

/** The most minutes between two consecutive commits of one author in the same session. */
export const SESSION_GAP_MINUTES = 120;

const MINUTE = 60_000;

/** Each author's dated commits as instants (`{ms, dayKey}`), sorted by time, in a Map by identity. */
function byAuthor(commits) {
  const authors = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const t = localParts(c.date);
    if (!t) continue;
    const key = identityKey(c);
    if (!authors.has(key)) authors.set(key, []);
    authors.get(key).push({ ms: t.ms, dayKey: t.dayKey });
  }
  for (const list of authors.values()) list.sort((a, b) => a.ms - b.ms);
  return authors;
}

/**
 * The sessions of `commits` as `[{start (ms), minutes, commits, day}]`: per author, sorted
 * by instant, a commit no more than SESSION_GAP_MINUTES after the previous one (equal
 * instants included) continues its session, else starts a new one. `minutes` is the time
 * from the first commit to the last, in whole minutes (rounded down: seconds count, so a
 * 59-second session is 0 minutes); `day` is the author-local 'YYYY-MM-DD' of the first
 * commit.
 */
export function sessionsOf(commits) {
  const sessions = [];
  for (const list of byAuthor(commits).values()) {
    let cur = null;
    for (const { ms, dayKey } of list) {
      if (cur && ms - cur.last <= SESSION_GAP_MINUTES * MINUTE) {
        cur.last = ms;
        cur.commits += 1;
        continue;
      }
      cur = { start: ms, last: ms, commits: 1, day: dayKey };
      sessions.push(cur);
    }
  }
  return sessions.map(({ start, last, commits: n, day }) => ({ start, minutes: Math.floor((last - start) / MINUTE), commits: n, day }));
}

/** Whether session `a` is longer than `b`: more minutes, then more commits, then earlier. */
const longer = (a, b) => !b || a.minutes > b.minutes || (a.minutes === b.minutes && (a.commits > b.commits || (a.commits === b.commits && a.start < b.start)));

/**
 * stats.sessions from the commits: `{count, medianMinutes, longest: {minutes, commits,
 * day}}`, or null without a commit with a parseable date (see sessionsOf for what a
 * session is).
 * - count: how many sessions there are, across all authors;
 * - medianMinutes: the median session length in whole minutes (an even count takes the
 *   mean of the two middle ones, rounded to a whole minute); one-commit sessions count as
 *   0 minutes;
 * - longest: the session with the most minutes (ties → more commits, then the earliest),
 *   its commits and the author-local day of its first commit. With `today` ('YYYY-MM-DD'),
 *   sessions that start after the day after today (clock skew, a bad GIT_AUTHOR_DATE) are
 *   not considered for it unless every session does (as daily.js daysUpTo and the latest
 *   late night), so the longest session is never a day in 2099; they still count in
 *   `count` and `medianMinutes`.
 * Invalid input policy: never throws; non-object entries and unparseable dates are skipped.
 */
export function computeSessions(commits, { today } = {}) {
  const sessions = sessionsOf(commits);
  if (sessions.length === 0) return null;
  const limit = epochDay(today ?? '');
  let best = null;
  let bestAny = null;
  for (const s of sessions) {
    if (longer(s, bestAny)) bestAny = s;
    if ((limit === null || epochDay(s.day) <= limit + 1) && longer(s, best)) best = s;
  }
  best = best ?? bestAny;
  const lengths = sessions.map((s) => s.minutes).sort((a, b) => a - b);
  const mid = lengths.length >> 1;
  const median = lengths.length % 2 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2);
  return { count: sessions.length, medianMinutes: median, longest: { minutes: best.minutes, commits: best.commits, day: best.day } };
}

const whole = (n, min) => Number.isSafeInteger(n) && n >= min;

/**
 * The coding sessions as the streak (or power-hour) card, the recap and wrapped.md show
 * them, from stats (computeStats output): `{count, medianMinutes, longest: {minutes,
 * commits, day}}` when stats.sessions is well-formed and its longest session lasted at
 * least a minute (two or more commits, so there is a length to tell), else null: with
 * every session a single commit (or commits in the same minute), "longest 0 min" says
 * nothing, so nothing is shown (stats.json keeps the value).
 */
export function shownSessions(stats) {
  const s = stats?.sessions;
  if (!s || typeof s !== 'object') return null;
  const l = s.longest;
  if (!whole(s.count, 1) || !whole(s.medianMinutes, 0) || !l || typeof l !== 'object') return null;
  if (!whole(l.minutes, 1) || !whole(l.commits, 2) || epochDay(l.day) === null) return null;
  return { count: s.count, medianMinutes: s.medianMinutes, longest: { minutes: l.minutes, commits: l.commits, day: l.day } };
}
