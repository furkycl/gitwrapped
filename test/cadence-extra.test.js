// Extra edge cases for cadence (src/stats/cadence.js): unsorted / duplicate input, huge
// gaps, author-local days at extreme offsets, year boundaries and leap days, rounding,
// consistency with totals, the recap / wrapped.md / streak card in en and tr, and the CLI
// with --since / --until / --year / --author and several repos.
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeCadence, computeStats, medianGap, shownCadence, epochDay } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const dayAt = (start, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
const onDays = (offsets, per = 1, start = '2026-08-01') => offsets.flatMap((i) => Array.from({ length: per }, () => commit(`${dayAt(start, i)}T12:00:00Z`)));
const days = (list) => list.map(([day, commits]) => ({ day, commits }));
const streakOf = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'streak');
const streakSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'streak').spec;
const withoutCadence = (stats) => ({ ...stats, daily: { ...stats.daily, days: stats.daily.days.slice(-1) } });
const BAD = /NaN|Infinity|undefined|\[object Object\]/;

describe('computeCadence: extra edge cases', () => {
  test('unsorted input with duplicate days → the same as sorted, merged', () => {
    const sorted = computeCadence(days([['2026-01-01', 2], ['2026-01-02', 1], ['2026-01-05', 3], ['2026-01-10', 1]]));
    const messy = computeCadence(days([['2026-01-10', 1], ['2026-01-05', 1], ['2026-01-01', 1], ['2026-01-05', 2], ['2026-01-02', 1], ['2026-01-01', 1]]));
    assert.deepEqual(messy, sorted);
    // 7 commits / 4 days = 1.75 → 1.8; gaps 1, 3, 5 → 3
    assert.deepEqual(sorted, { perActiveDay: 1.8, medianGapDays: 3 });
  });

  test('duplicate days never make a 0 gap', () => {
    assert.deepEqual(computeCadence(days([['2026-01-01', 1], ['2026-01-01', 1], ['2026-01-01', 1], ['2026-01-03', 1]])), { perActiveDay: 2, medianGapDays: 2 });
  });

  test('medianGap does not mutate its input; fewer than two days → null', () => {
    const input = [0, 10, 11, 30];
    const copy = [...input];
    assert.equal(medianGap(input), 10); // gaps 10, 1, 19 → sorted 1, 10, 19 → 10
    assert.deepEqual(input, copy);
    assert.equal(medianGap([5]), null);
    assert.equal(medianGap(null), null);
  });

  test('gaps of years and across centuries are exact calendar-day counts', () => {
    const c = computeCadence(days([['2000-01-01', 1], ['2026-01-01', 1]]));
    assert.equal(c.medianGapDays, epochDay('2026-01-01') - epochDay('2000-01-01'));
    assert.equal(c.medianGapDays, 9497);
    const century = computeCadence(days([['1899-12-31', 1], ['1900-03-01', 1], ['2100-03-01', 1]]));
    // 1900 is not a leap year: Dec 31 → Mar 1 = 31 + 28 + 1 = 60 days
    assert.equal(epochDay('1900-03-01') - epochDay('1899-12-31'), 60);
    assert.equal(century.medianGapDays, (60 + (epochDay('2100-03-01') - epochDay('1900-03-01'))) / 2);
    assert.ok(Number.isFinite(century.medianGapDays));
  });

  test('year boundaries and leap days count as consecutive days', () => {
    assert.equal(computeCadence(days([['2025-12-31', 1], ['2026-01-01', 1]])).medianGapDays, 1);
    assert.equal(computeCadence(days([['2024-02-28', 1], ['2024-02-29', 1], ['2024-03-01', 1]])).medianGapDays, 1);
    assert.equal(computeCadence(days([['2023-02-28', 1], ['2023-03-01', 1]])).medianGapDays, 1);
    assert.equal(computeCadence(days([['2024-02-28', 1], ['2024-03-01', 1]])).medianGapDays, 2);
    // 2023-02-29 does not exist: skipped
    assert.deepEqual(computeCadence(days([['2023-02-29', 5], ['2023-03-01', 1]])), { perActiveDay: 1, medianGapDays: null });
  });

  test('perActiveDay rounding to one decimal', () => {
    const spread = (counts) => counts.map((c, i) => ({ day: dayAt('2026-01-01', i * 2), commits: c }));
    assert.equal(computeCadence(spread([2, 1, 1, 1])).perActiveDay, 1.3); // 1.25
    assert.equal(computeCadence(spread([...Array(19).fill(3), 2])).perActiveDay, 3); // 2.95
    assert.equal(computeCadence(spread([...Array(99).fill(10), 9])).perActiveDay, 10); // 9.99
    assert.equal(computeCadence(spread([1, 1, 2])).perActiveDay, 1.3); // 1.333
    assert.equal(computeCadence(spread([1, 2, 2])).perActiveDay, 1.7); // 1.667
    assert.equal(computeCadence(spread([1000000, 1])).perActiveDay, 500000.5);
  });

  test('perActiveDay × activeDays ≈ commits, across many histories', () => {
    for (let seed = 1; seed < 60; seed++) {
      const offsets = [];
      let at = 0;
      for (let i = 0; i < (seed % 13) + 1; i++) { at += (seed * (i + 3)) % 11; offsets.push(at); }
      const commits = offsets.flatMap((o, i) => onDays([o], ((seed + i) % 5) + 1));
      const s = statsOf(commits);
      const active = s.totals.activeDays;
      assert.ok(Math.abs(s.cadence.perActiveDay * active - commits.length) <= 0.05 * active + 1e-9, `seed ${seed}`);
      assert.equal(active, s.daily.days.length, `seed ${seed}`);
      if (active < 2) assert.equal(s.cadence.medianGapDays, null);
      else {
        assert.ok(s.cadence.medianGapDays >= 1, `seed ${seed}`);
        assert.ok(Number.isInteger(s.cadence.medianGapDays * 2), `seed ${seed}: whole or .5`);
      }
    }
  });
});

describe('cadence: author-local days at extreme offsets', () => {
  test('+14:00 and -12:00 at the same instant are two different local days', () => {
    // 2026-03-01T11:00Z is 2026-03-02 01:00 at +14:00 and 2026-02-28 23:00 at -12:00.
    const s = statsOf([commit('2026-03-02T01:00:00+14:00'), commit('2026-02-28T23:00:00-12:00')]);
    assert.equal(s.totals.activeDays, 2);
    assert.deepEqual(s.cadence, { perActiveDay: 1, medianGapDays: 2 });
  });

  test('different UTC days that share one local day are one active day', () => {
    // Local 2026-03-01 at -12:00 (Mar 1 13:00Z) and +14:00 (Feb 28 11:00Z).
    const s = statsOf([commit('2026-03-01T01:00:00-12:00'), commit('2026-03-01T01:00:00+14:00'), commit('2026-03-03T12:00:00Z')]);
    assert.equal(s.totals.activeDays, 2);
    assert.deepEqual(s.cadence, { perActiveDay: 1.5, medianGapDays: 2 });
  });

  test('local midnight across a year boundary', () => {
    const s = statsOf([commit('2025-12-31T23:59:59+05:30'), commit('2026-01-01T00:00:00+05:30')]);
    assert.deepEqual(s.cadence, { perActiveDay: 1, medianGapDays: 1 });
  });

  test('a local leap day', () => {
    // 2024-02-29 local at -12:00 is 2024-03-01 UTC
    const s = statsOf([commit('2024-02-28T10:00:00Z'), commit('2024-02-29T20:00:00-12:00'), commit('2024-03-01T10:00:00Z')]);
    assert.equal(s.totals.activeDays, 3);
    assert.deepEqual(s.cadence, { perActiveDay: 1, medianGapDays: 1 });
  });
});

describe('shownCadence: future-dated days', () => {
  test('one past day + future-dated days → null (one shown day)', () => {
    const s = statsOf([commit('2026-08-01T12:00:00Z'), commit('2031-01-01T10:00:00Z'), commit('2032-01-01T10:00:00Z')]);
    assert.equal(s.cadence.medianGapDays !== null, true, 'stats.json keeps the raw gap');
    assert.equal(shownCadence(s, TODAY), null);
    assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY }), /Cadence/);
    assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /Cadence/);
    assert.equal(streakSpec(s).lines, undefined);
  });

  test('today + 1 is kept (the time zone grace day)', () => {
    const s = statsOf([commit('2026-10-06T12:00:00Z'), commit('2026-10-08T12:00:00Z'), commit('2026-10-09T12:00:00Z')]);
    assert.deepEqual(shownCadence(s, TODAY), { perActiveDay: 1, medianGapDays: 2, activeDays: 2 });
  });

  test('malformed stats never throw', () => {
    for (const bad of [undefined, null, {}, { daily: null }, { daily: { days: 'x' } }, { daily: { days: [null, 3] } }]) {
      assert.equal(shownCadence(bad, TODAY), null);
      assert.equal(shownCadence(bad, 'not-a-day'), null);
    }
  });
});

describe('cadence: stats.json shape', () => {
  test('numbers or null, never strings, NaN or missing', () => {
    for (const commits of [[], onDays([0]), onDays([0, 1, 5], 3), [commit('not a date'), ...onDays([0, 4])]]) {
      const doc = JSON.parse(buildStatsJson({ stats: statsOf(commits), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
      const c = doc.stats.cadence;
      assert.deepEqual(Object.keys(c).sort(), ['medianGapDays', 'perActiveDay']);
      assert.equal(typeof c.perActiveDay, 'number');
      assert.ok(Number.isFinite(c.perActiveDay));
      assert.ok(c.medianGapDays === null || (typeof c.medianGapDays === 'number' && Number.isFinite(c.medianGapDays)));
    }
    const empty = JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(empty.stats.cadence, { perActiveDay: 0, medianGapDays: null });
  });

  test('undated commits do not count', () => {
    const s = statsOf([commit('not a date'), commit(''), ...onDays([0, 2], 2)]);
    assert.deepEqual(s.cadence, { perActiveDay: 2, medianGapDays: 2 });
  });
});

describe('cadence: tr decimal comma everywhere', () => {
  // 4 commits / 3 days = 1.3; gaps 1, 2 → 1.5
  const s = statsOf([...onDays([0], 2), ...onDays([1, 3])]);

  test('recap and wrapped.md', () => {
    assert.deepEqual(s.cadence, { perActiveDay: 1.3, medianGapDays: 1.5 });
    const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(recap, /Ritim +Aktif gün başına 1,3 commit · 1,5 günde bir\n/);
    assert.doesNotMatch(recap, /1\.3|1\.5 günde/);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(md, /^- \*\*Ritim:\*\* Aktif gün başına 1,3 commit · 1,5 günde bir$/m);
    const recapEn = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(recapEn, /Cadence +1\.3 commits per active day · every 1\.5 days\n/);
  });

  test('streak card: a row uses the comma, or no row at all', () => {
    const spec = streakSpec(s, 'tr');
    const card = streakOf(s, 'tr').svg;
    if (spec.lines) {
      assert.deepEqual(spec.lines, [{ label: 'Aktif günde 1,3 commit', value: '1,5 günde bir', description: 'Aktif gün başına 1,3 commit · 1,5 günde bir' }]);
      assert.ok(card.includes('>Aktif günde 1,3 commit<'));
    } else {
      assert.equal(card, streakOf(withoutCadence(s), 'tr').svg);
    }
    assert.doesNotMatch(card, /Aktif günde 1\.3|1\.5 günde/);
  });

  test('a thousands gap: en comma grouping, tr dot grouping', () => {
    const big = statsOf([commit('2000-01-01T12:00:00Z'), commit('2026-01-01T12:00:00Z')]);
    assert.match(formatSummary(big, { repoName: 'demo', today: TODAY }), /every 9,497 days/);
    assert.match(formatSummary(big, { repoName: 'demo', today: TODAY, lang: 'tr' }), /9\.497 günde bir/);
  });
});

describe('cadence: streak card stays byte-identical when the row is not shown', () => {
  test('huge gaps: a whole row or the card as before', () => {
    for (const lang of ['en', 'tr']) {
      for (const dates of [
        ['2000-01-01T12:00:00Z', '2026-01-01T12:00:00Z'],
        ['1999-06-01T12:00:00Z', '2010-06-01T12:00:00Z', '2026-06-01T12:00:00Z', '2026-06-02T12:00:00Z'],
      ]) {
        const s = statsOf(dates.map((d) => commit(d)));
        const spec = streakSpec(s, lang);
        const card = streakOf(s, lang).svg;
        if (spec.lines) {
          assert.equal(spec.lines.length, 1);
          assert.ok(card.includes(`>${spec.lines[0].label}<`) && card.includes(`>${spec.lines[0].value}<`), `${lang} whole row`);
        } else {
          assert.equal(card, streakOf(withoutCadence(s), lang).svg, `${lang} unchanged`);
        }
      }
    }
  });

  test('cadence only from future-dated days → no row, card equals the one-day card', () => {
    const s = statsOf([commit('2026-08-01T12:00:00Z'), commit('2031-01-01T10:00:00Z')]);
    assert.equal(streakSpec(s).lines, undefined);
    assert.doesNotMatch(streakOf(s).svg, /per active day/);
  });
});

describe('cadence: no NaN / Infinity / undefined in any output', () => {
  test('recap, wrapped.md, cards and stats.json over many histories, en and tr', () => {
    const histories = [
      [],
      onDays([0]),
      onDays([0, 1]),
      onDays([0, 400, 800], 7),
      [commit('2000-01-01T12:00:00Z'), commit('2026-01-01T12:00:00Z')],
      [commit('2026-03-02T01:00:00+14:00'), commit('2026-02-28T23:00:00-12:00')],
      [commit('2026-08-01T12:00:00Z'), commit('2031-01-01T10:00:00Z')],
      [commit('2031-01-01T10:00:00Z'), commit('2031-01-05T10:00:00Z')],
      [commit('garbage'), ...onDays([0, 3])],
    ];
    for (const [i, h] of histories.entries()) {
      const s = statsOf(h);
      for (const lang of ['en', 'tr']) {
        const label = `history ${i} ${lang}`;
        const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang });
        const cadenceLine = recap.split('\n').find((l) => /Cadence|Ritim/.test(l)) ?? '';
        assert.doesNotMatch(cadenceLine, BAD, label);
        const md = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang });
        const mdLine = md.split('\n').find((l) => /Cadence|Ritim/.test(l)) ?? '';
        assert.doesNotMatch(mdLine, BAD, label);
        const card = streakOf(s, lang);
        assert.doesNotMatch(card.svg, /NaN|Infinity|undefined/, label);
        assert.doesNotMatch(card.description ?? '', /NaN|Infinity|undefined/, label);
      }
      const json = buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY });
      assert.doesNotMatch(json, /NaN|Infinity/, `history ${i}`);
    }
  });
});

describe('cadence: CLI windows, authors and repos', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  /** entries: a date string (ada) or [date, email]. */
  const repo = (name, entries) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const [i, e] of entries.entries()) {
      const [date, email] = Array.isArray(e) ? e : [e, 'ada@example.com'];
      const name = email.split('@')[0];
      git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${i}`], {
        GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
      });
    }
    return dir;
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
  const md = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');

  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'gw-cadence-extra-')); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('--until: days after the window are left out', () => {
    const dir = repo('until', ['2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z', '2026-03-03T10:00:00Z', '2026-03-10T10:00:00Z', '2026-03-20T10:00:00Z']);
    const out = join(tmp, 'until-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--until', '2026-03-05']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 2);
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 1.5, medianGapDays: 2 });
    assert.match(r.stdout, /Cadence +1\.5 commits per active day · every 2 days/);
    assert.match(md(out), /\*\*Cadence:\*\* 1\.5 commits per active day · every 2 days$/m);
  });

  test('--since + --until: one active day in the window → null gap, no line', () => {
    const dir = repo('window-one', ['2026-03-01T10:00:00Z', '2026-03-05T10:00:00Z', '2026-03-05T11:00:00Z', '2026-03-09T10:00:00Z']);
    const out = join(tmp, 'window-one-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--since', '2026-03-04', '--until', '2026-03-06']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.cadence, { perActiveDay: 2, medianGapDays: null });
    assert.doesNotMatch(r.stdout, /Cadence/);
    assert.doesNotMatch(md(out), /Cadence/);
  });

  test('--year: only that calendar year (Dec 31 / Jan 1 neighbours left out)', () => {
    const dir = repo('year', ['2024-12-31T12:00:00Z', '2025-01-01T12:00:00Z', '2025-01-01T13:00:00Z', '2025-01-04T12:00:00Z', '2025-12-31T12:00:00Z', '2026-01-01T12:00:00Z']);
    const out = join(tmp, 'year-out');
    const r = bin([dir, '--out', out, '--json', '--year', '2025']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 3);
    // 4 commits / 3 days = 1.3; gaps 3, 361 → 182
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 1.3, medianGapDays: 182 });
    assert.match(r.stdout, /Cadence +1\.3 commits per active day · every 182 days/);
  });

  test('--author: other authors\' days do not count', () => {
    const dir = repo('author', [
      '2026-03-01T10:00:00Z',
      ['2026-03-02T10:00:00Z', 'bob@example.com'],
      ['2026-03-03T10:00:00Z', 'bob@example.com'],
      '2026-03-05T10:00:00Z',
      '2026-03-05T11:00:00Z',
      '2026-03-09T10:00:00Z',
    ]);
    const out = join(tmp, 'author-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--author', 'ADA@example.com']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 3);
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 1.3, medianGapDays: 4 });
    assert.match(md(out), /\*\*Cadence:\*\* 1\.3 commits per active day · every 4 days$/m);
    const all = join(tmp, 'author-all-out');
    const r2 = bin([dir, '--out', all, '--json']);
    assert.equal(r2.status, 0, r2.stderr);
    // all authors: Mar 1, 2, 3, 5, 9 → 6 / 5 = 1.2; gaps 1, 1, 2, 4 → 1.5
    assert.deepEqual(statsJson(all).stats.cadence, { perActiveDay: 1.2, medianGapDays: 1.5 });
  });

  test('several repos with the same days: one active day each, commits summed', () => {
    const a = repo('ov-a', ['2026-03-01T10:00:00Z', '2026-03-02T10:00:00Z', '2026-03-04T10:00:00Z']);
    const b = repo('ov-b', ['2026-03-01T20:00:00Z', '2026-03-02T09:00:00Z', '2026-03-04T23:00:00Z']);
    const c = repo('ov-c', ['2026-03-02T05:00:00+14:00']); // Mar 2 local (Mar 1 UTC)
    const out = join(tmp, 'ov-out');
    const r = bin([a, b, c, '--out', out, '--json', '--lang', 'tr', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.activeDays, 3);
    // 7 / 3 = 2.3; gaps 1, 2 → 1.5
    assert.deepEqual(doc.stats.cadence, { perActiveDay: 2.3, medianGapDays: 1.5 });
    assert.match(r.stdout, /Ritim +Aktif gün başına 2,3 commit · 1,5 günde bir/);
    assert.match(md(out), /\*\*Ritim:\*\* Aktif gün başına 2,3 commit · 1,5 günde bir$/m);
    assert.doesNotMatch(r.stdout + md(out), /NaN|Infinity|undefined/);
  });
});
