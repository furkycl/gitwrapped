// Fixup commits, extra coverage: edge subjects, merges, the messages card drawn whole or
// byte-identical (large counts, Turkish strings, the folded counter row), junk shapes, and
// end to end through the CLI on real temporary repos with `git commit --fixup / --squash /
// --fixup=amend:` commits: stats.json, the recap and wrapped.md, --year / --since windows,
// --author and multi-repo runs (see test/fixups.test.js for the basics).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMessages, computeStats, isFixupSubject, shownFixups } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, fixupShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import tr from '../src/i18n/tr.js';

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
const opts = (lang = 'en') => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, opts(lang)).find((c) => c.id === 'messages').spec;
const messagesSvg = (stats, lang = 'en') => buildCards(stats, opts(lang)).find((c) => c.id === 'messages').svg;
const allSvgs = (stats, lang = 'en') => buildCards(stats, opts(lang)).map((c) => `${c.id}\n${c.svg}`);
const withMessages = (stats, patch) => ({ ...stats, messages: { ...stats.messages, ...patch } });
const noFixups = (stats) => withMessages(stats, { fixups: { commits: 0, share: 0 } });

const PLAIN = ['add parser', 'fix the parser', 'wip on render', 'fixup! add parser'];
const CONV = ['feat: add parser', 'fix: the parser', 'chore: wip on render', 'fixup! feat: add parser', 'docs: x'];

describe('isFixupSubject: edge subjects', () => {
  test('counted: exactly git\'s "fixup! " / "squash! " / "amend! " prefix, nested', () => {
    for (const s of ['fixup! ', 'squash! a', 'amend! a', 'fixup!  a', 'squash! squash! a', 'fixup! Merge branch x', 'fixup! 🐛 emoji']) {
      assert.equal(isFixupSubject(s), true, JSON.stringify(s));
    }
  });

  test('not counted: other cases, glued text, other punctuation, other prefixes', () => {
    for (const s of [' fixup! a', '\tsquash! a', '   amend! a', 'fixup!', 'squash!', 'amend!', 'amend!\ta', 'fixup!\ta', 'Fixup! a', 'Squash! a', 'AMEND! a', 'fixUp! a', 'fixup!x', 'squash!a', 'amend!!', 'fixup!!', 'fixup!: a', 'fixup!-a', 'fixups! a', 'fix! a', 'fixup ! a', 'fixup', 'squash', 'amend', 'feat(x)!: fixup! a', 'Revert "fixup! a"', 'a fixup! b', '!fixup a', 'ﬁxup! a']) {
      assert.equal(isFixupSubject(s), false, JSON.stringify(s));
    }
    for (const x of [undefined, {}, [], ['fixup! a'], true, Symbol.iterator]) assert.equal(isFixupSubject(x), false);
  });
});

describe('computeMessages: fixups edge cases', () => {
  test('merge commits with fixup subjects are skipped, by parents and by subject', () => {
    const m = computeMessages([
      commit('fixup! a', 1, { parents: ['p', 'q'] }),
      commit('squash! a', 2, { parents: ['p', 'q', 'r'] }),
      commit('amend! a', 3),
      commit('a', 4),
    ]);
    // Non-merge commits: 3 and 4.
    assert.deepEqual(m.fixups, { commits: 1, share: 0.5 });
  });

  test('a root commit (no parents) still counts; a junk entry does not', () => {
    const m = computeMessages([commit('fixup! a', 1, { parents: [] }), commit('a', 2), null, 42, 'fixup! x']);
    assert.equal(m.fixups.commits, 1);
  });

  test('commits without a subject count toward the share only', () => {
    const m = computeMessages([commit('fixup! a', 1), commit('', 2), commit(undefined, 3), commit('   ', 4)]);
    assert.deepEqual(m.fixups, { commits: 1, share: 0.25 });
  });

  test('a tiny share rounds to 0 in stats.json but is shown "<1%"', () => {
    const big = [commit('fixup! a', 0), ...Array.from({ length: 2999 }, (_, i) => commit('a', i + 1))];
    const m = computeMessages(big);
    assert.equal(m.fixups.commits, 1);
    assert.equal(m.fixups.share, 0);
    // The exact ratio is kept (non-enumerably), so the shown share is "<1%", not "0%".
    assert.equal(fixupShareText(shownFixups(m.fixups)), '<1%');
    assert.deepEqual(Object.keys(m.fixups), ['commits', 'share']);
    assert.equal(JSON.stringify(m.fixups), '{"commits":1,"share":0}');
  });

  test('a single non-fixup among many: never "100%"', () => {
    const many = [...Array.from({ length: 1999 }, (_, i) => commit('fixup! a', i)), commit('a', 5000)];
    const m = computeMessages(many);
    assert.equal(m.fixups.share, 0.999);
    assert.equal(fixupShareText(shownFixups(m.fixups)), '99%');
    assert.equal(fixupShareText(shownFixups(computeMessages([commit('fixup! a', 1)]).fixups)), '100%');
  });

  test('fixup commits still count in the fix / wip / oops counters by their own words', () => {
    const m = computeMessages([commit('fixup! fix the parser', 1), commit('squash! wip', 2), commit('amend! oops', 3)]);
    assert.deepEqual(m.counts, { fix: 1, wip: 1, oops: 1 });
    assert.equal(m.fixups.commits, 3);
  });
});

describe('shownFixups: junk and stats.json shapes', () => {
  test('null for non-positive, non-finite or non-number counts', () => {
    for (const x of [{ commits: '3', share: 0.1 }, { commits: NaN }, { commits: Infinity, share: 1 }, { commits: 0.2, share: 0.1 }, [], 0, true]) assert.equal(shownFixups(x), null, JSON.stringify(x));
  });

  test('a stats.json read back (no exact ratio) uses share, clamped, never 100% short of 1', () => {
    assert.deepEqual(shownFixups({ commits: 2, share: 2 }), { commits: 2, pct: 99.9 });
    assert.deepEqual(shownFixups({ commits: 2, share: -1 }), { commits: 2, pct: 0 });
    assert.deepEqual(shownFixups({ commits: 2 }), { commits: 2, pct: 0 });
    assert.deepEqual(shownFixups({ commits: 2, share: 1 }), { commits: 2, pct: 100 });
    assert.deepEqual(shownFixups({ commits: 2.4, share: 0.5 }), { commits: 2, pct: 50 });
  });

  test('recap and wrapped.md tolerate junk without throwing and without a fixups line', () => {
    const stats = computeStats(history(PLAIN.slice(0, 3)), { today: TODAY });
    for (const fixups of [null, 'x', { commits: 'many' }, { commits: -3, share: 0.5 }]) {
      const s = withMessages(stats, { fixups });
      assert.doesNotMatch(formatSummary(s, { repoName: 'demo' }), /Fixups/);
      assert.doesNotMatch(buildMarkdown(s, opts()), /Fixup commits/);
      assert.equal(messagesSvg(s), messagesSvg(stats));
    }
  });

  test('a stats.json round trip keeps the outputs (recap, wrapped.md, cards)', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    const back = JSON.parse(buildStatsJson({ stats, repoName: 'demo' })).stats;
    assert.deepEqual(back.messages.fixups, { commits: 10, share: 0.25 });
    for (const lang of ['en', 'tr']) {
      assert.equal(formatSummary(back, { repoName: 'demo', lang }).match(/Fixup.*$/m)[0], formatSummary(stats, { repoName: 'demo', lang }).match(/Fixup.*$/m)[0]);
      assert.equal(messagesSvg(back, lang), messagesSvg(stats, lang));
    }
  });
});

describe('the messages card: drawn whole, else byte-identical', () => {
  const plain = computeStats(history(PLAIN), { today: TODAY });

  test('the segment is in the SVG (en and tr), on the fix row only', () => {
    for (const lang of ['en', 'tr']) {
      const svg = messagesSvg(plain, lang);
      assert.match(svg, />10 · 10 fixup!</, lang);
      assert.equal(svg.match(/fixup!</g).length, 1, lang);
      assert.notEqual(svg, messagesSvg(noFixups(plain), lang));
      const fix = messagesSpec(plain, lang).lines.find((r) => r.label === (lang === 'tr' ? tr.messages.fixCommits : '“fix” commits'));
      assert.equal(fix.value, '10 · 10 fixup!');
    }
  });

  test('thousands separators in the segment (en ",", tr ".")', () => {
    const s = withMessages(plain, { counts: { ...plain.messages.counts, fix: 1234 }, fixups: { commits: 1500, share: 0.3 } });
    assert.match(messagesSvg(s), />1,234 · 1,500 fixup!</);
    const t = withMessages(plain, { counts: { ...plain.messages.counts, fix: 12 }, fixups: { commits: 1500, share: 0.3 } });
    assert.match(messagesSvg(t, 'tr'), />12 · 1\.500 fixup!</);
  });

  test('large counts: the row would be cut, so the card is byte-identical to the no-fixup card', () => {
    for (const [fix, fx] of [[10000, 1000], [1e6, 1e5], [1e12, 1e12], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
      const s = withMessages(plain, { counts: { ...plain.messages.counts, fix }, fixups: { commits: fx, share: 0.5 } });
      for (const lang of ['en', 'tr']) {
        assert.equal(messagesSvg(s, lang), messagesSvg(noFixups(s), lang), `${lang} ${fix} ${fx}`);
        assert.doesNotMatch(messagesSvg(s, lang), /fixup!</);
      }
    }
  });

  test('the longer Turkish label: a count that fits in en but not in tr leaves tr byte-identical', () => {
    const s = withMessages(plain, { counts: { ...plain.messages.counts, fix: 1e6 }, fixups: { commits: 9, share: 0.1 } });
    assert.match(messagesSvg(s, 'en'), />1,000,000 · 9 fixup!</);
    assert.equal(messagesSvg(s, 'tr'), messagesSvg(noFixups(s), 'tr'));
  });

  test('a folded counter row (commit-type mix) never gets the segment: byte-identical', () => {
    const conv = computeStats(history(CONV), { today: TODAY });
    assert.ok(conv.messages.fixups.commits > 0);
    for (const lang of ['en', 'tr']) {
      const lines = messagesSpec(conv, lang).lines;
      const folded = lines.find((r) => r.label === '“fix” / “wip” / “oops”');
      assert.ok(folded, `${lang}: counters folded`);
      assert.doesNotMatch(folded.value, /fixup!/);
      assert.equal(messagesSvg(conv, lang), messagesSvg(noFixups(conv), lang), lang);
    }
  });

  test('every other card is byte-identical with or without fixups (en, tr, plain and conventional)', () => {
    const conv = computeStats(history(CONV), { today: TODAY });
    for (const s of [plain, conv]) {
      for (const lang of ['en', 'tr']) {
        const a = allSvgs(s, lang);
        const b = allSvgs(noFixups(s), lang);
        assert.equal(a.length, b.length);
        for (let i = 0; i < a.length; i++) if (!a[i].startsWith('messages\n')) assert.equal(a[i], b[i]);
      }
    }
  });

  test('the segment never displaces other rows (emoji, reverts, issue refs)', () => {
    const subjects = ['add parser ✨', 'fix the parser #12', 'wip on render', 'fixup! add parser', 'Revert "add parser"', 'tidy #12'];
    const s = computeStats(history(subjects), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const labels = (x) => messagesSpec(x, lang).lines.map((r) => r.label);
      assert.deepEqual(labels(s), labels(noFixups(s)), lang);
    }
  });
});

describe('end to end (real repos via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const base = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_EDITOR: 'true' };
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...ADA, ...extra } });
  let root;
  const when = (d) => ({ GIT_AUTHOR_DATE: `${d}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${d}T10:00:00+00:00` });
  let seq = 0;
  const touch = (dir) => writeFileSync(join(dir, `f${seq++}.txt`), `line ${seq}\n`);
  const commitMsg = (dir, date, args, who = ADA) => {
    touch(dir);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', ...args], { ...who, ...when(date) });
  };
  const init = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };
  let n = 0;
  const run = (args) => {
    const out = join(root, `out${n++}`);
    const res = spawnSync(process.execPath, [BIN, ...args, '--out', out, '--no-png', '--no-color', '--json', '--md'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const files = readdirSync(join(out, 'cards')).filter((f) => f.endsWith('.svg'));
    const cards = files.map((f) => readFileSync(join(out, 'cards', f), 'utf8'));
    return { stdout: res.stdout, json, fixups: json.stats.messages.fixups, md, svg: cards.join('\n') };
  };

  let main;
  let other;
  let clean;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-fixups-x-'));
    main = init('main');
    // 2024: one plain commit and one fixup.
    commitMsg(main, '2024-06-01', ['-m', 'add parser']);
    commitMsg(main, '2024-06-02', ['--fixup=HEAD']); // "fixup! add parser"
    // 2025: real autosquash commits made by git, plus look-alikes that must not count.
    commitMsg(main, '2025-03-01', ['-m', 'feat render']);
    commitMsg(main, '2025-03-02', ['--squash=HEAD', '-m', 'more render']); // "squash! feat render"
    commitMsg(main, '2025-03-03', ['--fixup=amend:HEAD~1']); // "amend! feat render"
    commitMsg(main, '2025-03-04', ['--cleanup=verbatim', '-m', '  fixup! indented']);
    commitMsg(main, '2025-03-05', ['-m', 'fixup!']);
    commitMsg(main, '2025-03-06', ['-m', 'Fixup! not counted']);
    commitMsg(main, '2025-03-07', ['-m', 'fixup!x not counted']);
    commitMsg(main, '2025-03-08', ['-m', 'squash!: not counted']);
    // A merge commit whose subject looks like a fixup: skipped.
    git(main, ['checkout', '-q', '-b', 'topic']);
    commitMsg(main, '2025-03-09', ['-m', 'topic work'], BOB);
    git(main, ['checkout', '-q', 'main']);
    commitMsg(main, '2025-03-10', ['-m', 'main work']);
    git(main, ['merge', '-q', '--no-ff', '-m', 'fixup! merged topic', 'topic'], when('2025-03-11'));

    other = init('other');
    commitMsg(other, '2025-04-01', ['-m', 'api start']);
    commitMsg(other, '2025-04-02', ['--fixup=HEAD'], BOB);
    commitMsg(other, '2025-04-03', ['-m', 'api more']);
    commitMsg(other, '2025-04-04', ['-m', 'api done']);

    clean = init('clean');
    commitMsg(clean, '2025-05-01', ['-m', 'fix a thing']);
    commitMsg(clean, '2025-05-02', ['-m', 'wip']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('git writes the subjects we expect (fixture sanity)', () => {
    const subjects = git(main, ['log', '--format=%s', '--first-parent', 'main']).split('\n');
    for (const s of ['fixup! add parser', 'squash! feat render', 'amend! feat render', '  fixup! indented', 'fixup!', 'fixup! merged topic']) assert.ok(subjects.includes(s), `${s} in ${JSON.stringify(subjects)}`);
  });

  test('stats.json, the recap and wrapped.md on the whole history', () => {
    const r = run([main]);
    // Non-merge commits: 12 (the merge is skipped). Fixups: fixup! add parser, squash! and
    // amend! = 3 (the indented one and the bare "fixup!" are not, as for git's autosquash).
    assert.deepEqual(r.fixups, { commits: 3, share: 0.25 });
    assert.deepEqual(Object.keys(r.fixups), ['commits', 'share']);
    assert.match(r.stdout, /Fixups +3 commits \(25% of non-merge commits\)/);
    assert.match(r.md, /## Fixup commits\n\n3 commits \\\(25% of non-merge commits\\\)\n/);
    assert.match(r.svg, / · 3 fixup!</);
  });

  test('Turkish recap and wrapped.md', () => {
    const r = run([main, '--lang', 'tr']);
    assert.match(r.stdout, /Fixup'lar +3 commit \(merge dışı commit'lerin %25 kadarı\)/);
    assert.match(r.md, /## Fixup commit'leri\n\n3 commit \\\(merge dışı commit'lerin %25 kadarı\\\)\n/);
    assert.match(r.svg, / · 3 fixup!</);
  });

  test('--year and --since windows count only the commits inside', () => {
    const y24 = run([main, '--year', '2024']);
    assert.deepEqual(y24.fixups, { commits: 1, share: 0.5 });
    assert.match(y24.stdout, /Fixups +1 commit \(50% of non-merge commits\)/);
    const y25 = run([main, '--year', '2025']);
    assert.deepEqual(y25.fixups, { commits: 2, share: 0.2 });
    const since = run([main, '--since', '2025-03-02']);
    // Inside: squash!, amend!, indented, bare, Fixup!, fixup!x, squash!:, topic, main work
    // = 9 non-merge; 2 fixups (squash! and amend!).
    assert.deepEqual(since.fixups, { commits: 2, share: 0.222 });
    assert.match(since.md, /## Fixup commits\n\n2 commits \\\(22% of non-merge commits\\\)/);
    const none = run([main, '--since', '2025-03-06', '--until', '2025-03-10']);
    assert.deepEqual(none.fixups, { commits: 0, share: 0 });
    assert.doesNotMatch(none.stdout, /Fixups/);
    assert.doesNotMatch(none.md, /Fixup commits/);
    assert.doesNotMatch(none.svg, /fixup!</);
  });

  test('--author keeps only that author\'s fixups', () => {
    const r = run([main, other, '--author', 'bob@example.com']);
    // Bob: topic work (main) and the fixup in other.
    assert.deepEqual(r.fixups, { commits: 1, share: 0.5 });
  });

  test('multi-repo runs add up', () => {
    const r = run([main, other]);
    assert.deepEqual(r.fixups, { commits: 4, share: 0.25 });
    assert.match(r.stdout, /Fixups +4 commits \(25% of non-merge commits\)/);
    const r2 = run([other, clean]);
    assert.deepEqual(r2.fixups, { commits: 1, share: 0.167 });
    assert.match(r2.md, /1 commit \\\(17% of non-merge commits\\\)/);
  });

  test('a repo without fixups: zeros in stats.json and no line, section or segment', () => {
    const r = run([clean]);
    assert.deepEqual(r.fixups, { commits: 0, share: 0 });
    assert.doesNotMatch(r.stdout, /Fixup/);
    assert.doesNotMatch(r.md, /Fixup|fixup!/);
    assert.doesNotMatch(r.svg, /fixup!/);
  });
});
