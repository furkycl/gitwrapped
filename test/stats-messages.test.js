import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeMessages, computeStats } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

let seq = 0;
const msg = (subject, date = '2024-06-12T12:00:00Z', hash = `h${seq++}`) => ({
  hash, author: 'A', email: 'a@x.io', date, subject, files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0,
});
const subjects = (...xs) => xs.map((s) => msg(s));
const counts = (...xs) => computeMessages(subjects(...xs)).counts;

describe('computeMessages: empty / invalid input', () => {
  test('empty, undefined and null → nulls and zeros', () => {
    for (const input of [[], undefined, null]) {
      assert.deepEqual(computeMessages(input), {
        shortest: null,
        longest: null,
        topWord: null,
        counts: { fix: 0, wip: 0, oops: 0 },
        averageLength: 0,
        fixups: { commits: 0, share: 0 },
        subjectLength: null,
      });
    }
  });

  test('only empty / blank / missing / non-string subjects → same as empty (but subjectLength: length 0 each)', () => {
    const commits = [msg(''), msg('   \t '), msg(undefined), msg(42), { date: '2024-06-12T12:00:00Z' }, null];
    const { subjectLength, ...rest } = computeMessages(commits);
    const { subjectLength: none, ...empty } = computeMessages([]);
    assert.deepEqual(rest, empty);
    assert.equal(none, null);
    // subjectLength counts every non-merge commit (the five objects), a missing subject as 0.
    assert.deepEqual(subjectLength, { median: 0, over72: 0, share: 0 });
  });
});

describe('computeMessages: shortest / longest', () => {
  test('picks by length and reports subject, hash, length', () => {
    const m = computeMessages([msg('medium one', undefined, 'a'), msg('x', undefined, 'b'), msg('the longest subject', undefined, 'c')]);
    assert.deepEqual(m.shortest, { subject: 'x', hash: 'b', length: 1 });
    assert.deepEqual(m.longest, { subject: 'the longest subject', hash: 'c', length: 19 });
  });

  test('length is in code points (emoji counts as 1)', () => {
    const m = computeMessages(subjects('🎉🎉', 'abc'));
    assert.deepEqual(m.shortest, { subject: '🎉🎉', hash: m.shortest.hash, length: 2 });
    assert.equal(m.longest.subject, 'abc');
    assert.equal(m.longest.length, 3);
    assert.equal(computeMessages(subjects('ship it 🚀')).longest.length, 9);
  });

  test('subjects are trimmed; empty subjects are ignored', () => {
    const m = computeMessages(subjects('   hi  ', '', '   ', '\tlonger one\n'));
    assert.deepEqual([m.shortest.subject, m.shortest.length], ['hi', 2]);
    assert.deepEqual([m.longest.subject, m.longest.length], ['longer one', 10]);
  });

  test('ties go to the earliest date regardless of input order', () => {
    const m = computeMessages([
      msg('bbb', '2024-06-12T12:00:00Z', 'late'),
      msg('aaa', '2024-06-10T12:00:00Z', 'early'),
      msg('ccc', '2024-06-11T12:00:00Z', 'mid'),
    ]);
    assert.equal(m.shortest.hash, 'early');
    assert.equal(m.longest.hash, 'early');
  });

  test('ties are compared by instant, not by local wall clock', () => {
    // 09:00+05:00 = 04:00Z is earlier than 06:00Z even though 09 > 06 on the clock.
    const m = computeMessages([msg('aaa', '2024-06-12T06:00:00Z', 'utc'), msg('bbb', '2024-06-12T09:00:00+05:00', 'plus5')]);
    assert.equal(m.shortest.hash, 'plus5');
  });

  test('equal dates → input order', () => {
    const m = computeMessages([msg('aaa', '2024-06-12T12:00:00Z', 'first'), msg('bbb', '2024-06-12T12:00:00Z', 'second')]);
    assert.equal(m.shortest.hash, 'first');
    assert.equal(m.longest.hash, 'first');
  });

  test('undated commits come after dated ones, then input order', () => {
    const m = computeMessages([
      msg('u1', 'not a date', 'undated1'),
      msg('u2', null, 'undated2'),
      msg('d1', '2024-06-12T12:00:00Z', 'dated'),
    ]);
    assert.equal(m.shortest.hash, 'dated');
    const undatedOnly = computeMessages([msg('u1', 'garbage', 'first'), msg('u2', 'garbage2', 'second')]);
    assert.equal(undatedOnly.shortest.hash, 'first');
  });

  test('missing hash → null', () => {
    assert.equal(computeMessages([{ subject: 'x', date: '2024-06-12T12:00:00Z' }]).shortest.hash, null);
  });
});

describe('computeMessages: topWord', () => {
  test('most frequent word, lowercased, every occurrence counts', () => {
    assert.deepEqual(computeMessages(subjects('Parser parser PARSER', 'render')).topWord, { word: 'parser', count: 3 });
  });

  test('stopwords and conventional-commit types are excluded', () => {
    const tw = computeMessages(subjects('feat: the thing', 'feat: the thing', 'chore: and the docs', 'refactor(ci): this', 'test: tests style perf build')).topWord;
    assert.deepEqual(tw, { word: 'thing', count: 2 });
  });

  test('fix / wip / oops families are excluded', () => {
    const tw = computeMessages(subjects('fix fixes fixed fixing hotfix bugfix bugfixes', 'wip WIP', 'oops ooops oopss', 'login')).topWord;
    assert.deepEqual(tw, { word: 'login', count: 1 });
  });

  test('words under 3 code points are excluded; 3 code points count', () => {
    assert.equal(computeMessages(subjects('go go go ok ok')).topWord, null);
    assert.deepEqual(computeMessages(subjects('日本 日本 日本語')).topWord, { word: '日本語', count: 1 });
  });

  test('unicode words are kept whole', () => {
    assert.deepEqual(computeMessages(subjects('çalışma dosyası', 'yeni çalışma')).topWord, { word: 'çalışma', count: 2 });
  });

  test('apostrophes inside words are kept; trailing ones stripped', () => {
    assert.deepEqual(computeMessages(subjects("don't panic", "don't stop")).topWord, { word: "don't", count: 2 });
    assert.deepEqual(computeMessages(subjects("users' users")).topWord, { word: 'users', count: 2 });
  });

  test('ties → alphabetical', () => {
    assert.deepEqual(computeMessages(subjects('zebra apple mango')).topWord, { word: 'apple', count: 1 });
    assert.deepEqual(computeMessages(subjects('zebra zebra', 'apple apple')).topWord, { word: 'apple', count: 2 });
  });

  test('words without a letter (issue ids, versions) are excluded', () => {
    assert.deepEqual(computeMessages(subjects('close 1234', 'refs 1234', 'ref 1234 again', '2024 2024 2024')).topWord, { word: 'again', count: 1 });
    assert.deepEqual(computeMessages(subjects('v2 v2 v2', 'http2 http2', '3rd 3rd 3rd')).topWord, { word: '3rd', count: 3 });
  });

  test('hyphenated fix / wip / oops words are excluded too', () => {
    const tw = computeMessages(subjects('auto-fix auto-fix hot-fix', 'wip-branch oops-again', 'auto-format')).topWord;
    assert.deepEqual(tw, { word: 'auto-format', count: 1 });
    // Words that merely contain "fix" are ordinary words.
    assert.deepEqual(computeMessages(subjects('prefix-match prefix-match')).topWord, { word: 'prefix-match', count: 2 });
  });

  test('null when nothing qualifies', () => {
    assert.equal(computeMessages(subjects('fix: the wip', 'oops')).topWord, null);
  });
});

describe('computeMessages: counts', () => {
  test('fix family matches as a whole word, case-insensitive', () => {
    assert.equal(counts('fix: a', 'Fixes #12', 'FIXED it', 'fixing stuff', 'hotfix for prod', 'bugfix: thing', 'bugfixes', 'Hotfixed').fix, 8);
  });

  test('prefix / fixture / suffix / affix do not count as fix', () => {
    assert.equal(counts('add prefix option', 'update fixture', 'new fixtures', 'affix label', 'fixer upper', 'suffix').fix, 0);
  });

  test('word boundaries are Unicode-aware: letters before / after block a match', () => {
    assert.deepEqual(counts('çfix', 'préfix', 'fixé', 'öwip', 'wipé', 'ñoops', 'oopsñ', 'fix_it', '2fix'), { fix: 0, wip: 0, oops: 0 });
    // Non-word neighbours (punctuation, emoji, hyphen) still count.
    assert.deepEqual(counts('🐛fix', '«wip»', 'oops…', 'hot-fix', '(fixed)'), { fix: 3, wip: 1, oops: 1 });
  });

  test('wip is whole-word only', () => {
    assert.deepEqual(counts('WIP', 'wip: thing', '[wip] more', 'wipe the disk', 'swipe gesture', 'wiping').wip, 3);
  });

  test('oops family: oops / ooops / oopss / OOPS', () => {
    assert.equal(counts('oops', 'ooops', 'oopss', 'OOPS!!', 'whoops', 'oopsie').oops, 4);
  });

  test('"ops" (single o) is not an oops', () => {
    // e.g. "ops: rotate keys" — DevOps-style prefix, not a mistake.
    assert.equal(counts('ops: rotate keys', 'ci ops cleanup').oops, 0);
  });

  test('each commit counts at most once per category', () => {
    assert.deepEqual(counts('fix fix fixes wip wip oops ooops'), { fix: 1, wip: 1, oops: 1 });
    assert.deepEqual(counts('fix: oops wip', 'fix', 'other'), { fix: 2, wip: 1, oops: 1 });
  });

  test('empty subjects are not counted', () => {
    assert.deepEqual(computeMessages([msg(''), msg(null)]).counts, { fix: 0, wip: 0, oops: 0 });
  });
});

describe('computeMessages: merge commits are skipped', () => {
  const merges = [
    "Merge branch 'fix-login' into main",
    "Merge branches 'a' and 'b'",
    'Merge pull request #42 from me/wip-oops-fix',
    "Merge remote-tracking branch 'origin/main'",
    "Merge tag 'v1.0'",
    'Merge commit \'abc123\'',
    "Merge 'feature/fix-everything' into develop",
  ];

  test('git-generated merge subjects count for nothing', () => {
    assert.deepEqual(computeMessages(subjects(...merges)), computeMessages([]));
  });

  test('merges are left out of shortest, longest, topWord, counts and averageLength', () => {
    const m = computeMessages(subjects(...merges, 'add login page', 'login'));
    assert.equal(m.shortest.subject, 'login');
    assert.equal(m.longest.subject, 'add login page');
    assert.deepEqual(m.topWord, { word: 'login', count: 2 });
    assert.deepEqual(m.counts, { fix: 0, wip: 0, oops: 0 });
    assert.equal(m.averageLength, 9.5); // (14 + 5) / 2
  });

  test('ordinary subjects mentioning merge still count', () => {
    const m = computeMessages(subjects('Merge sort for results', 'merge branch helper', 'fix merge conflict'));
    assert.equal(m.longest.subject, 'Merge sort for results');
    assert.equal(m.counts.fix, 1);
    assert.deepEqual(m.topWord, { word: 'merge', count: 3 });
  });
});

describe('computeMessages: averageLength', () => {
  test('mean code-point length of non-empty subjects, rounded to 1 decimal', () => {
    assert.equal(computeMessages(subjects('a', 'bb', 'bb')).averageLength, 1.7); // 5/3
    assert.equal(computeMessages(subjects('a', 'bb', 'bbbb')).averageLength, 2.3); // 7/3
    assert.equal(computeMessages(subjects('a', 'bb')).averageLength, 1.5);
    assert.equal(computeMessages(subjects('abcd', '', '  ')).averageLength, 4);
    assert.equal(computeMessages(subjects('🎉', '🎉🎉🎉')).averageLength, 2);
  });
});

describe('messages on the fixture repo (integration)', () => {
  let fixture;
  let commits;
  before(async () => {
    fixture = makeFixtureRepo();
    commits = await readCommits(fixture.dir);
  });
  after(() => fixture?.cleanup());

  test('shortest, longest, counts, topWord, average', () => {
    const { messages } = computeStats(commits, { today: '2024-03-14' });
    const byIndex = (s) => commits.find((c) => c.subject === s).hash;
    assert.deepEqual(messages.shortest, { subject: 'wip', hash: byIndex('wip'), length: 3 });
    assert.deepEqual(messages.longest, { subject: 'refactor: move app to main', hash: byIndex('refactor: move app to main'), length: 26 });
    assert.deepEqual(messages.counts, { fix: 2, wip: 1, oops: 1 });
    // "app", "commit" and "empty" each appear twice → alphabetical.
    assert.deepEqual(messages.topWord, { word: 'app', count: 2 });
    // 20+23+3+20+4+19+16+26 = 131 / 8 = 16.375
    assert.equal(messages.averageLength, 16.4);
    assert.deepEqual(messages, computeStats(fixture.commits, { today: '2024-03-14' }).messages);
  });
});
