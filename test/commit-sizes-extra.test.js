// Extra edge cases for the commit size mix (src/stats/sizes.js, the totals card's stacked
// bar, the recap line, stats.json) written by the tester of loop turn 042.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { commitSizeOf, computeCommitSizes, computeStats, shownCommitSizes, sizeShares } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { run } from '../src/cli.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(files, extra = {}) {
  n += 1;
  return { hash: `s${n}`, author: 'A', email: 'a@x', date: `2026-03-${String((n % 28) + 1).padStart(2, '0')}T10:00:00Z`, subject: `c${n}`, parents: ['p'], files, ...extra };
}
const f = (path, added, removed = 0, binary = false) => ({ path, added, removed, binary });

/** A seeded PRNG (mulberry32) so the property tests are deterministic. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const totalsSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'totals').spec;
const totalsCard = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'totals');

/** The bar rects (height 32) of a rendered stack block, as [x, width]. */
const barRects = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="32"/g)].map((m) => [Number(m[1]), Number(m[2])]);

function assertLayoutOk(spec, label) {
  const layout = layoutCard(spec);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
  }
  return layout;
}

// --- properties -----------------------------------------------------------------------------

describe('commit sizes: properties (seeded PRNG)', () => {
  test('random histories: counts add up to total, shares to 100, each bucket matches commitSizeOf', () => {
    const rnd = prng(42);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const PATHS = ['src/a.js', 'lib/b.ts', 'docs/x.md', 'package-lock.json', 'dist/out.js', 'vendor/v.go', 'a.min.js', 'img.png'];
    for (let round = 0; round < 200; round++) {
      const commits = [];
      const expected = { tiny: 0, small: 0, medium: 0, large: 0 };
      const size = Math.floor(rnd() * 30);
      for (let i = 0; i < size; i++) {
        const merge = rnd() < 0.1;
        const files = [];
        let lines = 0;
        for (let k = Math.floor(rnd() * 4); k > 0; k--) {
          const path = pick(PATHS);
          const scale = pick([1, 10, 100, 1000]);
          const added = Math.floor(rnd() * scale);
          const removed = Math.floor(rnd() * scale);
          files.push(f(path, added, removed));
          if (!/lock|dist\/|vendor\/|\.min\./.test(path)) lines += added + removed;
        }
        commits.push(commit(files, merge ? { parents: ['a', 'b'] } : {}));
        if (!merge) expected[commitSizeOf(lines)] += 1;
      }
      const r = computeCommitSizes(commits);
      const label = `round ${round}`;
      assert.deepEqual({ tiny: r.tiny, small: r.small, medium: r.medium, large: r.large }, expected, label);
      assert.equal(r.total, r.tiny + r.small + r.medium + r.large, label);
      const sum = Object.values(r.shares).reduce((a, b) => a + b, 0);
      assert.equal(sum, r.total > 0 ? 100 : 0, label);
      for (const id of ['tiny', 'small', 'medium', 'large']) {
        assert.ok(Number.isInteger(r.shares[id]) && r.shares[id] >= 0, label);
        if (r.total > 0) assert.ok(Math.abs(r.shares[id] - (r[id] / r.total) * 100) < 1, `${label}: ${id} within 1 of exact`);
        if (r[id] === 0) assert.equal(r.shares[id], 0, `${label}: an empty bucket has 0%`);
      }
      // shownCommitSizes agrees with the stored shares.
      const shown = shownCommitSizes(r);
      if (r.total === 0) assert.equal(shown, null);
      else assert.deepEqual(shown.map((b) => b.share), ['tiny', 'small', 'medium', 'large'].map((id) => r.shares[id]), label);
    }
  });

  test('sizeShares: large / skewed / many-way inputs always sum to 100', () => {
    const rnd = prng(7);
    for (let i = 0; i < 500; i++) {
      const len = 2 + Math.floor(rnd() * 6);
      const values = Array.from({ length: len }, () => (rnd() < 0.3 ? 0 : Math.floor(rnd() ** 4 * 1e7)));
      const total = values.reduce((a, b) => a + b, 0);
      const shares = sizeShares(values);
      assert.equal(shares.length, len);
      assert.equal(shares.reduce((a, b) => a + b, 0), total > 0 ? 100 : 0, values.join());
      values.forEach((v, j) => {
        if (v === 0) assert.equal(shares[j], 0, `${values.join()}: zero stays 0`);
      });
    }
    // A single non-zero value takes 100 regardless of position; does not mutate its input.
    const input = [0, 0, 5, 0];
    assert.deepEqual(sizeShares(input), [0, 0, 100, 0]);
    assert.deepEqual(input, [0, 0, 5, 0]);
  });

  test('random mixes: the stacked bar segments never overlap and span exactly the content width', () => {
    const rnd = prng(2026);
    for (let i = 0; i < 120; i++) {
      const counts = [0, 0, 0, 0].map(() => (rnd() < 0.35 ? 0 : 1 + Math.floor(rnd() ** 3 * 5000)));
      if (counts.every((c) => c === 0)) counts[0] = 1;
      const [tiny, small, medium, large] = counts;
      const stats = computeStats([commit([f('src/a.js', 1)])], { today: TODAY });
      stats.commitSizes = { total: tiny + small + medium + large, tiny, small, medium, large };
      const spec = totalsSpec(stats);
      const block = layoutCard(spec).blocks.find((b) => b.kind === 'stack');
      assert.ok(block, counts.join());
      const rects = barRects(block.svg);
      assert.equal(rects.length, counts.filter((c) => c > 0).length, counts.join());
      assert.ok(Math.abs(rects[0][0] - 96) < 0.01, `${counts}: starts at the left padding`);
      const last = rects.at(-1);
      assert.ok(Math.abs(last[0] + last[1] - 984) <= 0.2, `${counts}: ends at the right padding (${last[0] + last[1]})`);
      for (let k = 0; k < rects.length; k++) {
        assert.ok(rects[k][1] >= 11.9, `${counts}: segment ${k} at least ~12px wide (${rects[k][1]})`);
        if (k > 0) assert.ok(rects[k][0] >= rects[k - 1][0] + rects[k - 1][1], `${counts}: segment ${k} does not overlap ${k - 1}`);
      }
    }
  });
});

// --- card rendering edges ---------------------------------------------------------------------

describe('totals card (extra)', () => {
  test('mono / neon, en / tr, single-repo and multi-repo: no overlap, labels drawn, no NaN', () => {
    const commits = [commit([f('src/a.js', 1)]), commit([f('src/a.js', 50)]), commit([f('src/a.js', 300)]), commit([f('src/a.js', 9000)])];
    const base = computeStats(commits, { today: TODAY });
    const multi = { ...base, repos: [{ name: 'api', commits: 3, linesAdded: 10, linesRemoved: 1, filesTouched: 2 }, { name: 'web', commits: 1, linesAdded: 1, linesRemoved: 0, filesTouched: 1 }] };
    const labels = { en: ['Tiny', 'Small', 'Medium', 'Large'], tr: ['Minik', 'Küçük', 'Orta', 'Büyük'] };
    for (const [name, stats] of [['single', base], ['multi', multi]]) {
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of ['default', 'mono', 'neon']) {
          const label = `${name}/${lang}/${colorTheme}`;
          const spec = totalsSpec(stats, { lang, colorTheme });
          const layout = assertLayoutOk(spec, label);
          const card = totalsCard(stats, { lang, colorTheme });
          assert.doesNotMatch(card.svg, /NaN|undefined|Infinity|null/, label);
          // The bar is purely additive (turn 042 review): a multi-repo totals card has no
          // spare room for it, so it is left out and the card is as without commitSizes.
          if (name === 'single') {
            assert.ok(layout.blocks.some((b) => b.kind === 'stack'), `${label}: stack drawn`);
            for (const l of labels[lang]) assert.ok(card.svg.includes(`>${l}<`), `${label}: ${l}`);
          } else {
            assert.equal(layout.blocks.some((b) => b.kind === 'stack'), false, `${label}: stack left out`);
            const without = { ...stats };
            delete without.commitSizes;
            assert.equal(card.svg, totalsCard(without, { lang, colorTheme }).svg, `${label}: byte-identical without the bar`);
          }
        }
      }
    }
  });

  test('100% in one bucket: one full-width rect; all four labels still drawn with 0%', () => {
    const stats = computeStats([commit([f('src/a.js', 2000)]), commit([f('src/b.js', 600)])], { today: TODAY });
    assert.deepEqual(stats.commitSizes.shares, { tiny: 0, small: 0, medium: 0, large: 100 });
    const block = layoutCard(totalsSpec(stats)).blocks.find((b) => b.kind === 'stack');
    const rects = barRects(block.svg);
    assert.equal(rects.length, 1);
    assert.deepEqual(rects[0], [96, 888]);
    const card = totalsCard(stats);
    assert.equal((card.svg.match(/>0%</g) ?? []).length, 3);
    assert.ok(card.svg.includes('>100%<'));
    // Only the non-empty bucket is in the description.
    assert.match(card.description, /Large \(over 500 lines\): 2 commits \(100%\)/);
    assert.doesNotMatch(card.description, /Tiny \(/);
  });

  test('huge commit counts render without overflowing; shares still sum to 100', () => {
    const stats = computeStats([commit([f('src/a.js', 1)])], { today: TODAY });
    stats.commitSizes = { total: 3e6 + 3, tiny: 1e6, small: 1e6 + 1, medium: 1e6 + 2, large: 0 };
    const spec = totalsSpec(stats);
    const stack = [].concat(spec.chart).find((c) => c.kind === 'stack');
    assert.deepEqual(stack.segments.map((s) => s.value), ['33%', '33%', '34%', '0%']);
    assertLayoutOk(spec, 'huge');
    assert.match(stack.segments[2].title, /1,000,002 commits/);
  });

  test('a history of only merge commits: card byte-identical to one without commitSizes', () => {
    const merges = [commit([f('src/a.js', 40)], { parents: ['a', 'b'] }), commit([], { parents: ['a', 'b', 'c'] })];
    const stats = computeStats(merges, { today: TODAY });
    assert.equal(stats.commitSizes.total, 0);
    const without = { ...stats };
    delete without.commitSizes;
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of ['default', 'mono', 'neon']) {
        const a = totalsCard(stats, { lang, colorTheme });
        const b = totalsCard(without, { lang, colorTheme });
        assert.equal(a.svg, b.svg, `${lang}/${colorTheme}`);
        assert.equal(a.description, b.description);
        assert.doesNotMatch(a.svg, /height="32"[^>]*fill-opacity="0.7"/);
      }
    }
    assert.doesNotMatch(formatSummary(stats, { paths: { html: 'x.html' }, today: TODAY }), /Sizes/);
  });
});

// --- end to end through the real CLI ----------------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}
const lines = (count, tag = 'l') => Array.from({ length: count }, (_, i) => `${tag}${i}`).join('\n') + '\n';
const capture = () => {
  const s = { text: '', write: (x) => { s.text += x; return true; } };
  return s;
};
const who = { GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };

function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const s of steps) {
    const env = { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date };
    if (s.git) {
      git(dir, s.git, env);
      continue;
    }
    for (const [p, content] of Object.entries(s.files ?? {})) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', s.msg], env);
  }
}

const totalsSvg = (outDir) => {
  const name = readdirSync(join(outDir, 'cards')).find((x) => /-totals\.svg$/.test(x));
  assert.ok(name, 'a totals card file is written');
  return readFileSync(join(outDir, 'cards', name), 'utf8');
};

describe('end to end via the CLI (commit sizes)', () => {
  let root;
  let app;
  let lib;
  const out = (name) => join(root, 'out', name);
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-sizes-x-'));
    app = join(root, 'app');
    lib = join(root, 'lib');
    // app: tiny (3), small (40), medium (200 src + 9000 lockfile → medium), large (700 docs), a merge.
    makeRepo(app, [
      { date: '2025-03-01T10:00:00+00:00', msg: 'tiny', files: { 'src/a.js': lines(3) } },
      { date: '2025-03-02T10:00:00+00:00', msg: 'small', files: { 'src/b.js': lines(40) } },
      { date: '2025-03-03T10:00:00+00:00', msg: 'medium + lockfile', files: { 'src/c.js': lines(200), 'package-lock.json': lines(9000) } },
      { date: '2025-03-04T10:00:00+00:00', msg: 'big docs', files: { 'docs/huge.md': lines(700) } },
      { date: '2025-03-05T10:00:00+00:00', git: ['checkout', '-q', '-b', 'side'] },
      { date: '2025-03-05T10:00:00+00:00', msg: 'side work', files: { 'src/side.js': lines(5) } },
      { date: '2025-03-06T10:00:00+00:00', git: ['checkout', '-q', 'main'] },
      { date: '2025-03-06T10:00:00+00:00', msg: 'main work', files: { 'src/main.js': lines(2) } },
      { date: '2025-03-07T10:00:00+00:00', git: ['merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side'] },
    ]);
    // lib: a lockfile at its root (ignored), and dist/ output (ignored) → both tiny.
    makeRepo(lib, [
      { date: '2025-04-01T10:00:00+00:00', msg: 'lib lock', files: { 'yarn.lock': lines(800) } },
      { date: '2025-04-02T10:00:00+00:00', msg: 'lib dist', files: { 'dist/engine.js': lines(900), 'src/e.js': lines(1) } },
      { date: '2025-04-03T10:00:00+00:00', msg: 'lib engine', files: { 'src/engine.js': lines(600) } },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json commitSizes, totals card labels and the recap line agree (merge skipped, lockfile ignored)', async () => {
    const stdout = capture();
    const code = await run([app, '--out', out('a'), '--no-png', '--no-color', '--json'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('a'), 'stats.json'), 'utf8'));
    // 6 non-merge commits: tiny (3, 5, 2), small (40), medium (200), large (700).
    assert.deepEqual(doc.stats.commitSizes, { total: 6, tiny: 3, small: 1, medium: 1, large: 1, shares: { tiny: 50, small: 17, medium: 17, large: 16 } });
    const keys = Object.keys(doc.stats);
    assert.equal(keys.indexOf('commitSizes'), keys.indexOf('biggestCommit') + 1);
    const svg = totalsSvg(out('a'));
    for (const t of ['>Tiny<', '>Small<', '>Medium<', '>Large<', '>50%<', '>17%<', '>16%<']) assert.ok(svg.includes(t), `totals card has ${t}`);
    assert.match(svg, /COMMIT SIZES|Commit sizes/i);
    assert.match(stdout.text, /\n {2}Sizes +50% tiny · 17% small · 17% medium · 16% large\n/);
  });

  test('--exclude moves commits between buckets (excluded files add no lines; commits still count)', async () => {
    const stdout = capture();
    const code = await run([app, '--out', out('ex'), '--no-png', '--no-color', '--json', '--exclude', 'docs/', '--exclude', 'src/c.js'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('ex'), 'stats.json'), 'utf8'));
    // docs (700) and c.js (200) are gone: both commits drop to tiny; small stays.
    assert.deepEqual(doc.stats.commitSizes, { total: 6, tiny: 5, small: 1, medium: 0, large: 0, shares: { tiny: 83, small: 17, medium: 0, large: 0 } });
    assert.match(stdout.text, /Sizes +83% tiny · 17% small · 0% medium · 0% large/);
  });

  test('multi-repo: a lockfile / dist at a repo root is ignored (repo-prefixed paths); --lang tr labels', async () => {
    const stdout = capture();
    const code = await run([app, lib, '--out', out('multi'), '--no-png', '--no-color', '--json', '--lang', 'tr'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('multi'), 'stats.json'), 'utf8'));
    // app: 3 tiny, 1 small, 1 medium, 1 large; lib: lock (tiny), dist + 1 (tiny), engine 600 (large).
    assert.deepEqual(doc.stats.commitSizes, { total: 9, tiny: 5, small: 1, medium: 1, large: 2, shares: { tiny: 56, small: 11, medium: 11, large: 22 } });
    const svg = totalsSvg(out('multi'));
    // The multi-repo totals card has no spare room, so the (purely additive) bar is left out.
    for (const t of ['>Minik<', '>Büyük<', 'BOYUTLARI']) assert.ok(!svg.includes(t), `tr totals card leaves out ${t}`);
    assert.doesNotMatch(svg, />Tiny<|>Large</);
    assert.match(stdout.text, /\n {2}Boyutlar +%56 minik · %11 küçük · %11 orta · %22 büyük\n/);
  });

  test('a repo of only empty and lockfile-only commits: every commit tiny → 100% tiny', async () => {
    const dir = join(root, 'empty');
    makeRepo(dir, [
      { date: '2025-01-01T10:00:00+00:00', msg: 'empty one' },
      { date: '2025-01-02T10:00:00+00:00', msg: 'lock only', files: { 'pnpm-lock.yaml': lines(3000) } },
    ]);
    const stdout = capture();
    assert.equal(await run([dir, '--out', out('empty'), '--no-png', '--no-color', '--json'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' }), 0);
    const doc = JSON.parse(readFileSync(join(out('empty'), 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.commitSizes, { total: 2, tiny: 2, small: 0, medium: 0, large: 0, shares: { tiny: 100, small: 0, medium: 0, large: 0 } });
    assert.match(stdout.text, /Sizes +100% tiny · 0% small · 0% medium · 0% large/);
  });
});
