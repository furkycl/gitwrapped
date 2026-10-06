// Monthly timeline: stats.months (src/stats/months.js) and the optional 'months' card.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeMonths, computeStats, monthsFromDays } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, CARD_IDS, cardIdsFor, COLOR_THEME_NAMES, hasMonthsCard, layoutCard, MAX_SHOWN_MONTHS, OPTIONAL_CARD_IDS, shownMonths } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { getStrings, LANGS } from '../src/i18n/index.js';
import { generate } from '../src/cli.js';
import { pngSize, renderPng } from '../src/png.js';

const TODAY = '2026-10-06';
const c = (date, extra = {}) => ({ hash: `h${date}`, date, subject: 'feat: x', author: 'Ada', email: 'a@x', files: [{ path: 'src/a.js', added: 1, removed: 0 }], ...extra });
const statsOf = (commits, today = TODAY) => computeStats(commits, { today });
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');
const monthsSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'months')?.spec;

/** `n` commits in each of the given months ('YYYY-MM' → count). */
function spread(counts) {
  const out = [];
  for (const [month, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push(c(`${month}-${String((i % 28) + 1).padStart(2, '0')}T12:00:00+00:00`, { hash: `${month}-${i}` }));
  }
  return out;
}

describe('computeMonths', () => {
  test('no commits → no months, null peak', () => {
    assert.deepEqual(computeMonths([]), { months: [], peak: null });
    assert.deepEqual(computeMonths(undefined), { months: [], peak: null });
    assert.deepEqual(statsOf([]).months, { months: [], peak: null });
  });

  test('contiguous and zero-filled from the first to the last active month, across a year end', () => {
    const m = computeMonths(spread({ '2025-11': 2, '2026-02': 3 }));
    assert.deepEqual(m.months, [
      { month: '2025-11', commits: 2 },
      { month: '2025-12', commits: 0 },
      { month: '2026-01', commits: 0 },
      { month: '2026-02', commits: 3 },
    ]);
    assert.deepEqual(m.peak, { month: '2026-02', commits: 3 });
  });

  test('a tie for the peak goes to the earliest month', () => {
    const m = computeMonths(spread({ '2026-01': 4, '2026-02': 1, '2026-03': 4 }));
    assert.deepEqual(m.peak, { month: '2026-01', commits: 4 });
  });

  test('months are the author-local calendar month (the commit offset, not UTC)', () => {
    // 23:30 on Jan 31 at -05:00 is Feb 1 in UTC; 00:30 on Mar 1 at +03:00 is Feb 28 in UTC.
    const m = computeMonths([c('2026-01-31T23:30:00-05:00'), c('2026-03-01T00:30:00+03:00')]);
    assert.deepEqual(m.months, [
      { month: '2026-01', commits: 1 },
      { month: '2026-02', commits: 0 },
      { month: '2026-03', commits: 1 },
    ]);
  });

  test('agrees with stats.daily, skips unparseable dates and counts future-dated commits', () => {
    const commits = [...spread({ '2026-09': 2, '2026-10': 1 }), c('not a date'), c('2099-01-01T00:00:00Z')];
    const s = statsOf(commits);
    assert.deepEqual(s.months, monthsFromDays(s.daily.days));
    assert.equal(s.months.months.at(-1).month, '2099-01');
    assert.equal(s.months.months.reduce((n, m) => n + m.commits, 0), 4);
  });

  test('monthsFromDays ignores invalid entries', () => {
    assert.deepEqual(monthsFromDays([{ day: '2026-13-01', commits: 1 }, { day: 'x', commits: 2 }, { day: '2026-05-01', commits: 'x' }, null]), { months: [], peak: null });
    assert.deepEqual(monthsFromDays([{ day: '2026-05-03', commits: 2 }, { day: '2026-05-09', commits: 1 }]).months, [{ month: '2026-05', commits: 3 }]);
  });

  test('stats.months sits right after stats.daily', () => {
    const keys = Object.keys(statsOf(spread({ '2026-01': 1 })));
    assert.equal(keys.indexOf('months'), keys.indexOf('daily') + 1);
  });
});

describe('months card applicability', () => {
  test('is optional and sits right after activity', () => {
    assert.ok(OPTIONAL_CARD_IDS.includes('months'));
    assert.equal(CARD_IDS.indexOf('months'), CARD_IDS.indexOf('activity') + 1);
  });

  test('one calendar month → no card, numbering contiguous', () => {
    const s = statsOf(spread({ '2026-03': 5 }));
    assert.equal(hasMonthsCard(s), false);
    const specs = buildCardSpecs(s, { today: TODAY });
    assert.ok(!specs.some((x) => x.id === 'months'));
    assert.deepEqual(specs.map((x) => x.spec.number), specs.map((_, i) => String(i + 1).padStart(2, '0')));
    assert.deepEqual(specs.map((x) => x.id), cardIdsFor({}));
  });

  test('two calendar months (even adjacent days across a month end) → card 06, later cards shift', () => {
    const s = statsOf([c('2026-03-31T12:00:00+00:00'), c('2026-04-01T12:00:00+00:00')]);
    assert.equal(hasMonthsCard(s), true);
    const specs = buildCardSpecs(s, { today: TODAY });
    assert.deepEqual(specs.map((x) => x.id), CARD_IDS.filter((id) => id !== 'contributors'));
    assert.equal(specs.find((x) => x.id === 'months').spec.number, '06');
    assert.equal(specs.find((x) => x.id === 'hot-files').spec.number, '07');
    assert.deepEqual(specs.map((x) => x.spec.number), specs.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  test('with a team too, all cards are built', () => {
    const s = statsOf([c('2026-03-31T12:00:00+00:00'), c('2026-04-01T12:00:00+00:00', { author: 'Bob', email: 'b@x' })]);
    assert.deepEqual(buildCards(s, { today: TODAY }).map((x) => x.id), [...CARD_IDS]);
  });

  test('future-dated commits do not make a single-month history get the card', () => {
    const s = statsOf([...spread({ '2026-10': 3 }), c('2099-05-01T12:00:00Z')]);
    assert.equal(s.months.months.length > 1, true, 'stats.json keeps every month');
    assert.equal(hasMonthsCard(s, { today: TODAY }), false);
    assert.ok(!cardIdsFor(s, { today: TODAY }).includes('months'));
    // Without a reference day nothing is left out.
    assert.equal(hasMonthsCard(s), true);
    // The shown months stop at today + 1.
    const t = statsOf([...spread({ '2026-09': 1, '2026-10': 3 }), c('2099-05-01T12:00:00Z')]);
    assert.deepEqual(shownMonths(t, TODAY).months.map((m) => m.month), ['2026-09', '2026-10']);
  });

  test('every commit dated in the future → no months shown, no card (stats.json keeps them)', () => {
    const s = statsOf([c('2099-01-03T12:00:00Z'), c('2099-02-03T12:00:00Z'), c('2099-05-03T12:00:00Z')]);
    assert.equal(s.months.months.length, 5);
    assert.deepEqual(shownMonths(s, TODAY), { months: [], peak: null });
    assert.equal(hasMonthsCard(s, { today: TODAY }), false);
    assert.ok(!buildCards(s, { today: TODAY }).some((x) => x.id === 'months'));
    // Without daily data the raw stats.months is used.
    assert.equal(shownMonths({ months: s.months }, TODAY).months.length, 5);
  });

  test('stats without daily / months (or junk) → no card', () => {
    assert.equal(hasMonthsCard({}), false);
    assert.equal(hasMonthsCard(null), false);
    assert.equal(hasMonthsCard({ months: { months: 'x' } }), false);
    assert.equal(hasMonthsCard({ months: { months: [{ month: '2026-01', commits: 0 }, { month: '2026-02', commits: 0 }] } }), false);
    assert.equal(hasMonthsCard({ months: { months: [{ month: '2026-01', commits: 1 }, { month: '2026-02', commits: 0 }] } }), true);
  });
});

describe('months card content', () => {
  test('English: peak month called out, bars per month, contiguous', () => {
    const s = statsOf(spread({ '2026-01': 3, '2026-03': 7, '2026-04': 2 }));
    const spec = monthsSpec(s);
    assert.equal(spec.eyebrow, 'Month by month');
    assert.equal(spec.big, 'Mar 2026');
    assert.equal(spec.title, 'was your peak month');
    assert.equal(spec.subtitle, '7 commits in a single month. You committed in 3 of 4 months.');
    assert.equal(spec.theme, 'neon');
    assert.equal(spec.chart.kind, 'bars');
    assert.deepEqual(spec.chart.values, [3, 0, 7, 2]);
    assert.deepEqual(spec.chart.highlight, [2]);
    assert.equal(spec.chart.peakLabel, '7');
    assert.deepEqual(spec.chart.titles, ['January 2026: 3 commits', 'February 2026: 0 commits', 'March 2026: 7 commits', 'April 2026: 2 commits']);
    assert.deepEqual(spec.chart.labels, ['2026', 'Feb', 'Mar', 'Apr']);
    const card = buildCards(s, { today: TODAY }).find((x) => x.id === 'months');
    assert.match(card.description, /Mar 2026 was your peak month\./);
    assert.match(card.description, /March 2026: 7 commits\./);
    assert.doesNotMatch(card.description, /February 2026/, 'empty months are left out of the description');
  });

  test('ties: "is tied" title, every tied month highlighted, the count above the earliest', () => {
    const spec = monthsSpec(statsOf(spread({ '2026-01': 4, '2026-02': 1, '2026-03': 4 })));
    assert.equal(spec.big, 'Jan 2026');
    assert.equal(spec.title, 'is tied for your peak month');
    assert.deepEqual(spec.chart.highlight, [0, 2]);
  });

  test('every active month with the same count → steady copy, nothing highlighted', () => {
    const spec = monthsSpec(statsOf(spread({ '2026-01': 3, '2026-03': 3, '2026-04': 3 })));
    assert.equal(spec.big, '3');
    assert.equal(spec.title, 'commits in every active month');
    assert.equal(spec.subtitle, 'You committed in 3 of 4 months.');
    assert.deepEqual(spec.chart.highlight, []);
    assert.equal(spec.chart.peakLabel, '');
    const one = monthsSpec(statsOf(spread({ '2026-01': 1, '2026-02': 1 })));
    assert.equal(one.title, 'commit in every active month');
    assert.equal(one.subtitle, 'You committed in every one of these 2 months.');
    const tr = monthsSpec(statsOf(spread({ '2026-01': 3, '2026-03': 3 })), { lang: 'tr' });
    assert.equal(tr.big, '3');
    assert.equal(tr.title, 'commit, her aktif ayda');
    // Not every active month tied: still a tie callout.
    const tie = monthsSpec(statsOf(spread({ '2026-01': 3, '2026-02': 1, '2026-03': 3 })));
    assert.equal(tie.title, 'is tied for your peak month');
  });

  test('every month active → "every one of these" copy', () => {
    const spec = monthsSpec(statsOf(spread({ '2026-01': 1, '2026-02': 2 })));
    assert.equal(spec.subtitle, '2 commits in a single month. You committed in every one of these 2 months.');
  });

  test(`long histories show the last ${MAX_SHOWN_MONTHS} months; stats keep every month`, () => {
    const counts = {};
    for (let i = 0; i < 40; i++) counts[`${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`] = i === 3 ? 30 : (i % 5) + 1;
    const s = statsOf(spread(counts));
    assert.equal(s.months.months.length, 40);
    assert.deepEqual(s.months.peak, { month: '2023-04', commits: 30 });
    const spec = monthsSpec(s, { today: '2026-04-30' });
    assert.equal(spec.chart.values.length, MAX_SHOWN_MONTHS);
    assert.equal(spec.eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
    // A timeline ending before the current month names its last month (like the activity card).
    assert.equal(monthsSpec(s).eyebrow, `${MAX_SHOWN_MONTHS} months to Apr 2026`);
    assert.equal(monthsSpec(s, { lang: 'tr' }).eyebrow, `Nis 2026 itibarıyla ${MAX_SHOWN_MONTHS} ay`);
    assert.equal(monthsSpec(s, { lang: 'tr', today: '2026-04-30' }).eyebrow, `Son ${MAX_SHOWN_MONTHS} ay`);
    // A past --until window ending in the last month counts as "as of" then.
    assert.equal(monthsSpec(s, { since: '2023-01-01', until: '2026-04-30' }).eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
    // The peak is the shown window's (2023-04 is out of it): the first of the 5-commit months.
    assert.equal(spec.chart.titles[0], 'May 2024: 2 commits');
    assert.equal(spec.big, 'Aug 2024');
    assert.equal(spec.title, 'is tied for your peak month');
    // Labels: every third month (Jan as its year), never two adjacent.
    const labelled = spec.chart.labels.flatMap((l, i) => (l ? [i] : []));
    for (let i = 1; i < labelled.length; i++) assert.ok(labelled[i] - labelled[i - 1] >= 3);
    assert.ok(spec.chart.labels.includes('2025'));
  });

  test('Turkish copy and month names', () => {
    const s = statsOf(spread({ '2026-01': 3, '2026-03': 7, '2026-04': 2 }));
    const spec = monthsSpec(s, { lang: 'tr' });
    assert.equal(spec.eyebrow, 'Ay ay commit');
    assert.equal(spec.big, 'Mar 2026');
    assert.equal(spec.title, 'en yoğun ayındı');
    assert.equal(spec.subtitle, 'Tek ayda 7 commit. 4 ayın 3 tanesinde commit attın.');
    assert.equal(spec.chart.titles[2], 'Mart 2026: 7 commit');
    assert.deepEqual(spec.chart.labels, ['2026', 'Şub', 'Mar', 'Nis']);
    const ago = monthsSpec(statsOf(spread({ '2026-07': 1, '2026-08': 9 })), { lang: 'tr' });
    assert.equal(ago.big, 'Ağu 2026');
    assert.equal(ago.chart.titles[1], 'Ağustos 2026: 9 commit');
  });

  test('both string tables have the monthly keys and 12 full month names', () => {
    for (const lang of LANGS) {
      const L = getStrings(lang);
      assert.equal(L.monthNames.length, 12, lang);
      for (const k of ['eyebrow', 'lastMonths', 'big', 'title', 'titleTied', 'peak', 'active', 'everyMonth', 'chartTitle', 'barTitle']) assert.ok(k in L.monthly, `${lang}.monthly.${k}`);
    }
  });
});

describe('months card rendering', () => {
  const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;
  const cases = {
    two: { '2026-09': 1, '2026-10': 4 },
    gaps: { '2025-01': 12, '2025-06': 1, '2026-02': 1234 },
    long: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, (i * 7) % 11 + 1])),
  };
  for (const [name, counts] of Object.entries(cases)) {
    for (const lang of LANGS) {
      for (const colorTheme of COLOR_THEME_NAMES) {
        test(`${name} / ${lang} / ${colorTheme}: renders within bounds, no NaN or undefined`, () => {
          const s = statsOf(spread(counts), '2035-01-01');
          const opts = { repoName: 'demo', today: '2035-01-01', lang, colorTheme };
          const spec = buildCardSpecs(s, opts).find((x) => x.id === 'months').spec;
          const layout = layoutCard(spec);
          for (const b of layout.blocks) assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${b.kind} outside the content area`);
          for (let i = 0; i < layout.blocks.length; i++) {
            for (let j = i + 1; j < layout.blocks.length; j++) assert.ok(!overlaps(layout.blocks[i], layout.blocks[j]), `${layout.blocks[i].kind} overlaps ${layout.blocks[j].kind}`);
          }
          assert.ok(layout.blocks.some((b) => b.kind === 'bars'), 'the bar chart fits');
          const card = buildCards(s, opts).find((x) => x.id === 'months');
          assert.doesNotMatch(card.svg, /NaN|undefined|null|\[object/);
          assert.doesNotMatch(card.description, /NaN|undefined|null|\[object/);
          // Every number in the SVG's coordinates lies on the 1080x1920 canvas.
          for (const m of card.svg.matchAll(/\b(x|y|width|height)="(-?[\d.]+)"/g)) {
            const v = Number(m[2]);
            assert.ok(v >= 0 && v <= (m[1] === 'x' || m[1] === 'width' ? 1080 : 1920), `${m[0]}`);
          }
          if (lang === 'en' && colorTheme === 'default') assert.ok(!/data-lang|colorTheme/.test(card.svg));
          assert.match(svgText(card.svg), lang === 'tr' ? /AYLIK COMMIT/ : /COMMITS PER MONTH/);
        });
      }
    }
  }
});

describe('months card as PNG', () => {
  for (const lang of LANGS) {
    for (const colorTheme of COLOR_THEME_NAMES) {
      test(`${lang} / ${colorTheme}: rasterizes to a 1080x1920 PNG`, async () => {
        const s = statsOf(spread({ '2025-11': 2, '2025-12': 0, '2026-01': 9, '2026-02': 4, '2026-03': 1 }));
        const card = buildCards(s, { today: TODAY, lang, colorTheme, repoName: 'demo' }).find((x) => x.id === 'months');
        assert.ok(card);
        assert.deepEqual(pngSize(await renderPng(card.svg)), { width: 1080, height: 1920 });
      });
    }
  }
});

describe('end to end', () => {
  function makeRepo(t, dates) {
    const root = mkdtempSync(join(tmpdir(), 'gw-months-'));
    t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
    const dir = join(root, 'app');
    mkdirSync(dir);
    const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    git(['config', 'commit.gpgsign', 'false']);
    dates.forEach((date, i) => {
      writeFileSync(join(dir, `f${i}.js`), 'x\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', `feat: ${i}`], {
        GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@x',
        GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      });
    });
    return { root, dir };
  }

  test('stats.json has stats.months; the card file is 06-months', async (t) => {
    const { root, dir } = makeRepo(t, ['2026-07-31T23:30:00-04:00', '2026-08-15T12:00:00+00:00', '2026-08-16T12:00:00+00:00', '2026-10-01T12:00:00+00:00']);
    const out = join(root, 'out');
    const r = await generate({ path: dir, out, png: false, json: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.months, {
      months: [{ month: '2026-07', commits: 1 }, { month: '2026-08', commits: 2 }, { month: '2026-09', commits: 0 }, { month: '2026-10', commits: 1 }],
      peak: { month: '2026-08', commits: 2 },
    });
    const files = readdirSync(join(out, 'cards')).sort();
    assert.ok(files.includes('06-months.svg'), files.join(','));
    assert.equal(files.length, r.cardFiles.length);
    const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
    assert.match(html, /data-card="months"/);
    assert.match(svgText(readFileSync(join(out, 'cards', '06-months.svg'), 'utf8')), /Aug 2026/);
  });

  test('narrowing --since to one month drops the card, with no stale file left', async (t) => {
    const { root, dir } = makeRepo(t, ['2026-08-01T12:00:00Z', '2026-08-20T12:00:00Z', '2026-09-02T12:00:00Z']);
    const a = await generate({ path: dir, out: join(root, 'a'), png: false }, { today: TODAY });
    assert.ok(a.cardFiles.some((f) => f.endsWith('06-months.svg')));
    const b = await generate({ path: dir, out: join(root, 'a'), png: false, since: '2026-09-01' }, { today: TODAY });
    assert.ok(!b.cardFiles.some((f) => f.endsWith('-months.svg')));
    // The stale 06-months.svg from the first run is gone and the numbering is contiguous.
    assert.deepEqual(readdirSync(join(root, 'a', 'cards')).sort(), cardIdsFor({}).map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`));
  });
});
