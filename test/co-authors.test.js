// Co-authors: Co-authored-by trailers parsed from git log (src/git.js), mapped through
// .mailmap, counted by computeCoAuthors (src/stats/coauthors.js), and shown on the team /
// totals card, in the recap, wrapped.md and stats.json, by name only.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mailmapCoAuthors, parseCoAuthor, parseLog, readCommits } from '../src/git.js';
import { computeCoAuthors, computeStats, shownCoAuthors, TOP_CO_AUTHORS } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';

const TODAY = '2025-04-01';
const US = '\x1f';

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

const CLAUDE = { name: 'Claude', email: 'noreply@anthropic.com' };
const GRACE = { name: 'Grace Hopper', email: 'grace@navy.example' };

/** Every <text> of an SVG. */
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe('parseCoAuthor / parseLog', () => {
  test('"Name <email>" splits; a bare name keeps an empty email; empty → null', () => {
    assert.deepEqual(parseCoAuthor('Ada Lovelace <ada@x.io>'), { name: 'Ada Lovelace', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('  Ada   Lovelace   < ada@x.io >  '), { name: 'Ada Lovelace', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('Ada'), { name: 'Ada', email: '' });
    assert.deepEqual(parseCoAuthor('<ada@x.io>'), { name: '', email: 'ada@x.io' });
    assert.equal(parseCoAuthor(''), null);
    assert.equal(parseCoAuthor('   '), null);
    assert.equal(parseCoAuthor(undefined), null);
  });

  test('Co-authored-by values follow the subject, one per line; the subject keeps \\x1f', () => {
    const rec = ['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', `sub${US}ject\nBob <bob@x>\nClaude <noreply@anthropic.com>`].join(US);
    const [c] = parseLog(`${rec}\0`);
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }, CLAUDE]);
    assert.equal(c.subject, `sub${US}ject`);
    // A \\x1f or \\x1e inside a value stays in that value (no field shift, no split).
    const [odd] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', `s\nEv${US}il <e@x>\nRo\x1ese <r@x>`].join(US)}\0`);
    assert.equal(odd.subject, 's');
    assert.deepEqual(odd.coAuthors.map((p) => p.email), ['e@x', 'r@x']);
    const [none] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 's'].join(US)}\0`);
    assert.deepEqual(none.coAuthors, []);
    assert.equal(none.subject, 's');
    // git < 2.22 prints the unknown placeholder literally: no co-authors, not junk.
    const [old] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 's\n%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)'].join(US)}\0`);
    assert.deepEqual(old.coAuthors, []);
    assert.equal(old.subject, 's');
  });

  test('the email is the last <...> with an "@"; text after it is dropped', () => {
    assert.deepEqual(parseCoAuthor('Ada <ada@x.io> (she/her)'), { name: 'Ada', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('Ada <Lovelace> <ada@x.io>'), { name: 'Ada Lovelace', email: 'ada@x.io' });
    assert.deepEqual(parseCoAuthor('Ada <ada@x.io> <team>'), { name: 'Ada', email: 'ada@x.io' });
  });
});

describe('computeCoAuthors', () => {
  test('empty input has the documented shape', () => {
    const empty = { paired: 0, commits: 0, share: 0, total: 0, top: [] };
    assert.deepEqual(computeCoAuthors([]), empty);
    assert.deepEqual(computeCoAuthors(undefined), empty);
    assert.deepEqual(computeCoAuthors([null, 1, 'x']), empty);
    assert.deepEqual(computeStats([], { today: TODAY }).coAuthors, empty);
    assert.equal(shownCoAuthors(empty), null);
  });

  test('counts paired commits and co-authors; merges, self and duplicates do not count', () => {
    const commits = [
      commit('Ada', 'ada@x.io', [CLAUDE, GRACE]),
      commit('Ada', 'ada@x.io', [CLAUDE, { name: 'claude', email: 'NOREPLY@anthropic.com' }]), // same identity twice
      commit('Ada', 'ada@x.io', [{ name: 'Ada L.', email: 'ADA@x.io' }]), // the author herself
      commit('Ada', 'ada@x.io', [CLAUDE], { parents: ['a', 'b'] }), // a merge
      commit('Ada', 'ada@x.io'),
    ];
    const co = computeCoAuthors(commits);
    assert.deepEqual(co, {
      paired: 2,
      commits: 4,
      share: 50,
      total: 2,
      top: [{ name: 'Claude', commits: 2 }, { name: 'Grace Hopper', commits: 1 }],
    });
  });

  test('ties go alphabetically; a name-only co-author is keyed by name; top is capped', () => {
    const people = ['Zed', 'Amy', 'Kim', 'Bea', 'Lou', 'Max', 'Ned'].map((name) => ({ name, email: '' }));
    const co = computeCoAuthors([commit('A', 'a@x', people)]);
    assert.equal(co.total, 7);
    assert.equal(co.top.length, TOP_CO_AUTHORS);
    assert.deepEqual(co.top.map((p) => p.name), ['Amy', 'Bea', 'Kim', 'Lou', 'Max']);
  });

  test('never returns an email: an address as name is cut, no name → Unknown', () => {
    const co = computeCoAuthors([commit('A', 'a@x', [{ name: 'bob@corp.example', email: 'bob@corp.example' }, { name: '', email: 'x@y.example' }])]);
    assert.doesNotMatch(JSON.stringify(co), /@/);
    assert.deepEqual(co.top.map((p) => p.name).sort(), ['Unknown', 'bob']);
  });
});

describe('cards, recap and wrapped.md', () => {
  const solo = (co) => Array.from({ length: 12 }, (_, i) => commit('Ada', 'ada@x.io', co && i % 2 ? co : []));
  const team = (co) => Array.from({ length: 12 }, (_, i) => commit(i % 3 ? 'Bob' : 'Ada', i % 3 ? 'bob@x.io' : 'ada@x.io', co && i % 2 ? co : []));

  test('without paired commits every card is byte-identical to one without the key', () => {
    for (const commits of [solo(null), team(null)]) {
      for (const lang of ['en', 'tr']) {
        const stats = computeStats(commits, { today: TODAY });
        assert.equal(stats.coAuthors.paired, 0);
        const { coAuthors, ...without } = stats;
        const a = buildCards(stats, { repoName: 'r', today: TODAY, lang });
        const b = buildCards(without, { repoName: 'r', today: TODAY, lang });
        assert.deepEqual(a, b);
        assert.equal(formatSummary(stats, { repoName: 'r', today: TODAY, lang }), formatSummary(without, { repoName: 'r', today: TODAY, lang }));
        assert.equal(buildMarkdown(stats, { repoName: 'r', today: TODAY, lang }), buildMarkdown(without, { repoName: 'r', today: TODAY, lang }));
      }
    }
  });

  test('the team card gets the pairing panel (en / tr), and the totals card no row', () => {
    const stats = computeStats(team([CLAUDE]), { today: TODAY });
    const en = buildCards(stats, { repoName: 'r', today: TODAY });
    const card = (cards, id) => cards.find((c) => c.id === id);
    assert.ok(texts(card(en, 'contributors').svg).includes('6 commits paired'));
    assert.ok(texts(card(en, 'contributors').svg).includes('Top co-author: Claude'));
    assert.match(card(en, 'contributors').description, /Pair programming: 6 commits paired/);
    assert.doesNotMatch(card(en, 'totals').svg, /Paired/);
    const tr = buildCards(stats, { repoName: 'r', today: TODAY, lang: 'tr' });
    assert.ok(texts(card(tr, 'contributors').svg).includes('6 commit birlikte yazıldı'));
    assert.ok(texts(card(tr, 'contributors').svg).includes('En sık ortak: Claude'));
  });

  test('without a team card the totals card gets a pairing row', () => {
    const stats = computeStats(solo([CLAUDE]), { today: TODAY });
    const specs = buildCardSpecs(stats, { repoName: 'r', today: TODAY });
    assert.ok(!specs.some((s) => s.id === 'contributors'));
    const totals = specs.find((s) => s.id === 'totals').spec;
    assert.deepEqual(totals.lines.at(-1), { label: 'Paired (top: Claude)', value: '6' });
    const tr = buildCardSpecs(stats, { repoName: 'r', today: TODAY, lang: 'tr' }).find((s) => s.id === 'totals').spec;
    assert.deepEqual(tr.lines.at(-1), { label: 'Eşli (en sık: Claude)', value: '6' });
  });

  test('--author: the team card (everyone) gets no panel; the totals card (yours) gets the row', () => {
    // You (Ada) pair with Claude; the team read has Bob too. stats.coAuthors counts your commits.
    const all = team(null).map((c) => (c.email === 'ada@x.io' ? { ...c, coAuthors: [CLAUDE] } : c));
    const mine = all.filter((c) => c.email === 'ada@x.io');
    const stats = computeStats(mine, { today: TODAY, team: all, author: 'ada@x.io' });
    assert.equal(stats.coAuthors.paired, mine.length);
    const { coAuthors, ...without } = stats;
    for (const lang of ['en', 'tr']) {
      const a = buildCards(stats, { repoName: 'r', today: TODAY, lang, author: 'ada@x.io' });
      const b = buildCards(without, { repoName: 'r', today: TODAY, lang, author: 'ada@x.io' });
      const id = (cards, x) => cards.find((c) => c.id === x);
      assert.deepEqual(id(a, 'contributors'), id(b, 'contributors'), `${lang}: team card unchanged`);
      assert.match(id(a, 'totals').description, lang === 'en' ? /Paired \(top: Claude\): 4/ : /Eşli \(en sık: Claude\): 4/);
    }
  });

  test('a team card with six bars (--author outside the top five) stays as it was', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const all = [];
    for (const [i, p] of people.entries()) for (let k = 0; k < 5 + i; k++) all.push(commit(p, `${p}@x.io`));
    const mine = [commit('Me', 'me@x.io', [CLAUDE]), commit('Me', 'me@x.io')];
    all.push(...mine);
    const stats = computeStats(mine, { today: TODAY, team: all, author: 'me@x.io' });
    const { coAuthors, ...without } = stats;
    const specs = buildCardSpecs(stats, { repoName: 'r', today: TODAY, author: 'me@x.io' });
    const teamSpec = specs.find((x) => x.id === 'contributors').spec;
    assert.equal(teamSpec.chart.items.length, 6);
    const before = buildCardSpecs(without, { repoName: 'r', today: TODAY, author: 'me@x.io' }).find((x) => x.id === 'contributors').spec;
    assert.deepEqual(teamSpec, before);
  });

  test('--year + several repos + size mix: no room for the row, the totals card is byte-identical', () => {
    const commits = solo([CLAUDE]).map((c, i) => ({ ...c, repo: i % 2 ? 'api' : 'web', linesAdded: i * 90, files: [{ path: `${i % 2 ? 'api' : 'web'}/a.js`, added: i * 90, removed: 1, binary: false }] }));
    const previous = { year: 2025, commits: solo(null).map((c) => ({ ...c, date: c.date.replace('2025', '2024') })), truncated: false };
    const stats = computeStats(commits, { today: TODAY, repos: ['web', 'api'], previousYear: previous });
    assert.ok(stats.yearOverYear && stats.repos);
    const { coAuthors, ...without } = stats;
    for (const lang of ['en', 'tr']) {
      const opts = { repoName: 'r', today: TODAY, since: '2025-01-01', until: '2025-12-31', lang };
      const spec = buildCardSpecs(stats, opts).find((x) => x.id === 'totals').spec;
      assert.ok(!spec.lines.some((l) => /Paired|Eşli/.test(l.label)), `${lang}: no pairing row`);
      assert.deepEqual(buildCards(stats, opts).find((c) => c.id === 'totals'), buildCards(without, opts).find((c) => c.id === 'totals'));
    }
  });

  test('recap and wrapped.md lines, en and tr', () => {
    const stats = computeStats(solo([GRACE]), { today: TODAY });
    const en = formatSummary(stats, { repoName: 'r', today: TODAY });
    assert.match(en, /Paired\s+6 commits \(50% of non-merge commits\) · top co-author: Grace Hopper/);
    const tr = formatSummary(stats, { repoName: 'r', today: TODAY, lang: 'tr' });
    assert.match(tr, /Birlikte yazılan\s+6 commit \(merge dışı commit'lerin %50 kadarı\) · en sık ortak: Grace Hopper/);
    const md = buildMarkdown(stats, { repoName: 'r', today: TODAY });
    assert.match(md, /- \*\*Paired:\*\* 6 commits \\\(50% of non-merge commits\\\), top co-author: Grace Hopper/);
    assert.match(buildMarkdown(stats, { repoName: 'r', today: TODAY, lang: 'tr' }), /Birlikte yazılan/);
    for (const out of [en, tr, md]) assert.doesNotMatch(out, /navy\.example/);
  });
});

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('git (real repos)', () => {
  let root;
  const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const make = (name, messages, mailmap) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    if (mailmap) writeFileSync(join(repo, '.mailmap'), mailmap);
    for (const [i, msg] of messages.entries()) {
      writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
      git(repo, ['add', '-A']);
      const date = `2025-03-${String(i + 1).padStart(2, '0')}T10:00:00+00:00`;
      git(repo, ['commit', '-q', '-m', msg], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    }
    return repo;
  };
  let app;
  let web;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-coauthors-'));
    app = make('app', [
      'feat: pair\n\nBody text.\n\nCo-authored-by: Bob <bob@old.example>\nco-authored-by: Claude <noreply@anthropic.com>',
      'fix: solo\n\nCo-authored-by: is not a trailer here because the paragraph has prose.\nJust prose.',
      'docs: self\n\nCo-Authored-By: Ada <ada@example.com>',
      'chore: bob again\n\nCO-AUTHORED-BY: Bob <bob@old.example>',
    ], 'Robert Smith <robert@new.example> <bob@old.example>\n');
    web = make('web', ['feat: web\n\nCo-authored-by: Bob <bob@old.example>']);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits parses trailers (any key case) and maps them through .mailmap', async () => {
    const commits = await readCommits(app);
    const bySubject = Object.fromEntries(commits.map((c) => [c.subject, c.coAuthors]));
    assert.deepEqual(bySubject['feat: pair'], [{ name: 'Robert Smith', email: 'robert@new.example' }, CLAUDE]);
    assert.deepEqual(bySubject['fix: solo'], []);
    assert.deepEqual(bySubject['docs: self'], [{ name: 'Ada', email: 'ada@example.com' }]);
    assert.deepEqual(bySubject['chore: bob again'], [{ name: 'Robert Smith', email: 'robert@new.example' }]);
  });

  test('the windowed (--since / --until) read parses and maps trailers too', async () => {
    const commits = await readCommits(app, { since: '2025-03-01', until: '2025-03-31' });
    assert.equal(commits.length, 4);
    const bySubject = Object.fromEntries(commits.map((c) => [c.subject, c.coAuthors]));
    assert.deepEqual(bySubject['feat: pair'], [{ name: 'Robert Smith', email: 'robert@new.example' }, CLAUDE]);
    const r = await generate({ path: app, out: join(root, 'oy'), png: false, year: '2025', since: '2025-01-01', until: '2025-12-31' }, { today: TODAY });
    assert.equal(r.stats.coAuthors.paired, 2);
    assert.equal(r.stats.coAuthors.top[0].name, 'Robert Smith');
  });

  test('coAuthors: false skips the .mailmap call (raw values)', async () => {
    const commits = await readCommits(app, { coAuthors: false });
    const pair = commits.find((c) => c.subject === 'feat: pair');
    assert.deepEqual(pair.coAuthors[0], { name: 'Bob', email: 'bob@old.example' });
  });

  test('mailmapCoAuthors keeps the raw values when git cannot map them', async () => {
    const commits = [{ coAuthors: [{ name: 'Bob', email: 'bob@old.example' }] }];
    await mailmapCoAuthors(join(root, 'missing'), commits);
    assert.deepEqual(commits[0].coAuthors, [{ name: 'Bob', email: 'bob@old.example' }]);
    assert.deepEqual(await mailmapCoAuthors(app, []), []);
  });

  test('generate: stats.coAuthors, recap data and wrapped.md; no co-author email anywhere', async () => {
    const out = join(root, 'o1');
    const r = await generate({ path: app, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.coAuthors, {
      paired: 2,
      commits: 4,
      share: 50,
      total: 2,
      top: [{ name: 'Robert Smith', commits: 2 }, { name: 'Claude', commits: 1 }],
    });
    const recap = formatSummary(r.stats, { repoName: 'app', today: TODAY });
    assert.match(recap, /top co-author: Robert Smith/);
    const files = [r.statsJson, r.markdown, r.html, ...readdirSync(join(out, 'cards')).map((f) => join(out, 'cards', f))];
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n') + recap;
    assert.match(all, /Robert Smith/);
    for (const email of ['bob@old.example', 'robert@new.example', 'noreply@anthropic.com']) assert.ok(!all.includes(email), email);
  });

  test('multi-repo: each repo uses its own .mailmap', async () => {
    const r = await generate({ paths: [app, web], out: join(root, 'o2'), png: false }, { today: TODAY });
    // web has no .mailmap, so its Bob stays a separate co-author.
    assert.equal(r.stats.coAuthors.paired, 3);
    assert.deepEqual(r.stats.coAuthors.top.map((p) => [p.name, p.commits]), [['Robert Smith', 2], ['Bob', 1], ['Claude', 1]]);
  });
});
