// --until YYYY-MM-DD and --year YYYY: parsing, the author-date window, the --max-commits
// cap inside a window, the current streak relative to the window end, and window text
// on cards, footer and recap.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, HELP_TEXT, parseCli, run } from '../src/cli.js';
import { buildCardSpecs, CARD_IDS, footerText, renderShareCard, windowLabel, windowYear } from '../src/cards/index.js';
import { buildLogArgs, readHistory } from '../src/git.js';
import { computeStats } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';

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

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Dates without an offset are the machine's local time (git reads them that way), the
// same clock --since / --until YYYY-MM-DD use: boundary tests hold in every timezone.
function commit(cwd, message, date, committerDate = date) {
  git(cwd, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', message], {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_COMMITTER_DATE: committerDate,
  });
}

let dir;
const outs = [];
const tmpOut = () => {
  const o = mkdtempSync(join(tmpdir(), 'gw-window-out-'));
  outs.push(o);
  return o;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'gw-window-'));
  git(dir, ['init', '-q']);
  commit(dir, 'nye 2024', '2024-12-31 23:30:00');
  commit(dir, 'new year 2025', '2025-01-01 00:30:00');
  commit(dir, 'mar 7', '2025-03-07 12:00:00');
  commit(dir, 'mar 8', '2025-03-08 12:00:00');
  commit(dir, 'until day, late', '2025-03-09 23:59:00');
  commit(dir, 'day after until', '2025-03-10 00:00:30');
  commit(dir, 'dec 29', '2025-12-29 12:00:00');
  commit(dir, 'dec 30', '2025-12-30 12:00:00');
  commit(dir, 'nye 2025', '2025-12-31 23:00:00');
  commit(dir, 'new year 2026', '2026-01-01 00:30:00');
  commit(dir, 'jan 5 2026', '2026-01-05 12:00:00');
  // Authored in 2025, committed (rebased) in 2026, on top of the history: git's own
  // --until (committer date) would drop it, the author-date window must keep it.
  commit(dir, 'rebased', '2025-06-15 12:00:00', '2026-02-01 12:00:00');
});

after(() => {
  for (const d of [dir, ...outs]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

/** An SVG's visible text, with wrapped lines joined by spaces. */
const textOf = (file) => readFileSync(file, 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const subjects = (commits) => commits.map((c) => c.subject);
const IN_2025 = ['rebased', 'nye 2025', 'dec 30', 'dec 29', 'day after until', 'until day, late', 'mar 8', 'mar 7', 'new year 2025'];

describe('parseCli: --until and --year', () => {
  test('--until is validated like --since and only present when given', () => {
    assert.equal(parseCli(['--until', '2025-03-09']).until, '2025-03-09');
    assert.equal(parseCli(['--until=2025-03-09']).until, '2025-03-09');
    assert.equal('until' in parseCli([]), false);
    assert.equal('year' in parseCli([]), false);
    assert.throws(() => parseCli(['--until', '2025-3-9']), /invalid --until "2025-3-9": expected format YYYY-MM-DD/);
    assert.throws(() => parseCli(['--until', '2025-02-30']), /invalid --until "2025-02-30": not a real calendar date/);
    assert.throws(() => parseCli(['--until', '']), /--until requires a non-empty value/);
    assert.throws(() => parseCli(['--until']), /--until requires a value/);
  });

  test('--since after --until is an error; the same day is fine', () => {
    assert.throws(() => parseCli(['--since', '2025-03-10', '--until', '2025-03-09']), /--since 2025-03-10 is after --until 2025-03-09/);
    const o = parseCli(['--since', '2025-03-09', '--until', '2025-03-09']);
    assert.equal(o.since, '2025-03-09');
    assert.equal(o.until, '2025-03-09');
  });

  test('--year YYYY expands to Jan 1 – Dec 31', () => {
    const o = parseCli(['--year', '2025']);
    assert.equal(o.year, '2025');
    assert.equal(o.since, '2025-01-01');
    assert.equal(o.until, '2025-12-31');
    assert.equal(parseCli(['--year', '1970']).since, '1970-01-01');
    assert.equal(parseCli(['--year', '9999']).until, '9999-12-31');
  });

  test('--year rejects bad years and combining with --since / --until', () => {
    for (const bad of ['25', '20250', '1969', '0000', 'abcd', '2025-01']) {
      assert.throws(() => parseCli(['--year', bad]), /invalid --year .*: expected a four-digit year from 1970 to 9999/, bad);
    }
    assert.throws(() => parseCli(['--year', '2025', '--since', '2025-01-01']), /--year cannot be combined with --since or --until/);
    assert.throws(() => parseCli(['--until', '2025-06-01', '--year', '2025']), /--year cannot be combined with --since or --until/);
    assert.throws(() => parseCli(['--year', '']), /--year requires a non-empty value/);
  });

  test('run exits 2 with a usage hint on a bad window', async () => {
    const stderr = sink();
    assert.equal(await run(['--since', '2025-02-01', '--until', '2025-01-01'], { stdout: sink(), stderr, env: {} }), 2);
    assert.match(stderr.data, /is after --until/);
    assert.match(stderr.data, /gitwrapped --help/);
  });

  test('--help lists --until and --year', () => {
    assert.match(HELP_TEXT, /--until YYYY-MM-DD/);
    assert.match(HELP_TEXT, /--year YYYY/);
  });
});

describe('readHistory: until window (author date)', () => {
  test('until is inclusive up to the end of that local day', async () => {
    const { commits } = await readHistory(dir, { since: '2025-03-01', until: '2025-03-09' });
    assert.deepEqual(subjects(commits), ['until day, late', 'mar 8', 'mar 7']);
  });

  test('until alone keeps everything authored up to that day', async () => {
    const { commits } = await readHistory(dir, { until: '2025-01-01' });
    assert.deepEqual(subjects(commits), ['new year 2025', 'nye 2024']);
  });

  test('a year window keeps exactly that year, including a commit committed later', async () => {
    const { commits, truncated } = await readHistory(dir, { since: '2025-01-01', until: '2025-12-31' });
    assert.deepEqual(subjects(commits), IN_2025);
    assert.equal(truncated, false);
  });

  test('git gets no --until pre-filter (it would check the committer date)', () => {
    const args = buildLogArgs({ since: '2025-01-01', until: '2025-12-31' });
    assert.ok(!args.some((a) => /^--(until|before|min-age)/.test(a)), args.join(' '));
  });

  test('--max-commits counts only commits inside the window', async () => {
    const two = await readHistory(dir, { since: '2025-01-01', until: '2025-12-31', limit: 2 });
    assert.deepEqual(subjects(two.commits), IN_2025.slice(0, 2));
    assert.equal(two.truncated, true);
    const exact = await readHistory(dir, { since: '2025-01-01', until: '2025-12-31', limit: IN_2025.length });
    assert.deepEqual(subjects(exact.commits), IN_2025);
    assert.equal(exact.truncated, false);
    const oneLess = await readHistory(dir, { since: '2025-01-01', until: '2025-12-31', limit: IN_2025.length - 1 });
    assert.equal(oneLess.commits.length, IN_2025.length - 1);
    assert.equal(oneLess.truncated, true);
    const untilOnly = await readHistory(dir, { until: '2025-03-09', limit: 1 });
    assert.deepEqual(subjects(untilOnly.commits), ['until day, late']);
    assert.equal(untilOnly.truncated, true);
  });

  test('a window with no commits returns []', async () => {
    const { commits, truncated } = await readHistory(dir, { since: '2023-01-01', until: '2023-12-31' });
    assert.deepEqual(commits, []);
    assert.equal(truncated, false);
  });
});

describe('window bounds use the author-local calendar day', () => {
  let edge;
  before(() => {
    edge = mkdtempSync(join(tmpdir(), 'gw-window-tz-'));
    git(edge, ['init', '-q']);
    // Each one sits on the other side of the year boundary in UTC than for its author.
    // A machine-midnight filter misfiles some of them in every machine timezone.
    commit(edge, 'utc-12 eve 2024', '2024-12-31T23:30:00-12:00'); // 2025-01-01T11:30Z
    commit(edge, 'utc+14 new year 2025', '2025-01-01T00:30:00+14:00'); // 2024-12-31T10:30Z
    commit(edge, 'utc-5 eve 2025', '2025-12-31T23:30:00-05:00'); // 2026-01-01T04:30Z
    commit(edge, 'utc+9 new year 2026', '2026-01-01T00:30:00+09:00'); // 2025-12-31T15:30Z
    commit(edge, 'utc+14 new year 2026', '2026-01-01T00:30:00+14:00'); // 2025-12-31T10:30Z
  });
  after(() => {
    if (edge) rmSync(edge, { recursive: true, force: true, maxRetries: 5 });
  });

  test('--year keeps exactly the commits made in that year for their author', async () => {
    const { commits } = await readHistory(edge, { since: '2025-01-01', until: '2025-12-31' });
    assert.deepEqual(subjects(commits), ['utc-5 eve 2025', 'utc+14 new year 2025']);
    const stats = computeStats(commits, { today: '2025-12-31', todayComplete: true });
    assert.equal(stats.totals.firstDay, '2025-01-01');
    assert.equal(stats.totals.lastDay, '2025-12-31');
    for (const { day } of stats.daily.days) assert.ok(day.startsWith('2025-'), day);
  });

  test('--since and --until alone split on the author day too', async () => {
    assert.deepEqual(subjects((await readHistory(edge, { since: '2026-01-01' })).commits), ['utc+14 new year 2026', 'utc+9 new year 2026']);
    assert.deepEqual(subjects((await readHistory(edge, { until: '2024-12-31' })).commits), ['utc-12 eve 2024']);
    // The same through the bounded (two-pass) read with a cap.
    const capped = await readHistory(edge, { until: '2025-12-31', limit: 1 });
    assert.deepEqual(subjects(capped.commits), ['utc-5 eve 2025']);
    assert.equal(capped.truncated, true);
  });
});

describe('early 1970', () => {
  test('--year 1970 finds commits from the first days of 1970 (no pre-1970 git bound)', async () => {
    const old = mkdtempSync(join(tmpdir(), 'gw-window-1970-'));
    try {
      git(old, ['init', '-q']);
      commit(old, 'epoch-ish', '1970-01-03T12:00:00+00:00');
      commit(old, 'summer of 70', '1970-06-01T12:00:00+00:00');
      commit(old, 'leap', '2024-02-29T12:00:00+00:00');
      assert.ok(!buildLogArgs({ since: '1970-01-01' }).some((a) => a.startsWith('--since')));
      assert.ok(!buildLogArgs({ since: '1970-01-03T00:00:00Z' }).some((a) => a.startsWith('--since')));
      assert.ok(buildLogArgs({ since: '1970-02-01' }).some((a) => a.startsWith('--since-as-filter=1970-01-25')));
      const { commits } = await readHistory(old, { since: '1970-01-01', until: '1970-12-31' });
      assert.deepEqual(subjects(commits), ['summer of 70', 'epoch-ish']);
      assert.deepEqual(subjects((await readHistory(old, { since: '1970-01-02' })).commits), ['leap', 'summer of 70', 'epoch-ish']);
    } finally {
      rmSync(old, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  test('dates before 1970 are refused with a clear message', () => {
    for (const flag of ['--since', '--until']) {
      assert.throws(() => parseCli([flag, '0099-01-01']), new RegExp(`invalid ${flag} "0099-01-01": dates before 1970 are not supported`));
      assert.throws(() => parseCli([flag, '1969-12-31']), /dates before 1970 are not supported/);
    }
    assert.equal(parseCli(['--until', '1970-01-01']).until, '1970-01-01');
  });
});

describe('bounded --until read', () => {
  test('the two-pass read returns the same commits (files and lines too) as a full read', async () => {
    const fx = makeFixtureRepo();
    try {
      const full = await readHistory(fx.dir, {});
      const windowed = await readHistory(fx.dir, { until: '2999-12-31' });
      assert.deepEqual(windowed, full);
      const cappedFull = await readHistory(fx.dir, { limit: 3 });
      const cappedWindow = await readHistory(fx.dir, { until: '2999-12-31', limit: 3 });
      assert.deepEqual(cappedWindow, cappedFull);
      assert.equal(cappedWindow.truncated, true);
    } finally {
      fx.cleanup();
    }
  });
});

describe('maxBuffer advice names the window', () => {
  test('a windowed read too large for the buffer suggests a narrower window', async () => {
    await assert.rejects(readHistory(dir, { until: '2025-12-31', maxBuffer: 16 }), /narrow it down with a narrower --since\/--until\/--year window or --author/);
    await assert.rejects(readHistory(dir, { since: '2025-01-01', maxBuffer: 16 }), /narrower --since\/--until\/--year window/);
  });
});

describe('current streak relative to the window end', () => {
  test('--year: the streak running on Dec 31 of that year', async () => {
    const r = await generate({ path: dir, since: '2025-01-01', until: '2025-12-31', out: tmpOut(), png: false }, { today: TODAY });
    assert.deepEqual(r.stats.streaks.current, { length: 3, start: '2025-12-29', end: '2025-12-31' });
    const streak = textOf(r.cardFiles[3]);
    assert.match(streak, /You were on a 3-day streak at the end of 2025\./);
    assert.doesNotMatch(streak, /right now/);
  });

  test('a past window end is a complete day: the streak must reach it (no grace day)', async () => {
    const alive = await generate({ path: dir, until: '2025-03-10', out: tmpOut(), png: false }, { today: TODAY });
    assert.deepEqual(alive.stats.streaks.current, { length: 4, start: '2025-03-07', end: '2025-03-10' });
    assert.equal(alive.asOf, '2025-03-10');
    assert.equal(alive.pastWindow, true);
    assert.match(textOf(alive.cardFiles[3]), /You were on a 4-day streak on Mar 10, 2025\./);
    assert.match(textOf(alive.cardFiles[3]), /Window end/);
    // Last active day Mar 10, window ends Mar 11: the streak broke on Mar 11.
    const dead = await generate({ path: dir, until: '2025-03-11', out: tmpOut(), png: false }, { today: TODAY });
    assert.equal(dead.stats.streaks.current.length, 0);
    assert.match(textOf(dead.cardFiles[3]), /No streak was running on Mar 11, 2025\./);
  });

  test('an until on or after today keeps today as the reference', async () => {
    const r = await generate({ path: dir, since: '2026-01-01', until: '2026-12-31', out: tmpOut(), png: false }, { today: '2026-01-06' });
    assert.deepEqual(r.stats.streaks.current, { length: 1, start: '2026-01-05', end: '2026-01-05' });
    assert.match(textOf(r.cardFiles[3]), /right now/);
    const later = await generate({ path: dir, since: '2026-01-01', until: '2026-12-31', out: tmpOut(), png: false }, { today: TODAY });
    assert.equal(later.stats.streaks.current.length, 0);
  });
});

describe('window text', () => {
  test('windowYear only for an exact calendar year', () => {
    assert.equal(windowYear('2025-01-01', '2025-12-31'), '2025');
    assert.equal(windowYear('2025-01-02', '2025-12-31'), null);
    assert.equal(windowYear('2025-01-01', '2026-12-31'), null);
    assert.equal(windowYear(undefined, '2025-12-31'), null);
  });

  test('windowLabel and footerText', () => {
    assert.equal(windowLabel({}), null);
    assert.equal(windowLabel({ since: '2025-01-01', until: '2025-12-31' }), '2025');
    assert.equal(windowLabel({ since: '2025-01-03', until: '2025-03-09' }), 'Jan 3 – Mar 9, 2025');
    assert.equal(windowLabel({ since: '2024-12-30', until: '2025-01-02' }), 'Dec 30, 2024 – Jan 2, 2025');
    assert.equal(windowLabel({ until: '2025-03-09' }), 'until Mar 9, 2025');
    assert.equal(windowLabel({ since: '2025-03-09' }), 'since Mar 9, 2025');
    const stats = computeStats([], { today: TODAY });
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-01', until: '2025-12-31' }), 'demo · 2025');
    assert.equal(footerText(stats, { repoName: 'demo', until: '2025-03-09' }), 'demo · until Mar 9, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-03', until: '2025-03-09' }), 'demo · Jan 3 – Mar 9, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-03' }), 'demo · since Jan 3, 2025');
  });

  test('cards and share image show the year', async () => {
    const r = await generate({ path: dir, since: '2025-01-01', until: '2025-12-31', out: tmpOut(), png: false }, { today: TODAY });
    const intro = textOf(r.cardFiles[0]);
    assert.match(intro, /Your 2025 in git/i);
    for (const f of r.cardFiles) assert.match(readFileSync(f, 'utf8'), / · 2025</, f);
    const share = readFileSync(r.shareSvg, 'utf8');
    assert.match(share, /My 2025 Git Wrapped/i);
    assert.match(share, / · 2025</);
  });

  test('an empty year still renders friendly copy', () => {
    const stats = computeStats([], { today: TODAY });
    const specs = buildCardSpecs(stats, { repoName: 'demo', since: '2023-01-01', until: '2023-12-31', today: TODAY });
    const intro = specs.find((s) => s.id === 'intro').spec;
    assert.equal(intro.chart.title, 'Your 2023 in git');
    assert.equal(intro.chart.value, 'A quiet year');
    assert.match(renderShareCard(stats, { repoName: 'demo', since: '2023-01-01', until: '2023-12-31', author: 'a@b.c' }), /2023 Git Wrapped · a@b\.c/i);
  });

  test('the viewer title names the window', async () => {
    const r = await generate({ path: dir, since: '2025-01-01', until: '2025-12-31', out: tmpOut(), png: false }, { today: TODAY });
    assert.match(readFileSync(r.html, 'utf8'), /<title>gitwrapped · [^<]+ · 2025<\/title>/);
    const all = await generate({ path: dir, out: tmpOut(), png: false }, { today: TODAY });
    assert.match(readFileSync(all.html, 'utf8'), /<title>gitwrapped · gw-window-[^<·]+<\/title>/);
  });

  test('the recap heading shows the window', () => {
    const stats = computeStats([{ hash: 'a', author: 'A', email: 'a@x', date: '2025-05-05T12:00:00+00:00', parents: [], subject: 'x', files: [] }], { today: TODAY });
    assert.match(formatSummary(stats, { repoName: 'demo', window: '2025' }), /★ demo Wrapped · 2025/);
    assert.match(formatSummary(stats, { repoName: 'demo' }), /★ demo Wrapped\n/);
  });
});

describe('run with a window', () => {
  test('--year: recap and cards cover only that year', async () => {
    const out = tmpOut();
    const stdout = sink();
    const code = await run([dir, '--year', '2025', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.match(stdout.data, new RegExp(`^gitwrapped: ${IN_2025.length} commits → `));
    assert.match(stdout.data, /Wrapped · 2025/);
    assert.match(stdout.data, /at window end 3 days/);
    assert.doesNotMatch(stdout.data, /current \d/);
  });

  test('an empty window exits 0, still writes cards and names the filters', async () => {
    const out = tmpOut();
    const stdout = sink();
    const code = await run([dir, '--year', '2023', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.match(stdout.data, /Note: no commits match --year 2023\./);
    assert.match(stdout.data, /No commits found/);
    assert.equal(readdirSync(join(out, 'cards')).length, CARD_IDS.length);
    assert.ok(existsSync(join(out, 'wrapped.html')));

    const stdout2 = sink();
    await run([dir, '--since', '2023-01-01', '--until', '2023-02-01', '--author', 'ada@example.com', '--no-png', '--out', tmpOut()], { stdout: stdout2, stderr: sink(), env: {}, today: TODAY });
    assert.match(stdout2.data, /Note: no commits match --since 2023-01-01 --until 2023-02-01 --author ada@example\.com\./);
  });

  test('the cap note counts a window as a filter', async () => {
    const stdout = sink();
    await run([dir, '--year', '2025', '--max-commits', '2', '--no-png', '--out', tmpOut()], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.match(stdout.data, /more than 2 matching commits; only the most recent 2 were analyzed/);
  });
});
