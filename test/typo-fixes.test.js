// Typo fixes (stats.messages.typos): non-merge commits whose subject mentions a typo /
// spelling fix, on the messages card (a row right after the fix / wip / oops row(s), in
// spare room only, else a segment on the "fix" row), the recap and wrapped.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { computeMessages, computeStats, isTypoFixSubject, shownTypos } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, typosShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (subject, i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 5 + i, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const history = (subjects, n = 40, extra = {}) => Array.from({ length: n }, (_, i) => commit(subjects[i % subjects.length], i, extra));
const PLAIN = ['add parser', 'fix the parser', 'wip on render', 'tidy render code'];
const WITH_TYPOS = [...PLAIN.slice(0, 3), 'fix typo in render'];
const opts = (lang = 'en') => ({ repoName: 'demo', today: TODAY, lang });
const cards = (stats, lang = 'en') => buildCards(stats, opts(lang)).map((c) => c.svg).join('\n');
const specs = (stats, lang = 'en') => buildCardSpecs(stats, opts(lang));
const messagesSpec = (stats, lang = 'en') => specs(stats, lang).find((c) => c.id === 'messages').spec;
/** stats with the typo fixes taken out, as a stats.json from before the stat. */
const withoutTypos = (stats) => {
  const { typos, ...messages } = stats.messages;
  return { ...stats, messages };
};

describe('isTypoFixSubject', () => {
  test('typo / typos / spelling(s) / misspell… / misspelt / yazım as whole words, any case', () => {
    const yes = [
      'fix typo', 'Fix typos in README', 'TYPO', 'typo', 'docs: Typo', 'fix: spelling', 'Spellings', 'SPELLING fixes',
      'misspell', 'Misspelled word', 'fix misspelling', 'misspellings', 'misspells', 'misspelt name',
      'Yazım hatası', 'yazım düzeltildi', 'YAZIM', 'yazim hatasi', 'YAZİM', 'Yazim', 'SPELLİNG', 'yazi\u0307m', 'TYPO.', 'fix typo.', 'typos.)', 'x.typo',
      'typo-fix', 'fix-typo', 'typo, spelling', "typo'yu düzelt", '(typo)', 'typo.', '"typo"', 'oops typo', '✨ typo',
    ];
    for (const s of yes) assert.equal(isTypoFixSubject(s), true, s);
  });

  test('not substrings or other words: typography, typology, retypo, spell, fix_typo, yazımı …', () => {
    const no = [
      'typography', 'Typology notes', 'retypo', 'typos2', '2typo', 'fix_typo', 'typo_fix', 'spell check', 'spelled out',
      'mis-spell', 'misspel', 'yazılım', 'test yazımı', 'yazımlar', 'typó', 'typó', 'add parser', '', '   ',
    ];
    for (const s of no) assert.equal(isTypoFixSubject(s), false, s);
  });

  test('paths, packages, files and domains do not count: a "/" before, a "/" or "." + letter / digit after', () => {
    const no = [
      'chore(deps): bump crate-ci/typos from 1.16 to 1.17', 'add typos.toml', 'link github.com/a/typo', 'see example.com/typo',
      'typo/spelling', 'docs/typo', 'typo/', 'misspell.v2', 'typo.2', 'typos.rs', 'spelling.md',
    ];
    for (const s of no) assert.equal(isTypoFixSubject(s), false, s);
    // A sentence-final "." (or one before punctuation / a space) still counts.
    for (const s of ['fix typo.', 'typo. Done', 'typo.)', 'typo...', 'typo./x']) assert.equal(isTypoFixSubject(s), true, s);
  });

  test('URLs and email addresses are cut first', () => {
    for (const s of ['see https://example.com/typo', 'link http://x.io/fix-typo#a', 'www.typo.com', 'docs: link https://x.io/spelling', 'typo@example.com', 'mail spelling@x.io']) {
      assert.equal(isTypoFixSubject(s), false, s);
    }
    assert.equal(isTypoFixSubject('fix typo in https://example.com/a'), true);
    assert.equal(isTypoFixSubject('https://example.com/a typo'), true);
  });

  test('NFD input is NFC-normalized: a decomposed "YAZİM" counts, a decomposed "typó" does not', () => {
    assert.equal(isTypoFixSubject('YAZİM'), true);
    assert.equal(isTypoFixSubject('typó'), false);
  });

  test('non-strings → false', () => {
    for (const s of [null, undefined, 42, {}, ['typo']]) assert.equal(isTypoFixSubject(s), false);
  });
});

describe('computeMessages: typos', () => {
  test('count and share of non-merge commits; each commit once', () => {
    const m = computeMessages([commit('typo typo spelling', 1), commit('fix typos', 2), commit('a', 3), commit('b', 4)]);
    assert.deepEqual(m.typos, { commits: 2, share: 0.5 });
  });

  test('merges are skipped (parents, else a merge subject); no typo fix → zeros', () => {
    const m = computeMessages([
      commit('Merge typo fixes', 1, { parents: ['p', 'q'] }),
      commit('typo', 2),
      commit('a', 3),
      { subject: "Merge branch 'typo'", date: '2026-03-01T10:00:00Z' },
    ]);
    assert.deepEqual(m.typos, { commits: 1, share: 0.5 });
    assert.deepEqual(computeMessages([commit('a', 1), commit('b', 2, { parents: ['p', 'q'] })]).typos, { commits: 0, share: 0 });
  });

  test('empty, null, merges only → {commits: 0, share: 0}', () => {
    for (const input of [[], null, undefined, [commit('typo', 1, { parents: ['p', 'q'] })]]) {
      assert.deepEqual(computeMessages(input).typos, { commits: 0, share: 0 });
    }
  });

  test('commits without a subject count in the denominator', () => {
    const m = computeMessages([commit('typo', 1), commit(undefined, 2), commit('', 3), commit(42, 4)]);
    assert.deepEqual(m.typos, { commits: 1, share: 0.25 });
  });

  test('share has 3 decimals, capped at 0.999 short of every commit; exactly 1 when all are', () => {
    const many = [...Array.from({ length: 2000 }, (_, i) => commit('fix typo', i)), commit('a', 9999)];
    assert.equal(computeMessages(many).typos.share, 0.999);
    assert.equal(computeMessages([commit('typo', 1)]).typos.share, 1);
    assert.equal(computeMessages([commit('typo', 1), commit('a', 2), commit('b', 3)]).typos.share, 0.333);
  });

  test('the fix / wip / oops counts are unchanged', () => {
    const subjects = ['fix typo', 'wip spelling', 'oops typo', 'add parser'];
    const m = computeMessages(subjects.map((s, i) => commit(s, i)));
    assert.deepEqual(m.counts, { fix: 1, wip: 1, oops: 1 });
    assert.deepEqual(m.typos, { commits: 3, share: 0.75 });
  });

  test('multi-repo histories add up', () => {
    const { commits } = mergeHistories([
      { label: 'a', commits: [commit('typo', 1), commit('x', 2)] },
      { label: 'b', commits: [commit('fix spelling', 3), commit('y', 4)] },
    ]);
    assert.deepEqual(computeMessages(commits).typos, { commits: 2, share: 0.5 });
  });

  test('stats.json keeps exactly {commits, share}, right after counts', () => {
    const stats = computeStats(history(WITH_TYPOS), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo' }));
    assert.deepEqual(doc.stats.messages.typos, { commits: 10, share: 0.25 });
    const keys = Object.keys(doc.stats.messages);
    assert.equal(keys[keys.indexOf('counts') + 1], 'typos');
    assert.deepEqual(Object.keys(doc.stats.messages.typos), ['commits', 'share']);
  });
});

describe('shownTypos', () => {
  test('null for older shapes and no typo fix; pct from the exact ratio, else from share', () => {
    for (const x of [undefined, null, 0, 'x', {}, { commits: 0, share: 0 }, { commits: -1, share: 0.1 }, { commits: NaN }]) assert.equal(shownTypos(x), null);
    assert.deepEqual(shownTypos({ commits: 4, share: 0.03 }), { commits: 4, pct: 3 });
    assert.deepEqual(shownTypos({ commits: 2.4, share: 2 }), { commits: 2, pct: 99.9 });
    assert.deepEqual(shownTypos({ commits: 1, share: 1 }), { commits: 1, pct: 100 });
    const exact = computeMessages([commit('typo', 1), commit('a', 2), commit('b', 3)]).typos;
    assert.ok(Math.abs(shownTypos(exact).pct - 100 / 3) < 1e-9);
  });

  test('typosShareText: whole percent, "<1%" for a tiny share, never 100% short of all', () => {
    assert.equal(typosShareText({ commits: 4, pct: 3.4 }), '3%');
    assert.equal(typosShareText({ commits: 1, pct: 0.1 }), '<1%');
    assert.equal(typosShareText({ commits: 999, pct: 99.9 }), '99%');
    assert.equal(typosShareText({ commits: 4, pct: 3.4 }, getStrings('tr')), '%3');
  });
});

describe('messages card', () => {
  test('without typo fixes, every card is as for a stats.json without the field', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    assert.deepEqual(stats.messages.typos, { commits: 0, share: 0 });
    for (const lang of ['en', 'tr']) assert.equal(cards(stats, lang), cards(withoutTypos(stats), lang));
  });

  test('a full card: the "fix" row gets a "· N typo" segment; every other card is unchanged', () => {
    const stats = computeStats(history(WITH_TYPOS), { today: TODAY });
    // tr: "· 10 yazım düz." would be cut, so the shorter "· 10 yazım".
    for (const [lang, word] of [['en', 'typos'], ['tr', 'yazım']]) {
      const before = specs(withoutTypos(stats), lang);
      const after = specs(stats, lang);
      const M = getStrings(lang).messages;
      const spec = after.find((c) => c.id === 'messages').spec;
      const old = before.find((c) => c.id === 'messages').spec;
      assert.equal(spec.lines.length, old.lines.length);
      assert.ok(!spec.lines.some((r) => r.label === M.typosTitle || r.label === M.typosShortTitle));
      const fix = spec.lines.find((r) => r.label === M.fixCommits);
      assert.equal(fix.value, `20 · 10 ${word}`);
      // Every other row is untouched, in place.
      spec.lines.forEach((r, i) => { if (r.label !== M.fixCommits) assert.deepEqual(r, old.lines[i]); });
      for (const [i, c] of after.entries()) if (c.id !== 'messages') assert.deepEqual(c.spec, before[i].spec, c.id);
    }
  });

  test('with spare room: a row right after the "oops" row, the rows after it kept', () => {
    // No files: no biggest-commit panel, so the card has room.
    const stats = computeStats([commit('fix typo', 1, { files: [] })], { today: TODAY });
    for (const [lang, title, value] of [['en', 'Typo fixes', '1 commit · 100%'], ['tr', 'Yazım düzeltmeleri', '1 · %100']]) {
      const M = getStrings(lang).messages;
      const old = messagesSpec(withoutTypos(stats), lang).lines;
      const lines = messagesSpec(stats, lang).lines;
      const at = lines.findIndex((r) => r.label === M.oopsCommits);
      assert.ok(at >= 0);
      assert.equal(lines[at + 1].label, title);
      assert.equal(lines[at + 1].value, value);
      assert.match(lines[at + 1].description, /1/);
      assert.deepEqual(lines.filter((_, i) => i !== at + 1), old);
      // The fix row itself has no segment then.
      assert.equal(lines.find((r) => r.label === M.fixCommits).value, '1');
    }
  });

  test('the row and the segment show up in the rendered SVG', () => {
    const roomy = computeStats([commit('fix typo', 1, { files: [] })], { today: TODAY });
    assert.match(cards(roomy), /Typo fixes/);
    const full = computeStats(history(WITH_TYPOS), { today: TODAY });
    assert.match(cards(full), /20 · 10 typos/);
    assert.match(cards(full, 'tr'), /20 · 10 yazım/);
  });

  test('a "· N fixup!" segment wins: no typo segment after it, even when it would fit', () => {
    for (const n of [4, 40]) {
      const stats = computeStats(history([...PLAIN.slice(0, 2), 'fixup! add parser', 'typo'], n), { today: TODAY });
      const fix = messagesSpec(stats).lines.find((r) => r.label === getStrings('en').messages.fixCommits);
      assert.equal(fix.value, `${n / 4} · ${n / 4} fixup!`);
      for (const lang of ['en', 'tr']) assert.equal(cards(stats, lang), cards(withoutTypos(stats), lang));
    }
  });

  test('singular / plural segment (en) and the longer Turkish form when it fits', () => {
    const stats = computeStats(history(['add parser', 'fix: typo', 'docs: readme', 'chore: x'], 4), { today: TODAY });
    assert.equal(messagesSpec(stats).lines.find((r) => r.label === getStrings('en').messages.fixCommits).value, '1 · 1 typo');
    assert.equal(messagesSpec(stats, 'tr').lines.find((r) => r.label === getStrings('tr').messages.fixCommits).value, '1 · 1 yazım düz.');
  });

  test('folded fix / wip / oops counters with room: the row goes right after the folded row', () => {
    // Conventional subjects bring the commit-type mix, which folds the counters; without
    // the subject length row (lower priority than every row but the typo fixes) the
    // Turkish card has one row of room left.
    const s0 = computeStats(history(['feat: a', 'fix: typo'], 4), { today: TODAY });
    const stats = { ...s0, messages: { ...s0.messages, subjectLength: null, topWords: [] } };
    const M = getStrings('tr').messages;
    const lines = messagesSpec(stats, 'tr').lines;
    const old = messagesSpec(withoutTypos(stats), 'tr').lines;
    const at = lines.findIndex((r) => r.label === M.counterCommits);
    assert.ok(at >= 0, JSON.stringify(lines));
    assert.equal(lines[at + 1].label, 'Yazım düzeltmeleri');
    assert.equal(lines[at + 1].value, '2 · %50');
    assert.equal(lines[at + 1].description, "2 commit yazım hatası düzeltiyor (merge dışı commit'lerin %50 kadarı)");
    assert.deepEqual(lines.filter((_, i) => i !== at + 1), old);
    assert.deepEqual(messagesSpec(stats, 'tr').chart, messagesSpec(withoutTypos(stats), 'tr').chart);
  });

  test('a segment that would be cut is left off', () => {
    // 1,234 "fix" commits: "1,234 · 400 yazım" is too long for the Turkish row.
    const subjects = [...Array.from({ length: 834 }, () => 'fix parser'), ...Array.from({ length: 400 }, () => 'fix typo'), 'add parser', 'wip'];
    const stats = computeStats(subjects.map((s, i) => commit(s, i)), { today: TODAY });
    const M = getStrings('tr').messages;
    const fix = messagesSpec(stats, 'tr').lines.find((r) => r.label === M.fixCommits);
    assert.equal(fix.value, '1.234');
    assert.equal(cards(stats, 'tr'), cards(withoutTypos(stats), 'tr'));
  });

  test('folded fix / wip / oops counters (no room for a row): the card is byte-identical to the no-typo card', () => {
    // Conventional subjects bring the commit-type mix, which folds the counters into one row.
    const subjects = ['feat: add parser', 'fix: typo', 'docs: spelling', 'chore: x', 'feat(y): z'];
    const stats = computeStats(history(subjects), { today: TODAY });
    assert.deepEqual(stats.messages.typos, { commits: 16, share: 0.4 });
    const M = getStrings('en').messages;
    assert.ok(messagesSpec(stats).lines.some((r) => r.label === M.counterCommits));
    for (const lang of ['en', 'tr']) assert.equal(cards(stats, lang), cards(withoutTypos(stats), lang));
  });

  test('an old stats.json without the field, or junk in it, renders as before', () => {
    const stats = computeStats(history(WITH_TYPOS), { today: TODAY });
    const base = cards(withoutTypos(stats));
    for (const typos of [null, 'x', 7, { commits: 0, share: 0 }, { commits: 'x' }]) {
      assert.equal(cards({ ...stats, messages: { ...stats.messages, typos } }), base);
    }
  });
});

describe('recap and wrapped.md', () => {
  test('a "Typo fixes" line / section, en and tr', () => {
    const stats = computeStats(history(WITH_TYPOS), { today: TODAY });
    const recap = formatSummary(stats, { lang: 'en' });
    assert.match(recap, /\n {2}Typo fixes {3}10 commits \(25% of non-merge commits\)\n/);
    const recapTr = formatSummary(stats, { lang: 'tr' });
    assert.match(recapTr, /\n {2}Yazım düzeltme {3}10 commit \(merge dışı commit'lerin %25 kadarı\)\n/);
    // After the fixups line, before the subject length line.
    const lines = recap.split('\n');
    assert.ok(lines.findIndex((l) => l.includes('Typo fixes')) < lines.findIndex((l) => l.includes('Subjects')));

    const md = buildMarkdown(stats, opts('en'));
    assert.match(md, /## Typo fixes\n\n10 commits \\\(25% of non-merge commits\\\)\n/);
    const mdTr = buildMarkdown(stats, opts('tr'));
    assert.match(mdTr, /## Yazım düzeltmeleri\n\n10 commit \\\(merge dışı commit'lerin %25 kadarı\\\)\n/);
  });

  test('hidden without typo fixes, and for an old stats.json', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      assert.doesNotMatch(formatSummary(stats, { lang }), /Typo fixes|Yazım düzeltme/);
      assert.doesNotMatch(buildMarkdown(stats, opts(lang)), /Typo fixes|Yazım düzeltmeleri/);
      assert.equal(formatSummary(stats, { lang }), formatSummary(withoutTypos(stats), { lang }));
      assert.equal(buildMarkdown(stats, opts(lang)), buildMarkdown(withoutTypos(stats), opts(lang)));
    }
  });

  test('a tiny share reads "<1%"', () => {
    const stats = computeStats([commit('typo', 0), ...Array.from({ length: 300 }, (_, i) => commit('add parser', i + 1))], { today: TODAY });
    assert.match(formatSummary(stats, { lang: 'en' }), /Typo fixes {3}1 commit \(<1% of non-merge commits\)/);
    assert.match(buildMarkdown(stats, opts('en')), /## Typo fixes\n\n1 commit \\\(\\<1% of non-merge commits\\\)\n/);
  });
});

describe('strings', () => {
  test('en and tr have every typo string', () => {
    for (const lang of ['en', 'tr']) {
      const L = getStrings(lang);
      for (const k of ['typosTitle', 'typosShortTitle', 'typosValue', 'typosShort', 'typosSegment', 'typosDescription']) assert.ok(L.messages[k], `${lang} messages.${k}`);
      assert.equal(typeof L.recap.typos, 'string');
      assert.equal(typeof L.markdown.typos, 'string');
      assert.ok(L.recap.typos.length < L.recap.labelWidth, `${lang} recap label fits the column`);
    }
    assert.equal(getStrings('en').messages.typosDescription(1, '3%'), '1 commit fixes a typo or spelling mistake (3% of non-merge commits)');
    assert.equal(getStrings('en').messages.typosDescription(4, '3%'), '4 commits fix a typo or spelling mistake (3% of non-merge commits)');
  });
});
