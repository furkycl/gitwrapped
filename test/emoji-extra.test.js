// Extra coverage for commit emoji (stats.emoji, src/stats/emoji.js): the messages card's
// emoji row with the conventional-commit type mix and the folded counter rows, the macOS
// PNG text path, hand-edited stats.json fuzz into card / recap / wrapped.md, Turkish
// output, multi-repo aggregation and end-to-end runs through the real binary, plus
// detector edge cases.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEmoji, computeStats, emojiIn, emojiKey, GITMOJI, isEmoji, shownEmoji } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { layoutCard } from '../src/cards/svg.js';
import { stripEmojiFromText } from '../src/png.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-04-01';
const commit = (subject, i, files = [], extra = {}) => ({
  hash: String(i).padStart(40, '0'),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files,
  parents: ['p'],
  ...extra,
});
const specs = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => specs(stats, lang).find((c) => c.id === 'messages').spec;
const messagesSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').svg;
const without = (stats) => {
  const copy = { ...stats };
  delete copy.emoji;
  return copy;
};
const charts = (spec) => [spec.chart].flat().filter(Boolean);
const isEmojiRow = (row) => typeof row?.label === 'string' && /^Emoji( |$)/.test(row.label);

// --- the emoji row with the type mix and the folded rows ---------------------------------

describe('messages card: emoji row with the type mix and folded counters', () => {
  const W = 'WWWWWWW MMMMMMM wwwwww mmmmmm WWWWWWW MMMMMMM wwwwww mmmmmm WWWWWWW MMMMMMM wwwwww mmmmmm'.split(' ');
  /** A conventional-commit history (about 37% emoji) whose card layout varies with l1 / l2 / big. */
  function variant(l1, l2, big) {
    // 3 of every 8 subjects have an emoji (the last commit's does not).
    const subj = ['feat: ✨ ' + W.slice(0, l1).join(' '), 'fix: :bug: crash', 'docs: 📝 readme', 'refactor: parser', 'test: more', 'chore: stuff', 'fix: typo', 'feat: again'];
    const commits = Array.from({ length: 40 }, (_, i) => commit(subj[i % 8], i, i === 39 && big ? [{ path: 'a.js', added: big, removed: 1 }] : []));
    commits[39].subject = 'feat: ' + W.slice(0, l2).join(' ');
    return computeStats(commits, { today: TODAY });
  }

  const seen = new Set();
  for (const lang of ['en', 'tr']) {
    test(`invariants over layout variants (${lang})`, () => {
      const M = getStrings(lang).messages;
      for (const l1 of [0, 1, 2, 4, 6, 8, 12]) for (const l2 of [0, 1, 3, 6, 12]) for (const big of [0, 100]) {
        const stats = variant(l1, l2, big);
        assert.equal(stats.emoji.shown, true);
        assert.ok(stats.commitTypes.shown, 'type mix shown');
        const a = messagesSpec(stats, lang);
        const b = messagesSpec(without(stats), lang);
        const tag = `${lang} l1=${l1} l2=${l2} big=${big}`;
        // The emoji row never costs a chart: the type mix / callout stay exactly as they were.
        assert.deepEqual(charts(a), charts(b), tag);
        const row = a.lines.at(-1);
        if (!isEmojiRow(row)) {
          assert.deepEqual(a, b, tag);
          assert.equal(messagesSvg(stats, lang), messagesSvg(without(stats), lang), tag);
          seen.add(`none:${charts(b).length}`);
          continue;
        }
        assert.equal(row.label, 'Emoji ✨ 🐛 📝', tag);
        assert.equal(row.value, getStrings(lang).pct(Math.round((stats.emoji.commits / stats.emoji.total) * 100)), tag);
        // Nothing shrinks more than without the row, but for one big-word step when nothing shrank.
        const la = layoutCard({ ...a, lang });
        const lb = layoutCard({ ...b, lang });
        assert.deepEqual(la.drawnCharts, lb.drawnCharts, tag);
        assert.ok(la.shrinkSteps <= lb.shrinkSteps + (lb.shrinkSteps === 0 ? 1 : 0), tag);
        assert.equal(a.lines.filter(isEmojiRow).length, 1, tag);
        const counter = (l) => l.label === M.counterCommits;
        const counterLabels = [M.counterCommits, M.fixCommits, M.wipCommits, M.oopsCommits];
        const before = a.lines.slice(0, -1);
        const kept = b.lines.filter((l) => !counterLabels.includes(l.label));
        if (before.some(counter)) {
          // Folded: the longest / shortest rows, then the one counter row, then emoji.
          assert.ok(counter(before.at(-1)), tag);
          assert.equal(before.at(-1).value, '10 / 0 / 0', tag);
          assert.deepEqual(before.slice(0, -1), kept, tag);
          seen.add(`folded:${charts(a).length}:${b.lines.some(counter) ? 'byTypes' : 'byEmoji'}`);
        } else if (before.length === kept.length && before.length < b.lines.length) {
          // In place of the counter rows: the longest / shortest rows, then emoji.
          assert.deepEqual(before, kept, tag);
          seen.add(`replaced:${charts(a).length}`);
        } else {
          assert.deepEqual(before, b.lines, tag);
          seen.add(`appended:${charts(a).length}`);
        }
      }
    });
  }

  test('every path was exercised: appended, folded by the type mix, folded for the emoji row, in place of the counters', () => {
    for (const k of ['appended:1', 'folded:2:byTypes', 'folded:2:byEmoji', 'replaced:2']) assert.ok(seen.has(k), `${k} in ${[...seen]}`);
    // With rows on the card, the row always finds room now.
    assert.ok(![...seen].some((k) => k.startsWith('none')), [...seen].join());
  });

  test('the type mix chart is drawn when the emoji row is added', () => {
    const stats = variant(1, 1, 100);
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, lang);
      if (!isEmojiRow(spec.lines.at(-1))) continue;
      const l = layoutCard({ ...spec, lang });
      assert.deepEqual(l.drawnCharts, charts(spec).map((_, i) => i));
    }
  });
});

// --- macOS PNG text ------------------------------------------------------------------------

describe('emoji row on macOS PNGs (emoji stripped from text)', () => {
  const stats = computeStats(Array.from({ length: 20 }, (_, i) => commit(['✨ a', ':bug: b', '📝 c', 'plain d'][i % 4], i)), { today: TODAY });

  for (const lang of ['en', 'tr']) {
    test(`the row still reads "Emoji" with its share (${lang})`, () => {
      const svg = messagesSvg(stats, lang);
      assert.match(svg, />Emoji ✨ 🐛 📝<\/text>/);
      const mac = stripEmojiFromText(svg);
      // The label loses its emoji and the trailing space; the share is untouched.
      const pct = getStrings(lang).pct(75);
      assert.ok(mac.includes('>Emoji</text>'), lang);
      assert.match(mac, new RegExp(`>Emoji</text><text[^>]*text-anchor="end">${pct}</text>`));
      assert.doesNotMatch(mac, /[✨🐛📝]/u);
    });
  }

  test('every emoji the detector counts is stripped from PNG text', () => {
    const extra = ['©️', '™️', '2⃣', '#⃣', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🇹🇷', '↔️', '☺️', '👍🏽', '🏳️‍🌈', '🧑‍💻', '⚡', '⚡️'];
    for (const e of [...Object.values(GITMOJI), ...extra]) {
      assert.deepEqual(emojiIn(`x ${e}`), [e], e);
      assert.equal(stripEmojiFromText(`<text x="1">Emoji ${e}</text>`), '<text x="1">Emoji</text>', e);
    }
  });

  test('a keycap / flag top emoji also strips cleanly from the card', () => {
    const s = { ...stats, emoji: { total: 20, commits: 10, top: [{ emoji: '#️⃣', count: 5 }, { emoji: '🇹🇷', count: 4 }, { emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', count: 1 }] } };
    const svg = messagesSvg(s);
    assert.match(svg, />Emoji #️⃣ 🇹🇷 🏴󠁧󠁢󠁳󠁣󠁴󠁿<\/text>/u);
    assert.match(stripEmojiFromText(svg), />Emoji<\/text><text[^>]*>50%<\/text>/);
  });
});

// --- hand-edited stats.json ----------------------------------------------------------------

describe('hand-edited stats.emoji: never throws, never prints junk', () => {
  const base = computeStats(Array.from({ length: 20 }, (_, i) => commit(['✨ a', 'plain b'][i % 2], i)), { today: TODAY });
  const JUNK_VALUES = [null, undefined, true, 0, -1, 1.5, NaN, Infinity, -Infinity, '5', '', 'abc', [], {}, [1, 2], { a: 1 }, 1e308, -0];
  const JUNK_EMOJI = ['', 'x', 'ab', '✨🐛', '✨ ', ' ✨', '✨\n', '<script>', '&amp;', '©', '™', '♻', '☺︎', '🇹', '#', '1', '‍', '️', '**', '`', '‮✨', '<✨>', 'a✨', 42, null, {}, ['✨']];
  const variants = [];
  for (const v of JUNK_VALUES) variants.push(v, { commits: v, total: 10, top: [{ emoji: '✨', count: 3 }] }, { commits: 5, total: v, top: [{ emoji: '✨', count: 3 }] }, { commits: 5, total: 10, top: v }, { commits: 5, total: 10, top: [{ emoji: '✨', count: v }] });
  for (const e of JUNK_EMOJI) variants.push({ commits: 5, total: 10, top: [{ emoji: e, count: 3 }] });
  variants.push(
    { commits: -5, total: -10, top: [{ emoji: '✨', count: -3 }] },
    { commits: 5, total: 10, top: [null, 'x', 7, [], { emoji: '✨' }, { count: 3 }] },
    { commits: 5, total: 10, top: Array.from({ length: 10 }, (_, i) => ({ emoji: ['✨', '🐛', '📝', '🚀', '🔥'][i % 5], count: 10 - i })) },
    { commits: 5, total: 10, top: [{ emoji: '✨', count: 1e9 }] },
    { commits: 5, total: 10, shown: false, top: [{ emoji: '✨', count: 3 }] },
    { commits: 1, total: 100, shown: true, top: [{ emoji: '✨', count: 1 }] },
    { commits: 50, total: 10, top: [{ emoji: '✨', count: 50 }] },
    { commits: 2.6, total: 10.2, top: [{ emoji: '✨', count: 0.4 }, { emoji: '🐛', count: 2.4 }] },
    { share: 0.9, top: [{ emoji: '✨', count: 3 }] },
    Object.assign(Object.create({ commits: 5, total: 10 }), {}),
  );

  const ALLOWED = new Set(['✨', '🐛', '📝', '🚀']);
  /** Every emoji-ish cluster in the text is one we allowed. */
  function onlyAllowedEmoji(text, tag) {
    for (const e of emojiIn(text)) assert.ok(ALLOWED.has(e), `${tag}: unexpected ${JSON.stringify(e)} in ${JSON.stringify(text)}`);
  }

  test('shownEmoji: null or a clean shape', () => {
    for (const v of variants) {
      const s = shownEmoji(v);
      if (s === null) continue;
      const tag = JSON.stringify(v);
      assert.deepEqual(Object.keys(s), ['commits', 'total', 'top'], tag);
      assert.ok(Number.isInteger(s.commits) && s.commits > 0, tag);
      assert.ok(Number.isInteger(s.total) && s.total >= s.commits, tag);
      assert.ok(s.commits / s.total >= 0.05, tag);
      assert.ok(s.top.length <= 3, tag);
      for (const t of s.top) {
        assert.ok(isEmoji(t.emoji), tag);
        assert.ok(Number.isInteger(t.count) && t.count > 0 && t.count <= s.commits, tag);
      }
    }
  });

  test('card, recap and wrapped.md (en + tr) for every variant', () => {
    for (const v of variants) {
      const stats = { ...base, emoji: v };
      const tag = (() => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } })();
      const shown = shownEmoji(v);
      for (const lang of ['en', 'tr']) {
        const L = getStrings(lang);
        const svg = messagesSvg(stats, lang);
        const recap = formatSummary(stats, { repoName: 'demo', lang });
        const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang });
        for (const out of [svg, recap, md]) {
          assert.doesNotMatch(out, /NaN|Infinity|undefined|\[object|null%|-\d+%|%-\d/, `${lang} ${tag}`);
          assert.doesNotMatch(out, /<script>|‮/, `${lang} ${tag}`);
        }
        const recapLine = recap.split('\n').find((l) => /^\s+Emoji\s/.test(l));
        const mdSection = /## Emoji\n\n([^\n]*)/.exec(md)?.[1];
        if (!shown) {
          assert.equal(recapLine, undefined, `${lang} ${tag}`);
          assert.equal(mdSection, undefined, `${lang} ${tag}`);
          assert.equal(svg, messagesSvg(without(stats), lang), `${lang} ${tag}`);
          continue;
        }
        assert.ok(recapLine, `${lang} ${tag}`);
        assert.ok(mdSection, `${lang} ${tag}`);
        onlyAllowedEmoji(recapLine, tag);
        onlyAllowedEmoji(mdSection, tag);
        // All three agree on the share and the emoji listed.
        const pctRe = lang === 'en' ? /(\d+)%/ : /%(\d+)/;
        const pct = pctRe.exec(recapLine)[1];
        assert.equal(pctRe.exec(mdSection)[1], pct, `${lang} ${tag}`);
        assert.deepEqual(emojiIn(recapLine), shown.top.map((t) => t.emoji), `${lang} ${tag}`);
        assert.deepEqual(emojiIn(mdSection), shown.top.map((t) => t.emoji), `${lang} ${tag}`);
        for (const t of shown.top) {
          assert.ok(recapLine.includes(`${t.emoji} ${L.num(t.count)}`), `${lang} ${tag}`);
          assert.ok(mdSection.includes(`${t.emoji} ${L.num(t.count)}`), `${lang} ${tag}`);
        }
        const row = messagesSpec(stats, lang).lines.at(-1);
        if (isEmojiRow(row)) {
          assert.equal(row.label, ['Emoji', ...shown.top.map((t) => t.emoji)].join(' '), `${lang} ${tag}`);
          assert.equal(row.value, L.pct(Number(pct)), `${lang} ${tag}`);
        }
      }
    }
  });

  test('specific clamps: counts capped at commits, total raised to commits, at most three emoji', () => {
    assert.deepEqual(shownEmoji({ commits: 5, total: 10, top: [{ emoji: '✨', count: 1e9 }] }).top, [{ emoji: '✨', count: 5 }]);
    assert.equal(shownEmoji({ commits: 50, total: 10, top: [] }).total, 50);
    assert.deepEqual(shownEmoji({ commits: 2.6, total: 10.2, top: [{ emoji: '✨', count: 0.4 }, { emoji: '🐛', count: 2.4 }] }), { commits: 3, total: 10, top: [{ emoji: '🐛', count: 2 }] });
    assert.equal(shownEmoji({ commits: 1, total: 100, shown: true, top: [{ emoji: '✨', count: 1 }] }), null);
    const md = buildMarkdown({ ...base, emoji: { commits: 50, total: 10, top: [{ emoji: '✨', count: 50 }] } }, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Emoji\n\n100% of commits: ✨ 50/);
  });

  test('keycap # / * are escaped in wrapped.md but kept whole', () => {
    const stats = { ...base, emoji: { commits: 5, total: 10, top: [{ emoji: '#️⃣', count: 3 }, { emoji: '*️⃣', count: 2 }] } };
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Emoji\n\n50% of commits: \\#️⃣ 3 · \\\*️⃣ 2\n/u);
    // The recap prints them as they are.
    assert.match(formatSummary(stats, { repoName: 'demo' }), /Emoji +50% of commits · #️⃣ 3 · \*️⃣ 2/u);
  });

  test('an empty top still shows the share alone', () => {
    const stats = { ...base, emoji: { commits: 5, total: 10, top: [] } };
    assert.match(formatSummary(stats, { repoName: 'demo' }), /Emoji +50% of commits\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /## Emoji\n\n50% of commits\n/);
    const row = messagesSpec(stats).lines.at(-1);
    assert.deepEqual(row, { label: 'Emoji', value: '50%' });
  });

  test('a stats object without emoji (an older stats.json) renders as before', () => {
    const old = without(base);
    assert.doesNotMatch(formatSummary(old, { repoName: 'demo' }), /Emoji/);
    assert.doesNotMatch(buildMarkdown(old, { repoName: 'demo', today: TODAY }), /Emoji/);
    assert.doesNotThrow(() => specs(old));
  });
});

// --- Turkish ------------------------------------------------------------------------------

describe('tr localization', () => {
  const stats = computeStats(Array.from({ length: 40 }, (_, i) => commit(['✨ ekle', ':bug: düzelt', 'güncelle', 'üç', '📝 belge', 'dört', 'beş', 'altı', 'yedi', 'sekiz'][i % 10], i)), { today: TODAY });

  test('recap, wrapped.md and card in Turkish', () => {
    const recap = formatSummary(stats, { repoName: 'demo', lang: 'tr' });
    assert.match(recap, /\n  Emoji +commit'lerin %30 kadarı · ✨ 4 · 🐛 4 · 📝 4\n/);
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(md, /## Emoji\n\ncommit'lerin %30 kadarı: ✨ 4 · 🐛 4 · 📝 4\n/);
    const row = messagesSpec(stats, 'tr').lines.at(-1);
    assert.deepEqual(row, { label: 'Emoji ✨ 🐛 📝', value: '%30' });
  });

  test('Turkish number formatting of large counts', () => {
    const big = { ...stats, emoji: { commits: 12345, total: 20000, top: [{ emoji: '✨', count: 12000 }] } };
    const tr = getStrings('tr');
    assert.ok(formatSummary(big, { repoName: 'demo', lang: 'tr' }).includes(`✨ ${tr.num(12000)}`));
    assert.ok(buildMarkdown(big, { repoName: 'demo', today: TODAY, lang: 'tr' }).includes(`✨ ${tr.num(12000)}`));
    assert.ok(formatSummary(big, { repoName: 'demo' }).includes('✨ 12,000'));
  });

  test('colored recap keeps the line intact', () => {
    const recap = formatSummary(stats, { repoName: 'demo', lang: 'tr', color: true });
    // eslint-disable-next-line no-control-regex
    const plain = recap.replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(plain, /Emoji +commit'lerin %30 kadarı · ✨ 4 · 🐛 4 · 📝 4/);
  });
});

// --- detector edge cases -------------------------------------------------------------------

describe('emojiIn / isEmoji edge cases', () => {
  test('keycaps, with and without U+FE0F; bare digits and # are not', () => {
    assert.deepEqual(emojiIn('1️⃣ 2⃣ #⃣ *️⃣'), ['1️⃣', '2⃣', '#⃣', '*️⃣']);
    assert.deepEqual(emojiIn('#1 *bold* 0 # 1'), []);
    assert.deepEqual(emojiIn('v1️⃣'), ['1️⃣']);
    assert.equal(emojiKey('2⃣'), emojiKey('2️⃣'));
  });

  test('tag-sequence flags are one emoji; a lone regional indicator is not', () => {
    assert.deepEqual(emojiIn('🏴󠁧󠁢󠁳󠁣󠁴󠁿🏴󠁧󠁢󠁷󠁬󠁳󠁿'), ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿']);
    assert.deepEqual(emojiIn('🇹'), []);
    assert.deepEqual(emojiIn('🇹🇷🇺'), ['🇹🇷']);
    const e = computeEmoji([commit('🏴󠁧󠁢󠁳󠁣󠁴󠁿 a', 1), commit('🏴󠁧󠁢󠁳󠁣󠁴󠁿 b', 2), commit('🏴 c', 3)]);
    assert.equal(e.distinct, 2);
    assert.deepEqual(e.top[0], { emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', count: 2 });
  });

  test('text-style symbols do not count; their emoji-style (FE0F) forms do', () => {
    assert.deepEqual(emojiIn('© 2026 Acme™ ® ‼ ⁉ ↔ ↩ ▶ ☺ ♥ ♻'), []);
    assert.deepEqual(emojiIn('©️ ™️'), ['©️', '™️']);
    assert.equal(computeEmoji([commit('Copyright © 2026', 1), commit('Brand™ rename', 2)]).commits, 0);
  });

  test('U+FE0E forces text style, even on default-emoji pictographs', () => {
    assert.deepEqual(emojiIn('✨︎ ⚡︎ ❤︎ ☺︎'), []);
    assert.deepEqual(emojiIn('✨︎ and ✨'), ['✨']);
  });

  test(':+1:, :-1:, :100: and adjacent shortcodes', () => {
    assert.deepEqual(emojiIn(':+1: :-1:'), ['👍', '👎']);
    assert.deepEqual(emojiIn(':tada::rocket::fire:'), ['🎉', '🚀', '🔥']);
    // A shortcode right after a stray ":" is not one (std::thread::spawn).
    assert.deepEqual(emojiIn('::tada::'), []);
    assert.deepEqual(emojiIn(':pencil2::memo:'), ['✏️', '📝']);
    assert.deepEqual(emojiIn('(:tada:)'), ['🎉']);
    assert.deepEqual(emojiIn(':100: at 10:100:'), ['💯']);
    assert.deepEqual(emojiIn(':TADA: :Tada:'), []);
    // A shortcode right after a letter (any script) is not one.
    assert.deepEqual(emojiIn('é:tada: ş:tada: 日:tada:'), []);
  });

  test('URLs and ports are not shortcodes', () => {
    assert.deepEqual(emojiIn('http://x:80: down'), []);
    assert.deepEqual(emojiIn('http://x:80: :tada:'), ['🎉']);
    // After a "/" a shortcode is one again (only letters and digits block it).
    assert.deepEqual(emojiIn('see http://host:8080/:bug:'), ['🐛']);
    assert.deepEqual(emojiIn('http://x:tada:'), []);
    assert.deepEqual(emojiIn('ssh git@host:repo:fire:'), []);
  });

  test('shortcodes and Unicode spellings of one emoji merge; repeats count once per commit', () => {
    const e = computeEmoji([commit(':recycle: ♻️ ♻️', 1), commit('♻️ x', 2), commit(':zap: ⚡', 3)]);
    assert.equal(e.commits, 3);
    assert.equal(e.distinct, 2);
    assert.deepEqual(e.top, [{ emoji: '♻️', count: 2 }, { emoji: '⚡', count: 1 }]);
  });

  test('ZWJ sequences and skin tones are one emoji each; variants stay distinct', () => {
    assert.deepEqual(emojiIn('🧑‍💻👍🏽👍'), ['🧑‍💻', '👍🏽', '👍']);
    assert.equal(computeEmoji([commit('👍🏽', 1), commit('👍', 2)]).distinct, 2);
  });

  test('isEmoji rejects non-strings and multi-character text', () => {
    for (const v of [null, undefined, 0, {}, [], '', 'a', '#', '1', '️', '‍', '⃣']) assert.equal(isEmoji(v), false, JSON.stringify(v));
  });

  test('merge commits and blank subjects are not counted', () => {
    const e = computeEmoji([commit('✨ a', 1), commit('🎉 Merge branch', 2, [], { parents: ['a', 'b'] }), commit('   ', 3), commit('b', 4)]);
    assert.deepEqual({ total: e.total, commits: e.commits }, { total: 2, commits: 1 });
  });

  test('random strings never throw and results are always emoji', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pool = ['a', ' ', ':', 'tada', 'bug', '+1', '✨', '️', '︎', '‍', '⃣', '1', '#', '🇹', '🇷', '🏴', '\u{E0067}', '\u{E007F}', '©', '👍', '🏽', '\ud83d', 'http://', '9'];
    for (let n = 0; n < 2000; n++) {
      const s = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pool[Math.floor(rnd() * pool.length)]).join('');
      const found = emojiIn(s);
      for (const e of found) assert.ok(isEmoji(e), `${JSON.stringify(s)} → ${JSON.stringify(e)}`);
    }
  });
});

// --- multi-repo + end-to-end ---------------------------------------------------------------

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...extra };
}
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
const WHO = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };

function makeRepo(dir, subjects, day0 = 1) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  subjects.forEach((subject, i) => {
    const date = `2026-03-${String(day0 + i).padStart(2, '0')}T12:00:00+00:00`;
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', subject], { ...WHO, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  });
  return dir;
}
const bin = (args) => spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv({ TZ: 'UTC' }) });

describe('end to end through the CLI', () => {
  let tmp;
  let repoA;
  let repoB;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-emoji-'));
    repoA = makeRepo(join(tmp, 'api'), ['✨ add login', ':bug: fix crash', 'update readme', ':sparkles: add logout', 'refactor parser', '✨️ polish']);
    // A merge commit with an emoji subject: not counted.
    git(repoA, ['checkout', '-q', '-b', 'side']);
    git(repoA, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', '📝 docs on side'], { ...WHO, GIT_AUTHOR_DATE: '2026-03-10T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-03-10T12:00:00+00:00' });
    git(repoA, ['checkout', '-q', 'main']);
    git(repoA, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'plain on main'], { ...WHO, GIT_AUTHOR_DATE: '2026-03-11T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-03-11T12:00:00+00:00' });
    git(repoA, ['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', '🎉 Merge side', 'side'], { ...WHO, GIT_AUTHOR_DATE: '2026-03-12T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-03-12T12:00:00+00:00' });
    repoB = makeRepo(join(tmp, 'web'), ['🐛 fix layout', 'plain one', 'plain two', '🐛 fix again'], 13);
  });
  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('single repo: stats.json, recap and wrapped.md', () => {
    const out = join(tmp, 'out-a');
    const r = bin([repoA, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    // 8 non-merge commits: ✨ ×3 (✨, :sparkles:, ✨️), 🐛, 📝 → 5 with emoji.
    assert.deepEqual(doc.stats.emoji, {
      total: 8, commits: 5, share: 0.625, distinct: 3,
      top: [{ emoji: '✨️', count: 3 }, { emoji: '🐛', count: 1 }, { emoji: '📝', count: 1 }],
      shown: true,
    });
    assert.match(r.stdout, /\n  Emoji +63% of commits · ✨️ 3 · 🐛 1 · 📝 1\n/);
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    assert.match(md, /## Emoji\n\n63% of commits: ✨️ 3 · 🐛 1 · 📝 1\n/);
    assert.doesNotMatch(md, /🎉/);
    const card = readdirSync(join(out, 'cards')).find((f) => /-messages\.svg$/.test(f));
    assert.ok(card);
    assert.match(readFileSync(join(out, 'cards', card), 'utf8'), />Emoji ✨️ 🐛 📝<\/text>/);
  });

  test('Turkish run', () => {
    const out = join(tmp, 'out-tr');
    const r = bin([repoA, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\n  Emoji +commit'lerin %63 kadarı · ✨️ 3 · 🐛 1 · 📝 1\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Emoji\n\ncommit'lerin %63 kadarı: ✨️ 3 · 🐛 1 · 📝 1\n/);
    // stats.json is language-independent.
    assert.equal(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.emoji.commits, 5);
  });

  test('two repos merge into one emoji stat', () => {
    const out = join(tmp, 'out-ab');
    const r = bin([repoA, repoB, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const e = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.emoji;
    // 8 + 4 commits; 5 + 2 with emoji; 🐛 in 1 + 2 commits.
    assert.deepEqual(e, {
      total: 12, commits: 7, share: 0.583, distinct: 3,
      top: [{ emoji: '✨️', count: 3 }, { emoji: '🐛', count: 3 }, { emoji: '📝', count: 1 }],
      shown: true,
    });
    assert.match(r.stdout, /\n  Emoji +58% of commits · ✨️ 3 · 🐛 3 · 📝 1\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Emoji\n\n58% of commits: ✨️ 3 · 🐛 3 · 📝 1\n/);
  });

  test('a repo without emoji: stat in stats.json, no recap line or section', () => {
    const dir = makeRepo(join(tmp, 'plain'), ['add a', 'fix b', 'docs c']);
    const out = join(tmp, 'out-plain');
    const r = bin([dir, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.emoji, { total: 3, commits: 0, share: 0, distinct: 0, top: [], shown: false });
    assert.doesNotMatch(r.stdout, /Emoji/);
    assert.doesNotMatch(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Emoji/);
  });
});
