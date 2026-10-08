// Fixup commits (stats.messages.fixups): autosquash subjects (`fixup!` / `squash!` /
// `amend!`) that reached the history, on the messages card, the recap and wrapped.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { computeMessages, computeStats, isFixupSubject, shownFixups } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, fixupShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';

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
const history = (subjects, n = 40) => Array.from({ length: n }, (_, i) => commit(subjects[i % subjects.length], i));
const PLAIN = ['add parser', 'fix the parser', 'wip on render', 'tidy render code'];
const WITH_FIXUPS = [...PLAIN.slice(0, 3), 'fixup! add parser'];
const cards = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg).join('\n');
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').spec;

describe('isFixupSubject', () => {
  test('git autosquash prefixes, exactly: "fixup! ", "squash! ", "amend! "', () => {
    for (const s of ['fixup! add parser', 'squash! add parser', 'amend! add parser', 'fixup! fixup! x', 'fixup! ']) assert.equal(isFixupSubject(s), true, s);
  });

  test('case-sensitive, at the very start, "!" then a space; not in the middle', () => {
    for (const s of ['  fixup! x', 'fixup!', 'fixup!\tx', 'Fixup! x', 'FIXUP! x', 'fixup x', 'fixup: x', 'fixup!x', 'feat: fixup! x', 'refixup! x', '', null, 42]) assert.equal(isFixupSubject(s), false, String(s));
  });
});

describe('computeMessages: fixups', () => {
  test('count and share of non-merge commits; nested prefixes count once', () => {
    const m = computeMessages([commit('fixup! fixup! a', 1), commit('squash! b', 2), commit('a', 3), commit('b', 4)]);
    assert.deepEqual(m.fixups, { commits: 2, share: 0.5 });
  });

  test('merges are skipped (parents, else a merge subject); no fixups → zeros', () => {
    const m = computeMessages([commit('fixup! a', 1, { parents: ['p', 'q'] }), commit('a', 2), { subject: "Merge branch 'x'", date: '2026-03-01T10:00:00Z' }]);
    assert.deepEqual(m.fixups, { commits: 0, share: 0 });
    assert.deepEqual(computeMessages([]).fixups, { commits: 0, share: 0 });
  });

  test('share has 3 decimals, capped at 0.999 short of every commit; exactly 1 when all are', () => {
    const many = [commit('fixup! a', 0), ...Array.from({ length: 2000 }, (_, i) => commit('fixup! b', i + 1)), commit('a', 9999)];
    assert.equal(computeMessages(many).fixups.share, 0.999);
    assert.equal(computeMessages([commit('amend! a', 1)]).fixups.share, 1);
    assert.equal(computeMessages([commit('fixup! a', 1), commit('a', 2), commit('b', 3)]).fixups.share, 0.333);
  });

  test('multi-repo histories add up', () => {
    const { commits } = mergeHistories([
      { label: 'web', commits: [commit('fixup! a', 1), commit('a', 2)] },
      { label: 'api', commits: [commit('squash! b', 3), commit('b', 4)] },
    ]);
    assert.deepEqual(computeStats(commits, { today: TODAY }).messages.fixups, { commits: 2, share: 0.5 });
  });

  test('stats.json keeps exactly {commits, share}', () => {
    const stats = computeStats(history(WITH_FIXUPS), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo' }));
    assert.deepEqual(doc.stats.messages.fixups, { commits: 10, share: 0.25 });
  });
});

describe('shownFixups', () => {
  test('null for older shapes and no fixups; pct from share otherwise', () => {
    for (const x of [undefined, null, 'x', {}, { commits: 0, share: 0 }, { commits: -1 }]) assert.equal(shownFixups(x), null);
    assert.deepEqual(shownFixups({ commits: 3, share: 0.02 }), { commits: 3, pct: 2 });
    assert.equal(fixupShareText(shownFixups({ commits: 1, share: 0.001 })), '<1%');
  });
});

describe('outputs', () => {
  test('without fixups, cards / recap / wrapped.md are as for a stats.json without the field', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    const old = { ...stats, messages: { ...stats.messages } };
    delete old.messages.fixups;
    for (const lang of ['en', 'tr']) {
      assert.equal(cards(stats, lang), cards(old, lang));
      assert.equal(formatSummary(stats, { repoName: 'demo', lang }), formatSummary(old, { repoName: 'demo', lang }));
      assert.equal(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang }), buildMarkdown(old, { repoName: 'demo', today: TODAY, lang }));
    }
  });

  test('the fix row gains a "· N fixup!" segment; other cards are unchanged', () => {
    const stats = computeStats(history(WITH_FIXUPS), { today: TODAY });
    const without = { ...stats, messages: { ...stats.messages, fixups: { commits: 0, share: 0 } } };
    const rows = messagesSpec(stats).lines;
    assert.ok(rows.some((r) => /“fix”/.test(r.label) && / · 10 fixup!$/.test(r.value)), JSON.stringify(rows));
    assert.ok(messagesSpec(stats, 'tr').lines.some((r) => / · 10 fixup!$/.test(r.value ?? '')));
    const a = buildCards(stats, { repoName: 'demo', today: TODAY });
    const b = buildCards(without, { repoName: 'demo', today: TODAY });
    for (let i = 0; i < a.length; i++) if (a[i].id !== 'messages') assert.equal(a[i].svg, b[i].svg, a[i].id);
    assert.deepEqual(messagesSpec(stats).lines.map((r) => r.label), messagesSpec(without).lines.map((r) => r.label));
  });

  test('folded fix / wip / oops counters (commit-type mix): the card is byte-identical to the no-fixup card', () => {
    const conv = computeStats(history(['feat: add parser', 'fix: the parser', 'chore: wip on render', 'fixup! feat: add parser', 'docs: x']), { today: TODAY });
    assert.ok(conv.messages.fixups.commits > 0);
    const without = { ...conv, messages: { ...conv.messages, fixups: { commits: 0, share: 0 } } };
    for (const lang of ['en', 'tr']) {
      assert.ok(messagesSpec(conv, lang).lines.some((r) => r.label === '“fix” / “wip” / “oops”'), `${lang}: counters folded`);
      assert.equal(cards(conv, lang), cards(without, lang), lang);
    }
  });

  test('recap and wrapped.md lines, en and tr', () => {
    const stats = computeStats(history(WITH_FIXUPS), { today: TODAY });
    assert.match(formatSummary(stats, { repoName: 'demo' }), /Fixups +10 commits \(25% of non-merge commits\)/);
    assert.match(formatSummary(stats, { repoName: 'demo', lang: 'tr' }), /Fixup'lar +10 commit \(merge dışı commit'lerin %25 kadarı\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /## Fixup commits\n\n10 commits \\\(25% of non-merge commits\\\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Fixup commit'leri\n\n10 commit \\\(merge dışı commit'lerin %25 kadarı\\\)/);
  });
});
