// Busiest day: the single author-local calendar day with the most commits in the window
// (ties → the earliest day), as stats.busiestDay (computeStats, src/stats/index.js), and
// shown on the activity card, in the recap and in wrapped.md (shownBusiestDay in
// src/stats/daily.js leaves out future-dated days there).
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { busiestOf, computeDaily, computeStats, shownBusiestDay } from '../src/stats/index.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { generate } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (date, subject = 'work') => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });

// Oct 2 has 3 commits, Oct 1 and Oct 4 have 2 each.
const HISTORY = () => [
  commit('2026-10-01T09:00:00+00:00'),
  commit('2026-10-01T10:00:00+00:00'),
  commit('2026-10-02T09:00:00+00:00'),
  commit('2026-10-02T11:00:00+00:00'),
  commit('2026-10-02T15:00:00+00:00'),
  commit('2026-10-04T09:00:00+00:00'),
  commit('2026-10-04T10:00:00+00:00'),
];

describe('stats.busiestDay', () => {
  test('the day with the most commits, as {day, commits}', () => {
    assert.deepEqual(statsOf(HISTORY()).busiestDay, { day: '2026-10-02', commits: 3 });
  });

  test('ties go to the earliest day, whatever the input order', () => {
    const commits = [
      commit('2026-10-05T09:00:00+00:00'),
      commit('2026-10-05T10:00:00+00:00'),
      commit('2026-10-03T09:00:00+00:00'),
      commit('2026-10-03T10:00:00+00:00'),
      commit('2026-10-04T10:00:00+00:00'),
    ];
    assert.deepEqual(statsOf(commits).busiestDay, { day: '2026-10-03', commits: 2 });
    assert.deepEqual(statsOf([...commits].reverse()).busiestDay, { day: '2026-10-03', commits: 2 });
  });

  test('counts author-local days, across a timezone boundary', () => {
    // 23:30 at -05:00 is already the next day in UTC; 00:30 at +03:00 is still the day
    // before in UTC. By the author's clock both land on the days written in the date.
    const commits = [
      commit('2026-03-01T23:30:00-05:00'),
      commit('2026-03-01T22:00:00-05:00'),
      commit('2026-03-02T00:30:00+03:00'),
      commit('2026-03-02T08:00:00+03:00'),
      commit('2026-03-02T09:00:00+03:00'),
    ];
    // In UTC this would be Mar 1: 1 (21:30Z), Mar 2: 4 (03:00Z, 04:30Z, 05:00Z, 06:00Z).
    assert.deepEqual(statsOf(commits).busiestDay, { day: '2026-03-02', commits: 3 });
    assert.deepEqual(statsOf(commits.slice(0, 3)).busiestDay, { day: '2026-03-01', commits: 2 });
  });

  test('null without commits (or without a parseable date)', () => {
    assert.equal(statsOf([]).busiestDay, null);
    assert.equal(computeStats().busiestDay, null);
    assert.equal(statsOf([commit('not a date')]).busiestDay, null);
  });

  test('is a copy of daily.busiest, right after daily', () => {
    const stats = statsOf(HISTORY());
    assert.deepEqual(stats.busiestDay, stats.daily.busiest);
    assert.notEqual(stats.busiestDay, stats.daily.busiest, 'not the same object');
    const keys = Object.keys(stats);
    assert.equal(keys.indexOf('busiestDay'), keys.indexOf('daily') + 1);
  });

  test('stats.json includes it', () => {
    const doc = JSON.parse(buildStatsJson({ stats: statsOf(HISTORY()), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.busiestDay, { day: '2026-10-02', commits: 3 });
    assert.equal(doc.schemaVersion, 1);
    const empty = JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.ok(Object.hasOwn(empty.stats, 'busiestDay'));
    assert.equal(empty.stats.busiestDay, null);
  });
});

describe('busiestOf / shownBusiestDay', () => {
  test('busiestOf: ties → earliest, invalid entries skipped, null when empty', () => {
    assert.deepEqual(busiestOf([{ day: '2026-01-03', commits: 2 }, { day: '2026-01-02', commits: 2 }, { day: '2026-01-01', commits: 1 }]), { day: '2026-01-02', commits: 2 });
    assert.deepEqual(busiestOf([{ day: 'x', commits: 9 }, { day: '2026-02-30', commits: 9 }, { day: '2026-01-01', commits: 'x' }, { day: '2026-01-05', commits: 1 }, null]), { day: '2026-01-05', commits: 1 });
    assert.equal(busiestOf([]), null);
    assert.equal(busiestOf(undefined), null);
    assert.equal(busiestOf([{ day: '2026-01-01', commits: 0 }]), null);
  });

  test('computeDaily still agrees with busiestOf', () => {
    const d = computeDaily(HISTORY());
    assert.deepEqual(d.busiest, busiestOf(d.days));
  });

  test('stats.busiestDay when nothing is future-dated', () => {
    const stats = statsOf(HISTORY());
    assert.deepEqual(shownBusiestDay(stats, TODAY), { day: '2026-10-02', commits: 3 });
    assert.deepEqual(shownBusiestDay(stats), { day: '2026-10-02', commits: 3 });
  });

  test('future-dated days are left out with `today` (raw stats keep them)', () => {
    const commits = [...HISTORY(), ...[1, 2, 3, 4].map((h) => commit(`2099-01-01T0${h}:00:00+00:00`))];
    const stats = statsOf(commits);
    assert.deepEqual(stats.busiestDay, { day: '2099-01-01', commits: 4 }, 'precondition: the raw stats see 2099');
    assert.deepEqual(shownBusiestDay(stats, TODAY), { day: '2026-10-02', commits: 3 });
    // Without today, nothing is clamped.
    assert.deepEqual(shownBusiestDay(stats), { day: '2099-01-01', commits: 4 });
    // The day after today is the author-timezone grace day: kept.
    const grace = statsOf([...HISTORY(), ...[1, 2, 3, 4].map((h) => commit(`2026-10-08T0${h}:00:00+00:00`))]);
    assert.deepEqual(shownBusiestDay(grace, TODAY), { day: '2026-10-08', commits: 4 });
    // Every day in the future: nothing better to show, so they are all kept.
    const allFuture = statsOf([commit('2099-01-01T01:00:00Z'), commit('2099-01-02T01:00:00Z')]);
    assert.deepEqual(shownBusiestDay(allFuture, TODAY), { day: '2099-01-01', commits: 1 });
  });

  test('falls back to daily.busiest; null for empty or invalid stats', () => {
    assert.deepEqual(shownBusiestDay({ daily: { busiest: { day: '2026-01-02', commits: 4 } } }), { day: '2026-01-02', commits: 4 });
    for (const bad of [undefined, null, {}, { busiestDay: null }, { busiestDay: { day: 'nope', commits: 3 } }, { busiestDay: { day: '2026-01-01', commits: NaN } }, { daily: { days: 'x' } }]) {
      assert.equal(shownBusiestDay(bad, TODAY), null, JSON.stringify(bad));
    }
    assert.equal(shownBusiestDay(statsOf([]), TODAY), null);
  });

  test('the activity card calls out the same day', () => {
    const spec = buildCardSpecs(statsOf(HISTORY()), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.match(spec.subtitle, /Busiest day: Oct 2, 2026 with 3 commits\./);
  });
});

describe('activity card vs the whole window (histories longer than 53 weeks)', () => {
  test('the card names the busiest day on its grid; recap, wrapped.md and stats.json the whole window', () => {
    const commits = [
      ...[10, 11, 12, 13, 14].map((h) => commit(`2023-01-05T${h}:00:00+00:00`)),
      commit('2026-09-01T09:00:00+00:00'),
      commit('2026-09-01T10:00:00+00:00'),
    ];
    const stats = statsOf(commits);
    assert.deepEqual(stats.busiestDay, { day: '2023-01-05', commits: 5 });
    assert.deepEqual(shownBusiestDay(stats, TODAY), { day: '2023-01-05', commits: 5 });
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.match(spec.subtitle, /Busiest day: Sep 1, 2026 with 2 commits\./);
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), /Busiest day {2}Jan 5, 2023 \(5 commits\)\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /^- \*\*Busiest day:\*\* Jan 5, 2023 \(5 commits\)$/m);
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.busiestDay, { day: '2023-01-05', commits: 5 });
  });
});

describe('recap and wrapped.md', () => {
  const stats = () => statsOf(HISTORY());

  test('recap: a "Busiest day" line with the date and commit count (en / tr)', () => {
    assert.match(formatSummary(stats(), { repoName: 'demo', today: TODAY }), /\n {2}Busiest day {2}Oct 2, 2026 \(3 commits\)\n/);
    assert.match(formatSummary(stats(), { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}En yoğun gün {5}2 Eki 2026 \(3 commit\)\n/);
    const one = statsOf([commit('2026-10-01T09:00:00Z')]);
    assert.match(formatSummary(one, { repoName: 'demo', today: TODAY }), /Busiest day {2}Oct 1, 2026 \(1 commit\)\n/);
  });

  test('recap: no line without commits; color keeps the same text', () => {
    assert.doesNotMatch(formatSummary(statsOf([]), { repoName: 'demo', today: TODAY }), /Busiest day/);
    const s = stats();
    const colored = formatSummary(s, { repoName: 'demo', today: TODAY, color: true });
    assert.equal(colored.replace(/\x1b\[\d+m/g, ''), formatSummary(s, { repoName: 'demo', today: TODAY }));
  });

  test('recap: future-dated days are left out with today', () => {
    const s = statsOf([...HISTORY(), ...[1, 2, 3, 4].map((h) => commit(`2099-01-01T0${h}:00:00+00:00`))]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /Busiest day {2}Oct 2, 2026 \(3 commits\)/);
    assert.doesNotMatch(out, /2099/);
  });

  test('wrapped.md: a "Busiest day" item next to the busiest weekday (en / tr)', () => {
    const md = buildMarkdown(stats(), { repoName: 'demo', today: TODAY });
    assert.match(md, /^- \*\*Busiest weekday:\*\* .+$/m);
    assert.match(md, /^- \*\*Busiest day:\*\* Oct 2, 2026 \(3 commits\)$/m);
    const habits = md.slice(md.indexOf(`## ${en.markdown.habits}`), md.indexOf(`## ${en.markdown.streaks}`));
    assert.match(habits, /Busiest day:/);
    const trMd = buildMarkdown(stats(), { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(trMd, /^- \*\*En yoğun hafta günü:\*\* .+$/m);
    assert.match(trMd, /^- \*\*En yoğun gün:\*\* 2 Eki 2026 \(3 commit\)$/m);
    assert.ok(!trMd.includes(en.markdown.busiestDay) && !trMd.includes(en.markdown.busiestWeekday));
  });

  test('wrapped.md: left out without commits; future-dated days left out with today', () => {
    assert.doesNotMatch(buildMarkdown(statsOf([]), { repoName: 'demo', today: TODAY }), /Busiest day/);
    const s = statsOf([...HISTORY(), ...[1, 2, 3, 4].map((h) => commit(`2099-01-01T0${h}:00:00+00:00`))]);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /^- \*\*Busiest day:\*\* Oct 2, 2026 \(3 commits\)$/m);
  });

  test('i18n: both tables have the recap and markdown labels', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.recap.busiestDay, 'string');
      assert.equal(typeof L.markdown.busiestDay, 'string');
      assert.equal(typeof L.markdown.busiestWeekday, 'string');
      assert.notEqual(L.markdown.busiestDay, L.markdown.busiestWeekday);
    }
  });
});

// --- edge cases: multi-repo, --author, merges, end to end -----------------------------

describe('busiestDay: edge cases on computed stats', () => {
  test('multi-repo: days are summed across repos (a day busy in two repos wins)', () => {
    // api: Oct 1 x2; web: Oct 2 x1, Oct 3 x2; docs: Oct 2 x2 → Oct 2 has 3 across repos.
    const tag = (c, repo) => ({ ...c, repo, files: c.files.map((f) => ({ ...f, path: `${repo}/${f.path}` })) });
    const commits = [
      tag(commit('2026-10-01T09:00:00+00:00'), 'api'),
      tag(commit('2026-10-01T10:00:00+00:00'), 'api'),
      tag(commit('2026-10-02T09:00:00+00:00'), 'web'),
      tag(commit('2026-10-03T09:00:00+00:00'), 'web'),
      tag(commit('2026-10-03T10:00:00+00:00'), 'web'),
      tag(commit('2026-10-02T11:00:00+00:00'), 'docs'),
      tag(commit('2026-10-02T12:00:00+00:00'), 'docs'),
    ];
    const stats = statsOf(commits, { repos: ['api', 'web', 'docs'] });
    assert.deepEqual(stats.busiestDay, { day: '2026-10-02', commits: 3 });
    assert.ok(Array.isArray(stats.repos), 'precondition: multi-repo stats');
    // Still right after daily (repos stays the last key).
    const keys = Object.keys(stats);
    assert.equal(keys.indexOf('busiestDay'), keys.indexOf('daily') + 1);
    assert.equal(keys.at(-1), 'repos');
    assert.match(formatSummary(stats, { repoName: '3 repos', today: TODAY }), /Busiest day {2}Oct 2, 2026 \(3 commits\)/);
  });

  test('--author run: counts only the filtered commits, not the team history', () => {
    // The team has a huge Oct 5; "you" (ada) are busiest on Oct 2.
    const bob = (date) => ({ ...commit(date), author: 'Bob', email: 'bob@example.com' });
    const mine = HISTORY();
    const team = [...mine, ...[8, 9, 10, 11, 12].map((h) => bob(`2026-10-05T${String(h).padStart(2, '0')}:00:00+00:00`))];
    const stats = statsOf(mine, { team, author: 'ada@example.com' });
    assert.deepEqual(stats.busiestDay, { day: '2026-10-02', commits: 3 });
    assert.equal(stats.contributors.total, 2, 'precondition: the team was ranked');
  });

  test('merge commits count toward their day, like the activity heatmap', () => {
    const merge = (date) => ({ ...commit(date, 'Merge branch x'), parents: ['p1', 'p2'], files: [] });
    const commits = [
      commit('2026-10-01T09:00:00+00:00'),
      commit('2026-10-01T10:00:00+00:00'),
      commit('2026-10-02T09:00:00+00:00'),
      merge('2026-10-02T10:00:00+00:00'),
      merge('2026-10-02T11:00:00+00:00'),
    ];
    const stats = statsOf(commits);
    assert.deepEqual(stats.busiestDay, { day: '2026-10-02', commits: 3 });
    assert.equal(stats.daily.days.find((d) => d.day === '2026-10-02').commits, 3);
  });

  test('single commit; plural forms in the recap; returned objects are fresh', () => {
    const stats = statsOf([commit('2026-02-28T23:59:59+14:00')]);
    assert.deepEqual(stats.busiestDay, { day: '2026-02-28', commits: 1 });
    const shown = shownBusiestDay(stats, TODAY);
    shown.commits = 99;
    assert.equal(stats.busiestDay.commits, 1, 'shownBusiestDay must not alias stats');
  });

  test('leap day and year boundary days are formatted correctly', () => {
    const s = statsOf([commit('2024-02-29T12:00:00Z'), commit('2024-02-29T13:00:00Z'), commit('2024-12-31T12:00:00Z')]);
    assert.deepEqual(s.busiestDay, { day: '2024-02-29', commits: 2 });
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /Busiest day {2}Feb 29, 2024 \(2 commits\)/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /^- \*\*Busiest day:\*\* Feb 29, 2024 \(2 commits\)$/m);
  });
});

describe('busiestDay: end to end', () => {
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
  const at = (date, name = 'Ada', email = 'ada@example.com') => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date });

  let fixture;
  let tmp;
  before(() => {
    fixture = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gw-busiest-'));
  });
  after(() => {
    fixture?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('CLI --json on the fixture repo: stats.json has busiestDay, recap shows it', () => {
    const out = join(tmp, 'all');
    const r = bin([fixture.dir, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    // One commit per author-local day in the fixture: the tie goes to the earliest day.
    assert.deepEqual(doc.stats.busiestDay, { day: '2024-03-04', commits: 1 });
    assert.deepEqual(doc.stats.busiestDay, doc.stats.daily.busiest);
    assert.match(r.stdout, /\n {2}Busiest day {2}Mar 4, 2024 \(1 commit\)\n/);
  });

  test('CLI --author --json --md: busiest day of that author only', () => {
    const out = join(tmp, 'bob');
    const r = bin([fixture.dir, '--out', out, '--json', '--md', '--author', 'bob@example.com']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.busiestDay, { day: '2024-03-05', commits: 1 });
    assert.match(r.stdout, /Busiest day {2}Mar 5, 2024 \(1 commit\)/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /^- \*\*Busiest day:\*\* Mar 5, 2024 \(1 commit\)$/m);
  });

  test('CLI --json on a repo with merge commits: merges count toward the day', () => {
    const dir = join(tmp, 'merges');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'], at('2026-09-01T09:00:00+00:00'));
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'second'], at('2026-09-01T10:00:00+00:00'));
    // Sep 3: one commit on a branch, one on main, then a merge → 3 commits that day.
    git(dir, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'side work'], at('2026-09-03T09:00:00+00:00'));
    git(dir, ['checkout', '-q', 'main']);
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'main work'], at('2026-09-03T10:00:00+00:00'));
    git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'side'], at('2026-09-03T11:00:00+00:00'));
    const out = join(tmp, 'merges-out');
    const r = bin([dir, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(doc.stats.totals.commits, 5);
    assert.deepEqual(doc.stats.busiestDay, { day: '2026-09-03', commits: 3 });
    assert.match(r.stdout, /Busiest day {2}Sep 3, 2026 \(3 commits\)/);
  });

  test('generate on two repos: busiestDay over the merged history', async () => {
    const mk = (name, dates) => {
      const dir = join(tmp, 'multi', name);
      mkdirSync(dir, { recursive: true });
      git(dir, ['init', '-q', '-b', 'main']);
      git(dir, ['config', 'commit.gpgsign', 'false']);
      for (const d of dates) git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${d}`], at(d));
      return dir;
    };
    // api: Sep 1 x2 + Sep 2 x1; web: Sep 2 x2 → Sep 2 has 3 across repos.
    const api = mk('api', ['2026-09-01T09:00:00+00:00', '2026-09-01T10:00:00+00:00', '2026-09-02T08:00:00+00:00']);
    const web = mk('web', ['2026-09-02T09:00:00+00:00', '2026-09-02T10:00:00+00:00']);
    const out = join(tmp, 'multi-out');
    const r = await generate({ path: api, paths: [api, web], out, png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.repos, ['api', 'web']);
    assert.deepEqual(r.stats.busiestDay, { day: '2026-09-02', commits: 3 });
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.busiestDay, { day: '2026-09-02', commits: 3 });
  });
});
