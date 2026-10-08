// Cold audit of the 1.10 work (office hours, test share, night power hour). Bugs fixed
// (regression tests below):
// - the power-hour card's "Late nights" row fell back to its short value ("1,000,000,000 ·
//   14%") without checking that it fits, so with a billion+ late-night commits it was drawn
//   cut; it is now left out when even the short value would be cut (as the office-hours and
//   tests rows are), and a night power hour then keeps its own quip;
// - the test share was rounded twice (stats.tests.share to 3 decimals, then to a whole
//   percent), so 45 of 10,000 lines (0.45%) read "1%" instead of "<1%" and 2.45% read "3%":
//   the shown percent now comes from the exact ratio, while stats.json keeps exactly
//   `{lines, share}`;
// - the activity card's "Weekends" row had no short fallback and no fit check, so 1,200
//   weekend commits with a two-digit share drew "1,200 commits ·…" (tr "1.200 commit ·…"):
//   it now falls back to "1,200 · 19%" and is left out when even that would be cut.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeTests, shownTests } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, testsShareText } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
const LANGS = { en, tr };
let n = 0;
const commit = (date, files = [{ path: 'src/a.js', added: 1, removed: 0 }]) => ({
  hash: `${String(++n).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files,
  parents: ['p'],
});
const opts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const peakSpec = (s, lang) => buildCardSpecs(s, opts(lang)).find((c) => c.id === 'peak-hour').spec;
const isLate = (r) => r.label === en.peak.lateNights || r.label === tr.peak.lateNights;
const QUIP_HOURS = [5, 9, 12, 14, 18, 22];
const ownQuip = (L, hour) => {
  const i = QUIP_HOURS.findIndex((h) => hour < h);
  return L.peak.quips[i === -1 ? QUIP_HOURS.length : i];
};

/**
 * Stats whose habits say `k * 5` commits at `hour`, `k` at 02:00 (late) and `k` at 10:00,
 * all on Mondays: a late-night share of 1/7 (14%) for a day hour, 6/7 for a 2 AM one.
 */
function scaled(hour, k) {
  const base = computeStats([commit('2026-03-02T14:00:00Z'), commit('2026-03-02T02:00:00Z')], { today: TODAY });
  const byHour = Array(24).fill(0);
  byHour[hour] = k * 5;
  byHour[2] += k;
  byHour[10] += k;
  const total = byHour.reduce((a, b) => a + b, 0);
  const byWeekday = [0, total, 0, 0, 0, 0, 0];
  const habits = { ...base.habits, byHour, byWeekday, peakHour: hour, peakHourCount: byHour[hour], peakHourTied: false, peakWeekday: 1, peakWeekdayTied: false };
  return { ...base, habits, officeHours: null };
}

describe('power-hour card: the "Late nights" row is never drawn cut', () => {
  test('a billion+ late-night commits: no row (the short value would be cut), en and tr, day and night hours', () => {
    for (const [lang, L] of Object.entries(LANGS)) {
      for (const hour of [14, 2, 23]) {
        const spec = peakSpec(scaled(hour, 1e9), lang);
        const lines = spec.lines ?? [];
        assert.ok(!lines.some(isLate), `${lang} ${hour}: ${JSON.stringify(lines)}`);
        for (const r of lines) assert.ok(rowFits(r), `${lang} ${hour}: ${JSON.stringify(r)}`);
        // A night power hour keeps its own quip (the swap is only for a row that fits).
        if (hour !== 14) {
          assert.ok(spec.subtitle.includes(ownQuip(L, hour)), `${lang} ${hour}: ${spec.subtitle}`);
          assert.ok(!spec.subtitle.includes(L.peak.nightQuip), `${lang} ${hour}: ${spec.subtitle}`);
        }
        const svg = buildCards(scaled(hour, 1e9), opts(lang)).find((c) => c.id === 'peak-hour').svg;
        assert.ok(!svg.includes('…'), `${lang} ${hour}: nothing cut`);
      }
    }
  });

  test('the short value still shows when it fits ("1,000 · 14%"), drawn whole', () => {
    const row = (peakSpec(scaled(14, 1000), 'en').lines ?? []).find(isLate);
    assert.deepEqual(row, { label: en.peak.lateNights, value: '1,000 · 14%' });
    assert.ok(rowFits(row));
    const night = (peakSpec(scaled(2, 1000), 'tr').lines ?? []).find(isLate);
    assert.deepEqual(night, { label: tr.peak.lateNights, value: '6.000 · %86' });
  });

  test('the recap and wrapped.md still have the late nights', () => {
    const s = scaled(14, 1e9);
    assert.match(formatSummary(s, opts('en')), /Late nights\s+1,000,000,000 commits/);
    assert.match(buildMarkdown(s, opts('en')), /1,000,000,000 commits/);
  });
});

describe('test share: the shown percent is rounded once, from the exact ratio', () => {
  const linesOf = (t, o) => [commit('2026-03-02T10:00:00Z', [{ path: 'test/a.test.js', added: t, removed: 0 }, { path: 'src/a.js', added: o, removed: 0 }])];

  test('0.45% reads "<1%", 2.45% "2%", 1.45% "1%"; 0.5% and 99.45% as before', () => {
    for (const [t, o, percent] of [[45, 9955, 0], [245, 9755, 2], [145, 9855, 1], [5, 995, 1], [9945, 55, 99], [42, 100, 30], [10, 0, 100]]) {
      const shown = shownTests(computeTests(linesOf(t, o)));
      assert.deepEqual(shown, { lines: t, percent }, `${t}/${t + o}`);
    }
    assert.equal(testsShareText(shownTests(computeTests(linesOf(45, 9955)))), '<1%');
    assert.equal(testsShareText(shownTests(computeTests(linesOf(45, 9955))), tr), '<%1');
  });

  test('stats.tests keeps exactly {lines, share} (share 3 decimals), in stats.json too', () => {
    const t = computeTests(linesOf(45, 9955));
    assert.deepEqual(t, { lines: 45, share: 0.005 });
    assert.deepEqual(Object.keys(t), ['lines', 'share']);
    assert.equal(JSON.stringify(t), '{"lines":45,"share":0.005}');
    const stats = computeStats(linesOf(45, 9955), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.tests, { lines: 45, share: 0.005 });
  });

  test('a share without the exact ratio (a copy, or stats from elsewhere) reads as before', () => {
    assert.deepEqual(shownTests({ lines: 45, share: 0.005 }), { lines: 45, percent: 1 });
    assert.deepEqual(shownTests({ ...computeTests(linesOf(45, 9955)) }), { lines: 45, percent: 1 });
    assert.deepEqual(shownTests({ lines: 3, share: 0 }), { lines: 3, percent: 0 });
  });

  test('card, recap and wrapped.md agree on "<1%" for 45 of 10,000 lines, en and tr', () => {
    const s = computeStats(linesOf(45, 9955), { today: TODAY });
    const specs = buildCardSpecs(s, opts('en'));
    const rows = ['hot-files', 'languages'].flatMap((id) => specs.find((c) => c.id === id).spec.lines ?? []).filter((r) => r.label === en.hotFiles.tests);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, '45 lines · <1%');
    assert.match(formatSummary(s, opts('en')), /Tests\s+45 lines \(<1% of lines changed\)/);
    assert.match(buildMarkdown(s, opts('en')), /45 lines \(<1% of lines changed\)/);
    assert.match(formatSummary(s, opts('tr')), /45 satır \(değişen satırların <%1 kadarı\)/);
    assert.match(buildMarkdown(s, opts('tr')), /45 satır \(değişen satırların <%1 kadarı\)/);
  });
});

describe('test share: more edges of the exact ratio', () => {
  const linesOf = (t, o) => [commit('2026-03-02T10:00:00Z', [{ path: 'test/a.test.js', added: t, removed: 0 }, { path: 'src/a.js', added: o, removed: 0 }])];

  test('a share of exactly 1 reads 100%, with or without the exact ratio; just short of it, 99%', () => {
    assert.deepEqual(shownTests(computeTests(linesOf(10, 0))), { lines: 10, percent: 100 });
    assert.deepEqual(shownTests({ lines: 10, share: 1 }), { lines: 10, percent: 100 });
    assert.equal(testsShareText(shownTests(computeTests(linesOf(10, 0)))), '100%');
    // 9,995 of 10,000 (99.95%): share capped at 0.999, never 100% short of every line.
    const t = computeTests(linesOf(9995, 5));
    assert.equal(t.share, 0.999);
    assert.deepEqual(shownTests(t), { lines: 9995, percent: 99 });
    // 999,999 of 1,000,000: exact ratio rounds to 1.000 but still reads 99%.
    assert.deepEqual(shownTests(computeTests(linesOf(999999, 1))), { lines: 999999, percent: 99 });
  });

  test('the exact ratio is not exposed: no own enumerable symbol, structuredClone / JSON copies fall back to share', () => {
    const t = computeTests(linesOf(45, 9955));
    assert.equal(Object.getOwnPropertySymbols(t).length, 1);
    assert.equal(Object.getOwnPropertyDescriptor(t, Object.getOwnPropertySymbols(t)[0]).enumerable, false);
    assert.deepEqual(shownTests(structuredClone(t)), { lines: 45, percent: 1 });
    assert.deepEqual(shownTests(JSON.parse(JSON.stringify(t))), { lines: 45, percent: 1 });
    // Malformed values still read null.
    assert.equal(shownTests({ lines: 0, share: 0.5 }), null);
    assert.equal(shownTests(null), null);
  });

  test('tr shows "<%1" on the card row for 45 of 10,000 lines', () => {
    const s = computeStats(linesOf(45, 9955), { today: TODAY });
    const specs = buildCardSpecs(s, opts('tr'));
    const rows = ['hot-files', 'languages'].flatMap((id) => specs.find((c) => c.id === id).spec.lines ?? []).filter((r) => r.label === tr.hotFiles.tests);
    assert.equal(rows.length, 1);
    assert.match(rows[0].value, /^45 satır · <%1$/);
  });
});

describe('end to end (the CLI run() on a real repo): stats.json keeps {lines, share}, outputs show "<1%"', () => {
  test('45 of 10,000 test lines', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { run } = await import('../src/cli.js');
    const tmp = mkdtempSync(join(tmpdir(), 'gw-a110-'));
    try {
      const repo = join(tmp, 'demo');
      mkdirSync(join(repo, 'test'), { recursive: true });
      mkdirSync(join(repo, 'src'), { recursive: true });
      const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: '2026-03-02T10:00:00Z', GIT_COMMITTER_DATE: '2026-03-02T10:00:00Z' };
      for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
      const g = (args) => execFileSync('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      g(['init', '-q', '-b', 'main']);
      const ls = (k, tag) => Array.from({ length: k }, (_, i) => `${tag}${i}`).join('\n') + '\n';
      writeFileSync(join(repo, 'test', 'a.test.js'), ls(45, 't'));
      writeFileSync(join(repo, 'src', 'a.js'), ls(9955, 's'));
      g(['add', '-A']);
      g(['commit', '-q', '--no-gpg-sign', '--no-verify', '-m', 'work']);
      for (const [lang, re] of [['en', /45 lines \(<1% of lines changed\)/], ['tr', /45 satır \(değişen satırların <%1 kadarı\)/]]) {
        const out = join(tmp, `out-${lang}`);
        let stdout = '';
        const sink = (f) => ({ write: (x) => { f(String(x)); return true; }, isTTY: false });
        const code = await run([repo, '--no-png', '--json', '--md', '--lang', lang, '--out', out], { stdout: sink((x) => { stdout += x; }), stderr: sink(() => {}), env: {}, today: TODAY });
        assert.equal(code, 0);
        const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
        assert.deepEqual(doc.stats.tests, { lines: 45, share: 0.005 });
        assert.deepEqual(Object.keys(doc.stats.tests), ['lines', 'share']);
        assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), re, lang);
        assert.match(stdout, re, `${lang} recap`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('activity card: the "Weekends" row is never drawn cut', () => {
  const p2 = (x) => String(x).padStart(2, '0');
  // `w` Saturday commits and `d` weekday (Mon-Fri) ones, all in one week of March 2026.
  const week = (w, d) => computeStats([
    ...Array.from({ length: w }, (_, i) => commit(`2026-03-07T${p2(10 + (i % 8))}:00:00Z`)),
    ...Array.from({ length: d }, (_, i) => commit(`2026-03-0${2 + (i % 5)}T${p2(10 + (i % 8))}:00:00Z`)),
  ], { today: TODAY });
  const activity = (s, lang) => buildCardSpecs(s, opts(lang)).find((c) => c.id === 'activity').spec;
  const weekendOf = (spec, L) => (spec.lines ?? []).find((r) => r.label === L.recap.weekend);
  const officeOf = (spec, L) => (spec.lines ?? []).find((r) => r.label === L.recap.officeHours);

  test('1,200 weekend + 5,000 weekday commits: the short value, drawn whole, en and tr; office hours still after it', () => {
    const s = week(1200, 5000);
    for (const [lang, L, value, office] of [['en', en, '1,200 · 19%', '5,000 · 81%'], ['tr', tr, '1.200 · %19', '5.000 · %81']]) {
      const spec = activity(s, lang);
      const row = weekendOf(spec, L);
      assert.deepEqual(row, { label: L.recap.weekend, value }, lang);
      for (const r of spec.lines) assert.ok(rowFits(r), `${lang}: ${JSON.stringify(r)}`);
      assert.equal(officeOf(spec, L)?.value, office, lang);
      const svg = buildCards(s, opts(lang)).find((c) => c.id === 'activity').svg;
      assert.ok(!svg.includes('…'), `${lang}: nothing cut`);
    }
  });

  test('a full value that fits is kept ("12 commits · 8%" style), and Weekend Warrior quotes the same percent', () => {
    const s = week(1200, 300);
    for (const [lang, L, re] of [['en', en, /^80% of your commits/], ['tr', tr, /%80 kadarı/]]) {
      const spec = activity(s, lang);
      assert.equal(weekendOf(spec, L).value, lang === 'en' ? '1,200 · 80%' : '1.200 · %80');
      assert.match(buildCardSpecs(s, opts(lang)).find((c) => c.id === 'personality').spec.subtitle, re);
    }
    const small = week(12, 130);
    assert.equal(weekendOf(activity(small, 'en'), en).value, '12 commits · 8%');
    assert.equal(weekendOf(activity(small, 'tr'), tr).value, '12 commit · %8');
  });

  test('even the short value too wide (a billion+ weekend commits): no row, en and tr', () => {
    const base = week(12, 130);
    const byWeekday = [...base.habits.byWeekday];
    byWeekday[6] = 1e12; // Saturday (byWeekday is Sunday-first)
    const byHour = [...base.habits.byHour];
    byHour[10] += 1e12 - 12;
    const s = { ...base, habits: { ...base.habits, byWeekday, byHour } };
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const spec = activity(s, lang);
      assert.equal(weekendOf(spec, L), undefined, `${lang}: ${JSON.stringify(spec.lines)}`);
      for (const r of spec.lines ?? []) assert.ok(rowFits(r), `${lang}: ${JSON.stringify(r)}`);
    }
  });
});
