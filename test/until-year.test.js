// --until YYYY-MM-DD and --year YYYY: CLI parsing, the git pre-filter, the exact
// author-date window, and how the window shows up on the cards and in the recap.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, parseCli, run, windowLabel, HELP_TEXT } from '../src/cli.js';
import { buildLogArgs, readHistory, UNTIL_SLACK_DAYS } from '../src/git.js';
import { buildCardSpecs, buildCards, footerText, layoutCard, renderShareCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { computeStats } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** ISO 8601 for a *local* wall-clock time, with this machine's UTC offset at that moment. */
function local(y, m, d, h = 12, mi = 0, s = 0) {
  const t = new Date(y, m - 1, d, h, mi, s);
  const off = -t.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

function sink() {
  let data = '';
  return { write(s) { data += s; return true; }, get data() { return data; } };
}

// --- CLI parsing ----------------------------------------------------------------------

describe('parseCli: --until and --year', () => {
  test('--until is parsed and validated', () => {
    const o = parseCli(['--until', '2025-03-31']);
    assert.equal(o.until, '2025-03-31');
    assert.equal(o.since, undefined);
    assert.equal(o.year, undefined);
    assert.equal(parseCli(['--until=2025-03-31']).until, '2025-03-31');
    assert.throws(() => parseCli(['--until', 'x']), /^Error: invalid --until "x": expected format YYYY-MM-DD$/);
    assert.throws(() => parseCli(['--until', '2025-02-30']), /invalid --until "2025-02-30": not a real calendar date/);
    assert.throws(() => parseCli(['--since', 'nope']), /invalid --since "nope": expected format YYYY-MM-DD/);
  });

  test('--since with --until', () => {
    const o = parseCli(['--since', '2025-01-01', '--until', '2025-03-31']);
    assert.equal(o.since, '2025-01-01');
    assert.equal(o.until, '2025-03-31');
    assert.equal(o.year, undefined);
    // A one-day window is fine.
    assert.equal(parseCli(['--since', '2025-01-01', '--until', '2025-01-01']).until, '2025-01-01');
  });

  test('--until before --since is an error', () => {
    assert.throws(() => parseCli(['--since', '2025-03-31', '--until', '2025-01-01']), /^Error: --until \(2025-01-01\) is before --since \(2025-03-31\)$/);
  });

  test('--year fills since / until with the calendar year', () => {
    const o = parseCli(['--year', '2025']);
    assert.equal(o.year, 2025);
    assert.equal(o.since, '2025-01-01');
    assert.equal(o.until, '2025-12-31');
    assert.equal(parseCli(['--year=1970']).year, 1970);
    assert.equal(parseCli(['--year', '9999']).until, '9999-12-31');
    // Defaults are untouched.
    assert.equal(parseCli([]).year, undefined);
    assert.equal(parseCli([]).until, undefined);
  });

  test('invalid --year values', () => {
    for (const bad of ['25', '20251', 'abcd', '1969', '0000', '2025.0', '-2025', '+202', '2O25']) {
      assert.throws(() => parseCli([`--year=${bad}`]), new RegExp(`^Error: invalid --year "${bad.replace(/[.+]/g, '\\$&')}": expected a 4-digit year like 2025$`), bad);
    }
  });

  test('--year cannot be combined with --since or --until', () => {
    for (const argv of [['--year', '2025', '--since', '2025-01-01'], ['--until', '2025-12-31', '--year', '2025'], ['--year', '2025', '--since', '2025-01-01', '--until', '2025-02-01']]) {
      assert.throws(() => parseCli(argv), /^Error: --year cannot be combined with --since or --until$/);
    }
  });

  test('empty and missing values', () => {
    for (const name of ['until', 'year']) {
      assert.throws(() => parseCli([`--${name}`, '  ']), new RegExp(`--${name} requires a non-empty value`));
      assert.throws(() => parseCli([`--${name}=`]), new RegExp(`--${name} requires a non-empty value`));
      assert.throws(() => parseCli([`--${name}`]), new RegExp(`^Error: --${name} requires a value$`));
      assert.throws(() => parseCli([`--${name}`, '--no-png']), new RegExp(`^Error: --${name} requires a value$`));
    }
  });

  test('run() exits 2 with a usage hint on a bad window', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await run(['--year', '2025', '--until', '2025-06-01'], { stdout, stderr, env: {} });
    assert.equal(code, 2);
    assert.equal(stdout.data, '');
    assert.match(stderr.data, /^gitwrapped: --year cannot be combined with --since or --until\nRun "gitwrapped --help" for usage\.\n$/);
  });

  test('help text documents both options', () => {
    assert.match(HELP_TEXT, /--until YYYY-MM-DD/);
    assert.match(HELP_TEXT, /--year YYYY/);
    assert.ok(HELP_TEXT.indexOf('--since') < HELP_TEXT.indexOf('--until'));
    assert.ok(HELP_TEXT.indexOf('--until') < HELP_TEXT.indexOf('--year'));
  });

  test('windowLabel', () => {
    assert.equal(windowLabel({ since: '2025-01-01', until: '2025-12-31', year: 2025 }), '2025');
    assert.equal(windowLabel({ since: '2025-01-01', until: '2025-03-31' }), '2025-01-01 → 2025-03-31');
    assert.equal(windowLabel({ since: '2025-01-01' }), 'since 2025-01-01');
    assert.equal(windowLabel({ until: '2025-03-31' }), 'through 2025-03-31');
    assert.equal(windowLabel({}), undefined);
  });
});

// --- git pre-filter ---------------------------------------------------------------------

describe('buildLogArgs: --until pre-filter', () => {
  test('sends --until UNTIL_SLACK_DAYS after the day, at the end of the local day', () => {
    assert.equal(UNTIL_SLACK_DAYS, 31);
    const args = buildLogArgs({ until: '2025-03-31' });
    assert.ok(args.includes('--until=2025-05-01 23:59:59'), args.join(' '));
    // Month and year rollover.
    assert.ok(buildLogArgs({ until: '2025-12-31' }).includes('--until=2026-01-31 23:59:59'));
  });

  test('works with or without --since-as-filter support, and without until no --until', () => {
    const old = buildLogArgs({ since: '2025-01-01', until: '2025-12-31', sinceAsFilter: false });
    assert.ok(old.includes('--until=2026-01-31 23:59:59'));
    assert.ok(!old.some((a) => a.startsWith('--since')));
    const both = buildLogArgs({ since: '2025-01-01', until: '2025-12-31', maxCount: 10 });
    assert.ok(both.some((a) => a.startsWith('--since-as-filter=')));
    assert.ok(both.includes('--max-count=10'));
    assert.ok(!buildLogArgs({ since: '2025-01-01' }).some((a) => a.startsWith('--until')));
    assert.ok(!buildLogArgs().some((a) => a.startsWith('--until')));
  });
});

// --- fixture repo -----------------------------------------------------------------------

describe('readHistory: author-date window on a real repo', () => {
  let root;
  let dir;

  function git(args, env = {}) {
    const e = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete e[k];
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: e, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  let n = 0;
  function commit(subject, author, committer = author) {
    n += 1;
    writeFileSync(join(dir, 'f.txt'), `${subject} ${n}\n`);
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', subject], {
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: author,
      GIT_COMMITTER_DATE: committer,
    });
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gitwrapped-until-'));
    dir = join(root, 'window-repo');
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);
    // Oldest first (by committer date, so git's walk order matches).
    commit('before the year', local(2023, 12, 31, 12));
    commit('mid year', local(2024, 6, 1, 12));
    // Committed more than UNTIL_SLACK_DAYS after the year: outside git's pre-filter.
    commit('rebased far later', local(2024, 11, 1, 12), local(2025, 3, 1, 12));
    // Authored inside the year, committed after it (a rebase): kept.
    commit('rebased in january', local(2024, 12, 15, 12), local(2025, 1, 20, 12));
    commit('last minute', local(2024, 12, 31, 23, 59));
    commit('new year', local(2025, 1, 1, 0, 0, 30));
    commit('spring', local(2025, 3, 1, 12, 0, 1));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  const subjects = (r) => r.commits.map((c) => c.subject);

  test('until keeps the whole last day and drops the day after', async () => {
    const r = await readHistory(dir, { until: '2024-12-31' });
    assert.deepEqual(subjects(r), ['last minute', 'rebased in january', 'mid year', 'before the year']);
    assert.equal(r.truncated, false);
  });

  test('since + until (a calendar year) uses author dates on both ends', async () => {
    const r = await readHistory(dir, { since: '2024-01-01', until: '2024-12-31' });
    assert.deepEqual(subjects(r), ['last minute', 'rebased in january', 'mid year']);
  });

  test('a commit whose committer date is more than the slack after until is not seen', async () => {
    const r = await readHistory(dir, { until: '2024-12-31' });
    assert.ok(!subjects(r).includes('rebased far later'));
    // ...but a window that reaches its committer date (within the slack) finds it.
    const wide = await readHistory(dir, { until: '2025-02-28' });
    assert.ok(subjects(wide).includes('rebased far later'));
    assert.ok(!subjects(wide).includes('spring'));
  });

  test('the cap re-read: slack commits using up capped slots do not hide matches', async () => {
    // With limit 2 git returns the 3 newest commits inside the loose pre-filter, and
    // "new year" (authored after the window) wastes one slot: the full re-read finds the
    // real second match and still reports the truncation.
    const r = await readHistory(dir, { until: '2024-12-31', limit: 2 });
    assert.deepEqual(subjects(r), ['last minute', 'rebased in january']);
    assert.equal(r.truncated, true);
    const one = await readHistory(dir, { since: '2024-01-01', until: '2024-12-31', limit: 3 });
    assert.deepEqual(subjects(one), ['last minute', 'rebased in january', 'mid year']);
    assert.equal(one.truncated, false);
  });

  test('generate --year: footer year on every card, intro and share copy, window streak', async () => {
    const out = join(root, 'out-gen');
    const opts = parseCli([dir, '--year', '2024', '--out', out, '--no-png']);
    const r = await generate(opts, { today: '2026-10-05' });
    assert.equal(r.commits, 3);
    assert.equal(r.year, 2024);
    assert.equal(r.since, '2024-01-01');
    assert.equal(r.until, '2024-12-31');
    // Streaks are measured at the end of the window: the Dec 31 commit is still "current".
    assert.equal(r.stats.streaks.current.length, 1);
    for (const f of r.cardFiles) {
      assert.ok(readFileSync(f, 'utf8').includes('>window-repo · 2024<'), `${f} footer`);
    }
    const intro = readFileSync(r.cardFiles[0], 'utf8');
    assert.ok(intro.includes('>2024 Wrapped<'));
    assert.ok(intro.includes('YOUR 2024 IN COMMITS') || intro.includes('Your 2024 in commits'));
    const share = readFileSync(r.shareSvg, 'utf8');
    assert.ok(share.includes('>MY 2024 GIT WRAPPED<'));
    assert.ok(share.includes('>window-repo · 2024<'));
  });

  test('generate with an until in the future keeps the real today', async () => {
    const out = join(root, 'out-future');
    const r = await generate(parseCli([dir, '--until', '2099-01-01', '--out', out, '--no-png']), { today: '2026-10-05' });
    assert.equal(r.commits, 7);
    assert.equal(r.stats.streaks.current.length, 0, 'the last commit was long before today');
    // An explicit today earlier than until is kept.
    const early = await generate(parseCli([dir, '--until', '2024-12-31', '--out', out, '--no-png']), { today: '2024-06-02' });
    assert.equal(early.stats.streaks.current.length, 0);
  });

  test('run --year: the recap header and the card footer show the year', async () => {
    const out = join(root, 'out-run');
    const stdout = sink();
    const stderr = sink();
    const fakePng = async () => Buffer.from('png');
    const code = await run([dir, '--year', '2024', '--out', out], { stdout, stderr, env: {}, today: '2026-10-05', renderPng: fakePng });
    assert.equal(code, 0, stderr.data);
    assert.match(stdout.data, /^gitwrapped: 3 commits → /);
    assert.match(stdout.data, /★ window-repo Wrapped · 2024\n/);
    assert.ok(readFileSync(join(out, 'cards', '09-outro.svg'), 'utf8').includes('>window-repo · 2024<'));
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'png');
  });

  test('run --since/--until: recap window and footer range', async () => {
    const out = join(root, 'out-range');
    const stdout = sink();
    const code = await run([dir, '--since', '2024-06-01', '--until', '2024-12-31', '--out', out, '--no-png'], { stdout, stderr: sink(), env: {}, today: '2026-10-05' });
    assert.equal(code, 0);
    assert.match(stdout.data, /★ window-repo Wrapped · 2024-06-01 → 2024-12-31\n/);
    assert.ok(readFileSync(join(out, 'cards', '01-intro.svg'), 'utf8').includes('>window-repo · Jun 1 – Dec 31, 2024<'));
  });

  test('run with a window that matches nothing still succeeds', async () => {
    const out = join(root, 'out-empty');
    const stdout = sink();
    const code = await run([dir, '--year', '2001', '--out', out, '--no-png'], { stdout, stderr: sink(), env: {}, today: '2026-10-05' });
    assert.equal(code, 0);
    assert.match(stdout.data, /^gitwrapped: 0 commits → /);
    assert.match(stdout.data, /No commits found/);
    assert.ok(readFileSync(join(out, 'cards', '01-intro.svg'), 'utf8').includes('>window-repo · 2001<'));
  });
});

// --- cards ------------------------------------------------------------------------------

describe('cards: requested window', () => {
  const stats = computeStats([
    { hash: 'a', author: 'A', email: 'a@x', date: '2025-02-03T10:00:00+00:00', parents: [], subject: 'feat: a', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
    { hash: 'b', author: 'A', email: 'a@x', date: '2025-02-10T10:00:00+00:00', parents: [], subject: 'fix: b', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
  ], { today: '2025-12-31' });

  test('footerText variants', () => {
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-01', until: '2025-12-31', year: 2025 }), 'demo · 2025');
    assert.equal(footerText(stats, { repoName: 'demo', year: '2025' }), 'demo · 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-01', until: '2025-03-31' }), 'demo · Jan 1 – Mar 31, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2024-11-01', until: '2025-03-31' }), 'demo · Nov 1, 2024 – Mar 31, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-03-31', until: '2025-03-31' }), 'demo · Mar 31, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', since: '2025-01-01' }), 'demo · since Jan 1, 2025');
    assert.equal(footerText(stats, { repoName: 'demo', until: '2025-03-31' }), 'demo · through Mar 31, 2025');
    assert.equal(footerText(stats, { repoName: 'demo' }), 'demo · Feb 3 – Feb 10, 2025');
    assert.equal(footerText(stats, { repoName: 'gitwrapped', year: 2025 }), '2025');
    assert.equal(footerText({}, { repoName: 'demo', until: '2025-03-31' }), 'demo · through Mar 31, 2025');
  });

  test('intro with a year: eyebrow, one-line title and callout, inside the layout', () => {
    for (const s of [stats, computeStats([], { today: '2025-12-31' })]) {
      for (const repoName of ['demo', 'a-rather-long-repository-name-here']) {
        const spec = buildCardSpecs(s, { repoName, year: 2025, author: 'someone.with.a.long.email@example.com' }).find((c) => c.id === 'intro').spec;
        assert.equal(spec.eyebrow, 'gitwrapped presents · 2025');
        assert.equal(spec.title, '2025 Wrapped');
        assert.equal(spec.chart.title, 'Your 2025 in commits');
        const layout = layoutCard(spec);
        const title = layout.blocks.find((b) => b.kind === 'title');
        assert.ok(title.svg.includes('>2025 Wrapped<'), 'title on one line');
        for (const b of layout.blocks) {
          assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${b.kind} inside the content area`);
        }
        for (let i = 1; i < layout.blocks.length; i++) assert.ok(layout.blocks[i - 1].bottom <= layout.blocks[i].top, 'no overlap');
      }
    }
  });

  test('without a year the intro is unchanged', () => {
    const spec = buildCardSpecs(stats, { repoName: 'demo', since: '2025-01-01', until: '2025-03-31' }).find((c) => c.id === 'intro').spec;
    assert.equal(spec.eyebrow, 'gitwrapped presents');
    assert.equal(spec.title, 'Wrapped');
    assert.equal(spec.chart.title, 'Your story so far');
  });

  test('every card carries the window footer; empty stats still render cleanly', () => {
    for (const s of [stats, computeStats([], { today: '2025-12-31' }), {}]) {
      for (const { id, svg } of buildCards(s, { repoName: 'demo', year: 2025 })) {
        assert.ok(svg.includes('>demo · 2025<'), id);
        assert.ok(!/NaN|undefined|null/.test(svg.replace(/<[^>]*>/g, ' ')), id);
      }
    }
  });

  test('share card eyebrow with a year', () => {
    // The share image draws its eyebrow in capitals.
    assert.ok(renderShareCard(stats, { repoName: 'demo', year: 2025 }).includes('>MY 2025 GIT WRAPPED<'));
    assert.ok(renderShareCard(stats, { repoName: 'demo', year: 2025, author: 'a@x' }).includes('>GIT WRAPPED 2025 · A@X<'));
    assert.ok(renderShareCard(stats, { repoName: 'demo' }).includes('>MY GIT WRAPPED<'));
    assert.ok(renderShareCard(stats, { repoName: 'demo', author: 'a@x' }).includes('>GIT WRAPPED · A@X<'));
    assert.ok(renderShareCard({}, { repoName: 'demo', until: '2025-03-31' }).includes('>demo · through Mar 31, 2025<'));
  });
});

// --- recap ------------------------------------------------------------------------------

describe('formatSummary: window header', () => {
  const stats = computeStats([
    { hash: 'a', author: 'A', email: 'a@x', date: '2025-02-03T10:00:00+00:00', parents: [], subject: 'feat: a', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
  ], { today: '2025-12-31' });

  test('window is appended to the heading', () => {
    assert.match(formatSummary(stats, { repoName: 'demo', window: '2025' }), /\n {2}★ demo Wrapped · 2025\n/);
    assert.match(formatSummary(stats, { repoName: 'demo', window: 'since 2025-01-01' }), /★ demo Wrapped · since 2025-01-01\n/);
    assert.match(formatSummary(stats, { repoName: 'demo' }), /★ demo Wrapped\n/);
    assert.match(formatSummary(stats, {}), /★ Wrapped\n/);
  });

  test('window text is stripped of control characters, also in color', () => {
    const out = formatSummary(stats, { repoName: 'demo', window: '20\x1b[31m25\x07' });
    assert.match(out, /★ demo Wrapped · 20\[31m25\n/);
    assert.ok(!out.includes('\x1b'));
    const colored = formatSummary(stats, { repoName: 'demo', window: '2025', color: true });
    assert.ok(colored.includes('★ demo Wrapped · 2025'));
  });
});

// --- more edge cases (tester) -------------------------------------------------------------

describe('parseCli: leap days and one-day windows', () => {
  test('--until accepts real leap days and rejects fake ones', () => {
    assert.equal(parseCli(['--until', '2024-02-29']).until, '2024-02-29');
    assert.equal(parseCli(['--until', '2000-02-29']).until, '2000-02-29');
    for (const bad of ['2025-02-29', '1900-02-29', '2025-13-01', '2025-00-10', '2025-04-31']) {
      assert.throws(() => parseCli(['--until', bad]), new RegExp(`^Error: invalid --until "${bad}": not a real calendar date$`), bad);
    }
    assert.throws(() => parseCli(['--until', '2025-1-1']), /^Error: invalid --until "2025-1-1": expected format YYYY-MM-DD$/);
  });

  test('--until equal to --since is a one-day window; a leap-year --year ends on Dec 31', () => {
    const o = parseCli(['--since', '2024-02-29', '--until', '2024-02-29']);
    assert.deepEqual([o.since, o.until, o.year], ['2024-02-29', '2024-02-29', undefined]);
    assert.equal(windowLabel(o), '2024-02-29', 'a one-day window is labeled with the day alone');
    const y = parseCli(['--year', '2024']);
    assert.deepEqual([y.since, y.until], ['2024-01-01', '2024-12-31']);
  });

  test('--year is trimmed; --year with an invalid --since still reports the --since error first', () => {
    assert.equal(parseCli(['--year', ' 2025 ']).year, 2025);
    assert.throws(() => parseCli(['--year', '2025', '--since', 'bad']), /^Error: invalid --since "bad"/);
    assert.throws(() => parseCli(['--year', 'bad', '--until', '2025-01-01']), /^Error: --year cannot be combined with --since or --until$/);
  });

  test('run() exit codes and messages for invalid windows', async () => {
    const cases = [
      [['--year', '2025', '--since', '2025-02-01'], '--year cannot be combined with --since or --until'],
      [['--year', '99'], 'invalid --year "99": expected a 4-digit year like 2025'],
      [['--until', '2025-02-30'], 'invalid --until "2025-02-30": not a real calendar date'],
      [['--until'], '--until requires a value'],
      [['--year='], '--year requires a non-empty value'],
      [['--since', '2025-02-01', '--until', '2025-01-31'], '--until (2025-01-31) is before --since (2025-02-01)'],
    ];
    for (const [argv, msg] of cases) {
      const stdout = sink();
      const stderr = sink();
      const code = await run(argv, { stdout, stderr, env: {} });
      assert.equal(code, 2, argv.join(' '));
      assert.equal(stdout.data, '');
      assert.equal(stderr.data, `gitwrapped: ${msg}\nRun "gitwrapped --help" for usage.\n`);
    }
  });
});

describe('window edge cases on a real repo', () => {
  let root;
  let dir;

  function git(args, env = {}) {
    const e = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete e[k];
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: e, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  let n = 0;
  function commit(subject, date, email = 'ada@example.com') {
    n += 1;
    writeFileSync(join(dir, 'f.txt'), `${subject} ${n}\n`);
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', subject], {
      GIT_AUTHOR_NAME: 'Dev',
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gitwrapped-until-edge-'));
    dir = join(root, 'edge-repo');
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);
    // Oldest first.
    commit('leap eve', local(2024, 2, 28, 23, 59, 59));
    commit('leap day', local(2024, 2, 29, 0, 0, 0));
    commit('leap night', local(2024, 2, 29, 23, 59, 59), 'bob@example.com');
    commit('march first', local(2024, 3, 1, 0, 0, 0));
    // 3 commits inside a Jan 2025 window...
    commit('in 1', local(2025, 1, 10, 12), 'bob@example.com');
    commit('in 2', local(2025, 1, 20, 12));
    commit('in 3', local(2025, 1, 30, 12), 'bob@example.com');
    // ...and 5 after it: three inside git's --until slack, two beyond it.
    commit('after 1', local(2025, 2, 5, 12));
    commit('after 2', local(2025, 2, 10, 12));
    commit('after 3', local(2025, 2, 20, 12));
    commit('after 4', local(2025, 4, 1, 12));
    commit('after 5', local(2025, 5, 1, 12));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  const subjects = (r) => r.commits.map((c) => c.subject);

  test('a one-day window on a leap day keeps exactly that day, edges included', async () => {
    const r = await readHistory(dir, { since: '2024-02-29', until: '2024-02-29' });
    assert.deepEqual(subjects(r), ['leap night', 'leap day']);
    assert.equal(r.truncated, false);
    assert.deepEqual(subjects(await readHistory(dir, { until: '2024-02-28' })), ['leap eve']);
  });

  test('generate with a one-day window: footer and intro show the single day', async () => {
    const out = join(root, 'out-one-day');
    const r = await generate(parseCli([dir, '--since', '2024-02-29', '--until', '2024-02-29', '--out', out, '--no-png']), { today: '2026-10-05' });
    assert.equal(r.commits, 2);
    assert.equal(r.stats.streaks.current.length, 1, 'the window ends on its only active day');
    const intro = readFileSync(r.cardFiles[0], 'utf8');
    assert.ok(intro.includes('>edge-repo · Feb 29, 2024<'));
    assert.ok(intro.includes('>Feb 29, 2024<'), 'intro callout range');
    assert.ok(intro.includes('>2 commits to unwrap<'));
  });

  test('--year 2024 includes the leap day', async () => {
    const out = join(root, 'out-leap-year');
    const r = await generate(parseCli([dir, '--year', '2024', '--out', out, '--no-png']), { today: '2026-10-05' });
    assert.equal(r.commits, 4);
    assert.equal(r.stats.totals.firstDay, '2024-02-28');
    assert.equal(r.stats.totals.lastDay, '2024-03-01');
  });

  test('--year with --author filters on both', async () => {
    const out = join(root, 'out-year-author');
    const stdout = sink();
    const code = await run([dir, '--year', '2025', '--author', 'BOB@example.com', '--out', out, '--no-png'], { stdout, stderr: sink(), env: {}, today: '2026-10-05' });
    assert.equal(code, 0);
    assert.match(stdout.data, /^gitwrapped: 2 commits → /);
    assert.match(stdout.data, /★ edge-repo Wrapped · 2025\n/);
    const intro = readFileSync(join(out, 'cards', '01-intro.svg'), 'utf8');
    assert.ok(intro.includes('>2025 Wrapped<'));
    // The subtitle wraps, so check the text with the line breaks removed.
    assert.match(intro.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), /Starring BOB@example\.com\./);
    assert.ok(intro.includes('>edge-repo · 2025<'));
    const r = await readHistory(dir, { since: '2025-01-01', until: '2025-12-31', author: 'bob@example.com' });
    assert.deepEqual(subjects(r), ['in 3', 'in 1']);
  });

  test('--max-commits counts only in-window commits with --until', async () => {
    const capped = await readHistory(dir, { since: '2025-01-01', until: '2025-01-31', limit: 2 });
    assert.deepEqual(subjects(capped), ['in 3', 'in 2']);
    assert.equal(capped.truncated, true);
    const untilOnly = await readHistory(dir, { until: '2025-01-31', limit: 2 });
    assert.deepEqual(subjects(untilOnly), ['in 3', 'in 2']);
    assert.equal(untilOnly.truncated, true);
    const exact = await readHistory(dir, { since: '2025-01-01', until: '2025-01-31', limit: 3 });
    assert.deepEqual(subjects(exact), ['in 3', 'in 2', 'in 1']);
    assert.equal(exact.truncated, false);
  });

  test('run --until --max-commits: the cap note says "matching commits"', async () => {
    const out = join(root, 'out-cap');
    const stdout = sink();
    const code = await run([dir, '--until', '2025-01-31', '--max-commits', '2', '--out', out, '--no-png'], { stdout, stderr: sink(), env: {}, today: '2026-10-05' });
    assert.equal(code, 0);
    assert.match(stdout.data, /^gitwrapped: 2 commits → /);
    assert.match(stdout.data, /★ edge-repo Wrapped · through 2025-01-31\n/);
    assert.match(stdout.data, /Note: more than 2 matching commits; only the most recent 2 were analyzed\./);
    const cap3 = sink();
    await run([dir, '--since', '2025-01-01', '--until', '2025-01-31', '--max-commits', '3', '--out', out, '--no-png'], { stdout: cap3, stderr: sink(), env: {}, today: '2026-10-05' });
    assert.match(cap3.data, /^gitwrapped: 3 commits → /);
    assert.ok(!cap3.data.includes('Note: more than'));
  });
});

// --- fix round 1 ----------------------------------------------------------------------

/** A throwaway repo whose commits carry the given author / committer dates. */
function makeRepo(prefix, commits) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(root, 'repo');
  const baseEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete baseEnv[k];
  const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...baseEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: baseEnv });
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  commits.forEach(([subject, author, committer = author], i) => {
    writeFileSync(join(dir, 'f.txt'), `${subject} ${i}\n`);
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', subject], {
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: author,
      GIT_COMMITTER_DATE: committer,
    });
  });
  return { root, dir };
}

describe('bounded re-read when slack commits fill the capped slots', () => {
  let repo;
  let wrapDir;
  let logFile;
  const saved = {};

  before(() => {
    const commits = [
      ['old 1', local(2024, 6, 1)],
      ['old 2', local(2024, 7, 1)],
      ['in 1', local(2025, 1, 10)],
      ['in 2', local(2025, 1, 20)],
      ['in 3', local(2025, 1, 30)],
    ];
    // Nine commits after --until 2025-01-31 but inside git's 31-day --until slack.
    for (let d = 1; d <= 7; d++) commits.push([`feb ${d}`, local(2025, 2, d)]);
    commits.push(['mar in 1', local(2025, 3, 1)], ['mar in 2', local(2025, 3, 2)]);
    // Five rebased commits on top: authored in 2024, committed after --since 2025-03-01.
    for (let i = 1; i <= 5; i++) commits.push([`rebased ${i}`, local(2024, 1, i), local(2025, 3, 9 + i)]);
    repo = makeRepo('gitwrapped-reread-', commits);
    if (process.platform === 'win32') return;
    // A `git` wrapper first on PATH logs each call's arguments, then runs the real git.
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    wrapDir = join(repo.root, 'bin');
    logFile = join(repo.root, 'git-calls.log');
    execFileSync('mkdir', [wrapDir]);
    writeFileSync(join(wrapDir, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GW_GIT_LOG"\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  });

  after(() => {
    if (repo) rmSync(repo.root, { recursive: true, force: true, maxRetries: 5 });
  });

  /** Run `fn` with the logging git wrapper on PATH; returns [result, git log calls]. */
  async function withGitLog(fn) {
    writeFileSync(logFile, '');
    saved.PATH = process.env.PATH;
    saved.GW_GIT_LOG = process.env.GW_GIT_LOG;
    process.env.PATH = `${wrapDir}:${process.env.PATH}`;
    process.env.GW_GIT_LOG = logFile;
    try {
      const result = await fn();
      const calls = readFileSync(logFile, 'utf8').split('\n').filter((l) => /(^| )log( |$)/.test(l));
      return [result, calls];
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.GW_GIT_LOG === undefined) delete process.env.GW_GIT_LOG;
      else process.env.GW_GIT_LOG = saved.GW_GIT_LOG;
    }
  }

  test('--until: the right commits, and every re-read keeps a --max-count', async (t) => {
    if (process.platform === 'win32') return t.skip('needs a POSIX shell wrapper for git');
    const [r, calls] = await withGitLog(() => readHistory(repo.dir, { until: '2025-01-31', limit: 2 }));
    assert.deepEqual(r.commits.map((c) => c.subject), ['in 3', 'in 2']);
    assert.equal(r.truncated, true);
    assert.ok(calls.length >= 2, `re-read happened: ${calls.length} calls`);
    for (const c of calls) assert.match(c, /--max-count=\d+/, `uncapped git log: ${c}`);
    const caps = calls.map((c) => Number(/--max-count=(\d+)/.exec(c)[1]));
    assert.equal(caps[0], 3, 'first read asks for limit + 1');
    for (let i = 1; i < caps.length; i++) assert.ok(caps[i] > caps[i - 1], `caps grow: ${caps.join(', ')}`);
  });

  test('--since: rebased commits on top are skipped with a bounded re-read too', async (t) => {
    if (process.platform === 'win32') return t.skip('needs a POSIX shell wrapper for git');
    const [r, calls] = await withGitLog(() => readHistory(repo.dir, { since: '2025-03-01', limit: 1 }));
    assert.deepEqual(r.commits.map((c) => c.subject), ['mar in 2']);
    assert.equal(r.truncated, true);
    assert.ok(calls.length >= 2);
    for (const c of calls) assert.match(c, /--max-count=\d+/, `uncapped git log: ${c}`);
  });

  test('results match an uncapped read for every small limit', async () => {
    for (const window of [{ until: '2025-01-31' }, { since: '2025-03-01' }, { since: '2025-01-15', until: '2025-02-03' }]) {
      const all = (await readHistory(repo.dir, { ...window, limit: Infinity })).commits.map((c) => c.subject);
      for (let limit = 1; limit <= all.length + 1; limit++) {
        const r = await readHistory(repo.dir, { ...window, limit });
        assert.deepEqual(r.commits.map((c) => c.subject), all.slice(0, limit), `${JSON.stringify(window)} limit ${limit}`);
        assert.equal(r.truncated, all.length > limit);
      }
    }
  });
});

describe('author-local calendar days decide the window', () => {
  let repo;
  before(() => {
    repo = makeRepo('gitwrapped-tz-', [
      // 2024-12-31T10:30Z, but Jan 1, 2025 for its author.
      ['kiribati new year', '2025-01-01T00:30:00+14:00'],
      // 2026-01-01T04:00Z, but still Dec 31, 2025 for its author.
      ['california eve', '2025-12-31T20:00:00-08:00'],
      // 2025-12-31T16:00Z, but already Jan 1, 2026 for its author.
      ['tokyo new year', '2026-01-01T01:00:00+09:00'],
    ]);
  });
  after(() => {
    if (repo) rmSync(repo.root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('--year 2025 keeps exactly the commits dated 2025 by their authors', async () => {
    const r = await readHistory(repo.dir, { since: '2025-01-01', until: '2025-12-31' });
    assert.deepEqual(r.commits.map((c) => c.subject), ['california eve', 'kiribati new year']);
    assert.deepEqual((await readHistory(repo.dir, { since: '2026-01-01' })).commits.map((c) => c.subject), ['tokyo new year']);
    assert.deepEqual((await readHistory(repo.dir, { until: '2024-12-31' })).commits, []);
  });

  test('the same result in any machine time zone', () => {
    const script = `
      const { readHistory } = await import(${JSON.stringify(new URL('../src/git.js', import.meta.url).href)});
      const r = await readHistory(process.argv[1], { since: '2025-01-01', until: '2025-12-31' });
      process.stdout.write(JSON.stringify(r.commits.map((c) => c.subject)));
    `;
    for (const TZ of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, repo.dir], { encoding: 'utf8', env: { ...process.env, TZ } });
      assert.deepEqual(JSON.parse(out), ['california eve', 'kiribati new year'], TZ);
    }
  });

  test('the --year intro callout never shows a date outside the year', async () => {
    const out = join(repo.root, 'out');
    const r = await generate(parseCli([repo.dir, '--year', '2025', '--out', out, '--no-png']), { today: '2026-10-05' });
    assert.equal(r.stats.totals.firstDay, '2025-01-01');
    assert.equal(r.stats.totals.lastDay, '2025-12-31');
    const intro = readFileSync(r.cardFiles[0], 'utf8');
    assert.ok(intro.includes('>Jan 1 – Dec 31, 2025<'));
    assert.ok(!/2024|2026/.test(intro.replace(/<[^>]*>/g, ' ')), 'no other year on the intro');
  });
});

describe('streak at the end of a past window', () => {
  const day = (d, h = 12) => ({ hash: `${d}-${h}`, author: 'A', email: 'a@x', date: `${d}T${String(h).padStart(2, '0')}:00:00+00:00`, parents: [], subject: 'feat: x', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
  const streakSpec = (stats, opts) => buildCardSpecs(stats, { repoName: 'demo', ...opts }).find((c) => c.id === 'streak').spec;
  const ending = computeStats([day('2024-12-29'), day('2024-12-30'), day('2024-12-31')], { today: '2024-12-31' });
  const lapsed = computeStats([day('2024-12-01'), day('2024-12-02')], { today: '2024-12-31' });

  test('with --year: "You ended 2024 on a 3-day streak."', () => {
    const spec = streakSpec(ending, { year: 2024, since: '2024-01-01', until: '2024-12-31', streakAsOf: '2024-12-31' });
    assert.match(spec.subtitle, /You ended 2024 on a 3-day streak\.$/);
    assert.ok(!/right now/.test(spec.subtitle));
    assert.equal(spec.chart.title, 'Longest vs. end of 2024');
    assert.deepEqual(spec.chart.items.map((i) => i.label), ['Longest', 'End of 2024']);
    assert.match(streakSpec(lapsed, { year: 2024, streakAsOf: '2024-12-31' }).subtitle, /No streak running on Dec 31, 2024\.$/);
  });

  test('with --until: the formatted end day', () => {
    const spec = streakSpec(ending, { until: '2024-12-31', streakAsOf: '2024-12-31' });
    assert.match(spec.subtitle, /You were on a 3-day streak on Dec 31, 2024\.$/);
    assert.equal(spec.chart.items[1].label, 'At window end');
    assert.match(streakSpec(lapsed, { until: '2024-12-31', streakAsOf: '2024-12-31' }).subtitle, /No streak running on Dec 31, 2024\.$/);
  });

  test('without streakAsOf the copy is unchanged', () => {
    const spec = streakSpec(ending, { until: '2024-12-31' });
    assert.match(spec.subtitle, /You're on a 3-day streak right now\. Keep it alive!$/);
    assert.equal(spec.chart.title, 'Longest vs. current');
    assert.equal(spec.chart.items[1].label, 'Current');
    assert.ok(buildCards(ending, { repoName: 'demo', year: 2024, streakAsOf: '2024-12-31' }).every(({ svg }) => !/NaN|undefined/.test(svg)));
  });

  test('recap: "at window end" instead of "current"', () => {
    assert.match(formatSummary(ending, { repoName: 'demo', streakAtWindowEnd: true }), /longest 3 days · at window end 3 days\n/);
    assert.match(formatSummary(ending, { repoName: 'demo' }), /longest 3 days · current 3 days\n/);
  });

  test('generate / run: streakAsOf only when the window ended before today', async () => {
    const repo = makeRepo('gitwrapped-streak-', [['a', local(2024, 12, 30)], ['b', local(2024, 12, 31)]]);
    try {
      const out = join(repo.root, 'out');
      const past = await generate(parseCli([repo.dir, '--year', '2024', '--out', out, '--no-png']), { today: '2026-10-05' });
      assert.equal(past.streakAsOf, '2024-12-31');
      const streakSvg = readFileSync(past.cardFiles[3], 'utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      assert.match(streakSvg, /You ended 2024 on a 2-day streak\./);
      const stdout = sink();
      assert.equal(await run([repo.dir, '--year', '2024', '--out', out, '--no-png'], { stdout, stderr: sink(), env: {}, today: '2026-10-05' }), 0);
      assert.match(stdout.data, /· at window end 2 days/);
      // A window still open today (or an explicit today on its last day) keeps "current".
      assert.equal((await generate(parseCli([repo.dir, '--until', '2099-01-01', '--out', out, '--no-png']), { today: '2026-10-05' })).streakAsOf, undefined);
      assert.equal((await generate(parseCli([repo.dir, '--year', '2024', '--out', out, '--no-png']), { today: '2024-12-31' })).streakAsOf, undefined);
      const open = sink();
      await run([repo.dir, '--year', '2024', '--out', out, '--no-png'], { stdout: open, stderr: sink(), env: {}, today: '2024-12-31' });
      assert.match(open.data, /· current 2 days/);
    } finally {
      rmSync(repo.root, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

describe('small CLI fixes', () => {
  test('oversized output with --year suggests splitting the year', async () => {
    const repo = makeRepo('gitwrapped-buf-', [['a', local(2025, 3, 1)]]);
    try {
      await assert.rejects(
        readHistory(repo.dir, { since: '2025-01-01', until: '2025-12-31', year: 2025, maxBuffer: 16 }),
        /larger than 0 MB; narrow it down by splitting the year with --since and --until instead of --year \(e\.g\. one quarter at a time\), or with --author, or lower --max-commits$/,
      );
      await assert.rejects(readHistory(repo.dir, { since: '2025-01-01', until: '2025-12-31', maxBuffer: 16 }), /narrow it down with a later --since, an earlier --until or --author/);
      await assert.rejects(readHistory(repo.dir, { maxBuffer: 16 }), /narrow it down with --since or --author/);
    } finally {
      rmSync(repo.root, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  test('--since / --until values are trimmed like --year', () => {
    const o = parseCli(['--since', ' 2025-01-01 ', '--until=\t2025-03-31 ']);
    assert.equal(o.since, '2025-01-01');
    assert.equal(o.until, '2025-03-31');
    assert.throws(() => parseCli(['--until', ' 2025-1-1 ']), /invalid --until "2025-1-1": expected format YYYY-MM-DD/);
  });

  test('the --year range 1970-9999 is documented', () => {
    assert.match(HELP_TEXT, /--year YYYY .*1970-9999/);
    assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /\| `--year YYYY` .*1970-9999/);
    assert.throws(() => parseCli(['--year', '1969']), /invalid --year "1969"/);
    assert.equal(parseCli(['--year', '9999']).year, 9999);
  });

  test('a one-day window is labeled with just the day', () => {
    assert.equal(windowLabel({ since: '2024-02-29', until: '2024-02-29' }), '2024-02-29');
    assert.equal(windowLabel(parseCli(['--since', '2024-02-29', '--until', '2024-02-29'])), '2024-02-29');
  });
});
