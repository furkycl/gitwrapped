import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBiggestGrower, computeHotFiles, computeStats, shownBiggestGrower } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added = 1, removed = 0, binary = false]) => ({ path, added, removed, binary })),
  parents: ['p'],
  ...extra,
});
const merge = (i, files = []) => commit(i, files, { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` });

// Two files, each touched twice: the hot-files card has room, and no one-touch row competes.
const roomy = () => [commit(1, [['src/a.js', 10, 1], ['src/b.js', 3, 0]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 1, 2]])];
// Many files across folders, a test file and a co-change pair: the hot-files card is full.
const crowded = () => Array.from({ length: 10 }, (_, i) => commit(i + 1, [['src/a.js', 5, 1], [`lib/f${i}.js`, 3, 0], ['test/x.test.js', 2, 0]]));

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts)).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isGrowerRow = (r, L = en) => typeof r?.label === 'string' && (r.label === L.hotFiles.grower || r.label.startsWith(`${L.hotFiles.growerLabelShort}: `));
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isGrowerRow(r, L));
const plain = (v) => (v ? { ...v } : v);

describe('computeBiggestGrower', () => {
  test('the file with the largest net growth (added − removed), summed per path', () => {
    const commits = [
      commit(1, [['src/a.js', 100, 0], ['src/b.js', 50, 0]]),
      commit(2, [['src/a.js', 0, 90], ['src/b.js', 20, 5]]),
      commit(3, [['src/c.js', 60, 40]]),
    ];
    // a: +100 −90 = 10; b: +70 −5 = 65; c: +60 −40 = 20.
    assert.deepEqual(computeBiggestGrower(commits), { path: 'src/b.js', net: 65, added: 70, removed: 5 });
  });

  test('ties go to the path that sorts first (code-unit order, so "B" before "a")', () => {
    const commits = [commit(1, [['src/z.js', 10, 0], ['src/a.js', 12, 2], ['src/B.js', 10, 0]])];
    assert.equal(computeBiggestGrower(commits).path, 'src/B.js');
    assert.equal(computeBiggestGrower([commit(1, [['b.js', 5, 0], ['a.js', 5, 0]])]).path, 'a.js');
  });

  test('null when no file grew: net 0 or less everywhere, no files, no commits', () => {
    assert.equal(computeBiggestGrower([commit(1, [['a.js', 5, 5], ['b.js', 1, 9]])]), null);
    assert.equal(computeBiggestGrower([commit(1, [])]), null);
    assert.equal(computeBiggestGrower([]), null);
    // A shrinking file never wins over a growing one, however many lines it removed.
    assert.equal(computeBiggestGrower([commit(1, [['a.js', 0, 900], ['b.js', 1, 0]])]).path, 'b.js');
  });

  test('merge commits never count, even with files', () => {
    const commits = [commit(1, [['src/a.js', 3, 0]]), merge(2, [['src/m.js', 500, 0]])];
    assert.deepEqual(computeBiggestGrower(commits), { path: 'src/a.js', net: 3, added: 3, removed: 0 });
    assert.equal(computeBiggestGrower([merge(1, [['src/m.js', 500, 0]])]), null);
    const bare = { hash: H(3), subject: "Merge branch 'x'", files: [{ path: 'src/m.js', added: 900, removed: 0 }] };
    assert.equal(computeBiggestGrower([commit(1, [['src/a.js', 3, 0]]), bare]).path, 'src/a.js');
  });

  test('ignored paths (lockfiles, build output, vendored, minified, snapshots) are left out, as for hot files', () => {
    const commits = [commit(1, [['src/a.js', 2, 0], ['package-lock.json', 9000, 0], ['dist/app.js', 800, 0], ['vendor/x.go', 700, 0], ['web/app.min.js', 600, 0], ['node_modules/x/i.js', 500, 0], ['__snapshots__/a.snap', 400, 0], ['yarn.lock', 300, 0]])];
    assert.equal(computeBiggestGrower(commits).path, 'src/a.js');
    assert.equal(computeBiggestGrower([commit(1, [['Cargo.lock', 10, 0]])]), null);
  });

  test('--exclude drops files first (excludeFiles)', () => {
    const commits = [commit(1, [['src/a.js', 5, 0], ['docs/big.md', 500, 0]])];
    assert.equal(computeBiggestGrower(commits).path, 'docs/big.md');
    assert.equal(computeBiggestGrower(excludeFiles(commits, compileExcludes(['docs/']))).path, 'src/a.js');
    assert.equal(computeBiggestGrower(excludeFiles(commits, compileExcludes(['*.js', 'docs/']))), null);
  });

  test('binary files add 0 lines (as for hot files)', () => {
    const commits = [commit(1, [['img/logo.png', 0, 0, true], ['src/a.js', 1, 0]]), commit(2, [['img/logo.png', 0, 0, true]])];
    assert.equal(computeBiggestGrower(commits).path, 'src/a.js');
    assert.equal(computeBiggestGrower([commit(1, [['img/logo.png', 0, 0, true]])]), null);
    // A malformed count adds 0 too.
    assert.equal(computeBiggestGrower([commit(1, [['a.js', NaN, 0], ['b.js', 'x', 0]])]), null);
  });

  test('multi-repo: the same path in two repos is two files; ignore rules apply at each repo root', () => {
    const commits = [
      commit(1, [['api/README.md', 10, 0], ['api/dist/x.js', 999, 0]], { repo: 'api' }),
      commit(2, [['web/README.md', 15, 0]], { repo: 'web' }),
      commit(3, [['web/src/a.js', 20, 0]], { repo: 'web' }),
    ];
    // api/README.md + web/README.md would be 25 as one path; apart, web/src/a.js wins.
    assert.deepEqual(computeBiggestGrower(commits), { path: 'web/src/a.js', net: 20, added: 20, removed: 0 });
  });

  test('renames as hot files see them (--no-renames): the new path gets every line', () => {
    const commits = [commit(1, [['src/old.js', 10, 0]]), commit(2, [['src/old.js', 0, 10], ['src/new.js', 10, 0]])];
    assert.deepEqual(computeBiggestGrower(commits), { path: 'src/new.js', net: 10, added: 10, removed: 0 });
  });

  test('agrees with hot files line totals (random histories)', () => {
    let seed = 11;
    const rand = (n) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const pool = ['src/a.js', 'src/b.js', 'lib/c.ts', 'README.md', 'package-lock.json', 'dist/x.js', 'docs/d.md', 'test/t.test.js'];
    for (let round = 0; round < 40; round++) {
      const commits = Array.from({ length: 1 + rand(12) }, (_, i) => {
        const files = Array.from({ length: rand(4) }, () => [pool[rand(pool.length)], rand(20), rand(20)]);
        return rand(6) === 0 ? merge(i + 1, files) : commit(i + 1, files);
      });
      const nonMerge = commits.filter((c) => c.parents.length < 2);
      const ref = computeHotFiles(nonMerge, { limit: 1000 })
        .map((f) => ({ path: f.path, net: f.linesAdded - f.linesRemoved, added: f.linesAdded, removed: f.linesRemoved }))
        .filter((f) => f.net > 0)
        .sort((a, b) => b.net - a.net || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      assert.deepEqual(computeBiggestGrower(commits), ref[0] ?? null);
    }
  });

  test('email-shaped text in the path is scrubbed', () => {
    assert.equal(computeBiggestGrower([commit(1, [['keys/ada@example.com.pub', 3, 0]])]).path, 'keys/…');
  });

  test('bad input never throws, never mutates', () => {
    for (const v of [null, undefined, 'x', 3, {}, [null, 3, 'x', { files: null }, { files: [null, { path: 3 }] }]]) assert.equal(computeBiggestGrower(v), null);
    const commits = roomy();
    const before = JSON.stringify(commits);
    computeBiggestGrower(commits);
    assert.equal(JSON.stringify(commits), before);
  });

  test('computeStats puts biggestGrower right after oneTouch; stats.json keeps exactly {path, net, added, removed} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('oneTouch') + 1], 'biggestGrower');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.biggestGrower, { path: 'src/a.js', net: 13, added: 15, removed: 2 });
    assert.deepEqual(Object.keys(doc.stats.biggestGrower), ['path', 'net', 'added', 'removed']);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo' })).stats.biggestGrower, null);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([commit(1, [['a.js', 1, 1]])]), repoName: 'demo' })).stats.biggestGrower, null);
  });
});

describe('shownBiggestGrower', () => {
  test('whole numbers, a non-empty scrubbed path; null without growth or a path', () => {
    assert.deepEqual(shownBiggestGrower({ path: 'a.js', net: 3, added: 5, removed: 2 }), { path: 'a.js', net: 3, added: 5, removed: 2 });
    assert.deepEqual(shownBiggestGrower({ path: 'x/ada@example.com', net: 2.6, added: 'x', removed: -1 }), { path: 'x/…', net: 3, added: 0, removed: 0 });
    for (const v of [null, undefined, 'x', 3, {}, { path: '', net: 3 }, { path: '  ', net: 3 }, { path: 'a.js', net: 0 }, { path: 'a.js', net: -4 }, { path: 'a.js', net: NaN }, { path: 3, net: 3 }]) {
      assert.equal(shownBiggestGrower(v), null, JSON.stringify(v));
    }
  });
});

describe('cards', () => {
  test('a "Biggest grower" row last on the hot-files card when there is room, en and tr', () => {
    const s = statsOf(roomy());
    const spec = specOf(s, 'hot-files');
    assert.deepEqual(spec.lines.at(-1), { label: 'Biggest grower', value: 'src/a.js · +13', description: 'src/a.js grew the most (+15 / −2, net +13 lines)' });
    assert.match(cardDescription(spec), /src\/a\.js grew the most \(\+15 \/ −2, net \+13 lines\)\./);
    const trSpec = specOf(s, 'hot-files', 'tr');
    assert.deepEqual(trSpec.lines.at(-1), { label: 'En çok büyüyen', value: 'src/a.js · +13', description: 'src/a.js en çok büyüyen dosya (+15 / −2, net +13 satır)' });
  });

  test('after the one-touch row when both fit', () => {
    const s = statsOf([commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 3, 0]])]);
    const labels = specOf(s, 'hot-files').lines.map((r) => r.label);
    assert.deepEqual(labels, ['One-touch files', 'Biggest grower']);
  });

  test('a long path is middle-elided, else just the file name; none when even that is cut', () => {
    const base = statsOf(roomy());
    const at = (path, net = 13) => rowOf(specOf({ ...base, biggestGrower: { path, net, added: net, removed: 0 } }, 'hot-files'));
    assert.equal(at('src/stats/x.js').value, 'src/stats/x.js · +13');
    assert.equal(at('a/bbbbbbbbbbbbbbbbbbbb/cc/dd/x.js').value, 'a/…/cc/dd/x.js · +13');
    assert.equal(at('a/bbbbbbbbbbbbbbbbbbbb/c/x.js').value, 'a/…/c/x.js · +13');
    // Too long for the value: the path moves into the label, middle-elided when needed.
    assert.deepEqual([at('src/stats/index.js', 1234).label, at('src/stats/index.js', 1234).value], ['Grower: src/stats/index.js', '+1,234']);
    assert.deepEqual([at('packages/core/src/lib/deep/x.js').label, at('packages/core/src/lib/deep/x.js').value], ['Grower: packages/…/deep/x.js', '+13']);
    // Else just the file name.
    assert.deepEqual([at('packages/core/src/lib/deep/a-longer-file-name.js').label, at('packages/core/src/lib/deep/a-longer-file-name.js').value], ['Grower: a-longer-file-name.js', '+13']);
    assert.equal(at('src/an-extremely-long-file-name-that-never-fits-anywhere-on-a-row-or-in-a-label-either-really.js'), undefined);
    assert.equal(at('a.js', 1234567).value, 'a.js · +1,234,567');
    // The hover text keeps the full path.
    assert.match(at('packages/core/src/lib/deep/x.js').description, /^packages\/core\/src\/lib\/deep\/x\.js grew the most/);
  });

  test('a realistic elided path really appears on the card, en and tr', () => {
    const base = statsOf(roomy());
    const path = 'src/cards/themes/stats/index.js';
    for (const [lang, L] of Object.entries(LANGS)) {
      const spec = specOf({ ...base, biggestGrower: { path, net: 5, added: 5, removed: 0 } }, 'hot-files', lang);
      const row = rowOf(spec, L);
      assert.deepEqual([row.label, row.value], [L.hotFiles.growerNamed('src/…/stats/index.js'), '+5'], lang);
      assert.ok(buildCards({ ...base, biggestGrower: { path, net: 5, added: 5, removed: 0 } }, cardOpts(lang)).find((c) => c.id === 'hot-files').svg.includes('src/…/stats/index.js'), lang);
    }
  });

  test('tr: a 6-digit net still gets a row (the short label)', () => {
    const base = statsOf(roomy());
    const spec = specOf({ ...base, biggestGrower: { path: 'index.js', net: 123456, added: 123456, removed: 0 } }, 'hot-files', 'tr');
    const row = rowOf(spec, tr);
    assert.ok(row);
    assert.deepEqual([row.label, row.value], ['Büyüyen: index.js', '+123.456']);
    const deep = specOf({ ...base, biggestGrower: { path: 'src/cards/index.js', net: 123456, added: 123456, removed: 0 } }, 'hot-files', 'tr');
    assert.ok(rowOf(deep, tr), 'a row for a longer path too');
  });

  test('never displaces anything: only the hot-files card changes, and it only gains the row', () => {
    const docsToo = [...roomy(), commit(3, [['README.md', 4, 0]])];
    const oneTouchToo = [commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 3, 0]])];
    const cases = [roomy(), crowded(), docsToo, oneTouchToo, [...roomy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]];
    let gained = 0;
    for (const commits of cases) {
      const s = statsOf(commits);
      const without = { ...s, biggestGrower: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        for (const theme of [{}, { colorTheme: 'mono' }]) {
          const a = svgs(s, lang, theme);
          const b = svgs(without, lang, theme);
          assert.deepEqual(a.map(([id]) => id), b.map(([id]) => id));
          for (const [i, [id, svg]] of a.entries()) {
            if (svg === b[i][1]) continue;
            assert.equal(id, 'hot-files');
            gained += 1;
            const spec = specOf(s, id, lang, theme);
            const base = specOf(without, id, lang, theme);
            const row = rowOf(spec, L);
            assert.ok(row, id);
            assert.equal(spec.lines.at(-1), row);
            assert.deepEqual(spec.lines.slice(0, -1), base.lines ?? []);
            const la = layoutCard({ ...spec, lang });
            const lb = layoutCard({ ...base, lang });
            assert.deepEqual(la.drawnCharts, lb.drawnCharts, id);
            assert.ok(la.shrinkSteps <= lb.shrinkSteps, id);
          }
        }
      }
    }
    assert.ok(gained > 0, 'the row shows somewhere');
  });

  test('no room: the crowded hot-files card is byte-identical', () => {
    const s = statsOf(crowded());
    assert.ok(s.biggestGrower);
    assert.equal(rowOf(specOf(s, 'hot-files')), undefined);
    assert.deepEqual(svgs(s), svgs({ ...s, biggestGrower: null }));
  });

  test('no row for null or a malformed value: cards byte-identical', () => {
    const s = statsOf(roomy());
    const without = svgs({ ...s, biggestGrower: null });
    for (const biggestGrower of [undefined, 'x', { path: 'a.js', net: 0 }, { path: '', net: 3 }, { net: 3 }]) {
      assert.deepEqual(svgs({ ...s, biggestGrower }), without, JSON.stringify(biggestGrower));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('no hot files: no row', () => {
    const s = { ...statsOf([]), biggestGrower: { path: 'a.js', net: 4, added: 4, removed: 0 } };
    for (const c of buildCardSpecs(s, cardOpts('en'))) assert.equal(rowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the one-touch line, en and tr; none without a grower', () => {
    const s = statsOf([commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 3, 0]])]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}One-touch.*\n {2}Top grower {3}src\/a\.js \(\+15 \/ −2, net \+13 lines\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}En çok büyüyen\s+src\/a\.js \(\+15 \/ −2, net \+13 satır\)\n/);
    // Nothing removed: just the lines added.
    assert.match(formatSummary({ ...s, biggestGrower: { path: 'a.js', net: 1, added: 1, removed: 0 } }, { repoName: 'demo', today: TODAY }), /Top grower\s+a\.js \(\+1 line\)\n/);
    for (const biggestGrower of [null, undefined, { path: 'a.js', net: 0 }]) {
      assert.doesNotMatch(formatSummary({ ...s, biggestGrower }, { repoName: 'demo', today: TODAY }), /Top grower/);
    }
  });

  test('wrapped.md item after the hot-files table, en and tr; none without a grower', () => {
    const s = statsOf(roomy());
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Hot files\n\n\|[^\n]*\n\|[^\n]*\n(?:\|[^\n]*\n)+\n- \*\*Biggest grower:\*\* src\/a\.js \(\+15 \/ −2, net \+13 lines\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*En çok büyüyen dosya:\*\* src\/a\.js \(\+15 \/ −2, net \+13 satır\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, biggestGrower: null }, { repoName: 'demo', today: TODAY }), /Biggest grower/);
    // Markdown in the path is escaped.
    assert.match(buildMarkdown({ ...s, biggestGrower: { path: 'src/*a*.js', net: 2, added: 2, removed: 0 } }, { repoName: 'demo', today: TODAY }), /Biggest grower:\*\* src\/\\\*a\\\*\.js \(\+2 lines\)/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.hotFiles.grower, 'string');
      assert.equal(typeof L.hotFiles.growerValue('a.js', 3), 'string');
      assert.equal(typeof L.hotFiles.growerDescription('a.js', 'x'), 'string');
      assert.equal(typeof L.recap.grower, 'string');
      assert.equal(typeof L.recap.growerDetail(3, 5, 2), 'string');
      assert.ok(L.recap.grower.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.grower, 'string');
    }
  });
});

describe('git (real repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const lines = (n, tag = '') => Array.from({ length: n }, (_, i) => `line ${tag}${i}`).join('\n') + '\n';
  const commitAll = (repo, msg, day) => {
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg], at(day));
  };
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-grower-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    // 1: a.js 20 lines, a lockfile (ignored), a binary (0 lines).
    write(repo, 'src/a.js', lines(20));
    write(repo, 'package-lock.json', lines(500));
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0, 1, 2, 0, 255, 0, 3]));
    commitAll(repo, 'feat: start', '2026-03-02');
    // 2: a.js shrinks to 5, b.js 12 lines, docs/guide.md 30 lines.
    write(repo, 'src/a.js', lines(5));
    write(repo, 'src/b.js', lines(12));
    write(repo, 'docs/guide.md', lines(30));
    commitAll(repo, 'feat: b', '2026-03-03');
    // 3 on a side branch (side.js, 100 lines), merged with a merge commit.
    git(repo, ['checkout', '-q', '-b', 'side']);
    write(repo, 'src/side.js', lines(100));
    commitAll(repo, 'feat: side', '2026-03-04');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-05'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md; --exclude drops files first; merges and lockfiles never count', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    // side.js comes in through its own (non-merge) commit: +100.
    assert.deepEqual(doc.stats.biggestGrower, { path: 'src/side.js', net: 100, added: 100, removed: 0 });
    assert.match(readFileSync(r.markdown, 'utf8'), /- \*\*Biggest grower:\*\* src\/side\.js \(\+100 lines\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Top grower\s+src\/side\.js \(\+100 lines\)/);
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['src/side.js'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.biggestGrower, { path: 'docs/guide.md', net: 30, added: 30, removed: 0 });
    const y = await generate({ path: repo, out: join(root, 'o3'), png: false, json: true, exclude: ['src/side.js', 'docs/'] }, { today: TODAY });
    // a.js: +20 then +0 −15 → net 5; b.js 12.
    assert.deepEqual(JSON.parse(readFileSync(y.statsJson, 'utf8')).stats.biggestGrower, { path: 'src/b.js', net: 12, added: 12, removed: 0 });
  });

  test('multi-repo: repo-labelled paths', async () => {
    const other = join(root, 'web');
    mkdirSync(other);
    git(other, ['init', '-q', '-b', 'main']);
    write(other, 'src/big.js', lines(300));
    commitAll(other, 'feat: big', '2026-03-06');
    const r = await generate({ paths: [repo, other], out: join(root, 'o4'), png: false, json: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.biggestGrower, { path: 'web/src/big.js', net: 300, added: 300, removed: 0 });
  });
});
