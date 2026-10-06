// Extra edge cases for the first commit (src/stats/first.js, the intro card's "It all
// began with" panel, the recap line, wrapped.md and stats.json) written by the tester of
// loop turn 046.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFirstCommit, computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP, measureText } from '../src/cards/svg.js';
import { formatSummary, displayWidth } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { generate, run } from '../src/cli.js';

const TODAY = '2026-05-01';

let n = 0;
function commit(date, subject, extra = {}) {
  n += 1;
  const hash = `${String(n).padStart(4, '0')}fedcba9876543210fedcba9876543210fedc`;
  return { hash, author: 'A', email: 'a@x.io', date, subject, parents: ['p'], files: [{ path: 'src/a.js', added: 1, removed: 0, binary: false }], ...extra };
}

/** The raw (still XML-escaped) text of every <text> element of an SVG. */
const rawTexts = (svg) => [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const texts = (svg) => rawTexts(svg).map(decode);

const intro = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts })[0];
const introSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts })[0].spec;
const firstLine = (recap) => recap.split('\n').find((l) => /First commit|İlk commit/.test(l));
const mdLine = (md) => md.split('\n').find((l) => /\*\*(First commit|İlk commit):\*\*/.test(l));
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The intro's "began" panel is laid out, inside the content area, with no overlaps. */
function assertPanelFits(stats, opts = {}, label = '') {
  const spec = introSpec(stats, opts);
  assert.ok(Array.isArray(spec.chart), `${label}: began panel in the spec`);
  const layout = layoutCard({ ...spec, lang: opts.lang });
  assert.deepEqual(layout.drawnCharts, [0, 1], `${label}: both panels drawn`);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: no overlap`);
  }
}

// --- computeFirstCommit: more inputs --------------------------------------------------

describe('computeFirstCommit (extra)', () => {
  test('merge-only histories (2 and 3+ parents) → null, through computeStats too; intro has one callout', () => {
    const m2 = commit('2026-01-01T00:00:00Z', 'Merge a', { parents: ['a', 'b'] });
    const m3 = commit('2026-01-02T00:00:00Z', 'Octopus', { parents: ['a', 'b', 'c'] });
    assert.equal(computeFirstCommit([m2, m3]), null);
    const stats = computeStats([m3, m2], { today: TODAY });
    assert.equal(stats.firstCommit, null);
    const spec = introSpec(stats);
    assert.equal(Array.isArray(spec.chart), false);
    assert.doesNotMatch(intro(stats).svg, /BEGAN/);
    assert.doesNotMatch(formatSummary(stats, { repoName: 'demo', today: TODAY }), /First commit/);
    assert.doesNotMatch(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /First commit/);
  });

  test('a root commit (no parents) counts; an earlier merge does not', () => {
    const root = commit('2026-01-05T00:00:00Z', 'root', { parents: [] });
    const merge = commit('2025-01-01T00:00:00Z', 'Merge old', { parents: ['a', 'b'] });
    assert.equal(computeFirstCommit([merge, root]).subject, 'root');
  });

  test('the earliest instant wins even when another commit has an earlier local day', () => {
    // 01:00 at +14:00 on Mar 2 is Mar 1 11:00 UTC; 20:00 at -10:00 on Mar 1 is Mar 2 06:00 UTC.
    const plus14 = commit('2026-03-02T01:00:00+14:00', 'plus fourteen');
    const minus10 = commit('2026-03-01T20:00:00-10:00', 'minus ten');
    for (const order of [[plus14, minus10], [minus10, plus14]]) {
      const r = computeFirstCommit(order);
      assert.equal(r.subject, 'plus fourteen');
      assert.equal(r.date, '2026-03-02', 'the author-local day of that commit');
    }
  });

  test('three commits on one instant in different zones: the last in input order wins', () => {
    const a = commit('2026-03-01T12:00:00+00:00', 'a');
    const b = commit('2026-03-01T17:30:00+05:30', 'b');
    const c = commit('2026-03-01T07:00:00-05:00', 'c');
    assert.equal(computeFirstCommit([a, b, c]).subject, 'c');
    assert.equal(computeFirstCommit([c, a, b]).subject, 'b');
    assert.equal(computeFirstCommit([b, c, a]).date, '2026-03-01');
    // A later merge on that instant never wins the tie.
    const m = commit('2026-03-01T12:00:00Z', 'merge', { parents: ['x', 'y'] });
    assert.equal(computeFirstCommit([a, m]).subject, 'a');
  });

  test('one second earlier wins over input order (git dates have second precision)', () => {
    const a = commit('2026-03-01T12:00:00Z', 'a');
    const b = commit('2026-03-01T12:00:01Z', 'b');
    assert.equal(computeFirstCommit([a, b]).subject, 'a');
    assert.equal(computeFirstCommit([b, a]).subject, 'a');
  });

  test('non-object entries are skipped among real ones; input is not changed', () => {
    const c = commit('2026-03-01T12:00:00Z', 'real');
    const input = [null, undefined, 7, 'str', c, []];
    const copy = JSON.stringify(input);
    assert.equal(computeFirstCommit(input).subject, 'real');
    assert.equal(JSON.stringify(input), copy);
  });

  test('hash: trimmed, cut to 7, uppercase kept, short hashes kept whole, spaces inside → null', () => {
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { hash: '  ABCDEF0123  ' })]).hash, 'ABCDEF0');
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { hash: 'abc' })]).hash, 'abc');
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { hash: 'ab cd' })]).hash, null);
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { hash: 1234567 })]).hash, null);
  });

  test('a non-string subject → null; email-only subjects → "…"; several emails all cut', () => {
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', 42)]).subject, null);
    assert.equal(computeFirstCommit([commit('2026-03-01T12:00:00Z', { toString: () => 'a@b.c' })]).subject, null);
    const r = computeFirstCommit([commit('2026-03-01T12:00:00Z', 'Co-authored by a@x.io, b@y.org and <c+tag@sub.z.co.uk>')]);
    assert.equal(r.subject, 'Co-authored by …, … and <…>');
  });

  test('a blank / non-string repo label is not kept', () => {
    assert.equal('repo' in computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { repo: '   ' })]), false);
    assert.equal('repo' in computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { repo: 5 })]), false);
  });

  test('the result serialises to JSON with exactly the documented keys', () => {
    const r = computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x')]);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(r))), ['date', 'subject', 'hash']);
    const m = computeFirstCommit([commit('2026-03-01T12:00:00Z', 'x', { repo: 'api' })]);
    assert.deepEqual(Object.keys(m), ['date', 'subject', 'hash', 'repo']);
  });
});

// --- intro card ------------------------------------------------------------------------

describe('intro card (extra)', () => {
  const base = computeStats([commit('2026-03-06T10:00:00Z', 'second'), commit('2026-03-02T09:00:00Z', 'Initial commit')], { today: TODAY });
  const withFirst = (patch) => ({ ...base, firstCommit: { ...base.firstCommit, ...patch } });
  const beganLine = (svg) => texts(svg).find((t) => t.startsWith('“') || t === '(no subject)' || t === '(konu yok)');

  for (const [label, subject] of [
    ['CJK', '修复：初始化项目结构和配置文件以及所有的依赖关系还有更多的内容在这里继续写下去'],
    ['emoji', `🎉🎉🎉 Initial commit 🚀✨ ${'👩‍💻👨‍👩‍👧 '.repeat(15)}`],
    ['one huge word', 'x'.repeat(5000)],
  ]) {
    test(`a long ${label} subject: one line within the content width, cut with "…", no split pairs`, () => {
      for (const lang of ['en', 'tr']) {
        const stats = withFirst({ subject });
        const svg = intro(stats, { lang }).svg;
        const line = beganLine(svg);
        assert.ok(line, `${label}/${lang}: began line drawn`);
        assert.ok(line.endsWith('…'), line);
        assert.doesNotMatch(line, LONE_SURROGATE);
        // The value's font size: the drawn line must fit the content width at it.
        const el = svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>“/);
        if (el) assert.ok(measureText(decode(line), Number(el[1])) <= 1080 - 2 * 96 + 1, `${label}: width`);
        assertPanelFits(stats, { lang }, `${label}/${lang}`);
      }
    });
  }

  test('XML specials are escaped in the SVG; control / bidi characters never reach it', () => {
    const svg = intro(withFirst({ subject: '<script>&x "q" \'s\' a\u202eb\u0007c\u2066d' })).svg;
    assert.doesNotMatch(svg, /<script/);
    assert.doesNotMatch(svg, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202e\u2066]/);
    const line = beganLine(svg);
    assert.equal(line, '“<script>&x "q" \'s\' a b c d”');
  });

  test('a subject made only of control / bidi characters reads "(no subject)" (en / tr)', () => {
    const stats = withFirst({ subject: '\u202e\u0007\u2066 \t' });
    assert.equal(beganLine(intro(stats).svg), '(no subject)');
    assert.equal(beganLine(intro(stats, { lang: 'tr' }).svg), '(konu yok)');
  });

  test('undated first commit: the note is the hash alone; nothing undefined / null / NaN', () => {
    const svg = intro(withFirst({ date: null })).svg;
    const t = texts(svg);
    assert.ok(t.includes(base.firstCommit.hash), t.join(' | '));
    assert.doesNotMatch(svg, /undefined|null|NaN|Invalid/);
  });

  test('an invalid date string and no hash: the panel still renders without a stray separator', () => {
    const svg = intro(withFirst({ date: '2026-02-30', hash: null })).svg;
    assert.doesNotMatch(svg, /undefined|null|NaN|Invalid/);
    assert.ok(!texts(svg).some((t) => /^ ·|· $| · · /.test(t)), texts(svg).join(' | '));
    assert.ok(texts(svg).includes('“Initial commit”'));
  });

  test('an email in hash or subject (hand-built stats) never reaches the SVG', () => {
    const svg = intro(withFirst({ subject: 'x ada@example.com y', hash: 'bob@example.com' })).svg;
    assert.doesNotMatch(svg, /example\.com/);
  });

  test('--year window: the "began" panel sits with the year title, en and tr', () => {
    for (const lang of ['en', 'tr']) {
      const opts = { lang, since: '2026-01-01', until: '2026-12-31' };
      const t = texts(intro(base, opts).svg);
      assert.ok(t.some((x) => /BEGAN WITH|BAŞLADI/.test(x)), t.join(' | '));
      assertPanelFits(base, opts, `year/${lang}`);
    }
  });

  test('a very long repo name and multi-repo label still fit', () => {
    const stats = withFirst({ repo: 'a-really-long-repository-label-'.repeat(6) });
    assertPanelFits(stats, { repoName: 'some-very-long-repository-name-that-goes-on' }, 'long names');
    const note = texts(intro(stats).svg).find((x) => x.startsWith('Mar 2, 2026 ·'));
    assert.ok(note, 'note drawn');
    assert.ok(measureText(note, 34) <= 1080 - 2 * 96 + 1, 'note fits');
  });
});

// --- recap -----------------------------------------------------------------------------

describe('recap (extra)', () => {
  const base = computeStats([commit('2026-03-06T10:00:00Z', 'second'), commit('2026-03-02T09:00:00Z', 'Initial commit')], { today: TODAY });
  const withFirst = (patch) => ({ ...base, firstCommit: { ...base.firstCommit, ...patch } });
  const recap = (s, opts = {}) => formatSummary(s, { repoName: 'demo', today: TODAY, ...opts });

  test('long CJK / emoji subjects are cut to at most 48 columns (+ quotes)', () => {
    for (const subject of ['修复：初始化项目结构和配置文件以及所有的依赖关系还有更多的内容在这里继续写下去', `🎉 ${'👩‍💻 '.repeat(40)}`, 'é'.repeat(200)]) {
      const line = firstLine(recap(withFirst({ subject })));
      const quoted = line.match(/"(.*)" \(/)[1];
      assert.ok(displayWidth(quoted) <= 48, `${displayWidth(quoted)}: ${quoted}`);
      assert.ok(quoted.endsWith('…'));
      assert.doesNotMatch(quoted, LONE_SURROGATE);
    }
  });

  test('control / bidi / ANSI escape characters are stripped from the line', () => {
    const line = firstLine(recap(withFirst({ subject: 'a\u001b[31mred\u0007\u202eb', repo: 'r\u001b[2Jx' })));
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
  });

  test('color: same text once ANSI codes are removed', () => {
    const plainLine = firstLine(recap(base));
    // eslint-disable-next-line no-control-regex
    const colored = firstLine(recap(base, { color: true }).replace(/\u001b\[[0-9;]*m/g, ''));
    assert.equal(colored, plainLine);
  });

  test('no date and no hash: no empty parentheses; date only / hash only', () => {
    assert.match(firstLine(recap(withFirst({ date: null, hash: null }))), /"Initial commit"$/);
    assert.match(firstLine(recap(withFirst({ hash: null }))), /"Initial commit" \(Mar 2, 2026\)$/);
    assert.match(firstLine(recap(withFirst({ date: 'garbage' }))), new RegExp(`"Initial commit" \\(${base.firstCommit.hash}\\)$`));
    assert.doesNotMatch(recap(withFirst({ date: null, hash: null })), /undefined|null|NaN/);
  });

  test('a null / empty subject reads "(no subject)" / "(konu yok)"', () => {
    assert.match(firstLine(recap(withFirst({ subject: null }))), /First commit\s+\(no subject\) \(Mar 2, 2026/);
    assert.match(firstLine(recap(withFirst({ subject: '\u202e  ' }), { lang: 'tr' })), /İlk commit\s+\(konu yok\) \(2 Mar 2026/);
  });

  test('a multi-repo label is appended; a long one is cut to 24 columns', () => {
    const line = firstLine(recap(withFirst({ repo: 'api' })));
    assert.match(line, new RegExp(`\\(Mar 2, 2026 · ${base.firstCommit.hash} · api\\)$`));
    const long = firstLine(recap(withFirst({ repo: 'r'.repeat(80) })));
    const label = long.match(/· (r+…)\)$/)[1];
    assert.ok(displayWidth(label) <= 24);
  });

  test('Turkish: label and day order', () => {
    assert.match(firstLine(recap(base, { lang: 'tr' })), new RegExp(`^  İlk commit\\s+"Initial commit" \\(2 Mar 2026 · ${base.firstCommit.hash}\\)$`));
  });
});

// --- wrapped.md ------------------------------------------------------------------------

describe('wrapped.md (extra)', () => {
  const base = computeStats([commit('2026-03-06T10:00:00Z', 'second'), commit('2026-03-02T09:00:00Z', 'Initial commit')], { today: TODAY });
  const withFirst = (patch) => ({ ...base, firstCommit: { ...base.firstCommit, ...patch } });
  const md = (s, opts = {}) => buildMarkdown(s, { repoName: 'demo', today: TODAY, ...opts });

  test('markdown specials, mentions, references and URLs are neutralised', () => {
    const line = mdLine(md(withFirst({ subject: 'Fix *bold* _it_ [link](https://x.y) #12 @bob `code` <b> ~~s~~ www.evil.io' })));
    assert.ok(line.includes('\\*bold\\*'), line);
    assert.ok(line.includes('\\_it\\_'), line);
    assert.ok(line.includes('\\[link\\]'), line);
    assert.ok(line.includes('\\`code\\`'), line);
    assert.ok(line.includes('\\<b\\>'), line);
    assert.doesNotMatch(line, /(?<!\\)@bob/);
    assert.doesNotMatch(line, /(?<!\\)#12/);
    assert.doesNotMatch(line, /https:\/\//);
    assert.doesNotMatch(line, /(?<![\\\u2060])www\./);
  });

  test('a newline / control character in the subject cannot break the list item', () => {
    const out = md(withFirst({ subject: 'one\n\n# Injected heading\r\n- item' }));
    assert.doesNotMatch(out, /^# Injected/m);
    assert.equal(mdLine(out).includes('Injected heading'), true);
  });

  test('a very long subject is cut at 120 characters with "…"', () => {
    const line = mdLine(md(withFirst({ subject: 'word '.repeat(100) })));
    const inner = line.match(/“(.*)”/)[1];
    assert.ok([...inner].length <= 120, `${[...inner].length}`);
    assert.ok(inner.endsWith('…'));
  });

  test('CJK / emoji subjects are kept intact when short, cut without split pairs when long', () => {
    assert.ok(mdLine(md(withFirst({ subject: '初始化 🎉 👩‍💻' }))).includes('“初始化 🎉 👩‍💻”'));
    const line = mdLine(md(withFirst({ subject: '🎉'.repeat(300) })));
    assert.doesNotMatch(line, LONE_SURROGATE);
  });

  test('Turkish: label and day', () => {
    assert.ok(md(base, { lang: 'tr' }).includes(`- **İlk commit:** “Initial commit” (2 Mar 2026 · \`${base.firstCommit.hash}\`)`));
  });

  test('no date / no hash: no empty parentheses; null subject → (no subject)', () => {
    assert.ok(mdLine(md(withFirst({ date: null, hash: null }))).endsWith('“Initial commit”'));
    assert.match(mdLine(md(withFirst({ subject: null }))), /\*\*First commit:\*\* \\\(no subject\\\) \(Mar 2, 2026/);
    assert.doesNotMatch(md(withFirst({ date: null, hash: null })), /undefined|null|NaN/);
  });

  test('multi-repo label is escaped and email-scrubbed', () => {
    assert.ok(mdLine(md(withFirst({ repo: 'my_api' }))).endsWith(`\`${base.firstCommit.hash}\` · my\\_api)`));
    assert.doesNotMatch(md(withFirst({ repo: 'ada@example.com' })), /example\.com/);
  });
});

// --- end to end: real git repos ---------------------------------------------------------

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
}

/** Every file under `dir`, recursively. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const capture = () => {
  const s = { text: '', write: (x) => { s.text += x; return true; } };
  return s;
};

describe('first commit end to end (extra)', () => {
  let root;
  const repos = {};
  const person = (name, email) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email });
  const ada = person('Ada', 'ada@example.com');
  const bob = person('Bob', 'bob@example.com');
  let k = 0;
  const step = (repo, who, date, msg) => {
    k += 1;
    writeFileSync(join(repo, `f${k}.txt`), `${k}\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg], { ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  };
  const init = (name) => {
    const repo = join(root, name);
    mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    repos[name] = repo;
    return repo;
  };
  const out = (name) => join(root, 'out', name);

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'gw-first-extra-'));
    // tz: Ada's root in 2024; then Bob in two zones around New Year 2025 (the +14:00 one is
    // the earlier instant but the later local day), then Ada in 2025.
    const tz = init('tz');
    step(tz, ada, '2024-06-01T10:00:00+00:00', 'root by ada@example.com');
    step(tz, bob, '2025-01-01T00:30:00+14:00', 'plus fourteen');
    step(tz, bob, '2024-12-31T20:00:00-10:00', 'minus ten');
    step(tz, ada, '2025-03-01T10:00:00+00:00', 'ada 2025');

    // merge: two 2024 commits on two branches, joined by a 2025 merge commit only.
    const merge = init('merge');
    step(merge, ada, '2024-05-01T10:00:00+00:00', 'main 2024');
    git(merge, ['checkout', '-q', '-b', 'side']);
    step(merge, bob, '2024-06-01T10:00:00+00:00', 'side 2024');
    git(merge, ['checkout', '-q', 'main']);
    git(merge, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], { ...ada, GIT_AUTHOR_DATE: '2025-02-01T10:00:00+00:00', GIT_COMMITTER_DATE: '2025-02-01T10:00:00+00:00' });

    // tie: parent and child at the same instant; the parent (older in git order) wins.
    const tie = init('tie');
    step(tie, ada, '2025-04-01T10:00:00+00:00', 'tie parent');
    step(tie, ada, '2025-04-01T12:00:00+02:00', 'tie child');

    // special: a subject full of markdown / XML specials and emails, and a CJK one.
    const special = init('special');
    step(special, ada, '2025-05-01T10:00:00+00:00', 'Init <app> & *stuff* by Ada <ada@example.com> 🎉 #1 @bob');
    step(special, ada, '2025-05-02T10:00:00+00:00', '修复：初始化项目结构和配置文件以及所有的依赖关系还有更多的内容');

    // other: another repo whose first commit is the earliest of a multi-repo run in 2025.
    const other = init('other');
    step(other, bob, '2025-01-01T00:00:00+00:00', 'other begins');
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('--year 2025 via the CLI: the window\'s first commit by author-local day (the +14:00 one)', async () => {
    const stdout = capture();
    const code = await run([repos.tz, '--out', out('year'), '--no-png', '--no-color', '--json', '--md', '--year', '2025'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('year'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.firstCommit.subject, 'plus fourteen');
    assert.equal(doc.stats.firstCommit.date, '2025-01-01');
    assert.match(stdout.text, /First commit\s+"plus fourteen" \(Jan 1, 2025 · [0-9a-f]{7}\)/);
    const hash = doc.stats.firstCommit.hash;
    assert.equal(git(repos.tz, ['rev-parse', '--short=7', hash]).trim(), hash);
    assert.equal(git(repos.tz, ['log', '-1', '--format=%s', hash]).trim(), 'plus fourteen');
  });

  test('--since / --until: the first commit follows the window', async () => {
    const r1 = await generate({ path: repos.tz, out: out('s1'), png: false, since: '2025-01-02' }, { today: '2026-01-10' });
    assert.equal(r1.stats.firstCommit.subject, 'ada 2025');
    const r2 = await generate({ path: repos.tz, out: out('s2'), png: false, until: '2024-12-31' }, { today: '2026-01-10' });
    assert.equal(r2.stats.firstCommit.subject, 'root by …');
    const r3 = await generate({ path: repos.tz, out: out('s3'), png: false, since: '2024-07-01', until: '2024-12-31' }, { today: '2026-01-10' });
    // Only "minus ten" (local Dec 31, 2024) is in the second half of 2024.
    assert.equal(r3.stats.firstCommit.subject, 'minus ten');
    assert.equal(r3.stats.firstCommit.date, '2024-12-31');
  });

  test('--author: the author\'s own first commit (earliest instant), not the team\'s', async () => {
    const r = await generate({ path: repos.tz, out: out('bob'), png: false, json: true, author: 'bob@example.com' }, { today: '2026-01-10' });
    assert.equal(r.stats.firstCommit.subject, 'plus fourteen');
    assert.equal(r.stats.firstCommit.date, '2025-01-01');
    const a = await generate({ path: repos.tz, out: out('ada'), png: false, json: true, author: 'ada@example.com', since: '2025-01-01' }, { today: '2026-01-10' });
    assert.equal(a.stats.firstCommit.subject, 'ada 2025');
  });

  test('a window holding only a merge commit: firstCommit null in JSON, no panel, no recap line', async () => {
    const stdout = capture();
    const code = await run([repos.merge, '--out', out('merge'), '--no-png', '--no-color', '--json', '--md', '--since', '2025-01-01'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('merge'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.totals.commits, 1);
    assert.equal(Object.hasOwn(doc.stats, 'firstCommit'), true);
    assert.equal(doc.stats.firstCommit, null);
    assert.doesNotMatch(stdout.text, /First commit/);
    assert.doesNotMatch(readFileSync(join(out('merge'), 'wrapped.md'), 'utf8'), /First commit/);
    const introSvg = walk(join(out('merge'), 'cards')).filter((p) => p.endsWith('.svg')).sort()[0];
    assert.doesNotMatch(readFileSync(introSvg, 'utf8'), /BEGAN/);
    // Without the window, the first non-merge commit of the whole history.
    const all = await generate({ path: repos.merge, out: out('merge-all'), png: false }, { today: '2026-01-10' });
    assert.equal(all.stats.firstCommit.subject, 'main 2024');
  });

  test('a parent and child on the same instant: the parent wins', async () => {
    const r = await generate({ path: repos.tie, out: out('tie'), png: false }, { today: '2026-01-10' });
    assert.equal(r.stats.firstCommit.subject, 'tie parent');
  });

  test('specials: no email in any output file; SVG well-formed; md escaped; tr recap', async () => {
    const stdout = capture();
    const code = await run([repos.special, '--out', out('special'), '--no-png', '--no-color', '--json', '--md', '--lang', 'tr'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('special'), 'stats.json'), 'utf8'));
    assert.equal(doc.stats.firstCommit.subject, 'Init <app> & *stuff* by Ada <…> 🎉 #1 @bob');
    assert.match(stdout.text, /İlk commit\s+"Init <app> & \*stuff\* by Ada <…> 🎉 #1 @bob" \(1 May 2025 · [0-9a-f]{7}\)/);
    const md = readFileSync(join(out('special'), 'wrapped.md'), 'utf8');
    assert.ok(mdLine(md).includes('“Init \\<app\\> \\& \\*stuff\\* by Ada \\<…\\> 🎉 \\#\u2060' + '1 \\@\u2060bob”'), mdLine(md));
    // The first commit's own fields never carry an email; nor does the recap / md line.
    assert.doesNotMatch(JSON.stringify(doc.stats.firstCommit) + firstLine(stdout.text) + mdLine(md), /@example|example\.com/);
    // Every card, share image and wrapped.md. (stats.json's messages.longest and the
    // viewer's screen-reader text carry raw subjects: a pre-existing, separate issue.)
    for (const file of walk(out('special')).filter((p) => /\.(svg|md)$/.test(p))) {
      const body = readFileSync(file, 'utf8');
      assert.doesNotMatch(body, /ada@example\.com|bob@example\.com/, file);
      if (file.endsWith('.svg')) assert.doesNotMatch(body, /<app>|&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/i, file);
    }
    const introSvg = walk(join(out('special'), 'cards')).filter((p) => p.endsWith('.svg')).sort()[0];
    assert.ok(texts(readFileSync(introSvg, 'utf8')).some((t) => t.startsWith('“Init <app> & *stuff*')), introSvg);
  });

  test('multi-repo: the repo field names the earliest repo, in JSON, recap and md', async () => {
    const stdout = capture();
    const code = await run([repos.tz, repos.other, repos.special, '--out', out('multi'), '--no-png', '--no-color', '--json', '--md', '--year', '2025'], { stdout, stderr: capture(), env: {}, today: '2026-01-10' });
    assert.equal(code, 0, stdout.text);
    const doc = JSON.parse(readFileSync(join(out('multi'), 'stats.json'), 'utf8'));
    // "plus fourteen" (Dec 31 10:30 UTC) is before "other begins" (Jan 1 00:00 UTC).
    assert.deepEqual(Object.keys(doc.stats.firstCommit), ['date', 'subject', 'hash', 'repo']);
    assert.equal(doc.stats.firstCommit.subject, 'plus fourteen');
    assert.equal(doc.stats.firstCommit.repo, 'tz');
    assert.match(firstLine(stdout.text), / · tz\)$/);
    assert.match(mdLine(readFileSync(join(out('multi'), 'wrapped.md'), 'utf8')), / · tz\)$/);
    // Without tz, the other repo's commit is the first one.
    const r = await generate({ paths: [repos.special, repos.other], out: out('multi2'), png: false, year: '2025', since: '2025-01-01', until: '2025-12-31' }, { today: '2026-01-10' });
    assert.equal(r.stats.firstCommit.repo, 'other');
    assert.equal(r.stats.firstCommit.subject, 'other begins');
  });

  test('a single repo never has a repo key in stats.json', async () => {
    const r = await generate({ path: repos.other, out: out('single'), png: false, json: true }, { today: '2026-01-10' });
    const doc = JSON.parse(readFileSync(r.statsJson, 'utf8'));
    assert.deepEqual(Object.keys(doc.stats.firstCommit), ['date', 'subject', 'hash']);
  });
});
