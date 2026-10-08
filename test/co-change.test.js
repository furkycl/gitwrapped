// Co-change pair: the two files changed together in the most non-merge commits, counted by
// computeCoChange (src/stats/cochange.js) over the same files as hot files, shown as
// stats.coChange, a recap line, a wrapped.md item and a row on the hot-files card (spare
// room only).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { CO_CHANGE_MAX_FILES, CO_CHANGE_MIN_COMMITS, computeCoChange, computeStats, shownCoChange } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, testsOnHotFiles } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, paths, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: paths.map((path) => ({ path, added: 3, removed: 1 })),
  parents: ['p'],
  ...extra,
});
/** `n` commits (numbered from `from`) each changing `paths`. */
const times = (n, paths, from = 1) => Array.from({ length: n }, (_, k) => commit(from + k, paths));

// One pair, three shared commits: the hot-files card has room for the row.
const roomy = () => times(3, ['src/a.js', 'src/b.js']);
// Five hot files and a top-folders list: no room for another row.
const busy = () => [
  ...roomy(),
  commit(4, ['lib/c.js', 'test/t.test.js']),
  commit(5, ['docs/d.md']),
  commit(6, ['e/e.js']),
  commit(7, ['f/f.js']),
];

const specOf = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').spec;
const svgs = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg);
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => r.label === L.hotFiles.coChange);
const rowOf2 = (spec, label) => (spec.lines ?? []).find((r) => r.label === label);
const stats = (commits) => computeStats(commits, { today: TODAY });

describe('computeCoChange', () => {
  test('the pair with the most shared commits, sorted paths', () => {
    const commits = [...times(3, ['src/z.js', 'src/a.js']), ...times(4, ['lib/y.js', 'lib/x.js'], 10)];
    assert.deepEqual(computeCoChange(commits), { files: ['lib/x.js', 'lib/y.js'], commits: 4 });
  });

  test('threshold: 3 shared commits, else null', () => {
    assert.equal(CO_CHANGE_MIN_COMMITS, 3);
    assert.equal(computeCoChange(times(2, ['a.js', 'b.js'])), null);
    assert.deepEqual(computeCoChange(times(3, ['a.js', 'b.js'])), { files: ['a.js', 'b.js'], commits: 3 });
    // Files changed often but never together are no pair.
    assert.equal(computeCoChange([...times(5, ['a.js']), ...times(5, ['b.js'], 10)]), null);
  });

  test('ties: first file alphabetically, then second', () => {
    const commits = [...times(3, ['m.js', 'z.js']), ...times(3, ['b.js', 'y.js'], 10), ...times(3, ['b.js', 'c.js'], 20)];
    assert.deepEqual(computeCoChange(commits), { files: ['b.js', 'c.js'], commits: 3 });
    // A commit touching three files counts for all three pairs.
    assert.deepEqual(computeCoChange(times(3, ['c.js', 'a.js', 'b.js'])), { files: ['a.js', 'b.js'], commits: 3 });
  });

  test('merge commits are skipped (parents, else a merge subject)', () => {
    const merges = times(3, ['a.js', 'b.js']).map((c) => ({ ...c, parents: ['p', 'q'] }));
    assert.equal(computeCoChange(merges), null);
    const bySubject = times(3, ['a.js', 'b.js']).map(({ parents, ...c }) => ({ ...c, subject: "Merge branch 'x'" }));
    assert.equal(computeCoChange(bySubject), null);
    assert.deepEqual(computeCoChange([...merges, ...times(3, ['a.js', 'b.js'], 10)]), { files: ['a.js', 'b.js'], commits: 3 });
  });

  test('a path listed twice in one commit counts once', () => {
    assert.equal(computeCoChange(times(3, ['a.js', 'a.js'])), null);
    assert.deepEqual(computeCoChange(times(3, ['a.js', 'b.js', 'a.js', 'b.js'])), { files: ['a.js', 'b.js'], commits: 3 });
  });

  test('ignored paths are left out, as for hot files', () => {
    assert.equal(computeCoChange(times(5, ['package.json', 'package-lock.json'])), null);
    assert.equal(computeCoChange(times(5, ['src/a.js', 'dist/a.js', 'node_modules/x/i.js'])), null);
    assert.deepEqual(computeCoChange(times(3, ['src/a.js', 'yarn.lock', 'src/b.js'])), { files: ['src/a.js', 'src/b.js'], commits: 3 });
  });

  test('--exclude drops files before (excludeFiles)', () => {
    const commits = [...times(5, ['docs/a.md', 'docs/b.md']), ...times(3, ['src/a.js', 'src/b.js'], 10)];
    assert.deepEqual(computeCoChange(commits), { files: ['docs/a.md', 'docs/b.md'], commits: 5 });
    assert.deepEqual(computeCoChange(excludeFiles(commits, compileExcludes(['docs/']))), { files: ['src/a.js', 'src/b.js'], commits: 3 });
    assert.equal(computeCoChange(excludeFiles(commits, compileExcludes(['docs/', 'src/b.js']))), null);
  });

  test('multi-repo: repo-labelled paths, ignore rules at each repo root', () => {
    const merged = mergeHistories([
      { label: 'api', commits: times(3, ['src/x.js', 'dist/b.js', 'src/y.js']) },
      { label: 'web', commits: times(4, ['dist/a.js', 'dist/b.js'], 10) },
    ]);
    assert.deepEqual(computeCoChange(merged.commits), { files: ['api/src/x.js', 'api/src/y.js'], commits: 3 });
  });

  test(`commits with more than ${CO_CHANGE_MAX_FILES} counted files are left out`, () => {
    const many = (n) => ['a.js', 'b.js', ...Array.from({ length: n - 2 }, (_, i) => `gen/f${i}.js`)];
    assert.deepEqual(computeCoChange(times(3, many(CO_CHANGE_MAX_FILES))), { files: ['a.js', 'b.js'], commits: 3 });
    assert.equal(computeCoChange(times(3, many(CO_CHANGE_MAX_FILES + 1))), null);
    // Ignored files do not count toward the limit.
    const withLocks = [...many(CO_CHANGE_MAX_FILES), ...Array.from({ length: 10 }, (_, i) => `node_modules/m${i}.js`)];
    assert.deepEqual(computeCoChange(times(3, withLocks)), { files: ['a.js', 'b.js'], commits: 3 });
  });

  test('many wide commits over a large file pool: exact, without a table of every pair', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const commits = Array.from({ length: 20000 }, (_, i) => commit(i, Array.from({ length: CO_CHANGE_MAX_FILES }, () => `src/d${Math.floor(rnd() * 100)}/f${Math.floor(rnd() * 50000)}.js`)));
    // One planted pair, a few times, that must win over the random noise.
    commits.push(...times(6, ['src/hot/a.js', 'src/hot/b.js', 'src/hot/c.js'], 30000));
    const t0 = Date.now();
    assert.deepEqual(computeCoChange(commits), { files: ['src/hot/a.js', 'src/hot/b.js'], commits: 6 });
    assert.ok(Date.now() - t0 < 30000);
  });

  test('stays fast on a big history', () => {
    const commits = Array.from({ length: 20000 }, (_, i) => commit(i, Array.from({ length: 8 }, (_, k) => `src/m${(i * 7 + k * 13) % 400}.js`)));
    const t0 = Date.now();
    const pair = computeCoChange(commits);
    assert.ok(pair && pair.commits >= 3);
    assert.ok(Date.now() - t0 < 5000);
  });

  test('email-shaped paths are scrubbed, counted by the real path', () => {
    const pair = computeCoChange(times(3, ['keys/ada@example.com.pub', 'keys/b.pub']));
    assert.deepEqual(pair, { files: ['keys/…', 'keys/b.pub'], commits: 3 });
  });

  test('bad input never throws, never mutates', () => {
    for (const bad of [undefined, null, 42, 'x', {}, [null, 1, 'x', { files: 'no' }, { files: [null, 1, { path: 3 }] }]]) {
      assert.equal(computeCoChange(bad), null);
    }
    const commits = roomy();
    const copy = structuredClone(commits);
    computeCoChange(commits);
    assert.deepEqual(commits, copy);
  });
});

describe('shownCoChange', () => {
  test('valid values pass, malformed ones are null', () => {
    assert.deepEqual(shownCoChange({ files: ['a.js', 'b.js'], commits: 3 }), { files: ['a.js', 'b.js'], commits: 3 });
    for (const bad of [null, undefined, 1, {}, { files: ['a.js'], commits: 3 }, { files: ['a.js', ''], commits: 3 }, { files: ['a.js', 2], commits: 3 }, { files: ['a.js', 'b.js'], commits: 2 }, { files: ['a.js', 'b.js'], commits: 3.5 }, { files: ['a.js', 'b.js'], commits: '9' }]) {
      assert.equal(shownCoChange(bad), null, JSON.stringify(bad));
    }
    assert.deepEqual(shownCoChange({ files: ['a@b.co/x', 'y'], commits: 4 }).files, ['…/x', 'y']);
  });
});

describe('stats.coChange', () => {
  test('in computeStats and stats.json after tests; null without a pair', () => {
    const s = stats(roomy());
    assert.deepEqual(s.coChange, { files: ['src/a.js', 'src/b.js'], commits: 3 });
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('tests') + 1], 'docShare');
    assert.equal(keys[keys.indexOf('docShare') + 1], 'coChange');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.coChange, { files: ['src/a.js', 'src/b.js'], commits: 3 });
    assert.equal(JSON.parse(buildStatsJson({ stats: stats([]), repoName: 'demo' })).stats.coChange, null);
    assert.equal(stats(times(2, ['a.js', 'b.js'])).coChange, null);
  });
});

describe('hot-files card row', () => {
  test('next to the top-folders list when there is room', () => {
    const s = stats([...roomy(), commit(9, ['lib/c.js'])]);
    assert.ok(Array.isArray(specOf(s).chart) && specOf(s).chart.length === 2);
    assert.equal(rowOf(specOf(s)).value, 'a.js + b.js · 3×');
  });

  test('in spare room: "Changed together" and "a.js + b.js · 3×", full paths in the description', () => {
    const s = stats(roomy());
    const row = rowOf(specOf(s));
    assert.deepEqual(row, { label: 'Changed together', value: 'a.js + b.js · 3×', description: 'src/a.js and src/b.js changed together in 3 commits' });
    assert.ok(rowFits(row));
    const card = buildCardSpecs(s, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'hot-files');
    assert.match(cardDescription(card.spec), /src\/a\.js and src\/b\.js changed together in 3 commits/);
    assert.ok(buildCards(s, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'hot-files').svg.includes('a.js + b.js · 3×'));
  });

  test('Turkish', () => {
    const row = rowOf(specOf(stats(roomy()), 'tr'), tr);
    assert.deepEqual(row, { label: 'Birlikte değişenler', value: 'a.js + b.js · 3×', description: "src/a.js ve src/b.js, 3 commit'te birlikte değişti" });
  });

  test('same file name: the last folder too', () => {
    const row = specOf(stats(times(3, ['src/x.js', 'lib/x.js']))).lines.at(-1);
    assert.deepEqual(row, { label: 'lib/x.js + src/x.js', value: '3× together', description: 'lib/x.js and src/x.js changed together in 3 commits' });
    // Deeper paths: only the last folder ("p/q/c/x.js" → "c/x.js").
    assert.equal(specOf(stats(times(3, ['p/q/c/x.js', 'p/q/d/x.js']))).lines.at(-1).label, 'c/x.js + d/x.js');
    // Equal two-segment tails: folders are added from the end until the names differ.
    const deep = specOf(stats(times(3, ['packages/a/s/i.js', 'packages/b/s/i.js']))).lines.at(-1);
    assert.equal(`${deep.label} ${deep.value}`.includes('a/s/i.js + b/s/i.js'), true, JSON.stringify(deep));
    assert.ok(rowFits(deep));
    // Too long once the names differ: no row, never a cut or ambiguous one.
    const long = stats(times(3, ['packages/first-package/src/lib/index.js', 'packages/other-package/src/lib/index.js']));
    assert.equal((specOf(long).lines ?? []).find((r) => /changed together/.test(r.description ?? '')), undefined);
  });

  test('when "Changed together" would cut the value: the pair as the label', () => {
    const s = stats(times(12, ['src/utils.js', 'src/helpers.js']));
    assert.equal(rowOf(specOf(s)), undefined);
    const row = rowOf2(specOf(s), 'helpers.js + utils.js');
    assert.equal(row.value, '12× together');
    assert.ok(rowFits(row));
    assert.equal(rowOf2(specOf(s, 'tr'), 'helpers.js + utils.js').value, '12 kez birlikte');
    assert.ok(buildCards(s, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'hot-files').svg.includes('12× together'));
  });

  test('after the tests row, never in its place', () => {
    for (const paths of [['src/a.js', 'src/a.test.js'], ['src/a.js', 'test/a.test.js']]) {
      const s = stats(times(3, paths));
      assert.deepEqual(specOf(s).lines.map((r) => r.label), ['Tests', 'a.js + a.test.js']);
      assert.equal(testsOnHotFiles(s, { L: en }), true);
      const without = specOf({ ...s, coChange: null });
      assert.deepEqual(specOf(s).lines.slice(0, -1), without.lines);
    }
  });

  test('no room: the card is exactly as without the pair', () => {
    const s = stats(busy());
    assert.ok(s.coChange);
    assert.equal(rowOf(specOf(s)), undefined);
    for (const lang of ['en', 'tr']) assert.deepEqual(svgs(s, lang), svgs({ ...s, coChange: null }, lang));
  });

  test('a value that would be cut: no row, never a cut one', () => {
    const long = 'a-really-quite-extraordinarily-long-component-file-name';
    const s = stats(times(3, [`src/${long}.js`, `src/${long}.test-helpers.js`]));
    assert.ok(s.coChange);
    assert.equal(rowOf(specOf(s)), undefined);
    assert.deepEqual(svgs(s), svgs({ ...s, coChange: null }));
  });

  test('null / missing / malformed coChange: cards byte-identical', () => {
    const s = stats(roomy());
    const without = { ...s };
    delete without.coChange;
    const none = svgs({ ...s, coChange: null });
    assert.deepEqual(svgs(without), none);
    assert.deepEqual(svgs({ ...s, coChange: { files: ['a'], commits: 9 } }), none);
    assert.notDeepEqual(svgs(s), none);
  });
});

describe('recap and wrapped.md', () => {
  test('recap: "Co-changed" with the paths and commits; none without a pair', () => {
    const s = stats(roomy());
    const line = formatSummary(s, { paths: {} }).split('\n').find((l) => l.includes('Co-changed'));
    assert.equal(line, '  Co-changed   src/a.js + src/b.js (3 commits)');
    const trLine = formatSummary(s, { paths: {}, lang: 'tr' }).split('\n').find((l) => l.includes('Birlikte'));
    assert.equal(trLine, '  Birlikte değişen src/a.js + src/b.js (3 commit)');
    assert.ok(!formatSummary({ ...s, coChange: null }, { paths: {} }).includes('Co-changed'));
    assert.ok(en.recap.coChange.length < en.recap.labelWidth);
    // Two paths that read alike once scrubbed or shortened: no line (recap and wrapped.md).
    const alike = { ...s, coChange: { files: ['k/ada@example.com/x', 'k/bob@example.com/x'], commits: 4 } };
    assert.ok(!formatSummary(alike, { paths: {} }).includes('Co-changed'));
    assert.ok(!buildMarkdown(alike, {}).includes('Changed together'));
    const longAlike = { ...s, coChange: { files: [`a/${'x'.repeat(60)}.js`, `b/${'x'.repeat(60)}.js`], commits: 4 } };
    assert.ok(!formatSummary(longAlike, { paths: {} }).includes('Co-changed'));
    assert.ok(buildMarkdown(longAlike, {}).includes('Changed together'));
    assert.ok(tr.recap.coChange.length < tr.recap.labelWidth);
  });

  test('wrapped.md: an item after the hot-files table; none without a pair', () => {
    const s = stats(roomy());
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.ok(md.includes('|\n\n- **Changed together:** src/a.js + src/b.js (3 commits)\n'));
    assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes('- **Birlikte değişenler:** src/a.js + src/b.js (3 commit)'));
    assert.equal(buildMarkdown({ ...s, coChange: null }, { repoName: 'demo', today: TODAY }).includes('Changed together'), false);
    // Paths are escaped like the table's.
    const odd = { ...s, coChange: { files: ['src/*a*.js', 'src/b_|.js'], commits: 4 } };
    assert.ok(buildMarkdown(odd, { repoName: 'demo' }).includes('src/\\*a\\*.js + src/b\\_\\|.js (4 commits)'));
  });

  test('multi-repo: labelled paths in the recap and wrapped.md', () => {
    const merged = mergeHistories([
      { label: 'api', commits: times(3, ['src/x.js', 'src/y.js']) },
      { label: 'web', commits: times(1, ['a.js'], 10) },
    ]);
    const s = computeStats(merged.commits, { today: TODAY, repos: merged.repos });
    assert.ok(formatSummary(s, { paths: {} }).includes('api/src/x.js + api/src/y.js (3 commits)'));
    assert.ok(buildMarkdown(s, {}).includes('api/src/x.js + api/src/y.js (3 commits)'));
  });
});
