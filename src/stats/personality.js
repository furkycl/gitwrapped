import { daysUpTo, longestRun } from './daily.js';
import { epochDay } from './time.js';
import { getStrings } from '../i18n/index.js';
import { shownReverts } from './reverts.js';
import { WEEKEND_DAYS, weekendPercent } from './weekend.js';

const EN = getStrings('en');
const IDS = ['night-owl', 'early-bird', 'friday-deployer', 'fixaholic', 'weekend-warrior', 'steady-shipper'];

/** The commit archetypes, in tie-break order. Steady Shipper is also the fallback. */
export const ARCHETYPES = Object.freeze(
  IDS.map((id) => Object.freeze({ id, name: EN.personality.archetypes[id].name, roast: EN.personality.archetypes[id].roast })),
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
 *   share − 0.15) / 0.35; fixaholic = (messages.counts.fix / non-merge commits − 0.15) / 0.45
 *   (non-merge commits: the `nonMergeCommits` option, else totals.commits);
 *   steady-shipper = 0.7 × activeDays / span + 0.3 × min(1, longest
 *   streak / 14), where span is the days from the earlier to the later of firstDay /
 *   lastDay, inclusive (density capped at 1). With the `today` option ('YYYY-MM-DD') and
 *   stats.daily.days, days after today + 1 (future-dated commits) count toward neither
 *   activeDays, the span nor the longest streak (see daily.js daysUpTo / longestRun).
 * - archetype: the top score, unless fewer than 3 commits are dated or the top score is
 *   below 0.25, in which case steady-shipper. `reason` is a short sentence quoting the
 *   real number behind it (Fixaholic's also names the reverts, stats.reverts, when any); with fewer than 3 dated commits it is "Not enough commits yet."
 * Invalid input policy: never throws; missing / malformed parts count as empty, so
 * `computePersonality()` → steady-shipper, "Not enough commits yet.", all scores 0.
 */
export function computePersonality(stats, opts) {
  stats = stats ?? {};
  const nonMergeCommits = opts?.nonMergeCommits;
  const totals = stats.totals ?? {};
  const byHour = Array.isArray(stats.habits?.byHour) ? stats.habits.byHour : [];
  const byWeekday = Array.isArray(stats.habits?.byWeekday) ? stats.habits.byWeekday : [];
  const commits = num(totals.commits);
  const dated = sumAt(byHour, [...Array(24).keys()]);
  const share = (n) => (dated > 0 ? n / dated : 0);

  const night = share(sumAt(byHour, NIGHT_HOURS));
  const morning = share(sumAt(byHour, MORNING_HOURS));
  const friday = share(sumAt(byWeekday, [5]));
  // The same commits as stats.weekend (see weekend.js), so its line and this fact agree.
  const weekend = share(sumAt(byWeekday, WEEKEND_DAYS));
  // Fix share is of non-merge commits: merges never carry the author's own message.
  const nonMerge = typeof nonMergeCommits === 'number' ? Math.min(num(nonMergeCommits), commits) : commits;
  const fixes = Math.min(num(stats.messages?.counts?.fix), nonMerge);
  const fixShare = nonMerge > 0 ? fixes / nonMerge : 0;
  // Reverts (stats.reverts) are not scored; the Fixaholic reason mentions them.
  const reverts = shownReverts(stats.reverts)?.count ?? 0;

  let activeDays = num(totals.activeDays);
  // The span runs from the earliest to the latest active day, whatever order the two
  // days arrive in (mixed offsets can make the earliest instant's day the later one).
  let a = epochDay(totals.firstDay);
  let b = epochDay(totals.lastDay);
  // With `today` and the daily list, future-dated days (after today + 1) are left out of
  // both the span and the active-day count, so one commit dated 2099 does not turn a
  // daily committer into a 0.01 density.
  // The longest streak is recomputed over the kept days too (a 2099 run is not a streak).
  let longest = num(stats.streaks?.longest?.length);
  const daily = Array.isArray(stats.daily?.days) ? stats.daily.days : null;
  if (daily && epochDay(opts?.today ?? '') !== null) {
    const keptDays = daysUpTo(daily, opts.today);
    const kept = keptDays.map((x) => epochDay(x.day));
    if (kept.length > 0 && kept.length < daily.length) {
      activeDays = kept.length;
      a = Math.min(...kept);
      b = Math.max(...kept);
      longest = longestRun(keptDays).length;
    }
  }
  const span = a !== null && b !== null ? Math.abs(b - a) + 1 : 0;
  const density = span > 0 ? Math.min(1, activeDays / span) : 0;
  const steady = activeDays > 0 ? 0.7 * density + 0.3 * Math.min(1, longest / 14) : 0;

  const raw = {
    'night-owl': above(night, 0.1, 0.4),
    'early-bird': above(morning, 0.08, 0.4),
    'friday-deployer': above(friday, 0.2, 0.25),
    fixaholic: above(fixShare, 0.15, 0.45),
    'weekend-warrior': above(weekend, 0.15, 0.35),
    'steady-shipper': steady,
  };
  const facts = { night, morning, friday, fixShare, reverts, weekend, activeDays, span, longest };
  // Array#sort is stable, so equal scores keep ARCHETYPES order.
  const scores = ARCHETYPES.map(({ id, name }) => ({ id, name, score: round2(clamp01(raw[id])) }))
    .sort((a, b) => b.score - a.score);

  const enough = dated >= MIN_DATED;
  const id = enough && scores[0].score >= MIN_SCORE ? scores[0].id : 'steady-shipper';
  const { name, roast } = BY_ID.get(id);
  const result = {
    archetype: { id, name, roast, reason: enough ? reasonText(id, facts, EN) : EN.personality.notEnough },
    scores,
  };
  // The numbers behind the reason, so the cards can phrase it in another language
  // (personalityReason). Under a module-private symbol and non-enumerable: JSON
  // (stats.json walks Object.keys), spreads and deep-equality checks never see it.
  Object.defineProperty(result, FACTS, { value: Object.freeze({ ...facts, enough }) });
  return result;
}

/** Key of the facts behind a computePersonality() result (see personalityReason). */
const FACTS = Symbol('personality facts');

/** The reason sentence for archetype `id` from `facts`, in the language of `L`. */
function reasonText(id, facts, L) {
  const pct = (share) => Math.round(share * 100);
  const r = L.personality.reasons;
  switch (id) {
    case 'night-owl': return r[id](pct(facts.night));
    case 'early-bird': return r[id](pct(facts.morning));
    case 'friday-deployer': return r[id](pct(facts.friday));
    case 'fixaholic': return r[id](pct(facts.fixShare), facts.reverts ?? 0);
    // The weekend line's percent (weekend.js): never 100 short of every commit.
    case 'weekend-warrior': return r[id](weekendPercent(facts.weekend));
    default: return r['steady-shipper'](facts.activeDays, facts.span, facts.longest);
  }
}

/**
 * The archetype's reason sentence in the language of string table `L` (see
 * src/i18n), for `personality` as returned by computePersonality(). Null when that object
 * did not come from computePersonality() (e.g. hand-built or parsed from stats.json):
 * the caller then keeps the stored English `reason`.
 */
export function personalityReason(personality, L) {
  const facts = personality && typeof personality === 'object' ? personality[FACTS] : undefined;
  const id = personality?.archetype?.id;
  if (!facts || typeof id !== 'string') return null;
  return facts.enough ? reasonText(id, facts, L) : L.personality.notEnough;
}
