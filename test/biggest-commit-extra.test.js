// Extra edge cases for the biggest commit (src/stats/biggest.js, the messages card's
// panel, the recap line, stats.json) written by the tester of loop turn 037.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeBiggestCommit, computeHotFiles, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { formatSummary, displayWidth } from '../src/summary.js';
import { generate, run } from '../src/cli.js';
import { loadResvg, pngSize, renderPng } from '../src/png.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(date, subject, files, extra = {}) {
  n += 1;
  return { hash: `x${n}`, author: 'A', email: 'a@x', date, subject, parents: ['p'], files, ...extra };
}
const f = (path, added, removed = 0, binary = false) => ({ path, added, removed, binary });

const messagesSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'messages').spec;
const messagesCard = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'messages');

/** Asserts the callout is laid out, everything is in the content area and nothing overlaps. */
function assertFits(spec, lang, label) {
  const layout = layoutCard({ ...spec, lang });
  assert.ok(layout.blocks.some((b) => b.kind === 'callout'), `${label}: the biggest-commit panel is kept`);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
  }
  return layout;
}

/** The text of each <text> element in an SVG fragment (entities left as is). */
const texts = (svg) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

// --- computeBiggestCommit: more inputs ------------------------------------------------

describe('computeBiggestCommit (extra)', () => {
  test('binary files add no lines, but a binary-only commit can never be the biggest', () => {
    const bin = commit('2026-03-01T10:00:00Z', 'add logo', [f('assets/logo.png', 0, 0, true)]);
    assert.equal(computeBiggestCommit([bin]), null);
    const mixed = commit('2026-03-02T10:00:00Z', 'mixed', [f('assets/a.png', 0, 0, true), f('src/a.js', 3, 1)]);
    const r = computeBiggestCommit([bin, mixed]);
    assert.equal(r.hash, mixed.hash);
    assert.equal(r.lines, 4);
    // Raw numstat "-" values, should they ever reach the stats, add 0 rather than NaN.
    const raw = commit('2026-03-03T10:00:00Z', 'raw', [{ path: 'x.bin', added: '-', removed: '-' }, { path: 'y.bin', added: null, removed: undefined }]);
    assert.equal(computeBiggestCommit([raw]), null);
  });

  test('files counts distinct counted paths: binary files touched with text are included, ignored paths not', () => {
    const c = commit('2026-03-02T10:00:00Z', 'mixed', [f('assets/a.png', 0, 0, true), f('src/a.js', 3, 1), f('yarn.lock', 99), f('src/a.js', 1)]);
    const r = computeBiggestCommit([c]);
    assert.equal(r.files, 2);
    assert.equal(r.lines, 5);
  });

  test('a rename reported as delete + add counts both sides (git log --no-renames)', () => {
    const c = commit('2026-03-02T10:00:00Z', 'move', [f('src/old.js', 0, 50), f('src/new.js', 50, 0)]);
    assert.deepEqual({ ...computeBiggestCommit([c]), hash: undefined }, { hash: undefined, subject: 'move', date: '2026-03-02', linesAdded: 50, linesRemoved: 50, lines: 100, files: 2 });
  });

  test('a commit that touches only ignored paths is never the biggest, even if huge', () => {
    const lock = commit('2026-03-01T10:00:00Z', 'lock', [f('package-lock.json', 1e6, 1e6), f('pnpm-lock.yaml', 5e5), f('dist/bundle.js', 1e5), f('a/b/node_modules/x.js', 7)]);
    const tiny = commit('2026-03-02T10:00:00Z', 'tiny', [f('README.md', 1)]);
    assert.equal(computeBiggestCommit([lock]), null);
    assert.equal(computeBiggestCommit([lock, tiny]).subject, 'tiny');
  });

  test('huge counts are summed exactly (no overflow / float noise below 2^53)', () => {
    const c = commit('2026-03-01T10:00:00Z', 'huge', [f('a.js', 98765432, 87654321), f('b.js', 1, 1)]);
    const r = computeBiggestCommit([c]);
    assert.equal(r.linesAdded, 98765433);
    assert.equal(r.linesRemoved, 87654322);
    assert.equal(r.lines, 186419755);
  });

  test('future-dated commits are kept and dated by their author-local day', () => {
    const future = commit('2031-12-31T23:30:00-08:00', 'from the future', [f('a.js', 500)]);
    const now = commit('2026-03-01T10:00:00Z', 'now', [f('a.js', 10)]);
    const r = computeBiggestCommit([now, future]);
    assert.equal(r.subject, 'from the future');
    assert.equal(r.date, '2031-12-31');
    // On a tie the earlier (present) one wins over the future one.
    const tie = commit('2031-01-01T00:00:00Z', 'future tie', [f('a.js', 10)]);
    assert.equal(computeBiggestCommit([tie, now]).subject, 'now');
  });

  test('subject whitespace: inner spacing kept, only blank → null', () => {
    assert.equal(computeBiggestCommit([commit('2026-03-01T10:00:00Z', ' \t a  b \n', [f('a.js', 1)])]).subject, 'a  b');
    assert.equal(computeBiggestCommit([commit('2026-03-01T10:00:00Z', ' \t\n ', [f('a.js', 1)])]).subject, null);
    assert.equal(computeBiggestCommit([commit('2026-03-01T10:00:00Z', 42, [f('a.js', 1)])]).subject, null);
  });

  test('ignored-path rules match computeHotFiles exactly (same file set)', () => {
    const paths = ['package-lock.json', 'yarn.lock', 'Cargo.lock', 'dist/a.js', 'build/x.js', 'node_modules/a.js', 'vendor/a.go', 'a.min.js', 'a.min.css', '__snapshots__/a.snap', 'src/a.js', 'src/dist/b.js', 'docs/x.md'];
    for (const p of paths) {
      const c = commit('2026-03-01T10:00:00Z', p, [f(p, 7)]);
      const hot = computeHotFiles([c]);
      const hotPaths = (Array.isArray(hot) ? hot : hot?.files ?? hot?.top ?? []).map((h) => h.path);
      const big = computeBiggestCommit([c]);
      assert.equal(big !== null, hotPaths.includes(p), `${p}: biggest and hot files agree on ignoring it`);
    }
  });

  test('does not mutate its input', () => {
    const commits = [commit('2026-03-01T10:00:00Z', ' s ', [f('a.js', 1, 2)])];
    const copy = structuredClone(commits);
    computeBiggestCommit(commits);
    assert.deepEqual(commits, copy);
  });

  test('a commit with files: [] / missing files and only merges → null', () => {
    assert.equal(computeBiggestCommit([commit('2026-03-01T10:00:00Z', 's', [])]), null);
    assert.equal(computeBiggestCommit([{ hash: 'h', date: '2026-03-01T10:00:00Z', subject: 's' }]), null);
  });

  test('result is JSON-safe (no Infinity / NaN / undefined fields)', () => {
    const r = computeBiggestCommit([commit('bad date', undefined, [f('a.js', Infinity, 3)], { hash: undefined })]);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    assert.deepEqual(r, { hash: null, subject: null, date: null, linesAdded: 0, linesRemoved: 3, lines: 3, files: 1 });
  });
});

// --- the messages card -------------------------------------------------------------------

/** A history whose biggest commit has `subject` and `added` / `removed` lines. */
const history = (subject, added, removed, { longSubject = 'feat: a normal subject line', topWord = true } = {}) => [
  commit('2026-03-04T10:00:00+00:00', subject, [f('src/a.js', added, removed)]),
  commit('2026-03-05T10:00:00+00:00', topWord ? 'fix: parser' : 'a', [f('src/b.js', 3, 1)]),
  commit('2026-04-05T10:00:00+00:00', topWord ? 'fix: wip oops' : 'bb', [f('src/b.js', 3, 1)]),
  commit('2026-04-06T10:00:00+00:00', longSubject, [f('src/b.js', 3, 1)]),
];

const SUBJECTS = {
  long: 'refactor: ' + 'rewrite the whole rendering pipeline so that it is faster '.repeat(20),
  noSpaces: 'x'.repeat(2000),
  emoji: '🚀✨🔥 ship it 👩‍👩‍👧‍👦🏳️‍🌈 '.repeat(15),
  rtl: 'إصلاح خطأ في المحلل اللغوي وإعادة كتابة الوحدة بالكامل '.repeat(5),
  hebrew: 'תיקון באג במנתח ושכתוב המודול כולו '.repeat(6),
  cjk: '重构整个渲染管线以提高性能并修复所有已知问题'.repeat(10),
  mixed: 'feat(日本語): add العربية support 🎉 and ünïcödé ' .repeat(6),
  combining: 'Z̷̢̛͖a̴̠͛l̸̰̈g̷̝̓ő̶͙ '.repeat(30),
};

describe('messages card (extra)', () => {
  test('7–8 digit line counts: the full "+N / −M lines" value is drawn (not truncated), en / tr, all themes', () => {
    const cases = [[1234567, 7654321], [98765432, 87654321], [99999999, 99999999]];
    for (const [added, removed] of cases) {
      const stats = computeStats(history('big', added, removed), { today: TODAY });
      for (const lang of ['en', 'tr']) {
        for (const colorTheme of ['default', 'mono', 'neon']) {
          const label = `${added}/${removed} ${lang}/${colorTheme}`;
          const spec = messagesSpec(stats, { lang, colorTheme });
          const sep = lang === 'tr' ? '.' : ',';
          const fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
          const unit = lang === 'tr' ? 'satır' : 'lines';
          assert.equal(spec.chart.value, `+${fmt(added)} / −${fmt(removed)} ${unit}`, label);
          const layout = assertFits(spec, lang, label);
          const panel = layout.blocks.find((b) => b.kind === 'callout');
          const drawn = texts(panel.svg);
          assert.ok(drawn.includes(spec.chart.value), `${label}: value drawn in full, got ${JSON.stringify(drawn)}`);
          const card = messagesCard(stats, { lang, colorTheme });
          assert.ok(card.svg.includes(spec.chart.value), `${label}: value in the SVG`);
        }
      }
    }
  });

  test('a zero side shows "0" (no "−0" / "+0")', () => {
    const stats = computeStats(history('only adds', 500, 0), { today: TODAY });
    assert.equal(messagesSpec(stats).chart.value, '+500 / 0 lines');
    const del = computeStats(history('only deletes', 0, 500), { today: TODAY });
    assert.equal(messagesSpec(del, { lang: 'tr' }).chart.value, '0 / −500 satır');
  });

  for (const [name, subject] of Object.entries(SUBJECTS)) {
    test(`subject "${name}": panel fits, no overlap, note is one truncated line`, () => {
      for (const longSubject of ['feat: a normal subject line', SUBJECTS.long]) {
        const stats = computeStats(history(subject, 12345678, 8765432, { longSubject }), { today: TODAY });
        for (const lang of ['en', 'tr']) {
          for (const colorTheme of ['default', 'mono', 'neon']) {
            const label = `${name}/${longSubject.length}/${lang}/${colorTheme}`;
            const spec = messagesSpec(stats, { lang, colorTheme });
            const layout = assertFits(spec, lang, label);
            const panel = layout.blocks.find((b) => b.kind === 'callout');
            const drawn = texts(panel.svg);
            assert.equal(drawn.length, 3, `${label}: caption, value and note`);
            const note = drawn[2];
            assert.ok(note.length > 1, `${label}: some of the subject is shown`);
            assert.ok(note.startsWith('“'), `${label}: note starts with the quote`);
            // Long subjects end with an ellipsis rather than overflowing.
            if ([...subject.trim()].length > 60) assert.ok(note.endsWith('…'), `${label}: long note is cut with …: ${note}`);
            assert.ok(!/[‪-‮⁦-⁩\x00-\x1f]/.test(note), `${label}: no control chars`);
            // The card as a whole still renders and is valid-ish XML.
            const card = messagesCard(stats, { lang, colorTheme });
            assert.ok(card.svg.startsWith('<svg') && card.svg.trimEnd().endsWith('</svg>'));
          }
        }
      }
    });
  }

  test('a lone surrogate / ZWJ-only subject never produces broken XML text', () => {
    for (const subject of ['\ud83d broken', '‍‍', 'a￾b']) {
      const stats = computeStats(history(subject, 10, 2), { today: TODAY });
      const card = messagesCard(stats);
      assert.ok(card.svg.includes('BIGGEST COMMIT') || /Biggest commit/i.test(card.svg));
      assert.doesNotMatch(card.svg, /\ud83d(?![\udc00-\udfff])/, `${JSON.stringify(subject)}: no lone high surrogate in the SVG`);
    }
  });

  test('messages card with no longest/shortest (no subjects at all) still shows the panel', () => {
    const commits = [commit('2026-03-04T10:00:00Z', '', [f('src/a.js', 40, 2)]), commit('2026-03-05T10:00:00Z', '  ', [f('src/b.js', 1)])];
    const stats = computeStats(commits, { today: TODAY });
    for (const lang of ['en', 'tr']) {
      const spec = messagesSpec(stats, { lang });
      assert.equal(spec.chart?.kind, 'callout', lang);
      assert.equal(spec.chart.note, lang === 'tr' ? '(konu yok)' : '(no subject)');
      assertFits(spec, lang, `no subjects ${lang}`);
    }
  });

  test('future-dated biggest commit: the caption shows its (future) day', () => {
    const commits = [commit('2031-07-09T10:00:00Z', 'time travel', [f('src/a.js', 900)]), ...history('x', 1, 0).slice(1)];
    const stats = computeStats(commits, { today: TODAY });
    assert.equal(messagesSpec(stats).chart.title, 'Biggest commit · Jul 9, 2031');
    assert.equal(messagesSpec(stats, { lang: 'tr' }).chart.title, 'En büyük commit · 9 Tem 2031');
  });

  test('the caption is upper-cased with Turkish rules in tr (loanword "commit" keeps the plain I)', () => {
    const stats = computeStats(history('big', 100, 5), { today: TODAY });
    const card = messagesCard(stats, { lang: 'tr' });
    assert.match(card.svg, /EN BÜYÜK COMMIT · 4 MAR 2026/);
  });

  test('card description mentions the subject-less placeholder and no "undefined"/"null"', () => {
    const stats = computeStats(history('x', 100, 5), { today: TODAY });
    for (const big of [{ ...stats.biggestCommit, subject: null }, { ...stats.biggestCommit, date: 'garbage' }, { ...stats.biggestCommit, date: '2026-02-30' }]) {
      const card = messagesCard({ ...stats, biggestCommit: big });
      assert.doesNotMatch(card.description, /undefined|null|NaN|Invalid/);
      assert.doesNotMatch(card.svg, /undefined|NaN|Invalid Date/);
    }
  });
});

// --- recap ---------------------------------------------------------------------------------

describe('recap (extra)', () => {
  test('huge numbers use the language separator', () => {
    const stats = computeStats(history('huge', 98765432, 87654321), { today: TODAY });
    assert.match(formatSummary(stats), /Biggest .*\(\+98,765,432 \/ −87,654,321 lines · Mar 4, 2026\)/);
    assert.match(formatSummary(stats, { lang: 'tr' }), /En büyük .*\(\+98\.765\.432 \/ −87\.654\.321 satır · 4 Mar 2026\)/);
  });

  test('long CJK / emoji subjects are cut to a bounded terminal width', () => {
    for (const [name, subject] of Object.entries(SUBJECTS)) {
      const stats = computeStats(history(subject, 10, 1), { today: TODAY });
      for (const lang of ['en', 'tr']) {
        const out = formatSummary(stats, { lang });
        const line = out.split('\n').find((l) => /^ {2}(Biggest|En büyük)/.test(l));
        assert.ok(line, `${name}/${lang}: a biggest line`);
        assert.doesNotMatch(line, /[‪-‮⁦-⁩\x00-\x1f]/, `${name}/${lang}: no control chars`);
        // 48 code points of subject; CJK is double width, so at most ~ 2*48 + overhead columns.
        assert.ok(displayWidth(line) <= 150, `${name}/${lang}: line width ${displayWidth(line)} is bounded`);
      }
    }
  });

  test('cutting a long emoji subject never splits a grapheme (no lone ZWJ / skin tone at the cut)', () => {
    const subject = '👩‍👩‍👧‍👦'.repeat(30);
    const stats = computeStats(history(subject, 10, 1), { today: TODAY });
    const line = formatSummary(stats).split('\n').find((l) => l.startsWith('  Biggest'));
    const quoted = line.match(/"(.*)…"/)?.[1];
    assert.ok(quoted !== undefined, `truncated: ${line}`);
    assert.doesNotMatch(quoted, /‍$/, 'does not end in a dangling zero-width joiner');
  });

  // KNOWN BUG (left failing on purpose): summary.js shortWord() cuts at 47 code points, not
  // graphemes, so a family emoji is split and the line ends in "👩\u200d👩\u200d…".
  test('BUG: cutting a ZWJ emoji subject at the 48-code-point cap does not split a grapheme', () => {
    const subject = 'a' + '👩‍👩‍👧‍👦'.repeat(30); // the cut lands right after a ZWJ
    const stats = computeStats(history(subject, 10, 1), { today: TODAY });
    const line = formatSummary(stats).split('\n').find((l) => l.startsWith('  Biggest'));
    const quoted = line.match(/"(.*)…"/)?.[1];
    assert.ok(quoted !== undefined, `truncated: ${line}`);
    assert.doesNotMatch(quoted, /\u200d$/, 'does not end in a dangling zero-width joiner');
    const segs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(quoted)].map((x) => x.segment);
    assert.ok(segs.slice(1).every((g) => g === '👩‍👩‍👧‍👦'), `only whole family emoji after "a": ${JSON.stringify(segs.slice(-2))}`);
  });

  // KNOWN BUG (left failing on purpose): the card's gate is num(added) + num(removed) > 0 on
  // raw values, the recap's is "either side rounds to a positive count". For a hand-edited /
  // junk stats object they disagree: {-50, 10} → recap line "0 / −10" but no panel;
  // {0.4, 0} → panel "0 / 0 lines" but no recap line.
  test('BUG: card panel and recap line agree on junk biggestCommit values', () => {
    const stats = computeStats(history('x', 100, 5), { today: TODAY });
    for (const junk of [{ linesAdded: -50, linesRemoved: 10 }, { linesAdded: 0.4, linesRemoved: 0 }, { linesAdded: 0.2, linesRemoved: 0.2 }]) {
      const big = { ...junk, subject: 'junk', date: '2026-03-04' };
      const card = Object.hasOwn(messagesSpec({ ...stats, biggestCommit: big }), 'chart');
      const recap = /Biggest/.test(formatSummary({ ...stats, biggestCommit: big }));
      assert.equal(card, recap, `${JSON.stringify(junk)}: card ${card} vs recap ${recap}`);
      if (card) assert.doesNotMatch(messagesSpec({ ...stats, biggestCommit: big }).chart.value, /^0 \/ 0 /);
    }
  });

  test('a future-dated biggest commit prints its day', () => {
    const commits = [commit('2031-07-09T10:00:00Z', 'time travel', [f('src/a.js', 900)]), ...history('x', 1, 0).slice(1)];
    const stats = computeStats(commits, { today: TODAY });
    assert.match(formatSummary(stats, { today: TODAY }), /Biggest +"time travel" \(\+900 \/ 0 lines · Jul 9, 2031\)/);
  });
});

// --- end to end through the real CLI ----------------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}
const lines = (count, tag = 'l') => Array.from({ length: count }, (_, i) => `${tag}${i}`).join('\n') + '\n';
const capture = () => {
  const s = { text: '', write: (x) => { s.text += x; return true; } };
  return s;
};

function makeRepo(dir, steps) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const s of steps) {
    const who = { GIT_AUTHOR_NAME: s.name ?? 'Alice', GIT_AUTHOR_EMAIL: s.email ?? 'alice@example.com', GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@example.com' };
    for (const [p, content] of Object.entries(s.files ?? {})) {
      const full = join(dir, p);
      if (content === null) unlinkSync(full);
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
    if (s.rename) renameSync(join(dir, s.rename[0]), join(dir, s.rename[1]));
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', s.msg], { ...who, GIT_AUTHOR_DATE: s.date, GIT_COMMITTER_DATE: s.date });
  }
}

describe('end to end (extra)', () => {
  let root;
  let app;
  let lib;
  const out = (name) => join(root, 'out', name);
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-biggest-x-'));
    app = join(root, 'app');
    lib = join(root, 'lib');
    const png = Buffer.alloc(4096, 0);
    png.write('\x89PNG', 0, 'latin1');
    makeRepo(app, [
      { date: '2024-06-01T10:00:00+00:00', msg: 'feat: old giant of 2024', files: { 'src/old.js': lines(300) } },
      { date: '2025-02-01T10:00:00+00:00', msg: 'chore: add binary blob', files: { 'assets/blob.png': png } },
      { date: '2025-02-02T10:00:00+00:00', msg: 'chore: only lockfile + dist', files: { 'package-lock.json': lines(5000), 'dist/out.js': lines(4000) } },
      { date: '2025-03-01T10:00:00+00:00', msg: 'refactor: move module', rename: ['src/old.js', 'src/moved.js'] },
      { date: '2025-03-02T10:00:00+00:00', msg: 'feat: bob big docs 📚', files: { 'docs/huge.md': lines(250) }, name: 'Bob', email: 'bob@example.com' },
      { date: '2025-03-03T10:00:00+00:00', msg: 'feat: alice core', files: { 'src/core.js': lines(120) } },
      { date: '2025-03-04T10:00:00+00:00', msg: 'fix: alice tweak', files: { 'src/core.js': lines(121) } },
    ]);
    makeRepo(lib, [
      { date: '2025-04-01T10:00:00+00:00', msg: 'feat: lib engine', files: { 'src/engine.js': lines(700) } },
      { date: '2025-04-02T10:00:00+00:00', msg: 'build: lib dist', files: { 'dist/engine.js': lines(9000) } },
    ]);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('rename (no-renames → delete + add) is the biggest of 2025; lockfile/dist/binary commits never win', async () => {
    const r = await generate({ path: app, out: out('a'), png: false, json: true, year: '2025', since: '2025-01-01', until: '2025-12-31' }, { today: '2026-01-10' });
    const big = r.stats.biggestCommit;
    assert.equal(big.subject, 'refactor: move module');
    assert.equal(big.linesAdded, 300);
    assert.equal(big.linesRemoved, 300);
    assert.equal(big.files, 2);
    assert.equal(big.date, '2025-03-01');
  });

  test('--year 2024 window: only that year\'s commits are considered', async () => {
    const r = await generate({ path: app, out: out('y24'), png: false, json: true, year: '2024', since: '2024-01-01', until: '2024-12-31' }, { today: '2026-01-10' });
    assert.equal(r.stats.biggestCommit.subject, 'feat: old giant of 2024');
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(doc.stats.biggestCommit, r.stats.biggestCommit);
  });

  test('--author: only the author\'s commits (team read does not leak in)', async () => {
    const bob = await generate({ path: app, out: out('bob'), png: false, json: true, author: 'bob@example.com' }, { today: '2026-01-10' });
    assert.equal(bob.stats.biggestCommit.subject, 'feat: bob big docs 📚');
    const alice = await generate({ path: app, out: out('alice'), png: false, json: true, author: 'alice@example.com', since: '2025-03-02' }, { today: '2026-01-10' });
    assert.equal(alice.stats.biggestCommit.subject, 'feat: alice core');
    assert.equal(alice.stats.biggestCommit.lines, 120);
  });

  test('--exclude changes the result in stats.json (src/ excluded → docs commit wins)', async () => {
    const r = await generate({ path: app, out: out('ex'), png: false, json: true, exclude: ['src/**'] }, { today: '2026-01-10' });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.equal(doc.stats.biggestCommit.subject, 'feat: bob big docs 📚');
    assert.equal(doc.stats.biggestCommit.lines, 250);
    // Excluding everything that counts → null in JSON (not missing).
    const all = await generate({ path: app, out: out('ex2'), png: false, json: true, exclude: ['src/', 'docs/'] }, { today: '2026-01-10' });
    const allDoc = JSON.parse(readFileSync(all.statsJson, 'utf8'));
    assert.equal(Object.hasOwn(allDoc.stats, 'biggestCommit'), true);
    assert.equal(allDoc.stats.biggestCommit, null);
  });

  test('multi-repo via the real CLI: dist/ at a repo root is ignored, recap and JSON agree, --lang tr', async () => {
    const stdout = capture();
    const code = await run([app, lib, '--out', out('multi'), '--no-png', '--no-color', '--json'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    assert.match(stdout.text, /\n {2}Biggest +"feat: lib engine" \(\+700 \/ 0 lines · Apr 1, 2025\)\n/);
    const doc = JSON.parse(readFileSync(join(out('multi'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.biggestCommit.subject, 'feat: lib engine');
    assert.equal(doc.stats.biggestCommit.files, 1);

    const tr = capture();
    assert.equal(await run([app, lib, '--out', out('multi-tr'), '--no-png', '--no-color', '--lang', 'tr'], { stdout: tr, stderr: capture(), env: {}, today: '2026-01-10' }), 0, tr.text);
    assert.match(tr.text, /\n {2}En büyük +"feat: lib engine" \(\+700 \/ 0 satır · 1 Nis 2025\)\n/);
    const html = readFileSync(join(out('multi-tr'), 'wrapped.html'), 'utf8');
    assert.match(html, /EN BÜYÜK COMMIT · 1 NİS 2025/);
  });

  test('a repo whose every commit is lockfile / binary: no biggest line, no panel, JSON null', async () => {
    const dir = join(root, 'noise');
    const png = Buffer.alloc(100, 0); // NUL bytes → git numstat reports it as binary ("-")
    makeRepo(dir, [
      { date: '2025-01-01T10:00:00+00:00', msg: 'lock', files: { 'yarn.lock': lines(100) } },
      { date: '2025-01-02T10:00:00+00:00', msg: 'img', files: { 'a.png': png } },
    ]);
    const stdout = capture();
    assert.equal(await run([dir, '--out', out('noise'), '--no-png', '--no-color', '--json'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' }), 0);
    assert.doesNotMatch(stdout.text, /Biggest/);
    const doc = JSON.parse(readFileSync(join(out('noise'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.biggestCommit, null);
  });
});

// --- PNG ------------------------------------------------------------------------------------

let Resvg = null;
try {
  Resvg = await loadResvg();
} catch {
  Resvg = null;
}

describe('PNG render of the messages card with a biggest commit', () => {

  test('renders to a 1080x1920 PNG in every theme and language, with huge numbers and an emoji/RTL subject', { timeout: 120000 }, async (t) => {
    if (!Resvg) return t.skip('resvg unavailable');
    const stats = computeStats(history(SUBJECTS.mixed + SUBJECTS.rtl, 98765432, 87654321, { longSubject: SUBJECTS.long }), { today: TODAY });
    for (const lang of ['en', 'tr']) {
      for (const colorTheme of ['default', 'mono', 'neon']) {
        const card = messagesCard(stats, { lang, colorTheme });
        const buf = await renderPng(card.svg);
        assert.deepEqual(pngSize(buf), { width: 1080, height: 1920 }, `${lang}/${colorTheme}`);
        // Differs from the card without the panel (the panel is actually drawn).
        const plain = messagesCard({ ...stats, biggestCommit: null }, { lang, colorTheme });
        assert.notEqual(card.svg, plain.svg);
      }
    }
  });
});
