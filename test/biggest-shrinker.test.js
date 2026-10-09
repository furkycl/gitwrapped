import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeBiggestShrinker, computeHotFiles, computeStats, shownBiggestShrinker } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
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

// Two files, each touched twice: src/a.js shrinks (−15 / +2, net −13), src/b.js grows (+4).
// The hot-files card has room, and no one-touch row competes.
const roomy = () => [commit(1, [['src/a.js', 1, 10], ['src/b.js', 3, 0]]), commit(2, [['src/a.js', 1, 5], ['src/b.js', 1, 0]])];
// Many files across folders, a test file and a co-change pair: the hot-files card is full.
const crowded = () => Array.from({ length: 10 }, (_, i) => commit(i + 1, [['src/a.js', 1, 5], [`lib/f${i}.js`, 3, 0], ['test/x.test.js', 2, 0]]));

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts)).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isShrinkerRow = (r, L = en) => typeof r?.label === 'string' && (r.label === L.hotFiles.shrinker || r.label.startsWith(`${L.hotFiles.shrinkerLabelShort}: `));
const isGrowerRow = (r, L = en) => typeof r?.label === 'string' && (r.label === L.hotFiles.grower || r.label.startsWith(`${L.hotFiles.growerLabelShort}: `));
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isShrinkerRow(r, L));

describe('computeBiggestShrinker', () => {
  test('the file with the largest net loss (removed − added), summed per path', () => {
    const commits = [
      commit(1, [['src/a.js', 0, 100], ['src/b.js', 0, 50]]),
      commit(2, [['src/a.js', 90, 0], ['src/b.js', 5, 20]]),
      commit(3, [['src/c.js', 40, 60]]),
    ];
    // a: −100 +90 = 10; b: −70 +5 = 65; c: −60 +40 = 20.
    assert.deepEqual(computeBiggestShrinker(commits), { path: 'src/b.js', net: 65, added: 5, removed: 70 });
  });

  test('ties go to the path that sorts first (code-unit order, so "B" before "a")', () => {
    const commits = [commit(1, [['src/z.js', 0, 10], ['src/a.js', 2, 12], ['src/B.js', 0, 10]])];
    assert.equal(computeBiggestShrinker(commits).path, 'src/B.js');
    assert.equal(computeBiggestShrinker([commit(1, [['b.js', 0, 5], ['a.js', 0, 5]])]).path, 'a.js');
  });

  test('null when no file shrank: net 0 or more everywhere, no files, no commits', () => {
    assert.equal(computeBiggestShrinker([commit(1, [['a.js', 5, 5], ['b.js', 9, 1]])]), null);
    assert.equal(computeBiggestShrinker([commit(1, [])]), null);
    assert.equal(computeBiggestShrinker([]), null);
    // A growing file never wins over a shrinking one, however many lines it added.
    assert.equal(computeBiggestShrinker([commit(1, [['a.js', 900, 0], ['b.js', 0, 1]])]).path, 'b.js');
  });

  test('merge commits never count, even with files', () => {
    const commits = [commit(1, [['src/a.js', 0, 3]]), merge(2, [['src/m.js', 0, 500]])];
    assert.deepEqual(computeBiggestShrinker(commits), { path: 'src/a.js', net: 3, added: 0, removed: 3 });
    assert.equal(computeBiggestShrinker([merge(1, [['src/m.js', 0, 500]])]), null);
  });

  test('ignored paths are left out, as for hot files', () => {
    const commits = [commit(1, [['src/a.js', 0, 2], ['package-lock.json', 0, 9000], ['dist/app.js', 0, 800], ['vendor/x.go', 0, 700], ['web/app.min.js', 0, 600], ['__snapshots__/a.snap', 0, 400]])];
    assert.equal(computeBiggestShrinker(commits).path, 'src/a.js');
    assert.equal(computeBiggestShrinker([commit(1, [['Cargo.lock', 0, 10]])]), null);
  });

  test('--exclude drops files first (excludeFiles)', () => {
    const commits = [commit(1, [['src/a.js', 0, 5], ['docs/big.md', 0, 500]])];
    assert.equal(computeBiggestShrinker(commits).path, 'docs/big.md');
    assert.equal(computeBiggestShrinker(excludeFiles(commits, compileExcludes(['docs/']))).path, 'src/a.js');
    assert.equal(computeBiggestShrinker(excludeFiles(commits, compileExcludes(['*.js', 'docs/']))), null);
  });

  test('multi-repo: the same path in two repos is two files; ignore rules apply at each repo root', () => {
    const commits = [
      commit(1, [['api/README.md', 0, 10], ['api/dist/x.js', 0, 999]], { repo: 'api' }),
      commit(2, [['web/README.md', 0, 15]], { repo: 'web' }),
      commit(3, [['web/src/a.js', 0, 20]], { repo: 'web' }),
    ];
    assert.deepEqual(computeBiggestShrinker(commits), { path: 'web/src/a.js', net: 20, added: 0, removed: 20 });
  });

  test('renames as hot files see them (--no-renames): the old path loses every line', () => {
    const commits = [commit(1, [['src/old.js', 10, 0]]), commit(2, [['src/old.js', 0, 30], ['src/new.js', 30, 0]])];
    assert.deepEqual(computeBiggestShrinker(commits), { path: 'src/old.js', net: 20, added: 10, removed: 30 });
  });

  test('agrees with hot files line totals (random histories)', () => {
    let seed = 7;
    const rand = (n) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const pool = ['src/a.js', 'src/b.js', 'lib/c.ts', 'README.md', 'package-lock.json', 'dist/x.js', 'docs/d.md'];
    for (let round = 0; round < 40; round++) {
      const commits = Array.from({ length: 1 + rand(12) }, (_, i) => {
        const files = Array.from({ length: rand(4) }, () => [pool[rand(pool.length)], rand(20), rand(20)]);
        return rand(6) === 0 ? merge(i + 1, files) : commit(i + 1, files);
      });
      const nonMerge = commits.filter((c) => c.parents.length < 2);
      const ref = computeHotFiles(nonMerge, { limit: 1000 })
        .map((f) => ({ path: f.path, net: f.linesRemoved - f.linesAdded, added: f.linesAdded, removed: f.linesRemoved }))
        .filter((f) => f.net > 0)
        .sort((a, b) => b.net - a.net || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      assert.deepEqual(computeBiggestShrinker(commits), ref[0] ?? null);
    }
  });

  test('email-shaped text in the path is scrubbed', () => {
    assert.equal(computeBiggestShrinker([commit(1, [['keys/ada@example.com.pub', 0, 3]])]).path, 'keys/…');
  });

  test('bad input never throws, never mutates', () => {
    for (const v of [null, undefined, 'x', 3, {}, [null, 3, 'x', { files: null }, { files: [null, { path: 3 }] }]]) assert.equal(computeBiggestShrinker(v), null);
    const commits = roomy();
    const before = JSON.stringify(commits);
    computeBiggestShrinker(commits);
    assert.equal(JSON.stringify(commits), before);
  });

  test('computeStats puts biggestShrinker right after biggestGrower; stats.json keeps exactly {path, net, added, removed} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('biggestGrower') + 1], 'biggestShrinker');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.biggestShrinker, { path: 'src/a.js', net: 13, added: 2, removed: 15 });
    assert.deepEqual(Object.keys(doc.stats.biggestShrinker), ['path', 'net', 'added', 'removed']);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo' })).stats.biggestShrinker, null);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([commit(1, [['a.js', 1, 1]])]), repoName: 'demo' })).stats.biggestShrinker, null);
  });
});

describe('shownBiggestShrinker', () => {
  test('whole numbers, a non-empty scrubbed path; null without a loss or a path', () => {
    assert.deepEqual(shownBiggestShrinker({ path: 'a.js', net: 3, added: 2, removed: 5 }), { path: 'a.js', net: 3, added: 2, removed: 5 });
    assert.deepEqual(shownBiggestShrinker({ path: 'x/ada@example.com', net: 2.6, added: 'x', removed: -1 }), { path: 'x/…', net: 3, added: 0, removed: 0 });
    for (const v of [null, undefined, 'x', 3, {}, { path: '', net: 3 }, { path: '  ', net: 3 }, { path: 'a.js', net: 0 }, { path: 'a.js', net: -4 }, { path: 'a.js', net: NaN }, { path: 3, net: 3 }]) {
      assert.equal(shownBiggestShrinker(v), null, JSON.stringify(v));
    }
  });
});

describe('cards', () => {
  test('a "Biggest shrinker" row last on the hot-files card, after the grower row, en and tr', () => {
    const s = statsOf(roomy());
    const spec = specOf(s, 'hot-files');
    assert.deepEqual(spec.lines.at(-1), { label: 'Biggest shrinker', value: 'src/a.js · −13', description: 'src/a.js shrank the most (−15 / +2, net −13 lines)' });
    assert.ok(isGrowerRow(spec.lines.at(-2)), 'the grower row comes first');
    assert.match(cardDescription(spec), /src\/a\.js shrank the most \(−15 \/ \+2, net −13 lines\)\./);
    const trSpec = specOf(s, 'hot-files', 'tr');
    assert.deepEqual(trSpec.lines.at(-1), { label: 'En çok küçülen', value: 'src/a.js · −13', description: 'src/a.js en çok küçülen dosya (−15 / +2, net −13 satır)' });
    assert.ok(isGrowerRow(trSpec.lines.at(-2), tr));
  });

  test('a long path moves into the label, middle-elided, else just the file name; none when even that is cut', () => {
    const base = { ...statsOf(roomy()), biggestGrower: null };
    const at = (path, net = 13) => rowOf(specOf({ ...base, biggestShrinker: { path, net, added: 0, removed: net } }, 'hot-files'));
    assert.equal(at('lib/util.js').value, 'lib/util.js · −13');
    // "Biggest shrinker" is wider than "Biggest grower": a slightly longer path already moves.
    assert.deepEqual([at('src/stats/x.js').label, at('src/stats/x.js').value], ['Shrinker: src/stats/x.js', '−13']);
    assert.deepEqual([at('src/stats/index.js', 1234).label, at('src/stats/index.js', 1234).value], ['Shrinker: src/stats/index.js', '−1,234']);
    assert.deepEqual([at('packages/core/src/lib/deep/x.js').label, at('packages/core/src/lib/deep/x.js').value], ['Shrinker: packages/…/deep/x.js', '−13']);
    assert.equal(at('src/an-extremely-long-file-name-that-never-fits-anywhere-on-a-row-or-in-a-label-either-really.js'), undefined);
    assert.match(at('packages/core/src/lib/deep/x.js').description, /^packages\/core\/src\/lib\/deep\/x\.js shrank the most/);
  });

  test('never displaces anything (the grower row included): only the hot-files card changes, and it only gains the row', () => {
    const docsToo = [...roomy(), commit(3, [['README.md', 4, 0]])];
    const oneTouchToo = [commit(1, [['src/a.js', 1, 10]]), commit(2, [['src/a.js', 1, 5], ['src/b.js', 3, 0]])];
    const cases = [roomy(), crowded(), docsToo, oneTouchToo, [...roomy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]];
    let gained = 0;
    for (const commits of cases) {
      const s = statsOf(commits);
      const without = { ...s, biggestShrinker: null };
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
    assert.ok(s.biggestShrinker);
    assert.equal(rowOf(specOf(s, 'hot-files')), undefined);
    assert.deepEqual(svgs(s), svgs({ ...s, biggestShrinker: null }));
  });

  test('no row for null or a malformed value: cards byte-identical', () => {
    const s = statsOf(roomy());
    const without = svgs({ ...s, biggestShrinker: null });
    for (const biggestShrinker of [undefined, 'x', { path: 'a.js', net: 0 }, { path: '', net: 3 }, { net: 3 }]) {
      assert.deepEqual(svgs({ ...s, biggestShrinker }), without, JSON.stringify(biggestShrinker));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('no hot files: no row', () => {
    const s = { ...statsOf([]), biggestShrinker: { path: 'a.js', net: 4, added: 0, removed: 4 } };
    for (const c of buildCardSpecs(s, cardOpts('en'))) assert.equal(rowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line right after the grower line, en and tr; none without a shrinker', () => {
    const s = statsOf(roomy());
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Top grower {3}src\/b\.js \(\+4 lines\)\n {2}Top shrinker src\/a\.js \(−15 \/ \+2, net −13 lines\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}En çok büyüyen[^\n]*\n {2}En çok küçülen\s+src\/a\.js \(−15 \/ \+2, net −13 satır\)\n/);
    // Nothing added: just the lines lost.
    assert.match(formatSummary({ ...s, biggestShrinker: { path: 'a.js', net: 1, added: 0, removed: 1 } }, { repoName: 'demo', today: TODAY }), /Top shrinker a\.js \(−1 line\)\n/);
    for (const biggestShrinker of [null, undefined, { path: 'a.js', net: 0 }]) {
      assert.doesNotMatch(formatSummary({ ...s, biggestShrinker }, { repoName: 'demo', today: TODAY }), /Top shrinker/);
    }
  });

  test('wrapped.md item right after the grower item, en and tr; none without a shrinker', () => {
    const s = statsOf(roomy());
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /- \*\*Biggest grower:\*\* src\/b\.js \(\+4 lines\)\n- \*\*Biggest shrinker:\*\* src\/a\.js \(−15 \/ \+2, net −13 lines\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*En çok küçülen dosya:\*\* src\/a\.js \(−15 \/ \+2, net −13 satır\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, biggestShrinker: null }, { repoName: 'demo', today: TODAY }), /Biggest shrinker/);
    assert.match(buildMarkdown({ ...s, biggestShrinker: { path: 'src/*a*.js', net: 2, added: 0, removed: 2 } }, { repoName: 'demo', today: TODAY }), /Biggest shrinker:\*\* src\/\\\*a\\\*\.js \(−2 lines\)/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.hotFiles.shrinker, 'string');
      assert.equal(typeof L.hotFiles.shrinkerValue('a.js', 3), 'string');
      assert.equal(typeof L.hotFiles.shrinkerNamed('a.js'), 'string');
      assert.equal(typeof L.hotFiles.shrinkerShort(3), 'string');
      assert.equal(typeof L.hotFiles.shrinkerDescription('a.js', 'x'), 'string');
      assert.equal(typeof L.recap.shrinker, 'string');
      assert.equal(typeof L.recap.shrinkerDetail(3, 2, 5), 'string');
      assert.ok(L.recap.shrinker.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.shrinker, 'string');
    }
  });
});
