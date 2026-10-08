// Period-over-period (--since without --year): the window vs the equal-length window just
// before it on commits, lines changed and active days, on the totals and outro cards, in
// the recap, wrapped.md and stats.json. --year runs keep year-over-year and never get it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, rowFits } from '../src/cards/svg.js';
import { generate, parseCli, run } from '../src/cli.js';
import { readHistory } from '../src/git.js';
import { buildStatsJson } from '../src/json.js';
import { buildMarkdown } from '../src/markdown.js';
import { computePreviousPeriod, computeStats, previousPeriod, previousWindow } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-08';

/** A commit as readCommits() returns it. */
function commit(hash, date, { added = 2, removed = 1, email = 'ada@example.com', author = 'Ada', path = 'src/a.js' } = {}) {
  const files = [{ path, added, removed, binary: false }];
  return { hash, author, email, date, parents: ['p'], subject: `feat: ${hash}`, files, filesChanged: 1, linesAdded: added, linesRemoved: removed };
}

const day = (d, h = 12) => `${d}T${String(h).padStart(2, '0')}:00:00+00:00`;

// --- window math --------------------------------------------------------------------------

describe('previousWindow', () => {
  test('the N days just before an N-day window', () => {
    assert.deepEqual(previousWindow('2026-09-09', '2026-10-08'), {
      since: '2026-09-09', until: '2026-10-08', previousSince: '2026-08-10', previousUntil: '2026-09-08', days: 30,
    });
    // A single day: the day before.
    assert.deepEqual(previousWindow('2025-01-01', '2025-01-01'), {
      since: '2025-01-01', until: '2025-01-01', previousSince: '2024-12-31', previousUntil: '2024-12-31', days: 1,
    });
  });

  test('month, year and leap-day boundaries are plain calendar arithmetic', () => {
    // March 2024 (31 days) → back over the 29-day February into January.
    assert.deepEqual(previousWindow('2024-03-01', '2024-03-31'), {
      since: '2024-03-01', until: '2024-03-31', previousSince: '2024-01-30', previousUntil: '2024-02-29', days: 31,
    });
    // February 2024 (29 days) → 2024-01-03 to 2024-01-31.
    const feb = previousWindow('2024-02-01', '2024-02-29');
    assert.equal(feb.days, 29);
    assert.deepEqual([feb.previousSince, feb.previousUntil], ['2024-01-03', '2024-01-31']);
    // A whole (non-leap) year of 365 days → back to the 2nd of January of the leap year.
    const year = previousWindow('2025-01-01', '2025-12-31');
    assert.equal(year.days, 365);
    assert.deepEqual([year.previousSince, year.previousUntil], ['2024-01-02', '2024-12-31']);
    // Across DST changes (Europe and US both switch in March / October): no hour drift.
    const dst = previousWindow('2026-03-29', '2026-11-01');
    assert.equal(dst.days, 218);
    assert.equal(dst.previousUntil, '2026-03-28');
    assert.equal(dst.previousSince, '2025-08-23');
  });

  test('a relative --since resolves first; the window ends at today without --until', () => {
    const opts = parseCli(['--since', '30d'], { today: TODAY });
    assert.equal(opts.since, '2026-09-08');
    const w = previousWindow(opts.since, TODAY);
    assert.equal(w.days, 31);
    assert.deepEqual([w.previousSince, w.previousUntil], ['2026-08-08', '2026-09-07']);
    const months = parseCli(['--since', '1m', '--until', '1d'], { today: '2026-03-31' });
    const m = previousWindow(months.since, months.until);
    assert.deepEqual([months.since, months.until, m.days, m.previousSince, m.previousUntil], ['2026-02-28', '2026-03-30', 31, '2026-01-28', '2026-02-27']);
  });

  test('null for bad dates, an inverted window, or a previous window before 1970', () => {
    assert.equal(previousWindow('2025-02-30', '2025-03-10'), null);
    assert.equal(previousWindow('2025-03-10', '2025-03-09'), null);
    assert.equal(previousWindow('2025-3-1', '2025-03-09'), null);
    assert.equal(previousWindow(undefined, '2025-03-09'), null);
    assert.equal(previousWindow('2025-03-01', null), null);
    assert.equal(previousWindow('1970-01-05', '1970-01-10'), null, 'would start on 1969-12-30');
    assert.deepEqual(previousWindow('1970-01-06', '1970-01-10'), {
      since: '1970-01-06', until: '1970-01-10', previousSince: '1970-01-01', previousUntil: '1970-01-05', days: 5,
    });
  });
});

// --- stats --------------------------------------------------------------------------------

const NOW = [
  commit('c1', day('2026-09-10'), { added: 10, removed: 5 }),
  commit('c2', day('2026-09-10', 15), { added: 1, removed: 0 }),
  commit('c3', day('2026-10-01'), { added: 4, removed: 4 }),
];
const BEFORE = [
  commit('p1', day('2026-08-12'), { added: 100, removed: 20 }),
  commit('p2', day('2026-08-20'), { added: 3, removed: 3 }),
  commit('p3', day('2026-08-30'), { added: 0, removed: 0 }),
  commit('p4', day('2026-09-05'), { added: 1, removed: 1 }),
];
const WINDOW = { since: '2026-09-09', until: '2026-10-08' };

describe('computePreviousPeriod', () => {
  test('current vs previous window with deltas', () => {
    const now = computeStats(NOW, { today: TODAY }).totals;
    assert.deepEqual(computePreviousPeriod(now, { ...WINDOW, commits: BEFORE }), {
      since: '2026-09-09',
      until: '2026-10-08',
      previousSince: '2026-08-10',
      previousUntil: '2026-09-08',
      days: 30,
      commits: { current: 3, previous: 4, delta: -1 },
      lines: { current: 24, previous: 128, delta: -104 },
      activeDays: { current: 2, previous: 4, delta: -2 },
      previousTruncated: false,
    });
    const capped = computePreviousPeriod(now, { ...WINDOW, commits: BEFORE, truncated: true });
    assert.equal(capped.previousTruncated, true);
  });

  test('null when there is nothing to compare', () => {
    const now = computeStats(NOW).totals;
    assert.equal(computePreviousPeriod(now, { ...WINDOW, commits: [] }), null, 'quiet previous window');
    assert.equal(computePreviousPeriod(computeStats([]).totals, { ...WINDOW, commits: BEFORE }), null, 'quiet window');
    assert.equal(computePreviousPeriod(now, { commits: BEFORE }), null, 'no window');
    assert.equal(computePreviousPeriod(now, { since: '1970-01-01', until: '1970-01-02', commits: BEFORE }), null, 'before 1970');
    assert.equal(computePreviousPeriod(now), null);
  });

  test('computeStats adds stats.previousPeriod as the last key, only with a comparison', () => {
    const plain = computeStats(NOW, { today: TODAY });
    assert.equal('previousPeriod' in plain, false);
    assert.deepEqual(computeStats(NOW, { today: TODAY, previousPeriod: { ...WINDOW, commits: [] } }), plain);
    const s = computeStats(NOW, { today: TODAY, previousPeriod: { ...WINDOW, commits: BEFORE } });
    assert.equal(Object.keys(s).at(-1), 'previousPeriod');
    const multi = computeStats(NOW.map((c) => ({ ...c, repo: 'a' })), { today: TODAY, repos: ['a', 'b'], previousPeriod: { ...WINDOW, commits: BEFORE } });
    assert.deepEqual(Object.keys(multi).slice(-2), ['repos', 'previousPeriod']);
    // Never both: a year-over-year comparison wins.
    const both = computeStats(NOW, { today: TODAY, previousYear: { year: 2026, commits: BEFORE.map((c) => ({ ...c, date: c.date.replace('2026', '2025') })) }, previousPeriod: { ...WINDOW, commits: BEFORE } });
    assert.ok('yearOverYear' in both);
    assert.equal('previousPeriod' in both, false);
  });

  test('previousPeriod() reads valid comparisons only', () => {
    const s = computeStats(NOW, { today: TODAY, previousPeriod: { ...WINDOW, commits: BEFORE } });
    assert.deepEqual(previousPeriod(s), { days: 30, commits: -1, lines: -104, activeDays: -2 });
    assert.equal(previousPeriod({}), null);
    assert.equal(previousPeriod(null), null);
    const p = s.previousPeriod;
    assert.equal(previousPeriod({ previousPeriod: { ...p, days: 0 } }), null);
    assert.equal(previousPeriod({ previousPeriod: { ...p, days: '30' } }), null);
    assert.equal(previousPeriod({ previousPeriod: { ...p, lines: { delta: Number.NaN } } }), null);
    assert.equal(previousPeriod({ previousPeriod: { ...p, activeDays: null } }), null);
  });
});

// --- cards, recap, wrapped.md, stats.json ----------------------------------------------------

const POP_STATS = () => computeStats(NOW, { today: TODAY, previousPeriod: { ...WINDOW, commits: BEFORE } });
const OPTS = { repoName: 'app', ...WINDOW, today: TODAY };
const spec = (stats, id, opts = OPTS) => buildCardSpecs(stats, opts).find((c) => c.id === id).spec;

describe('cards', () => {
  test('totals card: one row per metric with the signed change (en + tr)', () => {
    assert.deepEqual(spec(POP_STATS(), 'totals').lines.slice(-3), [
      { label: 'Commits vs prev. 30 days', value: '−1' },
      { label: 'Lines vs prev. 30 days', value: '−104' },
      { label: 'Active days vs prev. 30 days', value: '−2' },
    ]);
    const trRows = spec(POP_STATS(), 'totals', { ...OPTS, lang: 'tr' }).lines.slice(-3);
    assert.deepEqual(trRows.map((r) => r.label), ['Commit farkı (önceki 30 gün)', 'Satır farkı (önceki 30 gün)', 'Gün farkı (önceki 30 gün)']);
    const svg = buildCards(POP_STATS(), OPTS).find((c) => c.id === 'totals').svg;
    for (const t of ['Commits vs prev. 30 days', 'Active days vs prev. 30 days', '>−104<']) assert.ok(svg.includes(t), t);
    const trSvg = buildCards(POP_STATS(), { ...OPTS, lang: 'tr' }).find((c) => c.id === 'totals').svg;
    assert.ok(trSvg.includes('Gün farkı (önceki 30 gün)'));
    // One day: singular.
    const one = POP_STATS();
    one.previousPeriod = { ...one.previousPeriod, days: 1 };
    assert.equal(spec(one, 'totals').lines.at(-3).label, 'Commits vs prev. 1 day');
  });

  test('labels drop the day count when a row would not fit, all three together', () => {
    const s = POP_STATS();
    s.previousPeriod = { ...s.previousPeriod, days: 20000, lines: { current: 1, previous: 1, delta: -999999999 } };
    assert.deepEqual(spec(s, 'totals').lines.slice(-3).map((r) => r.label), ['Commits vs prev.', 'Lines vs prev.', 'Active days vs prev.']);
    assert.deepEqual(spec(s, 'totals', { ...OPTS, lang: 'tr' }).lines.slice(-3).map((r) => r.label), ['Commit farkı', 'Satır farkı', 'Gün farkı']);
    for (const n of [999999999, -999999999]) {
      for (const days of [1, 30, 365, 20000]) {
        const t = POP_STATS();
        const big = { current: 1, previous: 1, delta: n };
        t.previousPeriod = { ...t.previousPeriod, days, commits: big, lines: big, activeDays: big };
        for (const lang of ['en', 'tr']) {
          const sp = spec(t, 'totals', { ...OPTS, lang });
          for (const r of sp.lines.slice(-3)) assert.ok(rowFits(r), `${lang} ${days} ${n}: ${r.label} fits`);
          const rows = layoutCard(sp).blocks.find((b) => b.kind === 'rows').svg;
          assert.ok(!rows.includes('…'), `${lang} ${days} ${n}: a row is ellipsized`);
        }
      }
    }
  });

  test('outro card: the comparison sentence leads the subtitle (en + tr)', () => {
    assert.match(spec(POP_STATS(), 'outro').subtitle, /^vs previous 30 days: −1 commit, −104 lines changed, −2 active days\. Made with gitwrapped/);
    assert.match(spec(POP_STATS(), 'outro', { ...OPTS, lang: 'tr' }).subtitle, /^Önceki 30 güne göre: −1 commit, −104 değişen satır, −2 aktif gün\. gitwrapped ile/);
    assert.ok(buildCards(POP_STATS(), OPTS).find((c) => c.id === 'outro').svg.includes('vs previous 30 days:'));
    assert.ok(buildCards(POP_STATS(), { ...OPTS, lang: 'tr' }).find((c) => c.id === 'outro').svg.includes('Önceki 30 güne göre:'));
  });

  test('without a comparison every card is exactly as before', () => {
    const plain = computeStats(NOW, { today: TODAY });
    const quiet = computeStats(NOW, { today: TODAY, previousPeriod: { ...WINDOW, commits: [] } });
    for (const lang of ['en', 'tr']) assert.deepEqual(buildCards(quiet, { ...OPTS, lang }), buildCards(plain, { ...OPTS, lang }));
    const bad = { ...plain, previousPeriod: { days: 'x' } };
    assert.deepEqual(buildCards(bad, OPTS), buildCards(plain, OPTS));
  });

  test('worst case still fits: 6 rows, several repos, huge numbers (en + tr)', () => {
    const team = [...NOW, commit('b1', day('2026-09-12'), { email: 'bob@example.com', author: 'Bob' })];
    const labels = ['api', 'web', 'docs', 'infra', 'mobile'];
    const commits = team.map((c, i) => ({ ...c, repo: labels[i % labels.length], files: c.files.map((f) => ({ ...f, path: `${labels[i % labels.length]}/${f.path}` })) }));
    const stats = computeStats(commits, { today: TODAY, repos: labels, previousPeriod: { ...WINDOW, commits: BEFORE } });
    stats.previousPeriod = { ...stats.previousPeriod, days: 9999, commits: { current: 123456789, previous: 1, delta: 123456788 }, lines: { current: 0, previous: 987654321, delta: -987654321 } };
    for (const lang of ['en', 'tr']) {
      for (const id of ['totals', 'outro']) {
        const s = spec(stats, id, { ...OPTS, repoName: 'a-rather-long-repository-name', lang });
        if (id === 'totals') assert.equal(s.lines.length, 6, 'all six rows kept');
        const { blocks } = layoutCard(s);
        for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${lang}/${id}/${b.kind} inside the content area`);
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${lang}/${id}: ${blocks[i].kind} overlaps ${blocks[j].kind}`);
          }
        }
        const svg = buildCards(stats, { ...OPTS, lang }).find((c) => c.id === id).svg;
        assert.ok(!/NaN|undefined|Infinity|−0\b/.test(svg), `${lang}/${id}: bad number`);
      }
    }
  });
});

describe('recap, wrapped.md and stats.json', () => {
  test('the recap gets one "vs prev. N days" line (en + tr), none without a comparison', () => {
    const out = formatSummary(POP_STATS(), { repoName: 'app' });
    assert.match(out, /\n {2}vs prev\. 30 days −1 commit, −104 lines, −2 active days\n/);
    const trOut = formatSummary(POP_STATS(), { repoName: 'app', lang: 'tr' });
    assert.match(trOut, /\n {2}Önceki 30 güne göre −1 commit, −104 satır, −2 aktif gün\n/);
    const short = POP_STATS();
    short.previousPeriod = { ...short.previousPeriod, days: 1 };
    assert.match(formatSummary(short, { repoName: 'app' }), /\n {2}vs prev\. 1 day −1 commit/);
    assert.ok(!/vs prev\.|güne göre/.test(formatSummary(computeStats(NOW, { today: TODAY }), { repoName: 'app' })));
    assert.ok(formatSummary(POP_STATS(), { repoName: 'app', color: true }).includes('\x1b[36m−1 commit, −104 lines, −2 active days\x1b[39m'));
  });

  test('the recap label column widens to fit the period label, only with one', () => {
    const plainStats = computeStats(NOW, { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const out = formatSummary(POP_STATS(), { repoName: 'app', lang, today: TODAY });
      const label = (lang === 'en' ? en : tr).recap.vsPeriod(30);
      const width = label.length + 1;
      // Every padded label line has its value start in the same column.
      const rows = out.split('\n').filter((l) => /^ {2}\S/.test(l) && !/^ {2}(★|\d)/.test(l) && l.length > width + 2);
      assert.ok(rows.length > 2, out);
      const powerHour = (lang === 'en' ? en : tr).recap.powerHour;
      const ph = rows.find((l) => l.startsWith(`  ${powerHour}`));
      assert.ok(ph, out);
      assert.equal(ph.slice(2, 2 + width), powerHour.padEnd(width), 'power hour padded to the period label width');
      assert.ok(rows.find((l) => l.startsWith(`  ${label} `)));
      // Without the comparison: the usual width.
      const plain = formatSummary(plainStats, { repoName: 'app', lang, today: TODAY });
      const R = (lang === 'en' ? en : tr).recap;
      assert.ok(plain.split('\n').some((l) => l.startsWith(`  ${R.powerHour.padEnd(R.labelWidth)}`) && l[2 + R.labelWidth] !== ' '), plain);
    }
  });

  test('wrapped.md gets the same line (en + tr)', () => {
    const md = buildMarkdown(POP_STATS(), { repoName: 'app' });
    assert.ok(md.includes('vs prev. 30 days') && md.includes('−1 commit, −104 lines, −2 active days'), md);
    const trMd = buildMarkdown(POP_STATS(), { repoName: 'app', lang: 'tr' });
    assert.ok(trMd.includes('Önceki 30 güne göre') && trMd.includes('−104 satır'));
    assert.ok(!buildMarkdown(computeStats(NOW, { today: TODAY }), { repoName: 'app' }).includes('vs prev.'));
  });

  test('stats.json carries stats.previousPeriod as is', () => {
    const doc = JSON.parse(buildStatsJson({ stats: POP_STATS(), repoName: 'app', version: '1.1.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.previousPeriod, POP_STATS().previousPeriod);
    assert.equal(Object.keys(doc.stats).at(-1), 'previousPeriod');
  });

  test('en and tr notes for a capped previous window', () => {
    assert.equal(en.notes.previousPeriodTruncated('2', 30), 'Note: the previous 30-day window has more than 2 matching commits; the comparison with it counts only its most recent 2.');
    assert.match(tr.notes.previousPeriodTruncated('2', 30), /^Not: önceki 30 günlük dönemde/);
  });
});

// --- end to end -----------------------------------------------------------------------------

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

/** A throwaway repo at `dir`; each step is {date, lines, email}: writes `lines` lines to a.txt. */
function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    const file = join(dir, 'a.txt');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Array.from({ length: s.lines ?? 1 }, (_, j) => `step ${i} line ${j}`).join('\n') + '\n');
    git(dir, ['add', '-A']);
    const who = s.email ?? 'ada@example.com';
    git(dir, ['commit', '-q', '--allow-empty', '-m', `feat: step ${i}`], {
      GIT_AUTHOR_NAME: who.split('@')[0], GIT_AUTHOR_EMAIL: who, GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com',
      GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date,
    });
  }
  return dir;
}

async function cli(argv, extra = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run([...argv, '--no-png', '--no-color'], { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, today: TODAY, ...extra });
  return { code, stdout, stderr };
}

const readDirFiles = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
const statsOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats;

describe('end to end', () => {
  let tmp;
  let repo;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-pop-'));
    repo = makeRepo(join(tmp, 'app'), [
      { date: day('2026-08-01'), lines: 50 },
      { date: day('2026-08-15'), lines: 3 },
      { date: day('2026-08-15', 18), lines: 1, email: 'bob@example.com' },
      { date: day('2026-09-01'), lines: 2 },
      { date: day('2026-09-10'), lines: 4 },
      { date: day('2026-09-20'), lines: 6 },
      { date: day('2026-09-20', 20), lines: 2, email: 'bob@example.com' },
      { date: day('2026-10-01'), lines: 1 },
    ]);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  test('--since compares with the window before it in stats.json, recap, wrapped.md and cards', async () => {
    const out = join(tmp, 'out-since');
    const r = await cli([repo, '--since', '2026-09-09', '--json', '--md', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const s = statsOf(out);
    const p = s.previousPeriod;
    assert.deepEqual([p.since, p.until, p.previousSince, p.previousUntil, p.days], ['2026-09-09', TODAY, '2026-08-10', '2026-09-08', 30]);
    assert.deepEqual(p.commits, { current: 4, previous: 3, delta: 1 });
    assert.deepEqual(p.activeDays, { current: 3, previous: 2, delta: 1 });
    assert.equal(p.lines.current, s.totals.linesAdded + s.totals.linesRemoved);
    assert.equal(p.lines.delta, p.lines.current - p.lines.previous);
    assert.equal(p.previousTruncated, false);
    assert.equal(Object.keys(s).at(-1), 'previousPeriod');
    assert.match(r.stdout, /\n {2}vs prev\. 30 days \+1 commit, [+−±]\S+ lines?, \+1 active day\n/);
    assert.ok(readFileSync(join(out, 'wrapped.md'), 'utf8').includes('vs prev. 30 days'));
    const cards = readDirFiles(join(out, 'cards'));
    const totals = Object.entries(cards).find(([f]) => f.endsWith('-totals.svg'))[1];
    assert.ok(totals.includes('Commits vs prev. 30 days') && totals.includes('>+1<'));
    const outro = Object.entries(cards).find(([f]) => f.endsWith('-outro.svg'))[1];
    assert.ok(outro.includes('vs previous 30 days: +1 commit,'));
    assert.ok(readFileSync(join(out, 'wrapped.html'), 'utf8').includes('Commits vs prev. 30 days'));
  });

  test('a relative --since, --author and --lang tr', async () => {
    const out = join(tmp, 'out-rel');
    const r = await cli([repo, '--since', '30d', '--author', 'ada@example.com', '--lang', 'tr', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const p = statsOf(out).previousPeriod;
    assert.deepEqual([p.since, p.until, p.previousSince, p.previousUntil, p.days], ['2026-09-08', TODAY, '2026-08-08', '2026-09-07', 31]);
    // Ada: 09-10, 09-20, 10-01 now; 08-15, 09-01 before.
    assert.deepEqual(p.commits, { current: 3, previous: 2, delta: 1 });
    assert.match(r.stdout, /Önceki 31 güne göre +\+1 commit/);
  });

  test('an explicit --until ends the window', async () => {
    const out = join(tmp, 'out-until');
    const r = await cli([repo, '--since', '2026-09-10', '--until', '2026-09-25', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const p = statsOf(out).previousPeriod;
    assert.deepEqual([p.previousSince, p.previousUntil, p.days], ['2026-08-25', '2026-09-09', 16]);
    assert.deepEqual(p.commits, { current: 3, previous: 1, delta: 2 });
    assert.deepEqual(p.activeDays, { current: 2, previous: 1, delta: 1 });
  });

  test('no comparison when the previous window has no commits, without --since, or with --year', async () => {
    const quiet = await cli([repo, '--since', '2026-08-01', '--until', '2026-08-10', '--json', '--out', join(tmp, 'out-quiet')]);
    assert.equal(quiet.code, 0, quiet.stderr);
    assert.equal('previousPeriod' in statsOf(join(tmp, 'out-quiet')), false);
    assert.ok(!/vs prev\./.test(quiet.stdout));
    const all = await cli([repo, '--json', '--out', join(tmp, 'out-all')]);
    assert.equal('previousPeriod' in statsOf(join(tmp, 'out-all')), false);
    const until = await cli([repo, '--until', '2026-09-30', '--json', '--out', join(tmp, 'out-until-only')]);
    assert.equal('previousPeriod' in statsOf(join(tmp, 'out-until-only')), false);
    assert.ok(!/vs prev\./.test(all.stdout + until.stdout));
    const year = await cli([repo, '--year', '2026', '--json', '--out', join(tmp, 'out-year')]);
    assert.equal(year.code, 0, year.stderr);
    assert.equal('previousPeriod' in statsOf(join(tmp, 'out-year')), false);
    assert.ok(!Object.values(readDirFiles(join(tmp, 'out-year', 'cards'))).some((svg) => svg.includes('vs prev.')));
    // generate() with year set never reads a previous window either.
    const reads = [];
    const spy = (p, o) => { reads.push(o.since); return readHistory(p, o); };
    const g = await generate({ path: repo, year: '2026', since: '2026-01-01', until: '2026-12-31', out: join(tmp, 'out-year-g'), png: false }, { today: TODAY, readHistory: spy });
    assert.equal('previousPeriod' in g.stats, false);
    assert.deepEqual(reads, ['2026-01-01', '2025-01-01']);
  });

  test('a window with no commits reads nothing more', async () => {
    const reads = [];
    const spy = (p, o) => { reads.push(o.since); return readHistory(p, o); };
    const g = await generate({ path: repo, since: '2026-10-02', out: join(tmp, 'out-empty'), png: false }, { today: TODAY, readHistory: spy });
    assert.equal(g.commits, 0);
    assert.deepEqual(reads, ['2026-10-02']);
    assert.equal('previousPeriod' in g.stats, false);
  });

  test('--max-commits caps the previous window too, with a note', async () => {
    const g = await generate({ path: repo, since: '2026-09-09', out: join(tmp, 'out-cap'), png: false, maxCommits: 2 }, { today: TODAY });
    assert.deepEqual(g.stats.previousPeriod.commits, { current: 2, previous: 2, delta: 0 });
    assert.equal(g.stats.previousPeriod.previousTruncated, true);
    assert.equal(g.previousPeriodTruncated, true);
    const r = await cli([repo, '--since', '2026-09-09', '--max-commits', '2', '--out', join(tmp, 'out-cap-cli')]);
    assert.ok(r.stdout.includes('Note: the previous 30-day window has more than 2 matching commits'), r.stdout);
  });

  test('a failed previous-window read leaves the comparison out and warns', async () => {
    const failing = (p, o) => (o.since === '2026-08-10' ? Promise.reject(new Error('boom\nsecond line')) : readHistory(p, o));
    const g = await generate({ path: repo, since: '2026-09-09', out: join(tmp, 'out-fail'), png: false }, { today: TODAY, readHistory: failing });
    assert.equal(g.previousPeriodError, 'boom');
    assert.equal('previousPeriod' in g.stats, false);
    assert.equal(g.commits, 4);
    const r = await cli([repo, '--since', '2026-09-09', '--out', join(tmp, 'out-fail-cli')], { readHistory: failing });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /gitwrapped: period-over-period comparison skipped: boom\n/);
    assert.ok(!/vs prev\./.test(r.stdout));
  });
});

// --- tester additions ------------------------------------------------------------------------

/** A throwaway repo at `dir`; each step is {date, files: {path: lineCount}, email}. */
function makeRepoFiles(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    for (const [p, n] of Object.entries(s.files ?? { 'a.txt': 1 })) {
      const file = join(dir, p);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Array.from({ length: n }, (_, j) => `step ${i} line ${j}`).join('\n') + '\n');
    }
    git(dir, ['add', '-A']);
    const who = s.email ?? 'ada@example.com';
    git(dir, ['commit', '-q', '--allow-empty', '-m', `feat: step ${i}`], {
      GIT_AUTHOR_NAME: who.split('@')[0], GIT_AUTHOR_EMAIL: who, GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com',
      GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date,
    });
  }
  return dir;
}

/** The previous window's numbers as a plain run over exactly that window reports them. */
async function directTotals(opts, w, out) {
  const g = await generate({ ...opts, since: w.previousSince, until: w.previousUntil, out, png: false }, { today: TODAY });
  const t = g.stats.totals;
  return { commits: t.commits, lines: t.linesAdded + t.linesRemoved, activeDays: t.activeDays };
}

const ROW_RE = /vs prev\.|Önceki \S+ gün|farkı/;

describe('tester: period-over-period gaps', () => {
  let tmp;
  let api;
  let web;
  let mixed;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-pop-t-'));
    api = makeRepoFiles(join(tmp, 'api'), [
      { date: day('2026-08-20'), files: { 'src/a.js': 5 } },
      { date: day('2026-09-05'), files: { 'src/b.js': 2 } },
      { date: day('2026-09-15'), files: { 'src/a.js': 3 } },
    ]);
    web = makeRepoFiles(join(tmp, 'web'), [
      { date: day('2026-08-25'), files: { 'ui/x.js': 7 }, email: 'bob@example.com' },
      { date: day('2026-08-25', 20), files: { 'ui/y.js': 1 } },
      { date: day('2026-09-20'), files: { 'ui/x.js': 2 } },
    ]);
    mixed = makeRepoFiles(join(tmp, 'mixed'), [
      // previous window of [2026-09-09, 2026-10-08] is [2026-08-10, 2026-09-08]
      { date: '2026-08-09T23:59:00+00:00', files: { 'src/old.js': 9 } }, // just before it
      { date: '2026-08-10T00:01:00+00:00', files: { 'src/a.js': 2, 'vendor/lib.js': 100 } },
      { date: day('2026-08-30'), files: { 'vendor/only.js': 50 } }, // only an excluded file
      { date: '2026-09-08T23:59:00+00:00', files: { 'src/a.js': 4 } }, // last minute of it
      { date: '2026-09-09T00:01:00+00:00', files: { 'src/a.js': 1, 'vendor/lib.js': 10 } },
      { date: day('2026-09-25'), files: { 'src/c.js': 3 } },
    ]);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  test('several repos: the previous window is read from every repo and matches a direct run over it', async () => {
    const opts = { path: api, paths: [api, web] };
    const g = await generate({ ...opts, since: '2026-09-09', out: join(tmp, 'm1'), png: false, json: true, md: true }, { today: TODAY });
    const p = g.stats.previousPeriod;
    assert.ok(p, 'comparison present');
    assert.deepEqual(Object.keys(g.stats).slice(-2), ['repos', 'previousPeriod']);
    assert.deepEqual([p.previousSince, p.previousUntil, p.days], ['2026-08-10', '2026-09-08', 30]);
    // api: 08-20, 09-05; web: 08-25 x2 → 4 commits on 3 days before; 2 commits on 2 days now.
    assert.deepEqual(p.commits, { current: 2, previous: 4, delta: -2 });
    assert.deepEqual(p.activeDays, { current: 2, previous: 3, delta: -1 });
    const direct = await directTotals(opts, p, join(tmp, 'm1d'));
    assert.deepEqual({ commits: p.commits.previous, lines: p.lines.previous, activeDays: p.activeDays.previous }, direct);
    const totals = g.cardFiles.map((f) => readFileSync(f, 'utf8')).find((svg) => svg.includes('Commits vs prev. 30 days'));
    assert.ok(totals && totals.includes('>−2<'), 'multi-repo totals card has the rows');
    // The previous window of a repo with nothing in it (api has nothing before 08-10 for a
    // narrow window) does not break the read.
    const g2 = await generate({ ...opts, since: '2026-08-25', until: '2026-08-25', out: join(tmp, 'm2'), png: false }, { today: TODAY });
    assert.equal('previousPeriod' in g2.stats, false, 'nothing on 08-24 in either repo');
  });

  test('several repos with --author: previous window filtered by author too', async () => {
    const opts = { path: api, paths: [api, web], author: 'ada@example.com' };
    const g = await generate({ ...opts, since: '2026-09-09', out: join(tmp, 'm3'), png: false }, { today: TODAY });
    const p = g.stats.previousPeriod;
    assert.deepEqual(p.commits, { current: 2, previous: 3, delta: -1 });
    const direct = await directTotals(opts, p, join(tmp, 'm3d'));
    assert.deepEqual({ commits: p.commits.previous, lines: p.lines.previous, activeDays: p.activeDays.previous }, direct);
  });

  test('--exclude applies to the previous window; window bounds are inclusive and exact', async () => {
    const base = { path: mixed };
    const plain = await generate({ ...base, since: '2026-09-09', out: join(tmp, 'x0'), png: false }, { today: TODAY });
    const pp = plain.stats.previousPeriod;
    // 08-10 00:01, 08-30, 09-08 23:59 in; 08-09 23:59 out.
    assert.deepEqual(pp.commits, { current: 2, previous: 3, delta: -1 });
    assert.equal(pp.lines.previous, 102 + 50 + 4 + 2 /* a.js 2→4 rewrite: +4 −2 */);
    const ex = await generate({ ...base, since: '2026-09-09', exclude: ['vendor/**'], out: join(tmp, 'x1'), png: false }, { today: TODAY });
    const p = ex.stats.previousPeriod;
    assert.equal(p.lines.current, ex.stats.totals.linesAdded + ex.stats.totals.linesRemoved);
    assert.ok(p.lines.previous < pp.lines.previous, 'vendor lines dropped from the previous window');
    assert.equal(p.lines.previous, 2 + 4 + 2);
    const direct = await directTotals({ ...base, exclude: ['vendor/**'] }, p, join(tmp, 'x1d'));
    assert.deepEqual({ commits: p.commits.previous, lines: p.lines.previous, activeDays: p.activeDays.previous }, direct);
    // Same via the CLI flag.
    const r = await cli([mixed, '--since', '2026-09-09', '--exclude', 'vendor/**', '--json', '--out', join(tmp, 'x2')]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(statsOf(join(tmp, 'x2')).previousPeriod, JSON.parse(JSON.stringify(p)));
  });

  test('single-day window (since == until): the day before, singular labels (en + tr)', async () => {
    const out = join(tmp, 'd1');
    const r = await cli([mixed, '--since', '2026-09-09', '--until', '2026-09-09', '--json', '--md', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const p = statsOf(out).previousPeriod;
    assert.deepEqual([p.since, p.until, p.previousSince, p.previousUntil, p.days], ['2026-09-09', '2026-09-09', '2026-09-08', '2026-09-08', 1]);
    assert.deepEqual(p.commits, { current: 1, previous: 1, delta: 0 });
    assert.deepEqual(p.activeDays, { current: 1, previous: 1, delta: 0 });
    assert.match(r.stdout, /\n {2}vs prev\. 1 day +±0 commits, [+−]\d+ lines?, ±0 active days\n/);
    assert.ok(readFileSync(join(out, 'wrapped.md'), 'utf8').includes('vs prev. 1 day'));
    const cards = Object.values(readDirFiles(join(out, 'cards'))).join('\n');
    assert.ok(cards.includes('Commits vs prev. 1 day') && !cards.includes('1 days'));
    assert.ok(cards.includes('vs previous 1 day:') || cards.includes('vs previous 1 day:'), 'outro sentence');
    const trOut = join(tmp, 'd1tr');
    const t = await cli([mixed, '--since', '2026-09-09', '--until', '2026-09-09', '--lang', 'tr', '--out', trOut]);
    assert.equal(t.code, 0, t.stderr);
    assert.match(t.stdout, /Önceki 1 güne göre +±0 commit/);
    assert.ok(Object.values(readDirFiles(join(trOut, 'cards'))).join('\n').includes('Commit farkı (önceki 1 gün)'));
  });

  test('zero and negative deltas render as ±0 / − with locale grouping on cards, recap and md (en + tr)', () => {
    const s = POP_STATS();
    s.previousPeriod = {
      ...s.previousPeriod,
      days: 1234,
      commits: { current: 5, previous: 5, delta: 0 },
      lines: { current: 1, previous: 1235, delta: -1234 },
      activeDays: { current: 1, previous: 2, delta: -1 },
    };
    const vals = (lang) => spec(s, 'totals', { ...OPTS, lang }).lines.slice(-3).map((r) => r.value);
    assert.deepEqual(vals('en'), ['±0', '−1,234', '−1']);
    assert.deepEqual(vals('tr'), ['±0', '−1.234', '−1']);
    const enLabels = spec(s, 'totals', OPTS).lines.slice(-3).map((r) => r.label);
    assert.ok(enLabels.every((l) => /vs prev\.( 1,234 days)?$/.test(l)), enLabels.join('|'));
    assert.match(formatSummary(s, { repoName: 'app' }), /vs prev\. 1,234 days ±0 commits, −1,234 lines, −1 active day\n/);
    assert.match(formatSummary(s, { repoName: 'app', lang: 'tr' }), /Önceki 1\.234 güne göre ±0 commit, −1\.234 satır, −1 aktif gün\n/);
    const md = buildMarkdown(s, { repoName: 'app' });
    assert.ok(md.includes('±0 commits, −1,234 lines, −1 active day'), md);
    assert.ok(buildMarkdown(s, { repoName: 'app', lang: 'tr' }).includes('±0 commit, −1.234 satır, −1 aktif gün'));
    const outro = spec(s, 'outro').subtitle.replace(/ /g, ' ');
    assert.match(outro, /^vs previous 1,234 days: ±0 commits, −1,234 lines changed, −1 active day\./);
    const trOutro = spec(s, 'outro', { ...OPTS, lang: 'tr' }).subtitle.replace(/ /g, ' ');
    assert.match(trOutro, /^Önceki 1\.234 güne göre: ±0 commit, −1\.234 değişen satır, −1 aktif gün\./);
    for (const lang of ['en', 'tr']) {
      for (const c of buildCards(s, { ...OPTS, lang }).filter((x) => ['totals', 'outro'].includes(x.id))) {
        const text = [...c.svg.matchAll(/>([^<]*)</g)].map((m) => m[1]).join('|');
        assert.ok(!/NaN|undefined|(^|[^\d,.])[-−+]0\b/.test(text), `${lang}/${c.id}: ${text}`);
      }
    }
    // All-zero is still a comparison (not dropped).
    const z = POP_STATS();
    const zero = { current: 1, previous: 1, delta: 0 };
    z.previousPeriod = { ...z.previousPeriod, commits: zero, lines: zero, activeDays: zero };
    assert.deepEqual(spec(z, 'totals').lines.slice(-3).map((r) => r.value), ['±0', '±0', '±0']);
  });

  test('wrapped.html includes the comparison rows and outro sentence (en + tr), none without --since', async () => {
    for (const [lang, rowText, outroText] of [['en', 'Commits vs prev. 30 days', 'vs previous 30'], ['tr', 'Commit farkı (önceki 30 gün)', 'Önceki 30 güne göre:']]) {
      const out = join(tmp, `h-${lang}`);
      const r = await cli([mixed, '--since', '2026-09-09', '--lang', lang, '--out', out]);
      assert.equal(r.code, 0, r.stderr);
      const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
      assert.ok(html.includes(rowText), `${lang} row`);
      assert.ok(html.includes(outroText), `${lang} outro`);
    }
    const out = join(tmp, 'h-none');
    await cli([mixed, '--out', out]);
    assert.ok(!ROW_RE.test(readFileSync(join(out, 'wrapped.html'), 'utf8')));
  });

  test('PNG export of a --since run still renders the totals and outro cards', async (t) => {
    let ok = true;
    try {
      const { loadResvg } = await import('../src/png.js');
      await loadResvg();
    } catch (err) {
      ok = false;
      t.skip(`resvg unavailable: ${err.message}`);
    }
    if (!ok) return;
    for (const lang of ['en', 'tr']) {
      const g = await generate({ path: mixed, since: '2026-09-09', out: join(tmp, `png-${lang}`), lang }, { today: TODAY });
      assert.ok(g.stats.previousPeriod, 'comparison present');
      assert.equal(g.pngSkipped ?? null, null, String(g.pngSkipped));
      for (const id of ['totals', 'outro']) {
        const f = g.pngFiles.find((p) => p.endsWith(`-${id}.png`));
        assert.ok(f, `${lang} ${id}.png written`);
        const buf = readFileSync(f);
        assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
        assert.ok(buf.length > 1000);
      }
    }
  });

  test('runs without --since: one read, no previousPeriod, no comparison rows anywhere', async () => {
    for (const [name, extra] of [['all', []], ['until', ['--until', '2026-09-30']], ['author', ['--author', 'ada@example.com']], ['multi', [web]], ['tr', ['--lang', 'tr']]]) {
      const out = join(tmp, `none-${name}`);
      const r = await cli([mixed, ...extra, '--json', '--md', '--out', out]);
      assert.equal(r.code, 0, r.stderr);
      const s = statsOf(out);
      assert.equal('previousPeriod' in s, false, name);
      assert.ok(!ROW_RE.test(r.stdout), `${name} recap`);
      assert.ok(!ROW_RE.test(readFileSync(join(out, 'wrapped.md'), 'utf8')), `${name} md`);
      assert.ok(!ROW_RE.test(readFileSync(join(out, 'wrapped.html'), 'utf8')), `${name} html`);
      for (const [f, svg] of Object.entries(readDirFiles(join(out, 'cards')))) assert.ok(!ROW_RE.test(svg), `${name} ${f}`);
    }
    const reads = [];
    const spy = (p, o) => { reads.push([o.since, o.until]); return readHistory(p, o); };
    await generate({ path: mixed, until: '2026-09-30', out: join(tmp, 'none-g'), png: false }, { today: TODAY, readHistory: spy });
    assert.deepEqual(reads, [[undefined, '2026-09-30']], 'no extra read without --since');
    // Cards of a run without --since equal the cards of the same stats minus previousPeriod.
    const g = await generate({ path: mixed, since: '2026-09-09', out: join(tmp, 'none-strip'), png: false }, { today: TODAY });
    const { previousPeriod: _drop, ...rest } = g.stats;
    const plain = await generate({ path: mixed, since: '2026-09-09', out: join(tmp, 'none-strip2'), png: false }, { today: TODAY, readHistory: (p, o) => (o.since === '2026-08-10' ? Promise.resolve({ commits: [] }) : readHistory(p, o)) });
    assert.equal('previousPeriod' in plain.stats, false);
    assert.deepEqual(buildCards(plain.stats, OPTS), buildCards(rest, OPTS));
  });

  test('a window that reaches past today is compared over the days up to today only', async () => {
    const g = await generate({ path: mixed, since: '2026-09-20', until: '2026-12-31', out: join(tmp, 'future'), png: false }, { today: TODAY });
    const p = g.stats.previousPeriod;
    // 103 days asked for, of which only 19 have happened by TODAY: 19 vs the 19 before.
    assert.deepEqual([p.since, p.until, p.days], ['2026-09-20', TODAY, 19]);
    assert.deepEqual([p.previousSince, p.previousUntil], ['2026-09-01', '2026-09-19']);
    assert.deepEqual(p.commits, { current: 1, previous: 2, delta: -1 });
  });

  test('future --until is clamped to today; a window entirely in the future is not compared', async () => {
    const r = await cli([mixed, '--since', '2026-09-09', '--until', '2026-12-31', '--json', '--out', join(tmp, 'future-cli')]);
    assert.equal(r.code, 0, r.stderr);
    const p = statsOf(join(tmp, 'future-cli')).previousPeriod;
    assert.deepEqual([p.until, p.days, p.previousSince, p.previousUntil], [TODAY, 30, '2026-08-10', '2026-09-08']);
    assert.match(r.stdout, /vs prev\. 30 days/);
    // --since 2026-10-01 --until 2026-12-31 on 2026-10-08: 8 days vs the 8 before.
    const reads = [];
    const one = (date) => ({ hash: date, author: 'Ada', email: 'ada@example.com', date: `${date}T12:00:00+00:00`, parents: ['p'], subject: 'feat: x', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
    const spy = async (path, o) => { reads.push([o.since, o.until]); return { commits: [one(o.since)], truncated: false, limit: 50000 }; };
    const g = await generate({ path: mixed, since: '2026-10-01', until: '2026-12-31', out: join(tmp, 'future-8'), png: false }, { today: TODAY, readHistory: spy });
    assert.deepEqual(reads, [['2026-10-01', '2026-12-31'], ['2026-09-23', '2026-09-30']]);
    assert.deepEqual([g.stats.previousPeriod.until, g.stats.previousPeriod.days], [TODAY, 8]);
    // A window starting after today (a future-dated commit in it): no extra read.
    const fake = [];
    const stub = async (path, o) => {
      fake.push(o.since);
      const c = { hash: 'f1', author: 'Ada', email: 'ada@example.com', date: '2026-11-01T12:00:00+00:00', parents: ['p'], subject: 'feat: later', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
      return { commits: o.since === '2026-10-09' ? [c] : [], truncated: false, limit: 50000 };
    };
    const later = await generate({ path: mixed, since: '2026-10-09', until: '2026-12-31', out: join(tmp, 'future-all'), png: false }, { today: TODAY, readHistory: stub });
    assert.equal(later.commits, 1);
    assert.deepEqual(fake, ['2026-10-09']);
    assert.equal('previousPeriod' in later.stats, false);
  });
});
