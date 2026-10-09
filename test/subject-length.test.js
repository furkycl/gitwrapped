import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeMessages, computeStats, shownSubjectLength, SUBJECT_LIMIT } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard, subjectLengthShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { rowFits } from '../src/cards/svg.js';

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
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === 'messages').spec;
const svgs = (stats, lang = 'en') => buildCards(stats, cardOpts(lang)).map((c) => [c.id, c.svg]);
const without = (s) => ({ ...s, messages: { ...s.messages, subjectLength: null } });
const isRow = (r, L = en) => r?.label === L.messages.subjectLengthTitle;

describe('computeMessages: subjectLength', () => {
  test('median of trimmed code-point lengths: the middle one, or the mean of the two middle ones', () => {
    assert.equal(sl(['a', 'bbb', 'cc']).median, 2);
    assert.equal(sl(['a', 'bbbb', 'cc', 'ddddd']).median, 3); // (2 + 4) / 2
    assert.equal(sl(['a', 'bb']).median, 1.5);
    assert.equal(sl(['  padded  ', '\tx\t']).median, 3.5); // 6 and 1
    assert.equal(sl(['🎉🎉', 'é']).median, 1.5); // code points, not UTF-16 units
  });

  test('over72: strictly longer than 72 code points; share like fixups (3 decimals, ≤ 0.999 unless all)', () => {
    assert.equal(SUBJECT_LIMIT, 72);
    assert.deepEqual(sl([len(72), len(73), 'a', 'b']), { median: 36.5, over72: 1, share: 0.25 });
    assert.deepEqual(sl([`  ${len(72)}  `]), { median: 72, over72: 0, share: 0 });
    assert.deepEqual(sl([len(80), len(100)]), { median: 90, over72: 2, share: 1 });
    const many = [len(80), ...Array.from({ length: 1999 }, () => 'x')];
    assert.equal(sl(many).share, 0.001);
    const almost = [...Array.from({ length: 1999 }, () => len(80)), 'x'];
    assert.equal(sl(almost).share, 0.999);
  });

  test('merges are skipped; a non-merge commit without a subject counts as length 0; null without any non-merge commit', () => {
    const m = computeMessages([commit(len(90), 1, { parents: ['a', 'b'] }), commit('abc', 2), commit(undefined, 3)]);
    assert.deepEqual(m.subjectLength, { median: 1.5, over72: 0, share: 0 });
    assert.equal(computeMessages([]).subjectLength, null);
    assert.equal(computeMessages(null).subjectLength, null);
    assert.equal(computeMessages([commit('Merge branch x', 1, { parents: ['a', 'b'] })]).subjectLength, null);
  });

  test('measured as written (not email-scrubbed); the exact share is not enumerable', () => {
    const s = sl([`ping ${'a'.repeat(70)}@example.com`, 'b', 'c']);
    assert.equal(s.over72, 1);
    assert.deepEqual(Object.keys(s), ['median', 'over72', 'share']);
    assert.equal(JSON.stringify(s), '{"median":1,"over72":1,"share":0.333}');
  });
});

describe('shownSubjectLength', () => {
  test('median as stored, whole over72, pct from the exact ratio else from share', () => {
    assert.deepEqual(shownSubjectLength(sl([len(80), 'a', 'b'])), { median: 1, over72: 1, pct: (1 / 3) * 100 });
    assert.deepEqual(shownSubjectLength({ median: 40.5, over72: 2, share: 0.25 }), { median: 40.5, over72: 2, pct: 25 });
    assert.deepEqual(shownSubjectLength({ median: 40, over72: 0, share: 0 }), { median: 40, over72: 0, pct: 0 });
    assert.equal(shownSubjectLength({ median: 40, over72: 3, share: 0.9999 }).pct, 0.999 * 100);
    assert.equal(shownSubjectLength({ median: 40, over72: 3, share: 1 }).pct, 100);
  });

  test('null for anything that is not a usable stat', () => {
    for (const v of [null, undefined, 'x', 42, {}, { median: -1 }, { median: NaN }, { median: '40' }]) {
      assert.equal(shownSubjectLength(v), null, JSON.stringify(v));
    }
    assert.deepEqual(shownSubjectLength({ median: 3, over72: 'x' }), { median: 3, over72: 0, pct: 0 });
  });

  test('share text: "<1%" for a tiny share with any, never 100% short of all', () => {
    assert.equal(subjectLengthShareText({ over72: 1, pct: 0.01 }), '<1%');
    assert.equal(subjectLengthShareText({ over72: 9, pct: 99.9 }), '99%');
    assert.equal(subjectLengthShareText({ over72: 9, pct: 100 }), '100%');
    assert.equal(subjectLengthShareText({ over72: 2, pct: 25 }, tr), '%25');
  });
});

describe('stats and stats.json', () => {
  test('stats.messages.subjectLength comes after fixups (only bodies and topWords after it); stats.json keeps {median, over72, share}', () => {
    const s = statsOf(['add parser', len(80), 'tidy']);
    assert.deepEqual(Object.keys(s.messages), ['shortest', 'longest', 'topWord', 'counts', 'typos', 'averageLength', 'fixups', 'subjectLength', 'bodies', 'topWords']);
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo' }));
    assert.deepEqual(doc.stats.messages.subjectLength, { median: 10, over72: 1, share: 0.333 });
    const none = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' }));
    assert.equal(none.stats.messages.subjectLength, null);
  });
});

describe('cards', () => {
  // Build output only (dist/ is ignored like the hot files): no biggest-commit panel, so
  // the messages card has spare room for the row as it is.
  const roomyOf = (subjects, files = (i) => [`dist/${i}.js`]) => computeStats(subjects.map((t, i) => ({ ...commit(t, i + 1), files: files(i).map((path) => ({ path, added: 3, removed: 1 })) })), { today: TODAY });
  const LONG = ['add parser', 'tidy', 'more stuff', len(75, 'y')];

  test('a "Subject length" row last on the messages card when there is room, en and tr', () => {
    const s = roomyOf(LONG);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const spec = messagesSpec(s, lang);
      const row = spec.lines.at(-1);
      assert.ok(isRow(row, L), `${lang}: ${JSON.stringify(spec.lines)}`);
      assert.ok(spec.lines.length <= 6);
      assert.match(row.value, lang === 'en' ? /^10 · 25% over 72$/ : /^10 · 72 üstü %25$/);
    }
    assert.match(cardDescription(messagesSpec(s)), /Median subject length: 10 characters; 1 commit over 72 characters \(25% of non-merge commits\)/);
    assert.match(cardDescription(messagesSpec(s, 'tr')), /Medyan konu satırı uzunluğu: 10 karakter; 1 commit 72 karakteri aşıyor \(merge dışı commit'lerin %25 kadarı\)/);
  });

  test('without long subjects the value is just the median', () => {
    const s = roomyOf(['add parser', 'tidy', 'more stuff']);
    assert.equal(messagesSpec(s).lines.at(-1).value, 'median 10');
    assert.equal(messagesSpec(s, 'tr').lines.at(-1).value, 'medyan 10');
    assert.equal(messagesSpec({ ...s, messages: { ...s.messages, subjectLength: { median: 10.5, over72: 0, share: 0 } } }, 'tr').lines.at(-1).value, 'medyan 10,5');
  });

  test('null, missing or malformed stat: every card byte-identical to a run without it', () => {
    const s = roomyOf(LONG);
    for (const lang of ['en', 'tr']) {
      const ref = svgs(without(s), lang);
      assert.notDeepEqual(svgs(s, lang), ref);
      for (const subjectLength of [undefined, 'x', { median: -3 }, {}]) {
        assert.deepEqual(svgs({ ...s, messages: { ...s.messages, subjectLength } }, lang), ref, JSON.stringify(subjectLength));
      }
    }
  });

  test('append-only: only the messages card changes, and only by the row at its end', () => {
    for (const s of [roomyOf(LONG), roomyOf(['x']), statsOf(LONG)]) {
      for (const lang of ['en', 'tr']) {
        const a = svgs(s, lang);
        const b = svgs(without(s), lang);
        for (const [i, [id, svg]] of a.entries()) if (id !== 'messages') assert.equal(svg, b[i][1], id);
        const spec = messagesSpec(s, lang);
        const base = messagesSpec(without(s), lang);
        if (!isRow(spec.lines.at(-1), LANGS[lang])) {
          assert.deepEqual(spec, base);
          continue;
        }
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
  });

  test('when only folding the fix / wip / oops counters would make room: no row, the card byte-identical', () => {
    // Five rows and the biggest-commit panel: appending the row does not fit as the card
    // is, but it would with the counters folded into one row.
    const s = statsOf(LONG);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const base = messagesSpec(without(s), lang);
      assert.equal(base.lines.length, 5);
      const row = { label: L.messages.subjectLengthTitle, value: L.messages.subjectLengthShort(10, 1, L.pct(25)) };
      const appended = layoutCard({ ...base, lines: [...base.lines, row], lang });
      const folded = layoutCard({ ...base, lines: [...base.lines.slice(0, 2), { label: L.messages.counterCommits, value: '0 / 0 / 0' }, row], lang });
      const ref = layoutCard({ ...base, lang });
      const fits = (l) => l.drawnCharts.length === ref.drawnCharts.length && l.shrinkSteps <= ref.shrinkSteps;
      assert.ok(!fits(appended), lang);
      assert.ok(fits(folded), lang);
      assert.ok(!messagesSpec(s, lang).lines.some((r) => isRow(r, L)), lang);
      assert.deepEqual(svgs(s, lang), svgs(without(s), lang), lang);
    }
  });

  test('with issue refs and dependency bumps: they keep their places, the row comes after them', () => {
    // A full totals card (three contributors, pairing, born / buried files, merges) sends
    // the dependency-bumps row to the messages card when it has room there.
    const full = (st) => ({ ...st, fileLifecycle: { added: 3, deleted: 1 }, merges: { commits: 2, share: 0.3, pullRequests: 0 }, coAuthors: { paired: 3, total: 4, share: 0.5, top: 'Bo', coAuthors: [] }, totals: { ...st.totals, authors: 3 } });
    const files = (i) => [i === 1 ? 'package.json' : `dist/${i}.js`];
    const seen = { issueRefs: 0, depBumps: 0 };
    for (const subjects of [['#1'], ['add', 'add'], ['add #12', 'add #12'], ['a #12', 'b #12', 'c'], ['add parser #12', len(80)]]) {
      const s = full(roomyOf(subjects, files));
      assert.ok(s.issueRefs || s.depBumps);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const spec = messagesSpec(s, lang);
        const base = messagesSpec(without(s), lang);
        const has = isRow(spec.lines.at(-1), L);
        assert.deepEqual(has ? spec.lines.slice(0, -1) : spec.lines, base.lines, `${subjects} ${lang}`);
        if (!has) continue;
        const labels = spec.lines.map((r) => r.label);
        const issue = labels.findIndex((x) => x.startsWith(L.messages.issueRefsTitle(null, 0)));
        const dep = labels.findIndex((x) => x === L.totals.depBumps || x === L.totals.depBumpsLabelShort);
        if (issue >= 0) seen.issueRefs += 1;
        if (dep >= 0) seen.depBumps += 1;
        if (issue >= 0 && dep >= 0) assert.ok(issue < dep);
        assert.ok(spec.lines.length <= 6);
      }
    }
    assert.ok(seen.issueRefs > 0 && seen.depBumps > 0, JSON.stringify(seen));
  });

  test('empty history: no row', () => {
    const s = computeStats([], { today: TODAY });
    const spec = messagesSpec({ ...s, messages: { ...s.messages, subjectLength: { median: 4, over72: 1, share: 0.5 } } });
    assert.ok(!(spec.lines ?? []).some((r) => isRow(r)));
  });
});

describe('recap and wrapped.md', () => {
  test('recap "Subjects" line after the fixups, en and tr; none without the stat', () => {
    const s = statsOf(['add parser', 'tidy', 'more stuff', len(75, 'y')]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Subjects {5}median 10 chars · 1 commit over 72 \(25% of non-merge commits\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Konu satırları\s+medyan 10 karakter · 1 commit 72 üstü \(merge dışı commit'lerin %25 kadarı\)\n/);
    const short = statsOf(['add parser', 'tidy', 'more stuff']);
    assert.match(formatSummary(short, { repoName: 'demo', today: TODAY }), /\n {2}Subjects {5}median 10 chars · none over 72\n/);
    const withFixup = statsOf(['add parser', 'fixup! add parser', 'more stuff']);
    assert.match(formatSummary(withFixup, { repoName: 'demo', today: TODAY }), /\n {2}Fixups.*\n {2}Subjects /);
    assert.doesNotMatch(formatSummary(without(s), { repoName: 'demo', today: TODAY }), /Subjects/);
  });

  test('wrapped.md "Subject length" section, en and tr; none without the stat', () => {
    const s = statsOf(['add parser', 'tidy', 'more stuff', len(75, 'y')]);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Subject length\n\nmedian 10 characters; 1 commit over 72 characters \\\(25% of non-merge commits\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Konu satırı uzunluğu\n\nmedyan 10 karakter; 1 commit 72 karakteri aşıyor \\\(merge dışı commit'lerin %25 kadarı\\\)\n/);
    assert.match(buildMarkdown(statsOf(['ab', 'abcd']), { repoName: 'demo', today: TODAY }), /## Subject length\n\nmedian 3 characters; none over 72 characters\n/);
    assert.doesNotMatch(buildMarkdown(without(s), { repoName: 'demo', today: TODAY }), /Subject length/);
  });

  test('a median of exactly 1 is singular in English; the Turkish share never sits next to "72"', () => {
    assert.equal(en.recap.subjectLengthValue(1, 0), 'median 1 char · none over 72');
    assert.equal(en.markdown.subjectLengthValue(1, 1), 'median 1 character; 1 commit over 72 characters');
    assert.equal(en.messages.subjectLengthDescription(1, 0, '0%'), 'Median subject length: 1 character; no commit over 72 characters');
    assert.equal(en.recap.subjectLengthValue(1.5, 0), 'median 1.5 chars · none over 72');
    assert.equal(tr.messages.subjectLengthValue(48, 3, '%12'), '48 · 72 üstü %12');
    assert.equal(tr.messages.subjectLengthShort(48, 3, '%12'), '48 · >72: %12');
  });

  test('the long form with a share over 72 is drawn whole for typical medians and shares (en, tr)', () => {
    for (const median of [1, 9.5, 48, 72.5]) {
      for (const share of [0.4, 12, 99]) {
        for (const L of [en, tr]) {
          const pct = subjectLengthShareText({ pct: share, over72: 1 }, L);
          const row = { label: L.messages.subjectLengthTitle, value: L.messages.subjectLengthValue(median, 1, pct) };
          assert.ok(rowFits(row), JSON.stringify(row));
        }
      }
    }
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.messages.subjectLengthTitle, 'string');
      for (const k of ['subjectLengthValue', 'subjectLengthShort', 'subjectLengthDescription']) {
        assert.equal(typeof L.messages[k](40.5, 3, '5%'), 'string', k);
        assert.equal(typeof L.messages[k](40, 0, '0%'), 'string', k);
      }
      assert.ok(L.recap.subjects.length < L.recap.labelWidth);
      assert.equal(typeof L.recap.subjectLengthValue(40, 2), 'string');
      assert.equal(typeof L.markdown.subjectLength, 'string');
      assert.equal(typeof L.markdown.subjectLengthValue(40, 0), 'string');
    }
  });
});
