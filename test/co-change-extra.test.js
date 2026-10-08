// Extra edge cases for the co-change pair (src/stats/cochange.js, stats.coChange): end to
// end via the CLI on real temporary repos (stats.json, recap, wrapped.md, hot-files SVG),
// --exclude, ignored paths, merges, the 3-commit threshold, renames (--no-renames: a
// delete plus an add), tie-breaking, --lang tr, multi-repo, unusual paths (spaces,
// unicode, `<&>`, very long names) and the card row only ever drawn whole.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCoChange, computeStats, shownCoChange } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { escapeXml, rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
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
const times = (n, paths, from = 1) => Array.from({ length: n }, (_, k) => commit(from + k, paths));
const stats = (commits) => computeStats(commits, { today: TODAY });
const hotSpec = (s, lang = 'en') => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').spec;
const hotSvg = (s, lang = 'en') => buildCards(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').svg;
/** The co-change row on the hot-files card (either form), by its description. */
const pairRow = (spec) => (spec.lines ?? []).find((r) => typeof r.description === 'string' && /changed together|birlikte değişti/.test(r.description));

/** Every `&` in an SVG starts an entity, and no text node holds a raw `<`/`>`. */
function assertWellEscaped(svg) {
  assert.doesNotMatch(svg, /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/, 'unescaped & in SVG');
  for (const m of svg.matchAll(/>([^<]*)</g)) assert.ok(!m[1].includes('>'), `raw > in text: ${m[1]}`);
}

describe('computeCoChange: extra unit edge cases', () => {
  test('an ignored file never pairs, even when it is in every commit', () => {
    const commits = [...times(6, ['src/a.js', 'package-lock.json']), ...times(3, ['src/a.js', 'src/b.js'], 20)];
    assert.deepEqual(computeCoChange(commits), { files: ['src/a.js', 'src/b.js'], commits: 3 });
    // Nested ignored dirs / minified files too, as for hot files.
    assert.equal(computeCoChange(times(5, ['src/a.js', 'packages/x/node_modules/y/i.js', 'src/app.min.js'])), null);
  });

  test('2 shared commits → null; a 3rd one (in a busier commit) → pair', () => {
    const two = times(2, ['x.js', 'y.js']);
    assert.equal(computeCoChange(two), null);
    assert.deepEqual(computeCoChange([...two, commit(9, ['z.js', 'y.js', 'x.js'])]), { files: ['x.js', 'y.js'], commits: 3 });
  });

  test('merge commits with files never count, non-merge ones do', () => {
    const merges = times(5, ['a.js', 'b.js'], 1).map((c) => ({ ...c, parents: ['p', 'q'] }));
    assert.equal(computeCoChange([...merges, ...times(2, ['a.js', 'b.js'], 10)]), null);
  });

  test('tie-breaking: plain code-unit order, first file then second', () => {
    // Upper case sorts before lower case in code-unit order.
    const commits = [...times(3, ['a.js', 'b.js']), ...times(3, ['B.js', 'z.js'], 10)];
    assert.deepEqual(computeCoChange(commits), { files: ['B.js', 'z.js'], commits: 3 });
    // Same first file: the second decides, whatever the input order.
    const same = [...times(3, ['m.js', 'q.js']), ...times(3, ['m.js', 'n.js'], 10)];
    assert.deepEqual(computeCoChange(same), { files: ['m.js', 'n.js'], commits: 3 });
    assert.deepEqual(computeCoChange([...same].reverse()), { files: ['m.js', 'n.js'], commits: 3 });
    // More commits beats alphabetical.
    assert.deepEqual(computeCoChange([...times(3, ['a.js', 'b.js']), ...times(4, ['y.js', 'z.js'], 10)]), { files: ['y.js', 'z.js'], commits: 4 });
  });

  test('a rename (delete + add with --no-renames) does not carry history across', () => {
    const commits = [
      ...times(2, ['src/old.js', 'src/b.js']),
      commit(5, ['src/old.js', 'src/new.js']), // the rename itself
      ...times(2, ['src/new.js', 'src/b.js'], 10),
    ];
    assert.equal(computeCoChange(commits), null);
  });
});

describe('hot-files card row: never cut, escaped', () => {
  test('fuzz over name lengths (en/tr): a row, when present, fits and is drawn whole', () => {
    let shown = 0;
    let hidden = 0;
    for (const lang of ['en', 'tr']) {
      for (let n = 1; n <= 60; n += 2) {
        const a = `src/${'a'.repeat(n)}.js`;
        const b = `src/${'W'.repeat(1 + (n % 7))}.ts`;
        const s = stats(times(3, [a, b]));
        assert.ok(s.coChange);
        const row = pairRow(hotSpec(s, lang));
        if (!row) {
          hidden++;
          assert.equal(hotSvg(s, lang), hotSvg({ ...s, coChange: null }, lang));
          continue;
        }
        shown++;
        assert.ok(rowFits(row), JSON.stringify(row));
        const svg = hotSvg(s, lang);
        assert.ok(svg.includes(`>${escapeXml(row.label)}<`), `label drawn whole: ${row.label}`);
        assert.ok(svg.includes(`>${escapeXml(row.value)}<`), `value drawn whole: ${row.value}`);
      }
    }
    assert.ok(shown > 0 && hidden > 0, `shown ${shown}, hidden ${hidden}`);
  });

  test('`<&>`, spaces and unicode in names: escaped in the SVG, row drawn whole', () => {
    const a = 'we <&> ird/a & b.js';
    const b = 'we <&> ird/ünï <x>.js';
    const s = stats(times(3, [a, b]));
    assert.deepEqual(s.coChange, { files: [a, b], commits: 3 });
    for (const lang of ['en', 'tr']) {
      const svg = hotSvg(s, lang);
      assertWellEscaped(svg);
      const row = pairRow(hotSpec(s, lang));
      assert.ok(row, 'row present');
      assert.ok(rowFits(row));
      assert.ok(svg.includes(escapeXml('a & b.js + ünï <x>.js')), 'escaped names in svg');
      assert.ok(!svg.includes('a & b.js'));
    }
  });

  test('same file name, same last folder (one repo): folders added until the names differ', () => {
    const s = stats(times(3, ['a/x/i.js', 'b/x/i.js']));
    assert.deepEqual(s.coChange, { files: ['a/x/i.js', 'b/x/i.js'], commits: 3 });
    const row = pairRow(hotSpec(s));
    assert.ok(row && rowFits(row), 'row present and whole');
    assert.ok(`${row.label} ${row.value}`.includes('a/x/i.js + b/x/i.js'), JSON.stringify(row));
    // Longer names that no longer fit once they differ: no row, never an ambiguous one.
    const long = stats(times(3, ['a/x/index.js', 'b/x/index.js']));
    const r2 = pairRow(hotSpec(long));
    if (r2) assert.ok(!/x\/index\.js \+ x\/index\.js/.test(`${r2.label} ${r2.value}`), JSON.stringify(r2));
    assert.ok(formatSummary(s, { paths: {} }).includes('a/x/i.js + b/x/i.js (3 commits)'));
    assert.ok(formatSummary(long, { paths: {} }).includes('a/x/index.js + b/x/index.js (3 commits)'));
  });
});

describe('recap / wrapped.md with unusual paths', () => {
  test('markdown escapes the pair; recap clips long paths from the start', () => {
    const s = { ...stats(times(3, ['src/a.js', 'src/b.js'])), coChange: { files: ['we <&> ird/*a* & b.js', 'x/[y](z).js'], commits: 5 } };
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    const line = md.split('\n').find((l) => l.startsWith('- **Changed together:**'));
    assert.ok(line, md);
    assert.ok(!/(^|[^\\])\*a\*/.test(line), line);
    assert.ok(!/[^\\]\[y\]/.test(line), line);
    assert.ok(line.endsWith('(5 commits)'));
    const long = `src/${'deep/'.repeat(20)}file.js`;
    const recap = formatSummary({ ...s, coChange: { files: [long, 'src/b.js'], commits: 3 } }, { paths: {} });
    const rl = recap.split('\n').find((l) => l.includes('Co-changed'));
    assert.ok(rl.includes('…') && rl.includes('file.js + src/b.js (3 commits)'), rl);
  });

  test('shownCoChange: whitespace-only path → null', () => {
    assert.equal(shownCoChange({ files: ['  ', 'a.js'], commits: 3 }), null);
  });
});

describe('end to end (real repos via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const base = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...ADA, ...extra } });
  let root;
  let day = 1;
  const at = () => {
    const d = `2025-04-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const touch = (dir, path) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    let prev = '';
    try {
      prev = readFileSync(join(dir, path), 'utf8');
    } catch {}
    writeFileSync(join(dir, path), `${prev}line ${day}\n`);
  };
  /** One commit touching `paths` (added to the index with -f, so ignored-looking paths are real). */
  const change = (dir, paths, msg = 'feat: change') => {
    for (const p of paths) touch(dir, p);
    git(dir, ['add', '-A', '-f']);
    git(dir, ['commit', '-q', '-m', msg], at());
  };
  const init = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['config', 'core.quotePath', 'true']);
    return dir;
  };
  let n = 0;
  const run = (args) => {
    const out = join(root, `out${n++}`);
    const res = spawnSync(process.execPath, [BIN, ...args, '--out', out, '--no-png', '--no-color', '--json', '--md'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const hot = readdirSync(join(out, 'cards')).find((f) => f.endsWith('hot-files.svg'));
    const svg = hot ? readFileSync(join(out, 'cards', hot), 'utf8') : '';
    return { stdout: res.stdout, coChange: json.stats.coChange, md, svg };
  };

  let main;
  let thresh;
  let odd;
  let renamed;
  let alpha;
  let beta;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-cochange-x-'));
    main = init('main');
    // 3 commits: src/a.js + src/b.js, plus lockfiles / build output in each (ignored).
    for (let i = 0; i < 3; i++) change(main, ['src/a.js', 'src/b.js', 'package-lock.json', 'yarn.lock', 'dist/out.js']);
    // 4 commits: docs/x.md + docs/y.md (the winner, until --exclude docs/).
    for (let i = 0; i < 4; i++) change(main, ['docs/x.md', 'docs/y.md']);
    // A branch and a merge whose conflict resolution touches src/c.js + src/d.js, plus
    // only 2 non-merge commits sharing c + d: the merge must not make it 3.
    change(main, ['src/c.js', 'src/d.js']);
    change(main, ['src/c.js', 'src/d.js']);
    git(main, ['checkout', '-q', '-b', 'side']);
    change(main, ['src/e.js']);
    git(main, ['checkout', '-q', 'main']);
    change(main, ['src/f.js']);
    git(main, ['merge', '-q', '--no-ff', '--no-commit', 'side']);
    touch(main, 'src/c.js');
    touch(main, 'src/d.js');
    git(main, ['add', '-A']);
    git(main, ['commit', '-q', '-m', "Merge branch 'side'"], at());

    thresh = init('thresh');
    change(thresh, ['p.js', 'q.js']);
    change(thresh, ['p.js', 'q.js']);

    odd = init('odd');
    for (let i = 0; i < 3; i++) change(odd, ['we <&> ird/a & b.js', 'we <&> ird/ünï cödé.js']);

    renamed = init('renamed');
    git(renamed, ['config', 'diff.renames', 'true']);
    change(renamed, ['src/old.js', 'src/b.js']);
    change(renamed, ['src/old.js', 'src/b.js']);
    git(renamed, ['mv', 'src/old.js', 'src/new.js']);
    git(renamed, ['commit', '-q', '-m', 'refactor: rename'], at());
    change(renamed, ['src/new.js', 'src/b.js']);
    change(renamed, ['src/new.js', 'src/b.js']);

    alpha = init('alpha');
    for (let i = 0; i < 3; i++) change(alpha, ['src/a.js', 'src/b.js']);
    beta = init('beta');
    for (let i = 0; i < 4; i++) change(beta, ['src/a.js', 'src/b.js']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, recap, wrapped.md and the card: the 4-commit docs pair; lockfiles never pair', () => {
    const r = run([main]);
    assert.deepEqual(r.coChange, { files: ['docs/x.md', 'docs/y.md'], commits: 4 });
    assert.match(r.stdout, /Co-changed {3}docs\/x\.md \+ docs\/y\.md \(4 commits\)/);
    assert.ok(r.md.includes('- **Changed together:** docs/x.md + docs/y.md (4 commits)'), r.md);
    assert.ok(r.svg.includes('x.md + y.md · 4×') || r.svg.includes('4× together') || !r.svg.includes('together'), 'row whole or absent');
    assertWellEscaped(r.svg);
  });

  test('--exclude docs/ → the src pair (lockfiles / dist still ignored); --exclude its file too → null', () => {
    const r = run([main, '--exclude', 'docs/']);
    assert.deepEqual(r.coChange, { files: ['src/a.js', 'src/b.js'], commits: 3 });
    const r2 = run([main, '--exclude', 'docs/', '--exclude', 'src/b.js']);
    assert.equal(r2.coChange, null);
    assert.doesNotMatch(r2.stdout, /Co-changed/);
    assert.ok(!r2.md.includes('Changed together'));
    assert.ok(!r2.svg.includes('together'));
    // *.md matches at any depth.
    assert.deepEqual(run([main, '--exclude', '*.md']).coChange, { files: ['src/a.js', 'src/b.js'], commits: 3 });
  });

  test('a merge commit touching a pair does not make 2 shared commits into 3', () => {
    const r = run([main, '--exclude', 'docs/', '--exclude', 'src/a.js']);
    // src/c.js + src/d.js share only 2 non-merge commits; nothing else pairs.
    assert.equal(r.coChange, null);
  });

  test('exactly 2 shared commits → null; a 3rd → the pair', () => {
    const r = run([thresh]);
    assert.equal(r.coChange, null);
    assert.doesNotMatch(r.stdout, /Co-changed/);
    change(thresh, ['p.js', 'q.js']);
    const r2 = run([thresh]);
    assert.deepEqual(r2.coChange, { files: ['p.js', 'q.js'], commits: 3 });
    assert.ok(r2.svg.includes('p.js + q.js · 3×'), 'row on the card');
  });

  test('a rename splits the history: 2 + 2 commits → null', () => {
    const r = run([renamed]);
    assert.equal(r.coChange, null);
  });

  test('`<&>`, spaces and unicode paths: exact in stats.json, escaped in SVG and markdown', () => {
    const r = run([odd]);
    assert.deepEqual(r.coChange, { files: ['we <&> ird/a & b.js', 'we <&> ird/ünï cödé.js'], commits: 3 });
    assert.ok(r.stdout.includes('we <&> ird/a & b.js + we <&> ird/ünï cödé.js (3 commits)'), r.stdout);
    assertWellEscaped(r.svg);
    assert.ok(r.svg.includes(escapeXml('a & b.js + ünï cödé.js')), 'card row');
    const line = r.md.split('\n').find((l) => l.startsWith('- **Changed together:**'));
    assert.ok(line, r.md);
    assert.ok(line.includes('ünï cödé.js') && line.endsWith('(3 commits)'), line);
    // `<` must not survive as raw HTML in markdown.
    assert.ok(!/(^|[^\\])</.test(line), `raw < in markdown: ${line}`);
  });

  test('--lang tr: recap, wrapped.md and card', () => {
    const r = run([main, '--exclude', 'docs/', '--lang', 'tr']);
    assert.match(r.stdout, /Birlikte değişen src\/a\.js \+ src\/b\.js \(3 commit\)/);
    assert.doesNotMatch(r.stdout, /Co-changed/);
    assert.ok(r.md.includes('- **Birlikte değişenler:** src/a.js + src/b.js (3 commit)'), r.md);
    assert.ok(!r.svg.includes('Changed together') && !r.svg.includes('together'));
  });

  test('multi-repo: repo-prefixed paths, the bigger pair wins, never across repos', () => {
    const r = run([alpha, beta]);
    assert.deepEqual(r.coChange, { files: ['beta/src/a.js', 'beta/src/b.js'], commits: 4 });
    assert.ok(r.stdout.includes('beta/src/a.js + beta/src/b.js (4 commits)'));
    assert.ok(r.md.includes('beta/src/a.js + beta/src/b.js (4 commits)'));
  });
});
