// Releases: tags (lightweight and annotated, peeled to their commit) read by src/git.js
// readTags, counted by computeReleases (src/stats/releases.js), and shown on the outro
// card, in the recap, wrapped.md and stats.json.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories, parseTagRefs, readCommits, readHistory, readTags } from '../src/git.js';
import { computeReleases, computeStats, shownReleases } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2025-04-01';

let n = 0;
function commit(date, tags, extra = {}) {
  n += 1;
  return {
    hash: `${String(n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
    author: 'Ada',
    email: 'ada@example.com',
    date,
    subject: `feat: change ${n}`,
    parents: ['p'],
    coAuthors: [],
    files: [{ path: 'src/a.js', added: 3, removed: 1, binary: false }],
    filesChanged: 1,
    linesAdded: 3,
    linesRemoved: 1,
    ...(tags ? { tags } : {}),
    ...extra,
  };
}

/** Every <text> of an SVG. */
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

/** A few commits over March 2025, newest first (as git log), the oldest and a later one tagged. */
function history(tagsOld = ['v0.1.0'], tagsNew = ['v1.0.0']) {
  return [
    commit('2025-03-20T10:00:00+00:00'),
    commit('2025-03-12T09:00:00+00:00', tagsNew),
    commit('2025-03-05T18:00:00+00:00'),
    commit('2025-03-01T08:00:00+00:00', tagsOld),
  ];
}

describe('computeReleases', () => {
  test('empty input, no tags, or junk → count 0 and no first / latest', () => {
    const none = { count: 0, tags: 0, first: null, latest: null };
    assert.deepEqual(computeReleases([]), none);
    assert.deepEqual(computeReleases(), none);
    assert.deepEqual(computeReleases(null), none);
    assert.deepEqual(computeReleases([commit('2025-03-01T00:00:00Z')]), none);
    assert.deepEqual(computeReleases([null, 7, 'x', commit('2025-03-01T00:00:00Z', 'v1'), commit('2025-03-01T00:00:00Z', [null, 3, '', '  '])]), none);
  });

  test('one release per tagged commit; first is the earliest, latest the most recent, by author-local day', () => {
    // The newer commit is 2025-03-12 09:00 in +14:00 → 2025-03-11 19:00 UTC; its day is still the 12th.
    const commits = history(['v0.1.0'], ['v1.0.0']);
    commits[1].date = '2025-03-12T09:00:00+14:00';
    assert.deepEqual(computeReleases(commits), {
      count: 2,
      tags: 2,
      first: { name: 'v0.1.0', date: '2025-03-01' },
      latest: { name: 'v1.0.0', date: '2025-03-12' },
    });
  });

  test('several tags on one commit are one release, named by its most specific version', () => {
    const r = computeReleases(history(['v0.1.0', 'first'], ['v1.0.0', 'v1.0.0-rc.1', 'stable', 'v1', 'v1.0', 'latest']));
    assert.equal(r.count, 2);
    assert.equal(r.tags, 8);
    assert.deepEqual(r.first, { name: 'v0.1.0', date: '2025-03-01' });
    assert.deepEqual(r.latest, { name: 'v1.0.0', date: '2025-03-12' });
  });

  test('the shown tag: more version parts, then no suffix, then the highest (numeric-aware), deterministically', () => {
    const name = (tags) => computeReleases([commit('2025-03-01T00:00:00Z', tags)]).latest.name;
    assert.equal(name(['v1.9.0', 'v1.10.0']), 'v1.10.0');
    assert.equal(name(['v1.10.0', 'v1.9.0']), 'v1.10.0');
    assert.equal(name(['v1.2', 'v1.2.3', 'v1']), 'v1.2.3');
    assert.equal(name(['v2.0.0-rc.2', 'v2.0.0']), 'v2.0.0');
    assert.equal(name(['stable', 'latest']), 'stable');
    assert.equal(name(['latest', 'release-2']), 'release-2');
    assert.equal(name(['nested', 'v1.0.0']), 'v1.0.0');
    for (const tags of [['b', 'a', 'v3'], ['v3', 'a', 'b']]) assert.equal(name(tags), 'v3');
  });

  test('ties between commits on one instant go by name, numeric-aware', () => {
    const r = computeReleases([commit('2025-03-01T00:00:00Z', ['v1.10.0']), commit('2025-03-01T00:00:00Z', ['v1.9.0'])]);
    assert.equal(r.first.name, 'v1.9.0');
    assert.equal(r.latest.name, 'v1.10.0');
  });

  test('ordering is by instant, not input order or name', () => {
    const r = computeReleases([commit('2025-01-01T00:00:00Z', ['z-old']), commit('2025-06-01T00:00:00Z', ['a-new'])]);
    assert.equal(r.first.name, 'z-old');
    assert.equal(r.latest.name, 'a-new');
  });

  test('merge commits count (releases are often tagged on one)', () => {
    const r = computeReleases([commit('2025-03-01T00:00:00Z', ['v2'], { parents: ['a', 'b'] })]);
    assert.equal(r.count, 1);
    assert.deepEqual(r.latest, { name: 'v2', date: '2025-03-01' });
  });

  test('an undated commit sorts last and is never the latest when a dated tag exists', () => {
    const r = computeReleases([commit('not a date', ['undated']), commit('2025-03-01T00:00:00Z', ['v1'])]);
    assert.equal(r.count, 2);
    assert.deepEqual(r.first, { name: 'v1', date: '2025-03-01' });
    assert.deepEqual(r.latest, { name: 'v1', date: '2025-03-01' });
    assert.deepEqual(computeReleases([commit('nope', ['only'])]).latest, { name: 'only', date: null });
  });

  test('multi-repo: names are repo-prefixed and entries carry repo', () => {
    const r = computeReleases([
      commit('2025-03-10T00:00:00Z', ['v2.0.0'], { repo: 'web' }),
      commit('2025-03-01T00:00:00Z', ['v1.0.0'], { repo: 'api' }),
    ]);
    assert.deepEqual(r, {
      count: 2,
      tags: 2,
      first: { name: 'api/v1.0.0', date: '2025-03-01', repo: 'api' },
      latest: { name: 'web/v2.0.0', date: '2025-03-10', repo: 'web' },
    });
  });

  test('email-shaped tag names are scrubbed; control characters dropped', () => {
    const r = computeReleases([commit('2025-03-01T00:00:00Z', ['release-ada@example.com', 'v‮1\u0007'])]);
    assert.equal(r.count, 1);
    assert.equal(r.tags, 2);
    assert.ok(!JSON.stringify(r).includes('example.com'));
    assert.equal(r.latest.name, 'v1');
    // The whole address-shaped token goes ("release-ada@example.com" → "…").
    assert.equal(computeReleases([commit('2025-03-01T00:00:00Z', ['release-ada@example.com'])]).latest.name, '…');
  });

  test('shownReleases: null for none / junk, {count, latest} otherwise', () => {
    assert.equal(shownReleases(null), null);
    assert.equal(shownReleases({ count: 0, first: null, latest: null }), null);
    assert.equal(shownReleases({ count: 'many' }), null);
    assert.deepEqual(shownReleases({ count: 3, latest: { name: 'v1', date: '2025-03-01' } }), { count: 3, latest: { name: 'v1', date: '2025-03-01' } });
    assert.deepEqual(shownReleases({ count: 2, latest: { name: '' } }), { count: 2, latest: null });
    assert.deepEqual(shownReleases({ count: 2, latest: { name: 'a@b.io', date: 5 } }), { count: 2, latest: { name: '…', date: null } });
  });

  test('computeStats includes releases', () => {
    assert.deepEqual(computeStats(history(), { today: TODAY }).releases.count, 2);
    assert.deepEqual(computeStats([], { today: TODAY }).releases, { count: 0, tags: 0, first: null, latest: null });
  });
});

describe('mergeHistories and tags', () => {
  test('a dropped duplicate commit\'s tags join the kept copy as {name, repo}; inputs unchanged', () => {
    const shared = commit('2025-03-01T00:00:00Z', ['v1.0.0']);
    const again = { ...shared, tags: ['v1.0.0', 'v1.0.1'] };
    const only = { ...shared, tags: undefined };
    const { commits } = mergeHistories([{ label: 'a', commits: [shared] }, { label: 'b', commits: [again] }]);
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].tags, ['v1.0.0', { name: 'v1.0.0', repo: 'b' }, { name: 'v1.0.1', repo: 'b' }]);
    assert.deepEqual(shared.tags, ['v1.0.0']);
    const r = computeReleases(commits);
    assert.equal(r.count, 1);
    assert.equal(r.tags, 3);
    assert.deepEqual(r.latest, { name: 'b/v1.0.1', date: '2025-03-01', repo: 'b' });
    // Tagged only in the second repo: still a release, under that repo.
    const m = mergeHistories([{ label: 'a', commits: [only] }, { label: 'b', commits: [shared] }]);
    assert.deepEqual(computeReleases(m.commits).latest, { name: 'b/v1.0.0', date: '2025-03-01', repo: 'b' });
    // Neither tagged: no tags field.
    const none = mergeHistories([{ label: 'a', commits: [only] }, { label: 'b', commits: [only] }]);
    assert.ok(!('tags' in none.commits[0]) || none.commits[0].tags === undefined);
  });
});

describe('parseTagRefs', () => {
  test('lightweight tags keep their hash; annotated ones are peeled through ^{}', () => {
    const out = [
      'aaaa000000000000000000000000000000000000 refs/tags/light',
      'bbbb000000000000000000000000000000000000 refs/tags/annotated',
      'cccc000000000000000000000000000000000000 refs/tags/annotated^{}',
      'dddd000000000000000000000000000000000000 refs/tags/nested/name',
      'not a ref line',
      'eeee000000000000000000000000000000000000 refs/heads/main',
      '',
    ].join('\n');
    assert.deepEqual([...parseTagRefs(out)], [
      ['light', 'aaaa000000000000000000000000000000000000'],
      ['annotated', 'cccc000000000000000000000000000000000000'],
      ['nested/name', 'dddd000000000000000000000000000000000000'],
    ]);
    assert.equal(parseTagRefs('').size, 0);
    assert.equal(parseTagRefs(undefined).size, 0);
  });
});

describe('outro card, recap and wrapped.md', () => {
  const base = computeStats(history([], []), { today: TODAY });
  const withReleases = computeStats(history(['v0.1.0'], ['v1.0.0']), { today: TODAY });

  test('no releases → the outro card is byte-identical to one without the stat (every theme, both languages)', () => {
    const { releases, ...without } = base;
    assert.deepEqual(releases, { count: 0, tags: 0, first: null, latest: null });
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of ['default', 'mono', 'neon']) {
        const a = buildCards(base, { repoName: 'app', today: TODAY, lang, colorTheme }).find((c) => c.id === 'outro');
        const b = buildCards(without, { repoName: 'app', today: TODAY, lang, colorTheme }).find((c) => c.id === 'outro');
        assert.equal(a.svg, b.svg, `${lang}/${colorTheme}`);
        assert.equal(a.description, b.description);
      }
    }
  });

  test('with releases the outro gets the panel, in English and Turkish, mirrored in the description', () => {
    const outro = buildCards(withReleases, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro');
    const t = texts(outro.svg);
    assert.ok(t.includes('RELEASES'), t.join(' | '));
    assert.ok(t.includes('You shipped 2 releases'));
    assert.ok(t.includes('Latest: v1.0.0 · Mar 12, 2025'));
    assert.match(outro.description, /You shipped 2 releases/);
    const trOutro = buildCards(withReleases, { repoName: 'app', today: TODAY, lang: 'tr' }).find((c) => c.id === 'outro');
    const tt = texts(trOutro.svg);
    assert.ok(tt.includes('2 sürüm yayınladın'), tt.join(' | '));
    assert.ok(tt.some((x) => x.startsWith('Son sürüm: v1.0.0 · ')));
    const one = computeStats(history([], ['v1']), { today: TODAY });
    assert.ok(texts(buildCards(one, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro').svg).includes('You shipped 1 release'));
  });

  test('a long tag name is cut with "…" so the day still shows', () => {
    const long = `release-${'x'.repeat(120)}`;
    const stats = computeStats(history([], [long]), { today: TODAY });
    const t = texts(buildCards(stats, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro').svg);
    const note = t.find((x) => x.startsWith('Latest: '));
    assert.ok(note, t.join(' | '));
    // Cut in the middle: the head and the version-like tail both show, and the day.
    assert.match(note, /^Latest: release-x*…x+ · Mar 12, 2025$/);
  });

  test('the panel shows for typical repo names, with and without --year; the static subtitle gives way first', () => {
    const previousYear = { year: 2024, commits: [commit('2024-03-12T10:00:00+00:00')], truncated: false };
    const plainStats = computeStats(history([], ['v1.2.0']), { today: TODAY });
    const yearStats = computeStats(history([], ['v1.2.0']), { today: TODAY, previousYear });
    assert.ok(yearStats.yearOverYear);
    for (const [stats, window] of [[plainStats, {}], [yearStats, { since: '2025-01-01', until: '2025-12-31' }]]) {
      const { releases, ...without } = stats;
      assert.equal(releases.count, 1);
      for (const repoName of ['app', 'gitwrapped', 'my-project', 'a-really-long-repository-name']) {
        for (const lang of ['en', 'tr']) {
          for (const colorTheme of ['default', 'mono', 'neon']) {
            const opts = { repoName, today: TODAY, lang, colorTheme, ...window };
            const label = `${repoName}/${lang}/${colorTheme}/${window.since ? 'year' : 'plain'}`;
            const a = buildCards(stats, opts).find((c) => c.id === 'outro');
            const b = buildCards(without, opts).find((c) => c.id === 'outro');
            assert.match(a.svg, lang === 'en' ? /RELEASES/ : /SÜRÜMLER/, label);
            assert.ok(texts(a.svg).includes(lang === 'en' ? 'You shipped 1 release' : '1 sürüm yayınladın'), label);
            // Nothing else shrinks: the big word, the title and the tiles keep their geometry.
            const sa = buildCardSpecs(stats, opts).find((c) => c.id === 'outro').spec;
            const sb = buildCardSpecs(without, opts).find((c) => c.id === 'outro').spec;
            const geo = (spec) => layoutCard({ ...spec, lang }).blocks.filter((x) => x.kind !== 'subtitle').slice(0, 3).map((x) => [x.kind, Math.round(x.bottom - x.top)]);
            assert.deepEqual(geo(sa), geo(sb), label);
            assert.notEqual(a.svg, b.svg);
            // The static line goes before the --year sentence does.
            if (sa.subtitle && window.since) assert.match(sa.subtitle, /^(vs \d{4}|\d{4} yılına göre)/, label);
          }
        }
      }
    }
  });

  test('no commits → no panel even with a hand-written releases stat', () => {
    const empty = { ...computeStats([], { today: TODAY }), releases: { count: 4, latest: { name: 'v9', date: '2025-01-01' } } };
    const spec = buildCardSpecs(empty, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro').spec;
    assert.ok(!Array.isArray(spec.chart));
  });

  test('recap and wrapped.md get a line only when there are releases', () => {
    const recap = formatSummary(withReleases, { repoName: 'app', today: TODAY });
    assert.match(recap, /Releases\s+2 releases · latest: v1\.0\.0 \(Mar 12, 2025\)/);
    assert.doesNotMatch(formatSummary(base, { repoName: 'app', today: TODAY }), /Releases/);
    const md = buildMarkdown(withReleases, { repoName: 'app', today: TODAY });
    assert.match(md, /\*\*Releases:\*\* 2 releases, latest: v1\.0\.0 \(Mar 12, 2025\)/);
    assert.doesNotMatch(buildMarkdown(base, { repoName: 'app', today: TODAY }), /Releases/);
    assert.match(formatSummary(withReleases, { repoName: 'app', today: TODAY, lang: 'tr' }), /Sürümler\s+2 sürüm · son: v1\.0\.0/);
    assert.match(buildMarkdown(withReleases, { repoName: 'app', today: TODAY, lang: 'tr' }), /Sürümler:\*\* 2 sürüm, son sürüm: v1\.0\.0/);
  });

  test('en and tr have the release strings', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.outro.releases, 'string');
      assert.equal(typeof L.outro.shipped(3), 'string');
      assert.equal(typeof L.outro.latest('v1'), 'string');
      assert.equal(typeof L.recap.releases, 'string');
      assert.equal(typeof L.recap.latest, 'string');
      assert.equal(typeof L.markdown.releases, 'string');
      assert.equal(typeof L.markdown.latestRelease('v1'), 'string');
      assert.equal(L.units.release.length, 2);
    }
    assert.equal(en.outro.shipped(1), 'You shipped 1 release');
    assert.equal(tr.outro.shipped(3), '3 sürüm yayınladın');
  });
});

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('git (real repos)', () => {
  let root;
  const ada = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const bob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
  /** A repo with one commit per [day, who] entry; returns {repo, hashes} (oldest first). */
  const make = (name, days) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    git(repo, ['config', 'tag.gpgsign', 'false']);
    const hashes = [];
    for (const [i, [day, who]] of days.entries()) {
      writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
      git(repo, ['add', '-A']);
      const date = `2025-03-${day}T10:00:00+00:00`;
      git(repo, ['commit', '-q', '-m', `feat: change ${i}`], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      hashes.push(git(repo, ['rev-parse', 'HEAD']).trim());
    }
    return { repo, hashes };
  };
  let app;
  let web;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-releases-'));
    app = make('app', [['01', ada], ['05', bob], ['10', ada], ['15', ada]]);
    const tagEnv = { ...ada, GIT_COMMITTER_DATE: '2025-03-30T10:00:00+00:00' };
    git(app.repo, ['tag', 'v0.1.0', app.hashes[0]]); // lightweight, on the first commit
    git(app.repo, ['tag', 'bob-release', app.hashes[1]]); // lightweight, on Bob's commit
    git(app.repo, ['tag', '-a', 'v1.0.0', '-m', 'one oh', app.hashes[2]], tagEnv); // annotated
    git(app.repo, ['tag', 'v1.0.0-final', app.hashes[2]]); // a second tag on the same commit
    git(app.repo, ['-c', 'advice.nestedTag=false', 'tag', '-a', 'nested', '-m', 'tag of a tag', 'v1.0.0'], tagEnv); // peels to app.hashes[2]
    git(app.repo, ['tag', 'tree-tag', `${app.hashes[3]}^{tree}`]); // not a commit: never matches
    web = make('web', [['03', ada], ['20', ada]]);
    git(web.repo, ['tag', '-a', 'v2.0.0', '-m', 'two', web.hashes[1]], tagEnv);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('readCommits gives tagged commits their (peeled, sorted) tag names; untagged ones no field', async () => {
    const commits = await readCommits(app.repo);
    const byHash = Object.fromEntries(commits.map((c) => [c.hash, c.tags]));
    assert.deepEqual(byHash[app.hashes[0]], ['v0.1.0']);
    assert.deepEqual(byHash[app.hashes[1]], ['bob-release']);
    assert.deepEqual(byHash[app.hashes[2]], ['nested', 'v1.0.0', 'v1.0.0-final']);
    assert.equal(byHash[app.hashes[3]], undefined);
    assert.ok(!('tags' in commits.find((c) => c.hash === app.hashes[3])));
  });

  test('tags: false skips the tag read', async () => {
    const commits = await readCommits(app.repo, { tags: false });
    assert.ok(commits.every((c) => !('tags' in c)));
  });

  test('readTags: a failing git or a repo without tags gives no tags, never an error', async () => {
    const commits = [{ hash: app.hashes[0] }];
    await readTags(join(root, 'missing'), commits);
    assert.deepEqual(commits, [{ hash: app.hashes[0] }]);
    const bare = make('notags', [['02', ada]]);
    const read = await readHistory(bare.repo);
    assert.ok(read.commits.every((c) => !('tags' in c)));
    assert.deepEqual(await readTags(app.repo, []), []);
  });

  test('generate: stats.releases in stats.json, recap and wrapped.md; the outro panel', async () => {
    const out = join(root, 'o1');
    const r = await generate({ path: app.repo, out, png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    // v1.0.0, v1.0.0-final and the tag on it ("nested") are one release, shown as v1.0.0.
    assert.deepEqual(doc.stats.releases, {
      count: 3,
      tags: 5,
      first: { name: 'v0.1.0', date: '2025-03-01' },
      latest: { name: 'v1.0.0', date: '2025-03-10' },
    });
    assert.match(readFileSync(r.markdown, 'utf8'), /\*\*Releases:\*\* 3 releases, latest: v1\.0\.0 \(Mar 10, 2025\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Releases\s+3 releases/);
    assert.match(readFileSync(join(out, 'cards', readdirSync(join(out, 'cards')).find((f) => f.endsWith('-outro.svg'))), 'utf8').replace(/<[^>]+>/g, ' '), /You shipped 3 releases/);
  });

  test('tags on commits outside the window are left out', async () => {
    const r = await generate({ path: app.repo, out: join(root, 'o2'), png: false, since: '2025-03-04', until: '2025-03-12' }, { today: TODAY });
    assert.equal(r.stats.releases.count, 2);
    assert.equal(r.stats.releases.first.name, 'bob-release');
    const late = await generate({ path: app.repo, out: join(root, 'o3'), png: false, since: '2025-03-11' }, { today: TODAY });
    assert.deepEqual(late.stats.releases, { count: 0, tags: 0, first: null, latest: null });
  });

  test('--author keeps only tags on that author\'s commits', async () => {
    const r = await generate({ path: app.repo, out: join(root, 'o4'), png: false, author: 'bob@example.com' }, { today: TODAY });
    assert.deepEqual(r.stats.releases, { count: 1, tags: 1, first: { name: 'bob-release', date: '2025-03-05' }, latest: { name: 'bob-release', date: '2025-03-05' } });
  });

  test('--max-commits keeps only tags on the commits read', async () => {
    const r = await generate({ path: app.repo, out: join(root, 'o5'), png: false, maxCommits: 2 }, { today: TODAY });
    assert.equal(r.stats.releases.count, 1);
    assert.equal(r.stats.releases.tags, 3);
    assert.equal(r.stats.releases.first.name, 'v1.0.0');
  });

  test('multi-repo: a commit shared by two repos keeps both repos\' tags (one release)', async () => {
    const fork = join(root, 'fork');
    git(root, ['clone', '-q', app.repo, fork]);
    git(fork, ['tag', 'v1.1.0', app.hashes[3]]); // only the fork tags the last commit
    const r = await generate({ paths: [app.repo, fork], out: join(root, 'o7'), png: false }, { today: TODAY });
    assert.equal(r.stats.totals.commits, 4);
    assert.equal(r.stats.releases.count, 4);
    assert.deepEqual(r.stats.releases.latest, { name: 'fork/v1.1.0', date: '2025-03-15', repo: 'fork' });
    // Tagged alike in both: named after the first repo's (kept) copy.
    assert.deepEqual(r.stats.releases.first, { name: 'app/v0.1.0', date: '2025-03-01', repo: 'app' });
  });

  test('multi-repo: summed, names repo-prefixed, entries carry repo', async () => {
    const r = await generate({ paths: [app.repo, web.repo], out: join(root, 'o6'), png: false, json: true, md: true }, { today: TODAY });
    assert.deepEqual(r.stats.releases, {
      count: 4,
      tags: 6,
      first: { name: 'app/v0.1.0', date: '2025-03-01', repo: 'app' },
      latest: { name: 'web/v2.0.0', date: '2025-03-20', repo: 'web' },
    });
    assert.match(formatSummary(r.stats, { repoName: 'x', today: TODAY }), /latest: web\/v2\.0\.0/);
  });
});
