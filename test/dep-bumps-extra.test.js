// Edge cases for stats.depBumps (src/stats/depbumps.js): adversarial path matching, merges,
// malformed input, multi-repo labels, rounding at the cap, --exclude, card placement with
// large numbers (en / tr), recap and wrapped.md wording, and a real-git multi-repo run.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDepBumps, computeStats as computeAllStats, isDepPath, shownDepBumps } from '../src/stats/index.js';
import { excludeFiles, isIgnoredPath } from '../src/stats/files.js';
import { compileExcludes } from '../src/glob.js';
import { buildCards, buildCardSpecs, depBumpShareText, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

// The subject length row (stats.messages.subjectLength) is the messages card's lowest-priority
// row, appended after every other one (see test/subject-length.test.js); these tests are about
// the rows before it, so their stats leave it out.
const computeStats = (...args) => {
  const s = computeAllStats(...args);
  return s.messages ? { ...s, messages: { ...s.messages, subjectLength: null } } : s;
};

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(5, '0')}bcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map((f) => (typeof f === 'string' ? { path: f, added: 1, removed: 1 } : f)),
  parents: ['p'],
  ...extra,
});
const plain = (o) => (o ? { ...o } : o);
const bumpsOf = (commits) => plain(computeDepBumps(commits));
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardOpts = (lang, opts) => ({ repoName: 'demo', today: TODAY, lang, ...opts });
const specsOf = (stats, lang = 'en', opts = {}) => buildCardSpecs(stats, cardOpts(lang, opts));
const svgs = (stats, lang = 'en', opts = {}) => buildCards(stats, cardOpts(lang, opts)).map((c) => [c.id, c.svg]);
const isDepRow = (r, L) => [L.totals.depBumps, L.totals.depBumpsLabelShort].includes(r?.label);
const depRows = (stats, lang, opts) => specsOf(stats, lang, opts).flatMap((c) => (c.spec.lines ?? []).filter((r) => isDepRow(r, LANGS[lang])).map((r) => ({ id: c.id, row: r })));

const roomy = () => [commit(1, ['src/a.js']), commit(2, ['package.json', 'package-lock.json']), commit(3, ['src/a.js'])];

describe('isDepPath: adversarial paths', () => {
  test('basename rule at any depth, also inside dependency / build / vendor dirs', () => {
    for (const p of ['node_modules/x/package.json', 'vendor/gems/Gemfile', 'dist/package.json', 'a/b/c/d/e/go.mod', 'requirements/requirements.txt', '.github/package.json']) {
      assert.equal(isDepPath(p), true, p);
    }
  });

  test('look-alikes, suffixes, prefixes, directories named like a manifest, whitespace', () => {
    for (const p of [
      'a/package.json.bak', 'package.json/', 'package.json/index.js', 'package.json/x/yarn.lock.d/a', 'yarn.lock/', 'go.mod/',
      '.package.json', 'package.json~', ' package.json', 'package.json ', 'package.jsonc', 'package_json', 'package-json',
      'Gemfile.rb', 'gems.rb', 'Gemfile_', 'Cargo.toml.orig', 'go.mod.tmp', 'pyproject.toml.j2',
      'requirements', 'requirements.txt/', 'requirements.txt.bak', 'requirements/base.txt', 'my-requirements.txt', 'requirementstxt',
      'Pipfile', 'setup.py', 'go.work', 'yarn.lock.json', 'package-lock.json5', 'src/package.js', 'package',
    ]) {
      assert.equal(isDepPath(p), false, p);
    }
  });

  test('case variants never count (exact match, like the lockfiles)', () => {
    for (const p of ['PACKAGE.JSON', 'Package.Json', 'GO.MOD', 'Go.Mod', 'cargo.toml', 'CARGO.TOML', 'Pyproject.toml', 'PyProject.toml', 'GEMFILE', 'gemfile', 'Gemfile.LOCK', 'gemfile.lock', 'Yarn.lock', 'YARN.LOCK', 'cargo.lock', 'Go.sum', 'REQUIREMENTS.txt', 'requirements.TXT', 'Requirements-dev.txt', 'web/Package.json']) {
      assert.equal(isDepPath(p), false, p);
    }
  });

  test('backslashes are not separators (git always prints "/"), as in isIgnoredPath', () => {
    for (const p of ['web\\package.json', 'a\\b\\yarn.lock', 'py\\requirements.txt']) {
      assert.equal(isDepPath(p), false, p);
      assert.equal(isIgnoredPath(p), false, p);
    }
    // ...but a backslash inside the last segment of a real '/'-path keeps the rule on the basename.
    assert.equal(isDepPath('odd\\dir/package.json'), true);
  });

  test('every lockfile isDepPath accepts is one isIgnoredPath drops, at any depth', () => {
    for (const p of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'go.sum', 'uv.lock']) {
      for (const q of [p, `deep/er/${p}`]) {
        assert.equal(isDepPath(q), true, q);
        assert.equal(isIgnoredPath(q), true, q);
      }
    }
  });

  test('non-string inputs never throw', () => {
    for (const p of [null, undefined, 0, 1, NaN, true, [], ['package.json'], { path: 'package.json' }, Symbol('x'), () => 'package.json', new String('package.json')]) {
      assert.equal(isDepPath(p), false, String(typeof p));
    }
  });
});

describe('computeDepBumps: mixed, empty and malformed commits', () => {
  test('one non-dependency file makes it no bump, even an ignored one (dist/, node_modules/, a snapshot)', () => {
    for (const other of ['dist/app.js', 'node_modules/x/index.js', 'src/__snapshots__/a.snap', 'app.min.js', 'README.md', 'package.json.bak', 'Package.json']) {
      assert.deepEqual(bumpsOf([commit(1, ['package.json', other])]), { commits: 0, share: 0 }, other);
    }
  });

  test('a file listed twice, binary lockfiles and 0-line changes still count', () => {
    assert.deepEqual(bumpsOf([commit(1, ['yarn.lock', 'yarn.lock'])]), { commits: 1, share: 1 });
    assert.deepEqual(bumpsOf([commit(1, [{ path: 'bun.lockb', added: null, removed: null }])]), { commits: 1, share: 1 });
    assert.deepEqual(bumpsOf([commit(1, [{ path: 'go.mod', added: 0, removed: 0 }])]), { commits: 1, share: 1 });
  });

  test('empty commits (no files / files missing / not an array) count in the denominator only', () => {
    const commits = [commit(1, ['Cargo.lock']), commit(2, []), { ...commit(3, []), files: undefined }, { ...commit(4, []), files: 'package.json' }, { ...commit(5, []), files: { 0: { path: 'yarn.lock' }, length: 1 } }];
    assert.deepEqual(bumpsOf(commits), { commits: 1, share: 0.2 });
  });

  test('a file with an empty, non-string or missing path makes the commit no bump', () => {
    for (const bad of [{ path: '' }, { path: 3 }, { path: null }, {}, null, 'yarn.lock', 7]) {
      const c = { ...commit(1, ['yarn.lock']), files: [{ path: 'yarn.lock', added: 1, removed: 0 }, bad] };
      assert.deepEqual(bumpsOf([c]), { commits: 0, share: 0 }, JSON.stringify(bad));
    }
  });

  test('non-object entries are skipped entirely (not in the denominator)', () => {
    assert.equal(computeDepBumps([null, undefined, 0, '', 'x', 42, true]), null);
    assert.deepEqual(bumpsOf([null, 'x', commit(1, ['go.sum']), 5]), { commits: 1, share: 1 });
    for (const v of [null, undefined, 'x', 5, {}, { length: 2 }]) assert.equal(computeDepBumps(v), null);
  });

  test('frozen input: never mutates, never throws', () => {
    const commits = Object.freeze([Object.freeze({ ...commit(1, []), files: Object.freeze([Object.freeze({ path: 'go.mod', added: 1, removed: 0 })]) }), Object.freeze(commit(2, ['x.js']))]);
    assert.deepEqual(bumpsOf(commits), { commits: 1, share: 0.5 });
  });
});

describe('computeDepBumps: merges', () => {
  test('a merge whose files are all dependency files is in neither the numerator nor the denominator', () => {
    const m = commit(9, ['package.json', 'yarn.lock'], { parents: ['a', 'b'], subject: 'Merge pull request #3 from x/deps' });
    assert.equal(computeDepBumps([m]), null);
    assert.deepEqual(bumpsOf([m, commit(1, ['src/a.js'])]), { commits: 0, share: 0 });
    assert.deepEqual(bumpsOf([m, commit(1, ['yarn.lock'])]), { commits: 1, share: 1 });
    // An octopus merge too.
    assert.equal(computeDepBumps([commit(8, ['go.mod'], { parents: ['a', 'b', 'c'] })]), null);
  });

  test('without parents, a "Merge ..." subject marks a merge (isMergeCommit fallback); a root commit (no parents) counts', () => {
    const noParents = (i, files, subject) => { const c = commit(i, files, { subject }); delete c.parents; return c; };
    assert.equal(computeDepBumps([noParents(1, ['yarn.lock'], "Merge branch 'deps'")]), null);
    assert.deepEqual(bumpsOf([noParents(1, ['yarn.lock'], 'chore: bump')]), { commits: 1, share: 1 });
    assert.deepEqual(bumpsOf([commit(1, ['yarn.lock'], { parents: [] })]), { commits: 1, share: 1 });
    // A real one-parent commit whose subject says "Merge" is not a merge: parents win.
    assert.deepEqual(bumpsOf([commit(1, ['yarn.lock'], { subject: "Merge branch 'deps'" })]), { commits: 1, share: 1 });
  });

  test('merges change neither commits nor share however many there are', () => {
    const base = [commit(1, ['yarn.lock']), commit(2, ['src/a.js']), commit(3, ['src/b.js'])];
    const merges = Array.from({ length: 50 }, (_, i) => commit(100 + i, i % 2 ? ['yarn.lock'] : [], { parents: ['a', 'b'] }));
    assert.deepEqual(bumpsOf([...merges, ...base]), bumpsOf(base));
    assert.deepEqual(bumpsOf(base), { commits: 1, share: 0.333 });
  });
});

describe('computeDepBumps: share rounding and the cap', () => {
  const run = (bumps, total) => Array.from({ length: total }, (_, i) => commit(i + 1, [i < bumps ? 'yarn.lock' : 'src/a.js']));

  test('every non-merge commit a bump: exactly 1 and 100%', () => {
    for (const n of [1, 2, 7, 3000]) {
      const d = computeDepBumps(run(n, n));
      assert.deepEqual(plain(d), { commits: n, share: 1 }, String(n));
      assert.equal(shownDepBumps(d).pct, 100);
      assert.equal(depBumpShareText(shownDepBumps(d), en), '100%');
      assert.equal(depBumpShareText(shownDepBumps(d), tr), '%100');
    }
  });

  test('one short of all: at most 0.999 and never "100%", also when the ratio rounds to 1', () => {
    for (const [b, t, share] of [[999, 1000, 0.999], [1999, 2000, 0.999], [9999, 10000, 0.999], [1, 2, 0.5], [2, 3, 0.667], [99, 100, 0.99]]) {
      const d = computeDepBumps(run(b, t));
      assert.deepEqual(plain(d), { commits: b, share }, `${b}/${t}`);
      assert.ok(shownDepBumps(d).pct < 100, `${b}/${t}`);
      assert.notEqual(depBumpShareText(shownDepBumps(d), en), '100%', `${b}/${t}`);
    }
    assert.equal(depBumpShareText(shownDepBumps(computeDepBumps(run(9999, 10000))), en), '99%');
  });

  test('tiny shares: rounds half up to 0.001, below that 0, but always "<1%" shown', () => {
    assert.equal(computeDepBumps(run(1, 2000)).share, 0.001); // 0.0005 → 0.001
    assert.equal(computeDepBumps(run(1, 2001)).share, 0);
    for (const t of [2000, 2001, 5000]) {
      const d = computeDepBumps(run(1, t));
      assert.equal(depBumpShareText(shownDepBumps(d), en), '<1%', String(t));
      assert.equal(depBumpShareText(shownDepBumps(d), tr), '<%1', String(t));
    }
  });

  test('the exact ratio survives only in memory: stats.json holds {commits, share}; a re-read value shows the same', () => {
    const d = computeDepBumps(run(9995, 10000));
    assert.deepEqual(Object.keys(d), ['commits', 'share']);
    assert.equal(JSON.stringify(d), '{"commits":9995,"share":0.999}');
    const back = JSON.parse(JSON.stringify(d));
    assert.equal(depBumpShareText(shownDepBumps(back), en), depBumpShareText(shownDepBumps(d), en));
    // 0.6665 → 3-decimal 0.667 (or 0.666) must not be rounded a second time differently than from the exact ratio.
    const e = computeDepBumps(run(1333, 2000));
    assert.equal(shownDepBumps(e).pct, (1333 / 2000) * 100);
  });
});

describe('computeDepBumps: multi-repo paths and labels', () => {
  test('repo label prefix is cut; the label itself never makes a bump', () => {
    const commits = [
      commit(1, ['web/package.json', 'web/yarn.lock'], { repo: 'web' }),
      commit(2, ['package.json/src/a.js'], { repo: 'package.json' }),
      commit(3, ['yarn.lock/README.md'], { repo: 'yarn.lock' }),
      commit(4, ['go.mod/go.mod'], { repo: 'go.mod' }),
      commit(5, ['requirements.txt/x.py'], { repo: 'requirements.txt' }),
    ];
    assert.deepEqual(bumpsOf(commits), { commits: 2, share: 0.4 });
  });

  test('a path outside its label (no prefix) is checked as it is; a label that is a prefix of a dir name is not cut', () => {
    assert.deepEqual(bumpsOf([commit(1, ['webx/package.json'], { repo: 'web' })]), { commits: 1, share: 1 });
    assert.deepEqual(bumpsOf([commit(1, ['package.json'], { repo: 'package.json' })]), { commits: 1, share: 1 });
    assert.deepEqual(bumpsOf([commit(1, ['api/src/a.js', 'api/package.json'], { repo: 'api' })]), { commits: 0, share: 0 });
  });

  test('computeStats agrees with computeDepBumps on a merged multi-repo history', () => {
    const commits = [
      commit(1, ['api/package.json', 'api/package-lock.json'], { repo: 'api' }),
      commit(2, ['web/src/a.js'], { repo: 'web' }),
      commit(3, ['web/Cargo.lock'], { repo: 'web', parents: ['a', 'b'] }),
      commit(4, ['web/py/requirements-dev.txt'], { repo: 'web' }),
    ];
    const s = statsOf(commits, { repos: [{ label: 'api' }, { label: 'web' }] });
    assert.deepEqual(plain(s.depBumps), { commits: 2, share: 0.667 });
  });
});

describe('--exclude interactions (excludeFiles first)', () => {
  const ex = (commits, patterns) => bumpsOf(excludeFiles(commits, compileExcludes(patterns)));

  test('excluding the source part of a mixed commit turns it into a bump; excluding everything leaves an empty, counted commit', () => {
    const commits = [commit(1, ['src/a.js', 'package.json']), commit(2, ['yarn.lock']), commit(3, ['docs/x.md'])];
    assert.deepEqual(ex(commits, ['src/']), { commits: 2, share: 0.667 });
    assert.deepEqual(ex(commits, ['*']), { commits: 0, share: 0 });
    assert.deepEqual(ex(commits, ['yarn.lock', 'package.json']), { commits: 0, share: 0 });
    assert.deepEqual(ex(commits, ['*.lock']), { commits: 0, share: 0 });
    assert.deepEqual(ex(commits, ['docs']), { commits: 1, share: 0.333 });
  });

  test('excluding one of two dependency files keeps the bump', () => {
    assert.deepEqual(ex([commit(1, ['package.json', 'package-lock.json'])], ['package-lock.json']), { commits: 1, share: 1 });
    assert.deepEqual(ex([commit(1, ['web/package.json', 'web/go.sum'])], ['go.sum']), { commits: 1, share: 1 });
  });

  test('multi-repo: a repo-labelled path pattern drops one repo, a name pattern never drops a repo by its label', () => {
    const commits = [
      commit(1, ['api/package.json'], { repo: 'api' }),
      commit(2, ['web/src/a.js', 'web/yarn.lock'], { repo: 'web' }),
      commit(3, ['package.json/src/a.js', 'package.json/go.mod'], { repo: 'package.json' }),
    ];
    assert.deepEqual(ex(commits, ['web/src/']), { commits: 2, share: 0.667 });
    assert.deepEqual(ex(commits, ['src/']), { commits: 3, share: 1 });
    // "package.json" as a name pattern drops the api manifest, but not the repo labelled package.json.
    assert.deepEqual(ex(commits, ['package.json']), { commits: 0, share: 0 });
    const kept = excludeFiles(commits, compileExcludes(['package.json']));
    assert.deepEqual(kept[2].files.map((f) => f.path), ['package.json/src/a.js', 'package.json/go.mod']);
  });
});

describe('stats.json shape', () => {
  test('null for no history / only merges, {0, 0} with no bump, keys exactly commits + share', () => {
    const doc = (commits) => JSON.parse(buildStatsJson({ stats: statsOf(commits), repoName: 'demo', version: '0.0.0', asOf: TODAY })).stats.depBumps;
    assert.equal(doc([]), null);
    assert.equal(doc([commit(1, ['yarn.lock'], { parents: ['a', 'b'] })]), null);
    assert.deepEqual(doc([commit(1, ['src/a.js'])]), { commits: 0, share: 0 });
    assert.deepEqual(doc([commit(1, ['yarn.lock'])]), { commits: 1, share: 1 });
    assert.deepEqual(Object.keys(doc(roomy())), ['commits', 'share']);
  });
});

describe('cards: large numbers, en and tr, never displacing', () => {
  const variants = [1, 2, 999, 1000, 1234567, 123456789, 2 ** 31, 9007199254740991];
  const cases = () => [
    ['roomy', roomy(), {}],
    ['two repos', [
      commit(1, ['api/src/a.js'], { repo: 'api' }),
      commit(2, ['web/package.json'], { repo: 'web' }),
      commit(3, ['web/src/a.js'], { repo: 'web' }),
      commit(4, ['api/x.js'], { author: 'Bob', email: 'b@example.com', repo: 'api', born: ['api/x.js'] }),
    ], { repos: [{ label: 'api' }, { label: 'web' }] }],
    ['merges + issue refs', [
      commit(1, [{ path: 'src/a.js', added: 100, removed: 1 }], { subject: 'fix: #12 thing' }),
      commit(2, ['package.json'], { author: 'Bob', email: 'b@example.com' }),
      commit(3, [{ path: 'src/a.js', added: 1, removed: 50 }]),
      commit(4, [], { parents: ['a', 'b'], subject: "Merge branch 'x'" }),
      commit(5, [{ path: 'src/b.js', added: 3, removed: 0 }], { born: ['src/b.js'] }),
    ], {}],
  ];

  test('at most one row, last on totals or messages; other rows and every other card unchanged', () => {
    const seen = { totals: 0, messages: 0, none: 0 };
    for (const [name, commits, opts] of cases()) {
      const base = statsOf(commits, opts);
      const without = { ...base, depBumps: null };
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const ref = svgs(without, lang, opts);
        const refSpecs = specsOf(without, lang, opts);
        for (const n of variants) {
          for (const share of [0, 0.0004, 0.5, 0.9996, 1]) {
            const s = { ...base, depBumps: { commits: n, share } };
            const got = svgs(s, lang, opts);
            assert.deepEqual(got.map(([id]) => id), ref.map(([id]) => id), `${name} ${lang} ${n}`);
            const changed = got.filter(([id, svg], i) => svg !== ref[i][1]).map(([id]) => id);
            assert.ok(changed.length <= 1, `${name} ${lang} ${n}: ${changed}`);
            const rows = depRows(s, lang, opts);
            assert.equal(rows.length, changed.length, `${name} ${lang} ${n} ${share}`);
            if (!rows.length) { seen.none += 1; continue; }
            const [{ id, row }] = rows;
            seen[id] += 1;
            assert.equal(id, changed[0]);
            assert.ok(['totals', 'messages'].includes(id), id);
            const spec = specsOf(s, lang, opts).find((c) => c.id === id).spec;
            const refSpec = refSpecs.find((c) => c.id === id).spec;
            assert.deepEqual(spec.lines.at(-1), row);
            assert.deepEqual(spec.lines.slice(0, -1), refSpec.lines, `${name} ${lang} ${n}`);
            assert.ok(spec.lines.length <= 6);
            const la = layoutCard({ ...spec, lang });
            const lb = layoutCard({ ...refSpec, lang });
            assert.deepEqual(la.drawnCharts, lb.drawnCharts, `${name} ${lang} ${n}`);
            assert.ok(la.shrinkSteps <= lb.shrinkSteps, `${name} ${lang} ${n}`);
            // The number is shown whole, in the language's grouping.
            const grouped = n.toLocaleString('en-US').replace(/,/g, lang === 'tr' ? '.' : ',');
            assert.ok(row.value.startsWith(`${grouped} `), `${row.value} vs ${grouped}`);
            assert.ok(row.value.endsWith(depBumpShareText(shownDepBumps(s.depBumps), L)), row.value);
            assert.notEqual(depBumpShareText(shownDepBumps(s.depBumps), L), share < 1 ? (lang === 'tr' ? '%100' : '100%') : '', `${name} ${share}`);
          }
        }
      }
    }
    // Every placement was exercised: the totals card, the messages card, and no room at all.
    assert.ok(seen.totals > 0 && seen.messages > 0 && seen.none > 0, JSON.stringify(seen));
  });

  test('cards byte-identical for null, undefined, {0, 0} and a computed zero, en and tr, both themes', () => {
    const zero = statsOf([commit(1, ['src/a.js']), commit(2, ['README.md'])]);
    assert.deepEqual(plain(zero.depBumps), { commits: 0, share: 0 });
    for (const lang of ['en', 'tr']) {
      for (const theme of [{}, { colorTheme: 'mono' }]) {
        const ref = svgs({ ...zero, depBumps: null }, lang, theme);
        for (const depBumps of [undefined, { commits: 0, share: 0 }, { commits: 0, share: 1 }, { commits: 0.4, share: 0.5 }, { commits: Infinity, share: 0.5 }, [], 'x']) {
          assert.deepEqual(svgs({ ...zero, depBumps }, lang, theme), ref, `${lang} ${JSON.stringify(depBumps)}`);
        }
        assert.deepEqual(svgs(zero, lang, theme), ref);
      }
    }
  });

  test('singular / plural wording on the card: "1 commit" in the long form, en and tr hover text', () => {
    const s = statsOf(roomy());
    const [{ row }] = depRows(s, 'en');
    assert.equal(row.value, '1 commit · 33%');
    assert.match(row.description, /^1 commit only touched/);
    const two = { ...s, depBumps: { commits: 2, share: 0.5 } };
    const [{ row: r2 }] = depRows(two, 'en');
    assert.match(r2.value, /^2( commits)? · 50%$/);
    assert.match(r2.description, /^2 commits only touched lockfiles or dependency manifests \(50% of non-merge commits\)$/);
    const [{ row: t1 }] = depRows(s, 'tr');
    assert.match(t1.description, /^1 commit yalnızca kilit dosyalarını veya bağımlılık manifestlerini değiştirdi \(merge dışı commit'lerin %33 kadarı\)$/);
    const [{ row: tBig }] = depRows({ ...s, depBumps: { commits: 1234567, share: 0.5 } }, 'tr');
    assert.match(tBig.description, /^1\.234\.567 commit yalnızca/);
  });
});

describe('recap and wrapped.md wording', () => {
  const sum = (s, lang) => formatSummary(s, { repoName: 'demo', today: TODAY, lang });
  const md = (s, lang) => buildMarkdown(s, { repoName: 'demo', today: TODAY, lang });

  test('singular "1 commit" with 100%, en and tr', () => {
    const s = statsOf([commit(1, ['yarn.lock'])]);
    assert.match(sum(s, 'en'), /\n {2}Dep bumps\s+1 commit \(100% of non-merge commits\)\n/);
    assert.match(sum(s, 'tr'), /\n {2}Bağımlılıklar\s+1 commit \(merge dışı commit'lerin %100 kadarı\)\n/);
    assert.match(md(s, 'en'), /## Dependency bumps\n\n1 commit \\\(100% of non-merge commits\\\)\n/);
    assert.match(md(s, 'tr'), /## Bağımlılık güncellemeleri\n\n1 commit \\\(merge dışı commit'lerin %100 kadarı\\\)\n/);
  });

  test('plural and large numbers with grouping; 99% (never 100%) one short of all; <1%', () => {
    const base = statsOf(roomy());
    const at = (commits, share) => ({ ...base, depBumps: { commits, share } });
    assert.match(sum(at(1234567, 0.25), 'en'), /Dep bumps\s+1,234,567 commits \(25% of non-merge commits\)/);
    assert.match(sum(at(1234567, 0.25), 'tr'), /Bağımlılıklar\s+1\.234\.567 commit \(merge dışı commit'lerin %25 kadarı\)/);
    assert.match(md(at(1234567, 0.25), 'en'), /## Dependency bumps\n\n1,234,567 commits \\\(25% of non-merge commits\\\)/);
    assert.match(md(at(1234567, 0.25), 'tr'), /## Bağımlılık güncellemeleri\n\n1\.234\.567 commit \\\(merge dışı commit'lerin %25 kadarı\\\)/);
    const nearly = statsOf(Array.from({ length: 1000 }, (_, i) => commit(i + 1, [i ? 'yarn.lock' : 'src/a.js'])));
    assert.match(sum(nearly, 'en'), /Dep bumps\s+999 commits \(99% of non-merge commits\)/);
    assert.match(md(nearly, 'tr'), /999 commit \\\(merge dışı commit'lerin %99 kadarı\\\)/);
    assert.match(sum(at(3, 0), 'en'), /Dep bumps\s+3 commits \(<1% of non-merge commits\)/);
    assert.match(sum(at(3, 0), 'tr'), /Bağımlılıklar\s+3 commit \(merge dışı commit'lerin <%1 kadarı\)/);
  });

  test('the recap label is padded to the same column as its neighbours', () => {
    for (const lang of ['en', 'tr']) {
      const out = sum(statsOf(roomy()), lang).split('\n');
      const line = out.find((l) => l.startsWith(`  ${LANGS[lang].recap.depBumps}`));
      assert.ok(line, lang);
      const R = LANGS[lang].recap;
      assert.equal(line, `  ${R.depBumps.padEnd(R.labelWidth)}1 commit ${R.ofNonMerge(lang === 'tr' ? '%33' : '33%').replace(/^/, '(')})`, lang);
    }
  });

  test('no line / section for null, {0}, merges only, or malformed values, en and tr', () => {
    const base = statsOf(roomy());
    for (const depBumps of [null, undefined, { commits: 0, share: 0 }, { commits: -3, share: 0.5 }, 'x']) {
      for (const lang of ['en', 'tr']) {
        assert.doesNotMatch(sum({ ...base, depBumps }, lang), lang === 'en' ? /Dep bumps/ : /Bağımlılıklar/);
        assert.doesNotMatch(md({ ...base, depBumps }, lang), lang === 'en' ? /Dependency bumps/ : /Bağımlılık güncellemeleri/);
      }
    }
  });
});

describe('git (real repos, multi-repo)', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const commitAll = (repo, msg, day, extra = []) => {
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '--no-gpg-sign', ...extra, '-m', msg], at(day));
  };
  const init = (dir) => {
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
  };
  let root;
  let api;
  let web;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-dep-bumps-extra-'));
    api = join(root, 'api');
    web = join(root, 'web');
    // api: 1 mixed, 2 bump (manifest + lockfile), 3 empty commit, 4 a vendored manifest (bump by basename).
    init(api);
    write(api, 'src/a.js', 'a\n');
    write(api, 'package.json', '{"name":"api"}\n');
    commitAll(api, 'feat: start', '2026-03-02');
    write(api, 'package.json', '{"name":"api","dependencies":{"x":"1"}}\n');
    write(api, 'package-lock.json', 'lock\n'.repeat(50));
    commitAll(api, 'chore(deps): bump x', '2026-03-03');
    commitAll(api, 'chore: empty', '2026-03-04', ['--allow-empty']);
    write(api, 'node_modules/x/package.json', '{"name":"x"}\n');
    commitAll(api, 'chore: vendor x', '2026-03-05');
    // web: 1 a case-variant manifest (no other file differs from it only by case), 2 a bump on a
    // side branch merged with --no-ff (the merge never counts), 3 a look-alike manifest.
    init(web);
    write(web, 'cfg/Package.json', '{}\n');
    commitAll(web, 'feat: config', '2026-03-06');
    git(web, ['checkout', '-q', '-b', 'deps']);
    write(web, 'Cargo.toml', '[package]\nname="w"\n');
    write(web, 'Cargo.lock', 'lock\n');
    commitAll(web, 'chore: cargo', '2026-03-07');
    git(web, ['checkout', '-q', 'main']);
    git(web, ['merge', '-q', '--no-ff', '--no-gpg-sign', '-m', 'Merge branch deps', 'deps'], at('2026-03-08'));
    write(web, 'pyproject.toml.bak', 'x\n');
    commitAll(web, 'chore: backup', '2026-03-09');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('two repos: stats.json, recap and wrapped.md; merges, empty and case-variant commits handled', async () => {
    const r = await generate({ path: api, paths: [api, web], out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    // Non-merge: api 4 + web 3 = 7; bumps: api #2, api #4 (node_modules/x/package.json), web cargo = 3.
    assert.deepEqual(doc.stats.depBumps, { commits: 3, share: 0.429 });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Dependency bumps\n\n3 commits \\\(43% of non-merge commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'x', today: TODAY }), /Dep bumps\s+3 commits \(43% of non-merge commits\)/);
    assert.match(formatSummary(r.stats, { repoName: 'x', today: TODAY, lang: 'tr' }), /Bağımlılıklar\s+3 commit \(merge dışı commit'lerin %43 kadarı\)/);
  });

  test('two repos with --exclude: a repo-path pattern and a name pattern', async () => {
    // Dropping api/src/ makes api's first commit (then only package.json) a bump.
    const a = await generate({ path: api, paths: [api, web], out: join(root, 'o2'), png: false, json: true, exclude: ['api/src/'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(a.statsJson, 'utf8')).stats.depBumps, { commits: 4, share: 0.571 });
    // Dropping every lockfile and Cargo.toml: web's cargo commit is empty now, api #2 keeps package.json.
    const b = await generate({ path: api, paths: [api, web], out: join(root, 'o3'), png: false, json: true, exclude: ['*.lock', 'package-lock.json', 'Cargo.toml'] }, { today: TODAY });
    assert.deepEqual(JSON.parse(readFileSync(b.statsJson, 'utf8')).stats.depBumps, { commits: 2, share: 0.286 });
  });

  test('single repo, tr wrapped.md', async () => {
    const r = await generate({ path: web, out: join(root, 'o4'), png: false, md: true, lang: 'tr' }, { today: TODAY });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Bağımlılık güncellemeleri\n\n1 commit \\\(merge dışı commit'lerin %33 kadarı\\\)/);
  });
});
