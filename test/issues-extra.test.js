// Issue references, extra coverage: adversarial subjects, merge handling, share rounding,
// tie rules, junk input, the messages-card row never displacing other rows, en/tr strings,
// Markdown escaping and the stats.json shape (see test/issues.test.js for the basics).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistories } from '../src/git.js';
import { computeIssueRefs, computeStats as computeAllStats, issueRefLabel, issueRefsInSubject, shownIssueRefs } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, issueRefsShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
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
const refs = issueRefsInSubject;
const opts = (lang = 'en') => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, opts(lang)).find((c) => c.id === 'messages').spec;
const svgs = (stats, lang = 'en') => buildCards(stats, opts(lang)).map((c) => `${c.id}\n${c.svg}`);
const many = (n, k, ref = (i) => `#${i + 1}`) => Array.from({ length: n }, (_, i) => commit(i < k ? `fix ${ref(i)}` : 'tidy', i));

const PLAIN = ['feat: add login', 'fix crash', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again', 'tidy', 'more'];
const WITH_REFS = ['feat: add login (#12)', 'fix crash #128', 'update readme', 'refactor parser', 'docs', 'wip stuff', 'oops typo', 'fix again GH-128', 'tidy', 'more'];

describe('issueRefsInSubject: adversarial subjects', () => {
  test('URLs with #fragments are never references (any scheme, any case, in brackets)', () => {
    for (const s of [
      'https://x.io/a#12',
      'see https://x.io/a#12 now',
      'www.x.com/#5',
      'WWW.X.COM/#5',
      'HTTPS://X.IO/#9',
      'ftp://host/path#7',
      'see <https://x.io/#9>',
      '[link](https://x.io/#9)',
      '(https://x.io/#9)',
      'https://jira.example.com/browse/ABC-12',
      'https://github.com/o/r/issues/12',
      'https://github.com/o/r/pull/3#issuecomment-12',
      'x.io/a#12',
      'mailto:a@b.c#5',
    ]) assert.deepEqual(refs(s), [], s);
    // A reference after the link still counts.
    assert.deepEqual(refs('https://x.io/#9) #10'), ['#10']);
    assert.deepEqual(refs('ftp://h/#3 #4'), ['#4']);
    assert.deepEqual(refs('www.x.com/#5 and ABC-6'), ['ABC-6']);
  });

  test('HTML entities, colors and hex hashes are not references', () => {
    for (const s of ['&#123;', 'a &#123; b', '&#x7b;', '#fff', '#a1b2c3', '#1e3', 'deadbeef1-2', 'abc1234-5', '0123456789abcdef0123456789abcdef01234567', '%23 12']) assert.deepEqual(refs(s), [], s);
    assert.deepEqual(refs('revert deadbeef #5'), ['#5']);
    assert.deepEqual(refs('cherry-pick 1234abc, #5'), ['#5']);
  });

  test('encodings, digests and versions are not Jira keys', () => {
    for (const s of ['UTF-8', 'utf-8', 'UTF-16', 'SHA-1', 'SHA-256', 'sha-256', 'v1.2-3', 'v2-3', 'ABC-1.2', 'ABC-1-2', 'ABC-12.3', 'A-B-12', 'ABC-DEF-12', 'R2-D2', '2FA-1', 'X-1', 'C++-12', 'ES-6']) assert.deepEqual(refs(`bump ${s} handling`), [], s);
    // Trailing sentence punctuation is not a version.
    assert.deepEqual(refs('fixes ABC-12.'), ['ABC-12']);
    assert.deepEqual(refs('fixes ABC-12, ABC-13;'), ['ABC-12', 'ABC-13']);
    assert.deepEqual(refs('#12.'), ['#12']);
  });

  test('lowercase or mixed-case keys never count; uppercase ones do', () => {
    for (const s of ['abc-12', 'Abc-12', 'aBC-12', 'proj-7: fix']) assert.deepEqual(refs(s), [], s);
    assert.deepEqual(refs('PROJ-7: fix'), ['PROJ-7']);
  });

  test('unicode around refs: letters glue, punctuation and quotes do not', () => {
    for (const s of ['ü#12', '#12ü', '日本#12', '#12日本', 'ÜABC-12', 'ABC-12ü', 'çgh-3']) assert.deepEqual(refs(s), [], s);
    for (const s of ['«#12»', '“#12”', '‹#12›', '—#12—', '「#12」', '`#12`', '#12…']) assert.deepEqual(refs(s), ['#12'], s);
    assert.deepEqual(refs('düzeltme: giriş hatası (#12) – ABC-3 için'), ['#12', 'ABC-3']);
    assert.deepEqual(refs('✨ feat: login #7 🎉'), ['#7']);
  });

  test('squash subjects "(#12)" count, also with another ref', () => {
    assert.deepEqual(refs('feat: login (#12)'), ['#12']);
    assert.deepEqual(refs('Fix #12 (#34)'), ['#12', '#34']);
    assert.deepEqual(refs('Revert "feat: login (#12)" (#40)'), ['#12', '#40']);
  });

  test('GH-12 and #12 are the same reference, deduplicated in first-seen order', () => {
    assert.deepEqual(refs('GH-12 #12'), ['#12']);
    assert.deepEqual(refs('#12 then gh-12 then GH-12'), ['#12']);
    assert.deepEqual(refs('GH-3 #1 gh-3 ABC-1 #1 ABC-1'), ['#3', '#1', 'ABC-1']);
  });

  test('emails never yield references', () => {
    for (const s of ['x@y.com#12', 'thanks ABC-12@example.com', 'ping gh-3@x.org']) assert.deepEqual(refs(s), [], s);
    assert.deepEqual(refs('user@host.com ABC-1'), ['ABC-1']);
  });

  test('digit limits: 7 digits max, no leading zero', () => {
    assert.deepEqual(refs('ABC-1234567 #1234567 gh-1234567'), ['ABC-1234567', '#1234567']);
    for (const s of ['ABC-12345678', '#12345678', 'gh-12345678', 'ABC-012', '#012', 'gh-012']) assert.deepEqual(refs(s), [], s);
  });

  test('non-strings and whitespace-only: []', () => {
    for (const v of [undefined, null, 0, 12, true, Symbol('x'), () => '#1', ['#1'], { toString: () => '#1' }, new String('#1'), '\t\n ']) assert.deepEqual(refs(v), [], String(typeof v));
  });

  test('is pure: the same answer every call (no lastIndex leaks across calls)', () => {
    const s = 'fix #1 and ABC-2 and gh-3';
    const first = refs(s);
    for (let i = 0; i < 5; i++) assert.deepEqual(refs(s), first);
    assert.deepEqual(first, ['#1', 'ABC-2', '#3']);
  });
});

describe('computeIssueRefs: counting', () => {
  test('a commit with several refs counts once; each ref once per commit', () => {
    const s = computeIssueRefs([commit('#12 #13 #12 GH-12 gh-13', 1), commit('tidy', 2)]);
    assert.deepEqual(s, { commits: 1, share: 0.5, top: { ref: '#12', commits: 1 } });
  });

  test('GH-12 and #12 across commits add up to one issue', () => {
    const s = computeIssueRefs([commit('GH-12 start', 1), commit('#12 more', 2), commit('gh-12 done', 3), commit('#5', 4), commit('#5', 5)]);
    assert.deepEqual(s.top, { ref: '#12', commits: 3 });
    assert.equal(s.commits, 5);
    assert.equal(s.share, 1);
  });

  test('lowercase keys and URL-only refs neither count nor change the denominator', () => {
    const s = computeIssueRefs([commit('abc-12 fix', 1), commit('see https://x.io/a#12', 2), commit('ABC-12', 3), commit('UTF-8', 4)]);
    assert.deepEqual(s, { commits: 1, share: 0.25, top: { ref: 'ABC-12', commits: 1 } });
  });

  test('merges: excluded by parents (whatever the subject); by subject only without parents', () => {
    const m = (subject, i) => commit(subject, i, { parents: ['a', 'b'] });
    assert.equal(computeIssueRefs([m('fix #1', 1), m('ABC-2 octopus', 2)]), null);
    assert.deepEqual(computeIssueRefs([m('fix #1', 1), commit('fix #2', 2), commit('tidy', 3)]), { commits: 1, share: 0.5, top: { ref: '#2', commits: 1 } });
    // Without a parents array, a "Merge ..." subject is a merge (see isMergeCommit).
    assert.equal(computeIssueRefs([commit('Merge pull request #7 from a/b', 1, { parents: undefined })]), null);
    assert.equal(computeIssueRefs([commit('Merge branch \'GH-7\'', 1, { parents: undefined })]), null);
    // A single-parent commit titled "Merge ..." (e.g. squashed) is a normal commit.
    assert.deepEqual(computeIssueRefs([commit('Merge pull request #7 from a/b', 1)]), { commits: 1, share: 1, top: { ref: '#7', commits: 1 } });
    // A root commit (no parents) is a normal commit.
    assert.equal(computeIssueRefs([commit('init #1', 1, { parents: [] })]).commits, 1);
  });

  test('the body never counts (subject only)', () => {
    assert.equal(computeIssueRefs([commit('tidy', 1, { body: 'Fixes #12', message: 'tidy\n\nFixes #12' })]), null);
  });

  test('share: rounding to 3 decimals and the cap', () => {
    assert.equal(computeIssueRefs(many(1000, 999)).share, 0.999);
    assert.equal(computeIssueRefs(many(1001, 1000)).share, 0.999); // 0.999000999 → 0.999
    assert.equal(computeIssueRefs(many(2000, 1999)).share, 0.999); // 0.9995 rounds to 1, capped
    assert.equal(computeIssueRefs(many(10000, 9999)).share, 0.999);
    assert.equal(computeIssueRefs(many(5, 5)).share, 1);
    assert.equal(computeIssueRefs(many(1, 1)).share, 1);
    assert.equal(computeIssueRefs(many(3, 2)).share, 0.667);
    assert.equal(computeIssueRefs(many(8, 1)).share, 0.125);
    assert.equal(computeIssueRefs(many(2000, 1)).share, 0.001); // 0.0005 rounds up
    assert.equal(computeIssueRefs(many(2001, 1)).share, 0);
    // Merges never inflate the denominator: all non-merge commits reference → exactly 1.
    const withMerges = [...many(3, 3), commit('Merge x', 9, { parents: ['a', 'b'] })];
    assert.equal(computeIssueRefs(withMerges).share, 1);
  });

  test('shown percent: whole numbers, never 100% short of every commit, <1% for tiny', () => {
    const text = (n, k) => issueRefsShareText(shownIssueRefs(computeIssueRefs(many(n, k))), en);
    assert.equal(text(1000, 999), '99%');
    assert.equal(text(200, 199), '99%');
    assert.equal(text(5, 5), '100%');
    assert.equal(text(2001, 1), '<1%');
    assert.equal(text(3, 2), '67%');
    assert.equal(issueRefsShareText(shownIssueRefs(computeIssueRefs(many(3, 2))), tr), '%67');
  });

  test('ties: highest count wins regardless of order; then refOrder', () => {
    const a = [commit('ABC-1', 1), commit('ABC-1', 2), commit('#1', 3)];
    assert.deepEqual(computeIssueRefs(a).top, { ref: 'ABC-1', commits: 2 });
    assert.deepEqual(computeIssueRefs([...a].reverse()).top, { ref: 'ABC-1', commits: 2 });
    // # refs by number, not by string ("#9" before "#10").
    assert.deepEqual(computeIssueRefs([commit('#10', 1), commit('#9', 2)]).top.ref, '#9');
    // Jira keys: by key (plain string order), then by number.
    assert.equal(computeIssueRefs([commit('ABC-1', 1), commit('AB-1', 2)]).top.ref, 'AB-1');
    assert.equal(computeIssueRefs([commit('B-1 A1-9', 1)]).top.ref, 'A1-9'); // B-1 is not a key (1-letter)
    assert.equal(computeIssueRefs([commit('AB-1', 1), commit('A1-9', 2)]).top.ref, 'A1-9');
    assert.equal(computeIssueRefs([commit('ABC-10', 1), commit('ABC-9', 2), commit('ABC-100', 3)]).top.ref, 'ABC-9');
    // Input order never changes the answer.
    const mixed = [commit('ZZ-1', 1), commit('#300', 2), commit('#42', 3), commit('AA-5', 4)];
    for (let i = 0; i < 4; i++) {
      const rotated = [...mixed.slice(i), ...mixed.slice(0, i)];
      assert.deepEqual(computeIssueRefs(rotated).top, { ref: '#42', commits: 1 });
    }
  });

  test('multi-repo ties on the same # number go to the repo label in order', () => {
    const { commits } = mergeHistories([
      { label: 'web', commits: [commit('#5', 1)] },
      { label: 'api', commits: [commit('#5', 2)] },
    ]);
    assert.deepEqual(computeIssueRefs(commits).top, { ref: '#5', commits: 1, repo: 'api' });
    // A blank repo label is no label.
    assert.deepEqual(computeIssueRefs([commit('#5', 1, { repo: '  ' }), commit('#5', 2, { repo: '' })]).top, { ref: '#5', commits: 2 });
  });

  test('junk entries are skipped; frozen input works and is untouched', () => {
    const input = Object.freeze([null, undefined, 0, 'x #1', [], Object.freeze({ subject: '#3' }), Object.freeze(commit('#3 again', 2)), { subject: null }, { subject: 7 }]);
    // Entries that are objects count toward the denominator ([] included).
    const s = computeIssueRefs(input);
    assert.equal(s.commits, 2);
    assert.deepEqual(s.top, { ref: '#3', commits: 2 });
    for (const v of [null, undefined, 0, '', 'x', {}, { length: 2, 0: commit('#1', 1) }, new Map()]) assert.equal(computeIssueRefs(v), null);
  });

  test('stats.json shape: exactly {commits, share, top:{ref, commits}}; the exact ratio is hidden', () => {
    const s = computeIssueRefs(many(3, 2));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), { commits: 2, share: 0.667, top: { ref: '#1', commits: 1 } });
    assert.deepEqual(Object.keys(s), ['commits', 'share', 'top']);
    assert.deepEqual(Object.keys(s.top), ['ref', 'commits']);
    assert.equal(Object.getOwnPropertySymbols(s).length, 1);
    assert.equal(Object.getOwnPropertyDescriptor(s, Object.getOwnPropertySymbols(s)[0]).enumerable, false);
    // Through buildStatsJson too, with both a Jira top and null.
    const stats = computeStats(history(['ABC-1 a', 'ABC-1 b', ...PLAIN.slice(2)]), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.issueRefs, { commits: 8, share: 0.2, top: { ref: 'ABC-1', commits: 8 } });
    assert.equal(typeof doc.stats.issueRefs.share, 'number');
    assert.ok(Number.isInteger(doc.stats.issueRefs.commits));
    const none = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' }));
    assert.ok('issueRefs' in none.stats);
    assert.equal(none.stats.issueRefs, null);
  });
});

describe('shownIssueRefs: junk', () => {
  test('invalid tops are dropped, the count stays', () => {
    for (const ref of ['gh-1', 'abc-1', '#0', '#01', 'A-1', '#12345678', ' #1', 42, null, '']) {
      const r = shownIssueRefs({ commits: 4, share: 0.5, top: { ref, commits: 3 } });
      assert.equal(r.commits, 4, String(ref));
      assert.equal(r.top, null, String(ref));
    }
    assert.equal(shownIssueRefs({ commits: 4, share: 0.5, top: null }).top, null);
    assert.equal(shownIssueRefs({ commits: 4, share: 0.5, top: [] }).top, null);
  });

  test('numbers are clamped and rounded', () => {
    assert.equal(shownIssueRefs({ commits: 2.6, share: 0.5 }).commits, 3);
    assert.equal(shownIssueRefs({ commits: 3, share: -1 }).pct, 0);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.999 }).pct, 99.9);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 1.6 } }).top.commits, 2);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: 1.4 } }).top, null);
    assert.equal(shownIssueRefs({ commits: 3, share: 0.5, top: { ref: '#1', commits: '2' } }).top, null);
    assert.equal(issueRefsShareText(null, en), issueRefsShareText(undefined, en));
  });
});

describe('outputs', () => {
  test('cards are byte-identical (en + tr) when issueRefs is null, missing or junk', () => {
    const stats = computeStats(history(PLAIN), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const base = svgs({ ...stats, issueRefs: null }, lang);
      const missing = { ...stats };
      delete missing.issueRefs;
      assert.deepEqual(svgs(missing, lang), base);
      for (const junk of [undefined, 0, 'x', [], {}, { commits: 0, share: 0.5 }, { commits: -3 }, { commits: NaN }]) {
        assert.deepEqual(svgs({ ...stats, issueRefs: junk }, lang), base, `${lang} ${JSON.stringify(junk)}`);
      }
    }
  });

  test('the row never displaces a row: only appended, other cards identical (several histories, en + tr)', () => {
    const variants = [
      WITH_REFS,
      ['fix #1', 'wip #1', 'oops #2', 'fix', 'wip', 'oops', 'tidy'],
      ['feat: a (#1)', 'chore: b (#1)', 'docs: c', 'fix: d #2'],
      ['✨ add login #1', ':bug: fix crash #1', 'update readme', '📝 docs', 'tidy'],
      ['ABC-1 x', 'ABC-1 y', 'Revert "ABC-1 x"', 'tidy', 'more'],
      ['a much longer subject line that goes on and on about LONGPROJEC-1234567 and more', 'LONGPROJEC-1234567 b', 'c'],
    ];
    for (const subjects of variants) {
      const stats = computeStats(history(subjects), { today: TODAY });
      assert.ok(stats.issueRefs, subjects[0]);
      for (const lang of ['en', 'tr']) {
        const withIt = buildCards(stats, opts(lang));
        const without = buildCards({ ...stats, issueRefs: null }, opts(lang));
        assert.deepEqual(withIt.map((c) => c.id), without.map((c) => c.id), 'same card set');
        for (let i = 0; i < withIt.length; i++) if (withIt[i].id !== 'messages') assert.equal(withIt[i].svg, without[i].svg, `${lang} ${withIt[i].id}`);
        const a = messagesSpec(stats, lang).lines;
        const b = messagesSpec({ ...stats, issueRefs: null }, lang).lines;
        assert.ok(a.length <= 6);
        assert.ok(a.length === b.length || a.length === b.length + 1 || a.length === b.length - 1, `${lang} ${subjects[0]}: row count`);
        if (a.length === b.length) {
          // Either no room (identical card) or the counters folded into one row plus the issue row.
          const same = JSON.stringify(a) === JSON.stringify(b);
          if (!same) assert.match(a.at(-1).label, new RegExp(`^${lang === 'en' ? 'Issue refs' : 'Issue atıfları'}`));
        }
        if (a.length > b.length) {
          // Appended after the untouched rows.
          assert.deepEqual(a.slice(0, b.length), b);
          assert.match(a.at(-1).label, new RegExp(`^${lang === 'en' ? 'Issue refs' : 'Issue atıfları'}`));
        }
        // Every non-counter row of the base card is still there, in order.
        const isCounter = (r) => /“(fix|wip|oops)”/.test(r.label) || /“(fix|wip|oops)”/.test(r.value ?? '');
        const keptA = a.filter((r) => !/^Issue (refs|atıfları)/.test(r.label) && !isCounter(r)).map((r) => `${r.label}|${r.value}`);
        const keptB = b.filter((r) => !isCounter(r)).map((r) => `${r.label}|${r.value}`);
        // The folded counters row may itself be new; drop rows not in b only if they are the folded one.
        assert.deepEqual(keptA.filter((x) => keptB.includes(x)), keptB, `${lang} ${subjects[0]}`);
      }
    }
  });

  test('a repo label with markup is escaped in the SVG', () => {
    const { commits } = mergeHistories([
      { label: 'w<b>&"x', commits: history(['fix #5', 'more #5', ...PLAIN.slice(2)], 20) },
      { label: 'api', commits: [commit('tidy', 99)] },
    ]);
    const stats = computeStats(commits, { today: TODAY, repos: ['w<b>&"x', 'api'] });
    assert.equal(stats.issueRefs.top.repo, 'w<b>&"x');
    const svg = buildCards(stats, opts()).find((c) => c.id === 'messages').svg;
    assert.doesNotMatch(svg, /w<b>/);
    assert.doesNotMatch(svg, /&"x/);
  });

  test('wrapped.md: no line starts with "#" from a ref, and Markdown in a repo label is escaped', () => {
    const { commits } = mergeHistories([
      { label: 'my_*repo*', commits: history(['#5 fix', '#5 more', ...PLAIN.slice(2)], 20) },
      { label: 'api', commits: [commit('tidy', 99)] },
    ]);
    const stats = computeStats(commits, { today: TODAY, repos: ['my_*repo*', 'api'] });
    for (const lang of ['en', 'tr']) {
      const md = buildMarkdown(stats, opts(lang));
      const lines = md.split('\n');
      const at = lines.findIndex((l) => l === (lang === 'en' ? '## Issue references' : '## Issue atıfları'));
      assert.ok(at > 0, lang);
      const body = lines[at + 2];
      assert.doesNotMatch(body, /(^|[^\\])#\d/, 'every # is escaped');
      assert.ok(body.includes('\\#\u20605'), body);
      assert.ok(body.includes('my\\_\\*repo\\*'), body);
      for (const l of lines) assert.doesNotMatch(l, /^#\u2060?\d/);
    }
  });

  test('wrapped.md: a Jira top and singular counts (en + tr)', () => {
    const stats = computeStats([commit('ABC-7 a', 1), commit('ABC-7 b', 2), ...history(PLAIN, 6).map((c, i) => ({ ...c, hash: H(50 + i) }))], { today: TODAY });
    assert.deepEqual(stats.issueRefs, { commits: 2, share: 0.25, top: { ref: 'ABC-7', commits: 2 } });
    assert.match(buildMarkdown(stats, opts()), /## Issue references\n\n2 commits \\\(25% of non-merge commits\\\); most referenced: ABC-7 \\\(2 commits\\\)/);
    assert.match(buildMarkdown(stats, opts('tr')), /## Issue atıfları\n\n2 commit \\\(merge dışı commit'lerin %25 kadarı\\\); en çok atıf yapılan: ABC-7 \\\(2 commit\\\)/);
    const one = computeStats([commit('#3', 1), commit('tidy', 2)], { today: TODAY });
    assert.match(buildMarkdown(one, opts()), /## Issue references\n\n1 commit \\\(50% of non-merge commits\\\)\n/);
    assert.match(formatSummary(one, { repoName: 'demo' }), /Issue refs +1 commit \(50% of non-merge commits\)\n/);
  });

  test('recap: no line without refs; tr line; long repo label is shortened', () => {
    const plain = computeStats(history(PLAIN), { today: TODAY });
    assert.doesNotMatch(formatSummary(plain, { repoName: 'demo' }), /Issue refs/);
    assert.doesNotMatch(formatSummary(plain, { repoName: 'demo', lang: 'tr' }), /Issue atıfları/);
    assert.doesNotMatch(buildMarkdown(plain, opts()), /Issue references/);
    const long = 'x'.repeat(80);
    const { commits } = mergeHistories([
      { label: long, commits: [commit('#5 a', 1), commit('#5 b', 2)] },
      { label: 'api', commits: [commit('tidy', 3)] },
    ]);
    const stats = computeStats(commits, { today: TODAY, repos: [long, 'api'] });
    const line = formatSummary(stats, { repoName: 'demo' }).split('\n').find((l) => l.includes('Issue refs'));
    assert.ok(line, 'has the line');
    assert.ok(!line.includes(long), 'label shortened');
    assert.match(line, /\(2 commits\)$/);
  });

  test('en/tr strings: same shape, numbers grouped, refs passed through', () => {
    assert.equal(en.messages.issueRefsTitle('ABC-1', 1234), 'Issue refs (top ABC-1 ×1,234)');
    assert.equal(tr.messages.issueRefsTitle('#1', 2), 'Issue atıfları (en çok #1 ×2)');
    assert.equal(tr.messages.issueRefsTitle(null, 0), 'Issue atıfları');
    assert.equal(tr.messages.issueRefsValue(1234, '%5', '#1', 2), '1.234 · %5 (#1 ×2)');
    assert.equal(tr.messages.issueRefsValue(3, '%5', null, 0), '3 · %5');
    assert.equal(en.messages.issueRefsDescription(1, '5%', null, 0), '1 commit mentions an issue (5% of non-merge commits)');
    // BUG: the singular hover text reads "1 commit mention an issue"; it reaches the card spec.
    const one = computeStats([commit('fix crash #9', 1), ...PLAIN.slice(1, 8).map((s, i) => commit(s, i + 2))], { today: TODAY });
    assert.equal(messagesSpec(one).lines.at(-1).description, '1 commit mentions an issue (13% of non-merge commits)');
    assert.equal(en.messages.issueRefsDescription(2, '5%', '#9', 2), '2 commits mention an issue (5% of non-merge commits); most referenced: #9 (2 commits)');
    assert.equal(tr.messages.issueRefsDescription(2, '%5', '#9', 2), "2 commit bir issue'ya atıf yapıyor (merge dışı commit'lerin %5 kadarı); en çok atıf yapılan: #9 (2 commit)");
    assert.equal(en.recap.topIssue('#1', '2 commits'), 'top #1 (2 commits)');
    assert.equal(tr.recap.topIssue('#1', '2 commit'), 'en çok #1 (2 commit)');
    assert.equal(en.markdown.issueRefs, 'Issue references');
    assert.equal(tr.markdown.issueRefs, 'Issue atıfları');
    assert.equal(issueRefLabel({ ref: '#1', repo: null }), '#1');
    assert.equal(issueRefLabel(undefined), '');
  });
});

describe('review fixes (turn 086)', () => {
  test('version, platform and period names are not keys', () => {
    for (const s of ['X86-64', 'WIN-32', 'IE-11', 'IPV-6', 'LATIN-1', 'CP-1252', 'BASE-64', 'MD-5', 'MD5-3', 'SHA3-256', 'SHA1-1', 'Q3-2024', 'H1-2025', 'FY-2025']) {
      assert.deepEqual(issueRefsInSubject(`bump ${s} support`), [], s);
    }
    assert.deepEqual(issueRefsInSubject('X86-64 Q3-2024 and ABC-7'), ['ABC-7']);
  });

  test('a hex-looking key followed by -<digit> is a key; lowercase hashes are still skipped', () => {
    assert.deepEqual(issueRefsInSubject('ABC1234-5 key'), ['ABC1234-5']);
    assert.deepEqual(issueRefsInSubject('FACADE1-5'), ['FACADE1-5']);
    assert.deepEqual(issueRefsInSubject('cherry-pick deadbeef12 for #3'), ['#3']);
  });

  test('en hover text: singular verb for one commit', () => {
    assert.match(en.messages.issueRefsDescription(1, '5%', null, 0), /^1 commit mentions an issue/);
    assert.match(en.messages.issueRefsDescription(2, '5%', null, 0), /^2 commits mention an issue/);
  });
});

describe('audit fixes (turn 088)', () => {
  test('a reference right after "/" counts when the "/" follows another reference', () => {
    assert.deepEqual(refs('closes #12/#13'), ['#12', '#13']);
    assert.deepEqual(refs('ABC-1/ABC-2'), ['ABC-1', 'ABC-2']);
    assert.deepEqual(refs('#1/#2/#3'), ['#1', '#2', '#3']);
    assert.deepEqual(refs('GH-1/gh-2'), ['#1', '#2']);
    for (const s of ['foo/#12', 'owner/repo#12', 'path/ABC-1', 'src/ABC-1/ABC-2', 'UTF-8/#3', 'https://x.y/#12/#13']) assert.deepEqual(refs(s), [], s);
  });
});

describe('audit fixes (turn 088): edge cases', () => {
  test('chains and mixes of references after "/"', () => {
    assert.deepEqual(refs('#1/#2/#3/#4'), ['#1', '#2', '#3', '#4']);
    assert.deepEqual(refs('ABC-1/#2'), ['ABC-1', '#2']);
    assert.deepEqual(refs('#2/ABC-1'), ['#2', 'ABC-1']);
    assert.deepEqual(refs('gh-7/ABC-8'), ['#7', 'ABC-8']);
    assert.deepEqual(refs('(#12/#13)'), ['#12', '#13']);
    assert.deepEqual(refs('#12/#12'), ['#12']);
    assert.deepEqual(refs('#12 / #13'), ['#12', '#13']);
  });

  test('a "/" after a non-reference still excludes what follows it', () => {
    // The first one is after a path, so the chain never starts.
    assert.deepEqual(refs('src/ABC-1/ABC-2'), []);
    assert.deepEqual(refs('src/#1/#2/#3'), []);
    // A break in the chain: "foo" is not a reference.
    assert.deepEqual(refs('#12/foo/#13'), ['#12']);
    assert.deepEqual(refs('#12//#13'), ['#12']);
    // Not counted refs do not start a chain: "a#12", "#13abc", "UTF-8", a hex hash.
    assert.deepEqual(refs('a#12/#13'), []);
    assert.deepEqual(refs('#13abc/#14'), []);
    assert.deepEqual(refs('UTF-8/ABC-2'), []);
    assert.deepEqual(refs('deadbeef1/#14'), []);
    assert.deepEqual(refs('owner/repo#12/#13'), []);
    assert.deepEqual(refs('https://x.io/a#12/#13 and #14'), ['#14']);
  });

  test('with fixups the issue refs row may still fold the counters (documented: the segment yields), en / tr', () => {
    const s = computeStats(['fix #12', 'fix #12 again', 'fixup! fix #12', 'add x', 'wip'].map((t, i) => commit(t, i)), { today: TODAY });
    assert.equal(s.messages.fixups.commits, 1);
    for (const lang of ['en', 'tr']) {
      const lines = messagesSpec(s, lang).lines;
      assert.ok(lines.some((r) => r.label === '“fix” / “wip” / “oops”'), `${lang}: ${JSON.stringify(lines)}`);
      assert.ok(!lines.some((r) => /fixup!/.test(String(r.value))), `${lang}: ${JSON.stringify(lines)}`);
      assert.ok(lines.at(-1).label.startsWith((lang === 'en' ? en : tr).messages.issueRefsTitle(null, 0)), `${lang}: ${JSON.stringify(lines)}`);
    }
  });

  test('without fixups the issue refs row still folds the counters to make room (en, tr)', () => {
    const s = computeStats(['fix #12', 'fix #12 again', 'fixup x', 'add x', 'wip'].map((t, i) => commit(t, i)), { today: TODAY });
    assert.equal(s.messages.fixups.commits, 0);
    for (const lang of ['en', 'tr']) {
      const lines = messagesSpec(s, lang).lines;
      assert.ok(lines.some((r) => r.label === '“fix” / “wip” / “oops”'), `${lang}: ${JSON.stringify(lines)}`);
      assert.ok(lines.at(-1).label.startsWith((lang === 'en' ? en : tr).messages.issueRefsTitle(null, 0)), `${lang}: ${JSON.stringify(lines)}`);
    }
  });
});
