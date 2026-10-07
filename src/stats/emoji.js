import { isMergeCommit } from './messages.js';
import { graphemes } from '../cards/svg.js';

/**
 * The share of commits (commits with an emoji / counted) from which the messages card,
 * the recap and wrapped.md show the emoji stat: below it a stray 🎉 says nothing about
 * how the repo writes its messages.
 */
export const EMOJI_MIN_SHARE = 0.05;

/** How many emoji `top` lists (most used first). */
export const TOP_EMOJI = 3;

/**
 * gitmoji shortcodes (https://gitmoji.dev, plus a few common GitHub aliases) and the
 * emoji each stands for. Only these count: any other `:word:` is not an emoji, so text
 * like `a:b:c`, `10:30:00` or `std::vector` never is.
 */
export const GITMOJI = Object.freeze({
  art: '🎨', zap: '⚡', fire: '🔥', bug: '🐛', ambulance: '🚑', sparkles: '✨', memo: '📝',
  pencil: '📝', rocket: '🚀', lipstick: '💄', tada: '🎉', white_check_mark: '✅',
  heavy_check_mark: '✔️', lock: '🔒', closed_lock_with_key: '🔐', bookmark: '🔖',
  rotating_light: '🚨', construction: '🚧', green_heart: '💚', arrow_down: '⬇️',
  arrow_up: '⬆️', pushpin: '📌', construction_worker: '👷', chart_with_upwards_trend: '📈',
  recycle: '♻️', heavy_plus_sign: '➕', heavy_minus_sign: '➖', wrench: '🔧', hammer: '🔨',
  globe_with_meridians: '🌐', pencil2: '✏️', poop: '💩', rewind: '⏪',
  twisted_rightwards_arrows: '🔀', package: '📦', alien: '👽', truck: '🚚',
  page_facing_up: '📄', boom: '💥', bento: '🍱', wheelchair: '♿', bulb: '💡', beers: '🍻',
  speech_balloon: '💬', card_file_box: '🗃️', loud_sound: '🔊', mute: '🔇',
  busts_in_silhouette: '👥', children_crossing: '🚸', building_construction: '🏗️',
  iphone: '📱', clown_face: '🤡', egg: '🥚', see_no_evil: '🙈', camera_flash: '📸',
  alembic: '⚗️', mag: '🔍', label: '🏷️', seedling: '🌱', triangular_flag_on_post: '🚩',
  goal_net: '🥅', dizzy: '💫', wastebasket: '🗑️', passport_control: '🛂',
  adhesive_bandage: '🩹', monocle_face: '🧐', coffin: '⚰️', test_tube: '🧪', necktie: '👔',
  stethoscope: '🩺', bricks: '🧱', technologist: '🧑‍💻', money_with_wings: '💸',
  thread: '🧵', safety_vest: '🦺', lock_with_ink_pen: '🔏', airplane: '✈️', 100: '💯',
  whale: '🐳', heart: '❤️', ok_hand: '👌', '+1': '👍', '-1': '👎',
});

/** `:name:`: lowercase letters, digits, `_`, `+` and `-` between two colons. */
const SHORTCODE = /:([a-z0-9_+-]+):/g;
/** A shortcode right after the closing colon of another one: `:recycle::fire:`. */
const NEXT_SHORTCODE = /^:([a-z0-9_+-]+):/;
const ALNUM = /[\p{L}\p{N}]/u;
const PICTO = /\p{Extended_Pictographic}/u;
const PRESENTATION = /\p{Emoji_Presentation}/u;
const RI = /\p{Regional_Indicator}/gu;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
/** Code points that can start or make an emoji cluster; text without any has none. */
const CANDIDATE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/gu;
const VARIATION = /[\uFE0E\uFE0F]/gu;
/** Combining marks other than the keycap U+20E3 and the variation selectors (`✨` + U+0301 is still ✨), and a dangling ZWJ at the end. */
const STRAY = /(?![\u20E3\uFE0E\uFE0F])\p{M}|\u200D+$/gu;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

/**
 * Whether one grapheme cluster is an emoji: a flag (two regional indicators), a keycap
 * (1️⃣ #️⃣, also without U+FE0F), or a pictograph that renders as an emoji: one with
 * default emoji presentation (✨ ⚡ 🐛 ✅) or one followed by U+FE0F (♻️ ✔️ 🅰️). Text-style
 * symbols (© ™ → ♻ 🅰 🀀 without U+FE0F, anything followed by U+FE0E) are not. ZWJ
 * sequences (👩‍💻), skin tones (👍🏽) and tag flags are one cluster, so one emoji.
 */
export function isEmoji(cluster) {
  if (typeof cluster !== 'string' || !cluster) return false;
  if (KEYCAP.test(cluster)) return true;
  const ri = cluster.match(RI);
  if (ri) return ri.length >= 2;
  const cps = Array.from(cluster);
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (!PICTO.test(ch)) continue;
    if (cps[i + 1] === '\uFE0E') continue;
    if (PRESENTATION.test(ch) || cps[i + 1] === '\uFE0F') return true;
  }
  return false;
}

/** An emoji cluster without stray combining marks or a trailing ZWJ (see STRAY): the form emojiIn returns. */
const cleanEmoji = (cluster) => cluster.replace(STRAY, '');

/**
 * The key two spellings of one emoji share: the cluster without variation selectors (and
 * stray combining marks), so ⚡ and ⚡️, or ♻️ and :recycle:, are the same emoji. Skin
 * tones stay (👍🏽 is not 👍).
 */
export const emojiKey = (emoji) => cleanEmoji(String(emoji)).replace(VARIATION, '');

/**
 * The Unicode emoji clusters of `s` as [index, emoji]: each candidate code point (see
 * CANDIDATE) is looked up in its grapheme cluster, and the scan continues after it, so
 * plain text between emoji is never segmented.
 */
function unicodeEmoji(s, found) {
  CANDIDATE.lastIndex = 0;
  if (!CANDIDATE.test(s)) return;
  const segments = segmenter ? segmenter.segment(s) : null;
  CANDIDATE.lastIndex = 0;
  let m;
  while ((m = CANDIDATE.exec(s)) !== null) {
    let index = m.index;
    let cluster = m[0];
    if (segments) {
      const seg = segments.containing(m.index);
      index = seg.index;
      cluster = seg.segment;
    }
    CANDIDATE.lastIndex = Math.max(CANDIDATE.lastIndex, index + cluster.length);
    if (isEmoji(cluster)) found.push([index, cleanEmoji(cluster)]);
  }
}

/**
 * The gitmoji shortcodes of `s` as [index, emoji]. A `:name:` counts only when the name
 * is in GITMOJI and it is not part of other text: not right after a letter or digit
 * (`10:100:00`), not right after a `:` unless that colon closed a shortcode
 * (`std::thread::spawn`, `foo::bug::bar`; `:recycle::fire:` is two), not right before
 * `:` and a letter or digit unless a shortcode follows (`:lock::Mutex`), and not inside
 * brackets (`arr[:100:]`).
 */
function shortcodes(s, found) {
  if (!s.includes(':')) return;
  SHORTCODE.lastIndex = 0;
  let acceptedEnd = -1;
  let m;
  while ((m = SHORTCODE.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const prev = Array.from(s.slice(Math.max(0, start - 2), start)).at(-1) ?? '';
    const next = s.slice(end, end + 1);
    const known = Object.hasOwn(GITMOJI, m[1]);
    let ok = known && !(prev && ALNUM.test(prev)) && prev !== '[' && next !== ']';
    if (ok && prev === ':' && start !== acceptedEnd) ok = false;
    if (ok && next === ':' && ALNUM.test(s.slice(end + 1, end + 2))) {
      const after = NEXT_SHORTCODE.exec(s.slice(end));
      ok = after !== null && Object.hasOwn(GITMOJI, after[1]);
    }
    if (ok) {
      found.push([start, GITMOJI[m[1]]]);
      acceptedEnd = end;
    } else {
      // Not a shortcode: its closing colon may open the next one (`x:y:sparkles:`).
      SHORTCODE.lastIndex = end - 1;
    }
  }
}

/**
 * The emoji in a subject line, in order of appearance (repeats kept): Unicode emoji
 * clusters (see isEmoji) and gitmoji shortcodes (see shortcodes) as their emoji.
 * Returns `[]` for anything but a string.
 */
export function emojiIn(subject) {
  if (typeof subject !== 'string' || !subject) return [];
  const found = [];
  unicodeEmoji(subject, found);
  shortcodes(subject, found);
  return found.sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}

/** Code-point order (locale-independent). */
function byCodePoint(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Which of two spellings of one emoji to show: the longer (fully qualified, with U+FE0F), then the lower in code-point order. */
const betterForm = (a, b) => (b.length !== a.length ? (b.length > a.length ? b : a) : byCodePoint(b, a) < 0 ? b : a);

/**
 * Emoji in commit subjects, over the non-merge commits (see isMergeCommit) with a
 * non-empty subject (the commits the messages card and stats.commitTypes count).
 * Returns `{total, commits, share, distinct, top: [{emoji, count}], shown}`:
 * - total: commits counted; commits: how many of them have at least one emoji in the
 *   subject (see emojiIn: Unicode emoji and gitmoji shortcodes);
 * - share: commits / total, rounded to 3 decimals (0 without commits);
 * - distinct: how many different emoji were used (see emojiKey: ✨, ✨️ and :sparkles:
 *   are one);
 * - top: the TOP_EMOJI emoji used by the most commits, most first; `count` is the number
 *   of commits whose subject has it (an emoji repeated in one subject counts once); ties
 *   go to the lower emoji in code-point order of its key, so the order never
 *   depends on the order of the commits. `emoji` is its fullest spelling seen (with
 *   U+FE0F when any spelling had it); `[]` without any;
 * - shown: whether the cards / recap / wrapped.md show it: commits / total ≥ EMOJI_MIN_SHARE.
 * Invalid input policy (as in types.js): never throws; non-object entries and commits
 * without a string subject are skipped. Empty input → zeros, top [], shown false.
 */
export function computeEmoji(commits) {
  const counts = new Map(); // key → {emoji, count}
  let total = 0;
  let withEmoji = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object' || isMergeCommit(c)) continue;
    if (typeof c.subject !== 'string' || !c.subject.trim()) continue;
    total += 1;
    const list = emojiIn(c.subject);
    if (list.length === 0) continue;
    withEmoji += 1;
    const seen = new Set();
    for (const e of list) {
      const key = emojiKey(e);
      const entry = counts.get(key);
      if (!entry) counts.set(key, { emoji: e, count: 0 });
      else entry.emoji = betterForm(entry.emoji, e);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.get(key).count += 1;
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || byCodePoint(a[0], b[0]))
    .slice(0, TOP_EMOJI)
    .map(([, v]) => ({ emoji: v.emoji, count: v.count }));
  return {
    total,
    commits: withEmoji,
    share: total > 0 ? Math.round((withEmoji / total) * 1000) / 1000 : 0,
    distinct: counts.size,
    top,
    shown: withEmoji > 0 && withEmoji / total >= EMOJI_MIN_SHARE,
  };
}

/** A shown count: a finite positive number rounded to an integer, anything else 0. */
const shownCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * The emoji stat the messages card, the recap and wrapped.md show for `stats.emoji`, or
 * null when it is not shown: no object, no commit with an emoji, or such commits under
 * EMOJI_MIN_SHARE of `total` (recomputed from the counts, so a hand-edited `shown` flag
 * cannot disagree with them). Returns `{commits, total, top: [{emoji, count}]}`: `top`
 * keeps the (at most TOP_EMOJI) entries whose `emoji` is one emoji cluster (see isEmoji)
 * with a positive count, in their order, the first of each emoji only (see emojiKey).
 * All three outputs use this, so they agree.
 */
export function shownEmoji(stat) {
  if (!stat || typeof stat !== 'object') return null;
  const commits = shownCount(stat.commits);
  const total = Math.max(commits, shownCount(stat.total));
  if (commits === 0 || commits / total < EMOJI_MIN_SHARE) return null;
  const keys = new Set();
  const top = (Array.isArray(stat.top) ? stat.top : [])
    .filter((t) => t && typeof t.emoji === 'string' && graphemes(t.emoji).length === 1 && isEmoji(t.emoji) && shownCount(t.count) > 0)
    .filter((t) => {
      // One entry per emoji (a hand-edited ✨, ✨️, ✨ shows once).
      const key = emojiKey(t.emoji);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
    .slice(0, TOP_EMOJI)
    .map((t) => ({ emoji: t.emoji, count: Math.min(commits, shownCount(t.count)) }));
  return { commits, total, top };
}
