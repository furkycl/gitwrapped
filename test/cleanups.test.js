// Cleanup commits (src/stats/cleanups.js, stats.cleanups): non-merge commits that remove
// more lines than they add, over the hot-files file set. Unit cases (merges, ignored
// files, thresholds, ties, null cases, malformed input, rounding), the totals card rows
// (present / absent, byte-identical without them, en / tr), the recap, wrapped.md, and one
// end-to-end run of the CLI on a temporary git repo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCleanups, computeStats as computeAllStats, shownCleanups } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cleanupShareText } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out (and the top words row
// after it, stats.messages.topWords, see test/top-words.test.js).
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
};

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, added, removed, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `chore: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added, removed }],
  parents: ['p'],
  ...extra,
});
const stats = (commits) => computeStats(commits, { today: TODAY });
const totalsSpec = (s, lang = 'en') => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
const totalsSvg = (s, lang = 'en') => buildCards(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').svg;
const EN = getStrings('en');
const TR = getStrings('tr');
const countRow = (spec, L = EN) => (spec.lines ?? []).find((r) => r.label === L.totals.cleanups);
const biggestRow = (spec, L = EN) => (spec.lines ?? []).find((r) => r.label === L.totals.biggestCleanup);

describe('computeCleanups', () => {
  test('counts non-merge commits that remove more than they add; share of non-merge commits; biggest net deletion', () => {
    const commits = [commit(1, 100, 5), commit(2, 3, 50, { subject: 'chore: drop old code' }), commit(3, 10, 20), commit(4, 50, 1)];
    const c = computeCleanups(commits);
    assert.deepEqual(c, {
      commits: 2,
      share: 0.5,
      biggest: { hash: H(2), subject: 'chore: drop old code', date: '2026-03-03', linesAdded: 3, linesRemoved: 50, net: 47 },
    });
    // Exactly {commits, share, biggest} in JSON: the exact ratio is non-enumerable.
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(c))), ['commits', 'share', 'biggest']);
  });

  test('merge commits never count, neither as cleanups nor in the share', () => {
    const merge = commit(1, 0, 500, { parents: ['p', 'q'] });
    const c = computeCleanups([merge, commit(2, 1, 2), commit(3, 5, 1)]);
    assert.equal(c.commits, 1);
    assert.equal(c.share, 0.5);
    assert.equal(c.biggest.net, 1);
    // Only merges → null; no parents but a git "Merge …" subject is a merge too.
    assert.equal(computeCleanups([merge]), null);
    assert.equal(computeCleanups([{ ...commit(4, 0, 9), parents: undefined, subject: "Merge branch 'x'" }]), null);
  });

  test('ignored files (lockfiles, build output, vendored, minified) add nothing; multi-repo paths checked from the repo root', () => {
    const lock = { ...commit(1, 2, 1), files: [{ path: 'src/a.js', added: 2, removed: 1 }, { path: 'package-lock.json', added: 0, removed: 900 }, { path: 'dist/app.js', added: 0, removed: 50 }] };
    assert.equal(computeCleanups([lock]), null);
    // Only ignored files → 0 counted lines → not a cleanup.
    assert.equal(computeCleanups([{ ...commit(2, 0, 0), files: [{ path: 'yarn.lock', added: 0, removed: 99 }] }]), null);
    // A repo labelled "vendor": its own files are not vendored code; its dist/ is ignored.
    const multi = [
      { ...commit(3, 0, 0), repo: 'vendor', files: [{ path: 'vendor/a.js', added: 1, removed: 7 }] },
      { ...commit(4, 0, 0), repo: 'app', files: [{ path: 'app/dist/x.js', added: 0, removed: 100 }] },
    ];
    const c = computeCleanups(multi);
    assert.equal(c.commits, 1);
    assert.equal(c.biggest.net, 6);
    assert.equal(c.share, 0.5);
  });

  test('threshold: removed must be strictly more than added; 0 counted lines is not a cleanup', () => {
    assert.equal(computeCleanups([commit(1, 5, 5)]), null);
    assert.equal(computeCleanups([commit(1, 0, 0)]), null);
    assert.equal(computeCleanups([{ ...commit(1, 0, 0), files: [] }]), null);
    assert.deepEqual(computeCleanups([commit(1, 5, 6)]).biggest.net, 1);
    // Several files are summed before comparing.
    const mixed = { ...commit(2, 0, 0), files: [{ path: 'a.js', added: 10, removed: 0 }, { path: 'b.js', added: 0, removed: 9 }] };
    assert.equal(computeCleanups([mixed]), null);
  });

  test('ties: earliest by date; undated after dated; same instant → the later one in input order', () => {
    const a = commit(5, 0, 10, { subject: 'later' });
    const b = commit(2, 0, 10, { subject: 'earlier' });
    assert.equal(computeCleanups([a, b]).biggest.subject, 'earlier');
    assert.equal(computeCleanups([b, a]).biggest.subject, 'earlier');
    const undated = commit(1, 0, 10, { date: 'nope', subject: 'undated' });
    assert.equal(computeCleanups([undated, a]).biggest.subject, 'later');
    assert.equal(computeCleanups([undated]).biggest.date, null);
    const same1 = commit(3, 0, 10, { subject: 'newer in git order' });
    const same2 = commit(3, 0, 10, { subject: 'older in git order' });
    assert.equal(computeCleanups([same1, same2]).biggest.subject, 'older in git order');
    // A strictly bigger net deletion wins over an earlier date.
    assert.equal(computeCleanups([commit(9, 0, 11, { subject: 'big' }), b]).biggest.subject, 'big');
  });

  test('null cases and malformed input: never throws, never mutates', () => {
    assert.equal(computeCleanups([]), null);
    assert.equal(computeCleanups(undefined), null);
    assert.equal(computeCleanups('x'), null);
    assert.equal(computeCleanups([null, 1, 'x', {}]), null);
    const junk = [
      { ...commit(1, 0, 0), files: 'nope' },
      { ...commit(2, 0, 0), files: [null, 3, { path: 7, removed: 100 }, { path: 'a.js', added: 'x', removed: Infinity }, { path: 'b.js', added: -5, removed: NaN }] },
      { ...commit(3, 0, 0), files: [{ path: 'c.js', added: undefined, removed: 4 }] },
    ];
    const frozen = JSON.stringify(junk);
    const c = computeCleanups(junk);
    assert.equal(JSON.stringify(junk), frozen);
    assert.equal(c.commits, 1);
    assert.equal(c.share, 0.333);
    assert.deepEqual({ ...c.biggest, hash: null }, { hash: null, subject: 'chore: change 3', date: '2026-03-04', linesAdded: 0, linesRemoved: 4, net: 4 });
    // Every non-merge commit is in the share, also those with no counted line.
    assert.equal(computeCleanups([commit(1, 0, 3), { ...commit(2, 0, 0), files: undefined }]).share, 0.5);
  });

  test('subject: trimmed, emails scrubbed, empty → null; hash null when not a string', () => {
    const c = computeCleanups([commit(1, 0, 3, { subject: '  drop ada@example.com keys  ', hash: 42 })]);
    assert.equal(c.biggest.subject, 'drop … keys');
    assert.equal(c.biggest.hash, null);
    assert.equal(computeCleanups([commit(1, 0, 3, { subject: '   ' })]).biggest.subject, null);
    assert.equal(computeCleanups([commit(1, 0, 3, { subject: undefined })]).biggest.subject, null);
  });

  test('share: 3 decimals, capped at 0.999 short of all, 1 only when all; the shown percent rounds once', () => {
    const many = (n, cleanups) => Array.from({ length: n }, (_, i) => (i < cleanups ? commit(i, 0, 2) : commit(i, 2, 0)));
    assert.equal(computeCleanups(many(3, 3)).share, 1);
    assert.equal(cleanupShareText(shownCleanups(computeCleanups(many(3, 3)))), '100%');
    const almost = computeCleanups(many(2000, 1999));
    assert.equal(almost.share, 0.999);
    assert.equal(cleanupShareText(shownCleanups(almost)), '99%');
    // 45 of 10,000: share 0.005 (rounded), but the exact 0.45% shows as "<1%" (not "1%").
    const few = computeCleanups(many(10000, 45));
    assert.equal(few.share, 0.005);
    assert.equal(cleanupShareText(shownCleanups(few)), '<1%');
    // A JSON copy has no exact ratio: the share is used.
    assert.equal(cleanupShareText(shownCleanups(JSON.parse(JSON.stringify(few)))), '1%');
    // Tiny shares are "<1%", never "0%".
    assert.equal(cleanupShareText(shownCleanups(computeCleanups(many(2001, 1)))), '<1%');
    assert.equal(cleanupShareText(shownCleanups(computeCleanups(many(2001, 1))), TR), '<%1');
  });

  test('computeStats: stats.cleanups right after reverts', () => {
    const keys = Object.keys(stats([commit(1, 0, 2)]));
    assert.equal(keys[keys.indexOf('reverts') + 1], 'cleanups');
    assert.equal(stats([]).cleanups, null);
    assert.equal(stats([commit(1, 3, 2)]).cleanups, null);
  });
});

describe('shownCleanups', () => {
  test('null for missing / malformed values; biggest null without a positive net', () => {
    for (const v of [null, undefined, 0, 'x', {}, { commits: 0 }, { commits: -3 }, { commits: NaN }]) assert.equal(shownCleanups(v), null, JSON.stringify(v));
    assert.deepEqual(shownCleanups({ commits: 2, share: 0.5 }), { commits: 2, pct: 50, biggest: null });
    assert.equal(shownCleanups({ commits: 2, share: 0.5, biggest: { net: 0 } }).biggest, null);
    assert.equal(shownCleanups({ commits: 2, share: 0.5, biggest: 'x' }).biggest, null);
    assert.deepEqual(shownCleanups({ commits: 2.4, share: 7, biggest: { net: 9.6, subject: ' a@b.io ', date: 5 } }), { commits: 2, pct: 99.9, biggest: { subject: '…', date: null, net: 10 } });
    assert.equal(shownCleanups({ commits: 2, share: 'x' }).pct, 0);
  });
});

describe('totals card rows', () => {
  const base = [commit(1, 100, 5), commit(2, 3, 50, { subject: 'chore: drop old code' }), commit(3, 10, 20), commit(4, 50, 1)];

  test('en: "Cleanups 2 commits · 50%" then "Biggest cleanup" with the net deletion and the day; drawn whole', () => {
    const spec = totalsSpec(stats(base));
    const row = countRow(spec);
    assert.ok(row, JSON.stringify(spec.lines));
    assert.equal(row.value, '2 commits · 50%');
    assert.match(row.description, /2 commits removed more lines than they added \(50% of non-merge commits\)/);
    const big = biggestRow(spec);
    assert.ok(big);
    assert.ok(['−47 lines · Mar 3, 2026', '−47 lines · Mar 3', '−47 · Mar 3', '−47 lines'].includes(big.value), big.value);
    assert.match(big.description, /Biggest cleanup: −47 lines on Mar 3, 2026, “chore: drop old code”/);
    assert.ok(rowFits(row) && rowFits(big));
    // After every other row, count first.
    assert.equal(spec.lines.indexOf(big), spec.lines.indexOf(row) + 1);
    assert.equal(spec.lines.at(-1), big);
    const svg = totalsSvg(stats(base));
    assert.ok(svg.includes('Cleanups') && svg.includes('2 commits · 50%') && svg.includes('Biggest cleanup'));
  });

  test('tr: "Temizlikler" and "En büyük temizlik"', () => {
    const spec = totalsSpec(stats(base), 'tr');
    assert.equal(countRow(spec, TR)?.value, '2 commit · %50');
    const big = biggestRow(spec, TR);
    assert.ok(big && /^−47/.test(big.value), JSON.stringify(spec.lines));
    assert.match(big.description, /En büyük temizlik: 3 Mar 2026 günü −47 satır, “chore: drop old code”/);
    assert.ok(totalsSvg(stats(base), 'tr').includes('Temizlikler'));
  });

  test('byte-identical cards without cleanups: null, absent, or junk', () => {
    const s = stats(base);
    const without = { ...s, cleanups: null };
    const absent = { ...s };
    delete absent.cleanups;
    for (const lang of ['en', 'tr']) {
      const ref = buildCards(without, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg);
      assert.deepEqual(buildCards(absent, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg), ref);
      assert.deepEqual(buildCards({ ...s, cleanups: { commits: 0 } }, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg), ref);
      assert.ok(!ref.some((svg) => svg.includes('Cleanups') || svg.includes('Temizlikler')));
      // Only the totals card changes with cleanups.
      const withRows = buildCards(s, { repoName: 'demo', today: TODAY, lang });
      withRows.forEach((c, i) => (c.id === 'totals' ? assert.notEqual(c.svg, ref[i]) : assert.equal(c.svg, ref[i], c.id)));
    }
  });

  test('a count row that would be cut → no rows at all (card unchanged); no biggest → only the count row', () => {
    const s = stats(base);
    const huge = { ...s, cleanups: { commits: 1e15, share: 0.5, biggest: { net: 4, date: '2026-03-03', subject: 'x' } } };
    assert.equal(totalsSvg(huge), totalsSvg({ ...s, cleanups: null }));
    const noBig = totalsSpec({ ...s, cleanups: { commits: 3, share: 0.5, biggest: null } });
    assert.ok(countRow(noBig));
    assert.equal(biggestRow(noBig), undefined);
    // Without a known day the value is the line count alone.
    const noDay = totalsSpec({ ...s, cleanups: { commits: 3, share: 0.5, biggest: { net: 1234, date: null, subject: null } } });
    assert.equal(biggestRow(noDay)?.value, '−1,234 lines');
    assert.equal(biggestRow(noDay).description, 'Biggest cleanup: −1,234 lines');
  });

  test('no room on the totals card → the messages card gets the rows (never both); no room there either → unchanged', () => {
    const s = stats(base);
    // The size mix and four rows leave no spare room on the totals card.
    const full = { ...s, fileLifecycle: { added: 3, deleted: 1 }, merges: { commits: 2, share: 0.3, pullRequests: 0 } };
    const specs = buildCardSpecs(full, { repoName: 'demo', today: TODAY });
    const totals = specs.find((c) => c.id === 'totals').spec;
    const messages = specs.find((c) => c.id === 'messages').spec;
    const onTotals = Boolean(countRow(totals));
    assert.equal(onTotals, false, JSON.stringify(totals.lines));
    assert.equal(Boolean(countRow(messages)), !onTotals);
    if (!onTotals) {
      assert.equal(messages.lines.at(-1)?.label === EN.totals.biggestCleanup || messages.lines.at(-1)?.label === EN.totals.cleanups, true);
      assert.ok(messages.lines.length <= 6);
    }
    // A messages card with nothing to show (no subjects) never gets them.
    const none = { ...full, messages: {} };
    const ref = buildCards({ ...none, cleanups: null }, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages').svg;
    if (!onTotals) assert.equal(buildCards(none, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages').svg, ref);
  });

  test('placement: both rows on one card when either takes both; else the count row alone (totals first); never on both', () => {
    const s = stats(base);
    const at = (st) => {
      const specs = buildCardSpecs(st, { repoName: 'demo', today: TODAY });
      const rows = (id) => (specs.find((c) => c.id === id).spec.lines ?? []).filter((r) => r.label === EN.totals.cleanups || r.label === EN.totals.biggestCleanup).map((r) => r.label);
      return { totals: rows('totals'), messages: rows('messages') };
    };
    // A merges row leaves the totals card room for the count row only: alone it goes there…
    const tight = { ...s, merges: { commits: 2, share: 0.3, pullRequests: 0 } };
    assert.deepEqual(at({ ...tight, cleanups: { ...s.cleanups, biggest: null } }), { totals: [EN.totals.cleanups], messages: [] });
    // …but with a biggest cleanup both rows go on the messages card, which takes both.
    assert.deepEqual(at(tight), { totals: [], messages: [EN.totals.cleanups, EN.totals.biggestCleanup] });
    // No messages rows (no subjects): the count row alone on totals, as before.
    assert.deepEqual(at({ ...tight, messages: {} }), { totals: [EN.totals.cleanups], messages: [] });
    // Room for both on totals: totals.
    assert.deepEqual(at(s), { totals: [EN.totals.cleanups, EN.totals.biggestCleanup], messages: [] });
  });

  test('messages card: the folded fix / wip / oops layout wins when only it takes both rows', () => {
    const s = stats(base);
    // A full totals card (pairing, born / buried, merges) and a two-row message pair.
    const full = {
      ...s,
      fileLifecycle: { added: 3, deleted: 1 },
      merges: { commits: 2, share: 0.3, pullRequests: 0 },
      coAuthors: { paired: 3, total: 4, share: 0.5, top: 'Bo', coAuthors: [] },
      messages: { ...s.messages, longest: { subject: 'short' }, shortest: { subject: 'y' } },
    };
    const msg = (st) => buildCardSpecs(st, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages').spec;
    // The count row alone fits unfolded (the three counters stay)…
    const one = msg({ ...full, cleanups: { ...s.cleanups, biggest: null } });
    assert.ok(one.lines.some((r) => r.label === EN.messages.fixCommits));
    assert.equal(one.lines.at(-1).label, EN.totals.cleanups);
    // …both rows only with the counters folded: the folded layout is used.
    const both = msg(full);
    assert.ok(!both.lines.some((r) => r.label === EN.messages.fixCommits));
    assert.ok(both.lines.some((r) => r.label === EN.messages.counterCommits));
    assert.deepEqual(both.lines.slice(-2).map((r) => r.label), [EN.totals.cleanups, EN.totals.biggestCleanup]);
    assert.equal(buildCardSpecs(full, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'totals').spec.lines.some((r) => r.label === EN.totals.cleanups), false);
    assert.ok(both.lines.length <= 6);
  });

  test('the rows only use spare room: never more than 6 rows, and no other block changes', () => {
    const s = stats(base);
    // Fill the card: contributors, files born / buried, merges, pairing.
    const full = {
      ...s,
      totals: { ...s.totals, authors: 3 },
      fileLifecycle: { added: 3, deleted: 1 },
      merges: { commits: 2, share: 0.3, pullRequests: 4 },
      yearOverYear: s.yearOverYear,
    };
    for (const lang of ['en', 'tr']) {
      const spec = totalsSpec(full, lang);
      assert.ok(spec.lines.length <= 6);
      const without = totalsSpec({ ...full, cleanups: null }, lang);
      assert.deepEqual(spec.lines.slice(0, without.lines.length), without.lines);
      assert.equal(spec.big, without.big);
      assert.deepEqual(spec.chart, without.chart);
    }
  });
});

describe('recap and wrapped.md', () => {
  const s = stats([commit(1, 100, 5), commit(2, 3, 50, { subject: 'chore: drop *old* | [code] #12' }), commit(3, 10, 20), commit(4, 50, 1)]);

  test('recap en / tr', () => {
    const en = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(en, /\n {2}Cleanups {5}2 commits \(50% of non-merge commits\) · biggest "chore: drop \*old\* \| \[code\] #12" \(−47 lines · Mar 3, 2026\)\n/);
    const tr = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(tr, /Temizlikler +2 commit \(merge dışı commit'lerin %50 kadarı\) · en büyüğü "chore: drop \*old\* \| \[code\] #12" \(−47 satır · 3 Mar 2026\)/);
    assert.doesNotMatch(formatSummary({ ...s, cleanups: null }, { repoName: 'demo', today: TODAY }), /Cleanups/);
    // No biggest / no subject / no day.
    const bare = formatSummary({ ...s, cleanups: { commits: 3, share: 0.1 } }, { repoName: 'demo', today: TODAY });
    assert.match(bare, /Cleanups {5}3 commits \(10% of non-merge commits\)\n/);
    const noSubject = formatSummary({ ...s, cleanups: { commits: 3, share: 0.1, biggest: { net: 5, subject: null, date: 'bad' } } }, { repoName: 'demo', today: TODAY });
    assert.match(noSubject, /biggest \(no subject\) \(−5 lines\)/);
    // Control characters in the subject never reach the terminal.
    const evil = formatSummary({ ...s, cleanups: { commits: 1, share: 0.1, biggest: { net: 5, subject: 'a\x1b[31mb', date: null } } }, { repoName: 'demo', today: TODAY });
    assert.ok(!evil.includes('\x1b'));
  });

  test('wrapped.md en / tr, subject escaped', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.ok(md.includes('\n## Cleanups\n\n2 commits \\(50% of non-merge commits\\); biggest: “chore: drop \\*old\\* \\| \\[code\\] \\#\u2060' + '12” · −47 lines (Mar 3, 2026)\n'), md);
    // After the reverts section's place, before the personality.
    assert.ok(md.indexOf('## Cleanups') < md.indexOf('## Your commit personality') || !md.includes('## Your commit personality'));
    const tr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.ok(tr.includes('\n## Temizlikler\n\n2 commit \\(merge dışı commit\'lerin %50 kadarı\\); en büyüğü: “chore: drop'), tr);
    assert.ok(tr.includes('−47 satır (3 Mar 2026)'));
    assert.ok(!buildMarkdown({ ...s, cleanups: null }, { repoName: 'demo', today: TODAY }).includes('Cleanups'));
    const noSubject = buildMarkdown({ ...s, cleanups: { commits: 3, share: 0.1, biggest: { net: 5, subject: null, date: null } } }, { repoName: 'demo', today: TODAY });
    assert.ok(noSubject.includes('3 commits \\(10% of non-merge commits\\); biggest: \\(no subject\\) · −5 lines\n'), noSubject);
  });
});

describe('end to end (a real repo via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const base = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...ADA, ...extra } });
  let root;
  let repo;
  let day = 1;
  const at = () => {
    const d = `2025-04-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + (n > 0 ? '\n' : '');
  const write = (path, n, tag) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), lines(n, tag));
  };
  const commitAll = (msg) => {
    git(repo, ['add', '-A', '-f']);
    git(repo, ['commit', '-q', '-m', msg], at());
  };
  let n = 0;
  const run = (args) => {
    const out = join(root, `out${n++}`);
    const res = spawnSync(process.execPath, [BIN, repo, ...args, '--out', out, '--no-png', '--no-color', '--json', '--md'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const card = (id) => readFileSync(join(out, 'cards', readdirSync(join(out, 'cards')).find((f) => f.endsWith(`${id}.svg`))), 'utf8');
    // The rows go on the totals card, else on the messages card (never both).
    return { stdout: res.stdout, cleanups: json.stats.cleanups, md, totals: card('totals'), messages: card('messages'), svg: card('totals') + card('messages') };
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-cleanups-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    // 1: add code, docs and a lockfile.
    write('src/app.js', 100, 'a');
    write('docs/guide.md', 40, 'd');
    write('package-lock.json', 300, 'l');
    commitAll('feat: start');
    // 2: a cleanup: 100 → 30 lines in src/app.js (−70).
    write('src/app.js', 30, 'a');
    commitAll('refactor: drop the old parser (ada@example.com)');
    // 3: the lockfile shrinks a lot: ignored, so not a cleanup.
    write('package-lock.json', 10, 'l');
    write('src/app.js', 31, 'a');
    commitAll('chore: lockfile');
    // 4: docs shrink 40 → 0 (−40): a cleanup, unless --exclude docs/.
    write('docs/guide.md', 0, 'd');
    commitAll('docs: trim the guide');
    // 5: a side branch merged with a deletion in the merge itself: never counted.
    git(repo, ['checkout', '-q', '-b', 'side']);
    write('src/side.js', 5, 's');
    commitAll('feat: side');
    git(repo, ['checkout', '-q', 'main']);
    write('src/main.js', 5, 'm');
    commitAll('feat: main');
    git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'side']);
    write('src/app.js', 0, 'a');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', "Merge branch 'side'"], at());
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, recap, wrapped.md and the totals card', () => {
    const r = run([]);
    // Non-merge commits: start, drop, lockfile, docs, side, main = 6; cleanups: drop, docs.
    assert.equal(r.cleanups.commits, 2);
    assert.equal(r.cleanups.share, 0.333);
    const { hash, ...big } = r.cleanups.biggest;
    assert.match(hash, /^[0-9a-f]{40}$/);
    assert.deepEqual(big, { subject: 'refactor: drop the old parser (…)', date: '2025-04-02', linesAdded: 0, linesRemoved: 70, net: 70 });
    assert.match(r.stdout, /Cleanups {5}2 commits \(33% of non-merge commits\) · biggest "refactor: drop the old parser \(…\)" \(−70 lines · Apr 2, 2025\)/);
    assert.ok(r.md.includes('## Cleanups\n\n2 commits \\(33% of non-merge commits\\); biggest: “refactor: drop the old parser \\(…\\)” · −70 lines (Apr 2, 2025)'), r.md);
    // This history fills the totals card (born / buried, merges, the size mix), so the rows
    // go on the messages card, with the fix / wip / oops counts folded to make room.
    assert.ok(!r.totals.includes('Cleanups'));
    assert.ok(r.messages.includes('Cleanups') && r.messages.includes('2 commits · 33%'), 'count row on the messages card');
    assert.ok(r.messages.includes('Biggest cleanup') && r.messages.includes('−70 lines · Apr 2'));
    assert.ok(!r.stdout.includes('ada@example.com') && !r.md.includes('ada@example.com'));
  });

  test('--exclude drops files first: docs/ excluded → one cleanup; src/ too → null and nothing shown', () => {
    const r = run(['--exclude', 'docs/']);
    assert.equal(r.cleanups.commits, 1);
    assert.equal(r.cleanups.share, 0.167);
    const r2 = run(['--exclude', 'docs/', '--exclude', 'src/']);
    assert.equal(r2.cleanups, null);
    assert.doesNotMatch(r2.stdout, /Cleanups/);
    assert.ok(!r2.md.includes('Cleanups'));
    assert.ok(!r2.svg.includes('Cleanups'));
  });

  test('--lang tr', () => {
    const r = run(['--lang', 'tr']);
    assert.match(r.stdout, /Temizlikler +2 commit \(merge dışı commit'lerin %33 kadarı\) · en büyüğü/);
    assert.ok(r.md.includes('## Temizlikler'));
    assert.ok(r.svg.includes('Temizlikler'));
  });
});
