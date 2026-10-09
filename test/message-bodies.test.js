// Message bodies (stats.messages.bodies, src/stats/messages.js hasMessageBody /
// shownBodies, read by src/git.js readBodies): the share of non-merge commits whose
// message says anything beyond the subject (blank lines and trailers ignored), as the
// messages card's lowest-priority spare-room row, a recap line, a wrapped.md section and
// stats.json.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMessages, computeStats, hasMessageBody, shownBodies } from '../src/stats/index.js';
import { bodiesShareText, buildCards, buildCardSpecs, cardDescription, layoutCard } from '../src/cards/index.js';
import { parseBodyLog, readBodies, readCommits, readHistory } from '../src/git.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'gitwrapped.js');
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
/** `[subject, body]` pairs (or bare subjects, with an empty body) → commits carrying `body`. */
const history = (items) => items.map((x, i) => (Array.isArray(x) ? commit(x[0], i + 1, { body: x[1] }) : commit(x, i + 1, { body: '' })));
const bodiesOf = (items) => computeMessages(history(items)).bodies;
// The top words row (stats.messages.topWords, see test/top-words.test.js) comes after the
// bodies row; these tests are about the bodies row, so their stats leave it out.
const noTopWords = (s) => ({ ...s, messages: { ...s.messages, topWords: [] } });
const statsOf = (items) => noTopWords(computeStats(history(items), { today: TODAY }));
// Build output only (dist/ is ignored like the hot files): no biggest-commit panel, and a
// single subject (no "Shortest" row), so the messages card has room for both spare rows.
const roomyOf = (items) => noTopWords(computeStats(history(items).map((c, i) => ({ ...c, files: [{ path: `dist/${i}.js`, added: 3, removed: 1 }] })), { today: TODAY }));
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === 'messages').spec;
const svgs = (stats, lang = 'en') => buildCards(stats, cardOpts(lang)).map((c) => [c.id, c.svg]);
const withStat = (s, bodies) => ({ ...s, messages: { ...s.messages, bodies } });
const without = (s) => withStat(s, null);
const isRow = (r, L = en) => r?.label === L.messages.bodiesTitle || r?.label === L.messages.bodiesShortTitle;

describe('hasMessageBody: the body / trailer rule', () => {
  test('prose after the subject counts; empty and blank-only bodies do not', () => {
    assert.equal(hasMessageBody('Explain why.'), true);
    assert.equal(hasMessageBody('\n\nExplain why.\n'), true);
    for (const b of ['', '\n', '\n\n\n', '   \n\t\n', '\r\n\r\n']) assert.equal(hasMessageBody(b), false, JSON.stringify(b));
    for (const b of [undefined, null, 42, {}, ['x']]) assert.equal(hasMessageBody(b), false);
  });

  test('a body of trailers only does not count (Co-authored-by, Signed-off-by, Change-Id, …)', () => {
    for (const b of [
      'Co-authored-by: Bo <bo@x.io>',
      'Signed-off-by: Ada <ada@x.io>\n',
      'Co-authored-by: Bo <bo@x.io>\nCo-authored-by: Cy <cy@x.io>\nSigned-off-by: Ada <ada@x.io>',
      'Reviewed-by: R\nAcked-by: A\nTested-by: T\nReported-by: P\nSuggested-by: S\nHelped-by: H',
      'Change-Id: I0123456789abcdef',
      'Fixes: #12\nCloses: #13\nCc: Bo <bo@x.io>\nRefs: ABC-1\nLink: https://x.io/1\nBug: 42',
      'fixes: #3',
      'Signed-off-by:Ada', // no blank after the colon
      'Signed-off-by : Ada', // blanks before it
    ]) assert.equal(hasMessageBody(b), false, b);
    // A one-word token outside the known set reads as prose.
    assert.equal(hasMessageBody('Token : value'), true);
  });

  test('folded trailer values (continuation lines starting with a blank) stay trailers', () => {
    assert.equal(hasMessageBody('Co-authored-by: A very long name\n  <long@example.com>'), false);
    assert.equal(hasMessageBody('Signed-off-by: A\n\tcontinued'), false);
    // A continuation cannot open a paragraph.
    assert.equal(hasMessageBody('  indented prose'), true);
  });

  test('git cherry-pick -x’s note is not a body, alone or in the trailer block', () => {
    assert.equal(hasMessageBody('(cherry picked from commit 0123456789abcdef0123456789abcdef01234567)'), false);
    assert.equal(hasMessageBody('Signed-off-by: A\n(cherry picked from commit abcdef1)'), false);
    assert.equal(hasMessageBody('(cherry picked from commit xyz)'), true);
  });

  test('prose-looking "Word: text" lines count: "Note: …", "TODO: …", URLs', () => {
    assert.equal(hasMessageBody('Note: this fixes X'), true);
    assert.equal(hasMessageBody('TODO: follow up'), true);
    assert.equal(hasMessageBody('https://example.com/issue/1'), true);
  });

  test('a paragraph mixing trailers and prose is prose; trailers anywhere else are ignored', () => {
    assert.equal(hasMessageBody('Signed-off-by: A\nand then some prose'), true);
    assert.equal(hasMessageBody('Prose first.\nSigned-off-by: A'), true);
    assert.equal(hasMessageBody('Explain why.\n\nSigned-off-by: A'), true);
    assert.equal(hasMessageBody('Signed-off-by: A\n\nExplain why.'), true);
    // Trailers only, over several paragraphs: nothing beyond the subject.
    assert.equal(hasMessageBody('Change-Id: I1\n\nSigned-off-by: A\n\n\nCo-authored-by: B <b@x>'), false);
  });

  test('CRLF line endings and trailing blanks are handled', () => {
    assert.equal(hasMessageBody('Signed-off-by: A  \r\n\r\n'), false);
    assert.equal(hasMessageBody('\r\nWhy.\r\n'), true);
  });
});

describe('hasMessageBody: narrowed trailer tokens and values', () => {
  test('a hyphen alone does not make a trailer: "Follow-up: …", "Trade-offs: …" are prose', () => {
    for (const b of ['Follow-up: handle the empty case next', 'Trade-offs: slower start, less memory', 'Side-effects: none', 'Re-run: needed after the migration']) assert.equal(hasMessageBody(b), true, b);
  });

  test('other hyphenated (tool) tokens are trailers only with a reference-shaped value', () => {
    for (const b of ['Claude-Session: https://claude.ai/code/session_01ABC', 'X-Ticket: ABC-1', 'Tool-Run: 12345']) assert.equal(hasMessageBody(b), false, b);
    for (const b of ['Claude-Session: a long chat', 'X-Ticket: the login one']) assert.equal(hasMessageBody(b), true, b);
    assert.equal(hasMessageBody('Explain why.\n\nCo-Authored-By: A <a@x.io>\nClaude-Session: https://claude.ai/code/session_01ABC'), true);
    assert.equal(hasMessageBody('Co-Authored-By: A <a@x.io>\nClaude-Session: https://claude.ai/code/session_01ABC'), false);
  });

  test('people (-by) tokens and well-known hyphenated tokens take any value', () => {
    for (const b of ['Signed-off-by: Ada <ada@x.io>', 'Co-developed-by: Bo', 'reviewed-by: someone', 'Written-by: Ada', 'Change-Id: I0123', 'Reviewed-on: https://review.example/1', 'git-svn-id: svn://x/trunk@12 abc', 'Bug-Url: https://bugs/1', 'Message-Id: <a@b>']) {
      assert.equal(hasMessageBody(b), false, b);
    }
  });

  test('one-word tokens count only with reference-shaped values', () => {
    for (const b of [
      'Fixes: #12', 'Fixes: #12, #13', 'Closes: GH-12 ABC-3.', 'Refs: owner/repo#4', 'Resolves: https://x.io/i/9',
      'Fixes: 54a4f0239f2e ("KVM: MMU: make it work, really")', 'Fixes: 0123abcd', 'Bug: 12345', 'Issue: #7',
      'Cc: Bo <bo@x.io>, Cy <cy@x.io>', 'Cc: bo@x.io', 'Bcc: <bo@x.io>', 'Link: https://lore.kernel.org/r/1', 'Related: ABC-1; ABC-2',
    ]) assert.equal(hasMessageBody(b), false, b);
    for (const b of [
      'Fixes: a race where two writers collide', 'Issue: the parser crashes on empty input', 'Bug: prose about what broke',
      'Fixes: #12 and #13', 'Fixes:', 'Cc: the whole team', 'Link: see the wiki', 'Closes: 3 races',
    ]) assert.equal(hasMessageBody(b), true, b);
  });

  test('the paragraph rule holds: one prose line makes the paragraph prose', () => {
    assert.equal(hasMessageBody('Signed-off-by: A\nFixes: a race where …'), true);
    assert.equal(hasMessageBody('Fixes: #1\nSigned-off-by: A\n  folded'), false);
  });
});

describe('hasMessageBody: git revert boilerplate', () => {
  test('"This reverts commit <hash>." alone, or with trailers, is not a body', () => {
    assert.equal(hasMessageBody('This reverts commit 0123456789abcdef0123456789abcdef01234567.\n'), false);
    assert.equal(hasMessageBody('This reverts commit 0123456.\n\nSigned-off-by: A <a@x>\n'), false);
    assert.equal(hasMessageBody('  This reverts commit 0123456.  '), false);
  });

  test('the merge form, wrapped across lines however git (or an editor) wraps it', () => {
    const a = '0123456789abcdef0123456789abcdef01234567';
    const b = 'fedcba9876543210fedcba9876543210fedcba98';
    assert.equal(hasMessageBody(`This reverts commit ${a}, reversing\nchanges made to ${b}.\n`), false);
    assert.equal(hasMessageBody(`This reverts commit ${a},\n  reversing changes\nmade to ${b}.`), false);
  });

  test('an extra explanation paragraph still counts; so does text in the same paragraph', () => {
    assert.equal(hasMessageBody('This reverts commit 0123456.\n\nIt broke the build on Windows.'), true);
    assert.equal(hasMessageBody('It broke the build.\n\nThis reverts commit 0123456.'), true);
    assert.equal(hasMessageBody('This reverts commit 0123456 because it broke the build.'), true);
    assert.equal(hasMessageBody('This reverts commit 0123456.\nIt broke the build.'), true);
    assert.equal(hasMessageBody('This reverts commit xyz.'), true);
  });
});

describe('computeMessages: unknown bodies are null, not 0', () => {
  test('no commit with a boolean hasBody or a string body → null', () => {
    assert.equal(computeMessages([commit('a', 1), commit('b', 2)]).bodies, null);
    assert.equal(computeMessages([commit('a', 1, { hasBody: 'yes', body: 42 })]).bodies, null);
  });

  test('the share is over the commits whose body is known', () => {
    assert.deepEqual(computeMessages([commit('a', 1, { hasBody: true }), commit('b', 2, { hasBody: false }), commit('c', 3)]).bodies, { commits: 1, share: 0.5 });
  });

  test('null hides the row, the recap line and the wrapped.md section', () => {
    const s = computeStats([commit('a', 1), commit('b', 2)], { today: TODAY });
    assert.equal(s.messages.bodies, null);
    assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY }), /Bodies/);
    assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /Message bodies/);
    assert.equal(JSON.parse(buildStatsJson({ stats: s, repoName: 'demo' })).stats.messages.bodies, null);
  });
});

describe('parseBodyLog: CR / CRLF', () => {
  test('a record starting with "\\r\\n" or "\\r" before the hash, and CRLF bodies', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const c = 'c'.repeat(40);
    const out = `\r\n${a}\x1fWhy.\r\n\0\r${b}\x1f\r\n\r\n\0\r\n\r\n${c}\x1fSigned-off-by: A\r\n\r\n\0`;
    assert.deepEqual([...parseBodyLog(out)], [[a, true], [b, false], [c, false]]);
  });
});

describe('computeMessages: bodies', () => {
  test('{commits, share} over every non-merge commit; share rounded like fixups', () => {
    assert.deepEqual(bodiesOf([['a', 'why'], 'b', ['c', 'Signed-off-by: A'], ['d', 'how\n\nSigned-off-by: A']]), { commits: 2, share: 0.5 });
    assert.deepEqual(bodiesOf([['a', 'x'], 'b', 'c']), { commits: 1, share: 0.333 });
    assert.deepEqual(bodiesOf([['a', 'x'], ['b', 'y']]), { commits: 2, share: 1 });
    const many = [['a', 'x'], ...Array.from({ length: 1999 }, () => 'b')];
    assert.equal(bodiesOf(many).share, 0.001);
    const almost = [...Array.from({ length: 1999 }, () => ['a', 'x']), 'b'];
    assert.equal(bodiesOf(almost).share, 0.999);
  });

  test('{commits: 0, share: 0} with non-merge commits but no body; null without a non-merge commit', () => {
    assert.deepEqual(bodiesOf(['a', ['b', '\n\n'], ['c', 'Co-authored-by: B <b@x>']]), { commits: 0, share: 0 });
    assert.equal(computeMessages([]).bodies, null);
    assert.equal(computeMessages(null).bodies, null);
    assert.equal(computeMessages([commit('Merge x', 1, { parents: ['a', 'b'], body: 'why' })]).bodies, null);
  });

  test('merges are left out (numerator and denominator); a commit without a subject still counts', () => {
    const m = computeMessages([commit('Merge branch x', 1, { parents: ['a', 'b'], body: 'why' }), commit('a', 2, { body: 'why' }), commit(undefined, 3, { body: '' })]);
    assert.deepEqual(m.bodies, { commits: 1, share: 0.5 });
  });

  test('a boolean hasBody (from git.js readBodies) wins over body; otherwise body is checked', () => {
    assert.deepEqual(computeMessages([commit('a', 1, { hasBody: true }), commit('b', 2, { hasBody: false, body: 'why' }), commit('c', 3, { hasBody: 'yes', body: 'why' })]).bodies, { commits: 2, share: 0.667 });
  });

  test('the exact ratio rides along non-enumerably; stats.json keeps exactly {commits, share}, last in messages but topWords', () => {
    const s = statsOf([['a', 'x'], 'b', 'c']);
    assert.deepEqual(Object.keys(s.messages).slice(-2), ['bodies', 'topWords']);
    assert.deepEqual(Object.keys(s.messages.bodies), ['commits', 'share']);
    assert.equal(Object.getOwnPropertySymbols(s.messages.bodies).length, 1);
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo' }));
    assert.equal(JSON.stringify(doc.stats.messages.bodies), '{"commits":1,"share":0.333}');
    assert.deepEqual(Object.keys(doc.stats.messages).slice(-2), ['bodies', 'topWords']);
    const none = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' }));
    assert.equal(none.stats.messages.bodies, null);
  });
});

describe('shownBodies', () => {
  test('null for no object, no commits or malformed values', () => {
    for (const v of [null, undefined, 'x', 3, {}, { commits: 0, share: 0 }, { commits: -1 }, { commits: NaN }, { commits: '3' }]) assert.equal(shownBodies(v), null, JSON.stringify(v));
  });

  test('pct from the exact ratio, else share; below 100 unless exactly 1', () => {
    const s = statsOf([['a', 'x'], 'b', 'c']);
    assert.ok(Math.abs(shownBodies(s.messages.bodies).pct - 100 / 3) < 1e-9);
    assert.deepEqual(shownBodies({ commits: 2, share: 0.5 }), { commits: 2, pct: 50 });
    assert.deepEqual(shownBodies({ commits: 2, share: 1 }), { commits: 2, pct: 100 });
    assert.deepEqual(shownBodies({ commits: 2.4, share: 7 }), { commits: 2, pct: 99.9 });
    assert.deepEqual(shownBodies({ commits: 2, share: 'x' }), { commits: 2, pct: 0 });
    assert.equal(bodiesShareText(shownBodies({ commits: 1, share: 0.001 }), en), '<1%');
    assert.equal(bodiesShareText(shownBodies({ commits: 1, share: 0.999 }), en), '99%');
    assert.equal(bodiesShareText(shownBodies({ commits: 1, share: 0.31 }), tr), '%31');
  });
});

describe('parseBodyLog', () => {
  test('one NUL-terminated %H\\x1f%b record per commit; \\x1f, newlines and "1\\t2\\tpath" in a body are body text', () => {
    const a = 'a'.repeat(40);
    const b = 'B'.repeat(40);
    const c = 'c'.repeat(40);
    const out = `${a}\x1fwhy\x1fnot\n\n1\t2\tpath\n\0\n${b}\x1f\n\0${c}\x1fSigned-off-by: A\n\0`;
    assert.deepEqual([...parseBodyLog(out)], [[a, true], [b.toLowerCase(), false], [c, false]]);
    assert.equal(parseBodyLog('').size, 0);
    assert.equal(parseBodyLog(undefined).size, 0);
    assert.equal(parseBodyLog('zz\x1fbody\0nohash\0').size, 0);
  });
});

describe('messages card', () => {
  test('a "Message bodies" row last, after the subject length row, when there is room (en and tr)', () => {
    const s = roomyOf([['add parser', 'why'], ['add parser', ''], ['add parser', 'how']]);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const spec = messagesSpec(s, lang);
      assert.ok(isRow(spec.lines.at(-1), L), `${lang}: ${JSON.stringify(spec.lines)}`);
      assert.equal(spec.lines.at(-2).label, L.messages.subjectLengthTitle);
      assert.ok(spec.lines.length <= 6);
      assert.equal(spec.lines.at(-1).value, lang === 'en' ? '2 · 67%' : '2 · %67');
    }
    assert.match(cardDescription(messagesSpec(s)), /2 commits have a message body beyond the subject \(67% of non-merge commits\)/);
    assert.match(cardDescription(messagesSpec(s, 'tr')), /Konu satırından sonra açıklama \(gövde\) içeren: 2 commit \(merge dışı commit'lerin %67 kadarı\)/);
  });

  test('singular in English', () => {
    assert.equal(en.messages.bodiesDescription(1, '50%'), '1 commit has a message body beyond the subject (50% of non-merge commits)');
  });

  test('without the stat, with 0 commits or malformed: every card byte-identical to a run without it', () => {
    const s = roomyOf([['add parser', 'why'], 'add parser']);
    for (const lang of ['en', 'tr']) {
      const ref = svgs(without(s), lang);
      assert.notDeepEqual(svgs(s, lang), ref);
      for (const bodies of [undefined, 'x', {}, { commits: 0, share: 0 }, { commits: -2, share: 0.5 }]) {
        assert.deepEqual(svgs(withStat(s, bodies), lang), ref, JSON.stringify(bodies));
      }
    }
    // A history without bodies is the card as before.
    const plain = roomyOf(['add parser', 'add parser']);
    assert.deepEqual(plain.messages.bodies, { commits: 0, share: 0 });
    assert.deepEqual(svgs(plain), svgs(without(plain)));
  });

  test('append-only: only the messages card changes, and only by the row at its end; never displaces the subject length row', () => {
    const cases = [
      roomyOf([['add parser', 'why'], 'add parser']),
      roomyOf([['x', 'why']]),
      statsOf([['add parser', 'why'], 'tidy', ['more stuff', 'how'], 'fix it']),
      statsOf([['feat: a', 'why'], ['fix: b', 'x'], ['wip c', 'y'], ['oops', 'z'], ['Revert "x"', 'This reverts commit 0123456.'], ['✨ d #12', 'w']]),
    ];
    let drawn = 0;
    for (const s of cases) {
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
        drawn += 1;
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
    assert.ok(drawn > 0);
  });

  test('a full card (6 rows): no row, the card byte-identical', () => {
    const s = statsOf([['add parser', 'why'], 'tidy', ['more stuff', 'how']]);
    for (const lang of ['en', 'tr']) {
      assert.ok(!messagesSpec(s, lang).lines.some((r) => isRow(r, LANGS[lang])));
      assert.deepEqual(svgs(s, lang), svgs(without(s), lang));
    }
  });

  test('with the subject length row gone, the bodies row may take the spare slot', () => {
    const s = roomyOf([['add parser', 'why'], 'tidy']);
    const noSubjects = { ...s, messages: { ...s.messages, subjectLength: null } };
    const spec = messagesSpec(noSubjects);
    assert.ok(isRow(spec.lines.at(-1)), JSON.stringify(spec.lines));
    assert.ok(!spec.lines.some((r) => r.label === en.messages.subjectLengthTitle));
  });
});

describe('recap and wrapped.md', () => {
  const s = statsOf([['add parser', 'why'], 'tidy', ['more stuff', 'Signed-off-by: A'], ['fixup! add parser', 'how']]);

  test('recap "Bodies" line after the subjects line, en and tr; none without bodies', () => {
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Subjects .*\n {2}Bodies {7}2 commits \(50% of non-merge commits\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Konu satırları .*\n {2}Mesaj gövdeleri\s+2 commit \(merge dışı commit'lerin %50 kadarı\)\n/);
    assert.doesNotMatch(formatSummary(without(s), { repoName: 'demo', today: TODAY }), /Bodies/);
    assert.doesNotMatch(formatSummary(statsOf(['a', 'b']), { repoName: 'demo', today: TODAY }), /Bodies/);
  });

  test('wrapped.md "Message bodies" section after the subject length, en and tr; none without bodies', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Subject length\n\n[^\n]*\n\n## Message bodies\n\n2 commits \\\(50% of non-merge commits\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Mesaj gövdeleri\n\n2 commit \\\(merge dışı commit'lerin %50 kadarı\\\)\n/);
    assert.doesNotMatch(buildMarkdown(without(s), { repoName: 'demo', today: TODAY }), /Message bodies/);
    assert.doesNotMatch(buildMarkdown(statsOf(['a']), { repoName: 'demo', today: TODAY }), /Message bodies/);
  });
});

describe('end to end: real git', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const bob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' };
  const run = (args) => {
    const copy = { ...process.env, NO_COLOR: '1' };
    delete copy.FORCE_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { encoding: 'utf8', env: copy, cwd: ROOT });
  };
  const bodiesIn = (out) => JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.bodies);
  let root;
  let repo;
  let other;
  let day = 1;
  const next = () => `2026-03-${String(day++).padStart(2, '0')}`;
  const commitFile = (dir, rel, messages, extra = {}, flags = []) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), `${rel} ${day}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', ...flags, ...messages.flatMap((m) => ['-m', m])], { ...at(next()), ...extra });
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-bodies-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    commitFile(repo, 'src/a.js', ['feat: init']); // 03-01 subject only
    commitFile(repo, 'src/b.js', ['feat: parser', 'Explain why the parser\nis needed.']); // 03-02 body
    commitFile(repo, 'src/c.js', ['fix: typo', 'Co-authored-by: Bo <bo@example.com>']); // 03-03 trailer only
    commitFile(repo, 'src/d.js', ['chore: tidy'], {}, ['--signoff']); // 03-04 Signed-off-by only
    commitFile(repo, 'src/e.js', ['docs: note', 'Note: this fixes X', 'Signed-off-by: Ada <ada@example.com>']); // 03-05 prose + trailer
    commitFile(repo, 'src/f.js', ['line one\nline two']); // 03-06 a two-line subject paragraph (%s joins it): no body
    git(repo, ['checkout', '-q', '-b', 'side']);
    commitFile(repo, 'lib/side.js', ['side work']); // 03-07
    git(repo, ['checkout', '-q', 'main']);
    commitFile(repo, 'src/g.js', ['main work', '\n\n   \n']); // 03-08 blank body (git strips it)
    git(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'Merge side', '-m', 'A merge body that must not count.'], at(next())); // 03-09 merge
    commitFile(repo, 'docs/bob.md', ['docs: bob', 'Bob explains things.'], bob); // 03-10 Bob, body
    writeFileSync(join(repo, '.mailmap'), 'Robert <robert@example.com> <bob@example.com>\n');
    // Ada: 8 non-merge commits, 2 with a body; everyone: 9, 3; with web too: 11, 4.

    other = join(root, 'web');
    mkdirSync(other);
    git(other, ['init', '-q', '-b', 'main']);
    commitFile(other, 'index.html', ['feat: page', 'Why a page.']);
    commitFile(other, 'style.css', ['style: css']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits gives every commit hasBody; bodies: false and a failing git leave it out', async () => {
    const commits = await readCommits(repo);
    const by = Object.fromEntries(commits.map((c) => [c.subject, c.hasBody]));
    assert.deepEqual(by, {
      'feat: init': false,
      'feat: parser': true,
      'fix: typo': false,
      'chore: tidy': false,
      'docs: note': true,
      'line one line two': false,
      'side work': false,
      'main work': false,
      'Merge side': true,
      'docs: bob': true,
    });
    const skipped = (await readHistory(repo, { bodies: false })).commits;
    assert.ok(skipped.every((c) => !('hasBody' in c)));
    const fake = [{ hash: 'a'.repeat(40), subject: 'x', parents: ['p'] }];
    assert.equal(await readBodies(join(root, 'missing'), fake), fake);
    assert.ok(!('hasBody' in fake[0]));
    // Unknown is not "no body": the stat is null, not {commits: 0, share: 0}.
    assert.equal(computeMessages(fake).bodies, null);
    assert.equal(computeMessages(skipped).bodies, null);
    // A hash git does not know makes git fail: all or nothing, no commit gets the field.
    const mixed = (await readCommits(repo, { bodies: false })).slice(0, 2).concat([{ hash: 'f'.repeat(40) }]);
    await readBodies(repo, mixed);
    assert.ok(mixed.every((c) => !('hasBody' in c)));
    assert.deepEqual(await readBodies(repo, []), []);
  });

  test('stats.json, recap and wrapped.md for the whole history (merge left out)', () => {
    const out = join(root, 'all');
    const r = run([repo, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(bodiesIn(out), '{"commits":3,"share":0.333}');
    assert.match(r.stdout, /\n {2}Bodies {7}3 commits \(33% of non-merge commits\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Message bodies\n\n3 commits \\\(33% of non-merge commits\\\)\n/);
    assert.ok(readdirSync(join(out, 'cards')).some((f) => /^\d+-messages\.svg$/.test(f)));
  });

  test('the messages card for this history, deterministically: the row is drawn, or the cards are byte-identical to a run without the stat', async () => {
    const stats = computeStats(await readCommits(repo), { today: TODAY });
    assert.deepEqual(JSON.parse(JSON.stringify(stats.messages.bodies)), { commits: 3, share: 0.333 });
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, lang);
      const row = spec.lines.find((r) => isRow(r, LANGS[lang]));
      if (row) {
        assert.equal(spec.lines.at(-1), row);
        assert.match(svgs(stats, lang).find(([id]) => id === 'messages')[1], lang === 'en' ? />3 · 33%</ : />3 · %33</);
      } else {
        assert.deepEqual(svgs(stats, lang), svgs(without(stats), lang), lang);
      }
    }
  });

  test('--lang tr', () => {
    const out = join(root, 'tr');
    const r = run([repo, '--out', out, '--json', '--md', '--lang', 'tr']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Mesaj gövdeleri\s+3 commit \(merge dışı commit'lerin %33 kadarı\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /## Mesaj gövdeleri\n\n3 commit \\\(merge dışı commit'lerin %33 kadarı\\\)\n/);
    assert.equal(bodiesIn(out), '{"commits":3,"share":0.333}');
  });

  test('--author (through .mailmap) and the --since / --until window', () => {
    const ada = join(root, 'ada');
    assert.equal(run([repo, '--out', ada, '--json', '--author', 'ada@example.com']).status, 0);
    assert.equal(bodiesIn(ada), '{"commits":2,"share":0.25}');
    const robert = join(root, 'robert');
    assert.equal(run([repo, '--out', robert, '--json', '--author', 'robert@example.com']).status, 0);
    assert.equal(bodiesIn(robert), '{"commits":1,"share":1}');
    const win = join(root, 'win');
    // 03-03 .. 03-06: trailer only, signoff only, prose + trailer, two-line subject.
    assert.equal(run([repo, '--out', win, '--json', '--since', '2026-03-03', '--until', '2026-03-06']).status, 0);
    assert.equal(bodiesIn(win), '{"commits":1,"share":0.25}');
    const none = join(root, 'none');
    assert.equal(run([repo, '--out', none, '--json', '--since', '2026-03-06', '--until', '2026-03-08']).status, 0);
    assert.equal(bodiesIn(none), '{"commits":0,"share":0}');
  });

  test('several repos: counted over all of them', () => {
    const out = join(root, 'multi');
    const r = run([repo, other, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(bodiesIn(out), '{"commits":4,"share":0.364}');
  });
});

describe('end to end: reverts, the commit cap and long messages on real git', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra }, maxBuffer: 64 * 1024 * 1024 });
  let day = 1;
  const at = () => {
    const d = `2026-03-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  let root;
  let repo;
  // A long message with multi-byte characters, so records cross stdout chunk boundaries mid-character.
  const LONG = `${'Ayrıştırıcı açıklaması 🎉 '.repeat(120_000)}\n`;
  const commitMsg = (name, message) => {
    writeFileSync(join(repo, `${name}.txt`), `${name} ${day}\n`);
    git(repo, ['add', '-A']);
    const file = join(root, 'msg.txt');
    writeFileSync(file, message);
    git(repo, ['commit', '-q', '-F', file], at());
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-bodies-rev-'));
    repo = join(root, 'r');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    commitMsg('base', 'base\n');
    commitMsg('oops', 'oops\n\nExplained.\n');
    git(repo, ['revert', '--no-edit', 'HEAD'], at()); // plain git revert: boilerplate only
    git(repo, ['checkout', '-q', '-b', 'side']);
    commitMsg('side', 'side\n');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'Merge side'], at());
    git(repo, ['revert', '--no-edit', '-m', '1', 'HEAD'], at()); // a merge revert: "…, reversing\nchanges made to …"
    commitMsg('explained', 'Revert "base"\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.\n\nIt broke the build.\n');
    commitMsg('long', `long\n\n${LONG}`);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('a real `git revert --no-edit` (plain and of a merge) has no body; one with an explanation does', async () => {
    const commits = await readCommits(repo);
    const reverts = commits.filter((c) => /^Revert "/.test(c.subject));
    assert.equal(reverts.length, 3);
    const by = Object.fromEntries(commits.map((c) => [c.subject, c.hasBody]));
    assert.equal(by['Revert "oops"'], false);
    assert.equal(by['Revert "Merge side"'], false);
    assert.equal(by['Revert "base"'], true);
    assert.equal(by.long, true);
    assert.equal(by.oops, true);
    assert.equal(by.base, false);
    // The merge revert's raw body is the wrapped two-line form.
    const raw = git(repo, ['log', '-1', '--format=%b', commits.find((c) => c.subject === 'Revert "Merge side"').hash]);
    assert.match(raw, /^This reverts commit [0-9a-f]{40}, reversing\nchanges made to [0-9a-f]{40}\.\n/);
  });

  test('a multi-megabyte message streams through (only a boolean is kept)', async () => {
    const commits = await readCommits(repo);
    const long = commits.find((c) => c.subject === 'long');
    assert.equal(long.hasBody, true);
    assert.ok(!('body' in long));
  });

  test('--max-commits: only the capped commits are read and counted', async () => {
    const { commits } = await readHistory(repo, { limit: 2 });
    assert.equal(commits.length, 2);
    assert.ok(commits.every((c) => typeof c.hasBody === 'boolean'));
    // readBodies only touches the commits it is given.
    const all = await readCommits(repo, { bodies: false });
    const some = all.slice(0, 2);
    await readBodies(repo, some);
    assert.ok(some.every((c) => typeof c.hasBody === 'boolean'));
    assert.ok(all.slice(2).every((c) => !('hasBody' in c)));
    // The two newest: "long" and "Revert "base"", both with a body.
    const copy = { ...process.env, NO_COLOR: '1' };
    delete copy.FORCE_COLOR;
    const out = join(root, 'cap');
    const r = spawnSync(process.execPath, [BIN, repo, '--out', out, '--json', '--no-png', '--no-color', '--max-commits', '2'], { encoding: 'utf8', env: copy, cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.stringify(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.messages.bodies), '{"commits":2,"share":1}');
  });
});
