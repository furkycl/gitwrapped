import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildCards, CARD_IDS, formatNumber, renderCard } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { readCommits } from '../src/git.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2024-03-14';
const INJECT = `<script>&"'`;
const INJECT_ESCAPED = '&lt;script&gt;&amp;&quot;&apos;';
const byId = (cards) => Object.fromEntries(cards.map((c) => [c.id, c.svg]));
const stripTags = (svg) => svg.replace(/<[^>]*>/g, ' ');

// --- XML well-formedness ---------------------------------------------------------------

/** Tiny strict-ish XML checker: balanced tags, quoted unique attributes, valid entities. Returns error string or null. */
function xmlError(xml) {
  const stack = [];
  const NAME = '[A-Za-z_:][\\w.:-]*';
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  let rootClosed = false;
  let sawRoot = false;
  for (const m of xml.matchAll(re)) {
    const tok = m[0];
    if (tok.startsWith('<!--') || tok.startsWith('<?')) continue;
    if (tok.startsWith('<')) {
      if (rootClosed) return `content after root: ${tok}`;
      let mm;
      if ((mm = tok.match(new RegExp(`^</(${NAME})\\s*>$`)))) {
        const open = stack.pop();
        if (open !== mm[1]) return `mismatched </${mm[1]}>, open was <${open}>`;
        if (stack.length === 0) rootClosed = true;
        continue;
      }
      mm = tok.match(new RegExp(`^<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>$`));
      if (!mm) return `malformed tag: ${tok.slice(0, 120)}`;
      const names = [...mm[2].matchAll(new RegExp(`(${NAME})\\s*=`, 'g'))].map((a) => a[1]);
      if (new Set(names).size !== names.length) return `duplicate attribute in ${tok.slice(0, 80)}`;
      const values = [...mm[2].matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => a[1] ?? a[2]);
      for (const v of values) if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(v)) return `raw & in attribute: ${v}`;
      if (stack.length === 0) {
        if (sawRoot) return 'multiple roots';
        sawRoot = true;
      }
      if (mm[3] === '/') {
        if (stack.length === 0) rootClosed = true;
      } else {
        stack.push(mm[1]);
      }
    } else {
      if (stack.length === 0 && tok.trim()) return `text outside root: ${tok.slice(0, 40)}`;
      if (tok.includes('>') && /]]>/.test(tok)) return 'raw ]]> in text';
      if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(tok)) return `raw & in text: ${tok.slice(0, 80)}`;
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(tok)) return 'invalid XML char';
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(tok)) return 'lone surrogate';
    }
  }
  if (!sawRoot) return 'no root';
  if (stack.length) return `unclosed <${stack.at(-1)}>`;
  return null;
}

let hasXmllint = false;
try {
  execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  hasXmllint = true;
} catch {
  hasXmllint = false;
}

// --- Stats inputs ----------------------------------------------------------------------

const emptyStats = () => computeStats([], { today: TODAY });

function stressStats() {
  const s = emptyStats();
  const big = 9_007_199_254_740_991;
  const longPath = `${'deeply/nested/'.repeat(20)}🚀/file name with spaces & <stuff>.js`;
  s.totals = { ...s.totals, commits: big, activeDays: 3, linesAdded: big, linesRemoved: 123_456_789_012, filesTouched: 1e9, authors: 5000, firstDay: '1970-01-01', lastDay: '2999-12-31' };
  s.habits = { ...s.habits, peakHour: 3, peakHourCount: big, peakHourTied: false, peakHourLabel: `3 AM ${INJECT}`, peakWeekdayName: `Caturday ${INJECT}`, peakWeekdayTied: true };
  s.streaks = { longest: { length: 100000, start: '1970-01-01', end: '2243-10-17' }, current: { length: 99999, start: 'a', end: 'b' } };
  s.hotFiles = [
    { path: longPath, commits: big, linesAdded: big, linesRemoved: big },
    { path: `x/${'y'.repeat(400)}`, commits: big, linesAdded: 1, linesRemoved: 1 },
    { path: '👩‍💻/🇹🇷/emoji-dir/ファイル.js', commits: 1, linesAdded: 1, linesRemoved: 0 },
    { path: `${INJECT}/evil.js`, commits: 1, linesAdded: 1, linesRemoved: 0 },
  ];
  s.messages = {
    shortest: { subject: `🔥 ${INJECT}`, hash: 'a', length: 1 },
    longest: { subject: `${'refactor everything '.repeat(30)}${INJECT} 🎉👨‍👩‍👧‍👦`, hash: 'b', length: 600 },
    topWord: { word: `supercalifragilistic${'x'.repeat(200)}${INJECT}`, count: big },
    counts: { fix: big, wip: big, oops: big },
    averageLength: 123456.789,
  };
  s.personality = {
    archetype: { id: 'night-owl', name: `Night Owl ${INJECT} 🦉`, roast: `${'roast '.repeat(80)}${INJECT}`, reason: `${'reason '.repeat(80)}${INJECT}` },
    scores: [{ id: 'night-owl', name: `Night ${INJECT}`, score: 1 }, { id: 'x', name: 'Other', score: 0.333333 }],
  };
  return s;
}

const STRESS_OPTS = { repoName: `${'r'.repeat(150)}${INJECT}🚀${'R'.repeat(140)}`, since: `2020-01-01 ${INJECT}`, author: `Ada ${INJECT}` };

let fixture;
let fixtureStats;
before(async () => {
  fixture = makeFixtureRepo();
  fixtureStats = computeStats(await readCommits(fixture.dir), { today: TODAY });
});
after(() => fixture?.cleanup());

const scenarios = () => [
  ['fixture', buildCards(fixtureStats, { repoName: 'fixture' })],
  ['fixture+author+since', buildCards(fixtureStats, { repoName: 'fixture', author: 'Ada Lovelace', since: '2024-01-01' })],
  ['empty', buildCards(emptyStats(), { repoName: 'empty-repo' })],
  ['no args', buildCards()],
  ['null', buildCards(null)],
  ['{}', buildCards({})],
  ['stress', buildCards(stressStats(), STRESS_OPTS)],
];

// --- Tests -----------------------------------------------------------------------------

describe('formatNumber', () => {
  test('thousands separators', () => {
    assert.equal(formatNumber(0), '0');
    assert.equal(formatNumber(7), '7');
    assert.equal(formatNumber(999), '999');
    assert.equal(formatNumber(1000), '1,000');
    assert.equal(formatNumber(12345), '12,345');
    assert.equal(formatNumber(1234567), '1,234,567');
    assert.equal(formatNumber(Number.MAX_SAFE_INTEGER), '9,007,199,254,740,991');
  });

  test('rounds to an integer', () => {
    assert.equal(formatNumber(16.4), '16');
    assert.equal(formatNumber(999.5), '1,000');
  });

  test('negatives use a minus sign (U+2212)', () => {
    assert.equal(formatNumber(-1), '−1');
    assert.equal(formatNumber(-1234567), '−1,234,567');
    assert.equal(formatNumber(-0), '0');
    assert.equal(formatNumber(-0.4), '0');
  });

  test('huge values never use scientific notation', () => {
    assert.equal(formatNumber(1e21), '1,000,000,000,000,000,000,000');
    assert.equal(formatNumber(-1e21), '−1,000,000,000,000,000,000,000');
    assert.equal(formatNumber(1.5e22), '15,000,000,000,000,000,000,000');
    const huge = formatNumber(Number.MAX_VALUE);
    assert.match(huge, /^\d{1,3}(,\d{3})+$/);
    assert.ok(!/e|E|\+/.test(huge));
    assert.equal(formatNumber(Number.MAX_VALUE * 10), '0'); // Infinity
  });

  test('non-numbers and non-finite → "0"', () => {
    for (const v of [NaN, Infinity, -Infinity, null, undefined, '123', {}, [], true]) assert.equal(formatNumber(v), '0', String(v));
  });
});

describe('buildCards', () => {
  test('returns 8 cards in CARD_IDS order with unique ids', () => {
    assert.deepEqual(CARD_IDS, ['intro', 'totals', 'peak-hour', 'streak', 'hot-files', 'messages', 'personality', 'outro']);
    assert.ok(Object.isFrozen(CARD_IDS));
    for (const [name, cards] of scenarios()) {
      assert.equal(cards.length, 8, name);
      assert.deepEqual(cards.map((c) => c.id), CARD_IDS, name);
      assert.equal(new Set(cards.map((c) => c.id)).size, 8, name);
      for (const c of cards) {
        assert.equal(typeof c.svg, 'string');
        assert.ok(c.svg.startsWith('<svg'), `${name}/${c.id}`);
      }
    }
  });

  test('never prints null / undefined / NaN / [object Object]', () => {
    for (const [name, cards] of scenarios()) {
      for (const { id, svg } of cards) {
        for (const bad of ['null', 'undefined', 'NaN', '[object Object]', 'Infinity']) {
          assert.ok(!svg.includes(bad), `${name}/${id} contains "${bad}"`);
        }
      }
    }
  });

  test('is deterministic', () => {
    assert.deepEqual(buildCards(fixtureStats, { repoName: 'fixture' }), buildCards(fixtureStats, { repoName: 'fixture' }));
    assert.deepEqual(buildCards(stressStats(), STRESS_OPTS), buildCards(stressStats(), STRESS_OPTS));
  });

  test('does not mutate the stats object', () => {
    const s = stressStats();
    const copy = structuredClone(s);
    buildCards(s, STRESS_OPTS);
    assert.deepEqual(s, copy);
  });

  test('default repo name is "your repo"', () => {
    const cards = byId(buildCards(emptyStats()));
    assert.ok(cards.intro.includes('your repo'));
    assert.ok(byId(buildCards(emptyStats(), { repoName: '   ' })).intro.includes('your repo'));
  });

  test('repoName, author and since appear escaped', () => {
    const cards = buildCards(fixtureStats, { repoName: `my${INJECT}repo`, author: `Ada ${INJECT}`, since: `2024 ${INJECT}` });
    const all = cards.map((c) => c.svg).join('\n');
    assert.ok(!/<script/i.test(all));
    assert.ok(!all.includes(INJECT));
    const m = byId(cards);
    assert.ok(m.intro.includes(`my${INJECT_ESCAPED}repo`), 'repo name escaped on intro');
    assert.ok(m.intro.includes(`Ada ${INJECT_ESCAPED}`), 'author on intro');
    // Footer is limited to 560px on one line, so the tail may be ellipsized.
    assert.ok(m.totals.includes(`my${INJECT_ESCAPED}repo · since 2024`), 'footer');
    const short = byId(buildCards(fixtureStats, { repoName: 'r', since: `${INJECT}` }));
    assert.ok(short.totals.includes(`r · since ${INJECT_ESCAPED}`), 'short footer fully escaped');
    assert.ok(m.outro.includes(`my${INJECT_ESCAPED}repo`));
  });

  test('stress stats: every field escaped, no raw <script', () => {
    const all = buildCards(stressStats(), STRESS_OPTS).map((c) => c.svg).join('\n');
    assert.ok(!/<script/i.test(all));
    assert.ok(all.includes('&lt;script&gt;'));
  });

  test('every element id is unique across the 8 cards (safe to inline together)', () => {
    for (const [name, cards] of scenarios()) {
      const ids = cards.flatMap((c) => [...c.svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
      assert.ok(ids.length >= 16, `${name}: ${ids.length} ids`);
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids ${ids}`);
      for (const { id, svg } of cards) {
        for (const m of svg.matchAll(/\sid="([^"]*)"/g)) assert.ok(m[1].startsWith(`gw-${id}-`), `${id}: ${m[1]}`);
        for (const m of svg.matchAll(/url\(#([^)]*)\)/g)) assert.ok(svg.includes(`id="${m[1]}"`), `${id}: dangling ${m[1]}`);
      }
    }
  });

  test('tied peak hour says "is tied for your power hour", never "spread around the clock"', () => {
    const s = structuredClone(fixtureStats);
    s.habits.peakHourTied = true;
    const tied = stripTags(byId(buildCards(s))['peak-hour']);
    assert.ok(tied.includes(`${s.habits.peakHourLabel} is tied for your power hour`), tied);
    assert.ok(!tied.includes('spread around the clock'));
    s.habits.peakHourTied = false;
    assert.ok(!stripTags(byId(buildCards(s))['peak-hour']).includes('tied for your power hour'));
  });

  test('topWord used fewer than 2 times falls back to the average-length variant', () => {
    const s = structuredClone(fixtureStats);
    s.messages.averageLength = 23;
    for (const count of [0, 1, null, undefined]) {
      s.messages.topWord = { word: 'lonely', count };
      const m = byId(buildCards(s)).messages;
      assert.ok(!m.includes('lonely'), `count=${count}`);
      assert.ok(m.includes('characters per message, on average'), `count=${count}`);
      assert.ok(/>23</.test(m), `count=${count}`);
    }
    s.messages.topWord = { word: 'popular', count: 2 };
    const m = byId(buildCards(s)).messages;
    assert.ok(m.includes('“popular”'));
    assert.ok(m.includes('was your favorite word (2 times)'));
  });

  test('Shortest row is dropped when it is the same message as Longest', () => {
    const s = structuredClone(fixtureStats);
    s.messages.longest = { subject: 'only commit', hash: 'abc', length: 11 };
    s.messages.shortest = { subject: 'only commit', hash: 'abc', length: 11 };
    const one = byId(buildCards(s)).messages;
    assert.ok(one.includes('Longest: “only commit”'));
    assert.ok(!one.includes('Shortest:'));
    const two = byId(buildCards(fixtureStats)).messages;
    assert.ok(two.includes('Longest:') && two.includes('Shortest:'));
  });

  test('zero line counts render as plain "0"; negatives never produce double signs', () => {
    const s = structuredClone(fixtureStats);
    s.totals.linesAdded = 0;
    s.totals.linesRemoved = 0;
    s.hotFiles[0].linesAdded = 0;
    s.hotFiles[0].linesRemoved = 0;
    let m = byId(buildCards(s));
    assert.ok(/Lines added<\/text><text [^>]*>0<\/text>/.test(m.totals), 'added 0');
    assert.ok(/Lines removed<\/text><text [^>]*>0<\/text>/.test(m.totals), 'removed 0');
    assert.ok(m['hot-files'].includes(', 0 / 0 lines.'));
    for (const bad of ['+0', '−0']) {
      assert.ok(!m.totals.includes(`>${bad}<`), bad);
      assert.ok(!m['hot-files'].includes(bad), bad);
    }
    s.totals.linesAdded = -5;
    s.totals.linesRemoved = -7;
    s.hotFiles[0].linesAdded = -5;
    s.hotFiles[0].linesRemoved = -7;
    m = byId(buildCards(s));
    const all = m.totals + m['hot-files'];
    for (const bad of ['+−', '−−', '+-', '−-', '+5', '−7', '−5']) assert.ok(!all.includes(bad), bad);
    assert.ok(m['hot-files'].includes(', 0 / 0 lines.'));
    s.totals.linesAdded = 1234;
    s.totals.linesRemoved = 56;
    m = byId(buildCards(s));
    assert.ok(m.totals.includes('>+1,234<'));
    assert.ok(m.totals.includes('>−56<'));
  });

  test('tied peak hour copy says "one of"', () => {
    const s = structuredClone(fixtureStats);
    s.habits.peakHourTied = true;
    const tied = byId(buildCards(s))['peak-hour'];
    assert.ok(tied.includes('one of'), 'tied copy');
    s.habits.peakHourTied = false;
    s.habits.peakWeekdayTied = false;
    const solo = byId(buildCards(s))['peak-hour'];
    assert.ok(!solo.includes('one of'));
    assert.ok(solo.includes('is when you commit the most'));
  });

  test('tied hot files copy says "one of"', () => {
    const s = structuredClone(fixtureStats);
    s.hotFiles[1].commits = s.hotFiles[0].commits;
    assert.ok(byId(buildCards(s))['hot-files'].includes('one of your most-touched files'));
    assert.ok(!byId(buildCards(fixtureStats))['hot-files'].includes('one of'));
  });

  test('empty stats use friendly fallback copy', () => {
    const m = byId(buildCards(emptyStats(), { repoName: 'empty-repo' }));
    assert.ok(m.totals.includes('No commits yet'));
    assert.ok(m['peak-hour'].includes('No power hour yet'));
    assert.ok(m.streak.includes('No streak yet'));
    assert.ok(m['hot-files'].includes('No hot files yet'));
    assert.ok(m.messages.includes('No commit messages yet'));
    assert.ok(m.personality.includes('Steady Shipper'));
  });

  test('singular/plural copy', () => {
    const s = structuredClone(fixtureStats);
    s.totals.commits = 1;
    s.totals.activeDays = 1;
    const totals = byId(buildCards(s)).totals;
    assert.ok(/>commit</.test(totals), 'singular title');
    assert.ok(totals.includes('1 commit per active day'));
  });

  test('every card passes the built-in XML well-formedness check', () => {
    assert.equal(xmlError('<a><b x="1"/></a>'), null);
    assert.notEqual(xmlError('<a><b></a>'), null);
    assert.notEqual(xmlError('<a x=1></a>'), null);
    assert.notEqual(xmlError('<a>& </a>'), null);
    for (const [name, cards] of scenarios()) {
      for (const { id, svg } of cards) assert.equal(xmlError(svg), null, `${name}/${id}`);
    }
  });

  test('every card passes xmllint --noout', { skip: hasXmllint ? false : 'xmllint not installed' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitwrapped-xmllint-'));
    try {
      const files = [];
      for (const [name, cards] of scenarios()) {
        for (const { id, svg } of cards) {
          const file = join(dir, `${name.replace(/\W+/g, '_')}-${id}.svg`);
          writeFileSync(file, svg);
          files.push(file);
        }
      }
      execFileSync('xmllint', ['--noout', ...files], { stdio: ['ignore', 'pipe', 'pipe'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('renderCard is re-exported', () => {
    assert.equal(typeof renderCard, 'function');
  });
});

describe('integration: fixture repo → cards', () => {
  test('cards reflect the fixture history', () => {
    const m = byId(buildCards(fixtureStats, { repoName: 'fixture' }));
    assert.ok(/>8</.test(m.totals), 'totals shows 8 commits');
    assert.ok(stripTags(m.totals).includes('8'));
    assert.ok(m['hot-files'].includes('src/app.js'));
    assert.ok(m.personality.includes('Steady Shipper'));
    assert.ok(m.messages.includes('refactor: move app to main'));
    assert.ok(m.intro.includes('fixture'));
    assert.ok(m.totals.includes('fixture · 2024-03-04 → 2024-03-13'), 'footer date range');
    assert.ok(m['peak-hour'].includes('one of'), 'fixture peak hour is tied');
    assert.ok(m.streak.includes('>5<'));
  });
});

describe('scripts/preview-cards.js', () => {
  test('writes 8 SVGs plus an empty/ set', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gitwrapped-preview-'));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [join(ROOT, 'scripts/preview-cards.js'), out], { cwd: ROOT });
      const svgs = readdirSync(out).filter((f) => f.endsWith('.svg')).sort();
      assert.equal(svgs.length, 8);
      assert.deepEqual(svgs, CARD_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`));
      const empty = readdirSync(join(out, 'empty')).filter((f) => f.endsWith('.svg'));
      assert.equal(empty.length, 8);
      assert.equal(stdout.trim().split('\n').length, 16);
      for (const f of svgs) assert.equal(xmlError(readFileSync(join(out, f), 'utf8')), null, f);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
