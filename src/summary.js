// The console recap printed after a run: a short Wrapped-style summary plus where the
// output went. Pure string building; colors are raw ANSI escapes (no dependencies).

import { shownLongest } from './stats/daily.js';
import { languageHeadline } from './stats/languages.js';
import { hasTeamCard, shareLabel } from './stats/contributors.js';
import { DEFAULT_LANG, getStrings } from './i18n/index.js';

const EN = getStrings(DEFAULT_LANG);

const ESC = '\x1b[';
const STYLES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  magenta: [35, 39],
  cyan: [36, 39],
};

/**
 * Whether to color output written to `stream`, following the usual conventions:
 * `--no-color` (flag false) always wins; FORCE_COLOR set to anything but "" / "0" /
 * "false" forces color (and "0" / "false" disables it); a non-empty NO_COLOR disables it;
 * otherwise color only when the stream is a TTY and TERM is not "dumb".
 */
export function shouldUseColor({ stream, env = process.env, flag } = {}) {
  if (flag === false) return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== '') return !/^(0|false)$/i.test(force);
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream?.isTTY);
}

function painter(color) {
  const paint = (style, s) => {
    if (!color) return String(s);
    const [on, off] = STYLES[style];
    return `${ESC}${on}m${s}${ESC}${off}m`;
  };
  return paint;
}

// C0 and C1 control characters (incl. ESC, CSI, BEL, CR): a commit message, file name or
// repo name could otherwise inject terminal escape sequences into the recap. Also the
// bidi embedding / override / isolate controls (U+202A-202E, U+2066-2069), which can make
// text display in a different order than it is stored ("Trojan Source"), and the Unicode
// line / paragraph separators (U+2028, U+2029).
const CONTROL = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/** `s` as a string with every control character removed (safe to print). */
export function stripControl(s) {
  return String(s ?? '').replace(CONTROL, '');
}

/**
 * A line count with a sign, like the cards: 12 → "+12" / "−12". 0, anything that rounds
 * to 0, a negative count (never valid) or not a number → "0", so the recap never prints
 * "−0", "+-3" or "−-3".
 */
function signed(n, sign, L = EN) {
  const s = num(Number.isFinite(n) && n > 0 ? n : 0, L);
  return s === '0' ? s : `${sign}${s}`;
}

/**
 * 1234567 → "1,234,567" (Turkish: "1.234.567"); anything not a finite number → "0";
 * never "-0" (−0.4 → "0").
 */
function num(n, L = EN) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  return L.num(r === 0 ? 0 : r);
}

/** "1 commit", "2 commits" (`unit` is a key of the string table's `units`). */
function plural(n, unit, L = EN) {
  const [one, many] = L.units[unit];
  return `${num(n, L)} ${n === 1 ? one : many}`;
}

/** Keep the end of a long path: "…/deep/dir/file.js". */
function shortPath(p, max = 48) {
  const s = stripControl(p);
  const chars = [...s];
  return chars.length <= max ? s : `…${chars.slice(chars.length - max + 1).join('')}`;
}

/** Keep the start of a long word: "supercalifragi…" (max code points, incl. the "…"). */
function shortWord(w, max = 32) {
  const s = stripControl(w);
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Format the end-of-run recap. `stats` is computeStats() output; options:
 * - color: emit ANSI colors (default false; with false the result has no ESC chars)
 * - repoName: shown in the heading
 * - window: the requested date window ("2025", "since Jan 3, 2025"), shown in the heading
 * - streakAtWindowEnd: the current streak is relative to a past window's end, so it is
 *   labeled "at window end" instead of "current"
 * - paths: {html, cardsDir, cardCount, pngDir, pngCount, sharePng, shareSvg, statsJson}
 *   (pngDir / sharePng null when PNGs were not written; statsJson only with --json)
 * - notes: extra notice lines (e.g. the commit cap), shown in yellow
 * - today: 'YYYY-MM-DD'; when given, the longest streak leaves out future-dated days
 *   (after today + 1), as on the cards (see stats/daily.js shownLongest)
 * - lang: an src/i18n code (default 'en'); labels, units, numbers, the power hour and the
 *   personality are written in that language (notes are passed in already translated)
 * A "Team" line (top contributor, or the --author's rank) appears exactly when the
 * contributors card is built (see hasTeamCard in stats/contributors.js).
 * The first line is always `gitwrapped: N commits → <html>` (no color), so it is easy
 * to grep. Every text value is stripped of control characters (stripControl), so repo
 * data cannot inject terminal escapes. Returns the whole recap, newline-terminated.
 */
export function formatSummary(stats, { color = false, repoName, window, streakAtWindowEnd = false, paths = {}, notes = [], today, lang } = {}) {
  const L = getStrings(lang);
  const R = L.recap;
  const c = painter(color);
  const t = stats?.totals ?? {};
  const commits = Number.isFinite(t.commits) ? t.commits : 0;
  const lines = [];
  const sc = stripControl;
  lines.push(`gitwrapped: ${plural(commits, 'commit', L)} → ${sc(paths.html)}`.trimEnd());

  for (const note of notes) lines.push(c('yellow', `  ${sc(note)}`));

  const label = (s) => c('dim', s.padEnd(R.labelWidth));
  if (commits === 0) {
    lines.push(c('yellow', `  ${R.noCommits}`));
  } else {
    const name = repoName ? `${sc(repoName)} ` : '';
    const win = window ? c('dim', ` · ${sc(window)}`) : '';
    lines.push(`  ${c('bold', c('magenta', `★ ${name}Wrapped`))}${win}`);
    const lineStats = `${c('green', signed(t.linesAdded, '+', L))} / ${c('red', signed(t.linesRemoved, '−', L))} ${R.lines}`;
    lines.push(`  ${c('bold', plural(commits, 'commit', L))} · ${plural(t.activeDays ?? 0, 'activeDay', L)} · ${lineStats}`);

    const h = stats?.habits ?? {};
    if (h.peakHourLabel) {
      const tied = h.peakHourTied ? R.tied : '';
      // English keeps stats' own label ("2 AM"); other languages say the hour their way.
      const hour = L !== EN && Number.isInteger(h.peakHour) && h.peakHour >= 0 && h.peakHour < 24 ? L.hourLabel(h.peakHour) : sc(h.peakHourLabel);
      lines.push(`  ${label(R.powerHour)}${c('cyan', hour)} ${c('dim', `(${plural(h.peakHourCount, 'commit', L)}${tied})`)}`);
    }

    const s = stats?.streaks ?? {};
    // Like the cards: with `today`, future-dated days do not make the longest streak.
    const longest = shownLongest(stats, today)?.length ?? 0;
    if (longest > 0) {
      const current = s.current?.length ?? 0;
      const cur = current > 0 ? ` · ${streakAtWindowEnd ? R.atWindowEnd : R.current} ${plural(current, 'day', L)}` : '';
      lines.push(`  ${label(R.streak)}${R.longest} ${c('cyan', plural(longest, 'day', L))}${cur}`);
    }

    const hot = stats?.hotFiles?.[0];
    if (hot?.path) {
      lines.push(`  ${label(R.hottestFile)}${c('cyan', shortPath(hot.path))} ${c('dim', `(${plural(hot.commits, 'commit', L)})`)}`);
    }

    const topLang = languageHeadline(stats?.languages);
    if (topLang) {
      const share = topLang.share > 0 ? L.pct(topLang.share) : `<${L.pct(1)}`;
      lines.push(`  ${label(R.topLanguage)}${c('cyan', shortWord(topLang.name))} ${c('dim', `(${R.languageDetail(share, topLang.basis, topLang.tied.length - 1)})`)}`);
    }

    // Exactly when the contributors card is built (see hasTeamCard).
    const team = stats?.contributors ?? {};
    if (hasTeamCard(stats)) {
      const you = team.you;
      const lead = team.top?.[0];
      let detail = '';
      if (you?.rank > 0) detail = ` · ${R.youAre} ${c('cyan', `#${num(you.rank, L)}`)} ${c('dim', `(${R.ofCommits(shareLabel(you.share, you.commits, L.pct))})`)}`;
      else if (lead?.name) {
        const tied = team.top[1]?.commits === lead.commits ? R.tied : '';
        detail = ` · ${R.top} ${c('cyan', shortWord(lead.name))} ${c('dim', `(${shareLabel(lead.share, lead.commits, L.pct)}${tied})`)}`;
      }
      lines.push(`  ${label(R.team)}${plural(team.total, 'contributor', L)}${detail}`);
    }

    const m = stats?.messages ?? {};
    const words = [];
    // Same rule as the messages card: a "top" word has to show up at least twice.
    if (m.topWord?.word && m.topWord.count >= 2) {
      words.push(`"${shortWord(m.topWord.word)}" ${c('dim', `×${num(m.topWord.count, L)}`)}`);
    }
    const fixes = m.counts?.fix ?? 0;
    if (fixes > 0) words.push(`${plural(fixes, 'fix', L)}`);
    if (words.length > 0) lines.push(`  ${label(R.topWord)}${words.join(' · ')}`);

    const a = stats?.personality?.archetype;
    if (a?.name) {
      // Other languages name the archetype by id from the string table (as the cards do).
      const local = L !== EN && typeof a.id === 'string' && Object.hasOwn(L.personality.archetypes, a.id) ? L.personality.archetypes[a.id] : null;
      const name = local ? local.name : sc(a.name);
      const roast = local ? local.roast : a.roast ? sc(a.roast) : '';
      lines.push(`  ${label(R.you)}${c('bold', c('magenta', name))}${roast ? c('dim', ` — ${roast}`) : ''}`);
    }
  }

  const out = [];
  if (paths.cardsDir) out.push(`  ${R.cardsIn(plural(paths.cardCount ?? 0, 'card', L), sc(paths.cardsDir))}`);
  if (paths.pngDir) out.push(`  ${R.cardsIn(plural(paths.pngCount ?? 0, 'png', L), sc(paths.pngDir))}`);
  const share = paths.sharePng ?? paths.shareSvg;
  if (share) out.push(`  ${R.shareImage} ${sc(share)}`);
  if (paths.statsJson) out.push(`  ${R.statsJson} ${sc(paths.statsJson)}`);
  if (out.length > 0) lines.push(c('dim', '  ─'.padEnd(20, '─')), ...out);

  return `${lines.join('\n')}\n`;
}
