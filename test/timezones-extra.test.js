// Time zones (stats.timezones): extra coverage — the CLI's date windows (--year / --until,
// author-local days at the extreme offsets +14:00 / -12:00), --exclude, --author, --lang tr
// end to end, the author (not committer) offset, and the JSON shape on a real repo.
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeStats, computeTimezones, offsetMinutes, shownTimezones } from '../src/stats/index.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';

const TODAY = '2026-10-07';

describe('time zones: extra unit cases', () => {
  let n = 0;
  const commit = (date, extra = {}) => ({
    hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    date, subject: 'work', author: 'Ada', email: 'ada@example.com',
    files: [{ path: 'src/a.js', added: 1, removed: 0 }], parents: ['p'], ...extra,
  });

  test('the extreme offsets +14:00 and -12:00 sort west to east and format back', () => {
    const tz = computeTimezones([commit('2026-03-01T09:00:00+14:00'), commit('2026-03-01T09:00:00-12:00')]);
    assert.deepEqual(tz.offsets.map((o) => o.offset), ['-12:00', '+14:00']);
    assert.equal(tz.top.offset, '-12:00');
    assert.equal(offsetMinutes('+14:00'), 840);
    assert.equal(offsetMinutes('-12:00'), -720);
    assert.deepEqual(shownTimezones(tz), { count: 2, top: null, commits: 1, share: 50 });
  });

  test('shares in shownTimezones and stats always agree on the top offset', () => {
    const commits = [
      ...Array.from({ length: 7 }, (_, i) => commit(`2026-03-${String(i + 1).padStart(2, '0')}T09:00:00-12:00`)),
      ...Array.from({ length: 2 }, (_, i) => commit(`2026-03-${String(i + 10).padStart(2, '0')}T09:00:00+14:00`)),
      commit('2026-03-20T09:00:00+05:45'),
    ];
    const s = computeStats(commits, { today: TODAY });
    const shown = shownTimezones(s.timezones);
    assert.equal(shown.top, s.timezones.top.offset);
    assert.equal(shown.share, s.timezones.top.share * 100);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /3 time zones · mostly UTC−12:00 \(70% of commits\)/);
    const peak = buildCardSpecs(s, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'peak-hour').spec;
    assert.ok(`${peak.subtitle} ${JSON.stringify(peak.lines ?? [])}`.includes('UTC−12:00'), peak.subtitle);
  });

  test('a co-authored commit counts once, under the commit author\'s offset', () => {
    const s = computeStats([
      commit('2026-03-01T09:00:00+03:00', { coAuthors: [{ name: 'Bo', email: 'bo@example.com' }] }),
      commit('2026-03-02T09:00:00-05:00'),
    ], { today: TODAY });
    assert.deepEqual(s.timezones.offsets, [{ offset: '-05:00', commits: 1 }, { offset: '+03:00', commits: 1 }]);
  });
});

describe('time zones: CLI end to end (extra)', () => {
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
  /** commits: [{date, email?, committerDate?, file?}] — a file commit when `file` is set. */
  const repo = (name, commits) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const [i, c] of commits.entries()) {
      const email = c.email ?? 'ada@example.com';
      const who = email.split('@')[0];
      const env = {
        GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: c.date,
        GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: c.committerDate ?? c.date,
      };
      if (c.file) {
        mkdirSync(join(dir, c.file, '..'), { recursive: true });
        writeFileSync(join(dir, c.file), `line ${i}\n`.repeat(i + 1));
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-q', '-m', `work ${i}`], env);
      } else {
        git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${i}`], env);
      }
    }
    return dir;
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));

  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'gw-tz-extra-')); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('--year: author-local days decide, at +14:00 and -12:00', () => {
    // 2025-12-31 23:00 -12:00 is 2026-01-01 UTC but author-local 2025 → out.
    // 2026-12-31 23:00 -12:00 is 2027-01-01 UTC but author-local 2026 → in.
    // 2027-01-01 01:00 +14:00 is 2026-12-31 UTC but author-local 2027 → out.
    const dir = repo('year', [
      { date: '2025-12-31T23:00:00-12:00' },
      { date: '2026-06-01T09:00:00+03:00' },
      { date: '2026-06-02T09:00:00+03:00' },
      { date: '2026-12-31T23:00:00-12:00' },
      { date: '2027-01-01T01:00:00+14:00' },
    ]);
    const out = join(tmp, 'year-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--year', '2026']);
    assert.equal(r.status, 0, r.stderr);
    const doc = statsJson(out);
    assert.equal(doc.stats.totals.commits, 3);
    assert.deepEqual(doc.stats.timezones, {
      count: 2,
      top: { offset: '+03:00', commits: 2, share: 0.667 },
      offsets: [{ offset: '+03:00', commits: 2 }, { offset: '-12:00', commits: 1 }],
    });
    assert.match(r.stdout, /\n {2}Time zones {3}2 time zones · mostly UTC\+03:00 \(67% of commits\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /^- \*\*Time zones:\*\* 2 time zones \(mostly UTC\+03:00, 67% of commits\)$/m);
  });

  test('--until: a later commit from another zone is left out → one zone, no line', () => {
    const dir = repo('until', [
      { date: '2026-03-01T09:00:00+03:00' },
      { date: '2026-03-02T09:00:00+03:00' },
      { date: '2026-05-01T09:00:00-07:00' },
    ]);
    const out = join(tmp, 'until-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--until', '2026-03-31']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(out).stats.timezones, { count: 1, top: { offset: '+03:00', commits: 2, share: 1 }, offsets: [{ offset: '+03:00', commits: 2 }] });
    assert.doesNotMatch(r.stdout, /Time zones/);
    assert.doesNotMatch(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Time zones/);
    assert.doesNotMatch(readFileSync(join(out, 'cards', '03-peak-hour.svg'), 'utf8'), /time zones/);
  });

  test('--exclude does not change the time zones (commits still count)', () => {
    const dir = repo('exclude', [
      { date: '2026-03-01T09:00:00+03:00', file: 'docs/a.md' },
      { date: '2026-03-02T09:00:00-05:00', file: 'docs/b.md' },
      { date: '2026-03-03T09:00:00+03:00', file: 'src/a.js' },
    ]);
    const plain = join(tmp, 'exclude-plain');
    const excl = join(tmp, 'exclude-out');
    assert.equal(bin([dir, '--out', plain, '--json']).status, 0);
    const r = bin([dir, '--out', excl, '--json', '--exclude', 'docs/']);
    assert.equal(r.status, 0, r.stderr);
    const a = statsJson(plain).stats;
    const b = statsJson(excl).stats;
    assert.notDeepEqual(a.totals, b.totals, 'the exclude did take effect');
    assert.deepEqual(b.timezones, a.timezones);
    assert.equal(b.timezones.count, 2);
  });

  test('--author counts only that author\'s offsets', () => {
    const dir = repo('author', [
      { date: '2026-03-01T09:00:00+03:00', email: 'ada@example.com' },
      { date: '2026-03-02T09:00:00+03:00', email: 'ada@example.com' },
      { date: '2026-03-03T09:00:00-08:00', email: 'bob@example.com' },
      { date: '2026-03-04T09:00:00+05:30', email: 'bob@example.com' },
    ]);
    const all = join(tmp, 'author-all');
    assert.equal(bin([dir, '--out', all, '--json']).status, 0);
    assert.equal(statsJson(all).stats.timezones.count, 3);
    const ada = join(tmp, 'author-ada');
    const r = bin([dir, '--out', ada, '--json', '--author', 'ADA@example.com']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(statsJson(ada).stats.timezones, { count: 1, top: { offset: '+03:00', commits: 2, share: 1 }, offsets: [{ offset: '+03:00', commits: 2 }] });
    assert.doesNotMatch(r.stdout, /Time zones/);
    const bob = join(tmp, 'author-bob');
    const rb = bin([dir, '--out', bob, '--json', '--author', 'bob@example.com']);
    assert.equal(rb.status, 0, rb.stderr);
    assert.deepEqual(statsJson(bob).stats.timezones.offsets, [{ offset: '-08:00', commits: 1 }, { offset: '+05:30', commits: 1 }]);
    assert.match(rb.stdout, /\n {2}Time zones {3}2 time zones\n/, 'tie: no "mostly"');
  });

  test('the author date\'s offset counts, not the committer date\'s', () => {
    const dir = repo('committer', [
      { date: '2026-03-01T09:00:00+03:00', committerDate: '2026-03-01T09:00:00-07:00' },
      { date: '2026-03-02T09:00:00+03:00', committerDate: '2026-03-02T09:00:00-07:00' },
    ]);
    const out = join(tmp, 'committer-out');
    assert.equal(bin([dir, '--out', out, '--json']).status, 0);
    assert.deepEqual(statsJson(out).stats.timezones.offsets, [{ offset: '+03:00', commits: 2 }]);
  });

  test('--json on a two-zone repo: shape and types of stats.timezones', () => {
    const dir = repo('shape', [
      { date: '2026-03-01T09:00:00Z' },
      { date: '2026-03-02T09:00:00-00:00' },
      { date: '2026-03-03T21:00:00+09:00' },
    ]);
    const out = join(tmp, 'shape-out');
    const r = bin([dir, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const tz = statsJson(out).stats.timezones;
    assert.deepEqual(Object.keys(tz), ['count', 'top', 'offsets']);
    assert.equal(tz.count, tz.offsets.length);
    assert.deepEqual(Object.keys(tz.top), ['offset', 'commits', 'share']);
    for (const o of tz.offsets) {
      assert.deepEqual(Object.keys(o), ['offset', 'commits']);
      assert.match(o.offset, /^[+-]\d{2}:\d{2}$/);
      assert.ok(Number.isInteger(o.commits) && o.commits > 0);
    }
    assert.deepEqual(tz, { count: 2, top: { offset: '+00:00', commits: 2, share: 0.667 }, offsets: [{ offset: '+00:00', commits: 2 }, { offset: '+09:00', commits: 1 }] });
  });

  test('--lang tr: recap, wrapped.md and the power-hour card in Turkish', () => {
    // Two Mondays at +03:00 (an untied busiest day).
    const dir = repo('tr', [
      { date: '2026-03-02T21:00:00+03:00' },
      { date: '2026-03-09T21:00:00+03:00' },
      { date: '2026-03-03T21:00:00-05:00' },
    ]);
    const out = join(tmp, 'tr-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\n {2}Saat dilimleri {3}2 saat dilimi · en çok UTC\+03:00 \(commit'lerin %67 kadarı\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /^- \*\*Saat dilimleri:\*\* 2 saat dilimi \(en çok UTC\+03:00, commit'lerin %67 kadarı\)$/m);
    const card = readFileSync(join(out, 'cards', '03-peak-hour.svg'), 'utf8');
    // The row (keeping the quip) is preferred over the sentence replacing it.
    assert.ok((card.includes('saat diliminden commit att') && card.includes('çoğunu UTC+03:00 diliminden.')) || (card.includes('>2 saat dilimi<') && card.includes('>en çok UTC+03:00<')), 'peak-hour card shows the time zones in Turkish');
    assert.doesNotMatch(card, /time zones|mostly/);
  });
});
