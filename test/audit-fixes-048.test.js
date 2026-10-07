// Regression tests for the loop-048 audit of the 1.5 work: no email address reaches any
// output. Commit subjects (the longest / shortest message, the biggest commit) and hot-file
// paths had email-shaped text scrubbed only in wrapped.md; stats.json, the cards (and so the
// PNGs, the share image and wrapped.html with its screen-reader descriptions and tooltips)
// and the terminal recap showed it raw. Now the stats engine replaces it with "…" (see
// src/privacy.js scrubEmails), and the cards and recap cut it again for hand-made stats.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeBiggestCommit, computeHotFiles, computeMessages, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, renderShareCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { generate } from '../src/cli.js';
import { mergeHistories, repoLabels } from '../src/git.js';
import { scrubEmails } from '../src/privacy.js';
import { buildMarkdown } from '../src/markdown.js';

const TODAY = '2026-10-06';
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/;

let n = 0;
/** A non-merge commit as readCommits() returns it. */
function commit(subject, { path = 'src/a.js', added = 2, date } = {}) {
  n += 1;
  const files = [{ path, added, removed: 0, binary: false }];
  return {
    hash: `c48${String(n).padStart(4, '0')}`,
    author: 'Ada',
    email: 'ada@example.com',
    date: date ?? `2026-03-${String((n % 28) + 1).padStart(2, '0')}T10:00:00+00:00`,
    parents: ['p'],
    subject,
    files,
    filesChanged: 1,
    linesAdded: added,
    linesRemoved: 0,
  };
}

/** A history whose shortest, longest and biggest commits and hottest file all carry an email. */
function leakyHistory() {
  return [
    commit('x@leak.io'),
    commit('a long subject line that mentions longest@leak.io and keeps going on and on and on'),
    commit('feat: big drop, ping mail@leak.io', { added: 900 }),
    ...[1, 2, 3, 4, 5].map((i) => commit(`rotate key ${i}`, { path: 'keys/bob@leak.io.pub' })),
  ];
}

describe('scrubEmails keeps versions and scale suffixes', () => {
  test('a version or "@2x" after the "@" is not an address', () => {
    for (const keep of ['assets/logo@2x.png', 'img@1.5x.webp', 'bump lodash@4.17.21', '@babel/core@7.2', 'deps/pkg@1.2.3/x.js', 'src/@types/x.d.ts']) {
      assert.equal(scrubEmails(keep), keep);
    }
  });

  test('real addresses are still cut, with or without a dotted domain', () => {
    assert.equal(scrubEmails('ada@localhost'), '…');
    assert.equal(scrubEmails('root@buildbox'), '…');
    assert.equal(scrubEmails('mail a.b@ex.co now'), 'mail … now');
    assert.equal(scrubEmails('keys/ada@example.com.pub'), 'keys/…');
    assert.equal(scrubEmails('Ünal@örnek.com.tr'), '…');
  });

  test('stats keep version-like subjects and @2x paths whole', () => {
    const stats = computeStats([commit('chore: bump lodash@4.17.21', { path: 'assets/logo@2x.png', added: 40 })], { today: TODAY });
    assert.equal(stats.biggestCommit.subject, 'chore: bump lodash@4.17.21');
    assert.equal(stats.messages.longest.subject, 'chore: bump lodash@4.17.21');
    assert.equal(stats.hotFiles[0].path, 'assets/logo@2x.png');
  });
});

describe('repo labels are scrubbed at the source', () => {
  test('repoLabels cuts addresses and keeps labels unique', () => {
    assert.deepEqual(repoLabels(['ada@leak.io', 'bob@leak.io', 'web', 'app@2.0']), ['…', '…-2', 'web', 'app@2.0']);
  });

  test('no output of a multi-repo run shows an address-shaped label', () => {
    const labels = repoLabels(['ada@leak.io', 'web']);
    const histories = labels.map((label, i) => ({ label, commits: [commit(`feat: ${i}`, { path: 'src/a.js', added: 10 + i })], truncated: false }));
    const { commits } = mergeHistories(histories);
    const stats = computeStats(commits, { today: TODAY, repos: labels });
    assert.doesNotMatch(JSON.stringify(stats), EMAIL);
    const opts = { repoName: 'demo', today: TODAY };
    for (const c of buildCards(stats, opts)) assert.doesNotMatch(c.svg, EMAIL, c.id);
    assert.doesNotMatch(formatSummary(stats, { ...opts, html: 'out/wrapped.html' }), EMAIL);
    assert.doesNotMatch(buildMarkdown(stats, opts), EMAIL);
  });
});

describe('stats: email-shaped text is scrubbed', () => {
  test('messages: longest / shortest subjects, their lengths and the top word', () => {
    const m = computeMessages(leakyHistory());
    assert.equal(m.shortest.subject, '…');
    assert.equal(m.shortest.length, 1);
    assert.equal(m.longest.subject, 'a long subject line that mentions … and keeps going on and on and on');
    assert.equal(m.longest.length, [...m.longest.subject].length);
    // "leak" (the domain) no longer wins the favorite word: words come from scrubbed subjects.
    assert.notEqual(m.topWord?.word, 'leak');
    assert.equal(m.topWord?.word, 'key');
  });

  test('biggest commit subject', () => {
    const b = computeBiggestCommit(leakyHistory());
    assert.equal(b.subject, 'feat: big drop, ping …');
    assert.equal(b.lines, 900);
    // A subject that is only an address reads "…", never null.
    assert.equal(computeBiggestCommit([commit('ada@leak.io')]).subject, '…');
  });

  test('hot-file paths keep their folders, the address in the file name is cut', () => {
    const hot = computeHotFiles(leakyHistory());
    assert.equal(hot[0].path, 'keys/…');
    assert.equal(hot[0].commits, 5);
    // Two different address-named files stay two entries (counted by their real paths).
    const two = computeHotFiles([commit('a', { path: 'k/a@x.io' }), commit('b', { path: 'k/b@x.io' }), commit('c', { path: 'k/b@x.io' })]);
    assert.deepEqual(two.map((f) => [f.path, f.commits]), [['k/…', 2], ['k/…', 1]]);
    // Paths without an address are unchanged ("@types" has nothing before the "@").
    assert.equal(computeHotFiles([commit('t', { path: 'src/@types/x.d.ts' })])[0].path, 'src/@types/x.d.ts');
  });

  test('computeStats: nothing in the JSON-able stats holds an address', () => {
    const stats = computeStats(leakyHistory(), { today: TODAY });
    assert.doesNotMatch(JSON.stringify(stats), EMAIL);
  });
});

describe('cards and recap scrub hand-made stats too', () => {
  const stats = computeStats(leakyHistory(), { today: TODAY });
  // As a stats.json written by hand (or by an older version) could hold them.
  stats.messages.shortest = { subject: 'x@leak.io', hash: 'h', length: 9 };
  stats.messages.longest = { subject: 'see longest@leak.io for details please', hash: 'h', length: 37 };
  stats.biggestCommit = { ...stats.biggestCommit, subject: 'big from mail@leak.io' };
  stats.hotFiles = [{ path: 'keys/bob@leak.io.pub', commits: 5, linesAdded: 5, linesRemoved: 0 }];
  const opts = { repoName: 'demo', today: TODAY };

  test('every card SVG, every card description and the share card', () => {
    for (const lang of ['en', 'tr']) {
      for (const c of buildCards(stats, { ...opts, lang })) assert.doesNotMatch(c.svg, EMAIL, `${lang} ${c.id}`);
      for (const { id, spec } of buildCardSpecs(stats, { ...opts, lang })) assert.doesNotMatch(cardDescription(spec), EMAIL, `${lang} ${id} description`);
      assert.doesNotMatch(renderShareCard(stats, { ...opts, lang }), EMAIL, `${lang} share`);
    }
    const messages = buildCards(stats, opts).find((c) => c.id === 'messages').svg;
    assert.match(messages, /see … for details please/);
    assert.match(messages, /big from …/);
  });

  test('the recap', () => {
    for (const lang of ['en', 'tr']) {
      const recap = formatSummary(stats, { ...opts, lang, html: 'out/wrapped.html' });
      assert.doesNotMatch(recap, EMAIL, lang);
    }
    const recap = formatSummary(stats, { ...opts, html: 'out/wrapped.html' });
    assert.match(recap, /keys\/…/);
    assert.match(recap, /"big from …"/);
  });
});

describe('end to end: a repo with addresses in subjects and file names', () => {
  let root;
  let repo;
  const git = (cwd, args, env = {}) => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
  const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-048-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    const steps = [
      ['src/a.js', 1, 'x@leak.io'],
      ['src/big.js', 700, 'feat: import data from mail@leak.io'],
      ['src/b.js', 2, 'a rather long subject naming longest@leak.io and then some more words'],
      ...[1, 2, 3, 4].map((i) => ['keys/bob@leak.io.pub', 1, `rotate key ${i}`]),
    ];
    steps.forEach(([path, lines, subject], i) => {
      const p = join(repo, path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `${Array.from({ length: lines + i }, (_, k) => `line ${k}`).join('\n')}\n`);
      git(repo, ['add', '-A']);
      const date = `2026-03-0${i + 1}T10:00:00+00:00`;
      git(repo, ['commit', '-q', '-m', subject], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    });
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

  test('stats.json, the cards, share.svg, wrapped.html and wrapped.md hold no address', async () => {
    const out = join(root, 'out');
    const r = await generate({ path: repo, out, png: false, md: true, json: true }, { today: TODAY });
    const files = [
      'stats.json',
      'wrapped.html',
      'wrapped.md',
      'share.svg',
      ...readdirSync(join(out, 'cards')).map((f) => join('cards', f)),
    ];
    for (const f of files) assert.doesNotMatch(readFileSync(join(out, f), 'utf8'), /leak\.io/, f);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats;
    assert.equal(json.messages.shortest.subject, '…');
    assert.equal(json.biggestCommit.subject, 'feat: import data from …');
    assert.equal(json.hotFiles[0].path, 'keys/…');
    // The screen-reader description of the messages card carries the scrubbed subjects.
    const html = readFileSync(join(out, 'wrapped.html'), 'utf8');
    assert.match(html, /data-card="messages"[\s\S]*?<p class="sr"[^>]*>[^<]*naming …/);
    assert.doesNotMatch(formatSummary(r.stats, { repoName: r.repoName, today: TODAY, html: join(out, 'wrapped.html') }), /leak\.io/);
  });
});

describe('tester additions: more paths through the scrub', () => {
  test('messages: fix / wip / oops counts are unaffected by scrubbing', () => {
    const m = computeMessages([
      commit('fix: reported by bug@fix.io'),
      commit('wip for wip@team.io'),
      commit('oops, ping oops@x.io'),
      commit('hotfix from a@b.c'),
      // The only "fix" here is inside the address, so it no longer counts once scrubbed.
      commit('thanks fix@host.io'),
    ]);
    assert.deepEqual(m.counts, { fix: 2, wip: 1, oops: 1 });
  });

  test('a subject that is only an address (with spaces around it) reads "…" everywhere', () => {
    const history = [commit('  ada@leak.io  ', { added: 50 }), commit('another regular subject')];
    const m = computeMessages(history);
    assert.equal(m.shortest.subject, '…');
    assert.equal(m.shortest.length, 1);
    assert.equal(computeBiggestCommit(history).subject, '…');
    const stats = computeStats(history, { today: TODAY });
    assert.doesNotMatch(JSON.stringify(stats), /leak/);
    for (const lang of ['en', 'tr']) {
      const svg = buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages').svg;
      assert.doesNotMatch(svg, /leak/, lang);
      assert.doesNotMatch(formatSummary(stats, { repoName: 'demo', today: TODAY, lang }), /leak/, lang);
    }
  });

  test('--lang tr messages card shows the scrubbed subjects', () => {
    const stats = computeStats(leakyHistory(), { today: TODAY });
    const tr = buildCards(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }).find((c) => c.id === 'messages').svg;
    assert.doesNotMatch(tr, EMAIL);
    assert.match(tr, /En kısa: “…”/);
    assert.match(tr, /“feat: big drop, ping …”/);
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }).find((c) => c.id === 'messages').spec;
    const desc = cardDescription(spec);
    assert.doesNotMatch(desc, EMAIL);
    assert.match(desc, /mentions …/);
  });

  test('multi-repo: repo-prefixed hot-file paths keep the repo and folders, cut only the address', () => {
    const tag = (repo, c) => ({ ...c, repo, files: c.files.map((f) => ({ ...f, path: `${repo}/${f.path}` })) });
    const history = [
      ...[1, 2, 3].map((i) => tag('api', commit(`rotate ${i}`, { path: 'keys/ada@x.io.pub' }))),
      ...[1, 2].map((i) => tag('web', commit(`edit ${i}`, { path: 'src/@types/x.d.ts' }))),
      tag('web', commit('vendored', { path: 'dist/bob@x.io.js' })), // ignored at the repo root
    ];
    const stats = computeStats(history, { today: TODAY, repos: ['api', 'web'] });
    assert.deepEqual(stats.hotFiles.map((f) => [f.path, f.commits]), [['api/keys/…', 3], ['web/src/@types/x.d.ts', 2]]);
    assert.doesNotMatch(JSON.stringify(stats), /ada@|bob@/);
    for (const lang of ['en', 'tr']) {
      const opts = { repoName: '2 repos', today: TODAY, lang };
      for (const c of buildCards(stats, opts)) assert.doesNotMatch(c.svg, /ada@|x\.io/, `${lang} ${c.id}`);
      for (const { id, spec } of buildCardSpecs(stats, opts)) assert.doesNotMatch(cardDescription(spec), /ada@|x\.io/, `${lang} ${id}`);
      assert.doesNotMatch(renderShareCard(stats, opts), /ada@|x\.io/);
      assert.match(formatSummary(stats, opts), /keys\/…/);
    }
    const hot = buildCardSpecs(stats, { repoName: '2 repos', today: TODAY }).find((c) => c.id === 'hot-files').spec;
    const list = [hot.chart].flat()[0];
    assert.equal(list.items[0].label, '…');
    assert.equal(list.items[0].sub, 'api/keys/'); // dirname() keeps the trailing slash
    assert.equal(list.items[1].label, 'x.d.ts');
  });

  test('two real paths that scrub to the same display string keep their own counts and order', () => {
    const history = [
      // Same commit count (2 each); k/b@ has more lines, so it ranks first by its real path's lines.
      commit('1', { path: 'k/a@x.io', added: 1 }),
      commit('2', { path: 'k/a@x.io', added: 1 }),
      commit('3', { path: 'k/b@x.io', added: 10 }),
      commit('4', { path: 'k/b@x.io', added: 10 }),
      // Equal commits and lines: real-path order (c@ < d@) decides.
      commit('5', { path: 'k/d@x.io', added: 1 }),
      commit('6', { path: 'k/c@x.io', added: 1 }),
      commit('7', { path: 'src/z.js', added: 1 }),
    ];
    const hot = computeStats(history, { today: TODAY }).hotFiles;
    assert.deepEqual(
      hot.map((f) => [f.path, f.commits, f.linesAdded]),
      [['k/…', 2, 20], ['k/…', 2, 2], ['k/…', 1, 1], ['k/…', 1, 1], ['src/z.js', 1, 1]],
    );
    // Same result as the unscrubbed ranking, mapped to display.
    const real = computeHotFiles(history.map((c) => ({ ...c, files: c.files.map((f) => ({ ...f, path: f.path.replace('@x.io', '_x') })) })));
    assert.deepEqual(hot.map((f) => [f.commits, f.linesAdded]), real.map((f) => [f.commits, f.linesAdded]));
    assert.deepEqual(real.map((f) => f.path), ['k/b_x', 'k/a_x', 'k/c_x', 'k/d_x', 'src/z.js']);
    // The card still shows one bar per entry (no merging by display path), and the recap the top one.
    const spec = buildCardSpecs(computeStats(history, { today: TODAY }), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'hot-files').spec;
    assert.equal([spec.chart].flat()[0].items.length, 5);
  });

  test('paths with "@" but nothing before it are untouched, at any depth', () => {
    for (const path of ['src/@types/x.d.ts', '@types/x.d.ts', 'packages/@scope/pkg/index.js']) {
      const stats = computeStats([commit('t', { path })], { today: TODAY });
      assert.equal(stats.hotFiles[0].path, path);
      assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), new RegExp(path.split('/').at(-1).replace(/\./g, '\\.')));
    }
  });
});
