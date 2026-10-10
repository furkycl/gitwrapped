// The pre-1.17.0 audit: (1) scrubEmails (privacy.js) took time quadratic in the length of a
// run with no delimiter character and no "@" (the EMAIL regex was retried from every
// character of it), so a 30,000-character subject took about a second and a
// 1,000,000-character one many minutes; the
// typo fixes, bot names, shrinker paths and every other output go through it. A match now
// only starts where a token does, with exactly the same results. (2) The cards decided where
// the dependency-bumps, rewritten-commits and bot-commits rows go many times per build (each
// decision rebuilt the totals and message cards below it, and both cards asked every
// decision above theirs); each is now made once per (build context, stats) pair. (3) The
// issue references cut URLs with /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*/giu, retried from
// every letter of an "a-a-a-…" run (a 200,000-character subject took over 20 s); cutUrls in
// issues.js gives exactly the same result in linear time. The
// unit-level pins for the 1.17 features live in biggest-shrinker*.test.js,
// bot-commits*.test.js and typo-fixes*.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scrubEmails } from '../src/privacy.js';
import { computeStats, isTypoFixSubject } from '../src/stats/index.js';
import { botsCard, buildCardSpecs, depBumpsCard, rewrittenCard, withoutPlacementCache } from '../src/cards/index.js';
import { cutUrls, issueRefsInSubject } from '../src/stats/issues.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

/** The EMAIL regex as it was before the fix: the reference for the same results. */
const OLD_EMAIL = /[^\s<>()[\]"'`,;:|/\\@]+@(?=\p{L})[^\s<>()[\]"'`,;:|/\\@]+/gu;

describe('scrubEmails is linear and unchanged', () => {
  test('long runs without whitespace are scrubbed quickly', () => {
    // Before the fix, a 100,000-character run took about 10 s; now a few ms.
    for (const s of ['x'.repeat(100_000), 'a.'.repeat(50_000), 'x-y+z.'.repeat(16_000), 'ab12'.repeat(25_000)]) {
      const t = performance.now();
      assert.equal(scrubEmails(s), s);
      assert.ok(performance.now() - t < 1500, `${s.slice(0, 8)}… took ${Math.round(performance.now() - t)} ms`);
    }
  });

  test('a long run ending in an address is still cut whole', () => {
    const s = `${'x'.repeat(100_000)}@example.com done`;
    const t = performance.now();
    assert.equal(scrubEmails(s), '… done');
    assert.ok(performance.now() - t < 1500);
  });

  test('a commit with a 100,000-character subject is processed quickly (typo fixes too)', () => {
    const subject = `fix typo ${'q'.repeat(100_000)}`;
    const t = performance.now();
    assert.equal(isTypoFixSubject(subject), true);
    const s = computeStats([{ hash: 'a'.repeat(40), date: '2026-03-01T10:00:00+00:00', subject, author: 'Ada', email: 'ada@example.com', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0, parents: ['p'] }], { today: '2026-10-09' });
    assert.equal(s.messages.typos.commits, 1);
    assert.ok(performance.now() - t < 5000, `took ${Math.round(performance.now() - t)} ms`);
  });

  test('the same results as before on known cases', () => {
    for (const [input, out] of [
      ['ada@example.com', '…'],
      ['keys/ada@example.com.pub', 'keys/…'],
      ['lodash@4.17.21 and @babel/core@7.2', 'lodash@4.17.21 and @babel/core@7.2'],
      ['logo@2x.png', 'logo@2x.png'],
      ['a@b@c.io', '…@c.io'],
      ['x@@y.io', 'x@@y.io'],
      ['<ada@x.io>, bob@y.io; root@buildbox', '<…>, …; …'],
      ['é@ü.de', '…'],
      ['', ''],
    ]) {
      assert.equal(scrubEmails(input), out, input);
      assert.equal(scrubEmails(input), input.replace(OLD_EMAIL, '…'), input);
    }
  });

  test('the same results as the old regex on 50,000 random short strings', () => {
    let seed = 17;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const alphabet = [...'ab@ .:/<>\\xé1@\t"(,;|[])\'`\u00a0😀𝒜\ud83d'];
    for (let i = 0; i < 50_000; i++) {
      let s = '';
      for (let j = Math.floor(r() * 16); j > 0; j--) s += alphabet[Math.floor(r() * alphabet.length)];
      assert.equal(scrubEmails(s), s.replace(OLD_EMAIL, '…'), JSON.stringify(s));
    }
  });
});

describe('card row placements are decided once per build', () => {
  const mk = (i, subject, author, files, late = false) => ({
    hash: String(i).padStart(40, '0'),
    date: `2026-03-0${1 + (i % 8)}T10:00:00+00:00`,
    committerDate: `2026-03-0${1 + (i % 8)}T${late ? '13' : '10'}:00:00+00:00`,
    subject,
    author,
    email: author === 'Ada' ? 'ada@example.com' : `${author}@users.noreply.github.com`,
    files,
    filesChanged: files.length,
    linesAdded: files.reduce((a, f) => a + f.added, 0),
    linesRemoved: files.reduce((a, f) => a + f.removed, 0),
    parents: ['p'],
  });
  const commits = [
    mk(0, 'fix typo', 'Ada', [{ path: 'src/a.js', added: 5, removed: 1 }], true),
    mk(1, 'chore: bump', 'dependabot[bot]', [{ path: 'package.json', added: 1, removed: 1 }]),
    mk(2, 'feat: x', 'Ada', [{ path: 'src/b.js', added: 9, removed: 0 }]),
  ];
  const stats = computeStats(commits, { today: '2026-10-09' });

  /** `stats` with getters counting how often a build reads each of `keys`. */
  function counted(keys) {
    const counts = Object.fromEntries(keys.map((k) => [k, 0]));
    const out = { ...stats };
    for (const k of keys) {
      const v = stats[k];
      Object.defineProperty(out, k, { enumerable: true, get() { counts[k] += 1; return v; } });
    }
    return { out, counts };
  }

  test('the totals and dependency bumps are read a bounded number of times', () => {
    const { out, counts } = counted(['totals', 'depBumps', 'rewritten', 'bots']);
    buildCardSpecs(out, { today: '2026-10-09' });
    // Before the fix: totals 26, depBumps 21, rewritten 9, bots 2 for this history.
    assert.ok(counts.totals <= 12, `totals read ${counts.totals} times`);
    assert.ok(counts.depBumps <= 6, `depBumps read ${counts.depBumps} times`);
    assert.ok(counts.rewritten <= 4, `rewritten read ${counts.rewritten} times`);
  });

  test('the cards are exactly the same as without the cache', () => {
    const { out, counts } = counted(['totals', 'depBumps', 'rewritten', 'bots']);
    for (const lang of ['en', 'tr']) {
      const at0 = counts.depBumps;
      const cached = buildCardSpecs(out, { today: '2026-10-09', lang });
      const at1 = counts.depBumps;
      const uncached = withoutPlacementCache(() => buildCardSpecs(out, { today: '2026-10-09', lang }));
      // The uncached build really works every placement out again (many more reads).
      assert.ok(counts.depBumps - at1 > 2 * (at1 - at0), `uncached ${counts.depBumps - at1} vs cached ${at1 - at0} reads`);
      assert.deepEqual(cached, uncached, lang);
    }
    // The rows are where the placements say.
    const specs = buildCardSpecs(stats, { today: '2026-10-09' });
    const labels = (id) => specs.find((c) => c.id === id).spec.lines.map((l) => l.label);
    const ctx = { L: en, today: '2026-10-09' };
    assert.equal(depBumpsCard(stats, ctx), 'totals');
    for (const [fn, label] of [[depBumpsCard, en.totals.depBumps], [rewrittenCard, en.totals.rewritten], [botsCard, en.totals.bots]]) {
      const where = fn(stats, ctx);
      for (const id of ['totals', 'messages']) assert.equal(labels(id).includes(label), where === id, `${label} on ${id}`);
    }
  });

  test('one context never answers for another stats object, nor one stats object for another context', () => {
    const fresh = (fn, st) => fn(st, { L: en });
    const none = { ...stats, depBumps: null, rewritten: null, bots: null };
    const expected = [depBumpsCard, rewrittenCard, botsCard].map((fn) => fresh(fn, stats));
    assert.equal(expected[0], 'totals');
    const ctx = { L: en };
    assert.deepEqual([depBumpsCard, rewrittenCard, botsCard].map((fn) => fn(stats, ctx)), expected);
    assert.deepEqual([depBumpsCard, rewrittenCard, botsCard].map((fn) => fn(none, ctx)), [null, null, null]);
    assert.deepEqual([depBumpsCard, rewrittenCard, botsCard].map((fn) => fn(stats, ctx)), expected);
    assert.deepEqual([depBumpsCard, rewrittenCard, botsCard].map((fn) => fresh(fn, none)), [null, null, null]);
    // Non-object stats are not cached and never throw.
    assert.equal(botsCard(null, ctx), null);
    assert.equal(botsCard(undefined, ctx), null);
  });
});

describe('scrubEmails: the same results as the old regex on adversarial inputs', () => {
  const same = (s) => assert.equal(scrubEmails(s), s.replace(OLD_EMAIL, '…'), JSON.stringify(s));

  test('hand-picked: Unicode, brackets, quotes, several "@", trailing punctuation', () => {
    for (const [input, out] of [
      ['<a@b>', '<…>'],
      ['"ada@example.com"', '"…"'],
      ["'ada@example.com'", "'…'"],
      ['`ada@example.com`', '`…`'],
      ['(ada@example.com)', '(…)'],
      ['[ada@example.com]', '[…]'],
      ['ada@example.com.', '…'],
      ['ada@example.com!', '…'],
      ['ada@example.com?!', '…'],
      ['ada@example.com, bob@x.io;', '…, …;'],
      ['mailto:ada@example.com', 'mailto:…'],
      ['a@b@c@d.io', '…@…'],
      ['@ada@example.com', '@…'],
      ['ada@@example.com', 'ada@@example.com'],
      ['ada@', 'ada@'],
      ['@example.com', '@example.com'],
      ['ada@1.2.3', 'ada@1.2.3'],
      ['ada@_x.io', 'ada@_x.io'],
      ['ada@İstanbul.tr', '…'],
      ['çağrı@örnek.com.tr', '…'],
      ['用户@例子.中国', '…'],
      ['😀@x.io', '…'],
      ['ada@𝒜.io', '…'],
      ['e\u0301@x.io', '…'],
      ['ada\u00a0@x.io', 'ada\u00a0@x.io'],
      ['ada@x.io\u00a0next', '…\u00a0next'],
      ['ada\u200b@x.io', '…'],
      ['a|b@c.io|d', 'a|…|d'],
      ['C:\\keys\\ada@x.io.pub', 'C:\\keys\\…'],
      ['x\ud83d@y.io', '…'],
    ]) {
      assert.equal(scrubEmails(input), out, JSON.stringify(input));
      same(input);
    }
  });

  test('the same results as the old regex on 30,000 random strings over a wide alphabet', () => {
    let seed = 1717;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const alphabet = [...'ab@@.-+_1é\u0301İı😀𝒜中 \t\n\u00a0\u2028\u200b<>()[]"\'`,;:|/\\!?#'];
    for (let i = 0; i < 30_000; i++) {
      let s = '';
      for (let j = Math.floor(r() * 24); j > 0; j--) s += alphabet[Math.floor(r() * alphabet.length)];
      // Now and then a lone surrogate, as a cut-off subject can have.
      if (r() < 0.02) s = s.slice(0, Math.floor(r() * (s.length + 1))) + '\ud83d' + s.slice(Math.floor(r() * (s.length + 1)));
      same(s);
    }
  });

  test('long runs of other shapes are linear too (and unchanged)', () => {
    // [input, expected]: the old regex is not run here (it would take seconds per string).
    for (const [s, out] of [
      ['😀'.repeat(50_000), null],
      ['é'.repeat(100_000), null],
      [`${'x'.repeat(100_000)}@1`, null],
      ['x@1'.repeat(33_000), null],
      ['a@'.repeat(50_000), '…@'.repeat(25_000)],
      [`a@${'b'.repeat(100_000)}`, '…'],
    ]) {
      const t = performance.now();
      const got = scrubEmails(s);
      const ms = performance.now() - t;
      assert.ok(ms < 3000, `${s.slice(0, 8)}… took ${Math.round(ms)} ms`);
      assert.equal(got, out ?? s, s.slice(0, 8));
    }
  });
});

describe('card row placements: correct across builds, languages and repos', () => {
  const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
  const day = (i) => `2026-03-${String(1 + (i % 27)).padStart(2, '0')}`;
  const commit = (i, files, extra = {}) => ({
    hash: H(i),
    date: `${day(i)}T10:00:00+00:00`,
    committerDate: `${day(i)}T10:00:00+00:00`,
    subject: `feat: change ${i}`,
    author: 'Ada',
    email: 'ada@example.com',
    files: files.map(([path, added, removed]) => ({ path, added, removed })),
    parents: ['p'],
    ...extra,
  });
  const DEPENDABOT = { author: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' };
  const bot = (i, files, extra = {}) => commit(i, files, { ...DEPENDABOT, subject: `chore(deps): bump x from 1.0.${i} to 1.0.${i + 1}`, ...extra });
  // As in bot-commits.test.js: without the spare-room rows after the issue references, so the messages card has room.
  const statsOf = (commits, opts = {}) => {
    const s = computeStats(commits, { today: '2026-04-01', ...opts });
    return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
  };
  const LANGS = { en, tr };
  const ROWS = { depBumps: depBumpsCard, rewritten: rewrittenCard, bots: botsCard };
  const LABELS = (L) => ({ depBumps: [L.totals.depBumps, L.totals.depBumpsLabelShort], rewritten: [L.totals.rewritten, L.totals.rewrittenLabelShort], bots: [L.totals.bots, L.totals.botsLabelShort] });

  const cases = {
    roomy: [[commit(1, [['src/a.js', 10, 1]]), bot(2, [['package.json', 1, 1]]), commit(3, [['src/a.js', 5, 1]])]],
    rebasedBotMix: [[commit(1, [['src/a.js', 10, 1]]), bot(2, [['src/b.js', 4, 1]], { committerDate: `${day(2)}T12:00:00+00:00` })]],
    twoRepos: [
      [
        commit(1, [['api/src/a.js', 10, 1]], { repo: 'api' }),
        bot(2, [['web/package.json', 1, 1]], { repo: 'web', committerDate: `${day(2)}T12:00:00+00:00` }),
        commit(3, [['web/src/a.js', 5, 1]], { repo: 'web' }),
        commit(4, [['api/x.js', 5, 1]], { author: 'Bob', email: 'b@example.com', repo: 'api' }),
      ],
      { repos: [{ label: 'api' }, { label: 'web' }] },
    ],
    allBots: [[bot(1, [['src/a.js', 10, 1]]), bot(2, [['src/b.js', 4, 1]], { committerDate: `${day(2)}T12:00:00+00:00` })]],
    none: [[commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/b.js', 3, 0]])]],
  };
  const all = Object.fromEntries(Object.entries(cases).map(([k, [c, o]]) => [k, statsOf(c, o)]));

  /** Where each row is drawn in a build of `s` (null when on no card), checked to be on one card at most. */
  function drawn(s, lang) {
    const specs = buildCardSpecs(s, { repoName: 'demo', today: '2026-04-01', lang });
    const out = {};
    for (const [key, labels] of Object.entries(LABELS(LANGS[lang]))) {
      const on = specs.filter((c) => Array.isArray(c.spec.lines) && c.spec.lines.some((l) => labels.includes(l?.label))).map((c) => c.id);
      assert.ok(on.length <= 1, `${key} on ${on}`);
      out[key] = on[0] ?? null;
    }
    return { specs, out };
  }

  test('each row is drawn where its placement says, for every fixture and language, interleaved', () => {
    const seen = new Set();
    const first = {};
    // Interleave builds of different stats objects and languages, then repeat in reverse: every
    // build must match the first build of the same (stats, lang).
    const order = [];
    for (const lang of ['en', 'tr']) for (const k of Object.keys(all)) order.push([k, lang]);
    for (const [k, lang] of [...order, ...order.reverse()]) {
      const { specs, out } = drawn(all[k], lang);
      const key = `${k}/${lang}`;
      if (first[key]) assert.deepEqual(specs, first[key], key);
      else first[key] = specs;
      for (const [row, fn] of Object.entries(ROWS)) {
        assert.equal(out[row], fn(all[k], { L: LANGS[lang] }), `${key} ${row}`);
        seen.add(`${row}:${out[row]}`);
      }
    }
    // The fixtures cover both cards (and none) for every row that has a messages fallback here.
    for (const want of ['depBumps:totals', 'rewritten:totals', 'rewritten:messages', 'bots:totals', 'bots:messages', 'depBumps:null', 'rewritten:null', 'bots:null']) assert.ok(seen.has(want), `${want} not covered: ${[...seen]}`);
  });

  test('the same stats object, changed between builds, is never answered from the earlier build', () => {
    const s = { ...all.roomy };
    const before = buildCardSpecs(s, { today: '2026-04-01' });
    assert.equal(drawn(s, 'en').out.depBumps, 'totals');
    s.depBumps = null;
    s.bots = null;
    const after = buildCardSpecs(s, { today: '2026-04-01' });
    assert.deepEqual(after, buildCardSpecs({ ...s }, { today: '2026-04-01' }));
    assert.notDeepEqual(after, before);
    assert.equal(drawn(s, 'en').out.depBumps, null);
    assert.equal(drawn(s, 'en').out.bots, null);
  });

  test('one context, several stats objects and languages: never cross-answered', () => {
    const ctxEn = { L: en };
    const ctxTr = { L: tr };
    for (let round = 0; round < 2; round++) {
      for (const [k, s] of Object.entries(all)) {
        for (const [row, fn] of Object.entries(ROWS)) {
          assert.equal(fn(s, ctxEn), fn(s, { L: en }), `${k} ${row} en`);
          assert.equal(fn(s, ctxTr), fn(s, { L: tr }), `${k} ${row} tr`);
        }
      }
    }
  });
});

describe('issue references: URLs are cut in linear time, exactly as before', () => {
  /** The URL regex issues.js used before the fix: the reference for the same results. */
  const OLD_URL = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*/giu;
  const same = (s) => assert.equal(cutUrls(s), s.replace(OLD_URL, ' '), JSON.stringify(s));

  test('hand-picked cases, including the ones a token-start lookbehind would change', () => {
    for (const [input, out] of [
      ['see https://x.y/issues/12#34 and #5', 'see   and #5'],
      ['1-b://x #2', '1-  #2'],
      ['_a://x', '_a://x'],
      ['a_b://x', 'a_b://x'],
      ['9a://x', '9a://x'],
      ['-a://x', '- '],
      ['x.y+z-w://q r', '  r'],
      ['ſ://x K://y', '   '],
      ['www.x.io/#3 #4', '  #4'],
      ['awww.x #1', 'awww.x #1'],
      ['WWW.X #1', '  #1'],
      ['a://www.x b', '  b'],
      ['://x', '://x'],
      ['a:/x a//x', 'a:/x a//x'],
      ['ftp://a\u00a0#9', 'ftp://a\u00a0#9'.replace(OLD_URL, ' ')],
      ['😀a://x', '😀 '],
      ['', ''],
    ]) {
      assert.equal(cutUrls(input), out, JSON.stringify(input));
      same(input);
    }
  });

  test('the same results as the old regex on 120,000 random strings', () => {
    let seed = 4242;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pieces = ['://', 'www.', 'WWW.', 'http://', '1-b://x', 'a', 'Z', '1', '+', '.', '-', '_', ':', '/', 'w', ' ', '\t', '\u00a0', '\u017f', '\u212a', 'é', '😀', '\ud83d', '#1'];
    for (let i = 0; i < 120_000; i++) {
      let s = '';
      for (let j = Math.floor(r() * 14); j > 0; j--) s += pieces[Math.floor(r() * pieces.length)];
      same(s);
    }
  });

  test('100,000-character runs go through computeStats quickly', () => {
    // Before the fix: 'a-' × 40,000 took about 1 s in issueRefsInSubject alone, 200,000
    // characters over 20 s in computeStats.
    for (const unit of ['a-', 'a.', 'x.y', 'w.', 'ab+', 'a-_']) {
      const subject = `${unit.repeat(Math.ceil(100_000 / unit.length))}_://x #12`;
      const t = performance.now();
      assert.deepEqual(issueRefsInSubject(subject), ['#12']);
      const s = computeStats([{ hash: 'a'.repeat(40), date: '2026-03-01T10:00:00+00:00', subject, author: 'Ada', email: 'ada@example.com', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0, parents: ['p'] }], { today: '2026-10-09' });
      assert.equal(s.issueRefs.commits, 1);
      const ms = performance.now() - t;
      assert.ok(ms < 3000, `${unit}: ${Math.round(ms)} ms`);
    }
  });
});
