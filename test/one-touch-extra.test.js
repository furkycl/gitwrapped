// Edge cases for stats.oneTouch (src/stats/onetouch.js): a brute-force reference on random
// histories (merges, repo labels, ignored paths, duplicates, malformed files), hot files
// unchanged by the fileTouches refactor, the hot-files card row (tiny history vs no room,
// en / tr), recap and wrapped.md, and the CLI on real git repos (--json, --exclude, merges,
// multi-repo, --since / --until, lockfiles, --lang tr, the null case).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHotFiles, computeOneTouch, computeStats, fileTouches, isIgnoredPath, repoRelativePath, shownOneTouch } from '../src/stats/index.js';
import { excludeFiles } from '../src/stats/files.js';
import { scrubEmails } from '../src/privacy.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, oneTouchShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(6, '0')}cdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map((f) => (typeof f === 'string' ? { path: f, added: 2, removed: 1 } : f)),
  parents: ['p'],
  ...extra,
});
const merge = (i, files = []) => commit(i, files, { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` });
const plain = (o) => (o ? { ...o } : o);
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const hotSpec = (s, lang = 'en') => buildCardSpecs(s, cardOpts(lang)).find((c) => c.id === 'hot-files')?.spec;
const rowOf = (spec, L = en) => (spec?.lines ?? []).find((r) => [L.hotFiles.oneTouch, L.hotFiles.oneTouchLabelShort].includes(r?.label));

/** Independent reference: distinct counted paths; files touched by exactly 1 non-merge commit. */
function reference(commits) {
  const touches = new Map();
  for (const c of commits) {
    if (!c || typeof c !== 'object') continue;
    const isMerge = (Array.isArray(c.parents) && c.parents.length > 1) || /^Merge /.test(c.subject ?? '');
    if (isMerge) continue;
    const paths = new Set();
    for (const f of Array.isArray(c.files) ? c.files : []) {
      if (!f || typeof f.path !== 'string') continue;
      if (isIgnoredPath(repoRelativePath(c, f.path))) continue;
      paths.add(f.path);
    }
    for (const p of paths) touches.set(p, (touches.get(p) ?? 0) + 1);
  }
  if (touches.size === 0) return null;
  const once = [...touches.values()].filter((n) => n === 1).length;
  const total = touches.size;
  let share = Math.round((once / total) * 1000) / 1000;
  if (once < total && share > 0.999) share = 0.999;
  return { files: once, share };
}

/** computeHotFiles as it was before the fileTouches refactor (HEAD), for comparison. */
function oldHotFiles(commits, { limit = 5 } = {}) {
  const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  const byPath = new Map();
  for (const c of commits ?? []) {
    const seen = new Set();
    for (const f of c.files ?? []) {
      if (!f || typeof f.path !== 'string' || isIgnoredPath(repoRelativePath(c, f.path))) continue;
      let entry = byPath.get(f.path);
      if (!entry) {
        entry = { path: f.path, commits: 0, linesAdded: 0, linesRemoved: 0 };
        byPath.set(f.path, entry);
      }
      if (!seen.has(f.path)) {
        seen.add(f.path);
        entry.commits += 1;
      }
      entry.linesAdded += count(f.added);
      entry.linesRemoved += count(f.removed);
    }
  }
  return [...byPath.values()]
    .sort((a, b) => b.commits - a.commits || b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit)
    .map((e) => ({ ...e, path: scrubEmails(e.path) }));
}

/** mulberry32: a small seeded PRNG (integer-exact, unlike a float LCG); rand(n) in [0, n). */
function rng(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return n > 0 ? Math.floor(r * n) : 0;
  };
}

function randomHistory(rand, round) {
  const pool = ['src/a.js', 'src/b.js', 'lib/c.ts', 'README.md', 'package-lock.json', 'dist/x.js', 'docs/d.md', 'keys/ada@example.com.pub', 'vendor/v.go', 'web/app.min.js', 'yarn.lock', 'a.snap', 'src/__snapshots__/s.snap'];
  const repos = round % 3 === 0 ? ['api', 'web'] : [null];
  return Array.from({ length: rand(15) }, (_, i) => {
    const repo = repos[rand(repos.length)];
    const files = Array.from({ length: rand(5) }, () => {
      const k = rand(20);
      if (k === 0) return null;
      if (k === 1) return { path: 7 };
      const p = pool[rand(pool.length)];
      return { path: repo ? `${repo}/${p}` : p, added: rand(30) - 2, removed: k === 2 ? NaN : rand(10) };
    });
    const extra = repo ? { repo } : {};
    const kind = rand(8);
    if (kind === 0) return { ...merge(i + 1), files, ...extra }; // a merge with files: never counted
    if (kind === 1) return { ...commit(i + 1, []), parents: undefined, subject: "Merge pull request #3 from x/y", files, ...extra };
    return { ...commit(i + 1, []), files, ...extra };
  });
}

describe('computeOneTouch: brute force', () => {
  test('matches an independent reference on 400 random histories (merges, repos, ignored, malformed)', () => {
    const rand = rng(20261009);
    let nulls = 0;
    let zeros = 0;
    let some = 0;
    for (let round = 0; round < 400; round++) {
      const commits = randomHistory(rand, round);
      const snapshot = JSON.stringify(commits);
      const got = computeOneTouch(commits);
      const want = reference(commits);
      assert.deepEqual(plain(got), want, `round ${round}`);
      if (got) {
        assert.deepEqual(Object.keys(got), ['files', 'share']);
        assert.ok(got.files <= fileTouches(commits).size);
        const shown = shownOneTouch(got);
        if (got.files === 0) assert.equal(shown, null);
        else assert.equal(shown.files, got.files);
      }
      assert.equal(JSON.stringify(commits), snapshot, 'never mutates');
      if (want === null) nulls += 1;
      else if (want.files === 0) zeros += 1;
      else some += 1;
    }
    assert.ok(nulls > 0 && zeros > 0 && some > 0, `coverage ${nulls}/${zeros}/${some}`);
  });

  test('order of commits and of files within a commit never matters', () => {
    const commits = [commit(1, ['a.js', 'b.js']), commit(2, ['b.js', 'c.js', 'b.js']), commit(3, ['d.js']), merge(4, ['d.js'])];
    const want = plain(computeOneTouch(commits));
    assert.deepEqual(want, { files: 3, share: 0.75 });
    assert.deepEqual(plain(computeOneTouch([...commits].reverse())), want);
    assert.deepEqual(plain(computeOneTouch(commits.map((c) => ({ ...c, files: [...c.files].reverse() })))), want);
  });

  test('paths are case-sensitive and exact (no normalisation of "./" or trailing spaces)', () => {
    assert.deepEqual(plain(computeOneTouch([commit(1, ['A.js']), commit(2, ['a.js'])])), { files: 2, share: 1 });
    assert.deepEqual(plain(computeOneTouch([commit(1, ['a.js']), commit(2, ['a.js '])])), { files: 2, share: 1 });
  });

  test('a file touched only in merges (and once outside) is one-touch; touched only in merges is not a file', () => {
    assert.deepEqual(plain(computeOneTouch([commit(1, ['a.js']), merge(2, ['a.js']), merge(3, ['a.js'])])), { files: 1, share: 1 });
    assert.equal(computeOneTouch([merge(1, ['a.js']), merge(2, ['b.js'])]), null);
  });

  test('a repo label that is only a prefix match is still checked at the right root', () => {
    // repo "api": "api/dist/x.js" is ignored (dist/ at the api root), "apix/dist/x.js" is not repo-relative.
    const commits = [commit(1, ['api/dist/x.js', 'api/src/a.js'], { repo: 'api' }), commit(2, ['web/src/a.js'], { repo: 'web' })];
    assert.deepEqual(plain(computeOneTouch(commits)), { files: 2, share: 1 });
  });

  test('--exclude with a repo-labelled glob in a multi-repo run', () => {
    const commits = [commit(1, ['api/README.md', 'api/src/a.js'], { repo: 'api' }), commit(2, ['web/README.md'], { repo: 'web' }), commit(3, ['web/README.md'], { repo: 'web' })];
    assert.deepEqual(plain(computeOneTouch(commits)), { files: 2, share: 0.667 });
    // "README.md" matches at any depth: both repos lose it.
    assert.deepEqual(plain(computeOneTouch(excludeFiles(commits, compileExcludes(['README.md'])))), { files: 1, share: 1 });
  });
});

describe('hot files: unchanged by the fileTouches refactor', () => {
  test('computeHotFiles equals the pre-refactor implementation on random histories, any limit', () => {
    const rand = rng(99);
    for (let round = 0; round < 300; round++) {
      const commits = randomHistory(rand, round);
      for (const limit of [0, 1, 5, 1000]) {
        assert.deepEqual(computeHotFiles(commits, { limit }), oldHotFiles(commits, { limit }), `round ${round} limit ${limit}`);
      }
      assert.deepEqual(computeHotFiles(commits), oldHotFiles(commits));
    }
  });

  test('limit validation still throws; null/undefined commits still give []', () => {
    for (const limit of [-1, 1.5, '3', NaN]) assert.throws(() => computeHotFiles([], { limit }), TypeError);
    assert.deepEqual(computeHotFiles(null), []);
    assert.deepEqual(computeHotFiles(undefined), []);
  });

  test('fileTouches: first-seen order, unscrubbed paths, returns a Map', () => {
    const m = fileTouches([commit(1, ['z.js', 'keys/ada@example.com.pub']), commit(2, ['a.js', 'z.js'])]);
    assert.ok(m instanceof Map);
    assert.deepEqual([...m.keys()], ['z.js', 'keys/ada@example.com.pub', 'a.js']);
    assert.equal(m.get('z.js').commits, 2);
    for (const bad of [null, undefined, 3, 'x', {}, [null, 1, 'x']]) assert.equal(fileTouches(bad).size, 0);
  });
});

describe('cards / recap / wrapped.md: extra', () => {
  test('tiny history: the row is on the hot-files card SVG (en and tr)', () => {
    const s = statsOf([commit(1, ['src/a.js']), commit(2, ['src/a.js', 'src/b.js'])]);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const row = rowOf(hotSpec(s, lang), L);
      assert.ok(row, lang);
      const svg = buildCards(s, cardOpts(lang)).find((c) => c.id === 'hot-files').svg;
      assert.ok(svg.includes(L.hotFiles.oneTouch.replace(/'/g, '&#39;')) || svg.includes(L.hotFiles.oneTouch.replace(/'/g, '&apos;')) || svg.includes(L.hotFiles.oneTouch), lang);
    }
  });

  test('a crowded hot-files card has no row in either language, and the SVGs are byte-identical', () => {
    const crowded = Array.from({ length: 12 }, (_, i) => commit(i + 1, ['src/a.js', `lib/f${i}.js`, 'test/x.test.js', 'README.md']));
    const s = statsOf(crowded);
    assert.ok(s.oneTouch.files > 0);
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      assert.equal(rowOf(hotSpec(s, lang), L), undefined, lang);
      assert.deepEqual(buildCards(s, cardOpts(lang)).map((c) => c.svg), buildCards({ ...s, oneTouch: null }, cardOpts(lang)).map((c) => c.svg), lang);
    }
  });

  test('cards byte-identical with oneTouch null vs the key missing', () => {
    const s = statsOf([commit(1, ['src/a.js']), commit(2, ['src/a.js', 'src/b.js'])]);
    const { oneTouch, ...noKey } = s;
    assert.ok(oneTouch);
    for (const lang of ['en', 'tr']) {
      assert.deepEqual(buildCards({ ...s, oneTouch: null }, cardOpts(lang)).map((c) => c.svg), buildCards(noKey, cardOpts(lang)).map((c) => c.svg));
    }
    assert.doesNotMatch(formatSummary(noKey, { repoName: 'demo', today: TODAY }), /One-touch/);
    assert.doesNotMatch(buildMarkdown(noKey, { repoName: 'demo', today: TODAY }), /One-touch/);
  });

  test('after a JSON round trip (no exact ratio) the outputs use the rounded share and agree', () => {
    const files = ['a.js', 'b.js', 'c.js'];
    const s = statsOf([commit(1, files), commit(2, ['a.js'])]); // 2/3
    const json = JSON.parse(JSON.stringify(s.oneTouch));
    assert.deepEqual(json, { files: 2, share: 0.667 });
    assert.equal(oneTouchShareText(shownOneTouch(s.oneTouch)), '67%');
    assert.equal(oneTouchShareText(shownOneTouch(json)), '67%');
    // 0.9995 exact would show "99.95" -> must never read 100%.
    assert.notEqual(oneTouchShareText(shownOneTouch({ files: 1999, share: 0.999 })), '100%');
  });

  test('share text: <1% for a nonzero tiny exact ratio, 100% only when every file is one-touch', () => {
    const files = Array.from({ length: 1500 }, (_, i) => `f${i}.js`);
    const s = computeOneTouch([commit(1, files), commit(2, files), commit(3, ['solo.js'])]);
    assert.deepEqual(plain(s), { files: 1, share: 0.001 });
    assert.equal(oneTouchShareText(shownOneTouch(s)), '<1%');
    assert.equal(oneTouchShareText(shownOneTouch(computeOneTouch([commit(1, ['a.js', 'b.js'])]))), '100%');
    const almost = computeOneTouch([commit(1, files), commit(2, ['f0.js'])]);
    assert.equal(oneTouchShareText(shownOneTouch(almost)), '99%');
  });

  test('recap and wrapped.md: plural/singular and tr wording; nothing for an empty history', () => {
    const s = statsOf([commit(1, ['a.js', 'b.js', 'c.js']), commit(2, ['a.js'])]);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY }), /One-touch\s+2 files \(67% of changed files\)/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /Tek commit'lik\s+2 dosya \(değişen dosyaların %67 kadarı\)/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY }), /- \*\*One-touch files:\*\* 2 files \\\(67% of changed files\\\)/);
    const empty = statsOf([]);
    assert.equal(empty.oneTouch, null);
    assert.doesNotMatch(formatSummary(empty, { repoName: 'demo', today: TODAY }), /One-touch/);
    assert.doesNotMatch(buildMarkdown(empty, { repoName: 'demo', today: TODAY }), /One-touch/);
    assert.equal(JSON.parse(buildStatsJson({ stats: empty, repoName: 'demo' })).stats.oneTouch, null);
  });

  test('a huge count never produces NaN/undefined in any card, either language', () => {
    const s = { ...statsOf([commit(1, ['src/a.js']), commit(2, ['src/a.js', 'src/b.js'])]), oneTouch: { files: 9_876_543, share: 0.4321 } };
    for (const lang of ['en', 'tr']) {
      for (const c of buildCards(s, cardOpts(lang))) assert.doesNotMatch(c.svg, /NaN|Infinity|undefined/, `${lang} ${c.id}`);
    }
  });
});

describe('one-touch: CLI on real git repos', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const init = (name) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };
  const commitAll = (dir, msg, day) => {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', msg], at(day));
  };
  const statsJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
  const run = (args, name) => {
    const out = join(tmp, `${name}-out`);
    const r = bin([...args, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return { r, out, doc: statsJson(out), md: readFileSync(join(out, 'wrapped.md'), 'utf8') };
  };

  let tmp;
  let main;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-one-touch-extra-'));
    main = init('main');
    // Feb: x.js twice, old.js once.
    write(main, 'src/x.js', 'x1\n');
    write(main, 'src/old.js', 'o\n');
    commitAll(main, 'feat: feb 1', '2026-02-02');
    write(main, 'src/x.js', 'x2\n');
    commitAll(main, 'feat: feb 2', '2026-02-10');
    // Mar: a.js three times, b.js once, lockfile + dist every time (ignored), docs/g.md once.
    for (const [i, day] of ['2026-03-02', '2026-03-03', '2026-03-04'].entries()) {
      write(main, 'src/a.js', `a${i}\n`);
      write(main, 'yarn.lock', `l${i}\n`);
      write(main, 'dist/bundle.js', `d${i}\n`);
      if (i === 1) write(main, 'src/b.js', 'b\n');
      if (i === 2) write(main, 'docs/g.md', 'g\n');
      commitAll(main, `feat: mar ${i}`, day);
    }
    // A side branch touching side.js once and a.js, merged with --no-ff (the merge is skipped).
    git(main, ['checkout', '-q', '-b', 'side']);
    write(main, 'src/side.js', 's\n');
    commitAll(main, 'feat: side', '2026-03-05');
    git(main, ['checkout', '-q', 'main']);
    write(main, 'src/c.js', 'c\n');
    commitAll(main, 'feat: c', '2026-03-06');
    git(main, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-07'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('whole history: lockfile and dist ignored, merge skipped; stats.json, recap and wrapped.md agree', () => {
    const { r, doc, md } = run([main], 'all');
    // x.js 2, old.js 1, a.js 3, b.js 1, g.md 1, side.js 1, c.js 1 → 5 of 7.
    assert.deepEqual(doc.stats.oneTouch, { files: 5, share: 0.714 });
    assert.ok(!doc.stats.hotFiles.some((f) => /yarn\.lock|dist\//.test(f.path)));
    assert.match(r.stdout, /One-touch\s+5 files \(71% of changed files\)/);
    assert.match(md, /- \*\*One-touch files:\*\* 5 files \\\(71% of changed files\\\)/);
  });

  test('--since / --until: only the window counts', () => {
    const feb = run([main, '--since', '2026-02-01', '--until', '2026-02-28'], 'feb');
    assert.deepEqual(feb.doc.stats.oneTouch, { files: 1, share: 0.5 }); // x.js 2, old.js 1
    const mar = run([main, '--since', '2026-03-01', '--until', '2026-03-31'], 'mar');
    // a.js 3, b.js 1, g.md 1, side.js 1, c.js 1 → 4 of 5.
    assert.deepEqual(mar.doc.stats.oneTouch, { files: 4, share: 0.8 });
    // A window on a.js's single March 2 commit: a.js touched once there.
    const one = run([main, '--since', '2026-03-02', '--until', '2026-03-02'], 'one');
    assert.deepEqual(one.doc.stats.oneTouch, { files: 1, share: 1 });
    assert.match(one.r.stdout, /One-touch\s+1 file \(100% of changed files\)/);
  });

  test('--exclude (repeatable, folder and basename globs) drops files before counting', () => {
    const x = run([main, '--exclude', 'docs/', '--exclude', 'c.js'], 'excl');
    // x.js 2, old.js 1, a.js 3, b.js 1, side.js 1 → 3 of 5.
    assert.deepEqual(x.doc.stats.oneTouch, { files: 3, share: 0.6 });
    const all = run([main, '--exclude', '*.js', '--exclude', '*.md'], 'excl-all');
    assert.equal(all.doc.stats.oneTouch, null);
    assert.doesNotMatch(all.r.stdout, /One-touch/);
    assert.doesNotMatch(all.md, /One-touch/);
  });

  test('null: a history of only empty / ignored-only commits', () => {
    const dir = init('ignored-only');
    write(dir, 'package-lock.json', '{}\n');
    commitAll(dir, 'chore: lock', '2026-03-02');
    commitAll(dir, 'chore: empty', '2026-03-03');
    const { r, doc, md } = run([dir], 'ignored-only');
    assert.equal(doc.stats.oneTouch, null);
    assert.ok('oneTouch' in doc.stats);
    assert.doesNotMatch(r.stdout, /One-touch/);
    assert.doesNotMatch(md, /One-touch/);
  });

  test('{files: 0, share: 0} when every file was touched twice: no recap / md line', () => {
    const dir = init('twice');
    for (const day of ['2026-03-02', '2026-03-03']) {
      write(dir, 'a.js', day);
      write(dir, 'b.js', day);
      commitAll(dir, `feat: ${day}`, day);
    }
    const { r, doc, md } = run([dir], 'twice');
    assert.deepEqual(doc.stats.oneTouch, { files: 0, share: 0 });
    assert.doesNotMatch(r.stdout, /One-touch/);
    assert.doesNotMatch(md, /One-touch/);
  });

  test('multi-repo: the same path in two repos is two files; --lang tr wording; no room for the card row', () => {
    const api = init('api');
    const web = init('web');
    write(api, 'README.md', 'a\n');
    write(api, 'src/a.js', '1\n');
    commitAll(api, 'feat: api', '2026-03-02');
    write(api, 'src/a.js', '2\n');
    commitAll(api, 'feat: api 2', '2026-03-03');
    write(web, 'README.md', 'w\n');
    commitAll(web, 'feat: web', '2026-03-04');
    const { r, doc, md, out } = run([api, web, '--lang', 'tr'], 'multi');
    // api/README.md 1, api/src/a.js 2, web/README.md 1 → 2 of 3.
    assert.deepEqual(doc.stats.oneTouch, { files: 2, share: 0.667 });
    assert.match(r.stdout, /Tek commit'lik\s+2 dosya \(değişen dosyaların %67 kadarı\)/);
    assert.match(md, /- \*\*Tek commit'lik dosyalar:\*\* 2 dosya \\\(değişen dosyaların %67 kadarı\\\)/);
    // The multi-repo hot-files card (files per repo, folders) has no spare room: no row.
    const hot = readdirSync(join(out, 'cards')).find((f) => /hot-files\.svg$/.test(f));
    assert.ok(hot, 'hot-files card written');
    assert.doesNotMatch(readFileSync(join(out, 'cards', hot), 'utf8'), /Tek commit(?:'|&#39;|&apos;|&#x27;)lik/);
  });

  test('tiny single-repo history: the row is in the written hot-files SVG, en and tr', () => {
    const dir = init('tiny');
    write(dir, 'src/a.js', '1\n');
    commitAll(dir, 'feat: a', '2026-03-02');
    write(dir, 'src/a.js', '2\n');
    write(dir, 'src/b.js', 'b\n');
    commitAll(dir, 'feat: b', '2026-03-03');
    for (const [lang, re] of [['en', /One-touch files/], ['tr', /Tek commit(?:'|&#39;|&apos;|&#x27;)lik/]]) {
      const { out, doc } = run([dir, '--lang', lang], `tiny-${lang}`);
      assert.deepEqual(doc.stats.oneTouch, { files: 1, share: 0.5 });
      const hot = readdirSync(join(out, 'cards')).find((f) => /hot-files\.svg$/.test(f));
      const svg = readFileSync(join(out, 'cards', hot), 'utf8');
      assert.match(svg, re, lang);
      assert.match(svg, lang === 'en' ? /1 file · 50%/ : /· %50/, lang);
    }
  });
});
