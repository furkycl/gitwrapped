// The --md export: <out>/wrapped.md, a Markdown summary of the run for READMEs and PR
// descriptions. Pure string building in the --lang language, using the same "shown"
// helpers as the cards and the recap so the numbers agree. Never contains an email
// address: contributors appear by name only (contributorName), --author by its local
// part only (authorName), and email-shaped text in any repo-derived text (subjects,
// paths, repo and contributor names) is cut out by escapeMarkdown.

import { authorName, busFactorShareText, displayRepoName, folderLabel, cleanupShareText, formatDateRange, formatDay, conventionalText, emojiShareText, fixupShareText, issueRefsShareText, mergeShareText, pctText, revertShareText, repoRows, shownDayRange, sizeShareText, testsShareText } from './cards/index.js';
import { shownCommitSizes } from './stats/sizes.js';
import { shownCommitTypes } from './stats/types.js';
import { shownEmoji } from './stats/emoji.js';
import { shownReverts } from './stats/reverts.js';
import { shownCleanups } from './stats/cleanups.js';
import { issueRefLabel, shownIssueRefs } from './stats/issues.js';
import { shownFixups } from './stats/messages.js';
import { shownFileLifecycle } from './stats/files.js';
import { shownFolders } from './stats/folders.js';
import { shownTests } from './stats/tests.js';
import { shownCoChange } from './stats/cochange.js';
import { shownTimezones, utcLabel } from './stats/timezones.js';
import { shownWeekend, weekendPercentLabel } from './stats/weekend.js';
import { shownLateNights } from './stats/latenights.js';
import { shownOfficeHours } from './stats/officehours.js';
import { shownCadence } from './stats/cadence.js';
import { shownBusiestDay, shownLongest, shownLongestBreak } from './stats/daily.js';
import { shownBiggestLines } from './stats/biggest.js';
import { contributorName, contributorShare, exactPercent, hasTeamCard, shareLabel, shownBusFactor } from './stats/contributors.js';
import { shownCoAuthors } from './stats/coauthors.js';
import { shownReleases } from './stats/releases.js';
import { shownMerges } from './stats/merges.js';
import { scrubEmails } from './privacy.js';
import { languageBarRows, languageHeadline } from './stats/languages.js';
import { yearOverYear } from './stats/yoy.js';
import { previousPeriod } from './stats/period.js';
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
 * - today: 'YYYY-MM-DD'; future-dated days are left out of the busiest day, streak, break
 *   and date range as on the cards (shownBusiestDay, shownLongest, shownLongestBreak,
 *   shownDayRange)
 * - streakAtWindowEnd: the current streak is relative to a past window's end
 * - lang: an src/i18n code (default English)
 * - cards: [{id, file}] the card SVGs in order, `file` relative to the Markdown file
 *   (e.g. "cards/01-intro.svg"); linked as images at the end
 * A "Top folders" table (stats.folders: folder, lines added / removed, commits) follows the
 * hot files when there are two or more folders.
 * A "Test lines" item in the numbers ("1,234 lines (23% of lines changed)"; stats.tests,
 * see stats/tests.js shownTests) shows when at least one test line changed.
 * A "Changed together" item follows the hot-files table ("src/a.js + src/b.js (12
 * commits)"; stats.coChange, see stats/cochange.js shownCoChange) when a pair shares at
 * least 3 commits.
 * A "Bus factor" item ends the team section ("2 people (58% of lines changed)": the fewest
 * authors who made at least half of the lines changed; stats.contributors.busFactor, see
 * stats/contributors.js shownBusFactor) when there is one.
 * A "Cleanups" section follows the reverts ("12 commits (8% of non-merge commits); biggest:
 * “drop the old parser” · −4,210 lines (Mar 3, 2026)": the non-merge commits that removed
 * more lines than they added and the biggest net deletion; stats.cleanups, see
 * stats/cleanups.js shownCleanups) when there is at least one.
 * A "Fixup commits" section follows the reverts ("3 commits (2% of non-merge commits)":
 * the non-merge commits with a `fixup!` / `squash!` / `amend!` subject;
 * stats.messages.fixups, see stats/messages.js shownFixups) when there is at least one.
 * An "Issue references" section follows the cleanups ("42 commits (12% of non-merge
 * commits); most referenced: #128 (9 commits)": the non-merge commits whose subject
 * mentions an issue; stats.issueRefs, see stats/issues.js shownIssueRefs) when there is
 * at least one. The ref is escaped like all repo text, so "#128" is never a heading.
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
    // Files added, deleted and renamed in the window (stats.fileLifecycle), as in the recap; only with any.
    const lifecycle = shownFileLifecycle(stats?.fileLifecycle);
    if (lifecycle) numbers.push(item(escapeMarkdown(M.fileLifecycle), escapeMarkdown(M.fileLifecycleValue(lifecycle.added, lifecycle.deleted, lifecycle.renamed))));
    // Lines changed in test files and their share (stats.tests), as in the recap; only with any.
    const tests = shownTests(stats?.tests);
    if (tests) numbers.push(item(escapeMarkdown(M.tests), `${plural(tests.lines, 'line', L)} (${L.recap.ofLinesChanged(testsShareText(tests, L))})`));
    const yoy = yearOverYear(stats);
    if (yoy) numbers.push(item(escapeMarkdown(L.recap.vsYear(yoy.previousYear)), escapeMarkdown(L.yoy.changes(yoy.commits, yoy.lines, yoy.activeDays))));
    // --since: the change since the equal-length window before it (stats.previousPeriod).
    const pop = yoy ? null : previousPeriod(stats);
    if (pop) numbers.push(item(escapeMarkdown(L.recap.vsPeriod(pop.days)), escapeMarkdown(L.yoy.changes(pop.commits, pop.lines, pop.activeDays))));
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
      const share = `${plural(paired.paired, 'commit', L)} (${L.recap.ofNonMerge(shareLabel(exactPercent(paired), paired.paired, L.pct))})`;
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
    // Merged pull requests and merge commits (stats.merges), as on the totals card and the recap.
    const merges = shownMerges(stats?.merges);
    if (merges) numbers.push(item(escapeMarkdown(M.merges), escapeMarkdown(M.mergesValue(merges.pullRequests, merges.commits, mergeShareText(merges, L)))));
    section(M.numbers, numbers);

    // --- habits -----------------------------------------------------------------------
    const h = stats?.habits ?? {};
    const habits = [];
    const tied = (x) => (x ? `, ${M.tied}` : '');
    if (Number.isInteger(h.peakHour) && h.peakHour >= 0 && h.peakHour < 24) {
      habits.push(item(L.recap.powerHour, `${L.hourLabel(h.peakHour)} (${plural(h.peakHourCount, 'commit', L)}${tied(h.peakHourTied)})`));
    }
    if (Number.isInteger(h.peakWeekday) && h.peakWeekday >= 0 && h.peakWeekday < 7) {
      habits.push(item(M.busiestWeekday, `${L.weekdays[h.peakWeekday]} (${plural(h.peakWeekdayCount, 'commit', L)}${tied(h.peakWeekdayTied)})`));
    }
    // The calendar day with the most commits over the whole window, as in the recap
    // (future-dated days left out with `today`). The activity card's busiest day is that of
    // its 53-week grid, so on a longer history it can differ.
    const busiest = shownBusiestDay(stats, today);
    const busiestOn = busiest ? formatDay(busiest.day, lang) : null;
    if (busiestOn) habits.push(item(M.busiestDay, `${escapeMarkdown(busiestOn)} (${plural(busiest.commits, 'commit', L)})`));
    // Commits from two or more time zones (stats.timezones), as in the recap.
    const tz = shownTimezones(stats?.timezones);
    if (tz) {
      const top = tz.top ? ` (${L.recap.mostly(utcLabel(tz.top))}, ${L.recap.ofCommits(shareLabel(exactPercent(tz), tz.commits, L.pct))})` : '';
      habits.push(item(L.recap.timezones, `${L.recap.timezonesValue(tz.count)}${top}`));
    }
    // Commits on an author-local Saturday or Sunday (stats.weekend), as in the recap.
    const weekend = shownWeekend(stats);
    if (weekend) habits.push(item(M.weekend, `${plural(weekend.commits, 'commit', L)} (${L.recap.ofCommits(weekendPercentLabel(weekend.percent, L.pct))})`));
    // Commits between 00:00 and 04:59 author-local (stats.lateNights) and the latest-ever
    // commit time, as in the recap.
    const late = shownLateNights(stats);
    if (late) {
      const on = late.latest ? formatDay(late.latest.date, lang) : null;
      const latest = on ? `, ${M.latestAt(L.clock(late.latest.hour, late.latest.minute), escapeMarkdown(on))}` : '';
      habits.push(item(M.lateNights, `${plural(late.commits, 'commit', L)} (${L.recap.ofCommits(weekendPercentLabel(late.percent, L.pct))})${latest}`));
    }
    // Weekday commits between 09:00 and 17:59 author-local (stats.officeHours), as in the recap.
    const office = shownOfficeHours(stats);
    if (office) habits.push(item(M.officeHours, `${plural(office.commits, 'commit', L)} (${L.recap.ofCommits(weekendPercentLabel(office.percent, L.pct))})`));
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
    // Commits per active day and the median gap between active days, as in the recap.
    const cadence = shownCadence(stats, today);
    if (cadence) streaks.push(item(M.cadence, escapeMarkdown(`${L.streak.cadencePerDay(cadence.perActiveDay)} · ${L.streak.cadenceEvery(cadence.medianGapDays)}`)));
    section(M.streaks, streaks);

    // --- hot files --------------------------------------------------------------------
    const hot = (Array.isArray(stats?.hotFiles) ? stats.hotFiles : []).filter((f) => typeof f?.path === 'string' && f.path.trim()).slice(0, MD_TOP);
    // The two files changed together in the most non-merge commits (stats.coChange), as in
    // the recap, after the table; only when a pair shares 3+ commits.
    const pair = shownCoChange(stats?.coChange);
    // Left out when the two paths would read alike (scrubbed or clipped to the same text).
    const shown = pair ? pair.files.map((p) => escapeMarkdown(p)) : [];
    const together = pair && shown[0] !== shown[1] ? [item(escapeMarkdown(M.coChange), `${shown[0]} + ${shown[1]} (${plural(pair.commits, 'commit', L)})`)] : [];
    if (hot.length > 0) {
      section(M.hotFiles, [
        `| # | ${M.file} | ${M.commits} | ${M.lines} |`,
        '|--:|:--|--:|--:|',
        ...hot.map((f, i) => `| ${i + 1} | ${escapeMarkdown(f.path)} | ${num(f.commits, L)} | ${signed(f.linesAdded, '+', L)} / ${signed(f.linesRemoved, '−', L)} |`),
        ...(together.length > 0 ? ['', ...together] : []),
      ]);
    } else {
      section(M.hotFiles, together);
    }

    // --- top folders (stats.folders, two or more) -------------------------------------
    const folders = shownFolders(stats?.folders);
    if (folders) {
      section(M.topFolders, [
        `| # | ${M.folder} | ${M.lines} | ${M.commits} |`,
        '|--:|:--|--:|--:|',
        ...folders.slice(0, MD_TOP).map((f, i) => `| ${i + 1} | ${escapeMarkdown(folderLabel(f, L))} | ${signed(f.added, '+', L)} / ${signed(f.deleted, '−', L)} | ${num(f.commits, L)} |`),
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
        return `| ${num(p?.rank, L)} | ${escapeMarkdown(label, 80)} | ${num(p?.commits, L)} | ${escapeMarkdown(shareLabel(contributorShare(p), p?.commits, L.pct))} |`;
      });
      const lines = [escapeMarkdown(`${plural(c.total, 'contributor', L)}`)];
      if (youRank && !(c.top ?? []).some((p) => p?.rank === youRank)) {
        lines.push('', escapeMarkdown(`${L.recap.youAre} #${num(youRank, L)} (${L.recap.ofCommits(shareLabel(contributorShare(c.you), c.you.commits, L.pct))})`));
      }
      if (rows.length > 0) lines.push('', `| # | ${M.contributor} | ${M.commits} | ${M.share} |`, '|--:|:--|--:|--:|', ...rows);
      // The fewest authors who made half the lines changed (contributors.busFactor), as in the recap.
      const bus = shownBusFactor(c.busFactor);
      if (bus) lines.push('', item(escapeMarkdown(M.busFactor), `${L.recap.busFactorValue(bus.authors)} (${L.recap.ofLinesChanged(busFactorShareText(bus, L))})`));
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

    // --- emoji (as on the messages card and the recap; only when shown) ----------------
    const emoji = shownEmoji(stats?.emoji);
    if (emoji) {
      // The emoji are single validated clusters: only a keycap's "#" / "*" needs escaping
      // (a word joiner, as escapeMarkdown adds after "#", would break the keycap).
      const top = emoji.top.map((t) => `${t.emoji.replace(/[#*]/g, '\\$&')} ${num(t.count, L)}`).join(' · ');
      const share = escapeMarkdown(L.messages.emojiShare(emojiShareText(emoji, L)));
      section(M.emoji, [top ? `${share}: ${top}` : share]);
    }

    // --- reverts (as on the messages card and the recap; only with any) -----------------
    const reverts = shownReverts(stats?.reverts);
    if (reverts) section(M.reverts, [escapeMarkdown(`${plural(reverts.count, 'commit', L)} (${L.recap.ofNonMerge(revertShareText(reverts, L))})`)]);

    // --- fixup commits (as on the messages card and the recap; only with any) ----------
    const fixups = shownFixups(stats?.messages?.fixups);
    if (fixups) section(M.fixups, [escapeMarkdown(`${plural(fixups.commits, 'commit', L)} (${L.recap.ofNonMerge(fixupShareText(fixups, L))})`)]);

    // --- cleanups (as on the totals card and the recap; only with any) ------------------
    const cleanups = shownCleanups(stats?.cleanups);
    if (cleanups) {
      const b = cleanups.biggest;
      const count = escapeMarkdown(`${plural(cleanups.commits, 'commit', L)} (${L.recap.ofNonMerge(cleanupShareText(cleanups, L))})`);
      let biggest = '';
      if (b) {
        const subject = b.subject ? escapeMarkdown(b.subject, 120) : '';
        const day = formatDay(b.date, lang);
        biggest = `; ${escapeMarkdown(M.biggestCleanup)} ${subject ? `“${subject}”` : escapeMarkdown(L.messages.noSubject)} · ${signed(b.net, '−', L)} ${M.linesWord}${day ? ` (${escapeMarkdown(day)})` : ''}`;
      }
      section(M.cleanups, [`${count}${biggest}`]);
    }

    // --- issue references (as on the messages card and the recap; only with any) ------
    const issues = shownIssueRefs(stats?.issueRefs);
    if (issues) {
      const t = issues.top;
      const top = t ? `; ${M.topIssue} ${issueRefLabel(t)} (${plural(t.commits, 'commit', L)})` : '';
      section(M.issueRefs, [escapeMarkdown(`${plural(issues.commits, 'commit', L)} (${L.recap.ofNonMerge(issueRefsShareText(issues, L))})${top}`)]);
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
