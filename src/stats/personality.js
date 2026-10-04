import { epochDay } from './time.js';

/** The commit archetypes, in tie-break order. Steady Shipper is also the fallback. */
export const ARCHETYPES = Object.freeze(
  [
    { id: 'night-owl', name: 'Night Owl', roast: 'Your best ideas arrive after midnight. So do your worst ones.' },
    { id: 'early-bird', name: 'Early Bird', roast: 'You push code before the coffee is even brewed. Show-off.' },
    { id: 'friday-deployer', name: 'Friday Deployer', roast: 'You ship on Fridays and call it courage. Your on-call rotation calls it something else.' },
    { id: 'fixaholic', name: 'Fixaholic', roast: 'Every bug you fix is a bug you lovingly wrote first.' },
    { id: 'weekend-warrior', name: 'Weekend Warrior', roast: 'Saturdays are for touching grass. You touched git instead.' },
    { id: 'steady-shipper', name: 'Steady Shipper', roast: 'Reliable, consistent, low drama. Frankly, a little suspicious.' },
  ].map((a) => Object.freeze(a)),
);

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
const NIGHT_HOURS = [22, 23, 0, 1, 2, 3];
const MORNING_HOURS = [5, 6, 7, 8];
/** Below this best score no habit stands out, so the result falls back to steady-shipper. */
const MIN_SCORE = 0.25;
const MIN_DATED = 3;

const num = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
// The tiny nudge makes exact halves round up despite float noise: (0.25 − 0.10) / 0.40
// evaluates to 0.37499999999999994, which should still report as 0.38.
const round2 = (x) => Math.round(x * 100 + 1e-9) / 100;
const pct = (share) => `${Math.round(share * 100)}%`;
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
/** clamp01((share − baseline) / range): 0 at or below the baseline, 1 at baseline + range. */
const above = (share, baseline, range) => clamp01((share - baseline) / range);
const sumAt = (arr, idx) => idx.reduce((s, i) => s + num(arr[i]), 0);

/**
 * Rule-based commit personality from computeStats output (`{totals, habits, streaks,
 * messages}`; other keys are ignored).
 * Returns `{archetype: {id, name, roast, reason}, scores: [{id, name, score}]}`:
 * - scores: one entry per ARCHETYPES item, each 0..1 (rounded to 2 decimals), sorted by
 *   score desc with ties in ARCHETYPES order. Shares are of commits with a parseable date
 *   (sum of habits.byHour), in author-local time:
 *   habit scores measure how far a share rises above a "nobody would notice" baseline,
 *   clamped to 0..1: night-owl = (share in hours 22-03 − 0.10) / 0.40;
 *   early-bird = (share in hours 05-08 − 0.08) / 0.40; friday-deployer = (Friday share −
 *   0.20) / 0.25 (0.20 = a uniform Mon–Fri week; ≥45% → 1); weekend-warrior = (Sat+Sun
 *   share − 0.15) / 0.35; fixaholic = (messages.counts.fix / totals.commits − 0.15) / 0.45;
 *   steady-shipper = 0.7 × activeDays / span + 0.3 × min(1, longest
 *   streak / 14), where span is firstDay..lastDay inclusive (density capped at 1).
 * - archetype: the top score, unless fewer than 3 commits are dated or the top score is
 *   below 0.25, in which case steady-shipper. `reason` is a short sentence quoting the
 *   real number behind it; with fewer than 3 dated commits it is "Not enough commits yet."
 * Invalid input policy: never throws; missing / malformed parts count as empty, so
 * `computePersonality()` → steady-shipper, "Not enough commits yet.", all scores 0.
 */
export function computePersonality(stats) {
  stats = stats ?? {};
  const totals = stats.totals ?? {};
  const byHour = Array.isArray(stats.habits?.byHour) ? stats.habits.byHour : [];
  const byWeekday = Array.isArray(stats.habits?.byWeekday) ? stats.habits.byWeekday : [];
  const commits = num(totals.commits);
  const dated = sumAt(byHour, [...Array(24).keys()]);
  const share = (n) => (dated > 0 ? n / dated : 0);

  const night = share(sumAt(byHour, NIGHT_HOURS));
  const morning = share(sumAt(byHour, MORNING_HOURS));
  const friday = share(sumAt(byWeekday, [5]));
  const weekend = share(sumAt(byWeekday, [0, 6]));
  const fixes = Math.min(num(stats.messages?.counts?.fix), commits);
  const fixShare = commits > 0 ? fixes / commits : 0;

  const activeDays = num(totals.activeDays);
  const first = epochDay(totals.firstDay);
  const last = epochDay(totals.lastDay);
  const span = first !== null && last !== null && last >= first ? last - first + 1 : 0;
  const density = span > 0 ? Math.min(1, activeDays / span) : 0;
  const longest = num(stats.streaks?.longest?.length);
  const steady = activeDays > 0 ? 0.7 * density + 0.3 * Math.min(1, longest / 14) : 0;

  const raw = {
    'night-owl': above(night, 0.1, 0.4),
    'early-bird': above(morning, 0.08, 0.4),
    'friday-deployer': above(friday, 0.2, 0.25),
    fixaholic: above(fixShare, 0.15, 0.45),
    'weekend-warrior': above(weekend, 0.15, 0.35),
    'steady-shipper': steady,
  };
  const reasons = {
    'night-owl': `${pct(night)} of your commits land between 10 PM and 4 AM.`,
    'early-bird': `${pct(morning)} of your commits land between 5 AM and 9 AM.`,
    'friday-deployer': `${pct(friday)} of your commits land on a Friday.`,
    fixaholic: `${pct(fixShare)} of your commit messages are fixes.`,
    'weekend-warrior': `${pct(weekend)} of your commits land on a Saturday or Sunday.`,
    'steady-shipper': `You committed on ${activeDays} of ${days(span)}, with a longest streak of ${days(longest)}.`,
  };

  // Array#sort is stable, so equal scores keep ARCHETYPES order.
  const scores = ARCHETYPES.map(({ id, name }) => ({ id, name, score: round2(clamp01(raw[id])) }))
    .sort((a, b) => b.score - a.score);

  const enough = dated >= MIN_DATED;
  const id = enough && scores[0].score >= MIN_SCORE ? scores[0].id : 'steady-shipper';
  const { name, roast } = BY_ID.get(id);
  return {
    archetype: { id, name, roast, reason: enough ? reasons[id] : 'Not enough commits yet.' },
    scores,
  };
}
