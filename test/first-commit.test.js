// First commit: computeFirstCommit (src/stats/first.js), stats.json, the intro card's
// "It all began with" panel, the recap line and wrapped.md.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFirstCommit, computeStats, SHORT_HASH } from '../src/stats/index.js';
import { scrubEmails } from '../src/privacy.js';
import { buildCards, buildCardSpecs, layoutCard, measureText } from '../src/cards/index.js';
import { CALLOUT_NOTE } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(date, subject, extra = {}) {
  n += 1;
  const hash = `${String(n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
  return { hash, author: 'A', email: 'a@x.io', date, subject, parents: ['p'], files: [{ path: 'src/a.js', added: 1, removed: 0, binary: false }], ...extra };
}

/** The text of every <text> element of an SVG, decoded enough for matching. */
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

describe('computeFirstCommit', () => {
  test('empty / missing input → null', () => {
    assert.equal(computeFirstCommit([]), null);
    assert.equal(computeFirstCommit(undefined), null);
    assert.equal(computeFirstCommit(null), null);
    assert.equal(computeFirstCommit([null, 42, 'x']), null);
    assert.equal(computeStats([], { today: TODAY }).firstCommit, null);
  });

  test('picks the earliest by author instant, with the documented shape', () => {
    const late = commit('2026-03-06T10:00:00+00:00', 'later');
    // 23:30 at -05:00 is 04:30 UTC on Mar 5: earlier than `early2` (Mar 5 05:00 UTC).
    const first = commit('2026-03-04T23:30:00-05:00', '  feat: hello  ');
    const early2 = commit('2026-03-05T05:00:00+00:00', 'almost first');
    assert.deepEqual(computeFirstCommit([late, early2, first]), {
      date: '2026-03-04', // author-local day, not UTC (2026-03-05)
      subject: 'feat: hello',
      hash: first.hash.slice(0, SHORT_HASH),
    });
    assert.equal(SHORT_HASH, 7);
  });

  test('merge commits are skipped (as for the biggest commit); only merges → null', () => {
    const merge = commit('2026-01-01T00:00:00Z', 'Merge branch x', { parents: ['a', 'b'] });
    const real = commit('2026-02-01T00:00:00Z', 'real');
    assert.equal(computeFirstCommit([real, merge]).subject, 'real');
    assert.equal(computeFirstCommit([merge]), null);
  });

  test('ties on the same instant go to the later one in input order (older in git order)', () => {
    const a = commit('2026-03-01T10:00:00+00:00', 'listed first');
    const b = commit('2026-03-01T12:00:00+02:00', 'listed second'); // same instant
    assert.equal(computeFirstCommit([a, b]).subject, 'listed second');
    assert.equal(computeFirstCommit([b, a]).subject, 'listed first');
  });

  test('undated commits come after dated ones; all undated → last in input, date null', () => {
    const bad = commit('not a date', 'undated');
    const ok = commit('2026-03-01T10:00:00Z', 'dated');
    assert.equal(computeFirstCommit([ok, bad]).subject, 'dated');
    assert.equal(computeFirstCommit([bad, ok]).subject, 'dated');
    const bad2 = commit(undefined, 'undated 2');
    assert.deepEqual(computeFirstCommit([bad, bad2]), { date: null, subject: 'undated 2', hash: bad2.hash.slice(0, 7) });
  });

  test('email-shaped text is cut from the subject; empty subject / hash → null', () => {
    const c = commit('2026-03-01T10:00:00Z', 'init by ada@example.com (root@buildbox)');
    assert.equal(computeFirstCommit([c]).subject, 'init by … (…)');
    assert.deepEqual(computeFirstCommit([commit('2026-03-01T10:00:00Z', '   ', { hash: '' })]), { date: '2026-03-01', subject: null, hash: null });
    assert.deepEqual(computeFirstCommit([commit('2026-03-01T10:00:00Z', 'only@email.io', { hash: undefined })]), { date: '2026-03-01', subject: '…', hash: null });
    assert.equal(scrubEmails('a@b c'), '… c');
    // A hash that is not letters / digits (an email in a fixture, say) is not shown.
    assert.equal(computeFirstCommit([commit('2026-03-01T10:00:00Z', 'x', { hash: 'bob@x.io' })]).hash, null);
  });

  test('repo is kept only when the commit carries a label (multi-repo)', () => {
    const c = commit('2026-03-01T10:00:00Z', 'x', { repo: 'api' });
    assert.equal(computeFirstCommit([c]).repo, 'api');
    assert.equal('repo' in computeFirstCommit([commit('2026-03-01T10:00:00Z', 'x')]), false);
  });

  test('computeStats exposes it as stats.firstCommit', () => {
    const c = commit('2026-03-01T10:00:00Z', 'x');
    assert.deepEqual(computeStats([c], { today: TODAY }).firstCommit, computeFirstCommit([c]));
  });
});

describe('intro card', () => {
  const history = [commit('2026-03-06T10:00:00Z', 'second'), commit('2026-03-02T09:00:00Z', 'Initial commit')];
  const stats = computeStats(history, { today: TODAY });
  const intro = (s, opts = {}) => buildCards(s, { repoName: 'demo', today: TODAY, ...opts })[0];

  test('shows "It all began with", the quoted subject, the day and short hash', () => {
    const t = texts(intro(stats).svg);
    assert.ok(t.includes('IT ALL BEGAN WITH'));
    assert.ok(t.includes('“Initial commit”'));
    assert.ok(t.includes(`Mar 2, 2026 · ${stats.firstCommit.hash}`));
    // The range panel is still there.
    assert.ok(t.includes('YOUR STORY SO FAR'));
  });

  test('Turkish', () => {
    const t = texts(intro(stats, { lang: 'tr' }).svg);
    assert.ok(t.includes('HER ŞEY BUNUNLA BAŞLADI'));
    assert.ok(t.includes(`2 Mar 2026 · ${stats.firstCommit.hash}`));
  });

  test('a long subject is cut with "…" on one line; emails never shown', () => {
    const long = { ...stats, firstCommit: { ...stats.firstCommit, subject: `by ada@example.com ${'very long words '.repeat(20)}` } };
    const svg = intro(long).svg;
    const line = texts(svg).find((x) => x.startsWith('“by'));
    assert.ok(line.endsWith('…'), line);
    assert.doesNotMatch(svg, /example\.com/);
  });

  test('a multi-repo first commit names its repo', () => {
    const multi = { ...stats, firstCommit: { ...stats.firstCommit, repo: 'api' } };
    assert.ok(texts(intro(multi).svg).includes(`Mar 2, 2026 · ${stats.firstCommit.hash} · api`));
  });

  test('a long repo label is cut with "…"; day and hash always stay whole', () => {
    const repo = 'a-very-long-repository-nm'; // 25 characters
    const t = texts(intro({ ...stats, firstCommit: { ...stats.firstCommit, repo } }).svg);
    const note = t.find((x) => x.startsWith('Mar 2, 2026 · '));
    assert.ok(note.startsWith(`Mar 2, 2026 · ${stats.firstCommit.hash} · a`), note);
    assert.ok(note.endsWith('…') && !note.endsWith('·…') && !note.endsWith(' …'), note);
    assert.ok(repo.startsWith(note.split(' · ')[2].slice(0, -1)), note);
    // A label that cannot fit even a stub is left out: a (made-up) hash just short of the
    // note width leaves no room for " · a…", and day and hash still show whole.
    const fits = (x) => measureText(x, CALLOUT_NOTE.size) <= CALLOUT_NOTE.maxWidth;
    let hash = 'W';
    while (fits(`Mar 2, 2026 · ${hash}W`)) hash += 'W';
    assert.ok(!fits(`Mar 2, 2026 · ${hash} · a…`));
    const t2 = texts(intro({ ...stats, firstCommit: { ...stats.firstCommit, hash, repo } }).svg);
    assert.ok(t2.includes(`Mar 2, 2026 · ${hash}`), t2.join('\n'));
  });

  test('without stats.firstCommit the intro is exactly as before (one callout)', () => {
    const none = { ...stats, firstCommit: null };
    const spec = buildCardSpecs(none, { repoName: 'demo', today: TODAY })[0].spec;
    assert.equal(Array.isArray(spec.chart), false);
    assert.equal(spec.chart.kind, 'callout');
    assert.doesNotMatch(intro(none).svg, /BEGAN/);
  });

  test('the panel is optional: dropped when there is no room, layout otherwise unchanged', () => {
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY })[0].spec;
    assert.equal(spec.chart[0].optional, true);
    // Extra panels below leave no room for it.
    const [began, main] = spec.chart;
    const crowded = { ...spec, chart: [began, main, main, main] };
    const withPanel = layoutCard(crowded);
    const without = layoutCard({ ...crowded, chart: [main, main, main] });
    assert.deepEqual(withPanel.drawnCharts, [1, 2, 3]);
    assert.deepEqual(withPanel.blocks, without.blocks);
  });
});

describe('recap and wrapped.md', () => {
  const history = [commit('2026-03-06T10:00:00Z', 'second'), commit('2026-03-02T09:00:00Z', 'Initial | commit by bob@corp.io')];
  const stats = computeStats(history, { today: TODAY });

  test('recap: "First commit" line with subject, day and hash (en / tr)', () => {
    const en = formatSummary(stats, { repoName: 'demo', today: TODAY });
    assert.match(en, new RegExp(`First commit\\s+"Initial \\| commit by …" \\(Mar 2, 2026 · ${stats.firstCommit.hash}\\)`));
    const tr = formatSummary(stats, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(tr, /İlk commit\s+"Initial \| commit by …" \(2 Mar 2026 · /);
    const firstLines = (en + tr).split('\n').filter((l) => /First commit|İlk commit/.test(l));
    assert.equal(firstLines.length, 2);
    assert.doesNotMatch(firstLines.join('\n'), /corp\.io/);
  });

  test('recap: no line without a first commit', () => {
    assert.doesNotMatch(formatSummary({ ...stats, firstCommit: null }, { repoName: 'demo' }), /First commit/);
  });

  test('wrapped.md: a "First commit" item, escaped, hash in a code span, no email', () => {
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    assert.ok(md.includes(`- **First commit:** “Initial \\| commit by …” (Mar 2, 2026 · \`${stats.firstCommit.hash}\`)`), md);
    assert.doesNotMatch(md, /corp\.io/);
    const tr = buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(tr, /- \*\*İlk commit:\*\* /);
    assert.doesNotMatch(buildMarkdown({ ...stats, firstCommit: null }, { repoName: 'demo' }), /First commit/);
  });

  test('wrapped.md: a non-hex hash is escaped, not put in a code span', () => {
    const md = buildMarkdown({ ...stats, firstCommit: { ...stats.firstCommit, hash: '`x`' } }, { repoName: 'demo' });
    assert.ok(md.includes('· \\`x\\`)'), md);
  });
});

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('generate (end to end)', () => {
  let root;
  const repos = {};
  const who = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com' };
  const make = (name, steps) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    for (const [i, s] of steps.entries()) {
      writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', s.msg], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
    }
    repos[name] = repo;
  };
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-first-'));
    make('app', [
      { date: '2024-12-30T10:00:00+00:00', msg: 'last year by ada@example.com' },
      { date: '2025-01-03T10:00:00+00:00', msg: 'Kick off 2025' },
      { date: '2025-02-01T10:00:00+00:00', msg: 'more' },
    ]);
    make('web', [{ date: '2025-01-02T10:00:00+00:00', msg: 'web starts' }]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, recap data and wrapped.md follow the window; no email anywhere', async () => {
    const all = await generate({ path: repos.app, out: join(root, 'o1'), png: false, json: true, md: true }, { today: '2025-03-01' });
    const doc = JSON.parse(readFileSync(all.statsJson, 'utf8'));
    assert.deepEqual(Object.keys(doc.stats.firstCommit), ['date', 'subject', 'hash']);
    assert.equal(doc.stats.firstCommit.subject, 'last year by …');
    assert.equal(doc.stats.firstCommit.date, '2024-12-30');
    assert.match(doc.stats.firstCommit.hash, /^[0-9a-f]{7}$/);
    const md = readFileSync(all.markdown, 'utf8');
    assert.match(md, /First commit/);
    assert.doesNotMatch(md + JSON.stringify(doc.stats.firstCommit), /example\.com/);

    const year = await generate({ path: repos.app, out: join(root, 'o2'), png: false, json: true, since: '2025-01-01', until: '2025-12-31' }, { today: '2025-03-01' });
    assert.equal(year.stats.firstCommit.subject, 'Kick off 2025');
    assert.equal(year.stats.firstCommit.date, '2025-01-03');
  });

  test('multi-repo: the earliest across repos, with its repo label', async () => {
    const r = await generate({ paths: [repos.app, repos.web], out: join(root, 'o3'), png: false, since: '2025-01-01' }, { today: '2025-03-01' });
    assert.equal(r.stats.firstCommit.subject, 'web starts');
    assert.equal(r.stats.firstCommit.repo, 'web');
  });
});
