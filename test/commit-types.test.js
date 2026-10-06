// Conventional-commit mix (stats.commitTypes): the subject parser, the buckets, the
// "shown" threshold, and the messages card / recap / wrapped.md / stats.json outputs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMMIT_TYPE_IDS, COMMIT_TYPES_MIN_SHARE, commitTypeOf, computeCommitTypes, computeStats, foldCommitTypes, shownCommitTypes } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-10-05';

let n = 0;
/** A small non-merge commit with `subject`, one per day so dates are distinct. */
function commit(subject, extra = {}) {
  n += 1;
  const day = String((n % 28) + 1).padStart(2, '0');
  return {
    hash: `h${n}`, author: 'A', email: 'a@x', date: `2026-09-${day}T10:00:00Z`, subject, parents: ['p'],
    files: [{ path: 'src/app.js', added: 3, removed: 1 }], filesChanged: 1, linesAdded: 3, linesRemoved: 1, ...extra,
  };
}
const many = (subject, count) => Array.from({ length: count }, () => commit(subject));

describe('commitTypeOf', () => {
  test('the six types, scopes and breaking changes', () => {
    assert.equal(commitTypeOf('feat: dark mode'), 'feat');
    assert.equal(commitTypeOf('fix(api): null check'), 'fix');
    assert.equal(commitTypeOf('docs!: rewrite'), 'docs');
    assert.equal(commitTypeOf('refactor(core)!: split module'), 'refactor');
    assert.equal(commitTypeOf('test: cover edge cases'), 'test');
    assert.equal(commitTypeOf('chore(deps): bump'), 'chore');
    assert.equal(commitTypeOf('feat(): empty scope'), 'feat');
  });

  test('case-insensitive, surrounding whitespace ignored', () => {
    assert.equal(commitTypeOf('FEAT: shout'), 'feat');
    assert.equal(commitTypeOf('Fix: capital'), 'fix');
    assert.equal(commitTypeOf('  chore: padded  '), 'chore');
  });

  test('other known types go to "other"; aliases map to their bucket', () => {
    for (const t of ['perf', 'ci', 'build', 'style', 'revert', 'release', 'deps']) assert.equal(commitTypeOf(`${t}: x`), 'other', t);
    assert.equal(commitTypeOf('feature: x'), 'feat');
    assert.equal(commitTypeOf('features: x'), 'feat');
    assert.equal(commitTypeOf('bugfix: x'), 'fix');
    assert.equal(commitTypeOf('hotfix(ui): x'), 'fix');
    assert.equal(commitTypeOf('doc: x'), 'docs');
    assert.equal(commitTypeOf('tests: x'), 'test');
  });

  test('not conventional', () => {
    for (const s of ['Fix typo', 'feat:no space', 'feat:', 'feat: ', 'feat(scope: x', 'feat (x): y', 'Update: readme', 'WIP: stuff', 'Merge branch main', ': x', '', '   ', 'fix-up: x', 'feat(a)(b): x', 'feat!!: x']) {
      assert.equal(commitTypeOf(s), null, JSON.stringify(s));
    }
    for (const v of [null, undefined, 42, {}, ['feat: x']]) assert.equal(commitTypeOf(v), null);
  });
});

describe('computeCommitTypes', () => {
  test('counts, shares, top and shown', () => {
    const commits = [...many('feat: a', 3), ...many('fix: b', 2), commit('perf: c'), ...many('random subject', 4)];
    const t = computeCommitTypes(commits);
    assert.deepEqual(t, {
      total: 10,
      conventional: 6,
      share: 0.6,
      counts: { feat: 3, fix: 2, docs: 0, refactor: 0, test: 0, chore: 0, other: 1 },
      shares: { feat: 50, fix: 33, docs: 0, refactor: 0, test: 0, chore: 0, other: 17 },
      top: 'feat',
      shown: true,
    });
    assert.equal(Object.values(t.shares).reduce((a, b) => a + b, 0), 100);
  });

  test('empty and invalid input', () => {
    const empty = computeCommitTypes([]);
    assert.deepEqual(empty, { total: 0, conventional: 0, share: 0, counts: Object.fromEntries(COMMIT_TYPE_IDS.map((id) => [id, 0])), shares: Object.fromEntries(COMMIT_TYPE_IDS.map((id) => [id, 0])), top: null, shown: false });
    assert.deepEqual(computeCommitTypes(null), empty);
    assert.deepEqual(computeCommitTypes(undefined), empty);
    assert.deepEqual(computeCommitTypes([null, 3, 'x', {}, { subject: 42 }, { subject: '   ' }]), empty);
  });

  test('merge commits and empty subjects are skipped', () => {
    const merge = commit('feat: merged', { parents: ['a', 'b'] });
    const t = computeCommitTypes([merge, commit(''), commit('fix: x'), commit('nope')]);
    assert.equal(t.total, 2);
    assert.equal(t.conventional, 1);
    assert.equal(t.counts.feat, 0);
  });

  test('the 20% threshold', () => {
    assert.equal(COMMIT_TYPES_MIN_SHARE, 0.2);
    assert.equal(computeCommitTypes([commit('feat: a'), ...many('plain', 4)]).shown, true); // exactly 20%
    assert.equal(computeCommitTypes([commit('feat: a'), ...many('plain', 5)]).shown, false); // under 20%
    assert.equal(computeCommitTypes(many('plain', 5)).shown, false);
  });

  test('top ties go to bucket order', () => {
    assert.equal(computeCommitTypes([commit('chore: a'), commit('docs: b')]).top, 'docs');
    assert.equal(computeCommitTypes([commit('perf: a'), commit('test: b')]).top, 'test');
  });

  test('computeStats has commitTypes after commitSizes', () => {
    const keys = Object.keys(computeStats([commit('feat: x')], { today: TODAY }));
    assert.equal(keys[keys.indexOf('commitSizes') + 1], 'commitTypes');
  });
});

describe('shownCommitTypes / foldCommitTypes', () => {
  test('rows by count, other last, null under the threshold', () => {
    const t = computeCommitTypes([...many('perf: a', 5), ...many('fix: b', 2), ...many('feat: c', 3)]);
    const mix = shownCommitTypes(t);
    assert.deepEqual(mix.rows.map((r) => r.id), ['feat', 'fix', 'other']);
    assert.equal(mix.rows.reduce((a, r) => a + r.share, 0), 100);
    assert.equal(shownCommitTypes(computeCommitTypes([commit('feat: a'), ...many('plain', 9)])), null);
    assert.equal(shownCommitTypes(null), null);
    assert.equal(shownCommitTypes({ counts: { feat: -1, fix: Number.NaN } }), null);
  });

  test('fold keeps the top three named types and sums the rest into other', () => {
    const rows = [{ id: 'feat', count: 5, share: 33 }, { id: 'fix', count: 4, share: 27 }, { id: 'docs', count: 3, share: 20 }, { id: 'chore', count: 2, share: 13 }, { id: 'other', count: 1, share: 7 }];
    assert.deepEqual(foldCommitTypes(rows, 4), [rows[0], rows[1], rows[2], { id: 'rest', count: 3, share: 20 }]);
    assert.equal(foldCommitTypes(rows.slice(0, 3), 4).length, 3);
  });
});

describe('outputs', () => {
  const conventional = () => computeStats([...many('feat: add thing', 6), ...many('fix: repair thing', 3), commit('docs: explain')], { today: TODAY });
  const plain = () => computeStats([...many('add thing', 6), ...many('repair thing', 4)], { today: TODAY });

  test('stats.json carries stats.commitTypes', () => {
    const doc = JSON.parse(buildStatsJson({ stats: conventional(), repoName: 'r', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.commitTypes.counts, { feat: 6, fix: 3, docs: 1, refactor: 0, test: 0, chore: 0, other: 0 });
    assert.equal(doc.stats.commitTypes.shown, true);
  });

  for (const lang of ['en', 'tr']) {
    const L = getStrings(lang);
    test(`messages card shows the mix when it fits (${lang})`, () => {
      const card = buildCards(conventional(), { repoName: 'r', today: TODAY, lang }).find((c) => c.id === 'messages');
      assert.match(card.description, new RegExp(L.messages.typeNames.feat));
      assert.ok(card.description.includes(L.messages.typesTitle(L.pct(100))));
    });

    test(`no mix: messages card spec has no type chart (${lang})`, () => {
      const stats = plain();
      const spec = buildCardSpecs(stats, { repoName: 'r', today: TODAY, lang }).find((c) => c.id === 'messages').spec;
      const charts = Array.isArray(spec.chart) ? spec.chart : [spec.chart];
      assert.ok(!charts.some((c) => c?.kind === 'stack'));
      // Removing commitTypes altogether gives the very same card.
      const without = { ...stats };
      delete without.commitTypes;
      const a = buildCards(stats, { repoName: 'r', today: TODAY, lang }).find((c) => c.id === 'messages');
      const b = buildCards(without, { repoName: 'r', today: TODAY, lang }).find((c) => c.id === 'messages');
      assert.equal(a.svg, b.svg);
      assert.equal(a.description, b.description);
    });

    test(`recap and wrapped.md lines only when shown (${lang})`, () => {
      const recap = formatSummary(conventional(), { repoName: 'r', lang, today: TODAY });
      const typesLine = (text) => text.split('\n').find((l) => l.startsWith(`  ${L.recap.types} `));
      assert.equal(typesLine(recap), `  ${L.recap.types.padEnd(L.recap.labelWidth)}${L.pct(60)} feat · ${L.pct(30)} fix · ${L.pct(10)} docs (${L.recap.conventional(L.pct(100))})`);
      assert.equal(typesLine(formatSummary(plain(), { repoName: 'r', lang, today: TODAY })), undefined);
      const md = buildMarkdown(conventional(), { repoName: 'r', lang, today: TODAY });
      assert.ok(md.includes(`## ${L.markdown.commitTypes}`));
      assert.ok(!buildMarkdown(plain(), { repoName: 'r', lang, today: TODAY }).includes(`## ${L.markdown.commitTypes}`));
    });
  }
});
