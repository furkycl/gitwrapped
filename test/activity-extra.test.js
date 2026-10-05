// Tester additions for the activity heatmap (loop turn 016): end-to-end runs through the
// real binary (fresh and into an older, differently numbered output folder), daily stats
// vs streaks/totals across DST dates and extreme offsets, the calendar window's last row
// for Sunday/Monday endings, quartile levels for 1-5 distinct counts, title wording, the
// viewer page and the terminal summary.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCards, buildCardSpecs, CARD_IDS, layoutCard } from '../src/cards/index.js';
import { calendarLevels, calendarWindow } from '../src/cards/svg.js';
import { computeDaily, computeStats, computeStreaks, computeTotals, dayKeyFromEpoch, epochDay, localParts } from '../src/stats/index.js';
import { buildViewerHtml, CSP } from '../src/viewer.js';
import { pngSize } from '../src/png.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const TODAY = '2026-10-05';
const pad = (n) => String(n).padStart(2, '0');
const STEMS = CARD_IDS.map((id, i) => `${pad(i + 1)}-${id}`);
const at = (date) => ({ hash: date, author: 'A', email: 'a@x', date, subject: 'feat: x', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });

function bin(args, env = {}) {
  const e = { ...process.env, TZ: 'UTC', ...env };
  delete e.FORCE_COLOR;
  delete e.NO_COLOR;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', env: e });
}

const cellRects = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill-opacity="([\d.]+)">(?:<title>([^<]*)<\/title>)?<\/rect>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], op: +m[5], title: m[6] ?? null }));
const calendarSvg = (days) => layoutCard({ chart: { kind: 'calendar', days } }).blocks.find((b) => b.kind === 'calendar').svg;

let fixture;
let tmp;
before(() => {
  fixture = makeFixtureRepo();
  tmp = mkdtempSync(join(tmpdir(), 'gw-activity-extra-'));
});
after(() => {
  fixture?.cleanup();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

describe('bin: 10 cards end to end', () => {
  test('fresh run writes 10 SVGs and 10 real 1080x1920 PNGs with the current names', () => {
    const out = join(tmp, 'fresh');
    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), STEMS.map((s) => `${s}.svg`));
    assert.deepEqual(readdirSync(join(out, 'png')).sort(), STEMS.map((s) => `${s}.png`));
    assert.equal(STEMS[4], '05-activity');
    for (const s of STEMS) assert.deepEqual(pngSize(readFileSync(join(out, 'png', `${s}.png`))), { width: 1080, height: 1920 }, s);
    // Terminal summary: counts match, existing stat lines unchanged.
    assert.ok(r.stdout.includes(`10 cards in ${join(out, 'cards')}\n`), r.stdout);
    assert.ok(r.stdout.includes(`10 PNGs in ${join(out, 'png')}\n`), r.stdout);
    assert.ok(r.stdout.includes('8 commits · 8 active days'), r.stdout);
    assert.ok(r.stdout.includes('Streak       longest 5 days'), r.stdout);
    assert.ok(!/NaN|undefined|null/.test(r.stdout));
  });

  test('re-run into an older output folder: exactly the current 10 + unrelated user files remain', () => {
    const out = join(tmp, 'rerun');
    const cards = join(out, 'cards');
    const pngs = join(out, 'png');
    mkdirSync(cards, { recursive: true });
    mkdirSync(pngs, { recursive: true });
    // An old 8-card set (pre-activity numbering).
    const OLD = ['intro', 'totals', 'peak-hour', 'streak', 'hot-files', 'messages', 'personality', 'outro'].map((id, i) => `${pad(i + 1)}-${id}`);
    for (const s of OLD) {
      writeFileSync(join(cards, `${s}.svg`), 'old');
      writeFileSync(join(pngs, `${s}.png`), 'old');
    }
    // User files that must survive. On a case-insensitive file system (macOS, Windows)
    // 05-Hot-Files.svg is the same file as the old 05-hot-files.svg, so it is left out.
    writeFileSync(join(out, 'case-probe'), '');
    const caseInsensitive = existsSync(join(out, 'CASE-PROBE'));
    rmSync(join(out, 'case-probe'));
    const userCards = ['notes.txt', '05-custom.svg', ...(caseInsensitive ? [] : ['05-Hot-Files.svg']), '05-hot-files.svg.bak', '5-hot-files.svg', '05-hot-files.png', 'hot-files.svg'];
    const userPngs = ['notes.txt', '05-custom.png', '08-outro.svg', 'my-08-outro.png'];
    for (const f of userCards) writeFileSync(join(cards, f), 'mine');
    for (const f of userPngs) writeFileSync(join(pngs, f), 'mine');
    mkdirSync(join(cards, '06-outro.svg')); // a directory with a card-like name is not ours to remove
    writeFileSync(join(out, 'notes.txt'), 'mine');
    writeFileSync(join(out, '05-hot-files.svg'), 'mine'); // outside cards/: untouched
    writeFileSync(join(out, 'wrapped.html'), 'old'); // marks the folder as earlier gitwrapped output

    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(cards).sort(), [...STEMS.map((s) => `${s}.svg`), ...userCards, '06-outro.svg'].sort());
    assert.deepEqual(readdirSync(pngs).sort(), [...STEMS.map((s) => `${s}.png`), ...userPngs].sort());
    for (const f of userCards) assert.equal(readFileSync(join(cards, f), 'utf8'), 'mine', f);
    for (const f of userPngs) assert.equal(readFileSync(join(pngs, f), 'utf8'), 'mine', f);
    assert.ok(statSync(join(cards, '06-outro.svg')).isDirectory());
    assert.equal(readFileSync(join(out, '05-hot-files.svg'), 'utf8'), 'mine');
    assert.equal(readFileSync(join(out, 'notes.txt'), 'utf8'), 'mine');
    // The new files are real output, not the old stubs.
    assert.match(readFileSync(join(cards, '06-hot-files.svg'), 'utf8'), /^<svg\b/);
    assert.deepEqual(pngSize(readFileSync(join(pngs, '10-outro.png'))), { width: 1080, height: 1920 });

    // A second identical run is stable.
    const again = bin([fixture.dir, '--out', out]);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(readdirSync(cards).sort(), [...STEMS.map((s) => `${s}.svg`), ...userCards, '06-outro.svg'].sort());

    // --no-png: every known card PNG goes (old numbering too), user files stay, png/ kept.
    writeFileSync(join(pngs, '08-outro.png'), 'old');
    const noPng = bin([fixture.dir, '--out', out, '--no-png']);
    assert.equal(noPng.status, 0, noPng.stderr);
    assert.deepEqual(readdirSync(pngs).sort(), [...userPngs].sort());
  });

  test('the activity card does not depend on the machine timezone (+14 / -12)', () => {
    const svgs = ['Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles'].map((TZ, i) => {
      const out = join(tmp, `tz-${i}`);
      const r = bin([fixture.dir, '--out', out, '--no-png'], { TZ });
      assert.equal(r.status, 0, r.stderr);
      return readFileSync(join(out, 'cards', '05-activity.svg'), 'utf8');
    });
    assert.equal(svgs[1], svgs[0]);
    assert.equal(svgs[2], svgs[0]);
    // The fixture's 8 commits are on 8 author-local days (one on the US DST day 2024-03-10).
    assert.equal(cellRects(svgs[0]).filter((c) => c.title).length, 8);
    assert.ok(svgs[0].includes('<title>Mar 10, 2024: 1 commit</title>'));
  });
});

describe('daily stats agree with streaks and totals', () => {
  /** Longest run of consecutive days from computeDaily's days. */
  const longestRun = (days) => {
    let best = 0;
    let run = 0;
    let prev = null;
    for (const { day } of days) {
      const e = epochDay(day);
      run = prev !== null && e === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = e;
    }
    return best;
  };

  test('DST transition dates and extreme offsets use the author-local day', () => {
    const commits = [
      at('2024-03-10T02:30:00-08:00'), // US spring-forward hour (does not exist in LA local time)
      at('2024-03-31T02:30:00+01:00'), // EU spring-forward
      at('2024-11-03T01:30:00-07:00'), // US fall-back, first 1:30
      at('2024-11-03T01:30:00-08:00'), // ... second 1:30: same author-local day
      at('2026-10-05T23:30:00+14:00'), // Kiritimati: Oct 5 09:30 UTC
      at('2026-10-04T00:30:00-12:00'), // Baker Island: Oct 4 12:30 UTC
      at('2026-10-06T00:00:00+14:00'), // Oct 5 10:00 UTC, but Oct 6 for the author
      at('2026-10-03T23:59:00-12:00'), // Oct 4 11:59 UTC, but Oct 3 for the author
    ];
    const d = computeDaily(commits);
    assert.deepEqual(d.days, [
      { day: '2024-03-10', commits: 1 },
      { day: '2024-03-31', commits: 1 },
      { day: '2024-11-03', commits: 2 },
      { day: '2026-10-03', commits: 1 },
      { day: '2026-10-04', commits: 1 },
      { day: '2026-10-05', commits: 1 },
      { day: '2026-10-06', commits: 1 },
    ]);
    const s = computeStreaks(commits, { today: TODAY });
    assert.equal(s.longest.length, 4);
    assert.deepEqual([s.longest.start, s.longest.end], ['2026-10-03', '2026-10-06']);
    assert.equal(s.current.end, '2026-10-06'); // the day after today counts as alive
    assert.equal(computeTotals(commits).activeDays, d.days.length);
    // Weeks: Mar 4-10, Mar 25-31, Oct 28-Nov 3 (2024); Sep 28-Oct 4, Oct 5-11 (2026).
    assert.equal(d.activeWeeks, 5);
  });

  test('random commits with random offsets: days, totals and streaks line up', () => {
    let seed = 11;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 20; round++) {
      const commits = [];
      const n = 1 + Math.floor(r() * 200);
      for (let i = 0; i < n; i++) {
        const day = dayKeyFromEpoch(epochDay('2025-12-01') + Math.floor(r() * 120));
        const offMin = (Math.floor(r() * 105) - 48) * 15; // -12:00 .. +14:00
        const sign = offMin < 0 ? '-' : '+';
        const off = `${sign}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
        commits.push(at(`${day}T${pad(Math.floor(r() * 24))}:${pad(Math.floor(r() * 60))}:00${off}`));
      }
      const d = computeDaily(commits);
      const s = computeStats(commits, { today: TODAY });
      assert.deepEqual(s.daily, d);
      assert.equal(d.days.length, s.totals.activeDays);
      assert.equal(d.days.reduce((a, x) => a + x.commits, 0), commits.length);
      assert.deepEqual(d.days.map((x) => x.day), [...new Set(commits.map((c) => localParts(c.date).dayKey))].sort());
      assert.equal(s.streaks.longest.length, longestRun(d.days));
      assert.ok(d.days.some((x) => x.day === s.streaks.longest.start) && d.days.some((x) => x.day === s.streaks.longest.end));
      const maxC = Math.max(...d.days.map((x) => x.commits));
      assert.equal(d.busiest.commits, maxC);
      assert.equal(d.busiest.day, d.days.find((x) => x.commits === maxC).day);
      assert.ok(d.activeWeeks >= Math.ceil(d.days.length / 7) && d.activeWeeks <= d.days.length);
    }
  });
});

describe('calendar window: Monday-first weeks', () => {
  const one = (day) => [{ day, commits: 1 }];
  const lastRowMonday = (w) => dayKeyFromEpoch(w.start + (w.weeks - 1) * 7);

  test('last active day on a Sunday ends the last row; on a Monday it starts a new row', () => {
    assert.equal(lastRowMonday(calendarWindow(one('2026-10-04'))), '2026-09-28'); // Sunday
    assert.equal(lastRowMonday(calendarWindow(one('2026-10-05'))), '2026-10-05'); // Monday
    assert.equal(lastRowMonday(calendarWindow(one('2026-10-07'))), '2026-10-05'); // Wednesday
    for (const day of ['2026-10-04', '2026-10-05']) {
      const w = calendarWindow(one(day));
      assert.equal(w.weeks, 8);
      assert.equal(new Date(`${dayKeyFromEpoch(w.start)}T00:00:00Z`).getUTCDay(), 1, 'window starts on a Monday');
    }
  });

  test('rendered: Sunday is the last cell of the last row; Monday the first cell of it', () => {
    for (const [day, idx] of [['2026-10-04', 55], ['2026-10-05', 49]]) {
      const cells = cellRects(calendarSvg(one(day)));
      assert.equal(cells.length, 56);
      const titled = cells.map((c, i) => (c.title ? i : -1)).filter((i) => i >= 0);
      assert.deepEqual(titled, [idx], day);
    }
  });

  test('Sunday → next Monday spans 2 weeks (padded to 8); Monday → Sunday is 1 week', () => {
    const a = calendarWindow([...one('2026-10-04'), ...one('2026-10-05')]);
    assert.equal(a.weeks, 8);
    assert.equal(lastRowMonday(a), '2026-10-05');
    const b = calendarWindow([...one('2026-09-28'), ...one('2026-10-04')]);
    assert.equal(lastRowMonday(b), '2026-09-28');
  });

  test('53-week boundary: Monday..Sunday 53 weeks fits, one more day clips', () => {
    const fits = calendarWindow([...one('2025-09-29'), ...one('2026-10-04')]);
    assert.deepEqual([fits.weeks, fits.clipped, dayKeyFromEpoch(fits.start)], [53, false, '2025-09-29']);
    const clip = calendarWindow([...one('2025-09-28'), ...one('2026-10-04')]);
    assert.deepEqual([clip.weeks, clip.clipped, dayKeyFromEpoch(clip.start)], [53, true, '2025-09-29']);
    // Clipped days are not drawn.
    assert.ok(!calendarSvg([...one('2025-09-28'), ...one('2026-10-04')]).includes('Sep 28, 2025'));
  });
});

describe('quartile levels', () => {
  const OPS = [0.3, 0.5, 0.75, 1];
  for (let k = 1; k <= 5; k++) {
    test(`${k} distinct count(s)`, () => {
      const counts = Array.from({ length: k }, (_, i) => i + 1);
      const lv = calendarLevels(counts);
      const levels = counts.map(lv);
      for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], `monotonic ${levels}`);
      assert.equal(levels.at(-1), 3, 'busiest on top');
      if (k > 1) assert.equal(levels[0], 0, 'quietest at the bottom');
      assert.equal(new Set(levels).size, Math.min(k, 4), `levels ${levels}`);
      for (const l of levels) assert.ok(Number.isInteger(l) && l >= 0 && l <= 3);
      // Rendered opacities follow the levels.
      const start = epochDay('2026-09-07'); // a Monday
      const days = counts.map((c, i) => ({ day: dayKeyFromEpoch(start + i), commits: c }));
      const titled = cellRects(calendarSvg(days)).filter((c) => c.title);
      assert.deepEqual(titled.map((c) => c.op), levels.map((l) => OPS[l]));
    });
  }

  test('exact level tables for 3 and 5 distinct counts', () => {
    assert.deepEqual([1, 2, 3].map(calendarLevels([1, 2, 3])), [0, 1, 3]);
    assert.deepEqual([1, 2, 3, 4, 5].map(calendarLevels([1, 2, 3, 4, 5])), [0, 0, 1, 2, 3]);
    assert.deepEqual([7].map(calendarLevels([7])), [3]);
  });
});

describe('titles: singular / plural', () => {
  test('cell titles: 1 commit, 2 commits, 1,234 commits', () => {
    const svg = calendarSvg([{ day: '2026-10-01', commits: 1 }, { day: '2026-10-02', commits: 2 }, { day: '2026-10-03', commits: 1234 }]);
    const titles = cellRects(svg).filter((c) => c.title).map((c) => c.title);
    assert.deepEqual(titles, ['Oct 1, 2026: 1 commit', 'Oct 2, 2026: 2 commits', 'Oct 3, 2026: 1,234 commits']);
  });

  test('card copy: busiest day with 1,234 commits; 1 active day / 1 week', () => {
    const commits = Array.from({ length: 1234 }, () => at('2026-10-03T10:00:00Z'));
    const spec = buildCardSpecs(computeStats(commits, { today: TODAY }), {}).find((c) => c.id === 'activity').spec;
    assert.equal(spec.big, '1');
    assert.equal(spec.title, 'active day');
    assert.equal(spec.subtitle, 'Busiest day: Oct 3, 2026 with 1,234 commits. You showed up in 1 week.');
  });
});

describe('viewer page', () => {
  test('wrapped.html from a run has 10 cards with unique ids and an intact CSP', () => {
    const out = join(tmp, 'viewer');
    const r = bin([fixture.dir, '--out', out, '--no-png']);
    assert.equal(r.status, 0, r.stderr);
    const page = readFileSync(join(out, 'wrapped.html'), 'utf8');
    const sections = [...page.matchAll(/<section class="slide[^"]*" id="(card-\d+)" data-card="([^"]*)"/g)];
    assert.deepEqual(sections.map((m) => m[1]), CARD_IDS.map((_, i) => `card-${i + 1}`));
    assert.deepEqual(sections.map((m) => m[2]), [...CARD_IDS]);
    assert.equal((page.match(/<span class="bar[^"]*"><i><\/i><\/span>/g) ?? []).length, CARD_IDS.length);
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
    assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
    assert.match(CSP, /default-src 'none'/);
    assert.ok(!/\b(?:href|src)="(?:https?:)?\/\//.test(page), 'no external URLs');
    // The activity card's inline SVG is the 5th slide and carries its heatmap.
    const slide5 = page.split('<section').find((s) => s.includes('id="card-5"'));
    assert.ok(slide5.includes('data-card="activity"'));
    assert.ok(slide5.includes('<title>Mar 10, 2024: 1 commit</title>'));
    // Same as building it in-process.
    assert.equal(buildViewerHtml(buildCards(computeStats([], { today: TODAY }))).match(/<section /g).length, CARD_IDS.length);
  });
});
