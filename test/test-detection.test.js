// Broader test-file detection (src/stats/tests.js isTestPath): a "specs" directory,
// "_spec." / "_tests." names, pytest's "test_*.py" and "conftest.py", and xUnit-style
// class names (FooTest.java, UserTests.cs, LoginSpec.groovy), with the lookalikes that
// still are not tests, and how they move stats.tests (computeTests, multi-repo, computeStats).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { computeStats, computeTests, isTestPath, TEST_DIRS } from '../src/stats/index.js';
import * as testsModule from '../src/stats/tests.js';

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

const yes = (paths) => {
  for (const p of paths) assert.equal(isTestPath(p), true, p);
};
const no = (paths) => {
  for (const p of paths) assert.equal(isTestPath(p), false, p);
};

describe('TEST_DIRS', () => {
  test('lists the five directory names, frozen, same array from both modules', () => {
    assert.deepEqual(TEST_DIRS, ['test', 'tests', '__tests__', 'spec', 'specs']);
    assert.ok(Object.isFrozen(TEST_DIRS));
    assert.equal(testsModule.TEST_DIRS, TEST_DIRS);
    assert.equal(testsModule.isTestPath, isTestPath);
    assert.throws(() => TEST_DIRS.push('testing'), TypeError);
    assert.equal(TEST_DIRS.length, 5);
  });
});

describe('isTestPath: rule 1, directory segments (now with "specs")', () => {
  test('a specs/ directory at any depth', () => {
    yes(['specs/a.js', 'pkg/specs/a.rb', 'a/b/specs/c/d.txt', 'specs/fixtures/logo.png', 'specs/specs']);
  });

  test('the old directories still count', () => {
    yes(['test/a.js', 'tests/a.py', '__tests__/a.jsx', 'spec/a.rb', 'src/test/java/com/x/Foo.java']);
  });

  test('only directories: a file named specs is not a test; case-sensitive; no partial names', () => {
    no(['specs', 'src/specs', 'Specs/a.rb', 'SPECS/a.rb', 'specsuite/a.rb', 'myspecs/a.rb', 'specs.d/a.rb', 'testdata/a.go', 'Tests/a.js', 'tests_py/api.py']);
  });
});

describe('isTestPath: rule 2, name markers', () => {
  test('_spec. and _tests. join .test., .spec. and _test.', () => {
    yes(['user_spec.rb', 'spec_helper_spec.rb', 'app/models/user_spec.rb', 'lib/parser_spec.lua', 'pkg/db_tests.rs', 'a_tests.py', 'x_spec.d.ts']);
    yes(['a.test.js', 'a.spec.ts', 'db_test.go']);
  });

  test('lookalike names are not tests', () => {
    no(['tests.js', 'spec.rb', 'foo.tests.js', 'foo-test.js', 'foo-spec.rb', 'my_spec', 'foo_tests', 'a_SPEC.rb', 'a_Tests.py', 'spec_helper.rb', 'a_specs.rb', 'my_spec/a.rb', 'x_tests.d/a.py']);
  });
});

describe('isTestPath: rule 3, test_*.ext (pytest style)', () => {
  test('test_<name>.<ext> anywhere', () => {
    yes(['test_foo.py', 'tests_py/test_api.py', 'lib/test_utils.py', 'pkg/test_a.b.py', 'src/test_x.c', 'test_a-b.sh']);
  });

  test('needs a non-empty name and an extension; prefix is case-sensitive', () => {
    no(['test_.py', 'test_foo', 'src/test_foo', 'Test_foo.py', 'TEST_foo.py', 'mytest_foo.py', 'a.test_foo.py', 'test_foo/a.py', 'test_.', 'test_']);
  });
});

describe('isTestPath: rule 4, conftest.py', () => {
  test('exactly conftest.py, at any depth', () => {
    yes(['conftest.py', 'src/conftest.py', 'pkg/a/conftest.py']);
  });

  test('anything else named like it is not', () => {
    no(['conftest.pyc', 'conftest.py.bak', 'Conftest.py', 'myconftest.py', 'conftest', 'conftest.pyi', 'conftest.py/a.txt', 'conftest_py']);
  });
});

describe('isTestPath: rule 5, xUnit class names', () => {
  test('<Name>Test / Tests / Spec on JVM, .NET, Swift, PHP, Obj-C files', () => {
    yes([
      'FooTest.java',
      'src/test/java/com/x/FooTest.java',
      'src/main/java/com/x/FooTest.java',
      'UserTests.cs',
      'LoginSpec.groovy',
      'AppTests.swift',
      'UserTest.php',
      'ApiTest.kt',
      'ParserSpec.scala',
      'ServiceSpec.kt',
      'ViewSpec.swift',
      'MathSpec.php',
      'ViewSpec.m',
      'MathTests.fs',
      'LegacyTest.vb',
      'ViewTests.m',
      'ViewTests.mm',
      'a1Test.java',
      '9Test.java',
      'xTests.cs',
    ]);
  });

  test('lookalikes: no prefix, wrong case, other extensions, a dotted prefix', () => {
    no([
      'Test.java',
      'Tests.cs',
      'Spec.groovy',
      'a.Test.js',
      'Latest.java',
      'Contest.cs',
      'FooTest.js',
      'FooTest.py',
      'FooTEST.java',
      'Footest.java',
      'FooTests.JAVA',
      'Foo_Test.java',
      'Foo-Test.java',
      'Foo.Test.java',
      'FooTest.java.orig',
      'FooTest.javax',
      'FooTestUtil.java',
      'FooSpecs.groovy',
      'PodSpec.java',
      'ActiveUserSpec.cs',
      'MathSpec.fs',
      'LegacySpec.vb',
      'FooTest',
      'src/FooTest/a.txt',
    ]);
  });
});

describe('isTestPath: still not tests, still never throws', () => {
  test('the negatives from the spec', () => {
    no(['tests.js', 'spec.rb', 'foo.tests.js', 'foo-test.js', 'testdata/a.go', 'Tests/a.js', 'specs', 'src/specs', 'my_spec', 'conftest.pyc', 'test_.py', 'test_foo', 'Test.java', 'a.Test.js', 'Latest.java', 'FooTest.js', 'FooTEST.java', 'Tests.cs']);
  });

  test('ordinary source files', () => {
    no(['src/Foo.java', 'app/models/user.rb', 'lib/utils.py', 'README.md', 'src/latest.js', 'contest/a.js', 'attest.py']);
  });

  test('bad input is false', () => {
    for (const p of [undefined, null, '', 0, true, NaN, Symbol('x'), ['specs', 'a.js'], { path: 'conftest.py' }, new String('test_foo.py')]) {
      assert.equal(isTestPath(p), false, String(typeof p));
    }
  });
});

describe('computeTests with the new rules', () => {
  test('specs, _spec, test_*, xUnit names and conftest all count; plain source does not', () => {
    const c = [
      commit(1, [['app/models/user.rb', 10, 0], ['spec/user_spec.rb', 20, 0]]),
      commit(2, [['lib/test_utils.py', 5, 0], ['src/FooTest.java', 10, 5]]),
      commit(3, [['src/Foo.java', 40, 10]]),
    ];
    // all: 10 + 20 + 5 + 15 + 50 = 100; tests: 20 + 5 + 15 = 40
    assert.deepEqual(computeTests(c), { lines: 40, share: 0.4 });
  });

  test('a specs/ folder, _tests. names and conftest.py', () => {
    const c = [commit(1, [['pkg/specs/a.rb', 3, 0], ['src/db_tests.rs', 3, 0], ['conftest.py', 2, 2], ['src/db.rs', 10, 0]])];
    // all: 3 + 3 + 4 + 10 = 20; tests: 10
    assert.deepEqual(computeTests(c), { lines: 10, share: 0.5 });
  });

  test('lookalikes do not count', () => {
    const c = [commit(1, [['src/specs', 5, 0], ['test_foo', 5, 0], ['Latest.java', 5, 0], ['conftest.pyc', 5, 0], ['FooTest.js', 5, 0]])];
    assert.deepEqual(computeTests(c), { lines: 0, share: 0 });
  });

  test('ignore rules still win inside new test folders', () => {
    const c = [commit(1, [['specs/package-lock.json', 500, 0], ['specs/node_modules/a.js', 50, 0], ['specs/a.rb', 5, 0], ['src/a.rb', 5, 0]])];
    assert.deepEqual(computeTests(c), { lines: 5, share: 0.5 });
  });

  test('multi-repo: checked inside each repo, so a repo labelled "specs" is not all tests', () => {
    const merged = mergeHistories([
      { label: 'specs', commits: [commit(1, [['src/x.rb', 10, 0]])] },
      { label: 'api', commits: [commit(2, [['conftest.py', 4, 0], ['tests_py/test_api.py', 6, 0]])] },
      { label: 'app', commits: [commit(3, [['src/test/java/com/x/FooTest.java', 10, 0], ['src/main/java/com/x/Foo.java', 20, 0]])] },
    ]);
    assert.ok(merged.commits.every((c) => c.files.every((f) => f.path.startsWith(`${c.repo}/`))));
    // all: 10 + 10 + 30 = 50; tests: 10 + 10 = 20
    assert.deepEqual(computeTests(merged.commits), { lines: 20, share: 0.4 });
  });
});

describe('computeStats end to end', () => {
  test('stats.tests reflects the broader detection and keeps exactly {lines, share}', () => {
    const c = [
      commit(1, [['app/models/user.rb', 10, 0], ['spec/user_spec.rb', 20, 0]]),
      commit(2, [['lib/test_utils.py', 5, 0], ['src/FooTest.java', 10, 5]]),
      commit(3, [['src/Foo.java', 40, 10]]),
    ];
    const stats = computeStats(c, { today: TODAY });
    assert.deepEqual(stats.tests, { lines: 40, share: 0.4 });
    assert.deepEqual(Object.keys(stats.tests), ['lines', 'share']);
    assert.deepEqual(JSON.parse(JSON.stringify(stats.tests)), { lines: 40, share: 0.4 });
  });

  test('a Python-only repo (test_*.py + conftest.py) now has test lines', () => {
    const c = [commit(1, [['app/main.py', 30, 0], ['test_main.py', 15, 0], ['conftest.py', 5, 0]])];
    assert.deepEqual(computeStats(c, { today: TODAY }).tests, { lines: 20, share: 0.4 });
  });
});
