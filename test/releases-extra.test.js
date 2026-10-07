// Extra edge cases for releases (tags peeled to the analyzed commits: src/git.js
// parseTagRefs / readTags, src/stats/releases.js, the outro card's optional panel, the
// recap, wrapped.md and stats.json) written by the tester of loop turn 050.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHistories, parseTagRefs, readCommits } from '../src/git.js';
import { computeReleases, computeStats, shownReleases } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, COLOR_THEMES, layoutCard } from '../src/cards/index.js';
import { CALLOUT_NOTE, CARD_WIDTH, CONTENT_BOTTOM, CONTENT_TOP, measureText } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate } from '../src/cli.js';

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

function history(tagsOld = ['v0.1.0'], tagsNew = ['v1.0.0']) {
  return [
    commit('2025-03-20T10:00:00+00:00'),
    commit('2025-03-12T09:00:00+00:00', tagsNew),
    commit('2025-03-05T18:00:00+00:00'),
    commit('2025-03-01T08:00:00+00:00', tagsOld),
  ];
}

const rawTexts = (svg) => [...svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, '') }));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const texts = (svg) => rawTexts(svg).map((t) => decode(t.text));
const outroOf = (stats, opts) => buildCards(stats, { repoName: 'app', today: TODAY, ...opts }).find((c) => c.id === 'outro');

/** Every block inside the content area, none overlapping. */
function assertLayoutInBounds(spec, label) {
  const { blocks } = layoutCard(spec);
  for (const b of blocks) assert.ok(b.top >= CONTENT_TOP - 0.5 && b.bottom <= CONTENT_BOTTOM + 0.5, `${label}: ${b.kind} ${b.top}..${b.bottom}`);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      assert.ok(!(blocks[i].top < blocks[j].bottom && blocks[j].top < blocks[i].bottom), `${label}: blocks ${blocks[i].kind} / ${blocks[j].kind} overlap`);
    }
  }
}

/** Every start-anchored <text> ends inside the card (measureText estimate). */
function assertTextsInside(svg, label) {
  for (const { attrs, text } of rawTexts(svg)) {
    if (/text-anchor/.test(attrs)) continue;
    const x = Number(/\bx="([\d.-]+)"/.exec(attrs)?.[1]);
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(size)) continue;
    const w = measureText(decode(text), size);
    assert.ok(x >= 0 && x + w <= CARD_WIDTH, `${label}: "${decode(text)}" (${x}+${Math.round(w)}) inside the card`);
  }
}

// --- computeReleases / shownReleases ------------------------------------------------

describe('computeReleases (extra)', () => {
  test('odd but valid tag characters are kept as written', () => {
    const odd = ['v1.0.0+build.5', 'release_2025.03', 'sürüm-1', 'v2#hot', 'a/b/c', 'pkg@1.2.3', '@scope/pkg@1.2.3', '日本-1.0'];
    // One commit, one release; all eight tags are counted in `tags`.
    const r = computeReleases([commit('2025-03-01T00:00:00Z', odd)]);
    assert.equal(r.count, 1);
    assert.equal(r.tags, odd.length);
    // Most specific: three version parts with no suffix; then the highest name.
    assert.equal(r.latest.name, 'pkg@1.2.3');
    assert.deepEqual(r.first, r.latest);
    for (const name of odd) {
      assert.equal(computeReleases([commit('2025-03-01T00:00:00Z', [name])]).latest.name, name);
    }
  });

  test('email-shaped names are scrubbed everywhere (stats, recap, md, card), version-after-@ kept', () => {
    const stats = computeStats(history(['ada@example.com'], ['deploy-bob@corp.example.org']), { today: TODAY });
    assert.equal(stats.releases.count, 2);
    assert.deepEqual([stats.releases.first.name, stats.releases.latest.name], ['…', '…']);
    for (const lang of ['en', 'tr']) {
      const outputs = [
        JSON.stringify(stats.releases),
        formatSummary(stats, { repoName: 'app', today: TODAY, lang }),
        buildMarkdown(stats, { repoName: 'app', today: TODAY, lang }),
        texts(outroOf(stats, { lang }).svg).join('\n'),
        outroOf(stats, { lang }).description,
      ];
      for (const o of outputs) {
        assert.doesNotMatch(o, /corp\.example|ada@example|deploy-bob@/, lang);
      }
    }
    // A version after "@" is not an address.
    assert.equal(computeReleases([commit('2025-03-01T00:00:00Z', ['lodash@4.17.21'])]).latest.name, 'lodash@4.17.21');
  });

  test('tag names made only of control / format characters are not counted', () => {
    // Control-only names are dropped (not counted).
    assert.deepEqual(computeReleases([commit('2025-03-01T00:00:00Z', ['\u0007​'])]), { count: 0, tags: 0, first: null, latest: null });
  });

  test('duplicate tag names across repos are kept apart by the repo prefix', () => {
    const r = computeReleases([
      commit('2025-03-10T00:00:00Z', ['v1.0.0'], { repo: 'web' }),
      commit('2025-03-01T00:00:00Z', ['v1.0.0'], { repo: 'api' }),
    ]);
    assert.equal(r.count, 2);
    assert.deepEqual(r.first, { name: 'api/v1.0.0', date: '2025-03-01', repo: 'api' });
    assert.deepEqual(r.latest, { name: 'web/v1.0.0', date: '2025-03-10', repo: 'web' });
  });

  test('same instant in two repos: ties broken by prefixed name (deterministic, input order irrelevant)', () => {
    const a = commit('2025-03-10T00:00:00Z', ['v1'], { repo: 'zeta' });
    const b = commit('2025-03-10T00:00:00Z', ['v1'], { repo: 'alpha' });
    assert.deepEqual(computeReleases([a, b]), computeReleases([b, a]));
    assert.equal(computeReleases([a, b]).first.name, 'alpha/v1');
    assert.equal(computeReleases([a, b]).latest.name, 'zeta/v1');
  });

  test('a blank repo label is treated as single-repo (no prefix, no repo field)', () => {
    const r = computeReleases([commit('2025-03-10T00:00:00Z', ['v1'], { repo: '  ' })]);
    assert.deepEqual(r.latest, { name: 'v1', date: '2025-03-10' });
  });

  test('shape is stable: exactly {count, tags, first, latest}, and first/latest exactly {name, date}', () => {
    for (const commits of [[], history(), history([], ['only'])]) {
      const r = computeReleases(commits);
      assert.deepEqual(Object.keys(r), ['count', 'tags', 'first', 'latest']);
      for (const e of [r.first, r.latest]) if (e) assert.deepEqual(Object.keys(e), ['name', 'date']);
    }
    const multi = computeReleases([commit('2025-03-10T00:00:00Z', ['v1'], { repo: 'web' })]);
    assert.deepEqual(Object.keys(multi.latest), ['name', 'date', 'repo']);
  });

  test('computeReleases never mutates its input', () => {
    const commits = history(['b', 'a'], ['v1']);
    const snap = JSON.stringify(commits);
    computeReleases(commits);
    assert.equal(JSON.stringify(commits), snap);
  });

  test('shownReleases tolerates odd shapes: fractional / negative / Infinity counts', () => {
    assert.equal(shownReleases({ count: -3, latest: { name: 'v1' } }), null);
    assert.equal(shownReleases({ count: Infinity }), null);
    assert.equal(shownReleases({ count: 0.5 }), null);
    assert.deepEqual(shownReleases({ count: 2.9, latest: { name: 'v1', date: '2025-01-01' } }), { count: 2, latest: { name: 'v1', date: '2025-01-01' } });
    assert.deepEqual(shownReleases({ count: 1, latest: 'v1' }), { count: 1, latest: null });
    assert.equal(shownReleases(undefined), null);
    assert.equal(shownReleases('5'), null);
  });
});

// --- parseTagRefs --------------------------------------------------------------------

describe('parseTagRefs (extra)', () => {
  const h = (c) => c.repeat(40);
  test('CRLF output, uppercase hashes, sha256 hashes, and ^{} before its own line', () => {
    const out = [
      `${h('A')} refs/tags/upper\r`,
      `${h('b')} refs/tags/ann^{}`,
      `${h('c')} refs/tags/ann`,
      `${'d'.repeat(64)} refs/tags/sha256`,
      `${h('e')} refs/tags/a^{}x`, // never a valid git ref; not a peeled line either
    ].join('\n');
    const m = parseTagRefs(out);
    assert.equal(m.get('upper'), h('a'));
    assert.equal(m.get('ann'), h('b'), 'the peeled hash wins even when listed first');
    assert.equal(m.get('sha256'), 'd'.repeat(64));
  });

  test('lines with leading spaces or other ref namespaces are ignored', () => {
    const out = [` ${h('a')} refs/tags/x`, `${h('a')} refs/remotes/origin/v1`, `${h('a')}  refs/tags/y`].join('\n');
    assert.equal(parseTagRefs(out).size, 0);
  });
});

// --- outro card -----------------------------------------------------------------------

describe('outro releases panel (extra)', () => {
  const longNames = [
    `release-${'x'.repeat(200)}`,
    `v${'1.'.repeat(80)}0`,
    'ŞĞÜİÇÖ'.repeat(30),
    'W'.repeat(150),
    '日本語のリリース'.repeat(15),
    `a${'-'.repeat(150)}`,
  ];

  test('very long tag names fit the note line in both languages and every theme, day intact', () => {
    for (const name of longNames) {
      const stats = computeStats(history([], [name]), { today: TODAY });
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of Object.keys(COLOR_THEMES)) {
          const label = `${name.slice(0, 12)}/${lang}/${colorTheme}`;
          const spec = buildCardSpecs(stats, { repoName: 'app', today: TODAY, lang, colorTheme }).find((c) => c.id === 'outro').spec;
          assert.ok(Array.isArray(spec.chart), label);
          const note = spec.chart[1].note;
          assert.ok(measureText(note, CALLOUT_NOTE.size) <= CALLOUT_NOTE.maxWidth, `${label}: note too wide: ${note}`);
          assert.match(note, /…/, label);
          assert.match(note, lang === 'en' ? / · Mar 12, 2025$/ : / · 12 Mar 2025$/, `${label}: ${note}`);
          assertLayoutInBounds(spec, label);
          const card = outroOf(stats, { lang, colorTheme });
          assertTextsInside(card.svg, label);
          assert.ok(texts(card.svg).includes(note), `${label}: note rendered as is`);
        }
      }
    }
  });

  test('a name that exactly fits is not cut', () => {
    const stats = computeStats(history([], ['v1.0.0']), { today: TODAY });
    const note = buildCardSpecs(stats, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro').spec.chart[1].note;
    assert.equal(note, 'Latest: v1.0.0 · Mar 12, 2025');
  });

  test('multi-repo long label + long tag still fits', () => {
    const c = commit('2025-03-12T09:00:00+00:00', [`v${'9'.repeat(60)}`], { repo: 'a-very-long-repository-label-indeed' });
    const stats = computeStats([c, commit('2025-03-01T00:00:00Z', null, { repo: 'web' })], { today: TODAY, repos: ['a-very-long-repository-label-indeed', 'web'] });
    for (const lang of ['en', 'tr']) {
      const spec = buildCardSpecs(stats, { repoName: '2 repos', today: TODAY, lang }).find((x) => x.id === 'outro').spec;
      const panel = Array.isArray(spec.chart) ? spec.chart[1] : null;
      assert.ok(panel, lang);
      assert.ok(measureText(panel.note, CALLOUT_NOTE.size) <= CALLOUT_NOTE.maxWidth, panel.note);
      // Cut in the middle: the repo label's start and the tag's end both show.
      assert.match(panel.note, /^(Latest|Son sürüm): a-very-.*…9+ · /);
      assertLayoutInBounds(spec, lang);
    }
  });

  test('releases with an undated latest: the note has no day and no dangling separator', () => {
    const stats = computeStats([commit('2025-03-01T00:00:00Z'), commit('not a date', ['v9'])], { today: TODAY });
    const spec = buildCardSpecs(stats, { repoName: 'app', today: TODAY }).find((c) => c.id === 'outro').spec;
    assert.ok(Array.isArray(spec.chart));
    assert.equal(spec.chart[1].note, 'Latest: v9');
    assert.match(formatSummary(stats, { repoName: 'app', today: TODAY }), /Releases\s+1 release · latest: v9\n/);
    assert.match(buildMarkdown(stats, { repoName: 'app', today: TODAY }), /\*\*Releases:\*\* 1 release, latest: v9\n/);
  });

  test('the panel shows for common repo names (10+ characters, e.g. "gitwrapped")', () => {
    const stats = computeStats(history([], ['v1.0.0']), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      for (const repoName of ['gitwrapped', 'my-project']) {
        const spec = buildCardSpecs(stats, { repoName, today: TODAY, lang }).find((c) => c.id === 'outro').spec;
        assert.ok(Array.isArray(spec.chart), `${lang}/${repoName}`);
        assert.match(outroOf(stats, { repoName, lang }).svg, /RELEASES|SÜRÜMLER/, `${lang}/${repoName}`);
      }
    }
  });

  test('XML-special characters in a tag name are escaped in the SVG', () => {
    // Not valid in git ref names except & — but stats.json can be hand-written.
    const stats = { ...computeStats(history([], []), { today: TODAY }), releases: { count: 1, first: null, latest: { name: 'v1&<b>"x"', date: '2025-03-12' } } };
    const card = outroOf(stats);
    assert.doesNotMatch(card.svg, /<b>/);
    assert.ok(texts(card.svg).some((t) => t.startsWith('Latest: v1&<b>"x"')));
  });
});

// --- recap / wrapped.md ---------------------------------------------------------------

describe('recap and wrapped.md (extra)', () => {
  test('count 0 or a junk stat → no Releases line in either language', () => {
    const base = computeStats(history([], []), { today: TODAY });
    for (const releases of [{ count: 0, first: null, latest: null }, undefined, null, { count: 'x' }]) {
      const s = { ...base, releases };
      assert.doesNotMatch(formatSummary(s, { repoName: 'app', today: TODAY }), /Releases/);
      assert.doesNotMatch(formatSummary(s, { repoName: 'app', today: TODAY, lang: 'tr' }), /Sürümler/);
      assert.doesNotMatch(buildMarkdown(s, { repoName: 'app', today: TODAY }), /Releases/);
      assert.doesNotMatch(buildMarkdown(s, { repoName: 'app', today: TODAY, lang: 'tr' }), /Sürümler/);
    }
  });

  test('markdown escapes special characters in tag names', () => {
    const stats = computeStats(history([], ['v1_*beta*_[x](y)']), { today: TODAY });
    const md = buildMarkdown(stats, { repoName: 'app', today: TODAY });
    const line = md.split('\n').find((l) => l.includes('**Releases:**'));
    assert.ok(line, md);
    assert.doesNotMatch(line, /latest: v1_\*beta/);
    assert.doesNotMatch(line, /\[x\]\(y\)/);
  });

  test('recap strips control / escape characters from a hand-written latest name', () => {
    const base = computeStats(history([], []), { today: TODAY });
    const s = { ...base, releases: { count: 1, first: null, latest: { name: 'v1\u001b[31mred', date: '2025-03-12' } } };
    const recap = formatSummary(s, { repoName: 'app', today: TODAY });
    assert.ok(!recap.includes('\u001b'));
  });

  test('a long name is shortened in the recap; one count, tr plural', () => {
    const stats = computeStats(history([], [`v${'x'.repeat(200)}`]), { today: TODAY });
    const line = formatSummary(stats, { repoName: 'app', today: TODAY }).split('\n').find((l) => l.includes('Releases'));
    assert.ok(line.length < 140, line);
    assert.match(formatSummary(stats, { repoName: 'app', today: TODAY, lang: 'tr' }), /Sürümler\s+1 sürüm · son: /);
  });
});

// --- real repos ---------------------------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('git and generate (extra, real repos)', () => {
  let root;
  const ada = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  /** A repo with one commit per [date, file] entry; returns {repo, hashes} (oldest first). */
  const make = (name, entries) => {
    const repo = join(root, name);
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    git(repo, ['config', 'tag.gpgsign', 'false']);
    const hashes = [];
    for (const [i, [date, file]] of entries.entries()) {
      const f = file ?? `f${i}.txt`;
      mkdirSync(join(repo, f, '..'), { recursive: true });
      writeFileSync(join(repo, f), `${i}\n`);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', `feat: change ${i}`], { ...ada, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      hashes.push(git(repo, ['rev-parse', 'HEAD']).trim());
    }
    return { repo, hashes };
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-releases-extra-'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('odd tag characters and unicode survive show-ref; packed refs are read too', async () => {
    const { repo, hashes } = make('odd', [['2025-03-01T10:00:00+00:00'], ['2025-03-05T10:00:00+00:00']]);
    const names = ['v1.0.0+build.5', 'sürüm-1', 'pkg@1.2.3', 'nested/dir/v2', 'release_2025.03', 'ada@example.com'];
    for (const t of names) git(repo, ['tag', t, hashes[0]]);
    git(repo, ['tag', 'packed-one', hashes[1]]);
    git(repo, ['pack-refs', '--all']);
    git(repo, ['tag', 'loose-one', hashes[1]]);
    const commits = await readCommits(repo);
    const tagsOf = Object.fromEntries(commits.map((c) => [c.hash, c.tags]));
    assert.deepEqual(tagsOf[hashes[0]], [...names].sort());
    assert.deepEqual(tagsOf[hashes[1]], ['loose-one', 'packed-one']);
    const r = computeReleases(commits);
    assert.equal(r.count, 2);
    assert.equal(r.tags, 8);
    assert.ok(!JSON.stringify(r).includes('example.com'));
  });

  test('a tag on a commit whose files are all --exclude\'d still counts (commits still count)', async () => {
    const { repo, hashes } = make('excl', [['2025-03-01T10:00:00+00:00', 'src/a.js'], ['2025-03-05T10:00:00+00:00', 'dist/bundle.js']]);
    git(repo, ['tag', 'v1.0.0', hashes[1]]);
    const out = join(root, 'o-excl');
    const r = await generate({ path: repo, out, png: false, json: true, exclude: ['dist/**'] }, { today: TODAY });
    assert.equal(r.stats.totals.commits, 2);
    assert.deepEqual(r.stats.releases, { count: 1, tags: 1, first: { name: 'v1.0.0', date: '2025-03-05' }, latest: { name: 'v1.0.0', date: '2025-03-05' } });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.releases, r.stats.releases);
    assert.deepEqual(doc.filters.exclude, ['dist/**']);
  });

  test('--year: releases of that year only; tags in the previous year are not counted (en and tr)', async () => {
    const { repo, hashes } = make('yearly', [
      ['2024-06-01T10:00:00+00:00'],
      ['2025-02-01T10:00:00+00:00'],
      ['2025-05-01T10:00:00+00:00'],
    ]);
    git(repo, ['tag', 'v0.9.0', hashes[0]]);
    git(repo, ['tag', 'v1.0.0', hashes[1]]);
    git(repo, ['tag', 'v1.1.0', hashes[2]]);
    for (const lang of ['en', 'tr']) {
      const out = join(root, `o-year-${lang}`);
      const r = await generate({ path: repo, out, png: false, json: true, md: true, year: '2025', since: '2025-01-01', until: '2025-12-31', lang }, { today: '2025-10-01' });
      assert.deepEqual(r.stats.releases, { count: 2, tags: 2, first: { name: 'v1.0.0', date: '2025-02-01' }, latest: { name: 'v1.1.0', date: '2025-05-01' } }, lang);
      assert.ok(r.stats.yearOverYear, 'the previous year has commits: comparison present');
      const md = readFileSync(r.markdown, 'utf8');
      assert.match(md, lang === 'en' ? /\*\*Releases:\*\* 2 releases, latest: v1\.1\.0 \(May 1, 2025\)/ : /\*\*Sürümler:\*\* 2 sürüm, son sürüm: v1\.1\.0 \(1 May 2025\)/, md);
      const recap = formatSummary(r.stats, { repoName: 'yearly', today: '2025-10-01', lang, since: '2025-01-01', until: '2025-12-31' });
      assert.match(recap, lang === 'en' ? /Releases\s+2 releases · latest: v1\.1\.0 \(May 1, 2025\)/ : /Sürümler\s+2 sürüm · son: v1\.1\.0 \(1 May 2025\)/, recap);
      // Whether the panel fits beside the year-over-year sentence or not, the card stays in bounds.
      const spec = buildCardSpecs(r.stats, { repoName: 'yearly', since: '2025-01-01', until: '2025-12-31', today: '2025-10-01', lang }).find((c) => c.id === 'outro').spec;
      assertLayoutInBounds(spec, `year/${lang}`);
    }
  });

  test('--year with no previous-year commits: the outro panel shows (en and tr)', async () => {
    const { repo, hashes } = make('yearly-new', [['2025-02-01T10:00:00+00:00'], ['2025-05-01T10:00:00+00:00']]);
    git(repo, ['tag', 'v1.0.0', hashes[1]]);
    for (const lang of ['en', 'tr']) {
      const r = await generate({ path: repo, out: join(root, `o-ynew-${lang}`), png: false, year: '2025', since: '2025-01-01', until: '2025-12-31', lang }, { today: '2025-10-01' });
      assert.equal(r.stats.yearOverYear ?? null, null);
      // The panel shows whatever the repo name (see the common-names test above).
      const t = texts(buildCards(r.stats, { repoName: 'app', since: '2025-01-01', until: '2025-12-31', today: '2025-10-01', lang }).find((c) => c.id === 'outro').svg);
      assert.ok(t.includes(lang === 'en' ? 'You shipped 1 release' : '1 sürüm yayınladın'), t.join(' | '));
    }
  });

  test('multi-repo with the same tag name in two repos: both counted, prefixed', async () => {
    const a = make('dup-a', [['2025-03-01T10:00:00+00:00']]);
    const b = make('dup-b', [['2025-03-08T10:00:00+00:00']]);
    git(a.repo, ['tag', 'v1.0.0', a.hashes[0]]);
    git(b.repo, ['tag', 'v1.0.0', b.hashes[0]]);
    const r = await generate({ paths: [a.repo, b.repo], out: join(root, 'o-dup'), png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.stats.releases, {
      count: 2,
      tags: 2,
      first: { name: 'dup-a/v1.0.0', date: '2025-03-01', repo: 'dup-a' },
      latest: { name: 'dup-b/v1.0.0', date: '2025-03-08', repo: 'dup-b' },
    });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.releases, r.stats.releases);
  });

  test('paths with spaces and non-ASCII characters (Windows-style folder names) work', async () => {
    const { repo, hashes } = make('My Projects/çalışma alanı (1)', [['2025-03-01T10:00:00+00:00']]);
    git(repo, ['tag', 'v1.0.0', hashes[0]]);
    const commits = await readCommits(repo);
    assert.deepEqual(commits[0].tags, ['v1.0.0']);
    const r = await generate({ path: repo, out: join(root, 'out dir', 'çıktı'), png: false, json: true }, { today: TODAY });
    assert.equal(r.stats.releases.count, 1);
  });

  test('stats.json releases shape is stable: present with count 0 when there are no tags', async () => {
    const { repo } = make('notags', [['2025-03-01T10:00:00+00:00']]);
    const r = await generate({ path: repo, out: join(root, 'o-none'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.releases, { count: 0, tags: 0, first: null, latest: null });
    assert.doesNotMatch(readFileSync(r.markdown, 'utf8'), /Releases/);
    assert.doesNotMatch(formatSummary(r.stats, { repoName: 'notags', today: TODAY }), /Releases/);
  });
});

// --- mergeHistories: tags survive the merge ------------------------------------------

describe('mergeHistories keeps tags', () => {
  test('tags are carried through, alongside the repo label', () => {
    const { commits } = mergeHistories([{ label: 'api', commits: [commit('2025-03-01T00:00:00Z', ['v1'])] }]);
    assert.deepEqual(commits[0].tags, ['v1']);
    assert.equal(computeReleases(commits).latest.name, 'api/v1');
  });
});
