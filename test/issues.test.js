// Issue references: non-merge commits whose subject mentions an issue (`#123`, `GH-123`,
// a Jira-style `ABC-123`; not inside URLs or hashes), counted by computeIssueRefs
// (src/stats/issues.js) and shown on the messages card, in the recap, wrapped.md and
// stats.json.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories } from '../src/git.js';
import { computeIssueRefs, computeStats as computeAllStats, issueRefLabel, issueRefsInSubject, shownIssueRefs } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, issueRefsShareText, layoutCard } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
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
const refs = issueRefsInSubject;

describe('issueRefsInSubject', () => {
  test('#123: distinct, in order, squash PR numbers count', () => {
    assert.deepEqual(refs('fix #12 and #12 again, see #7'), ['#12', '#7']);
    assert.deepEqual(refs('feat: login (#34)'), ['#34']);
    assert.deepEqual(refs('#1 at the start'), ['#1']);
    assert.deepEqual(refs('closes #1234567'), ['#1234567']);
    assert.deepEqual(refs('fixes #12, #13; #14.'), ['#12', '#13', '#14']);
  });

  test('#123 boundaries: not after a word char, "/", "&" or "#"; not before a word char; no leading zero', () => {
    for (const s of ['a#1', 'issue#12', 'foo/#12', '&#123; entity', '##5', '#123abc', '#12_x', '#0', '#07', '#12345678', 'ş#3', '#3ş']) assert.deepEqual(refs(s), [], s);
    assert.deepEqual(refs('(#5)'), ['#5']);
    assert.deepEqual(refs('-#5 [#6] "#7"'), ['#5', '#6', '#7']);
  });

  test('colors and hex are digits-only: #fff, #a1b2c3d are not refs', () => {
    assert.deepEqual(refs('use #fff and #a1b2c3d, #123abc'), []);
  });

  test('GH-123 (any case) is #123', () => {
    assert.deepEqual(refs('GH-9 and gh-10, #9'), ['#9', '#10']);
    assert.deepEqual(refs('Gh-5'), ['#5']);
    for (const s of ['xgh-5', 'a.gh-5', 'gh-5a', 'gh-1.2', 'gh-0', 'path/GH-5']) assert.deepEqual(refs(s), [], s);
  });

  test('Jira-style keys: uppercase key, boundaries, versions excluded', () => {
    assert.deepEqual(refs('ABC-123: fix the login'), ['ABC-123']);
    assert.deepEqual(refs('[PROJ-7] and A1-2 and AB2C-9'), ['PROJ-7', 'A1-2', 'AB2C-9']);
    for (const s of ['abc-123', 'Abc-12', 'A-12', 'x.ABC-1', 'path/ABC-1', 'xABC-1', 'ABC-1x', 'ABC-1.2', 'ABC-1-2', 'ABC-0', '#ABC-1', 'ABCDEFGHIJK-1']) assert.deepEqual(refs(s), [], s);
    assert.deepEqual(refs('ABCDEFGHIJ-1'), ['ABCDEFGHIJ-1']);
  });

  test('the denylist: encodings, hashes, standards, advisories are not keys', () => {
    for (const s of ['UTF-8', 'SHA-256', 'ISO-8601', 'RFC-2119', 'CVE-2024', 'PEP-8', 'ES-2020', 'AES-256', 'RSA-2048', 'TLS-13', 'HTTP-2', 'COVID-19', 'CWE-79', 'ECMA-262', 'SSL-3']) assert.deepEqual(refs(`use ${s} here`), [], s);
  });

  test('URLs and www. links are skipped', () => {
    assert.deepEqual(refs('see https://github.com/a/b/issues/77#88 and www.x.com/#5'), []);
    assert.deepEqual(refs('https://jira.example.com/browse/ABC-12 for ABC-13'), ['ABC-13']);
    assert.deepEqual(refs('link http://x.y/#3 (#4)'), ['#4']);
  });

  test('hex hashes and emails are skipped', () => {
    assert.deepEqual(refs('deadbeef1-2 cafebabe12-3'), []);
    assert.deepEqual(refs('revert abc1234 #9'), ['#9']);
    assert.deepEqual(refs('thanks ABC-12@example.com'), []);
  });

  test('anything but a string → []', () => {
    for (const v of [undefined, null, 42, {}, [], '', '   ']) assert.deepEqual(refs(v), []);
  });
});

describe('computeIssueRefs', () => {
  test('counts commits once, share of non-merge commits, top by commits', () => {
    const s = computeIssueRefs([
      commit('fix #12 and #12', 1),
      commit('feat: x (#12)', 2),
      commit('ABC-7 and #3', 3),
      commit('Merge pull request #12 from x/y', 4, { parents: ['a', 'b'] }),
      commit('tidy', 5),
    ]);
    assert.deepEqual(s, { commits: 3, share: 0.75, top: { ref: '#12', commits: 2 } });
    assert.deepEqual(Object.keys(s), ['commits', 'share', 'top']);
  });

  test('merge commits are excluded, also from the denominator', () => {
    assert.equal(computeIssueRefs([commit('Merge pull request #1 from a/b', 1, { parents: ['a', 'b'] })]), null);
    assert.equal(computeIssueRefs([commit('Merge branch x', 1, { parents: undefined })]), null);
    assert.equal(computeIssueRefs([commit('#1', 1), commit('Merge pull request #2 from a/b', 2, { parents: ['a', 'b'] })]).share, 1);
  });

  test('null without any reference, for empty and junk input; never throws, never mutates', () => {
    assert.equal(computeIssueRefs([]), null);
    assert.equal(computeIssueRefs(undefined), null);
    assert.equal(computeIssueRefs('nope'), null);
    assert.equal(computeIssueRefs([commit('tidy', 1), commit('UTF-8 fix', 2)]), null);
    const input = [null, 3, 'x', { subject: 42 }, { subject: '#1' }, commit('#2', 2)];
    const copy = JSON.stringify(input);
    assert.deepEqual(computeIssueRefs(input), { commits: 2, share: 0.667, top: { ref: '#1', commits: 1 } });
    assert.equal(JSON.stringify(input), copy);
  });

  test('ties: lowest # number first, # refs before Jira keys, Jira by key then number', () => {
    assert.deepEqual(computeIssueRefs([commit('#20', 1), commit('#3', 2)]).top, { ref: '#3', commits: 1 });
    assert.deepEqual(computeIssueRefs([commit('ABC-1', 1), commit('#99', 2)]).top, { ref: '#99', commits: 1 });
    assert.deepEqual(computeIssueRefs([commit('XYZ-1', 1), commit('ABC-9', 2), commit('ABC-10', 3)]).top, { ref: 'ABC-9', commits: 1 });
    assert.deepEqual(computeIssueRefs([commit('#1', 1), commit('ABC-2', 2), commit('ABC-2 again', 3)]).top, { ref: 'ABC-2', commits: 2 });
  });

  test('share: 3 decimals, at most 0.999 short of every commit, 1 when all', () => {
    const many = (n, k) => Array.from({ length: n }, (_, i) => commit(i < k ? `#${i + 1}` : 'tidy', i));
    assert.equal(computeIssueRefs(many(3, 1)).share, 0.333);
    assert.equal(computeIssueRefs(many(2000, 1999)).share, 0.999);
    assert.equal(computeIssueRefs(many(4, 4)).share, 1);
    assert.equal(computeIssueRefs(many(3000, 1)).share, 0);
    // The exact ratio rides along for display (not in JSON).
    assert.equal(issueRefsShareText(shownIssueRefs(computeIssueRefs(many(3000, 1))), en), '<1%');
    assert.equal(issueRefsShareText(shownIssueRefs(computeIssueRefs(many(2000, 1999))), en), '99%');
    assert.equal(issueRefsShareText(shownIssueRefs(computeIssueRefs(many(4, 4))), en), '100%');
    assert.equal(JSON.stringify(computeIssueRefs(many(3, 1))), '{"commits":1,"share":0.333,"top":{"ref":"#1","commits":1}}');
  });

  test('multi-repo: # refs per repo (with a repo label on top), Jira keys shared', () => {
    const { commits } = mergeHistories([
      { label: 'web', commits: [commit('#5', 1), commit('#5 again', 2)] },
      { label: 'api', commits: [commit('#5', 3), commit('ABC-1', 4)] },
    ]);
    assert.deepEqual(computeIssueRefs(commits).top, { ref: '#5', commits: 2, repo: 'web' });
    const jira = mergeHistories([
      { label: 'web', commits: [commit('ABC-1', 1), commit('#5', 2)] },
      { label: 'api', commits: [commit('ABC-1 too', 3), commit('#5 too', 4)] },
    ]).commits;
    assert.deepEqual(computeIssueRefs(jira).top, { ref: 'ABC-1', commits: 2 });
  });

  test('computeStats puts issueRefs right after cleanups', () => {
    const keys = Object.keys(computeStats([commit('#1', 1)], { today: TODAY }));
    assert.equal(keys[keys.indexOf('cleanups') + 1], 'issueRefs');
    assert.equal(computeStats([], { today: TODAY }).issueRefs, null);
  });
});

describe('shownIssueRefs', () => {
  test('null for no object or no commits; top only with 2+ commits and a valid ref', () => {
    for (const v of [null, undefined, 3, 'x', {}, { commits: 0 }, { commits: -1 }, { commits: NaN }]) assert.equal(shownIssueRefs(v), null);
    assert.deepEqual(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 1 } }), { commits: 3, pct: 50, top: null });
    assert.deepEqual(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 2 } }), { commits: 3, pct: 50, top: { ref: '#1', commits: 2, repo: null } });
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '<b>', commits: 2 } }).top, null);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1\n', commits: 2 } }).top, null);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 9 } }).top.commits, 3);
    assert.equal(shownIssueRefs({ commits: 3, share: 2 }).pct, 99.9);
    assert.equal(shownIssueRefs({ commits: 3, share: 1 }).pct, 100);
    assert.equal(shownIssueRefs({ commits: 3, share: 'x' }).pct, 0);
  });

  test('repo label: on # refs only, emails scrubbed', () => {
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 2, repo: ' web ' } }).top.repo, 'web');
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: 'ABC-1', commits: 2, repo: 'web' } }).top.repo, null);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 2, repo: 'ada@example.com' } }).top.repo, '…');
    assert.equal(issueRefLabel({ ref: '#1', repo: 'web' }), 'web#1');
    assert.equal(issueRefLabel({ ref: 'ABC-1', repo: null }), 'ABC-1');
    assert.equal(issueRefLabel(null), '');
  });
});

describe('outputs', () => {
  const SUBJECTS = ['feat: add login (#12)', 'fix crash #128', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again GH-128', 'tidy', 'more'];
  const PLAIN = ['feat: add login', 'fix crash', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again', 'tidy', 'more'];

  test('the messages card gets an issue refs row (en + tr) that fits, the biggest commit keeps its room', () => {
    const stats = computeStats(history(SUBJECTS), { today: TODAY });
    assert.deepEqual(stats.issueRefs, { commits: 12, share: 0.3, top: { ref: '#128', commits: 8 } });
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const spec = messagesSpec(stats, lang);
      const row = spec.lines.at(-1);
      assert.match(row.label, new RegExp(`^${L.messages.issueRefsTitle(null, 0)}`));
      assert.match(row.value, new RegExp(`^12 · ${L.pct(30)}`));
      assert.ok(rowFits(row), 'drawn whole');
      assert.ok(`${row.label} ${row.value}`.includes('#128 ×8'), 'names the top issue');
      assert.equal(row.description, L.messages.issueRefsDescription(12, L.pct(30), '#128', 8));
      assert.ok(spec.lines.length <= 6);
      assert.ok(layoutCard({ ...spec, lang }).drawnCharts.length > 0, 'the biggest commit keeps its room');
      assert.ok(messagesSvg(stats, lang).includes('#128 ×8'));
    }
    assert.equal(messagesSpec(stats).lines.at(-1).label, 'Issue refs (top #128 ×8)');
    assert.equal(messagesSpec(stats, 'tr').lines.at(-1).value, '12 · %30 (#128 ×8)');
  });

  test('forms: label with the top, else value with the top, else count and share alone', () => {
    const M = en.messages;
    assert.equal(M.issueRefsTitle('#1', 2), 'Issue refs (top #1 ×2)');
    assert.equal(M.issueRefsTitle(null, 0), 'Issue refs');
    assert.equal(M.issueRefsValue(1234, '5%', '#1', 2), '1,234 · 5% (#1 ×2)');
    assert.equal(M.issueRefsValue(1234, '5%', null, 0), '1,234 · 5%');
    // A long Jira key does not fit next to the label or in the value: the short row.
    const commits = history(['LONGPROJEC-1234567 fix', 'LONGPROJEC-1234567 again', ...PLAIN.slice(2)]);
    const spec = messagesSpec(computeStats(commits, { today: TODAY }));
    const row = spec.lines.at(-1);
    assert.equal(row.label, 'Issue refs');
    assert.match(row.value, /^8 · 20%$/);
    assert.match(row.description, /most referenced: LONGPROJEC-1234567 \(8 commits\)/);
  });

  test('a top mentioned once is not shown: count and share alone', () => {
    const subjects = PLAIN.map((s, i) => (i < 3 ? `${s} #${i + 1}` : s));
    const stats = computeStats(history(subjects, 10), { today: TODAY });
    assert.deepEqual(stats.issueRefs.top, { ref: '#1', commits: 1 });
    const row = messagesSpec(stats).lines.at(-1);
    assert.deepEqual([row.label, row.value], ['Issue refs', '3 · 30%']);
    assert.doesNotMatch(formatSummary(stats, { repoName: 'demo' }), /top #/);
  });

  test('without issue references every card, the recap and wrapped.md are byte-identical', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    assert.equal(stats.issueRefs, null);
    const without = { ...stats };
    delete without.issueRefs;
    for (const lang of ['en', 'tr']) assert.equal(allSvgs(stats, lang), allSvgs(without, lang));
    assert.equal(formatSummary(stats, { repoName: 'demo' }), formatSummary(without, { repoName: 'demo' }));
    assert.equal(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), buildMarkdown(without, { repoName: 'demo', today: TODAY }));
  });

  test('the row never takes another row\'s place: other cards are unchanged, the messages card only gains it', () => {
    const stats = computeStats(history(SUBJECTS), { today: TODAY });
    const without = { ...stats, issueRefs: null };
    const a = buildCards(stats, { repoName: 'demo', today: TODAY });
    const b = buildCards(without, { repoName: 'demo', today: TODAY });
    for (let i = 0; i < a.length; i++) if (a[i].id !== 'messages') assert.equal(a[i].svg, b[i].svg, a[i].id);
    const withRow = messagesSpec(stats);
    const base = messagesSpec(without);
    const kept = (rows) => rows.map((r) => `${r.label}|${r.value ?? ''}`);
    // Every label of the base card is still there (the counters may be folded into one row).
    const folded = kept(withRow.lines).join('\n');
    for (const r of base.lines) {
      if (/“(fix|wip|oops)”/.test(r.label)) continue;
      assert.ok(folded.includes(`${r.label}|${r.value ?? ''}`), r.label);
    }
  });

  test('a full card (emoji and reverts rows) keeps its rows; the issue row is left off', () => {
    const subjects = ['✨ add login #1', ':bug: fix crash #1', 'update readme', '📝 docs', 'tidy'];
    const commits = history(subjects);
    commits[2] = commit('Revert "✨ add login"', 2);
    const stats = computeStats(commits, { today: TODAY });
    const without = { ...stats, issueRefs: null };
    const spec = messagesSpec(stats);
    const base = messagesSpec(without);
    assert.deepEqual(spec.lines.slice(0, base.lines.length).map((r) => r.label), base.lines.map((r) => r.label));
    assert.ok(spec.lines.length <= 6);
    assert.ok(!spec.lines.some((r) => /^Issue refs/.test(r.label)));
  });

  test('recap and wrapped.md lines (en + tr); the ref is escaped in Markdown', () => {
    const stats = computeStats(history(SUBJECTS), { today: TODAY });
    assert.match(formatSummary(stats, { repoName: 'demo' }), /Issue refs +12 commits \(30% of non-merge commits\) · top #128 \(8 commits\)/);
    assert.match(formatSummary(stats, { repoName: 'demo', lang: 'tr' }), /Issue atıfları +12 commit \(merge dışı commit'lerin %30 kadarı\) · en çok #128 \(8 commit\)/);
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Issue references\n\n12 commits \\\(30% of non-merge commits\\\); most referenced: \\#\u2060128 \\\(8 commits\\\)/);
    assert.doesNotMatch(md, /^#128/m);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Issue atıfları\n\n12 commit \\\(merge dışı commit'lerin %30 kadarı\\\); en çok atıf yapılan: \\#\u2060128 \\\(8 commit\\\)/);
    // wrapped.md: the section follows the cleanups (or the reverts / emoji before it).
    const lines = md.split('\n');
    assert.ok(lines.indexOf('## Issue references') > lines.indexOf('## Commit types'));
  });

  test('multi-repo top shows the repo label: "web#5"', () => {
    const { commits } = mergeHistories([
      { label: 'web', commits: [commit('#5 a', 1), commit('#5 b', 2), commit('tidy', 3)] },
      { label: 'api', commits: [commit('#5 c', 4), commit('more', 5)] },
    ]);
    const stats = computeStats(commits, { today: TODAY, repos: ['web', 'api'] });
    assert.deepEqual(stats.issueRefs.top, { ref: '#5', commits: 2, repo: 'web' });
    assert.match(formatSummary(stats, { repoName: 'demo' }), /top web#5 \(2 commits\)/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /most referenced: web\\#\u2060?5/);
  });

  test('stats.json: {commits, share, top} or null, after cleanups', () => {
    const stats = computeStats(history(SUBJECTS), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.issueRefs, { commits: 12, share: 0.3, top: { ref: '#128', commits: 8 } });
    const keys = Object.keys(doc.stats);
    assert.equal(keys[keys.indexOf('cleanups') + 1], 'issueRefs');
    const none = JSON.parse(buildStatsJson({ stats: computeStats(history(PLAIN), { today: TODAY }), repoName: 'demo' }));
    assert.equal(none.stats.issueRefs, null);
    // A JSON copy (no exact ratio) still reads the same share.
    assert.equal(issueRefsShareText(shownIssueRefs(doc.stats.issueRefs), en), '30%');
  });

  test('junk stats never throw and draw no row', () => {
    for (const junk of [{ commits: 'x' }, { commits: 3, share: NaN, top: 'x' }, { commits: Infinity }, []]) {
      const stats = { ...computeStats(history(PLAIN), { today: TODAY }), issueRefs: junk };
      assert.doesNotThrow(() => buildCards(stats, { repoName: 'demo', today: TODAY }));
      assert.doesNotThrow(() => formatSummary(stats, { repoName: 'demo' }));
      assert.doesNotThrow(() => buildMarkdown(stats, { repoName: 'demo', today: TODAY }));
    }
  });
});

describe('i18n', () => {
  test('en and tr have the same issue-reference strings', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.messages.issueRefsTitle(null, 0), 'string');
      assert.equal(typeof L.messages.issueRefsTitle('#1', 2), 'string');
      assert.equal(typeof L.messages.issueRefsValue(3, '2%', '#1', 2), 'string');
      assert.equal(typeof L.messages.issueRefsDescription(3, '2%', null, 0), 'string');
      assert.equal(typeof L.recap.issueRefs, 'string');
      assert.equal(typeof L.recap.topIssue('#1', '2 commits'), 'string');
      assert.equal(typeof L.markdown.issueRefs, 'string');
      assert.equal(typeof L.markdown.topIssue, 'string');
    }
    assert.ok(tr.recap.issueRefs.length < tr.recap.labelWidth);
    assert.ok(en.recap.issueRefs.length < en.recap.labelWidth);
  });
});

describe('git (real repo)', () => {
  let root;
  let repo;
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: '2026-03-10T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-03-10T12:00:00+00:00' };
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-issues-'));
    repo = join(root, 'app');
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: { ...process.env, ...env } });
    git(['config', 'commit.gpgsign', 'false']);
    const subjects = ['feat: login (#12)', 'fix: crash, closes #12', 'docs: see https://x.y/issues/40#41', 'chore: bump UTF-8 handling', 'ABC-7: wire the api', 'tidy'];
    subjects.forEach((s, i) => {
      writeFileSync(join(repo, 'a.txt'), `${i}\n`);
      git(['add', '-A']);
      git(['commit', '-q', '-m', s, '-m', 'Body mentions #99, which does not count.']);
    });
    git(['checkout', '-q', '-b', 'side']);
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'side work']);
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--no-ff', 'side', '-m', 'Merge pull request #13 from x/side']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.issueRefs in stats.json, recap line and wrapped.md section', async () => {
    const out = join(root, 'o1');
    const r = await generate({ path: repo, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    // 7 non-merge commits; #12 twice and ABC-7 once; the body, the URL, UTF-8 and the merge do not count.
    assert.deepEqual(doc.stats.issueRefs, { commits: 3, share: 0.429, top: { ref: '#12', commits: 2 } });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Issue references\n\n3 commits \\\(43% of non-merge commits\\\); most referenced: \\#\u206012 \\\(2 commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Issue refs\s+3 commits \(43% of non-merge commits\) · top #12 \(2 commits\)/);
  });
});
