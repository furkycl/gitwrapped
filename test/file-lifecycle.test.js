// Files born and buried: files added vs deleted in the window, read by src/git.js
// readLifecycle (one `git log --name-status -M --diff-filter=AD` call over the analyzed
// commits), counted by computeFileLifecycle (src/stats/files.js) and shown as
// stats.fileLifecycle, a recap line, a wrapped.md item and a totals-card row (spare room only).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHistories, parseLifecycleLog, readCommits, readLifecycle } from '../src/git.js';
import { computeFileLifecycle, computeStats, shownFileLifecycle } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
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
const totalsSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec;
const totalsSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').svg;

describe('parseLifecycleLog', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(64);

  test('A / D entries per commit; renames, copies and other statuses skipped', () => {
    const out = `${a}\0\nA\0new.js\0D\0old.js\0R087\0from.js\0to.js\0M\0kept.js\0${b}\0${c}\0\nC100\0x\0y\0A\0z\0`;
    const found = parseLifecycleLog(out);
    assert.deepEqual(found.get(a), { born: ['new.js'], buried: ['old.js'] });
    assert.equal(found.has(b), false); // no matching entries: left out
    assert.deepEqual(found.get(c), { born: ['z'], buried: [] }); // SHA-256 hash
    assert.equal(found.size, 2);
  });

  test('paths that look like a status or a hash, or hold newlines, stay paths', () => {
    const out = `${a}\0\nA\0A\0A\0${b}\0D\0line\nbreak.txt\0`;
    assert.deepEqual(parseLifecycleLog(out).get(a), { born: ['A', b], buried: ['line\nbreak.txt'] });
  });

  test('junk and empty input', () => {
    assert.equal(parseLifecycleLog('').size, 0);
    assert.equal(parseLifecycleLog(undefined).size, 0);
    assert.equal(parseLifecycleLog('A\0x\0').size, 0); // no header yet
  });
});

describe('computeFileLifecycle / shownFileLifecycle', () => {
  test('counts adds and deletes per commit; ignored paths and merges skipped', () => {
    const commits = [
      commit(1, { born: ['src/a.js', 'package-lock.json', 'dist/app.js', 'src/b.js'] }),
      commit(2, { buried: ['src/b.js', 'node_modules/x/index.js'] }),
      commit(3, { born: ['src/b.js'] }), // born again: counts again
      commit(4, { parents: ['p1', 'p2'], born: ['src/m.js'], buried: ['src/n.js'] }),
      commit(5),
      null,
      commit(6, { born: [null, 7, ''], buried: 'nope' }),
    ];
    assert.deepEqual(computeFileLifecycle(commits), { added: 3, deleted: 1 });
    assert.deepEqual(computeFileLifecycle([]), { added: 0, deleted: 0 });
    assert.deepEqual(computeFileLifecycle(undefined), { added: 0, deleted: 0 });
  });

  test('multi-repo: root-level ignore rules apply at each repo root', () => {
    const commits = [commit(1, { repo: 'api', born: ['api/dist/x.js', 'api/src/x.js'], buried: ['api/build/y.js'] })];
    assert.deepEqual(computeFileLifecycle(commits), { added: 1, deleted: 0 });
  });

  test('computeStats puts fileLifecycle right after hotFiles', () => {
    const stats = computeStats([commit(1, { born: ['src/a.js'] })], { today: TODAY });
    const keys = Object.keys(stats);
    assert.equal(keys[keys.indexOf('hotFiles') + 1], 'fileLifecycle');
    assert.deepEqual(stats.fileLifecycle, { added: 1, deleted: 0 });
  });

  test('shownFileLifecycle: null without any; malformed values are 0', () => {
    assert.equal(shownFileLifecycle({ added: 0, deleted: 0 }), null);
    assert.equal(shownFileLifecycle(null), null);
    assert.equal(shownFileLifecycle('x'), null);
    assert.deepEqual(shownFileLifecycle({ added: 2, deleted: -1 }), { added: 2, deleted: 0 });
    assert.deepEqual(shownFileLifecycle({ added: 1.5, deleted: 3 }), { added: 0, deleted: 3 });
  });
});

describe('excludeFiles and mergeHistories carry born / buried', () => {
  test('--exclude drops matching born / buried paths, even when no line file matches', () => {
    const isExcluded = compileExcludes(['docs/']);
    const c = commit(1, { files: [{ path: 'docs/a.md', added: 1, removed: 0 }, { path: 'src/a.js', added: 1, removed: 0 }], born: ['docs/a.md', 'src/a.js'], buried: ['docs/old.md'] });
    const [out] = excludeFiles([c], isExcluded);
    assert.deepEqual(out.born, ['src/a.js']);
    assert.deepEqual(out.buried, []);
    assert.deepEqual(c.born, ['docs/a.md', 'src/a.js']); // input untouched
    const plain = commit(2, { born: ['src/z.js'] });
    assert.equal(excludeFiles([plain], isExcluded)[0], plain);
  });

  test('mergeHistories prefixes born / buried with the repo label', () => {
    const merged = mergeHistories([{ label: 'api', commits: [commit(1, { born: ['src/x.js'], buried: ['y.js'] })] }, { label: 'web', commits: [commit(2)] }]);
    const api = merged.commits.find((c) => c.repo === 'api');
    assert.deepEqual([api.born, api.buried], [['api/src/x.js'], ['api/y.js']]);
    assert.equal('born' in merged.commits.find((c) => c.repo === 'web'), false);
  });
});

describe('cards, recap and wrapped.md', () => {
  const base = () => computeStats([commit(1), commit(2)], { today: TODAY });

  test('totals card: a "Files born / buried" row when there is room, en and tr', () => {
    const stats = { ...base(), fileLifecycle: { added: 1234, deleted: 3 } };
    assert.deepEqual(totalsSpec(stats).lines.at(-1), { label: 'Files born / buried', value: '1,234 / 3' });
    assert.deepEqual(totalsSpec(stats, 'tr').lines.at(-1), { label: 'Doğan / gömülen dosya', value: '1.234 / 3' });
    assert.match(totalsSvg(stats), /Files born \/ buried/);
  });

  test('totals card: unchanged (byte-identical) without added or deleted files', () => {
    const stats = base();
    const without = { ...stats };
    delete without.fileLifecycle;
    assert.deepEqual(stats.fileLifecycle, { added: 0, deleted: 0 });
    assert.equal(totalsSvg(stats), totalsSvg(without));
    assert.doesNotMatch(totalsSvg(stats), /born/);
  });

  test('totals card: no row when the card is full (--year rows and contributors)', () => {
    const commits = [commit(1), commit(2, { author: 'Bob', email: 'bob@example.com' })];
    const previous = [commit(3, { date: '2025-03-03T10:00:00Z' })];
    const stats = computeStats(commits, { today: TODAY, previousYear: { year: 2026, commits: previous } });
    assert.ok(stats.yearOverYear);
    const full = totalsSpec(stats);
    assert.equal(full.lines.length, 6);
    const spec = totalsSpec({ ...stats, fileLifecycle: { added: 4, deleted: 1 } });
    assert.deepEqual(spec, full);
  });

  test('recap line, en and tr; none without any', () => {
    const stats = { ...base(), fileLifecycle: { added: 12, deleted: 3 } };
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), /\n {2}Files {8}12 born · 3 buried\n/);
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Dosyalar\s+12 doğdu · 3 gömüldü/);
    assert.doesNotMatch(formatSummary(base(), { repoName: 'demo', today: TODAY }), /born/);
  });

  test('wrapped.md item in the numbers, en and tr; none without any', () => {
    const stats = { ...base(), fileLifecycle: { added: 1, deleted: 1200 } };
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /- \*\*Files touched:\*\* \d+\n- \*\*Files born \/ buried:\*\* 1 file added, 1,200 deleted\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Doğan \/ gömülen dosyalar:\*\* 1 dosya eklendi, 1\.200 silindi/);
    assert.doesNotMatch(buildMarkdown(base(), { repoName: 'demo', today: TODAY }), /born/);
  });

  test('every language has the strings', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.totals.fileLifecycle, 'string');
      assert.equal(typeof L.totals.fileLifecycleValue(2, 1), 'string');
      assert.equal(typeof L.recap.fileLifecycle, 'string');
      assert.equal(typeof L.recap.fileLifecycleValue(2, 1), 'string');
      assert.equal(typeof L.markdown.fileLifecycle, 'string');
      assert.equal(typeof L.markdown.fileLifecycleValue(2, 1), 'string');
    }
  });
});

describe('git (real repos)', () => {
  let root;
  let repo;
  let other;
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const hashes = {};
  let day = 1;
  const at = () => {
    const d = `2025-03-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const write = (dir, path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const init = (dir) => {
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-lifecycle-'));
    repo = join(root, 'app');
    init(repo);
    // 2025-03-01: three files born, a lockfile ignored.
    write(repo, 'src/a.js', 'export const a = 1;\nexport const aa = 2;\nexport const aaa = 3;\n');
    write(repo, 'src/b.js', 'b\n');
    write(repo, 'docs/guide.md', '# guide\n');
    write(repo, 'package-lock.json', '{}\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: start'], at());
    hashes.start = git(repo, ['rev-parse', 'HEAD']).trim();
    // 2025-03-02: a rename (not born nor buried), one delete, one add.
    git(repo, ['mv', 'src/a.js', 'src/alpha.js']);
    git(repo, ['rm', '-q', 'src/b.js']);
    write(repo, 'src/c.js', 'c\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'refactor: rename a, drop b, add c'], at());
    hashes.rename = git(repo, ['rev-parse', 'HEAD']).trim();
    // 2025-03-03: a docs file born and the guide buried (for --exclude).
    write(repo, 'docs/api.md', '# api\n');
    git(repo, ['rm', '-q', 'docs/guide.md']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'docs: swap guide for api'], at());
    // 2025-03-04: a side branch merged with --no-ff (the merge adds nothing of its own).
    git(repo, ['checkout', '-q', '-b', 'side']);
    write(repo, 'src/side.js', 's\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: side'], at());
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], at());
    // Config that must not change the result.
    git(repo, ['config', 'diff.renames', 'false']);
    git(repo, ['config', 'diff.relative', 'true']);
    git(repo, ['config', 'log.showRoot', 'false']);

    other = join(root, 'lib');
    init(other);
    write(other, 'index.js', 'x\n');
    write(other, 'dist/bundle.js', 'y\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', 'feat: lib'], at());
    git(other, ['rm', '-q', 'index.js']);
    write(other, 'main.js', 'z\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', 'refactor: main'], at());
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits gives born / buried; renames are neither; merges get none', async () => {
    const commits = await readCommits(repo);
    const by = new Map(commits.map((c) => [c.subject, c]));
    assert.deepEqual(by.get('feat: start').born, ['docs/guide.md', 'package-lock.json', 'src/a.js', 'src/b.js']);
    assert.equal('buried' in by.get('feat: start'), false);
    assert.deepEqual(by.get('refactor: rename a, drop b, add c').born, ['src/c.js']);
    assert.deepEqual(by.get('refactor: rename a, drop b, add c').buried, ['src/b.js']);
    assert.deepEqual(by.get('feat: side').born, ['src/side.js']);
    assert.equal('born' in by.get('Merge side'), false);
    assert.equal('buried' in by.get('Merge side'), false);
    // The numstat read still sees the rename as a delete plus an add.
    assert.deepEqual(by.get('refactor: rename a, drop b, add c').files.map((f) => f.path).sort(), ['src/a.js', 'src/alpha.js', 'src/b.js', 'src/c.js']);
    // Lockfile left out: 3 + 1 + 1 + 1 born, 1 + 1 buried.
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 6, deleted: 2 });
  });

  test('lifecycle: false skips the read; a failing git gives no fields, never an error', async () => {
    const commits = await readCommits(repo, { lifecycle: false });
    assert.equal(commits.some((c) => 'born' in c || 'buried' in c), false);
    const fake = [{ hash: hashes.start }];
    assert.equal(await readLifecycle(join(root, 'missing'), fake), fake);
    assert.equal('born' in fake[0], false);
    assert.deepEqual(await readLifecycle(repo, []), []);
  });

  test('the window: only the analyzed commits count', async () => {
    const commits = await readCommits(repo, { since: '2025-03-02', until: '2025-03-03' });
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 2, deleted: 2 });
  });

  test('generate: stats.json shape, recap and wrapped.md; --exclude drops files', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.fileLifecycle, { added: 6, deleted: 2 });
    assert.deepEqual(Object.keys(doc.stats.fileLifecycle), ['added', 'deleted']);
    assert.match(readFileSync(r.markdown, 'utf8'), /- \*\*Files born \/ buried:\*\* 6 files added, 2 deleted/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Files\s+6 born · 2 buried/);

    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.fileLifecycle, { added: 4, deleted: 1 });
  });

  test('generate: several repos are summed (ignore rules at each repo root)', async () => {
    const r = await generate({ paths: [repo, other], out: join(root, 'o3'), png: false, json: true }, { today: TODAY });
    // app 6 / 2; lib: index.js + main.js born (dist/ ignored), index.js buried.
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.fileLifecycle, { added: 8, deleted: 3 });
  });

  test('generate: the team read of an --author run skips the lifecycle read', async () => {
    const calls = [];
    const { readHistory } = await import('../src/git.js');
    await generate({ path: repo, out: join(root, 'o4'), png: false, author: 'ada@example.com' }, {
      today: TODAY,
      readHistory: (p, opts) => {
        calls.push(opts);
        return readHistory(p, opts);
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].lifecycle, undefined);
    assert.equal(calls[1].lifecycle, false);
  });

  test('a shallow clone: the boundary commit is neither born nor buried', async () => {
    const clone = join(root, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${other}`, clone], { env: { ...process.env, ...env } });
    const commits = await readCommits(clone);
    assert.equal(commits.length, 1);
    assert.equal('born' in commits[0], false);
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 0, deleted: 0 });
  });
});

// Tester additions: odd paths through the real -z read, a file born and buried inside the
// window, --author / --max-commits through the real read, and the binary end to end.
describe('git (real repos): odd paths, author, cap, CLI', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com' };
  const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' };
  const base = { GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', LC_ALL: 'C' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...extra } });
  const write = (dir, path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const on = (day, who) => ({ ...who, GIT_AUTHOR_DATE: `2025-04-0${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `2025-04-0${day}T10:00:00+00:00` });
  let root;
  let repo;
  // Tabs and backslashes are not valid in Windows file names: plain stand-ins there.
  const WIN = process.platform === 'win32';
  const TAB = WIN ? 'tab_here.txt' : 'tab\there.txt';
  const BS = WIN ? 'back_slash.txt' : 'back\\slash.txt';
  const longText = (seed) => Array.from({ length: 40 }, (_, i) => `${seed} line ${i} ${seed.repeat(3)}`).join('\n') + '\n';

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-lifecycle-odd-'));
    repo = join(root, 'odd');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    git(repo, ['config', 'core.quotePath', 'true']); // -z must ignore it
    // 04-01 Ada: six files born, with spaces, unicode, a tab, a backslash.
    write(repo, 'my file.txt', 'a\n');
    write(repo, 'ünïcödé/naïve.md', longText('n'));
    write(repo, TAB, 't\n');
    write(repo, BS, 'b\n');
    write(repo, 'dir with space/x.js', 'x\n');
    write(repo, 'Readme.md', '# readme\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: odd paths'], on(1, ADA));
    // 04-02 Bob: temp.js born, the backslash file buried.
    write(repo, 'temp.js', 'tmp\n');
    git(repo, ['rm', '-q', BS]);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: temp'], on(2, BOB));
    // 04-03 Ada: temp.js and "my file.txt" buried.
    git(repo, ['rm', '-q', 'temp.js', 'my file.txt']);
    git(repo, ['commit', '-q', '-m', 'chore: drop temp'], on(3, ADA));
    // 04-04 Bob: a rename rewritten past the similarity threshold (an add plus a delete).
    git(repo, ['mv', 'ünïcödé/naïve.md', 'ünïcödé/renamed.md']);
    write(repo, 'ünïcödé/renamed.md', longText('zq'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'docs: rewrite'], on(4, BOB));
    // 04-05 Ada: a binary file born, and a submodule (gitlink) added.
    writeFileSync(join(repo, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0, 255]));
    git(repo, ['add', '-A']);
    git(repo, ['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendor/sub`]);
    git(repo, ['commit', '-q', '-m', 'feat: image and submodule'], on(5, ADA));
    // 04-06 Bob: a case-only rename (R100): neither.
    git(repo, ['mv', 'Readme.md', 'README.md']);
    git(repo, ['commit', '-q', '-m', 'docs: rename readme'], on(6, BOB));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('-z read keeps spaces, unicode, tabs and backslashes verbatim', async () => {
    const commits = await readCommits(repo);
    const by = new Map(commits.map((c) => [c.subject, c]));
    assert.deepEqual([...by.get('feat: odd paths').born].sort(), ['Readme.md', BS, 'dir with space/x.js', 'my file.txt', TAB, 'ünïcödé/naïve.md'].sort());
    assert.deepEqual(by.get('feat: temp').buried, [BS]);
    assert.deepEqual([...by.get('chore: drop temp').buried].sort(), ['my file.txt', 'temp.js']);
    assert.deepEqual(by.get('docs: rewrite').born, ['ünïcödé/renamed.md']);
    assert.deepEqual(by.get('docs: rewrite').buried, ['ünïcödé/naïve.md']);
    assert.deepEqual(by.get('feat: image and submodule').born, ['img.png']); // gitlink skipped
    assert.equal('born' in by.get('docs: rename readme'), false);
    assert.equal('buried' in by.get('docs: rename readme'), false);
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 9, deleted: 4 });
  });

  test('a file born and buried inside the window counts on both sides', async () => {
    const commits = await readCommits(repo, { since: '2025-04-02', until: '2025-04-03' });
    assert.equal(commits.length, 2);
    assert.deepEqual(computeStats(commits, { today: TODAY }).fileLifecycle, { added: 1, deleted: 3 });
  });

  test('--author: only that author\'s commits count (real read)', async () => {
    const ada = await readCommits(repo, { author: 'ada@example.com' });
    assert.deepEqual(computeStats(ada, { today: TODAY }).fileLifecycle, { added: 7, deleted: 2 });
    const bob = await readCommits(repo, { author: 'BOB@example.com' });
    assert.deepEqual(computeStats(bob, { today: TODAY }).fileLifecycle, { added: 2, deleted: 2 });
  });

  test('--author via generate: stats.fileLifecycle is the author\'s, not the team\'s', async () => {
    const r = await generate({ path: repo, out: join(root, 'oa'), png: false, json: true, author: 'bob@example.com' }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(r.statsJson, 'utf8')).stats.fileLifecycle, { added: 2, deleted: 2 });
  });

  test('--max-commits: only the capped commits count', async () => {
    const r = await generate({ path: repo, out: join(root, 'om'), png: false, json: true, maxCommits: 2 }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.equal(doc.stats.totals.commits, 2);
    assert.deepEqual(doc.stats.fileLifecycle, { added: 1, deleted: 0 });
  });

  test('the binary end to end: --json, --md, --author, --exclude, recap', () => {
    const run = (args) => {
      const env = { ...process.env, TZ: 'UTC', ...base };
      delete env.FORCE_COLOR;
      delete env.NO_COLOR;
      return spawnSync(process.execPath, [BIN, repo, '--no-png', '--no-color', ...args], { encoding: 'utf8', env });
    };
    const out = join(root, 'cli1');
    const r = run(['--json', '--md', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.fileLifecycle, { added: 9, deleted: 4 });
    assert.match(r.stdout, /Files\s+9 born · 4 buried/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Files born \/ buried:\*\* 9 files added, 4 deleted/);
    assert.match(readFileSync(join(out, 'cards', '02-totals.svg'), 'utf8'), /Files born \/ buried/);

    const out2 = join(root, 'cli2');
    const a = run(['--json', '--author', 'ada@example.com', '--exclude', 'ünïcödé/', '--lang', 'tr', '--out', out2]);
    assert.equal(a.status, 0, a.stderr);
    // Ada: 7 / 2, the naïve.md add dropped by --exclude.
    assert.deepEqual(JSON.parse(readFileSync(join(out2, 'stats.json'), 'utf8')).stats.fileLifecycle, { added: 6, deleted: 2 });
    assert.match(a.stdout, /Dosyalar\s+6 doğdu · 2 gömüldü/);
  });
});
