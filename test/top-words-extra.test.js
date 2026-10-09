// Extra coverage for top subject words (stats.messages.topWords, src/stats/messages.js
// subjectWords / shownTopWords): a token-level brute-force oracle against computeMessages
// on random seeded histories, aggregation invariants on arbitrary strings, Unicode / Turkish
// casing / NFD edge cases, prefix / issue-ref / hash / number cutting, and the CLI end to
// end on a real git repo (stats.json, wrapped.md and the recap in en and tr, with --author,
// --since / --until and merge commits).
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeMessages, computeStats, shownTopWords, subjectWords } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'gitwrapped.js');
const TODAY = '2026-04-01';

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (subject, i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const set = (s) => [...subjectWords(s)].sort();

// --- token vocabulary for the oracle ---------------------------------------------------
// Each token is raw text and the word it must count as (null: contributes no word).
const WORD_TOKENS = [
  ['parser', 'parser'],
  ['Parser', 'parser'],
  ['PARSER', 'parser'],
  ['cache', 'cache'],
  ['Cache', 'cache'],
  ['login', 'login'],
  ['fix', 'fix'],
  ['Fix', 'fix'],
  ['feat', 'feat'],
  ['zebra', 'zebra'],
  ['İYİ', 'iyi'],
  ['iyi', 'iyi'],
  ['İYİ', 'iyi'], // NFD dotted capital I
  ['ışık', 'ışık'],
  ['değişiklik', 'değişiklik'],
  ['DEĞİŞİKLİK', 'değişiklik'],
  ['çözüm', 'çözüm'], // NFD
  ['ÇÖZÜM', 'çözüm'],
  ['çözüm', 'çözüm'],
  ['café', 'café'], // NFD
  ['café', 'café'],
  ['ärger', 'ärger'],
  ["don't", null], // a stopword (also written with ’)
  ['don’t', null],
  ["isn't", "isn't"],
  ['isn’t', "isn't"],
  ['日本語', '日本語'],
  ['добавить', 'добавить'],
  ['deadbeef', 'deadbeef'], // hex without a digit is a word
  ['abc', 'abc'],
  ['db', null], // too short
  ['go', null],
  ['the', null], // stopwords
  ['The', null],
  ['with', null],
  ['için', null],
  ['İÇİN', null],
  ['daha', null],
  ['olarak', null],
  ['bir', null],
  ['how', null],
  ['Why', null],
  ['doesn’t', null],
];
const JUNK_TOKENS = [
  '#12',
  '#7',
  'GH-45',
  'gh-7',
  'ABC-123',
  'PROJ-9',
  'owner/repo#12',
  'deadbee1',
  'a1b2c3d4e5f6',
  '0123456789abcdef0123456789abcdef01234567',
  '42',
  '2024',
  '1.2.3',
  'https://example.com/parser/cache',
  'www.example.org/login',
  '🎉',
  '✨',
  '…',
  '---',
  'ada@example.com',
  'zebra@parser.io',
  ':sparkles:',
  ':white_check_mark:',
];
const PREFIXES = ['', '', '', 'feat: ', 'fix: ', 'fix(api)!: ', 'Chore(deps-dev): ', 'refactor!: ', 'docs(readme): ', 'login: ', 'fixup! ', 'squash! fixup! feat: ', ':sparkles: ', '✨ fix(ui): ', 'Revert "feat: ', 'fixup! :bug: fix: '];
const SEPS = [' ', '  ', ', ', ' - ', '; ', ' · ', ' (', ') '];

/** A random subject and the distinct words it must yield. */
function randomSubject(r) {
  const n = Math.floor(r() * 7);
  const parts = [];
  const want = new Set();
  for (let k = 0; k < n; k += 1) {
    if (r() < 0.7) {
      const [raw, word] = pick(r, WORD_TOKENS);
      parts.push(raw);
      if (word) want.add(word);
    } else parts.push(pick(r, JUNK_TOKENS));
  }
  let subject = '';
  for (const [k, p] of parts.entries()) subject += (k > 0 ? pick(r, SEPS) : '') + p;
  const prefix = pick(r, PREFIXES);
  // A prefix is only cut with a blank (or the end) after the colon: with an empty body it
  // is cut entirely. Its type word never counts.
  return { subject: prefix + subject, want };
}

/** Brute-force reference: count each word once per non-merge commit, sort, top 3. */
function reference(entries) {
  const counts = new Map();
  for (const { want, merge } of entries) {
    if (merge) continue;
    for (const w of want) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const all = [...counts.entries()].map(([word, count]) => ({ word, count }));
  all.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return all.slice(0, 3);
}

describe('topWords: brute-force oracle on random seeded histories', () => {
  test('1000 random histories: computeMessages().topWords equals the token-level reference', () => {
    const r = rng(100);
    let nonEmpty = 0;
    for (let i = 0; i < 1000; i += 1) {
      const n = Math.floor(r() * 15);
      const entries = Array.from({ length: n }, () => ({ ...randomSubject(r), merge: r() < 0.15 }));
      const commits = entries.map((e, k) => commit(e.subject, k + 1, { parents: e.merge ? ['a', 'b'] : ['p'] }));
      const got = computeMessages(commits).topWords;
      const want = reference(entries);
      assert.deepEqual(got, want, `#${i}: ${JSON.stringify(entries.map((e) => [e.subject, e.merge]))}`);
      if (got.length) nonEmpty += 1;
    }
    assert.ok(nonEmpty > 500, `non-empty ${nonEmpty}`);
  });

  test('per subject: subjectWords equals the token-level expectation (5000 random subjects)', () => {
    const r = rng(7);
    for (let i = 0; i < 5000; i += 1) {
      const { subject, want } = randomSubject(r);
      if (subject.includes('@')) continue; // emails are scrubbed by computeMessages, not subjectWords
      assert.deepEqual(set(subject), [...want].sort(), JSON.stringify(subject));
    }
  });

  test('arbitrary random strings: never throws; topWords is the aggregation of subjectWords over non-merge commits', () => {
    const r = rng(2026);
    const ALPHABET = ['a', 'b', 'Z', 'İ', 'ı', 'I', 'ş', 'é', '́', '̇', '1', '9', '#', '-', '/', ':', '(', ')', '!', ' ', ' ', "'", '’', '.', '@', '_', 'x', 'f', 'e', 't', '日', '🎉', '\t'];
    for (let i = 0; i < 500; i += 1) {
      const commits = Array.from({ length: 1 + Math.floor(r() * 10) }, (_, k) => {
        const len = Math.floor(r() * 40);
        let s = '';
        for (let j = 0; j < len; j += 1) s += pick(r, ALPHABET);
        return commit(s, k + 1, { parents: r() < 0.1 ? ['a', 'b'] : ['p'] });
      });
      const m = computeMessages(commits);
      const counts = new Map();
      for (const c of commits) {
        if (c.parents.length > 1 || c.subject.trim() === '') continue;
        // Email-shaped text is scrubbed before the words are read; these subjects use "@"
        // so compare only histories without one.
        for (const w of subjectWords(c.subject)) counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      if (commits.some((c) => c.subject.includes('@'))) {
        assert.ok(Array.isArray(m.topWords) && m.topWords.length <= 3);
        continue;
      }
      const want = [...counts]
        .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 3)
        .map(([word, count]) => ({ word, count }));
      assert.deepEqual(m.topWords, want, JSON.stringify(commits.map((c) => c.subject)));
      for (const { word, count } of m.topWords) {
        assert.equal(word, word.normalize('NFC'));
        assert.ok([...word].length >= 3, word);
        assert.ok(Number.isInteger(count) && count >= 1 && count <= commits.length);
        // shownTopWords accepts every word computeMessages produces.
      }
      const shown = shownTopWords(m.topWords);
      const wantShown = m.topWords.filter((w) => w.count >= 2);
      assert.deepEqual(shown, wantShown.length ? wantShown : null);
    }
  });
});

describe('subjectWords: edge cases', () => {
  test('Turkish dotted İ (precomposed and NFD) lowercases to plain i; ı stays dotless', () => {
    assert.deepEqual(set('İSTANBUL'), ['istanbul']);
    assert.deepEqual(set('İstanbul'), ['istanbul']);
    assert.deepEqual(set('KİTAP kitap Kitap'), ['kitap']);
    assert.deepEqual(set('ışık'), ['ışık']);
    assert.deepEqual(set('ŞİMDİ şimdi'), ['şimdi']);
    // Never a stray combining dot (U+0307) in a word.
    for (const w of subjectWords('İİİ İzmir DİKKAT I\u0307I\u0307I\u0307')) assert.ok(!w.includes('\u0307'), JSON.stringify(w));
    // Uppercase stopwords are still stopwords.
    assert.deepEqual(set('İÇİN ÇOK DAHA ŞEY ÖNCE SONRA'), []);
  });

  test('NFD input is NFC-normalized, so NFD and NFC spellings are one word', () => {
    const m = computeMessages([commit('çözüm bulundu', 1), commit('çözüm hazır', 2), commit('ÇÖZÜM', 3)]);
    assert.deepEqual(m.topWords[0], { word: 'çözüm', count: 3 });
    assert.equal(m.topWords[0].word, 'çözüm'.normalize('NFC'));
    assert.deepEqual(set('café café CAFÉ'), ['café']);
  });

  test('conventional prefixes: type, scope, !, case, empty body', () => {
    assert.deepEqual(set('feat(parser)!: parser rewrite'), ['parser', 'rewrite']);
    assert.deepEqual(set('FEAT(Parser): thing'), ['thing']);
    assert.deepEqual(set('refactor!: drop node'), ['drop', 'node']);
    assert.deepEqual(set('fix(api)!:'), []);
    assert.deepEqual(set('fix(api)!:   '), []);
    assert.deepEqual(set('fix(scope with spaces)!: words'), ['words']);
    assert.deepEqual(set('docs:\tstuff'), ['stuff']);
    // Only the first prefix is cut.
    assert.deepEqual(set('feat: fix: nested'), ['fix', 'nested']);
    // Not a prefix: digit in the type, colon without blank, or later in the subject.
    assert.deepEqual(set('fix:crash'), ['crash', 'fix']);
    assert.deepEqual(set('see feat: here'), ['feat', 'here', 'see']);
    // fixup!/squash! markers are cut first, then the conventional prefix behind them.
    assert.deepEqual(set('fixup! feat: add parser'), ['add', 'parser']);
  });

  test('issue refs, hashes and numbers yield no words', () => {
    assert.deepEqual(set('#1 #22 #333 GH-1 gh-22 ABC-1 XY-99 owner/repo#4 org.name/re-po#5'), []);
    assert.deepEqual(set('deadbee1 0123456 a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'), []);
    assert.deepEqual(set('12 3.14 2024-01-01 v1.2.3 10x'), []);
    assert.deepEqual(set('closes #12, refs GH-3 and fixes ABC-77'), ['closes', 'fixes', 'refs']);
    // A merged-in number / ref does not glue letters into a longer word.
    assert.deepEqual(set('parser#12cache'), ['cache', 'parser']);
  });

  test('all-stopword / all-short subjects → no words; computeMessages topWords is []', () => {
    const subjects = ['the and for', 'ile ve için bir', 'a an to of', 'bu şu o', 'go db ok', 'this that these those', '#1 2 3'];
    for (const s of subjects) assert.deepEqual(set(s), [], s);
    assert.deepEqual(computeMessages(subjects.map((s, i) => commit(s, i + 1))).topWords, []);
    assert.deepEqual(computeMessages(['feat: ', 'fix(x)!:'].map((s, i) => commit(s, i + 1))).topWords, []);
  });

  test('non-string subjects never throw (subjectWords and computeMessages)', () => {
    const weird = [undefined, null, 0, 1n, NaN, true, {}, [], ['parser parser'], { toString: () => 'parser' }, Symbol('s'), () => 'x', new String('parser cache')];
    for (const v of weird) {
      assert.doesNotThrow(() => subjectWords(v));
      assert.equal(subjectWords(v).size, 0);
    }
    const commits = weird.map((v, i) => commit(v, i + 1));
    let m;
    assert.doesNotThrow(() => {
      m = computeMessages(commits);
    });
    assert.deepEqual(m.topWords, []);
    // Mixed with real subjects, only the strings count.
    m = computeMessages([...commits, commit('parser cache', 99), commit('parser', 100)]);
    assert.deepEqual(m.topWords, [{ word: 'parser', count: 2 }, { word: 'cache', count: 1 }]);
  });

  test('shownTopWords never throws on hostile stats.json input', () => {
    const hostile = [
      [null, undefined, 5, 'x', [], {}],
      [{ word: 'parser', count: '5' }, { word: 'parser', count: Infinity }, { word: 'parser', count: NaN }],
      [{ word: 'pa rser', count: 5 }, { word: 'ab', count: 5 }, { word: '123', count: 5 }, { word: '<svg>', count: 5 }],
    ];
    for (const h of hostile) assert.equal(shownTopWords(h), null, JSON.stringify(h));
    assert.deepEqual(shownTopWords([{ word: 'parser', count: 1.6 }, { word: 'cache', count: 1.4 }]), [{ word: 'parser', count: 2 }]);
  });
});

describe('outputs agree (in memory, en and tr)', () => {
  const subjects = ['parser parser', 'parser cache', 'cache login', 'login once', 'solo'];
  const stats = computeStats(subjects.map((s, i) => commit(s, i + 1)), { today: TODAY });

  test('recap and wrapped.md show the same shown words, in order, in en and tr', () => {
    assert.deepEqual(stats.messages.topWords, [
      { word: 'cache', count: 2 },
      { word: 'login', count: 2 },
      { word: 'parser', count: 2 },
    ]);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const recap = formatSummary(stats, { repoName: 'demo', today: TODAY, lang });
      assert.match(recap, new RegExp(`${L.recap.topWords}\\s+"cache" ×2 · "login" ×2 · "parser" ×2 \\(${L.recap.topWordsNote}\\)`), lang);
      const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang });
      assert.ok(md.includes(`## ${L.markdown.topWords}\n\n${L.markdown.topWordsValue(shownTopWords(stats.messages.topWords)).replace(/[()]/g, '\\$&')}`), `${lang}\n${md}`);
    }
  });

  test('no word in ≥ 2 commits → no recap line and no wrapped.md section', () => {
    const s = computeStats(['alpha', 'beta', 'gamma'].map((x, i) => commit(x, i + 1)), { today: TODAY });
    assert.equal(s.messages.topWords.length, 3);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      assert.ok(!formatSummary(s, { repoName: 'demo', today: TODAY, lang }).includes(L.recap.topWordsNote), lang);
      assert.ok(!buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }).includes(`## ${L.markdown.topWords}`), lang);
    }
  });
});

describe('real git: CLI end to end', () => {
  const ENV = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV, ...extra } });
  let root;
  let repo;
  let k = 0;
  const when = (d) => ({ GIT_AUTHOR_DATE: `${d}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${d}T10:00:00+00:00` });
  const mk = (who, date, subject) => {
    k += 1;
    writeFileSync(join(repo, `f${k}.txt`), `${k}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', subject], { ...who, ...when(date) });
  };
  const run = (args) => {
    const copy = { ...process.env, NO_COLOR: '1' };
    delete copy.FORCE_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { encoding: 'utf8', env: copy, cwd: ROOT });
  };
  let outN = 0;
  const cli = (extra) => {
    const out = join(root, `out${++outN}`);
    const r = run([repo, '--out', out, '--json', '--md', ...extra]);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    return { doc, md, stdout: r.stdout, topWords: doc.stats.messages.topWords };
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-topwords-x-'));
    repo = join(root, 'r');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    // 2025, Ada: legacy ×3.
    mk(ADA, '2025-06-01', 'legacy legacy');
    mk(ADA, '2025-06-02', 'Legacy code');
    mk(ADA, '2025-06-03', 'LEGACY tests');
    // 2026, Ada: parser ×3, cache ×2; "login:" is a conventional prefix, so login ×1.
    mk(ADA, '2026-03-01', 'feat(parser): parser handles tabs');
    mk(ADA, '2026-03-02', 'fix: Parser crash #12');
    mk(ADA, '2026-03-03', 'cache parser layer deadbee1');
    mk(ADA, '2026-03-04', 'cache warmup GH-4');
    mk(ADA, '2026-03-05', 'Improve login flow');
    mk(ADA, '2026-03-06', 'login: retry 3 times');
    // 2026, Bob on a branch: zebra ×3.
    git(repo, ['checkout', '-q', '-b', 'zoo']);
    mk(BOB, '2026-03-07', 'zebra zebra stripes');
    mk(BOB, '2026-03-08', 'Zebra again');
    mk(BOB, '2026-03-09', 'zebra once more');
    git(repo, ['checkout', '-q', 'main']);
    mk(ADA, '2026-03-10', 'İYİ ışık');
    // A merge commit full of words that must not count.
    git(repo, ['merge', '-q', '--no-ff', 'zoo', '-m', 'zebra cache legacy parser login merge'], { ...ADA, ...when('2026-03-11') });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('whole history: legacy, parser, zebra ×3 (ties alphabetical); the merge commit is excluded', () => {
    const { topWords, md, stdout } = cli([]);
    assert.deepEqual(topWords, [
      { word: 'legacy', count: 3 },
      { word: 'parser', count: 3 },
      { word: 'zebra', count: 3 },
    ]);
    assert.match(stdout, /Top words\s+"legacy" ×3 · "parser" ×3 · "zebra" ×3 \(commits per word\)/);
    assert.ok(md.includes('## Top subject words\n\nlegacy \\(3 commits\\), parser \\(3 commits\\), zebra \\(3 commits\\)\n'), md);
  });

  test('--lang tr: same words, Turkish labels in the recap and wrapped.md', () => {
    const { topWords, md, stdout } = cli(['--lang', 'tr']);
    assert.deepEqual(topWords.map((w) => w.word), ['legacy', 'parser', 'zebra']);
    assert.match(stdout, /Sık kelimeler\s+"legacy" ×3 · "parser" ×3 · "zebra" ×3 \(kelime başına commit sayısı\)/);
    assert.ok(md.includes('## Konu satırlarında en sık geçen kelimeler\n\nlegacy \\(3 commit\\), parser \\(3 commit\\), zebra \\(3 commit\\)\n'), md);
  });

  test('--author ada: legacy, parser ×3, cache ×2', () => {
    const { topWords, stdout, md } = cli(['--author', 'ADA@example.com']);
    assert.deepEqual(topWords, [
      { word: 'legacy', count: 3 },
      { word: 'parser', count: 3 },
      { word: 'cache', count: 2 },
    ]);
    assert.match(stdout, /"legacy" ×3 · "parser" ×3 · "cache" ×2/);
    assert.ok(md.includes('legacy \\(3 commits\\), parser \\(3 commits\\), cache \\(2 commits\\)'), md);
  });

  test('--author bob: stats.json keeps single-commit words; outputs show only zebra', () => {
    const { topWords, stdout, md } = cli(['--author', 'bob@example.com', '--lang', 'tr']);
    assert.deepEqual(topWords, [
      { word: 'zebra', count: 3 },
      { word: 'once', count: 1 },
      { word: 'stripes', count: 1 },
    ]);
    assert.match(stdout, /Sık kelimeler\s+"zebra" ×3 \(kelime başına commit sayısı\)/);
    assert.ok(!stdout.includes('"once"'));
    assert.ok(md.includes('## Konu satırlarında en sık geçen kelimeler\n\nzebra \\(3 commit\\)\n'), md);
  });

  test('--since 2026-01-01: parser, zebra ×3, cache ×2 (legacy is outside the window)', () => {
    const { topWords } = cli(['--since', '2026-01-01']);
    assert.deepEqual(topWords, [
      { word: 'parser', count: 3 },
      { word: 'zebra', count: 3 },
      { word: 'cache', count: 2 },
    ]);
  });

  test('--since 2026-01-01 --author ada: ties at 1 go alphabetically (crash), shown only ≥ 2', () => {
    const { topWords, stdout, md } = cli(['--since', '2026-01-01', '--author', 'ada@example.com']);
    assert.deepEqual(topWords, [
      { word: 'parser', count: 3 },
      { word: 'cache', count: 2 },
      { word: 'crash', count: 1 },
    ]);
    assert.match(stdout, /Top words\s+"parser" ×3 · "cache" ×2 \(commits per word\)/);
    assert.ok(md.includes('parser \\(3 commits\\), cache \\(2 commits\\)\n'), md);
  });

  test('--until 2025-12-31: only legacy is shown', () => {
    const { topWords, stdout, md } = cli(['--until', '2025-12-31']);
    assert.deepEqual(topWords, [
      { word: 'legacy', count: 3 },
      { word: 'code', count: 1 },
      { word: 'tests', count: 1 },
    ]);
    assert.match(stdout, /Top words\s+"legacy" ×3 \(commits per word\)/);
    assert.ok(md.includes('## Top subject words\n\nlegacy \\(3 commits\\)\n'), md);
  });

  test('a window with no shared word: topWords lists single-commit words, nothing is shown', () => {
    const { topWords, stdout, md } = cli(['--since', '2026-03-10', '--until', '2026-03-10']);
    assert.deepEqual(topWords, [
      { word: 'iyi', count: 1 },
      { word: 'ışık', count: 1 },
    ]);
    assert.ok(!stdout.includes('commits per word'), stdout);
    assert.ok(!md.includes('Top subject words'), md);
  });

  test('an empty window: topWords is []', () => {
    const r = run([repo, '--out', join(root, 'empty'), '--json', '--since', '2024-01-01', '--until', '2024-01-31']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('commits per word'), r.stdout);
    const doc = JSON.parse(readFileSync(join(root, 'empty', 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.messages.topWords, []);
  });
});
