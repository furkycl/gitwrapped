// Extra coverage for late nights (stats.lateNights, src/stats/latenights.js): a real
// throwaway repo (scripts/make-fixture-repo.js plus commits with explicit GIT_AUTHOR_DATE
// offsets at 23:59+02:00, 00:30-05:00, 04:59+00:00, 05:00, ...) run end to end through the
// real binary with --json --md in en and tr: stats.json, the recap line and the wrapped.md
// item agree; hours are author-local, not UTC; --author filtering; two repos at once;
// --since / --until windows; a future-dated commit never the latest; the counts equal
// habits.byHour[0..4] (the hours Night Owl scores); no email anywhere; and malformed input
// to computeLateNights / shownLateNights / the renderers never throws.
// Written by the tester of loop turn 067.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { computeLateNights, computeStats, lateNightCounts, shownLateNights } from '../src/stats/index.js';
import { buildCards } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
}
const CHILD_TIMEOUT = 60_000;
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT });
const ADA = { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Lovelace', GIT_COMMITTER_EMAIL: 'ada@example.com' };
const BOB = { GIT_AUTHOR_NAME: 'Bob Builder', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob Builder', GIT_COMMITTER_EMAIL: 'bob@example.com' };
const commitAt = (dir, who, date, msg) => git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', msg], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
const WINDOW = ['--since', '2024-01-01', '--until', '2024-12-31'];
const bin = (args, { window = WINDOW, env = {} } = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args, ...window, '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC', ...env }), stdio: ['ignore', 'pipe', 'pipe'], timeout: CHILD_TIMEOUT });
  assert.equal(r.error, undefined, `gitwrapped ${args.join(' ')}: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
  return r;
};
const statsOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats;
const mdOf = (out) => readFileSync(join(out, 'wrapped.md'), 'utf8');
const peakCard = (out) => {
  const f = readdirSync(join(out, 'cards')).find((name) => name.endsWith('-peak-hour.svg'));
  assert.ok(f, `peak-hour card in ${out}`);
  return readFileSync(join(out, 'cards', f), 'utf8');
};
function allOutput(dir) {
  const parts = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) parts.push(allOutput(p));
    else if (!/\.(png|gif)$/.test(name.name)) parts.push(readFileSync(p, 'utf8'));
  }
  return parts.join('\n');
}
const lateSum = (s) => [0, 1, 2, 3, 4].reduce((n, h) => n + s.habits.byHour[h], 0);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The recap line and wrapped.md item expected for `commits`, `percent`, latest `{date, time}`. */
function expectedLines(L, lang, { commits, percent, latest }) {
  const [y, mo, d] = latest.date.split('-').map(Number);
  const [h, m] = latest.time.split(':').map(Number);
  const unit = lang === 'tr' ? 'commit' : commits === 1 ? 'commit' : 'commits';
  const pct = L.recap.ofCommits(L.pct(percent));
  const recap = new RegExp(`\\n {2}${escRe(L.recap.lateNights)} +${commits} ${unit} \\(${escRe(pct)}\\) · ${escRe(L.recap.latestAt(L.clock(h, m), L.date(d, mo, y)))}\\n`);
  const md = new RegExp(`\\n- \\*\\*${escRe(L.markdown.lateNights)}:\\*\\* ${commits} ${unit} \\(${escRe(pct)}\\), ${escRe(L.markdown.latestAt(L.clock(h, m), L.date(d, mo, y)))}\\n`);
  return { recap, md };
}

// The fixture repo (8 commits in March 2024; one late night: Ada's 02:15-08:00 on Mar 10,
// 10:15 UTC) plus six in April 2024:
//   Ada 23:59+02:00 (21:59 UTC)  not late          Bob 00:30-05:00 (05:30 UTC)  late
//   Ada 04:59+00:00              late, the latest  Ada 05:00+00:00              not late
//   Bob 03:00+09:00 (18:00 UTC)  late              Ada 22:30-03:00 (01:30 UTC)  not late
// → 14 commits, 4 late (29%), latest 04:59 on 2024-04-03. A UTC reading would give
//   02:15→10:15, 00:30→05:30, 04:59, 03:00→18:00, 22:30→01:30: 2 late, a different answer.
function addNights(dir) {
  commitAt(dir, ADA, '2024-04-01T23:59:00+02:00', 'feat: almost midnight');
  commitAt(dir, BOB, '2024-04-02T00:30:00-05:00', 'fix: past midnight');
  commitAt(dir, ADA, '2024-04-03T04:59:00+00:00', 'chore: the last minute of the night');
  commitAt(dir, ADA, '2024-04-04T05:00:00+00:00', 'chore: early morning');
  commitAt(dir, BOB, '2024-04-05T03:00:00+09:00', 'docs: 3 am in Tokyo');
  commitAt(dir, ADA, '2024-04-06T22:30:00-03:00', 'test: evening');
}

describe('end to end: real late nights', () => {
  let tmp;
  let app;
  let lib;
  let future;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-late-x-'));
    app = makeFixtureRepo({ dir: join(tmp, 'app') }).dir;
    addNights(app);
    // A second repo: a 04:59 tie with an earlier instant (wins the latest), and a daytime commit.
    lib = join(tmp, 'lib');
    mkdirSync(lib);
    git(lib, ['init', '-q', '-b', 'main']);
    commitAt(lib, ADA, '2024-01-15T04:59:30+00:00', 'feat: lib at 4:59');
    commitAt(lib, BOB, '2024-05-02T12:00:00+00:00', 'feat: lib at noon');
    // A repo with a commit dated 2099 at 04:30: counted, never the latest-ever time.
    future = join(tmp, 'future');
    mkdirSync(future);
    git(future, ['init', '-q', '-b', 'main']);
    commitAt(future, ADA, '2024-04-03T01:00:00+00:00', 'feat: real night');
    commitAt(future, ADA, '2024-04-04T15:00:00+00:00', 'feat: afternoon');
    commitAt(future, ADA, '2099-01-01T04:30:00+00:00', 'chore: clock skew');
  });
  after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

  for (const lang of ['en', 'tr']) {
    test(`stats.json, recap, wrapped.md and the card agree (${lang})`, () => {
      const L = lang === 'tr' ? tr : en;
      const out = join(tmp, `o-${lang}`);
      const r = bin([app, '--out', out, '--json', '--md', '--lang', lang]);
      const s = statsOf(out);
      assert.deepEqual(s.lateNights, { commits: 4, share: 0.286, latest: { date: '2024-04-03', time: '04:59' } });
      assert.equal(s.lateNights.commits, lateSum(s));
      const { recap, md } = expectedLines(L, lang, { commits: 4, percent: 29, latest: s.lateNights.latest });
      assert.match(r.stdout, recap);
      assert.match(mdOf(out), md);
      // The power-hour card: when it shows the row, it shows the same numbers.
      const svg = peakCard(out);
      if (svg.includes(L.peak.lateNights)) assert.ok(svg.includes(`4 ${lang === 'tr' ? 'commit' : 'commits'}`), 'card row count');
      if (svg.includes(L.peak.latestLabel)) assert.ok(svg.includes(L.peak.latestValue(L.clock(4, 59), L.date(3, 4, 2024)).split(' · ')[0]), 'card latest');
    });
  }

  test('author-local hours, not UTC: same result whatever the machine TZ', () => {
    const outs = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'].map((tz, i) => {
      const out = join(tmp, `o-tz-${i}`);
      bin([app, '--out', out, '--json'], { env: { TZ: tz } });
      return statsOf(out);
    });
    for (const s of outs) assert.deepEqual(s.lateNights, outs[0].lateNights);
    // Each counted hour is the commit's own: 02:15, 00:30, 04:59, 03:00 → hours 0, 2, 3, 4.
    assert.deepEqual(outs[0].habits.byHour.slice(0, 5), [1, 0, 1, 1, 1]);
    assert.equal(outs[0].habits.byHour[5], 1); // 05:00 is not a late night
    assert.equal(outs[0].habits.byHour[23], 2); // 23:59 and 23:45
  });

  test('--author: only that author\'s late nights', () => {
    const ada = join(tmp, 'o-ada');
    const r = bin([app, '--out', ada, '--json', '--md', '--author', 'ADA@example.com']);
    let s = statsOf(ada);
    // Ada: 10:00, 23:45, 02:15, 16:20, 23:59, 04:59, 05:00, 22:30 → 2 of 8.
    assert.deepEqual(s.lateNights, { commits: 2, share: 0.25, latest: { date: '2024-04-03', time: '04:59' } });
    assert.equal(s.lateNights.commits, lateSum(s));
    assert.match(r.stdout, expectedLines(en, 'en', { commits: 2, percent: 25, latest: s.lateNights.latest }).recap);
    const bob = join(tmp, 'o-bob');
    bin([app, '--out', bob, '--json', '--md', '--author', 'bob@example.com']);
    s = statsOf(bob);
    // Bob: 14:30, 11:00, 09:00, 12:00, 00:30, 03:00 → 2 of 6; 03:00 is later than 00:30.
    assert.deepEqual(s.lateNights, { commits: 2, share: 0.333, latest: { date: '2024-04-05', time: '03:00' } });
    assert.match(mdOf(bob), expectedLines(en, 'en', { commits: 2, percent: 33, latest: s.lateNights.latest }).md);
  });

  test('two repos: counts add up, a same-minute tie goes to the earliest instant', () => {
    const out = join(tmp, 'o-multi');
    const r = bin([app, lib, '--out', out, '--json', '--md']);
    const s = statsOf(out);
    // 14 + 2 commits, 4 + 1 late; lib's 04:59 on Jan 15 is earlier than app's on Apr 3.
    assert.deepEqual(s.lateNights, { commits: 5, share: 0.313, latest: { date: '2024-01-15', time: '04:59' } });
    assert.equal(s.lateNights.commits, lateSum(s));
    const lines = expectedLines(en, 'en', { commits: 5, percent: 31, latest: s.lateNights.latest });
    assert.match(r.stdout, lines.recap);
    assert.match(mdOf(out), lines.md);
    // Order of paths does not matter.
    const out2 = join(tmp, 'o-multi-2');
    bin([lib, app, '--out', out2, '--json']);
    assert.deepEqual(statsOf(out2).lateNights, s.lateNights);
  });

  test('--since / --until: only the window\'s commits', () => {
    const april = join(tmp, 'o-april');
    bin([app, '--out', april, '--json', '--md'], { window: ['--since', '2024-04-01', '--until', '2024-04-30'] });
    assert.deepEqual(statsOf(april).lateNights, { commits: 3, share: 0.5, latest: { date: '2024-04-03', time: '04:59' } });
    const march = join(tmp, 'o-march');
    const r = bin([app, '--out', march, '--json', '--md', '--lang', 'tr'], { window: ['--since', '2024-03-01', '--until', '2024-03-31'] });
    const s = statsOf(march);
    assert.deepEqual(s.lateNights, { commits: 1, share: 0.125, latest: { date: '2024-03-10', time: '02:15' } });
    const lines = expectedLines(tr, 'tr', { commits: 1, percent: 13, latest: s.lateNights.latest });
    assert.match(r.stdout, lines.recap);
    assert.match(mdOf(march), lines.md);
    // A window with no late-night commit: zero, no line anywhere.
    const day = join(tmp, 'o-day');
    const r2 = bin([app, '--out', day, '--json', '--md'], { window: ['--since', '2024-03-11', '--until', '2024-03-13'] });
    assert.equal(statsOf(day).lateNights.commits, 0);
    assert.equal(statsOf(day).lateNights.share, 0);
    assert.doesNotMatch(r2.stdout, /Late nights/);
    assert.doesNotMatch(mdOf(day), /Late-night/);
    assert.doesNotMatch(peakCard(day), /Late nights|Latest night/);
  });

  test('a future-dated commit counts but is never the latest-ever time', () => {
    const out = join(tmp, 'o-future');
    const r = bin([future, '--out', out, '--json', '--md'], { window: [] });
    const s = statsOf(out);
    assert.deepEqual(s.lateNights, { commits: 2, share: 0.667, latest: { date: '2024-04-03', time: '01:00' } });
    assert.equal(s.lateNights.commits, lateSum(s));
    assert.doesNotMatch(r.stdout, /2099/);
    assert.doesNotMatch(mdOf(out).split('\n').filter((l) => /Late-night/.test(l)).join('\n'), /2099/);
    assert.match(r.stdout, expectedLines(en, 'en', { commits: 2, percent: 67, latest: s.lateNights.latest }).recap);
  });

  test('consistent with Night Owl: same byHour, Night Owl hours 22-03', () => {
    const out = join(tmp, 'o-en');
    const s = statsOf(out);
    const owl = [22, 23, 0, 1, 2, 3].reduce((n, h) => n + s.habits.byHour[h], 0);
    assert.equal(s.lateNights.commits, lateSum(s));
    assert.ok(s.lateNights.commits <= owl + s.habits.byHour[4]);
    // Night Owl: 23:45, 23:59, 22:30, 02:15, 00:30, 03:00 = 6 of 14 = 43%.
    assert.equal(owl, 6);
    const dated = s.habits.byHour.reduce((a, b) => a + b, 0);
    assert.equal(dated, 14);
    assert.equal(s.lateNights.share, Math.round((s.lateNights.commits / dated) * 1000) / 1000);
    assert.equal(s.personality.archetype.id, 'night-owl');
    assert.match(s.personality.archetype.reason, /^43% /);
  });

  test('no email anywhere in the output', () => {
    for (const dir of ['o-en', 'o-tr', 'o-multi', 'o-future', 'o-april', 'o-march']) {
      const text = allOutput(join(tmp, dir));
      assert.doesNotMatch(text, /@example\.com/, dir);
    }
    // With --author, the filter the user typed is echoed back (as everywhere), nobody else's.
    assert.doesNotMatch(allOutput(join(tmp, 'o-ada')), /bob@example\.com/);
    const r = bin([app, lib, '--out', join(tmp, 'o-mail'), '--json', '--md', '--author', 'ada@example.com']);
    assert.doesNotMatch(r.stdout, /bob@example\.com/);
    assert.doesNotMatch(r.stdout.split('\n').filter((l) => /Late nights/.test(l)).join('\n'), /@/);
    assert.doesNotMatch(JSON.stringify(statsOf(join(tmp, 'o-mail')).lateNights), /@/);
  });
});

// --- malformed inputs ----------------------------------------------------------------------

describe('malformed input never throws', () => {
  const WEIRD = [undefined, null, 0, 1, NaN, -1, '', 'x', true, [], {}, () => 1, Symbol('s'), 10n, new Date(), [null], { length: 3 }];
  const WEIRD_DATES = [undefined, null, 0, 1e15, NaN, '', ' ', 'x', '2024-13-01T01:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T01:60:00Z', '2024-01-01T01:00:00+24:00', '2024-01-01', '01:00', {}, [], ['2024-01-01T01:00:00Z'], Symbol('d'), 10n, new Date('2024-01-01T01:00:00Z')];

  test('computeLateNights: any commits, any today', () => {
    for (const cs of WEIRD) {
      const r = computeLateNights(cs);
      assert.deepEqual(r, { commits: 0, share: 0, latest: null }, String(typeof cs));
    }
    const r = computeLateNights(WEIRD_DATES.map((date) => ({ date })));
    assert.deepEqual(r, { commits: 0, share: 0, latest: null });
    const mixed = [...WEIRD, ...WEIRD_DATES.map((date) => ({ date })), { date: '2024-01-01T01:00:00Z' }, { date: ' 2024-01-02T02:00:00+01:00 ' }];
    for (const today of WEIRD) {
      const out = computeLateNights(mixed, { today });
      assert.equal(out.commits, 2);
      assert.ok(out.latest);
      assert.ok(out.share >= 0 && out.share <= 1);
    }
    assert.doesNotThrow(() => computeLateNights(mixed, undefined));
    assert.doesNotThrow(() => computeLateNights([], {}));
    // Sparse arrays and huge inputs.
    // eslint-disable-next-line no-sparse-arrays
    assert.deepEqual(computeLateNights([, , { date: '2024-01-01T03:00:00Z' }]), { commits: 1, share: 1, latest: { date: '2024-01-01', time: '03:00' } });
  });

  test('shownLateNights / lateNightCounts: any stats shape', () => {
    const habitsShapes = [...WEIRD, { byHour: WEIRD }, { byHour: [NaN, Infinity, -5, '3', 2.5, null] }, { byHour: new Array(100).fill(1) }, { byHour: { 0: 3 } }];
    const lateShapes = [...WEIRD, { latest: WEIRD }, { latest: { date: 20240101, time: 400 } }, { latest: { date: '2024-01-01', time: '04:59:00' } }, { latest: { date: '2024-01-01T00:00Z', time: '01:00' } }, { latest: { date: '2024-01-01', time: '24:00' } }, { latest: { date: '0000-01-01', time: '00:00' } }];
    for (const habits of habitsShapes) {
      assert.doesNotThrow(() => lateNightCounts(habits));
      const c = lateNightCounts(habits);
      assert.ok(Number.isFinite(c.commits) && Number.isFinite(c.dated) && c.commits <= c.dated);
      for (const lateNights of lateShapes) {
        let shown;
        assert.doesNotThrow(() => { shown = shownLateNights({ habits, lateNights }); });
        if (shown) {
          assert.ok(shown.commits > 0 && Number.isFinite(shown.percent) && shown.percent >= 0 && shown.percent <= 100);
          if (shown.latest) assert.ok(shown.latest.hour >= 0 && shown.latest.hour < 5);
        }
      }
    }
    // 2.5 commits at 4 AM: finite counts are taken as-is (only non-positive / non-finite dropped).
    assert.deepEqual(lateNightCounts({ byHour: [NaN, Infinity, -5, '3', 2.5, null] }), { commits: 2.5, dated: 2.5 });
    for (const s of WEIRD) assert.doesNotThrow(() => shownLateNights(s));
  });

  test('recap, wrapped.md, stats.json and cards with a malformed lateNights', () => {
    const base = computeStats([{ hash: 'a'.repeat(40), date: '2024-03-03T02:10:00Z', subject: 'x', author: 'A', email: 'a@example.com', files: [], parents: ['p'] }], { today: '2024-12-31' });
    for (const lateNights of [...WEIRD, { commits: 'x', share: {}, latest: 'y' }, { latest: { date: '2024-02-30', time: '02:10' } }]) {
      const s = { ...base, lateNights };
      for (const lang of ['en', 'tr']) {
        let out;
        assert.doesNotThrow(() => { out = formatSummary(s, { repoName: 'demo', today: '2024-12-31', lang }); });
        // The count comes from habits, so the line is still there, without a latest time.
        assert.match(out, lang === 'en' ? /Late nights +1 commit \(100% of commits\)\n/ : /Gece mesaisi +1 commit \(commit'lerin %100 kadarı\)\n/);
        assert.doesNotThrow(() => buildMarkdown(s, { repoName: 'demo', today: '2024-12-31', lang }));
        assert.doesNotThrow(() => buildCards(s, { repoName: 'demo', today: '2024-12-31', lang }));
      }
      if (typeof lateNights !== 'symbol' && typeof lateNights !== 'bigint') assert.doesNotThrow(() => buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: '2024-12-31' }));
    }
    // Habits missing entirely: no line, nothing throws.
    const { habits, ...noHabits } = base;
    assert.doesNotMatch(formatSummary(noHabits, { repoName: 'demo', today: '2024-12-31' }), /Late nights/);
    assert.doesNotThrow(() => buildCards(noHabits, { repoName: 'demo', today: '2024-12-31' }));
  });
});
