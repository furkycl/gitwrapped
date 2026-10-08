// Bus factor (M17): the smallest number of authors who together made at least half of the
// lines changed, counted by computeBusFactor (src/stats/contributors.js) over the same
// files as hot files and the same identities as the contributors, shown as
// stats.contributors.busFactor, a row on the team card (spare room only), a recap line
// after "Team" and an item in wrapped.md's team section.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mergeHistories } from '../src/git.js';
import { computeBusFactor, computeContributors, computeStats, shownBusFactor } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, busFactorShareText, cardDescription } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate, run } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
let seq = 0;
/** A commit as readCommits() returns it: `files` as [path, added, removed?]. */
const commit = (author, email, files, extra = {}) => {
  seq += 1;
  const fs = files.map(([path, added, removed = 0]) => ({ path, added, removed, binary: false }));
  return {
    hash: `${String(seq).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    date: `2026-03-${String(1 + (seq % 27)).padStart(2, '0')}T10:00:00Z`,
    subject: `feat: change ${seq}`,
    author,
    email,
    parents: ['p'],
    coAuthors: [],
    files: fs,
    filesChanged: fs.length,
    linesAdded: fs.reduce((n, f) => n + f.added, 0),
    linesRemoved: fs.reduce((n, f) => n + f.removed, 0),
    ...extra,
  };
};
const ada = (files, extra) => commit('Ada', 'ada@example.com', files, extra);
const bob = (files, extra) => commit('Bob', 'bob@example.com', files, extra);
const cy = (files, extra) => commit('Cy', 'cy@example.com', files, extra);
const plain = (b) => (b ? { authors: b.authors, share: b.share } : b);
const svgText = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' | ');

// ---------------------------------------------------------------------------------------
describe('computeBusFactor', () => {
  test('smallest k whose top-k lines reach half of all lines (2 × theirs ≥ all)', () => {
    // 60 / 25 / 15 → Ada alone has 60% of 100.
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 60]]), bob([['src/b.js', 25]]), cy([['src/c.js', 15]])])), { authors: 1, share: 0.6 });
    // Exactly half is enough: 50 / 30 / 20.
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 50]]), bob([['src/b.js', 30]]), cy([['src/c.js', 20]])])), { authors: 1, share: 0.5 });
    // Just under half is not: 49 / 31 / 20 (Ada's 49 + Bob's 31 = 80%).
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 49]]), bob([['src/b.js', 31]]), cy([['src/c.js', 20]])])), { authors: 2, share: 0.8 });
    // Odd totals compare exactly: 1 / 1 / 1 → 2 of 3 (one is 33%, under half).
    assert.deepEqual(plain(computeBusFactor([ada([['a.js', 1]]), bob([['b.js', 1]]), cy([['c.js', 1]])])), { authors: 2, share: 0.667 });
    // Added and removed both count, summed over commits and files.
    assert.deepEqual(plain(computeBusFactor([ada([['a.js', 3, 4]]), ada([['b.js', 1, 0]]), bob([['c.js', 2, 2]]), cy([['d.js', 0, 3]])])), { authors: 1, share: 0.533 });
  });

  test('ties: equal totals give the same k whatever the order', () => {
    const four = [ada([['a.js', 10]]), bob([['b.js', 10]]), cy([['c.js', 10]]), commit('Di', 'di@example.com', [['d.js', 10]])];
    assert.deepEqual(plain(computeBusFactor(four)), { authors: 2, share: 0.5 });
    assert.deepEqual(plain(computeBusFactor([...four].reverse())), { authors: 2, share: 0.5 });
    assert.deepEqual(plain(computeBusFactor([ada([['a.js', 7]]), bob([['b.js', 7]])])), { authors: 1, share: 0.5 });
  });

  test('single author, empty input and no counted lines → null', () => {
    assert.equal(computeBusFactor([]), null);
    assert.equal(computeBusFactor(), null);
    assert.equal(computeBusFactor(null), null);
    assert.equal(computeBusFactor([ada([['a.js', 10]]), ada([['b.js', 5]])]), null, 'one author is no team');
    assert.equal(computeBusFactor([ada([['a.js', 10]]), commit('ADA', 'ADA@example.com ', [['b.js', 5]])]), null, 'emails compare lowercased and trimmed');
    // Two people but only lockfiles / build output / binaries / merges: nothing counted.
    assert.equal(computeBusFactor([
      ada([['package-lock.json', 500]]),
      bob([['dist/app.js', 300], ['yarn.lock', 2]]),
      cy([['logo.png', 0]]),
      commit('Di', 'di@example.com', [], { parents: ['a', 'b'] }),
    ]), null);
  });

  test('one author with every counted line → share 1; else never 1 short of every line', () => {
    // Bob only touched a lockfile: Ada made 100% of the counted lines.
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 10]]), bob([['package-lock.json', 900]])])), { authors: 1, share: 1 });
    // 9,999 of 10,000 rounds to 1.000 but is capped at 0.999.
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 9999]]), bob([['src/b.js', 1]])])), { authors: 1, share: 0.999 });
  });

  test('ignored paths are left out exactly as for hot files', () => {
    // Bob's lockfile, build output, vendored code, minified file and snapshot do not count:
    // Ada's 30 beat Bob's 20 counted lines.
    const commits = [
      ada([['src/a.js', 30]]),
      bob([['src/b.js', 20], ['package-lock.json', 1000], ['dist/bundle.js', 400], ['vendor/x.go', 50], ['web/app.min.js', 90], ['__snapshots__/a.snap', 10], ['node_modules/x/y.js', 5]]),
    ];
    assert.deepEqual(plain(computeBusFactor(commits)), { authors: 1, share: 0.6 });
    // A source folder named build/ deeper in the tree still counts (as for hot files).
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 30]]), bob([['src/build/b.js', 40]])])), { authors: 1, share: 0.571 });
  });

  test('--exclude drops files first (excludeFiles), so their lines do not count', () => {
    const commits = [ada([['src/a.js', 30], ['docs/big.md', 100]]), bob([['src/b.js', 40]]), cy([['src/c.js', 35]])];
    // Ada leads with 130 of 205.
    assert.deepEqual(plain(computeBusFactor(commits)), { authors: 1, share: 0.634 });
    // Without docs/: 30 / 40 / 35 → two people (75 of 105).
    assert.deepEqual(plain(computeBusFactor(excludeFiles(commits, compileExcludes(['docs/'])))), { authors: 2, share: 0.714 });
  });

  test('identities are the contributors\' (mailmapped names / emails merged, name key without email)', () => {
    // Two spellings of one (already mailmapped) email are one person: 40 + 40 of 150.
    const commits = [
      commit('Ada Lovelace', 'ada@example.com', [['a.js', 40]]),
      commit('ada', 'Ada@Example.com', [['b.js', 40]]),
      bob([['c.js', 40]]),
      cy([['d.js', 30]]),
    ];
    assert.deepEqual(plain(computeBusFactor(commits)), { authors: 1, share: 0.533 });
    assert.equal(computeContributors(commits).total, 3);
    // No email: keyed by name (case and whitespace ignored), apart from email keys.
    assert.deepEqual(plain(computeBusFactor([commit('Ghost  Writer', '', [['a.js', 10]]), commit('ghost writer', '', [['b.js', 10]]), bob([['c.js', 15]])])), { authors: 1, share: 0.571 });
  });

  test('multi-repo: ignore rules apply at each repo root', () => {
    const { commits: merged } = mergeHistories([
      { label: 'api', commits: [ada([['src/a.js', 10], ['dist/x.js', 500]])] },
      { label: 'dist', commits: [bob([['src/b.js', 30]])] },
    ]);
    // api/dist/x.js is the api repo's build output; a repo labelled "dist" is not.
    assert.deepEqual(plain(computeBusFactor(merged)), { authors: 1, share: 0.75 });
  });

  test('invalid input never throws or mutates; stats.json keeps exactly {authors, share}', () => {
    const commits = [null, 7, 'x', { files: 'nope' }, ada([['a.js', 5]]), bob([['b.js', Number.NaN], ['c.js', -3], [null, 4]]), cy([['c.js', 2]])];
    commits[5].files.push({ path: 42, added: 9 }, null);
    const copy = JSON.stringify(commits);
    const b = computeBusFactor(commits);
    assert.deepEqual(plain(b), { authors: 1, share: 0.714 });
    assert.equal(JSON.stringify(commits), copy);
    assert.deepEqual(Object.keys(b), ['authors', 'share']);
    assert.equal(JSON.stringify(b), '{"authors":1,"share":0.714}');
  });

  test('stats.contributors.busFactor: over the team history computeContributors ranks', () => {
    const team = [ada([['src/a.js', 60]]), bob([['src/b.js', 25]]), cy([['src/c.js', 15]])];
    const mine = [team[1]];
    const s = computeStats(mine, { today: TODAY, team, author: 'bob@example.com' });
    assert.deepEqual(plain(s.contributors.busFactor), { authors: 1, share: 0.6 }, 'the team\'s, not just yours');
    assert.equal(computeStats(mine, { today: TODAY }).contributors.busFactor, null, 'a one-author history has none');
    assert.equal(Object.keys(computeStats(team, { today: TODAY }).contributors).at(-1), 'busFactor');
  });
});

describe('shownBusFactor', () => {
  test('whole percent, rounded once from the exact ratio', () => {
    assert.deepEqual(shownBusFactor(computeBusFactor([ada([['a.js', 60]]), bob([['b.js', 25]]), cy([['c.js', 15]])])), { authors: 1, percent: 60 });
    // 2 of 3 → 66.67% → 67.
    assert.deepEqual(shownBusFactor(computeBusFactor([ada([['a.js', 1]]), bob([['b.js', 1]]), cy([['c.js', 1]])])), { authors: 2, percent: 67 });
    // 9,999 of 10,000: never "100%" short of every line; all of them is 100%.
    assert.deepEqual(shownBusFactor(computeBusFactor([ada([['a.js', 9999]]), bob([['b.js', 1]])])), { authors: 1, percent: 99 });
    assert.deepEqual(shownBusFactor({ authors: 1, share: 1 }), { authors: 1, percent: 100 });
    // A plain value (e.g. read back from stats.json) uses its share.
    assert.deepEqual(shownBusFactor({ authors: 3, share: 0.584 }), { authors: 3, percent: 58 });
  });

  test('missing or malformed → null', () => {
    for (const v of [null, undefined, 3, 'x', {}, { authors: 0, share: 0.5 }, { authors: -1, share: 0.5 }, { authors: 1.5, share: 0.5 }, { authors: '2', share: 0.5 }]) {
      assert.equal(shownBusFactor(v), null, JSON.stringify(v));
    }
  });
});

// ---------------------------------------------------------------------------------------
/** A team of `n` people (person i makes n - i commits of 10 lines), optionally paired. */
function team(n, { paired = false } = {}) {
  const commits = [];
  for (let a = 0; a < n; a += 1) {
    for (let k = 0; k < n - a; k += 1) {
      commits.push(commit(`Person ${a}`, `p${a}@example.com`, [[`src/f${a}.js`, 10]], paired ? { coAuthors: [{ name: 'Zed', email: 'zed@example.com' }] } : {}));
    }
  }
  return computeStats(commits, { today: TODAY });
}
const teamSpec = (stats, lang) => buildCardSpecs(stats, { today: TODAY, lang }).find((c) => c.id === 'contributors')?.spec;
const teamSvg = (stats, lang) => buildCards(stats, { today: TODAY, lang }).find((c) => c.id === 'contributors')?.svg;
const without = (stats) => ({ ...stats, contributors: { ...stats.contributors, busFactor: null } });

describe('team card row', () => {
  test('in spare room: "Bus factor" and "2 people · 60%" (en) / "2 kişi · %60" (tr)', () => {
    const s = team(5);
    assert.deepEqual(plain(s.contributors.busFactor), { authors: 2, share: 0.6 });
    const e = teamSpec(s, 'en');
    assert.deepEqual(e.lines, [{ label: 'Bus factor', value: '2 people · 60%', description: '2 people made 60% of the lines changed' }]);
    const t = teamSpec(s, 'tr');
    assert.deepEqual(t.lines, [{ label: 'Otobüs faktörü', value: '2 kişi · %60', description: 'Değişen satırların %60 kadarını 2 kişi yaptı' }]);
    assert.match(svgText(teamSvg(s, 'en')), /Bus factor \| 2 people · 60%/);
    assert.match(svgText(teamSvg(s, 'tr')), /Otobüs faktörü \| 2 kişi · %60/);
    assert.match(cardDescription(e), /2 people made 60% of the lines changed\./);
    // The rest of the card is as without the row.
    const { lines, ...rest } = e;
    assert.deepEqual(rest, teamSpec(without(s), 'en'));
    assert.equal(teamSpec(without(s), 'en').lines, undefined);
  });

  test('singular in English: "1 person"', () => {
    const s = team(2);
    assert.deepEqual(teamSpec(s, 'en').lines.map((l) => l.value), ['1 person · 67%']);
    assert.deepEqual(teamSpec(s, 'tr').lines.map((l) => l.value), ['1 kişi · %67']);
  });

  test('no room (five bars and the pairing panel): the card is byte-identical', () => {
    const s = team(5, { paired: true });
    assert.ok(s.contributors.busFactor);
    for (const lang of ['en', 'tr']) {
      assert.equal(teamSpec(s, lang).lines, undefined, lang);
      assert.equal(teamSvg(s, lang), teamSvg(without(s), lang), lang);
    }
  });

  test('without a bus factor (no counted line changed) there is no row', () => {
    const s = computeStats([ada([['package-lock.json', 10]]), bob([['yarn.lock', 4]])], { today: TODAY });
    assert.equal(s.contributors.busFactor, null);
    assert.equal(teamSpec(s, 'en').lines, undefined);
  });

  test('a long count falls back to the short value, and a row is never drawn cut', () => {
    const s = team(3);
    s.contributors.busFactor = { authors: 1234567, share: 0.6 };
    assert.deepEqual(teamSpec(s, 'en').lines.map((l) => l.value), ['1,234,567 · 60%']);
    assert.deepEqual(teamSpec(s, 'tr').lines.map((l) => l.value), ['1.234.567 · %60']);
    s.contributors.busFactor = { authors: 123456789012345, share: 0.6 };
    assert.equal(teamSpec(s, 'en').lines, undefined);
  });

  test('busFactorShareText matches the locale\'s percent style', () => {
    assert.equal(busFactorShareText({ authors: 2, percent: 58 }, en), '58%');
    assert.equal(busFactorShareText({ authors: 2, percent: 58 }, tr), '%58');
  });
});

describe('strings', () => {
  test('en and tr', () => {
    assert.equal(en.contributors.busFactor, 'Bus factor');
    assert.equal(en.contributors.busFactorValue(1, '52%'), '1 person · 52%');
    assert.equal(en.contributors.busFactorValue(3, '58%'), '3 people · 58%');
    assert.equal(en.contributors.busFactorShort(1200, '58%'), '1,200 · 58%');
    assert.equal(en.recap.busFactorValue(1), '1 person');
    assert.equal(en.recap.busFactorValue(2), '2 people');
    assert.equal(en.markdown.busFactor, 'Bus factor');
    assert.equal(tr.contributors.busFactor, 'Otobüs faktörü');
    assert.equal(tr.contributors.busFactorValue(1, '%52'), '1 kişi · %52');
    assert.equal(tr.contributors.busFactorValue(3, '%58'), '3 kişi · %58');
    assert.equal(tr.contributors.busFactorShort(1200, '%58'), '1.200 · %58');
    assert.equal(tr.recap.busFactorValue(2), '2 kişi');
    assert.equal(tr.markdown.busFactor, 'Otobüs faktörü');
    for (const L of [en, tr]) assert.ok(L.recap.busFactor.length < L.recap.labelWidth);
  });
});

describe('recap, wrapped.md and stats.json', () => {
  const s = team(5);

  test('recap: a "Bus factor" line right after "Team"', () => {
    const lines = formatSummary(s, { repoName: 'demo', today: TODAY }).split('\n');
    const at = lines.findIndex((l) => l.trimStart().startsWith('Team'));
    assert.ok(at > 0);
    assert.equal(lines[at + 1], `  ${'Bus factor'.padEnd(en.recap.labelWidth)}2 people (60% of lines changed)`);
    const trLines = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).split('\n');
    const trAt = trLines.findIndex((l) => l.trimStart().startsWith('Ekip'));
    assert.equal(trLines[trAt + 1], `  ${'Otobüs faktörü'.padEnd(tr.recap.labelWidth)}2 kişi (değişen satırların %60 kadarı)`);
  });

  test('recap: no line without a team card or a bus factor', () => {
    const solo = computeStats([ada([['a.js', 5]])], { today: TODAY });
    assert.doesNotMatch(formatSummary(solo, { repoName: 'demo', today: TODAY }), /Bus factor/);
    const locks = computeStats([ada([['yarn.lock', 5]]), bob([['yarn.lock', 5]])], { today: TODAY });
    const recap = formatSummary(locks, { repoName: 'demo', today: TODAY });
    assert.match(recap, /Team/);
    assert.doesNotMatch(recap, /Bus factor/);
    // An --author with no commits in the team it ranks: no team card, so no line either.
    const noYou = { ...s, contributors: { ...s.contributors, authorFilter: true, you: null } };
    assert.doesNotMatch(formatSummary(noYou, { repoName: 'demo', today: TODAY }), /Bus factor/);
  });

  test('wrapped.md: an item in the team section', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    const team = md.slice(md.indexOf('## The team'));
    assert.match(team, /\n- \*\*Bus factor:\*\* 2 people \(60% of lines changed\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /- \*\*Otobüs faktörü:\*\* 2 kişi \(değişen satırların %60 kadarı\)/);
    assert.doesNotMatch(buildMarkdown(computeStats([ada([['a.js', 5]])], { today: TODAY }), { repoName: 'demo', today: TODAY }), /Bus factor/);
  });

  test('stats.json: stats.contributors.busFactor is {authors, share} or null', () => {
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.contributors.busFactor, { authors: 2, share: 0.6 });
    assert.deepEqual(Object.keys(doc.stats.contributors), ['total', 'top', 'you', 'authorFilter', 'truncated', 'busFactor']);
    const empty = JSON.parse(buildStatsJson({ stats: computeStats([], { today: TODAY }), repoName: 'demo' }));
    assert.equal(empty.stats.contributors.busFactor, null);
  });
});

// ---------------------------------------------------------------------------------------
describe('end to end (real repo, .mailmap, --exclude, --author)', () => {
  const env = (who, email, date) => {
    const e = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete e[k];
    return e;
  };
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + '\n';
  let root;
  let repo;
  const sink = (f) => ({ write: (x) => { f(String(x)); return true; }, isTTY: false });
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-bus-factor-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    const git = (args, e = env('Setup', 'setup@example.com', '2026-03-01T10:00:00Z')) => execFileSync('git', args, { cwd: repo, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    const step = (who, email, date, files) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), text);
      }
      git(['add', '-A']);
      git(['commit', '-q', '--no-gpg-sign', '--no-verify', '-m', `work by ${who}`], env(who, email, date));
    };
    // Ada commits under two emails that .mailmap merges: 41 lines (with the 1-line
    // .mailmap) + 40. Bob changes 40 lines and a 1,000-line lockfile; Cy 30 lines.
    step('Ada', 'ada@old.example', '2026-03-02T10:00:00Z', { '.mailmap': 'Ada Lovelace <ada@new.example> <ada@old.example>\n', 'src/a.js': lines(40, 'a') });
    step('Ada Lovelace', 'ada@new.example', '2026-03-03T10:00:00Z', { 'src/b.js': lines(40, 'b') });
    step('Bob', 'bob@example.com', '2026-03-04T10:00:00Z', { 'src/c.js': lines(40, 'c'), 'package-lock.json': lines(1000, 'l') });
    step('Cy', 'cy@example.com', '2026-03-05T10:00:00Z', { 'docs/d.md': lines(30, 'd') });
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

  test('CLI: stats.json, recap, wrapped.md and the team card (en / tr)', async () => {
    for (const [lang, recapRe, mdRe, cardRe] of [
      ['en', /Bus factor\s+1 person \(54% of lines changed\)/, /- \*\*Bus factor:\*\* 1 person \(54% of lines changed\)/, /Bus factor \| 1 person · 54%/],
      ['tr', /Otobüs faktörü\s+1 kişi \(değişen satırların %54 kadarı\)/, /- \*\*Otobüs faktörü:\*\* 1 kişi \(değişen satırların %54 kadarı\)/, /Otobüs faktörü \| 1 kişi · %54/],
    ]) {
      const out = join(root, `out-${lang}`);
      let stdout = '';
      const code = await run([repo, '--no-png', '--json', '--md', '--lang', lang, '--out', out], { stdout: sink((x) => { stdout += x; }), stderr: sink(() => {}), env: {}, today: TODAY });
      assert.equal(code, 0);
      const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
      // Ada (merged by .mailmap) made 81 of the 151 counted lines; the lockfile is left out.
      assert.equal(doc.stats.contributors.total, 3);
      assert.deepEqual(doc.stats.contributors.busFactor, { authors: 1, share: 0.536 });
      assert.match(stdout, recapRe, lang);
      assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), mdRe, lang);
      const svg = readFileSync(join(out, 'cards', '08-contributors.svg'), 'utf8');
      assert.match(svgText(svg), cardRe, lang);
      assert.doesNotMatch(svg, /@/);
      assert.doesNotMatch(JSON.stringify(doc.stats.contributors.busFactor), /@/);
    }
  });

  test('--exclude leaves its files out; --author keeps the whole team\'s bus factor', async () => {
    // Without src/b.js: Ada 41, Bob 40, Cy 30 → two people (81 of 111).
    const x = await generate({ path: repo, out: join(root, 'x'), png: false, json: true, exclude: ['src/b.js'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.contributors.busFactor, { authors: 2, share: 0.73 });
    // --author: your own stats are filtered, the bus factor is the team's (as the ranking).
    const a = await generate({ path: repo, out: join(root, 'a'), png: false, json: true, author: 'cy@example.com' }, { today: TODAY });
    assert.equal(a.stats.totals.commits, 1);
    assert.equal(a.stats.contributors.you.rank, 3);
    assert.deepEqual(plain(a.stats.contributors.busFactor), { authors: 1, share: 0.536 });
    assert.match(formatSummary(a.stats, { repoName: 'app', today: TODAY }), /Bus factor\s+1 person \(54% of lines changed\)/);
  });
});

// ---------------------------------------------------------------------------------------
// Tester additions: edge cases around identities, git numstat shapes, multi-repo runs and
// outputs that must stay as before.
describe('edge cases (tester)', () => {
  test('merge-only and co-author-only people: identities count, lines do not', () => {
    // Mo only merges (no files): still a contributor, so Ada alone made every counted line.
    const merged = [ada([['src/a.js', 10]]), commit('Mo', 'mo@example.com', [], { parents: ['a', 'b'] })];
    assert.deepEqual(plain(computeBusFactor(merged)), { authors: 1, share: 1 });
    assert.equal(computeContributors(merged).total, 2);
    const s = computeStats(merged, { today: TODAY });
    assert.deepEqual(teamSpec(s, 'en').lines?.map((l) => l.value), ['1 person · 100%']);
    // Co-authors are never authors here: Zed paired on everything but is no identity.
    const paired = [ada([['a.js', 10]], { coAuthors: [{ name: 'Zed', email: 'zed@example.com' }] }), ada([['b.js', 10]], { coAuthors: [{ name: 'Zed', email: 'zed@example.com' }] })];
    assert.equal(computeBusFactor(paired), null);
  });

  test('binary files add 0 lines; renames (as --no-renames reports them) count both sides', () => {
    const bin = { path: 'logo.png', added: 0, removed: 0, binary: true };
    assert.equal(computeBusFactor([ada([]), bob([])].map((c, i) => ({ ...c, files: [bin], filesChanged: 1 }))), null);
    // A pure 30-line rename by Bob is a delete of 30 and an add of 30 → 60 of 95.
    assert.deepEqual(plain(computeBusFactor([ada([['src/a.js', 35]]), bob([['src/a.js', 0, 30], ['src/b.js', 30]])])), { authors: 1, share: 0.632 });
  });

  test('a person spread over two repos of a multi-repo run is one identity', () => {
    const { commits: merged } = mergeHistories([
      { label: 'api', commits: [ada([['src/a.js', 30]]), bob([['src/b.js', 40]])] },
      { label: 'web', commits: [ada([['src/c.js', 30]]), cy([['src/d.js', 25]])] },
    ]);
    // Ada 60 of 125 is under half; Ada + Bob 100 of 125.
    assert.deepEqual(plain(computeBusFactor(merged)), { authors: 2, share: 0.8 });
    // Ignore rules look past the repo label, even nested: web/node_modules/... and api/yarn.lock.
    const { commits: m2 } = mergeHistories([
      { label: 'api', commits: [ada([['src/a.js', 10], ['yarn.lock', 900]])] },
      { label: 'web', commits: [bob([['node_modules/x/y.js', 900], ['src/b.js', 5]])] },
    ]);
    assert.deepEqual(plain(computeBusFactor(m2)), { authors: 1, share: 0.667 });
  });

  test('ties at exactly half, larger teams and a boundary just over half', () => {
    // 20 equal people: exactly 10 make half.
    const twenty = Array.from({ length: 20 }, (_, i) => commit(`P${i}`, `p${i}@example.com`, [[`f${i}.js`, 3]]));
    assert.deepEqual(plain(computeBusFactor(twenty)), { authors: 10, share: 0.5 });
    // 2k+1 equal people: k is short of half, k + 1 is enough.
    const five = Array.from({ length: 5 }, (_, i) => commit(`P${i}`, `p${i}@example.com`, [[`f${i}.js`, 1]]));
    assert.deepEqual(plain(computeBusFactor(five)), { authors: 3, share: 0.6 });
    // Huge line counts compare exactly (no float drift): 2^52 vs 2^52 - 1 … still one person.
    const big = 2 ** 52;
    assert.deepEqual(plain(computeBusFactor([ada([['a.js', big]]), bob([['b.js', big - 1]])])), { authors: 1, share: 0.5 });
    assert.deepEqual(shownBusFactor(computeBusFactor([ada([['a.js', big]]), bob([['b.js', big - 1]])])), { authors: 1, percent: 50 });
  });

  test('stats.json keeps the bus factor even when the team card is hidden; recap and wrapped.md do not show it', () => {
    const s = team(3);
    const hidden = { ...s, contributors: { ...s.contributors, authorFilter: true, you: null } };
    const doc = JSON.parse(buildStatsJson({ stats: hidden, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.contributors.busFactor, plain(s.contributors.busFactor));
    assert.doesNotMatch(buildMarkdown(hidden, { repoName: 'demo', today: TODAY }), /Bus factor/);
    assert.doesNotMatch(buildMarkdown(hidden, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Otobüs/);
    assert.doesNotMatch(formatSummary(hidden, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Otobüs/);
    assert.equal(buildCardSpecs(hidden, { today: TODAY }).find((c) => c.id === 'contributors'), undefined);
  });

  test('a malformed busFactor in stats never throws and shows nowhere', () => {
    const s = team(3);
    for (const v of [{ authors: 2, share: Number.NaN }, { authors: 2 }, { authors: 2, share: 'x' }]) {
      const bad = { ...s, contributors: { ...s.contributors, busFactor: v } };
      // Rendered with a share of 0 → "<1%" rather than crashing; the count is still valid.
      assert.doesNotThrow(() => buildCards(bad, { today: TODAY }));
      assert.doesNotThrow(() => formatSummary(bad, { repoName: 'demo', today: TODAY }));
      assert.doesNotThrow(() => buildMarkdown(bad, { repoName: 'demo', today: TODAY }));
    }
    for (const v of [{ authors: Number.NaN, share: 0.5 }, { authors: Infinity, share: 0.6 }, 'two', []]) {
      const bad = { ...s, contributors: { ...s.contributors, busFactor: v } };
      assert.equal(teamSpec(bad, 'en').lines, undefined, JSON.stringify(v));
      assert.doesNotMatch(formatSummary(bad, { repoName: 'demo', today: TODAY }), /Bus factor/);
      assert.doesNotMatch(buildMarkdown(bad, { repoName: 'demo', today: TODAY }), /Bus factor/);
    }
  });

  test('non-team output is unchanged: a one-author history only gains "busFactor": null', () => {
    const solo = computeStats([ada([['src/a.js', 10]]), ada([['src/b.js', 20]])], { today: TODAY });
    assert.equal(solo.contributors.busFactor, null);
    const withoutKey = { ...solo, contributors: Object.fromEntries(Object.entries(solo.contributors).filter(([k]) => k !== 'busFactor')) };
    for (const lang of ['en', 'tr']) {
      assert.equal(formatSummary(solo, { repoName: 'demo', today: TODAY, lang }), formatSummary(withoutKey, { repoName: 'demo', today: TODAY, lang }));
      assert.equal(buildMarkdown(solo, { repoName: 'demo', today: TODAY, lang }), buildMarkdown(withoutKey, { repoName: 'demo', today: TODAY, lang }));
      assert.deepEqual(buildCards(solo, { today: TODAY, lang }).map((c) => c.svg), buildCards(withoutKey, { today: TODAY, lang }).map((c) => c.svg));
    }
  });
});

describe('end to end: binary, rename, merge, multi-repo, absent --author (tester)', () => {
  const env = (who, email, date) => {
    const e = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete e[k];
    return e;
  };
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + '\n';
  let root;
  let app;
  let lib;
  const setup = (dir) => {
    mkdirSync(dir);
    const git = (args, e = env('Setup', 'setup@example.com', '2026-03-01T10:00:00Z')) => execFileSync('git', args, { cwd: dir, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    const step = (who, email, date, files, args = []) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      git(['add', '-A']);
      git(['commit', '-q', '--no-gpg-sign', '--no-verify', ...args, '-m', `work by ${who}`], env(who, email, date));
    };
    return { git, step };
  };
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-bus-factor-x-'));
    app = join(root, 'app');
    lib = join(root, 'lib');
    const a = setup(app);
    a.step('Ada', 'ada@example.com', '2026-03-02T10:00:00Z', { 'src/a.js': lines(30, 'a') });
    // A binary file ("-\t-" in numstat): 0 lines.
    a.step('Bob', 'bob@example.com', '2026-03-03T10:00:00Z', { 'img/logo.bin': Buffer.from([0, 1, 2, 0, 255, 0, 3]) });
    a.git(['mv', 'src/a.js', 'src/renamed.js']);
    a.step('Bob', 'bob@example.com', '2026-03-04T10:00:00Z', {});
    a.git(['checkout', '-q', '-b', 'feat']);
    a.step('Cy', 'cy@example.com', '2026-03-05T10:00:00Z', { 'src/f.js': lines(10, 'f') });
    a.git(['checkout', '-q', 'main']);
    a.step('Ada', 'ada@example.com', '2026-03-06T10:00:00Z', { 'src/m.js': lines(5, 'm') });
    a.git(['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', 'Merge feat', 'feat'], env('Mo', 'mo@example.com', '2026-03-07T10:00:00Z'));
    const l = setup(lib);
    l.step('Ada', 'ada@example.com', '2026-03-08T10:00:00Z', { 'src/l.js': lines(100, 'l') });
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

  test('binary 0, rename both sides, merge 0: Bob 60 of 105', async () => {
    const r = await generate({ path: app, out: join(root, 'o1'), png: false, json: true }, { today: TODAY });
    assert.equal(r.stats.contributors.total, 4);
    assert.deepEqual(plain(r.stats.contributors.busFactor), { authors: 1, share: 0.571 });
  });

  test('multi-repo: Ada in both repos is one person (135 of 205)', async () => {
    const r = await generate({ path: app, paths: [app, lib], out: join(root, 'o2'), png: false, json: true }, { today: TODAY });
    assert.equal(r.stats.contributors.total, 4);
    assert.deepEqual(plain(r.stats.contributors.busFactor), { authors: 1, share: 0.659 });
    // --author in a multi-repo run: still the whole team's.
    const a = await generate({ path: app, paths: [app, lib], out: join(root, 'o3'), png: false, json: true, author: 'cy@example.com' }, { today: TODAY });
    assert.deepEqual(plain(a.stats.contributors.busFactor), { authors: 1, share: 0.659 });
  });

  test('--author with --exclude: the team read drops the excluded files too', async () => {
    // Without src/renamed.js: Ada 35 (a.js 30 + m.js 5), Bob 30 (a.js delete), Cy 10 → 35 of 75.
    const a = await generate({ path: app, out: join(root, 'o4'), png: false, json: true, author: 'cy@example.com', exclude: ['src/renamed.js'] }, { today: TODAY });
    const b = await generate({ path: app, out: join(root, 'o5'), png: false, json: true, exclude: ['src/renamed.js'] }, { today: TODAY });
    assert.deepEqual(plain(b.stats.contributors.busFactor), { authors: 2, share: 0.867 });
    assert.deepEqual(plain(a.stats.contributors.busFactor), plain(b.stats.contributors.busFactor));
  });

  test('an --author absent from the history: no bus factor anywhere, nothing throws', async () => {
    const out = join(root, 'o6');
    let stdout = '';
    const sink = (f) => ({ write: (x) => { f(String(x)); return true; }, isTTY: false });
    const code = await run([app, '--no-png', '--json', '--md', '--author', 'nobody@example.com', '--out', out], { stdout: sink((x) => { stdout += x; }), stderr: sink(() => {}), env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /Bus factor/);
    assert.equal(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.contributors.busFactor, null);
    assert.doesNotMatch(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Bus factor/);
  });
});
