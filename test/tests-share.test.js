// Test share: the lines changed in test files and their share of all lines changed,
// counted by computeTests (src/stats/tests.js) over the same files as hot files, shown as
// stats.tests, a recap line, a wrapped.md item and a row on the hot-files card (else the
// languages card), in spare room only.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories } from '../src/git.js';
import { computeStats, computeTests, isTestPath, shownTests, TEST_DIRS } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard, testsOnHotFiles, testsShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});

// One hot file and one test file: the hot-files card has room for the row.
const roomy = () => [commit(1, [['src/a.js', 100, 10]]), commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]])];
// Three hot files and a top-folders list: no room there, the languages card gets the row.
const busy = () => [
  commit(1, [['src/a.js', 100, 10], ['src/b.js', 20, 0], ['README.md', 5, 1]]),
  commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]]),
  commit(3, [['docs/guide.md', 7, 0]]),
];
// Eight languages: in Turkish neither card has room for the row.
const EXTS = ['js', 'py', 'go', 'rs', 'rb', 'java', 'md', 'json'];
const crowded = () => Array.from({ length: 8 }, (_, i) => commit(i + 1, [[`src/f${i}.${EXTS[i]}`, 10 + i, 1], [`lib/g${i}.${EXTS[(i + 3) % 8]}`, 5, 0], [`test/t${i}.test.js`, 3, 0]]));

const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgOf = (stats, id, lang = 'en', opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, ...opts }).find((c) => c.id === id).svg;
const testsRowOf = (spec, L = en) => (spec.lines ?? []).find((r) => r.label === L.hotFiles.tests);
const withoutTests = (s) => {
  const copy = { ...s };
  delete copy.tests;
  return copy;
};

describe('isTestPath', () => {
  test('test directories at any depth', () => {
    for (const p of ['test/a.js', 'tests/a.js', '__tests__/a.js', 'spec/a.rb', 'src/test/x.js', 'pkg/a/tests/b/c.py', 'src/__tests__/App.jsx', 'test/fixtures/data.json', 'specs/a.js']) {
      assert.equal(isTestPath(p), true, p);
    }
    assert.deepEqual(TEST_DIRS, ['test', 'tests', '__tests__', 'spec', 'specs']);
  });

  test('test file names: *.test.*, *.spec.*, *_test.*', () => {
    for (const p of ['src/a.test.js', 'a.spec.ts', 'pkg/db_test.go', 'app.test.tsx', 'x/y.spec.rb', 'foo.test.snap.js']) {
      assert.equal(isTestPath(p), true, p);
    }
  });

  test('not tests: other names, case, a file named "test", partial directory names', () => {
    for (const p of ['src/a.js', 'test', 'tests', 'src/test', 'Test/a.js', 'TESTS/a.js', 'testing/a.js', 'contest/a.js', 'src/latest.js', 'attest.js', 'a.testing.js', 'test.js', 'spec.ts', 'mytest.go', 'specs', 'src/specs', 'README.md']) {
      assert.equal(isTestPath(p), false, p);
    }
  });

  test('bad input is false, never throws', () => {
    for (const p of [undefined, null, '', 42, {}, []]) assert.equal(isTestPath(p), false);
  });
});

describe('computeTests', () => {
  test('lines added + deleted in test files, share of all counted lines (3 decimals)', () => {
    // all: 110 + 42 + 6 = 158; tests: 42 → 0.266
    assert.deepEqual(computeTests(roomy()), { lines: 42, share: 0.266 });
  });

  test('ignored paths count nowhere (lockfiles, build output, snapshots, minified)', () => {
    const c = [commit(1, [['src/a.js', 10, 0], ['test/a.test.js', 10, 0], ['package-lock.json', 5000, 0], ['dist/app.js', 900, 0], ['test/__snapshots__/a.snap', 300, 0], ['test/vendor.min.js', 200, 0]])];
    assert.deepEqual(computeTests(c), { lines: 10, share: 0.5 });
  });

  test('none in tests → {lines: 0, share: 0}; no counted line at all → null', () => {
    assert.deepEqual(computeTests([commit(1, [['src/a.js', 3, 1]])]), { lines: 0, share: 0 });
    assert.equal(computeTests([]), null);
    assert.equal(computeTests([commit(1, [['logo.png', undefined, undefined]])]), null);
    assert.equal(computeTests([commit(1, [['package-lock.json', 10, 0]])]), null);
  });

  test('share: 1 only when every line is in tests, else at most 0.999; tiny shares may round to 0', () => {
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 5, 5]])]), { lines: 10, share: 1 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 9999, 0], ['src/a.js', 1, 0]])]), { lines: 9999, share: 0.999 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1, 0], ['src/a.js', 9999, 0]])]), { lines: 1, share: 0 });
  });

  test('multi-repo: checked on the path inside each repo, so a repo labelled "test" is not all tests', () => {
    const merged = mergeHistories([
      { label: 'test', commits: [commit(1, [['src/x.js', 10, 0], ['dist/b.js', 99, 0]])] },
      { label: 'web', commits: [commit(2, [['spec/y.spec.js', 10, 0]])] },
    ]);
    assert.deepEqual(computeTests(merged.commits), { lines: 10, share: 0.5 });
  });

  test('--exclude drops files before (excludeFiles)', () => {
    assert.deepEqual(computeTests(excludeFiles(busy(), compileExcludes(['test/']))), { lines: 0, share: 0 });
    assert.deepEqual(computeTests(excludeFiles(busy(), compileExcludes(['src/', 'docs/', 'README.md']))), { lines: 42, share: 1 });
  });

  test('bad input never throws, never mutates', () => {
    assert.equal(computeTests(undefined), null);
    assert.equal(computeTests('nope'), null);
    assert.equal(computeTests([null, 7, { files: 'x' }, { files: [null, 3, { path: 3, added: 5 }, { path: 'test/a.js', added: 'x', removed: NaN }, { path: 'test/b.js', added: Infinity, removed: -4 }] }]), null);
    assert.deepEqual(computeTests([{ files: [{ path: 'test/a.js', added: 2 }, { path: 'a.js', removed: 2 }] }]), { lines: 2, share: 0.5 });
    const input = roomy();
    const copy = structuredClone(input);
    computeTests(input);
    assert.deepEqual(input, copy);
  });

  test('computeStats puts tests right after fileLifecycle; stats.json keeps it (null too)', () => {
    const stats = computeStats(roomy(), { today: TODAY });
    const keys = Object.keys(stats);
    assert.equal(keys[keys.indexOf('fileLifecycle') + 1], 'tests');
    assert.deepEqual(stats.tests, { lines: 42, share: 0.266 });
    assert.equal(computeStats([], { today: TODAY }).tests, null);
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.tests, { lines: 42, share: 0.266 });
    assert.equal(JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' })).stats.tests, null);
  });
});

describe('shownTests / testsShareText', () => {
  test('whole percent, "<1%" when it rounds to 0, never 100% short of all', () => {
    assert.deepEqual(shownTests({ lines: 42, share: 0.266 }), { lines: 42, percent: 27 });
    assert.deepEqual(shownTests({ lines: 10, share: 1 }), { lines: 10, percent: 100 });
    assert.deepEqual(shownTests({ lines: 9999, share: 0.999 }), { lines: 9999, percent: 99 });
    assert.deepEqual(shownTests({ lines: 1, share: 0 }), { lines: 1, percent: 0 });
    assert.equal(testsShareText({ lines: 1, percent: 0 }), '<1%');
    assert.equal(testsShareText({ lines: 1, percent: 0 }, tr), '<%1');
    assert.equal(testsShareText({ lines: 9, percent: 27 }, tr), '%27');
  });

  test('null without a test line or for malformed values; odd shares are clamped', () => {
    for (const v of [null, undefined, 'x', 3, {}, { lines: 0, share: 0 }, { lines: -2, share: 0.5 }, { lines: 1.5, share: 0.5 }, { lines: '3', share: 0.5 }]) {
      assert.equal(shownTests(v), null, JSON.stringify(v));
    }
    assert.deepEqual(shownTests({ lines: 5, share: 7 }), { lines: 5, percent: 99 });
    assert.deepEqual(shownTests({ lines: 5, share: NaN }), { lines: 5, percent: 0 });
    assert.deepEqual(shownTests({ lines: 5, share: -1 }), { lines: 5, percent: 0 });
  });
});

describe('cards', () => {
  test('hot-files card: a "Tests" row when there is room, en and tr; not on the languages card', () => {
    const s = computeStats(roomy(), { today: TODAY });
    for (const [lang, L, value] of [['en', en, '42 lines · 27%'], ['tr', tr, '42 satır · %27']]) {
      const hot = specOf(s, 'hot-files', lang);
      const row = testsRowOf(hot, L);
      assert.ok(row, lang);
      assert.equal(row.value, value);
      assert.equal(testsRowOf(specOf(s, 'languages', lang), L), undefined, lang);
      assert.ok(svgOf(s, 'hot-files', lang).includes(L.hotFiles.tests), lang);
      assert.equal(svgOf(s, 'languages', lang), svgOf(withoutTests(s), 'languages', lang), lang);
      assert.equal(testsOnHotFiles(s, { L, repos: null }), true);
    }
  });

  test('languages card gets it when the hot-files card has no room; hot-files card byte-identical', () => {
    const s = computeStats(busy(), { today: TODAY });
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      assert.equal(testsRowOf(specOf(s, 'hot-files', lang), L), undefined, lang);
      assert.equal(svgOf(s, 'hot-files', lang), svgOf(withoutTests(s), 'hot-files', lang), lang);
      const row = testsRowOf(specOf(s, 'languages', lang), L);
      assert.ok(row, lang);
      assert.equal(row.value, L.hotFiles.testsValue(42, testsShareText({ percent: 22 }, L)));
      assert.equal(testsOnHotFiles(s, { L, repos: null }), false);
    }
  });

  test('neither card has room: both byte-identical (still in the recap and wrapped.md)', () => {
    const s = computeStats(crowded(), { today: TODAY });
    assert.ok(s.tests.lines > 0);
    for (const id of ['hot-files', 'languages']) assert.equal(svgOf(s, id, 'tr'), svgOf(withoutTests(s), id, 'tr'), id);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Testler/);
  });

  test('never displaces anything: same charts drawn, no extra shrinking, on whichever card shows it', () => {
    const cases = [roomy(), busy(), crowded(), [...busy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]];
    for (const commits of cases) {
      // Without the docs-share row (test/docs-share.test.js covers it), which would take the
      // tests row's spare room when that is left out.
      const s = { ...computeStats(commits, { today: TODAY }), docShare: null };
      for (const lang of ['en', 'tr']) {
        for (const opts of [{}, { colorTheme: 'mono' }]) {
          let shown = 0;
          for (const id of ['hot-files', 'languages']) {
            const spec = specOf(s, id, lang, opts);
            const base = specOf(withoutTests(s), id, lang, opts);
            if (!testsRowOf(spec, lang === 'en' ? en : tr)) {
              assert.equal(svgOf(s, id, lang, opts), svgOf(withoutTests(s), id, lang, opts), `${id} ${lang}`);
              continue;
            }
            shown += 1;
            const a = layoutCard(spec);
            const b = layoutCard(base);
            assert.deepEqual(a.drawnCharts, b.drawnCharts, id);
            assert.ok(a.shrinkSteps <= b.shrinkSteps, id);
            assert.deepEqual(spec.lines.slice(0, -1), base.lines ?? []);
          }
          assert.ok(shown <= 1, lang);
        }
      }
    }
  });

  test('no row without a test line, or for a malformed / missing value: cards byte-identical', () => {
    const s = computeStats(roomy(), { today: TODAY });
    const ref = svgOf(withoutTests(s), 'hot-files');
    for (const tests of [null, { lines: 0, share: 0 }, 'x', { lines: -1, share: 2 }]) {
      assert.equal(svgOf({ ...s, tests }, 'hot-files'), ref, JSON.stringify(tests));
      assert.equal(svgOf({ ...s, tests }, 'languages'), svgOf(withoutTests(s), 'languages'));
    }
    assert.notEqual(svgOf(s, 'hot-files'), ref);
  });

  test('"<1%" for a tiny share; the short value when the full one would be cut', () => {
    const s = computeStats(roomy(), { today: TODAY });
    assert.equal(testsRowOf(specOf({ ...s, tests: { lines: 3, share: 0 } }, 'hot-files')).value, '3 lines · <1%');
    const big = testsRowOf(specOf({ ...s, tests: { lines: 123456789, share: 0.5 } }, 'hot-files'));
    assert.equal(big.value, '123,456,789 · 50%');
    // Too wide even short: no row on either card rather than a cut one.
    const huge = { ...s, tests: { lines: 123456789012, share: 0.5 } };
    assert.equal(testsRowOf(specOf(huge, 'hot-files')), undefined);
    assert.equal(testsRowOf(specOf(huge, 'languages')), undefined);
  });

  test('the card description reads the row as a sentence', () => {
    const s = computeStats(roomy(), { today: TODAY });
    assert.match(cardDescription(specOf(s, 'hot-files')), /42 lines changed in tests \(27% of lines changed\)\./);
    assert.match(cardDescription(specOf(s, 'hot-files', 'tr')), /Testlerde 42 satır değişti \(değişen satırların %27 kadarı\)\./);
    const cards = buildCards(s, { repoName: 'demo', today: TODAY });
    assert.match(cards.find((c) => c.id === 'hot-files').description, /changed in tests/);
  });

  test('no hot files (empty history): no row anywhere', () => {
    const s = { ...computeStats([], { today: TODAY }), tests: { lines: 4, share: 0.5 } };
    assert.equal(testsRowOf(specOf(s, 'hot-files')), undefined);
    assert.equal(testsRowOf(specOf(s, 'languages')), undefined);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the top folders, en and tr; none without a test line', () => {
    const s = computeStats(busy(), { today: TODAY });
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Top folders .*\n {2}Tests {8}42 lines \(22% of lines changed\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Testler\s+42 satır \(değişen satırların %22 kadarı\)\n/);
    assert.match(formatSummary({ ...s, tests: { lines: 2, share: 0.0001 } }, { repoName: 'demo', today: TODAY }), /Tests\s+2 lines \(<1% of lines changed\)/);
    for (const tests of [null, { lines: 0, share: 0 }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, tests }, { repoName: 'demo', today: TODAY }), /\n {2}Tests /);
    }
  });

  test('wrapped.md item in the numbers, en and tr; none without a test line', () => {
    const s = computeStats(busy(), { today: TODAY });
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## In numbers\n[\s\S]*- \*\*Test lines:\*\* 42 lines \(22% of lines changed\)\n[\s\S]*## When you commit/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Test satırları:\*\* 42 satır \(değişen satırların %22 kadarı\)/);
    assert.match(buildMarkdown({ ...s, tests: { lines: 5, share: 1 } }, { repoName: 'demo', today: TODAY }), /5 lines \(100% of lines changed\)/);
    assert.doesNotMatch(buildMarkdown({ ...s, tests: { lines: 0, share: 0 } }, { repoName: 'demo', today: TODAY }), /Test lines/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.hotFiles.tests, 'string');
      for (const k of ['testsValue', 'testsShort', 'testsDescription']) assert.equal(typeof L.hotFiles[k](3, '5%'), 'string', k);
      assert.equal(typeof L.recap.tests, 'string');
      assert.ok(L.recap.tests.length < L.recap.labelWidth);
      assert.equal(typeof L.recap.ofLinesChanged('5%'), 'string');
      assert.equal(typeof L.markdown.tests, 'string');
    }
  });
});

describe('git (real repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day = '2026-03-02') => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-tests-share-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    write(repo, 'src/a.js', lines(15));
    write(repo, 'package-lock.json', lines(400));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: a'], at('2026-03-02'));
    write(repo, 'test/a.test.js', lines(3));
    write(repo, 'src/b_test.go', lines(2));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'test: add'], at('2026-03-03'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md; --exclude drops files', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.tests, { lines: 5, share: 0.25 });
    assert.match(readFileSync(r.markdown, 'utf8'), /Test lines:\*\* 5 lines \(25% of lines changed\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Tests\s+5 lines \(25% of lines changed\)/);
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['test/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.tests, { lines: 2, share: 0.118 });
  });
});
