import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeHotFiles, isIgnoredPath } from '../src/stats/index.js';

const f = (path, added, removed, binary = false) => ({ path, added, removed, binary });
const c = (...files) => ({ hash: 'h', author: 'A', email: 'a@x.io', date: '2024-06-15T09:00:00Z', subject: 's', files });
const hot = (path, commits, linesAdded, linesRemoved) => ({ path, commits, linesAdded, linesRemoved });

describe('isIgnoredPath', () => {
  test('every lockfile family, at the root and nested', () => {
    const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
      'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'go.sum', 'mix.lock',
      'pubspec.lock', 'Podfile.lock', 'packages.lock.json', 'flake.lock', 'uv.lock'];
    for (const l of locks) {
      assert.equal(isIgnoredPath(l), true, l);
      assert.equal(isIgnoredPath(`packages/web/${l}`), true, `nested ${l}`);
    }
  });

  test('build / dependency directories', () => {
    for (const p of ['node_modules/lodash/index.js', 'packages/a/node_modules/x.js', 'dist/index.js', 'packages/web/dist/app.js',
      'apps/site/build/x.js', 'src/.next/x', 'a/b/__pycache__/m.pyc',
      'build/out.o', 'coverage/lcov.info', '.next/cache/x', 'target/debug/main', 'out/x.html',
      '__pycache__/m.pyc', '.turbo/log', '.nuxt/a.js', '.svelte-kit/a.js', '.parcel-cache/a']) {
      assert.equal(isIgnoredPath(p), true, p);
    }
  });

  test('minified bundles and source maps', () => {
    for (const p of ['vendor/jquery.min.js', 'app.min.js', 'styles/site.min.css', 'app.js.map', 'src/a.css.map']) {
      assert.equal(isIgnoredPath(p), true, p);
    }
  });

  test('vendored code (root vendor/, third_party/) and test snapshots', () => {
    for (const p of ['vendor/github.com/x/y.go', 'vendor/autoload.php', 'third_party/lib/a.c', 'src/__snapshots__/App.test.js.snap',
      '__snapshots__/x.js', 'test/a.test.ts.snap', 'App.snap']) {
      assert.equal(isIgnoredPath(p), true, p);
    }
    for (const p of ['src/vendor/a.js', 'app/third_party/b.py', 'vendor', 'snapshots/a.js', 'src/snap.js', 'a.snapshot', 'vendors/x.js']) {
      assert.equal(isIgnoredPath(p), false, p);
    }
  });

  test('look-alikes are not ignored', () => {
    for (const p of ['src/dist.js', 'builds/x', 'distribution/a.js', 'lock.json', 'README.md', 'src/app.js',
      'my-dist/a.js', 'yarn.lock.md', 'Package-lock.json', 'admin.js', 'sitemap.xml', 'src/map.js', 'notes/my notes.txt']) {
      assert.equal(isIgnoredPath(p), false, p);
    }
  });

  test('generic build names deeper in the tree are real source, not output', () => {
    for (const p of ['src/build/index.js', 'lib/out/x.js', 'src/target/a.ts', 'app/coverage/x.js', 'web/dist/app.js',
      'scripts/build', 'build', 'dist', 'packages/dist/x.js', 'levels/world.map', 'game/a.map']) {
      assert.equal(isIgnoredPath(p), false, p);
    }
  });

  test('non-string or empty path → true, never throws', () => {
    for (const bad of ['', null, undefined, 42, {}]) assert.equal(isIgnoredPath(bad), true, String(bad));
  });
});

describe('computeHotFiles', () => {
  test('empty input → []', () => {
    for (const input of [[], undefined, null, [c()], [{}]]) assert.deepEqual(computeHotFiles(input), []);
  });

  test('a path listed twice in one commit counts once; lines still sum', () => {
    assert.deepEqual(computeHotFiles([c(f('a.js', 1, 2), f('a.js', 3, 4)), c(f('a.js', 1, 0))]), [hot('a.js', 2, 5, 6)]);
  });

  test('sorted by commits desc, then total lines desc, then path asc', () => {
    const out = computeHotFiles([
      c(f('b.js', 1, 0), f('a.js', 1, 0), f('z.js', 50, 50)),
      c(f('b.js', 1, 0), f('a.js', 1, 0), f('c.js', 5, 5)),
      c(f('c.js', 0, 1)),
    ], { limit: 10 });
    assert.deepEqual(out, [
      hot('c.js', 2, 5, 6), // 2 commits, 11 lines
      hot('a.js', 2, 2, 0), // 2 commits, 2 lines, path tie-break
      hot('b.js', 2, 2, 0),
      hot('z.js', 1, 50, 50),
    ]);
  });

  test('path tie-break is plain code-unit order', () => {
    const out = computeHotFiles([c(f('b', 1, 0), f('B', 1, 0), f('a', 1, 0), f('_', 1, 0))]);
    assert.deepEqual(out.map((x) => x.path), ['B', '_', 'a', 'b']);
  });

  test('limit defaults to 5; 0 → []; larger limits return everything', () => {
    const many = c(...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => f(p, 1, 0)));
    assert.deepEqual(computeHotFiles([many]).map((x) => x.path), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(computeHotFiles([many], {}).length, 5);
    assert.deepEqual(computeHotFiles([many], { limit: 0 }), []);
    assert.equal(computeHotFiles([many], { limit: 2 }).length, 2);
    assert.equal(computeHotFiles([many], { limit: 100 }).length, 7);
  });

  test('invalid limit throws TypeError', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '3', null]) {
      assert.throws(() => computeHotFiles([], { limit: bad }), TypeError, String(bad));
    }
  });

  test('binary files count as edits with 0 lines', () => {
    assert.deepEqual(computeHotFiles([c(f('logo.png', 0, 0, true)), c(f('logo.png', 0, 0, true), f('a.js', 9, 9))]), [
      hot('logo.png', 2, 0, 0),
      hot('a.js', 1, 9, 9),
    ]);
  });

  test('ignored paths are skipped; bad entries and bad counts are tolerated', () => {
    const out = computeHotFiles([
      c(f('package-lock.json', 100, 100), f('dist/a.js', 5, 5), f('src/a.js', 2, NaN), null, { added: 3 }, f('src/a.js', undefined, -4)),
      { files: undefined },
    ]);
    assert.deepEqual(out, [hot('src/a.js', 1, 2, 0)]);
  });

  test('a rename (delete + add) counts both paths', () => {
    assert.deepEqual(computeHotFiles([c(f('src/app.js', 0, 7), f('src/main.js', 7, 0))]), [
      hot('src/app.js', 1, 0, 7),
      hot('src/main.js', 1, 7, 0),
    ]);
  });
});
