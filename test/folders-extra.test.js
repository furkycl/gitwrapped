// Extra edge cases for top folders (src/stats/folders.js): ignore rules at the root vs.
// deeper, dotfolders, ties at the top-5 cut, same folder name in two repos, renames
// (--no-renames: a delete in the old folder plus an add in the new), unicode / spaces,
// --exclude / --author end to end, tr recap and wrapped.md, card unchanged with < 2 folders.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHistories, parseLog } from '../src/git.js';
import { computeFolders, computeStats, folderOf, shownFolders } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';

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
const paths = (out) => out.map((f) => f.path);
const hotSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').svg;

describe('computeFolders: ignore rules', () => {
  test('root-only ignored paths never create a folder (not even (root))', () => {
    const out = computeFolders([
      commit(1, [
        ['package-lock.json', 10, 10],
        ['yarn.lock', 10, 0],
        ['pnpm-lock.yaml', 10, 0],
        ['dist/app.js', 50, 0],
        ['build/x.js', 50, 0],
        ['coverage/lcov.info', 50, 0],
        ['vendor/lib.js', 50, 0],
        ['node_modules/pkg/index.js', 50, 0],
        ['app.min.js', 50, 0],
        ['src/a.js', 1, 0],
      ]),
    ]);
    assert.deepEqual(out, [{ path: 'src', lines: 1, added: 1, deleted: 0, commits: 1 }]);
  });

  test('a commit with only ignored files does not count as a commit for any folder', () => {
    const out = computeFolders([commit(1, [['src/a.js', 2, 0]]), commit(2, [['src/node_modules/x.js', 9, 0], ['src/a.min.js', 9, 0]])]);
    assert.deepEqual(out, [{ path: 'src', lines: 2, added: 2, deleted: 0, commits: 1 }]);
  });

  test('build-dir names deeper in the tree still count, under their top-level folder', () => {
    const out = computeFolders([commit(1, [['src/dist/keep.js', 3, 0], ['src/vendor/v.js', 2, 0], ['packages/x/dist/b.js', 99, 0], ['packages/x/src/c.js', 1, 0]])]);
    assert.deepEqual(out.map((f) => [f.path, f.lines]), [['src', 5], ['packages', 1]]);
  });

  test('dotfolders (.github) count as a folder; a root dotfile is (root)', () => {
    const out = computeFolders([commit(1, [['.github/workflows/ci.yml', 8, 2], ['.gitignore', 1, 0], ['.eslintrc.json', 2, 0]])]);
    assert.deepEqual(out, [
      { path: '.github', lines: 10, added: 8, deleted: 2, commits: 1 },
      { path: '(root)', lines: 3, added: 3, deleted: 0, commits: 1 },
    ]);
    assert.equal(folderOf({}, '.github/x.yml'), '.github');
    assert.equal(folderOf({}, '.env'), '(root)');
  });
});

describe('computeFolders: --exclude', () => {
  test('a folder whose only changes are excluded disappears; others keep their counts', () => {
    const commits = [commit(1, [['gen/a.js', 100, 0], ['gen/b.js', 50, 0], ['src/a.js', 3, 1]]), commit(2, [['gen/c.js', 5, 0]])];
    assert.deepEqual(paths(computeFolders(commits)), ['gen', 'src']);
    for (const pattern of ['gen/', 'gen/**', 'gen', '*.js']) {
      const out = computeFolders(excludeFiles(commits, compileExcludes([pattern])));
      if (pattern === '*.js') assert.deepEqual(out, [], pattern);
      else assert.deepEqual(out, [{ path: 'src', lines: 4, added: 3, deleted: 1, commits: 1 }], pattern);
    }
  });

  test('a partial exclude inside a folder lowers its lines and can drop its commit count', () => {
    const commits = [commit(1, [['src/gen/x.js', 40, 0]]), commit(2, [['src/a.js', 2, 0], ['src/gen/y.js', 9, 0]])];
    const out = computeFolders(excludeFiles(commits, compileExcludes(['src/gen/'])));
    assert.deepEqual(out, [{ path: 'src', lines: 2, added: 2, deleted: 0, commits: 1 }]);
  });

  test('multi-repo: an exclude given with the repo label only drops that repo', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit(1, [['docs/a.md', 5, 0], ['src/a.js', 1, 0]])] },
      { label: 'web', commits: [commit(2, [['docs/b.md', 7, 0]])] },
    ]);
    const out = computeFolders(excludeFiles(merged.commits, compileExcludes(['api/docs/'])));
    assert.deepEqual(out.map((f) => [f.path, f.lines]), [['web/docs', 7], ['api/src', 1]]);
    const all = computeFolders(excludeFiles(merged.commits, compileExcludes(['docs/'])));
    assert.deepEqual(paths(all), ['api/src']);
  });
});

describe('computeFolders: ranking', () => {
  test('ties at the top-5 cut: equal lines break by path (code-unit order)', () => {
    // Seven folders, all 10 lines; uppercase and dot sort before lowercase.
    const files = ['zeta', 'beta', 'Alpha', '.github', 'alpha', '(root)x', 'gamma'].map((d) => [`${d}/f.js`, 10, 0]);
    const out = computeFolders([commit(1, files)]);
    assert.deepEqual(paths(out), ['(root)x', '.github', 'Alpha', 'alpha', 'beta']);
    assert.ok(out.every((f) => f.lines === 10 && f.commits === 1));
  });

  test('ranks by lines, not commits; added and deleted both count', () => {
    const commits = [
      commit(1, [['many/a.js', 1, 0]]),
      commit(2, [['many/a.js', 1, 0]]),
      commit(3, [['many/a.js', 1, 0]]),
      commit(4, [['big/a.js', 0, 5]]),
    ];
    assert.deepEqual(computeFolders(commits).map((f) => [f.path, f.lines, f.commits]), [['big', 5, 1], ['many', 3, 3]]);
  });

  test('limit 0 returns [] and a limit above the folder count returns them all', () => {
    const c = [commit(1, [['a/x', 1, 0], ['b/x', 2, 0]])];
    assert.deepEqual(computeFolders(c, { limit: 0 }), []);
    assert.equal(computeFolders(c, { limit: 50 }).length, 2);
  });

  test('paths with spaces and non-ASCII names are kept verbatim', () => {
    const out = computeFolders([commit(1, [['my docs/read me.md', 4, 0], ['dökümanlar/ç.md', 6, 0], ['日本/a.txt', 2, 0], ['root file.txt', 1, 0]])]);
    assert.deepEqual(paths(out), ['dökümanlar', 'my docs', '日本', '(root)']);
  });
});

describe('computeFolders: multi-repo', () => {
  test('the same folder name in two repos stays separate; root files per repo', () => {
    const merged = mergeHistories([
      { label: 'alpha', commits: [commit(1, [['src/a.js', 7, 0], ['README.md', 1, 0]])] },
      { label: 'beta', commits: [commit(2, [['src/a.js', 7, 0], ['README.md', 2, 0]])] },
    ]);
    const out = computeFolders(merged.commits);
    assert.deepEqual(out.map((f) => [f.path, f.lines, f.commits]), [['alpha/src', 7, 1], ['beta/src', 7, 1], ['beta/(root)', 2, 1], ['alpha/(root)', 1, 1]]);
    const shown = shownFolders(out);
    assert.deepEqual(shown.map((f) => [f.repo, f.name, f.root]), [['alpha', 'src', false], ['beta', 'src', false], ['beta', '(root)', true], ['alpha', '(root)', true]]);
  });

  test('a repo labelled like an ignored dir ("dist") is not itself ignored', () => {
    const merged = mergeHistories([
      { label: 'dist', commits: [commit(1, [['src/a.js', 4, 0], ['dist/out.js', 99, 0]])] },
      { label: 'web', commits: [commit(2, [['lib/b.js', 1, 0]])] },
    ]);
    assert.deepEqual(computeFolders(merged.commits).map((f) => [f.path, f.lines]), [['dist/src', 4], ['web/lib', 1]]);
  });
});

describe('renames (parseLog with --no-renames output)', () => {
  test('a rename seen as a delete plus an add: lines go to both folders', () => {
    // What `git log -z --numstat --no-renames` prints for a pure move of a 10-line file.
    const header = `${H(1)}\x1fAda\x1fada@example.com\x1f2026-03-02T10:00:00+00:00\x1fp\x1frefactor: move\n`;
    const out = `${header}\n\x0010\t0\tlib/a.js\x000\t10\tsrc/a.js\x00`;
    const commits = parseLog(out);
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].files.map((f) => [f.path, f.added, f.removed]), [['lib/a.js', 10, 0], ['src/a.js', 0, 10]]);
    assert.deepEqual(computeFolders(commits), [
      { path: 'lib', lines: 10, added: 10, deleted: 0, commits: 1 },
      { path: 'src', lines: 10, added: 0, deleted: 10, commits: 1 },
    ]);
  });
});

describe('card and recap with fewer than two folders', () => {
  test('one folder (all changes in src): card byte-identical to no folders, no recap line, no md table', () => {
    const s = computeStats([commit(1, [['src/a.js', 5, 0]]), commit(2, [['src/b.js', 3, 1], ['dist/x.js', 9, 0]])], { today: TODAY });
    assert.equal(s.folders.length, 1);
    assert.equal(shownFolders(s.folders), null);
    for (const lang of ['en', 'tr']) {
      assert.equal(hotSvg(s, lang), hotSvg({ ...s, folders: [] }, lang), lang);
      assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY, lang }), /Top folders|Gözde klasörler/);
      assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }), /Top folders|Gözde klasörler/);
    }
  });

  test('only root files: one "(root)" folder, card unchanged', () => {
    const s = computeStats([commit(1, [['README.md', 5, 0], ['index.js', 3, 0]])], { today: TODAY });
    assert.deepEqual(s.folders, [{ path: '(root)', lines: 8, added: 8, deleted: 0, commits: 1 }]);
    assert.equal(hotSvg(s), hotSvg({ ...s, folders: [] }));
  });
});

describe('end to end (real repos via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const base = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const who = (name, email) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
  const ADA = who('Ada', 'ada@example.com');
  const BOB = who('Bob', 'bob@example.com');
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...ADA, ...extra } });
  let root;
  let proj;
  let alpha;
  let beta;
  let day = 1;
  const at = () => {
    const d = `2025-04-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const write = (dir, path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const lines = (n, seed = 'x') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join('\n') + '\n';
  const init = (dir) => {
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['config', 'core.quotePath', 'true']);
  };
  const run = (args) => {
    const res = spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    return res;
  };
  const foldersOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.folders;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-folders-x-'));
    proj = join(root, 'proj');
    init(proj);
    // c1 (Ada): real folders, a dotfolder, spaces, unicode, a kept src/dist, and ignored stuff.
    write(proj, 'src/a.js', lines(10));
    write(proj, 'src/dist/keep.js', lines(1));
    write(proj, '.github/workflows/ci.yml', lines(6));
    write(proj, 'my docs/read me.md', lines(4));
    write(proj, 'dökümanlar/ç.md', lines(5));
    write(proj, 'node_modules/x/i.js', lines(100));
    write(proj, 'yarn.lock', lines(50));
    write(proj, 'dist/b.js', lines(20));
    write(proj, 'vendor/v.js', lines(30));
    write(proj, 'build/z.js', lines(5));
    git(proj, ['add', '-A', '-f']);
    git(proj, ['commit', '-q', '-m', 'feat: start'], at());
    // c2 (Bob): a pure rename src/a.js -> lib/a.js (rename detection on in config: ignored).
    git(proj, ['config', 'diff.renames', 'true']);
    mkdirSync(join(proj, 'lib'));
    git(proj, ['mv', 'src/a.js', 'lib/a.js']);
    git(proj, ['commit', '-q', '-m', 'refactor: move'], { ...BOB, ...at() });
    // c3 (Ada): generated code, to be excluded.
    write(proj, 'gen/out.js', lines(7));
    git(proj, ['add', '-A']);
    git(proj, ['commit', '-q', '-m', 'chore: gen'], at());

    alpha = join(root, 'alpha');
    beta = join(root, 'beta');
    for (const [dir, n] of [[alpha, 3], [beta, 8]]) {
      init(dir);
      write(dir, 'src/a.js', lines(n));
      write(dir, 'README.md', lines(1));
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'feat: init'], at());
    }
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('--json: ignores, dotfolder, unicode, rename as delete + add, top-5 cap', () => {
    const out = join(root, 'e1');
    run([proj, '--out', out, '--json']);
    const folders = foldersOf(out);
    assert.deepEqual(folders, [
      { path: 'src', lines: 21, added: 11, deleted: 10, commits: 2 },
      { path: 'lib', lines: 10, added: 10, deleted: 0, commits: 1 },
      { path: 'gen', lines: 7, added: 7, deleted: 0, commits: 1 },
      { path: '.github', lines: 6, added: 6, deleted: 0, commits: 1 },
      { path: 'dökümanlar', lines: 5, added: 5, deleted: 0, commits: 1 },
    ]);
    assert.ok(folders.every((f) => !f.path.includes('=>') && !f.path.includes('{')));
  });

  test('--exclude gen/ removes that folder and lets the next one in', () => {
    const out = join(root, 'e2');
    run([proj, '--out', out, '--json', '--exclude', 'gen/']);
    assert.deepEqual(foldersOf(out).map((f) => [f.path, f.lines]), [['src', 21], ['lib', 10], ['.github', 6], ['dökümanlar', 5], ['my docs', 4]]);
  });

  test('--author only counts that author\'s changes', () => {
    const out = join(root, 'e3');
    run([proj, '--out', out, '--json', '--author', 'bob@example.com']);
    assert.deepEqual(foldersOf(out), [
      { path: 'lib', lines: 10, added: 10, deleted: 0, commits: 1 },
      { path: 'src', lines: 10, added: 0, deleted: 10, commits: 1 },
    ]);
    const out2 = join(root, 'e3b');
    run([proj, '--out', out2, '--json', '--author', 'ADA@example.com']);
    assert.deepEqual(foldersOf(out2).map((f) => [f.path, f.lines, f.commits]), [['src', 11, 1], ['gen', 7, 1], ['.github', 6, 1], ['dökümanlar', 5, 1], ['my docs', 4, 1]]);
  });

  test('--lang tr: recap line and wrapped.md table', () => {
    const out = join(root, 'e4');
    const res = run([proj, '--out', out, '--md', '--lang', 'tr']);
    assert.match(res.stdout, /Gözde klasörler\s+src\/ \(21 satır\) · lib\/ \(10 satır\) · gen\/ \(7 satır\)/);
    assert.doesNotMatch(res.stdout, /Top folders/);
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    assert.match(md, /## Gözde klasörler\n\n\| # \| Klasör \| Satır \| Commit \|\n\|--:\|:--\|--:\|--:\|\n\| 1 \| src\/ \| \+11 \/ −10 \| 2 \|\n\| 2 \| lib\/ \| \+10 \/ 0 \| 1 \|\n/);
    assert.match(md, /\| 4 \| \.github\/ \|/);
    assert.match(md, /\| 5 \| dökümanlar\/ \|/);
  });

  test('two repos with the same folder name: kept apart, repo-prefixed, root per repo', () => {
    const out = join(root, 'e5');
    const res = run([alpha, beta, '--out', out, '--json']);
    assert.deepEqual(foldersOf(out).map((f) => [f.path, f.lines]), [['beta/src', 8], ['alpha/src', 3], ['alpha/(root)', 1], ['beta/(root)', 1]]);
    assert.match(res.stdout, /Top folders\s+beta\/src\/ \(8 lines\) · alpha\/src\/ \(3 lines\) · alpha\/\(root\) \(1 line\)/);
  });
});
