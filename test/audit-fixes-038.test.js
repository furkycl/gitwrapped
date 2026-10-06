// Regression tests for the loop-038 audit fixes (pre-1.3.0): multi-repo --exclude patterns
// that start with a wildcard never match the repo label, "**" inside a segment is a plain
// "*", the months card's went-quiet eyebrow uses the activity card's 30-day test, biggest
// commit ties on the same instant go to the older commit, --help names the biggest commit
// under --exclude, and the months card's tick labels never crowd each other.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compileExcludes, compileGlob } from '../src/glob.js';
import { excludeFiles } from '../src/stats/files.js';
import { computeBiggestCommit, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, MAX_SHOWN_MONTHS, measureText } from '../src/cards/index.js';
import { generate, HELP_TEXT } from '../src/cli.js';

const TODAY = '2026-10-06';
const yes = (p, path) => assert.equal(compileGlob(p)(path), true, `${p} should match ${path}`);
const no = (p, path) => assert.equal(compileGlob(p)(path), false, `${p} should not match ${path}`);

const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete GIT_ENV[k];
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const who = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };

/** Steps: {date, files: {path: content}, msg?}, oldest first. */
function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  for (const [i, s] of steps.entries()) {
    for (const [p, content] of Object.entries(s.files ?? {})) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', s.msg ?? `feat: step ${i}`], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
  return dir;
}

const lines = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n') + '\n';

describe('multi-repo --exclude: a pattern starting with a wildcard never matches the repo label', () => {
  test('compileGlob: label is true only for path patterns whose first segment is literal', () => {
    for (const p of ['*/generated/', '*/*', '**/x.js', '?pi/src/', 'a*/src', '**', '*', 'docs', 'api*', '*.min.js']) {
      assert.equal(compileGlob(p).label, false, p);
    }
    for (const p of ['api/src/**', 'api/src/', '/web', '/api/docs', 'web/docs/', 'api/*.js', 'api/**/x.js']) {
      assert.equal(compileGlob(p).label, true, p);
    }
  });

  test('compileExcludes {labelled: true}: wildcard-first patterns are not tried against the label', () => {
    const lab = { labelled: true };
    const gen = compileExcludes(['*/generated/']);
    assert.equal(gen('app/generated/b.js', lab), false, 'a repo-root generated/ is not one level deep');
    assert.equal(gen('pkg/generated/a.js'), true, 'repo-relative: still matches one level deep');
    const star = compileExcludes(['*/*']);
    assert.equal(star('app/README.md', lab), false, 'a root file of repo "app" is not "*/*"');
    assert.equal(star('src/a.js'), true);
    assert.equal(star('README.md'), false);
    const deep = compileExcludes(['**/x.js']);
    assert.equal(deep('app/lib/y.js', lab), false);
    // Literal-label patterns still target that repo.
    const api = compileExcludes(['api/src/**']);
    assert.equal(api('api/src/x.js', lab), true);
    assert.equal(api('web/src/x.js', lab), false);
    assert.equal(compileExcludes(['/web'])('web/src/x.js', lab), true);
    assert.equal(compileExcludes(['/web'])('api/src/x.js', lab), false);
    // Name patterns still never match a label.
    assert.equal(compileExcludes(['app'])('app/src/x.js', lab), false);
  });

  test('excludeFiles: "*/generated/" drops the same files per repo as in a single-repo run', () => {
    const mk = (repo, paths) => ({ hash: repo, repo, files: paths.map((p) => ({ path: `${repo}/${p}`, added: 1, removed: 0 })) });
    const app = mk('app', ['generated/b.js', 'pkg/generated/a.js', 'src/c.js']);
    const out = excludeFiles([app], compileExcludes(['*/generated/']));
    assert.deepEqual(out[0].files.map((f) => f.path), ['app/generated/b.js', 'app/src/c.js']);
    const all = excludeFiles([app], compileExcludes(['*/*']));
    // "*/*" in a single repo: every file inside a directory, root files kept (none here).
    assert.deepEqual(all[0].files, []);
    const root = mk('web', ['README.md', 'src/x.js']);
    assert.deepEqual(excludeFiles([root], compileExcludes(['*/*']))[0].files.map((f) => f.path), ['web/README.md']);
    // A literal-label pattern hits only its repo.
    const both = excludeFiles([app, root], compileExcludes(['app/src/**']));
    assert.deepEqual(both[0].files.map((f) => f.path), ['app/generated/b.js', 'app/pkg/generated/a.js']);
    assert.equal(both[1], root);
  });

  describe('end to end with two fixture repos', () => {
    let root;
    let app;
    let web;
    before(() => {
      root = mkdtempSync(join(tmpdir(), 'gw038-ex-'));
      app = makeRepo(join(root, 'app'), [
        { date: '2025-03-01T10:00:00+00:00', files: { 'README.md': lines(3), 'generated/b.js': lines(5), 'pkg/generated/a.js': lines(7), 'src/c.js': lines(11) } },
      ]);
      web = makeRepo(join(root, 'web'), [
        { date: '2025-03-02T10:00:00+00:00', files: { 'index.html': lines(2), 'generated/x.js': lines(13), 'ui/generated/y.js': lines(17), 'ui/z.js': lines(19) } },
      ]);
    });
    after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

    for (const pattern of ['*/generated/', '*/*', '**/x.js']) {
      test(`"${pattern}": per-repo files and lines equal single-repo runs`, async () => {
        const multi = await generate({ paths: [app, web], out: join(root, `m-${pattern.replace(/\W/g, '_')}`), png: false, exclude: [pattern] }, { today: TODAY });
        const byName = Object.fromEntries(multi.stats.repos.map((x) => [x.name, x]));
        for (const [name, dir] of [['app', app], ['web', web]]) {
          const single = await generate({ path: dir, out: join(root, `s-${name}-${pattern.replace(/\W/g, '_')}`), png: false, exclude: [pattern] }, { today: TODAY });
          assert.equal(byName[name].filesTouched, single.stats.totals.filesTouched, `${name} filesTouched`);
          assert.equal(byName[name].linesAdded, single.stats.totals.linesAdded, `${name} linesAdded`);
        }
      });
    }

    test('"*/generated/" keeps each repo\'s root generated/ (exact counts)', async () => {
      const r = await generate({ paths: [app, web], out: join(root, 'exact'), png: false, exclude: ['*/generated/'] }, { today: TODAY });
      const byName = Object.fromEntries(r.stats.repos.map((x) => [x.name, x]));
      assert.equal(byName.app.filesTouched, 3);
      assert.equal(byName.app.linesAdded, 3 + 5 + 11);
      assert.equal(byName.web.filesTouched, 3);
      assert.equal(byName.web.linesAdded, 2 + 13 + 19);
    });

    test('"app/src/**" and "/web" still target one repo', async () => {
      const r = await generate({ paths: [app, web], out: join(root, 'lit'), png: false, exclude: ['app/src/**', '/web'] }, { today: TODAY });
      const byName = Object.fromEntries(r.stats.repos.map((x) => [x.name, x]));
      assert.equal(byName.app.filesTouched, 3);
      assert.equal(byName.app.linesAdded, 3 + 5 + 7);
      assert.equal(byName.web.filesTouched, 0);
      assert.equal(byName.web.linesAdded, 0);
      assert.equal(byName.web.commits, 1);
    });
  });
});

describe('glob: "**" that is not a whole segment is a plain "*"', () => {
  test('src**.js stays within one segment', () => {
    no('src**.js', 'src/app/x.js');
    no('src**.js', 'src/x.js');
    yes('src**.js', 'srcfoo.js');
    yes('src**.js', 'src.js');
    yes('src**.js', 'lib/srcfoo.js');
    for (const p of ['srcfoo.js', 'src/app/x.js', 'a/srcb.js']) assert.equal(compileGlob('src**.js')(p), compileGlob('src*.js')(p), p);
  });

  test('test** behaves like test*', () => {
    for (const p of ['test', 'tests', 'test/a.js', 'testdata/x/y.js', 'a/tests/b.js', 'atest', 'te', 'x/testy']) {
      assert.equal(compileGlob('test**')(p), compileGlob('test*')(p), p);
    }
    no('test**', 'atest/x');
    yes('test**', 'testing/a/b.js');
  });

  test('**x and a**b inside a segment are plain stars too', () => {
    for (const p of ['foo.js', 'a/b/foo.js', 'a/b.js']) assert.equal(compileGlob('**.js')(p), compileGlob('*.js')(p), p);
    yes('a/b**c', 'a/bxc');
    no('a/b**c', 'a/bx/c');
  });

  test('whole-segment "**" is unchanged', () => {
    yes('docs/**', 'docs/a/b.md');
    yes('docs/**', 'docs/x');
    no('docs/**', 'docs');
    no('docs/**', 'src/docs/x');
    yes('**/x.js', 'x.js');
    yes('**/x.js', 'a/b/x.js');
    no('**/x.js', 'a/bx.js');
    yes('a/**/b', 'a/b');
    yes('a/**/b', 'a/x/y/b');
    yes('a/**/b', 'a/x/b/c.js');
    no('a/**/b', 'z/a/b');
    yes('**', 'x/y/z');
  });
});

describe('months card: went-quiet eyebrow uses the 30-day test', () => {
  const c = (date) => ({ hash: `h${date}${Math.random()}`, date, subject: 'feat: x', author: 'Ada', email: 'a@x', files: [{ path: 'src/a.js', added: 1, removed: 0 }] });
  // One commit on the 2nd of every month from Jan 2024 to `last`'s month, then one on `last` 
  // ('YYYY-MM-DD'): longer than MAX_SHOWN_MONTHS, so the timeline is clipped.
  function history(last) {
    const [y, m] = last.split('-').map(Number);
    const out = [];
    for (let idx = 2024 * 12; idx < y * 12 + m - 1; idx++) out.push(c(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-02T12:00:00+00:00`));
    out.push(c(`${last}T12:00:00+00:00`));
    return out;
  }
  const spec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'months')?.spec;
  const activity = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((x) => x.id === 'activity')?.spec;

  test('last commit in the previous month but < 30 days ago: "your last N months"', () => {
    const s = computeStats(history('2026-09-20'), { today: TODAY });
    assert.ok(s.months.months.length > MAX_SHOWN_MONTHS);
    assert.equal(spec(s).eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
    assert.equal(spec(s, { lang: 'tr' }).eyebrow, `Son ${MAX_SHOWN_MONTHS} ay`);
    // Exactly 30 days before is not quiet yet.
    assert.equal(spec(s, { today: '2026-10-20' }).eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
  });

  test('last commit > 30 days ago: names its last month', () => {
    const s = computeStats(history('2026-09-02'), { today: TODAY });
    assert.equal(spec(s).eyebrow, `${MAX_SHOWN_MONTHS} months to Sep 2026`);
    assert.equal(spec(s, { lang: 'tr' }).eyebrow, `Eyl 2026 itibarıyla ${MAX_SHOWN_MONTHS} ay`);
    // 31 days after Sep 20 → quiet.
    const s2 = computeStats(history('2026-09-20'), { today: '2026-10-21' });
    assert.equal(spec(s2, { today: '2026-10-21' }).eyebrow, `${MAX_SHOWN_MONTHS} months to Sep 2026`);
  });

  test('agrees with the activity card on whether the repo went quiet', () => {
    for (const [last, today] of [['2026-09-20', TODAY], ['2026-09-02', TODAY], ['2026-09-20', '2026-10-20'], ['2026-09-20', '2026-10-21']]) {
      const s = computeStats(history(last), { today });
      const quietMonths = !/^Your last/.test(spec(s, { today }).eyebrow);
      const a = activity(s, { today });
      assert.ok(a, 'activity card exists');
      const quietActivity = a.eyebrow !== activity(s, { today: last }).eyebrow;
      assert.equal(quietMonths, quietActivity, `${last} as of ${today}`);
    }
  });

  test('a past --until window: "as of" is the until day', () => {
    const s = computeStats(history('2026-09-02'), { today: TODAY });
    assert.equal(spec(s, { since: '2024-01-01', until: '2026-09-15' }).eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
  });

  test('without stats.daily the month\'s last day counts as its last active day', () => {
    const months = [];
    for (let idx = 2024 * 12; idx <= 2026 * 12 + 8; idx++) months.push({ month: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, commits: 1 });
    const s = { ...computeStats(history('2026-09-02'), { today: TODAY }), daily: undefined, months: { months, peak: months[0] } };
    // Sep 30 → Oct 6 is 6 days: not quiet; Oct 31 → 31 days: quiet.
    assert.equal(spec(s).eyebrow, `Your last ${MAX_SHOWN_MONTHS} months`);
    assert.equal(spec(s, { today: '2026-10-31' }).eyebrow, `${MAX_SHOWN_MONTHS} months to Sep 2026`);
  });
});

describe('biggest commit: same lines and same instant → the older commit in git order', () => {
  const f = (path, added, removed = 0) => ({ path, added, removed, binary: false });
  const commit = (hash, date, subject, files) => ({ hash, author: 'A', email: 'a@x', date, subject, parents: ['p'], files });

  test('pure: the later one in input (newest-first) order wins', () => {
    const newer = commit('n', '2026-03-05T10:00:00Z', 'newer', [f('a.js', 10)]);
    const older = commit('o', '2026-03-05T10:00:00Z', 'older', [f('b.js', 7, 3)]);
    assert.equal(computeBiggestCommit([newer, older]).hash, 'o');
    assert.equal(computeBiggestCommit([newer, older]).subject, 'older');
    // Three on the same instant: the last.
    const oldest = commit('x', '2026-03-05T11:00:00+01:00', 'oldest', [f('c.js', 10)]);
    assert.equal(computeBiggestCommit([newer, older, oldest]).subject, 'oldest');
    // More lines still beats the tie-break; an earlier instant still beats input order.
    const bigger = commit('b', '2026-03-05T10:00:00Z', 'bigger', [f('a.js', 11)]);
    assert.equal(computeBiggestCommit([bigger, newer, older]).subject, 'bigger');
    const earlier = commit('e', '2026-03-05T09:00:00Z', 'earlier', [f('a.js', 10)]);
    assert.equal(computeBiggestCommit([earlier, newer, older]).subject, 'earlier');
    assert.equal(computeBiggestCommit([newer, older, earlier]).subject, 'earlier');
  });

  test('end to end: two equal commits with the same timestamp → the first one made', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'gw038-big-'));
    t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
    const date = '2026-03-05T10:00:00+00:00';
    const repo = makeRepo(join(root, 'app'), [
      { date: '2026-03-01T10:00:00+00:00', msg: 'chore: tiny', files: { 'x.txt': lines(1) } },
      { date, msg: 'feat: first', files: { 'a.js': lines(20) } },
      { date, msg: 'feat: second', files: { 'b.js': lines(20) } },
    ]);
    const r = await generate({ path: repo, out: join(root, 'out'), png: false }, { today: TODAY });
    assert.equal(r.stats.biggestCommit.subject, 'feat: first');
    assert.equal(r.stats.biggestCommit.lines, 20);
  });
});

describe('--help: --exclude mentions the biggest commit', () => {
  test('the --exclude entry lists the biggest commit among what it filters', () => {
    const start = HELP_TEXT.indexOf('--exclude');
    assert.ok(start >= 0);
    const end = HELP_TEXT.indexOf('\n  --', start + 1);
    const entry = HELP_TEXT.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
    assert.match(entry, /biggest commit/);
    assert.match(entry, /commits still count/);
  });
});

describe('months card tick labels never crowd each other (9–22 months)', () => {
  const c = (date) => ({ hash: `h${date}${Math.random()}`, date, subject: 'feat: x', author: 'Ada', email: 'a@x', files: [{ path: 'src/a.js', added: 1, removed: 0 }] });
  const FAR = '2035-01-01';
  const TICK_RE = /<text x="([\d.]+)" y="([\d.]+)" font-size="30" font-weight="700" fill-opacity="0.75" text-anchor="middle">([^<]*)<\/text>/g;
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  for (const lang of ['en', 'tr']) {
    test(`${lang}: adjacent tick slots are >= 100px apart and the rendered labels do not overlap`, () => {
      for (let n = 9; n <= 22; n++) {
        for (let startMonth = 1; startMonth <= 12; startMonth++) {
          const commits = [];
          for (let i = 0; i < n; i++) {
            const idx = 2030 * 12 + startMonth - 1 + i;
            commits.push(c(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-10T12:00:00+00:00`));
          }
          const s = computeStats(commits, { today: FAR });
          const opts = { repoName: 'demo', today: FAR, lang };
          const spec = buildCardSpecs(s, opts).find((x) => x.id === 'months').spec;
          assert.equal(spec.chart.labels.length, n);
          const want = spec.chart.labels.filter((l) => l);
          const svg = buildCards(s, opts).find((x) => x.id === 'months').svg;
          const idx = spec.chart.labels.flatMap((l, i) => (l ? [i] : []));
          const ticks = [...svg.matchAll(TICK_RE)].map((m, k) => ({ x: Number(m[1]), y: m[2], t: unescape(m[3]), i: idx[k] }));
          const label = `n=${n} start=${startMonth} ${lang}`;
          assert.deepEqual(ticks.map((k) => k.t), want, label);
          for (let i = 1; i < ticks.length; i++) {
            const a = ticks[i - 1];
            const b = ticks[i];
            // Slot centres (before the edge clamp keeps a label inside the content area)
            // are at least 100px apart.
            assert.ok((b.i - a.i) * (888 / n) >= 100, `${label}: "${a.t}" and "${b.t}" slots closer than 100px`);
            // Heavy-weight width estimate (measureText × 1.02, as the renderer uses).
            const half = (measureText(a.t, 30) * 1.02 + measureText(b.t, 30) * 1.02) / 2;
            assert.ok(b.x - a.x - half >= 8, `${label}: "${a.t}"@${a.x} and "${b.t}"@${b.x} overlap (gap ${b.x - a.x - half})`);
          }
        }
      }
    });
  }
});
