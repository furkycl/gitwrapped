// Renames, edge cases: similarity threshold, renames whose parent is outside the --since
// window, spaces / unicode under -z, rename + add in one commit, --author, the CLI's
// stats.json, older stats.json without `renamed`, and the totals card never drawing cut
// text (en and tr).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommits, readHistory } from '../src/git.js';
import { computeFileLifecycle, computeStats, shownFileLifecycle } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const LANGS = { en, tr };
const TODAY = '2026-04-01';
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 5 + i, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const opts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const totalsSpec = (stats, lang = 'en') => buildCardSpecs(stats, opts(lang)).find((c) => c.id === 'totals').spec;
const totalsSvg = (stats, lang = 'en') => buildCards(stats, opts(lang)).find((c) => c.id === 'totals').svg;

describe('older stats.json without renamed', () => {
  const base = () => computeStats([commit(1), commit(2)], { today: TODAY });

  test('cards, recap and wrapped.md are the same as with renamed: 0', () => {
    for (const lang of ['en', 'tr']) {
      const old = { ...base(), fileLifecycle: { added: 7, deleted: 2 } };
      const zero = { ...base(), fileLifecycle: { added: 7, deleted: 2, renamed: 0 } };
      assert.deepEqual(buildCards(old, opts(lang)).map((c) => c.svg), buildCards(zero, opts(lang)).map((c) => c.svg));
      assert.equal(formatSummary(old, opts(lang)), formatSummary(zero, opts(lang)));
      assert.equal(buildMarkdown(old, opts(lang)), buildMarkdown(zero, opts(lang)));
      assert.doesNotMatch(formatSummary(old, opts(lang)), /renamed|taşındı/);
      assert.deepEqual(totalsSpec(old, lang).lines.at(-1), { label: LANGS[lang].totals.fileLifecycle, value: '7 / 2' });
    }
  });

  test('renamed of a wrong type reads as 0; null / non-object fileLifecycle shows nothing', () => {
    for (const renamed of [null, undefined, '4', NaN, Infinity, -1, 2.5, [], {}, true]) {
      assert.deepEqual(shownFileLifecycle({ added: 1, deleted: 0, renamed }), { added: 1, deleted: 0, renamed: 0 }, String(renamed));
    }
    assert.equal(shownFileLifecycle({ renamed: Number.MAX_SAFE_INTEGER + 2 }), null);
    for (const v of [null, undefined, 3, 'x', []]) assert.equal(shownFileLifecycle(v), null);
    const noLc = base();
    delete noLc.fileLifecycle;
    assert.doesNotMatch(formatSummary(noLc, opts('en')), /\n {2}Files\s/);
  });
});

describe('computeFileLifecycle: more renames', () => {
  test('renames into ignored file names (lock files, minified) do not count; out of them do', () => {
    const commits = [
      commit(1, { renamed: [{ from: 'src/lock.json', to: 'package-lock.json' }] }),
      commit(2, { renamed: [{ from: 'yarn.lock', to: 'src/yarn.txt' }] }),
      commit(3, { renamed: [{ from: 'src/a.js', to: 'node_modules/x/a.js' }] }),
    ];
    assert.deepEqual(computeFileLifecycle(commits), { added: 0, deleted: 0, renamed: 1 });
  });

  test('renamed does not touch added / deleted, and a commit with all three counts each', () => {
    const c = commit(1, { born: ['src/n.js'], buried: ['src/o.js', 'src/p.js'], renamed: [{ from: 'src/q.js', to: 'src/r.js' }] });
    assert.deepEqual(computeFileLifecycle([c]), { added: 1, deleted: 2, renamed: 1 });
  });

  test('a merge commit with renames counts nothing, even with one parent listed twice', () => {
    assert.deepEqual(computeFileLifecycle([commit(1, { parents: ['a', 'b', 'c'], renamed: [{ from: 'x', to: 'y' }] })]), { added: 0, deleted: 0, renamed: 0 });
    // A root commit (no parents) is not a merge.
    assert.deepEqual(computeFileLifecycle([commit(2, { parents: [], renamed: [{ from: 'x', to: 'y' }] })]), { added: 0, deleted: 0, renamed: 1 });
  });
});

describe('totals card never draws cut text', () => {
  const base = () => computeStats([commit(1), commit(2)], { today: TODAY });
  const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  test('no ellipsis in any lifecycle row text, en and tr, across sizes', () => {
    // Up to 6 digits each: the born / buried row itself is cut from 7 digits each on (a
    // limit that predates renames, see the last test here).
    const sizes = [0, 1, 9, 10, 99, 999, 1000, 12345, 99999, 123456, 999999];
    for (const lang of ['en', 'tr']) {
      const T = LANGS[lang].totals;
      for (const a of sizes) {
        for (const r of [0, 1, 9, 42, 123456, 98765432]) {
          const lc = { added: a, deleted: a, renamed: r };
          const spec = totalsSpec({ ...base(), fileLifecycle: lc }, lang);
          const row = spec.lines.find((l) => l.label === T.fileLifecycle || l.label === T.fileLifecycleRenamed);
          if (!row) continue;
          // The renamed row is only ever drawn whole.
          if (row.label === T.fileLifecycleRenamed) assert.ok(rowFits(row), `${lang} ${JSON.stringify(row)}`);
          if (r === 0) assert.equal(row.label, T.fileLifecycle);
          const svg = totalsSvg({ ...base(), fileLifecycle: lc }, lang);
          for (const t of texts(svg)) {
            if (t.includes('/') && /\d/.test(t)) assert.ok(!t.includes('…'), `${lang} ${JSON.stringify(lc)}: cut "${t}"`);
          }
          if (row.label === T.fileLifecycleRenamed) {
            assert.ok(svg.includes(`>${row.value.replace(/&/g, '&amp;')}<`), `${lang}: value drawn whole`);
          }
        }
      }
    }
  });

  test('renames never make the row cut: with huge counts the card is as without renames', () => {
    for (const lang of ['en', 'tr']) {
      const lc = { added: 98765432, deleted: 98765432 };
      assert.equal(totalsSvg({ ...base(), fileLifecycle: { ...lc, renamed: 3 } }, lang), totalsSvg({ ...base(), fileLifecycle: lc }, lang));
    }
  });

  test('renamed row fits for small counts in en (a row of 3 short numbers)', () => {
    for (const n of [1, 9, 42, 99]) {
      const row = totalsSpec({ ...base(), fileLifecycle: { added: n, deleted: n, renamed: n } }, 'en').lines.at(-1);
      assert.equal(row.label, 'Born / buried / renamed', String(n));
    }
  });

  test('renamed row in tr either fits whole or falls back to born / buried', () => {
    for (const n of [1, 5, 9, 10, 42]) {
      const row = totalsSpec({ ...base(), fileLifecycle: { added: n, deleted: n, renamed: n } }, 'tr').lines.at(-1);
      if (row.label === tr.totals.fileLifecycleRenamed) assert.ok(rowFits(row));
      else assert.deepEqual(row, { label: tr.totals.fileLifecycle, value: `${n} / ${n}` });
    }
  });

  test('byte-identical cards (all of them) when renamed is 0, across sizes, en and tr', () => {
    for (const lang of ['en', 'tr']) {
      for (const lc of [{ added: 1, deleted: 0 }, { added: 0, deleted: 5 }, { added: 99999, deleted: 1 }, { added: 0, deleted: 0 }]) {
        const before = buildCards({ ...base(), fileLifecycle: lc }, opts(lang)).map((c) => c.svg);
        const after = buildCards({ ...base(), fileLifecycle: { ...lc, renamed: 0 } }, opts(lang)).map((c) => c.svg);
        assert.deepEqual(after, before);
      }
    }
  });

  test('renames change only the totals card', () => {
    const plain = buildCards({ ...base(), fileLifecycle: { added: 3, deleted: 1 } }, opts('en'));
    const withR = buildCards({ ...base(), fileLifecycle: { added: 3, deleted: 1, renamed: 2 } }, opts('en'));
    assert.deepEqual(withR.map((c) => c.id), plain.map((c) => c.id));
    for (let i = 0; i < plain.length; i++) {
      if (plain[i].id === 'totals') assert.notEqual(withR[i].svg, plain[i].svg);
      else assert.equal(withR[i].svg, plain[i].svg, plain[i].id);
    }
  });
});

describe('git (real repo): rename edge cases', () => {
  let root;
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (d) => ({ GIT_AUTHOR_DATE: `${d}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${d}T10:00:00+00:00` });
  const body = (seed, n = 20) => Array.from({ length: n }, (_, i) => `${seed} line ${i}`).join('\n') + '\n';
  const init = (name) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    return repo;
  };
  const write = (repo, path, text) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  let repo;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-renames-x-'));
    repo = init('app');
    // 2025-01-10 (before the window): files born.
    write(repo, 'src/keep.js', body('keep'));
    write(repo, 'src/far.js', body('far'));
    write(repo, 'src/near.js', body('near'));
    write(repo, 'src/old.js', body('old'));
    write(repo, 'src/bob.js', body('bob'));
    write(repo, 'src/plain name.js', body('space'));
    write(repo, 'src/café.js', body('cafe'));
    write(repo, 'src/Case.js', body('case'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: start'], at('2025-01-10'));
    // 2025-05-01: the first commit in the window; its parent is outside it. A rename.
    git(repo, ['mv', 'src/keep.js', 'src/kept.js']);
    git(repo, ['commit', '-q', '-m', 'refactor: keep → kept'], at('2025-05-01'));
    // 2025-05-02: renamed and rewritten past the similarity threshold: an add plus a delete.
    git(repo, ['mv', 'src/far.js', 'src/farther.js']);
    write(repo, 'src/farther.js', body('totally different', 20));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'refactor: rewrite far'], at('2025-05-02'));
    // 2025-05-03: renamed with a small edit (still similar): a rename.
    git(repo, ['mv', 'src/near.js', 'src/nearer.js']);
    writeFileSync(join(repo, 'src/nearer.js'), body('near').replace('near line 3', 'near line three'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'refactor: tweak near'], at('2025-05-03'));
    // 2025-05-04: a rename, two new files and a delete in one commit.
    mkdirSync(join(repo, 'lib'));
    git(repo, ['mv', 'src/old.js', 'lib/new home.js']);
    write(repo, 'src/fresh one.js', body('fresh'));
    write(repo, 'src/fresh two.js', body('fresh two'));
    git(repo, ['rm', '-q', 'src/kept.js']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: rename, add and delete'], at('2025-05-04'));
    // 2025-05-05: spaces and unicode in both paths.
    git(repo, ['mv', 'src/plain name.js', 'src/still a plain name.js']);
    git(repo, ['mv', 'src/café.js', 'src/çay ğüşöı.js']);
    git(repo, ['commit', '-q', '-m', 'chore: unicode renames'], at('2025-05-05'));
    // 2025-05-06: a case-only rename.
    git(repo, ['mv', 'src/Case.js', 'src/case-lower.js']);
    git(repo, ['commit', '-q', '-m', 'chore: case'], at('2025-05-06'));
    // 2025-05-07: Bob renames a file.
    git(repo, ['mv', 'src/bob.js', 'src/bobby.js']);
    git(repo, ['commit', '-q', '-m', 'refactor: bob'], { ...at('2025-05-07'), GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' });
    // Settings that must not change the result.
    git(repo, ['config', 'diff.renames', 'false']);
    git(repo, ['config', 'core.quotePath', 'true']);
    git(repo, ['config', 'diff.renameLimit', '1']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const bySubject = async (o) => new Map((await readCommits(repo, o)).map((c) => [c.subject, c]));

  test('rename edited past the similarity threshold is an add plus a delete', async () => {
    const c = (await bySubject()).get('refactor: rewrite far');
    assert.equal('renamed' in c, false);
    assert.deepEqual(c.born, ['src/farther.js']);
    assert.deepEqual(c.buried, ['src/far.js']);
  });

  test('rename with a small edit is still a rename', async () => {
    const c = (await bySubject()).get('refactor: tweak near');
    assert.deepEqual(c.renamed, [{ from: 'src/near.js', to: 'src/nearer.js' }]);
    assert.equal('born' in c, false);
    assert.equal('buried' in c, false);
  });

  test('rename in the first commit of a --since window (parent outside it) counts', async () => {
    const { commits } = await readHistory(repo, { since: '2025-05-01', until: '2025-05-01' });
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].renamed, [{ from: 'src/keep.js', to: 'src/kept.js' }]);
    assert.equal('born' in commits[0], false); // not diffed against an empty tree
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 0, deleted: 0, renamed: 1 });
  });

  test('a commit that renames, adds and deletes', async () => {
    const c = (await bySubject()).get('feat: rename, add and delete');
    assert.deepEqual(c.renamed, [{ from: 'src/old.js', to: 'lib/new home.js' }]);
    assert.deepEqual([...c.born].sort(), ['src/fresh one.js', 'src/fresh two.js']);
    assert.deepEqual(c.buried, ['src/kept.js']);
    assert.deepEqual(computeFileLifecycle([c]), { added: 2, deleted: 1, renamed: 1 });
  });

  test('spaces and unicode survive -z (core.quotePath on); case-only renames count', async () => {
    const m = await bySubject();
    const u = m.get('chore: unicode renames').renamed;
    const sorted = [...u].sort((x, y) => (x.from < y.from ? -1 : 1));
    assert.deepEqual(sorted, [
      { from: 'src/café.js', to: 'src/çay ğüşöı.js' },
      { from: 'src/plain name.js', to: 'src/still a plain name.js' },
    ]);
    assert.deepEqual(m.get('chore: case').renamed, [{ from: 'src/Case.js', to: 'src/case-lower.js' }]);
  });

  test('--author: only that author\'s renames', async () => {
    const all = await readCommits(repo, { since: '2025-05-01' });
    assert.deepEqual(computeStats(all, { today: TODAY }).fileLifecycle, { added: 3, deleted: 2, renamed: 7 });
    const bob = await readCommits(repo, { since: '2025-05-01', author: 'bob@example.com' });
    assert.equal(bob.length, 1);
    assert.deepEqual(computeStats(bob, { today: TODAY }).fileLifecycle, { added: 0, deleted: 0, renamed: 1 });
    const ada = await readCommits(repo, { since: '2025-05-01', author: 'ada@example.com' });
    assert.deepEqual(computeStats(ada, { today: TODAY }).fileLifecycle, { added: 3, deleted: 2, renamed: 6 });
  });

  test('generate --author writes renamed to stats.json and wrapped.md', async () => {
    const r = await generate({ path: repo, out: join(root, 'o-author'), png: false, json: true, md: true, since: '2025-05-01', author: 'bob@example.com' }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.fileLifecycle, { added: 0, deleted: 0, renamed: 1 });
    assert.match(readFileSync(r.markdown, 'utf8'), /0 files added, 0 deleted, 1 renamed/);
    const svg = readFileSync(join(r.out ?? join(root, 'o-author'), 'cards', '02-totals.svg'), 'utf8');
    assert.match(svg, />0 \/ 0 \/ 1</);
  });

  test('CLI binary: stats.json has stats.fileLifecycle.renamed; recap shows it', () => {
    const out = join(root, 'o-cli');
    const res = spawnSync(process.execPath, [BIN, repo, '--since', '2025-05-01', '--until', '2025-12-31', '--no-png', '--json', '--no-color', '--out', out], {
      encoding: 'utf8',
      env: { ...process.env, ...env, NO_COLOR: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.fileLifecycle, { added: 3, deleted: 2, renamed: 7 });
    assert.match(res.stdout, /Files\s+3 born · 2 buried · 7 renamed/);
  });

  test('shallow clone: the boundary commit gets no renamed; later ones do', async () => {
    const shallow = join(root, 'shallow');
    git(root, ['clone', '-q', '--depth', '2', `file://${repo.replace(/\\/g, '/')}`, shallow]);
    const { commits, shallow: isShallow } = await readHistory(shallow);
    assert.equal(isShallow, true);
    assert.equal(commits.length, 2);
    const [top, boundary] = commits;
    assert.deepEqual(top.renamed, [{ from: 'src/bob.js', to: 'src/bobby.js' }]);
    for (const k of ['born', 'buried', 'renamed']) assert.equal(k in boundary, false, k);
  });

  test('a repo with only renames: no other lifecycle count', async () => {
    const solo = init('solo');
    write(solo, 'a.txt', body('a'));
    git(solo, ['add', '-A']);
    git(solo, ['commit', '-q', '-m', 'init'], at('2025-01-01'));
    git(solo, ['mv', 'a.txt', 'b.txt']);
    git(solo, ['commit', '-q', '-m', 'rename'], at('2025-06-01'));
    const { commits } = await readHistory(solo, { since: '2025-03-01' });
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 0, deleted: 0, renamed: 1 });
    const r = await generate({ path: solo, out: join(root, 'o-solo'), png: false, json: true, md: true, since: '2025-03-01' }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.fileLifecycle, { added: 0, deleted: 0, renamed: 1 });
    assert.match(readFileSync(r.markdown, 'utf8'), /0 files added, 0 deleted, 1 renamed/);
  });
});
