// Extra edge cases for the contributors stat / card / recap (M8), complementing
// test/contributors.test.js: .mailmap merges on a real repo, identity rules (case, empty
// email), tie-breaking, "you" outside the top five, --author mismatches, single-author and
// empty repos, stats.json privacy, recap Team line, the date window on the team read, and
// card layout with long / unicode / bidi names.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCards, buildCardSpecs, CARD_IDS, cardIdsFor, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { generate, run } from '../src/cli.js';
import { readCommits } from '../src/git.js';
import { computeContributors, computeStats, computeTotals, contributorName, TOP_CONTRIBUTORS } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';
const pad = (n) => String(n).padStart(2, '0');
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));
let seq = 0;
/** A commit as readCommits() returns it. */
const c = (author, email, { added = 0, removed = 0, date = '2026-10-01T10:00:00+00:00', parents = ['p'] } = {}) => ({
  hash: `h${seq++}`, author, email, date, parents, subject: 'feat: x', files: [], filesChanged: 0, linesAdded: added, linesRemoved: removed,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const specOf = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'contributors')?.spec;
const cardOf = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'contributors');
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function assertLayoutInBounds(spec, label) {
  const { blocks } = layoutCard(spec);
  for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${label}: ${b.kind} ${b.top}..${b.bottom}`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${label}: blocks overlap`);
    }
  }
}

// ---------------------------------------------------------------------------------------
describe('computeContributors: identity and ordering edge cases', () => {
  test('email identity is case-insensitive and whitespace-trimmed; display name is the most frequent spelling', () => {
    const r = computeContributors([
      c('ada', ' ADA@X.IO '), c('Ada', 'ada@x.io'), c('Ada', 'Ada@x.io'), c('bob', 'bob@x.io'),
    ]);
    assert.equal(r.total, 2);
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Ada', 3], ['bob', 1]]);
    assert.equal(computeContributors([c('a', 'ADA@x.io'), c('b', 'ada@X.io')]).total, computeTotals([c('a', 'ADA@x.io'), c('b', 'ada@X.io')]).authors);
  });

  test('name ties for the display name: alphabetically first wins, regardless of input order', () => {
    const a = [c('Zoe', 'z@x.io'), c('Amy', 'z@x.io'), c('Mia', 'z@x.io'), c('Other', 'o@x.io')];
    assert.equal(computeContributors(a).top[0].name, 'Amy');
    assert.equal(computeContributors([...a].reverse()).top[0].name, 'Amy');
    // A name used more often beats an alphabetically earlier one.
    assert.equal(computeContributors([c('Zoe', 'z@x.io'), c('Zoe', 'z@x.io'), c('Amy', 'z@x.io')]).top[0].name, 'Zoe');
    // Names differing only in internal whitespace count as one spelling.
    assert.equal(computeContributors([c('Ada  L', 'a@x.io'), c('Ada L', 'a@x.io'), c('Abe', 'a@x.io')]).top[0].name, 'Ada L');
  });

  test('ordering: commits desc → lines changed desc → name asc → identity (stable for same name)', () => {
    const commits = [
      c('Cara', 'cara@x.io', { added: 1 }), c('Cara', 'cara@x.io', { added: 1 }),
      c('Abe', 'abe@x.io', { added: 10 }), // 1 commit, 10 lines
      c('Dan', 'dan@x.io', { removed: 10 }), // 1 commit, 10 lines: same as Abe → name
      c('Bea', 'bea@x.io', { added: 3, removed: 8 }), // 1 commit, 11 lines
      c('Sam', 'sam-b@x.io'), c('Sam', 'sam-a@x.io'), // same name, same counts → identity
    ];
    const r = computeContributors(commits);
    assert.deepEqual(r.top.map((p) => [p.name, p.rank]), [['Cara', 1], ['Bea', 2], ['Abe', 3], ['Dan', 4], ['Sam', 5]]);
    assert.equal(r.total, 6);
    for (let k = 0; k < 5; k++) {
      const shuffled = [...commits.slice(k), ...commits.slice(0, k)].reverse();
      assert.deepEqual(computeContributors(shuffled), r);
    }
    // The two Sams are ranked deterministically by identity: "you" picks the right one.
    assert.equal(computeContributors(commits, { author: 'sam-a@x.io' }).you.rank, 5);
    assert.equal(computeContributors(commits, { author: 'sam-b@x.io' }).you.rank, 6);
  });

  test('commits with an empty / whitespace / missing email: keyed by name, case-insensitively, never "you"', () => {
    const r = computeContributors([
      c('Ghost', ''), c('ghost', '   '), { ...c('GHOST', ''), email: undefined }, c('Ghost', 'ghost@x.io'),
    ], { author: 'ghost@x.io' });
    // The email-less Ghost commits are one identity, the emailed one another.
    assert.equal(r.total, 2);
    assert.deepEqual(r.top.map((p) => p.commits), [3, 1]);
    assert.equal(r.you.commits, 1);
    assert.equal(r.you.rank, 2);
    // An empty name and empty email share one "Unknown" identity.
    const u = computeContributors([c('', ''), c('  ', ''), c(null, null)]);
    assert.deepEqual(u.top.map((p) => [p.name, p.commits]), [['Unknown', 3]]);
  });

  test('an email-less name key cannot collide with an email key', () => {
    const r = computeContributors([c('a@x.io', ''), c('Ann', 'a@x.io')]);
    assert.equal(r.total, 2);
  });

  test('"you" ranked sixth or lower keeps its true rank and numbers; top stays five', () => {
    const team = [...times(6, (i) => times(10 - i, () => c(`P${i}`, `p${i}@x.io`, { added: 1 }))).flat(), c('Me', 'Me@X.io', { added: 7, removed: 2 })];
    const r = computeContributors(team, { author: 'me@x.io' });
    assert.equal(r.top.length, TOP_CONTRIBUTORS);
    assert.ok(!r.top.some((p) => p.name === 'Me'));
    assert.deepEqual(r.you, { name: 'Me', rank: 7, commits: 1, added: 7, removed: 2, share: Math.round((1 / 46) * 1000) / 10 });
  });

  test('--author matching nothing, or empty / whitespace / non-string → you is null', () => {
    const team = [c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io')];
    for (const author of ['nobody@x.io', '', '   ', null, 42, {}, 'ADA@X.IO.evil']) {
      assert.equal(computeContributors(team, { author }).you, null, String(author));
    }
    assert.equal(computeContributors(team, { author: 'AdA@x.Io' }).you.name, 'Ada');
  });

  test('names that are really addresses are stripped; nothing in the output contains an @', () => {
    const r = computeContributors([
      c('ada@example.com', ''), // name-keyed, name is an address
      c('  <bob@example.com>  ', 'bob@example.com'),
      c('Cy Name <cy@example.com>', 'cy@example.com'),
      c('mailto:dee@example.com', 'dee@example.com'),
    ], { author: 'cy@example.com' });
    assert.doesNotMatch(JSON.stringify(r), /@|example\.com/);
    assert.deepEqual(r.top.map((p) => p.name).sort(), ['Cy Name', 'ada', 'bob', 'mailto:dee']);
    assert.equal(contributorName('a@b'), 'a');
    assert.equal(contributorName('<>'), null);
    assert.equal(contributorName('Ada <'), 'Ada');
  });
});

// ---------------------------------------------------------------------------------------
describe('contributors card: rows, numbering and layout', () => {
  test('single author (even with name variants / email case) → no card, 10 contiguous numbers', () => {
    const stats = statsOf([c('Ada', 'ada@x.io'), c('ADA', 'ADA@X.IO'), c('Ada L', 'Ada@x.io')]);
    assert.equal(stats.contributors.total, 1);
    const specs = buildCardSpecs(stats, { today: TODAY });
    assert.deepEqual(specs.map((s) => s.id), CARD_IDS.filter((id) => id !== 'contributors'));
    assert.deepEqual(specs.map((s) => s.spec.number), times(10, (i) => pad(i + 1)));
    assert.equal(cardOf(stats), undefined);
  });

  test('empty history → no contributors card', () => {
    const stats = statsOf([]);
    assert.deepEqual(stats.contributors, { total: 0, top: [], you: null, authorFilter: false, truncated: false });
    assert.equal(buildCards(stats, { today: TODAY }).length, 10);
    assert.equal(cardOf(stats), undefined);
  });

  test('--author with different case gets the "you" marker; one marker only', () => {
    const team = [...times(3, () => c('Ada', 'ada@x.io')), c('Bob', 'bob@x.io'), c('Bob', 'bob@x.io')];
    const stats = statsOf(team.filter((x) => x.email === 'bob@x.io'), { team, author: 'BoB@X.Io' });
    const spec = specOf(stats, { author: 'BoB@X.Io' });
    assert.equal(spec.big, '#2');
    assert.deepEqual(spec.chart.items.map((x) => x.sub), ['', 'you']);
    const card = cardOf(stats, { author: 'BoB@X.Io' });
    assert.match(svgText(card.svg), /Bob \| you/);
    assert.doesNotMatch(card.svg, /@|x\.io/);
  });

  test('"you" in sixth place: six bars, the last marked with the rank; layout in bounds', () => {
    const team = [...times(5, (i) => times(10 - i, () => c(`Person ${i}`, `p${i}@x.io`))).flat(), c('Me', 'me@x.io')];
    const stats = statsOf([c('Me', 'me@x.io')], { team, author: 'me@x.io' });
    const spec = specOf(stats);
    assert.equal(spec.big, '#6');
    assert.equal(spec.chart.items.length, 6);
    assert.equal(spec.chart.items[5].sub, 'you · #6');
    assert.ok(spec.chart.items.slice(0, 5).every((x) => x.sub === ''));
    assertLayoutInBounds(spec, 'sixth');
    assert.equal((svgText(cardOf(stats).svg).match(/you · #6/g) ?? []).length, 1);
  });

  test('--author matching nobody in the team: no contributors card, 10 cards numbered 01..10', () => {
    const team = [c('Ada', 'ada@x.io'), c('Bob', 'bob@x.io'), c('Bob', 'bob@x.io')];
    const stats = statsOf([], { team, author: 'zed@x.io' });
    assert.equal(stats.contributors.you, null);
    assert.equal(stats.contributors.authorFilter, true);
    assert.equal(specOf(stats, { author: 'zed@x.io' }), undefined);
    const specs = buildCardSpecs(stats, { author: 'zed@x.io', today: TODAY });
    assert.deepEqual(specs.map((s) => s.spec.number), times(10, (i) => pad(i + 1)));
  });

  test('long, unicode, emoji, RTL and bidi-control names: in bounds, truncated, no bidi controls in the SVG', () => {
    const names = [
      'W'.repeat(300),
      'Ünïcødé Ñámé Ŵïth Ðïåçrïtïçs Ånd Mõrë Ëxtrå Lëttërs',
      '山田太郎山田太郎山田太郎山田太郎山田太郎山田太郎',
      '👩‍💻👩‍💻👩‍💻 Emoji Person 🧑🏽‍🚀🧑🏽‍🚀🧑🏽‍🚀🧑🏽‍🚀🧑🏽‍🚀',
      'محمد عبد الرحمن بن عبد العزيز آل سعود الطويل',
      'Evil‮gnirts‬ ⁦iso⁩ ‏name',
    ];
    const team = names.flatMap((n, i) => times(10 - i, () => c(n, `u${i}@x.io`)));
    for (const author of [undefined, 'u5@x.io']) {
      const stats = statsOf(author ? team.filter((x) => x.email === author) : team, { team, author });
      const spec = specOf(stats, { author });
      assertLayoutInBounds(spec, `author=${author}`);
      const card = cardOf(stats, { author });
      assert.doesNotMatch(card.svg, /[‪-‮⁦-⁩]/u);
      assert.doesNotMatch(card.description, /[‪-‮⁦-⁩]/u);
      assert.doesNotMatch(card.svg, /\b(?:null|undefined|NaN)\b/);
      // The 300-W name does not appear in full on the card.
      assert.ok(!svgText(card.svg).includes('W'.repeat(300)));
      assert.match(svgText(card.svg), /W+…/);
      // No lone surrogates from truncating an emoji.
      assert.ok(card.svg.isWellFormed?.() ?? true);
    }
  });

  test('contributor count formats with separators and plurals', () => {
    const many = { contributors: { total: 12345, top: [{ name: 'A', rank: 1, commits: 2, share: 1 }, { name: 'B', rank: 2, commits: 1, share: 1 }], you: null } };
    const spec = specOf(many);
    assert.equal(spec.big, '12,345');
  });
});

// ---------------------------------------------------------------------------------------
describe('recap Team line', () => {
  test('absent for 0 or 1 contributors; present for 2+', () => {
    assert.doesNotMatch(formatSummary(statsOf([])), /Team/);
    assert.doesNotMatch(formatSummary(statsOf([c('Ada', 'a@x.io'), c('ADA', 'A@X.IO')])), /Team/);
    assert.match(formatSummary(statsOf([c('Ada', 'a@x.io'), c('Bob', 'b@x.io'), c('Bob', 'b@x.io')])), /Team {9}2 contributors · top: Bob \(67%\)/);
  });

  test('"you" not found in the team falls back to the top contributor', () => {
    const team = [c('Ada', 'a@x.io'), c('Bob', 'b@x.io'), c('Bob', 'b@x.io')];
    // Own commits that are (oddly) not in the team read: no "you" → no card, no Team line.
    const out = formatSummary(statsOf([c('Zed', 'zed@x.io')], { team, author: 'zed@x.io' }));
    assert.doesNotMatch(out, /Team/);
    assert.doesNotMatch(out, /you're/);
    // Without --author the same team gets the top contributor.
    assert.match(formatSummary(statsOf(team)), /Team {9}2 contributors · top: Bob \(67%\)/);
    // --author matching no commits at all: the recap is the "No commits found" one, with
    // no Team line (and no contributors card).
    const none = formatSummary(statsOf([], { team, author: 'zed@x.io' }));
    assert.match(none, /No commits found/);
    assert.doesNotMatch(none, /Team/);
  });

  test('"you" outside the top five is reported with the true rank; bidi controls stripped from the lead name', () => {
    const team = [...times(6, (i) => times(10 - i, () => c(`P${i}`, `p${i}@x.io`))).flat(), c('Me', 'me@x.io')];
    assert.match(formatSummary(statsOf([c('Me', 'me@x.io')], { team, author: 'me@x.io' })), /Team {9}7 contributors · you're #7 \(2% of commits\)/);
    const evil = formatSummary(statsOf([c('Ev‮li', 'e@x.io'), c('Ev‮li', 'e@x.io'), c('B', 'b@x.io')]));
    assert.match(evil, /top: Evli \(67%\)/);
  });
});

// ---------------------------------------------------------------------------------------
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', LC_ALL: 'C' };
function git(cwd, args, extra = {}) {
  const env = { ...process.env, ...GIT_ENV, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A repo at <root>/<name>; `commits`: [name, email, ISO date]. `.mailmap` content optional (committed first, by the first author). */
function makeRepo(root, name, commits, mailmap) {
  const dir = join(root, name);
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  if (mailmap) writeFileSync(join(dir, '.mailmap'), mailmap);
  commits.forEach(([who, email, date], i) => {
    writeFileSync(join(dir, 'f.txt'), `${i}\n`, { flag: 'a' });
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--no-gpg-sign', '--no-verify', '-m', `commit ${i}`], {
      GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'Committer', GIT_COMMITTER_EMAIL: 'committer@example.org', GIT_COMMITTER_DATE: date,
    });
  });
  return dir;
}
const day = (d) => `2026-09-${pad(d)}T10:00:00+00:00`;
const silent = { write: () => true };

describe('end to end (real repos)', () => {
  let root;
  let fixture;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-contrib-extra-'));
    fixture = makeFixtureRepo();
  });
  after(() => {
    fixture?.cleanup();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const out = (name) => join(root, 'out', name);

  test('.mailmap merges two emails (and email case) into one contributor; --author on the canonical email ranks the merged person', async () => {
    const dir = makeRepo(root, 'mm2', [
      ['Ada (work)', 'ada@work.example', day(1)],
      ['ada', 'ADA@Home.Example', day(2)],
      ['Ada', 'ada@home.example', day(3)],
      ['Bob', 'bob@example.com', day(4)],
      ['Bob', 'bob@example.com', day(5)],
      ['Cy', 'cy@example.com', day(6)],
    ], 'Ada Lovelace <ada@home.example> <ada@work.example>\nAda Lovelace <ada@home.example>\n');
    const commits = await readCommits(dir);
    assert.equal(commits.length, 6);
    const r = computeContributors(commits, { author: 'ada@home.example' });
    assert.equal(r.total, 3);
    assert.deepEqual(r.top.map((p) => [p.name, p.commits]), [['Ada Lovelace', 3], ['Bob', 2], ['Cy', 1]]);
    assert.equal(r.you.rank, 1);
    assert.equal(r.you.share, 50);

    const g = await generate({ path: dir, out: out('mm2'), png: false, json: true, author: 'ADA@HOME.EXAMPLE' }, { today: TODAY });
    assert.equal(g.commits, 3, 'all three Ada commits, from both addresses, are "yours"');
    assert.equal(g.stats.contributors.total, 3);
    assert.equal(g.stats.contributors.you.commits, 3);
    assert.equal(g.stats.contributors.you.name, 'Ada Lovelace');
    const svg = readFileSync(join(g.cardsDir, '08-contributors.svg'), 'utf8');
    assert.match(svgText(svg), /#1 \| of 3 contributors/);
    assert.doesNotMatch(svg, /@|\.example/);
    // stats.json: contributors present; the only email is the --author filter.
    const json = readFileSync(g.statsJson, 'utf8');
    const doc = JSON.parse(json);
    assert.equal(doc.stats.contributors.total, 3);
    assert.equal(doc.filters.author, 'ADA@HOME.EXAMPLE');
    assert.deepEqual(json.match(EMAIL_RE), ['ADA@HOME.EXAMPLE']);
    assert.doesNotMatch(json, /work\.example|bob@|cy@|committer@/);
  });

  test('stats.json without --author contains contributors and no email at all', async () => {
    const g = await generate({ path: fixture.dir, out: out('json-noauthor'), png: false, json: true }, { today: TODAY });
    const json = readFileSync(g.statsJson, 'utf8');
    const doc = JSON.parse(json);
    assert.equal(doc.filters.author, null);
    assert.equal(doc.stats.contributors.total, 2);
    assert.equal(doc.stats.contributors.you, null);
    assert.equal(json.match(EMAIL_RE), null);
  });

  test('commits with an empty author email are counted as their own (name-keyed) contributor', async () => {
    const dir = makeRepo(root, 'noemail', [
      ['Ghost', '', day(1)],
      ['Ghost', '', day(2)],
      ['Ada', 'ada@example.com', day(3)],
    ]);
    const commits = await readCommits(dir);
    assert.deepEqual(commits.map((x) => x.email).sort(), ['', '', 'ada@example.com']);
    const g = await generate({ path: dir, out: out('noemail'), png: false, json: true }, { today: TODAY });
    assert.equal(g.stats.contributors.total, 2);
    assert.deepEqual(g.stats.contributors.top.map((p) => [p.name, p.commits]), [['Ghost', 2], ['Ada', 1]]);
    assert.equal(g.cardFiles.length, 11);
  });

  test('single-author repo (two email spellings) → 10 cards numbered 01..10, no Team line', async () => {
    const dir = makeRepo(root, 'solo', [
      ['Ada', 'ada@example.com', day(1)],
      ['Ada L', 'ADA@EXAMPLE.COM', day(2)],
    ]);
    let text = '';
    const code = await run([dir, '--no-png', '--no-color', '--out', out('solo')], { stdout: { write: (x) => { text += x; return true; } }, stderr: silent, env: {}, today: TODAY });
    assert.equal(code, 0);
    const files = readdirSync(join(out('solo'), 'cards')).sort();
    assert.deepEqual(files, cardIdsFor({}).map((id, i) => `${pad(i + 1)}-${id}.svg`));
    assert.ok(!files.some((f) => f.includes('contributors')));
    assert.doesNotMatch(text, /Team/);
  });

  test('empty repo → no contributors card, no Team line, exit 0', async () => {
    const dir = join(root, 'empty');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    let text = '';
    const code = await run([dir, '--no-png', '--no-color', '--out', out('empty')], { stdout: { write: (x) => { text += x; return true; } }, stderr: silent, env: {}, today: TODAY });
    assert.equal(code, 0);
    const files = readdirSync(join(out('empty'), 'cards'));
    assert.ok(!files.some((f) => f.includes('contributors')));
    assert.doesNotMatch(text, /Team/);
    const g = await generate({ path: dir, out: out('empty2'), png: false, author: 'a@b.co' }, { today: TODAY });
    assert.deepEqual(g.stats.contributors, { total: 0, top: [], you: null, authorFilter: true, truncated: false });
  });

  test('--until window applies to the team read too', async () => {
    // Fixture: ada 03-04, bob 03-05, ... → until 03-05: one commit each.
    const g = await generate({ path: fixture.dir, out: out('until'), png: false, until: '2024-03-05', author: 'ada@example.com' }, { today: TODAY });
    assert.equal(g.commits, 1);
    assert.equal(g.stats.contributors.total, 2);
    assert.deepEqual(g.stats.contributors.top.map((p) => p.commits), [1, 1]);
    assert.equal(g.stats.contributors.you.share, 50);
    // A window holding only Bob: no commits by ada → no team read, no card.
    const b = await generate({ path: fixture.dir, out: out('only-bob'), png: false, since: '2024-03-05', until: '2024-03-05', author: 'ada@example.com' }, { today: TODAY });
    assert.equal(b.commits, 0);
    assert.equal(b.stats.contributors.total, 0);
    assert.equal(b.stats.contributors.you, null);
    assert.ok(!b.cardFiles.some((f) => f.includes('contributors')));
  });

  test('recap Team line via run(): "you\'re #N" with --author, top contributor without; no emails printed', async () => {
    let text = '';
    const stdout = { write: (x) => { text += x; return true; } };
    await run([fixture.dir, '--no-png', '--no-color', '--author', 'Bob@Example.com', '--out', out('recap-a')], { stdout, stderr: silent, env: {}, today: TODAY });
    assert.match(text, /Team {9}2 contributors · you're #2 \(50% of commits\)/);
    assert.equal((text.match(EMAIL_RE) ?? []).filter((e) => !/^bob@example\.com$/i.test(e)).length, 0);
    text = '';
    await run([fixture.dir, '--no-png', '--no-color', '--out', out('recap-b')], { stdout, stderr: silent, env: {}, today: TODAY });
    assert.match(text, /Team {9}2 contributors · top: Ada Lovelace \(50%, tied\)/);
    assert.doesNotMatch(text, /@example\.com/);
  });
});
