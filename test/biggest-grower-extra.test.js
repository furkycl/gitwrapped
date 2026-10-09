// Edge cases for stats.biggestGrower (src/stats/grower.js): a brute-force reference on many
// seeded random histories (merges by parents and by subject, repo labels, ignored paths,
// binary files, malformed counts, duplicate paths in a commit, negative / zero nets, ties),
// the hot-files card row never changing any other row (random histories, en / tr), the
// recap and wrapped.md agreeing with stats.json, and the CLI on real git repos (--json,
// --since / --until, --author, --exclude, multi-repo labels, --lang tr, the null case).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBiggestGrower, computeStats, isIgnoredPath, repoRelativePath, shownBiggestGrower } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { scrubEmails } from '../src/privacy.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(6, '0')}beef0123456789abcdef0123456789abcd`;
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
const f = (path, added = 1, removed = 0, binary = false) => ({ path, added, removed, binary });
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const rowOf = (spec, L = en) => (spec?.lines ?? []).find((r) => typeof r?.label === 'string' && (r.label === L.hotFiles.grower || r.label.startsWith(`${L.hotFiles.growerLabelShort}: `)));

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

/** Independent reference: per-path sums over non-merge commits, then the largest net > 0, ties by path. */
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
      s.added += lineCount(file.added);
      s.removed += lineCount(file.removed);
      sums.set(file.path, s);
    }
  }
  const ranked = [...sums.entries()]
    .map(([path, s]) => ({ path, net: s.added - s.removed, added: s.added, removed: s.removed }))
    .filter((x) => x.net > 0)
    .sort((a, b) => b.net - a.net || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ranked.length ? { ...ranked[0], path: scrubEmails(ranked[0].path) } : null;
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
      if (path.endsWith('.png')) return f(shown, 0, 0, true);
      const r = rand();
      // Mostly small counts so ties and zero / negative nets are common; sometimes junk.
      const cnt = () => (r < 0.05 ? pick([NaN, -3, Infinity, '7', undefined]) : Math.floor(rand() * 8));
      return f(shown, cnt(), cnt());
    });
    // A path listed twice in one commit: both counts are summed.
    if (files.length && rand() < 0.15) files.push({ ...files[0] });
    if (rand() < 0.1) files.push(null, { path: 7, added: 99 });
    const kind = rand();
    let extra = repo ? { repo } : {};
    if (kind < 0.12) extra = { ...extra, parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` };
    else if (kind < 0.18) {
      // No parents array: merge-ness from the subject.
      extra = { ...extra, parents: undefined, subject: pick(["Merge branch 'y'", 'Merge pull request #4 from x/y', 'fix: merge sort', 'Merged stuff']) };
    }
    commits.push(commit(i + 1, files, extra));
  }
  if (rand() < 0.05) commits.push(null, 3, 'x', { files: 5 });
  return commits;
}

describe('computeBiggestGrower vs a brute-force reference', () => {
  test('600 seeded random histories (single repo)', () => {
    const rand = mulberry32(0xb16);
    let nulls = 0;
    let found = 0;
    for (let round = 0; round < 600; round++) {
      const commits = randomHistory(rand);
      const want = reference(commits);
      assert.deepEqual(computeBiggestGrower(commits), want, `round ${round}: ${JSON.stringify(commits)}`);
      if (want === null) nulls += 1;
      else found += 1;
    }
    // The generator really exercises both the null and non-null branches.
    assert.ok(nulls > 20 && found > 100, `nulls ${nulls}, non-null ${found}`);
  });

  test('400 seeded random multi-repo histories (labels, ignore rules at each repo root)', () => {
    const rand = mulberry32(0x5eed);
    for (let round = 0; round < 400; round++) {
      const commits = randomHistory(rand, { repos: true });
      assert.deepEqual(computeBiggestGrower(commits), reference(commits), `round ${round}`);
    }
  });

  test('random --exclude patterns: the same as the reference on the excluded history', () => {
    const rand = mulberry32(42);
    const patterns = [['docs/'], ['*.js'], ['src/a.js'], ['README.md', 'lib/'], ['*.md', '*.ts'], ['api/'], ['src/']];
    for (let round = 0; round < 200; round++) {
      const commits = randomHistory(rand, { repos: rand() < 0.5 });
      const ex = excludeFiles(commits.filter((c) => c && typeof c === 'object'), compileExcludes(patterns[round % patterns.length]));
      assert.deepEqual(computeBiggestGrower(ex), reference(ex), `round ${round}`);
    }
  });

  test('result invariants: net = added − removed > 0, whole numbers, and shownBiggestGrower keeps it as is', () => {
    const rand = mulberry32(7);
    for (let round = 0; round < 300; round++) {
      const g = computeBiggestGrower(randomHistory(rand));
      if (!g) continue;
      assert.deepEqual(Object.keys(g), ['path', 'net', 'added', 'removed']);
      assert.equal(g.net, g.added - g.removed);
      assert.ok(g.net > 0 && Number.isInteger(g.net) && Number.isInteger(g.added) && Number.isInteger(g.removed));
      assert.ok(!/@/.test(g.path));
      assert.deepEqual(shownBiggestGrower(g), g);
    }
  });

  test('tie on net: the code-unit-first path wins regardless of input order or magnitudes', () => {
    const a = [commit(1, [f('src/b.js', 100, 90)]), commit(2, [f('src/a.js', 10, 0)]), commit(3, [f('Z.js', 15, 5)])];
    assert.equal(computeBiggestGrower(a).path, 'Z.js');
    assert.equal(computeBiggestGrower([...a].reverse()).path, 'Z.js');
    assert.deepEqual(computeBiggestGrower(a), { path: 'Z.js', net: 10, added: 15, removed: 5 });
  });

  test('net is summed across commits: a file that shrank then grew back nets its total', () => {
    const commits = [commit(1, [f('a.js', 50, 0), f('b.js', 10, 0)]), commit(2, [f('a.js', 0, 45)]), commit(3, [f('a.js', 4, 0)])];
    assert.deepEqual(computeBiggestGrower(commits), { path: 'b.js', net: 10, added: 10, removed: 0 });
  });

  test('a subject-only merge (no parents) is skipped; a "Merged ..." subject is not a merge', () => {
    assert.equal(computeBiggestGrower([{ subject: "Merge branch 'x' into main", files: [f('a.js', 5, 0)] }]), null);
    assert.equal(computeBiggestGrower([{ subject: 'Merged it', files: [f('a.js', 5, 0)] }]).path, 'a.js');
    // A parents array decides over the subject.
    assert.equal(computeBiggestGrower([{ parents: ['p'], subject: "Merge branch 'x'", files: [f('a.js', 5, 0)] }]).path, 'a.js');
  });

  test('non-array files never throw (fileTouches)', () => {
    for (const files of [5, 'ab', { path: 'a.js' }, true]) assert.equal(computeBiggestGrower([{ files }]), null, JSON.stringify(files));
  });
});

describe('the hot-files card row never changes another row', () => {
  test('random histories, en and tr: only hot-files differs, by the grower row appended last', () => {
    const rand = mulberry32(0xcafe);
    let shown = 0;
    let hidden = 0;
    for (let round = 0; round < 60; round++) {
      const commits = randomHistory(rand).filter((c) => c && typeof c === 'object' && Array.isArray(c.files));
      // The shrinker row may follow the grower row; leave it out so only the grower differs.
      const s = { ...statsOf(commits), biggestShrinker: null };
      const without = { ...s, biggestGrower: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const a = buildCardSpecs(s, cardOpts(lang));
        const b = buildCardSpecs(without, cardOpts(lang));
        assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
        for (const [i, { id, spec }] of a.entries()) {
          const base = b[i].spec;
          if (id !== 'hot-files') {
            assert.deepEqual(spec, base, `${round} ${lang} ${id}`);
            continue;
          }
          const row = rowOf(spec, L);
          if (!row) {
            hidden += 1;
            assert.deepEqual(spec, base, `${round} ${lang}`);
            continue;
          }
          shown += 1;
          assert.equal(spec.lines.at(-1), row);
          assert.deepEqual(spec.lines.slice(0, -1), base.lines ?? []);
          assert.deepEqual({ ...spec, lines: undefined }, { ...base, lines: undefined });
          const g = shownBiggestGrower(s.biggestGrower);
          assert.ok(g);
          assert.ok(row.value.endsWith(`+${L.num(g.net)}`), row.value);
          assert.ok(row.description.includes(g.path));
        }
        // Card SVGs other than hot-files are byte-identical.
        const sa = buildCards(s, cardOpts(lang));
        const sb = buildCards(without, cardOpts(lang));
        for (const [i, c] of sa.entries()) if (c.id !== 'hot-files') assert.equal(c.svg, sb[i].svg, `${round} ${lang} ${c.id}`);
      }
    }
    assert.ok(shown > 0, `row shown ${shown}, not shown ${hidden}`);
  });
});

describe('recap, wrapped.md and stats.json agree', () => {
  test('random histories: all three name the same file and numbers (en and tr)', () => {
    const rand = mulberry32(99);
    for (let round = 0; round < 80; round++) {
      const commits = randomHistory(rand).filter((c) => c && typeof c === 'object' && Array.isArray(c.files));
      const s = statsOf(commits);
      const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
      assert.deepEqual(doc.stats.biggestGrower, s.biggestGrower === null ? null : { ...s.biggestGrower });
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const recap = formatSummary(s, { repoName: 'demo', today: TODAY, lang });
        const md = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang });
        const g = s.biggestGrower;
        if (!g) {
          assert.ok(!recap.includes(`  ${L.recap.grower}`), recap);
          assert.ok(!md.includes(`**${L.markdown.grower}:**`));
          continue;
        }
        const detail = L.recap.growerDetail(g.net, g.added, g.removed);
        assert.ok(recap.includes(`${g.path} (${detail})`), `${lang}\n${recap}`);
        assert.ok(md.includes(`(${detail})`) && md.includes(`**${L.markdown.grower}:**`), md);
      }
    }
  });

  test('recap shortens a very long path from the start; wrapped.md keeps it whole', () => {
    const long = `src/${'deep/'.repeat(12)}file.js`;
    const s = { ...statsOf([commit(1, [f('src/a.js', 3, 0)]), commit(2, [f('src/a.js', 1, 0)])]), biggestGrower: { path: long, net: 5, added: 5, removed: 0 } };
    const recap = formatSummary(s, { repoName: 'demo', today: TODAY });
    const line = recap.split('\n').find((l) => l.includes('Top grower'));
    assert.match(line, /….*file\.js \(\+5 lines\)/);
    assert.ok(!line.includes(long));
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY }).includes(long));
  });

  test('singular / plural and thousands separators in both languages', () => {
    assert.equal(en.recap.growerDetail(1, 1, 0), '+1 line');
    assert.equal(en.recap.growerDetail(1234, 1500, 266), '+1,500 / −266, net +1,234 lines');
    assert.equal(tr.recap.growerDetail(1234, 1500, 266), `+${tr.num(1500)} / −266, net +${tr.num(1234)} satır`);
    assert.equal(en.hotFiles.growerValue('a.js', 1234567), 'a.js · +1,234,567');
  });
});

describe('biggest grower: CLI on real git repos', () => {
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
    tmp = mkdtempSync(join(tmpdir(), 'gw-grower-extra-'));
    main = init('main');
    // Feb (Ada): feb.js +40, then −10.
    write(main, 'src/feb.js', lines(40));
    commitAll(main, 'feat: feb 1', '2026-02-02');
    write(main, 'src/feb.js', lines(30));
    commitAll(main, 'feat: feb 2', '2026-02-10');
    // Mar 2 (Ada): a.js +25, yarn.lock +900 (ignored), a binary.
    write(main, 'src/a.js', lines(25));
    write(main, 'yarn.lock', lines(900));
    writeFileSync(join(main, 'logo.png'), Buffer.from([0, 1, 2, 0, 255, 0, 3, 0]));
    commitAll(main, 'feat: mar a', '2026-03-02');
    // Mar 3 (Bob): bob.js +60, feb.js deleted (−30).
    write(main, 'src/bob.js', lines(60));
    rmSync(join(main, 'src/feb.js'));
    commitAll(main, 'feat: bob', '2026-03-03', bob);
    // Mar 4 (Ada): a.js grows to 35 (+10), dist/ build output (ignored).
    write(main, 'src/a.js', lines(35));
    write(main, 'dist/bundle.js', lines(5000));
    commitAll(main, 'feat: mar a 2', '2026-03-04');
    // Side branch (Ada) side.js +20, merged --no-ff (the merge commit itself never counts).
    git(main, ['checkout', '-q', '-b', 'side']);
    write(main, 'src/side.js', lines(20));
    commitAll(main, 'feat: side', '2026-03-05');
    git(main, ['checkout', '-q', 'main']);
    git(main, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-06'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('whole history: Bob\'s bob.js (+60); lockfile, dist and binary never count; recap and wrapped.md agree', () => {
    const { r, doc, md } = run([main], 'all');
    assert.deepEqual(doc.stats.biggestGrower, { path: 'src/bob.js', net: 60, added: 60, removed: 0 });
    assert.match(r.stdout, /Top grower\s+src\/bob\.js \(\+60 lines\)/);
    assert.match(md, /- \*\*Biggest grower:\*\* src\/bob\.js \(\+60 lines\)/);
  });

  test('--since / --until windows', () => {
    const feb = run([main, '--since', '2026-02-01', '--until', '2026-02-28'], 'feb');
    assert.deepEqual(feb.doc.stats.biggestGrower, { path: 'src/feb.js', net: 30, added: 40, removed: 10 });
    assert.match(feb.r.stdout, /Top grower\s+src\/feb\.js \(\+40 \/ −10, net \+30 lines\)/);
    // Only Feb 10 (feb.js −10): nothing grew.
    const shrink = run([main, '--since', '2026-02-10', '--until', '2026-02-10'], 'shrink');
    assert.equal(shrink.doc.stats.biggestGrower, null);
    assert.ok('biggestGrower' in shrink.doc.stats);
    assert.doesNotMatch(shrink.r.stdout, /Top grower/);
    assert.doesNotMatch(shrink.md, /Biggest grower/);
    // Mar 4 – Mar 6: a.js +10 vs side.js +20 (through its own commit; the merge adds nothing).
    const late = run([main, '--since', '2026-03-04', '--until', '2026-03-06'], 'late');
    assert.deepEqual(late.doc.stats.biggestGrower, { path: 'src/side.js', net: 20, added: 20, removed: 0 });
    // Only the merge day: the merge commit never counts.
    const mergeDay = run([main, '--since', '2026-03-06', '--until', '2026-03-06'], 'merge-day');
    assert.equal(mergeDay.doc.stats.biggestGrower, null);
  });

  test('--author: only that author\'s commits count', () => {
    const ada = run([main, '--author', 'ada@example.com'], 'ada');
    // Ada: feb.js 40−10 = 30, a.js 35, side.js 20 → a.js.
    assert.deepEqual(ada.doc.stats.biggestGrower, { path: 'src/a.js', net: 35, added: 35, removed: 0 });
    const b = run([main, '--author', 'bob@example.com'], 'bob');
    assert.deepEqual(b.doc.stats.biggestGrower, { path: 'src/bob.js', net: 60, added: 60, removed: 0 });
  });

  test('--exclude, then --lang tr wording in recap and wrapped.md', () => {
    const x = run([main, '--exclude', 'bob.js', '--lang', 'tr'], 'tr');
    assert.deepEqual(x.doc.stats.biggestGrower, { path: 'src/a.js', net: 35, added: 35, removed: 0 });
    assert.match(x.r.stdout, /En çok büyüyen\s+src\/a\.js \(\+35 satır\)/);
    assert.match(x.md, /- \*\*En çok büyüyen dosya:\*\* src\/a\.js \(\+35 satır\)/);
    const none = run([main, '--exclude', '*.js'], 'none');
    assert.equal(none.doc.stats.biggestGrower, null);
  });

  test('multi-repo: repo-labelled paths, same path in two repos kept apart, dist/ ignored at each repo root', () => {
    const api = init('api');
    const web = init('web');
    write(api, 'src/x.js', lines(30));
    write(api, 'dist/big.js', lines(999));
    commitAll(api, 'feat: api', '2026-03-02');
    write(web, 'src/x.js', lines(25));
    commitAll(web, 'feat: web', '2026-03-03');
    write(web, 'src/y.js', lines(40));
    commitAll(web, 'feat: web y', '2026-03-04');
    // As one path api+web src/x.js would be 55; apart, web/src/y.js (40) wins.
    const { r, doc, md } = run([api, web], 'multi');
    assert.deepEqual(doc.stats.biggestGrower, { path: 'web/src/y.js', net: 40, added: 40, removed: 0 });
    assert.match(r.stdout, /Top grower\s+web\/src\/y\.js \(\+40 lines\)/);
    assert.match(md, /Biggest grower:\*\* web\/src\/y\.js/);
    // A labelled --exclude drops it: then api/src/x.js (30) beats web/src/x.js (25).
    const x = run([api, web, '--exclude', 'web/src/y.js'], 'multi-x');
    assert.deepEqual(x.doc.stats.biggestGrower, { path: 'api/src/x.js', net: 30, added: 30, removed: 0 });
  });

  test('tie on a real repo: the path that sorts first', () => {
    const dir = init('tie');
    write(dir, 'src/b.js', lines(12));
    write(dir, 'src/a.js', lines(12));
    write(dir, 'src/c.js', lines(11));
    commitAll(dir, 'feat: tie', '2026-03-02');
    assert.deepEqual(run([dir], 'tie').doc.stats.biggestGrower, { path: 'src/a.js', net: 12, added: 12, removed: 0 });
  });
});
