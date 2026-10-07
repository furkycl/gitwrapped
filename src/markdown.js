// The --md export: <out>/wrapped.md, a Markdown summary of the run for READMEs and PR
// descriptions. Pure string building in the --lang language, using the same "shown"
// helpers as the cards and the recap so the numbers agree. Never contains an email
// address: contributors appear by name only (contributorName), --author by its local
// part only (authorName), and email-shaped text in any repo-derived text (subjects,
// paths, repo and contributor names) is cut out by escapeMarkdown.

import { authorName, displayRepoName, formatDateRange, formatDay, conventionalText, pctText, repoRows, shownDayRange, sizeShareText } from './cards/index.js';
import { shownCommitSizes } from './stats/sizes.js';
import { shownCommitTypes } from './stats/types.js';
import { shownLongest, shownLongestBreak } from './stats/daily.js';
import { shownBiggestLines } from './stats/biggest.js';
import { contributorName, hasTeamCard, shareLabel } from './stats/contributors.js';
import { shownCoAuthors } from './stats/coauthors.js';
import { shownReleases } from './stats/releases.js';
import { scrubEmails } from './privacy.js';
import { languageBarRows, languageHeadline } from './stats/languages.js';
import { yearOverYear } from './stats/yoy.js';
import { getStrings, languageLabel } from './i18n/index.js';

/** How many hot files / languages / contributors the summary lists. */
export const MD_TOP = 5;

// C0 / C1 controls, bidi embedding / override / isolate controls and the line /
// paragraph separators (as in summary.js): never written into the file.
const CONTROL = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/**
 * Inline Markdown-significant ASCII punctuation, backslash-escaped (CommonMark lets any
 * of it be). Repo-derived text is only ever placed after a fixed prefix of ours (a list
 * label, a table "|", "# ", a quote mark), never at the start of a line, so block syntax
 * such as "1." or "- " cannot trigger and "." / "-" / "+" stay as they are; "#" is
 * escaped because a trailing run would close a heading, "$" because GitHub reads "$x$" as math.
 */
const SPECIAL = /[\\`*_{}[\]()#!|<>~&@$]/g;

/** U+2060 WORD JOINER: invisible, but keeps GitHub from reading "@user" / "#12" as a mention / reference. */
const WJ = '\u2060';

/** Keep at most `max` code points, ending in "…" when cut. */
function clip(s, max) {
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, max - 1).join('')}…`;
}

/**
 * `s` as inline Markdown text that renders literally: control / bidi characters become
 * spaces, whitespace runs collapse to one space (so it cannot start a new line, block or
 * table row), email addresses are replaced with "…", it is clipped to `max` code points,
 * every Markdown-significant character (including "|" for table cells) is
 * backslash-escaped, a word joiner follows each "@" and "#" (no GitHub @mention or #123
 * reference), and "://" / "www." are broken up so no URL becomes a link.
 */
export function escapeMarkdown(s, max = 200) {
  const flat = scrubEmails(String(s ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim());
  return clip(flat, max)
    .replace(SPECIAL, (c) => (c === '@' || c === '#' ? `\\${c}${WJ}` : `\\${c}`))
    // No autolinks either: "https://x.y" and "www.x.y" stay plain text.
    .replace(/:(?=\/\/)/g, '\\:')
    .replace(/(www)\./gi, '$1\\.');
}


const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** A whole number in the language's format; never "-0". */
function num(n, L) {
  const r = Math.round(finite(n));
  return L.num(r === 0 ? 0 : r);
}

/** "8 commits" / "8 commit" (`unit` a key of the table's `units`). */
function plural(n, unit, L) {
  const [one, many] = L.units[unit];
  return `${num(n, L)} ${n === 1 ? one : many}`;
}

/** "+12" / "−12"; 0 or anything not positive → "0". */
function signed(n, sign, L) {
  const s = num(finite(n) > 0 ? n : 0, L);
  return s === '0' ? s : `${sign}${s}`;
}

/** A "- **Label:** value" list item. */
const item = (label, value) => `- **${label}:** ${value}`;

/**
 * The Markdown summary of `stats` (computeStats() output) as a newline-terminated string.
 * Options:
 * - repoName: the repo's display name (a multi-repo run is named "N repos" instead)
 * - window: the requested date window, already formatted (windowLabel); without it the
 *   first – last active day is shown
 * - author: the --author value; only its name part (authorName) is shown, never the email
 * - today: 'YYYY-MM-DD'; future-dated days are left out of the streak, break and date
 *   range as on the cards (shownLongest, shownLongestBreak, shownDayRange)
 * - streakAtWindowEnd: the current streak is relative to a past window's end
 * - lang: an src/i18n code (default English)
 * - cards: [{id, file}] the card SVGs in order, `file` relative to the Markdown file
 *   (e.g. "cards/01-intro.svg"); linked as images at the end
 * Sections without data are left out (no habits / streak / hot files / languages section
 * for an empty history, no team section unless the contributors card is built, ...).
 */
export function buildMarkdown(stats, { repoName, window, author, today, streakAtWindowEnd = false, lang, cards = [] } = {}) {
  const L = getStrings(lang);
  const M = L.markdown;
  const out = [];
  const section = (title, lines) => {
    if (lines.length > 0) out.push('', `## ${title}`, '', ...lines);
  };
  const t = stats?.totals ?? {};
  const commits = finite(t.commits);

  const name = displayRepoName(stats, { repoName, lang });
  out.push(`# ${escapeMarkdown(M.title(name))}`);
  const range = shownDayRange(stats, today);
  const when = window || (commits > 0 ? formatDateRange(range.firstDay, range.lastDay, lang) : '');
  const who = authorName(author);
  const sub = [when && escapeMarkdown(when), who && escapeMarkdown(L.intro.starring(who))].filter(Boolean);
  if (sub.length > 0) out.push('', `_${sub.join(' · ')}_`);

  if (commits === 0) {
    out.push('', escapeMarkdown(M.noCommits));
  } else {
    // --- headline numbers -----------------------------------------------------------
    const numbers = [
      item(M.commits, num(commits, L)),
      item(L.totals.activeDays, num(t.activeDays, L)),
      item(M.lines, `${signed(t.linesAdded, '+', L)} / ${signed(t.linesRemoved, '−', L)}`),
      item(L.totals.filesTouched, num(t.filesTouched, L)),
    ];
    const yoy = yearOverYear(stats);
    if (yoy) numbers.push(item(escapeMarkdown(L.recap.vsYear(yoy.previousYear)), escapeMarkdown(L.yoy.changes(yoy.commits, yoy.lines, yoy.activeDays))));
    // The commit size mix, as on the totals card and the recap; only when there is one.
    const mix = shownCommitSizes(stats?.commitSizes);
    if (mix) numbers.push(item(escapeMarkdown(L.totals.commitSizes), escapeMarkdown(mix.map((b) => `${sizeShareText(b, mix, L)} ${L.recap.sizeNames[b.id]}`).join(' · '))));
    // The first commit in the window (stats.firstCommit), as on the intro card and the recap.
    const first = stats?.firstCommit;
    if (first && typeof first === 'object') {
      const subject = typeof first.subject === 'string' ? escapeMarkdown(first.subject, 120) : '';
      // A hex hash goes in a code span (GitHub does not link it there); anything else is escaped.
      const hash = typeof first.hash === 'string' && /^[0-9a-f]{1,40}$/i.test(first.hash) ? `\`${first.hash}\`` : escapeMarkdown(first.hash ?? '', 40);
      const day = formatDay(first.date, lang);
      const detail = [day && escapeMarkdown(day), hash, typeof first.repo === 'string' && escapeMarkdown(first.repo, 80)].filter(Boolean).join(' · ');
      numbers.push(item(escapeMarkdown(L.recap.firstCommit), `${subject ? `“${subject}”` : escapeMarkdown(L.messages.noSubject)}${detail ? ` (${detail})` : ''}`));
    }
    // Commits with a Co-authored-by co-author (stats.coAuthors), as on the cards and the recap.
    const paired = shownCoAuthors(stats?.coAuthors);
    if (paired) {
      const share = `${plural(paired.paired, 'commit', L)} (${L.recap.ofNonMerge(shareLabel(paired.share, paired.paired, L.pct))})`;
      const top = paired.top ? escapeMarkdown(M.topCoAuthor(paired.top), 120) : '';
      numbers.push(item(escapeMarkdown(M.paired), `${escapeMarkdown(share)}${top ? `, ${top}` : ''}`));
    }
    // Tags on the commits (stats.releases), as on the outro card and the recap.
    const rel = shownReleases(stats?.releases);
    if (rel) {
      const day = rel.latest ? formatDay(rel.latest.date, lang) : '';
      const latest = rel.latest ? `, ${escapeMarkdown(M.latestRelease(rel.latest.name), 120)}${day ? ` (${escapeMarkdown(day)})` : ''}` : '';
      numbers.push(item(escapeMarkdown(M.releases), `${escapeMarkdown(plural(rel.count, 'release', L))}${latest}`));
    }
    section(M.numbers, numbers);

    // --- habits -----------------------------------------------------------------------
    const h = stats?.habits ?? {};
    const habits = [];
    const tied = (x) => (x ? `, ${M.tied}` : '');
    if (Number.isInteger(h.peakHour) && h.peakHour >= 0 && h.peakHour < 24) {
      habits.push(item(L.recap.powerHour, `${L.hourLabel(h.peakHour)} (${plural(h.peakHourCount, 'commit', L)}${tied(h.peakHourTied)})`));
    }
    if (Number.isInteger(h.peakWeekday) && h.peakWeekday >= 0 && h.peakWeekday < 7) {
      habits.push(item(M.busiestDay, `${L.weekdays[h.peakWeekday]} (${plural(h.peakWeekdayCount, 'commit', L)}${tied(h.peakWeekdayTied)})`));
    }
    section(M.habits, habits);

    // --- streaks ----------------------------------------------------------------------
    const streaks = [];
    const longest = shownLongest(stats, today);
    if (finite(longest?.length) > 0) {
      const span = formatDateRange(longest.start, longest.end, lang);
      streaks.push(item(M.longestStreak, `${plural(longest.length, 'day', L)}${span ? ` (${escapeMarkdown(span)})` : ''}`));
      // Like the recap: only a running streak.
      const current = finite(stats?.streaks?.current?.length);
      if (current > 0) streaks.push(item(streakAtWindowEnd ? M.windowEndStreak : M.currentStreak, plural(current, 'day', L)));
    }
    const pause = shownLongestBreak(stats, today);
    if (Number.isInteger(pause?.days) && pause.days > 0) {
      const from = formatDay(pause.from, lang);
      const to = formatDay(pause.to, lang);
      streaks.push(item(M.longestBreak, `${plural(pause.days, 'day', L)}${from && to ? ` (${escapeMarkdown(`${from} – ${to}`)})` : ''}`));
    }
    section(M.streaks, streaks);

    // --- hot files --------------------------------------------------------------------
    const hot = (Array.isArray(stats?.hotFiles) ? stats.hotFiles : []).filter((f) => typeof f?.path === 'string' && f.path.trim()).slice(0, MD_TOP);
    if (hot.length > 0) {
      section(M.hotFiles, [
        `| # | ${M.file} | ${M.commits} | ${M.lines} |`,
        '|--:|:--|--:|--:|',
        ...hot.map((f, i) => `| ${i + 1} | ${escapeMarkdown(f.path)} | ${num(f.commits, L)} | ${signed(f.linesAdded, '+', L)} / ${signed(f.linesRemoved, '−', L)} |`),
      ]);
    }

    // --- languages --------------------------------------------------------------------
    const head = languageHeadline(stats?.languages);
    if (head) {
      // The same rows as the languages card's bars (languageBarRows).
      const basis = head.basis === 'files' ? 'files' : 'lines';
      const rows = languageBarRows(head, MD_TOP);
      section(M.languages, [
        `| ${M.language} | ${basis === 'files' ? L.languages.shareOfFiles : L.languages.shareOfLines} | ${basis === 'files' ? M.files : M.lines} |`,
        '|:--|--:|--:|',
        ...rows.map((r) => {
          const label = r.other ? L.languages.other : languageLabel(r.name, L);
          return `| ${escapeMarkdown(label, 60)} | ${escapeMarkdown(pctText(r.share, r.amount, L))} | ${num(r.amount, L)} |`;
        }),
      ]);
    }

    // --- team (exactly when the contributors card is built) ----------------------------
    if (hasTeamCard(stats)) {
      const c = stats.contributors;
      const youRank = Number.isInteger(c.you?.rank) ? c.you.rank : null;
      const rows = (Array.isArray(c.top) ? c.top : []).slice(0, MD_TOP).map((p) => {
        const person = contributorName(p?.name) ?? L.contributors.unknown;
        const label = p?.rank === youRank ? L.contributors.youName(person) : person;
        return `| ${num(p?.rank, L)} | ${escapeMarkdown(label, 80)} | ${num(p?.commits, L)} | ${escapeMarkdown(shareLabel(p?.share, p?.commits, L.pct))} |`;
      });
      const lines = [escapeMarkdown(`${plural(c.total, 'contributor', L)}`)];
      if (youRank && !(c.top ?? []).some((p) => p?.rank === youRank)) {
        lines.push('', escapeMarkdown(`${L.recap.youAre} #${num(youRank, L)} (${L.recap.ofCommits(shareLabel(c.you.share, c.you.commits, L.pct))})`));
      }
      if (rows.length > 0) lines.push('', `| # | ${M.contributor} | ${M.commits} | ${M.share} |`, '|--:|:--|--:|--:|', ...rows);
      section(L.contributors.eyebrow, lines);
    }

    // --- repos (a multi-repo run) -------------------------------------------------------
    const repos = repoRows(stats);
    if (repos) {
      section(L.recap.repos, [
        `| ${M.repo} | ${M.commits} | ${M.lines} |`,
        '|:--|--:|--:|',
        ...repos.map((r) => `| ${escapeMarkdown(r.name, 80)} | ${num(r.commits, L)} | ${signed(r.linesAdded, '+', L)} / ${signed(r.linesRemoved, '−', L)} |`),
      ]);
    }

    // --- biggest commit ---------------------------------------------------------------
    const big = stats?.biggestCommit;
    const bigLines = shownBiggestLines(big);
    if (bigLines) {
      const subject = typeof big.subject === 'string' ? escapeMarkdown(big.subject, 120) : '';
      const day = formatDay(big.date, lang);
      section(escapeMarkdown(L.messages.biggestTitle(day)), [
        `${subject ? `“${subject}”` : escapeMarkdown(L.messages.noSubject)} · ${signed(bigLines.added, '+', L)} / ${signed(bigLines.removed, '−', L)} ${M.linesWord}`,
      ]);
    }

    // --- commit types (as on the messages card and the recap; only when shown) ----------
    const types = shownCommitTypes(stats?.commitTypes);
    if (types) {
      const names = L.messages.typeNames;
      section(M.commitTypes, [
        escapeMarkdown(`${types.rows.map((r) => `${sizeShareText(r, types.rows, L)} ${names[r.id]}`).join(' · ')} (${L.recap.conventional(conventionalText(types, L))})`),
      ]);
    }

    // --- personality ------------------------------------------------------------------
    const a = stats?.personality?.archetype;
    if (a?.name || a?.id) {
      // Named from the string table by id (as the cards do); else stats' own English text.
      const local = typeof a.id === 'string' && Object.hasOwn(L.personality.archetypes, a.id) ? L.personality.archetypes[a.id] : null;
      const title = local ? local.name : a.name;
      const roast = local ? local.roast : a.roast;
      if (title) section(L.personality.eyebrow, [`**${escapeMarkdown(title, 80)}**${roast ? ` — ${escapeMarkdown(roast)}` : ''}`]);
    }
  }

  // --- the cards --------------------------------------------------------------------------
  const images = (Array.isArray(cards) ? cards : [])
    .filter((c) => typeof c?.file === 'string' && /^[\w./-]+$/.test(c.file))
    .map((c) => `![${escapeMarkdown(Object.hasOwn(M.cardNames, c.id) ? M.cardNames[c.id] : c.id)}](${c.file})`);
  section(M.cards, images);

  out.push('', `_${escapeMarkdown(M.footer)}_`);
  return `${out.join('\n')}\n`;
}
