// The pre-1.14.0 audit, end to end: (1) the subject length row's long form is now
// "48 · 12% over 72" ("48 · 72 üstü %12"), which fits the card, where "median 48 · 12% over
// 72" never did; (2) dependency bumps recognise composer.json, Pipfile, pubspec.yaml,
// mix.exs, Podfile, flake.nix and Go's vendor/modules.txt; (3) the README and CHANGELOG say
// so. The unit-level pins live in subject-length*.test.js and dep-bumps*.test.js; these go
// through computeStats / buildCards / generate on a real repo.
// Written by the tester of loop turn 093.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { generate } from '../src/cli.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
// Build output only (dist/ is ignored like the hot files): no biggest-commit panel, so the
// messages card has spare room for the subject length row.
const commit = (subject, i, paths = [`dist/${i}.js`]) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject,
  author: 'Ada',
  email: 'ada@example.com',
  files: paths.map((path) => ({ path, added: 3, removed: 1 })),
  parents: ['p'],
});
const statsOf = (subjects) => computeStats(subjects.map((s, i) => commit(s, i + 1)), { today: TODAY });
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const messagesSpec = (stats, lang = 'en') => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === 'messages').spec;
const messagesSvg = (stats, lang = 'en') => buildCards(stats, cardOpts(lang)).find((c) => c.id === 'messages').svg;
const subjectRow = (spec, L) => spec.lines.find((r) => r?.label === L.messages.subjectLengthTitle);

describe('subject length: the long form is drawn on the card', () => {
  // 22 subjects of 48 characters and 3 of 80: median 48, 3 of 25 = 12% over 72, the very
  // example the docs use (the old "median 48 · 12% over 72" was always cut to the short form).
  const subjects = [...Array.from({ length: 22 }, (_, i) => `${String(i).padStart(2, '0')} ${'x'.repeat(45)}`), ...Array.from({ length: 3 }, (_, i) => `${i} ${'y'.repeat(78)}`)];
  const s = statsOf(subjects);

  test('the stat is median 48, 3 commits (12%) over 72', () => {
    assert.deepEqual({ ...s.messages.subjectLength }, { median: 48, over72: 3, share: 0.12 });
  });

  test('en: "48 · 12% over 72" in the spec and in the SVG, no "median" prefix', () => {
    const row = subjectRow(messagesSpec(s), en);
    assert.ok(row, JSON.stringify(messagesSpec(s).lines));
    assert.equal(row.value, '48 · 12% over 72');
    const svg = messagesSvg(s);
    assert.ok(svg.includes('48 · 12% over 72'), 'long form drawn');
    assert.ok(!svg.includes('48 · 12% &gt;72') && !svg.includes('48 · 12% >72'), 'not the short form');
    assert.ok(!svg.includes('median 48'), 'no median prefix');
    assert.match(cardDescription(messagesSpec(s)), /Median subject length: 48 characters; 3 commits over 72 characters \(12% of non-merge commits\)/);
  });

  test('tr: "48 · 72 üstü %12" in the spec and in the SVG', () => {
    const row = subjectRow(messagesSpec(s, 'tr'), tr);
    assert.ok(row, JSON.stringify(messagesSpec(s, 'tr').lines));
    assert.equal(row.value, '48 · 72 üstü %12');
    const svg = messagesSvg(s, 'tr');
    assert.ok(svg.includes('48 · 72 üstü %12'));
    assert.ok(!svg.includes('medyan 48'));
  });

  test('without a subject over 72 the value stays "median N" / "medyan N"', () => {
    const none = statsOf(Array.from({ length: 5 }, (_, i) => `${i} ${'x'.repeat(46)}`));
    for (const [lang, want] of [['en', 'median 48'], ['tr', 'medyan 48']]) {
      assert.equal(subjectRow(messagesSpec(none, lang), LANGS[lang]).value, want);
      assert.ok(messagesSvg(none, lang).includes(want));
    }
  });

  test('a long form is drawn whole for a spread of medians and shares, in both languages', () => {
    for (const [nShort, nLong, shortLen] of [[9, 1, 9], [3, 1, 60], [1, 1, 40], [99, 1, 30], [1, 9, 20]]) {
      const subs = [...Array.from({ length: nShort }, (_, i) => `${i}`.padEnd(shortLen, 'a')), ...Array.from({ length: nLong }, (_, i) => `${i}`.padEnd(90, 'b'))];
      const st = statsOf(subs);
      for (const lang of ['en', 'tr']) {
        const L = LANGS[lang];
        const row = subjectRow(messagesSpec(st, lang), L);
        assert.ok(row, `${lang} ${nShort}/${nLong}/${shortLen}: the row is on the card`);
        assert.match(row.value, lang === 'en' ? /^\d+(\.5)? · (<1|\d+)% over 72$/ : /^\d+(,5)? · 72 üstü %(<1|\d+)$|^\d+(,5)? · 72 üstü <%1$/, `${lang} ${nShort}/${nLong}/${shortLen}: ${row.value}`);
      }
    }
  });
});

describe('dependency bumps: the new manifests, through generate on a real repo', () => {
  const env = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env, ...extra } });
  const at = (day) => ({ GIT_AUTHOR_DATE: `${day}T10:00:00+00:00`, GIT_COMMITTER_DATE: `${day}T10:00:00+00:00` });
  const write = (dir, rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  let root;
  let repo;
  let n = 0;
  const commitFiles = (files, msg) => {
    n += 1;
    for (const f of files) write(repo, f, `v${n} ${f}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg], at(`2026-03-${String(n).padStart(2, '0')}`));
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-audit-114-'));
    repo = join(root, 'app');
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    commitFiles(['src/a.js'], 'initial source'); // not a bump
    commitFiles(['composer.json', 'composer.lock'], 'bump composer deps');
    commitFiles(['Pipfile', 'Pipfile.lock'], 'bump pipenv deps');
    commitFiles(['app/pubspec.yaml', 'app/pubspec.lock'], 'bump flutter deps');
    commitFiles(['mix.exs', 'mix.lock'], 'bump hex deps');
    commitFiles(['ios/Podfile', 'ios/Podfile.lock'], 'pod update');
    commitFiles(['flake.nix', 'flake.lock'], 'nix flake update');
    commitFiles(['go.mod', 'go.sum', 'vendor/modules.txt'], 'go mod vendor');
    commitFiles(['modules.txt'], 'a bare modules.txt is not a manifest'); // not a bump
    commitFiles(['Pipfile', 'src/b.py'], 'manifest plus source'); // not a bump
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('stats.json, wrapped.md and the recap count the seven new-manifest commits (7 of 10)', async () => {
    const r = await generate({ path: repo, out: join(root, 'o1'), png: false, json: true, md: true }, { today: TODAY });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.depBumps, { commits: 7, share: 0.7 });
    assert.match(readFileSync(r.markdown, 'utf8'), /## Dependency bumps\n\n7 commits \\\(70% of non-merge commits\\\)/);
    assert.match(formatSummary(r.stats, { repoName: 'app', today: TODAY }), /Dep bumps\s+7 commits \(70% of non-merge commits\)/);
    // Manifests are not lockfiles: they still count as hot files.
    assert.ok(doc.stats.hotFiles.some((f) => /composer\.json|Pipfile|flake\.nix/.test(f.path)), JSON.stringify(doc.stats.hotFiles));
  });

  test('--exclude drops files first: excluding src/ turns "manifest plus source" into a bump', async () => {
    const x = await generate({ path: repo, out: join(root, 'o2'), png: false, json: true, exclude: ['src/'] }, { today: TODAY });
    const doc = JSON.parse(readFileSync(x.statsJson, 'utf8'));
    assert.equal(doc.stats.depBumps.commits, 8);
  });

  test('excluding vendor/ leaves the go mod vendor commit a bump (go.mod and go.sum)', async () => {
    const x = await generate({ path: repo, out: join(root, 'o3'), png: false, json: true, exclude: ['vendor/'] }, { today: TODAY });
    assert.equal(JSON.parse(readFileSync(x.statsJson, 'utf8')).stats.depBumps.commits, 7);
  });
});

describe('docs', () => {
  const read = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
  const README = read('README.md');
  const CHANGELOG = read('CHANGELOG.md');
  const released = /^## \[1\.14\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(CHANGELOG)?.[1] ?? '';
  const NEW = ['composer.json', 'Pipfile', 'pubspec.yaml', 'mix.exs', 'Podfile', 'flake.nix', 'vendor/modules.txt'];

  test('README and the CHANGELOG [1.14.0] dependency bumps entry name every new manifest', () => {
    const entry = /^- Dependency bumps:[\s\S]*?(?=^- |^### |^## )/m.exec(released)?.[0];
    assert.ok(entry, 'a Dependency bumps entry under [1.14.0]');
    for (const m of NEW) {
      assert.ok(entry.includes(`\`${m}\``), `CHANGELOG: ${m}`);
      assert.ok(README.includes(`\`${m}\``), `README: ${m}`);
    }
  });

  test('the old, never-drawn "median 48 · 12% over 72" is gone; the drawn forms are documented', () => {
    for (const [name, text] of [['README', README], ['CHANGELOG', CHANGELOG]]) {
      assert.ok(!text.includes('median 48 · 12% over 72'), name);
      assert.ok(!text.includes('medyan 48 · 72 üstü: %12'), name);
      assert.ok(text.includes('48 · 12% over 72'), name);
      assert.ok(text.includes('48 · 72 üstü %12'), name);
    }
  });

  test('the documented examples are exactly what the i18n strings produce', () => {
    assert.equal(en.messages.subjectLengthValue(48, 3, '12%'), '48 · 12% over 72');
    assert.equal(tr.messages.subjectLengthValue(48, 3, '%12'), '48 · 72 üstü %12');
    assert.ok(README.includes(`"${en.messages.subjectLengthShort(48, 3, '12%')}"`));
    assert.ok(README.includes(`"${tr.messages.subjectLengthShort(48, 3, '%12')}"`));
  });
});
