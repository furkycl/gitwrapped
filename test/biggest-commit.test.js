// Biggest commit: computeBiggestCommit (src/stats/biggest.js), stats.json, the messages
// card's panel and the recap line.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeBiggestCommit, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard, CARD_HEIGHT } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { generate } from '../src/cli.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(date, subject, files, extra = {}) {
  n += 1;
  return { hash: `h${n}`, author: 'A', email: 'a@x', date, subject, parents: ['p'], files, ...extra };
}
const f = (path, added, removed = 0) => ({ path, added, removed, binary: false });

describe('computeBiggestCommit', () => {
  test('empty / missing input → null', () => {
    assert.equal(computeBiggestCommit([]), null);
    assert.equal(computeBiggestCommit(undefined), null);
    assert.equal(computeBiggestCommit(null), null);
    assert.equal(computeStats([], { today: TODAY }).biggestCommit, null);
  });

  test('picks the most lines changed, with the documented shape', () => {
    const a = commit('2026-03-04T23:30:00-05:00', '  feat: big one  ', [f('src/a.js', 100, 20), f('src/b.js', 5, 5), f('src/a.js', 1, 0)]);
    const b = commit('2026-03-06T10:00:00+00:00', 'small', [f('src/a.js', 3, 1)]);
    assert.deepEqual(computeBiggestCommit([b, a]), {
      hash: a.hash,
      subject: 'feat: big one',
      date: '2026-03-04', // author-local day, not UTC (2026-03-05)
      linesAdded: 106,
      linesRemoved: 25,
      lines: 131,
      files: 2,
    });
  });

  test('ignores the same paths as hot files (lockfiles, build output, vendored, minified, snapshots)', () => {
    const noisy = commit('2026-03-01T10:00:00Z', 'bump deps', [
      f('package-lock.json', 50000, 40000),
      f('dist/app.js', 9000),
      f('node_modules/x/index.js', 900),
      f('vendor/lib.c', 800),
      f('web.min.js', 700),
      f('__snapshots__/a.snap', 600),
      f('src/real.js', 2),
    ]);
    const real = commit('2026-03-02T10:00:00Z', 'real work', [f('src/real.js', 30, 10)]);
    const r = computeBiggestCommit([noisy, real]);
    assert.equal(r.hash, real.hash);
    assert.equal(r.lines, 40);
    // Only ignored files: cannot be the biggest at all.
    assert.equal(computeBiggestCommit([commit('2026-03-01T10:00:00Z', 'lock', [f('yarn.lock', 10)])]), null);
  });

  test('multi-repo: ignore rules apply at each repo root (prefixed paths)', () => {
    const api = commit('2026-03-01T10:00:00Z', 'api build', [f('api/dist/out.js', 5000), f('api/src/x.js', 1)], { repo: 'api' });
    const web = commit('2026-03-02T10:00:00Z', 'web work', [f('web/src/y.js', 20)], { repo: 'web' });
    const r = computeBiggestCommit([api, web]);
    assert.equal(r.hash, web.hash);
    assert.equal(r.lines, 20);
    // "dist" below the root of a repo is real source.
    const deep = commit('2026-03-03T10:00:00Z', 'deep', [f('api/src/dist/z.js', 99)], { repo: 'api' });
    assert.equal(computeBiggestCommit([api, web, deep]).hash, deep.hash);
  });

  test('merge commits are skipped (by parents, or by subject without parents)', () => {
    const merge = commit('2026-03-01T10:00:00Z', 'Merge branch x', [f('src/a.js', 1000)], { parents: ['a', 'b'] });
    const mergeBySubject = { hash: 'm2', date: '2026-03-01T10:00:00Z', subject: "Merge branch 'x' into main", files: [f('src/a.js', 900)] };
    const plain = commit('2026-03-02T10:00:00Z', 'work', [f('src/a.js', 3)]);
    assert.equal(computeBiggestCommit([merge, mergeBySubject, plain]).hash, plain.hash);
    assert.equal(computeBiggestCommit([merge]), null);
  });

  test('ties: earliest date, unparseable dates last, then the later in input order (older in git order)', () => {
    const later = commit('2026-03-05T10:00:00Z', 'later', [f('a.js', 10)]);
    const earlier = commit('2026-03-05T09:00:00Z', 'earlier', [f('a.js', 5, 5)]);
    const undated = commit('nope', 'undated', [f('a.js', 10)]);
    assert.equal(computeBiggestCommit([later, undated, earlier]).subject, 'earlier');
    assert.equal(computeBiggestCommit([undated, later]).subject, 'later');
    const undated2 = commit(undefined, 'undated 2', [f('a.js', 10)]);
    const r = computeBiggestCommit([undated, undated2]);
    assert.equal(r.subject, 'undated 2');
    assert.equal(r.date, null);
    const same1 = commit('2026-03-05T10:00:00Z', 'first', [f('a.js', 10)]);
    const same2 = commit('2026-03-05T11:00:00+01:00', 'second', [f('a.js', 10)]); // same instant
    assert.equal(computeBiggestCommit([same1, same2]).subject, 'second');
    assert.equal(computeBiggestCommit([same2, same1]).subject, 'first');
  });

  test('invalid input never throws: bad counts add 0, bad files are skipped', () => {
    const c = commit('2026-03-01T10:00:00Z', undefined, [null, { path: 5, added: 9 }, f('a.js', -5, NaN), f('b.js', Infinity, 4), f('c.js', '7', 2)]);
    assert.deepEqual(computeBiggestCommit([c, null, {}, { files: 'x' }]), { hash: c.hash, subject: null, date: '2026-03-01', linesAdded: 0, linesRemoved: 6, lines: 6, files: 3 });
  });

  test('is computeStats().biggestCommit, right after messages', () => {
    const commits = [commit('2026-03-01T10:00:00Z', 'x', [f('a.js', 4)])];
    const stats = computeStats(commits, { today: TODAY });
    assert.deepEqual(stats.biggestCommit, computeBiggestCommit(commits));
    const keys = Object.keys(stats);
    assert.equal(keys.indexOf('biggestCommit'), keys.indexOf('messages') + 1);
  });
});

const HISTORY = () => [
  commit('2026-03-04T10:00:00+00:00', 'feat: the giant <refactor> & "rewrite"‮ of everything', [f('src/a.js', 12345, 678), f('package-lock.json', 99999)]),
  commit('2026-03-05T10:00:00+00:00', 'fix it', [f('src/b.js', 3, 1)]),
  commit('2026-04-05T10:00:00+00:00', 'wip oops', [f('src/b.js', 3, 1)]),
  commit('2026-04-06T10:00:00+00:00', 'fix the parser', [f('src/b.js', 3, 1)]),
];

describe('messages card', () => {
  test('shows the biggest commit (day, +/− lines, subject) without overlap, in every language and theme', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const expect = {
      en: { title: 'Biggest commit · Mar 4, 2026', value: '+12,345 / −678 lines' },
      tr: { title: 'En büyük commit · 4 Mar 2026', value: '+12.345 / −678 satır' },
    };
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of ['default', 'mono', 'neon']) {
        const { spec } = buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang, colorTheme }).find((c) => c.id === 'messages');
        assert.equal(spec.chart.kind, 'callout');
        assert.equal(spec.chart.title, expect[lang].title);
        assert.equal(spec.chart.value, expect[lang].value);
        assert.match(spec.chart.note, /^“feat: the giant <refactor>/);
        const layout = layoutCard(spec);
        assert.ok(layout.blocks.some((b) => b.kind === 'callout'), `${lang}/${colorTheme}: the panel fits`);
        const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
        for (const [i, b] of sorted.entries()) {
          assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${lang}/${colorTheme}: ${b.kind} inside the content area`);
          if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${lang}/${colorTheme}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
        }
        // The rows (longest / shortest / fix / wip / oops) are all still there.
        assert.equal(spec.lines.length, 5);
      }
    }
  });

  test('the subject is XML-escaped and stripped of bidi controls in the SVG', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const card = buildCards(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages');
    assert.match(card.svg, /&lt;refactor&gt; &amp; &quot;rewrite&quot;/);
    assert.doesNotMatch(card.svg, /<refactor>|‮/);
    assert.ok(card.svg.includes(`viewBox="0 0 1080 ${CARD_HEIGHT}"`));
    assert.match(card.description, /Biggest commit · Mar 4, 2026: \+12,345 \/ −678 lines\./);
    assert.doesNotMatch(card.description, /‮/);
  });

  test('without a biggest commit the card is exactly as before', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    // The conventional-commit mix adds a chart of its own (see commit-types.test.js).
    delete stats.commitTypes;
    const without = { ...stats };
    delete without.biggestCommit;
    for (const lang of ['en', 'tr']) {
      const a = buildCards({ ...stats, biggestCommit: null }, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages');
      const b = buildCards(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages');
      assert.equal(a.svg, b.svg);
      assert.doesNotMatch(a.svg, /Biggest|En büyük/);
      const { spec } = buildCardSpecs(without, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'messages');
      assert.equal(Object.hasOwn(spec, 'chart'), false);
    }
    // Junk biggestCommit values are ignored the same way.
    for (const junk of [{}, { linesAdded: 0, linesRemoved: 0 }, { linesAdded: NaN }, 'x']) {
      const { spec } = buildCardSpecs({ ...stats, biggestCommit: junk }, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages');
      assert.equal(Object.hasOwn(spec, 'chart'), false, JSON.stringify(junk));
    }
  });

  test('missing subject and day: a placeholder note and an undated caption', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const big = { ...stats.biggestCommit, subject: null, date: null };
    const { spec } = buildCardSpecs({ ...stats, biggestCommit: big }, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'messages');
    assert.equal(spec.chart.title, 'Biggest commit');
    assert.equal(spec.chart.note, '(no subject)');
    const invisible = buildCardSpecs({ ...stats, biggestCommit: { ...big, subject: '\u202e\x1b ' } }, { repoName: 'demo', today: TODAY, lang: 'tr' }).find((c) => c.id === 'messages');
    assert.equal(invisible.spec.chart.note, '(konu yok)');
  });
});

describe('recap', () => {
  test('a "Biggest" line with the subject, lines and day; control characters stripped', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    const out = formatSummary(stats, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Biggest {6}"feat: the giant <refactor> & "rewrite" of every…" \(\+12,345 \/ −678 lines · Mar 4, 2026\)\n/);
    assert.doesNotMatch(out, /‮/);
    const tr = formatSummary(stats, { lang: 'tr' });
    assert.match(tr, /\n {2}En büyük {9}"feat: .*" \(\+12\.345 \/ −678 satır · 4 Mar 2026\)\n/);
    // Colored output is the same text.
    assert.equal(formatSummary(stats, { color: true }).replace(/\x1b\[\d+m/g, ''), formatSummary(stats));
  });

  test('no line without a biggest commit; junk values never print null / NaN', () => {
    const stats = computeStats(HISTORY(), { today: TODAY });
    assert.doesNotMatch(formatSummary({ ...stats, biggestCommit: null }), /Biggest/);
    assert.doesNotMatch(formatSummary({ ...stats, biggestCommit: { linesAdded: 0, linesRemoved: -3 } }), /Biggest/);
    const odd = formatSummary({ ...stats, biggestCommit: { linesAdded: 5, linesRemoved: NaN, subject: '\x1b\u202e\t', date: '2026-02-31' } });
    assert.match(odd, /Biggest {6}\(no subject\) \(\+5 \/ 0 lines\)\n/);
    assert.doesNotMatch(odd, /null|undefined|NaN|\x1b/);
  });
});

// --- end to end: a real git repo, --json and --exclude ---------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

const lines = (count, tag = 'l') => Array.from({ length: count }, (_, i) => `${tag}${i}`).join('\n') + '\n';

describe('generate (end to end)', () => {
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-biggest-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    git(repo, ['config', 'core.autocrlf', 'false']);
    const who = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com' };
    const steps = [
      { date: '2025-03-01T10:00:00+00:00', msg: 'chore: lockfile', files: { 'package-lock.json': lines(500), 'src/a.js': lines(2) } },
      { date: '2025-03-02T10:00:00+00:00', msg: 'docs: guide', files: { 'docs/guide.md': lines(80) } },
      { date: '2025-03-03T10:00:00+00:00', msg: 'feat: core', files: { 'src/core.js': lines(40) } },
    ];
    for (const s of steps) {
      for (const [p, content] of Object.entries(s.files)) {
        mkdirSync(dirname(join(repo, p)), { recursive: true });
        writeFileSync(join(repo, p), content);
      }
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', s.msg], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
    }
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json has stats.biggestCommit; lockfiles never count, --exclude drops paths', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true }, { today: '2025-03-04' });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    const big = doc.stats.biggestCommit;
    assert.deepEqual(Object.keys(big), ['hash', 'subject', 'date', 'linesAdded', 'linesRemoved', 'lines', 'files']);
    assert.equal(big.subject, 'docs: guide');
    assert.equal(big.date, '2025-03-02');
    assert.equal(big.lines, 80);
    assert.match(big.hash, /^[0-9a-f]{40}$/);
    assert.deepEqual(doc.stats.biggestCommit, r.stats.biggestCommit);

    const ex = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['docs/'] }, { today: '2025-03-04' });
    const exDoc = JSON.parse(readFileSync(ex.statsJson, 'utf8'));
    assert.equal(exDoc.stats.biggestCommit.subject, 'feat: core');
    assert.equal(exDoc.stats.biggestCommit.lines, 40);
  });
});
