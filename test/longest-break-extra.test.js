// Extra tests for the longest break (stats.streaks.longestBreak, the streak card's callout,
// the recap's Break line) written by the tester of loop turn 040: end to end through the
// real CLI with fixture repos, date windows, multi-repo merges, future-dated commits,
// every color theme and both languages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStats, shownLongestBreak } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, COLOR_THEME_NAMES } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { generate, run } from '../src/cli.js';

const TODAY = '2026-01-10';
const NO_BREAK = { days: 0, from: null, to: null };

const at = (date) => ({ hash: `h${date}`, author: 'A', email: 'a@x.io', date, subject: 's', files: [{ path: 'a.js', added: 1, removed: 0, binary: false }] });
const days = (...keys) => keys.map((k) => at(`${k}T12:00:00Z`));

const streakSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'streak').spec;
const streakCard = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'streak');
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

/** Asserts the callout is laid out, everything is in the content area and nothing overlaps. */
function assertFits(spec, lang, label) {
  const layout = layoutCard({ ...spec, lang });
  assert.ok(layout.blocks.some((b) => b.kind === 'callout'), `${label}: the break panel is kept`);
  assert.ok(layout.blocks.some((b) => b.kind === 'hbars'), `${label}: the streak bars are kept`);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
  }
  return layout;
}

// --- card layout in every theme / language -----------------------------------------------

describe('streak card break panel (extra)', () => {
  const cases = {
    small: days('2025-03-01', '2025-03-03'),
    // A run of 5 + a long break + a current streak (both bars present).
    typical: days('2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05', '2025-06-01', '2026-01-08', '2026-01-09', '2026-01-10'),
    // A five-digit break (decades) — the widest value text.
    huge: days('1990-01-01', '2025-12-30', '2025-12-31'),
    // A single active day per side, crossing a year.
    yearEnd: days('2024-12-31', '2025-01-02'),
  };

  for (const [name, commits] of Object.entries(cases)) {
    test(`"${name}": panel fits with no overlap in every color theme, en / tr`, () => {
      const stats = computeStats(commits, { today: TODAY });
      assert.ok(stats.streaks.longestBreak.days > 0);
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of COLOR_THEME_NAMES) {
          const label = `${name}/${lang}/${colorTheme}`;
          const spec = streakSpec(stats, { lang, colorTheme });
          const layout = assertFits(spec, lang, label);
          const panel = layout.blocks.find((b) => b.kind === 'callout');
          const drawn = texts(panel.svg);
          const callout = spec.chart[1];
          assert.ok(drawn.includes(callout.value), `${label}: value drawn in full, got ${JSON.stringify(drawn)}`);
          const card = streakCard(stats, { lang, colorTheme });
          assert.ok(card.svg.startsWith('<svg') && card.svg.trimEnd().endsWith('</svg>'));
          assert.doesNotMatch(card.svg, /undefined|NaN|Invalid Date|null/);
        }
      }
    });
  }

  test('huge break uses the language thousands separator', () => {
    const stats = computeStats(cases.huge, { today: TODAY });
    const d = stats.streaks.longestBreak.days;
    assert.ok(d > 9999);
    assert.match(streakSpec(stats).chart[1].value, /^\d{2},\d{3} days off$/);
    assert.match(streakSpec(stats, { lang: 'tr' }).chart[1].value, /^\d{2}\.\d{3} gün$/);
    assert.match(formatSummary(stats, { today: TODAY }), /Break +longest \d{2},\d{3} days \(Jan 1, 1990 – Dec 30, 2025\)/);
  });

  test('a one-day break is singular ("1 day off" / "1 gün")', () => {
    const stats = computeStats(cases.small, { today: TODAY });
    assert.equal(streakSpec(stats).chart[1].value, '1 day off');
    assert.equal(streakSpec(stats, { lang: 'tr' }).chart[1].value, '1 gün');
    assert.match(formatSummary(stats, { today: TODAY }), /Break +longest 1 day \(/);
  });

  test('the tr caption is upper-cased on the card SVG', () => {
    const stats = computeStats(cases.typical, { today: TODAY });
    const svg = streakCard(stats, { lang: 'tr' }).svg;
    assert.match(svg, /EN UZUN MOLA/);
    assert.match(svg, /220 gün</);
    assert.match(svg, /1 Haz 2025 ile 8 Oca 2026 arası/);
    assert.match(streakCard(stats).svg, /LONGEST BREAK/i);
  });

  test('present day + future-dated days only: the card and recap show no break', () => {
    const stats = computeStats(days('2025-06-01', '2099-01-01', '2099-03-01'), { today: TODAY });
    assert.equal(stats.streaks.longestBreak.to, '2099-01-01');
    assert.deepEqual(shownLongestBreak(stats, TODAY), NO_BREAK);
    assert.equal(Array.isArray(streakSpec(stats).chart), false);
    assert.doesNotMatch(formatSummary(stats, { today: TODAY }), /Break/);
  });

  test('without a break the cards are byte-identical to stats with no longestBreak field at all', () => {
    for (const commits of [[], days('2025-03-01'), days('2025-03-01', '2025-03-02', '2025-03-03')]) {
      const stats = computeStats(commits, { today: TODAY });
      assert.deepEqual(stats.streaks.longestBreak, NO_BREAK);
      const { longestBreak, ...rest } = stats.streaks;
      const legacy = { ...stats, streaks: rest };
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of COLOR_THEME_NAMES) {
          const a = buildCards(stats, { repoName: 'demo', today: TODAY, lang, colorTheme });
          const b = buildCards(legacy, { repoName: 'demo', today: TODAY, lang, colorTheme });
          assert.deepEqual(a, b, `${commits.length}/${lang}/${colorTheme}`);
        }
        assert.equal(formatSummary(stats, { today: TODAY, lang }), formatSummary(legacy, { today: TODAY, lang }));
      }
    }
  });

  test('junk longestBreak values never draw a panel or recap line', () => {
    const stats = computeStats(days('2025-03-01', '2025-03-02'), { today: TODAY });
    for (const junk of [null, {}, { days: -3, from: '2025-03-01', to: '2025-03-05' }, { days: 2.5, from: 'x', to: 'y' }, { days: '7' }]) {
      const s = { ...stats, streaks: { ...stats.streaks, longestBreak: junk } };
      assert.equal(Array.isArray(streakSpec(s).chart), false, JSON.stringify(junk));
      assert.doesNotMatch(formatSummary(s, { today: TODAY }), /Break/, JSON.stringify(junk));
    }
    // Valid days but unparseable from/to: panel without a note, recap without the range.
    const s = { ...stats, streaks: { ...stats.streaks, longestBreak: { days: 4, from: 'bad', to: null } } };
    assert.equal(streakSpec(s).chart[1].note, '');
    assert.match(formatSummary(s, { today: TODAY }), /\n {2}Break +longest 4 days\n/);
  });
});

// --- end to end through the real CLI -----------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}
const capture = () => {
  const s = { text: '', write: (x) => { s.text += x; return true; } };
  return s;
};

/** A repo with one commit per date (author and committer date the same). */
function makeRepo(dir, dates) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, date] of dates.entries()) {
    writeFileSync(join(dir, 'a.js'), `${i}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `c${i}`], { GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@example.com', GIT_COMMITTER_NAME: 'Alice', GIT_COMMITTER_EMAIL: 'alice@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
}
const noon = (d) => `${d}T12:00:00+00:00`;

describe('longest break end to end (extra)', () => {
  let root;
  const repo = {};
  const out = (name) => join(root, 'out', name);
  const json = (dir) => JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'));
  const streakSvg = (dir) => {
    const f = readdirSync(join(dir, 'cards')).find((x) => x.endsWith('-streak.svg'));
    return readFileSync(join(dir, 'cards', f), 'utf8');
  };
  const cli = async (args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await run([...args, '--no-png', '--no-color'], { stdout, stderr, env: {}, today: TODAY });
    assert.equal(code, 0, stdout.text + stderr.text);
    return stdout.text;
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-break-x-'));
    // Gaps (idle days): Nov 1 → Dec 20 2024: 48; Dec 20 → Jan 5: 15; Jan 6 → Mar 1 2025: 53;
    // Mar 2 → Mar 12: 9.
    repo.app = join(root, 'app');
    makeRepo(repo.app, ['2024-11-01', '2024-12-20', '2025-01-05', '2025-01-06', '2025-03-01', '2025-03-02', '2025-03-12'].map(noon));
    // Merged with app: Nov 1 → Dec 1: 29 (the longest); Jan 6 → Feb 1: 25; Feb 1 → Mar 1: 27.
    // The -05:00 commit is Mar 12 author-local (Mar 13 in UTC) — the same day as app's.
    repo.lib = join(root, 'lib');
    makeRepo(repo.lib, [noon('2024-12-01'), noon('2025-02-01'), '2025-03-12T23:30:00-05:00']);
    repo.future = join(root, 'future');
    makeRepo(repo.future, [noon('2025-03-01'), noon('2025-03-05'), noon('2099-01-01')]);
    repo.flat = join(root, 'flat');
    makeRepo(repo.flat, ['2025-03-01', '2025-03-02', '2025-03-03'].map(noon));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('--json: stats.json has the longest break over the whole history', async () => {
    const text = await cli([repo.app, '--out', out('all'), '--json']);
    assert.deepEqual(json(out('all')).stats.streaks.longestBreak, { days: 53, from: '2025-01-06', to: '2025-03-01' });
    assert.match(text, /\n {2}Break +longest 53 days \(Jan 6, 2025 – Mar 1, 2025\)\n/);
    const svg = streakSvg(out('all'));
    assert.match(svg, /53 days off/);
    assert.match(svg, /Between Jan 6, 2025 and Mar 1, 2025/);
    // The viewer page carries the same card.
    assert.match(readFileSync(join(out('all'), 'wrapped.html'), 'utf8'), /53 days off/);
  });

  test('--year 2024: only that year\'s gap (no break across the year boundary)', async () => {
    const text = await cli([repo.app, '--out', out('y24'), '--json', '--year', '2024']);
    assert.deepEqual(json(out('y24')).stats.streaks.longestBreak, { days: 48, from: '2024-11-01', to: '2024-12-20' });
    assert.match(text, /Break +longest 48 days \(Nov 1, 2024 – Dec 20, 2024\)/);
    assert.match(streakSvg(out('y24')), /48 days off/);
  });

  test('--year 2025: the break into 2025 from Dec 20 is not counted', async () => {
    await cli([repo.app, '--out', out('y25'), '--json', '--year', '2025']);
    assert.deepEqual(json(out('y25')).stats.streaks.longestBreak, { days: 53, from: '2025-01-06', to: '2025-03-01' });
  });

  test('--since: gaps before the window are left out', async () => {
    await cli([repo.app, '--out', out('since'), '--json', '--since', '2025-03-01']);
    assert.deepEqual(json(out('since')).stats.streaks.longestBreak, { days: 9, from: '2025-03-02', to: '2025-03-12' });
  });

  test('--until: gaps after the window are left out (past window)', async () => {
    const text = await cli([repo.app, '--out', out('until'), '--json', '--until', '2025-01-06']);
    assert.deepEqual(json(out('until')).stats.streaks.longestBreak, { days: 48, from: '2024-11-01', to: '2024-12-20' });
    assert.match(text, /Break +longest 48 days/);
  });

  test('--since + --until: the break never extends to the window edges', async () => {
    // Window Dec 1 2024 – Feb 28 2025 holds Dec 20, Jan 5, Jan 6: only the 15-day gap;
    // the idle stretch from Dec 1 and up to Feb 28 does not count.
    await cli([repo.app, '--out', out('both'), '--json', '--since', '2024-12-01', '--until', '2025-02-28']);
    assert.deepEqual(json(out('both')).stats.streaks.longestBreak, { days: 15, from: '2024-12-20', to: '2025-01-05' });
    // A window with one active day → no break, no panel, no recap line.
    const text = await cli([repo.app, '--out', out('one'), '--json', '--since', '2025-03-10', '--until', '2025-03-20']);
    assert.deepEqual(json(out('one')).stats.streaks.longestBreak, NO_BREAK);
    assert.doesNotMatch(text, /Break/);
    assert.doesNotMatch(streakSvg(out('one')), /days off/);
  });

  test('--lang tr: card SVG and recap are localized', async () => {
    const text = await cli([repo.app, '--out', out('tr'), '--lang', 'tr']);
    assert.match(text, /\n {2}Mola +en uzun 53 gün \(6 Oca 2025 – 1 Mar 2025\)\n/);
    const svg = streakSvg(out('tr'));
    assert.match(svg, /EN UZUN MOLA/);
    assert.match(svg, /53 gün</);
    assert.match(svg, /6 Oca 2025 ile 1 Mar 2025 arası/);
    assert.doesNotMatch(svg, /days off|Longest break/i);
  });

  test('every --theme renders the panel', async () => {
    for (const theme of COLOR_THEME_NAMES) {
      await cli([repo.app, '--out', out(`theme-${theme}`), '--theme', theme]);
      assert.match(streakSvg(out(`theme-${theme}`)), /53 days off/, theme);
    }
  });

  test('multi-repo: active days are merged before the gaps are measured', async () => {
    const text = await cli([repo.app, repo.lib, '--out', out('multi'), '--json']);
    const doc = json(out('multi'));
    assert.deepEqual(doc.stats.streaks.longestBreak, { days: 29, from: '2024-11-01', to: '2024-12-01' });
    assert.match(text, /Break +longest 29 days \(Nov 1, 2024 – Dec 1, 2024\)/);
    assert.match(streakSvg(out('multi')), /29 days off/);
    // Each repo alone has a longer break than the merge.
    const lib = await generate({ path: repo.lib, out: out('lib'), png: false, json: true }, { today: TODAY });
    assert.deepEqual(lib.stats.streaks.longestBreak, { days: 61, from: '2024-12-01', to: '2025-02-01' });
    // The -05:00 late-night commit counts as Mar 12 (author-local): no extra day.
    assert.equal(doc.stats.totals.activeDays, 9);
  });

  test('multi-repo with --year 2025: merged break inside the window only', async () => {
    await cli([repo.app, repo.lib, '--out', out('multi25'), '--json', '--year', '2025']);
    // 2025 days: Jan 5, Jan 6, Feb 1, Mar 1, Mar 2, Mar 12 → Feb 1 → Mar 1 = 27.
    assert.deepEqual(json(out('multi25')).stats.streaks.longestBreak, { days: 27, from: '2025-02-01', to: '2025-03-01' });
  });

  test('a future-dated commit: raw in stats.json, left out on the card and in the recap', async () => {
    const text = await cli([repo.future, '--out', out('future'), '--json']);
    const raw = json(out('future')).stats.streaks.longestBreak;
    assert.equal(raw.from, '2025-03-05');
    assert.equal(raw.to, '2099-01-01');
    assert.ok(raw.days > 25000);
    assert.match(text, /\n {2}Break +longest 3 days \(Mar 1, 2025 – Mar 5, 2025\)\n/);
    assert.doesNotMatch(text, /2099/);
    const svg = streakSvg(out('future'));
    assert.match(svg, /3 days off/);
    assert.match(svg, /Between Mar 1, 2025 and Mar 5, 2025/);
    assert.doesNotMatch(svg, /2099/);
  });

  test('no break: stats.json has the empty shape, no Break line, no panel', async () => {
    const text = await cli([repo.flat, '--out', out('flat'), '--json']);
    const doc = json(out('flat'));
    assert.deepEqual(doc.stats.streaks.longestBreak, NO_BREAK);
    assert.deepEqual(Object.keys(doc.stats.streaks), ['longest', 'current', 'longestBreak']);
    assert.doesNotMatch(text, /Break/);
    const svg = streakSvg(out('flat'));
    assert.doesNotMatch(svg, /days off|LONGEST BREAK/i);
    // The card files equal the ones built from stats with no longestBreak field at all.
    const r = await generate({ path: repo.flat, out: out('flat2'), png: false }, { today: TODAY });
    const { longestBreak, ...rest } = r.stats.streaks;
    const legacy = buildCards({ ...r.stats, streaks: rest }, { repoName: 'flat', today: TODAY }).find((c) => c.id === 'streak');
    assert.equal(streakSvg(out('flat2')), legacy.svg);
  });
});
