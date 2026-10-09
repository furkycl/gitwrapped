// Edge cases for stats.biggestShrinker (src/stats/shrinker.js): a brute-force reference on
// many seeded random histories (merges by parents and by subject, repo labels, ignored paths,
// binary files, malformed counts, duplicate paths in a commit, positive / zero nets, ties),
// grower and shrinker side by side (stats, card rows, recap, wrapped.md), and the CLI on real
// git repos (--json, --since / --until, --author, --exclude, a deleted file, multi-repo
// labels, --lang tr, the null case).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBiggestGrower, computeBiggestShrinker, computeStats, isIgnoredPath, repoRelativePath, shownBiggestShrinker } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { scrubEmails } from '../src/privacy.js';
import { compileExcludes } from '../src/glob.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(6, '0')}feed0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files,
  parents: ['p'],
  ...extra,
});
const f = (path, added = 0, removed = 1, binary = false) => ({ path, added, removed, binary });
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const isRow = (r, H, short) => typeof r?.label === 'string' && (r.label === H || r.label.startsWith(`${short}: `));
const shrinkerRowOf = (spec, L = en) => (spec?.lines ?? []).find((r) => isRow(r, L.hotFiles.shrinker, L.hotFiles.shrinkerLabelShort));
const growerRowOf = (spec, L = en) => (spec?.lines ?? []).find((r) => isRow(r, L.hotFiles.grower, L.hotFiles.growerLabelShort));

/** mulberry32: a small, well-mixed 32-bit PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent reference: per-path sums over non-merge commits, then the largest loss (removed − added) > 0, ties by path. */
function reference(commits) {
  const MERGE_SUBJECT = /^Merge (?:(?:branch|branches|pull request|remote-tracking branch|tag|commit)\b|(['"]).+?\1 into\b)/;
  const lineCount = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  const sums = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const isMerge = Array.isArray(c.parents) ? c.parents.length > 1 : typeof c.subject === 'string' && MERGE_SUBJECT.test(c.subject.trim());
    if (isMerge) continue;
    for (const file of Array.isArray(c.files) ? c.files : []) {
      if (!file || typeof file.path !== 'string') continue;
      if (isIgnoredPath(repoRelativePath(c, file.path))) continue;
      const s = sums.get(file.path) ?? { added: 0, removed: 0 };
      // A binary file adds 0 either way (git reports '-' counts; the reader gives 0).
      if (!file.binary) {
        s.added += lineCount(file.added);
        s.removed += lineCount(file.removed);
      }
      sums.set(file.path, s);
    }
  }
  let best = null;
  for (const [path, s] of sums) {
    const net = s.removed - s.added;
    if (net <= 0) continue;
    if (!best || net > best.net || (net === best.net && path < best.path)) best = { path, net, added: s.added, removed: s.removed };
  }
  return best ? { ...best, path: scrubEmails(best.path) } : null;
}

const POOL = [
  'src/a.js', 'src/b.js', 'src/B.js', 'lib/c.ts', 'README.md', 'docs/guide.md', 'test/t.test.js',
  'package-lock.json', 'yarn.lock', 'dist/x.js', 'src/dist/y.js', 'vendor/v.go', 'src/vendor/w.go',
  'packages/p/dist/z.js', 'packages/p/src/q.js', 'web/app.min.js', 'node_modules/m/i.js',
  'img/logo.png', 'keys/ada@example.com.pub', 'a/__snapshots__/s.snap',
];

function randomHistory(rand, { repos = false } = {}) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const n = Math.floor(rand() * 14);
  const commits = [];
  for (let i = 0; i < n; i++) {
    const repo = repos ? pick(['api', 'web']) : undefined;
    const files = Array.from({ length: Math.floor(rand() * 5) }, () => {
      const path = pick(POOL);
      const shown = repo ? `${repo}/${path}` : path;
      // Binary: the reader gives 0 / 0.
      if (path.endsWith('.png')) return f(shown, 0, 0, true);
      const r = rand();
      const cnt = () => (r < 0.05 ? pick([NaN, -3, Infinity, '7', undefined]) : Math.floor(rand() * 8));
      return f(shown, cnt(), cnt());
    });
    if (files.length && rand() < 0.15) files.push({ ...files[0] });
    if (rand() < 0.1) files.push(null, { path: 7, removed: 99 });
    const kind = rand();
    let extra = repo ? { repo } : {};
    if (kind < 0.12) extra = { ...extra, parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` };
    else if (kind < 0.18) {
      extra = { ...extra, parents: undefined, subject: pick(["Merge branch 'y'", 'Merge pull request #4 from x/y', 'fix: merge sort', 'Merged stuff']) };
    }
    commits.push(commit(i + 1, files, extra));
  }
  if (rand() < 0.05) commits.push(null, 3, 'x', { files: 5 });
  return commits;
}

describe('computeBiggestShrinker vs a brute-force reference', () => {
  test('800 seeded random histories (single repo)', () => {
    const rand = mulberry32(0x5b1);
    let nulls = 0;
    let found = 0;
    for (let round = 0; round < 800; round++) {
      const commits = randomHistory(rand);
      const want = reference(commits);
      assert.deepEqual(computeBiggestShrinker(commits), want, `round ${round}: ${JSON.stringify(commits)}`);
      if (want === null) nulls += 1;
      else found += 1;
    }
    assert.ok(nulls > 20 && found > 100, `nulls ${nulls}, non-null ${found}`);
  });

  test('500 seeded random multi-repo histories (labels, ignore rules at each repo root)', () => {
    const rand = mulberry32(0xd00d);
    for (let round = 0; round < 500; round++) {
      const commits = randomHistory(rand, { repos: true });
      assert.deepEqual(computeBiggestShrinker(commits), reference(commits), `round ${round}`);
    }
  });

  test('random --exclude patterns: the same as the reference on the excluded history', () => {
    const rand = mulberry32(4242);
    const patterns = [['docs/'], ['*.js'], ['src/a.js'], ['README.md', 'lib/'], ['*.md', '*.ts'], ['api/'], ['src/']];
    for (let round = 0; round < 250; round++) {
      const commits = randomHistory(rand, { repos: rand() < 0.5 });
      const ex = excludeFiles(commits.filter((c) => c && typeof c === 'object'), compileExcludes(patterns[round % patterns.length]));
      assert.deepEqual(computeBiggestShrinker(ex), reference(ex), `round ${round}`);
    }
  });

  test('mirror property: negating every count swaps grower and shrinker (non-junk histories)', () => {
    const rand = mulberry32(31337);
    let checked = 0;
    for (let round = 0; round < 300; round++) {
      const commits = randomHistory(rand).filter((c) => c && typeof c === 'object' && Array.isArray(c.files));
      const clean = commits.map((c) => ({ ...c, files: c.files.filter((x) => x && typeof x.path === 'string' && Number.isFinite(x.added) && x.added >= 0 && Number.isFinite(x.removed) && x.removed >= 0) }));
      const swapped = clean.map((c) => ({ ...c, files: c.files.map((x) => ({ ...x, added: x.removed, removed: x.added })) }));
      const g = computeBiggestGrower(swapped);
      const s = computeBiggestShrinker(clean);
      assert.deepEqual(s, g === null ? null : { ...g, added: g.removed, removed: g.added }, `round ${round}`);
      if (s) checked += 1;
    }
    assert.ok(checked > 50, `${checked}`);
  });

  test('result invariants: net = removed − added > 0, whole numbers, scrubbed, shownBiggestShrinker keeps it', () => {
    const rand = mulberry32(8);
    for (let round = 0; round < 300; round++) {
      const s = computeBiggestShrinker(randomHistory(rand));
      if (!s) continue;
      assert.deepEqual(Object.keys(s), ['path', 'net', 'added', 'removed']);
      assert.equal(s.net, s.removed - s.added);
      assert.ok(s.net > 0 && Number.isInteger(s.net) && Number.isInteger(s.added) && Number.isInteger(s.removed));
      assert.ok(!/@/.test(s.path));
      assert.deepEqual(shownBiggestShrinker(s), s);
    }
  });

  test('tie on net: the code-unit-first path wins regardless of input order or magnitudes', () => {
    const a = [commit(1, [f('src/b.js', 90, 100)]), commit(2, [f('src/a.js', 0, 10)]), commit(3, [f('Z.js', 5, 15)])];
    assert.deepEqual(computeBiggestShrinker(a), { path: 'Z.js', net: 10, added: 5, removed: 15 });
    assert.deepEqual(computeBiggestShrinker([...a].reverse()), { path: 'Z.js', net: 10, added: 5, removed: 15 });
  });

  test('a deleted file loses all its lines; a file deleted then re-added nets the difference', () => {
    // Created before the window: inside the window only the deletion is seen.
    assert.deepEqual(computeBiggestShrinker([commit(1, [f('old.js', 0, 120)]), commit(2, [f('b.js', 0, 30)])]), { path: 'old.js', net: 120, added: 0, removed: 120 });
    assert.deepEqual(computeBiggestShrinker([commit(1, [f('old.js', 0, 120)]), commit(2, [f('old.js', 100, 0), f('b.js', 0, 30)])]), { path: 'b.js', net: 30, added: 0, removed: 30 });
  });

  test('merges never count, whether by parents or by subject; "Merged ..." is not a merge', () => {
    assert.equal(computeBiggestShrinker([commit(1, [f('a.js', 0, 50)], { parents: ['x', 'y'] })]), null);
    assert.equal(computeBiggestShrinker([{ subject: "Merge branch 'x' into main", files: [f('a.js', 0, 5)] }]), null);
    assert.equal(computeBiggestShrinker([{ subject: 'Merged it', files: [f('a.js', 0, 5)] }]).path, 'a.js');
    assert.equal(computeBiggestShrinker([{ parents: ['p'], subject: "Merge branch 'x'", files: [f('a.js', 0, 5)] }]).path, 'a.js');
    // A merge's files never offset a non-merge loss either.
    assert.deepEqual(computeBiggestShrinker([commit(1, [f('a.js', 0, 9)]), commit(2, [f('a.js', 50, 0)], { parents: ['x', 'y'] })]), { path: 'a.js', net: 9, added: 0, removed: 9 });
  });

  test('a binary file never shrinks; ignored paths never win', () => {
    assert.equal(computeBiggestShrinker([commit(1, [f('img/a.png', 0, 0, true), f('yarn.lock', 0, 5000), f('dist/x.js', 0, 900)])]), null);
  });
});

describe('grower and shrinker coexist', () => {
  const commits = () => [
    commit(1, [f('src/grow.js', 40, 0), f('src/old.js', 1, 30), f('src/x.js', 1, 1)]),
    commit(2, [f('src/grow.js', 5, 1), f('src/old.js', 0, 6), f('src/x.js', 1, 1)]),
  ];

  test('stats carry both, as distinct files', () => {
    const s = statsOf(commits());
    assert.deepEqual(s.biggestGrower, { path: 'src/grow.js', net: 44, added: 45, removed: 1 });
    assert.deepEqual(s.biggestShrinker, { path: 'src/old.js', net: 35, added: 1, removed: 36 });
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.biggestShrinker, s.biggestShrinker);
    assert.deepEqual(doc.stats.biggestGrower, s.biggestGrower);
  });

  test('recap and wrapped.md show grower then shrinker (en and tr)', () => {
    const s = statsOf(commits());
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang });
      const md = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang });
      const gi = recap.indexOf(L.recap.grower);
      const si = recap.indexOf(L.recap.shrinker);
      assert.ok(gi >= 0 && si > gi, `${lang}\n${recap}`);
      assert.ok(recap.includes(`src/old.js (${L.recap.shrinkerDetail(35, 1, 36)})`), recap);
      const gm = md.indexOf(`**${L.markdown.grower}:**`);
      const sm = md.indexOf(`**${L.markdown.shrinker}:** src/old.js (${L.recap.shrinkerDetail(35, 1, 36)})`);
      assert.ok(gm >= 0 && sm > gm, md);
    }
    assert.equal(en.recap.shrinkerDetail(35, 1, 36), '−36 / +1, net −35 lines');
    assert.equal(en.recap.shrinkerDetail(1, 0, 1), '−1 line');
    assert.equal(tr.recap.shrinkerDetail(45, 0, 45), '−45 satır');
  });

  test('the card: when both rows show, grower comes before shrinker, shrinker last', () => {
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const spec = buildCardSpecs(statsOf(commits()), cardOpts(lang)).find((c) => c.id === 'hot-files').spec;
      const g = growerRowOf(spec, L);
      const s = shrinkerRowOf(spec, L);
      assert.ok(s, `${lang}: ${JSON.stringify(spec.lines)}`);
      assert.equal(spec.lines.at(-1), s);
      if (g) assert.ok(spec.lines.indexOf(g) < spec.lines.indexOf(s));
      assert.ok(s.value.endsWith(`−${L.num(35)}`), s.value);
      assert.ok(s.description.includes('src/old.js'));
    }
  });

  test('random histories: removing the shrinker only drops its row from the hot-files card', () => {
    const rand = mulberry32(0xabc);
    let shown = 0;
    for (let round = 0; round < 50; round++) {
      const hist = randomHistory(rand).filter((c) => c && typeof c === 'object' && Array.isArray(c.files));
      const s = statsOf(hist);
      const a = buildCardSpecs(s, cardOpts('en'));
      const b = buildCardSpecs({ ...s, biggestShrinker: null }, cardOpts('en'));
      for (const [i, { id, spec }] of a.entries()) {
        if (id !== 'hot-files') {
          assert.deepEqual(spec, b[i].spec, `${round} ${id}`);
          continue;
        }
        const row = shrinkerRowOf(spec);
        if (!row) {
          assert.deepEqual(spec, b[i].spec);
          continue;
        }
        shown += 1;
        assert.equal(spec.lines.at(-1), row);
        assert.deepEqual(spec.lines.slice(0, -1), b[i].spec.lines ?? []);
      }
    }
    assert.ok(shown > 0);
  });
});

describe('biggest shrinker: CLI on real git repos', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const bob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' };
  const lines = (n, tag = '') => Array.from({ length: n }, (_, i) => `line ${tag}${i}`).join('\n') + (n ? '\n' : '');
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const init = (name) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };
  const commitAll = (dir, msg, day, extra = {}) => {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', msg], { ...at(day), ...extra });
  };
  const run = (args, name) => {
    const out = join(tmp, `${name}-out`);
    const r = bin([...args, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return { r, doc: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')), md: readFileSync(join(out, 'wrapped.md'), 'utf8') };
  };

  let tmp;
  let main;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-shrinker-extra-'));
    main = init('main');
    // Jan 5 (Ada): the starting files, plus an ignored lockfile / build output and a binary.
    write(main, 'src/old.js', lines(80));
    write(main, 'src/dead.js', lines(45));
    write(main, 'src/legacy.js', lines(30));
    write(main, 'yarn.lock', lines(900));
    write(main, 'dist/bundle.js', lines(500));
    writeFileSync(join(main, 'logo.png'), Buffer.from([0, 1, 2, 0, 255, 0, 3, 0]));
    commitAll(main, 'feat: start', '2026-01-05');
    // Feb 10 (Ada): old.js 80 → 50 (−30).
    write(main, 'src/old.js', lines(50));
    commitAll(main, 'refactor: trim old', '2026-02-10');
    // Mar 3 (Bob): dead.js deleted (−45); the lockfile and dist/ deleted (ignored); the binary changed.
    rmSync(join(main, 'src/dead.js'));
    rmSync(join(main, 'yarn.lock'));
    rmSync(join(main, 'dist'), { recursive: true });
    writeFileSync(join(main, 'logo.png'), Buffer.from([9, 0, 8, 0, 7, 0]));
    commitAll(main, 'chore: remove dead', '2026-03-03', bob);
    // Mar 4 (Ada): grow.js +60; old.js 50 → 40 with one line changed (+1 / −11).
    write(main, 'src/grow.js', lines(60));
    write(main, 'src/old.js', lines(39) + 'changed\n');
    commitAll(main, 'feat: grow', '2026-03-04');
    // Side branch (Ada): legacy.js 30 → 5 (−25), merged --no-ff on Mar 6.
    git(main, ['checkout', '-q', '-b', 'side']);
    write(main, 'src/legacy.js', lines(5));
    commitAll(main, 'refactor: legacy', '2026-03-05');
    git(main, ['checkout', '-q', 'main']);
    git(main, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-06'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('March: the deleted dead.js loses all 45 lines and wins; grower coexists; recap and wrapped.md agree', () => {
    const { r, doc, md } = run([main, '--since', '2026-03-01'], 'mar');
    assert.deepEqual(doc.stats.biggestShrinker, { path: 'src/dead.js', net: 45, added: 0, removed: 45 });
    assert.deepEqual(doc.stats.biggestGrower, { path: 'src/grow.js', net: 60, added: 60, removed: 0 });
    assert.match(r.stdout, /Top shrinker\s+src\/dead\.js \(−45 lines\)/);
    assert.match(r.stdout, /Top grower\s+src\/grow\.js \(\+60 lines\)/);
    assert.ok(r.stdout.indexOf('Top grower') < r.stdout.indexOf('Top shrinker'));
    assert.match(md, /- \*\*Biggest shrinker:\*\* src\/dead\.js \(−45 lines\)/);
    assert.ok(md.indexOf('Biggest grower') < md.indexOf('Biggest shrinker'));
  });

  test('--lang tr wording in recap and wrapped.md', () => {
    const { r, md } = run([main, '--since', '2026-03-01', '--lang', 'tr'], 'tr');
    assert.match(r.stdout, /En çok küçülen\s+src\/dead\.js \(−45 satır\)/);
    assert.match(md, /- \*\*En çok küçülen dosya:\*\* src\/dead\.js \(−45 satır\)/);
  });

  test('--exclude drops the shrinker: the next file wins, with added lines shown; all excluded → null', () => {
    const a = run([main, '--since', '2026-03-01', '--exclude', 'src/dead.js'], 'x1');
    assert.deepEqual(a.doc.stats.biggestShrinker, { path: 'src/legacy.js', net: 25, added: 0, removed: 25 });
    const b = run([main, '--since', '2026-03-01', '--exclude', 'dead.js', '--exclude', 'legacy.js'], 'x2');
    assert.deepEqual(b.doc.stats.biggestShrinker, { path: 'src/old.js', net: 10, added: 1, removed: 11 });
    assert.match(b.r.stdout, /Top shrinker\s+src\/old\.js \(−11 \/ \+1, net −10 lines\)/);
    assert.match(b.md, /Biggest shrinker:\*\* src\/old\.js \(−11 \/ \+1, net −10 lines\)/);
    const none = run([main, '--since', '2026-03-01', '--exclude', 'src/'], 'x3');
    assert.equal(none.doc.stats.biggestShrinker, null);
    assert.ok('biggestShrinker' in none.doc.stats);
    assert.doesNotMatch(none.r.stdout, /Top shrinker/);
    assert.doesNotMatch(none.md, /Biggest shrinker/);
  });

  test('whole history: everything was created in the window, so nothing shrank (null)', () => {
    const { r, doc, md } = run([main], 'all');
    // old.js +81 −41, dead.js +45 −45, legacy.js +30 −25: no loss; lockfile / dist / binary never count.
    assert.equal(doc.stats.biggestShrinker, null);
    assert.doesNotMatch(r.stdout, /Top shrinker/);
    assert.doesNotMatch(md, /Biggest shrinker/);
  });

  test('--since / --until windows and --author', () => {
    const feb = run([main, '--since', '2026-02-01', '--until', '2026-02-28'], 'feb');
    assert.deepEqual(feb.doc.stats.biggestShrinker, { path: 'src/old.js', net: 30, added: 0, removed: 30 });
    // Only the merge day: the merge commit never counts.
    const mergeDay = run([main, '--since', '2026-03-06', '--until', '2026-03-06'], 'merge-day');
    assert.equal(mergeDay.doc.stats.biggestShrinker, null);
    const ada = run([main, '--since', '2026-03-01', '--author', 'ada@example.com'], 'ada');
    assert.deepEqual(ada.doc.stats.biggestShrinker, { path: 'src/legacy.js', net: 25, added: 0, removed: 25 });
    const b = run([main, '--author', 'bob@example.com'], 'bob');
    assert.deepEqual(b.doc.stats.biggestShrinker, { path: 'src/dead.js', net: 45, added: 0, removed: 45 });
  });

  test('multi-repo: labelled paths, the same path in two repos kept apart', () => {
    const api = init('api');
    const web = init('web');
    write(api, 'src/x.js', lines(40));
    commitAll(api, 'feat: api', '2026-01-02');
    write(api, 'src/x.js', lines(10));
    commitAll(api, 'refactor: api', '2026-03-02');
    write(web, 'src/x.js', lines(40));
    write(web, 'src/y.js', lines(50));
    commitAll(web, 'feat: web', '2026-01-03');
    write(web, 'src/x.js', lines(20));
    write(web, 'src/y.js', lines(15));
    commitAll(web, 'refactor: web', '2026-03-03');
    // Combined, src/x.js would lose 50; apart, web/src/y.js (35) wins over api/src/x.js (30).
    const { r, doc } = run([api, web, '--since', '2026-03-01'], 'multi');
    assert.deepEqual(doc.stats.biggestShrinker, { path: 'web/src/y.js', net: 35, added: 0, removed: 35 });
    assert.match(r.stdout, /Top shrinker\s+web\/src\/y\.js \(−35 lines\)/);
    const x = run([api, web, '--since', '2026-03-01', '--exclude', 'web/src/y.js'], 'multi-x');
    assert.deepEqual(x.doc.stats.biggestShrinker, { path: 'api/src/x.js', net: 30, added: 0, removed: 30 });
  });

  test('tie on a real repo: the path that sorts first', () => {
    const dir = init('tie');
    write(dir, 'src/b.js', lines(12));
    write(dir, 'src/a.js', lines(12));
    write(dir, 'src/c.js', lines(12));
    commitAll(dir, 'feat: tie', '2026-01-02');
    write(dir, 'src/b.js', lines(2));
    write(dir, 'src/a.js', lines(2));
    write(dir, 'src/c.js', lines(3));
    commitAll(dir, 'refactor: tie', '2026-03-02');
    assert.deepEqual(run([dir, '--since', '2026-03-01'], 'tie').doc.stats.biggestShrinker, { path: 'src/a.js', net: 10, added: 0, removed: 10 });
  });
});
