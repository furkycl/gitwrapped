// Year-over-year (--year), adversarial: author-local year boundaries (−05:00 / +14:00)
// consistent with the window filter, in every machine timezone; a leap year's Feb 29;
// --year 1970 (the previous year, 1969, is before anything git can store); themes + tr
// layout with the comparison rows; stats.json shape; PNG / share image; --no-color recap.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCards, buildCardSpecs, layoutCard, renderShareCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { generate, run } from '../src/cli.js';
import { readHistory } from '../src/git.js';
import { computeStats, computeYearOverYear, yearOverYear } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { loadResvg, pngSize, renderPng } from '../src/png.js';

const TODAY = '2026-10-06';
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADA = { name: 'Ada', email: 'ada@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
}
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });

let tmp;
/** A repo at <tmp>/<name>; each commit is [who, ISO date with offset]; empty commits. */
function makeRepo(name, commits) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [i, [who, date]] of commits.entries()) {
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', `feat: c${i}`], {
      GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email,
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

async function cli(argv, { color = false } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run([...argv, '--no-png', ...(color ? [] : ['--no-color'])], {
    stdout: { write: (s) => { stdout += s; return true; } },
    stderr: { write: (s) => { stderr += s; return true; } },
    env: {},
    today: TODAY,
  });
  return { code, stdout, stderr };
}

function bin(args, tz) {
  return spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: tz }) });
}

const readJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
const cardSvg = (out, id) => {
  const f = readdirSync(join(out, 'cards')).find((n) => n.endsWith(`-${id}.svg`));
  return readFileSync(join(out, 'cards', f), 'utf8');
};

let boundary;
let leap;
let epoch;
let tzOnly;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gw-yoy-x-'));
  // Author-local years: 2024-12-31T23:30-05:00 is 2025-01-01 in UTC but 2024 for the
  // author; 2025-01-01T00:30+14:00 is 2024-12-31 in UTC but 2025 for the author.
  boundary = makeRepo('boundary', [
    [ADA, '2024-06-01T12:00:00+00:00'],
    [ADA, '2024-12-31T23:30:00-05:00'],
    [BOB, '2025-01-01T00:30:00+14:00'],
    [ADA, '2025-07-01T12:00:00+00:00'],
    [ADA, '2025-12-31T23:59:00-12:00'], // 2026-01-01 UTC, 2025 for the author
    [BOB, '2026-01-01T00:10:00+14:00'], // 2025-12-31 UTC, 2026 for the author
  ]);
  // Leap year 2024: Feb 28, Feb 29, Mar 1, Dec 31 (day 366) are 4 distinct active days.
  leap = makeRepo('leap', [
    [ADA, '2023-02-28T12:00:00+00:00'],
    [ADA, '2023-03-01T12:00:00+00:00'],
    [ADA, '2024-02-28T12:00:00+00:00'],
    [ADA, '2024-02-29T12:00:00+00:00'],
    [ADA, '2024-02-29T18:00:00+00:00'],
    [ADA, '2024-03-01T12:00:00+00:00'],
    [ADA, '2024-12-31T12:00:00+00:00'],
  ]);
  epoch = makeRepo('epoch', [
    [ADA, '1970-01-02T12:00:00+00:00'],
    [ADA, '1970-06-01T12:00:00+00:00'],
  ]);
  // The previous year has commits; this year's only commit is in 2026 only author-locally.
  tzOnly = makeRepo('tzonly', [
    [ADA, '2025-03-01T12:00:00+00:00'],
    [ADA, '2025-03-02T12:00:00+00:00'],
    [ADA, '2026-01-01T00:30:00+14:00'],
  ]);
});
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

describe('author-local year boundaries', () => {
  test('commits count in the author-local year, both years, as the window filter does', async () => {
    const out = join(tmp, 'o-boundary');
    const r = await cli([boundary, '--year', '2025', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const doc = readJson(out);
    // 2025 (author-local): +14:00 Jan 1, Jul 1, −12:00 Dec 31 → 3 commits, 3 days.
    assert.equal(doc.stats.totals.commits, 3);
    assert.deepEqual(doc.stats.yearOverYear.commits, { current: 3, previous: 2, delta: 1 });
    assert.deepEqual(doc.stats.yearOverYear.activeDays, { current: 3, previous: 2, delta: 1 });
    // The previous year's read gives exactly what a --year 2024 run counts.
    const prev = join(tmp, 'o-boundary-2024');
    const r24 = await cli([boundary, '--year', '2024', '--json', '--out', prev]);
    assert.equal(r24.code, 0, r24.stderr);
    const d24 = readJson(prev);
    assert.equal(d24.stats.totals.commits, doc.stats.yearOverYear.commits.previous);
    assert.equal(d24.stats.totals.activeDays, doc.stats.yearOverYear.activeDays.previous);
    assert.equal(d24.stats.totals.linesAdded + d24.stats.totals.linesRemoved, doc.stats.yearOverYear.lines.previous);
    // 2024 itself: 2023 has no commits → no comparison.
    assert.equal('yearOverYear' in d24.stats, false);
  });

  test('previous-year read matches readHistory with that year\'s bounds', async () => {
    const h = await readHistory(boundary, { since: '2024-01-01', until: '2024-12-31' });
    assert.deepEqual(h.commits.map((c) => c.date), ['2024-12-31T23:30:00-05:00', '2024-06-01T12:00:00+00:00']);
  });

  test('the same comparison in every machine timezone (UTC−12 … UTC+14)', () => {
    const docs = [];
    for (const tz of ['Etc/GMT+12', 'America/New_York', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      const out = join(tmp, `o-tz-${tz.replace(/\W/g, '_')}`);
      const r = bin([boundary, '--year', '2025', '--json', '--out', out], tz);
      assert.equal(r.status, 0, `${tz}: ${r.stderr}`);
      docs.push([tz, readJson(out).stats.yearOverYear]);
    }
    for (const [tz, y] of docs) assert.deepEqual(y, docs[0][1], tz);
  });

  test('this year present only author-locally (+14:00 on Jan 1) still compares against last year', async () => {
    const out = join(tmp, 'o-tzonly');
    const r = await cli([tzOnly, '--year', '2026', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const y = readJson(out).stats.yearOverYear;
    assert.deepEqual(y.commits, { current: 1, previous: 2, delta: -1 });
    assert.deepEqual(y.activeDays, { current: 1, previous: 2, delta: -1 });
    assert.equal(y.previousYear, 2025);
    assert.match(r.stdout, /\n {2}vs 2025 +−1 commit, ±0 lines, −1 active day\n/);
    // --year 2025 sees only the two March commits and no comparison (2024 is empty).
    const out25 = join(tmp, 'o-tzonly-2025');
    await cli([tzOnly, '--year', '2025', '--json', '--out', out25]);
    const d = readJson(out25);
    assert.equal(d.stats.totals.commits, 2);
    assert.equal('yearOverYear' in d.stats, false);
  });
});

describe('leap year and edges of the range', () => {
  test('2024 (leap): Feb 29 is its own active day; 2023 → 2024 deltas', async () => {
    const out = join(tmp, 'o-leap');
    const r = await cli([leap, '--year', '2024', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const y = readJson(out).stats.yearOverYear;
    assert.deepEqual(y.commits, { current: 5, previous: 2, delta: 3 });
    assert.deepEqual(y.activeDays, { current: 4, previous: 2, delta: 2 });
    assert.equal(y.year, 2024);
    assert.equal(y.previousYear, 2023);
    // And 2025 against the leap year: no 2025 commits → no comparison, no crash.
    const r25 = await cli([leap, '--year', '2025', '--json', '--out', join(tmp, 'o-leap-25')]);
    assert.equal(r25.code, 0, r25.stderr);
    assert.equal('yearOverYear' in readJson(join(tmp, 'o-leap-25')).stats, false);
  });

  test('--year 1970: the previous year (1969) is out of git\'s range: no crash, no comparison', async () => {
    const out = join(tmp, 'o-1970');
    const r = await cli([epoch, '--year', '1970', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const doc = readJson(out);
    assert.equal(doc.stats.totals.commits, 2);
    assert.equal('yearOverYear' in doc.stats, false);
    assert.ok(!/vs 1969/.test(r.stdout));
    assert.ok(!/vs 1969/.test(cardSvg(out, 'totals')));
    // Same via the real binary in a far-east timezone (local 1969-12-25 bound math).
    const b = bin([epoch, '--year', '1970', '--json', '--out', join(tmp, 'o-1970-bin')], 'Pacific/Kiritimati');
    assert.equal(b.status, 0, b.stderr);
  });

  test('--year 1971 compares against 1970', async () => {
    const repo = makeRepo('epoch2', [
      [ADA, '1970-01-02T12:00:00+00:00'],
      [ADA, '1971-05-05T12:00:00+00:00'],
    ]);
    const out = join(tmp, 'o-1971');
    const r = await cli([repo, '--year', '1971', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readJson(out).stats.yearOverYear.commits, { current: 1, previous: 1, delta: 0 });
  });

  test('generate() with a numeric year, and with a malformed year, does not crash', async () => {
    const a = await generate({ path: boundary, year: 2025, since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'o-num'), png: false }, { today: TODAY });
    assert.equal(a.stats.yearOverYear.previousYear, 2024);
    const b = await generate({ path: boundary, year: '25', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'o-bad'), png: false }, { today: TODAY });
    assert.equal('yearOverYear' in b.stats, false);
  });
});

describe('stats.json shape', () => {
  test('yearOverYear has exactly the documented keys and integer metrics', async () => {
    const out = join(tmp, 'o-shape');
    const r = await cli([boundary, '--year', '2025', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const doc = readJson(out);
    const y = doc.stats.yearOverYear;
    assert.deepEqual(Object.keys(y), ['year', 'previousYear', 'commits', 'lines', 'activeDays', 'previousTruncated']);
    assert.equal(typeof y.year, 'number');
    assert.equal(y.previousYear, y.year - 1);
    for (const k of ['commits', 'lines', 'activeDays']) {
      assert.deepEqual(Object.keys(y[k]), ['current', 'previous', 'delta'], k);
      for (const v of Object.values(y[k])) assert.ok(Number.isInteger(v), `${k}: ${v}`);
      assert.equal(y[k].delta, y[k].current - y[k].previous, k);
    }
    assert.equal(y.commits.current, doc.stats.totals.commits);
    assert.equal(y.activeDays.current, doc.stats.totals.activeDays);
    assert.equal(y.previousTruncated, false);
    assert.equal(Object.keys(doc.stats).at(-1), 'yearOverYear');
    // The filters still say what this year's window was.
    assert.equal(doc.filters.since, '2025-01-01');
    assert.equal(doc.filters.until, '2025-12-31');
  });

  test('computeYearOverYear ignores garbage in totals and previous commits', () => {
    const y = computeYearOverYear({ commits: 2, linesAdded: -5, linesRemoved: Number.NaN, activeDays: Infinity }, { year: 2025, commits: [{ date: '2024-01-01T00:00:00+00:00', linesAdded: 1, linesRemoved: 0, files: [] }] });
    assert.ok(y);
    for (const k of ['commits', 'lines', 'activeDays']) for (const v of Object.values(y[k])) assert.ok(Number.isFinite(v), `${k} ${v}`);
    assert.equal(computeYearOverYear(null, { year: 2025, commits: [] }), null);
    assert.equal(yearOverYear({ yearOverYear: { previousYear: 2024, commits: { delta: Infinity }, lines: { delta: 1 }, activeDays: { delta: 1 } } }), null);
  });
});

// --- rendering ------------------------------------------------------------------------------

const commit = (hash, date, email = 'ada@example.com', author = 'Ada') => ({
  hash, author, email, date, parents: ['p'], subject: `feat: ${hash}`,
  files: [{ path: 'src/a.js', added: 3, removed: 1, binary: false }], filesChanged: 1, linesAdded: 3, linesRemoved: 1,
});
const NOW = [commit('a', '2025-02-01T12:00:00+00:00'), commit('b', '2025-05-01T12:00:00+00:00', 'bob@example.com', 'Bob'), commit('c', '2025-05-02T12:00:00+00:00')];
const PREV = [commit('p', '2024-02-01T12:00:00+00:00')];
const statsWithYoy = () => {
  const s = computeStats(NOW, { today: TODAY, previousYear: { year: 2025, commits: PREV } });
  // Extreme deltas to stress widths.
  s.yearOverYear = { ...s.yearOverYear, commits: { current: 50000, previous: 1, delta: 49999 }, lines: { current: 0, previous: 98765432, delta: -98765432 }, activeDays: { current: 1, previous: 366, delta: -365 } };
  return s;
};
const OPTS = { repoName: 'some-quite-long-repository-name', since: '2025-01-01', until: '2025-12-31', today: TODAY };

describe('themes, lang and layout with the comparison', () => {
  for (const colorTheme of ['default', 'mono', 'neon']) {
    for (const lang of ['en', 'tr']) {
      test(`${colorTheme}/${lang}: totals + outro fit, no overlaps, no bad numbers`, () => {
        const stats = statsWithYoy();
        const specs = buildCardSpecs(stats, { ...OPTS, lang, colorTheme });
        for (const id of ['totals', 'outro']) {
          const { spec } = specs.find((c) => c.id === id);
          const { blocks } = layoutCard(spec);
          for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${id}/${b.kind}`);
          for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
              assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${id}: ${blocks[i].kind} overlaps ${blocks[j].kind}`);
            }
          }
        }
        const cards = buildCards(stats, { ...OPTS, lang, colorTheme });
        const totals = cards.find((c) => c.id === 'totals').svg;
        const outro = cards.find((c) => c.id === 'outro').svg;
        assert.ok(totals.includes(lang === 'en' ? 'Active days vs 2024' : 'Gün farkı (2024)'));
        assert.ok(totals.includes(lang === 'en' ? '+49,999' : '+49.999'));
        assert.ok(totals.includes(lang === 'en' ? '−98,765,432' : '−98.765.432'));
        assert.ok(outro.includes(lang === 'en' ? 'vs 2024:' : '2024 yılına göre:'));
        for (const svg of [totals, outro]) assert.ok(!/NaN|undefined|Infinity|−0\b|null/.test(svg));
      });
    }
  }

  test('totals rows: the comparison keeps the same row order in every theme', () => {
    const labels = (colorTheme) => buildCardSpecs(statsWithYoy(), { ...OPTS, colorTheme }).find((c) => c.id === 'totals').spec.lines.map((r) => r.label);
    assert.deepEqual(labels('mono'), labels('default'));
    assert.deepEqual(labels('neon'), labels('default'));
    assert.equal(labels('default').length, 6);
  });
});

describe('share image and PNG', () => {
  test('share card is unaffected by the comparison and has no bad numbers', () => {
    const withY = computeStats(NOW, { today: TODAY, previousYear: { year: 2025, commits: PREV } });
    const plain = computeStats(NOW, { today: TODAY });
    for (const colorTheme of ['default', 'mono', 'neon']) {
      for (const lang of ['en', 'tr']) {
        const a = renderShareCard(withY, { ...OPTS, lang, colorTheme });
        assert.equal(a, renderShareCard(plain, { ...OPTS, lang, colorTheme }));
        assert.ok(!/NaN|undefined|Infinity/.test(a));
      }
    }
  });

  test('totals, outro and share rasterize to PNGs of the expected size', async (t) => {
    try {
      await loadResvg();
    } catch {
      t.skip('resvg not available');
      return;
    }
    const stats = statsWithYoy();
    for (const lang of ['en', 'tr']) {
      const cards = buildCards(stats, { ...OPTS, lang, colorTheme: 'neon' });
      for (const id of ['totals', 'outro']) {
        const buf = await renderPng(cards.find((c) => c.id === id).svg, { width: 1080 });
        assert.equal(pngSize(buf).width, 1080, `${lang}/${id}`);
      }
      const share = await renderPng(renderShareCard(stats, { ...OPTS, lang }), { width: 1200 });
      assert.equal(pngSize(share).width, 1200);
    }
  });

  test('end to end with PNGs (injected renderer sees the comparison)', async () => {
    const seen = [];
    const r = await generate({ path: boundary, year: '2025', since: '2025-01-01', until: '2025-12-31', out: join(tmp, 'o-png'), png: true, theme: 'mono', lang: 'tr' }, {
      today: TODAY,
      renderPng: async (svg, { width }) => { seen.push(svg); return Buffer.from(`png${width}`); },
    });
    assert.ok(r.stats.yearOverYear);
    assert.ok(seen.some((s) => s.includes('Commit farkı (2024)')));
    assert.equal(readFileSync(join(tmp, 'o-png', 'share.png'), 'utf8'), 'png1200');
  });
});

describe('recap', () => {
  test('--no-color recap: plain "vs <year>" line, no ANSI anywhere', async () => {
    const r = await cli([boundary, '--year', '2025', '--out', join(tmp, 'o-nocolor')]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!/\x1b\[/.test(r.stdout), 'no escape codes');
    assert.match(r.stdout, /\n {2}vs 2024 +\+1 commit, ±0 lines, \+1 active day\n/);
    const tr = await cli([boundary, '--year', '2025', '--lang', 'tr', '--out', join(tmp, 'o-nocolor-tr')]);
    assert.ok(!/\x1b\[/.test(tr.stdout));
    assert.match(tr.stdout, /\n {2}2024 ile fark +\+1 commit, ±0 satır, \+1 aktif gün\n/);
  });

  test('formatSummary: the vs line sits once, with and without color', () => {
    const s = computeStats(NOW, { today: TODAY, previousYear: { year: 2025, commits: PREV } });
    const plain = formatSummary(s, { repoName: 'app', window: '2025' });
    assert.equal(plain.match(/vs 2024/g).length, 1);
    assert.ok(!/\x1b\[/.test(plain));
    const colored = formatSummary(s, { repoName: 'app', window: '2025', color: true });
    assert.equal(colored.replace(/\x1b\[\d+m/g, ''), plain);
  });
});
