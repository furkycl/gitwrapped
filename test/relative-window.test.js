// Relative windows: --since / --until 30d, 12w, 6m, 1y resolve against today's local date
// (resolveRelativeDate), before every other check, and every output sees the resolved dates.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELP_TEXT, parseCli, resolveRelativeDate, run } from '../src/cli.js';
import { localToday } from '../src/stats/index.js';

const TODAY = '2026-10-05';

describe('resolveRelativeDate', () => {
  test('days and weeks count back calendar days', () => {
    assert.equal(resolveRelativeDate('30d', TODAY), '2026-09-05');
    assert.equal(resolveRelativeDate('0d', TODAY), TODAY);
    assert.equal(resolveRelativeDate('1d', '2026-01-01'), '2025-12-31');
    assert.equal(resolveRelativeDate('1d', '2024-03-01'), '2024-02-29');
    assert.equal(resolveRelativeDate('12w', TODAY), '2026-07-13');
    assert.equal(resolveRelativeDate('1w', '2026-03-03'), '2026-02-24');
    // No DST drift: pure calendar arithmetic across a DST change.
    assert.equal(resolveRelativeDate('7d', '2026-11-03'), '2026-10-27');
    assert.equal(resolveRelativeDate('7d', '2026-03-31'), '2026-03-24');
  });

  test('months and years are calendar months, clamped to the month end', () => {
    assert.equal(resolveRelativeDate('6m', TODAY), '2026-04-05');
    assert.equal(resolveRelativeDate('1m', '2026-03-31'), '2026-02-28');
    assert.equal(resolveRelativeDate('1m', '2024-03-31'), '2024-02-29');
    assert.equal(resolveRelativeDate('1m', '2026-05-31'), '2026-04-30');
    assert.equal(resolveRelativeDate('1m', '2026-01-15'), '2025-12-15');
    assert.equal(resolveRelativeDate('13m', '2026-01-15'), '2024-12-15');
    assert.equal(resolveRelativeDate('1y', TODAY), '2025-10-05');
    assert.equal(resolveRelativeDate('1y', '2024-02-29'), '2023-02-28');
    assert.equal(resolveRelativeDate('4y', '2024-02-29'), '2020-02-29');
    assert.equal(resolveRelativeDate('12m', TODAY), resolveRelativeDate('1y', TODAY));
  });

  test('case, whitespace and leading zeros are fine', () => {
    assert.equal(resolveRelativeDate(' 30D ', TODAY), '2026-09-05');
    assert.equal(resolveRelativeDate('6M', TODAY), '2026-04-05');
    assert.equal(resolveRelativeDate('007d', TODAY), '2026-09-28');
    assert.equal(resolveRelativeDate('9999d', TODAY), '1999-05-21');
  });

  test('anything else is not a relative window (null)', () => {
    for (const bad of ['30x', '-5d', '1.5m', 'd', '30', '30 d', '+3d', '1e3d', '10000d', '2026-01-01', '']) {
      assert.equal(resolveRelativeDate(bad, TODAY), null, bad);
    }
  });

  test('results before 1970 are returned as such (sorting before 1970-01-01)', () => {
    assert.ok(resolveRelativeDate('57y', TODAY) < '1970-01-01');
    assert.ok(resolveRelativeDate('9999y', TODAY) < '1970-01-01');
    assert.ok(resolveRelativeDate('9999m', TODAY) < '1970-01-01');
  });
});

describe('parseCli: relative --since / --until', () => {
  test('resolve against the given today', () => {
    const o = parseCli(['--since', '90d', '--until', '1w'], { today: TODAY });
    assert.equal(o.since, '2026-07-07');
    assert.equal(o.until, '2026-09-28');
    assert.equal(parseCli(['--since=6m'], { today: TODAY }).since, '2026-04-05');
    assert.equal(parseCli(['--until', '1y'], { today: TODAY }).until, '2025-10-05');
    assert.equal(parseCli(['--since', ' 1Y '], { today: TODAY }).since, '2025-10-05');
    // Absolute dates still work alongside.
    const mixed = parseCli(['--since', '2026-01-01', '--until', '30d'], { today: TODAY });
    assert.equal(mixed.since, '2026-01-01');
    assert.equal(mixed.until, '2026-09-05');
  });

  test('today defaults to the local date', () => {
    assert.equal(parseCli(['--since', '0d']).since, localToday());
  });

  test('bad values name the relative form; pre-1970 results are rejected', () => {
    for (const bad of ['30x', '1.5m', '3 w']) {
      // (10000d+ has its own range message; see below)
      assert.throws(
        () => parseCli(['--since', bad], { today: TODAY }),
        { message: `invalid --since "${bad}": expected format YYYY-MM-DD or a relative window like 30d, 12w, 6m, 1y` },
        bad,
      );
    }
    assert.throws(() => parseCli(['--until', '-5d'], { today: TODAY }), /invalid --until "-5d": expected format YYYY-MM-DD or a relative window like 30d, 12w, 6m, 1y/);
    assert.throws(() => parseCli(['--since', '100y'], { today: TODAY }), { message: 'invalid --since "100y": dates before 1970 are not supported' });
    assert.throws(() => parseCli(['--since', '9999y'], { today: TODAY }), /dates before 1970 are not supported/);
    assert.equal(parseCli(['--since', '56y'], { today: TODAY }).since, '1970-10-05');
    assert.throws(() => parseCli(['--since', '10000d'], { today: TODAY }), { message: 'invalid --since "10000d": a relative window counts 0 to 9999 units' });
  });

  test('order and --year checks see the resolved dates', () => {
    assert.throws(() => parseCli(['--since', '30d', '--until', '1y'], { today: TODAY }), { message: '--since 2026-09-05 is after --until 2025-10-05' });
    assert.throws(() => parseCli(['--year', '2025', '--since', '30d'], { today: TODAY }), /--year cannot be combined with --since or --until/);
    assert.throws(() => parseCli(['--until', '6m', '--year', '2025'], { today: TODAY }), /--year cannot be combined with --since or --until/);
  });

  test('--help mentions the relative forms', () => {
    assert.match(HELP_TEXT, /--since YYYY-MM-DD[^\n]*\n\s+\(or relative to today: 30d, 12w, 6m, 1y\)/);
    assert.match(HELP_TEXT, /--until YYYY-MM-DD[^\n]*\n\s+\(or relative to today: 30d, 12w, 6m, 1y\)/);
  });
});

function sink() {
  let data = '';
  return {
    write(s) {
      data += s;
      return true;
    },
    get data() {
      return data;
    },
  };
}

describe('run: a relative window', () => {
  let dir;
  let out;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-relwin-'));
    out = mkdtempSync(join(tmpdir(), 'gw-relwin-out-'));
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
    const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    for (const [msg, date] of [['old', '2026-01-10 12:00:00'], ['in', '2026-08-01 12:00:00'], ['in too', '2026-09-01 12:00:00'], ['recent', '2026-10-01 12:00:00']]) {
      git(['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', msg], {
        GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_COMMITTER_DATE: date,
      });
    }
  });
  after(() => {
    for (const d of [dir, out]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  });

  test('uses run\'s today, and stats.json / recap show the resolved dates', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await run([dir, '--since', '6m', '--until', '2w', '--json', '--no-png', '--out', out], { stdout, stderr, env: {}, today: TODAY });
    assert.equal(code, 0, stderr.data);
    assert.match(stdout.data, /^gitwrapped: 2 commits → /);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(json.filters.since, '2026-04-05');
    assert.equal(json.filters.until, '2026-09-21');
    assert.match(stdout.data, /Wrapped · Apr 5 – Sep 21, 2026/);
    assert.doesNotMatch(stdout.data, /6m|2w/);
  });

  test('an empty relative window names the resolved dates in the note', async () => {
    const stdout = sink();
    await run([dir, '--since', '1d', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.match(stdout.data, /Note: no commits match --since 2026-10-04\./);
  });
});
