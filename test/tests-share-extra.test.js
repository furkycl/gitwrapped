// Extra edge cases for the test share (src/stats/tests.js): isTestPath corner cases,
// ignore rules inside test folders, rounding at the 0 / 0.999 / 1 edges, multi-repo
// prefixes (a repo named "test" or "spec"), renames and binary files, rows drawn whole on
// whichever card shows them, byte-identical cards without a test line, and end to end via
// the CLI (stats.json shape, --exclude, several repos, --lang tr recap and wrapped.md).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHistories } from '../src/git.js';
import { computeStats, computeTests, isTestPath, shownTests } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
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
const LANGS = { en, tr };
const specs = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang });
const specOf = (stats, id, lang) => specs(stats, lang).find((c) => c.id === id)?.spec;
const svgs = (stats, lang = 'en') => Object.fromEntries(buildCards(stats, { repoName: 'demo', today: TODAY, lang }).map((c) => [c.id, c.svg]));
const testsRows = (stats, lang = 'en') => specs(stats, lang).flatMap((c) => (c.spec.lines ?? []).filter((r) => r.label === LANGS[lang].hotFiles.tests).map((r) => ({ id: c.id, row: r })));
const roomy = () => [commit(1, [['src/a.js', 100, 10]]), commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]])];
const busy = () => [
  commit(1, [['src/a.js', 100, 10], ['src/b.js', 20, 0], ['README.md', 5, 1]]),
  commit(2, [['test/a.test.js', 40, 2], ['src/a.js', 3, 3]]),
  commit(3, [['docs/guide.md', 7, 0]]),
];

describe('isTestPath: more corner cases', () => {
  test('nested test directories and test names, at any depth', () => {
    for (const p of ['a/b/__tests__/x.js', 'a/b/c/test/d/e.txt', 'x/spec/y/z.rb', 'pkg/tests/fixtures/a.png', 'foo_test.go', 'a/b/foo_test.py', '.test.js', '_test.go', 'deep/a.b.spec.mjs', 'e2e/login.spec.ts', 'Test/a.test.js', 'test_foo.py']) {
      assert.equal(isTestPath(p), true, p);
    }
  });

  test('not tests: lookalike names and directories, a trailing ".test", case, file named spec', () => {
    for (const p of ['spec', 'src/spec', 'test.js', 'tests.js', 'spec.rb', 'contest/a.js', 'src/contest/b.js', 'latest.js', 'src/latest.js', 'attestation/a.js', 'my.test', 'src/my.spec', 'foo_test', 'foo.test.d/x.js', 'x.spec.d/y.ts', 'tests.js/a', 'testdata/a.go', '__test__/a.js', 'Tests/a.js', 'SPEC/a.rb', 'a.Test.js', 'a.SPEC.ts', 'foo_Test.go', 'foo-test.js', 'foo.tests.js']) {
      assert.equal(isTestPath(p), false, p);
    }
  });

  test('Windows-style separators are not split (git always reports "/")', () => {
    assert.equal(isTestPath('test\\a.js'), false);
    assert.equal(isTestPath('src\\__tests__\\a.js'), false);
    // The name rule still sees the whole string as the file name.
    assert.equal(isTestPath('src\\a.test.js'), true);
  });

  test('bad input is false, never throws', () => {
    for (const p of [undefined, null, '', 0, 1, true, NaN, Symbol('x'), () => 'test/a.js', ['test', 'a.js'], { path: 'test/a.js' }, new String('test/a.js')]) {
      assert.equal(isTestPath(p), false, String(typeof p));
    }
  });
});

describe('computeTests: ignore rules inside test folders', () => {
  test('lockfiles, node_modules, snapshots, minified files and root build dirs never count', () => {
    const c = [
      commit(1, [
        ['src/a.js', 10, 0],
        ['test/a.test.js', 10, 0],
        ['tests/package-lock.json', 500, 0],
        ['test/yarn.lock', 500, 0],
        ['test/node_modules/x/index.js', 500, 0],
        ['src/__tests__/__snapshots__/a.test.js.snap', 500, 0],
        ['spec/vendor.min.js', 500, 0],
        ['test/app.js.map', 500, 0],
        ['dist/test/a.test.js', 500, 0],
        ['build/__tests__/x.js', 500, 0],
        ['coverage/test/a.js', 500, 0],
        ['vendor/test/a_test.go', 500, 0],
        ['packages/x/dist/test/a.test.js', 500, 0],
      ]),
    ];
    assert.deepEqual(computeTests(c), { lines: 10, share: 0.5 });
  });

  test('build-dir names below the root are not ignored, so test files there still count', () => {
    const c = [commit(1, [['src/a.js', 10, 0], ['test/dist/a.js', 5, 0], ['packages/x/test/out/b.js', 5, 0]])];
    assert.deepEqual(computeTests(c), { lines: 10, share: 0.5 });
  });

  test('only ignored test files → null; only ignored + binary → null', () => {
    assert.equal(computeTests([commit(1, [['test/package-lock.json', 3, 0], ['test/node_modules/a.js', 4, 0]])]), null);
    assert.equal(computeTests([commit(1, [['test/fixtures/logo.png', undefined, undefined], ['dist/test/a.js', 9, 9]])]), null);
  });
});

describe('computeTests: rounding and caps', () => {
  test('exact 1 only when every counted line is a test line', () => {
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1, 0]])]), { lines: 1, share: 1 });
    // Ignored and binary non-test files do not keep it below 1.
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 3, 4], ['logo.png', undefined, undefined], ['package-lock.json', 99, 0]])]), { lines: 7, share: 1 });
  });

  test('just short of every line is 0.999, never 1', () => {
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1999, 0], ['a.js', 1, 0]])]), { lines: 1999, share: 0.999 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 999999, 0], ['a.js', 0, 1]])]), { lines: 999999, share: 0.999 });
  });

  test('tiny shares round half up at 3 decimals, may round to 0 with lines > 0', () => {
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1, 0], ['a.js', 1999, 0]])]), { lines: 1, share: 0.001 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1, 0], ['a.js', 2001, 0]])]), { lines: 1, share: 0 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 1, 0], ['a.js', 2, 0]])]), { lines: 1, share: 0.333 });
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 2, 0], ['a.js', 1, 0]])]), { lines: 2, share: 0.667 });
  });

  test('share always has at most 3 decimals and stays in [0, 1]', () => {
    for (let t = 0; t <= 40; t += 1) {
      for (const o of [0, 1, 3, 7, 997]) {
        if (t + o === 0) continue;
        const r = computeTests([commit(1, [['test/a.js', t, 0], ['src/a.js', o, 0]])]);
        assert.equal(r.lines, t);
        assert.ok(r.share >= 0 && r.share <= 1);
        assert.equal(Math.round(r.share * 1000) / 1000, r.share);
        assert.equal(r.share === 1, o === 0, `${t}/${o}`);
        assert.equal(JSON.stringify(r.share).replace(/^0\./, '').length <= 3 || r.share === 1 || r.share === 0, true, JSON.stringify(r.share));
      }
    }
  });

  test('shownTests: percent agrees with the share, 100 only for exactly 1', () => {
    assert.deepEqual(shownTests({ lines: 5, share: 0.995 }), { lines: 5, percent: 99 });
    assert.deepEqual(shownTests({ lines: 5, share: 0.9999999 }), { lines: 5, percent: 99 });
    assert.deepEqual(shownTests({ lines: 5, share: 0.005 }), { lines: 5, percent: 1 });
    assert.deepEqual(shownTests({ lines: 5, share: 0.004 }), { lines: 5, percent: 0 });
    assert.deepEqual(shownTests({ lines: 5, share: 1 }), { lines: 5, percent: 100 });
    assert.equal(shownTests({ lines: Number.MAX_SAFE_INTEGER + 1, share: 0.5 }), null);
    assert.equal(shownTests({ lines: Infinity, share: 0.5 }), null);
  });
});

describe('computeTests: multi-repo, renames, binary, merges', () => {
  test('repos named "test", "spec" or "__tests__" do not make their files tests', () => {
    const merged = mergeHistories([
      { label: 'test', commits: [commit(1, [['src/x.js', 10, 0]])] },
      { label: 'spec', commits: [commit(2, [['lib/y.rb', 10, 0]])] },
      { label: '__tests__', commits: [commit(3, [['tests/z.js', 10, 0], ['dist/w.js', 99, 0]])] },
    ]);
    assert.ok(merged.commits.every((c) => c.files.every((f) => f.path.startsWith(`${c.repo}/`))));
    assert.deepEqual(computeTests(merged.commits), { lines: 10, share: 0.333 });
  });

  test('ignore rules apply at each repo root: <repo>/dist/test/... is ignored, <repo>/test/... counts', () => {
    const merged = mergeHistories([
      { label: 'api', commits: [commit(1, [['dist/test/a.test.js', 500, 0], ['test/a.test.js', 4, 0]])] },
      { label: 'web', commits: [commit(2, [['src/b.js', 4, 0], ['node_modules/test/c.js', 9, 0]])] },
    ]);
    assert.deepEqual(computeTests(merged.commits), { lines: 4, share: 0.5 });
  });

  test('a rename out of / into test/ (--no-renames) is a delete there plus an add elsewhere', () => {
    const out = [commit(1, [['test/a.js', 0, 10], ['src/a.js', 10, 0]])];
    assert.deepEqual(computeTests(out), { lines: 10, share: 0.5 });
    // A pure rename inside test/ is all test lines.
    assert.deepEqual(computeTests([commit(1, [['test/a.js', 0, 6], ['tests/a.js', 6, 0]])]), { lines: 12, share: 1 });
  });

  test('binary test files add 0 lines; merges (no files) add nothing', () => {
    const c = [
      commit(1, [['test/fixtures/logo.png', undefined, undefined], ['src/a.js', 3, 1]]),
      commit(2, [], { parents: ['a', 'b'], subject: 'Merge branch x' }),
    ];
    assert.deepEqual(computeTests(c), { lines: 0, share: 0 });
  });

  test('--exclude by name pattern drops just those test files', () => {
    const c = [commit(1, [['src/a.js', 10, 0], ['src/a.test.js', 5, 0], ['pkg/b_test.go', 5, 0], ['spec/c.rb', 10, 0]])];
    assert.deepEqual(computeTests(excludeFiles(c, compileExcludes(['*.test.js']))), { lines: 15, share: 0.6 });
    assert.deepEqual(computeTests(excludeFiles(c, compileExcludes(['*_test.go', 'spec/']))), { lines: 5, share: 0.333 });
    assert.equal(computeTests(excludeFiles(c, compileExcludes(['*']))), null);
  });
});

describe('cards: drawn whole, or not at all', () => {
  const base = computeStats(roomy(), { today: TODAY });
  const busyStats = computeStats(busy(), { today: TODAY });

  test('the row (whichever card has it) is never cut, for realistic sizes, en and tr', () => {
    for (const s of [base, busyStats]) {
      for (const lines of [1, 2, 9, 999, 1000, 12345, 999999, 1234567, 99999999]) {
        for (const share of [0, 0.001, 0.005, 0.266, 0.5, 0.999, 1]) {
          for (const lang of ['en', 'tr']) {
            const rows = testsRows({ ...s, tests: { lines, share } }, lang);
            assert.ok(rows.length <= 1, `${lines} ${share} ${lang}`);
            for (const { id, row } of rows) {
              assert.ok(rowFits(row), `${lang} ${id}: "${row.label}" / "${row.value}" is cut`);
              assert.match(row.value, /%/);
            }
          }
        }
      }
    }
  });

  test('a very large line count still shows the percent whole (or no row)', () => {
    // BUG candidate: from ~1 billion lines even the short value ("1,234,567,890 · 50%") is
    // cut on the row, so the percent is hidden; the row is still added.
    // Also "123,456,789 · 100%" (every line in tests) is cut from 9 digits.
    for (const [lines, share] of [[123456789, 1], [1234567890, 0.5], [99999999999, 0.5]]) {
      for (const lang of ['en', 'tr']) {
        for (const { id, row } of testsRows({ ...base, tests: { lines, share } }, lang)) {
          assert.ok(rowFits(row), `${lang} ${id}: "${row.label}" / "${row.value}" is cut`);
        }
      }
    }
  });

  test('history with no test files: every card byte-identical to no stats.tests at all', () => {
    const commits = [commit(1, [['src/a.js', 100, 10]]), commit(2, [['src/b.js', 40, 2], ['README.md', 3, 3]])];
    const s = computeStats(commits, { today: TODAY });
    assert.deepEqual(s.tests, { lines: 0, share: 0 });
    const without = { ...s };
    delete without.tests;
    for (const lang of ['en', 'tr']) {
      assert.deepEqual(svgs(s, lang), svgs(without, lang), lang);
      assert.deepEqual(svgs(s, lang), svgs({ ...s, tests: null }, lang), lang);
      assert.equal(testsRows(s, lang).length, 0);
    }
    assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY }), /\n {2}Tests /);
    assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /Test lines/);
  });

  test('the languages card description reads the row when it is there', () => {
    for (const lang of ['en', 'tr']) {
      const rows = testsRows(busyStats, lang);
      assert.deepEqual(rows.map((r) => r.id), ['languages'], lang);
      const desc = cardDescription(specOf(busyStats, 'languages', lang));
      assert.ok(desc.includes(LANGS[lang].hotFiles.testsDescription(42, lang === 'en' ? '22%' : '%22')), desc);
      assert.ok(!cardDescription(specOf(busyStats, 'hot-files', lang)).includes(lang === 'en' ? 'changed in tests' : 'Testlerde'));
    }
  });

  test('multi-repo stats: at most one row, drawn whole, value from the repo-relative count', () => {
    const merged = mergeHistories([
      { label: 'test', commits: [commit(1, [['src/x.js', 30, 0]])] },
      { label: 'web', commits: [commit(2, [['src/__tests__/y.js', 10, 0]])] },
    ]);
    const s = computeStats(merged.commits, { today: TODAY, repos: ['test', 'web'] });
    assert.deepEqual(s.tests, { lines: 10, share: 0.25 });
    for (const lang of ['en', 'tr']) {
      const rows = testsRows(s, lang);
      assert.ok(rows.length <= 1, lang);
      for (const { row } of rows) {
        assert.ok(rowFits(row));
        assert.equal(row.value, lang === 'en' ? '10 lines · 25%' : '10 satır · %25');
      }
    }
  });
});

describe('end to end (real repos via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let day = 1;
  const at = () => {
    const d = `2025-04-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const write = (dir, rel, data) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), data);
  };
  const lines = (n, seed = 'x') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join('\n') + '\n';
  const init = (dir) => {
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
  };
  const run = (args) => {
    const res = spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    return res;
  };
  const testsOf = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.tests;
  let root;
  let app;
  let named;
  let plain;
  let locky;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-tests-x-'));
    app = join(root, 'app');
    init(app);
    // c1: 20 src + 5 test lines counted; a binary fixture (0 lines) and lots of ignored stuff.
    write(app, 'src/a.js', lines(20));
    write(app, 'test/a.test.js', lines(5, 't'));
    write(app, 'test/fixtures/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3, 0, 255]));
    write(app, 'tests/package-lock.json', lines(300));
    write(app, 'test/node_modules/x.js', lines(50));
    write(app, 'dist/test/b.test.js', lines(40));
    write(app, 'src/__tests__/__snapshots__/a.snap', lines(30));
    git(app, ['add', '-A', '-f']);
    git(app, ['commit', '-q', '-m', 'feat: start'], at());
    // c2: rename test/a.test.js -> src/moved.js with rename detection on in config (ignored:
    // --no-renames): 5 deleted in test/, 5 added in src/.
    git(app, ['config', 'diff.renames', 'true']);
    git(app, ['mv', 'test/a.test.js', 'src/moved.js']);
    git(app, ['commit', '-q', '-m', 'refactor: move'], at());
    // c3: a Go test by name and a spec/ dir: 10 more test lines.
    write(app, 'lib/c_test.go', lines(4));
    write(app, 'spec/s.rb', lines(6));
    git(app, ['add', '-A']);
    git(app, ['commit', '-q', '-m', 'test: more'], at());
    // all counted: 20 + 5 + 5 + 5 + 4 + 6 = 45; tests: 5 + 5 + 4 + 6 = 20 → 0.444

    named = join(root, 'test');
    init(named);
    write(named, 'src/x.js', lines(5));
    write(named, 'test/y.test.js', lines(5));
    git(named, ['add', '-A']);
    git(named, ['commit', '-q', '-m', 'feat: x'], at());

    plain = join(root, 'plain');
    init(plain);
    write(plain, 'src/a.js', lines(8));
    write(plain, 'contest/latest.js', lines(3));
    git(plain, ['add', '-A']);
    git(plain, ['commit', '-q', '-m', 'feat: a'], at());

    locky = join(root, 'locky');
    init(locky);
    write(locky, 'package-lock.json', lines(8));
    write(locky, 'test/logo.png', Buffer.from([0, 1, 2, 0, 255]));
    git(locky, ['add', '-A']);
    git(locky, ['commit', '-q', '-m', 'chore: lock'], at());
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json: exactly {lines, share}, ignores, binary, rename as delete + add', () => {
    const out = join(root, 'e1');
    run([app, '--out', out, '--json']);
    const t = testsOf(out);
    assert.deepEqual(Object.keys(t), ['lines', 'share']);
    assert.deepEqual(t, { lines: 20, share: 0.444 });
  });

  test('--exclude: a test folder, a name pattern, everything but tests', () => {
    const cases = [
      [['spec/'], { lines: 14, share: 0.359 }],
      [['*_test.go'], { lines: 16, share: 0.39 }],
      [['src/'], { lines: 20, share: 1 }],
      [['test/', 'spec/', 'lib/'], { lines: 0, share: 0 }],
      [['*'], null],
    ];
    cases.forEach(([globs, want], i) => {
      const out = join(root, `x${i}`);
      run([app, '--out', out, '--json', ...globs.flatMap((g) => ['--exclude', g])]);
      assert.deepEqual(testsOf(out), want, globs.join(' '));
    });
  });

  test('several repos: paths checked inside each repo, so the repo named "test" is not all tests', () => {
    const out = join(root, 'm1');
    run([app, named, '--out', out, '--json']);
    // 45 + 10 counted, 20 + 5 in tests.
    assert.deepEqual(testsOf(out), { lines: 25, share: 0.455 });
    const out2 = join(root, 'm2');
    run([named, plain, '--out', out2, '--json']);
    assert.deepEqual(testsOf(out2), { lines: 5, share: 0.238 });
  });

  test('no test files → {lines: 0, share: 0}, no recap line, no wrapped.md item; nothing counted → null', () => {
    const out = join(root, 'p1');
    const res = run([plain, '--out', out, '--json', '--md']);
    assert.deepEqual(testsOf(out), { lines: 0, share: 0 });
    assert.doesNotMatch(res.stdout, /\n {2}Tests /);
    assert.doesNotMatch(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Test lines/);
    const out2 = join(root, 'p2');
    run([locky, '--out', out2, '--json']);
    assert.equal(testsOf(out2), null);
  });

  test('recap and wrapped.md, en and tr', () => {
    const out = join(root, 'r1');
    const res = run([app, '--out', out, '--md']);
    assert.match(res.stdout, /\n {2}Tests\s+20 lines \(44% of lines changed\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /- \*\*Test lines:\*\* 20 lines \(44% of lines changed\)\n/);
    const outTr = join(root, 'r2');
    const resTr = run([app, '--out', outTr, '--md', '--lang', 'tr']);
    assert.match(resTr.stdout, /\n {2}Testler\s+20 satır \(değişen satırların %44 kadarı\)\n/);
    assert.doesNotMatch(resTr.stdout, /\n {2}Tests /);
    const md = readFileSync(join(outTr, 'wrapped.md'), 'utf8');
    assert.match(md, /- \*\*Test satırları:\*\* 20 satır \(değişen satırların %44 kadarı\)\n/);
    assert.doesNotMatch(md, /Test lines|of lines changed/);
  });

  test('the cards on disk carry the row on exactly one of hot-files / languages (this fixture has room)', () => {
    for (const lang of ['en', 'tr']) {
      const out = join(root, `c-${lang}`);
      run([app, '--out', out, '--lang', lang]);
      const files = execFileSync('ls', [join(out, 'cards')], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const label = `>${LANGS[lang].hotFiles.tests}<`;
      const pct = lang === 'en' ? '44%' : '%44';
      const withRow = files.filter((f) => /hot-files|languages/.test(f) && readFileSync(join(out, 'cards', f), 'utf8').includes(label));
      assert.equal(withRow.length, 1, `${lang}: ${withRow.join()}`);
      for (const f of withRow) assert.ok(readFileSync(join(out, 'cards', f), 'utf8').includes(pct), f);
    }
  });
});
