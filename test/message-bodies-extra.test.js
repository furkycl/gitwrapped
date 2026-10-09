// Extra coverage for message bodies (stats.messages.bodies): adversarial bodies for
// hasMessageBody, a property test against an independent oracle, share rounding edges,
// parseBodyLog / readBodies on bodies with odd bytes from a real repo, the CLI's
// stats.json shape, and a randomized never-displacing check of the messages card.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMessages, computeStats, hasMessageBody, shownBodies } from '../src/stats/index.js';
import { bodiesShareText, buildCardSpecs, buildCards } from '../src/cards/index.js';
import { parseBodyLog, readCommits } from '../src/git.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'gitwrapped.js');
const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`;
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

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

describe('hasMessageBody: adversarial bodies', () => {
  test('whitespace-only bodies (spaces, tabs, CR, NBSP, ideographic space) are not bodies', () => {
    for (const b of [' ', '\t', '\t\t\n\t', ' \t \n \t\n\n', '\r', '\r\n\t\r\n', ' \n　', '\n \n']) {
      assert.equal(hasMessageBody(b), false, JSON.stringify(b));
    }
  });

  test('unicode prose counts (Turkish, CJK, emoji, RTL)', () => {
    for (const b of ['Ayrıştırıcı neden gerekli: açıklama.', '修复了解析器的问题', '🎉🎉🎉', 'שלום עולם', 'Çözüm: önbellek eklendi']) {
      assert.equal(hasMessageBody(b), true, b);
    }
  });

  test('a lone "Signed-off-by:" (empty value) is a trailer; prose after a blank line is a body', () => {
    assert.equal(hasMessageBody('Signed-off-by:'), false);
    assert.equal(hasMessageBody('Signed-off-by:\n'), false);
    assert.equal(hasMessageBody('Signed-off-by:\n\nThe parser needed a rewrite because the old one\nfailed on nested input.\n'), true);
    assert.equal(hasMessageBody('Signed-off-by:\nThe parser needed a rewrite.'), true);
  });

  test('a trailer block in the middle followed by prose is a body; prose then trailers then prose too', () => {
    assert.equal(hasMessageBody('Co-authored-by: A <a@x>\nSigned-off-by: B <b@x>\n\nWhy this change.\n'), true);
    assert.equal(hasMessageBody('First.\n\nSigned-off-by: B\n\nLast.'), true);
    assert.equal(hasMessageBody('\n\nSigned-off-by: B\n\n\n\nCo-authored-by: C <c@x>\n\n'), false);
  });

  test('git revert boilerplate "This reverts commit <hex>." is not a body (like trailers); an explanation is', () => {
    assert.equal(hasMessageBody('This reverts commit 0123456789abcdef0123456789abcdef01234567.\n'), false);
    assert.equal(hasMessageBody('This reverts commit 0123456789abcdef0123456789abcdef01234567.\n\nSigned-off-by: A <a@x>\n'), false);
    assert.equal(hasMessageBody('This reverts commit 0123456789abcdef0123456789abcdef01234567.\n\nIt broke the build.\n'), true);
  });

  test('bodies with \\x1f, other control chars, or "---" separators', () => {
    assert.equal(hasMessageBody('\x1f'), true);
    assert.equal(hasMessageBody('a\x1fb\x1ec'), true);
    assert.equal(hasMessageBody('---'), true);
    assert.equal(hasMessageBody('---\n\nSigned-off-by: A'), true);
    assert.equal(hasMessageBody('\x01\x02'), true);
    // A trailer whose value carries a control char is still a trailer.
    assert.equal(hasMessageBody('Signed-off-by: A\x1fB'), false);
  });

  test('a very long body (1 MB, 50,000 lines) is handled quickly, both ways', () => {
    const prose = 'word '.repeat(200_000);
    const trailers = Array.from({ length: 50_000 }, (_, i) => `Co-authored-by: P${i} <p${i}@x.io>`).join('\n');
    const t0 = Date.now();
    assert.equal(hasMessageBody(prose), true);
    assert.equal(hasMessageBody(trailers), false);
    assert.equal(hasMessageBody(`${trailers}\n\nfinally prose`), true);
    assert.equal(hasMessageBody(`${trailers}\nfinally prose`), true);
    assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
  });

  test('never throws on odd strings', () => {
    for (const b of ['\0', '\uD800', '\n'.repeat(10_000), ':', '-:', ' : ', 'a:', '-a: b']) {
      assert.doesNotThrow(() => hasMessageBody(b), JSON.stringify(b));
      assert.equal(typeof hasMessageBody(b), 'boolean');
    }
  });
});

describe('hasMessageBody: property test against an independent oracle', () => {
  // Building blocks with a known kind: messages are made of paragraphs; a paragraph is a
  // trailer block (trailer lines, possibly folded) or contains at least one prose line.
  const TRAILERS = [
    'Signed-off-by: Ada <ada@x.io>',
    'Co-authored-by: Bo <bo@x.io>',
    'Reviewed-by: R',
    'Change-Id: I0123abcd',
    'Fixes: #12',
    'fixes:#3',
    'Cc: Bo <bo@x.io>',
    'Refs : ABC-1',
    'Link: https://x.io/a',
    '(cherry picked from commit abcdef0)',
    'Signed-off-by:',
  ];
  const FOLDS = ['  <continued@x.io>', '\tmore value'];
  const PROSE = ['Explain why.', 'Note: this fixes X', 'TODO: later', 'https://x.io', 'ünïcödé prose', '---', 'a: b c', '(cherry picked from commit zz)', '42', 'This reverts commit abcdef0 because it broke X.', 'Fixes: a race where two writers collide', 'Follow-up: later'];
  const BLANKS = ['', ' ', '\t', '  \t ', '\r'];
  const EOL = ['\n', '\r\n'];

  function generate(r) {
    const paragraphs = [];
    let expected = false;
    const n = Math.floor(r() * 4);
    for (let p = 0; p < n; p += 1) {
      const lines = [];
      const isProse = r() < 0.35;
      if (isProse) {
        expected = true;
        const len = 1 + Math.floor(r() * 3);
        const proseAt = Math.floor(r() * len);
        for (let i = 0; i < len; i += 1) lines.push(i === proseAt ? pick(r, PROSE) : pick(r, [...TRAILERS, ...PROSE]));
      } else {
        lines.push(pick(r, TRAILERS));
        const more = Math.floor(r() * 3);
        for (let i = 0; i < more; i += 1) lines.push(r() < 0.3 ? pick(r, FOLDS) : pick(r, TRAILERS));
      }
      paragraphs.push(lines.map((l) => (r() < 0.2 ? `${l}  ` : l)));
    }
    const eol = pick(r, EOL);
    const sep = () => {
      const k = 1 + Math.floor(r() * 2);
      return Array.from({ length: k }, () => pick(r, BLANKS)).join(eol);
    };
    let body = r() < 0.3 ? sep() + eol : '';
    body += paragraphs.map((ls) => ls.join(eol)).join(eol + sep() + eol);
    if (r() < 0.5) body += eol;
    return { body, expected };
  }

  test('2,000 generated bodies agree with how they were built', () => {
    const r = rng(96);
    for (let i = 0; i < 2000; i += 1) {
      const { body, expected } = generate(r);
      assert.equal(hasMessageBody(body), expected, JSON.stringify(body));
    }
  });

  // A simple reference for random character soup: any non-blank line that is neither a
  // trailer line nor a continuation of a trailer paragraph means a body.
  function reference(body) {
    // Token rule: a "-by" token or a well-known hyphenated one takes any value; a one-word
    // reference token needs a value made of references (only the shapes this soup can
    // build are modelled here: numbers, hex hashes, ABC-1 keys, separated by blanks / commas).
    const refValue = (v) => {
      const t = v.trim().replace(/\.$/, '');
      return t !== '' && t.split(/[,;]/).every((p) => p.trim() !== '' && p.trim().split(/[ \t]+/).every((w) => /^(?:\d+|[0-9a-f]{7,64}|[A-Za-z][A-Za-z0-9_]*-\d+|#\d+)$/i.test(w)));
    };
    const trailer = (l) => {
      if (/^\(cherry picked from commit [0-9a-f]{7,64}\)$/.test(l)) return true;
      const m = /^([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*)$/.exec(l);
      if (!m) return false;
      const token = m[1].toLowerCase();
      if (/^[a-z][a-z-]*-by$/.test(token) || ['change-id', 'reviewed-on', 'git-svn-id', 'bug-url', 'message-id', 'closes-bug', 'partial-bug', 'related-bug', 'depends-on'].includes(token)) return true;
      return (['cc', 'bcc', 'fixes', 'closes', 'resolves', 'refs', 'ref', 'references', 'related', 'bug', 'issue', 'link'].includes(token) || token.includes('-')) && refValue(m[2]);
    };
    const paras = [];
    let cur = [];
    for (const raw of body.split('\n')) {
      const l = raw.trimEnd();
      if (l.trim() === '') {
        if (cur.length) paras.push(cur);
        cur = [];
      } else cur.push(l);
    }
    if (cur.length) paras.push(cur);
    return paras.some((p) => !trailer(p[0]) || p.slice(1).some((l) => !trailer(l) && !/^[ \t]/.test(l)));
  }

  test('5,000 random character-soup bodies agree with a reference implementation', () => {
    const r = rng(7);
    const alphabet = ['a', 'B', '-', ':', ' ', '\t', '\n', '\n', '\r', '1', '(', ')', 'x', '\x1f', 'ğ', 'Signed-off-by', 'Fixes', 'Note'];
    for (let i = 0; i < 5000; i += 1) {
      const len = Math.floor(r() * 30);
      let body = '';
      for (let k = 0; k < len; k += 1) body += pick(r, alphabet);
      assert.equal(hasMessageBody(body), reference(body), JSON.stringify(body));
    }
  });
});

describe('computeMessages: share rounding edges', () => {
  const histOf = (withBody, total) => Array.from({ length: total }, (_, i) => commit(`s${i}`, i + 1, { hasBody: i < withBody }));

  test('1 of 1000, 999 of 1000, 1000 of 1000, 1 of 3000, 2999 of 3000, 1 of 1', () => {
    assert.deepEqual(computeMessages(histOf(1, 1000)).bodies, { commits: 1, share: 0.001 });
    assert.deepEqual(computeMessages(histOf(999, 1000)).bodies, { commits: 999, share: 0.999 });
    assert.deepEqual(computeMessages(histOf(1000, 1000)).bodies, { commits: 1000, share: 1 });
    // Rounds to 0 / 1 but must stay strictly inside (0, 1) as shown.
    const tiny = computeMessages(histOf(1, 3000)).bodies;
    assert.equal(tiny.commits, 1);
    assert.equal(tiny.share, 0);
    assert.equal(bodiesShareText(shownBodies(tiny), en), '<1%');
    const huge = computeMessages(histOf(2999, 3000)).bodies;
    assert.deepEqual(huge, { commits: 2999, share: 0.999 });
    assert.equal(bodiesShareText(shownBodies(huge), en), '99%');
    assert.deepEqual(computeMessages(histOf(1, 1)).bodies, { commits: 1, share: 1 });
    assert.equal(bodiesShareText(shownBodies(computeMessages(histOf(1, 1)).bodies), en), '100%');
  });

  test('shown text after a JSON round trip (no exact ratio) agrees with the in-memory one for typical shares', () => {
    for (const [k, n] of [[1, 3], [2, 3], [1, 1000], [999, 1000], [1, 7], [5, 8], [1000, 1000]]) {
      const b = computeMessages(histOf(k, n)).bodies;
      const plain = JSON.parse(JSON.stringify(b));
      for (const L of [en, tr]) assert.equal(bodiesShareText(shownBodies(plain), L), bodiesShareText(shownBodies(b), L), `${k}/${n}`);
    }
  });

  test('merges in between do not affect the denominator', () => {
    const h = [...histOf(1, 2), commit('Merge branch x', 99, { parents: ['a', 'b'], hasBody: true }), commit('Merge branch y', 98, { parents: undefined, body: 'why' })];
    assert.deepEqual(computeMessages(h).bodies, { commits: 1, share: 0.5 });
  });
});

describe('parseBodyLog: odd records', () => {
  test('bodies with "---", tabs, CRLF and many \\x1f; uppercase / SHA-256 hashes; leading newlines between records', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(64);
    const c = 'C'.repeat(40);
    const out = `${a}\x1f---\n\x1f\x1f\x1f\n\0\n\n${b}\x1f\t\r\n \r\n\0${c}\x1fCo-authored-by: X <x@y>\r\n\r\nWhy.\r\n\0`;
    assert.deepEqual([...parseBodyLog(out)], [[a, true], [b, false], [c.toLowerCase(), true]]);
  });
});

describe('real git: adversarial commit messages', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let root;
  let repo;
  let day = 1;
  const at = () => {
    const d = `2026-03-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  // Verbatim messages from a file, so whitespace and control characters survive.
  const commitMsg = (name, message) => {
    writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
    git(repo, ['add', '-A']);
    const file = join(root, 'msg.txt');
    writeFileSync(file, message);
    git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', file], at());
  };
  const run = (args) => {
    const copy = { ...process.env, NO_COLOR: '1' };
    delete copy.FORCE_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-color', '--no-png'], { encoding: 'utf8', env: copy, cwd: ROOT });
  };
  const longBody = Array.from({ length: 5000 }, (_, i) => `line ${i} of a very long explanation`).join('\n');
  const EXPECT = {
    ws: false,
    unicode: true,
    soblead: true,
    middle: true,
    us: true,
    dashes: true,
    long: true,
    trailers: false,
    wsprefix: false,
    reverted: false,
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-bodies-x-'));
    repo = join(root, 'r');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    commitMsg('ws', 'ws\n\n \t \n\t\t\n   \n');
    commitMsg('unicode', 'unicode\n\nAyrıştırıcı için açıklama 🎉\n');
    commitMsg('soblead', 'soblead\n\nSigned-off-by:\n\nThen a real paragraph of prose.\n');
    commitMsg('middle', 'middle\n\nCo-authored-by: Bo <bo@example.com>\n\nProse after the trailers.\n');
    commitMsg('us', 'us\n\nbody \x1f with \x1f unit separators\x1f\n');
    commitMsg('dashes', 'dashes\n\n---\n\x1f\n');
    commitMsg('long', `long\n\n${longBody}\n`);
    commitMsg('trailers', 'trailers\n\nCo-authored-by: Bo <bo@example.com>\nSigned-off-by: Ada <ada@example.com>\n');
    commitMsg('wsprefix', '\n\nwsprefix\n');
    commitMsg('reverted', 'reverted\n');
    git(repo, ['revert', '--no-edit', 'HEAD'], at());
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits sets hasBody per commit as expected; a real `git revert --no-edit` has none (boilerplate only)', async () => {
    const commits = await readCommits(repo);
    const by = Object.fromEntries(commits.map((c) => [c.subject, c.hasBody]));
    for (const [subject, want] of Object.entries(EXPECT)) assert.equal(by[subject], want, subject);
    const revert = commits.find((c) => /^Revert "reverted"/.test(c.subject));
    assert.ok(revert, JSON.stringify(Object.keys(by)));
    assert.equal(revert.hasBody, false);
    assert.equal(commits.length, Object.keys(EXPECT).length + 1);
    assert.ok(commits.every((c) => typeof c.hasBody === 'boolean'));
  });

  test('CLI --json: stats.json carries stats.messages.bodies as exactly {commits, share}, last in messages', () => {
    const out = join(root, 'out');
    const r = run([repo, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const want = Object.values(EXPECT).filter(Boolean).length; // the revert has no body
    const total = Object.keys(EXPECT).length + 1;
    const b = doc.stats.messages.bodies;
    assert.deepEqual(Object.keys(b), ['commits', 'share']);
    assert.equal(b.commits, want);
    assert.equal(b.share, Math.round((want / total) * 1000) / 1000);
    assert.deepEqual(Object.keys(doc.stats.messages).slice(-2), ['bodies', 'topWords']);
    assert.equal(typeof b.commits, 'number');
    assert.ok(Number.isInteger(b.commits));
    assert.ok(b.share > 0 && b.share < 1);
    // The recap agrees with stats.json.
    assert.match(r.stdout, new RegExp(`Bodies\\s+${want} commits \\(${Math.round((want / total) * 100)}% of non-merge commits\\)`));
  });
});

describe('messages card: never displacing (randomized)', () => {
  const SUBJECTS = [
    'fix: a',
    'feat: add parser',
    'wip',
    'oops',
    'fixup! feat: add parser',
    'chore(deps): bump lodash from 4.17.20 to 4.17.21',
    'a'.repeat(90),
    'Refactor the entire rendering pipeline to support themes and languages',
    '✨ sparkle #12',
    'Revert "x"',
    'tidy',
    'Merge branch x',
  ];
  const isRow = (r, L) => r?.label === L.messages.bodiesTitle || r?.label === L.messages.bodiesShortTitle;
  const specOf = (s, lang) => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages')?.spec;

  test('300 random histories × en/tr: rows without bodies are a prefix of rows with them, same order; only the bodies row may be added', () => {
    const r = rng(2026);
    let drawn = 0;
    let skipped = 0;
    for (let i = 0; i < 300; i += 1) {
      const n = 1 + Math.floor(r() * 12);
      const dist = r() < 0.5;
      const h = Array.from({ length: n }, (_, k) => {
        const subject = pick(r, SUBJECTS);
        const isMerge = subject.startsWith('Merge');
        return commit(subject, k + 1, {
          hasBody: r() < 0.5,
          parents: isMerge ? ['a', 'b'] : ['p'],
          files: [{ path: dist ? `dist/${k}.js` : pick(r, ['src/a.js', 'src/b.js', 'package.json', 'README.md']), added: Math.floor(r() * 300), removed: Math.floor(r() * 50) }],
        });
      });
      const s = computeStats(h, { today: TODAY });
      const base = { ...s, messages: { ...s.messages, bodies: null } };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const a = specOf(s, lang);
        const b = specOf(base, lang);
        if (!a || !b) {
          assert.equal(Boolean(a), Boolean(b));
          skipped += 1;
          continue;
        }
        assert.ok(!b.lines.some((row) => isRow(row, L)));
        assert.deepEqual(a.lines.slice(0, b.lines.length), b.lines, `${lang} #${i}`);
        const extra = a.lines.slice(b.lines.length);
        assert.ok(extra.length <= 1, `${lang} #${i}: ${JSON.stringify(extra)}`);
        if (extra.length) {
          drawn += 1;
          assert.ok(isRow(extra[0], L));
          assert.ok(shownBodies(s.messages.bodies));
        }
        const { lines: _a, ...restA } = a;
        const { lines: _b, ...restB } = b;
        assert.deepEqual(restA, restB, `${lang} #${i}`);
      }
    }
    assert.ok(drawn >= 5, `drawn ${drawn}, skipped ${skipped}`);
  });

  test('other cards are byte-identical with and without the stat on random histories', () => {
    const r = rng(11);
    for (let i = 0; i < 25; i += 1) {
      const h = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, k) => commit(pick(r, SUBJECTS.slice(0, -1)), k + 1, { hasBody: r() < 0.6 }));
      const s = computeStats(h, { today: TODAY });
      const base = { ...s, messages: { ...s.messages, bodies: null } };
      const a = buildCards(s, { repoName: 'demo', today: TODAY });
      const b = buildCards(base, { repoName: 'demo', today: TODAY });
      assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
      for (const [k, c] of a.entries()) if (c.id !== 'messages') assert.equal(c.svg, b[k].svg, c.id);
    }
  });
});
