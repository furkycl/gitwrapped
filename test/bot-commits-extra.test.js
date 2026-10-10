// Edge cases for stats.bots (src/stats/bots.js): a brute-force reference on many seeded
// random histories (bot / human / look-alike names and emails, "[BOT]" case, email local
// parts, merges by parents and by subject, unicode and control characters, non-object
// commits, missing fields, ties), shownBots, the card row (randomized: never displacing
// anything), the recap and wrapped.md (en / tr, no email leaking), and the CLI on a real
// git repo built from the fixture helper (.mailmap, --author, --lang tr, the null case).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBots, computeStats, isBotAuthor, shownBots } from '../src/stats/index.js';
import { scrubEmails } from '../src/privacy.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(6, '0')}b07b07b07b07b07b07b07b07b07b07b07b07`.slice(0, 40);
const commit = (i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00+00:00`,
  committerDate: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00+00:00`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: `src/f${i % 5}.js`, added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const isBotsRow = (r, L = en) => [L.totals.bots, L.totals.botsLabelShort].includes(r?.label);

/** mulberry32: a small, well-mixed 32-bit PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- independent reference -------------------------------------------------------------

const MERGE_SUBJECT = /^Merge (?:(?:branch|branches|pull request|remote-tracking branch|tag|commit)\b|(['"]).+?\1 into\b)/;
const isMerge = (c) => (Array.isArray(c.parents) ? c.parents.length > 1 : typeof c.subject === 'string' && MERGE_SUBJECT.test(c.subject.trim()));
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const endsWithBot = (s) => s.toLowerCase().endsWith('[bot]');

/** Word search by hand: the needle (lowercased) with no letter / digit on either side. */
function hasWord(hay, needles) {
  const lower = hay.toLowerCase();
  // Compare code-point arrays so a neighbouring astral letter counts as one character.
  const chars = [...lower];
  const orig = [...hay];
  if (chars.length !== orig.length) return hasWordSlow(hay, needles);
  for (const needle of needles) {
    const n = [...needle];
    for (let i = 0; i + n.length <= chars.length; i += 1) {
      if (chars.slice(i, i + n.length).join('') !== needle) continue;
      if (isWordChar(orig[i - 1]) || isWordChar(orig[i + n.length])) continue;
      return true;
    }
  }
  return false;
}
// toLowerCase can change length (e.g. "İ"): fall back to per-character lowering.
function hasWordSlow(hay, needles) {
  const orig = [...hay];
  const chars = orig.map((ch) => (ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch));
  for (const needle of needles) {
    const n = [...needle];
    for (let i = 0; i + n.length <= chars.length; i += 1) {
      if (chars.slice(i, i + n.length).join('') !== needle) continue;
      if (isWordChar(orig[i - 1]) || isWordChar(orig[i + n.length])) continue;
      return true;
    }
  }
  return false;
}
const BOT_WORDS = ['dependabot', 'renovate', 'github-actions', 'github_actions', 'github actions'];

/** Control / format characters removed by hand, then trimmed. */
const refClean = (s) => (typeof s === 'string' ? [...s].filter((ch) => !/[\p{Cc}\p{Cf}]/u.test(ch)).join('').trim() : '');

/** A well-known bot word at the very start of `n`, not followed by a letter / digit. */
const startsWithWord = (n, needles) => needles.some((needle) => {
  const head = [...n].slice(0, [...needle].length);
  if (head.length !== [...needle].length) return false;
  if (head.map((ch) => ch.toLowerCase()).join('') !== needle) return false;
  return !isWordChar([...n][head.length]);
});

function refIsBot(name, email) {
  const n = refClean(name);
  const e = refClean(email);
  if (endsWithBot(n) || startsWithWord(n, BOT_WORDS)) return true;
  if (endsWithBot(e)) return true;
  const at = e.lastIndexOf('@');
  return at > 0 && endsWithBot(e.slice(0, at).trim());
}

function refName(name) {
  let n = typeof name === 'string' ? name : '';
  // Format characters dropped, control characters read as spaces (audit 1.17).
  n = [...n].filter((ch) => !/\p{Cf}/u.test(ch)).map((ch) => (/\p{Cc}/u.test(ch) ? ' ' : ch)).join('');
  n = n.split(/\s+/).filter(Boolean).join(' ');
  const lt = n.indexOf('<');
  if (lt > 0) n = n.slice(0, lt).trim();
  else if (lt === 0) n = n.slice(1).replace(/>.*$/s, '').trim();
  const at = n.indexOf('@');
  if (at >= 0) n = n.slice(0, at).trim();
  n = scrubEmails(n).split(/\s+/).filter(Boolean).join(' ');
  // "Unknown" is never a bot's shown name (see shownBots), so it is unnamed (audit 1.17).
  return n === 'Unknown' ? '' : n;
}

function reference(commits) {
  let total = 0;
  const counts = {};
  let bots = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (c === null || typeof c !== 'object' || isMerge(c)) continue;
    total += 1;
    if (!refIsBot(c.author, c.email)) continue;
    bots += 1;
    const k = refName(c.author);
    if (k === '') continue;
    const g = (counts[`#${k.toLowerCase()}`] ??= {});
    g[`#${k}`] = (g[`#${k}`] ?? 0) + 1;
  }
  if (total === 0) return null;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const entries = Object.values(counts).map((g) => {
    const spellings = Object.entries(g).map(([k, v]) => [k.slice(1), v]);
    spellings.sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    return [spellings[0][0], spellings.reduce((sum, [, v]) => sum + v, 0)];
  });
  entries.sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const top = entries.length ? { name: entries[0][0], commits: entries[0][1] } : null;
  let share = Math.round((bots / total) * 1000) / 1000;
  if (bots < total && share > 0.999) share = 0.999;
  return { commits: bots, share, top };
}

// ---- random histories ------------------------------------------------------------------

const NAMES = [
  'Ada', 'Bob', 'dependabot[bot]', 'Dependabot[BOT]', 'renovate[bot]', 'Renovate Bot', 'renovate-bot', 'my-renovate-bot',
  'Renovated', 'renovates', 'Dependabotics', 'github-actions', 'github-actions[bot]', 'GitHub Actions', 'github_actions',
  'githubactions', 'github--actions', 'Robot', 'Bot', 'ada[bot] fan', '  spaced[bot]  ', 'snyk-bot', 'çrenovate', 'renovateé',
  'Ünïcödé[bot]', '依赖机器人[bot]', '😀renovate', 'renovate😀', 'x\u0000renovate', 'renovate​', 'dependabot​[bot]',
  'ci <ci@example.com>', 'ci@example.com', 'ops@example.com [bot]', '', '   ', 'Zed[bot]', 'Ab[bot]', 'ab[bot]',
  'Unknown', 'unknown', 'dep­endabot', 'İrenovate', 'renovate1', '1renovate', '_renovate_', 'renovate.bot', 'DEPENDABOT', 'Name\nWith\tTabs[bot]',
];
const EMAILS = [
  'ada@example.com', 'bob@example.com', '49699333+dependabot[bot]@users.noreply.github.com', 'X[BOT]@users.noreply.github.com',
  'ci[bot]', 'ci[Bot] ', 'renovate@example.com', 'bot@renovateapp.com', '[bot]@x', '@x[bot]', 'a[bot] @x.com', 'a@b@c[bot]',
  'a[bot]@b@c', '', '   ', 'dependabot@example.com', 'notabot@example.com', 'app[bot]x@y.z',
];

function randomCommit(rand, i) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const r = rand();
  if (r < 0.03) return pick([null, undefined, 'x', 7, true, [], () => 1]);
  const c = commit(i, { author: pick(NAMES), email: pick(EMAILS) });
  const m = rand();
  if (m < 0.08) c.parents = ['a', 'b'];
  else if (m < 0.12) c.parents = ['a', 'b', 'c'];
  else if (m < 0.17) {
    delete c.parents;
    c.subject = pick(["Merge branch 'x'", "Merge pull request #3 from y", '  Merge tag v1', "Merge 'a' into b", 'Merged stuff', 'feat: merge']);
  } else if (m < 0.2) c.parents = [];
  const odd = rand();
  if (odd < 0.04) delete c.author;
  else if (odd < 0.08) delete c.email;
  else if (odd < 0.1) c.author = pick([null, 5, {}, ['dependabot[bot]']]);
  else if (odd < 0.12) c.email = pick([null, 5, {}, ['x[bot]']]);
  return c;
}

describe('computeBots: brute-force reference', () => {
  test('matches the reference on 600 seeded random histories (and JSON round-trips to it)', () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const rand = mulberry32(seed);
      const n = Math.floor(rand() * 40);
      const commits = Array.from({ length: n }, (_, i) => randomCommit(rand, i));
      const copy = commits.map((c) => (c && typeof c === 'object' && !Array.isArray(c) ? { ...c } : c));
      const got = computeBots(commits);
      const want = reference(commits);
      assert.deepEqual(got, want, `seed ${seed}`);
      assert.deepEqual(got === null ? null : JSON.parse(JSON.stringify(got)), want, `seed ${seed} json`);
      // never mutates
      commits.forEach((c, i) => {
        if (c && typeof c === 'object' && !Array.isArray(c)) assert.deepEqual(c, copy[i], `seed ${seed} #${i}`);
      });
      if (got) {
        assert.ok(got.share >= 0 && got.share <= 1);
        assert.ok(!got.top || (got.top.commits <= got.commits && got.top.commits > 0));
        assert.doesNotMatch(JSON.stringify(got), /@/);
      }
    }
  });

  test('isBotAuthor matches the reference on every name × email pair', () => {
    for (const name of [...NAMES, null, undefined, 5]) {
      for (const email of [...EMAILS, null, undefined, {}]) {
        assert.equal(isBotAuthor(name, email), refIsBot(name, email), `${JSON.stringify(name)} <${JSON.stringify(email)}>`);
      }
    }
  });
});

describe('isBotAuthor: word boundaries, case, email', () => {
  test('look-alikes', () => {
    const yes = ['DEPENDABOT', 'my-renovate-bot[bot]', 'github_actions', 'GitHub_Actions', 'renovate.bot', 'Renovate Bot', 'renovate😀', '\u0000renovate', 'renovate\u200b', 'dep\u00adendabot', 'dependabot\u200b[bot]', 'x[bot]\u200b', 'Ünïcödé[bot]', 'X[BoT]', 'dependabot-preview'];
    const no = ['my-renovate-bot', '_renovate_', '😀renovate', 'x\u0000renovate', 'Ada Renovate', 'Ada (dependabot fan)', 'Renovated', 'renovates', 'Dependabotics', 'githubactions', 'github--actions', 'github  actions', 'çrenovate', 'renovateé', 'renovate1', '1renovate', 'Robot', 'snyk-bot', '[bot] x', 'bot', 'bot]'];
    for (const n of yes) assert.equal(isBotAuthor(n, 'h@example.com'), true, n);
    for (const n of no) assert.equal(isBotAuthor(n, 'h@example.com'), false, n);
  });

  test('email: whole or local part ending in "[bot]", any case; the domain alone never', () => {
    assert.equal(isBotAuthor('Human', '1+app[BOT]@users.noreply.github.com'), true);
    assert.equal(isBotAuthor('Human', 'ci[bot]'), true);
    assert.equal(isBotAuthor('Human', ' ci[Bot] '), true);
    assert.equal(isBotAuthor('Human', 'a[bot] @x.com'), true);
    assert.equal(isBotAuthor('Human', 'a[bot]@b@c'), false, 'part before the LAST @');
    assert.equal(isBotAuthor('Human', 'a@b@c[bot]'), true, 'whole email');
    assert.equal(isBotAuthor('Human', '@x[bot]'), true, 'whole email ends with [bot]');
    assert.equal(isBotAuthor('Human', 'ada@bots[bot].example.com'), false);
    assert.equal(isBotAuthor('Human', 'dependabot@example.com'), false, 'well-known names only count in the name');
    assert.equal(isBotAuthor('Human', 'app[bot]x@y.z'), false);
    assert.equal(isBotAuthor('Human', 'ci[bot]\u200b@x.com'), true, 'format characters ignored');
    assert.equal(isBotAuthor('Human', 'ci[bot]\u0000'), true, 'control characters ignored');
  });
});

describe('computeBots: edge cases', () => {
  test('merges (parents or subject) never count, nor feed the share or the top bot', () => {
    const bot = { author: 'dependabot[bot]', email: '1+dependabot[bot]@users.noreply.github.com' };
    const commits = [
      commit(1),
      commit(2, { ...bot, parents: ['a', 'b'] }),
      commit(3, { ...bot, parents: undefined, subject: "Merge pull request #1 from x/y" }),
      commit(4, { author: 'renovate[bot]', email: '' }),
    ];
    assert.deepEqual(computeBots(commits), { commits: 1, share: 0.5, top: { name: 'renovate[bot]', commits: 1 } });
    // A root commit (no parents) counts; the subject is ignored when parents are given.
    assert.deepEqual(computeBots([commit(1, { ...bot, parents: [], subject: "Merge branch 'x'" })]), { commits: 1, share: 1, top: { name: 'dependabot[bot]', commits: 1 } });
  });

  test('grouped ignoring case, shown by the most used spelling (ties → code-unit order); group ties → code-unit order', () => {
    const cs = [commit(1, { author: 'ab[bot]' }), commit(2, { author: 'Ab[bot]' }), commit(3, { author: 'b[bot]' }), commit(4, { author: 'b[bot]' }), commit(5, { author: 'Ab[bot]' }), commit(6, { author: 'ab[bot]' })];
    assert.deepEqual(computeBots(cs).top, { name: 'Ab[bot]', commits: 4 });
    const spelled = [commit(1, { author: 'Renovate[bot]' }), commit(2, { author: 'renovate[bot]' }), commit(3, { author: 'renovate[bot]' }), commit(4, { author: 'a[bot]' }), commit(5, { author: 'a[bot]' })];
    assert.deepEqual(computeBots(spelled).top, { name: 'renovate[bot]', commits: 3 });
    const tie = [commit(1, { author: 'b[bot]' }), commit(2, { author: 'B[BOT]' }), commit(3, { author: 'a[bot]' }), commit(4, { author: 'A[bot]' })];
    assert.deepEqual(computeBots(tie).top, { name: 'A[bot]', commits: 2 });
    // Whitespace / control differences fold into one shown name.
    const ws = [commit(1, { author: 'x  y[bot]' }), commit(2, { author: ' x\ty[bot]' }), commit(3, { author: 'x\u0000y[bot]' }), commit(4, { author: 'a[bot]' })];
    assert.deepEqual(computeBots(ws).top, { name: 'x y[bot]', commits: 3 });
  });

  test('missing / odd names: an unnamed bot counts but is never top; never the email', () => {
    const r = computeBots([commit(1, { author: undefined, email: '1+x[bot]@users.noreply.github.com' }), commit(2, { author: '​', email: 'y[bot]' })]);
    assert.deepEqual(r, { commits: 2, share: 1, top: null });
    const named = computeBots([commit(1, { author: '', email: 'x[bot]@y' }), commit(2, { author: '', email: 'x[bot]@y' }), commit(3, { author: 'renovate[bot]' })]);
    assert.deepEqual(named, { commits: 3, share: 1, top: { name: 'renovate[bot]', commits: 1 } }, 'the busiest named bot wins');
    const s = computeBots([commit(1, { author: 'ops@example.com [bot]', email: '' })]);
    assert.deepEqual(s.top, { name: 'ops', commits: 1 });
    const t = computeBots([commit(1, { author: 'Deploy (ci@corp.io) [bot]', email: '' })]);
    assert.doesNotMatch(JSON.stringify(t), /corp\.io|@/);
  });

  test('non-object entries are skipped (not counted in the total); non-arrays → null', () => {
    assert.deepEqual(computeBots([null, undefined, 0, '', 'dependabot[bot]', commit(1, { author: 'renovate[bot]' }), commit(2)]), { commits: 1, share: 0.5, top: { name: 'renovate[bot]', commits: 1 } });
    for (const v of [undefined, null, 5, 'x', {}, { length: 2, 0: commit(1) }]) assert.equal(computeBots(v), null, String(v));
  });

  test('share rounding: 0.9995 → 0.999 short of all, 0.0004 → 0 with commits kept', () => {
    const many = Array.from({ length: 2000 }, (_, i) => commit(i, i === 0 ? {} : { author: 'renovate[bot]' }));
    assert.equal(computeBots(many).share, 0.999);
    const r = computeBots(Array.from({ length: 2500 }, (_, i) => commit(i, i === 0 ? { author: 'renovate[bot]' } : {})));
    assert.equal(r.share, 0);
    assert.equal(r.commits, 1);
    assert.equal(shownBots(r).pct, (1 / 2500) * 100, 'pct from the exact ratio');
  });
});

describe('shownBots', () => {
  test('agrees with computeBots on random histories; JSON round-trip only loses precision', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = mulberry32(seed * 7);
      const commits = Array.from({ length: 1 + Math.floor(rand() * 30) }, (_, i) => randomCommit(rand, i));
      const r = computeBots(commits);
      const shown = shownBots(r);
      if (!r || r.commits === 0) {
        assert.equal(shown, null, `seed ${seed}`);
        continue;
      }
      assert.equal(shown.commits, r.commits);
      assert.deepEqual(shown.top, r.top);
      const viaJson = shownBots(JSON.parse(JSON.stringify(r)));
      assert.equal(viaJson.commits, r.commits);
      assert.ok(Math.abs(viaJson.pct - shown.pct) <= 0.05 + 1e-9, `seed ${seed}`);
      assert.ok(shown.pct <= 100 && (shown.pct < 100 || r.share === 1));
    }
  });

  test('malformed values', () => {
    assert.equal(shownBots({ commits: Infinity, share: 0.5 }), null);
    assert.equal(shownBots({ commits: '3', share: 0.5 }), null);
    assert.deepEqual(shownBots({ commits: 2.4, share: NaN }), { commits: 2, pct: 0, top: null });
    assert.deepEqual(shownBots({ commits: 2, share: -1 }), { commits: 2, pct: 0, top: null });
    assert.deepEqual(shownBots({ commits: 2, share: 7 }), { commits: 2, pct: 99.9, top: null });
    assert.deepEqual(shownBots({ commits: 2, share: 0.5, top: { name: 'a\u0000b <a@b.co>', commits: 1.6 } }).top, { name: 'a b', commits: 2 });
    assert.equal(shownBots({ commits: 2, share: 0.5, top: { name: 'Unknown', commits: 1 } }).top, null);
    assert.equal(shownBots({ commits: 2, share: 0.5, top: { name: '​', commits: 1 } }).top, null);
    assert.equal(shownBots([]), null);
  });
});

describe('card row: never displacing (randomized)', () => {
  test('with stats.bots vs without: at most one card changes, and it only gains the row last', () => {
    let rowsSeen = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const rand = mulberry32(seed * 131);
      const n = 1 + Math.floor(rand() * 25);
      const commits = Array.from({ length: n }, (_, i) => {
        const c = randomCommit(rand, i);
        return c && typeof c === 'object' && !Array.isArray(c) ? { ...c, author: typeof c.author === 'string' ? c.author : 'Ada', email: typeof c.email === 'string' ? c.email : '' } : commit(i);
      });
      const s = statsOf(commits);
      const without = { ...s, bots: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const a = buildCards(s, cardOpts(lang));
        const b = buildCards(without, cardOpts(lang));
        assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id), `seed ${seed} ${lang}`);
        const sa = buildCardSpecs(s, cardOpts(lang));
        const sb = buildCardSpecs(without, cardOpts(lang));
        let changed = 0;
        for (const [i, card] of a.entries()) {
          if (card.svg === b[i].svg) continue;
          changed += 1;
          assert.ok(['totals', 'messages'].includes(card.id), `seed ${seed} ${card.id}`);
          const la = sa[i].spec.lines;
          const lb = sb[i].spec.lines;
          assert.ok(isBotsRow(la.at(-1), L), `seed ${seed} ${lang} ${card.id}`);
          assert.deepEqual(la.slice(0, -1), lb, `seed ${seed} ${lang} ${card.id}`);
          assert.equal(la.filter((r) => isBotsRow(r, L)).length, 1);
          // No email in the row (hover text included).
          assert.doesNotMatch(JSON.stringify(la.at(-1)), /@/);
        }
        assert.ok(changed <= 1, `seed ${seed} ${lang}`);
        if (!shownBots(s.bots)) assert.equal(changed, 0, `seed ${seed} ${lang}`);
        rowsSeen += changed;
      }
    }
    assert.ok(rowsSeen > 10, `rows shown: ${rowsSeen}`);
  });
});

describe('recap and wrapped.md text', () => {
  const mix = () => [
    commit(1),
    commit(2, { author: 'my_app[bot]', email: '9+my_app[bot]@users.noreply.github.com' }),
    commit(3, { author: 'my_app[bot]', email: '9+my_app[bot]@users.noreply.github.com' }),
    commit(4, { author: 'Renovate Bot', email: 'bot@renovateapp.com' }),
    commit(5, { author: 'Ada', parents: ['a', 'b'], subject: "Merge branch 'x'" }),
    commit(6, { author: 'dependabot[bot]', email: 'x[bot]@e.com', parents: ['a', 'b'], subject: "Merge branch 'y'" }),
  ];

  test('en / tr recap: count, share, the busiest bot; no email', () => {
    const s = statsOf(mix());
    assert.deepEqual(s.bots, { commits: 3, share: 0.75, top: { name: 'my_app[bot]', commits: 2 } });
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Bot commits\s+3 commits \(75% of non-merge commits\) · top my_app\[bot\] \(2 commits\)\n/);
    const outTr = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(outTr, /\n {2}Bot commit'leri\s+3 commit \(merge dışı commit'lerin %75 kadarı\) · en çok my_app\[bot\] \(2 commit\)\n/);
    for (const t of [out, outTr]) assert.doesNotMatch(t, /noreply|renovateapp|x\[bot\]@/);
  });

  test('en / tr wrapped.md: escaped name, one section; no email', () => {
    const s = statsOf(mix());
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /\n## Bot commits\n\n3 commits \\\(75% of non-merge commits\\\); busiest: my\\_app\\\[bot\\\] \\\(2 commits\\\)\n/);
    assert.equal(md.split('## Bot commits').length, 2);
    const mdTr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(mdTr, /\n## Bot commit'leri\n\n3 commit \\\(merge dışı commit'lerin %75 kadarı\\\); en çok commit atan bot: my\\_app\\\[bot\\\] \\\(2 commit\\\)\n/);
    for (const t of [md, mdTr]) assert.doesNotMatch(t, /noreply|renovateapp/);
  });

  test('an email-shaped top name (hand-made stats.json) never leaks anywhere', () => {
    const s = { ...statsOf(mix()), bots: { commits: 2, share: 0.5, top: { name: 'leak me@secret.example.org', commits: 2 } } };
    const outs = [formatSummary(s, { repoName: 'demo', today: TODAY }), buildMarkdown(s, { repoName: 'demo', today: TODAY }), JSON.stringify(buildCardSpecs(s, cardOpts('en')))];
    for (const t of outs) assert.doesNotMatch(t, /secret\.example/);
    assert.match(outs[0], /top leak me \(2 commits\)/);
  });

  test('100% only when every non-merge commit is a bot\'s; "<1%" for a tiny share', () => {
    const all = statsOf([commit(1, { author: 'renovate[bot]' }), commit(2, { author: 'renovate[bot]' }), commit(3, { parents: ['a', 'b'] })]);
    assert.match(formatSummary(all, { repoName: 'demo', today: TODAY }), /Bot commits\s+2 commits \(100% of non-merge commits\)/);
    const tiny = statsOf(Array.from({ length: 400 }, (_, i) => commit(i, i === 0 ? { author: 'renovate[bot]' } : {})));
    assert.match(formatSummary(tiny, { repoName: 'demo', today: TODAY }), /Bot commits\s+1 commit \(<1% of non-merge commits\)/);
    assert.match(buildMarkdown(tiny, { repoName: 'demo', today: TODAY }), /## Bot commits\n\n1 commit \\\(\\<1% of non-merge commits\\\); busiest: renovate\\\[bot\\\]/);
    const near = statsOf(Array.from({ length: 400 }, (_, i) => commit(i, i === 0 ? {} : { author: 'renovate[bot]' })));
    assert.match(formatSummary(near, { repoName: 'demo', today: TODAY }), /Bot commits\s+399 commits \(99\.\d% of non-merge commits\)|Bot commits\s+399 commits \(>99% of non-merge commits\)|Bot commits\s+399 commits \(99% of non-merge commits\)/);
    assert.doesNotMatch(formatSummary(near, { repoName: 'demo', today: TODAY }), /Bot commits[^\n]*100%/);
  });

  test('no bot: no line, no section; stats.json carries {0, 0, null}', () => {
    const s = statsOf([commit(1), commit(2, { author: 'Renovated Kitchen' })]);
    assert.deepEqual(s.bots, { commits: 0, share: 0, top: null });
    assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY }), /Bot commits/);
    assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /Bot commits/);
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.bots, { commits: 0, share: 0, top: null });
  });
});

describe('bot commits: CLI on a real git repo (fixture + bots, .mailmap, --author)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  const as = (name, email, day) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });

  let fixture;
  let dir;
  let tmp;
  let base;
  const run = (args, name) => {
    const out = join(tmp, `${name}-out`);
    const r = bin([...args, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return { r, doc: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')), md: readFileSync(join(out, 'wrapped.md'), 'utf8') };
  };

  before(() => {
    fixture = makeFixtureRepo();
    dir = fixture.dir;
    base = fixture.commits.length;
    tmp = mkdtempSync(join(tmpdir(), 'gw-bots-extra-'));
    git(dir, ['config', 'commit.gpgsign', 'false']);
    // .mailmap: the old dependabot-preview identity onto dependabot; a human's "[bot]" alias
    // onto the human; a CI identity with a human-looking name onto a "[bot]" identity.
    writeFileSync(join(dir, '.mailmap'), [
      'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> dependabot-preview[bot] <27856297+dependabot-preview[bot]@users.noreply.github.com>',
      'Bob Builder <bob@example.com> bobs-helper[bot] <bob[bot]@example.com>',
      'deployer[bot] <deployer[bot]@corp.example> Deploy Script <deploy@corp.example>',
      '',
    ].join('\n'));
    git(dir, ['add', '.mailmap']);
    git(dir, ['commit', '-q', '-m', 'chore: mailmap'], as('Ada Lovelace', 'ada@example.com', '2024-03-20'));
    const steps = [
      ['dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com', '2024-03-21'],
      ['dependabot-preview[bot]', '27856297+dependabot-preview[bot]@users.noreply.github.com', '2024-03-22'],
      ['dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com', '2024-03-23'],
      ['bobs-helper[bot]', 'bob[bot]@example.com', '2024-03-24'],
      ['Deploy Script', 'deploy@corp.example', '2024-03-25'],
      ['Renovated Kitchen', 'kitchen@example.com', '2024-03-26'],
    ];
    for (const [i, [name, email, day]] of steps.entries()) {
      writeFileSync(join(dir, `bump${i}.txt`), `${i}\n`);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', `chore(deps): bump ${i}`], as(name, email, day));
    }
    // A merge by dependabot: never counted.
    git(dir, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(dir, 'side.txt'), 'side\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'feat: side'], as('Ada Lovelace', 'ada@example.com', '2024-03-27'));
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '-q', '--no-ff', '-m', "Merge branch 'side'", 'side'], as('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com', '2024-03-28'));
  });
  after(() => {
    fixture?.cleanup?.();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('whole year: .mailmap applied, merges excluded; stats.json, wrapped.md and recap agree; no email', () => {
    const { r, doc, md } = run([dir, '--year', '2024'], 'all');
    // Non-merge: the fixture's commits, the .mailmap commit, 6 bumps, the side commit.
    const total = base + 1 + 6 + 1;
    // Bots: dependabot ×3 (one via .mailmap), deployer[bot] ×1 (via .mailmap); bobs-helper is Bob.
    assert.deepEqual(doc.stats.bots, { commits: 4, share: Math.round((4 / total) * 1000) / 1000, top: { name: 'dependabot[bot]', commits: 3 } });
    const pct = Math.round((4 / total) * 100);
    assert.match(md, new RegExp(`## Bot commits\\n\\n4 commits \\\\\\(${pct}% of non-merge commits\\\\\\); busiest: dependabot\\\\\\[bot\\\\\\] \\\\\\(3 commits\\\\\\)`));
    assert.match(r.stdout, new RegExp(`Bot commits\\s+4 commits \\(${pct}% of non-merge commits\\) · top dependabot\\[bot\\] \\(3 commits\\)`));
    for (const t of [r.stdout, md, JSON.stringify(doc.stats.bots)]) assert.doesNotMatch(t, /noreply|corp\.example|bob\[bot\]/);
  });

  test('--lang tr', () => {
    const { r, md } = run([dir, '--year', '2024', '--lang', 'tr'], 'tr');
    assert.match(r.stdout, /Bot commit'leri\s+4 commit \(merge dışı commit'lerin %\d+ kadarı\) · en çok dependabot\[bot\] \(3 commit\)/);
    assert.match(md, /## Bot commit'leri\n\n4 commit \\\(merge dışı commit'lerin %\d+ kadarı\\\); en çok commit atan bot: dependabot\\\[bot\\\] \\\(3 commit\\\)/);
  });

  test('--author: the bot alone (100%, matched after .mailmap), a human (no bot: no section), the remapped alias', () => {
    const d = run([dir, '--year', '2024', '--author', '49699333+dependabot[bot]@users.noreply.github.com'], 'dep');
    assert.deepEqual(d.doc.stats.bots, { commits: 3, share: 1, top: { name: 'dependabot[bot]', commits: 3 } });
    assert.match(d.md, /## Bot commits\n\n3 commits \\\(100% of non-merge commits\\\)/);
    const b = run([dir, '--year', '2024', '--author', 'bob@example.com'], 'bob');
    assert.equal(b.doc.stats.bots.commits, 0);
    assert.equal(b.doc.stats.bots.top, null);
    assert.doesNotMatch(b.md, /Bot commits/);
    assert.doesNotMatch(b.r.stdout, /Bot commits/);
    const dep = run([dir, '--year', '2024', '--author', 'deployer[bot]@corp.example'], 'deployer');
    assert.deepEqual(dep.doc.stats.bots, { commits: 1, share: 1, top: { name: 'deployer[bot]', commits: 1 } });
  });

  test('a window with only the merge: stats.bots is null', () => {
    const { doc, md } = run([dir, '--since', '2024-03-28', '--until', '2024-03-28'], 'merge-only');
    assert.equal(doc.stats.bots, null);
    assert.doesNotMatch(md, /Bot commits/);
  });
});
