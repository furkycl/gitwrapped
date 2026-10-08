// Weekend share (stats.weekend): extra coverage — the CLI end to end on throwaway repos
// (stats.json, the recap, wrapped.md and the activity card, en and tr), --year / --since
// windows on author-local days, several repos summed, --author, and the activity card's
// weekend row in every color theme (present, inside the content area, no overlap).
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeStats, computeWeekend, shownWeekend } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, COLOR_THEME_NAMES } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { personalityReason } from '../src/stats/personality.js';
import { formatSummary } from '../src/summary.js';
import en from '../src/i18n/en.js';

const TODAY = '2026-10-07';

describe('weekend: extra unit cases', () => {
  let n = 0;
  const commit = (date, extra = {}) => ({
    hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    date, subject: 'work', author: 'Ada', email: 'ada@example.com',
    files: [{ path: 'src/a.js', added: 1, removed: 0 }], parents: ['p'], ...extra,
  });

  test('extreme offsets: +14:00 Monday 00:30 is Sunday in UTC → not weekend; -12:00 Friday 23:00 is Saturday UTC → not', () => {
    const s = computeStats([
      commit('2026-03-09T00:30:00+14:00'), // Monday local
      commit('2026-03-06T23:00:00-12:00'), // Friday local
      commit('2026-03-07T00:30:00+14:00'), // Saturday local (Friday UTC) → weekend
      commit('2026-03-08T23:30:00-12:00'), // Sunday local (Monday UTC) → weekend
    ], { today: TODAY });
    assert.deepEqual(s.weekend, { commits: 2, share: 0.5 });
  });

  test('every commit on a weekend → share 1 and "100%"', () => {
    const s = computeStats([commit('2026-03-07T10:00:00Z'), commit('2026-03-08T10:00:00Z')], { today: TODAY });
    assert.deepEqual(s.weekend, { commits: 2, share: 1 });
    assert.deepEqual(shownWeekend(s), { commits: 2, percent: 100 });
  });

  test('negative / NaN / fractional junk in habits never throws or goes negative', () => {
    assert.deepEqual(computeWeekend({ byWeekday: [-5, 0, 0, 0, 0, 0, NaN], byHour: [-3] }), { commits: 0, share: 0 });
    assert.deepEqual(computeWeekend({ byWeekday: [Infinity, 0, 0, 0, 0, 0, 2], byHour: [4] }), { commits: 2, share: 0.5 });
    // byHour smaller than the weekend count: dated is lifted to the weekend count.
    assert.deepEqual(computeWeekend({ byWeekday: [3, 0, 0, 0, 0, 0, 0], byHour: [1] }), { commits: 3, share: 1 });
  });

  test('Weekend Warrior at a .5 rounding boundary: 5 of 8 reads 63% in the reason, the recap and stats', () => {
    const commits = [
      ...Array.from({ length: 5 }, (_, i) => commit(`2026-03-0${7 + (i % 2)}T14:00:00Z`)),
      ...Array.from({ length: 3 }, (_, i) => commit(`2026-03-0${2 + i}T14:00:00Z`)),
    ];
    const s = computeStats(commits, { today: TODAY });
    assert.equal(s.personality.archetype.id, 'weekend-warrior');
    assert.deepEqual(s.weekend, { commits: 5, share: 0.625 });
    assert.deepEqual(shownWeekend(s), { commits: 5, percent: 63 });
    assert.equal(personalityReason(s.personality, en), '63% of your commits land on a Saturday or Sunday.');
    assert.match(formatSummary(s, { repoName: 'demo', paths: {} }), /Weekends {5}5 commits \(63% of commits\)/);
  });
});

describe('weekend: activity card in every color theme', () => {
  let n = 0;
  const commit = (date) => ({
    hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    date, subject: 'work', author: 'Ada', email: 'ada@example.com',
    files: [{ path: 'src/a.js', added: 1, removed: 0 }], parents: ['p'],
  });
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const daily = (count) => Array.from({ length: count }, (_, i) => commit(`${day(Date.parse('2026-10-06T00:00:00Z') - i * 86400000)}T12:00:00+03:00`));

  test('row present, inside the content area, nothing overlapping — all themes, en and tr', () => {
    assert.ok(COLOR_THEME_NAMES.length >= 3);
    // (a ~year of daily commits gets no row: its calendar cells would drop below their
    // normal minimum, see test/weekend.test.js)
    for (const count of [7, 100, 200]) {
      const s = computeStats(daily(count), { today: TODAY });
      const w = shownWeekend(s);
      assert.ok(w, `${count}: has weekend commits`);
      for (const lang of ['en', 'tr']) {
        let baseLayout;
        for (const colorTheme of COLOR_THEME_NAMES) {
          const label = `${count} days ${lang} ${colorTheme}`;
          const spec = buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang, colorTheme }).find((c) => c.id === 'activity').spec;
          // The weekend row first (an office-hours row may follow it, see test/office-hours.test.js).
          assert.equal(spec.lines?.filter((r) => r.label === (lang === 'tr' ? 'Hafta sonu' : 'Weekends')).length, 1, `${label}: one weekend row`);
          assert.equal(spec.lines[0].label, lang === 'tr' ? 'Hafta sonu' : 'Weekends', label);
          const layout = layoutCard({ ...spec, lang });
          const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
          for (const [i, b] of sorted.entries()) {
            assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} inside`);
            if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} no overlap`);
          }
          const geo = layout.blocks.map((b) => [b.kind, b.top, b.bottom]);
          if (!baseLayout) baseLayout = geo;
          else assert.deepEqual(geo, baseLayout, `${label}: same layout as the default theme`);
          const svg = buildCards(s, { repoName: 'demo', today: TODAY, lang, colorTheme }).find((c) => c.id === 'activity').svg;
          assert.ok(svg.includes(lang === 'tr' ? 'Hafta sonu' : 'Weekends'), `${label}: row in the SVG`);
          assert.ok(svg.includes(lang === 'tr' ? `%${w.percent}` : `${w.percent}%`), `${label}: percent in the SVG`);
        }
      }
    }
  });
});

describe('weekend: CLI end to end', () => {
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
  /** commits: [{date, email?}] as empty commits. */
  const repo = (name, commits) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const [i, c] of commits.entries()) {
      const email = c.email ?? 'ada@example.com';
      const who = email.split('@')[0];
      git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${i}`], {
        GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: c.date,
        GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: c.date,
      });
    }
    return dir;
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
  const md = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');
  const activity = (out) => readFileSync(join(out, 'cards', '05-activity.svg'), 'utf8');

  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'gw-weekend-extra-')); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  // 2026-03-07 Sat, 03-08 Sun, 03-09 Mon … 03-13 Fri, 03-14 Sat.
  const base = [
    { date: '2026-03-07T22:00:00-05:00' }, // Sat local (Sun UTC) → weekend
    { date: '2026-03-08T01:00:00+03:00' }, // Sun local (Sat UTC) → weekend
    { date: '2026-03-06T23:00:00-05:00' }, // Fri local (Sat UTC) → not
    { date: '2026-03-09T01:00:00+03:00' }, // Mon local (Sun UTC) → not
    { date: '2026-03-10T14:00:00Z' },
    { date: '2026-03-11T14:00:00Z' },
    { date: '2026-03-12T14:00:00Z' },
    { date: '2026-03-13T14:00:00Z' },
  ];

  test('en: stats.json, recap, wrapped.md and the activity card agree (author-local weekdays)', () => {
    const dir = repo('en', base);
    const out = join(tmp, 'en-out');
    const r = bin([dir, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.deepEqual(doc.stats.weekend, { commits: 2, share: 0.25 });
    assert.deepEqual(Object.keys(doc.stats.weekend), ['commits', 'share']);
    assert.equal(doc.stats.weekend.commits, doc.stats.habits.byWeekday[0] + doc.stats.habits.byWeekday[6]);
    assert.match(r.stdout, /\n {2}Weekends {5}2 commits \(25% of commits\)\n/);
    assert.match(md(out), /^- \*\*Weekend commits:\*\* 2 commits \(25% of commits\)$/m);
    const card = activity(out);
    assert.ok(card.includes('Weekends'), 'activity card has the row');
    assert.ok(card.includes('2 commits · 25%'), card.match(/Weekends.{0,200}/s)?.[0]);
  });

  test('tr: the same in Turkish', () => {
    const dir = repo('tr', base);
    const out = join(tmp, 'tr-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.weekend, { commits: 2, share: 0.25 });
    assert.match(r.stdout, /\n {2}Hafta sonu {7}2 commit \(commit'lerin %25 kadarı\)\n/);
    assert.match(md(out), /^- \*\*Hafta sonu commit'leri:\*\* 2 commit \(commit'lerin %25 kadarı\)$/m);
    const card = activity(out);
    assert.ok(card.includes('Hafta sonu'));
    assert.ok(card.includes('2 commit · %25'));
    assert.doesNotMatch(card, /Weekends/);
    assert.doesNotMatch(r.stdout, /Weekends/);
  });

  test('no weekend commit: zero in stats.json, no line anywhere', () => {
    const dir = repo('none', base.slice(2));
    const out = join(tmp, 'none-out');
    const r = bin([dir, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.weekend, { commits: 0, share: 0 });
    assert.doesNotMatch(r.stdout, /Weekends/);
    assert.doesNotMatch(md(out), /Weekend commits/);
    assert.doesNotMatch(activity(out), /Weekends/);
  });

  test('--year: author-local days decide the window and the weekday', () => {
    const dir = repo('year', [
      { date: '2025-12-27T10:00:00Z' }, // Sat 2025 → out
      { date: '2026-01-03T00:30:00+14:00' }, // Sat local 2026 (Fri 2026-01-02 UTC) → in, weekend
      { date: '2026-06-01T09:00:00+03:00' }, // Mon → in
      { date: '2026-12-31T23:00:00-12:00' }, // Thu local 2026 (Fri 2027 UTC) → in, not weekend
      { date: '2027-01-02T10:00:00Z' }, // Sat 2027 → out
    ]);
    const out = join(tmp, 'year-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--year', '2026']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.commits, 3);
    assert.deepEqual(doc.stats.weekend, { commits: 1, share: 0.333 });
    assert.match(r.stdout, /\n {2}Weekends {5}1 commit \(33% of commits\)\n/);
    assert.match(md(out), /^- \*\*Weekend commits:\*\* 1 commit \(33% of commits\)$/m);
  });

  test('--since: weekend commits before the window are left out', () => {
    const dir = repo('since', [
      { date: '2026-03-07T10:00:00Z' }, // Sat, before → out
      { date: '2026-03-08T10:00:00Z' }, // Sun, before → out
      { date: '2026-03-16T10:00:00Z' }, // Mon
      { date: '2026-03-21T10:00:00Z' }, // Sat → in
      { date: '2026-03-23T10:00:00Z' }, // Mon
      { date: '2026-03-24T10:00:00Z' }, // Tue
    ]);
    const out = join(tmp, 'since-out');
    const r = bin([dir, '--out', out, '--json', '--since', '2026-03-15']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.weekend, { commits: 1, share: 0.25 });
    assert.match(r.stdout, /Weekends {5}1 commit \(25% of commits\)/);
  });

  test('several repos: weekend commits are summed', () => {
    const a = repo('multi-a', [{ date: '2026-03-07T10:00:00Z' }, { date: '2026-03-09T10:00:00Z' }]);
    const b = repo('multi-b', [{ date: '2026-03-08T10:00:00+05:30' }, { date: '2026-03-14T23:30:00-03:00' }, { date: '2026-03-10T10:00:00Z' }, { date: '2026-03-11T10:00:00Z' }]);
    const out = join(tmp, 'multi-out');
    const r = bin([a, b, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.commits, 6);
    assert.deepEqual(doc.stats.weekend, { commits: 3, share: 0.5 });
    assert.match(r.stdout, /Weekends {5}3 commits \(50% of commits\)/);
    assert.match(md(out), /^- \*\*Weekend commits:\*\* 3 commits \(50% of commits\)$/m);
  });

  test('--author: only that author\'s weekend commits', () => {
    const dir = repo('author', [
      { date: '2026-03-07T10:00:00Z', email: 'ada@example.com' },
      { date: '2026-03-09T10:00:00Z', email: 'ada@example.com' },
      { date: '2026-03-10T10:00:00Z', email: 'ada@example.com' },
      { date: '2026-03-08T10:00:00Z', email: 'bob@example.com' },
      { date: '2026-03-14T10:00:00Z', email: 'bob@example.com' },
    ]);
    const all = join(tmp, 'author-all');
    assert.equal(bin([dir, '--out', all, '--json']).status, 0);
    assert.deepEqual(statsJson(all).stats.weekend, { commits: 3, share: 0.6 });
    const ada = join(tmp, 'author-ada');
    const r = bin([dir, '--out', ada, '--json', '--author', 'ADA@example.com']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(ada).stats.weekend, { commits: 1, share: 0.333 });
    assert.match(r.stdout, /Weekends {5}1 commit \(33% of commits\)/);
    const bob = join(tmp, 'author-bob');
    const rb = bin([dir, '--out', bob, '--json', '--author', 'bob@example.com']);
    assert.equal(rb.status, 0, rb.stderr);
    assert.deepEqual(statsJson(bob).stats.weekend, { commits: 2, share: 1 });
    assert.match(rb.stdout, /Weekends {5}2 commits \(100% of commits\)/);
  });

  test('--theme mono / neon: the activity card still carries the row', () => {
    const dir = repo('themes', base);
    for (const theme of ['mono', 'neon']) {
      const out = join(tmp, `theme-${theme}`);
      const r = bin([dir, '--out', out, '--theme', theme]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(activity(out).includes('2 commits · 25%'), theme);
    }
  });
});
