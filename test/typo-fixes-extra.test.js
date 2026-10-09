// Edge cases for stats.messages.typos (src/stats/messages.js isTypoFixSubject / shownTypos):
// a brute-force reference matcher on many seeded random subjects (typo / spelling /
// misspell… / yazım fragments, look-alikes such as typography / typology, URLs, emails,
// hyphens, underscores, punctuation, NFD, case), the share math against a reference on
// random histories (merges by parents and by subject, multi-repo), the messages card on
// random histories (never displacing: identical to the card without the stat except the
// one added row or "· N typos" segment), and the CLI on a real git repo (en / tr).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHistories } from '../src/git.js';
import { computeMessages, computeStats, isTypoFixSubject, shownTypos } from '../src/stats/index.js';
import { scrubEmails } from '../src/privacy.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(6, '0')}7e707e707e707e707e707e707e707e707e70`.slice(0, 40);
const commit = (subject, i, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: `src/f${i % 4}.js`, added: 5 + (i % 9), removed: 1 }],
  parents: ['p'],
  ...extra,
});
const opts = (lang = 'en') => ({ repoName: 'demo', today: TODAY, lang });
const withoutTypos = (stats) => {
  const { typos, ...messages } = stats.messages;
  return { ...stats, messages };
};

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

// ---- independent reference matcher -----------------------------------------------------

const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(ch);
const isLetter = (ch) => /\p{L}/u.test(ch);
const isAsciiLetter = (ch) => ch !== undefined && /^[A-Za-z]$/.test(ch);
const isSchemeChar = (ch) => ch !== undefined && /^[A-Za-z0-9+.-]$/.test(ch);
const isSpace = (ch) => /\s/u.test(ch);

/** URLs cut by hand: `scheme://…` and `www.…` up to the next whitespace, each replaced by one space. */
function refCutUrls(s) {
  const cs = [...s];
  let out = '';
  let i = 0;
  const restEnd = (j) => {
    while (j < cs.length && !isSpace(cs[j])) j += 1;
    return j;
  };
  while (i < cs.length) {
    const prev = cs[i - 1];
    // scheme://
    const schemeBlocked = prev !== undefined && /[\p{L}\p{N}_+.-]/u.test(prev);
    if (isAsciiLetter(cs[i]) && !schemeBlocked) {
      let j = i + 1;
      while (isSchemeChar(cs[j])) j += 1;
      if (cs[j] === ':' && cs[j + 1] === '/' && cs[j + 2] === '/') {
        out += ' ';
        i = restEnd(j + 3);
        continue;
      }
    }
    // www.
    const prevBlocks = prev !== undefined && /[\p{L}\p{N}_]/u.test(prev);
    if (!prevBlocks && cs.slice(i, i + 4).join('').toLowerCase() === 'www.') {
      out += ' ';
      i = restEnd(i + 4);
      continue;
    }
    out += cs[i];
    i += 1;
  }
  return out;
}

/** Per code point lowering that keeps one code point (so "İ" stays "İ"). */
const lower1 = (ch) => (ch.toLowerCase().length === ch.length && [...ch.toLowerCase()].length === 1 ? ch.toLowerCase() : ch);

const EXACT_WORDS = new Set(['typo', 'typos', 'spelling', 'spellings', 'misspelt', 'yazım', 'yazim']);

function refIsTypoWord(word) {
  const w = [...word].map(lower1).join('');
  if (EXACT_WORDS.has(w)) return true;
  if (w.startsWith('misspell') && [...w.slice('misspell'.length)].every(isLetter)) return true;
  return false;
}

/** Dotted capital I and "i" + combining dot above, read as "i", by hand. */
function refFoldDottedI(s) {
  const cs = [...s];
  let out = '';
  for (let i = 0; i < cs.length; i += 1) {
    if (cs[i] === '\u0130') out += 'i';
    else if (cs[i] === 'i' && cs[i + 1] === '\u0307') {
      out += 'i';
      i += 1;
    } else out += cs[i];
  }
  return out;
}

const isLetterOrDigit = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function refIsTypoFix(subject) {
  if (typeof subject !== 'string') return false;
  const cs = [...refFoldDottedI(refCutUrls(scrubEmails(subject.normalize('NFC')))), ' '];
  // Maximal runs of word characters (letters, marks, digits, "_"); a run right after a
  // "/", or right before a "/" or a "." + letter / digit, is a path / package / file /
  // domain part and does not count.
  let word = '';
  for (let i = 0; i < cs.length; i += 1) {
    const ch = cs[i];
    if (isWordChar(ch)) word += ch;
    else {
      if (word && refIsTypoWord(word)) {
        const before = cs[i - [...word].length - 1];
        const pathy = before === '/' || ch === '/' || (ch === '.' && isLetterOrDigit(cs[i + 1]));
        if (!pathy) return true;
      }
      word = '';
    }
  }
  return false;
}

const FRAGMENTS = [
  'typo', 'typos', 'Typo', 'TYPO', 'TyPoS', 'spelling', 'Spellings', 'SPELLING', 'misspell', 'misspelled', 'Misspelt',
  'MISSPELLINGS', 'misspells', 'misspellé', 'yazım', 'Yazım', 'YAZIM', 'yazim', 'YAZİM', 'yazımı', 'yazılım', 'yazı',
  'typography', 'typology', 'typographic', 'retypo', 'typoo', 'typ', 'spell', 'spelled', 'speling', 'misspel', 'mis', 'spelt',
  'fix', 'Fix', 'docs', 'readme', 'the', 'in', 'a', '2', '42', 'é', 'ç', 'ş', 'ü', '日本', '😀', '✨', '\u0301', 'o\u0301', 'i\u0307',
  'https://example.com/typo', 'http://x.io/fix-typo#a', 'HTTPS://X.IO/spelling', 'git+ssh://h/typo', 'ftp://typo', 'www.typo.com',
  'WWW.spelling.org', 'www.', 'x://typo', 'typo://x', 'example.com/typo', 'typo@example.com', 'spelling@x.io', 'ada@typo',
  'lodash@4.1', 'x@typo.io', '://', 'mailto:typo@x.io',
];
const SEPARATORS = [' ', ' ', ' ', '', '-', '_', '.', ',', '/', ':', ';', '(', ')', '"', "'", '!', '?', '#', '+', '\t', '\n', '`', '[', ']', '*', '—'];

function randomSubject(rand) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const n = 1 + Math.floor(rand() * 6);
  let s = rand() < 0.2 ? pick(SEPARATORS) : '';
  for (let i = 0; i < n; i += 1) {
    s += pick(FRAGMENTS);
    if (i < n - 1 || rand() < 0.2) s += pick(SEPARATORS);
  }
  if (rand() < 0.05) s = s.normalize('NFD');
  return s;
}

describe('isTypoFixSubject: brute-force reference', () => {
  test('the reference agrees with hand-picked cases', () => {
    const yes = ['fix typo', 'TYPO', 'misspelt', 'Misspellings', 'YAZIM', 'yazim', 'typo-fix', 'fix_ typo', '(spelling)', 'see https://x.io/a typo'];
    const no = ['typography', 'typology', 'fix_typo', 'yazımı', 'https://x.io/typo', 'www.typo.com', 'typo@x.io', 'misspell2', 'typó'];
    for (const s of yes) assert.equal(refIsTypoFix(s), true, s);
    for (const s of no) assert.equal(refIsTypoFix(s), false, s);
  });

  test('matches the reference on 20,000 seeded random subjects (both outcomes well represented)', () => {
    let hits = 0;
    for (let seed = 1; seed <= 20000; seed += 1) {
      const s = randomSubject(mulberry32(seed));
      const want = refIsTypoFix(s);
      assert.equal(isTypoFixSubject(s), want, `seed ${seed}: ${JSON.stringify(s)}`);
      if (want) hits += 1;
    }
    assert.ok(hits > 3000 && hits < 17000, `hits ${hits}`);
  });

  test('every fragment alone and wrapped in every separator', () => {
    for (const f of FRAGMENTS) {
      for (const sep of SEPARATORS) {
        for (const s of [f, `${sep}${f}${sep}`, `fix${sep}${f}`, `${f}${sep}fix`]) assert.equal(isTypoFixSubject(s), refIsTypoFix(s), JSON.stringify(s));
      }
    }
  });

  test('look-alikes and boundaries, explicitly', () => {
    const cases = {
      'misspelt word': true, 'Misspelt': true, 'misspelte': false, 'misspellé': true, 'misspelt2': false, 'misspelled_x': false,
      'typos.': true, 'typos2': false, 'typo\u0301': false, 'typo\u200b': true, '\u00e9typo': false, 'e\u0301typo': false,
      'fix typo (https://github.com/x/y/pull/1)': true, 'docs: https://typo.dev': false, 'x.https://a.b/typo': false, 'é.https://a.b/typo': false, '+https://a.b/typo': false, // not cut as URLs, but "/typo" is a path part
      'crate-ci/typos': false, 'typos.toml': false, 'example.com/typo': false, 'typo/': false, 'typo.': true, 'typo./': true, 'SPELLİNG': true, 'yazi\u0307m': true,
      'see www.typo.io': false, 'awww.typo': true, 'ywww.typo': true, 'ada.typo@example.com': false,
      'yazım.': true, 'Yazım-hatası': true, 'YAZIMI': false, 'yazımcı': false, 'Typo’s': true, 'typos’': true,
    };
    for (const [s, want] of Object.entries(cases)) {
      assert.equal(refIsTypoFix(s), want, `reference: ${JSON.stringify(s)}`);
      assert.equal(isTypoFixSubject(s), want, JSON.stringify(s));
    }
  });
});

// ---- share math ------------------------------------------------------------------------

const MERGE_SUBJECT = /^Merge (?:(?:branch|branches|pull request|remote-tracking branch|tag|commit)\b|(['"]).+?\1 into\b)/;
const isMerge = (c) => (Array.isArray(c.parents) ? c.parents.length > 1 : typeof c.subject === 'string' && MERGE_SUBJECT.test(c.subject.trim()));

function refTypos(commits) {
  let total = 0;
  let hits = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (c === null || typeof c !== 'object' || isMerge(c)) continue;
    total += 1;
    if (refIsTypoFix(c.subject)) hits += 1;
  }
  if (hits === 0) return { commits: 0, share: 0 };
  let share = Math.round((hits / total) * 1000) / 1000;
  if (hits < total && share > 0.999) share = 0.999;
  return { commits: hits, share };
}

function randomCommit(rand, i) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const c = commit(rand() < 0.4 ? randomSubject(rand) : pick(['add parser', 'fix typo', 'wip', 'oops', 'tidy', 'docs: spelling']), i);
  const m = rand();
  if (m < 0.08) c.parents = ['a', 'b'];
  else if (m < 0.12) {
    delete c.parents;
    c.subject = pick(["Merge branch 'typo'", 'Merge pull request #3 from y/typo-fix', "Merge 'typos' into main", 'Merged typo fix']);
  } else if (m < 0.15) c.subject = pick([undefined, null, 42, '']);
  return c;
}

describe('computeMessages: typos share vs reference', () => {
  test('600 seeded random histories (merges by parents / subject, odd subjects)', () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const rand = mulberry32(seed * 7919);
      const commits = Array.from({ length: Math.floor(rand() * 60) }, (_, i) => randomCommit(rand, i));
      const got = computeMessages(commits).typos;
      assert.deepEqual({ ...got }, refTypos(commits), `seed ${seed}`);
      assert.deepEqual(Object.keys(got), ['commits', 'share']);
      // Shown percent: from the exact ratio, never 100 short of every commit.
      const shown = shownTypos(got);
      if (got.commits === 0) assert.equal(shown, null);
      else {
        const nonMerge = commits.filter((c) => !isMerge(c)).length;
        const exact = (got.commits / nonMerge) * 100;
        assert.ok(Math.abs(shown.pct - (got.commits === nonMerge ? 100 : Math.min(exact, 99.9))) < 1e-9, `seed ${seed}`);
      }
    }
  });

  test('share: 3 decimals, rounding at the edges, cap 0.999 unless all match, 0 when none', () => {
    const run = (hits, total) => computeMessages(Array.from({ length: total }, (_, i) => commit(i < hits ? 'typo' : 'add', i))).typos;
    assert.deepEqual(run(0, 5), { commits: 0, share: 0 });
    assert.deepEqual(run(1, 3), { commits: 1, share: 0.333 });
    assert.deepEqual(run(2, 3), { commits: 2, share: 0.667 });
    assert.deepEqual(run(1, 2000), { commits: 1, share: 0.001 });
    assert.deepEqual(run(1, 2001), { commits: 1, share: 0 }); // rounds to 0 but commits stay
    assert.deepEqual(run(1999, 2000), { commits: 1999, share: 0.999 }); // 0.9995 rounds to 1, capped
    assert.deepEqual(run(1000, 1001), { commits: 1000, share: 0.999 });
    assert.deepEqual(run(7, 7), { commits: 7, share: 1 });
    // A share that rounds to 0 still shows the row / line ("<1%").
    const tiny = computeStats(Array.from({ length: 2001 }, (_, i) => commit(i === 0 ? 'typo' : 'add', i)), { today: TODAY });
    assert.match(formatSummary(tiny, { lang: 'en' }), /Typo fixes\s+1 commit \(<1% of non-merge commits\)/);
    const near = computeStats(Array.from({ length: 2000 }, (_, i) => commit(i === 0 ? 'add' : 'typo', i)), { today: TODAY });
    assert.match(formatSummary(near, { lang: 'en' }), /Typo fixes\s+1,999 commits \(99% of non-merge commits\)/);
  });

  test('merges never count, even with a typo subject; only merges → zeros', () => {
    const commits = [
      commit('fix typo', 1, { parents: ['a', 'b'] }),
      commit('spelling', 2, { parents: ['a', 'b', 'c'] }),
      { subject: "Merge branch 'typo-fixes'", date: '2026-03-02T10:00:00Z' },
      commit('typo', 3),
      commit('add', 4),
    ];
    assert.deepEqual(computeMessages(commits).typos, { commits: 1, share: 0.5 });
    assert.deepEqual(computeMessages(commits.slice(0, 3)).typos, { commits: 0, share: 0 });
  });

  test('multi-repo: random repos merged equal the reference over the concatenation; shared hashes once', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const rand = mulberry32(seed + 424242);
      const repos = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, r) => ({
        label: `r${r}`,
        commits: Array.from({ length: Math.floor(rand() * 25) }, (_, i) => randomCommit(rand, r * 1000 + i)),
      }));
      const { commits } = mergeHistories(repos);
      assert.deepEqual({ ...computeMessages(commits).typos }, refTypos(repos.flatMap((r) => r.commits)), `seed ${seed}`);
    }
    const shared = commit('fix typo', 1);
    const { commits } = mergeHistories([{ label: 'a', commits: [shared, commit('x', 2)] }, { label: 'b', commits: [{ ...shared }, commit('y', 3)] }]);
    assert.deepEqual(computeMessages(commits).typos, { commits: 1, share: 0.333 });
  });

  test('stats.json round-trip: shownTypos from the JSON share agrees with the in-memory one to a whole percent', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = mulberry32(seed + 99);
      const commits = Array.from({ length: 1 + Math.floor(rand() * 80) }, (_, i) => randomCommit(rand, i));
      const stats = computeStats(commits, { today: TODAY });
      const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo' }));
      assert.deepEqual(doc.stats.messages.typos, { ...stats.messages.typos });
      const a = shownTypos(stats.messages.typos);
      const b = shownTypos(doc.stats.messages.typos);
      assert.equal(a === null, b === null);
      if (a) {
        assert.equal(a.commits, b.commits);
        assert.ok(Math.abs(a.pct - b.pct) <= 0.05 + 1e-9, `seed ${seed}`);
      }
    }
  });
});

// ---- the messages card: never displacing -----------------------------------------------

describe('messages card: random histories, the typo fixes never displace anything', () => {
  const SUBJECTS = [
    'add parser', 'fix parser', 'fix typo', 'wip', 'wip spelling', 'oops', 'oops typo', 'tidy', 'docs: spelling', 'feat: x',
    'fix: misspelt name', 'fixup! add parser', 'Yazım hatası', 'chore: bump', 'refactor everything in the codebase at once and more',
  ];

  test('400 seeded histories, en and tr: every card identical except one added typo row or a "· N typos" segment', () => {
    const outcomes = { same: 0, row: 0, segment: 0 };
    for (let seed = 1; seed <= 400; seed += 1) {
      const rand = mulberry32(seed + 31337);
      const pick = (xs) => xs[Math.floor(rand() * xs.length)];
      const n = 1 + Math.floor(rand() * 60);
      const noFiles = rand() < 0.3;
      const commits = Array.from({ length: n }, (_, i) => commit(pick(SUBJECTS), i, noFiles ? { files: [] } : {}));
      const stats = computeStats(commits, { today: TODAY });
      for (const lang of ['en', 'tr']) {
        const M = getStrings(lang).messages;
        const after = buildCardSpecs(stats, opts(lang));
        const before = buildCardSpecs(withoutTypos(stats), opts(lang));
        assert.equal(after.length, before.length);
        for (const [i, c] of after.entries()) if (c.id !== 'messages') assert.deepEqual(c.spec, before[i].spec, `seed ${seed} ${lang} ${c.id}`);
        const a = after.find((c) => c.id === 'messages').spec;
        const b = before.find((c) => c.id === 'messages').spec;
        const t = shownTypos(stats.messages.typos);
        const { lines: al, ...arest } = a;
        const { lines: bl, ...brest } = b;
        assert.deepEqual(arest, brest, `seed ${seed} ${lang}: only the lines change`);
        if (JSON.stringify(a) === JSON.stringify(b)) {
          outcomes.same += 1;
          continue;
        }
        assert.ok(t, `seed ${seed} ${lang}: changed without any typo fix`);
        if (al.length === bl.length + 1) {
          const at = al.findIndex((r) => r.label === M.typosTitle || r.label === M.typosShortTitle);
          assert.ok(at > 0, `seed ${seed} ${lang}`);
          assert.ok([M.oopsCommits, M.counterCommits].includes(al[at - 1].label), `seed ${seed} ${lang}: after ${al[at - 1].label}`);
          assert.deepEqual(al.filter((_, i) => i !== at), bl, `seed ${seed} ${lang}`);
          assert.ok(al.length <= 6);
          assert.match(al[at].value, new RegExp(`^${t.commits}\\b|^${t.commits} `));
          outcomes.row += 1;
        } else {
          assert.equal(al.length, bl.length, `seed ${seed} ${lang}`);
          const diff = al.map((r, i) => i).filter((i) => JSON.stringify(al[i]) !== JSON.stringify(bl[i]));
          assert.equal(diff.length, 1, `seed ${seed} ${lang}`);
          const [i] = diff;
          assert.equal(al[i].label, M.fixCommits);
          assert.deepEqual({ ...al[i], value: bl[i].value }, bl[i]);
          assert.ok([M.typosSegment(bl[i].value, t.commits, false), M.typosSegment(bl[i].value, t.commits, true)].includes(al[i].value), `seed ${seed} ${lang}: ${al[i].value}`);
          outcomes.segment += 1;
        }
      }
    }
    // Each path is exercised.
    for (const k of ['same', 'row', 'segment']) assert.ok(outcomes[k] > 0, `${k}: ${JSON.stringify(outcomes)}`);
  });
});

// ---- CLI on a real git repo ------------------------------------------------------------

describe('typo fixes: CLI on a real git repo (en / tr)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', LC_ALL: 'C' };
  let root;
  let repo;
  let repo2;
  const gitIn = (cwd, args, day) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, GIT_AUTHOR_DATE: `${day}T12:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T12:00:00+00:00` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const bin = (args) => {
    const e = { ...process.env, TZ: 'UTC' };
    delete e.FORCE_COLOR;
    delete e.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { cwd: ROOT, encoding: 'utf8', env: e });
  };
  const run = (args, name) => {
    const out = join(root, `${name}-out`);
    const r = bin([...args, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return { r, doc: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')), md: readFileSync(join(out, 'wrapped.md'), 'utf8') };
  };
  const build = (dir, subjects) => {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: { ...process.env, ...env } });
    gitIn(dir, ['config', 'commit.gpgsign', 'false'], '2025-01-01');
    subjects.forEach((s, i) => {
      writeFileSync(join(dir, 'a.txt'), `${i}\n`);
      gitIn(dir, ['add', '-A'], `2025-03-${String(1 + i).padStart(2, '0')}`);
      gitIn(dir, ['commit', '-q', '-m', s, '-m', 'Body says typo, which does not count.'], `2025-03-${String(1 + i).padStart(2, '0')}`);
    });
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-typos-extra-'));
    repo = join(root, 'app');
    repo2 = join(root, 'lib');
    // 8 non-merge commits; typo fixes: "fix typo", "docs: spelling", "Misspelt name", "YAZIM hatası" = 4.
    build(repo, ['add parser', 'fix typo in README', 'docs: spelling', 'Misspelt name', 'YAZIM hatası', 'docs: typography notes', 'link https://x.io/typo', 'mail typo@example.com']);
    // A merge with a typo subject: not counted.
    gitIn(repo, ['checkout', '-q', '-b', 'side'], '2025-03-20');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    gitIn(repo, ['add', '-A'], '2025-03-20');
    gitIn(repo, ['commit', '-q', '-m', 'side work'], '2025-03-20');
    gitIn(repo, ['checkout', '-q', 'main'], '2025-03-21');
    gitIn(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'Merge typo fixes from side'], '2025-03-21');
    // A second repo for the multi-repo run: 2 commits, 1 typo fix.
    build(repo2, ['fix typos', 'add lib']);
  });
  after(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('en: stats.json, recap and wrapped.md agree (merge, body, URL, email, typography not counted)', () => {
    const { r, doc, md } = run([repo, '--year', '2025'], 'en');
    // 9 non-merge commits (8 + side work); 4 typo fixes.
    assert.deepEqual(doc.stats.messages.typos, { commits: 4, share: 0.444 });
    assert.match(r.stdout, /\n {2}Typo fixes\s+4 commits \(44% of non-merge commits\)\n/);
    assert.match(md, /\n## Typo fixes\n\n4 commits \\\(44% of non-merge commits\\\)\n/);
    assert.equal(md.split('## Typo fixes').length, 2);
  });

  test('tr', () => {
    const { r, doc, md } = run([repo, '--year', '2025', '--lang', 'tr'], 'tr');
    assert.deepEqual(doc.stats.messages.typos, { commits: 4, share: 0.444 });
    assert.match(r.stdout, /\n {2}Yazım düzeltme\s+4 commit \(merge dışı commit'lerin %44 kadarı\)\n/);
    assert.match(md, /\n## Yazım düzeltmeleri\n\n4 commit \\\(merge dışı commit'lerin %44 kadarı\\\)\n/);
  });

  test('multi-repo: the histories add up', () => {
    const { r, doc, md } = run([repo, repo2, '--year', '2025'], 'multi');
    assert.deepEqual(doc.stats.messages.typos, { commits: 5, share: 0.455 });
    assert.match(r.stdout, /Typo fixes\s+5 commits \(45% of non-merge commits\)/);
    assert.match(md, /## Typo fixes\n\n5 commits \\\(45% of non-merge commits\\\)/);
  });

  test('a window without a typo fix: zeros in stats.json, no line, no section', () => {
    const { r, doc, md } = run([repo, '--since', '2025-03-01', '--until', '2025-03-01'], 'none');
    assert.deepEqual(doc.stats.messages.typos, { commits: 0, share: 0 });
    assert.doesNotMatch(r.stdout, /Typo fixes/);
    assert.doesNotMatch(md, /Typo fixes/);
  });
});
