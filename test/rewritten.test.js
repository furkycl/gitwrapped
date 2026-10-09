import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeRewritten, computeStats as computeAllStats, isRewrittenCommit, REWRITE_GAP_MS, shownRewritten } from '../src/stats/index.js';
import { parseLog, readCommits } from '../src/git.js';
import { buildCards, buildCardSpecs, cardDescription, layoutCard, rewrittenCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The messages card's spare-room rows after the issue references (subject length, top
// words) are left out, so these tests only see the rows before the rewritten-commits row.
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
const rebased = (i, files, extra = {}) => commit(i, files, { committerDate: `${day(i)}T12:00:00+00:00`, ...extra });
const merge = (i) => commit(i, [], { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}`, committerDate: '2026-03-28T10:00:00+00:00' });

// One rewritten commit among three: the totals card has room for the row.
const roomy = () => [commit(1, [['src/a.js', 10, 1]]), rebased(2, [['src/b.js', 4, 1]]), commit(3, [['src/a.js', 5, 1]])];
// Two repos: the totals card (with its per-repo chart) has no room, the messages card does.
const twoRepos = () => [
  commit(1, [['api/src/a.js', 10, 1]], { repo: 'api' }),
  rebased(2, [['web/src/b.js', 1, 1]], { repo: 'web' }),
  commit(3, [['web/src/a.js', 5, 1]], { repo: 'web' }),
  commit(4, [['api/x.js', 5, 1]], { author: 'Bob', email: 'b@example.com', repo: 'api', born: ['api/x.js'] }),
];
const TWO = [{ label: 'api' }, { label: 'web' }];

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts));
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isRow = (r, L = en) => [L.totals.rewritten, L.totals.rewrittenLabelShort].includes(r?.label);
const rowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isRow(r, L));

describe('isRewrittenCommit', () => {
  test('committer date strictly more than an hour after the author date, as instants', () => {
    const at = (date, committerDate) => ({ date, committerDate });
    assert.equal(REWRITE_GAP_MS, 3_600_000);
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+00:00', '2026-01-01T11:00:01+00:00')), true);
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+00:00', '2026-01-01T11:00:00+00:00')), false, 'exactly an hour');
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+00:00', '2026-01-01T10:59:59+00:00')), false);
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+00:00', '2025-12-01T10:00:00+00:00')), false, 'committed before authored');
    // Same wall clock, different zones: 10:00+03:00 is 07:00Z, so 10:00Z is 3 hours later.
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+03:00', '2026-01-01T10:00:00+00:00')), true);
    // Later wall clock, but the same instant.
    assert.equal(isRewrittenCommit(at('2026-01-01T10:00:00+00:00', '2026-01-01T13:00:00+03:00')), false);
  });

  test('missing, unparseable or non-string dates, and non-objects: false, never throws', () => {
    for (const c of [null, undefined, 'x', 3, {}, { date: '2026-01-01T10:00:00Z' }, { date: '2026-01-01T10:00:00Z', committerDate: 'soon' }, { date: 5, committerDate: 7_200_001 }, { date: 'x', committerDate: '2026-01-01T10:00:00Z' }]) {
      assert.equal(isRewrittenCommit(c), false, JSON.stringify(c));
    }
  });
});

describe('computeRewritten', () => {
  test('rewritten non-merge commits and their share of every non-merge commit', () => {
    const r = computeRewritten([...roomy(), merge(4), commit(5, [], { committerDate: undefined })]);
    assert.deepEqual(r, { commits: 1, share: 0.25 });
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { commits: 1, share: 0.25 });
  });

  test('merges never count, even when rewritten; null without a non-merge commit; {0, 0} without a rewritten one', () => {
    assert.equal(computeRewritten([]), null);
    assert.equal(computeRewritten(null), null);
    assert.equal(computeRewritten([merge(1), merge(2)]), null);
    assert.deepEqual(computeRewritten([commit(1, []), merge(2)]), { commits: 0, share: 0 });
  });

  test('share: 1 only when every non-merge commit was rewritten, else at most 0.999', () => {
    assert.deepEqual(computeRewritten([rebased(1, []), rebased(2, [])]), { commits: 2, share: 1 });
    const many = Array.from({ length: 2000 }, (_, i) => (i === 0 ? commit(i, []) : rebased(i, [])));
    assert.equal(computeRewritten(many).share, 0.999);
    const few = Array.from({ length: 3000 }, (_, i) => (i === 0 ? rebased(i, []) : commit(i, [])));
    assert.equal(computeRewritten(few).share, 0);
    assert.equal(computeRewritten(few).commits, 1);
  });

  test('bad input never throws, never mutates', () => {
    const input = [null, 'x', 4, rebased(1, []), commit(2, [])];
    const copy = JSON.parse(JSON.stringify(input));
    assert.deepEqual(computeRewritten(input), { commits: 1, share: 0.5 });
    assert.deepEqual(input, copy);
  });

  test('computeStats puts rewritten right after depBumps; stats.json keeps exactly {commits, share} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('depBumps') + 1], 'rewritten');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.rewritten, { commits: 1, share: 0.333 });
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([merge(1)]), repoName: 'demo', version: '0.0.0', asOf: TODAY })).stats.rewritten, null);
  });
});

describe('shownRewritten', () => {
  test('whole commits and a percent from the exact ratio, never 100% short of all; null without one', () => {
    const r = computeRewritten(roomy());
    assert.deepEqual(shownRewritten(r), { commits: 1, pct: (1 / 3) * 100 });
    assert.deepEqual(shownRewritten({ commits: 2, share: 1 }), { commits: 2, pct: 100 });
    assert.deepEqual(shownRewritten({ commits: 2, share: 0.9999 }), { commits: 2, pct: 99.9 });
    for (const v of [null, undefined, 'x', { commits: 0, share: 0 }, { commits: -1, share: 0.5 }, { commits: NaN }]) {
      assert.equal(shownRewritten(v), null, JSON.stringify(v));
    }
  });
});

describe('parseLog', () => {
  const US = '\x1f';
  test('reads the committer date line after the subject, before the Co-authored-by values', () => {
    const rec = ['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'subject\n2025-01-02T03:04:05Z\nBob <bob@x>'].join(US);
    const [c] = parseLog(`${rec}\0`);
    assert.equal(c.subject, 'subject');
    assert.equal(c.committerDate, '2025-01-02T03:04:05+00:00');
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
    const [d] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'subject\n2025-01-02T03:04:05+03:00\n'].join(US)}\0`);
    assert.equal(d.committerDate, '2025-01-02T03:04:05+03:00');
    assert.deepEqual(d.coAuthors, []);
  });

  test('a record without the line parses as before: no committerDate, trailers kept', () => {
    const [c] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'subject\nBob <bob@x>'].join(US)}\0`);
    assert.equal('committerDate' in c, false);
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
    const [d] = parseLog(`${['h', 'A', 'a@x', '2025-01-01T00:00:00Z', '', 'subject'].join(US)}\0`);
    assert.equal('committerDate' in d, false);
    assert.equal(isRewrittenCommit(d), false);
  });
});

describe('cards', () => {
  test('a "Rewritten commits" row last on the totals card when there is room, en and tr', () => {
    const s = statsOf(roomy());
    assert.equal(rewrittenCard(s, { L: en }), 'totals');
    const spec = specOf(s, 'totals');
    assert.deepEqual(spec.lines.at(-1), { label: 'Rewritten commits', value: '1 commit · 33%', description: '1 commit was committed more than an hour after being authored: rebased, amended or cherry-picked (33% of non-merge commits)' });
    assert.equal(rowOf(specOf(s, 'messages')), undefined);
    const t = rowOf(specOf(s, 'totals', 'tr'), tr);
    assert.ok(t, 'tr row');
    assert.match(t.value, /^1( commit)? · %33$/);
    assert.match(cardDescription(specOf(s, 'totals', 'tr')), /merge dışı commit'lerin %33 kadarı/);
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
    const cases = [[roomy()], [twoRepos(), { repos: TWO }]];
    for (const [commits, opts] of cases) {
      const s = statsOf(commits, opts);
      const without = { ...s, rewritten: null };
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
    const without = svgs({ ...s, rewritten: null });
    for (const rewritten of [undefined, { commits: 0, share: 0 }, 'x', { commits: -2, share: 2 }]) {
      assert.deepEqual(svgs({ ...s, rewritten }), without, JSON.stringify(rewritten));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('"<1%" for a tiny share; shorter forms when the full one would be cut; none when even the shortest is', () => {
    const s = statsOf(roomy());
    assert.match(rowOf(specOf({ ...s, rewritten: { commits: 3, share: 0 } }, 'totals')).value, /^3( commits)? · <1%$/);
    const big = rowOf(specOf({ ...s, rewritten: { commits: 123456789, share: 0.5 } }, 'totals'));
    assert.match(big.value, /^123,456,789 · 50%$/);
    const huge = { ...s, rewritten: { commits: 123456789012345678, share: 0.5 } };
    assert.equal(rowOf(specOf(huge, 'totals')), undefined);
    assert.equal(rowOf(specOf(huge, 'messages')), undefined);
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const row = rowOf(specOf({ ...s, rewritten: { commits: 1234, share: 0.42 } }, 'totals', lang), L);
      assert.ok(row, lang);
    }
  });

  test('empty history: no row anywhere', () => {
    const s = { ...statsOf([]), rewritten: { commits: 4, share: 0.5 } };
    for (const c of specs(s)) assert.equal(rowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the dependency bumps, en and tr; none without a rewritten commit', () => {
    const s = statsOf([...roomy(), commit(9, [['package.json', 1, 0]])]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Dep bumps.*\n {2}Rewritten {4}1 commit \(25% of non-merge commits\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Yeniden yazılmış\s+1 commit \(merge dışı commit'lerin %25 kadarı\)\n/);
    for (const rewritten of [null, { commits: 0, share: 0 }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, rewritten }, { repoName: 'demo', today: TODAY }), /Rewritten/);
    }
  });

  test('wrapped.md section after the dependency bumps, en and tr; none without a rewritten commit', () => {
    const s = statsOf([...roomy(), commit(9, [['package.json', 1, 0]])]);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /Dependency bumps[\s\S]*## Rewritten commits\n\n1 commit \\\(25% of non-merge commits\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Yeniden yazılan commit'ler\n\n1 commit \\\(merge dışı commit'lerin %25 kadarı\\\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, rewritten: { commits: 0, share: 0 } }, { repoName: 'demo', today: TODAY }), /Rewritten commits/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      for (const k of ['rewritten', 'rewrittenLabelShort']) assert.equal(typeof L.totals[k], 'string', k);
      for (const k of ['rewrittenValue', 'rewrittenShort', 'rewrittenDescription']) assert.equal(typeof L.totals[k](3, '5%'), 'string', k);
      assert.equal(typeof L.recap.rewritten, 'string');
      assert.ok(L.recap.rewritten.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.rewritten, 'string');
    }
  });
});

describe('git (real repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  let dir;
  let out;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'gw-rewritten-'));
    out = mkdtempSync(join(tmpdir(), 'gw-rewritten-out-'));
    git(dir, ['init', '-q', '-b', 'main']);
    const steps = [
      ['a.txt', '2026-03-01T10:00:00+00:00', '2026-03-01T10:00:00+00:00'],
      // Committed 2 hours after it was written (an amend or rebase).
      ['b.txt', '2026-03-02T10:00:00+00:00', '2026-03-02T12:00:00+00:00'],
      // Exactly an hour later: not rewritten.
      ['c.txt', '2026-03-03T10:00:00+00:00', '2026-03-03T11:00:00+00:00'],
      // Different zones, same wall clock: committed 3 hours later.
      ['d.txt', '2026-03-04T10:00:00+03:00', '2026-03-04T10:00:00+00:00'],
    ];
    for (const [file, author, committer] of steps) {
      writeFileSync(join(dir, file), `${file}\n`);
      git(dir, ['add', file]);
      git(dir, ['commit', '-q', '-m', `add ${file}`], { GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer });
    }
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  test('readCommits reads committer dates; two of four commits are rewritten', async () => {
    const res = await readCommits(dir);
    const commits = res.commits ?? res;
    assert.equal(commits.length, 4);
    for (const c of commits) assert.match(c.committerDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.deepEqual(computeRewritten(commits), { commits: 2, share: 0.5 });
  });

  test('generate: stats.json, recap and wrapped.md', async () => {
    const r = await generate({ path: dir, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.rewritten, { commits: 2, share: 0.5 });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Rewritten commits\n\n2 commits \\\(50% of non-merge commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'demo', today: TODAY }), /Rewritten\s+2 commits \(50% of non-merge commits\)/);
  });
});
