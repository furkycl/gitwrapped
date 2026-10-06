// Regression tests for the loop-033 audit fixes: --author + --max-commits team ranking,
// the totals headline of a multi-repo --year run, recap padding by terminal width, and
// translated language names.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, run } from '../src/cli.js';
import { buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { displayWidth, formatSummary } from '../src/summary.js';
import { getStrings, languageLabel } from '../src/i18n/index.js';

const TODAY = '2026-01-05';
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');

function tmp(t, prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

/**
 * A throwaway repo `name` under `root` with one commit per entry of `commits`
 * (`{date, name?, email?, file?}`, dates fixed for author and committer).
 */
function makeRepo(root, name, commits) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['config', 'commit.gpgsign', 'false']);
  commits.forEach((c, i) => {
    const file = c.file ?? `src/f${i}.js`;
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), 'line\n'.repeat(i + 1));
    git(['add', '-A']);
    const who = { name: c.name ?? 'Ada', email: c.email ?? 'a@x' };
    git(['commit', '-q', '-m', `commit ${i}`], {
      GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email,
      GIT_AUTHOR_DATE: `${c.date}T12:00:00Z`, GIT_COMMITTER_DATE: `${c.date}T12:00:00Z`,
    });
  });
  return dir;
}

async function cli(argv) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: { write: (x) => { stdout += x; return true; } }, stderr: { write: (x) => { stderr += x; return true; } }, env: {}, today: TODAY });
  return { code, stdout, stderr };
}

const ADA = { name: 'Ada', email: 'a@x' };
const BOB = { name: 'Bob', email: 'b@x' };
const CY = { name: 'Cy', email: 'c@x' };

const DAN = { name: 'Dan', email: 'd@x' };

describe('--author + --max-commits: both sides of the team ranking cover the same span', () => {
  test('everyone since your oldest commit fits the cap: ranked exactly over it, you == totals', async (t) => {
    const root = tmp(t, 'gw033-span-');
    // Dan's older commit pushes the unfiltered read over the cap; from Ada's first day on it fits.
    const repo = makeRepo(root, 'repo', [{ date: '2024-12-01', ...DAN }, { date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...ADA }]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '3', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const c = json.stats.contributors;
    assert.equal(c.you.commits, json.stats.totals.commits);
    assert.deepEqual(c.top.map((p) => [p.name, p.commits]), [['Ada', 2], ['Bob', 1]]);
    assert.equal(c.truncated, true);
    assert.match(r.stdout, /Note: everyone's commits together are over 3, so the contributors card ranks only those since your oldest analyzed commit \(Jan 1, 2025\)\./);
    assert.doesNotMatch(r.stdout, /only the most recent 3 were analyzed/);
    assert.doesNotMatch(r.stdout, /plus all of yours/);
  });

  test('still over the cap: ranked within everyone\'s most recent N, you counted in it too', async (t) => {
    const root = tmp(t, 'gw033-alt-');
    const repo = makeRepo(root, 'repo', [
      { date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...ADA },
      { date: '2025-01-04', ...BOB }, { date: '2025-01-05', ...ADA }, { date: '2025-01-06', ...BOB },
    ]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '2', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const c = json.stats.contributors;
    assert.equal(json.stats.totals.commits, 2);
    // Everyone's 2 most recent: Bob Jan 6, Ada Jan 5; no older commit of yours is added.
    assert.equal(c.you.commits, 1);
    assert.equal(c.top.reduce((n, p) => n + p.commits, 0), 2);
    const card = svgText(readFileSync(join(out, 'cards', '08-contributors.svg'), 'utf8'));
    assert.match(card, /You made 50% of the commits: 1 \| commit,/);
    assert.match(r.stdout, /only the most recent 2 were analyzed/);
    assert.match(r.stdout, /Note: the contributors card ranks only the most recent 2 commits by everyone \(from Jan 5, 2025\), you included\./);
  });

  test('your commits all older than everyone\'s most recent N: no card, no note about it', async (t) => {
    const root = tmp(t, 'gw033-old-');
    const repo = makeRepo(root, 'repo', [
      { date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...ADA },
      { date: '2025-01-03', ...BOB }, { date: '2025-01-04', ...CY }, { date: '2025-01-05', ...BOB },
    ]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '2', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const c = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.contributors;
    assert.equal(c.you, null);
    assert.equal(c.truncated, true);
    assert.equal(existsSync(join(out, 'cards', '08-contributors.svg')), false);
    assert.doesNotMatch(r.stdout, /contributors card/);
  });

  test('a span that leaves only you: no card, and no note about it', async (t) => {
    const root = tmp(t, 'gw033-solo-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', ...BOB }, { date: '2025-01-02', ...ADA }, { date: '2025-01-03', ...ADA }]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '2', '--no-png', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(join(out, 'cards', '08-contributors.svg')), false);
    assert.doesNotMatch(r.stdout, /contributors card/);
  });

  test('multi-repo with a clone (shared hashes): the ranking is not overstated', async (t) => {
    const root = tmp(t, 'gw033-review-');
    const a = makeRepo(root, 'a', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...ADA }, { date: '2025-01-04', ...BOB }, { date: '2025-01-05', ...BOB }]);
    const b = join(root, 'b');
    execFileSync('git', ['clone', '-q', a, b], { stdio: 'ignore' });
    // Dan's commit is made last but dated first (makeRepo's line counts grow per commit,
    // so Cy's 2 commits change fewer lines than Ada's and rank after her).
    const c = makeRepo(root, 'c', [{ date: '2025-01-06', ...CY }, { date: '2025-01-07', ...CY }, { date: '2024-12-01', ...DAN }]);
    // Everyone since Ada's first commit (7 distinct commits) fits a cap of 7; Dan's older one does not.
    const r = await generate({ paths: [a, b, c], out: join(root, 'out'), png: false, maxCommits: 7, author: 'a@x' }, { today: TODAY });
    assert.equal(r.teamTruncated, true);
    assert.deepEqual(r.teamSpan, { from: '2025-01-01', capped: false });
    const k = r.stats.contributors;
    assert.deepEqual(k.top.map((p) => [p.name, p.commits]), [['Bob', 3], ['Ada', 2], ['Cy', 2]]);
    assert.equal(k.you.rank, 2);
    assert.equal(k.you.commits, r.stats.totals.commits);
    // The reviewer's cap of 3 (without Dan): everyone's 3 most recent hold none of Ada's,
    // so there is no card (before: "#1 of 3 · 40%" from a topped-up window).
    const c2 = makeRepo(root, 'c2', [{ date: '2025-01-06', ...CY }, { date: '2025-01-07', ...CY }]);
    const r3 = await generate({ paths: [a, b, c2], out: join(root, 'out3'), png: false, maxCommits: 3, author: 'a@x' }, { today: TODAY });
    assert.equal(r3.stats.contributors.you, null);
    assert.equal(r3.cardFiles.some((f) => /contributors/.test(f)), false);
  });

  test('Turkish notes', async (t) => {
    const root = tmp(t, 'gw033-tr-');
    const repo = makeRepo(root, 'repo', [{ date: '2024-12-01', ...DAN }, { date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }]);
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '2', '--no-png', '--lang', 'tr', '--out', join(root, 'out')]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Not: herkesin commit'leri toplamda 2 üzerinde; katkıcı kartı yalnızca incelenen en eski commit'inden \(1 \S+ 2025\) bu yana olanları sıralıyor\./);
    const tr = getStrings('tr').notes;
    assert.equal(tr.teamTruncated('2', '5 Oca 2025'), "Not: katkıcı kartı yalnızca herkesin (senin de) en yeni 2 commit'ini sıralıyor (5 Oca 2025 itibarıyla).");
    assert.equal(getStrings('en').notes.teamTruncated('2', null), 'Note: the contributors card ranks only the most recent 2 commits by everyone, you included.');
  });
});

describe('totals card of a multi-repo --year run keeps the commit count the hero', () => {
  const bigSize = (layout) => {
    const big = layout.blocks.find((b) => b.kind === 'big');
    return Number(/font-size="([\d.]+)"/.exec(big.svg)[1]);
  };
  const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;

  for (const n of [2, 3, 5]) {
    test(`${n} repos with commits in both years`, async (t) => {
      const root = tmp(t, `gw033-yoy${n}-`);
      const paths = Array.from({ length: n }, (_, i) => makeRepo(root, `repo${i}`, [
        { date: '2024-03-01', ...ADA },
        { date: '2025-03-01', ...ADA },
        { date: '2025-04-01', ...(i === 0 ? BOB : ADA) },
      ]));
      const r = await generate({ paths, out: join(root, 'out'), png: false, since: '2025-01-01', until: '2025-12-31', year: '2025' }, { today: TODAY });
      assert.ok(r.stats.yearOverYear, 'has a year-over-year comparison');
      const spec = buildCardSpecs(r.stats, { repoName: r.repoName, since: '2025-01-01', until: '2025-12-31', today: TODAY }).find((c) => c.id === 'totals').spec;
      const layout = layoutCard(spec);
      assert.ok(bigSize(layout) >= 140, `big number is ${bigSize(layout)}px`);
      const blocks = layout.blocks;
      for (const b of blocks) assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${b.kind} outside the content area`);
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) assert.ok(!overlaps(blocks[i], blocks[j]), `${blocks[i].kind} overlaps ${blocks[j].kind}`);
      }
      // The written card matches.
      const svg = readFileSync(r.cardFiles.find((f) => f.endsWith('02-totals.svg')), 'utf8');
      assert.ok(svg.includes(`font-size="${bigSize(layout)}"`));
      // The lines-changed split chart always stays.
      assert.ok(blocks.some((b) => b.kind === 'split'));
    });
  }

  test('without a floor the layout is unchanged; bigMin is clamped', () => {
    const spec = { eyebrow: 'X', big: '42', title: 'commits', subtitle: 'sub', lines: [{ label: 'a', value: '1' }] };
    assert.deepEqual(layoutCard({ ...spec, bigMin: 10 }), layoutCard(spec));
    assert.deepEqual(layoutCard({ ...spec, bigMin: 'x' }), layoutCard(spec));
  });
});

describe('recap Repos block pads by terminal width', () => {
  test('displayWidth', () => {
    assert.equal(displayWidth('party'), 5);
    assert.equal(displayWidth('🎉party'), 7);
    assert.equal(displayWidth('日本語'), 6);
    assert.equal(displayWidth('한국'), 4);
    assert.equal(displayWidth('é'), 1);
    assert.equal(displayWidth('👩‍💻'), 2);
    assert.equal(displayWidth(''), 0);
  });

  test('emoji and CJK labels line up with ASCII ones', () => {
    const repos = [
      { name: '🎉party', commits: 3, linesAdded: 10, linesRemoved: 1, filesTouched: 2, share: 50 },
      { name: 'web', commits: 2, linesAdded: 5, linesRemoved: 0, filesTouched: 1, share: 33.3 },
      { name: '日本語', commits: 1, linesAdded: 1, linesRemoved: 0, filesTouched: 1, share: 16.7 },
    ];
    const stats = { totals: { commits: 6, linesAdded: 16, linesRemoved: 1, activeDays: 3 }, repos };
    const text = formatSummary(stats, { repoName: '3 repos' });
    const rows = text.split('\n').filter((l) => /^ {4}\S/.test(l) && /commit/.test(l));
    assert.equal(rows.length, 3);
    const cols = rows.map((l) => displayWidth(l.slice(0, l.search(/\d+ commits?/))));
    assert.deepEqual(cols, [cols[0], cols[0], cols[0]], rows.join('\n'));
    // ASCII-only labels: padded as before.
    const plain = formatSummary({ ...stats, repos: [repos[1], { ...repos[0], name: 'party' }] }, { repoName: '2 repos' });
    assert.match(plain, /^ {4}web {4}2 commits/m);
    assert.match(plain, /^ {4}party {2}3 commits/m);
  });
});

describe('language names are translated where shown, not in stats.json', () => {
  test('tables and languageLabel', () => {
    assert.equal(languageLabel('Text', getStrings('tr')), 'Metin');
    assert.equal(languageLabel('Text', getStrings('en')), 'Text');
    assert.equal(languageLabel('JavaScript', getStrings('tr')), 'JavaScript');
    assert.equal(languageLabel('toString', getStrings('tr')), 'toString');
  });

  test('--lang tr: "Metin" on the card and in the recap; stats.json keeps "Text"', async (t) => {
    const root = tmp(t, 'gw033-lang-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', file: 'notes.txt' }, { date: '2025-01-02', file: 'todo.txt' }]);
    const out = join(root, 'out-tr');
    const r = await cli([repo, '--lang', 'tr', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const card = svgText(readFileSync(join(out, 'cards', '07-languages.svg'), 'utf8'));
    assert.match(card, /Metin/);
    assert.doesNotMatch(card, /\bText\b/);
    assert.match(r.stdout, /Metin/);
    assert.doesNotMatch(r.stdout, /\bText\b/);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.equal(json.stats.languages.languages[0].name, 'Text');
    // English is unchanged.
    const en = join(root, 'out-en');
    const e = await cli([repo, '--no-png', '--json', '--out', en]);
    assert.match(svgText(readFileSync(join(en, 'cards', '07-languages.svg'), 'utf8')), /Text/);
    assert.match(e.stdout, /Text/);
    assert.equal(readFileSync(join(en, 'stats.json'), 'utf8'), readFileSync(join(out, 'stats.json'), 'utf8'));
  });
});

// ---------------------------------------------------------------------------------------
// Tester additions: edge cases around the four fixes.
// ---------------------------------------------------------------------------------------

describe('tester: --author + --max-commits edge cases', () => {
  test('multi-repo: your commits in one repo older than everyone\'s window are not topped up', async (t) => {
    const root = tmp(t, 'gw033-multi-');
    const a = makeRepo(root, 'api', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...ADA }, { date: '2025-01-03', ...ADA }]);
    const b = makeRepo(root, 'web', [{ date: '2025-02-01', ...BOB }, { date: '2025-02-02', ...CY }, { date: '2025-02-03', ...BOB }]);
    const out = join(root, 'out');
    const r = await cli([a, b, '--author', 'a@x', '--max-commits', '2', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const c = json.stats.contributors;
    assert.equal(json.stats.totals.commits, 2);
    // Everyone's 2 most recent since Ada's oldest analyzed day are Bob's and Cy's in web.
    assert.equal(c.you, null);
    assert.equal(c.top.reduce((n, p) => n + p.commits, 0), 2);
    assert.equal(c.truncated, true);
    assert.equal(existsSync(join(out, 'cards', '08-contributors.svg')), false);
    assert.doesNotMatch(r.stdout, /contributors card/);
  });

  test('multi-repo: the same commit (hash) in two repos is counted once in the ranking', async (t) => {
    const root = tmp(t, 'gw033-clone-');
    const a = makeRepo(root, 'api', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...CY }, { date: '2025-01-04', ...BOB }]);
    const b = join(root, 'api-clone');
    execFileSync('git', ['clone', '-q', a, b], { stdio: 'ignore' });
    // A cap of 4 fits the 4 distinct commits only when the clone's copies count once.
    const r = await generate({ paths: [a, b], out: join(root, 'out'), png: false, maxCommits: 4, author: 'a@x' }, { today: TODAY });
    assert.equal(r.stats.totals.commits, 1);
    assert.equal(r.stats.contributors.you.commits, 1);
    assert.equal(r.teamTruncated, false);
    assert.equal(r.stats.contributors.top.reduce((n, p) => n + p.commits, 0), 4);
  });

  test('cap larger than the history: no top-up, no cap note, team not truncated', async (t) => {
    const root = tmp(t, 'gw033-big-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...ADA }]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '10', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const c = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.contributors;
    assert.equal(c.truncated, false);
    assert.equal(c.you.commits, 2);
    assert.equal(c.top.reduce((n, p) => n + p.commits, 0), 3);
    assert.ok(existsSync(join(out, 'cards', '08-contributors.svg')));
    assert.doesNotMatch(r.stdout, /contributors card ranks/);
    assert.doesNotMatch(r.stdout, /most recent/);
  });

  test('cap exactly the history size: not truncated, no note', async (t) => {
    const root = tmp(t, 'gw033-exact-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...ADA }]);
    const r = await generate({ path: repo, out: join(root, 'out'), png: false, maxCommits: 3, author: 'a@x' }, { today: TODAY });
    assert.equal(r.teamTruncated, false);
    assert.equal(r.stats.contributors.truncated, false);
    assert.equal(r.stats.contributors.top.reduce((n, p) => n + p.commits, 0), 3);
  });

  test('your commits all inside the team window: no duplicates (by hash)', async (t) => {
    const root = tmp(t, 'gw033-inside-');
    const repo = makeRepo(root, 'repo', [
      { date: '2025-01-01', ...BOB }, { date: '2025-01-02', ...ADA }, { date: '2025-01-03', ...CY }, { date: '2025-01-04', ...ADA },
    ]);
    const out = join(root, 'out');
    const r = await cli([repo, '--author', 'a@x', '--max-commits', '3', '--no-png', '--json', '--out', out]);
    assert.equal(r.code, 0, r.stderr);
    const c = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.contributors;
    assert.equal(c.you.commits, 2);
    assert.equal(c.total, 2); // Ada and Cy; Bob is outside the window
    assert.equal(c.top.reduce((n, p) => n + p.commits, 0), 3);
    assert.equal(c.truncated, true);
    assert.match(r.stdout, /contributors card ranks only those since your oldest analyzed commit \(Jan 2, 2025\)/);
    assert.doesNotMatch(r.stdout, /only the most recent 3 were analyzed/);
  });

  test('with an injected reader: the span is re-read from your oldest analyzed day, same cap', async (t) => {
    const root = tmp(t, 'gw033-fake-');
    const mk = (hash, email, date) => ({ hash, author: email[0].toUpperCase(), email, date: `${date}T12:00:00Z`, parents: [], subject: hash, files: [], linesAdded: 1, linesRemoved: 0 });
    const all = [mk('h5', 'b@x', '2025-01-05'), mk('h4', 'a@x', '2025-01-04'), mk('h3', 'c@x', '2025-01-03'), mk('h2', 'a@x', '2025-01-02'), mk('h1', 'd@x', '2024-12-01')];
    const calls = [];
    const reader = async (_p, { since, author, limit }) => {
      calls.push({ since, author, limit });
      const pool = all.filter((c) => (!author || c.email === author) && (!since || c.date.slice(0, 10) >= since));
      return { commits: pool.slice(0, limit), truncated: pool.length > limit, limit, shallow: false };
    };
    const r = await generate({ path: root, out: join(root, 'out'), png: false, maxCommits: 4, author: 'a@x' }, { today: TODAY, readHistory: reader });
    // Ada's read: h4, h2; team: 5 commits (capped at 4); since Jan 2: h5..h2, which fits.
    assert.equal(r.truncated, false);
    assert.equal(r.teamTruncated, true);
    assert.deepEqual(calls.slice(1), [{ since: undefined, author: undefined, limit: 4 }, { since: '2025-01-02', author: undefined, limit: 4 }]);
    assert.deepEqual(r.teamSpan, { from: '2025-01-02', capped: false });
    assert.equal(r.stats.contributors.you.commits, 2);
    assert.equal(r.stats.contributors.top.reduce((n, p) => n + p.commits, 0), 4);
  });

  test('no --author: a capped run never shows the team note', async (t) => {
    const root = tmp(t, 'gw033-noauth-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...CY }]);
    const r = await cli([repo, '--max-commits', '2', '--no-png', '--out', join(root, 'out')]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /only the most recent 2 were analyzed/);
    assert.doesNotMatch(r.stdout, /contributors card ranks/);
  });

  test('--author that matches nobody: no team read, no card, no team note', async (t) => {
    const root = tmp(t, 'gw033-nobody-');
    const repo = makeRepo(root, 'repo', [{ date: '2025-01-01', ...ADA }, { date: '2025-01-02', ...BOB }, { date: '2025-01-03', ...CY }]);
    const r = await generate({ path: repo, out: join(root, 'out'), png: false, maxCommits: 1, author: 'zed@x' }, { today: TODAY });
    assert.equal(r.teamTruncated, false);
    assert.equal(r.cardFiles.some((f) => /contributors/.test(f)), false);
  });
});

describe('tester: totals bigMin floor', () => {
  const bigSize = (layout) => Number(/font-size="([\d.]+)"/.exec(layout.blocks.find((b) => b.kind === 'big').svg)[1]);
  const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;

  test('single-repo --year: totals spec has no bigMin and lays out as before', async (t) => {
    const root = tmp(t, 'gw033-single-');
    const repo = makeRepo(root, 'repo', [{ date: '2024-03-01', ...ADA }, { date: '2025-03-01', ...ADA }, { date: '2025-04-01', ...BOB }]);
    const r = await generate({ path: repo, out: join(root, 'out'), png: false, since: '2025-01-01', until: '2025-12-31', year: '2025' }, { today: TODAY });
    assert.ok(r.stats.yearOverYear);
    const spec = buildCardSpecs(r.stats, { repoName: r.repoName, since: '2025-01-01', until: '2025-12-31', today: TODAY }).find((c) => c.id === 'totals').spec;
    assert.equal(Object.hasOwn(spec, 'bigMin'), false);
    // No per-repo bars: the lines split and the commit size mix only.
    assert.deepEqual([].concat(spec.chart).map((c) => c.kind), ['split', 'stack']);
  });

  test('multi-repo totals spec carries bigMin 140; zero-commit totals does not', async (t) => {
    const root = tmp(t, 'gw033-mspec-');
    const paths = [makeRepo(root, 'a', [{ date: '2025-03-01', ...ADA }]), makeRepo(root, 'b', [{ date: '2025-03-02', ...BOB }])];
    const r = await generate({ paths, out: join(root, 'out'), png: false }, { today: TODAY });
    const spec = buildCardSpecs(r.stats, { repoName: r.repoName, today: TODAY }).find((c) => c.id === 'totals').spec;
    assert.equal(spec.bigMin, 140);
    const empty = buildCardSpecs({ ...r.stats, totals: { ...r.stats.totals, commits: 0 } }, { repoName: r.repoName, today: TODAY }).find((c) => c.id === 'totals');
    assert.equal(Object.hasOwn(empty.spec, 'bigMin'), false);
  });

  test('floor holds while charts drop; huge floor is clamped; everything stays inside', () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ label: `row ${i}`, value: String(i) }));
    const split = { kind: 'split', title: 'Lines', segments: [{ label: 'a', value: '+1', amount: 1 }, { label: 'r', value: '-1', amount: 1 }] };
    const bars = { kind: 'hbars', title: 'Per repo', items: Array.from({ length: 5 }, (_, i) => ({ label: `repo${i}`, value: `${i}`, amount: i + 1 })) };
    const spec = { eyebrow: 'Totals', big: '42', title: 'commits', subtitle: 'a fairly long subtitle that wraps onto more than one line maybe', lines, chart: [split, bars] };
    for (const bigMin of [140, 200, 280, 10_000]) {
      const l = layoutCard({ ...spec, bigMin });
      assert.ok(bigSize(l) >= Math.min(bigMin, 280) || !l.blocks.some((b) => b.kind === 'hbars' || b.kind === 'split'), `bigMin ${bigMin}: ${bigSize(l)}px`);
      assert.ok(bigSize(l) <= 280);
      for (const b of l.blocks) assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${b.kind} outside (bigMin ${bigMin})`);
      for (let i = 0; i < l.blocks.length; i++) for (let j = i + 1; j < l.blocks.length; j++) assert.ok(!overlaps(l.blocks[i], l.blocks[j]));
    }
    assert.deepEqual(layoutCard({ ...spec, bigMin: 10_000 }), layoutCard({ ...spec, bigMin: 280 }));
    assert.deepEqual(layoutCard({ ...spec, bigMin: 72 }), layoutCard(spec));
    assert.deepEqual(layoutCard({ ...spec, bigMin: NaN }), layoutCard(spec));
    assert.deepEqual(layoutCard({ ...spec, bigMin: Infinity }), layoutCard(spec));
  });

  test('a text-only card too tall even at the floor still fits (big shrinks below it)', () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ label: `a long row label number ${i}`, value: String(i * 1000) }));
    const spec = { eyebrow: 'Totals', big: '12,345', title: 'commits and a much longer title that wraps over lines', subtitle: 'subtitle '.repeat(20), lines, bigMin: 280 };
    const l = layoutCard(spec);
    for (const b of l.blocks) assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${b.kind} outside`);
  });
});

describe('tester: displayWidth edge cases', () => {
  test('combining marks, ZWJ, flags, keycaps, format chars, fullwidth, non-strings', () => {
    assert.equal(displayWidth('é'), 1);
    assert.equal(displayWidth('́'), 0);
    assert.equal(displayWidth('á̂̃'), 1);
    assert.equal(displayWidth('👨‍👩‍👧‍👦'), 2);
    assert.equal(displayWidth('🏳️‍🌈'), 2);
    assert.equal(displayWidth('❤️'), 2);
    assert.equal(displayWidth('❤'), 1);
    assert.equal(displayWidth('1️⃣'), 2);
    assert.equal(displayWidth('🇹🇷'), 2);
    assert.equal(displayWidth('👍🏽'), 2);
    assert.equal(displayWidth('​'), 0);
    assert.equal(displayWidth('‍'), 0);
    assert.equal(displayWidth('ｆｕｌｌ'), 8);
    assert.equal(displayWidth('ｱ'), 1); // halfwidth katakana
    assert.equal(displayWidth('İstanbul ğüşöç'), 14);
    assert.equal(displayWidth(''), 0);
    assert.equal(displayWidth(null), 0);
    assert.equal(displayWidth(undefined), 0);
    assert.equal(displayWidth(123), 3);
  });

  test('recap: combining-mark and ZWJ repo names line up with ASCII ones', () => {
    const mk = (name, commits) => ({ name, commits, linesAdded: 1, linesRemoved: 0, filesTouched: 1, share: 25 });
    const repos = [mk('café', 4), mk('👩‍💻dev', 3), mk('🇹🇷tr', 2), mk('longer-name', 1)];
    const text = formatSummary({ totals: { commits: 10, linesAdded: 4, linesRemoved: 0, activeDays: 2 }, repos }, { repoName: '4 repos' });
    const rows = text.split('\n').filter((l) => /^ {4}\S/.test(l) && /commit/.test(l));
    assert.equal(rows.length, 4);
    const cols = rows.map((l) => displayWidth(l.slice(0, l.search(/\d+ commits?/))));
    assert.ok(cols.every((x) => x === cols[0]), rows.join('\n'));
    assert.equal(cols[0], 4 + 'longer-name'.length + 2);
  });
});

describe('tester: Turkish language names on bars', () => {
  test('"Metin" as a non-lead bar label (and its tooltip); English keeps "Text"', async (t) => {
    const root = tmp(t, 'gw033-bars-');
    const repo = makeRepo(root, 'repo', [
      { date: '2025-01-01', file: 'a.js' }, { date: '2025-01-02', file: 'b.js' }, { date: '2025-01-03', file: 'c.js' },
      { date: '2025-01-04', file: 'notes.txt' },
    ]);
    const r = await generate({ path: repo, out: join(root, 'tr'), png: false, lang: 'tr' }, { today: TODAY });
    const svg = readFileSync(r.cardFiles.find((f) => /languages/.test(f)), 'utf8');
    assert.match(svgText(svg), /Metin/);
    assert.doesNotMatch(svg, /\bText\b/);
    assert.match(svg, /<title>Metin: /);
    const e = await generate({ path: repo, out: join(root, 'en'), png: false }, { today: TODAY });
    assert.match(readFileSync(e.cardFiles.find((f) => /languages/.test(f)), 'utf8'), /<title>Text: /);
  });

  test('a tie involving Text is named "Metin" in the Turkish title and bars', () => {
    const stats = {
      totals: { commits: 2, linesAdded: 2, linesRemoved: 0, activeDays: 1, filesTouched: 2 },
      languages: {
        basis: 'files',
        languages: [
          { name: 'Markdown', type: 'prose', files: 1, lines: 1, share: 50 },
          { name: 'Text', type: 'prose', files: 1, lines: 1, share: 50 },
        ],
      },
    };
    const spec = buildCardSpecs(stats, { repoName: 'r', today: TODAY, lang: 'tr' }).find((c) => c.id === 'languages').spec;
    assert.match(spec.title, /Markdown ve Metin/);
    assert.deepEqual(spec.chart.items.map((i) => i.label), ['Markdown', 'Metin']);
    assert.doesNotMatch(JSON.stringify(spec), /\bText\b/);
    const en = buildCardSpecs(stats, { repoName: 'r', today: TODAY }).find((c) => c.id === 'languages').spec;
    assert.match(en.title, /Markdown and Text/);
  });
});
