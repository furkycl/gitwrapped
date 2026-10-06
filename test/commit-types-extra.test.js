// Extra edge cases for the conventional-commit mix (src/stats/types.js, the messages card's
// stacked bar, the recap line, wrapped.md, stats.json) written by the tester of loop turn 045.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { COMMIT_TYPE_IDS, commitTypeOf, computeCommitTypes, computeStats, foldCommitTypes, shownCommitTypes } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, COLOR_THEME_NAMES, conventionalText } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, measureText } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';
import { run } from '../src/cli.js';

const TODAY = '2026-10-05';

let n = 0;
function commit(subject, extra = {}) {
  n += 1;
  const day = String((n % 28) + 1).padStart(2, '0');
  return {
    hash: `x${n}`, author: 'A', email: 'a@x', date: `2026-09-${day}T10:00:00Z`, subject, parents: ['p'],
    files: [{ path: 'src/app.js', added: 3, removed: 1 }], filesChanged: 1, linesAdded: 3, linesRemoved: 1, ...extra,
  };
}
const many = (subject, count) => Array.from({ length: count }, () => commit(subject));

/** A seeded PRNG (mulberry32) so the property tests are deterministic. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const messagesSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'messages').spec;
const messagesCard = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'messages');
const charts = (spec) => (Array.isArray(spec.chart) ? spec.chart : spec.chart ? [spec.chart] : []);

function assertLayoutOk(spec, label) {
  const layout = layoutCard(spec);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
  }
  return layout;
}

/**
 * The text items (value / label) drawn under an inline stack bar, as {x, size, text, right}:
 * every text element after the "COMMIT TYPES" caption inside the stack block.
 */
function inlineItems(blockSvg) {
  return [...blockSvg.matchAll(/<g><title>[^<]*<\/title><rect[^>]*\/>((?:<text[^>]*>[^<]*<\/text>)+)<\/g>/g)].map((m) => {
    const texts = [...m[1].matchAll(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((t) => ({ x: Number(t[1]), size: Number(t[2]), text: t[3] }));
    const last = texts.at(-1);
    const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return { texts, right: last.x + measureText(unescape(last.text), last.size) * 1.02 };
  });
}

// --- the subject parser -------------------------------------------------------------------------

describe('commitTypeOf (extra)', () => {
  test('mixed case types and aliases, any case of scope', () => {
    assert.equal(commitTypeOf('FeAt!: x'), 'feat');
    assert.equal(commitTypeOf('Hotfix(Prod)!: down'), 'fix');
    assert.equal(commitTypeOf('FEATURES(UI): x'), 'feat');
    assert.equal(commitTypeOf('DOC: x'), 'docs');
    assert.equal(commitTypeOf('Tests(e2e): x'), 'test');
    assert.equal(commitTypeOf('CI: x'), 'other');
    assert.equal(commitTypeOf('Revert: x'), 'other');
  });

  test('scopes: spaces, punctuation, unicode, dependabot style', () => {
    assert.equal(commitTypeOf('feat(my scope): x'), 'feat');
    assert.equal(commitTypeOf('chore(deps-dev): bump vitest from 1.2 to 1.3'), 'chore');
    assert.equal(commitTypeOf('fix(#12): y'), 'fix');
    assert.equal(commitTypeOf('feat(çekirdek): x'), 'feat');
    assert.equal(commitTypeOf('build(a/b, c.d): x'), 'other');
  });

  test('nested / unbalanced parens, misplaced "!" or space are not conventional', () => {
    for (const s of ['feat(a(b)): x', 'feat((a)): x', 'feat(a)): x', 'feat!(ui): x', 'feat(ui) : x', 'feat :x', 'feat ! : x', 'feat(ui)!:x', 'feat: \t ', 'feat:  ']) {
      assert.equal(commitTypeOf(s), null, JSON.stringify(s));
    }
  });

  test('whitespace after the colon: tabs and several spaces are fine; leading tabs / newlines trimmed', () => {
    assert.equal(commitTypeOf('feat:\tx'), 'feat');
    assert.equal(commitTypeOf('fix:   spaced'), 'fix');
    assert.equal(commitTypeOf('\t\nfeat: x'), 'feat');
    assert.equal(commitTypeOf('feat: 🎉'), 'feat');
    assert.equal(commitTypeOf('feat: x '), 'feat');
  });

  test('git-generated and look-alike subjects are not conventional', () => {
    for (const s of ['Revert "feat: x"', 'fixup! feat: x', 'squash! fix: y', 'amend! docs: z', 'Merge pull request #1 from a/feat', "Merge branch 'feat: x'", 'feat/login: x', 'feat-x: y', 'feat_x: y', '[feat]: y', 'feat1: x', 'refactoring: x', 'fixes: x', 'chores: x', 'Feat. x', 'Feat - x', 'Initial commit', 'v1.2.0']) {
      assert.equal(commitTypeOf(s), null, JSON.stringify(s));
    }
  });

  test('a very long subject is still parsed (and quickly)', () => {
    const t0 = Date.now();
    assert.equal(commitTypeOf(`feat(${'s'.repeat(5000)}): ${'x'.repeat(100000)}`), 'feat');
    assert.equal(commitTypeOf(`feat(${'('.repeat(5000)}`), null);
    assert.equal(commitTypeOf('feat'.repeat(20000)), null);
    assert.ok(Date.now() - t0 < 1000);
  });

  test('every bucket id is a result of some subject; no unknown bucket', () => {
    const seen = new Set(['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'perf', 'ci', 'build', 'style', 'revert', 'release', 'deps', 'feature', 'features', 'bugfix', 'hotfix', 'doc', 'tests'].map((t) => commitTypeOf(`${t}: x`)));
    assert.deepEqual([...seen].sort(), [...COMMIT_TYPE_IDS].sort());
  });
});

// --- computeCommitTypes -------------------------------------------------------------------------

describe('computeCommitTypes (extra)', () => {
  test('merges are excluded by parents and, without parents, by a "Merge ..." subject', () => {
    const t = computeCommitTypes([
      commit('feat: real'),
      commit('feat: octopus', { parents: ['a', 'b', 'c'] }),
      { subject: "Merge branch 'feat: x'" },
      { subject: 'fix: no parents field' },
    ]);
    assert.equal(t.total, 2);
    assert.equal(t.conventional, 2);
    assert.deepEqual([t.counts.feat, t.counts.fix], [1, 1]);
  });

  test('threshold boundary at larger totals: 20/100 shown, 19/100 not, 1/5 shown, 2/11 not', () => {
    const mk = (conv, plain) => computeCommitTypes([...many('feat: a', conv), ...many('plain words', plain)]);
    assert.equal(mk(20, 80).shown, true);
    assert.equal(mk(20, 80).share, 0.2);
    assert.equal(mk(19, 81).shown, false);
    assert.equal(mk(19, 81).share, 0.19);
    assert.equal(mk(3, 12).shown, true);
    assert.equal(mk(7, 28).shown, true);
    assert.equal(mk(2, 9).shown, false);
    // 199 / 1000 rounds to 0.199 and stays hidden; 200 / 1000 is shown.
    assert.equal(mk(199, 801).shown, false);
    assert.equal(mk(200, 800).shown, true);
    // shownCommitTypes agrees with `shown` at the boundary.
    assert.notEqual(shownCommitTypes(mk(20, 80)), null);
    assert.equal(shownCommitTypes(mk(19, 81)), null);
  });

  test('merges and empty subjects do not count toward the threshold denominator', () => {
    // 1 conventional + 4 plain = exactly 20%; the 10 merges and 5 blank subjects are ignored.
    const t = computeCommitTypes([
      commit('feat: a'), ...many('plain', 4),
      ...Array.from({ length: 10 }, () => commit('Merge stuff', { parents: ['a', 'b'] })),
      ...many('   ', 5),
    ]);
    assert.equal(t.total, 5);
    assert.equal(t.shown, true);
  });

  test('random histories: counts add up, shares sum to 100, each bucket matches commitTypeOf', () => {
    const rnd = prng(45);
    const SUBJECTS = ['feat: a', 'FIX(x): b', 'docs!: c', 'refactor: d', 'test: e', 'chore(deps): f', 'perf: g', 'ci: h', 'hotfix: i', 'random words', 'WIP', 'Update: x', '', 'feat:nospace'];
    for (let round = 0; round < 300; round++) {
      const commits = [];
      const expected = Object.fromEntries(COMMIT_TYPE_IDS.map((id) => [id, 0]));
      let total = 0;
      for (let i = Math.floor(rnd() * 40); i > 0; i--) {
        const subject = SUBJECTS[Math.floor(rnd() * SUBJECTS.length)];
        const merge = rnd() < 0.1;
        commits.push(commit(subject, merge ? { parents: ['a', 'b'] } : {}));
        if (merge || !subject.trim()) continue;
        total += 1;
        const type = commitTypeOf(subject);
        if (type) expected[type] += 1;
      }
      const t = computeCommitTypes(commits);
      const label = `round ${round}`;
      assert.deepEqual(t.counts, expected, label);
      assert.equal(t.total, total, label);
      const conventional = Object.values(expected).reduce((a, b) => a + b, 0);
      assert.equal(t.conventional, conventional, label);
      assert.equal(Object.values(t.shares).reduce((a, b) => a + b, 0), conventional > 0 ? 100 : 0, label);
      for (const id of COMMIT_TYPE_IDS) {
        if (t.counts[id] === 0) assert.equal(t.shares[id], 0, `${label}: empty bucket 0%`);
        else assert.ok(Math.abs(t.shares[id] - (t.counts[id] / conventional) * 100) < 1, `${label}: ${id} within 1 of exact`);
      }
      // top is the max count, earliest in bucket order on ties.
      const max = Math.max(...Object.values(t.counts));
      assert.equal(t.top, max > 0 ? COMMIT_TYPE_IDS.find((id) => t.counts[id] === max) : null, label);
      assert.equal(t.shown, conventional > 0 && conventional / total >= 0.2, label);
      // shownCommitTypes: null exactly when not shown; rows sum to 100 with other last.
      const mix = shownCommitTypes(t);
      assert.equal(mix !== null, t.shown, label);
      if (mix) {
        assert.equal(mix.rows.reduce((a, r) => a + r.share, 0), 100, label);
        const otherAt = mix.rows.findIndex((r) => r.id === 'other');
        if (otherAt >= 0) assert.equal(otherAt, mix.rows.length - 1, `${label}: other last`);
        for (let k = 1; k < mix.rows.length; k++) {
          if (mix.rows[k].id !== 'other') assert.ok(mix.rows[k - 1].count >= mix.rows[k].count, `${label}: rows by count`);
        }
      }
    }
  });

  test('top ties: feat beats every other bucket, other loses every tie', () => {
    for (const id of COMMIT_TYPE_IDS.slice(1)) {
      const subject = id === 'other' ? 'perf: x' : `${id}: x`;
      assert.equal(computeCommitTypes([commit(subject), commit('feat: y')]).top, 'feat', id);
    }
    for (const id of COMMIT_TYPE_IDS.slice(0, -1)) {
      assert.equal(computeCommitTypes([commit('ci: x'), commit(`${id}: y`)]).top, id, id);
    }
    // A strict majority beats bucket order.
    assert.equal(computeCommitTypes([...many('chore: x', 3), ...many('feat: y', 2)]).top, 'chore');
  });

  test('computeStats with no commits: commitTypes empty and hidden', () => {
    const s = computeStats([], { today: TODAY });
    assert.equal(s.commitTypes.total, 0);
    assert.equal(s.commitTypes.shown, false);
    assert.equal(shownCommitTypes(s.commitTypes), null);
  });
});

// --- shownCommitTypes / foldCommitTypes / conventionalText ----------------------------------------

describe('shownCommitTypes (extra): hand-edited stats.json', () => {
  test('ignores the stored shown flag and shares; recomputes from counts', () => {
    const mix = shownCommitTypes({ total: 10, counts: { feat: 3 }, shown: false, shares: { feat: 7 } });
    assert.deepEqual(mix, { conventional: 3, total: 10, rows: [{ id: 'feat', count: 3, share: 100 }] });
    assert.equal(shownCommitTypes({ total: 100, counts: { feat: 3 }, shown: true }), null);
  });

  test('total smaller than the counts, missing, or junk: treated as all conventional', () => {
    for (const total of [1, 0, -5, undefined, 'x', Number.NaN, Infinity]) {
      const mix = shownCommitTypes({ total, counts: { fix: 2, docs: 2 } });
      assert.equal(mix.total, 4, String(total));
      assert.deepEqual(mix.rows.map((r) => r.id), ['fix', 'docs']);
    }
  });

  test('junk counts: strings, fractions, unknown ids, arrays', () => {
    assert.equal(shownCommitTypes({ counts: { feat: '5' } }), null);
    assert.equal(shownCommitTypes({ counts: { bogus: 5 } }), null);
    assert.equal(shownCommitTypes({ counts: [5, 5] }), null);
    assert.equal(shownCommitTypes('nope'), null);
    assert.equal(shownCommitTypes([]), null);
    const mix = shownCommitTypes({ counts: { feat: 2.6, fix: 0.4 } });
    assert.deepEqual(mix.rows, [{ id: 'feat', count: 3, share: 100 }]);
  });

  test('other is last even when it is the biggest; ties keep bucket order', () => {
    const mix = shownCommitTypes({ total: 20, counts: { other: 9, chore: 2, docs: 2, feat: 1 } });
    assert.deepEqual(mix.rows.map((r) => r.id), ['docs', 'chore', 'feat', 'other']);
    assert.equal(mix.rows.reduce((a, r) => a + r.share, 0), 100);
  });
});

describe('foldCommitTypes (extra)', () => {
  test('folding never changes the share total and keeps at most max rows', () => {
    const rnd = prng(9);
    for (let i = 0; i < 200; i++) {
      const counts = Object.fromEntries(COMMIT_TYPE_IDS.map((id) => [id, rnd() < 0.4 ? 0 : 1 + Math.floor(rnd() * 50)]));
      const mix = shownCommitTypes({ counts });
      if (!mix) continue;
      for (const max of [2, 3, 4, 5]) {
        const rows = foldCommitTypes(mix.rows, max);
        assert.ok(rows.length <= Math.max(max, 1), JSON.stringify(counts));
        assert.equal(rows.reduce((a, r) => a + r.share, 0), 100, JSON.stringify(counts));
        assert.equal(rows.reduce((a, r) => a + r.count, 0), mix.conventional);
        assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'no duplicate ids');
        if (rows.length > 1 && rows.some((r) => r.id === 'other')) assert.equal(rows.at(-1).id, 'other');
      }
    }
  });

  test('invalid input is returned as is', () => {
    assert.equal(foldCommitTypes(null), null);
    assert.equal(foldCommitTypes(undefined), undefined);
    assert.deepEqual(foldCommitTypes([]), []);
  });
});

describe('conventionalText', () => {
  const en = getStrings('en');
  const tr = getStrings('tr');
  test('rounds, caps at 99% while some commit is not conventional, 100% only when all are', () => {
    assert.equal(conventionalText({ conventional: 199, total: 200 }, en), '99%');
    assert.equal(conventionalText({ conventional: 200, total: 201 }, en), '99%');
    assert.equal(conventionalText({ conventional: 5, total: 5 }, en), '100%');
    assert.equal(conventionalText({ conventional: 1, total: 5 }, en), '20%');
    assert.equal(conventionalText({ conventional: 2, total: 3 }, tr), '%67');
    assert.equal(conventionalText(null, en), '0%');
    assert.equal(conventionalText({ conventional: 4, total: 2 }, en), '100%');
  });
});

// --- the messages card ----------------------------------------------------------------------------

describe('messages card (extra)', () => {
  const realistic = () => computeStats([
    commit('feat(cli): add --since flag for date windows'), commit('fix: handle empty repos without crashing'),
    commit('docs: update README with examples'), commit('chore(deps): bump vitest from 1.2 to 1.3'),
    commit('feat: add neon theme'), commit('Fix typo'), commit('wip'), commit('refactor(cards): split layout into blocks'),
  ], { today: TODAY });

  test('every theme and language: drawn, inside the content area, no overlap, no NaN', () => {
    const stats = realistic();
    for (const lang of ['en', 'tr']) {
      const L = getStrings(lang);
      for (const colorTheme of COLOR_THEME_NAMES) {
        const label = `${lang}/${colorTheme}`;
        const spec = messagesSpec(stats, { lang, colorTheme });
        const layout = assertLayoutOk({ ...spec, lang }, label);
        assert.ok(layout.blocks.some((b) => b.kind === 'stack'), `${label}: type stack drawn`);
        const card = messagesCard(stats, { lang, colorTheme });
        assert.doesNotMatch(card.svg, /NaN|undefined|Infinity|null/, label);
        assert.ok(card.svg.includes(`>${L.upper(L.messages.typesTitle(L.pct(75)))}<`), `${label}: caption`);
        // feat, fix, docs, then refactor + chore folded into "the rest" (no genuine other bucket).
        assert.ok(card.svg.includes(`>${L.messages.typeNames.rest}<`), `${label}: rest label`);
        assert.ok(!card.svg.includes(`>${L.messages.typeNames.other}<`), `${label}: no other label`);
      }
    }
  });

  test('the folded "the rest" row of the card agrees with the recap (counts and shares)', () => {
    const stats = realistic();
    const stack = charts(messagesSpec(stats)).find((c) => c.kind === 'stack');
    assert.deepEqual(stack.segments.map((s) => [s.label, s.value, s.amount]), [['feat', '33%', 2], ['fix', '17%', 1], ['docs', '17%', 1], ['the rest', '33%', 2]]);
    const recap = formatSummary(stats, { repoName: 'demo', today: TODAY });
    assert.match(recap, /\n {2}Types +33% feat · 17% fix · 17% docs · 17% refactor · 16% chore \(75% of commits conventional\)\n/);
  });

  test('the inline items stay inside the card width and never overlap each other', () => {
    const cases = [
      { feat: 1, fix: 1, docs: 1, refactor: 1, test: 1, chore: 1, other: 1 },
      { refactor: 500, chore: 300, docs: 150, test: 1, other: 49 },
      { refactor: 1, chore: 1, docs: 1, test: 1, feat: 1 },
      { other: 3 },
      { refactor: 4 },
      { refactor: 1000 },
      { feat: 997, fix: 1, refactor: 1, chore: 1 },
    ];
    for (const counts of cases) {
      for (const lang of ['en', 'tr']) {
        const stats = realistic();
        // Two more commits than conventional ones, so a lone type has a "no prefix" partner.
        stats.commitTypes = { total: Object.values(counts).reduce((a, b) => a + b, 0) + 2, counts };
        const spec = messagesSpec(stats, { lang });
        const label = `${JSON.stringify(counts)}/${lang}`;
        const layout = assertLayoutOk({ ...spec, lang }, label);
        const block = layout.blocks.find((b) => b.kind === 'stack');
        assert.ok(block, `${label}: stack drawn`);
        const items = inlineItems(block.svg);
        assert.ok(items.length >= 2, `${label}: at least two items`);
        for (const [i, it] of items.entries()) {
          assert.ok(it.texts[0].x >= 96, `${label}: item ${i} starts inside`);
          assert.ok(it.right <= 984 + 0.5, `${label}: item ${i} ends at ${it.right} (inside 984)`);
          if (i > 0) assert.ok(it.texts[0].x - 30 >= items[i - 1].right, `${label}: item ${i} does not overlap item ${i - 1}`);
        }
      }
    }
  });

  test('a lone type is paired with the commits without a prefix; 100% one type draws no bar', () => {
    const only = (counts, total) => {
      const stats = realistic();
      stats.commitTypes = { total, counts };
      return charts(messagesSpec(stats)).find((c) => c.kind === 'stack');
    };
    assert.deepEqual(only({ other: 5 }, 8).segments.map((s) => [s.label, s.value, s.amount]), [['other', '63%', 5], ['no prefix', '37%', 3]]);
    assert.deepEqual(only({ docs: 5 }, 20).segments.map((s) => [s.label, s.value, s.amount]), [['docs', '25%', 5], ['no prefix', '75%', 15]]);
    assert.equal(only({ docs: 5 }, 5), undefined);
    assert.equal(only({ other: 5 }, 5), undefined);
    // Never a 0% segment.
    for (const total of [5, 6, 20, 25, 1000]) {
      const stack = only({ feat: 5 }, total);
      if (stack) assert.ok(stack.segments.every((s) => s.amount > 0 && s.value !== '0%'), String(total));
    }
  });

  test('a mix too big for the card (5 rows, a long title) leaves the card byte-identical to no commitTypes', () => {
    const stats = computeStats([commit('feat(a-very-long-scope-name): ' + 'x'.repeat(200)), commit('fix: y'), commit('docs: zz zz')], { today: TODAY });
    assert.equal(stats.commitTypes.shown, true);
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of COLOR_THEME_NAMES) {
        const without = { ...stats };
        delete without.commitTypes;
        const a = messagesCard(stats, { lang, colorTheme });
        const b = messagesCard(without, { lang, colorTheme });
        if (charts(messagesSpec(stats, { lang, colorTheme })).some((c) => c.kind === 'stack')) {
          assertLayoutOk({ ...messagesSpec(stats, { lang, colorTheme }), lang }, `${lang}/${colorTheme}`);
        } else {
          assert.equal(a.svg, b.svg, `${lang}/${colorTheme}`);
          assert.equal(a.description, b.description);
        }
      }
    }
  });

  test('junk stats.commitTypes never throws and never adds the mix', () => {
    const base = computeStats([commit('feat: a'), commit('fix: b')], { today: TODAY });
    const without = { ...base };
    delete without.commitTypes;
    const ref = messagesCard(without).svg;
    for (const junk of [null, 'x', 42, [], { counts: null }, { counts: { feat: -3 } }, { total: 1e9, counts: { feat: 1 } }]) {
      const stats = { ...base, commitTypes: junk };
      assert.equal(messagesCard(stats).svg, ref, JSON.stringify(junk));
      assert.doesNotMatch(formatSummary(stats, { repoName: 'demo', today: TODAY }), /Types/);
      assert.ok(!buildMarkdown(stats, { repoName: 'demo', today: TODAY }).includes('## Commit types'));
    }
  });

  test('the "no messages" card with a shown mix (hand-edited stats) still lays out cleanly', () => {
    const stats = computeStats([commit('feat: a'), commit('fix: b')], { today: TODAY });
    stats.messages = null;
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, { lang });
      assertLayoutOk({ ...spec, lang }, lang);
      assert.doesNotMatch(messagesCard(stats, { lang }).svg, /NaN|undefined|null/);
    }
  });

  test('the "<1%" share of a rare type is shown as such (card, recap, wrapped.md)', () => {
    const stats = realistic();
    stats.commitTypes = { total: 300, counts: { feat: 250, fix: 49, docs: 1 } };
    const stack = charts(messagesSpec(stats)).find((c) => c.kind === 'stack');
    assert.deepEqual(stack.segments.map((s) => s.value), ['84%', '16%', '<1%']);
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), /Types +84% feat · 16% fix · <1% docs \(100% of commits conventional\)/);
    assert.ok(buildMarkdown(stats, { repoName: 'demo', today: TODAY }).includes('84% feat · 16% fix · \\<1% docs') || buildMarkdown(stats, { repoName: 'demo', today: TODAY }).includes('84% feat · 16% fix · <1% docs'));
  });
});

// --- recap / wrapped.md (extra) ---------------------------------------------------------------

describe('recap and wrapped.md (extra)', () => {
  test('threshold boundary: exactly 20% shows the line, just under hides it (en / tr)', () => {
    const at = computeStats([commit('feat: a'), ...many('plain one', 4)], { today: TODAY });
    const under = computeStats([commit('feat: a'), ...many('plain one', 5)], { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const L = getStrings(lang);
      const has = (s) => formatSummary(s, { repoName: 'demo', lang, today: TODAY }).split('\n').some((l) => l.startsWith(`  ${L.recap.types} `));
      assert.equal(has(at), true, lang);
      assert.equal(has(under), false, lang);
      assert.ok(buildMarkdown(at, { repoName: 'demo', lang, today: TODAY }).includes(`## ${L.markdown.commitTypes}`));
      assert.ok(!buildMarkdown(under, { repoName: 'demo', lang, today: TODAY }).includes(`## ${L.markdown.commitTypes}`));
      assert.ok(formatSummary(at, { repoName: 'demo', lang, today: TODAY }).includes(L.recap.conventional(L.pct(20))));
    }
  });

  test('Turkish: "diğer" for other, percent sign first, conventional suffix', () => {
    const stats = computeStats([...many('feat: a', 2), commit('perf: b'), commit('plain')], { today: TODAY });
    const recap = formatSummary(stats, { repoName: 'demo', lang: 'tr', today: TODAY });
    assert.match(recap, /\n {2}Türler +%67 feat · %33 diğer \(commit'lerin %75 kadarı conventional\)\n/);
    const md = buildMarkdown(stats, { repoName: 'demo', lang: 'tr', today: TODAY });
    assert.ok(md.includes('## Commit türleri'));
    assert.ok(md.includes("%67 feat · %33 diğer \\(commit'lerin %75 kadarı conventional\\)"), md);
  });

  test('color recap: no ANSI codes leak into the plain run, and the colored line still reads right', () => {
    const stats = computeStats([...many('feat: a', 2), commit('fix: b')], { today: TODAY });
    const plain = formatSummary(stats, { repoName: 'demo', today: TODAY });
    assert.doesNotMatch(plain, /\x1b\[/);
    const colored = formatSummary(stats, { repoName: 'demo', today: TODAY, color: true });
    const line = colored.split('\n').find((l) => l.includes('Types'));
    assert.ok(line);
    // eslint-disable-next-line no-control-regex
    assert.match(line.replace(/\x1b\[[0-9;]*m/g, ''), /Types +67% feat · 33% fix \(100% of commits conventional\)/);
  });

  test('the wrapped.md section sits between the commit size / biggest sections and the personality section', () => {
    const stats = computeStats([...many('feat: a', 2), commit('fix: b')], { today: TODAY });
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    const heads = md.split('\n').filter((l) => l.startsWith('## '));
    const i = heads.indexOf('## Commit types');
    assert.ok(i > 0, heads.join('|'));
    const p = heads.findIndex((h) => /personality|you are/i.test(h));
    if (p >= 0) assert.ok(i < p, heads.join('|'));
  });
});

// --- end to end via the CLI ----------------------------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}
const capture = () => {
  const s = { text: '', write: (x) => { s.text += x; return true; } };
  return s;
};
const who = { GIT_AUTHOR_NAME: 'Alice', GIT_AUTHOR_EMAIL: 'alice@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };

function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  let k = 0;
  for (const s of steps) {
    const env = { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date };
    if (s.git) {
      git(dir, s.git, env);
      continue;
    }
    k += 1;
    const files = s.files ?? { [`src/f${k}.js`]: `line ${k}\n` };
    for (const [p, content] of Object.entries(files)) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', s.msg], env);
  }
}

const messagesSvg = (outDir) => {
  const name = readdirSync(join(outDir, 'cards')).find((x) => /-messages\.svg$/.test(x));
  assert.ok(name, 'a messages card file is written');
  return readFileSync(join(outDir, 'cards', name), 'utf8');
};

describe('end to end via the CLI (commit types)', () => {
  let root;
  let conv;
  let plain;
  const out = (name) => join(root, 'out', name);
  const day = (d) => `2025-03-${String(d).padStart(2, '0')}T10:00:00+00:00`;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-types-x-'));
    conv = join(root, 'conv');
    plain = join(root, 'plain');
    // conv: 3 feat (one upper-case, one with scope and "!"), 1 fix, 1 docs, 1 plain, and a
    // merge commit with a conventional-looking subject that must not count.
    makeRepo(conv, [
      { date: day(1), msg: 'feat: add login' },
      { date: day(2), msg: 'FEAT(ui)!: new layout' },
      { date: day(3), msg: 'fix(api): handle null' },
      { date: day(4), git: ['checkout', '-q', '-b', 'side'] },
      { date: day(4), msg: 'docs: explain setup' },
      { date: day(5), git: ['checkout', '-q', 'main'] },
      { date: day(5), msg: 'Feature: add export' },
      { date: day(6), git: ['merge', '-q', '--no-ff', '-m', 'feat: merge side branch', 'side'] },
      { date: day(7), msg: 'tidy things up' },
    ]);
    // plain: 9 plain subjects, 1 conventional → 10%, under the threshold on its own.
    makeRepo(plain, [
      ...Array.from({ length: 9 }, (_, i) => ({ date: `2025-04-${String(i + 1).padStart(2, '0')}T10:00:00+00:00`, msg: `update thing ${i}` })),
      { date: '2025-04-20T10:00:00+00:00', msg: 'chore: bump' },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, recap, wrapped.md and the messages card agree; merge commit skipped', async () => {
    const stdout = capture();
    const code = await run([conv, '--out', out('a'), '--no-png', '--no-color', '--json', '--md'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('a'), 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.commitTypes, {
      total: 6, conventional: 5, share: 0.833,
      counts: { feat: 3, fix: 1, docs: 1, refactor: 0, test: 0, chore: 0, other: 0 },
      shares: { feat: 60, fix: 20, docs: 20, refactor: 0, test: 0, chore: 0, other: 0 },
      top: 'feat', shown: true,
    });
    assert.match(stdout.text, /\n {2}Types +60% feat · 20% fix · 20% docs \(83% of commits conventional\)\n/);
    const md = readFileSync(join(out('a'), 'wrapped.md'), 'utf8');
    assert.ok(md.includes('## Commit types'));
    assert.ok(md.includes('60% feat · 20% fix · 20% docs \\(83% of commits conventional\\)'), md);
    const svg = messagesSvg(out('a'));
    assert.ok(svg.includes('>COMMIT TYPES · 83% CONVENTIONAL<'), 'card caption');
    for (const t of ['>60%<', '>feat<', '>fix<', '>docs<']) assert.ok(svg.includes(t), `card has ${t}`);
  });

  test('under the threshold: stats.json has the mix (shown false); no recap line, no section, no bar', async () => {
    const stdout = capture();
    const code = await run([plain, '--out', out('p'), '--no-png', '--no-color', '--json', '--md', '--lang', 'tr'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('p'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.commitTypes.total, 10);
    assert.equal(doc.stats.commitTypes.conventional, 1);
    assert.equal(doc.stats.commitTypes.share, 0.1);
    assert.equal(doc.stats.commitTypes.shown, false);
    assert.doesNotMatch(stdout.text, /Türler/);
    assert.ok(!readFileSync(join(out('p'), 'wrapped.md'), 'utf8').includes('## Commit türleri'));
    assert.ok(!messagesSvg(out('p')).includes('COMMIT TÜRLERİ'));
  });

  test('multi-repo: the mix is over all repos (6 + 10 commits, 6 conventional = 37.5%), Turkish', async () => {
    const stdout = capture();
    const code = await run([conv, plain, '--out', out('m'), '--no-png', '--no-color', '--json', '--md', '--lang', 'tr'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('m'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.commitTypes.total, 16);
    assert.equal(doc.stats.commitTypes.conventional, 6);
    assert.deepEqual(doc.stats.commitTypes.counts, { feat: 3, fix: 1, docs: 1, refactor: 0, test: 0, chore: 1, other: 0 });
    assert.equal(doc.stats.commitTypes.shown, true);
    assert.match(stdout.text, /\n {2}Türler +%50 feat · %17 fix · %17 docs · %16 chore \(commit'lerin %38 kadarı conventional\)\n/);
    assert.ok(readFileSync(join(out('m'), 'wrapped.md'), 'utf8').includes('## Commit türleri'));
  });

  test('--theme does not change stats.commitTypes or the recap line', async () => {
    const texts = [];
    for (const theme of COLOR_THEME_NAMES) {
      const stdout = capture();
      assert.equal(await run([conv, '--out', out(`t-${theme}`), '--no-png', '--no-color', '--json', '--theme', theme], { stdout, stderr: capture(), env: {}, today: '2026-01-10' }), 0);
      const doc = JSON.parse(readFileSync(join(out(`t-${theme}`), 'stats.json'), 'utf8'));
      texts.push(JSON.stringify(doc.stats.commitTypes) + stdout.text.split('\n').find((l) => l.includes('Types')));
      assert.ok(messagesSvg(out(`t-${theme}`)).includes('COMMIT TYPES'), theme);
    }
    assert.equal(new Set(texts).size, 1);
  });
});
