import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeHotFiles, computeOneTouch, computeStats, fileTouches, shownOneTouch } from '../src/stats/index.js';
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
  files: files.map(([path, added = 1, removed = 0]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});
const merge = (i, files = []) => commit(i, files, { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` });

// Two files, one touched once: the hot-files card has room for the row.
const roomy = () => [commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 3, 0]])];
// Many files across folders, a test file and a co-change pair: the hot-files card is full.
const crowded = () => Array.from({ length: 10 }, (_, i) => commit(i + 1, [['src/a.js', 5, 1], [`lib/f${i}.js`, 3, 0], ['test/x.test.js', 2, 0]]));

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specOf = (stats, id, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts)).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isRow = (r, L = en) => [L.hotFiles.oneTouch, L.hotFiles.oneTouchLabelShort].includes(r?.label);
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isRow(r, L));

describe('computeOneTouch', () => {
  test('distinct changed files touched by exactly one non-merge commit; share of all changed files', () => {
    const commits = [
      commit(1, [['src/a.js'], ['src/b.js'], ['README.md']]),
      commit(2, [['src/a.js'], ['src/a.js']]), // listed twice in one commit: one touch
      commit(3, [['src/c.js']]),
      commit(4, []),
    ];
    // a.js: 2 touches; b.js, README.md, c.js: 1 each.
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 3, share: 0.75 });
  });

  test('merge commits never count, even with files', () => {
    const commits = [commit(1, [['src/a.js']]), merge(2, [['src/a.js'], ['src/m.js']])];
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 1, share: 1 });
    // A subject-only merge (no parents info) is a merge too.
    const bare = { hash: H(3), subject: "Merge branch 'x'", files: [{ path: 'src/a.js' }] };
    assert.deepEqual({ ...computeOneTouch([commit(1, [['src/a.js']]), bare]) }, { files: 1, share: 1 });
  });

  test('ignored paths (lockfiles, build output, vendored, minified, snapshots) are left out, as for hot files', () => {
    const commits = [commit(1, [['src/a.js'], ['package-lock.json'], ['dist/app.js'], ['vendor/x.go'], ['web/app.min.js'], ['node_modules/x/i.js'], ['__snapshots__/a.snap']]), commit(2, [['src/a.js']])];
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 0, share: 0 });
  });

  test('--exclude drops files first (excludeFiles)', () => {
    const commits = [commit(1, [['src/a.js'], ['docs/x.md']]), commit(2, [['src/a.js'], ['src/b.js']])];
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 2, share: 0.667 });
    assert.deepEqual({ ...computeOneTouch(excludeFiles(commits, compileExcludes(['docs/']))) }, { files: 1, share: 0.5 });
    assert.equal(computeOneTouch(excludeFiles(commits, compileExcludes(['*.js', 'docs/']))), null);
  });

  test('renames as hot files see them (--no-renames): the old path and the new one, each a touch', () => {
    const commits = [
      commit(1, [['src/old.js', 10, 0]]),
      commit(2, [['src/old.js', 0, 10], ['src/new.js', 10, 0]]), // git mv src/old.js src/new.js
      commit(3, [['src/new.js', 1, 1]]),
      commit(4, [['src/x.js', 1, 0]]),
      commit(5, [['src/x.js', 0, 1], ['src/y.js', 1, 0]]), // x.js renamed to y.js, never edited again
    ];
    // old.js 2, new.js 2, x.js 2, y.js 1.
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 1, share: 0.25 });
  });

  test('multi-repo: the same path in two repos is two files; ignore rules apply at each repo root', () => {
    const commits = [
      commit(1, [['api/README.md'], ['api/dist/x.js']], { repo: 'api' }),
      commit(2, [['web/README.md']], { repo: 'web' }),
      commit(3, [['web/src/a.js']], { repo: 'web' }),
      commit(4, [['web/src/a.js']], { repo: 'web' }),
    ];
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 2, share: 0.667 });
  });

  test("a file's touches are exactly hot files' commit count (random histories)", () => {
    let seed = 7;
    const rand = (n) => {
      // mulberry32: exact 32-bit integer math (an LCG in float loses precision)
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) % n);
    };
    const pool = ['src/a.js', 'src/b.js', 'lib/c.ts', 'README.md', 'package-lock.json', 'dist/x.js', 'docs/d.md', 'test/t.test.js'];
    for (let round = 0; round < 30; round++) {
      const commits = Array.from({ length: 1 + rand(12) }, (_, i) => {
        const files = Array.from({ length: rand(4) }, () => [pool[rand(pool.length)]]);
        return rand(6) === 0 ? merge(i + 1) : commit(i + 1, files);
      });
      const hot = computeHotFiles(commits, { limit: 1000 });
      const once = hot.filter((f) => f.commits === 1).length;
      const stat = computeOneTouch(commits);
      if (hot.length === 0) assert.equal(stat, null);
      else assert.deepEqual({ ...stat }, { files: once, share: Math.min(Math.round((once / hot.length) * 1000) / 1000, once < hot.length ? 0.999 : 1) });
      assert.equal(fileTouches(commits).size, hot.length);
    }
  });

  test('null without a changed file; {0, 0} when every file was touched more than once', () => {
    assert.equal(computeOneTouch([]), null);
    assert.equal(computeOneTouch(undefined), null);
    assert.equal(computeOneTouch([commit(1, []), merge(2)]), null);
    assert.equal(computeOneTouch([commit(1, [['yarn.lock']])]), null);
    assert.deepEqual({ ...computeOneTouch([commit(1, [['a.js']]), commit(2, [['a.js']])]) }, { files: 0, share: 0 });
  });

  test('share: 3 decimals, 1 only when every file was touched once, else at most 0.999; tiny shares may round to 0', () => {
    assert.equal(computeOneTouch([commit(1, [['a.js'], ['b.js']])]).share, 1);
    const files = Array.from({ length: 2000 }, (_, i) => [`f${i}.js`]);
    const many = [commit(1, files), commit(2, [['f0.js']])];
    assert.deepEqual({ ...computeOneTouch(many) }, { files: 1999, share: 0.999 });
    const few = [commit(1, files), commit(2, files.slice(1)), commit(3, [['solo.js']])];
    assert.deepEqual({ ...computeOneTouch(few) }, { files: 2, share: 0.001 });
    const fewer = [commit(1, files), commit(2, files), commit(3, [['solo.js']])];
    assert.deepEqual({ ...computeOneTouch(fewer) }, { files: 1, share: 0 });
  });

  test('bad input never throws, never mutates', () => {
    const commits = [null, 3, 'x', commit(1, [['a.js']]), { ...commit(2, []), files: [null, { added: 1 }, { path: 4 }] }, { ...commit(3, []), files: 'x' }];
    const before = JSON.stringify(commits);
    assert.deepEqual({ ...computeOneTouch(commits) }, { files: 1, share: 1 });
    assert.equal(JSON.stringify(commits), before);
  });

  test('computeStats puts oneTouch right after coChange; stats.json keeps exactly {files, share} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('coChange') + 1], 'oneTouch');
    assert.deepEqual(Object.keys(s.oneTouch), ['files', 'share']);
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.oneTouch, { files: 1, share: 0.5 });
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo' })).stats.oneTouch, null);
    assert.deepEqual(JSON.parse(buildStatsJson({ stats: statsOf([commit(1, [['a.js']]), commit(2, [['a.js']])]), repoName: 'demo' })).stats.oneTouch, { files: 0, share: 0 });
  });
});

describe('shownOneTouch', () => {
  test('whole files and a percent from the exact ratio, never 100% short of all; null without a one-touch file', () => {
    assert.deepEqual(shownOneTouch(computeOneTouch([commit(1, [['a.js'], ['b.js'], ['c.js']]), commit(2, [['a.js']])])), { files: 2, pct: (2 / 3) * 100 });
    assert.deepEqual(shownOneTouch({ files: 2, share: 1 }), { files: 2, pct: 100 });
    assert.deepEqual(shownOneTouch({ files: 2, share: 0.9996 }), { files: 2, pct: 99.9 });
    assert.deepEqual(shownOneTouch({ files: 2, share: 'x' }), { files: 2, pct: 0 });
    for (const v of [null, undefined, 'x', 3, {}, { files: 0, share: 0 }, { files: -1, share: 0.5 }, { files: NaN, share: 0.5 }]) assert.equal(shownOneTouch(v), null);
  });
});

describe('cards', () => {
  test('a "One-touch files" row last on the hot-files card when there is room, en and tr', () => {
    const s = statsOf(roomy());
    const spec = specOf(s, 'hot-files');
    assert.deepEqual(spec.lines.at(-1), { label: 'One-touch files', value: '1 file · 50%', description: '1 file changed in just one commit (50% of changed files)' });
    assert.match(cardDescription(spec), /1 file changed in just one commit \(50% of changed files\)\./);
    const trSpec = specOf(s, 'hot-files', 'tr');
    const t = rowOf(trSpec, tr);
    assert.ok(t, 'tr row');
    assert.equal(trSpec.lines.at(-1), t);
    assert.match(t.value, /^1( dosya)? · %50$/);
    assert.match(cardDescription(trSpec), /1 dosya yalnızca tek bir commit'te değişti \(değişen dosyaların %50 kadarı\)\./);
  });

  test('never displaces anything: only the hot-files card changes, and it only gains the row', () => {
    const docsToo = [...roomy(), commit(3, [['README.md', 4, 0]])];
    const cases = [[roomy()], [crowded()], [docsToo], [[...roomy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]]];
    let gained = 0;
    for (const [commits, opts] of cases) {
      const s = statsOf(commits, opts);
      const without = { ...s, oneTouch: null };
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

  test('after the docs row when both are on the hot-files card', () => {
    const s = statsOf([commit(1, [['src/a.js', 100, 10]]), commit(2, [['src/a.js', 3, 3], ['README.md', 8, 2]])]);
    const labels = specOf(s, 'hot-files').lines.map((r) => r.label);
    assert.deepEqual(labels, ['Docs', 'One-touch files']);
  });

  test('no room: the crowded hot-files card is byte-identical', () => {
    const s = statsOf(crowded());
    assert.equal(s.oneTouch.files, 10);
    assert.equal(rowOf(specOf(s, 'hot-files')), undefined);
    assert.deepEqual(svgs(s), svgs({ ...s, oneTouch: null }));
  });

  test('no row for null, 0 or a malformed value: cards byte-identical', () => {
    const s = statsOf(roomy());
    const without = svgs({ ...s, oneTouch: null });
    for (const oneTouch of [undefined, { files: 0, share: 0 }, 'x', { files: -2, share: 2 }]) {
      assert.deepEqual(svgs({ ...s, oneTouch }), without, JSON.stringify(oneTouch));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('"<1%" for a tiny share; the short forms when the full one would be cut; none when even those are', () => {
    const s = statsOf(roomy());
    assert.equal(rowOf(specOf({ ...s, oneTouch: { files: 3, share: 0 } }, 'hot-files')).value, '3 files · <1%');
    assert.equal(rowOf(specOf({ ...s, oneTouch: { files: 123456789, share: 0.5 } }, 'hot-files')).value, '123,456,789 · 50%');
    assert.equal(rowOf(specOf({ ...s, oneTouch: { files: 123456789012345, share: 0.5 } }, 'hot-files')), undefined);
  });

  test('no hot files: no row', () => {
    const s = { ...statsOf([]), oneTouch: { files: 4, share: 0.5 } };
    for (const c of buildCardSpecs(s, cardOpts('en'))) assert.equal(rowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the co-change line, en and tr; none without a one-touch file', () => {
    const s = statsOf([commit(1, [['src/a.js'], ['src/b.js']]), commit(2, [['src/a.js'], ['src/b.js']]), commit(3, [['src/a.js'], ['src/b.js'], ['src/c.js']])]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Co-changed.*\n {2}One-touch {4}1 file \(33% of changed files\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Tek commit'lik\s+1 dosya \(değişen dosyaların %33 kadarı\)\n/);
    assert.match(formatSummary({ ...s, oneTouch: { files: 2, share: 0.0001 } }, { repoName: 'demo', today: TODAY }), /One-touch\s+2 files \(<1% of changed files\)/);
    for (const oneTouch of [null, { files: 0, share: 0 }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, oneTouch }, { repoName: 'demo', today: TODAY }), /One-touch/);
    }
  });

  test('wrapped.md item after the hot-files table, en and tr; none without a one-touch file', () => {
    const s = statsOf(roomy());
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Hot files\n\n\|[^\n]*\n\|[^\n]*\n(?:\|[^\n]*\n)+\n- \*\*One-touch files:\*\* 1 file \\\(50% of changed files\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Tek commit'lik dosyalar:\*\* 1 dosya \\\(değişen dosyaların %50 kadarı\\\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, oneTouch: { files: 0, share: 0 } }, { repoName: 'demo', today: TODAY }), /One-touch/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      for (const k of ['oneTouch', 'oneTouchLabelShort']) assert.equal(typeof L.hotFiles[k], 'string', k);
      for (const k of ['oneTouchValue', 'oneTouchShort', 'oneTouchDescription']) assert.equal(typeof L.hotFiles[k](3, '5%'), 'string', k);
      assert.equal(typeof L.recap.oneTouch, 'string');
      assert.equal(typeof L.recap.ofChangedFiles('5%'), 'string');
      assert.ok(L.recap.oneTouch.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.oneTouch, 'string');
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
    root = mkdtempSync(join(tmpdir(), 'gw-one-touch-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    // 1: two source files and a lockfile (ignored).
    write(repo, 'src/a.js', lines(20));
    write(repo, 'src/keep.js', lines(5));
    write(repo, 'package-lock.json', lines(50));
    commitAll(repo, 'feat: start', '2026-03-02');
    // 2: keep.js again.
    write(repo, 'src/keep.js', lines(6));
    commitAll(repo, 'feat: keep', '2026-03-03');
    // 3: a pure rename (a.js → b.js): a delete of a.js plus an add of b.js.
    git(repo, ['mv', 'src/a.js', 'src/b.js']);
    commitAll(repo, 'refactor: rename', '2026-03-04');
    // 4: b.js edited, README.md added once.
    write(repo, 'src/b.js', lines(21));
    write(repo, 'README.md', '# app\n');
    commitAll(repo, 'docs: readme', '2026-03-05');
    // 5 on a side branch (side.js, once), then a merge commit (never counted).
    git(repo, ['checkout', '-q', '-b', 'side']);
    write(repo, 'src/side.js', lines(2));
    commitAll(repo, 'feat: side', '2026-03-06');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-07'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md agree with hot files; --exclude drops files first', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    // a.js 2 (add, rename away), keep.js 2, b.js 2 (rename in, edit), README.md 1, side.js 1.
    assert.deepEqual(doc.stats.oneTouch, { files: 2, share: 0.4 });
    const hot = doc.stats.hotFiles;
    assert.deepEqual(hot.filter((f) => f.commits === 1).map((f) => f.path).sort(), ['README.md', 'src/side.js']);
    assert.match(readFileSync(r.markdown, 'utf8'), /- \*\*One-touch files:\*\* 2 files \\\(40% of changed files\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /One-touch\s+2 files \(40% of changed files\)/);
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['README.md'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.oneTouch, { files: 1, share: 0.25 });
  });
});
