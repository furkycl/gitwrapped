// Extra edge cases for the docs share (stats.docShare, src/stats/docs.js) beyond
// test/docs-share.test.js: path shapes, ignore rules, renames / binary files, multi-repo
// labels, --exclude, rounding at the ends, malformed values and the card / recap /
// wrapped.md output.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDocShare, computeStats, computeTests, isDocPath, isTestPath, shownDocShare } from '../src/stats/index.js';
import { mergeHistories, parseLog } from '../src/git.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, docsCard, layoutCard } from '../src/cards/index.js';
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
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});

const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgOf = (stats, id, lang = 'en', opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, ...opts }).find((c) => c.id === id).svg;
const docsRowOf = (spec, L = en) => (spec.lines ?? []).find((r) => r.label === L.hotFiles.docs);
const docsRowsOn = (stats, lang = 'en', opts = {}) =>
  specs(stats, lang, opts).filter((c) => (c.spec.lines ?? []).some((r) => r.label === LANGS[lang].hotFiles.docs)).map((c) => c.id);

describe('isDocPath: more path shapes', () => {
  test('a file named "docs" / "doc" (any depth) is not a doc; a file under one is', () => {
    for (const p of ['docs', 'doc', 'src/docs', 'a/b/doc', 'docs.txt', 'doc.js', 'docs-old/a.txt', 'old-docs/a.txt', 'Doc/a.txt', 'DOCS/a.txt']) {
      assert.equal(isDocPath(p), false, p);
    }
    for (const p of ['docs/docs', 'doc/doc', 'docs/x', 'a/docs/b/c/d.bin', 'docs/doc/x.js', 'doc/docs/README', 'packages/ui/docs/api.json']) {
      assert.equal(isDocPath(p), true, p);
    }
  });

  test('nested and repeated doc directories', () => {
    for (const p of ['docs/docs/a.txt', 'a/doc/b/docs/c.txt', 'x/y/z/docs/w.html', 'Docs/docs/a.txt']) assert.equal(isDocPath(p), true, p);
  });

  test('doc extensions: name required before the dot, any letter case, only as the last suffix', () => {
    for (const p of ['docs.md', 'doc.rst', 'a.MD', 'a.Md', 'b.MDX', 'c.ADOC', 'd.RsT', 'x.md.md', '.github/CONTRIBUTING.md', '..md', '.x.md', 'a b.md', 'ünï.md']) {
      assert.equal(isDocPath(p), true, p);
    }
    for (const p of ['.md', '.MD', '.mdx', '.rst', '.adoc', 'src/.md', 'a.md~', 'a.md.bak', 'a.mdown', 'a.markdown', 'a.txt', 'a.rest', 'a.asciidoc', 'md', 'a.md/', 'a.md ', 'amd', 'a_md']) {
      assert.equal(isDocPath(p), false, p);
    }
  });

  test('a bare ".md" inside a docs directory is still a doc (by the directory)', () => {
    assert.equal(isDocPath('docs/.md'), true);
    assert.equal(isDocPath('src/.md'), false);
  });

  test('Windows-style backslash paths: only the extension rule applies (git always reports "/")', () => {
    assert.equal(isDocPath('docs\\a.txt'), false);
    assert.equal(isDocPath('src\\docs\\a.txt'), false);
    assert.equal(isDocPath('docs\\guide.md'), true);
    assert.equal(isDocPath('C:\\repo\\README.MD'), true);
  });

  test('leading, trailing and doubled slashes never throw', () => {
    assert.equal(isDocPath('/docs/a.txt'), true);
    assert.equal(isDocPath('docs//a.txt'), true);
    assert.equal(isDocPath('docs/'), true);
    assert.equal(isDocPath('/'), false);
    assert.equal(isDocPath('//'), false);
  });

  test('test and doc are independent: a file can be both, either or neither', () => {
    const cases = [['test/README.md', true, true], ['docs/a.test.js', true, true], ['test/a.js', true, false], ['docs/a.js', false, true], ['src/a.js', false, false]];
    for (const [p, t, d] of cases) {
      assert.equal(isTestPath(p), t, `test ${p}`);
      assert.equal(isDocPath(p), d, `doc ${p}`);
    }
  });

  test('non-string inputs, including objects with toString, are not docs', () => {
    for (const p of [['docs', 'a.md'], { toString: () => 'a.md' }, new String('a.md'), Symbol('a.md'), 0, true, NaN]) assert.equal(isDocPath(p), false);
  });
});

describe('computeDocShare: more inputs', () => {
  test('lockfiles, generated and vendored files under docs are ignored', () => {
    const commits = [commit(1, [
      ['docs/package-lock.json', 500, 0],
      ['docs/yarn.lock', 500, 0],
      ['docs/node_modules/x/README.md', 500, 0],
      ['vendor/docs/a.md', 500, 0],
      ['dist/docs/a.md', 500, 0],
      ['docs/guide.md', 4, 0],
      ['src/a.js', 4, 0],
    ])];
    assert.deepEqual(computeDocShare(commits), { lines: 4, share: 0.5 });
  });

  test('a docs directory that is itself a build output at a monorepo root is ignored like the hot files', () => {
    // packages/x/dist/... is ignored by isIgnoredPath; packages/x/docs/... is not.
    const commits = [commit(1, [['packages/x/dist/README.md', 50, 0], ['packages/x/docs/a.txt', 3, 0], ['packages/x/src/a.js', 1, 0]])];
    assert.deepEqual(computeDocShare(commits), { lines: 3, share: 0.75 });
  });

  test('a rename (--no-renames: delete + add) moves lines between doc and non-doc', () => {
    // docs/a.txt -> notes/a.txt: the deletion counts as docs, the addition does not.
    const commits = [commit(1, [['docs/a.txt', 0, 10], ['notes/a.txt', 10, 0]])];
    assert.deepEqual(computeDocShare(commits), { lines: 10, share: 0.5 });
  });

  test('binary files ("-" counts from git) add 0 lines, under docs or not', () => {
    const out = [
      `${H(1)}\x1fAda\x1fada@example.com\x1f2026-03-02T10:00:00+00:00\x1f\x1ffeat: a\n`,
      '-\t-\tdocs/logo.png',
      '3\t1\tsrc/a.js',
      '2\t0\tdocs/a.md',
      '',
    ].join('\0');
    const commits = parseLog(out);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].files.length, 3);
    assert.deepEqual(computeDocShare(commits), { lines: 2, share: 0.333 });
    // Only a binary doc changed: no line to take a share of.
    assert.equal(computeDocShare([commit(1, [['docs/logo.png', 0, 0]])]), null);
    assert.equal(computeDocShare([{ files: [{ path: 'docs/logo.png', added: 0, removed: 0, binary: true }] }]), null);
  });

  test('merge commits with no files and commits without files do not count', () => {
    const commits = [commit(1, [], { parents: ['a', 'b'] }), commit(2, [['README.md', 1, 1]]), { hash: H(3) }];
    assert.deepEqual(computeDocShare(commits), { lines: 2, share: 1 });
  });

  test('a path listed twice in one commit counts its lines twice (as hot files sum them)', () => {
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 2, 0], ['a.md', 2, 0], ['a.js', 4, 0]])]), { lines: 4, share: 0.5 });
  });

  test('rounding near 0 and 1: 0.0005 rounds to 0.001; 0.9995 stays at 0.999; 1 only for all', () => {
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 1, 0], ['a.js', 1999, 0]])]), { lines: 1, share: 0.001 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 1, 0], ['a.js', 2001, 0]])]), { lines: 1, share: 0 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 1999, 0], ['a.js', 1, 0]])]), { lines: 1999, share: 0.999 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 999999, 0], ['a.js', 1, 0]])]), { lines: 999999, share: 0.999 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 3, 0], ['docs/b', 0, 4]])]), { lines: 7, share: 1 });
  });

  test('shares stay in 0..1 and lines never exceed all counted lines (random histories)', () => {
    let seed = 7;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const paths = ['docs/a.txt', 'README.md', 'src/a.js', 'test/a.md', 'yarn.lock', 'dist/x.md', 'doc', 'docs', 'lib/.md', 'x.RST'];
    for (let k = 0; k < 200; k++) {
      const commits = Array.from({ length: 1 + rnd(5) }, (_, i) => commit(i, Array.from({ length: rnd(4) }, () => [paths[rnd(paths.length)], rnd(50), rnd(50)])));
      const d = computeDocShare(commits);
      if (d === null) continue;
      assert.ok(d.share >= 0 && d.share <= 1, JSON.stringify(d));
      assert.ok(Number.isInteger(d.lines) && d.lines >= 0);
      const shown = shownDocShare(d);
      if (d.lines === 0) assert.equal(shown, null);
      else assert.ok(shown.percent >= 0 && shown.percent <= 100);
      if (shown && shown.percent === 100) assert.equal(d.share, 1);
    }
  });

  test('multi-repo: a repo labelled "docs" or "doc" counts only its real doc files', () => {
    const merged = mergeHistories([
      { label: 'docs', commits: [commit(1, [['src/x.js', 10, 0], ['docs/y.txt', 10, 0]])] },
      { label: 'doc', commits: [commit(2, [['a.js', 10, 0], ['README.MD', 10, 0]])] },
    ]);
    // Paths are "docs/src/x.js", "docs/docs/y.txt", "doc/a.js", "doc/README.MD".
    assert.deepEqual(computeDocShare(merged.commits), { lines: 20, share: 0.5 });
  });

  test('multi-repo: a repo labelled like an ignored dir ("vendor", "dist") still counts its files', () => {
    const merged = mergeHistories([
      { label: 'dist', commits: [commit(1, [['README.md', 10, 0], ['src/a.js', 10, 0]])] },
      { label: 'vendor', commits: [commit(2, [['docs/a.txt', 10, 0], ['node_modules/a.md', 99, 0]])] },
    ]);
    assert.deepEqual(computeDocShare(merged.commits), { lines: 20, share: 0.667 });
  });

  test('--exclude: patterns on docs, extensions and only some doc files', () => {
    const commits = () => [commit(1, [['docs/a.txt', 10, 0], ['README.md', 10, 0], ['src/a.js', 20, 0], ['src/docs/b.txt', 10, 0]])];
    assert.deepEqual(computeDocShare(commits()), { lines: 30, share: 0.6 });
    // "docs/" (no other slash) matches a docs directory at any depth, as in gitignore.
    assert.deepEqual(computeDocShare(excludeFiles(commits(), compileExcludes(['docs/']))), { lines: 10, share: 0.333 });
    assert.deepEqual(computeDocShare(excludeFiles(commits(), compileExcludes(['/docs/']))), { lines: 20, share: 0.5 });
    assert.deepEqual(computeDocShare(excludeFiles(commits(), compileExcludes(['*.md']))), { lines: 20, share: 0.5 });
    assert.deepEqual(computeDocShare(excludeFiles(commits(), compileExcludes(['**/docs/**', '*.md']))), { lines: 0, share: 0 });
    // Everything excluded: nothing to take a share of.
    assert.equal(computeDocShare(excludeFiles(commits(), compileExcludes(['docs/', 'src/', '*.md']))), null);
  });

  test('--exclude in a multi-repo run where the repo is labelled "docs"', () => {
    const merged = mergeHistories([
      { label: 'docs', commits: [commit(1, [['src/x.js', 10, 0], ['guide.md', 10, 0]])] },
      { label: 'web', commits: [commit(2, [['docs/y.txt', 10, 0], ['src/z.js', 10, 0]])] },
    ]);
    // "docs/" (a repo-relative pattern) drops web's docs/ directory, never repo docs entirely.
    const kept = excludeFiles(merged.commits, compileExcludes(['docs/']));
    const d = computeDocShare(kept);
    assert.ok(d !== null);
    assert.equal(d.lines, 10, JSON.stringify(d));
  });

  test('the exact share survives computeStats but not a JSON round trip (falls back to share)', () => {
    const s = computeStats([commit(1, [['a.md', 9, 0], ['src/a.js', 1991, 0]])], { today: TODAY });
    assert.deepEqual(shownDocShare(s.docShare), { lines: 9, percent: 0 });
    const back = JSON.parse(JSON.stringify(s.docShare));
    assert.deepEqual(back, { lines: 9, share: 0.005 });
    assert.deepEqual(shownDocShare(back), { lines: 9, percent: 1 });
    // A spread copy keeps lines / share, loses the exact ratio, never throws.
    assert.deepEqual(shownDocShare({ ...s.docShare }), { lines: 9, percent: 1 });
  });
});

describe('shownDocShare: malformed values', () => {
  test('lines must be a positive safe integer', () => {
    for (const lines of [0, -1, 1.5, NaN, Infinity, -Infinity, '3', null, undefined, true, [3], 2 ** 53, 1e300]) {
      assert.equal(shownDocShare({ lines, share: 0.5 }), null, String(lines));
    }
    assert.deepEqual(shownDocShare({ lines: Number.MAX_SAFE_INTEGER, share: 0.5 }), { lines: Number.MAX_SAFE_INTEGER, percent: 50 });
  });

  test('share outside 0..1 or not a number is clamped / read as 0, never 100% short of all', () => {
    const cases = [
      [-0.5, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0], ['0.5', 0], [null, 0], [undefined, 0], [0.9999, 99], [0.995, 99], [0.994, 99], [0.004, 0], [0.005, 1], [1.0000001, 99], [1, 100], [0, 0],
    ];
    for (const [share, percent] of cases) {
      assert.deepEqual(shownDocShare({ lines: 4, share }), { lines: 4, percent }, String(share));
    }
  });

  test('arrays, functions, primitives and frozen objects never throw', () => {
    for (const v of [[], [1, 2], () => 1, 'docs', 42, true, Symbol('x'), Object.freeze({ lines: 3, share: 0.25 }), Object.create(null)]) {
      assert.doesNotThrow(() => shownDocShare(v));
    }
    assert.deepEqual(shownDocShare(Object.freeze({ lines: 3, share: 0.25 })), { lines: 3, percent: 25 });
    assert.equal(shownDocShare(Object.create(null)), null);
  });

  test('extra keys are ignored', () => {
    assert.deepEqual(shownDocShare({ lines: 3, share: 0.25, extra: 'x' }), { lines: 3, percent: 25 });
  });
});

describe('cards: more layouts', () => {
  // Every line in docs: the hot-files card shows the doc row at 100%.
  const allDocs = () => [commit(1, [['docs/a.txt', 10, 0]]), commit(2, [['README.md', 5, 5]])];
  // Every line both a test and a doc.
  const both = () => [commit(1, [['test/a.md', 10, 0]]), commit(2, [['tests/README.md', 5, 5]])];

  test('100% and "<1%" values, en and tr', () => {
    const s = computeStats(allDocs(), { today: TODAY });
    assert.deepEqual(s.docShare, { lines: 20, share: 1 });
    assert.equal(docsRowOf(specOf(s, 'hot-files')).value, '20 lines · 100%');
    assert.equal(docsRowOf(specOf(s, 'hot-files', 'tr'), tr).value, '20 satır · %100');
    const tiny = { ...s, docShare: { lines: 1, share: 0.001 } };
    assert.equal(docsRowOf(specOf(tiny, 'hot-files')).value, '1 line · <1%');
    assert.equal(docsRowOf(specOf(tiny, 'hot-files', 'tr'), tr).value, '1 satır · <%1');
  });

  test('both a tests row and a docs row at 100% when every line is in a test doc', () => {
    const s = computeStats(both(), { today: TODAY });
    assert.deepEqual(s.tests, { lines: 20, share: 1 });
    assert.deepEqual(s.docShare, { lines: 20, share: 1 });
    const hot = specOf(s, 'hot-files');
    const ls = (hot.lines ?? []).map((r) => r.label);
    assert.ok(ls.includes('Tests'));
    assert.equal(ls[ls.indexOf('Tests') + 1], 'Docs');
  });

  test('docs row never on more than one card, and docsCard agrees with where it is', () => {
    const histories = [
      allDocs(),
      both(),
      [commit(1, [['a.js', 1, 0], ['docs/a.txt', 1, 0]])],
      Array.from({ length: 6 }, (_, i) => commit(i + 1, [[`src/f${i}.js`, 10, 1], [`docs/d${i}.md`, 3, 0], [`test/t${i}.test.js`, 2, 0]])),
    ];
    for (const commits of histories) {
      const s = computeStats(commits, { today: TODAY });
      for (const lang of ['en', 'tr']) {
        const on = docsRowsOn(s, lang);
        assert.ok(on.length <= 1, `${lang} ${on}`);
        const expected = docsCard(s, { L: LANGS[lang], repos: null });
        assert.deepEqual(on, expected ? [expected] : [], lang);
      }
    }
  });

  test('crowded cards: no rows displaced, charts and sizes kept, for many shapes (en, tr, mono)', () => {
    const EXTS = ['js', 'py', 'go', 'rs', 'rb', 'java', 'md', 'json', 'ts', 'c'];
    for (let n = 1; n <= 10; n++) {
      const commits = Array.from({ length: n }, (_, i) =>
        commit(i + 1, [[`src/f${i}.${EXTS[i % EXTS.length]}`, 10 + i, 1], [`docs/g${i}.md`, 5, 0], [`test/t${i}.test.js`, 3, 0], ['src/shared.js', 1, 1]]));
      const s = computeStats(commits, { today: TODAY });
      const without = { ...s, docShare: null };
      for (const lang of ['en', 'tr']) {
        for (const opts of [{}, { colorTheme: 'mono' }]) {
          for (const id of ['hot-files', 'languages']) {
            const spec = specOf(s, id, lang, opts);
            const base = specOf(without, id, lang, opts);
            const row = docsRowOf(spec, LANGS[lang]);
            if (!row) {
              assert.equal(svgOf(s, id, lang, opts), svgOf(without, id, lang, opts), `${n} ${id} ${lang}`);
              continue;
            }
            assert.deepEqual(spec.lines.filter((r) => r !== row), base.lines ?? [], `${n} ${id} ${lang}`);
            assert.ok(spec.lines.length <= 6);
            const a = layoutCard(spec);
            const b = layoutCard(base);
            assert.deepEqual(a.drawnCharts, b.drawnCharts);
            assert.ok(a.shrinkSteps <= b.shrinkSteps);
          }
        }
      }
    }
  });

  test('every other card is byte-identical with and without docShare', () => {
    const commits = [commit(1, [['src/a.js', 100, 10]]), commit(2, [['README.md', 8, 2], ['src/a.js', 3, 3]])];
    const s = computeStats(commits, { today: TODAY });
    const without = { ...s, docShare: null };
    for (const lang of ['en', 'tr']) {
      const a = buildCards(s, { repoName: 'demo', today: TODAY, lang });
      const b = buildCards(without, { repoName: 'demo', today: TODAY, lang });
      assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
      for (let i = 0; i < a.length; i++) {
        if (a[i].id === docsCard(s, { L: LANGS[lang], repos: null })) continue;
        assert.equal(a[i].svg, b[i].svg, `${lang} ${a[i].id}`);
      }
    }
  });

  test('null docShare: hot-files and languages SVGs byte-identical to a stats object without the key at all', () => {
    const commits = [commit(1, [['src/a.js', 100, 10]]), commit(2, [['README.md', 8, 2]])];
    const s = { ...computeStats(commits, { today: TODAY }), docShare: null };
    const { docShare: _, ...noKey } = s;
    for (const lang of ['en', 'tr']) {
      for (const id of ['hot-files', 'languages']) assert.equal(svgOf(s, id, lang), svgOf(noKey, id, lang), `${id} ${lang}`);
    }
  });

  test('multi-repo: a "docs" repo label does not put a 100% docs row on the card', () => {
    const merged = mergeHistories([
      { label: 'docs', commits: [commit(1, [['src/x.js', 10, 0]])] },
      { label: 'web', commits: [commit(2, [['src/y.js', 10, 0]])] },
    ]);
    const s = computeStats(merged.commits, { today: TODAY });
    assert.deepEqual(s.docShare, { lines: 0, share: 0 });
    assert.deepEqual(docsRowsOn(s), []);
  });
});

describe('recap and wrapped.md: more cases', () => {
  const docsNoTests = () => [commit(1, [['src/a.js', 100, 10]]), commit(2, [['README.md', 8, 2]])];

  test('a docs line without a tests line, en and tr', () => {
    const s = computeStats(docsNoTests(), { today: TODAY });
    assert.equal(s.tests.lines, 0);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Docs\s+10 lines \(8% of lines changed\)\n/);
    assert.doesNotMatch(out, /\n {2}Tests /);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Dokümanlar\s+10 satır \(değişen satırların %8 kadarı\)\n/);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /- \*\*Doc lines:\*\* 10 lines \(8% of lines changed\)\n/);
    assert.doesNotMatch(md, /Test lines/);
  });

  test('singular "line", 100%, "<1%" and a big number, en and tr', () => {
    const s = computeStats(docsNoTests(), { today: TODAY });
    const at = (docShare, lang = 'en') => [formatSummary({ ...s, docShare }, { repoName: 'demo', today: TODAY, lang }), buildMarkdown({ ...s, docShare }, { repoName: 'demo', today: TODAY, lang })];
    let [out, md] = at({ lines: 1, share: 0.0001 });
    assert.match(out, /Docs\s+1 line \(<1% of lines changed\)/);
    assert.match(md, /Doc lines:\*\* 1 line \(<1% of lines changed\)/);
    [out, md] = at({ lines: 20, share: 1 });
    assert.match(out, /Docs\s+20 lines \(100% of lines changed\)/);
    assert.match(md, /Doc lines:\*\* 20 lines \(100% of lines changed\)/);
    [out, md] = at({ lines: 1234567, share: 0.9999 });
    assert.match(out, /Docs\s+1,234,567 lines \(99% of lines changed\)/);
    assert.match(md, /Doc lines:\*\* 1,234,567 lines \(99% of lines changed\)/);
    [out, md] = at({ lines: 1, share: 0.0001 }, 'tr');
    assert.match(out, /Dokümanlar\s+1 satır \(değişen satırların <%1 kadarı\)/);
    assert.match(md, /Doküman satırları:\*\* 1 satır \(değişen satırların <%1 kadarı\)/);
  });

  test('malformed docShare never throws and shows nothing in recap / wrapped.md / cards', () => {
    const s = computeStats(docsNoTests(), { today: TODAY });
    for (const docShare of ['x', 7, [], [{ lines: 3 }], { lines: '3', share: 0.5 }, { lines: 3.5, share: 0.5 }, { lines: -3, share: 0.5 }, { share: 0.5 }, true]) {
      const bad = { ...s, docShare };
      assert.doesNotMatch(formatSummary(bad, { repoName: 'demo', today: TODAY }), /\n {2}Docs /, JSON.stringify(docShare));
      assert.doesNotMatch(buildMarkdown(bad, { repoName: 'demo', today: TODAY }), /Doc lines/);
      assert.deepEqual(docsRowsOn(bad), []);
    }
  });

  test('tr strings: label column fits; values use the tr percent and number style', () => {
    assert.equal(tr.hotFiles.docsValue(1234, '%23'), '1.234 satır · %23');
    assert.equal(tr.hotFiles.docsShort(1234, '%23'), '1.234 · %23');
    assert.equal(tr.hotFiles.docsDescription(1, '%5'), 'Dokümanlarda 1 satır değişti (değişen satırların %5 kadarı)');
    assert.equal(en.hotFiles.docsValue(1, '5%'), '1 line · 5%');
    assert.equal(en.hotFiles.docsDescription(1234, '5%'), '1,234 lines changed in docs (5% of lines changed)');
    assert.ok(tr.recap.docs.length < tr.recap.labelWidth);
  });
});

describe('git (real repo): renames, binary docs, letter case', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, data) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), data);
  };
  const lines = (n, p = 'line') => Array.from({ length: n }, (_, i) => `${p} ${i}`).join('\n') + '\n';
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-docs-extra-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'diff.renames', 'true']);
    write(repo, 'src/a.js', lines(10));
    write(repo, 'docs/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3, 0]));
    write(repo, 'Docs/upper.txt', lines(4));
    write(repo, 'NOTES.MD', lines(6));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: a'], at('2026-03-02'));
    // A rename out of docs/: with --no-renames, a delete (docs) plus an add (not docs).
    write(repo, 'docs/move.txt', lines(5, 'm'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'docs: move'], at('2026-03-03'));
    mkdirSync(join(repo, 'notes'));
    git(repo, ['mv', 'docs/move.txt', 'notes/move.txt']);
    git(repo, ['commit', '-q', '-m', 'chore: rename'], at('2026-03-04'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('binary doc adds 0, "Docs/" is not a doc dir, ".MD" is; a rename is delete + add', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    // Counted lines: src/a.js 10, Docs/upper.txt 4, NOTES.MD 6, docs/move.txt +5, then -5, notes/move.txt +5 = 35.
    // Doc lines: NOTES.MD 6 + docs/move.txt 10 = 16 → 16/35 = 0.457.
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.docShare, { lines: 16, share: 0.457 });
    assert.match(readFileSync(r.markdown, 'utf8'), /Doc lines:\*\* 16 lines \(46% of lines changed\)/);
    assert.deepEqual(JSON.parse(buildStatsJson({ stats: r.stats, repoName: 'app' })).stats.docShare, { lines: 16, share: 0.457 });
  });

  test('--exclude "*.MD" vs "*.md": exclude matching follows its own case rules, the share follows the files kept', async () => {
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/**', 'NOTES.MD'] }, { today: TODAY });
    // Left: src/a.js 10, Docs/upper.txt 4, notes/move.txt 5 → no doc lines.
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.docShare, { lines: 0, share: 0 });
  });
});
