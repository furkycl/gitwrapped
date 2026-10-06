import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary, shouldUseColor } from '../src/summary.js';
import { computeStats } from '../src/stats/index.js';

const TODAY = '2024-03-14';
const PATHS = {
  html: 'out/wrapped.html',
  cardsDir: 'out/cards',
  cardCount: 8,
  pngDir: 'out/png',
  pngCount: 8,
  sharePng: 'out/share.png',
  shareSvg: 'out/share.svg',
};

function commit(date, subject, files = [{ path: 'src/a.js', added: 3, removed: 1, binary: false }]) {
  const linesAdded = files.reduce((n, f) => n + f.added, 0);
  const linesRemoved = files.reduce((n, f) => n + f.removed, 0);
  return { hash: date, author: 'A', email: 'a@x', date, subject, files, filesChanged: files.length, linesAdded, linesRemoved };
}

const MANY = [
  commit('2024-03-13T23:10:00+00:00', 'fix the parser again'),
  commit('2024-03-12T23:40:00+00:00', 'parser: handle tabs'),
  commit('2024-03-11T22:05:00+00:00', 'add parser tests'),
  commit('2024-03-09T10:00:00+00:00', 'initial commit', [{ path: 'README.md', added: 1200, removed: 0, binary: false }]),
];

describe('shouldUseColor', () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  const cases = [
    [{ stream: tty, env: {} }, true],
    [{ stream: pipe, env: {} }, false],
    [{ stream: undefined, env: {} }, false],
    [{ stream: tty, env: { NO_COLOR: '1' } }, false],
    [{ stream: tty, env: { NO_COLOR: '' } }, true],
    [{ stream: tty, env: { TERM: 'dumb' } }, false],
    [{ stream: pipe, env: { FORCE_COLOR: '1' } }, true],
    [{ stream: pipe, env: { FORCE_COLOR: 'true' } }, true],
    [{ stream: tty, env: { FORCE_COLOR: '0' } }, false],
    [{ stream: tty, env: { FORCE_COLOR: 'false' } }, false],
    [{ stream: tty, env: { FORCE_COLOR: '' } }, true],
    [{ stream: pipe, env: { FORCE_COLOR: '1', NO_COLOR: '1' } }, true],
    [{ stream: tty, env: { FORCE_COLOR: '1' }, flag: false }, false],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(shouldUseColor(input), expected);
    });
  }
});

describe('formatSummary', () => {
  test('full recap: first line, stats rows, output paths; plain has no ESC', () => {
    const out = formatSummary(computeStats(MANY, { today: TODAY }), { repoName: 'demo', paths: PATHS });
    const lines = out.split('\n');
    assert.equal(lines[0], 'gitwrapped: 4 commits → out/wrapped.html');
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.includes('\x1b'));
    assert.match(out, /★ demo Wrapped/);
    assert.match(out, /4 commits · 4 active days · \+1,209 \/ −3 lines/);
    assert.match(out, /Power hour {3}11 PM \(2 commits\)/);
    assert.match(out, /Streak {7}longest 3 days · current 3 days/);
    assert.match(out, /Break {8}longest 1 day \(Mar 9, 2024 – Mar 11, 2024\)\n/);
    assert.match(out, /Hottest file src\/a\.js \(3 commits\)/);
    assert.match(out, /Top word {5}"parser" ×3 · 1 fix/);
    assert.match(out, /Biggest {6}"initial commit" \(\+1,200 \/ 0 lines · Mar 9, 2024\)/);
    assert.match(out, /You are {6}\S/);
    assert.match(out, /8 cards in out\/cards\n/);
    assert.match(out, /8 PNGs in out\/png\n/);
    assert.match(out, /share image: out\/share\.png\n$/);
    assert.match(out, /Sizes {8}\S/);
    assert.ok(lines.length >= 8 && lines.length <= 17, `compact: ${lines.length} lines`);
  });

  test('color: true adds ANSI escapes but keeps the first line plain', () => {
    const out = formatSummary(computeStats(MANY, { today: TODAY }), { color: true, repoName: 'demo', paths: PATHS });
    assert.match(out, /\x1b\[\d+m/);
    assert.equal(out.split('\n')[0], 'gitwrapped: 4 commits → out/wrapped.html');
    assert.equal(out.replace(/\x1b\[\d+m/g, ''), formatSummary(computeStats(MANY, { today: TODAY }), { repoName: 'demo', paths: PATHS }));
  });

  test('empty stats: "No commits found", no null/undefined/NaN, no stat rows', () => {
    for (const color of [false, true]) {
      const out = formatSummary(computeStats([], { today: TODAY }), { color, paths: { ...PATHS, pngDir: null, sharePng: null } });
      assert.match(out, /^gitwrapped: 0 commits → out\/wrapped\.html\n/);
      assert.match(out, /No commits found/);
      assert.doesNotMatch(out, /null|undefined|NaN/);
      assert.doesNotMatch(out, /Power hour|Streak|Hottest|You are/);
      assert.match(out, /share image: out\/share\.svg/);
      assert.doesNotMatch(out, /PNGs in/);
      if (!color) assert.ok(!out.includes('\x1b'));
    }
  });

  test('missing stats and paths entirely still format safely', () => {
    for (const stats of [undefined, null, {}]) {
      const out = formatSummary(stats);
      assert.equal(out.split('\n')[0], 'gitwrapped: 0 commits →');
      assert.doesNotMatch(out, /null|undefined|NaN/);
    }
  });

  test('single commit: singular nouns, 1-day streak', () => {
    const out = formatSummary(computeStats([MANY[0]], { today: TODAY }), { paths: PATHS });
    assert.match(out, /^gitwrapped: 1 commit → /);
    assert.match(out, /1 commit · 1 active day · /);
    assert.match(out, /longest 1 day · current 1 day/);
    assert.match(out, /\(1 commit\)/);
    assert.doesNotMatch(out, /\b1 (commits|days)\b/);
    assert.doesNotMatch(out, /null|undefined|NaN/);
  });

  test('notes are printed after the first line', () => {
    const out = formatSummary(computeStats(MANY, { today: TODAY }), { notes: ['Note: capped.'], paths: PATHS });
    assert.equal(out.split('\n')[1], '  Note: capped.');
  });

  test('long hot-file paths are shortened from the start', () => {
    const path = `${'deep/'.repeat(20)}file.js`;
    const out = formatSummary(computeStats([commit('2024-03-13T10:00:00+00:00', 'x', [{ path, added: 1, removed: 0, binary: false }])], { today: TODAY }));
    assert.match(out, /Hottest file …[^ ]*\/file\.js \(1 commit\)/);
  });
});

describe('formatSummary: terminal escape injection', () => {
  test('control characters in repo-derived text are stripped', () => {
    const evil = 'x\x1b]0;PWNED\x07\x1b[31m\x9b2J\r';
    const stats = computeStats([commit('2024-03-13T10:00:00+00:00', `${evil} word word`, [{ path: `${evil}.txt`, added: 1, removed: 0, binary: false }])], { today: TODAY });
    const out = formatSummary(stats, { repoName: evil, paths: PATHS, notes: [evil] });
    assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(out), JSON.stringify(out));
  });
});
