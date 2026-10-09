// Extra edge cases for the subject length stat (stats.messages.subjectLength,
// src/stats/messages.js) beyond test/subject-length.test.js: code point counting (astral,
// ZWJ, combining marks), trimming, the 72 / 73 boundary, even / odd medians and their
// en / tr display, merges, malformed values, the messages card (fit, placement, never
// displacing rows, byte-identical without the stat), recap / wrapped.md lines, stats.json
// key order, and end to end through the real CLI on a git fixture (--author, --exclude).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMessages, computeStats, shownSubjectLength, SUBJECT_LIMIT } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard, subjectLengthShareText, CARD_WIDTH, measureText } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'gitwrapped.js');
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
const len = (n, ch = 'x') => ch.repeat(n);
const sl = (subjects) => computeMessages(history(subjects)).subjectLength;
const statsOf = (subjects) => computeStats(history(subjects), { today: TODAY });
// Build output only (dist/ is ignored like the hot files): no biggest-commit panel, so the
// messages card has spare room for the (append-only) row.
const roomyOf = (subjects) => computeStats(history(subjects).map((c, i) => ({ ...c, files: [{ path: `dist/${i}.js`, added: 3, removed: 1 }] })), { today: TODAY });
const cardOpts = (lang, theme) => ({ repoName: 'demo', today: TODAY, lang, ...(theme ? { colorTheme: theme } : {}) });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === 'messages').spec;
const svgs = (stats, lang = 'en', theme) => buildCards(stats, cardOpts(lang, theme)).map((c) => [c.id, c.svg]);
const withStat = (s, subjectLength) => ({ ...s, messages: { ...s.messages, subjectLength } });
const isRow = (r, L = en) => r?.label === L.messages.subjectLengthTitle;

const rawTexts = (svg) => [...svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, '') }));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Every block inside the content area, none overlapping. */
function assertLayoutInBounds(spec, label) {
  const { blocks } = layoutCard(spec);
  for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${label}: ${b.kind} ${b.top}..${b.bottom}`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${label}: blocks ${blocks[i].kind} / ${blocks[j].kind} overlap`);
    }
  }
}

/** Every start-anchored <text> ends inside the card (measureText estimate). */
function assertTextsInside(svg, label) {
  for (const { attrs, text } of rawTexts(svg)) {
    if (/text-anchor/.test(attrs)) continue;
    const x = Number(/\bx="([\d.-]+)"/.exec(attrs)?.[1]);
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(size)) continue;
    const w = measureText(decode(text), size);
    assert.ok(x >= 0 && x + w <= CARD_WIDTH, `${label}: "${decode(text)}" (${x}+${Math.round(w)}) inside the card`);
  }
}

describe('computeMessages: code points and trimming', () => {
  test('astral emoji count 1 each; ZWJ sequences and skin tones count every code point; combining marks count', () => {
    assert.equal(sl(['🎉']).median, 1);
    assert.equal(sl(['🎉🚀✨']).median, 3);
    assert.equal(sl(['👨‍👩‍👧‍👦']).median, 7); // 4 people + 3 ZWJ
    assert.equal(sl(['👍🏽']).median, 2); // base + skin tone modifier
    assert.equal(sl(['é']).median, 2); // e + combining acute
    assert.equal(sl(['é']).median, 1); // precomposed é
    assert.equal(sl(['𝐀𝐁𝐂']).median, 3); // mathematical bold (astral)
    assert.equal(sl(['日本語のコミット']).median, 8);
    assert.equal(sl(['🇹🇷']).median, 2); // a flag is two regional indicators
  });

  test('a lone surrogate counts as one code point and never throws', () => {
    assert.equal(sl(['\uD800abc']).median, 4);
    assert.equal(sl(['abc\uDC00']).median, 4);
  });

  test('72 astral code points are not over 72; 73 are (UTF-16 length would say 144 / 146)', () => {
    assert.deepEqual(sl([len(72, '🎉')]), { median: 72, over72: 0, share: 0 });
    assert.deepEqual(sl([len(73, '🎉')]), { median: 73, over72: 1, share: 1 });
    assert.deepEqual(sl([len(36, 'é')]), { median: 72, over72: 0, share: 0 });
    assert.deepEqual(sl([`${len(36, 'é')}x`]), { median: 73, over72: 1, share: 1 });
  });

  test('whitespace-only and empty subjects count as length 0 (and still count as commits)', () => {
    assert.deepEqual(sl(['   ', '\t\t', '', ' ', '　']), { median: 0, over72: 0, share: 0 });
    assert.deepEqual(sl(['   ', len(80)]), { median: 40, over72: 1, share: 0.5 });
  });

  test('padding is trimmed (spaces, tabs, NBSP, ideographic space, BOM) before measuring and before the 72 check', () => {
    assert.equal(sl(['  abc  ']).median, 3);
    assert.equal(sl(['\t\tabc\n']).median, 3);
    assert.equal(sl([' abc　']).median, 3);
    assert.equal(sl(['﻿abc']).median, 3);
    assert.deepEqual(sl([`${len(10, ' ')}${len(72)}${len(10, ' ')}`]), { median: 72, over72: 0, share: 0 });
    assert.deepEqual(sl([`\t${len(73)}\t`]), { median: 73, over72: 1, share: 1 });
    // Zero-width space is not whitespace for String#trim: it counts.
    assert.equal(sl(['​abc']).median, 4);
  });

  test('exactly 72 vs 73, alone and mixed', () => {
    assert.deepEqual(sl([len(72)]), { median: 72, over72: 0, share: 0 });
    assert.deepEqual(sl([len(73)]), { median: 73, over72: 1, share: 1 });
    assert.deepEqual(sl([len(71), len(72), len(73), len(74)]), { median: 72.5, over72: 2, share: 0.5 });
    assert.equal(SUBJECT_LIMIT, 72);
  });
});

describe('computeMessages: medians', () => {
  test('odd counts: the middle value, whatever the input order', () => {
    assert.equal(sl(['ccc', 'a', 'bb']).median, 2);
    assert.equal(sl([len(5), len(1), len(9), len(3), len(7)]).median, 5);
    assert.equal(sl([len(100)]).median, 100);
  });

  test('even counts: the mean of the two middle values, whole or exactly .5', () => {
    assert.equal(sl(['a', 'bbb']).median, 2);
    assert.equal(sl([len(10), len(11)]).median, 10.5);
    assert.equal(sl([len(1), len(10), len(11), len(500)]).median, 10.5);
    assert.equal(sl(['', 'a']).median, 0.5);
  });

  test('numeric (not lexicographic) sort', () => {
    assert.equal(sl([len(9), len(10), len(100)]).median, 10);
    assert.equal(sl([len(2), len(10), len(11)]).median, 10);
  });

  test('duplicates', () => {
    assert.equal(sl(['aa', 'aa', 'aa', 'b']).median, 2);
  });

  test('the input array is not reordered', () => {
    const commits = history([len(9), len(1), len(5)]);
    const before = commits.map((c) => c.subject);
    computeMessages(commits);
    assert.deepEqual(commits.map((c) => c.subject), before);
  });
});

describe('computeMessages: merges and odd entries', () => {
  test('two-parent merges are skipped whatever their subject; one-parent "Merge ..." subjects count', () => {
    const m = computeMessages([
      commit(len(200), 1, { parents: ['a', 'b'] }),
      commit(len(200), 2, { parents: ['a', 'b', 'c'] }),
      commit('Merge branch feature', 3, { parents: ['a'] }), // 20, has a parents array with one entry
      commit('abc', 4),
    ]);
    assert.deepEqual(m.subjectLength, { median: 11.5, over72: 0, share: 0 });
  });

  test('without a parents array, git merge subjects are skipped', () => {
    const noParents = (s, i) => {
      const c = commit(s, i);
      delete c.parents;
      return c;
    };
    const m = computeMessages([noParents(`Merge pull request #1 from x/${len(80)}`, 1), noParents("Merge 'a' into b", 2), noParents('abc', 3)]);
    assert.deepEqual(m.subjectLength, { median: 3, over72: 0, share: 0 });
  });

  test('a root commit (parents: []) counts', () => {
    assert.deepEqual(computeMessages([commit('abcd', 1, { parents: [] })]).subjectLength, { median: 4, over72: 0, share: 0 });
  });

  test('non-object entries are ignored; non-string subjects count as 0', () => {
    const m = computeMessages([null, undefined, 5, 'x', commit('abcd', 1), commit(42, 2), commit({ toString: () => len(90) }, 3)]);
    assert.deepEqual(m.subjectLength, { median: 0, over72: 0, share: 0 });
  });

  test('only merges → null', () => {
    assert.equal(computeMessages([commit('x', 1, { parents: ['a', 'b'] }), commit('y', 2, { parents: ['a', 'b'] })]).subjectLength, null);
  });
});

describe('shownSubjectLength: malformed values', () => {
  test('median: 0 is fine; Infinity / null / boolean / string are not', () => {
    assert.deepEqual(shownSubjectLength({ median: 0, over72: 0, share: 0 }), { median: 0, over72: 0, pct: 0 });
    for (const median of [Infinity, -Infinity, null, true, '3', [3], -0.1]) {
      assert.equal(shownSubjectLength({ median, over72: 1, share: 0.5 }), null, String(median));
    }
  });

  test('over72: rounded, negatives / non-numbers → 0', () => {
    assert.equal(shownSubjectLength({ median: 3, over72: 2.4, share: 0.5 }).over72, 2);
    for (const over72 of [-1, NaN, Infinity, '2', null, undefined, true]) {
      assert.deepEqual(shownSubjectLength({ median: 3, over72, share: 0.5 }), { median: 3, over72: 0, pct: 0 }, String(over72));
    }
  });

  test('share clamped: > 1 → 99.9%, negative / missing → 0 (shown "<1%")', () => {
    assert.equal(shownSubjectLength({ median: 3, over72: 1, share: 7 }).pct, 99.9);
    assert.equal(shownSubjectLength({ median: 3, over72: 1, share: -1 }).pct, 0);
    assert.equal(shownSubjectLength({ median: 3, over72: 1 }).pct, 0);
    assert.equal(subjectLengthShareText(shownSubjectLength({ median: 3, over72: 1 })), '<1%');
  });

  test('a stats.json round trip (no exact ratio) keeps the share text', () => {
    const live = sl([len(80), 'a', 'b']);
    const parsed = JSON.parse(JSON.stringify(live));
    assert.equal(subjectLengthShareText(shownSubjectLength(live)), subjectLengthShareText(shownSubjectLength(parsed)));
    // 1/2000 is 0.05%: "<1%" from the exact ratio and from the rounded 0.001 alike.
    const tiny = sl([len(80), ...Array.from({ length: 1999 }, () => 'x')]);
    assert.equal(subjectLengthShareText(shownSubjectLength(tiny)), '<1%');
    assert.equal(subjectLengthShareText(shownSubjectLength(JSON.parse(JSON.stringify(tiny)))), '<1%');
  });
});

describe('display: .5 medians and grouping in en / tr', () => {
  test('card values', () => {
    assert.equal(en.messages.subjectLengthValue(10.5, 0, '0%'), 'median 10.5');
    assert.equal(tr.messages.subjectLengthValue(10.5, 0, '%0'), 'medyan 10,5');
    assert.equal(en.messages.subjectLengthValue(10.5, 3, '12%'), '10.5 · 12% over 72');
    assert.equal(tr.messages.subjectLengthValue(10.5, 3, '%12'), '10,5 · 72 üstü %12');
    assert.equal(en.messages.subjectLengthShort(10.5, 3, '12%'), '10.5 · 12% >72');
    assert.equal(tr.messages.subjectLengthShort(10.5, 3, '%12'), '10,5 · >72: %12');
    assert.equal(en.messages.subjectLengthValue(10, 0, '0%'), 'median 10');
    assert.equal(en.messages.subjectLengthValue(1234.5, 0, '0%'), 'median 1,234.5');
    assert.equal(tr.messages.subjectLengthValue(1234.5, 0, '%0'), 'medyan 1.234,5');
  });

  test('descriptions, recap and markdown values', () => {
    assert.equal(en.messages.subjectLengthDescription(10.5, 1, '25%'), 'Median subject length: 10.5 characters; 1 commit over 72 characters (25% of non-merge commits)');
    assert.equal(tr.messages.subjectLengthDescription(10.5, 2, '%25'), "Medyan konu satırı uzunluğu: 10,5 karakter; 2 commit 72 karakteri aşıyor (merge dışı commit'lerin %25 kadarı)");
    assert.equal(en.messages.subjectLengthDescription(10, 0, '0%'), 'Median subject length: 10 characters; no commit over 72 characters');
    assert.equal(en.recap.subjectLengthValue(10.5, 2), 'median 10.5 chars · 2 commits over 72');
    assert.equal(tr.recap.subjectLengthValue(10.5, 2), 'medyan 10,5 karakter · 2 commit 72 üstü');
    assert.equal(tr.recap.subjectLengthValue(10.5, 0), 'medyan 10,5 karakter · 72 üstü yok');
    assert.equal(en.markdown.subjectLengthValue(10.5, 1), 'median 10.5 characters; 1 commit over 72 characters');
    assert.equal(tr.markdown.subjectLengthValue(10.5, 0), 'medyan 10,5 karakter; hiçbiri 72 karakteri aşmıyor');
  });

  test('end to end from an even history: card, recap and markdown agree on "10.5" / "10,5"', () => {
    const s = statsOf([len(10), len(11), len(10), len(11)]);
    assert.equal(s.messages.subjectLength.median, 10.5);
    assert.equal(messagesSpec(s).lines.at(-1).value, 'median 10.5');
    assert.equal(messagesSpec(s, 'tr').lines.at(-1).value, 'medyan 10,5');
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /Subjects\s+median 10\.5 chars · none over 72\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Konu satırları\s+medyan 10,5 karakter · 72 üstü yok\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /## Subject length\n\nmedian 10\.5 characters; none over 72 characters\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Konu satırı uzunluğu\n\nmedyan 10,5 karakter; hiçbiri 72 karakteri aşmıyor\n/);
  });

  test('a hand-edited non-.5 median is shown with one decimal', () => {
    const s = withStat(roomyOf(['aa', 'bb', 'cc']), { median: 10.26, over72: 0, share: 0 });
    assert.equal(messagesSpec(s).lines.at(-1).value, 'median 10.3');
    assert.equal(messagesSpec(s, 'tr').lines.at(-1).value, 'medyan 10,3');
  });
});

describe('stats.json', () => {
  test('key order {median, over72, share} and number types, also with an even median and no long subject', () => {
    for (const [subjects, expected] of [
      [['ab', 'abc'], '{"median":2.5,"over72":0,"share":0}'],
      [[len(80), len(90), 'a'], '{"median":80,"over72":2,"share":0.667}'],
      [[len(73)], '{"median":73,"over72":1,"share":1}'],
    ]) {
      const doc = JSON.parse(buildStatsJson({ stats: statsOf(subjects), repoName: 'demo' }));
      assert.equal(JSON.stringify(doc.stats.messages.subjectLength), expected);
      assert.deepEqual(Object.keys(doc.stats.messages).slice(-4), ['fixups', 'subjectLength', 'bodies', 'topWords']);
    }
  });

  test('no symbol or extra key leaks into the serialized stat', () => {
    const s = statsOf([len(80), 'a']);
    const text = buildStatsJson({ stats: s, repoName: 'demo' });
    const doc = JSON.parse(text);
    assert.deepEqual(Object.keys(doc.stats.messages.subjectLength), ['median', 'over72', 'share']);
    assert.equal(Object.getOwnPropertySymbols(s.messages.subjectLength).length, 1); // the exact ratio
  });
});

describe('messages card', () => {
  // Histories that give the messages card few or many rows (types, emoji, reverts,
  // fixups, issue refs, dep bumps, cleanups), with and without long subjects.
  const varieties = {
    plain: ['add parser', 'tidy', 'more stuff', len(75, 'y')],
    short: ['a', 'b'],
    single: ['x'],
    typed: ['feat: add a', 'fix: b', 'chore: c', 'docs: d', 'feat: e', 'test: f', `feat: ${len(80)}`],
    busy: ['feat: 🎉 launch', 'fix: typo wip', 'oops', 'fixup! feat: 🎉 launch', 'Revert "oops"', 'closes #12 for real', 'chore(deps): bump lodash from 1 to 2', len(90, 'z'), 'wip'],
    turkish: ['İlk sürüm: çğıöşü', 'düzeltme', `${len(74, 'ş')}`, 'ekle #3'],
    allLong: Array.from({ length: 6 }, (_, i) => len(73 + i)),
    emojiOnly: ['🎉', '🚀', '✨🔥', '👨‍👩‍👧‍👦'],
  };

  test('the row fits whole, the layout stays in bounds and every text ends inside the card (en, tr, all themes)', () => {
    let shown = 0;
    for (const [name, subjects] of Object.entries(varieties)) {
      const s = statsOf(subjects);
      for (const lang of ['en', 'tr']) {
        const spec = messagesSpec(s, lang);
        const row = spec.lines?.find((r) => isRow(r, LANGS[lang]));
        if (row) {
          shown += 1;
          assert.ok(rowFits(row), `${name} ${lang}: ${JSON.stringify(row)}`);
          assert.ok(spec.lines.length <= 6);
          assert.ok(isRow(spec.lines.at(-1), LANGS[lang]), `${name} ${lang}: the row is last`);
        }
        assertLayoutInBounds({ ...spec, lang }, `${name} ${lang}`);
        for (const theme of ['default', 'mono', 'neon']) {
          const svg = svgs(s, lang, theme).find(([id]) => id === 'messages')[1];
          assertTextsInside(svg, `${name} ${lang} ${theme}`);
        }
      }
    }
    assert.ok(shown > 0);
  });

  test('never displaces a row or chart: the rows before it are exactly the card without it, charts as drawn, nothing shrunk', () => {
    for (const [name, subjects] of Object.entries(varieties)) {
      const s = statsOf(subjects);
      const ref = withStat(s, null);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const spec = messagesSpec(s, lang);
        const base = messagesSpec(ref, lang);
        const has = isRow(spec.lines?.at(-1), L);
        if (!has) {
          assert.deepEqual(spec, base, `${name} ${lang}`);
          continue;
        }
        // Append-only: no folded counters, nothing else changed.
        assert.deepEqual(spec.lines.slice(0, -1), base.lines, `${name} ${lang}`);
        const la = layoutCard({ ...spec, lang });
        const lb = layoutCard({ ...base, lang });
        assert.deepEqual(la.drawnCharts, lb.drawnCharts, `${name} ${lang}`);
        assert.ok(la.shrinkSteps <= lb.shrinkSteps, `${name} ${lang}`);
        assert.equal(spec.big, base.big);
        assert.equal(spec.subtitle, base.subtitle);
      }
    }
  });

  test('a visible "· N fixup!" segment is never folded away for the row', () => {
    for (const subjects of [['add a', 'fixup! add a', 'fix b', 'wip c', len(80)], ['add parser', 'fixup! add parser', 'tidy']]) {
      const s = statsOf(subjects);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const base = messagesSpec(withStat(s, null), lang);
        const spec = messagesSpec(s, lang);
        const baseFix = base.lines.find((r) => r.label === L.messages.fixCommits);
        assert.match(baseFix.value, /fixup!/, `${lang}: ${JSON.stringify(base.lines)}`);
        assert.ok(spec.lines.some((r) => r.label === L.messages.fixCommits && r.value === baseFix.value), `${lang}: ${JSON.stringify(spec.lines)}`);
      }
    }
    // Here the row would only fit with the counters folded (which would also hide
    // "· 1 fixup!"): the row never folds, so no row and the card as it was (byte-identical).
    const s = statsOf(['add parser', 'fixup! add parser', 'tidy']);
    for (const lang of ['en', 'tr']) {
      assert.ok(!messagesSpec(s, lang).lines.some((r) => isRow(r, LANGS[lang])), lang);
      assert.deepEqual(svgs(s, lang), svgs(withStat(s, null), lang), lang);
    }
  });

  test('every card but messages byte-identical with and without the stat, en / tr, every theme', () => {
    for (const [name, subjects] of Object.entries(varieties)) {
      const s = statsOf(subjects);
      for (const lang of ['en', 'tr']) {
        for (const theme of ['default', 'neon']) {
          const a = svgs(s, lang, theme);
          const b = svgs(withStat(s, null), lang, theme);
          assert.deepEqual(a.map(([id]) => id), b.map(([id]) => id));
          for (const [i, [id, svg]] of a.entries()) if (id !== 'messages') assert.equal(svg, b[i][1], `${name} ${lang} ${theme} ${id}`);
        }
      }
    }
  });

  test('null vs key missing vs malformed: every card byte-identical, en and tr', () => {
    const s = statsOf(varieties.busy);
    const { subjectLength, ...rest } = s.messages;
    assert.ok(subjectLength);
    const missing = { ...s, messages: rest };
    for (const lang of ['en', 'tr']) {
      const ref = svgs(withStat(s, null), lang);
      assert.deepEqual(svgs(missing, lang), ref);
      for (const bad of [{ median: NaN }, { median: '9' }, [], 0, false, { over72: 3, share: 1 }]) {
        assert.deepEqual(svgs(withStat(s, bad), lang), ref, JSON.stringify(bad));
      }
    }
  });

  test('the hover description is part of the card description, in words', () => {
    const s = roomyOf(varieties.plain);
    assert.match(cardDescription(messagesSpec(s)), /Median subject length: 10 characters; 1 commit over 72 characters \(25% of non-merge commits\)/);
    const none = roomyOf(['add parser', 'tidy', 'more stuff']);
    assert.match(cardDescription(messagesSpec(none)), /Median subject length: 10 characters; no commit over 72 characters/);
    assert.match(cardDescription(messagesSpec(none, 'tr')), /hiçbir commit 72 karakteri aşmıyor/);
  });

  test('share on the card: "<1%" for a tiny share, never 100% short of all, 100% when all', () => {
    const tiny = withStat(roomyOf(['aa', 'bb', 'cc']), { median: 2, over72: 1, share: 0.001 });
    assert.match(messagesSpec(tiny).lines.at(-1).value, /<1% (over 72|>72)$/);
    assert.match(messagesSpec(tiny, 'tr').lines.at(-1).value, /(72 üstü|>72:) <%1$/);
    const almost = withStat(roomyOf(['aa', 'bb', 'cc']), { median: 80, over72: 999, share: 0.999 });
    assert.match(messagesSpec(almost).lines.at(-1).value, /99% (over 72|>72)$/);
    const all = roomyOf(varieties.allLong);
    const row = messagesSpec(all).lines.find((r) => isRow(r));
    if (row) assert.match(row.value, /100% (over 72|>72)$/);
  });
});

describe('recap and wrapped.md', () => {
  test('recap: singular / plural, the share only with any, between Fixups and the next section', () => {
    const one = statsOf(['add parser', len(80)]);
    assert.match(formatSummary(one, { repoName: 'demo', today: TODAY }), /\n {2}Subjects {5}median 45 chars · 1 commit over 72 \(50% of non-merge commits\)\n/);
    const two = statsOf([len(80), len(81), 'x']);
    assert.match(formatSummary(two, { repoName: 'demo', today: TODAY }), /\n {2}Subjects {5}median 80 chars · 2 commits over 72 \(67% of non-merge commits\)\n/);
    assert.match(formatSummary(two, { repoName: 'demo', today: TODAY, lang: 'tr' }), /medyan 80 karakter · 2 commit 72 üstü \(merge dışı commit'lerin %67 kadarı\)\n/);
  });

  test('recap with color: the share is dimmed, the value is not', () => {
    const s = statsOf(['add parser', len(80)]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY, color: true });
    const line = out.split('\n').find((l) => l.includes('median 45 chars'));
    assert.ok(line, out);
    assert.match(line, /median 45 chars · 1 commit over 72 \x1b\[2m\(50% of non-merge commits\)/);
  });

  test('recap and markdown absent for an empty history, present for a merge-free history of empty subjects', () => {
    const empty = computeStats([], { today: TODAY });
    assert.doesNotMatch(formatSummary(empty, { repoName: 'demo', today: TODAY }), /Subjects/);
    assert.doesNotMatch(buildMarkdown(empty, { repoName: 'demo', today: TODAY }), /Subject length/);
    const blank = statsOf(['   ', '']);
    assert.equal(blank.messages.subjectLength.median, 0);
  });

  test('markdown: the share is escaped, the section sits after Fixup commits', () => {
    const s = statsOf(['add parser', 'fixup! add parser', len(80)]);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Subject length\n\nmedian 17 characters; 1 commit over 72 characters \\\(33% of non-merge commits\\\)\n/);
    const fix = md.indexOf('Fixup commits');
    const sub = md.indexOf('## Subject length');
    assert.ok(fix >= 0 && sub > fix, md);
  });

  test('card, recap and markdown share text always agree', () => {
    for (const subjects of [[len(80), ...Array.from({ length: 300 }, () => 'a')], [len(80), len(90), 'a'], [len(99)], ['a', 'b', len(73)]]) {
      const s = statsOf(subjects);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const share = subjectLengthShareText(shownSubjectLength(s.messages.subjectLength), L);
        assert.ok(formatSummary(s, { repoName: 'demo', today: TODAY, lang }).includes(share), `${lang} recap ${share}`);
        assert.ok(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }).includes(share), `${lang} md ${share}`);
        assert.ok(cardDescription(messagesSpec(s, lang)).includes(share) || !messagesSpec(s, lang).lines.some((r) => isRow(r, L)), `${lang} card ${share}`);
      }
    }
  });
});

describe('end to end: the real CLI on a git fixture', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const bob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' };
  const run = (args) => {
    const copy = { ...process.env, NO_COLOR: '1' };
    delete copy.FORCE_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { encoding: 'utf8', env: copy, cwd: ROOT });
  };
  const messagesSvg = (out) => {
    const name = readdirSync(join(out, 'cards')).find((f) => /^\d+-messages\.svg$/.test(f));
    assert.ok(name, 'messages card written');
    return readFileSync(join(out, 'cards', name), 'utf8');
  };
  let root;
  let repo;
  let day = 1;
  const next = () => `2026-03-${String(day++).padStart(2, '0')}`;
  const commitFile = (rel, message, extra = {}, flags = []) => {
    // File names differ in more than letter case (case-insensitive file systems on macOS / Windows).
    mkdirSync(join(repo, rel, '..'), { recursive: true });
    writeFileSync(join(repo, rel), `${rel} ${day}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', ...flags, '-m', message], { ...at(next()), ...extra });
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-subject-length-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    commitFile('src/a.js', 'feat: init'); // 10
    commitFile('src/b.js', '🎉 ship it'); // 9 code points (11 UTF-16 units)
    commitFile('src/c.js', 'étude'); // 6 (combining acute)
    commitFile('src/d.js', len(72)); // 72: not over
    commitFile('src/e.js', len(73, 'y')); // 73: over
    commitFile('src/f.js', 'line one\nline two\n\nbody text that is not the subject'); // git joins: "line one line two" = 17
    commitFile('src/g.js', '   padded', {}, ['--cleanup=verbatim']); // leading spaces kept by git, trimmed: 6
    git(repo, ['checkout', '-q', '-b', 'side']);
    commitFile('lib/side.js', 'side work'); // 9
    git(repo, ['checkout', '-q', 'main']);
    commitFile('src/h.js', 'main work'); // 9
    git(repo, ['merge', '-q', '--no-ff', 'side', '-m', len(90, 'm')], at(next())); // merge: excluded
    commitFile('docs/bob.md', len(100, 'b'), bob); // Bob, 100
    // Ada: [10, 9, 6, 72, 73, 17, 6, 9, 9]; everyone: + 100.
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, recap and wrapped.md for the whole history (merge left out, code points, trimmed)', () => {
    const out = join(root, 'all');
    const r = run([repo, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    // Sorted: 6 6 9 9 9 10 17 72 73 100 → median (9 + 10) / 2 = 9.5; over 72: 73 and 100.
    assert.equal(JSON.stringify(doc.stats.messages.subjectLength), '{"median":9.5,"over72":2,"share":0.2}');
    assert.match(r.stdout, /\n {2}Subjects {5}median 9\.5 chars · 2 commits over 72 \(20% of non-merge commits\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Subject length\n\nmedian 9\.5 characters; 2 commits over 72 characters \\\(20% of non-merge commits\\\)\n/);
    // The row is spare-room only and the e2e layout differs by platform (macOS fits one row less),
    // so the card is checked only when the row was drawn; unit tests above pin the row itself.
    const svg = messagesSvg(out);
    if (/>Subject length</.test(svg)) assert.match(svg, />(median )?9\.5 · 20%/);
    assertTextsInside(svg, 'e2e en');
  });

  test('--lang tr: "9,5" and the tr share style everywhere', () => {
    const out = join(root, 'tr');
    const r = run([repo, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Konu satırları\s+medyan 9,5 karakter · 2 commit 72 üstü \(merge dışı commit'lerin %20 kadarı\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Konu satırı uzunluğu\n\nmedyan 9,5 karakter; 2 commit 72 karakteri aşıyor \\\(merge dışı commit'lerin %20 kadarı\\\)\n/);
    // stats.json is language-independent.
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.subjectLength), '{"median":9.5,"over72":2,"share":0.2}');
    const svg = messagesSvg(out);
    if (/>Konu uzunluğu</.test(svg)) assert.match(svg, />(medyan )?9,5 · /);
    assertTextsInside(svg, 'e2e tr');
  });

  test('--author: only that author\'s non-merge commits', () => {
    const out = join(root, 'ada');
    const r = run([repo, '--out', out, '--json', '--author', 'ada@example.com']);
    assert.equal(r.status, 0, r.stderr);
    // Sorted: 6 6 9 9 9 10 17 72 73 → median 9; over 72: 1 of 9.
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.subjectLength), '{"median":9,"over72":1,"share":0.111}');
    assert.match(r.stdout, /Subjects {5}median 9 chars · 1 commit over 72 \(11% of non-merge commits\)\n/);
    const bobOut = join(root, 'bob');
    const b = run([repo, '--out', bobOut, '--json', '--author', 'BOB@example.com']);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(bobOut, 'stats.json'), 'utf8')).stats.messages.subjectLength), '{"median":100,"over72":1,"share":1}');
  });

  test('--exclude never changes it (commits still count even with every file excluded)', () => {
    const out = join(root, 'excl');
    const r = run([repo, '--out', out, '--json', '--exclude', 'src/', '--exclude', 'lib/', '--exclude', 'docs/']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.subjectLength), '{"median":9.5,"over72":2,"share":0.2}');
  });

  test('--since window: only the commits in it', () => {
    const out = join(root, 'since');
    // From 2026-03-08: side work (03-08), main work (03-09), merge (03-10, excluded), Bob (03-11).
    const r = run([repo, '--out', out, '--json', '--since', '2026-03-08', '--until', '2026-03-31']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.subjectLength), '{"median":9,"over72":1,"share":0.333}');
  });
});
