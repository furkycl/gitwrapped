// Year-over-year (--year): this year vs the previous calendar year on commits, lines
// changed and active days, on the totals and outro cards, in the recap and stats.json.
// Runs without --year (and --year runs whose previous year has no commits) are unchanged.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { generate, run } from '../src/cli.js';
import { readHistory } from '../src/git.js';
import { buildStatsJson } from '../src/json.js';
import { computeStats, computeYearOverYear, yearOverYear } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { formatDelta } from '../src/i18n/index.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-06';

/** A commit as readCommits() returns it. */
function commit(hash, date, { added = 2, removed = 1, email = 'ada@example.com', author = 'Ada', path = 'src/a.js' } = {}) {
  const files = [{ path, added, removed, binary: false }];
  return { hash, author, email, date, parents: ['p'], subject: `feat: ${hash}`, files, filesChanged: 1, linesAdded: added, linesRemoved: removed };
}

const day = (d, h = 12) => `${d}T${String(h).padStart(2, '0')}:00:00+00:00`;

// --- formatting ---------------------------------------------------------------------------

describe('formatDelta', () => {
  test('signs with + and U+2212, never "−0"', () => {
    assert.equal(formatDelta(42), '+42');
    assert.equal(formatDelta(-3), '−3');
    assert.equal(formatDelta(0), '±0');
    assert.equal(formatDelta(-0.4), '±0');
    assert.equal(formatDelta(0.4), '±0');
    assert.equal(formatDelta(Number.NaN), '±0');
    assert.equal(formatDelta('5'), '±0');
    assert.equal(formatDelta(1234567), '+1,234,567');
    assert.equal(formatDelta(-1203, '.'), '−1.203');
  });

  test('the string tables format deltas in their own number format', () => {
    assert.equal(en.delta(-1203), '−1,203');
    assert.equal(tr.delta(-1203), '−1.203');
    assert.equal(en.yoy.changes(1, -1, 0), '+1 commit, −1 line, ±0 active days');
    assert.equal(en.yoy.changes(42, -1203, 5), '+42 commits, −1,203 lines, +5 active days');
    assert.equal(tr.yoy.changes(42, -1203, 5), '+42 commit, −1.203 satır, +5 aktif gün');
    // The outro's summary keeps each change on one line with no-break spaces.
    assert.equal(en.yoy.summary(2024, 2, 3, -1), 'vs 2024: +2\u00a0commits, +3\u00a0lines\u00a0changed, −1\u00a0active\u00a0day.');
    assert.equal(tr.yoy.summary(2024, 2, 1, -1), '2024 yılına göre: +2\u00a0commit, +1\u00a0değişen\u00a0satır, −1\u00a0aktif\u00a0gün.');
  });
});

// --- stats --------------------------------------------------------------------------------

const THIS_YEAR = [
  commit('c1', day('2025-01-10'), { added: 10, removed: 5 }),
  commit('c2', day('2025-01-10', 15), { added: 1, removed: 0 }),
  commit('c3', day('2025-06-01'), { added: 4, removed: 4 }),
];
const LAST_YEAR = [
  commit('p1', day('2024-02-01'), { added: 100, removed: 20 }),
  commit('p2', day('2024-03-01'), { added: 3, removed: 3 }),
  commit('p3', day('2024-04-01'), { added: 0, removed: 0 }),
  commit('p4', day('2024-05-01'), { added: 1, removed: 1 }),
];

describe('computeYearOverYear', () => {
  test('current vs previous with deltas (negative, positive and zero)', () => {
    const now = computeStats(THIS_YEAR, { today: TODAY }).totals;
    const y = computeYearOverYear(now, { year: '2025', commits: LAST_YEAR });
    assert.deepEqual(y, {
      year: 2025,
      previousYear: 2024,
      commits: { current: 3, previous: 4, delta: -1 },
      lines: { current: 24, previous: 128, delta: -104 },
      activeDays: { current: 2, previous: 4, delta: -2 },
      previousTruncated: false,
    });
    const more = computeYearOverYear(computeStats(LAST_YEAR).totals, { year: 2025, commits: THIS_YEAR, truncated: true });
    assert.deepEqual(more.commits, { current: 4, previous: 3, delta: 1 });
    assert.equal(more.lines.delta, 104);
    assert.equal(more.activeDays.delta, 2);
    assert.equal(more.previousTruncated, true);
    const same = computeYearOverYear(now, { year: 2025, commits: THIS_YEAR.map((c) => ({ ...c, date: c.date.replace('2025', '2024') })) });
    assert.deepEqual([same.commits.delta, same.lines.delta, same.activeDays.delta], [0, 0, 0]);
  });

  test('null when there is nothing to compare', () => {
    const now = computeStats(THIS_YEAR).totals;
    assert.equal(computeYearOverYear(now, { year: 2025, commits: [] }), null, 'first year');
    assert.equal(computeYearOverYear(computeStats([]).totals, { year: 2025, commits: LAST_YEAR }), null, 'quiet year');
    assert.equal(computeYearOverYear(now, { commits: LAST_YEAR }), null, 'no year');
    assert.equal(computeYearOverYear(now, { year: 'soon', commits: LAST_YEAR }), null);
    assert.equal(computeYearOverYear(now), null);
  });

  test('computeStats adds stats.yearOverYear as the last key, only when there is a comparison', () => {
    const plain = computeStats(THIS_YEAR, { today: TODAY });
    assert.equal('yearOverYear' in plain, false);
    const firstYear = computeStats(THIS_YEAR, { today: TODAY, previousYear: { year: 2025, commits: [] } });
    assert.deepEqual(firstYear, plain);
    assert.deepEqual(Object.keys(firstYear), Object.keys(plain));
    const yoy = computeStats(THIS_YEAR, { today: TODAY, previousYear: { year: 2025, commits: LAST_YEAR } });
    assert.equal(Object.keys(yoy).at(-1), 'yearOverYear');
    assert.equal(yoy.yearOverYear.commits.delta, -1);
    // Multi-repo: still after stats.repos.
    const multi = computeStats(THIS_YEAR.map((c) => ({ ...c, repo: 'a' })), { today: TODAY, repos: ['a', 'b'], previousYear: { year: 2025, commits: LAST_YEAR } });
    assert.deepEqual(Object.keys(multi).slice(-2), ['repos', 'yearOverYear']);
  });

  test('yearOverYear() reads valid comparisons only', () => {
    const s = computeStats(THIS_YEAR, { today: TODAY, previousYear: { year: 2025, commits: LAST_YEAR } });
    assert.deepEqual(yearOverYear(s), { previousYear: 2024, commits: -1, lines: -104, activeDays: -2 });
    assert.equal(yearOverYear({}), null);
    assert.equal(yearOverYear(null), null);
    assert.equal(yearOverYear({ yearOverYear: { previousYear: 2024, commits: { delta: 1 }, lines: { delta: Number.NaN }, activeDays: { delta: 0 } } }), null);
    assert.equal(yearOverYear({ yearOverYear: { previousYear: '2024', commits: { delta: 1 }, lines: { delta: 1 }, activeDays: { delta: 0 } } }), null);
  });
});

// --- cards, recap, stats.json -----------------------------------------------------------------

const YOY_STATS = () => computeStats(THIS_YEAR, { today: TODAY, previousYear: { year: 2025, commits: LAST_YEAR } });
const OPTS = { repoName: 'app', since: '2025-01-01', until: '2025-12-31', today: TODAY };
const spec = (stats, id, opts = OPTS) => buildCardSpecs(stats, opts).find((c) => c.id === id).spec;

describe('cards', () => {
  test('totals card: one row per metric with the signed change (en + tr)', () => {
    const rows = spec(YOY_STATS(), 'totals').lines;
    assert.deepEqual(rows.slice(-3), [
      { label: 'Commits vs 2024', value: '−1' },
      { label: 'Lines vs 2024', value: '−104' },
      { label: 'Active days vs 2024', value: '−2' },
    ]);
    const trRows = spec(YOY_STATS(), 'totals', { ...OPTS, lang: 'tr' }).lines;
    assert.deepEqual(trRows.slice(-3).map((r) => r.label), ['Commit farkı (2024)', 'Satır farkı (2024)', 'Gün farkı (2024)']);
    const svg = buildCards(YOY_STATS(), OPTS).find((c) => c.id === 'totals').svg;
    for (const t of ['Commits vs 2024', 'Lines vs 2024', 'Active days vs 2024', '>−104<']) assert.ok(svg.includes(t), t);
    const trSvg = buildCards(YOY_STATS(), { ...OPTS, lang: 'tr' }).find((c) => c.id === 'totals').svg;
    assert.ok(trSvg.includes('Gün farkı (2024)'));
  });

  test('outro card: the year-over-year sentence leads the subtitle (en + tr)', () => {
    assert.match(spec(YOY_STATS(), 'outro').subtitle, /^vs 2024: −1\u00a0commit, −104\u00a0lines\u00a0changed, −2\u00a0active\u00a0days\. Made with gitwrapped/);
    assert.match(spec(YOY_STATS(), 'outro', { ...OPTS, lang: 'tr' }).subtitle, /^2024 yılına göre: −1\u00a0commit, −104\u00a0değişen\u00a0satır, −2\u00a0aktif\u00a0gün\. gitwrapped ile/);
    const svg = buildCards(YOY_STATS(), OPTS).find((c) => c.id === 'outro').svg;
    assert.ok(svg.includes('vs 2024:'), 'drawn on the card');
    const trSvg = buildCards(YOY_STATS(), { ...OPTS, lang: 'tr' }).find((c) => c.id === 'outro').svg;
    assert.ok(trSvg.includes('2024 yılına göre:'));
  });

  test('without a comparison every card is exactly as before', () => {
    const plain = computeStats(THIS_YEAR, { today: TODAY });
    const firstYear = computeStats(THIS_YEAR, { today: TODAY, previousYear: { year: 2025, commits: [] } });
    for (const lang of ['en', 'tr']) {
      assert.deepEqual(buildCards(firstYear, { ...OPTS, lang }), buildCards(plain, { ...OPTS, lang }));
    }
    assert.ok(!buildCards(plain, OPTS).some((c) => /vs 2024/.test(c.svg)));
  });

  test('worst case still fits: 6 rows (contributors + comparison), several repos, huge numbers, tr', () => {
    const big = (n) => ({ current: n, previous: 1, delta: n - 1 });
    const team = [...THIS_YEAR, commit('b1', day('2025-03-03'), { email: 'bob@example.com', author: 'Bob' })];
    const labels = ['api', 'web', 'docs', 'infra', 'mobile'];
    const commits = team.map((c, i) => ({ ...c, repo: labels[i % labels.length], files: c.files.map((f) => ({ ...f, path: `${labels[i % labels.length]}/${f.path}` })) }));
    const stats = computeStats(commits, { today: TODAY, repos: labels, previousYear: { year: 2025, commits: LAST_YEAR } });
    stats.yearOverYear = { ...stats.yearOverYear, commits: big(123456789), lines: { current: 0, previous: 987654321, delta: -987654321 }, activeDays: big(366) };
    for (const lang of ['en', 'tr']) {
      for (const id of ['totals', 'outro']) {
        const s = spec(stats, id, { ...OPTS, repoName: 'a-rather-long-repository-name', lang });
        if (id === 'totals') assert.equal(s.lines.length, 6, 'all six rows kept');
        const { blocks } = layoutCard(s);
        for (const b of blocks) {
          assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${lang}/${id}/${b.kind} inside the content area`);
        }
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${lang}/${id}: ${blocks[i].kind} overlaps ${blocks[j].kind}`);
          }
        }
        const svg = buildCards(stats, { ...OPTS, lang }).find((c) => c.id === id).svg;
        assert.ok(!/NaN|undefined|Infinity|−0\b/.test(svg), `${lang}/${id}: bad number`);
        if (id === 'totals') {
          const rows = blocks.find((b) => b.kind === 'rows').svg;
          assert.ok(rows.includes(lang === 'en' ? '+123,456,788' : '+123.456.788'), `${lang}: commit delta drawn in full`);
          assert.ok(rows.includes(lang === 'en' ? '−987,654,321' : '−987.654.321'), `${lang}: line delta drawn in full`);
        }
      }
    }
  });
});

describe('row labels at 9-digit changes', () => {
  test('no label or value is ellipsized (en + tr, both signs)', () => {
    for (const n of [999999999, -999999999]) {
      const stats = YOY_STATS();
      stats.yearOverYear = { ...stats.yearOverYear, commits: { current: 1, previous: 1, delta: n }, lines: { current: 1, previous: 1, delta: n }, activeDays: { current: 1, previous: 1, delta: n } };
      for (const lang of ['en', 'tr']) {
        const s = spec(stats, 'totals', { ...OPTS, lang });
        const rows = layoutCard(s).blocks.find((b) => b.kind === 'rows').svg;
        assert.ok(!rows.includes('…'), `${lang} ${n}: a row is ellipsized`);
        for (const r of s.lines.slice(-3)) {
          assert.ok(rows.includes(`>${r.label}<`), `${lang}: ${r.label} drawn in full`);
          assert.ok(rows.includes(`>${r.value}<`), `${lang}: ${r.value} drawn in full`);
        }
      }
    }
  });

  test('the outro keeps each change on one line (no-break spaces survive layout)', () => {
    for (const lang of ['en', 'tr']) {
      const svg = layoutCard(spec(YOY_STATS(), 'outro', { ...OPTS, lang })).blocks.map((b) => b.svg).join('');
      const unit = lang === 'en' ? '−104\u00a0lines\u00a0changed' : '−104\u00a0değişen\u00a0satır';
      assert.ok(svg.includes(unit), `${lang}: ${unit}`);
    }
  });
});

describe('recap and stats.json', () => {
  test('the recap gets one "vs <year>" line (en + tr), none without a comparison', () => {
    const out = formatSummary(YOY_STATS(), { repoName: 'app', window: '2025' });
    assert.match(out, /\n {2}vs 2024 +−1 commit, −104 lines, −2 active days\n/);
    const trOut = formatSummary(YOY_STATS(), { repoName: 'app', window: '2025', lang: 'tr' });
    assert.match(trOut, /\n {2}2024 ile fark +−1 commit, −104 satır, −2 aktif gün\n/);
    const plain = formatSummary(computeStats(THIS_YEAR, { today: TODAY }), { repoName: 'app' });
    assert.ok(!/vs 20|ile fark/.test(plain));
    const colored = formatSummary(YOY_STATS(), { repoName: 'app', color: true });
    assert.ok(colored.includes('\x1b[36m−1 commit, −104 lines, −2 active days\x1b[39m'));
  });

  test('stats.json carries stats.yearOverYear as is', () => {
    const doc = JSON.parse(buildStatsJson({ stats: YOY_STATS(), repoName: 'app', version: '1.1.0', asOf: '2025-12-31' }));
    assert.deepEqual(doc.stats.yearOverYear, YOY_STATS().yearOverYear);
    assert.equal(Object.keys(doc.stats).at(-1), 'yearOverYear');
  });
});

// --- end to end -----------------------------------------------------------------------------

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

/** A throwaway repo at `dir`; each step is {date, file, lines, email}: writes `lines` lines to `file`. */
function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    const file = join(dir, s.file ?? 'a.txt');
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

/** Run the CLI in-process; returns {code, stdout, stderr}. */
async function cli(argv, extra = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run([...argv, '--no-png', '--no-color'], { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, today: TODAY, ...extra });
  return { code, stdout, stderr };
}

const readDirFiles = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

describe('end to end', () => {
  let tmp;
  let repo;
  let api;
  let web;
  let fresh;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-yoy-'));
    // 2024: Ada ×2 (2 days), Bob ×1. 2025: Ada ×3 (2 days), Bob ×2. 2023 is ignored.
    repo = makeRepo(join(tmp, 'app'), [
      { date: day('2023-06-01'), lines: 50 },
      { date: day('2024-02-01'), lines: 3 },
      { date: day('2024-02-01', 18), lines: 1, email: 'bob@example.com' },
      { date: day('2024-09-01'), lines: 2 },
      { date: day('2025-01-05'), lines: 4 },
      { date: day('2025-01-05', 16), lines: 4, email: 'bob@example.com' },
      { date: day('2025-03-01'), lines: 6 },
      { date: day('2025-03-01', 20), lines: 2, email: 'bob@example.com' },
      { date: day('2025-12-30'), lines: 1 },
    ]);
    api = makeRepo(join(tmp, 'm', 'api'), [
      { date: day('2024-05-01'), file: 'x.js', lines: 2 },
      { date: day('2025-05-01'), file: 'x.js', lines: 3 },
      { date: day('2025-05-02'), file: 'x.js', lines: 1 },
    ]);
    web = makeRepo(join(tmp, 'm', 'web'), [
      { date: day('2024-05-01'), file: 'y.js', lines: 4 },
      { date: day('2024-07-07'), file: 'y.js', lines: 1 },
      { date: day('2025-08-01'), file: 'y.js', lines: 2 },
    ]);
    // Only 2025 commits: a first year.
    fresh = makeRepo(join(tmp, 'fresh'), [
      { date: day('2025-04-01'), lines: 2 },
      { date: day('2025-04-02'), lines: 3 },
    ]);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  test('--year compares against the previous year in stats.json, recap and cards', async () => {
    const out = join(tmp, 'out-year');
    const r = await cli([repo, '--year', '2025', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const y = doc.stats.yearOverYear;
    assert.equal(y.year, 2025);
    assert.equal(y.previousYear, 2024);
    assert.deepEqual(y.commits, { current: 5, previous: 3, delta: 2 });
    assert.deepEqual(y.activeDays, { current: 3, previous: 2, delta: 1 });
    assert.equal(y.lines.current, doc.stats.totals.linesAdded + doc.stats.totals.linesRemoved);
    assert.equal(y.lines.delta, y.lines.current - y.lines.previous);
    assert.equal(y.previousTruncated, false);
    assert.match(r.stdout, /\n {2}vs 2024 +\+2 commits, [+−]\S+ lines?, \+1 active day\n/);
    const cards = readDirFiles(join(out, 'cards'));
    const totals = Object.entries(cards).find(([f]) => f.endsWith('-totals.svg'))[1];
    assert.ok(totals.includes('Commits vs 2024') && totals.includes('>+2<'));
    const outro = Object.entries(cards).find(([f]) => f.endsWith('-outro.svg'))[1];
    assert.ok(outro.includes('vs 2024: +2\u00a0commits'));
    // The viewer embeds the same cards.
    assert.ok(readFileSync(join(out, 'wrapped.html'), 'utf8').includes('Commits vs 2024'));
  });

  test('--author filters the previous year too', async () => {
    const out = join(tmp, 'out-author');
    const r = await cli([repo, '--year', '2025', '--author', 'ada@example.com', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const y = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.yearOverYear;
    assert.deepEqual(y.commits, { current: 3, previous: 2, delta: 1 });
    assert.deepEqual(y.activeDays, { current: 3, previous: 2, delta: 1 });
    // Ada's 2024 commits: 50 → 3 lines (+3 −50), then Bob's 1 → 2 lines (+2 −1).
    assert.equal(y.lines.previous, 56);
    const bob = await cli([repo, '--year', '2025', '--author', 'BOB@example.com', '--json', '--out', join(tmp, 'out-bob')]);
    assert.equal(bob.code, 0, bob.stderr);
    const yb = JSON.parse(readFileSync(join(tmp, 'out-bob', 'stats.json'), 'utf8')).stats.yearOverYear;
    assert.deepEqual(yb.commits, { current: 2, previous: 1, delta: 1 });
    assert.deepEqual(yb.activeDays, { current: 2, previous: 1, delta: 1 });
  });

  test('several repos: the previous year is merged across the same repos', async () => {
    const out = join(tmp, 'out-multi');
    const r = await cli([api, web, '--year', '2025', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.repos, ['api', 'web']);
    const y = doc.stats.yearOverYear;
    assert.deepEqual(y.commits, { current: 3, previous: 3, delta: 0 });
    assert.deepEqual(y.activeDays, { current: 3, previous: 2, delta: 1 });
    assert.match(r.stdout, /vs 2024 +±0 commits, /);
    assert.deepEqual(Object.keys(doc.stats).slice(-2), ['repos', 'yearOverYear']);
  });

  test('--max-commits caps the previous year too (previousTruncated)', async () => {
    const r = await generate({ path: repo, year: '2025', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'out-cap'), png: false, maxCommits: 2 }, { today: TODAY });
    assert.deepEqual(r.stats.yearOverYear.commits, { current: 2, previous: 2, delta: 0 });
    assert.equal(r.stats.yearOverYear.previousTruncated, true);
  });

  test('a first year (no commits the year before) has no comparison: output as without it', async () => {
    const a = join(tmp, 'out-first');
    const b = join(tmp, 'out-first-window');
    const ra = await cli([fresh, '--year', '2025', '--json', '--out', a]);
    const rb = await cli([fresh, '--since', '2025-01-01', '--until', '2025-12-31', '--json', '--out', b]);
    assert.equal(ra.code, 0, ra.stderr);
    assert.equal(rb.code, 0, rb.stderr);
    assert.equal('yearOverYear' in JSON.parse(readFileSync(join(a, 'stats.json'), 'utf8')).stats, false);
    assert.equal(readFileSync(join(a, 'stats.json'), 'utf8'), readFileSync(join(b, 'stats.json'), 'utf8'));
    assert.deepEqual(readDirFiles(join(a, 'cards')), readDirFiles(join(b, 'cards')));
    assert.equal(readFileSync(join(a, 'wrapped.html'), 'utf8'), readFileSync(join(b, 'wrapped.html'), 'utf8'));
    assert.equal(ra.stdout.replaceAll(a, b), rb.stdout);
    assert.ok(!/vs 2024/.test(ra.stdout));
  });

  test('without --year nothing is compared, even for a whole-year window', async () => {
    const out = join(tmp, 'out-window');
    const r = await cli([repo, '--since', '2025-01-01', '--until', '2025-12-31', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal('yearOverYear' in JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats, false);
    assert.ok(!/vs 2024/.test(r.stdout));
    assert.ok(!Object.values(readDirFiles(join(out, 'cards'))).some((svg) => svg.includes('vs 2024')));
    const all = await cli([repo, '--json', '--out', join(tmp, 'out-all')]);
    assert.equal('yearOverYear' in JSON.parse(readFileSync(join(tmp, 'out-all', 'stats.json'), 'utf8')).stats, false);
    assert.ok(!/ vs \d{4}/.test(all.stdout));
  });

  test('a quiet year (no commits) skips the previous-year read and shows no comparison', async () => {
    const out = join(tmp, 'out-quiet');
    const r = await cli([fresh, '--year', '2026', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal('yearOverYear' in JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats, false);
  });
  test('--max-commits cutting the previous year short adds a note (en + tr)', async () => {
    const heavy = makeRepo(join(tmp, 'heavy'), [
      { date: day('2024-01-01'), lines: 1 },
      { date: day('2024-02-01'), lines: 2 },
      { date: day('2024-03-01'), lines: 3 },
      { date: day('2025-01-01'), lines: 4 },
    ]);
    const r = await cli([heavy, '--year', '2025', '--max-commits', '2', '--json', '--out', join(tmp, 'out-heavy')]);
    assert.equal(r.code, 0, r.stderr);
    const y = JSON.parse(readFileSync(join(tmp, 'out-heavy', 'stats.json'), 'utf8')).stats.yearOverYear;
    assert.equal(y.previousTruncated, true);
    assert.deepEqual(y.commits, { current: 1, previous: 2, delta: -1 });
    assert.match(r.stdout, /Note: 2024 has more than 2 matching commits; the comparison with it counts only its most recent 2\./);
    assert.ok(!/only the most recent 2 were analyzed/.test(r.stdout), 'this year was not truncated');
    const t = await cli([heavy, '--year', '2025', '--max-commits', '2', '--lang', 'tr', '--out', join(tmp, 'out-heavy-tr')]);
    assert.match(t.stdout, /Not: 2024 yılında eşleşen commit sayısı 2 üzerinde/);
    const ok = await cli([heavy, '--year', '2025', '--out', join(tmp, 'out-heavy-ok')]);
    assert.ok(!/Note: 2024/.test(ok.stdout));
  });

  test('a failing previous-year read skips the comparison with a warning; the run succeeds', async () => {
    const failing = async (p, opts) => {
      if (opts?.since === '2024-01-01') throw new Error('boom\nsecond line');
      return readHistory(p, opts);
    };
    const r = await cli([repo, '--year', '2025', '--json', '--out', join(tmp, 'out-fail')], { readHistory: failing });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, 'gitwrapped: year-over-year comparison skipped: boom\n');
    assert.equal('yearOverYear' in JSON.parse(readFileSync(join(tmp, 'out-fail', 'stats.json'), 'utf8')).stats, false);
    assert.ok(!/vs 2024/.test(r.stdout));
    const g = await generate({ path: repo, year: '2025', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'out-fail-2'), png: false }, { today: TODAY, readHistory: failing });
    assert.equal(g.previousYearError, 'boom');
    const fine = await generate({ path: repo, year: '2025', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'out-fail-3'), png: false }, { today: TODAY });
    assert.equal(fine.previousYearError, null);
  });

  test('the previous year is read only for an exact --year window with commits', async () => {
    const calls = [];
    const spy = async (p, opts) => {
      calls.push(opts?.since);
      return readHistory(p, opts);
    };
    // This year empty: no second read.
    await generate({ path: fresh, year: '2026', since: '2026-01-01', until: '2026-12-31', out: join(tmp, 'out-spy-1'), png: false }, { today: TODAY, readHistory: spy });
    assert.deepEqual(calls, ['2026-01-01']);
    // `year` with a window that is not exactly that year: no second read, no comparison.
    calls.length = 0;
    const r = await generate({ path: repo, year: '2025', since: '2025-03-01', until: '2025-12-31', out: join(tmp, 'out-spy-2'), png: false }, { today: TODAY, readHistory: spy });
    assert.deepEqual(calls, ['2025-03-01']);
    assert.equal('yearOverYear' in r.stats, false);
    // The real thing: two reads.
    calls.length = 0;
    await generate({ path: repo, year: '2025', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'out-spy-3'), png: false }, { today: TODAY, readHistory: spy });
    assert.deepEqual(calls, ['2025-01-01', '2024-01-01']);
  });

  test('.mailmap applies to the previous year (email changed between years)', async () => {
    const mm = makeRepo(join(tmp, 'mailmapped'), [
      { date: day('2024-04-01'), lines: 2, email: 'old@example.com' },
      { date: day('2024-04-02'), lines: 1, email: 'old@example.com' },
      { date: day('2025-04-01'), lines: 3, email: 'new@example.com' },
    ]);
    writeFileSync(join(mm, '.mailmap'), 'Ada <new@example.com> <old@example.com>\n');
    const r = await cli([mm, '--year', '2025', '--author', 'new@example.com', '--json', '--out', join(tmp, 'out-mm')]);
    assert.equal(r.code, 0, r.stderr);
    const y = JSON.parse(readFileSync(join(tmp, 'out-mm', 'stats.json'), 'utf8')).stats.yearOverYear;
    assert.deepEqual(y.commits, { current: 1, previous: 2, delta: -1 });
  });
});
