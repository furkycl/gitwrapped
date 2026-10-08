// Extra edge cases for cleanup commits (src/stats/cleanups.js, stats.cleanups): binary
// files, renames, deletions only in ignored files, --exclude, --author, multi-repo runs
// (repo-relative ignore rules), huge numbers (thousands separators en / tr, the "−" sign),
// emoji / RTL / bidi / `<&>` / very long subjects (rows drawn whole, SVG escaped), emails
// scrubbed, stats.json exact keys, cards byte-identical without cleanups, and the shown
// share ("<1%", never "100%" short of every commit). End-to-end parts run the CLI on real
// temporary repos (Windows-safe file names only).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCleanups, computeStats, shownCleanups } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cardDescription, cleanupShareText } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { getStrings } from '../src/i18n/index.js';

const TODAY = '2026-04-01';
const EN = getStrings('en');
const TR = getStrings('tr');
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, added, removed, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `chore: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added, removed }],
  parents: ['p'],
  ...extra,
});
const many = (n, k) => Array.from({ length: n }, (_, i) => (i < k ? commit(i, 0, 2) : commit(i, 2, 0)));
const stats = (commits) => computeStats(commits, { today: TODAY });
const specs = (s, lang = 'en') => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang });
const svgs = (s, lang = 'en') => buildCards(s, { repoName: 'demo', today: TODAY, lang }).map((c) => c.svg);
const allRows = (s, lang = 'en') => specs(s, lang).flatMap((c) => c.spec.lines ?? []);
const row = (s, label, lang = 'en') => allRows(s, lang).find((r) => r.label === label);
const shareOf = (commits, L = EN) => cleanupShareText(shownCleanups(computeCleanups(commits)), L);

/** Every `&` in an SVG starts an entity, and no text node holds a raw `<`/`>`. */
function assertWellEscaped(svg) {
  assert.doesNotMatch(svg, /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/, 'unescaped & in SVG');
  for (const m of svg.matchAll(/>([^<]*)</g)) assert.ok(!m[1].includes('>'), `raw > in text: ${m[1]}`);
}

describe('computeCleanups: extra unit edge cases', () => {
  test('binary files (0 / 0 or "-" counts) add nothing; a binary-only deletion is not a cleanup', () => {
    const bin = { ...commit(1, 0, 0), files: [{ path: 'logo.png', added: 0, removed: 0, binary: true }] };
    assert.equal(computeCleanups([bin]), null);
    const dash = { ...commit(2, 0, 0), files: [{ path: 'logo.png', added: '-', removed: '-' }] };
    assert.equal(computeCleanups([dash]), null);
    // A binary next to a text deletion: only the text lines count.
    const mixed = { ...commit(3, 0, 0), files: [{ path: 'logo.png', added: 0, removed: 0, binary: true }, { path: 'src/a.js', added: 1, removed: 4 }] };
    assert.deepEqual({ ...computeCleanups([mixed]).biggest, hash: null }, { hash: null, subject: 'chore: change 3', date: '2026-03-04', linesAdded: 1, linesRemoved: 4, net: 3 });
    // The binary commits still count in the share.
    assert.equal(computeCleanups([bin, dash, mixed]).share, 0.333);
  });

  test('a rename (delete + add of the same lines) is not a cleanup; a rename that also trims is', () => {
    const rename = { ...commit(1, 0, 0), files: [{ path: 'src/old.js', added: 0, removed: 40 }, { path: 'src/new.js', added: 40, removed: 0 }] };
    assert.equal(computeCleanups([rename]), null);
    const trim = { ...commit(2, 0, 0), files: [{ path: 'src/old.js', added: 0, removed: 40 }, { path: 'src/new.js', added: 30, removed: 0 }] };
    assert.equal(computeCleanups([trim]).biggest.net, 10);
  });

  test('deletions only in ignored files never make a cleanup (lockfiles, dist/, node_modules, vendored, minified)', () => {
    const paths = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'dist/app.js', 'build/x.js', 'node_modules/a/i.js', 'packages/x/node_modules/y/i.js', 'vendor/lib.js', 'src/app.min.js'];
    const commits = paths.map((path, i) => ({ ...commit(i, 0, 0), files: [{ path, added: 0, removed: 500 }, { path: 'src/a.js', added: 1, removed: 0 }] }));
    assert.equal(computeCleanups(commits), null, JSON.stringify(computeCleanups(commits)));
  });

  test('multi-repo: ignore rules are checked from each repo root (a repo labelled "dist" or "node_modules" counts)', () => {
    const c = computeCleanups([
      { ...commit(1, 0, 0), repo: 'dist', files: [{ path: 'dist/src/a.js', added: 0, removed: 9 }] },
      { ...commit(2, 0, 0), repo: 'node_modules', files: [{ path: 'node_modules/src/b.js', added: 0, removed: 4 }] },
      { ...commit(3, 0, 0), repo: 'app', files: [{ path: 'app/dist/a.js', added: 0, removed: 90 }, { path: 'app/package-lock.json', added: 0, removed: 90 }] },
    ]);
    assert.equal(c.commits, 2);
    assert.equal(c.biggest.net, 9);
    assert.equal(c.share, 0.667);
  });

  test('huge counts: summed exactly; not mutated; JSON keys exactly {commits, share, biggest} and the biggest keys', () => {
    const big = { ...commit(1, 0, 0), files: [{ path: 'a.js', added: 1, removed: 5_000_000 }, { path: 'b.js', added: 0, removed: 4_000_000_000 }] };
    const c = computeCleanups([big]);
    assert.equal(c.biggest.net, 4_004_999_999);
    assert.equal(c.share, 1);
    const json = JSON.parse(JSON.stringify(c));
    assert.deepEqual(Object.keys(json), ['commits', 'share', 'biggest']);
    assert.deepEqual(Object.keys(json.biggest), ['hash', 'subject', 'date', 'linesAdded', 'linesRemoved', 'net']);
  });

  test('the share is never 1 short of every commit, at any size', () => {
    for (const n of [2, 3, 999, 1000, 1001, 5000]) {
      const c = computeCleanups(many(n, n - 1));
      assert.ok(c.share < 1, `${n}: ${c.share}`);
      assert.notEqual(shareOf(many(n, n - 1)), '100%', String(n));
      assert.notEqual(cleanupShareText(shownCleanups(JSON.parse(JSON.stringify(c)))), '100%', `${n} json`);
    }
    // A merge alongside never makes the share less than 1 when every non-merge commit is a cleanup.
    assert.equal(computeCleanups([...many(4, 4), commit(9, 9, 0, { parents: ['a', 'b'] })]).share, 1);
    assert.equal(shareOf([...many(4, 4), commit(9, 9, 0, { parents: ['a', 'b'] })]), '100%');
    assert.equal(shareOf(many(4, 4), TR), '%100');
  });

  test('shown share: "<1%" below a half percent, "1%" from a half percent; tr "<%1" / "%1"; never "0%"', () => {
    assert.equal(shareOf(many(1000, 4)), '<1%');
    assert.equal(shareOf(many(1000, 4), TR), '<%1');
    assert.equal(shareOf(many(1000, 5)), '1%');
    assert.equal(shareOf(many(150, 1)), '1%');
    assert.equal(shareOf(many(150, 1), TR), '%1');
    assert.equal(shareOf(many(201, 1)), '<1%');
    for (const n of [300, 1000, 10000]) assert.notEqual(shareOf(many(n, 1)), '0%');
    assert.equal(shareOf(many(200, 199)), '99%');
  });
});

describe('outputs: numbers, subjects, escaping', () => {
  const evilSubject = `refactor: <b>&amp; "x" 'y' 🧹👩‍💻 مرحبا بالعالم ${'very long '.repeat(80)} ada@example.com`;
  const s = stats([commit(1, 100, 5), commit(2, 3, 1_234_570, { subject: evilSubject }), commit(3, 10, 20), commit(4, 50, 1)]);

  test('stats: the email is scrubbed; the subject keeps the rest', () => {
    assert.equal(s.cleanups.biggest.net, 1_234_567);
    assert.ok(!s.cleanups.biggest.subject.includes('ada@example.com'));
    assert.ok(s.cleanups.biggest.subject.startsWith('refactor: <b>&amp; "x"'));
    assert.ok(s.cleanups.biggest.subject.endsWith('…'));
  });

  test('card rows: thousands separators (en "," / tr "."), the "−" sign (U+2212), drawn whole, no subject on the row', () => {
    for (const [lang, L, re] of [['en', EN, /^−1,234,567 lines/], ['tr', TR, /^−1\.234\.567 satır/]]) {
      const big = row(s, L.totals.biggestCleanup, lang);
      assert.ok(big, lang);
      assert.match(big.value, re);
      assert.ok(!big.value.includes('-'), `ASCII minus in ${big.value}`);
      assert.ok(!big.value.includes('…'), `row value ellipsized: ${big.value}`);
      assert.ok(rowFits(big), big.value);
      const count = row(s, L.totals.cleanups, lang);
      assert.ok(count && rowFits(count));
      // The subject is only in the description, scrubbed and clipped.
      assert.ok(big.description.includes('🧹👩‍💻 مرحبا'));
      assert.ok(!big.description.includes('ada@example.com'));
      assert.ok([...big.description].length < 700, String(big.description.length));
    }
  });

  test('SVG: well escaped; no raw `<b>` or email; cleanup rows present; card descriptions carry no email', () => {
    for (const lang of ['en', 'tr']) {
      const all = svgs(s, lang);
      for (const svg of all) {
        assertWellEscaped(svg);
        assert.ok(!svg.includes('<b>'));
        assert.ok(!svg.includes('ada@example.com'));
      }
      assert.ok(all.some((svg) => svg.includes(lang === 'en' ? 'Biggest cleanup' : 'En büyük temizlik')), lang);
      for (const c of specs(s, lang)) assert.ok(!cardDescription({ ...c.spec, lang }).includes('ada@example.com'), c.id);
    }
  });

  test('recap: separators, the "−" sign, subject clipped, email scrubbed, en / tr', () => {
    const en = formatSummary(s, { repoName: 'demo', today: TODAY }).split('\n').find((l) => l.includes('Cleanups'));
    assert.match(en, /\(−1,234,567 lines · Mar 3, 2026\)$/);
    assert.match(en, /biggest "refactor: <b>&amp; .*…"/);
    assert.ok(!en.includes('ada@example.com'));
    const tr = formatSummary(s, { repoName: 'demo', today: TODAY, lang: 'tr' }).split('\n').find((l) => l.includes('Temizlikler'));
    assert.match(tr, /\(−1\.234\.567 satır · 3 Mar 2026\)$/);
  });

  test('wrapped.md: `<&>` escaped, separators, the "−" sign, email scrubbed', () => {
    const md = buildMarkdown(s, { repoName: 'demo', today: TODAY });
    const line = md.split('\n')[md.split('\n').indexOf('## Cleanups') + 2];
    assert.ok(line.includes('\\<b\\>\\&amp;'), line);
    assert.ok(line.endsWith('· −1,234,567 lines (Mar 3, 2026)'), line);
    assert.ok(!md.includes('ada@example.com'));
    const tr = buildMarkdown(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.ok(tr.includes('· −1.234.567 satır (3 Mar 2026)'));
  });

  test('bidi / control characters never reach the recap, wrapped.md or card descriptions; a bidi-only subject reads as none', () => {
    const bidi = stats([commit(1, 0, 9, { subject: '‮evil‬\x1b[31m' }), commit(2, 3, 0)]);
    const recap = formatSummary(bidi, { repoName: 'demo', today: TODAY });
    const md = buildMarkdown(bidi, { repoName: 'demo', today: TODAY });
    const desc = row(bidi, EN.totals.biggestCleanup).description;
    for (const out of [recap, md, desc]) assert.doesNotMatch(out, /[‪-‮⁦-⁩\x1b]/);
    assert.ok(desc.includes('evil'));
    const only = stats([commit(1, 0, 9, { subject: '‮⁦' }), commit(2, 3, 0)]);
    assert.match(formatSummary(only, { repoName: 'demo', today: TODAY }), /biggest \(no subject\) \(−9 lines/);
    assert.ok(buildMarkdown(only, { repoName: 'demo', today: TODAY }).includes('biggest: \\(no subject\\) · −9 lines'));
    assert.equal(row(only, EN.totals.biggestCleanup).description, 'Biggest cleanup: −9 lines on Mar 2, 2026');
  });

  test('a single cleanup reads "1 commit" (singular), en / tr', () => {
    const one = stats([commit(1, 0, 9), commit(2, 3, 0)]);
    assert.equal(row(one, EN.totals.cleanups).value, '1 commit · 50%');
    assert.equal(row(one, TR.totals.cleanups, 'tr').value, '1 commit · %50');
    assert.match(formatSummary(one, { repoName: 'demo', today: TODAY }), /Cleanups {5}1 commit \(50% of non-merge commits\)/);
  });

  test('every card byte-identical with cleanups null / absent, en / tr, also for a history that sends the rows to the messages card', () => {
    const histories = [
      s,
      { ...s, fileLifecycle: { added: 3, deleted: 1 }, merges: { commits: 2, share: 0.3, pullRequests: 0 } },
    ];
    for (const h of histories) {
      for (const lang of ['en', 'tr']) {
        const ref = svgs({ ...h, cleanups: null }, lang);
        const absent = { ...h };
        delete absent.cleanups;
        assert.deepEqual(svgs(absent, lang), ref);
        assert.deepEqual(svgs({ ...h, cleanups: 'junk' }, lang), ref);
        assert.deepEqual(svgs({ ...h, cleanups: { commits: -1, share: 0.5 } }, lang), ref);
        // With cleanups exactly one card changes (totals or messages, never both).
        const changed = svgs(h, lang).filter((svg, i) => svg !== ref[i]);
        assert.ok(changed.length <= 1, `${lang}: ${changed.length} cards changed`);
      }
    }
  });
});

describe('end to end (real repos via the CLI)', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const base = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const ADA = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' };
  const BOB = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@example.com', GIT_COMMITTER_NAME: 'Bob', GIT_COMMITTER_EMAIL: 'bob@example.com' };
  const git = (cwd, args, extra = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...base, ...ADA, ...extra } });
  let root;
  let day = 1;
  const at = () => {
    const d = `2025-05-${String(day++).padStart(2, '0')}T10:00:00+00:00`;
    return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d };
  };
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + (n > 0 ? '\n' : '');
  const write = (dir, path, n, tag = 'x') => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), lines(n, tag));
  };
  const commitAll = (dir, msg, who = ADA) => {
    git(dir, ['add', '-A', '-f']);
    git(dir, ['commit', '-q', '-m', msg], { ...who, ...at() });
  };
  const init = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };
  let n = 0;
  const run = (args) => {
    const out = join(root, `out${n++}`);
    const res = spawnSync(process.execPath, [BIN, ...args, '--out', out, '--no-png', '--no-color', '--json', '--md'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const files = readdirSync(join(out, 'cards')).filter((f) => f.endsWith('.svg'));
    for (const f of files) assert.match(f, /^[^<>:"|?*]+$/);
    const cards = files.map((f) => readFileSync(join(out, 'cards', f), 'utf8'));
    return { stdout: res.stdout, json, cleanups: json.stats.cleanups, md, cards, svg: cards.join('\n') };
  };

  let main;
  let alpha;
  let dist;
  const LONG = `refactor: drop <legacy> & "old" parser 🧹 مرحبا ${'and more '.repeat(30)}(bob@example.com)`;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-cleanups-x-'));
    main = init('main');
    // 1: code, a binary, a lockfile and build output.
    write(main, 'src/app.js', 60, 'a');
    writeFileSync(join(main, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3, 0, 255, 0, 7]));
    write(main, 'package-lock.json', 400, 'l');
    write(main, 'dist/app.js', 300, 'd');
    commitAll(main, 'feat: start');
    // 2: only the binary is deleted ("-" counts): not a cleanup.
    rmSync(join(main, 'logo.png'));
    commitAll(main, 'chore: drop the logo');
    // 3: only ignored files shrink, plus one added line: not a cleanup.
    write(main, 'package-lock.json', 5, 'l');
    write(main, 'dist/app.js', 0, 'd');
    write(main, 'src/app.js', 61, 'a');
    commitAll(main, 'chore: rebuild');
    // 4: a pure rename (read with --no-renames: delete 61 + add 61): not a cleanup.
    git(main, ['mv', 'src/app.js', 'src/core.js']);
    commitAll(main, 'refactor: rename app to core');
    // 5: Ada's cleanup: 61 → 11 lines (−50), with a long, odd subject.
    write(main, 'src/core.js', 11, 'a');
    commitAll(main, LONG);
    // 6: Bob's cleanup: −80 in his own file (added first, by Bob).
    write(main, 'lib/bob.js', 90, 'b');
    commitAll(main, 'feat: bob adds', BOB);
    write(main, 'lib/bob.js', 10, 'b');
    commitAll(main, 'chore: bob trims', BOB);

    // Multi-repo: a repo called "dist" (its own files count) and "alpha" (its dist/ does not).
    dist = init('dist');
    write(dist, 'src/x.js', 30);
    commitAll(dist, 'feat: x');
    write(dist, 'src/x.js', 10);
    commitAll(dist, 'chore: trim x');
    alpha = init('alpha');
    write(alpha, 'src/y.js', 5);
    write(alpha, 'dist/y.js', 500);
    commitAll(alpha, 'feat: y');
    write(alpha, 'dist/y.js', 0);
    write(alpha, 'src/y.js', 6);
    commitAll(alpha, 'chore: clean build');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('binary, ignored-only and rename commits are not cleanups; stats.json exact keys; Bob wins the biggest', () => {
    const r = run([main]);
    // Non-merge commits: 7; cleanups: Ada's −50 and Bob's −80.
    assert.deepEqual(Object.keys(r.cleanups), ['commits', 'share', 'biggest']);
    assert.deepEqual(Object.keys(r.cleanups.biggest), ['hash', 'subject', 'date', 'linesAdded', 'linesRemoved', 'net']);
    assert.equal(r.cleanups.commits, 2);
    assert.equal(r.cleanups.share, 0.286);
    const { hash, ...big } = r.cleanups.biggest;
    assert.match(hash, /^[0-9a-f]{40}$/);
    assert.deepEqual(big, { subject: 'chore: bob trims', date: '2025-05-07', linesAdded: 0, linesRemoved: 80, net: 80 });
    assert.match(r.stdout, /2 commits \(29% of non-merge commits\) · biggest "chore: bob trims" \(−80 lines · May 7, 2025\)/);
    // The rows only use spare room (totals, else messages): on at most one card, and here
    // (contributors, born / buried, the commit-type mix) neither card has room.
    assert.ok(r.cards.filter((svg) => svg.includes('Cleanups')).length <= 1);
    for (const svg of r.cards) assertWellEscaped(svg);
  });

  test('--author ada: only her commits; the odd subject is scrubbed, clipped and escaped everywhere', () => {
    const r = run([main, '--author', 'ada@example.com']);
    assert.equal(r.cleanups.commits, 1);
    assert.equal(r.cleanups.share, 0.2);
    assert.equal(r.cleanups.biggest.net, 50);
    assert.equal(r.cleanups.biggest.date, '2025-05-05');
    const subject = r.cleanups.biggest.subject;
    assert.ok(subject.startsWith('refactor: drop <legacy> & "old" parser 🧹 مرحبا'), subject);
    assert.ok(!subject.includes('bob@example.com'));
    for (const out of [r.stdout, r.md, r.svg, JSON.stringify(r.json)]) assert.ok(!out.includes('bob@example.com'));
    assert.match(r.stdout, /Cleanups {5}1 commit \(20% of non-merge commits\) · biggest "refactor: drop <legacy> & "old" parser.*…" \(−50 lines · May 5, 2025\)/);
    assert.ok(r.md.includes('biggest: “refactor: drop \\<legacy\\> \\& "old" parser 🧹 مرحبا'), r.md);
    assert.ok(r.md.includes('· −50 lines (May 5, 2025)'));
    assert.ok(r.cards.filter((svg) => svg.includes('Biggest cleanup')).length <= 1);
    if (r.svg.includes('Biggest cleanup')) assert.ok(r.svg.includes('−50 lines'));
    assert.ok(!r.svg.includes('<legacy>'));
    for (const svg of r.cards) assertWellEscaped(svg);
  });

  test('--author bob --lang tr', () => {
    const r = run([main, '--author', 'bob@example.com', '--lang', 'tr']);
    assert.equal(r.cleanups.commits, 1);
    assert.equal(r.cleanups.share, 0.5);
    assert.match(r.stdout, /Temizlikler +1 commit \(merge dışı commit'lerin %50 kadarı\) · en büyüğü "chore: bob trims" \(−80 satır · 7 May 2025\)/);
    assert.ok(r.md.includes('## Temizlikler'));
    assert.ok(r.cards.filter((svg) => svg.includes('Temizlikler')).length <= 1);
  });

  test('--exclude: excluding src/ leaves only Bob; excluding lib/ too → null, nothing shown', () => {
    const r = run([main, '--exclude', 'src/']);
    assert.equal(r.cleanups.commits, 1);
    assert.equal(r.cleanups.biggest.subject, 'chore: bob trims');
    const r2 = run([main, '--exclude', 'src/**', '--exclude', 'lib/']);
    assert.equal(r2.cleanups, null);
    assert.ok(!r2.stdout.includes('Cleanups'));
    assert.ok(!r2.md.includes('Cleanups'));
    assert.ok(!r2.svg.includes('Cleanups') && !r2.svg.includes('Biggest cleanup'));
    // A glob on the file name alone matches at any depth. Excluding only core.js leaves the
    // rename's deletion of app.js: then the rename reads as a cleanup (−61).
    const r3 = run([main, '--exclude', 'core.js', '--exclude', 'bob.js']);
    assert.equal(r3.cleanups.commits, 1);
    assert.equal(r3.cleanups.biggest.subject, 'refactor: rename app to core');
    assert.equal(r3.cleanups.biggest.net, 61);
    assert.equal(run([main, '--exclude', 'app.js', '--exclude', 'core.js', '--exclude', 'bob.js']).cleanups, null);
  });

  test('multi-repo: a repo named "dist" counts its own files; another repo\'s dist/ is ignored', () => {
    const r = run([dist, alpha]);
    assert.equal(r.cleanups.commits, 1);
    assert.equal(r.cleanups.share, 0.25);
    assert.equal(r.cleanups.biggest.subject, 'chore: trim x');
    assert.equal(r.cleanups.biggest.net, 20);
    // Only alpha: its build-output deletion is ignored → null.
    assert.equal(run([alpha]).cleanups, null);
  });
});
