import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDocShare, computeStats as computeAllStats, DOC_DIRS, isDocPath, shownDocShare } from '../src/stats/index.js';
import { mergeHistories } from '../src/git.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, docsCard, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The one-touch files row (stats.oneTouch) is the hot-files card's lowest-priority row,
// appended after every other one (see test/one-touch.test.js); these tests are about the
// rows before it, so their stats leave it out.
const computeStats = (...args) => ({ ...computeAllStats(...args), oneTouch: null });

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

// Two hot files, one of them both a test and a doc: the hot-files card has room for both rows.
const roomy = () => [commit(1, [['src/a.js', 100, 10]]), commit(2, [['test/notes.md', 40, 2], ['src/a.js', 3, 3]])];
// A doc but no test: the docs row alone on the hot-files card.
const docsOnly = () => [commit(1, [['src/a.js', 100, 10]]), commit(2, [['src/a.js', 3, 3], ['README.md', 8, 2]])];
// Three hot files and a top-folders list: the tests row goes to the languages card, the docs row after it.
const busy = () => [
  commit(1, [['src/a.js', 100, 10], ['src/b.js', 20, 0], ['README.md', 5, 1]]),
  commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]]),
  commit(3, [['docs/guide.md', 7, 0], ['docs/notes.txt', 2, 0]]),
];
// Tests and a co-change pair fill the hot-files card: the docs row goes to the languages card.
const paired = () => [1, 2, 3].map((i) => commit(i, [['src/a.js', 10, 1], ['test/a.md', 5, 0]]));
// Eight languages: in Turkish neither card has room.
const EXTS = ['js', 'py', 'go', 'rs', 'rb', 'java', 'md', 'json'];
const crowded = () => Array.from({ length: 8 }, (_, i) => commit(i + 1, [[`src/f${i}.${EXTS[i]}`, 10 + i, 1], [`lib/g${i}.${EXTS[(i + 3) % 8]}`, 5, 0], [`test/t${i}.test.js`, 3, 0]]));

const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgOf = (stats, id, lang = 'en', opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, lang, ...opts }).find((c) => c.id === id).svg;
const labels = (spec) => (spec.lines ?? []).map((r) => r.label);
const docsRowOf = (spec, L = en) => (spec.lines ?? []).find((r) => r.label === L.hotFiles.docs);

describe('isDocPath', () => {
  test('docs / doc directories at any depth, any file under them', () => {
    assert.deepEqual(DOC_DIRS, ['docs', 'doc']);
    for (const p of ['docs/a.txt', 'doc/a.txt', 'docs/conf.py', 'pkg/docs/x/y.png', 'src/doc/notes.txt', 'docs/api/index.html']) {
      assert.equal(isDocPath(p), true, p);
    }
  });

  test('.md, .mdx, .rst, .adoc in any letter case, anywhere', () => {
    for (const p of ['README.md', 'src/notes.md', 'CHANGELOG.MD', 'a/b.mdx', 'guide.rst', 'guide.Rst', 'manual.adoc', 'test/README.md']) {
      assert.equal(isDocPath(p), true, p);
    }
  });

  test('not docs: case-different or partial directory names, a .txt outside docs, other names', () => {
    for (const p of ['Docs/a.txt', 'DOC/a.txt', 'documentation/a.txt', 'docsite/a.txt', 'mydocs/a.txt', 'docs', 'src/doc', 'notes.txt', 'LICENSE', 'src/a.js', '.md', 'a.md.js', 'a.markdown', 'docs.js', 'src/readme']) {
      assert.equal(isDocPath(p), false, p);
    }
    for (const p of [undefined, null, '', 3, {}]) assert.equal(isDocPath(p), false);
  });
});

describe('computeDocShare', () => {
  test('lines and share of the counted lines; ignored paths left out; null with no line changed', () => {
    assert.deepEqual(computeDocShare(busy()), { lines: 15, share: 0.078 });
    assert.deepEqual(computeDocShare([commit(1, [['src/a.js', 3, 1]])]), { lines: 0, share: 0 });
    assert.equal(computeDocShare([]), null);
    assert.equal(computeDocShare([commit(1, [['logo.png', undefined, undefined]])]), null);
    // A lockfile and vendored docs are ignored, as for the hot files.
    assert.equal(computeDocShare([commit(1, [['package-lock.json', 10, 0], ['node_modules/x/README.md', 5, 0]])]), null);
    assert.deepEqual(computeDocShare([commit(1, [['README.md', 2, 0], ['vendor/x/docs/a.md', 50, 0], ['src/a.js', 2, 0]])]), { lines: 2, share: 0.5 });
  });

  test('a file that is both a test and a doc counts for both shares', () => {
    const s = computeStats(roomy(), { today: TODAY });
    assert.deepEqual(s.tests, { lines: 42, share: 0.266 });
    assert.deepEqual(s.docShare, { lines: 42, share: 0.266 });
  });

  test('share: 1 only when every line is in docs, else at most 0.999; tiny shares may round to 0', () => {
    assert.deepEqual(computeDocShare([commit(1, [['docs/a.txt', 5, 5]])]), { lines: 10, share: 1 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 9999, 0], ['src/a.js', 1, 0]])]), { lines: 9999, share: 0.999 });
    assert.deepEqual(computeDocShare([commit(1, [['a.md', 1, 0], ['src/a.js', 9999, 0]])]), { lines: 1, share: 0 });
  });

  test('multi-repo: checked on the path inside each repo, so a repo labelled "docs" is not all docs', () => {
    const merged = mergeHistories([
      { label: 'docs', commits: [commit(1, [['src/x.js', 10, 0], ['dist/b.md', 99, 0]])] },
      { label: 'web', commits: [commit(2, [['doc/y.txt', 10, 0]])] },
    ]);
    assert.deepEqual(computeDocShare(merged.commits), { lines: 10, share: 0.5 });
  });

  test('--exclude drops files before (excludeFiles)', () => {
    assert.deepEqual(computeDocShare(excludeFiles(busy(), compileExcludes(['docs/', '*.md']))), { lines: 0, share: 0 });
    assert.deepEqual(computeDocShare(excludeFiles(busy(), compileExcludes(['src/', 'test/']))), { lines: 15, share: 1 });
  });

  test('bad input never throws, never mutates', () => {
    assert.equal(computeDocShare(undefined), null);
    assert.equal(computeDocShare('nope'), null);
    assert.equal(computeDocShare([null, 7, { files: 'x' }, { files: [null, 3, { path: 3, added: 5 }, { path: 'a.md', added: 'x', removed: NaN }, { path: 'b.md', added: Infinity, removed: -4 }] }]), null);
    assert.deepEqual(computeDocShare([{ files: [{ path: 'a.md', added: 2 }, { path: 'a.js', removed: 2 }] }]), { lines: 2, share: 0.5 });
    const input = busy();
    const copy = structuredClone(input);
    computeDocShare(input);
    assert.deepEqual(input, copy);
  });

  test('computeStats puts docShare right after tests; stats.json keeps exactly {lines, share} (null too)', () => {
    const stats = computeStats(busy(), { today: TODAY });
    const keys = Object.keys(stats);
    assert.equal(keys[keys.indexOf('tests') + 1], 'docShare');
    assert.deepEqual(Object.keys(stats.docShare), ['lines', 'share']);
    assert.equal(computeStats([], { today: TODAY }).docShare, null);
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.docShare, { lines: 15, share: 0.078 });
    assert.equal(JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' })).stats.docShare, null);
  });
});

describe('shownDocShare', () => {
  test('whole percent from the exact ratio, never 100% short of all; null without a doc line', () => {
    assert.deepEqual(shownDocShare({ lines: 42, share: 0.266 }), { lines: 42, percent: 27 });
    assert.deepEqual(shownDocShare({ lines: 10, share: 1 }), { lines: 10, percent: 100 });
    assert.deepEqual(shownDocShare({ lines: 9999, share: 0.999 }), { lines: 9999, percent: 99 });
    assert.deepEqual(shownDocShare({ lines: 1, share: 0 }), { lines: 1, percent: 0 });
    // 9 of 2000 lines is 0.45%: the 3-decimal share (0.005) would read 1%, the exact one <1%.
    const d = computeDocShare([commit(1, [['a.md', 9, 0], ['src/a.js', 1991, 0]])]);
    assert.deepEqual(d, { lines: 9, share: 0.005 });
    assert.deepEqual(shownDocShare(d), { lines: 9, percent: 0 });
    for (const v of [null, undefined, 'x', 3, {}, { lines: 0, share: 0 }, { lines: -2, share: 0.5 }, { lines: 1.5, share: 0.5 }, { lines: '3', share: 0.5 }]) {
      assert.equal(shownDocShare(v), null, JSON.stringify(v));
    }
    assert.deepEqual(shownDocShare({ lines: 5, share: 7 }), { lines: 5, percent: 99 });
  });
});

describe('cards', () => {
  test('a "Docs" row right after the "Tests" row on the hot-files card when there is room, en and tr', () => {
    const s = computeStats(roomy(), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const hot = specOf(s, 'hot-files', lang);
      assert.deepEqual(labels(hot), [L.hotFiles.tests, L.hotFiles.docs], lang);
      assert.equal(docsRowOf(hot, L).value, lang === 'en' ? '42 lines · 27%' : '42 satır · %27');
      assert.equal(docsRowOf(specOf(s, 'languages', lang), L), undefined);
      assert.equal(docsCard(s, { L, repos: null }), 'hot-files');
    }
  });

  test('without a tests row: alone on the hot-files card', () => {
    const s = computeStats(docsOnly(), { today: TODAY });
    assert.deepEqual(labels(specOf(s, 'hot-files')), ['Docs']);
    assert.equal(docsRowOf(specOf(s, 'hot-files')).value, '10 lines · 8%');
  });

  test('follows the tests row to the languages card', () => {
    const s = computeStats(busy(), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      assert.deepEqual(labels(specOf(s, 'hot-files', lang)), [], lang);
      assert.deepEqual(labels(specOf(s, 'languages', lang)), [L.hotFiles.tests, L.hotFiles.docs], lang);
    }
  });

  test('on the other card when the tests row and the co-change pair fill the first', () => {
    const s = computeStats(paired(), { today: TODAY });
    assert.deepEqual(labels(specOf(s, 'hot-files')), ['Tests', 'Changed together']);
    assert.deepEqual(labels(specOf(s, 'languages')), ['Docs']);
    assert.equal(docsCard(s, { L: en, repos: null }), 'languages');
  });

  test('never displaces anything: every other row, chart and size as without it, on one card at most', () => {
    const cases = [roomy(), docsOnly(), busy(), paired(), crowded(), [...busy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]];
    for (const commits of cases) {
      const s = computeStats(commits, { today: TODAY });
      const without = { ...s, docShare: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        for (const opts of [{}, { colorTheme: 'mono' }]) {
          let shown = 0;
          for (const id of ['hot-files', 'languages']) {
            const spec = specOf(s, id, lang, opts);
            const base = specOf(without, id, lang, opts);
            const row = docsRowOf(spec, L);
            if (!row) {
              assert.equal(svgOf(s, id, lang, opts), svgOf(without, id, lang, opts), `${id} ${lang}`);
              continue;
            }
            shown += 1;
            const a = layoutCard(spec);
            const b = layoutCard(base);
            assert.deepEqual(a.drawnCharts, b.drawnCharts, id);
            assert.ok(a.shrinkSteps <= b.shrinkSteps, id);
            assert.deepEqual(spec.lines.filter((r) => r !== row), base.lines ?? []);
            // Right after the tests row when the card has one.
            const at = spec.lines.indexOf(row);
            const t = spec.lines.findIndex((r) => r.label === L.hotFiles.tests);
            if (t >= 0) assert.equal(at, t + 1, id);
          }
          assert.ok(shown <= 1, lang);
        }
      }
    }
  });

  test('no row without a doc line, or for a malformed / missing value: cards byte-identical', () => {
    const s = computeStats(roomy(), { today: TODAY });
    const without = { ...s, docShare: null };
    for (const docShare of [undefined, { lines: 0, share: 0 }, 'x', { lines: -1, share: 2 }]) {
      assert.equal(svgOf({ ...s, docShare }, 'hot-files'), svgOf(without, 'hot-files'), JSON.stringify(docShare));
      assert.equal(svgOf({ ...s, docShare }, 'languages'), svgOf(without, 'languages'));
    }
    assert.notEqual(svgOf(s, 'hot-files'), svgOf(without, 'hot-files'));
  });

  test('"<1%" for a tiny share; the short value when the full one would be cut; none when even that is', () => {
    const s = computeStats(docsOnly(), { today: TODAY });
    assert.equal(docsRowOf(specOf({ ...s, docShare: { lines: 3, share: 0 } }, 'hot-files')).value, '3 lines · <1%');
    assert.equal(docsRowOf(specOf({ ...s, docShare: { lines: 123456789, share: 0.5 } }, 'hot-files')).value, '123,456,789 · 50%');
    const huge = { ...s, docShare: { lines: 123456789012, share: 0.5 } };
    assert.equal(docsRowOf(specOf(huge, 'hot-files')), undefined);
    assert.equal(docsRowOf(specOf(huge, 'languages')), undefined);
  });

  test('the card description reads the row as a sentence', () => {
    const s = computeStats(docsOnly(), { today: TODAY });
    assert.match(cardDescription(specOf(s, 'hot-files')), /10 lines changed in docs \(8% of lines changed\)\./);
    assert.match(cardDescription(specOf(s, 'hot-files', 'tr')), /Dokümanlarda 10 satır değişti \(değişen satırların %8 kadarı\)\./);
  });

  test('no hot files (empty history): no row anywhere', () => {
    const s = { ...computeStats([], { today: TODAY }), docShare: { lines: 4, share: 0.5 } };
    assert.equal(docsRowOf(specOf(s, 'hot-files')), undefined);
    assert.equal(docsRowOf(specOf(s, 'languages')), undefined);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line right after the tests line, en and tr; none without a doc line', () => {
    const s = computeStats(busy(), { today: TODAY });
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Tests {8}42 lines \(22% of lines changed\)\n {2}Docs {9}15 lines \(8% of lines changed\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Dokümanlar\s+15 satır \(değişen satırların %8 kadarı\)\n/);
    assert.match(formatSummary({ ...s, docShare: { lines: 2, share: 0.0001 } }, { repoName: 'demo', today: TODAY }), /Docs\s+2 lines \(<1% of lines changed\)/);
    for (const docShare of [null, { lines: 0, share: 0 }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, docShare }, { repoName: 'demo', today: TODAY }), /\n {2}Docs /);
    }
  });

  test('wrapped.md item after the test lines, en and tr; none without a doc line', () => {
    const s = computeStats(busy(), { today: TODAY });
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /- \*\*Test lines:\*\* 42 lines \(22% of lines changed\)\n- \*\*Doc lines:\*\* 15 lines \(8% of lines changed\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Doküman satırları:\*\* 15 satır \(değişen satırların %8 kadarı\)/);
    assert.doesNotMatch(buildMarkdown({ ...s, docShare: { lines: 0, share: 0 } }, { repoName: 'demo', today: TODAY }), /Doc lines/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.hotFiles.docs, 'string');
      for (const k of ['docsValue', 'docsShort', 'docsDescription']) assert.equal(typeof L.hotFiles[k](3, '5%'), 'string', k);
      assert.equal(typeof L.recap.docs, 'string');
      assert.ok(L.recap.docs.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.docs, 'string');
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
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-docs-share-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    write(repo, 'src/a.js', lines(15));
    write(repo, 'package-lock.json', lines(400));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: a'], at('2026-03-02'));
    write(repo, 'README.md', lines(3));
    write(repo, 'docs/notes.txt', lines(2));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'docs: add'], at('2026-03-03'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md; --exclude drops files', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.docShare, { lines: 5, share: 0.25 });
    assert.match(readFileSync(r.markdown, 'utf8'), /Doc lines:\*\* 5 lines \(25% of lines changed\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Docs\s+5 lines \(25% of lines changed\)/);
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.docShare, { lines: 3, share: 0.167 });
  });
});
