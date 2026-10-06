// Extra edge cases for co-authors (Co-authored-by trailers: src/git.js LOG_FORMAT /
// parseCoAuthor / mailmapCoAuthors, src/stats/coauthors.js, the team / totals card's
// pairing panel or row, the recap, wrapped.md and stats.json) written by the tester of
// loop turn 047.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mailmapCoAuthors, parseCoAuthor, parseLog, readCommits, readHistory } from '../src/git.js';
import { computeCoAuthors, computeStats, shownCoAuthors } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, COLOR_THEMES, layoutCard } from '../src/cards/index.js';
import { CARD_WIDTH, CONTENT_BOTTOM, CONTENT_TOP, measureText } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';

const TODAY = '2025-04-01';
const US = '\x1f';
const RS = '\x1e';
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)*/;

let n = 0;
function commit(author, email, coAuthors = [], extra = {}) {
  n += 1;
  const day = String(1 + (n % 28)).padStart(2, '0');
  return {
    hash: `${String(n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    author,
    email,
    date: `2025-03-${day}T10:00:00+00:00`,
    subject: `feat: change ${n}`,
    parents: ['p'],
    coAuthors,
    files: [{ path: 'src/a.js', added: 3, removed: 1, binary: false }],
    filesChanged: 1,
    linesAdded: 3,
    linesRemoved: 1,
    ...extra,
  };
}

/**
 * One `git log -z` record in LOG_FORMAT layout: the subject, then each Co-authored-by
 * value on its own line (`trailers` lists them separated by \x1e here, for brevity).
 */
const record = (trailers, subject, { hash = 'h', parents = '' } = {}) => [hash, 'A', 'a@x', '2025-01-01T00:00:00Z', parents, trailers ? `${subject}\n${trailers.split(RS).join('\n')}` : subject].join(US);

const rawTexts = (svg) => [...svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, '') }));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const texts = (svg) => rawTexts(svg).map((t) => decode(t.text));
const card = (cards, id) => cards.find((c) => c.id === id);

/** Every block inside the content area, none overlapping. */
function assertLayoutInBounds(spec, label) {
  const { blocks } = layoutCard(spec);
  for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${label}: ${b.kind} ${b.top}..${b.bottom}`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${label}: blocks ${blocks[i].kind} / ${blocks[j].kind} overlap`);
    }
  }
}

/** Every start-anchored <text> ends inside the card (measureText estimate). */
function assertTextsInside(svg, label) {
  for (const { attrs, text } of rawTexts(svg)) {
    if (/text-anchor/.test(attrs)) continue;
    const x = Number(/\bx="([\d.-]+)"/.exec(attrs)?.[1]);
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(size)) continue;
    const w = measureText(decode(text), size);
    assert.ok(x >= 0 && x + w <= CARD_WIDTH, `${label}: "${decode(text)}" (${x}+${Math.round(w)}) inside the card`);
  }
}

// --- parseCoAuthor: odd formatting ---------------------------------------------------

describe('parseCoAuthor (extra)', () => {
  test('odd spacing, unicode, a name containing @, nested brackets', () => {
    assert.deepEqual(parseCoAuthor('Ada<ada@x.io>'), { name: 'Ada', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('\tÇağrı  Şahin\t<cagri@x.tr>'), { name: 'Çağrı Şahin', email: 'cagri@x.tr' });
    assert.deepEqual(parseCoAuthor('李小龍 <lee@x.cn>'), { name: '李小龍', email: 'lee@x.cn' });
    assert.deepEqual(parseCoAuthor('bob@corp.example'), { name: 'bob@corp.example', email: '' });
    assert.deepEqual(parseCoAuthor('Ada <Lovelace> <ada@x.io>'), { name: 'Ada Lovelace', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('Ada <>'), { name: 'Ada', email: '' });
    assert.equal(parseCoAuthor('<>'), null);
    assert.equal(parseCoAuthor('< >'), null);
  });

  test('CR / LF / folded whitespace inside a value collapse to single spaces', () => {
    assert.deepEqual(parseCoAuthor('Ada\r\n  Lovelace <ada@x.io>\r'), { name: 'Ada Lovelace', email: 'ada@x.io' });
  });

  test('an unterminated "<" is not an email split; nothing throws on junk', () => {
    const r = parseCoAuthor('Ada <ada@x.io');
    assert.ok(r);
    assert.equal(r.email, '');
    for (const v of [null, 0, 42, {}, [], 'x'.repeat(100000)]) assert.doesNotThrow(() => parseCoAuthor(v));
  });
});

// --- parseLog: field boundaries --------------------------------------------------------

describe('parseLog (extra): the trailer field', () => {
  test('a subject containing \\x1f and \\x1e stays whole; co-authors unaffected', () => {
    const [c] = parseLog(`${record(`Bob <bob@x>`, `a${US}b${RS}c`)}\0`);
    assert.equal(c.subject, `a${US}b${RS}c`);
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
  });

  test('an empty subject with co-authors', () => {
    const [c] = parseLog(`${record(`Bob <bob@x>${RS}Cy <cy@x>`, '')}\0`);
    assert.equal(c.subject, '');
    assert.equal(c.coAuthors.length, 2);
  });

  test('empty values between separators are dropped', () => {
    const [c] = parseLog(`${record(`${RS}Bob <bob@x>${RS}${RS}  ${RS}`, 's')}\0`);
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
  });

  test('a record with too few fields is skipped; one without trailer lines has no co-authors', () => {
    const short = ['h', 'A', 'a@x', '2025-01-01T00:00:00Z', 'subject'].join(US);
    assert.deepEqual(parseLog(`${short}\0`), []);
    const [c] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'subject'].join(US)}\0`);
    assert.equal(c.subject, 'subject');
    assert.deepEqual(c.coAuthors, []);
  });

  test('numstat after a record with co-authors still attaches to that commit', () => {
    const out = `${record('Bob <bob@x>', 's1', { hash: 'h1' })}\0\n3\t1\ta.js\0${record('', 's2', { hash: 'h2' })}\0\n1\t0\tb.js\0`;
    const [a, b] = parseLog(out);
    assert.equal(a.hash, 'h1');
    assert.equal(a.files.length, 1);
    assert.equal(a.files[0].path, 'a.js');
    assert.deepEqual(b.coAuthors, []);
    assert.equal(b.files[0].path, 'b.js');
  });
});

// --- computeCoAuthors: more inputs ---------------------------------------------------

describe('computeCoAuthors (extra)', () => {
  test('octopus merges (3 parents) are skipped too; root commits (no parents) count', () => {
    const co = computeCoAuthors([
      commit('A', 'a@x', [{ name: 'B', email: 'b@x' }], { parents: ['1', '2', '3'] }),
      commit('A', 'a@x', [{ name: 'B', email: 'b@x' }], { parents: [] }),
    ]);
    assert.equal(co.commits, 1);
    assert.equal(co.paired, 1);
  });

  test('self by email with different case and whitespace; self by name when the author has no email', () => {
    const co = computeCoAuthors([
      commit('Ada', 'Ada@X.io', [{ name: 'Someone', email: ' ada@x.IO ' }]),
      commit('Ada  Lovelace', '', [{ name: 'ada lovelace', email: '' }]),
    ]);
    assert.equal(co.paired, 0);
    assert.equal(co.total, 0);
    assert.equal(co.share, 0);
  });

  test('the same co-author twice on one commit counts once; across commits per commit', () => {
    const b = { name: 'Bob', email: 'bob@x' };
    const co = computeCoAuthors([commit('A', 'a@x', [b, b, { ...b, email: 'BOB@X' }]), commit('A', 'a@x', [b])]);
    assert.deepEqual(co.top, [{ name: 'Bob', commits: 2 }]);
    assert.equal(co.paired, 2);
  });

  test('a name-only and an email co-author with the same name stay distinct identities', () => {
    const co = computeCoAuthors([commit('A', 'a@x', [{ name: 'Bob', email: '' }, { name: 'Bob', email: 'bob@x' }])]);
    assert.equal(co.total, 2);
  });

  test('an email-only co-author is named "Unknown" and never shows the address', () => {
    const co = computeCoAuthors([commit('A', 'a@x', [{ name: '', email: 'ghost@x.io' }])]);
    assert.deepEqual(co.top, [{ name: 'Unknown', commits: 1 }]);
    assert.doesNotMatch(JSON.stringify(co), /@/);
  });

  test('a name containing an address anywhere never leaks it', () => {
    const co = computeCoAuthors([commit('A', 'a@x', [
      { name: 'Bob (bob@corp.example)', email: '' },
      { name: 'Team <team@corp.example>', email: '' },
      { name: '<carol@corp.example>', email: '' },
    ])]);
    assert.doesNotMatch(JSON.stringify(co), /corp\.example/);
  });

  test('display name: most frequent spelling, ties alphabetical, order-independent', () => {
    const mk = (names) => names.map((name) => commit('A', 'a@x', [{ name, email: 'b@x' }]));
    assert.equal(computeCoAuthors(mk(['bob', 'Bob', 'Bob'])).top[0].name, 'Bob');
    assert.equal(computeCoAuthors(mk(['Zed', 'Bob'])).top[0].name, 'Bob');
    assert.equal(computeCoAuthors(mk(['Bob', 'Zed'])).top[0].name, 'Bob');
  });

  test('share has one decimal; malformed coAuthors fields are tolerated', () => {
    const p = { name: 'P', email: 'p@x' };
    const co = computeCoAuthors([
      commit('A', 'a@x', [p]),
      commit('A', 'a@x', 'not an array'),
      commit('A', 'a@x', [null, 3, 'x', {}]),
      commit('A', 'a@x', undefined),
    ]);
    assert.equal(co.commits, 4);
    assert.equal(co.paired, 1);
    assert.equal(co.share, 25);
    const third = computeCoAuthors([commit('A', 'a@x', [p]), commit('A', 'a@x'), commit('A', 'a@x')]);
    assert.equal(third.share, 33.3);
  });

  test('shownCoAuthors tolerates hand-written stats', () => {
    assert.equal(shownCoAuthors(null), null);
    assert.equal(shownCoAuthors({ paired: '3' }), null);
    assert.equal(shownCoAuthors({ paired: NaN }), null);
    assert.equal(shownCoAuthors({ paired: -1 }), null);
    assert.deepEqual(shownCoAuthors({ paired: 2.9, share: -5, top: 'x' }), { paired: 2, share: 0, top: null });
    assert.deepEqual(shownCoAuthors({ paired: 1, share: 10, top: [{ name: 'eve@evil.example' }] }), { paired: 1, share: 10, top: 'eve' });
  });
});

// --- cards / recap / markdown: privacy and layout -------------------------------------

describe('cards, recap and wrapped.md (extra)', () => {
  const LONG = 'Wolfeschlegelsteinhausenbergerdorff Hubert Blaine Maximilian Xerxes Ünlü-Çağlayan'.repeat(2);
  const solo = (co) => Array.from({ length: 12 }, (_, i) => commit('Ada', 'ada@x.io', i % 2 ? co : []));
  const team = (co) => Array.from({ length: 12 }, (_, i) => commit(i % 3 ? 'Bob' : 'Ada', i % 3 ? 'bob@x.io' : 'ada@x.io', i % 2 ? co : []));

  test('hand-written stats.coAuthors with an address as top name: no email on any surface', () => {
    for (const commits of [solo([]), team([])]) {
      const stats = { ...computeStats(commits, { today: TODAY }), coAuthors: { paired: 3, share: 25, top: [{ name: 'eve@evil.example says hi mallory@evil.example', commits: 3 }] } };
      for (const lang of ['en', 'tr']) {
        const cards = buildCards(stats, { repoName: 'r', today: TODAY, lang });
        for (const c of cards) {
          assert.doesNotMatch(c.svg, /evil\.example/, `${c.id} svg`);
          assert.doesNotMatch(String(c.description ?? ''), /evil\.example/, `${c.id} description`);
        }
        assert.doesNotMatch(formatSummary(stats, { repoName: 'r', today: TODAY, lang }), /evil\.example/);
        assert.doesNotMatch(buildMarkdown(stats, { repoName: 'r', today: TODAY, lang }), /evil\.example/);
      }
    }
  });

  test('a top name with an address after other text (as the name) is scrubbed on every surface', () => {
    // contributorName cuts at the first "@", so "Ada x@y" can't arrive whole; but a top
    // name in a hand-written stats.json that has no "@" yet looks like markup must be escaped.
    const stats = { ...computeStats(solo([]), { today: TODAY }), coAuthors: { paired: 2, share: 10, top: [{ name: '<script>*x*</script>', commits: 2 }] } };
    const md = buildMarkdown(stats, { repoName: 'r', today: TODAY });
    assert.doesNotMatch(md, /<script>/);
    for (const c of buildCards(stats, { repoName: 'r', today: TODAY })) assert.doesNotMatch(c.svg, /<script>/);
  });

  test('very long co-author names: team panel / totals row in bounds, no overlap, every theme, en/tr', () => {
    const who = [{ name: LONG, email: 'long@x.io' }];
    for (const [kind, commits] of [['team', team(who)], ['solo', solo(who)]]) {
      const stats = computeStats(commits, { today: TODAY });
      assert.equal(stats.coAuthors.paired, 6);
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of Object.keys(COLOR_THEMES)) {
          const label = `${kind}/${lang}/${colorTheme}`;
          const specs = buildCardSpecs(stats, { repoName: 'r', today: TODAY, lang, colorTheme });
          for (const { id, spec } of specs) assertLayoutInBounds(spec, `${label}/${id}`);
          const cards = buildCards(stats, { repoName: 'r', today: TODAY, lang, colorTheme });
          for (const id of ['totals', 'contributors']) {
            const c = card(cards, id);
            if (c) assertTextsInside(c.svg, `${label}/${id}`);
          }
          const shown = cards.map((c) => texts(c.svg).join('\n')).join('\n');
          assert.match(shown, kind === 'team' ? /paired|birlikte yazıldı/ : /Paired|Eşli/, `${label}: pairing shown somewhere`);
          assert.doesNotMatch(shown, /long@x\.io/);
        }
      }
    }
  });

  test('pairing shown at most once across the cards (team panel XOR totals row)', () => {
    for (const commits of [team([{ name: 'Cy', email: 'cy@x' }]), solo([{ name: 'Cy', email: 'cy@x' }])]) {
      const stats = computeStats(commits, { today: TODAY });
      for (const lang of ['en', 'tr']) {
        const cards = buildCards(stats, { repoName: 'r', today: TODAY, lang });
        const hits = cards.filter((c) => texts(c.svg).some((t) => /^(Paired|Eşli \(|6 commits paired|6 commit birlikte)/.test(t)));
        assert.equal(hits.length, 1, `${lang}: ${hits.map((c) => c.id)}`);
      }
    }
  });

  test('no paired commits but co-authors only on merges → byte-identical to no key, every theme', () => {
    const commits = [...team([]), commit('Ada', 'ada@x.io', [{ name: 'Cy', email: 'cy@x' }], { parents: ['a', 'b'] })];
    const stats = computeStats(commits, { today: TODAY });
    assert.equal(stats.coAuthors.paired, 0);
    const { coAuthors, ...without } = stats;
    for (const colorTheme of Object.keys(COLOR_THEMES)) {
      for (const lang of ['en', 'tr']) {
        assert.deepEqual(buildCards(stats, { repoName: 'r', today: TODAY, lang, colorTheme }), buildCards(without, { repoName: 'r', today: TODAY, lang, colorTheme }));
      }
    }
  });

  test('pairing with 1 commit uses the singular, en and tr', () => {
    const commits = [commit('Ada', 'ada@x.io', [{ name: 'Cy', email: 'cy@x' }]), commit('Ada', 'ada@x.io'), commit('Ada', 'ada@x.io')];
    const stats = computeStats(commits, { today: TODAY });
    const recap = formatSummary(stats, { repoName: 'r', today: TODAY });
    assert.match(recap, /Paired\s+1 commit \(33% of non-merge commits\) · top co-author: Cy/);
    assert.match(buildMarkdown(stats, { repoName: 'r', today: TODAY }), /\*\*Paired:\*\* 1 commit \\\(33% of non-merge commits\\\), top co-author: Cy/);
    assert.match(formatSummary(stats, { repoName: 'r', today: TODAY, lang: 'tr' }), /Birlikte yazılan\s+1 commit \(merge dışı commit'lerin %33 kadarı\)/);
  });
});

// --- real repos ---------------------------------------------------------------------

function git(dir, args, env = {}, input) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, input });
}

describe('git (real repos, extra)', () => {
  let root;
  const people = {
    ada: { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com' },
    bob: { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com' },
  };
  const make = (name, commits, mailmap) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    if (mailmap) writeFileSync(join(repo, '.mailmap'), mailmap);
    for (const [i, c] of commits.entries()) {
      const { msg, who = 'ada', date = `2025-03-${String(i + 1).padStart(2, '0')}T10:00:00+00:00`, file = `f${i}.txt` } = typeof c === 'string' ? { msg: c } : c;
      mkdirSync(join(repo, file, '..'), { recursive: true });
      writeFileSync(join(repo, file), `${i}\n`);
      git(repo, ['add', '-A']);
      // -F - keeps the message byte-exact (CR, control characters) with --cleanup=verbatim.
      git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', '-'], { ...people[who], GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, msg);
    }
    return repo;
  };
  const bySubject = (commits) => Object.fromEntries(commits.map((c) => [c.subject, c.coAuthors]));
  let odd;
  let mapped;
  let windowed;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-coauthors-extra-'));
    odd = make('odd', [
      'no email\n\nCo-authored-by: Just A Name',
      'email only\n\nCo-authored-by: <solo@example.org>',
      'spaces\n\nCo-authored-by:    Spacey    McSpace    <spacey@example.org>   ',
      'unicode\n\nCo-authored-by: Çağrı Şahin <cagri@example.org>',
      'multi\n\nSigned-off-by: Ada <ada@example.com>\nCo-authored-by: Bob <bob@example.com>\nReviewed-by: Zed <zed@example.org>\nco-authored-by: Cy <cy@example.org>',
      'folded\n\nCo-authored-by: Folded\n  Name <folded@example.org>',
      'crlf\r\n\r\nCo-authored-by: Crlf Person <crlf@example.org>\r\n',
      'non-final\n\nCo-authored-by: Early <early@example.org>\n\nJust a closing paragraph of prose.',
      'twice\n\nCo-authored-by: Bob <bob@example.com>\nCo-authored-by: Bob <BOB@example.com>',
      'self\n\nCo-authored-by: ADA <ADA@Example.com>',
      // A lone trailer line is the subject, not a trailer (git's rule): nothing paired.
      'Co-authored-by: Bob <bob@example.com>',
    ]);
    mapped = make('mapped', [
      'old bob\n\nCo-authored-by: Bobby <bob@old.example>',
      'name only map\n\nCo-authored-by: robert <robert@example.com>',
      'email only map\n\nCo-authored-by: Carol C <carol@old.example>',
      'by name+email\n\nCo-authored-by: Dee <dee@shared.example>',
      'other dee\n\nCo-authored-by: Dee Other <dee@shared.example>',
      'author alias is self\n\nCo-authored-by: Ada Alias <ada@alias.example>',
    ], [
      'Robert Smith <robert@example.com> <bob@old.example>',
      'Robert Smith <robert@example.com>',
      '<carol@new.example> <carol@old.example>',
      'Dee Real <dee@real.example> Dee <dee@shared.example>',
      'Ada <ada@example.com> <ada@alias.example>',
      '',
    ].join('\n'));
    windowed = make('win', [
      { msg: 'old\n\nCo-authored-by: Old Pal <old@example.org>', date: '2024-06-01T10:00:00+00:00' },
      { msg: 'mine\n\nCo-authored-by: Pal <pal@example.org>', date: '2025-02-01T10:00:00+00:00', file: 'vendor/x.js' },
      { msg: 'bobs\n\nCo-authored-by: Pal <pal@example.org>', who: 'bob', date: '2025-02-02T10:00:00+00:00' },
      { msg: 'merge-ish solo', date: '2025-02-03T10:00:00+00:00' },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('odd trailer formatting parses as documented', async () => {
    const c = bySubject(await readCommits(odd));
    assert.deepEqual(c['no email'], [{ name: 'Just A Name', email: '' }]);
    assert.deepEqual(c['email only'], [{ name: '', email: 'solo@example.org' }]);
    assert.deepEqual(c.spaces, [{ name: 'Spacey McSpace', email: 'spacey@example.org' }]);
    assert.deepEqual(c.unicode, [{ name: 'Çağrı Şahin', email: 'cagri@example.org' }]);
    assert.deepEqual(c.multi, [{ name: 'Bob', email: 'bob@example.com' }, { name: 'Cy', email: 'cy@example.org' }]);
    assert.deepEqual(c.folded, [{ name: 'Folded Name', email: 'folded@example.org' }]);
    assert.deepEqual(c.crlf, [{ name: 'Crlf Person', email: 'crlf@example.org' }]);
    assert.deepEqual(c['non-final'], [], 'a Co-authored-by line outside the last paragraph is not a trailer');
    assert.equal(c.twice.length, 2);
    assert.deepEqual(c['Co-authored-by: Bob <bob@example.com>'], []);
  });

  test('odd repo: counts (self, duplicates, a trailer-only message)', async () => {
    const co = computeCoAuthors(await readCommits(odd));
    assert.equal(co.commits, 11);
    // every commit but non-final and self is paired
    assert.equal(co.paired, 8);
    const bob = co.top.find((p) => p.name === 'Bob');
    assert.equal(bob.commits, 2); // multi, twice (once)
  });

  test('mailmap: email remap, name-only, email-only, name+email keyed entries, author alias = self', async () => {
    const c = bySubject(await readCommits(mapped));
    assert.deepEqual(c['old bob'], [{ name: 'Robert Smith', email: 'robert@example.com' }]);
    assert.deepEqual(c['name only map'], [{ name: 'Robert Smith', email: 'robert@example.com' }]);
    assert.deepEqual(c['email only map'], [{ name: 'Carol C', email: 'carol@new.example' }]);
    assert.deepEqual(c['by name+email'], [{ name: 'Dee Real', email: 'dee@real.example' }]);
    assert.deepEqual(c['other dee'], [{ name: 'Dee Other', email: 'dee@shared.example' }]);
    assert.deepEqual(c['author alias is self'], [{ name: 'Ada', email: 'ada@example.com' }]);
    const co = computeCoAuthors(await readCommits(mapped));
    assert.equal(co.paired, 5);
    assert.deepEqual(co.top[0], { name: 'Robert Smith', commits: 2 });
  });

  test('mailmapCoAuthors: name-only / email-only contacts survive check-mailmap; one batch for all', async () => {
    const commits = [
      { coAuthors: [{ name: 'Name Only', email: '' }, { name: '', email: 'carol@old.example' }] },
      { coAuthors: [{ name: 'Bobby', email: 'bob@old.example' }] },
      { coAuthors: [] },
      null,
    ];
    await mailmapCoAuthors(mapped, commits);
    assert.deepEqual(commits[0].coAuthors, [{ name: 'Name Only', email: '' }, { name: '', email: 'carol@new.example' }]);
    assert.deepEqual(commits[1].coAuthors, [{ name: 'Robert Smith', email: 'robert@example.com' }]);
  });

  test('mailmapCoAuthors: a non-repo directory leaves everything as written', async () => {
    const dir = join(root, 'not-a-repo');
    mkdirSync(dir);
    const commits = [{ coAuthors: [{ name: 'Bobby', email: 'bob@old.example' }] }];
    await mailmapCoAuthors(dir, commits);
    assert.deepEqual(commits[0].coAuthors, [{ name: 'Bobby', email: 'bob@old.example' }]);
  });

  test('--author: only that author\'s commits are counted', async () => {
    const { commits } = await readHistory(windowed, { author: 'bob@example.com' });
    const co = computeCoAuthors(commits);
    assert.deepEqual({ paired: co.paired, commits: co.commits }, { paired: 1, commits: 1 });
    const r = await generate({ path: windowed, out: join(root, 'oa'), png: false, json: true, author: 'ada@example.com' }, { today: TODAY });
    assert.equal(r.stats.coAuthors.commits, 3);
    assert.equal(r.stats.coAuthors.paired, 2);
  });

  test('--since / --until / --year windows', async () => {
    const y = await generate({ path: windowed, out: join(root, 'oy'), png: false, year: '2025', since: '2025-01-01', until: '2025-12-31' }, { today: TODAY });
    assert.deepEqual(y.stats.coAuthors.top, [{ name: 'Pal', commits: 2 }]);
    assert.equal(y.stats.coAuthors.paired, 2);
    const u = await generate({ path: windowed, out: join(root, 'ou'), png: false, until: '2024-12-31' }, { today: TODAY });
    assert.deepEqual(u.stats.coAuthors.top, [{ name: 'Old Pal', commits: 1 }]);
  });

  test('--exclude does not change the counts (a commit whose files are all excluded still counts)', async () => {
    const a = await generate({ path: windowed, out: join(root, 'oe1'), png: false }, { today: TODAY });
    const b = await generate({ path: windowed, out: join(root, 'oe2'), png: false, exclude: ['vendor/**'] }, { today: TODAY });
    assert.deepEqual(b.stats.coAuthors, a.stats.coAuthors);
  });

  test('multi-repo: distinct mailmaps, counts add up', async () => {
    const r = await generate({ paths: [mapped, odd], out: join(root, 'om'), png: false, json: true }, { today: TODAY });
    const one = computeCoAuthors(await readCommits(mapped));
    const two = computeCoAuthors(await readCommits(odd));
    assert.equal(r.stats.coAuthors.paired, one.paired + two.paired);
    assert.equal(r.stats.coAuthors.commits, one.commits + two.commits);
    // "Bobby <bob@old.example>" is mapped in `mapped` only; odd's Bob (bob@example.com) is separate.
    const names = r.stats.coAuthors.top.map((p) => p.name);
    assert.ok(names.includes('Robert Smith'));
    assert.ok(!names.includes('Bobby'));
  });

  test('privacy: no co-author email in stats.json, wrapped.md, recap, card SVGs or wrapped.html', async () => {
    for (const lang of ['en', 'tr']) {
      const out = join(root, `op-${lang}`);
      const r = await generate({ paths: [mapped, odd], out, png: false, json: true, md: true, lang }, { today: TODAY });
      const recap = formatSummary(r.stats, { repoName: 'x', today: TODAY, lang });
      const files = [r.statsJson, r.markdown, r.html, ...readdirSync(join(out, 'cards')).map((f) => join(out, 'cards', f))];
      const all = files.map((f) => readFileSync(f, 'utf8')).join('\n') + recap;
      for (const email of ['solo@example.org', 'spacey@example.org', 'cagri@example.org', 'cy@example.org', 'folded@example.org', 'crlf@example.org',
        'robert@example.com', 'bob@old.example', 'carol@new.example', 'carol@old.example', 'dee@real.example', 'dee@shared.example']) {
        assert.ok(!all.includes(email), `${lang}: ${email}`);
      }
      const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
      assert.doesNotMatch(JSON.stringify(doc.stats.coAuthors), EMAIL_RE);
    }
  });

  test('a Co-authored-by value containing \\x1f does not corrupt the subject or leak the email', async () => {
    const repo = make('ctrl', [`ctrl subject\n\nCo-authored-by: Evil${US}Name <evil@example.org>`]);
    const out = join(root, 'octrl');
    const r = await generate({ path: repo, out, png: false, json: true, md: true }, { today: TODAY });
    const files = [r.statsJson, r.markdown, r.html, ...readdirSync(join(out, 'cards')).map((f) => join(out, 'cards', f))];
    for (const f of files) assert.ok(!readFileSync(f, 'utf8').includes('evil@example.org'), `email in ${f}`);
    const [c] = await readCommits(repo);
    assert.equal(c.subject, 'ctrl subject');
  });

  test('a Co-authored-by value containing \\x1e is one co-author, not two', async () => {
    const repo = make('ctrl2', [`rs subject\n\nCo-authored-by: Evil${RS}Name <evil@example.org>`]);
    const [c] = await readCommits(repo);
    assert.equal(c.subject, 'rs subject');
    assert.equal(c.coAuthors.length, 1);
  });
});
