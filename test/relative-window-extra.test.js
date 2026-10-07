// Extra coverage for relative --since / --until windows (30d, 12w, 6m, 1y): edge cases of
// resolveRelativeDate / parseCli, and an end-to-end run with an injected `today` checking
// that the cards, share card, wrapped.md, wrapped.html and stats.json all show resolved dates.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCli, resolveRelativeDate, run } from '../src/cli.js';
import { localToday } from '../src/stats/index.js';

const TODAY = '2026-10-05';
const FORMAT_ERR = 'expected format YYYY-MM-DD or a relative window like 30d, 12w, 6m, 1y';

describe('resolveRelativeDate: edge cases', () => {
  test('0 of any unit is today', () => {
    for (const v of ['0d', '0w', '0m', '0y', '000D']) assert.equal(resolveRelativeDate(v, TODAY), TODAY, v);
  });

  test('year boundary: months and days cross into the previous year', () => {
    assert.equal(resolveRelativeDate('1m', '2026-01-15'), '2025-12-15');
    assert.equal(resolveRelativeDate('1m', '2026-01-31'), '2025-12-31');
    assert.equal(resolveRelativeDate('2m', '2026-01-31'), '2025-11-30');
    assert.equal(resolveRelativeDate('12m', '2026-01-01'), '2025-01-01');
    assert.equal(resolveRelativeDate('15d', '2026-01-10'), '2025-12-26');
    assert.equal(resolveRelativeDate('1w', '2026-01-03'), '2025-12-27');
  });

  test('century leap rules for month-end clamping', () => {
    assert.equal(resolveRelativeDate('1m', '2100-03-31'), '2100-02-28'); // 2100 is not a leap year
    assert.equal(resolveRelativeDate('1m', '2000-03-31'), '2000-02-29'); // 2000 is
    assert.equal(resolveRelativeDate('100y', '2000-02-29'), '1900-02-28');
  });

  test('9999 is the largest N; 10000 is not a relative window', () => {
    assert.notEqual(resolveRelativeDate('9999d', TODAY), null);
    assert.notEqual(resolveRelativeDate('9999w', TODAY), null);
    assert.equal(resolveRelativeDate('10000w', TODAY), null);
    assert.equal(resolveRelativeDate('10000m', TODAY), null);
    assert.equal(resolveRelativeDate('00009999d', TODAY), resolveRelativeDate('9999d', TODAY));
  });

  test('results always look like a date and pre-1970/negative years sort before 1970', () => {
    for (const v of ['9999w', '9999m', '2026y', '2027y', '9999y']) {
      const r = resolveRelativeDate(v, TODAY);
      assert.match(r, /^-?\d{4}-\d{2}-\d{2}$/, v);
      assert.ok(r < '1970-01-01', v);
    }
    assert.equal(resolveRelativeDate('2026y', TODAY), '0000-10-05');
    assert.equal(resolveRelativeDate('2027y', TODAY), '-0001-10-05');
  });

  test('non-ASCII digits, inner whitespace and non-strings are not relative windows', () => {
    for (const bad of ['٣d', '３d', '1 d', '1\td', 'd1', '1dd', '1h', '1s']) assert.equal(resolveRelativeDate(bad, TODAY), null, bad);
    assert.equal(resolveRelativeDate(undefined, TODAY), null);
  });
});

describe('parseCli: relative windows, more cases', () => {
  test('--year with a relative --since / --until is an error (either order)', () => {
    for (const argv of [
      ['--year', '2025', '--since', '30d'],
      ['--since', '30d', '--year', '2025'],
      ['--year', '2025', '--until', '0d'],
      ['--year=2025', '--since=1y', '--until=1m'],
    ]) {
      assert.throws(() => parseCli(argv, { today: TODAY }), { message: '--year cannot be combined with --since or --until' }, argv.join(' '));
    }
  });

  test('since after until is checked on the resolved dates', () => {
    assert.throws(() => parseCli(['--since', '1d', '--until', '30d'], { today: TODAY }), { message: '--since 2026-10-04 is after --until 2026-09-05' });
    assert.throws(() => parseCli(['--since', '1w', '--until', '8d'], { today: TODAY }), { message: '--since 2026-09-28 is after --until 2026-09-27' });
    // Mixed: an absolute since after a relative until.
    assert.throws(() => parseCli(['--since', '2026-10-01', '--until', '1w'], { today: TODAY }), { message: '--since 2026-10-01 is after --until 2026-09-28' });
    // Same resolved day is fine.
    const o = parseCli(['--since', '7d', '--until', '1W'], { today: TODAY });
    assert.equal(o.since, '2026-09-28');
    assert.equal(o.until, '2026-09-28');
  });

  test('0d means today, for both ends', () => {
    const o = parseCli(['--since', '0d', '--until', '0d'], { today: TODAY });
    assert.equal(o.since, TODAY);
    assert.equal(o.until, TODAY);
  });

  test('case and surrounding whitespace are ignored', () => {
    assert.equal(parseCli(['--since', ' 6M '], { today: TODAY }).since, '2026-04-05');
    assert.equal(parseCli(['--until= 2W\t'], { today: TODAY }).until, '2026-09-21');
    assert.equal(parseCli(['--since', '1Y'], { today: TODAY }).since, '2025-10-05');
  });

  test('mixing absolute and relative in both directions', () => {
    const a = parseCli(['--since', '3m', '--until', '2026-10-01'], { today: TODAY });
    assert.deepEqual([a.since, a.until], ['2026-07-05', '2026-10-01']);
    const b = parseCli(['--since', '2025-01-01', '--until', '1y'], { today: TODAY });
    assert.deepEqual([b.since, b.until], ['2025-01-01', '2025-10-05']);
  });

  test('the 1970 floor: exactly 1970-01-01 is allowed, one day earlier is not', () => {
    assert.equal(parseCli(['--since', '0d'], { today: '1970-01-01' }).since, '1970-01-01');
    assert.equal(parseCli(['--since', '56y'], { today: '2026-01-01' }).since, '1970-01-01');
    assert.throws(() => parseCli(['--since', '1d'], { today: '1970-01-01' }), { message: 'invalid --since "1d": dates before 1970 are not supported' });
    assert.throws(() => parseCli(['--until', '57y'], { today: '2026-01-01' }), { message: 'invalid --until "57y": dates before 1970 are not supported' });
    // Year 0 / negative years are rejected, not passed through.
    assert.throws(() => parseCli(['--since', '2026y'], { today: TODAY }), /dates before 1970 are not supported/);
    assert.throws(() => parseCli(['--since', '2027y'], { today: TODAY }), /dates before 1970 are not supported/);
    assert.throws(() => parseCli(['--since', '9999m'], { today: TODAY }), /dates before 1970 are not supported/);
  });

  test('the 9999 limit: N above 9999 gets a range error, not a 1970 error', () => {
    assert.throws(() => parseCli(['--since', '10000d'], { today: TODAY }), { message: 'invalid --since "10000d": a relative window counts 0 to 9999 units' });
    assert.equal(parseCli(['--since', '9999d'], { today: TODAY }).since, '1999-05-21');
    assert.throws(() => parseCli(['--since', '9999w'], { today: TODAY }), /dates before 1970 are not supported/);
  });

  test('error message shows the trimmed value', () => {
    assert.throws(() => parseCli(['--since', '  100Y '], { today: TODAY }), { message: 'invalid --since "100Y": dates before 1970 are not supported' });
    assert.throws(() => parseCli(['--until', ' 5x '], { today: TODAY }), { message: `invalid --until "5x": ${FORMAT_ERR}` });
  });

  test('the last --since wins when repeated, relative or not', () => {
    assert.equal(parseCli(['--since', '30d', '--since', '60d'], { today: TODAY }).since, '2026-08-06');
    assert.equal(parseCli(['--since', '30d', '--since', '2026-01-01'], { today: TODAY }).since, '2026-01-01');
  });

  test('today undefined or null falls back to the local date', () => {
    assert.equal(parseCli(['--until', '0d'], {}).until, localToday());
    assert.equal(parseCli(['--until', '0d'], { today: undefined }).until, localToday());
    assert.equal(parseCli(['--until', '0d'], { today: null }).until, localToday());
  });

  test('absolute dates are untouched by today', () => {
    const o = parseCli(['--since', '2020-02-29', '--until', '2020-03-01'], { today: '1970-01-01' });
    assert.deepEqual([o.since, o.until], ['2020-02-29', '2020-03-01']);
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

describe('run: relative window end to end (cards, share card, wrapped.md, stats.json)', () => {
  let root;
  let dir;
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-relwin-x-'));
    dir = join(root, 'app');
    mkdirSync(dir);
    const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    for (const [msg, date] of [
      ['old', '2025-12-20T12:00:00+00:00'],
      ['jan', '2026-01-10T12:00:00+00:00'],
      ['aug', '2026-08-01T12:00:00+00:00'],
      ['sep', '2026-09-01T12:00:00+00:00'],
      ['oct', '2026-10-01T12:00:00+00:00'],
    ]) {
      git(['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', msg], {
        GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_COMMITTER_DATE: date,
      });
    }
  });
  after(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  function outDir() {
    return mkdtempSync(join(root, 'out-'));
  }

  test('every output shows the resolved dates, never the raw relative values', async () => {
    const out = outDir();
    const stdout = sink();
    const stderr = sink();
    const code = await run([dir, '--since', '6m', '--until', '2w', '--md', '--json', '--no-png', '--out', out], { stdout, stderr, env: {}, today: TODAY });
    assert.equal(code, 0, stderr.data);
    assert.match(stdout.data, /^gitwrapped: 2 commits → /);
    assert.match(stdout.data, /Wrapped · Apr 5 – Sep 21, 2026/);

    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(json.filters.since, '2026-04-05');
    assert.equal(json.filters.until, '2026-09-21');

    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    assert.match(md, /Apr 5 – Sep 21, 2026/);

    const cards = readdirSync(join(out, 'cards')).filter((f) => f.endsWith('.svg'));
    assert.ok(cards.length > 0);
    const intro = readFileSync(join(out, 'cards', cards.find((f) => f.includes('intro'))), 'utf8');
    assert.match(intro, /Apr 5 – Sep 21, 2026/);
    const share = readFileSync(join(out, 'share.svg'), 'utf8');
    assert.match(share, /Apr 5 – Sep 21, 2026/);

    for (const f of [...cards.map((c) => join(out, 'cards', c)), join(out, 'share.svg'), join(out, 'wrapped.md'), join(out, 'wrapped.html')]) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /--since 6m|--until 2w|\b6m\b.*\b2w\b/, f);
    }
  });

  test('a year-crossing window (1m on Jan 15) picks up the December commit', async () => {
    const out = outDir();
    const stdout = sink();
    const stderr = sink();
    const code = await run([dir, '--since', '1m', '--until', '0d', '--json', '--no-png', '--out', out], { stdout, stderr, env: {}, today: '2026-01-15' });
    assert.equal(code, 0, stderr.data);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(json.filters.since, '2025-12-15');
    assert.equal(json.filters.until, '2026-01-15');
    assert.match(stdout.data, /^gitwrapped: 2 commits → /);
  });

  test('run passes today through: a different today moves the window', async () => {
    const a = outDir();
    const b = outDir();
    await run([dir, '--since', '30d', '--json', '--no-png', '--out', a], { stdout: sink(), stderr: sink(), env: {}, today: '2026-10-05' });
    await run([dir, '--since', '30d', '--json', '--no-png', '--out', b], { stdout: sink(), stderr: sink(), env: {}, today: '2026-09-15' });
    assert.equal(JSON.parse(readFileSync(join(a, 'stats.json'), 'utf8')).filters.since, '2026-09-05');
    assert.equal(JSON.parse(readFileSync(join(b, 'stats.json'), 'utf8')).filters.since, '2026-08-16');
  });

  test('run without today resolves against the local date', async () => {
    const out = outDir();
    const stderr = sink();
    const code = await run([dir, '--until', '0d', '--json', '--no-png', '--out', out], { stdout: sink(), stderr, env: {} });
    assert.equal(code, 0, stderr.data);
    assert.equal(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).filters.until, localToday());
  });

  test('bad relative values exit 2 with the message on stderr and write nothing', async () => {
    for (const [argv, msg] of [
      [['--year', '2025', '--since', '30d'], '--year cannot be combined with --since or --until'],
      [['--since', '1d', '--until', '30d'], '--since 2026-10-04 is after --until 2026-09-05'],
      [['--since', '100y'], 'invalid --since "100y": dates before 1970 are not supported'],
      [['--until', '10000d'], 'invalid --until "10000d": a relative window counts 0 to 9999 units'],
    ]) {
      const out = join(root, `bad-${Math.random().toString(36).slice(2)}`);
      const stdout = sink();
      const stderr = sink();
      const code = await run([dir, ...argv, '--no-png', '--out', out], { stdout, stderr, env: {}, today: TODAY });
      assert.equal(code, 2, argv.join(' '));
      assert.equal(stdout.data, '');
      assert.ok(stderr.data.startsWith(`gitwrapped: ${msg}\n`), stderr.data);
      assert.throws(() => readdirSync(out), { code: 'ENOENT' });
    }
  });
});
