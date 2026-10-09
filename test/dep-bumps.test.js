import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDepBumps, computeStats as computeAllStats, DEP_MANIFESTS, isDepPath, shownDepBumps } from '../src/stats/index.js';
import { excludeFiles, isIgnoredPath } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, cardDescription, depBumpsCard, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out (and the top words row
// after it, stats.messages.topWords, see test/top-words.test.js).
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null, topWords: [] } } : s;
};

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});
const merge = (i) => commit(i, [], { parents: ['a', 'b'], subject: `Merge branch 'x' ${i}` });

// One bump among three commits: the totals card has room for the row.
const roomy = () => [commit(1, [['src/a.js', 10, 1]]), commit(2, [['package.json', 1, 1], ['package-lock.json', 40, 30]]), commit(3, [['src/a.js', 5, 1]])];
// Two repos: the totals card (with its per-repo chart) has no room, the messages card does.
const twoRepos = () => [
  commit(1, [['api/src/a.js', 10, 1]], { repo: 'api' }),
  commit(2, [['web/package.json', 1, 1]], { repo: 'web' }),
  commit(3, [['web/src/a.js', 5, 1]], { repo: 'web' }),
  commit(4, [['api/x.js', 5, 1]], { author: 'Bob', email: 'b@example.com', repo: 'api', born: ['api/x.js'] }),
];
const TWO = [{ label: 'api' }, { label: 'web' }];
// A full totals card and a full messages card (cleanup rows): no room anywhere.
const crowded = () => [
  commit(1, [['src/a.js', 100, 1]]),
  commit(2, [['package.json', 1, 1]], { author: 'Bob', email: 'b@example.com' }),
  commit(3, [['src/a.js', 1, 50]]),
  merge(4),
  commit(5, [['src/b.js', 3, 0]], { born: ['src/b.js'] }),
];

const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specs = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts));
const specOf = (stats, id, lang, opts) => specs(stats, lang, opts).find((c) => c.id === id).spec;
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isDepRow = (r, L = en) => [L.totals.depBumps, L.totals.depBumpsLabelShort].includes(r?.label);
const depRowOf = (spec, L = en) => (spec.lines ?? []).find((r) => isDepRow(r, L));

describe('isDepPath', () => {
  test('lockfiles (also those isIgnoredPath drops) and manifests, by basename at any depth', () => {
    assert.deepEqual(DEP_MANIFESTS, ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'Gemfile', 'composer.json', 'Pipfile', 'pubspec.yaml', 'mix.exs', 'Podfile', 'flake.nix']);
    const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'go.sum', 'uv.lock', 'composer.lock'];
    for (const p of lockfiles) {
      assert.equal(isIgnoredPath(p), true, p);
      assert.equal(isDepPath(p), true, p);
      assert.equal(isDepPath(`packages/web/${p}`), true, p);
    }
    for (const p of [...DEP_MANIFESTS, 'apps/web/package.json', 'svc/go.mod', 'crates/x/Cargo.toml', 'py/pyproject.toml']) assert.equal(isDepPath(p), true, p);
    for (const p of ['requirements.txt', 'requirements-dev.txt', 'requirements_test.txt', 'requirements.prod.txt', 'py/requirements-ci.txt']) assert.equal(isDepPath(p), true, p);
  });

  test('each manifest whose lockfile is a lockfile, and Go vendoring (vendor/modules.txt)', () => {
    for (const [manifest, lock] of [['composer.json', 'composer.lock'], ['Pipfile', 'Pipfile.lock'], ['pubspec.yaml', 'pubspec.lock'], ['mix.exs', 'mix.lock'], ['Podfile', 'Podfile.lock'], ['flake.nix', 'flake.lock']]) {
      assert.equal(isDepPath(manifest), true, manifest);
      assert.equal(isDepPath(`app/${manifest}`), true, manifest);
      assert.equal(isDepPath(lock), true, lock);
      assert.equal(computeDepBumps([{ hash: 'a', subject: 'bump', files: [{ path: manifest }, { path: lock }] }]).commits, 1, manifest);
    }
    for (const p of ['vendor/modules.txt', 'svc/vendor/modules.txt']) assert.equal(isDepPath(p), true, p);
    for (const p of ['modules.txt', 'src/modules.txt', 'vendor/x/modules.txt', 'Vendor/modules.txt', 'vendor/Modules.txt', 'myvendor/modules.txt', 'pipfile', 'Composer.json', 'podfile', 'Flake.nix']) {
      assert.equal(isDepPath(p), false, p);
    }
    const files = ['go.mod', 'go.sum', 'vendor/modules.txt'].map((path) => ({ path }));
    assert.equal(computeDepBumps([{ hash: 'a', subject: 'go mod vendor', files }]).commits, 1);
    const withSources = [...files, { path: 'vendor/github.com/x/y/y.go' }];
    assert.equal(computeDepBumps([{ hash: 'b', subject: 'go mod vendor', files: withSources }]).commits, 0,
      'vendored sources are not dependency files (README: needs --exclude vendor/)');
  });

  test('exact and case-sensitive, like the lockfiles; no partial names', () => {
    for (const p of ['Package.json', 'PACKAGE-LOCK.JSON', 'gemfile', 'Requirements.txt', 'cargo.toml', 'Go.mod', 'package.json5', 'xpackage.json', 'go.mod.bak', 'requirements.in', 'requirements.txt.orig', 'dev-requirements.txt', 'package.json/x.js', 'src/a.js', 'README.md']) {
      assert.equal(isDepPath(p), false, p);
    }
    for (const p of ['', null, undefined, 3, {}]) assert.equal(isDepPath(p), false);
  });
});

describe('computeDepBumps', () => {
  test('non-merge commits whose every file is a lockfile or manifest; share of all non-merge commits', () => {
    const commits = [
      commit(1, [['package.json', 1, 1], ['package-lock.json', 40, 30]]),
      commit(2, [['src/a.js', 5, 1], ['package.json', 1, 0]]), // mixed: not a bump
      commit(3, [['bun.lockb', 0, 0]]), // binary lockfile, 0 lines: still a bump
      commit(4, []), // no files: counted, not a bump
      merge(5), // merges never count
      commit(6, [['py/requirements-dev.txt', 2, 1], ['go.sum', 3, 3], ['svc/go.mod', 1, 1]]),
    ];
    assert.deepEqual({ ...computeDepBumps(commits) }, { commits: 3, share: 0.6 });
  });

  test('null without a non-merge commit; {0, 0} when none is a bump', () => {
    assert.equal(computeDepBumps([]), null);
    assert.equal(computeDepBumps(undefined), null);
    assert.equal(computeDepBumps([merge(1), merge(2)]), null);
    assert.deepEqual({ ...computeDepBumps([commit(1, [['src/a.js', 1, 0]]), merge(2)]) }, { commits: 0, share: 0 });
  });

  test('share: 1 only when every non-merge commit is a bump, else at most 0.999; tiny shares may round to 0', () => {
    assert.equal(computeDepBumps([commit(1, [['yarn.lock', 1, 1]]), merge(2)]).share, 1);
    const many = Array.from({ length: 2000 }, (_, i) => commit(i + 1, [[i === 0 ? 'src/a.js' : 'yarn.lock', 1, 0]]));
    assert.equal(computeDepBumps(many).share, 0.999);
    const few = Array.from({ length: 2001 }, (_, i) => commit(i + 1, [[i === 0 ? 'yarn.lock' : 'src/a.js', 1, 0]]));
    assert.equal(computeDepBumps(few).share, 0);
    assert.equal(computeDepBumps(few).commits, 1);
  });

  test('multi-repo: names checked on the path inside each repo', () => {
    const commits = [commit(1, [['web/package.json', 1, 1]], { repo: 'web' }), commit(2, [['package.json/src/a.js', 1, 1]], { repo: 'package.json' })];
    assert.deepEqual({ ...computeDepBumps(commits) }, { commits: 1, share: 0.5 });
  });

  test('--exclude drops files first (excludeFiles): a bump can appear, or vanish when its lockfile is excluded', () => {
    const commits = [commit(1, [['src/a.js', 5, 1], ['package.json', 1, 0]]), commit(2, [['package-lock.json', 4, 4]])];
    assert.equal(computeDepBumps(excludeFiles(commits, compileExcludes(['src/']))).commits, 2);
    assert.equal(computeDepBumps(excludeFiles(commits, compileExcludes(['package-lock.json']))).commits, 0);
  });

  test('bad input never throws, never mutates; a file without a path makes a commit no bump', () => {
    const commits = [null, 3, 'x', commit(1, [['yarn.lock', 1, 1]]), { ...commit(2, []), files: [null] }, { ...commit(3, []), files: [{ added: 1 }] }, { ...commit(4, []), files: 'x' }];
    const before = JSON.stringify(commits);
    assert.deepEqual({ ...computeDepBumps(commits) }, { commits: 1, share: 0.25 });
    assert.equal(JSON.stringify(commits), before);
  });

  test('computeStats puts depBumps right after issueRefs; stats.json keeps exactly {commits, share} (null too)', () => {
    const s = statsOf(roomy());
    const keys = Object.keys(s);
    assert.equal(keys[keys.indexOf('issueRefs') + 1], 'depBumps');
    const doc = JSON.parse(buildStatsJson({ stats: s, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.depBumps, { commits: 1, share: 0.333 });
    assert.deepEqual(Object.keys(s.depBumps), ['commits', 'share']);
    assert.equal(JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo' })).stats.depBumps, null);
  });
});

describe('shownDepBumps', () => {
  test('whole commits and a percent from the exact ratio, never 100% short of all; null without a bump', () => {
    assert.deepEqual(shownDepBumps(computeDepBumps(roomy())), { commits: 1, pct: (1 / 3) * 100 });
    assert.deepEqual(shownDepBumps({ commits: 2, share: 1 }), { commits: 2, pct: 100 });
    assert.deepEqual(shownDepBumps({ commits: 2, share: 0.9996 }), { commits: 2, pct: 99.9 });
    assert.deepEqual(shownDepBumps({ commits: 2, share: 'x' }), { commits: 2, pct: 0 });
    for (const v of [null, undefined, 'x', 3, {}, { commits: 0, share: 0 }, { commits: -1, share: 0.5 }, { commits: NaN, share: 0.5 }]) assert.equal(shownDepBumps(v), null);
  });
});

describe('cards', () => {
  test('a "Dependency bumps" row last on the totals card when there is room, en and tr', () => {
    const s = statsOf(roomy());
    assert.equal(depBumpsCard(s, { L: en }), 'totals');
    const spec = specOf(s, 'totals');
    assert.deepEqual(spec.lines.at(-1), { label: 'Dependency bumps', value: '1 commit · 33%', description: '1 commit only touched lockfiles or dependency manifests (33% of non-merge commits)' });
    assert.equal(depRowOf(specOf(s, 'messages')), undefined);
    const t = depRowOf(specOf(s, 'totals', 'tr'), tr);
    assert.ok(t, 'tr row');
    assert.match(t.value, /^1( commit)? · %33$/);
    assert.match(cardDescription(specOf(s, 'totals', 'tr')), /1 commit yalnızca kilit dosyalarını veya bağımlılık manifestlerini değiştirdi \(merge dışı commit'lerin %33 kadarı\)\./);
    assert.match(cardDescription(spec), /1 commit only touched lockfiles or dependency manifests \(33% of non-merge commits\)\./);
  });

  test('on the messages card, last, when the totals card has no room', () => {
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      const s = statsOf(twoRepos(), { repos: TWO });
      assert.equal(depRowOf(specOf(s, 'totals', lang), L), undefined, lang);
      const lines = specOf(s, 'messages', lang).lines;
      assert.ok(isDepRow(lines.at(-1), L), lang);
    }
  });

  test('never displaces anything: every other card byte-identical, the one card only gains the row', () => {
    const cases = [[roomy()], [twoRepos(), { repos: TWO }], [crowded()], [[...roomy(), ...crowded().map((c, i) => ({ ...c, hash: H(50 + i) }))]]];
    for (const [commits, opts] of cases) {
      const s = statsOf(commits, opts);
      const without = { ...s, depBumps: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        for (const theme of [{}, { colorTheme: 'mono' }]) {
          const a = svgs(s, lang, theme);
          const b = svgs(without, lang, theme);
          assert.deepEqual(a.map(([id]) => id), b.map(([id]) => id));
          let shown = 0;
          for (const [i, [id, svg]] of a.entries()) {
            if (svg === b[i][1]) continue;
            shown += 1;
            assert.ok(['totals', 'messages'].includes(id), id);
            const spec = specOf(s, id, lang, theme);
            const base = specOf(without, id, lang, theme);
            const row = depRowOf(spec, L);
            assert.ok(row, id);
            assert.equal(spec.lines.at(-1), row);
            assert.deepEqual(spec.lines.slice(0, -1), base.lines);
            const la = layoutCard({ ...spec, lang });
            const lb = layoutCard({ ...base, lang });
            assert.deepEqual(la.drawnCharts, lb.drawnCharts, id);
            assert.ok(la.shrinkSteps <= lb.shrinkSteps, id);
          }
          assert.ok(shown <= 1, `${lang} ${shown}`);
        }
      }
    }
  });

  test('no room on either card: every card byte-identical', () => {
    const s = statsOf(crowded());
    assert.equal(s.depBumps.commits, 1);
    assert.equal(depBumpsCard(s, { L: en }), null);
    assert.deepEqual(svgs(s), svgs({ ...s, depBumps: null }));
  });

  test('no row for null, 0 or a malformed value: cards byte-identical', () => {
    const s = statsOf(roomy());
    const without = svgs({ ...s, depBumps: null });
    for (const depBumps of [undefined, { commits: 0, share: 0 }, 'x', { commits: -2, share: 2 }]) {
      assert.deepEqual(svgs({ ...s, depBumps }), without, JSON.stringify(depBumps));
    }
    assert.notDeepEqual(svgs(s), without);
  });

  test('"<1%" for a tiny share; the short value when the full one would be cut; none when even that is', () => {
    const s = statsOf(roomy());
    assert.equal(depRowOf(specOf({ ...s, depBumps: { commits: 3, share: 0 } }, 'totals')).value, '3 · <1%');
    assert.match(depRowOf(specOf({ ...s, depBumps: { commits: 1, share: 0 } }, 'totals')).value, /^1( commit)? · <1%$/);
    assert.equal(depRowOf(specOf({ ...s, depBumps: { commits: 123456789, share: 0.5 } }, 'totals')).value, '123,456,789 · 50%');
    const huge = { ...s, depBumps: { commits: 123456789012345, share: 0.5 } };
    assert.equal(depRowOf(specOf(huge, 'totals')), undefined);
    assert.equal(depRowOf(specOf(huge, 'messages')), undefined);
  });

  test('empty history: no row anywhere', () => {
    const s = { ...statsOf([]), depBumps: { commits: 4, share: 0.5 } };
    for (const c of specs(s)) assert.equal(depRowOf(c.spec), undefined, c.id);
  });
});

describe('recap and wrapped.md', () => {
  test('recap line after the issue refs, en and tr; none without a bump', () => {
    const s = statsOf([...roomy(), commit(9, [['src/c.js', 1, 0]], { subject: 'fix: #12' })]);
    const out = formatSummary(s, { repoName: 'demo', today: TODAY });
    assert.match(out, /\n {2}Issue refs.*\n {2}Dep bumps {4}1 commit \(25% of non-merge commits\)\n/);
    assert.match(formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /\n {2}Bağımlılıklar\s+1 commit \(merge dışı commit'lerin %25 kadarı\)\n/);
    assert.match(formatSummary({ ...s, depBumps: { commits: 2, share: 0.0001 } }, { repoName: 'demo', today: TODAY }), /Dep bumps\s+2 commits \(<1% of non-merge commits\)/);
    for (const depBumps of [null, { commits: 0, share: 0 }, undefined]) {
      assert.doesNotMatch(formatSummary({ ...s, depBumps }, { repoName: 'demo', today: TODAY }), /Dep bumps/);
    }
  });

  test('wrapped.md section after the issue references, en and tr; none without a bump', () => {
    const s = statsOf([...roomy(), commit(9, [['src/c.js', 1, 0]], { subject: 'fix: #12' })]);
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    assert.match(md, /Issue references[\s\S]*Dependency bumps/);
    assert.match(md, /## Dependency bumps\n\n1 commit \\\(25% of non-merge commits\\\)\n/);
    assert.match(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' }), /## Bağımlılık güncellemeleri\n\n1 commit \\\(merge dışı commit'lerin %25 kadarı\\\)\n/);
    assert.doesNotMatch(buildMarkdown({ ...s, depBumps: { commits: 0, share: 0 } }, { repoName: 'demo', today: TODAY }), /Dependency bumps/);
  });

  test('every language has the strings; the recap label fits its column', () => {
    for (const L of [en, tr]) {
      for (const k of ['depBumps', 'depBumpsLabelShort']) assert.equal(typeof L.totals[k], 'string', k);
      for (const k of ['depBumpsValue', 'depBumpsShort', 'depBumpsDescription']) assert.equal(typeof L.totals[k](3, '5%'), 'string', k);
      assert.equal(typeof L.recap.depBumps, 'string');
      assert.ok(L.recap.depBumps.length < L.recap.labelWidth);
      assert.equal(typeof L.markdown.depBumps, 'string');
    }
  });
});

describe('git (real repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const lines = (n, tag = '') => Array.from({ length: n }, (_, i) => `line ${tag}${i}`).join('\n') + '\n';
  const commitAll = (repo, msg, day) => {
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg], at(day));
  };
  let root;
  let repo;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-dep-bumps-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    // 1: mixed (a source file and the manifest): not a bump.
    write(repo, 'src/a.js', lines(5));
    write(repo, 'package.json', '{"name":"app"}\n');
    commitAll(repo, 'feat: start', '2026-03-02');
    // 2: manifest + lockfile (whose lines every other stat ignores): a bump.
    write(repo, 'package.json', '{"name":"app","dependencies":{"x":"1"}}\n');
    write(repo, 'package-lock.json', lines(300));
    commitAll(repo, 'chore(deps): bump x', '2026-03-03');
    // 3: source only.
    write(repo, 'src/a.js', lines(7));
    commitAll(repo, 'feat: more', '2026-03-04');
    // 4: requirements file and a nested lockfile: a bump.
    write(repo, 'py/requirements-dev.txt', 'pytest==8\n');
    write(repo, 'svc/go.sum', lines(4));
    commitAll(repo, 'chore: pin dev deps', '2026-03-05');
    // 5 on a side branch, then a merge commit (never counted).
    git(repo, ['checkout', '-q', '-b', 'side']);
    write(repo, 'src/b.js', lines(2));
    commitAll(repo, 'feat: side', '2026-03-06');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], at('2026-03-07'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('generate: stats.json, recap and wrapped.md; --exclude drops files first', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.depBumps, { commits: 2, share: 0.4 });
    // The lockfile's lines are still left out of the hot files.
    assert.ok(!doc.stats.hotFiles.some((f) => f.path === 'package-lock.json'));
    assert.match(readFileSync(r.markdown, 'utf8'), /## Dependency bumps\n\n2 commits \\\(40% of non-merge commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Dep bumps\s+2 commits \(40% of non-merge commits\)/);
    // Without src/, the first commit only touched package.json: now a bump too.
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['src/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.depBumps, { commits: 3, share: 0.6 });
  });
});
