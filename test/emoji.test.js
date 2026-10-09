import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeEmoji, computeStats as computeAllStats, EMOJI_MIN_SHARE, emojiIn, emojiKey, GITMOJI, isEmoji, shownEmoji } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { layoutCard } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out (and the top words row
// after it, stats.messages.topWords, see test/top-words.test.js).
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
};

const TODAY = '2026-04-01';
const commit = (subject, i, extra = {}) => ({
  hash: String(i).padStart(40, '0'),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 5 + i, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const history = (subjects, n = 40) => Array.from({ length: n }, (_, i) => commit(subjects[i % subjects.length], i));
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').spec;
const messagesSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').svg;

describe('emojiIn', () => {
  test('Unicode emoji, one per grapheme cluster', () => {
    assert.deepEqual(emojiIn('✨ add login'), ['✨']);
    assert.deepEqual(emojiIn('pair 👩‍💻 with 👨‍👩‍👧‍👦'), ['👩‍💻', '👨‍👩‍👧‍👦']);
    assert.deepEqual(emojiIn('👍🏽 ok'), ['👍🏽']);
    assert.deepEqual(emojiIn('🇹🇷 and 🇺🇸'), ['🇹🇷', '🇺🇸']);
    assert.deepEqual(emojiIn('step 1️⃣ #️⃣'), ['1️⃣', '#️⃣']);
    assert.deepEqual(emojiIn('⚡️ and ⚡'), ['⚡️', '⚡']);
    assert.deepEqual(emojiIn('🏴󠁧󠁢󠁳󠁣󠁴󠁿 flag'), ['🏴󠁧󠁢󠁳󠁣󠁴󠁿']);
  });

  test('text-style symbols are not emoji', () => {
    assert.deepEqual(emojiIn('© 2026 ™ → ↔ ♻ plain'), []);
    assert.deepEqual(emojiIn('♻️ recycled'), ['♻️']);
    assert.deepEqual(emojiIn('☺︎ text style'), []);
    assert.deepEqual(emojiIn('1 2 # *'), []);
  });

  test('gitmoji shortcodes from the table, in order with Unicode emoji', () => {
    assert.deepEqual(emojiIn(':sparkles: add :bug:'), ['✨', '🐛']);
    assert.deepEqual(emojiIn('🎉 then :rocket:'), ['🎉', '🚀']);
    assert.deepEqual(emojiIn(':recycle::fire:'), ['♻️', '🔥']);
    assert.deepEqual(emojiIn('feat: :sparkles: x'), ['✨']);
    assert.equal(GITMOJI.sparkles, '✨');
    assert.equal(GITMOJI.technologist, '🧑‍💻');
    for (const [name, e] of Object.entries(GITMOJI)) assert.ok(isEmoji(e), name);
  });

  test('unknown shortcodes, times, scopes and C++ are not emoji', () => {
    assert.deepEqual(emojiIn(':notanemoji: :Sparkles: :sparkles'), []);
    assert.deepEqual(emojiIn('a:b:c at 10:30:00, std::vector, 10:100:00'), []);
    assert.deepEqual(emojiIn('word:sparkles: and 9:tada:'), []);
    assert.deepEqual(emojiIn(''), []);
    assert.deepEqual(emojiIn(null), []);
    assert.deepEqual(emojiIn(42), []);
  });

  test('emojiKey drops variation selectors only', () => {
    assert.equal(emojiKey('⚡️'), emojiKey('⚡'));
    assert.equal(emojiKey('♻️'), '♻');
    assert.notEqual(emojiKey('👍🏽'), emojiKey('👍'));
  });
});

describe('computeEmoji', () => {
  test('shape, counting once per commit, normalization and top order', () => {
    const e = computeEmoji([
      commit('✨ a ✨ :sparkles:', 1),
      commit(':sparkles: b', 2),
      commit('⚡ c', 3),
      commit('⚡️ d 🐛', 4),
      commit('🐛 e', 5),
      commit('📝 f', 6),
      commit('plain', 7),
      commit('', 8),
      commit('Merge branch ✨', 9, { parents: ['a', 'b'] }),
    ]);
    assert.deepEqual(Object.keys(e), ['total', 'commits', 'share', 'distinct', 'top', 'shown']);
    assert.equal(e.total, 7);
    assert.equal(e.commits, 6);
    assert.equal(e.share, 0.857);
    assert.equal(e.distinct, 4);
    // ✨ 2, ⚡ 2, 🐛 2 tie: code point order (⚡ U+26A1 < ✨ U+2728 < 🐛 U+1F41B); ⚡ shown fully qualified.
    assert.deepEqual(e.top, [{ emoji: '⚡️', count: 2 }, { emoji: '✨', count: 2 }, { emoji: '🐛', count: 2 }]);
    assert.equal(e.shown, true);
  });

  test('the order of the commits does not change the result', () => {
    const list = ['🐛 a', '✨ b', '📝 c', '🚀 d', '✨ e', '🐛 f', 'x'].map((s, i) => commit(s, i));
    assert.deepEqual(computeEmoji(list), computeEmoji([...list].reverse()));
  });

  test('no emoji: zeros and an empty top', () => {
    assert.deepEqual(computeEmoji([commit('plain', 1)]), { total: 1, commits: 0, share: 0, distinct: 0, top: [], shown: false });
    assert.deepEqual(computeEmoji([]), { total: 0, commits: 0, share: 0, distinct: 0, top: [], shown: false });
    assert.deepEqual(computeEmoji(null), computeEmoji([]));
    assert.deepEqual(computeEmoji([null, 'x', { subject: 5 }]), computeEmoji([]));
  });

  test('5% threshold', () => {
    assert.equal(EMOJI_MIN_SHARE, 0.05);
    const at = (withEmoji, total) => computeEmoji(Array.from({ length: total }, (_, i) => commit(i < withEmoji ? '✨ x' : 'x', i)));
    assert.equal(at(1, 20).shown, true);
    assert.equal(at(1, 21).shown, false);
    assert.equal(shownEmoji(at(1, 21)), null);
    assert.deepEqual(shownEmoji(at(1, 20)), { commits: 1, total: 20, top: [{ emoji: '✨', count: 1 }] });
  });

  test('shownEmoji tolerates junk', () => {
    for (const junk of [null, undefined, 'x', {}, { commits: 0, total: 5 }, { commits: NaN }, { commits: 1, total: 100 }]) assert.equal(shownEmoji(junk), null, JSON.stringify(junk));
    const s = shownEmoji({ commits: 3, total: 10, top: [{ emoji: 'ab', count: 2 }, { emoji: '✨', count: 9 }, null, { emoji: '🐛', count: 0 }, { emoji: '✨🐛', count: 1 }] });
    assert.deepEqual(s, { commits: 3, total: 10, top: [{ emoji: '✨', count: 3 }] });
  });

  test('computeStats puts emoji after commitTypes', () => {
    const keys = Object.keys(computeStats([commit('✨ x', 1)], { today: TODAY }));
    assert.equal(keys[keys.indexOf('commitTypes') + 1], 'emoji');
  });
});

describe('outputs', () => {
  const EMOJI = ['✨ add login', ':bug: fix crash', 'update readme', 'refactor parser', '📝 docs', 'wip stuff', 'oops typo', 'fix again', 'tidy', 'more'];
  const PLAIN = ['add login', 'fix crash', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again', 'tidy', 'more'];

  test('the messages card gets an emoji row when shown (en + tr)', () => {
    const stats = computeStats(history(EMOJI), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, lang);
      const row = spec.lines.at(-1);
      assert.equal(row.label, 'Emoji ✨ 🐛 📝');
      assert.equal(row.value, getStrings(lang).pct(30));
      assert.equal(layoutCard({ ...spec, lang }).fitsAsIs, true);
      assert.match(messagesSvg(stats, lang), /Emoji ✨ 🐛 📝/);
    }
  });

  test('without emoji, or under 5%, the card is byte-identical to one without the stat', () => {
    const plain = computeStats(history(PLAIN), { today: TODAY });
    const sub = computeStats(history(PLAIN, 99).concat([commit('✨ x', 99)]), { today: TODAY });
    assert.equal(sub.emoji.shown, false);
    for (const stats of [plain, sub]) {
      const without = { ...stats };
      delete without.emoji;
      for (const lang of ['en', 'tr']) assert.equal(messagesSvg(stats, lang), messagesSvg(without, lang));
    }
  });

  test('recap and wrapped.md lines, only when shown', () => {
    const stats = computeStats(history(EMOJI), { today: TODAY });
    const recap = formatSummary(stats, { repoName: 'demo' });
    assert.match(recap, /Emoji +30% of commits · ✨ 4 · 🐛 4 · 📝 4/);
    assert.match(formatSummary(stats, { repoName: 'demo', lang: 'tr' }), /Emoji +commit'lerin %30 kadarı · ✨ 4/);
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Emoji\n\n30% of commits: ✨ 4 · 🐛 4 · 📝 4/);
    const plain = computeStats(history(PLAIN), { today: TODAY });
    assert.doesNotMatch(formatSummary(plain, { repoName: 'demo' }), /Emoji/);
    assert.doesNotMatch(buildMarkdown(plain, { repoName: 'demo', today: TODAY }), /Emoji/);
  });
});

describe('review fixes', () => {
  const isEmojiRow = (l) => /^Emoji( |$)/.test(l?.label ?? '');

  test('`::` paths, slices and stray colons are not shortcodes; chained shortcodes are', () => {
    for (const s of ['use std::thread::spawn', 'crate::lock::Mutex', 'foo::bug::bar', 'arr[:100:]', ':lock::Mutex', '::tada::', 'a::sparkles:']) assert.deepEqual(emojiIn(s), [], s);
    assert.deepEqual(emojiIn(':recycle::fire:'), ['♻️', '🔥']);
    assert.deepEqual(emojiIn(':tada::rocket::fire: ship'), ['🎉', '🚀', '🔥']);
    assert.deepEqual(emojiIn(':bug:fix'), ['🐛']);
  });

  test('text-default pictographs above U+1F000 need U+FE0F', () => {
    assert.deepEqual(emojiIn('🀀 🂡 🅰 🅿'), []);
    assert.deepEqual(emojiIn('🅰️ 🀄'), ['🅰️', '🀄']);
  });

  test('stray combining marks and a dangling ZWJ do not make a new emoji', () => {
    assert.deepEqual(emojiIn('✨\u0301 x'), ['✨']);
    assert.deepEqual(emojiIn('👩\u200D x'), ['👩']);
    assert.equal(emojiKey('✨\u0301'), emojiKey('✨'));
    assert.equal(computeEmoji([commit('✨\u0301 a', 1), commit('✨ b', 2)]).distinct, 1);
  });

  test('shownEmoji keeps one entry per emoji', () => {
    const s = shownEmoji({ commits: 5, total: 10, top: [{ emoji: '✨', count: 5 }, { emoji: '✨️', count: 4 }, { emoji: '✨', count: 3 }, { emoji: '🐛', count: 2 }] });
    assert.deepEqual(s.top, [{ emoji: '✨', count: 5 }, { emoji: '🐛', count: 2 }]);
  });

  for (const style of ['✨', ':sparkles:']) {
    test(`with the type mix on the card, the emoji row shows too (feat: ${style})`, () => {
      const stats = computeStats(Array.from({ length: 40 }, (_, i) => commit(`feat: ${style} do thing ${i}`, i)), { today: TODAY });
      const mixed = computeStats(Array.from({ length: 40 }, (_, i) => commit([`feat: ${style} do thing ${i}`, `fix: :bug: crash ${i}`, `docs: readme ${i}`][i % 3], i)), { today: TODAY });
      for (const st of [stats, mixed]) {
        for (const lang of ['en', 'tr']) {
          const spec = messagesSpec(st, lang);
          assert.ok(isEmojiRow(spec.lines.at(-1)), `${lang} ${JSON.stringify(spec.lines)}`);
          const without = { ...st };
          delete without.emoji;
          const base = messagesSpec(without, lang);
          // Every chart (the type mix when it is on the card, the biggest commit) stays drawn.
          assert.deepEqual(layoutCard({ ...spec, lang }).drawnCharts, layoutCard({ ...base, lang }).drawnCharts);
        }
      }
      const spec = messagesSpec(mixed);
      assert.ok([spec.chart].flat().some((c) => c?.kind === 'stack'), 'type mix drawn');
    });
  }

  test('the "average length" title variant gets the row too (en + tr)', () => {
    const stats = computeStats(Array.from({ length: 300 }, (_, i) => commit(`✨ x${i}`, i)), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, lang);
      assert.deepEqual(spec.lines.at(-1), { label: 'Emoji ✨', value: getStrings(lang).pct(100) });
      assert.ok(layoutCard({ ...spec, lang }).shrinkSteps <= 1);
    }
  });

  test('100k subjects with emoji stay fast', () => {
    const many = Array.from({ length: 100_000 }, (_, i) => ({ subject: `✨ update the thing ${i} with :bug: and more words`, parents: ['p'] }));
    const t0 = performance.now();
    const e = computeEmoji(many);
    const ms = performance.now() - t0;
    assert.equal(e.commits, 100_000);
    assert.ok(ms < 3000, `${Math.round(ms)}ms`);
  });
});
