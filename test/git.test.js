import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLogArgs, parseLog, readCommits, readHistory, versionAtLeast, DEFAULT_LIMIT, LOG_FORMAT } from '../src/git.js';

const US = '\x1f';

// One log record: hash, author, email, date, then the subject; parents (%P) are empty
// and there are no Co-authored-by values (nothing after the subject).
function rec(hash, author, email, date, ...subject) {
  return [hash, author, email, date, '', ...subject].join(US) + '\0';
}

describe('buildLogArgs', () => {
  test('defaults: log with delimiter format and no filters', () => {
    const args = buildLogArgs();
    assert.equal(args[0], 'log');
    assert.ok(args.includes('--no-color'));
    assert.ok(args.includes(`--format=${LOG_FORMAT}`));
    assert.equal(LOG_FORMAT, '%H%x1f%aN%x1f%aE%x1f%aI%x1f%P%x1f%s%n%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)');
    assert.ok(args.includes('--use-mailmap'));
    assert.ok(args.includes('--ignore-submodules=all'));
    assert.ok(args.includes('-z'));
    assert.ok(args.includes('--encoding=UTF-8'));
    assert.ok(args.includes('--numstat'));
    assert.ok(args.includes('--no-renames'));
    assert.ok(!args.some((a) => a.startsWith('--since') || a.startsWith('--author')));
    assert.deepEqual(buildLogArgs({}), args);
  });

  test('maxCount adds --max-count; invalid values throw', () => {
    assert.ok(buildLogArgs({ maxCount: 50001 }).includes('--max-count=50001'));
    assert.ok(!buildLogArgs().some((a) => a.startsWith('--max-count')));
    for (const maxCount of [0, -1, 2.5, '10']) assert.throws(() => buildLogArgs({ maxCount }), TypeError);
  });

  test('--since date is sent as local midnight in a single arg', () => {
    // git gets a bound 7 days looser (a pre-filter); the exact author-date filter is in JS.
    assert.ok(buildLogArgs({ since: '2025-01-15' }).includes('--since-as-filter=2025-01-08 00:00:00'));
    assert.ok(buildLogArgs({ since: '2025-03-03' }).includes('--since-as-filter=2025-02-24 00:00:00'));
    assert.ok(buildLogArgs({ since: '2025-01-15T10:00:00Z' }).includes('--since-as-filter=2025-01-08T10:00:00.000Z'));
    // Older git (no --since-as-filter): no git-side date filter at all.
    assert.ok(!buildLogArgs({ since: '2025-01-15', sinceAsFilter: false }).some((a) => a.startsWith('--since')));
  });

  test('--author matches the exact email as a case-insensitive fixed string', () => {
    const args = buildLogArgs({ author: 'a.b@x.io' });
    assert.ok(args.includes('--author=<a.b@x.io>'));
    assert.ok(args.includes('--fixed-strings'));
    assert.ok(args.includes('--regexp-ignore-case'));
  });

  test('shell-looking values stay inside one argument', () => {
    const args = buildLogArgs({ since: '2025-01-01; rm -rf /', author: '$(whoami)' });
    assert.ok(args.includes('--since-as-filter=2025-01-01; rm -rf /'));
    assert.ok(args.includes('--author=<$(whoami)>'));
  });
});

describe('parseLog', () => {
  test('empty / nullish output returns []', () => {
    assert.deepEqual(parseLog(''), []);
    assert.deepEqual(parseLog('\n'), []);
    assert.deepEqual(parseLog('\0'), []);
    assert.deepEqual(parseLog(undefined), []);
  });

  test('parses one record with all fields', () => {
    const out = rec('abc123', 'Ada', 'ada@x.io', '2025-01-02T03:04:05+01:00', 'init');
    assert.deepEqual(parseLog(out), [
      {
        hash: 'abc123',
        author: 'Ada',
        email: 'ada@x.io',
        date: '2025-01-02T03:04:05+01:00',
        parents: [],
        coAuthors: [],
        subject: 'init',
        files: [],
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
      },
    ]);
  });

  test('parses multiple records and keeps order', () => {
    const out = rec('h2', 'B', 'b@x', '2025-01-02T00:00:00Z', 'second') + rec('h1', 'A', 'a@x', '2025-01-01T00:00:00Z', 'first');
    assert.deepEqual(parseLog(out).map((c) => c.hash), ['h2', 'h1']);
  });

  test('subjects with pipes, tabs, quotes and unicode survive', () => {
    const subject = 'fix | thing\tand "quotes" 🎉 ünïcode';
    const [c] = parseLog(rec('h', 'Zoë Ñúñez 李', 'z@x', '2025-01-01T00:00:00Z', subject));
    assert.equal(c.subject, subject);
    assert.equal(c.author, 'Zoë Ñúñez 李');
  });

  test('empty subject and trailing newlines / CRLF are handled', () => {
    const out = rec('h', 'A', 'a@x', '2025-01-01T00:00:00Z', '') + '\n\r\n';
    const [c] = parseLog(out);
    assert.equal(c.subject, '');
    assert.equal(c.date, '2025-01-01T00:00:00+00:00');
  });

  test('malformed records with too few fields are skipped', () => {
    assert.deepEqual(parseLog('garbage\0'), []);
  });
});

describe('readCommits', () => {
  let dir;
  let emptyDir;
  let notRepo;

  function git(cwd, args, env = {}) {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
    });
  }

  function commit(subject, { name, email, date, file }) {
    if (file) writeFileSync(join(dir, file), `${subject}\n`, { flag: 'a' });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', subject], {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date,
    });
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitwrapped-test-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    commit('initial commit', { name: 'Ada Lovelace', email: 'ada@example.com', date: '2024-01-10T09:00:00Z', file: 'a.txt' });
    commit('fix: handle a | b\tcase', { name: 'Zoë Ñúñez', email: 'zoe@example.com', date: '2024-06-15T23:30:00+02:00', file: 'b.txt' });
    commit('wip 🎉', { name: 'Ada Lovelace', email: 'ada@example.com', date: '2025-03-01T12:00:00Z' });

    emptyDir = mkdtempSync(join(tmpdir(), 'gitwrapped-empty-'));
    git(emptyDir, ['init', '-q']);

    notRepo = mkdtempSync(join(tmpdir(), 'gitwrapped-norepo-'));
  });

  after(() => {
    for (const d of [dir, emptyDir, notRepo]) {
      if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
    }
  });

  test('returns all commits, newest first, with all fields', async () => {
    const commits = await readCommits(dir);
    assert.equal(commits.length, 3);
    assert.deepEqual(commits.map((c) => c.subject), ['wip 🎉', 'fix: handle a | b\tcase', 'initial commit']);
    const [, mid] = commits;
    assert.match(mid.hash, /^[0-9a-f]{40}$/);
    assert.equal(mid.author, 'Zoë Ñúñez');
    assert.equal(mid.email, 'zoe@example.com');
    assert.equal(mid.date, '2024-06-15T23:30:00+02:00');
    // %aI prints UTC as +00:00 on older git but as Z on git 2.55 (CI): compare instants.
    assert.match(commits[0].date, /^2025-03-01T12:00:00(Z|[+-]00:00)$/);
    assert.equal(Date.parse(commits[0].date), Date.parse('2025-03-01T12:00:00Z'));
  });

  test('hashes match git rev-list', async () => {
    const commits = await readCommits(dir);
    const revs = git(dir, ['rev-list', 'HEAD']).trim().split('\n');
    assert.deepEqual(commits.map((c) => c.hash), revs);
  });

  test('--since filters older commits', async () => {
    const commits = await readCommits(dir, { since: '2024-06-01' });
    assert.deepEqual(commits.map((c) => c.subject), ['wip 🎉', 'fix: handle a | b\tcase']);
  });

  test('--author filters by exact email', async () => {
    const ada = await readCommits(dir, { author: 'ada@example.com' });
    assert.equal(ada.length, 2);
    assert.ok(ada.every((c) => c.email === 'ada@example.com'));
    assert.deepEqual(await readCommits(dir, { author: 'da@example.com' }), []);
    assert.deepEqual(await readCommits(dir, { author: 'ada@example' }), []);
  });

  test('--since and --author combine', async () => {
    const commits = await readCommits(dir, { since: '2025-01-01', author: 'ada@example.com' });
    assert.deepEqual(commits.map((c) => c.subject), ['wip 🎉']);
  });

  test('empty repo returns []', async () => {
    assert.deepEqual(await readCommits(emptyDir), []);
  });

  test('non-repo directory throws a clear error', async () => {
    await assert.rejects(readCommits(notRepo), { message: `not a git repository: ${notRepo}` });
  });

  test('missing path throws a clear error', async () => {
    const missing = join(notRepo, 'does-not-exist');
    await assert.rejects(readCommits(missing), { message: `path does not exist: ${missing}` });
  });

  test('readHistory caps at the most recent `limit` commits and flags truncation', async () => {
    const two = await readHistory(dir, { limit: 2 });
    assert.equal(two.truncated, true);
    assert.equal(two.limit, 2);
    assert.deepEqual(two.commits.map((c) => c.subject), ['wip 🎉', 'fix: handle a | b\tcase']);
    const exact = await readHistory(dir, { limit: 3 });
    assert.equal(exact.truncated, false, 'exactly `limit` commits is not truncated');
    assert.equal(exact.commits.length, 3);
    const all = await readHistory(dir);
    assert.equal(all.limit, DEFAULT_LIMIT);
    assert.equal(all.truncated, false);
    assert.deepEqual(all.commits, await readCommits(dir));
    assert.deepEqual((await readCommits(dir, { limit: 1 })).map((c) => c.subject), ['wip 🎉']);
  });

  test('a repo owned by another user gives a safe.directory hint', { skip: process.getuid?.() === 0 ? false : 'needs root to chown' }, async (t) => {
    const owned = mkdtempSync(join(tmpdir(), 'gitwrapped-dubious-'));
    t.after(() => rmSync(owned, { recursive: true, force: true, maxRetries: 5 }));
    git(owned, ['init', '-q']);
    execFileSync('chown', ['-R', '65534', owned]);
    const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      await assert.rejects(readHistory(owned), (err) => {
        assert.match(err.message, /dubious ownership/);
        assert.match(err.message, /git config --global --add safe\.directory '[^']+'/);
        return true;
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('readHistory on an empty repo → no commits, not truncated', async () => {
    assert.deepEqual(await readHistory(emptyDir), { commits: [], truncated: false, limit: DEFAULT_LIMIT, shallow: false, unborn: true, otherRefs: false });
  });

  test('readHistory rejects a non-positive / non-integer limit', async () => {
    for (const limit of [0, -1, 1.5, NaN, '3']) await assert.rejects(readHistory(dir, { limit }), TypeError);
  });

});

describe('parseLog edge cases', () => {
  test('a \\x1f inside the subject is kept (subject is the last field)', () => {
    const [c] = parseLog(['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'a', 'b'].join(US) + '\0');
    assert.equal(c.subject, `a${US}b`);
  });

  test('leading and trailing spaces in fields are preserved', () => {
    const [c] = parseLog(rec('h', ' A ', 'a@x', '2025-01-01T00:00:00Z', '  padded  '));
    assert.equal(c.author, ' A ');
    assert.equal(c.subject, '  padded  ');
  });

  test('a \\x1e inside the subject is kept', () => {
    const [c] = parseLog(rec('h', 'A', 'a@x', '2025-01-01T00:00:00Z', 'a\x1eb'));
    assert.equal(c.subject, 'a\x1eb');
  });

  test('records without a trailing NUL are handled', () => {
    const out = `h1${US}A${US}a@x${US}2025-01-01T00:00:00Z${US}${US}one\0h2${US}B${US}b@x${US}2025-01-02T00:00:00Z${US}${US}two`;
    assert.deepEqual(parseLog(out).map((c) => [c.hash, c.subject]), [['h1', 'one'], ['h2', 'two']]);
  });

  test('accepts a Buffer-like value via String()', () => {
    const out = Buffer.from(rec('h', 'A', 'a@x', '2025-01-01T00:00:00Z', 'buf'));
    assert.equal(parseLog(out)[0].subject, 'buf');
  });
});

describe('readCommits edge cases', () => {
  let root;
  let dir;

  function git(cwd, args, env = {}) {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
    });
  }

  function commit(message, { name = 'Ada', email = 'ada@example.com', date, committerDate = date, extra = [] }) {
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', ...extra, '-m', message], {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: committerDate,
    });
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gitwrapped edge '));
    dir = join(root, 'repo with spaces');
    git(root, ['init', '-q', 'repo with spaces']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['checkout', '-q', '-b', 'main']);
    commit('   leading spaces kept, trailing dropped   ', { date: '2024-01-01T00:00:00Z' });
    commit('first line\nwrapped line\n\nbody paragraph\nwith detail', {
      name: 'Владимир 山田 José',
      email: 'vlad@example.com',
      date: '2024-01-02T00:00:00Z',
    });
    git(dir, ['checkout', '-q', '-b', 'side']);
    commit('side work', { date: '2024-01-03T00:00:00Z' });
    git(dir, ['checkout', '-q', 'main']);
    commit('main work', { date: '2024-01-04T00:00:00Z' });
    git(dir, ['merge', '-q', '--no-ff', '--no-gpg-sign', 'side', '-m', 'Merge branch side'], {
      GIT_AUTHOR_DATE: '2024-01-05T00:00:00Z',
      GIT_COMMITTER_DATE: '2024-01-05T00:00:00Z',
    });
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('works for a repo path containing spaces, with no opts', async () => {
    const commits = await readCommits(dir);
    assert.equal(commits.length, 5);
    assert.deepEqual(await readCommits(dir, undefined), commits);
    assert.deepEqual(await readCommits(dir, {}), commits);
  });

  test('empty-string filters behave like no filters', async () => {
    assert.equal((await readCommits(dir, { since: '', author: '' })).length, 5);
  });

  test('merge commits and both branches are included', async () => {
    const subjects = (await readCommits(dir)).map((c) => c.subject);
    assert.equal(subjects[0], 'Merge branch side');
    assert.ok(subjects.includes('side work'));
    assert.ok(subjects.includes('main work'));
  });

  test('multi-line message: only the subject (first paragraph, joined) is kept', async () => {
    const c = (await readCommits(dir)).find((x) => x.email === 'vlad@example.com');
    assert.equal(c.subject, 'first line wrapped line');
    assert.ok(!c.subject.includes('body'));
  });

  test('unicode author names round-trip', async () => {
    const c = (await readCommits(dir)).find((x) => x.email === 'vlad@example.com');
    assert.equal(c.author, 'Владимир 山田 José');
  });

  test('leading spaces in the subject survive; git strips trailing ones', async () => {
    const commits = await readCommits(dir);
    assert.equal(commits.at(-1).subject, '   leading spaces kept, trailing dropped');
  });

  test('--since is inclusive at the exact commit timestamp', async () => {
    const at = await readCommits(dir, { since: '2024-01-04T00:00:00Z' });
    assert.deepEqual(at.map((c) => c.subject), ['Merge branch side', 'main work']);
    const after1s = await readCommits(dir, { since: '2024-01-04T00:00:01Z' });
    assert.deepEqual(after1s.map((c) => c.subject), ['Merge branch side']);
  });

  test('--since in the future returns []', async () => {
    assert.deepEqual(await readCommits(dir, { since: '2999-01-01' }), []);
  });

  test('a subdirectory of the repo reads the whole repo', async () => {
    const sub = join(dir, 'sub dir');
    mkdirSync(sub);
    assert.equal((await readCommits(sub)).length, 5);
  });

  test('a file path throws "not a directory"', async () => {
    const file = join(root, 'plain file.txt');
    writeFileSync(file, 'x');
    await assert.rejects(readCommits(file), { message: `not a directory: ${file}` });
  });
});

describe('readCommits review fixes', () => {
  let dir;
  let other;

  function git(cwd, args, env = {}) {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
    });
  }

  function commit(cwd, message, { email = 'ada@example.com', date, committerDate = date, extra = [] }) {
    git(cwd, ['commit', '-q', '--allow-empty', '--no-gpg-sign', ...extra, '-m', message], {
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: committerDate,
    });
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitwrapped-fixes-'));
    git(dir, ['init', '-q']);
    // Dates without an offset are local time, matching how --since YYYY-MM-DD is read.
    commit(dir, 'day before', { date: '2024-02-09 23:59:00' });
    commit(dir, 'early on since day', { date: '2024-02-10 00:30:00' });
    commit(dir, 'old author, new committer', { date: '2023-05-05 12:00:00', committerDate: '2024-03-01 12:00:00' });
    commit(dir, 'Mixed case email', { email: 'Grace.Hopper@Example.COM', date: '2024-03-02 12:00:00' });
    commit(dir, 'rs\x1ein subject', { date: '2024-03-03 12:00:00', extra: ['--cleanup=verbatim'] });

    other = mkdtempSync(join(tmpdir(), 'gitwrapped-other-'));
    git(other, ['init', '-q']);
    commit(other, 'other repo', { date: '2024-01-01 12:00:00' });
  });

  after(() => {
    for (const d of [dir, other]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  });

  test('--since YYYY-MM-DD includes commits early that day (local midnight)', async () => {
    const subjects = (await readCommits(dir, { since: '2024-02-10' })).map((c) => c.subject);
    assert.ok(subjects.includes('early on since day'));
    assert.ok(!subjects.includes('day before'));
  });

  test('--since filters on author date, not committer date', async () => {
    const subjects = (await readCommits(dir, { since: '2024-01-01' })).map((c) => c.subject);
    assert.ok(!subjects.includes('old author, new committer'));
    const all = (await readCommits(dir)).map((c) => c.subject);
    assert.ok(all.includes('old author, new committer'));
  });

  test('--author matches a mixed-case recorded email case-insensitively', async () => {
    for (const author of ['grace.hopper@example.com', 'GRACE.HOPPER@EXAMPLE.COM', 'Grace.Hopper@Example.COM']) {
      const commits = await readCommits(dir, { author });
      assert.deepEqual(commits.map((c) => c.subject), ['Mixed case email'], author);
    }
  });

  test('a \\x1e in a real subject is preserved', async () => {
    const [latest] = await readCommits(dir);
    assert.equal(latest.subject, 'rs\x1ein subject');
  });

  test('GIT_DIR / GIT_WORK_TREE / GIT_CEILING_DIRECTORIES etc. do not override the path', async () => {
    const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR'];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      process.env.GIT_DIR = join(other, '.git');
      process.env.GIT_WORK_TREE = other;
      process.env.GIT_INDEX_FILE = join(other, '.git', 'index');
      process.env.GIT_COMMON_DIR = join(other, '.git');
      process.env.GIT_CEILING_DIRECTORIES = dir;
      const sub = join(dir, 'nested');
      mkdirSync(sub, { recursive: true });
      const commits = await readCommits(sub);
      assert.equal(commits.length, 5);
      assert.ok(!commits.some((c) => c.subject === 'other repo'));
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  });

  test('output larger than maxBuffer gives a friendly error', async () => {
    await assert.rejects(readCommits(dir, { maxBuffer: 16 }), /larger than .*MB; narrow it down with --since or --author/);
  });
});

test('parseLog normalizes a UTC "Z" author date to +00:00 (git 2.55 vs older git)', () => {
  const [c] = parseLog('h\x1fA\x1fa@x\x1f2025-01-01T00:00:00Z\x1f\x1fs\0');
  assert.equal(c.date, '2025-01-01T00:00:00+00:00');
});

test('versionAtLeast compares major.minor', () => {
  assert.equal(versionAtLeast([2, 37, 0], 2, 37), true);
  assert.equal(versionAtLeast([2, 43, 1], 2, 37), true);
  assert.equal(versionAtLeast([3, 0, 0], 2, 37), true);
  assert.equal(versionAtLeast([2, 36, 9], 2, 37), false);
  assert.equal(versionAtLeast([1, 99, 0], 2, 37), false);
  assert.equal(versionAtLeast([0, 0, 0], 2, 37), false);
});

describe('--since uses author-date semantics on new and old git', () => {
  let dir;
  let fakeBin;
  const env = (extra = {}) => {
    const e = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.io', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete e[k];
    return e;
  };
  const commitAt = (subject, author, committer = author) =>
    execFileSync('git', ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', subject], {
      cwd: dir,
      env: env({ GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer }),
    });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-since-skew-'));
    execFileSync('git', ['init', '-q', dir], { env: env() });
    commitAt('old', '2023-06-01T12:00:00Z');
    // Committer clock behind the author's: committed before --since, authored after it.
    commitAt('skewed', '2024-07-01T12:00:00Z', '2023-12-28T12:00:00Z');
    commitAt('ancient-in-the-middle', '2022-01-01T12:00:00Z');
    commitAt('new', '2024-08-01T12:00:00Z');
    // A fake git 2.30 (no --since-as-filter) that forwards everything else to the real git.
    // It is a POSIX shell script, so it is only built where the test using it runs.
    if (process.platform === 'win32') return;
    fakeBin = mkdtempSync(join(tmpdir(), 'gw-oldgit-'));
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(fakeBin, 'git'),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 2.30.1"; exit 0; fi\n` +
        `for a in "$@"; do case "$a" in --since-as-filter*) echo "fatal: unrecognized argument: $a" >&2; exit 128;; esac; done\n` +
        `exec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    if (fakeBin) rmSync(fakeBin, { recursive: true, force: true, maxRetries: 5 });
  });

  test('a commit authored after --since but committed a few days before it is kept', async () => {
    const { commits } = await readHistory(dir, { since: '2024-01-01' });
    assert.deepEqual(commits.map((c) => c.subject), ['new', 'skewed']);
  });

  test('old git (no --since-as-filter): same commits, filtered in JS', { skip: process.platform === 'win32' && 'POSIX shell wrapper' }, () => {
    // A child process, so the cached git version of this process is not reused.
    const script = `import { readHistory } from ${JSON.stringify(new URL('../src/git.js', import.meta.url).href)};
const r = await readHistory(${JSON.stringify(dir)}, { since: '2024-01-01' });
const capped = await readHistory(${JSON.stringify(dir)}, { since: '2024-01-01', limit: 1 });
console.log(JSON.stringify([r.commits.map((c) => c.subject), capped.commits.map((c) => c.subject), capped.truncated]));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...env(), PATH: `${fakeBin}${delimiter}${process.env.PATH}` },
    });
    assert.deepEqual(JSON.parse(out), [['new', 'skewed'], ['new'], true]);
  });
});
