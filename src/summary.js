// The console recap printed after a run: a short Wrapped-style summary plus where the
// output went. Pure string building; colors are raw ANSI escapes (no dependencies).

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

/** 1234567 → "1,234,567"; anything not a finite number → "0". */
function num(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

function plural(n, one, many = `${one}s`) {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** Keep the end of a long path: "…/deep/dir/file.js". */
function shortPath(p, max = 48) {
  const s = String(p);
  const chars = [...s];
  return chars.length <= max ? s : `…${chars.slice(chars.length - max + 1).join('')}`;
}

/** Keep the start of a long word: "supercalifragi…" (max code points, incl. the "…"). */
function shortWord(w, max = 32) {
  const s = String(w);
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Format the end-of-run recap. `stats` is computeStats() output; options:
 * - color: emit ANSI colors (default false; with false the result has no ESC chars)
 * - repoName: shown in the heading
 * - paths: {html, cardsDir, cardCount, pngDir, pngCount, sharePng, shareSvg}
 *   (pngDir / sharePng null when PNGs were not written)
 * - notes: extra notice lines (e.g. the commit cap), shown in yellow
 * The first line is always `gitwrapped: N commits → <html>` (no color), so it is easy
 * to grep. Returns the whole recap, newline-terminated.
 */
export function formatSummary(stats, { color = false, repoName, paths = {}, notes = [] } = {}) {
  const c = painter(color);
  const t = stats?.totals ?? {};
  const commits = Number.isFinite(t.commits) ? t.commits : 0;
  const lines = [];
  lines.push(`gitwrapped: ${plural(commits, 'commit')} → ${paths.html ?? ''}`.trimEnd());

  for (const note of notes) lines.push(c('yellow', `  ${note}`));

  const label = (s) => c('dim', s.padEnd(13));
  if (commits === 0) {
    lines.push(c('yellow', '  No commits found: the cards are generated, but there is nothing to recap yet.'));
  } else {
    const name = repoName ? `${repoName} ` : '';
    lines.push(`  ${c('bold', c('magenta', `★ ${name}Wrapped`))}`);
    const lineStats = `${c('green', `+${num(t.linesAdded)}`)} / ${c('red', `−${num(t.linesRemoved)}`)} lines`;
    lines.push(`  ${c('bold', plural(commits, 'commit'))} · ${plural(t.activeDays ?? 0, 'active day')} · ${lineStats}`);

    const h = stats?.habits ?? {};
    if (h.peakHourLabel) {
      const tied = h.peakHourTied ? ', tied' : '';
      lines.push(`  ${label('Power hour')}${c('cyan', h.peakHourLabel)} ${c('dim', `(${plural(h.peakHourCount, 'commit')}${tied})`)}`);
    }

    const s = stats?.streaks ?? {};
    const longest = s.longest?.length ?? 0;
    if (longest > 0) {
      const current = s.current?.length ?? 0;
      const cur = current > 0 ? ` · current ${plural(current, 'day')}` : '';
      lines.push(`  ${label('Streak')}longest ${c('cyan', plural(longest, 'day'))}${cur}`);
    }

    const hot = stats?.hotFiles?.[0];
    if (hot?.path) {
      lines.push(`  ${label('Hottest file')}${c('cyan', shortPath(hot.path))} ${c('dim', `(${plural(hot.commits, 'commit')})`)}`);
    }

    const m = stats?.messages ?? {};
    const words = [];
    if (m.topWord?.word) {
      const word = shortWord(m.topWord.word);
      words.push(m.topWord.count > 1 ? `"${word}" ${c('dim', `×${num(m.topWord.count)}`)}` : `"${word}"`);
    }
    const fixes = m.counts?.fix ?? 0;
    if (fixes > 0) words.push(`${plural(fixes, 'fix', 'fixes')}`);
    if (words.length > 0) lines.push(`  ${label('Top word')}${words.join(' · ')}`);

    const a = stats?.personality?.archetype;
    if (a?.name) {
      lines.push(`  ${label('You are')}${c('bold', c('magenta', a.name))}${a.roast ? c('dim', ` — ${a.roast}`) : ''}`);
    }
  }

  const out = [];
  if (paths.cardsDir) out.push(`  ${plural(paths.cardCount ?? 0, 'card')} in ${paths.cardsDir}`);
  if (paths.pngDir) out.push(`  ${plural(paths.pngCount ?? 0, 'PNG')} in ${paths.pngDir}`);
  const share = paths.sharePng ?? paths.shareSvg;
  if (share) out.push(`  share image: ${share}`);
  if (out.length > 0) lines.push(c('dim', '  ─'.padEnd(20, '─')), ...out);

  return `${lines.join('\n')}\n`;
}
