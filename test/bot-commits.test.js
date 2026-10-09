import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeBots, computeStats as computeAllStats, isBotAuthor, shownBots } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { botsCard, buildCards, buildCardSpecs, cardDescription, layoutCard, rewrittenCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The messages card's spare-room rows after the issue references (subject length, top
// words) are left out, so these tests only see the rows before the bot-commits row.
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
};

const TODAY = '2026-04-01';
const LANGS = { en, tr };
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
const bot = (i, files, extra = {}) => commit(i, files, { ...DEPENDABOT, subject: `chore: bump x ${i}`, ...extra });
const merge = (i, extra = {}) => commit(i, [], { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}`, ...extra });

// One bot commit among three: the totals card has room for the row.
const roomy = () => [commit(1, [['src/a.js', 10, 1]]), bot(2, [['src/b.js', 4, 1]]), commit(3, [['src/a.js', 5, 1]])];
// Two repos: the totals card (with its per-repo chart) has no room, the messages card does.
const twoRepos = () => [
  commit(1, [['api/src/a.js', 10, 1]], { repo: 'api' }),
  bot(2, [['web/src/b.js', 1, 1]], { repo: 'web' }),
  commit(3, [['web/src/a.js', 5, 1]], { repo: 'web' }),
  commit(4, [['api/x.js', 5, 1]], { author: 'Bob', email: 'b@example.com', repo: 'api', born: ['api/x.js'] }),
];
const TWO = [{ label: 'api' }, { label: 'web' }];
// A human commit and a rebased bot commit: the totals card takes the rewritten-commits row, the messages card the bot row.
const rebasedBotMix = () => [commit(1, [['src/a.js', 10, 1]]), bot(2, [['src/b.js', 4, 1]], { committerDate: `${day(2)}T12:00:00+00:00`, subject: 'feat: change 2' })];

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts));
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isRow = (r, L = en) => [L.totals.bots, L.totals.botsLabelShort].includes(r?.label);
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isRow(r, L));
const isRewrittenRow = (r, L = en) => [L.totals.rewritten, L.totals.rewrittenLabelShort].includes(r?.label);

describe('isBotAuthor', () => {
  test('a "[bot]" name or email (local part), or a dependabot / renovate / github-actions name', () => {
    const yes = [
      ['dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com'],
      ['Some App', '12345+some-app[bot]@users.noreply.github.com'],
      ['x', 'ci[BOT]'],
      ['  my-app[Bot]  ', ''],
      ['dependabot-preview[bot]', ''],
      ['dependabot', 'support@github.com'],
      ['Dependabot', ''],
      ['renovate[bot]', ''],
      ['Renovate Bot', 'bot@renovateapp.com'],
      ['renovate-bot', ''],
      ['github-actions', 'github-actions@github.com'],
      ['github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'],
      ['GitHub Actions', ''],
      ['my-renovate-bot[bot]', ''],
      ['renovate\u200b', ''],
      ['Ada', 'ci[bot]\u200b@example.com'],
      ['x[bot]\u0000', ''],
    ];
    for (const [name, email] of yes) assert.equal(isBotAuthor(name, email), true, `${name} <${email}>`);
  });

  test('humans are not bots: whole words only, and only the name for the well-known bots', () => {
    const no = [
      ['Ada Lovelace', 'ada@example.com'],
      ['Renovated Kitchen', 'r@example.com'],
      ['Dependabotics', ''],
      ['Robot', 'robot@example.com'],
      ['Bot', 'bot@example.com'],
      ['Ada [bot] fan', 'ada@example.com'],
      ['Ada', 'renovate@example.com'],
      ['githubactions-fan', ''],
      ['Ada Renovate', ''],
      ['Ada (dependabot fan)', ''],
      ['my-renovate-bot', ''],
      ['_renovate_', ''],
      ['', ''],
    ];
    for (const [name, email] of no) assert.equal(isBotAuthor(name, email), false, `${name} <${email}>`);
  });

  test('non-strings count as empty; never throws', () => {
    for (const [n, e] of [[null, null], [undefined, undefined], [3, {}], [{}, 'x[bot]@y']]) {
      assert.doesNotThrow(() => isBotAuthor(n, e));
    }
    assert.equal(isBotAuthor(null, 'x[bot]@users.noreply.github.com'), true);
    assert.equal(isBotAuthor(5, 7), false);
  });
});

describe('computeBots', () => {
  test('bot non-merge commits, their share and the busiest bot', () => {
    const commits = [
      ...roomy(),
      bot(4, []),
      commit(5, [], { author: 'renovate[bot]', email: '29139614+renovate[bot]@users.noreply.github.com' }),
      merge(6, DEPENDABOT),
    ];
    const r = computeBots(commits);
    assert.deepEqual(r, { commits: 3, share: 0.6, top: { name: 'dependabot[bot]', commits: 2 } });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { commits: 3, share: 0.6, top: { name: 'dependabot[bot]', commits: 2 } });
  });

  test('ties go to the name first in code-unit order; bots grouped by name', () => {
    const commits = [
      commit(1, [], { author: 'renovate[bot]', email: 'a[bot]@x' }),
      commit(2, [], { author: 'Zed[bot]', email: '' }),
      commit(3, [], { author: 'Zed[bot]', email: 'other[bot]@x' }),
      commit(4, [], { author: 'renovate[bot]', email: 'b[bot]@x' }),
    ];
    assert.deepEqual(computeBots(commits).top, { name: 'Zed[bot]', commits: 2 });
  });

  test('grouped ignoring case, shown by the most used spelling', () => {
    const commits = [
      commit(1, [], { author: 'Renovate[bot]', email: '' }),
      commit(2, [], { author: 'renovate[bot]', email: '' }),
      commit(3, [], { author: 'RENOVATE[BOT]', email: '' }),
      commit(4, [], { author: 'renovate[bot]', email: '' }),
      commit(5, [], { author: 'a[bot]', email: '' }),
      commit(6, [], { author: 'a[bot]', email: '' }),
    ];
    assert.deepEqual(computeBots(commits).top, { name: 'renovate[bot]', commits: 4 });
  });

  test('an unnamed bot counts in commits and share but is never top: the busiest named bot wins', () => {
    const unnamed = (i) => commit(i, [], { author: '', email: `${i}+app[bot]@users.noreply.github.com` });
    assert.deepEqual(computeBots([unnamed(1), unnamed(2), unnamed(3), bot(4, []), commit(5, [])]), { commits: 4, share: 0.8, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.deepEqual(computeBots([unnamed(1), commit(2, [])]), { commits: 1, share: 0.5, top: null });
  });

  test('merges never count; null without a non-merge commit; {0, 0, null} without a bot', () => {
    assert.equal(computeBots([]), null);
    assert.equal(computeBots(null), null);
    assert.equal(computeBots([merge(1, DEPENDABOT)]), null);
    assert.deepEqual(computeBots([commit(1, []), merge(2, DEPENDABOT)]), { commits: 0, share: 0, top: null });
  });

  test('share: 1 only when every non-merge commit is a bot\'s, else at most 0.999', () => {
    assert.deepEqual(computeBots([bot(1, []), bot(2, [])]), { commits: 2, share: 1, top: { name: 'dependabot[bot]', commits: 2 } });
    const many = Array.from({ length: 2000 }, (_, i) => (i === 0 ? commit(i, []) : bot(i, [])));
    assert.equal(computeBots(many).share, 0.999);
    const few = Array.from({ length: 3000 }, (_, i) => (i === 0 ? bot(i, []) : commit(i, [])));
    assert.equal(computeBots(few).share, 0);
    assert.equal(computeBots(few).commits, 1);
  });

  test('no email ever: an address used as a name is cut, email-like text scrubbed', () => {
    const r = computeBots([commit(1, [], { author: 'ci-bot@example.com [bot]', email: '' }), commit(2, [], { author: '', email: 'x[bot]@users.noreply.github.com' })]);
    assert.equal(r.commits, 2);
    assert.doesNotMatch(JSON.stringify(r), /@/);
  });

  test('bad input never throws, never mutates', () => {
    const input = [null, 'x', 4, bot(1, []), commit(2, [])];
    const copy = JSON.parse(JSON.stringify(input));
    assert.deepEqual(computeBots(input), { commits: 1, share: 0.5, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.deepEqual(input, copy);
  });

  test('computeStats puts bots right after rewritten; stats.json keeps exactly {commits, share, top} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('rewritten') + 1], 'bots');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.bots, { commits: 1, share: 0.333, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([merge(1)]), repoName: 'demo', version: '0.0.0', asOf: TODAY })).stats.bots, null);
  });
});

describe('shownBots', () => {
  test('whole commits, a percent from the exact ratio (never 100% short of all), the top; null without one', () => {
    const r = computeBots(roomy());
    assert.deepEqual(shownBots(r), { commits: 1, pct: (1 / 3) * 100, top: { name: 'dependabot[bot]', commits: 1 } });
    assert.deepEqual(shownBots({ commits: 2, share: 1, top: null }), { commits: 2, pct: 100, top: null });
    assert.deepEqual(shownBots({ commits: 2, share: 0.9999 }), { commits: 2, pct: 99.9, top: null });
    assert.deepEqual(shownBots({ commits: 2, share: 0.5, top: { name: 'x', commits: 9 } }).top, { name: 'x', commits: 2 });
    for (const top of ['x', { name: '' }, { name: 'x', commits: 0 }, { name: 5, commits: 1 }]) {
      assert.equal(shownBots({ commits: 2, share: 0.5, top }).top, null, JSON.stringify(top));
    }
    assert.deepEqual(shownBots({ commits: 2, share: 0.5, top: { name: 'a@b.com', commits: 1 } }).top, { name: 'a', commits: 1 });
    for (const v of [null, undefined, 'x', { commits: 0, share: 0, top: null }, { commits: -1, share: 0.5 }, { commits: NaN }]) {
      assert.equal(shownBots(v), null, JSON.stringify(v));
    }
  });
});

describe('cards', () => {
  test('a "Bot commits" row last on the totals card when there is room, with the busiest bot, en and tr', () => {
    const s = statsOf(roomy());
    assert.equal(botsCard(s, { L: en }), 'totals');
    const spec = specOf(s, 'totals');
    assert.deepEqual(spec.lines.at(-1), { label: 'Bot commits', value: '1 commit · 33%', description: '1 commit by bots (33% of non-merge commits); busiest: dependabot[bot] (1 commit)' });
    assert.equal(rowOf(specOf(s, 'messages')), undefined);
    const t = rowOf(specOf(s, 'totals', 'tr'), tr);
    assert.ok(t, 'tr row');
    assert.match(t.value, /^1( commit)? · %33/);
    assert.match(cardDescription(specOf(s, 'totals', 'tr')), /merge dışı commit'lerin %33 kadarı/);
  });

  test('the busiest bot only in the hover text; none without a top bot', () => {
    const s = statsOf(roomy());
    const plain = rowOf(specOf({ ...s, bots: { commits: 1, share: 0.333, top: null } }, 'totals'));
    assert.equal(plain.value, '1 commit · 33%');
    assert.equal(plain.description, '1 commit by bots (33% of non-merge commits)');
    const long = rowOf(specOf({ ...s, bots: { commits: 1, share: 0.333, top: { name: 'a-very-long-github-app-name[bot]', commits: 1 } } }, 'totals'));
    assert.equal(long.value, '1 commit · 33%');
    assert.match(long.description, /busiest: a-very-long-github-app-name\[bot\] \(1 commit\)$/);
  });

  test('strictly after the rewritten-commits row: on the same card, or on the messages card when the totals card is full', () => {
    // Every commit the bot's: one contributor, room for both rows on the totals card.
    const same = statsOf([bot(1, [['src/a.js', 10, 1]]), bot(2, [['src/b.js', 4, 1]], { committerDate: `${day(2)}T12:00:00+00:00` })]);
    assert.equal(rewrittenCard(same, { L: en }), 'totals');
    assert.equal(botsCard(same, { L: en }), 'totals');
    const lines = specOf(same, 'totals').lines;
    assert.ok(isRow(lines.at(-1)));
    assert.ok(isRewrittenRow(lines.at(-2)));
    // With a contributors row the totals card only has room for the rewritten-commits row.
    const split = statsOf(rebasedBotMix());
    assert.equal(rewrittenCard(split, { L: en }), 'totals');
    assert.equal(botsCard(split, { L: en }), 'messages');
    assert.ok(isRewrittenRow(specOf(split, 'totals').lines.at(-1)));
    assert.ok(isRow(specOf(split, 'messages').lines.at(-1)));
  });

  test('on the messages card, last, when the totals card has no room', () => {
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const s = statsOf(twoRepos(), { repos: TWO });
      assert.equal(rowOf(specOf(s, 'totals', lang), L), undefined, lang);
      assert.ok(isRow(specOf(s, 'messages', lang).lines.at(-1), L), lang);
    }
  });

  test('never displaces anything: every other card byte-identical, the one card only gains the row', () => {
    const cases = [[roomy()], [twoRepos(), { repos: TWO }], [rebasedBotMix()]];
    for (const [commits, opts] of cases) {
      const s = statsOf(commits, opts);
      const without = { ...s, bots: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const a = svgs(s, lang);
        const b = svgs(without, lang);
        assert.deepEqual(a.map(([id]) => id), b.map(([id]) => id));
        let shown = 0;
        for (const [i, [id, svg]] of a.entries()) {
          if (svg === b[i][1]) continue;
          shown += 1;
          assert.ok(['totals', 'messages'].includes(id), id);
          const spec = specOf(s, id, lang);
          const base = specOf(without, id, lang);
          assert.ok(isRow(spec.lines.at(-1), L), id);
          assert.deepEqual(spec.lines.slice(0, -1), base.lines);
          const la = layoutCard({ ...spec, lang });
          const lb = layoutCard({ ...base, lang });
          assert.deepEqual(la.drawnCharts, lb.drawnCharts, id);
          assert.ok(la.shrinkSteps <= lb.shrinkSteps, id);
        }
        assert.equal(shown, 1, lang);
      }
    }
  });

  test('no row for null, 0 or a malformed value: cards byte-identical', () => {
    const s = statsOf(roomy());
    const without = svgs({ ...s, bots: null });
    for (const bots of [undefined, { commits: 0, share: 0, top: null }, 'x', { commits: -2, share: 2 }]) {
      assert.deepEqual(svgs({ ...s, bots }), without, JSON.stringify(bots));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('"<1%" for a tiny share; none when even the shortest form would be cut', () => {
    const s = statsOf(roomy());
    assert.match(rowOf(specOf({ ...s, bots: { commits: 3, share: 0, top: null } }, 'totals')).value, /^3( commits)? · <1%$/);
    const huge = { ...s, bots: { commits: 123456789012345678, share: 0.5, top: null } };
    assert.equal(rowOf(specOf(huge, 'totals')), undefined);
    assert.equal(rowOf(specOf(huge, 'messages')), undefined);
  });

  test('empty history: no row anywhere', () => {
    const s = { ...statsOf([]), bots: { commits: 4, share: 0.5, top: null } };
    for (const c of specs(s)) assert.equal(rowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the rewritten commits, en and tr; none without a bot commit', () => {
    const s = statsOf([...roomy(), bot(9, [], { committerDate: `${day(9)}T12:00:00+00:00` })]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Rewritten.*\n {2}Bot commits {2}2 commits \(50% of non-merge commits\) · top dependabot\[bot\] \(2 commits\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Bot commit'leri\s+2 commit \(merge dışı commit'lerin %50 kadarı\) · en çok dependabot\[bot\] \(2 commit\)\n/);
    for (const bots of [null, { commits: 0, share: 0, top: null }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, bots }, { repoName: 'demo', today: TODAY }), /Bot commits/);
    }
    assert.match(formatSummary({ ...s, bots: { commits: 2, share: 0.5, top: null } }, { repoName: 'demo', today: TODAY }), /Bot commits {2}2 commits \(50% of non-merge commits\)\n/);
  });

  test('wrapped.md section after the rewritten commits, en and tr; none without a bot commit', () => {
    const s = statsOf([...roomy(), bot(9, [], { committerDate: `${day(9)}T12:00:00+00:00` })]);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /## Rewritten commits[\s\S]*## Bot commits\n\n2 commits \\\(50% of non-merge commits\\\); busiest: dependabot\\\[bot\\\] \\\(2 commits\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Bot commit'leri\n\n2 commit \\\(merge dışı commit'lerin %50 kadarı\\\); en çok commit atan bot: dependabot\\\[bot\\\] \\\(2 commit\\\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, bots: { commits: 0, share: 0, top: null } }, { repoName: 'demo', today: TODAY }), /Bot commits/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      for (const k of ['bots', 'botsLabelShort']) assert.equal(typeof L.totals[k], 'string', k);
      for (const k of ['botsValue', 'botsShort']) assert.equal(typeof L.totals[k](3, '5%'), 'string', k);
      assert.equal(typeof L.totals.botsDescription(3, '5%', 'x[bot]', 2), 'string');
      assert.equal(typeof L.recap.bots, 'string');
      assert.ok(L.recap.bots.length < L.recap.labelWidth);
      assert.equal(typeof L.recap.topBot('x', '2 commits'), 'string');
      assert.equal(typeof L.markdown.bots, 'string');
      assert.equal(typeof L.markdown.topBot, 'string');
    }
  });
});

describe('git (real repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let dir;
  let out;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-bots-'));
    out = mkdtempSync(join(tmpdir(), 'gw-bots-out-'));
    git(dir, ['init', '-q', '-b', 'main']);
    // .mailmap maps an old bot identity onto the canonical one, and a person's bot-looking
    // alias onto the person.
    writeFileSync(join(dir, '.mailmap'), [
      'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> dependabot-preview[bot] <27856297+dependabot-preview[bot]@users.noreply.github.com>',
      'Grace <grace@example.com> grace-bot[bot] <grace[bot]@example.com>',
      '',
    ].join('\n'));
    const steps = [
      ['a.txt', 'Ada', 'ada@example.com'],
      ['b.txt', 'dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com'],
      ['c.txt', 'dependabot-preview[bot]', '27856297+dependabot-preview[bot]@users.noreply.github.com'],
      ['d.txt', 'Renovate Bot', 'bot@renovateapp.com'],
      ['e.txt', 'grace-bot[bot]', 'grace[bot]@example.com'],
    ];
    for (const [i, [file, name, email]] of steps.entries()) {
      writeFileSync(join(dir, file), `${file}\n`);
      git(dir, ['add', '-A']);
      const at = `2026-03-0${i + 1}T10:00:00+00:00`;
      git(dir, ['commit', '-q', '-m', `add ${file}`], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
    }
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  test('readCommits applies .mailmap: three of five commits are bots, dependabot the busiest', async () => {
    const res = await readCommits(dir);
    const commits = res.commits ?? res;
    assert.equal(commits.length, 5);
    assert.deepEqual(computeBots(commits), { commits: 3, share: 0.6, top: { name: 'dependabot[bot]', commits: 2 } });
  });

  test('generate: stats.json, recap and wrapped.md; no email anywhere', async () => {
    const r = await generate({ path: dir, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.bots, { commits: 3, share: 0.6, top: { name: 'dependabot[bot]', commits: 2 } });
    const md = readFileSync(r.markdown, 'utf8');
    assert.match(md, /## Bot commits\n\n3 commits \\\(60% of non-merge commits\\\); busiest: dependabot\\\[bot\\\] \\\(2 commits\\\)/);
    assert.doesNotMatch(md, /noreply|renovateapp/);
    assert.match(formatSummary(r.stats, { repoName: 'demo', today: TODAY }), /Bot commits\s+3 commits \(60% of non-merge commits\) · top dependabot\[bot\] \(2 commits\)/);
  });
});
