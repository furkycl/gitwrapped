// Reverts: commits that revert another, by a `Revert "…"` subject or a "This reverts
// commit <hash>" line in the message (read by src/git.js readReverts), counted by
// computeReverts (src/stats/reverts.js) and shown on the messages card, in the Fixaholic
// reason, the recap, wrapped.md and stats.json.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories, parseRevertLog, readCommits, readReverts, revertTargets } from '../src/git.js';
import { computePersonality, computeReverts, computeStats as computeAllStats, isRevertCommit, isRevertSubject, shownReverts } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out.
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null } } : s;
};

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
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').spec;
const messagesSvg = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').svg;
const allSvgs = (stats, lang = 'en') => buildCards(stats, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg).join('\n');

describe('detection', () => {
  test('a Revert "…" subject, a revert of a revert, curly quotes; not other subjects', () => {
    assert.equal(isRevertSubject('Revert "feat: add login"'), true);
    assert.equal(isRevertSubject('Revert "Revert "feat: add login""'), true);
    assert.equal(isRevertSubject('Revert “x”'), true);
    assert.equal(isRevertSubject('revert "x" handling in parser'), false);
    assert.equal(isRevertSubject('Reverted the parser'), false);
    assert.equal(isRevertSubject('revert: drop cache'), true); // a Conventional Commits revert (audit 1.6)
    assert.equal(isRevertSubject('revert:drop cache'), false);
    assert.equal(isRevertSubject('fix: Revert "x" in docs'), false);
    assert.equal(isRevertSubject(null), false);
  });

  test('revertTargets: "This reverts commit <hash>" lines, lowercased, distinct', () => {
    const a = 'a'.repeat(40);
    assert.deepEqual(revertTargets(`Revert "x"\n\nThis reverts commit ${a}.`), [a]);
    assert.deepEqual(revertTargets('This reverts commit ABCDEF1.\nthis reverts commit abcdef1\n  This reverts commit 1234567.'), ['abcdef1', '1234567']);
    assert.deepEqual(revertTargets('docs: x\n\nbody: see This reverts commit DEADBEEF1 mid-line'), []);
    assert.deepEqual(revertTargets(`This reverts commit ${'b'.repeat(64)}.`), ['b'.repeat(64)]);
    assert.deepEqual(revertTargets('This reverts commit abc12 (too short), This reverts commit deadbeefzz'), []);
    assert.deepEqual(revertTargets(''), []);
    assert.deepEqual(revertTargets(undefined), []);
  });

  test('parseRevertLog: one NUL-terminated %H\\x1f%B record per commit; only revert messages kept', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const out = `${a}\x1fReapply "x"\n\nThis reverts commit ${b}.\n\0\n${b}\x1fodd \x1f message\n\0garbage\0`;
    assert.deepEqual([...parseRevertLog(out)], [[a, [b]]]);
    assert.equal(parseRevertLog('').size, 0);
  });

  test('isRevertCommit: by subject, by body (revertOf), both', () => {
    assert.equal(isRevertCommit(commit('Revert "x"', 1)), true);
    assert.equal(isRevertCommit(commit('Undo the parser change', 1, { revertOf: ['abcdef1'] })), true);
    assert.equal(isRevertCommit(commit('Revert "x"', 1, { revertOf: ['abcdef1'] })), true);
    assert.equal(isRevertCommit(commit('fix: x', 1)), false);
    assert.equal(isRevertCommit(commit('fix: x', 1, { revertOf: ['nothex!'] })), false);
    assert.equal(isRevertCommit(null), false);
  });
});

describe('computeReverts', () => {
  test('counts by subject, body or both once each; share of non-merge commits; distinct targets', () => {
    const commits = [
      commit('Revert "feat: a"', 1),
      commit('Undo b', 2, { revertOf: ['abcdef1'] }),
      commit('Revert "fix: c"', 3, { revertOf: ['abcdef2'] }),
      commit('Revert "Revert "feat: a""', 4, { revertOf: ['ABCDEF1'] }),
      commit('Revert "x"', 5, { parents: ['p', 'q'] }), // merge: skipped
      commit('feat: d', 6),
      commit('feat: e', 7),
      commit('feat: f', 8),
    ];
    assert.deepEqual(computeReverts(commits), { total: 7, count: 4, share: 0.571, reverted: 2 });
  });

  test('zero case and junk', () => {
    assert.deepEqual(computeReverts([]), { total: 0, count: 0, share: 0, reverted: 0 });
    assert.deepEqual(computeReverts(undefined), { total: 0, count: 0, share: 0, reverted: 0 });
    assert.deepEqual(computeReverts([null, 3, commit('feat: x', 1)]), { total: 1, count: 0, share: 0, reverted: 0 });
    assert.equal(shownReverts({ count: 0, total: 5 }), null);
    assert.equal(shownReverts(null), null);
    assert.deepEqual(shownReverts({ count: 2, total: 1 }), { count: 2, total: 2, pct: 100 });
  });

  test('computeStats puts reverts right after emoji', () => {
    const keys = Object.keys(computeStats([commit('Revert "x"', 1)], { today: TODAY }));
    assert.equal(keys[keys.indexOf('emoji') + 1], 'reverts');
  });
});

describe('outputs', () => {
  const SUBJECTS = ['feat: add login', 'fix crash', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again', 'tidy', 'more'];
  const withReverts = () => {
    const commits = history(SUBJECTS);
    commits[3] = commit('Revert "feat: add login"', 3);
    commits[7] = commit('Revert "Revert "feat: add login""', 7, { revertOf: ['abcdef1'] });
    return commits;
  };

  test('the messages card gets a reverts row (en + tr) that fits', () => {
    const stats = computeStats(withReverts(), { today: TODAY });
    assert.equal(stats.reverts.count, 2);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const spec = messagesSpec(stats, lang);
      const row = spec.lines.at(-1);
      assert.equal(row.label, L.messages.revertsTitle);
      assert.equal(row.value, `2 · ${L.pct(5)}`);
      assert.ok(layoutCard({ ...spec, lang }).drawnCharts.length > 0, 'the biggest commit keeps its room');
      assert.ok(messagesSvg(stats, lang).includes(`2 · ${L.pct(5)}`));
    }
  });

  test('without reverts every card is byte-identical to one without the stat', () => {
    const stats = computeStats(history(SUBJECTS), { today: TODAY });
    assert.equal(stats.reverts.count, 0);
    const without = { ...stats };
    delete without.reverts;
    for (const lang of ['en', 'tr']) assert.equal(allSvgs(stats, lang), allSvgs(without, lang));
    assert.equal(formatSummary(stats, { repoName: 'demo' }), formatSummary(without, { repoName: 'demo' }));
    assert.equal(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), buildMarkdown(without, { repoName: 'demo', today: TODAY }));
  });

  test('with the emoji row too, both rows fit or the emoji row keeps its place', () => {
    const commits = history(['✨ add login', ':bug: fix crash', 'update readme', '📝 docs', 'tidy']);
    commits[2] = commit('Revert "✨ add login"', 2);
    const stats = computeStats(commits, { today: TODAY });
    const labels = messagesSpec(stats).lines.map((r) => r.label);
    assert.deepEqual(labels.slice(-2), ['Emoji ✨ 🐛 📝', 'Reverts']);
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, lang);
      const l = layoutCard({ ...spec, lang });
      assert.ok(l.drawnCharts.length > 0, 'the biggest commit keeps its room');
    }
  });

  test('recap and wrapped.md lines (en + tr), <1% for a rare revert', () => {
    const stats = computeStats(withReverts(), { today: TODAY });
    assert.match(formatSummary(stats, { repoName: 'demo' }), /Reverts +2 commits \(5% of non-merge commits\)/);
    assert.match(formatSummary(stats, { repoName: 'demo', lang: 'tr' }), /Revert'ler +2 commit \(merge dışı commit'lerin %5 kadarı\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /## Reverts\n\n2 commits \\\(5% of non-merge commits\\\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Revert'ler\n\n2 commit/);
    const rare = history(SUBJECTS, 300);
    rare[0] = commit('Revert "x"', 0);
    assert.match(formatSummary(computeStats(rare, { today: TODAY }), { repoName: 'demo' }), /Reverts +1 commit \(<1% of non-merge commits\)/);
  });
});

describe('Fixaholic reason', () => {
  const base = { totals: { commits: 10, activeDays: 3, firstDay: '2026-03-01', lastDay: '2026-03-03' }, habits: { byHour: Array(24).fill(0).map((_, h) => (h === 12 ? 10 : 0)), byWeekday: [0, 2, 2, 2, 2, 2, 0] }, messages: { counts: { fix: 8 } } };

  test('names the reverts when there are any (en + tr), else unchanged', () => {
    const plain = computePersonality(base);
    assert.equal(plain.archetype.id, 'fixaholic');
    assert.equal(plain.archetype.reason, '80% of your commit messages are fixes.');
    const one = computePersonality({ ...base, reverts: { count: 1, total: 10 } });
    assert.equal(one.archetype.reason, '80% of your commit messages are fixes; 1 commit reverts another.');
    const three = computePersonality({ ...base, reverts: { count: 3, total: 10 } });
    assert.equal(three.archetype.reason, '80% of your commit messages are fixes; 3 commits revert another.');
    assert.equal(tr.personality.reasons.fixaholic(80, 3), "Commit mesajlarının %80 kadarı birer düzeltme; 3 commit başka bir commit'i geri alıyor.");
    assert.equal(tr.personality.reasons.fixaholic(80, 0), 'Commit mesajlarının %80 kadarı birer düzeltme.');
  });

  test('the personality card shows it in Turkish too', () => {
    const commits = Array.from({ length: 10 }, (_, i) => commit(i < 7 ? `fix: bug ${i}` : `Revert "fix: bug ${i}"`, i));
    const stats = computeStats(commits, { today: TODAY });
    assert.equal(stats.personality.archetype.id, 'fixaholic');
    assert.match(stats.personality.archetype.reason, /; 3 commits revert another\.$/);
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }).find((c) => c.id === 'personality').spec;
    assert.match(spec.subtitle, /; 3 commit başka bir commit'i geri alıyor\.$/);
  });
});

describe('i18n', () => {
  test('en and tr have the same revert strings', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.messages.revertsTitle, 'string');
      assert.equal(typeof L.messages.revertsValue(3, '2%'), 'string');
      assert.equal(typeof L.recap.reverts, 'string');
      assert.equal(typeof L.markdown.reverts, 'string');
      assert.equal(L.personality.reasons.fixaholic.length, 2);
    }
  });
});

describe('git (real repos)', () => {
  let root;
  let repo;
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const hashes = {};
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-reverts-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    let day = 1;
    const at = () => {
      const d = `2025-03-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
      return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
    };
    const head = () => git(repo, ['rev-parse', 'HEAD']).trim();
    writeFileSync(join(repo, 'a.txt'), '1\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: one'], at());
    writeFileSync(join(repo, 'a.txt'), '2\n');
    git(repo, ['commit', '-qam', 'feat: two'], at());
    hashes.two = head();
    git(repo, ['revert', '--no-edit', 'HEAD'], at()); // Revert "feat: two" + body line
    hashes.revert = head();
    git(repo, ['revert', '--no-edit', 'HEAD'], at()); // Reapply / Revert "Revert ..." + body line
    hashes.reapply = head();
    writeFileSync(join(repo, 'b.txt'), '1\n');
    git(repo, ['add', '-A']);
    // Body only: a hand-written subject with git's line pasted into the body.
    git(repo, ['commit', '-q', '-m', 'Undo the parser change', '-m', `This reverts commit ${hashes.two.slice(0, 10)}.`], at());
    hashes.bodyOnly = head();
    writeFileSync(join(repo, 'c.txt'), '1\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat: three', '-m', 'Mentions reverts but not the line.\nCo-authored-by: Bob <bob@example.com>'], at());
    // grep.patternType must not change how the bodies are matched.
    git(repo, ['config', 'grep.patternType', 'fixed']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits gives revert commits revertOf (from the body); others no field', async () => {
    const commits = await readCommits(repo);
    const by = new Map(commits.map((c) => [c.hash, c]));
    assert.deepEqual(by.get(hashes.revert).revertOf, [hashes.two]);
    assert.deepEqual(by.get(hashes.reapply).revertOf, [hashes.revert]);
    assert.deepEqual(by.get(hashes.bodyOnly).revertOf, [hashes.two.slice(0, 10)]);
    assert.equal(commits.filter((c) => 'revertOf' in c).length, 3);
    const stats = computeStats(commits, { today: TODAY });
    // reverted: two (full and abbreviated: one commit) and revert = 2 distinct commits.
    assert.deepEqual(stats.reverts, { total: 6, count: 3, share: 0.5, reverted: 2 });
  });

  test('reverts: false skips the read; a failing git gives no field, never an error', async () => {
    const commits = await readCommits(repo, { reverts: false });
    assert.equal(commits.some((c) => 'revertOf' in c), false);
    const fake = [{ hash: hashes.revert }];
    assert.equal(await readReverts(join(root, 'missing'), fake), fake);
    assert.equal('revertOf' in fake[0], false);
    assert.deepEqual(await readReverts(repo, []), []);
  });

  test('mergeHistories keeps revertOf', () => {
    const merged = mergeHistories([{ label: 'a', commits: [commit('Undo', 1, { revertOf: ['abcdef1'] })] }, { label: 'b', commits: [commit('x', 2)] }]);
    assert.deepEqual(merged.commits.find((c) => c.repo === 'a').revertOf, ['abcdef1']);
  });

  test('generate: stats.reverts in stats.json, recap line and wrapped.md section', async () => {
    const out = join(root, 'o1');
    const r = await generate({ path: repo, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.reverts, { total: 6, count: 3, share: 0.5, reverted: 2 });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Reverts\n\n3 commits \\\(50% of non-merge commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Reverts\s+3 commits/);
  });

  test('generate: the team read of an --author run skips the revert read', async () => {
    const calls = [];
    const { readHistory } = await import('../src/git.js');
    await generate({ path: repo, out: join(root, 'o2'), png: false, author: 'ada@example.com' }, {
      today: TODAY,
      readHistory: (p, opts) => {
        calls.push(opts);
        return readHistory(p, opts);
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].reverts, undefined);
    assert.equal(calls[1].reverts, false);
  });
});
