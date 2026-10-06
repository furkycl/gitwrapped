// Contributors stat + card (M8): computeContributors (identity, names, ranking, "you",
// privacy), the optional 08-contributors card (skipped for single-author histories, card
// numbering stays contiguous), the recap line, and "you vs the team" end to end through
// generate() on real repos (with a .mailmap).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCards, buildCardSpecs, CARD_IDS, cardIdsFor, layoutCard, OPTIONAL_CARD_IDS } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { generate, run } from '../src/cli.js';
import { readCommits } from '../src/git.js';
import { computeContributors, computeStats, computeTotals, contributorName, hasTeamCard, shareLabel, TOP_CONTRIBUTORS } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';
const pad = (n) => String(n).padStart(2, '0');
const stems = (ids) => ids.map((id, i) => `${pad(i + 1)}-${id}`);

/** A commit as readCommits() returns it. */
const c = (author, email, { added = 0, removed = 0, date = '2026-10-01T10:00:00+00:00', parents = ['p'] } = {}) => ({
  hash: `${email}-${date}-${added}`, author, email, date, parents, subject: 'feat: x', files: [], filesChanged: 0, linesAdded: added, linesRemoved: removed,
});
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// ---------------------------------------------------------------------------------------
describe('computeContributors', () => {
  test('empty / missing input', () => {
    const empty = { total: 0, top: [], you: null, authorFilter: false, truncated: false };
    assert.deepEqual(computeContributors([]), empty);
    assert.deepEqual(computeContributors(), empty);
    assert.deepEqual(computeContributors(null, { author: 'a@x.io', truncated: 1 }), { ...empty, authorFilter: true, truncated: true });
    assert.equal(computeContributors([], { author: '   ' }).authorFilter, false);
  });

  test('ranks by commits, then lines changed, then name; shares are one-decimal percents', () => {
    const commits = [
      ...times(3, () => c('Ada', 'ada@x.io', { added: 1 })),
      ...times(2, () => c('Bob', 'bob@x.io', { added: 50, removed: 50 })),
      ...times(2, () => c('Cy', 'cy@x.io', { added: 1 })),
      ...times(2, () => c('Al', 'al@x.io', { added: 1 })),
    ];
    const r = computeContributors(commits);
    assert.equal(r.total, 4);
    assert.equal(r.you, null);
    assert.deepEqual(r.top, [
      { name: 'Ada', rank: 1, commits: 3, added: 3, removed: 0, share: 33.3 },
      { name: 'Bob', rank: 2, commits: 2, added: 100, removed: 100, share: 22.2 },
      // Same commits and lines: alphabetical.
      { name: 'Al', rank: 3, commits: 2, added: 2, removed: 0, share: 22.2 },
      { name: 'Cy', rank: 4, commits: 2, added: 2, removed: 0, share: 22.2 },
    ]);
    // Input order does not matter.
    assert.deepEqual(computeContributors([...commits].reverse()), r);
  });

  test('one identity per email (case-insensitive); the most frequent name wins, ties alphabetical', () => {
    const r = computeContributors([
      c('Ada L.', 'Ada@X.io'), c('Ada Lovelace', 'ada@x.io'), c('Ada Lovelace', 'ADA@x.io'),
      c('Zed', 'z@x.io'), c('Bea', 'z@x.io'),
    ]);
    assert.equal(r.total, 2);
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Ada Lovelace', 3], ['Bea', 2]]);
  });

  test('a commit without an email is keyed by its name; no name at all reads "Unknown"', () => {
    const r = computeContributors([c('Solo', ''), c('solo', ''), c('Other', ''), c('', '')]);
    assert.equal(r.total, 3);
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Solo', 2], ['Other', 1], ['Unknown', 1]]);
    // The name key ignores case and runs of whitespace, like the display name.
    const ghosts = computeContributors([c('Ghost  X', ''), c('ghost x', ''), c(' Ghost\tX ', '')]);
    assert.equal(ghosts.total, 1);
    assert.deepEqual(ghosts.top.map((p) => [p.name, p.commits]), [['Ghost X', 3]]);
    // An email-less identity never matches --author.
    assert.equal(computeContributors([c('Solo', '')], { author: '' }).you, null);
  });

  test('merges count as commits and lines add up to the totals (same rules as totals.js)', () => {
    const commits = [
      c('Ada', 'ada@x.io', { added: 5, removed: 1 }),
      c('Ada', 'ada@x.io', { parents: ['a', 'b'] }), // merge: no numstat
      c('Bob', 'bob@x.io', { added: 2, removed: 7 }),
      { ...c('Bob', 'bob@x.io'), linesAdded: NaN, linesRemoved: '3' }, // bad counts → 0
    ];
    const r = computeContributors(commits);
    const t = computeTotals(commits);
    assert.equal(r.top.reduce((n, p) => n + p.commits, 0), t.commits);
    assert.equal(r.top.reduce((n, p) => n + p.added, 0), t.linesAdded);
    assert.equal(r.top.reduce((n, p) => n + p.removed, 0), t.linesRemoved);
    assert.equal(r.total, t.authors);
    // Tied on commits: Bob changed more lines (9 vs 6).
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Bob', 2], ['Ada', 2]]);
  });

  test(`top lists ${TOP_CONTRIBUTORS}; "you" is found by exact, case-insensitive email, even outside the top`, () => {
    const commits = times(8, (i) => times(10 - i, () => c(`P${i}`, `p${i}@x.io`))).flat();
    const r = computeContributors(commits, { author: '  P7@X.IO ' });
    assert.equal(r.total, 8);
    assert.equal(r.top.length, TOP_CONTRIBUTORS);
    assert.deepEqual(r.you, { name: 'P7', rank: 8, commits: 3, added: 0, removed: 0, share: 5.8 });
    assert.equal(computeContributors(commits, { author: 'p0@x.io' }).you.rank, 1);
    // Not a substring or a name match: exact email only.
    for (const author of ['p7@x', 'x.io', 'P7', '<p7@x.io>', 'p7@x.io|p1@x.io']) {
      assert.equal(computeContributors(commits, { author }).you, null, author);
    }
    assert.equal(computeContributors(commits).you, null);
  });

  test('never returns an email: not as a key, and not when a name is really an address', () => {
    const r = computeContributors([
      c('ada@example.com', 'ada@example.com'),
      c('Bob <bob@example.com>', 'bob@example.com'),
      c('<cy@example.com>', 'cy@example.com'),
    ], { author: 'ada@example.com' });
    const json = JSON.stringify(r);
    assert.doesNotMatch(json, /@|example\.com/);
    assert.deepEqual(r.top.map((p) => p.name).sort(), ['Bob', 'ada', 'cy']);
    assert.equal(r.you.name, 'ada');
    for (const p of r.top) assert.deepEqual(Object.keys(p), ['name', 'rank', 'commits', 'added', 'removed', 'share']);
  });

  test('contributorName and shareLabel', () => {
    assert.equal(contributorName('  Ada   Lovelace '), 'Ada Lovelace');
    assert.equal(contributorName('a@b.c'), 'a');
    assert.equal(contributorName('Ada <a@b.c>'), 'Ada');
    assert.equal(contributorName('@b.c'), null);
    assert.equal(contributorName(''), null);
    assert.equal(contributorName(undefined), null);
    assert.equal(shareLabel(31.3, 5), '31%');
    assert.equal(shareLabel(0.4, 1), '<1%');
    assert.equal(shareLabel(0, 1), '<1%');
    assert.equal(shareLabel(0, 0), '0%');
    assert.equal(shareLabel(99.6, 999), '99%');
    assert.equal(shareLabel(100, 3), '100%');
    assert.equal(shareLabel(NaN, 0), '0%');
  });

  test('computeStats: contributors from `team` when given, "you" from `author`', () => {
    const mine = [c('Ada', 'ada@x.io'), c('Ada', 'ada@x.io')];
    const team = [...mine, c('Bob', 'bob@x.io'), c('Bob', 'bob@x.io'), c('Bob', 'bob@x.io')];
    const s = computeStats(mine, { today: TODAY, team, author: 'ada@x.io' });
    assert.equal(s.totals.commits, 2);
    assert.equal(s.contributors.total, 2);
    assert.deepEqual(s.contributors.you, { name: 'Ada', rank: 2, commits: 2, added: 0, removed: 0, share: 40 });
    assert.deepEqual(computeStats(mine, { today: TODAY }).contributors, computeContributors(mine));
  });
});

// ---------------------------------------------------------------------------------------
/** Stats for `commits` with an optional team / author. */
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const specOf = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'contributors')?.spec;
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');

describe('contributors card', () => {
  test('is optional and sits after languages', () => {
    assert.deepEqual(OPTIONAL_CARD_IDS, ['contributors']);
    assert.equal(CARD_IDS.indexOf('contributors'), CARD_IDS.indexOf('languages') + 1);
    assert.equal(CARD_IDS.length, 11);
    assert.deepEqual(cardIdsFor({}), CARD_IDS.filter((id) => id !== 'contributors'));
    assert.deepEqual(cardIdsFor(null), cardIdsFor({}));
    assert.deepEqual(cardIdsFor({ contributors: { total: 1 } }), cardIdsFor({}));
    assert.deepEqual(cardIdsFor({ contributors: { total: 2 } }), [...CARD_IDS]);
    assert.deepEqual(cardIdsFor({ contributors: { total: '7' } }), cardIdsFor({}), 'a non-number total is no team');
  });

  test('single author: skipped, cards numbered 01..10 without a gap', () => {
    const specs = buildCardSpecs(statsOf([c('Ada', 'ada@x.io'), c('Ada again', 'ADA@x.io')]), { today: TODAY });
    assert.equal(specs.length, 10);
    assert.ok(!specs.some((s) => s.id === 'contributors'));
    assert.deepEqual(specs.map((s) => s.spec.number), times(10, (i) => pad(i + 1)));
    assert.deepEqual(specs.map((s) => s.id), cardIdsFor({}));
  });

  test('two authors: card 08 of 11, numbering contiguous, later cards shift by one', () => {
    const cards = buildCards(statsOf([c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')]), { today: TODAY });
    const specs = buildCardSpecs(statsOf([c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')]), { today: TODAY });
    assert.deepEqual(cards.map((x) => x.id), [...CARD_IDS]);
    assert.deepEqual(specs.map((s) => s.spec.number), times(11, (i) => pad(i + 1)));
    assert.equal(specs.find((s) => s.id === 'contributors').spec.number, '08');
    assert.equal(specs.find((s) => s.id === 'outro').spec.number, '11');
    // Card ids stay unique and prefixed.
    const ids = cards.flatMap((x) => [...x.svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('gw-contributors-bg'));
  });

  test('team view: headcount, leader and top bars by commits', () => {
    const commits = [
      ...times(5, () => c('Ada Lovelace', 'ada@x.io', { added: 3 })),
      ...times(3, () => c('Bob', 'bob@x.io')),
      ...times(2, () => c('Cy', 'cy@x.io')),
    ];
    const spec = specOf(statsOf(commits));
    assert.equal(spec.eyebrow, 'The team');
    assert.equal(spec.big, '3');
    assert.equal(spec.title, 'contributors');
    assert.equal(spec.subtitle, 'Ada Lovelace leads the pack with 50% of the commits.');
    assert.equal(spec.chart.kind, 'hbars');
    assert.deepEqual(spec.chart.items.map((x) => [x.label, x.value, x.amount, x.sub]), [
      ['Ada Lovelace', '5 commits', 5, ''], ['Bob', '3 commits', 3, ''], ['Cy', '2 commits', 2, ''],
    ]);
    assert.equal(spec.chart.items[0].title, 'Ada Lovelace: #1, 5 commits (50%), +15 / 0 lines');
  });

  test('a tie at the top is named; more than three tied reads "Several people"', () => {
    const two = specOf(statsOf([c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')]));
    assert.equal(two.subtitle, 'Ada and Bob share the lead with 1 commit each.');
    const four = specOf(statsOf(['A', 'B', 'C', 'D'].map((n) => c(n, `${n}@x.io`))));
    assert.equal(four.subtitle, 'Several people share the lead with 1 commit each.');
    assert.equal(four.big, '4');
  });

  test('you vs the team: rank, share and a "you" marker on your bar', () => {
    const team = [
      ...times(6, () => c('Ada', 'ada@x.io')),
      ...times(3, () => c('Me', 'me@x.io', { added: 4, removed: 1 })),
      c('Bob', 'bob@x.io'),
    ];
    const mine = team.filter((x) => x.email === 'me@x.io');
    const stats = statsOf(mine, { team, author: 'ME@x.io' });
    const spec = specOf(stats, { author: 'ME@x.io' });
    assert.equal(spec.big, '#2');
    assert.equal(spec.title, 'of 3 contributors');
    assert.equal(spec.subtitle, 'You made 30% of the commits: 3 commits, +12 / −3 lines.');
    assert.deepEqual(spec.chart.items.map((x) => [x.label, x.sub]), [['Ada', ''], ['Me', 'you'], ['Bob', '']]);
    assert.match(spec.chart.items[1].title, /^Me \(you\): #2, 3 commits \(30%\)/);
  });

  test('you outside the top five get a sixth bar with your rank', () => {
    const team = [...times(7, (i) => times(10 - i, () => c(`P${i}`, `p${i}@x.io`))).flat(), c('Me', 'me@x.io')];
    const stats = statsOf([c('Me', 'me@x.io')], { team, author: 'me@x.io' });
    const spec = specOf(stats);
    assert.equal(spec.big, '#8');
    assert.equal(spec.title, 'of 8 contributors');
    assert.equal(spec.chart.items.length, 6);
    assert.deepEqual([spec.chart.items[5].label, spec.chart.items[5].sub], ['Me', 'you · #8']);
    assert.match(spec.subtitle, /^You made 2% of the commits/);
  });

  test('--author that matches nobody: no contributors card and no Team line (they agree)', () => {
    const team = [c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')];
    for (const mine of [[], [c('Zed', 'zed@x.io')]]) {
      const stats = statsOf(mine, { team, author: 'nobody@x.io' });
      assert.equal(hasTeamCard(stats), false);
      assert.equal(specOf(stats, { author: 'nobody@x.io' }), undefined);
      assert.doesNotMatch(formatSummary(stats), /Team/);
    }
    assert.equal(hasTeamCard(statsOf(team)), true);
    assert.equal(hasTeamCard(statsOf(team, { author: 'ada@x.io' })), true);
    assert.equal(hasTeamCard({ contributors: { total: 2, authorFilter: true, you: { commits: 0 } } }), false);
    assert.equal(hasTeamCard(null), false);
  });

  test('copes with odd stats; never prints null/undefined/NaN; layout stays in bounds', () => {
    const odd = [
      { contributors: { total: 2 } },
      { contributors: { total: 2, top: null, you: { rank: 0 } } },
      { contributors: { total: 3, top: [{ name: null, commits: 2 }, { name: '  ', commits: 1, share: NaN }, null, { name: 'zero', commits: 0 }] } },
      { contributors: { total: 1e300, top: [{ name: 'W'.repeat(500), rank: 1, commits: 1e300, added: 1e300, removed: -5, share: 1e300 }], you: { name: '<b>&', rank: 1e12, commits: 1, share: 0 } } },
    ];
    for (const stats of odd) {
      const card = buildCards(stats, { today: TODAY }).find((x) => x.id === 'contributors');
      assert.ok(card, JSON.stringify(stats));
      assert.doesNotMatch(card.svg, /\b(?:null|undefined|NaN|Infinity)\b|\[object Object\]/);
      assert.doesNotMatch(card.description, /\b(?:null|undefined|NaN)\b/);
      assert.doesNotMatch(card.svg, /<b>/);
      const { blocks } = layoutCard(specOf(stats));
      for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${b.kind} ${b.top}..${b.bottom}`);
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), 'blocks overlap');
      }
    }
    assert.match(buildCards(odd[2], {}).find((x) => x.id === 'contributors').svg, />Unknown</);
  });

  test('description reads the card for assistive tech', () => {
    const team = [c('Ada', 'ada@x.io'), c('Ada', 'ada@x.io'), c('Me', 'me@x.io')];
    const card = buildCards(statsOf(team.slice(2), { team, author: 'me@x.io' }), { author: 'me@x.io' }).find((x) => x.id === 'contributors');
    assert.match(card.description, /^The team\. #2 of 2 contributors\. You made 33% of the commits/);
    assert.match(card.description, /Top contributors by commits\. Ada: #1, 2 commits \(67%\)/);
    assert.match(card.description, /Me \(you\): #2, 1 commit \(33%\)/);
  });
});

// ---------------------------------------------------------------------------------------
describe('terminal recap', () => {
  test('a Team line for 2+ contributors only', () => {
    const solo = formatSummary(statsOf([c('Ada', 'ada@x.io')]));
    assert.doesNotMatch(solo, /Team/);
    const team = [c('Ada', 'ada@x.io'), c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')];
    assert.match(formatSummary(statsOf(team)), /\n {2}Team {9}2 contributors · top: Ada \(67%\)\n/);
    assert.match(formatSummary(statsOf([c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')])), /Team {9}2 contributors · top: Ada \(50%, tied\)/);
    const mine = formatSummary(statsOf(team.slice(2), { team, author: 'bob@x.io' }));
    assert.match(mine, /Team {9}2 contributors · you're #2 \(33% of commits\)/);
    assert.doesNotMatch(mine, /@/);
  });

  test('strips control characters from names', () => {
    const out = formatSummary(statsOf([c('Ev\x1b[31mil', 'e@x.io'), c('Ev\x1b[31mil', 'e@x.io'), c('B', 'b@x.io')]));
    assert.match(out, /top: Ev\[31mil/);
    assert.ok(!out.includes('\x1b'));
  });
});

// ---------------------------------------------------------------------------------------
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', LC_ALL: 'C' };
function git(cwd, args, extra = {}) {
  const env = { ...process.env, ...GIT_ENV, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A repo at <tmp>/<name>; `commits`: [name, email, ISO date, file?]. `.mailmap` content optional. */
function makeRepo(root, name, commits, mailmap) {
  const dir = join(root, name);
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  if (mailmap) {
    writeFileSync(join(dir, '.mailmap'), mailmap);
  }
  commits.forEach(([who, email, date, file = 'f.txt'], i) => {
    writeFileSync(join(dir, file), `${i}\n`, { flag: 'a' });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-gpg-sign', '--no-verify', '-m', `commit ${i}`], {
      GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
    });
  });
  return dir;
}

describe('end to end', () => {
  let root;
  let fixture;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-contributors-'));
    fixture = makeFixtureRepo();
  });
  after(() => {
    fixture?.cleanup();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const out = (name) => join(root, 'out', name);

  test('.mailmap merges identities and fixes names (readCommits is mailmapped)', async () => {
    const dir = makeRepo(root, 'mailmap', [
      ['ada', 'ada@old.example', '2026-09-01T10:00:00+00:00'],
      ['Ada L.', 'ada@new.example', '2026-09-02T10:00:00+00:00'],
      ['Ada L.', 'ada@new.example', '2026-09-03T10:00:00+00:00'],
      ['bob', 'bob@example.com', '2026-09-04T10:00:00+00:00'],
    ], 'Ada Lovelace <ada@new.example>\nAda Lovelace <ada@new.example> <ada@old.example>\nBob Builder <bob@example.com>\n');
    const r = computeContributors(await readCommits(dir), { author: 'ADA@new.example' });
    assert.equal(r.total, 2);
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Ada Lovelace', 3], ['Bob Builder', 1]]);
    assert.equal(r.you.rank, 1);
    // --author matches the mailmapped email, so the old address is the same person.
    const g = await generate({ path: dir, out: out('mailmap'), png: false, json: true, author: 'ada@old.example' }, { today: TODAY });
    assert.equal(g.commits, 0, 'git matches --author after .mailmap: the old address is gone');
    const g2 = await generate({ path: dir, out: out('mailmap2'), png: false, json: true, author: 'ada@new.example' }, { today: TODAY });
    assert.equal(g2.commits, 3);
    // 3 lines of f.txt plus the 3-line .mailmap added with the first commit.
    assert.deepEqual(g2.stats.contributors.you, { name: 'Ada Lovelace', rank: 1, commits: 3, added: 6, removed: 0, share: 75 });
  });

  test('--author on the fixture: filtered totals, ranked against the unfiltered team', async () => {
    const o = out('author');
    const r = await generate({ path: fixture.dir, out: o, png: false, json: true, author: 'BOB@example.com' }, { today: TODAY });
    assert.equal(r.commits, 4);
    assert.equal(r.stats.totals.commits, 4);
    assert.equal(r.teamTruncated, false);
    const team = r.stats.contributors;
    assert.equal(team.total, 2);
    assert.deepEqual(team.top.map((p) => [p.name, p.commits]), [['Ada Lovelace', 4], ['Bob Builder', 4]]);
    // Ada and Bob tie on commits (4 each); Ada changed more lines (19 vs 18).
    assert.deepEqual(team.you, { name: 'Bob Builder', rank: 2, commits: 4, added: 10, removed: 8, share: 50 });
    // Your own numbers on the card agree with your filtered totals.
    assert.equal(team.you.added, r.stats.totals.linesAdded);
    assert.equal(team.you.removed, r.stats.totals.linesRemoved);

    assert.deepEqual(readdirSync(join(o, 'cards')).sort(), stems(CARD_IDS).map((s) => `${s}.svg`));
    const svg = readFileSync(join(o, 'cards', '08-contributors.svg'), 'utf8');
    const text = svgText(svg);
    assert.match(text, /#2 \| of 2 contributors/);
    assert.match(text, /Bob Builder \| you/);
    assert.doesNotMatch(svg, /@|example\.com/);
    const json = readFileSync(join(o, 'stats.json'), 'utf8');
    // The only email in stats.json is the --author filter you passed.
    assert.deepEqual(json.match(/[\w.]+@[\w.]+/g), ['BOB@example.com']);
    assert.doesNotMatch(readFileSync(r.html, 'utf8'), /@example\.com/);
  });

  test('without --author there is no "you"; the team is the history read', async () => {
    const r = await generate({ path: fixture.dir, out: out('noauthor'), png: false }, { today: TODAY });
    assert.equal(r.stats.contributors.you, null);
    assert.equal(r.stats.contributors.total, r.stats.totals.authors);
    assert.equal(r.cardFiles.length, 11);
    const text = svgText(readFileSync(join(r.cardsDir, '08-contributors.svg'), 'utf8'));
    assert.match(text, /2 \| contributors/);
    assert.match(text, /Ada Lovelace and Bob Builder \| share the lead with 4 commits \| each\./);
  });

  test('--author ranks within the same window and cap; a capped team read is noted', async () => {
    // --since 2024-03-10: ada 03-10, 03-12; bob 03-11, 03-13.
    const r = await generate({ path: fixture.dir, out: out('window'), png: false, since: '2024-03-10', author: 'ada@example.com' }, { today: TODAY });
    assert.equal(r.commits, 2);
    assert.equal(r.stats.contributors.total, 2);
    assert.equal(r.stats.contributors.you.commits, 2);
    assert.equal(r.stats.contributors.you.share, 50);
    // --max-commits 3: Ada's 3 latest commits; everyone since the oldest of them is still
    // over the cap, so the team is the latest 3 of everyone's, Ada counted within them.
    const capped = await generate({ path: fixture.dir, out: out('capped'), png: false, maxCommits: 3, author: 'ada@example.com' }, { today: TODAY });
    assert.equal(capped.truncated, true);
    assert.equal(capped.teamTruncated, true);
    assert.equal(capped.teamSpan.capped, true);
    assert.equal(capped.stats.contributors.top.reduce((n, p) => n + p.commits, 0), 3);
    assert.ok(capped.stats.contributors.you.commits <= capped.stats.totals.commits);
    assert.equal(capped.stats.contributors.truncated, true);
    assert.equal(r.stats.contributors.truncated, false);
    // Without --author the contributors come from the main read: its cap is theirs.
    const plain = await generate({ path: fixture.dir, out: out('capped-plain'), png: false, maxCommits: 3, json: true }, { today: TODAY });
    assert.equal(plain.stats.contributors.truncated, true);
    assert.equal(JSON.parse(readFileSync(plain.statsJson, 'utf8')).stats.contributors.truncated, true);
    const solo = await generate({ path: fixture.dir, out: out('capped4'), png: false, maxCommits: 4, author: 'ada@example.com' }, { today: TODAY });
    assert.equal(solo.truncated, false);
    assert.equal(solo.teamTruncated, true);
    // The recap says so whenever the team card is built from a capped team read.
    let text = '';
    const stdout = { write: (x) => { text += x; return true; } };
    const code = await run([fixture.dir, '--max-commits', '4', '--author', 'ada@example.com', '--no-png', '--out', out('capped-run')], { stdout, stderr: { write: () => true }, env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.match(text, /Note: the contributors card ranks only the most recent 4 commits by everyone \(from Mar 10, 2024\), you included\./);
    text = '';
    await run([fixture.dir, '--max-commits', '3', '--author', 'ada@example.com', '--no-png', '--out', out('capped-run3')], { stdout, stderr: { write: () => true }, env: {}, today: TODAY });
    assert.match(text, /contributors card ranks only the most recent 3 commits by everyone/);
    assert.match(text, /only the most recent 3 were analyzed/);
  });

  test('a single-author window skips the card; switching 11 ↔ 10 cards leaves no stale or misnumbered files', async () => {
    const o = out('switch');
    // Full history: two authors, 11 cards (and PNGs via a fake rasterizer).
    const fake = async () => Buffer.from('png');
    const a = await generate({ path: fixture.dir, out: o, png: true }, { today: TODAY, renderPng: fake });
    assert.equal(a.cardFiles.length, 11);
    assert.deepEqual(readdirSync(join(o, 'png')).sort(), [...stems(CARD_IDS).map((s) => `${s}.png`), ].sort());
    // Only Ada's last day: one author, 10 cards; 08-contributors and 09..11 are gone.
    const b = await generate({ path: fixture.dir, out: o, png: true, since: '2024-03-13' }, { today: TODAY, renderPng: fake });
    assert.equal(b.stats.contributors.total, 1);
    const solo = stems(cardIdsFor({}));
    assert.deepEqual(readdirSync(join(o, 'cards')).sort(), solo.map((s) => `${s}.svg`));
    assert.deepEqual(readdirSync(join(o, 'png')).sort(), solo.map((s) => `${s}.png`));
    assert.ok(!existsSync(join(o, 'cards', '08-contributors.svg')));
    assert.match(readFileSync(join(o, 'cards', '08-messages.svg'), 'utf8'), /MESSAGE HALL OF FAME/i);
    assert.equal((readFileSync(b.html, 'utf8').match(/<section class="slide/g) ?? []).length, 10);
    // And back to 11, without PNGs this time: the PNG folder is cleared, cards renumbered.
    await generate({ path: fixture.dir, out: o, png: false }, { today: TODAY });
    assert.deepEqual(readdirSync(join(o, 'cards')).sort(), stems(CARD_IDS).map((s) => `${s}.svg`));
    assert.ok(!existsSync(join(o, 'png')));
  });
});
