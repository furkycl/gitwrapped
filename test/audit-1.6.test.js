// Cold audit of the 1.6 work (releases, commit emoji, reverts): regression tests for the
// bugs it found.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory } from '../src/git.js';
import { commitTypeOf, computeCommitTypes, computePersonality, computeReverts, computeStats, isRevertCommit, isRevertSubject } from '../src/stats/index.js';
import tr from '../src/i18n/tr.js';
import en from '../src/i18n/en.js';
import { buildStatsJson } from '../src/json.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (subject, i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 5, removed: 1 }],
  parents: ['p'],
  ...extra,
});

describe('reverts: Conventional Commits `revert:` subjects count', () => {
  test('revert: / revert(scope): / revert!: in any case; not look-alikes', () => {
    for (const s of ['revert: drop the cache', 'revert(api): undo v2', 'Revert(api)!: undo v2', 'REVERT: x', '  revert: x']) {
      assert.equal(isRevertSubject(s), true, s);
    }
    for (const s of ['revert:x', 'revert:', 'reverted: x', 'reverts: x', 'feat: revert the cache', 'revert the cache', 'revert (api): x']) {
      assert.equal(isRevertSubject(s), false, s);
    }
    // The git-written form still counts.
    assert.equal(isRevertSubject('Revert "feat: x"'), true);
  });

  test('computeReverts counts them (merges still skipped)', () => {
    const commits = [
      commit('feat: a', 1),
      commit('revert: a', 2),
      commit('revert(ui): b', 3),
      commit('revert: merged', 4, { parents: ['p', 'q'] }),
    ];
    assert.equal(isRevertCommit(commits[1]), true);
    assert.deepEqual(computeReverts(commits), { total: 3, count: 2, share: 0.667, reverted: 0 });
  });
});

describe('reverts: `reverted` names each commit once', () => {
  const full = 'abcdef0123456789abcdef0123456789abcdef01';
  const other = '1234567890abcdef1234567890abcdef12345678';

  test('an abbreviated hash and the full hash of one commit are one commit', () => {
    const commits = [
      commit('undo a', 1, { revertOf: [full.slice(0, 7)] }),
      commit('undo a again', 2, { revertOf: [full] }),
      commit('undo a once more', 3, { revertOf: [full.slice(0, 12).toUpperCase()] }),
    ];
    assert.equal(computeReverts(commits).reverted, 1);
  });

  test('two abbreviations of different lengths are one commit; different commits stay apart', () => {
    assert.equal(computeReverts([
      commit('x', 1, { revertOf: [full.slice(0, 9)] }),
      commit('y', 2, { revertOf: [full.slice(0, 7), other.slice(0, 7)] }),
      commit('z', 3, { revertOf: [other] }),
    ]).reverted, 2);
    assert.equal(computeReverts([commit('x', 1, { revertOf: [full, other] })]).reverted, 2);
  });
});

describe('commit types: emoji in front of the type', () => {
  test('a Unicode emoji or gitmoji shortcode before the prefix is skipped', () => {
    assert.equal(commitTypeOf('✨ feat: dark mode'), 'feat');
    assert.equal(commitTypeOf(':sparkles: feat: dark mode'), 'feat');
    assert.equal(commitTypeOf('✨feat: dark mode'), 'feat');
    assert.equal(commitTypeOf('🐛🚑️ fix(api)!: crash'), 'fix');
    assert.equal(commitTypeOf(':bug::ambulance: fix: crash'), 'fix');
    assert.equal(commitTypeOf('👩‍💻 docs: guide'), 'docs');
    assert.equal(commitTypeOf('♻️ refactor: x'), 'refactor');
  });

  test('the rest of the convention is still required', () => {
    assert.equal(commitTypeOf('✨ Update: readme'), null);
    assert.equal(commitTypeOf(':sparkles:'), null);
    assert.equal(commitTypeOf('✨ add dark mode'), null);
    assert.equal(commitTypeOf(':sparkles: feat:'), null);
    assert.equal(commitTypeOf('1 feat: x'), null);
  });

  test('a gitmoji history shows its type mix', () => {
    const subjects = [':sparkles: feat: a', '🐛 fix: b', ':memo: docs: c', 'plain d'];
    const t = computeCommitTypes(subjects.map((s, i) => commit(s, i)));
    assert.equal(t.conventional, 3);
    assert.equal(t.shown, true);
    assert.deepEqual([t.counts.feat, t.counts.fix, t.counts.docs], [1, 1, 1]);
  });
});

describe('Fixaholic reason: neither overlap nor separation of fixes and reverts is claimed', () => {
  // A `Revert "fix: x"` is both a fix and a revert, a `Revert "Add x"` only a revert.
  const base = { totals: { commits: 10, activeDays: 3, firstDay: '2026-03-01', lastDay: '2026-03-03' }, habits: { byHour: Array(24).fill(0).map((_, h) => (h === 12 ? 10 : 0)), byWeekday: [0, 2, 2, 2, 2, 2, 0] }, messages: { counts: { fix: 8 } } };

  test('en / tr say "N commits revert another", not "including" or "and N are reverts"', () => {
    const r = computePersonality({ ...base, reverts: { count: 2, total: 10 } }).archetype.reason;
    assert.equal(r, '80% of your commit messages are fixes; 2 commits revert another.');
    assert.doesNotMatch(r, /including|are reverts/);
    assert.equal(computePersonality({ ...base, reverts: { count: 1, total: 10 } }).archetype.reason, '80% of your commit messages are fixes; 1 commit reverts another.');
    assert.equal(tr.personality.reasons.fixaholic(80, 2), "Commit mesajlarının %80 kadarı birer düzeltme; 2 commit başka bir commit'i geri alıyor.");
  });

  test('reverts of fixes: the reason does not add up to more than all commits', () => {
    const commits = Array.from({ length: 10 }, (_, i) => commit(i < 7 ? `fix: bug ${i}` : `Revert "fix: bug ${i}"`, i));
    const r = computeStats(commits, { today: TODAY }).personality.archetype.reason;
    assert.equal(r, '100% of your commit messages are fixes; 3 commits revert another.');
  });
});

describe('end to end: a real repo', () => {
  let tmp;
  let full;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-audit16-'));
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: '2026-03-10T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-03-10T12:00:00+00:00',
    };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', ':sparkles: feat: one');
    full = git('rev-parse', 'HEAD').trim();
    git('commit', '-q', '--allow-empty', '-m', '✨ feat: two');
    git('commit', '-q', '--allow-empty', '-m', 'revert: drop two');
    git('commit', '-q', '--allow-empty', '-m', 'undo one', '-m', `This reverts commit ${full.slice(0, 7)}.`);
    git('commit', '-q', '--allow-empty', '-m', 'undo one again', '-m', `This reverts commit ${full}.`);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  test('stats.reverts and stats.commitTypes', async () => {
    const { commits } = await readHistory(tmp);
    const s = computeStats(commits, { today: TODAY });
    assert.deepEqual(s.reverts, { total: 5, count: 3, share: 0.6, reverted: 1 });
    assert.equal(s.commitTypes.conventional, 3); // two gitmoji feats + the revert
    assert.equal(s.commitTypes.counts.feat, 2);
  });
});

// --- Tester edge cases -------------------------------------------------------------------
describe('edge: conventional revert subjects', () => {
  test('tab after the colon, empty scope; not empty description, double scope or missing space', () => {
    for (const s of ['revert:\tx', 'revert(): x', 'Revert: x', 'revert!: x']) assert.equal(isRevertSubject(s), true, s);
    for (const s of ['revert: ', 'revert:   ', 'revert(a)(b): x', 'revert(a)!:x', 'revert!x: y', 'unrevert: x', 'Revert x', '', null, undefined, 42]) {
      assert.equal(isRevertSubject(s), false, String(s));
    }
  });

  test('a conventional revert with a This-reverts line counts once and names its target', () => {
    const h = 'abcdef0123456789abcdef0123456789abcdef01';
    assert.deepEqual(computeReverts([commit('revert: a', 1, { revertOf: [h] }), commit('feat: b', 2)]), { total: 2, count: 1, share: 0.5, reverted: 1 });
  });
});

describe('edge: `reverted` prefix matching', () => {
  const a = `abcdef1${'1'.repeat(33)}`;
  const b = `abcdef1${'2'.repeat(33)}`;
  const c = (revertOf, i) => commit('undo', i, { revertOf });

  test('an abbreviation that is a prefix of two different full hashes adds nothing (2, not 3)', () => {
    assert.equal(computeReverts([c(['abcdef1'], 1), c([a], 2), c([b], 3)]).reverted, 2);
  });

  test('the abbreviation alone is one commit; two different abbreviations are two', () => {
    assert.equal(computeReverts([c(['abcdef1'], 1)]).reverted, 1);
    assert.equal(computeReverts([c(['abcdef1'], 1), c(['abcdef2'], 2)]).reverted, 2);
    // Two diverging abbreviations plus their common prefix: two commits.
    assert.equal(computeReverts([c(['abcdef12'], 1), c(['abcdef13'], 2), c(['abcdef1'], 3)]).reverted, 2);
  });

  test('uppercase and mixed-case hex match lowercase; order in the list does not matter', () => {
    assert.equal(computeReverts([c([a.toUpperCase()], 1), c(['AbCdEf1'], 2)]).reverted, 1);
    assert.equal(computeReverts([c([a, 'abcdef1'], 1)]).reverted, 1);
    assert.equal(computeReverts([c(['abcdef1', a], 1)]).reverted, 1);
  });

  test('a shared prefix that is not a prefix of the whole hash does not merge', () => {
    // "bcdef11" occurs inside `a` but not at its start.
    assert.equal(computeReverts([c([a], 1), c(['bcdef11'], 2)]).reverted, 2);
  });

  test('invalid targets are ignored, and reverts in merge commits do not count', () => {
    assert.equal(computeReverts([c(['abc', 'zzzzzzz', 7, null, 'g'.repeat(40)], 1)]).reverted, 0);
    assert.equal(computeReverts([commit('m', 1, { parents: ['p', 'q'], revertOf: [a] })]).reverted, 0);
  });
});

describe('edge: emoji in front of the commit type', () => {
  test('shortcode with no space, several blanks, flags, ZWJ', () => {
    assert.equal(commitTypeOf(':sparkles:feat: x'), 'feat');
    assert.equal(commitTypeOf('  ✨  feat:  x'), 'feat');
    assert.equal(commitTypeOf('🇹🇷 fix: x'), 'fix');
    assert.equal(commitTypeOf(':sparkles: :bug: fix: x'), 'fix');
  });

  test('emoji-only subjects and emoji before a non-type word are not conventional', () => {
    for (const s of ['✨', '✨ ', '✨✨✨', ':sparkles:', ':sparkles::bug:', '✨ :', '✨ feat', '✨ feat:x', '✨ wip: x']) {
      assert.equal(commitTypeOf(s), null, s);
    }
    // Uppercase shortcodes are not gitmoji (as in emoji.js), so they are not stripped.
    assert.equal(commitTypeOf(':Sparkles: feat: x'), null);
  });

  test('an emoji after the type is not stripped', () => {
    assert.equal(commitTypeOf('feat: ✨ x'), 'feat');
    assert.equal(commitTypeOf('feat ✨: x'), null);
  });

  test('emoji-only subjects are counted in total but not as conventional', () => {
    const t = computeCommitTypes([commit('✨', 1), commit(':sparkles:', 2), commit('✨ feat: a', 3)]);
    assert.equal(t.total, 3);
    assert.equal(t.conventional, 1);
  });

  test('a keycap emoji (digit / # / * + U+FE0F + U+20E3) before the type is stripped', () => {
    assert.equal(commitTypeOf('1️⃣ feat: x'), 'feat');
    assert.equal(commitTypeOf('#️⃣ fix: x'), 'fix');
    assert.equal(commitTypeOf('*⃣ docs: x'), 'docs');
    assert.equal(commitTypeOf('1 feat: x'), null);
    assert.equal(commitTypeOf('# feat: x'), null);
  });

  test('a bare text-style symbol is not an emoji (as in stats/emoji.js); with U+FE0F it is', () => {
    assert.equal(commitTypeOf('© feat: x'), null);
    assert.equal(commitTypeOf('™ feat: x'), null);
    assert.equal(commitTypeOf('©️ feat: x'), 'feat');
  });

  test('a gitmoji-prefixed conventional revert counts as a revert, as it counts as a revert type', () => {
    assert.equal(commitTypeOf('⏪ revert: x'), 'other');
    assert.equal(isRevertSubject('⏪ revert: x'), true);
    assert.equal(isRevertSubject(':rewind: revert: x'), true);
    assert.equal(isRevertSubject('⏪ revert:x'), false);
    assert.equal(isRevertSubject('⏪ feat: revert x'), false);
  });
});

describe('edge: Fixaholic strings', () => {
  test('en: no reverts, one, many (thousands separated)', () => {
    const f = en.personality.reasons.fixaholic;
    assert.equal(f(40, 0), '40% of your commit messages are fixes.');
    assert.equal(f(40, undefined), '40% of your commit messages are fixes.');
    assert.equal(f(40, 1), '40% of your commit messages are fixes; 1 commit reverts another.');
    assert.equal(f(40, 2), '40% of your commit messages are fixes; 2 commits revert another.');
    assert.match(f(40, 1234), /; 1,234 commits revert another\.$/);
  });

  test('tr strings', () => {
    const f = tr.personality.reasons.fixaholic;
    assert.equal(f(40, 0), 'Commit mesajlarının %40 kadarı birer düzeltme.');
    assert.equal(f(40, 1), "Commit mesajlarının %40 kadarı birer düzeltme; 1 commit başka bir commit'i geri alıyor.");
  });
});

describe('edge: stats.json shape for reverts', () => {
  test('stats.reverts is {total, count, share, reverted} with numbers, and unchanged without reverts', () => {
    const full = 'abcdef0123456789abcdef0123456789abcdef01';
    const commits = [commit('feat: a', 1), commit('revert: a', 2), commit('undo', 3, { revertOf: [full.slice(0, 7)] }), commit('undo2', 4, { revertOf: [full] })];
    const doc = JSON.parse(buildStatsJson({ stats: computeStats(commits, { today: TODAY }), repoName: 'r', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(Object.keys(doc.stats.reverts).sort(), ['count', 'reverted', 'share', 'total']);
    assert.deepEqual(doc.stats.reverts, { total: 4, count: 3, share: 0.75, reverted: 1 });
    const none = JSON.parse(buildStatsJson({ stats: computeStats([commit('feat: a', 1)], { today: TODAY }), repoName: 'r' }));
    assert.deepEqual(none.stats.reverts, { total: 1, count: 0, share: 0, reverted: 0 });
  });
});
