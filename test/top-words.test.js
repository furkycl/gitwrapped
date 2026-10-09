// Top subject words (stats.messages.topWords, src/stats/messages.js subjectWords /
// shownTopWords): the three most common words in non-merge commit subjects, each counted
// once per commit, as the messages card's lowest-priority spare-room row, a recap line, a
// wrapped.md section and stats.json.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMessages, computeStats, shownTopWords, subjectWords, TOP_WORDS, TOP_WORDS_MIN } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
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
const history = (subjects) => subjects.map((s, i) => commit(s, i + 1));
const words = (subjects) => computeMessages(history(subjects)).topWords;
const statsOf = (subjects) => computeStats(history(subjects), { today: TODAY });
// Build output only (dist/ is ignored like the hot files): no biggest-commit panel, and
// identical subjects (no "Shortest" row), so the messages card has spare room.
const roomyOf = (subjects) => computeStats(history(subjects).map((c, i) => ({ ...c, files: [{ path: `dist/${i}.js`, added: 3, removed: 1 }] })), { today: TODAY });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === 'messages').spec;
const svgs = (stats, lang = 'en') => buildCards(stats, cardOpts(lang)).map((c) => [c.id, c.svg]);
const withStat = (s, topWords) => ({ ...s, messages: { ...s.messages, topWords } });
const without = (s) => withStat(s, []);
const isRow = (r, L = en) => r?.label === L.messages.topWordsTitle || (typeof r?.label === 'string' && r.label.startsWith(`${L.messages.topWordsTitle}: `));
/** The words part of a top words row, in either form ("Top words" + value, or "Top words: …" as the label). */
const rowWords = (r, L = en) => (r.label === L.messages.topWordsTitle ? r.value : r.label.slice(L.messages.topWordsTitle.length + 2));
const set = (s) => [...subjectWords(s)];

describe('subjectWords: the word rule', () => {
  test('runs of letters, lowercased, at least 3 code points, each once', () => {
    assert.deepEqual(set('Add Parser for the parser API'), ['add', 'parser', 'api']);
    assert.deepEqual(set('go to db'), []);
    assert.deepEqual(set('test test test'), ['test']);
    assert.deepEqual(set('auto-save, on_load; x.y.zed'), ['auto', 'save', 'load', 'zed']);
  });

  test('a leading conventional-commit prefix is cut; the same words later still count', () => {
    assert.deepEqual(set('feat: add parser'), ['add', 'parser']);
    assert.deepEqual(set('fix(api)!: handle tabs'), ['handle', 'tabs']);
    assert.deepEqual(set('Chore(deps-dev): bump lodash'), ['bump', 'lodash']);
    assert.deepEqual(set('fix: fix the fix'), ['fix']);
    assert.deepEqual(set('feat:'), []);
    // Not a prefix: not at the start, or no blank after the colon.
    assert.deepEqual(set('add feat: thing'), ['add', 'feat', 'thing']);
    assert.deepEqual(set('fix:crash'), ['fix', 'crash']);
    assert.deepEqual(set('  feat: padded'), ['padded']);
  });

  test('leading emoji / gitmoji shortcodes are cut before the prefix; shortcodes anywhere are dropped', () => {
    assert.deepEqual(set(':sparkles: feat: add parser'), ['add', 'parser']);
    assert.deepEqual(set('✨ feat(ui): add parser'), ['add', 'parser']);
    assert.deepEqual(set('🐛🚑️ fix: crash'), ['crash']);
    assert.deepEqual(set('add parser :tada: done :white_check_mark:'), ['add', 'parser', 'done']);
    assert.deepEqual(set('feat: :sparkles: shiny'), ['shiny']);
    // Not a shortcode: capitals or blanks inside.
    assert.deepEqual(set('see :Foo: and :big one:'), ['see', 'foo', 'big', 'one']);
  });

  test('autosquash markers and a Revert "…" wrapper are cut before the prefix (nested too)', () => {
    assert.deepEqual(set('fixup! feat: add parser'), ['add', 'parser']);
    assert.deepEqual(set('squash! fixup! amend! fix(api): handle tabs'), ['handle', 'tabs']);
    assert.deepEqual(set('Revert "feat: add parser"'), ['add', 'parser']);
    assert.deepEqual(set('Revert "Revert "fix: login""'), ['login']);
    assert.deepEqual(set('Revert "fixup! ✨ feat: cache"'), ['cache']);
    assert.deepEqual(set('fixup! Revert ":bug: fix: crash"'), ['crash']);
    assert.deepEqual(set('Revert "unclosed parser'), ['unclosed', 'parser']);
    // Not a wrapper: no quote, or not at the start; "fixup!" needs its "!".
    assert.deepEqual(set('Revert the parser'), ['revert', 'parser']);
    assert.deepEqual(set('add fixup! parser'), ['add', 'fixup', 'parser']);
    assert.deepEqual(set('fixup parser'), ['fixup', 'parser']);
  });

  test('issue refs, URLs, hashes and numbers are cut', () => {
    assert.deepEqual(set('close #123 and GH-45 and gh-7'), ['close']);
    assert.deepEqual(set('see owner/repo#12 now'), ['see']);
    assert.deepEqual(set('PROJ-123 ABC-9 parser'), ['parser']);
    assert.deepEqual(set('revert deadbeef1 and a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'), ['revert']);
    assert.deepEqual(set('bump 1.2.3 to 2024 v42'), ['bump']);
    assert.deepEqual(set('read https://example.com/docs/page and www.example.org/x'), ['read']);
    // Hex without a digit is a word; lowercase "abc-123" is not a Jira key.
    assert.deepEqual(set('deadbeef cafe abc-123'), ['deadbeef', 'cafe', 'abc']);
    // Letters next to digits still form a word.
    assert.deepEqual(set('utf8 python3'), ['utf', 'python']);
  });

  test('English and Turkish stopwords are left out', () => {
    assert.deepEqual(set('the and for with from into this that'), []);
    assert.deepEqual(set('ve ile için bir bu da de daha gibi olarak'), []);
    assert.deepEqual(set('parser için yeni test ve ile'), ['parser', 'yeni', 'test']);
    assert.deepEqual(set("how why where while does don't doesn't parser"), ['parser']);
  });

  test('Unicode: NFC, letters with marks, Turkish dotted İ, apostrophes', () => {
    assert.deepEqual(set('café café'), ['café']);
    assert.deepEqual(set('İYİ değişiklik ÇÖZÜM'), ['iyi', 'değişiklik', 'çözüm']);
    assert.deepEqual(set("isn't README’yi"), ["isn't", "readme'yi"]);
    assert.deepEqual(set('日本語 добавить'), ['日本語', 'добавить']);
    assert.deepEqual(set('🎉 ✨ … --- 123'), []);
  });

  test('non-strings → none; never throws', () => {
    for (const v of [undefined, null, 42, {}, ['a b c'], Symbol('x')]) assert.deepEqual(set(v), []);
  });

  test('long adversarial subjects stay fast', () => {
    const t0 = Date.now();
    for (const s of ['a'.repeat(100000), 'a/'.repeat(50000), 'ab1'.repeat(40000), `${'A'.repeat(100000)}-`, '#'.repeat(100000), `${'a.'.repeat(50000)}/x`, `${'a+'.repeat(50000)}:`, 'a-'.repeat(50000), 'www.'.repeat(25000)]) subjectWords(s);
    assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  });
});

describe('computeMessages: topWords', () => {
  test('top three by commits (once per commit), ties alphabetical', () => {
    assert.deepEqual(words(['add parser', 'parser parser cache', 'cache login', 'login parser', 'zeta']), [
      { word: 'parser', count: 3 },
      { word: 'cache', count: 2 },
      { word: 'login', count: 2 },
    ]);
    assert.deepEqual(words(['beta alpha', 'gamma delta']), [
      { word: 'alpha', count: 1 },
      { word: 'beta', count: 1 },
      { word: 'delta', count: 1 },
    ]);
    // Code-unit order: "zeta" < "ärger".
    assert.deepEqual(words(['ärger zeta']).map((w) => w.word), ['zeta', 'ärger']);
    assert.equal(TOP_WORDS, 3);
    assert.equal(TOP_WORDS_MIN, 2);
  });

  test('merge commits are skipped (by parents, or by a merge subject without parents)', () => {
    const h = [commit('Merge parser into main', 1, { parents: ['a', 'b'] }), commit('parser', 2), { subject: "Merge branch 'parser'" }, { subject: 'cache' }];
    assert.deepEqual(computeMessages(h).topWords, [{ word: 'cache', count: 1 }, { word: 'parser', count: 1 }]);
  });

  test('email-shaped text is cut first', () => {
    assert.deepEqual(words(['thanks ada@example.com', 'thanks bob@example.org']), [{ word: 'thanks', count: 2 }]);
  });

  test('empty / invalid input → []; never throws', () => {
    for (const v of [undefined, null, []]) assert.deepEqual(computeMessages(v).topWords, []);
    assert.deepEqual(computeMessages([null, 5, 'x', {}, { subject: 42 }, { subject: '' }, { subject: '12 #3' }]).topWords, []);
  });

  test('topWord is untouched: its own rule (every occurrence, types and fix words left out)', () => {
    const m = computeMessages(history(['fix: parser parser', 'fix tests', 'fix tests']));
    assert.deepEqual(m.topWord, { word: 'parser', count: 2 });
    assert.deepEqual(m.topWords, [{ word: 'fix', count: 2 }, { word: 'tests', count: 2 }, { word: 'parser', count: 1 }]);
  });
});

describe('shownTopWords', () => {
  test('null for no array, or nothing in at least 2 commits', () => {
    for (const v of [null, undefined, 'x', 3, {}, [], [{ word: 'parser', count: 1 }]]) assert.equal(shownTopWords(v), null, JSON.stringify(v));
  });

  test('keeps valid words with ≥ 2 commits, deduped, sorted, at most 3', () => {
    const raw = [
      { word: 'b', count: 9 },
      { word: 'cache', count: 2.4 },
      { word: 'parser', count: 5 },
      { word: 'parser', count: 7 },
      { word: 'a@b.c', count: 9 },
      { word: 'two words', count: 9 },
      { word: 'nan', count: NaN },
      { word: 'str', count: '9' },
      { word: 'login', count: 3 },
      { word: 'zeta', count: 3 },
      null,
      7,
    ];
    assert.deepEqual(shownTopWords(raw), [{ word: 'parser', count: 5 }, { word: 'login', count: 3 }, { word: 'zeta', count: 3 }]);
    assert.deepEqual(shownTopWords([{ word: 'cache', count: 2.4 }, { word: "don't", count: 2 }]), [{ word: 'cache', count: 2 }, { word: "don't", count: 2 }]);
  });
});

describe('stats.json', () => {
  test('stats.messages.topWords is last in messages, an array of {word, count}', () => {
    const s = statsOf(['add parser', 'parser cache']);
    assert.equal(Object.keys(s.messages).at(-1), 'topWords');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo' }));
    assert.equal(JSON.stringify(doc.stats.messages.topWords), '[{"word":"parser","count":2},{"word":"add","count":1},{"word":"cache","count":1}]');
    assert.equal(Object.keys(doc.stats.messages).at(-1), 'topWords');
    const none = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' }));
    assert.deepEqual(none.stats.messages.topWords, []);
  });
});

describe('messages card', () => {
  test('the row is appended in spare room (en + tr), longest form that fits, hover text in words', () => {
    const s = roomyOf(['fix tests', 'fix tests']);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const spec = messagesSpec(s, lang);
      const row = spec.lines.at(-1);
      assert.ok(isRow(row, L), lang);
      // Two words: the whole row as one label (a label has more room than a value).
      assert.equal(row.label, L.messages.topWordsLabel([{ word: 'fix', count: 2 }, { word: 'tests', count: 2 }]));
      assert.equal(row.value, undefined);
      assert.equal(rowWords(row, L), 'fix ×2 · tests ×2');
      assert.equal(row.description, lang === 'en' ? 'Most common words in commit subjects: fix (2 commits), tests (2 commits)' : 'Konu satırlarında en sık geçen kelimeler: fix (2 commit), tests (2 commit)');
      assert.equal(layoutCard({ ...spec, lang }).fitsAsIs, true);
      assert.match(buildCards(s, cardOpts(lang)).find((c) => c.id === 'messages').svg, new RegExp(L.messages.topWordsTitle));
    }
  });

  test('never displaces: only the messages card changes, and only by one row at its end', () => {
    const cases = [
      roomyOf(['fix tests', 'fix tests']),
      roomyOf(['fix tests', 'fix tests', 'fix tests']),
      statsOf(['add parser', 'parser cache', 'cache login', 'login parser']),
      statsOf(['feat: a parser', 'fix: b parser', 'wip c', 'oops', 'Revert "x"', '✨ d #12 parser']),
      roomyOf(['add parser', 'add parser']),
    ];
    let drawn = 0;
    for (const s of cases) {
      for (const lang of ['en', 'tr']) {
        const a = svgs(s, lang);
        const b = svgs(without(s), lang);
        for (const [i, [id, svg]] of a.entries()) if (id !== 'messages') assert.equal(svg, b[i][1], id);
        const spec = messagesSpec(s, lang);
        const base = messagesSpec(without(s), lang);
        assert.ok(!base.lines?.some((r) => isRow(r, LANGS[lang])));
        if (!isRow(spec.lines?.at(-1), LANGS[lang])) {
          assert.deepEqual(spec, base);
          continue;
        }
        drawn += 1;
        const { lines, ...rest } = spec;
        const { lines: baseLines, ...baseRest } = base;
        assert.deepEqual(lines.slice(0, -1), baseLines, lang);
        assert.deepEqual(rest, baseRest, lang);
        const la = layoutCard({ ...spec, lang });
        const lb = layoutCard({ ...base, lang });
        assert.deepEqual(la.drawnCharts, lb.drawnCharts);
        assert.ok(la.shrinkSteps <= lb.shrinkSteps, lang);
      }
    }
    assert.ok(drawn >= 2, `drawn ${drawn}`);
  });

  test('comes after the message bodies row: a bodies row in the last slot keeps it off', () => {
    const s = roomyOf(['fix tests', 'fix tests']);
    const withBodies = { ...s, messages: { ...s.messages, bodies: { commits: 1, share: 0.5 } } };
    const spec = messagesSpec(withBodies);
    assert.equal(spec.lines.at(-1).label, en.messages.bodiesTitle);
    assert.ok(!spec.lines.some((r) => isRow(r)));
    assert.deepEqual(spec, messagesSpec(without(withBodies)));
  });

  test('no row without a word in 2 commits, or for a lone word the big favorite word already shows', () => {
    const one = roomyOf(['add parser']);
    assert.deepEqual(messagesSpec(one), messagesSpec(without(one)));
    // "parser" is both the favorite word and the only shown top word.
    const fav = roomyOf(['parser', 'parser']);
    assert.deepEqual(fav.messages.topWord, { word: 'parser', count: 2 });
    assert.deepEqual(shownTopWords(fav.messages.topWords), [{ word: 'parser', count: 2 }]);
    assert.deepEqual(svgs(fav), svgs(without(fav)));
    // A stats.json from before the stat (no topWords) is the card as before.
    const old = { ...fav, messages: { ...fav.messages } };
    delete old.messages.topWords;
    assert.deepEqual(svgs(old), svgs(without(fav)));
  });

  test('a word too long for the row drops the row to fewer words', () => {
    const long = 'x'.repeat(200);
    const s = roomyOf([`fix ${long}`, `fix ${long}`]);
    // The long word is the big favorite word ("fix" is not a topWord candidate), so the
    // one-word form "fix ×2" is not a repeat of it.
    assert.equal(s.messages.topWord.word, long);
    for (const lang of ['en', 'tr']) {
      const row = messagesSpec(s, lang).lines.at(-1);
      assert.ok(isRow(row, LANGS[lang]), lang);
      // A single word is drawn as "Top words" with its value, like the card's other rows.
      assert.equal(row.label, LANGS[lang].messages.topWordsTitle);
      assert.equal(row.value, 'fix ×2');
    }
  });

  test('the favorite-word skip: only a lone favorite word is left out, never a longer form', () => {
    const fav = roomyOf(['parser', 'parser']);
    const long = 'z'.repeat(150);
    // Two words that fit: shown, though the first is the favorite word.
    const both = withStat(fav, [{ word: 'parser', count: 2 }, { word: 'cache', count: 2 }]);
    const row = messagesSpec(both).lines.at(-1);
    assert.ok(isRow(row));
    assert.equal(row.label, 'Top words: cache ×2 · parser ×2');
    // A long second word cuts the row to its first word, which is the favorite: no row.
    const cut = withStat(fav, [{ word: 'parser', count: 2 }, { word: long, count: 2 }]);
    assert.deepEqual(messagesSpec(cut), messagesSpec(without(fav)));
    assert.deepEqual(svgs(cut), svgs(without(fav)));
    // The same with a first word that is not the favorite: the one-word form is drawn.
    const other = withStat(fav, [{ word: 'cache', count: 2 }, { word: long, count: 2 }]);
    assert.equal(messagesSpec(other).lines.at(-1).value, 'cache ×2');
  });
});

describe('messages card: never displacing (randomized)', () => {
  // A small deterministic PRNG (mulberry32).
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
  const SUBJECTS = ['fix tests', 'feat: add parser', 'wip parser', 'oops', 'fix #12 parser', '✨ cache', 'Revert "cache"', 'parser cache login', 'tidy', 'Merge branch x'];

  test('200 random histories × en/tr: rows without topWords are a prefix of rows with them; only the top words row may be added', () => {
    const r = rng(100);
    let drawn = 0;
    for (let i = 0; i < 200; i += 1) {
      const n = 1 + Math.floor(r() * 8);
      // Some histories repeat one subject (no "Shortest" row), so the card has spare room.
      const same = r() < 0.4 ? pick(r, SUBJECTS) : null;
      const h = Array.from({ length: n }, (_, k) => {
        const subject = same ?? pick(r, SUBJECTS);
        return commit(subject, k + 1, {
          parents: subject.startsWith('Merge') ? ['a', 'b'] : ['p'],
          ...(r() < 0.3 ? { hasBody: r() < 0.5 } : {}),
          files: [{ path: r() < 0.5 ? `dist/${k}.js` : pick(r, ['src/a.js', 'README.md']), added: Math.floor(r() * 300), removed: Math.floor(r() * 50) }],
        });
      });
      const s = computeStats(h, { today: TODAY });
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const a = messagesSpec(s, lang);
        const b = messagesSpec(without(s), lang);
        const { lines: la = [], ...restA } = a;
        const { lines: lb = [], ...restB } = b;
        assert.deepEqual(restA, restB, `${lang} #${i}`);
        assert.deepEqual(la.slice(0, lb.length), lb, `${lang} #${i}`);
        const extra = la.slice(lb.length);
        assert.ok(extra.length <= 1, `${lang} #${i}`);
        if (extra.length) {
          drawn += 1;
          assert.ok(isRow(extra[0], L));
          assert.ok(shownTopWords(s.messages.topWords));
        }
      }
    }
    assert.ok(drawn >= 5, `drawn ${drawn}`);
  });
});

describe('recap and wrapped.md', () => {
  const s = statsOf(['add parser', 'parser: cache tweak', 'cache login', 'login parser']);

  test('recap "Top words" line after the bodies line, en and tr; none without a shown word', () => {
    const out = formatSummary(s, { repoName: 'demo' });
    assert.match(out, /\n {2}Top words {4}"cache" ×2 · "login" ×2 · "parser" ×2 \(commits per word\)\n/);
    const trOut = formatSummary(s, { repoName: 'demo', lang: 'tr' });
    assert.match(trOut, /\n {2}Sık kelimeler {4}"cache" ×2 · "login" ×2 · "parser" ×2 \(kelime başına commit sayısı\)\n/);
    const withBodies = { ...s, messages: { ...s.messages, bodies: { commits: 1, share: 0.25 } } };
    const lines = formatSummary(withBodies, { repoName: 'demo' }).split('\n');
    assert.equal(lines.findIndex((l) => l.startsWith('  Top words')), lines.findIndex((l) => l.startsWith('  Bodies')) + 1);
    for (const v of [[], null, undefined, [{ word: 'x', count: 1 }], [{ word: 'parser', count: 1 }]]) {
      assert.doesNotMatch(formatSummary(withStat(s, v), { repoName: 'demo' }), /Top words/);
    }
  });

  test('wrapped.md "Top subject words" section, en and tr; none without a shown word', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Top subject words\n\ncache \\\(2 commits\\\), login \\\(2 commits\\\), parser \\\(2 commits\\\)\n/);
    const trMd = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(trMd, /## Konu satırlarında en sık geçen kelimeler\n\ncache \\\(2 commit\\\), login \\\(2 commit\\\), parser \\\(2 commit\\\)\n/);
    for (const v of [[], null, [{ word: 'parser', count: 1 }]]) assert.doesNotMatch(buildMarkdown(withStat(s, v), { repoName: 'demo', today: TODAY }), /Top subject words/);
  });

  test('long words are cut to 24 characters with "…" in the recap and wrapped.md alike', () => {
    const long = `${'a'.repeat(30)}b`;
    const cut = `${'a'.repeat(23)}…`;
    const w = withStat(s, [{ word: long, count: 3 }]);
    assert.ok(formatSummary(w, { repoName: 'demo' }).includes(`Top words    "${cut}" ×3 (commits per word)\n`));
    assert.ok(buildMarkdown(w, { repoName: 'demo', today: TODAY }).includes(`## Top subject words\n\n${cut} \\(3 commits\\)\n`));
    const fits = 'a'.repeat(24);
    assert.ok(buildMarkdown(withStat(s, [{ word: fits, count: 3 }]), { repoName: 'demo', today: TODAY }).includes(`\n${fits} \\(3 commits\\)\n`));
  });

  test('a single shown word is listed alone; counts use the language number format', () => {
    const big = withStat(s, [{ word: 'parser', count: 1234 }, { word: 'cache', count: 1 }]);
    assert.match(formatSummary(big, { repoName: 'demo' }), /Top words {4}"parser" ×1,234 \(commits per word\)\n/);
    assert.match(formatSummary(big, { repoName: 'demo', lang: 'tr' }), /Sık kelimeler {4}"parser" ×1\.234 \(kelime başına commit sayısı\)\n/);
    assert.match(buildMarkdown(big, { repoName: 'demo', today: TODAY }), /\nparser \\\(1,234 commits\\\)\n/);
  });
});
