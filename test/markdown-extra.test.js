// --md edge cases: combined with --theme / --json / --exclude / multi-repo / --year (yoy)
// / --no-png, hostile contributor names and commit subjects, Turkish headings, no emails
// and no machine paths anywhere.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, run } from '../src/cli.js';
import { buildMarkdown } from '../src/markdown.js';
import { computeStats } from '../src/stats/index.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2024-03-14';
const EMAIL_RE = /[\w.+-]+\\?@[\w-]+(\.[\w-]+)+/;

function sink() {
  let data = '';
  return {
    write(s) {
      data += s;
      return true;
    },
    get data() {
      return data;
    },
  };
}

function commit(date, subject, files = [{ path: 'src/app.js', added: 3, removed: 1 }], author = 'Ada', email = 'ada@example.com') {
  return {
    hash: `${date}-${subject}-${author}`, author, email, date, subject, parents: [], files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

/** Cells of a Markdown table row, split on unescaped pipes. */
const cells = (row) => row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());

/** Every table in `md` keeps the column count of its header row. */
function assertTablesWellFormed(md) {
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || (i > 0 && lines[i - 1].startsWith('|'))) continue;
    const width = cells(lines[i]).length;
    for (let j = i; j < lines.length && lines[j].startsWith('|'); j++) assert.equal(cells(lines[j]).length, width, `row "${lines[j]}" in\n${md}`);
  }
}

const strip = (md) => md.replace(/^!\[.*$/gm, '');

let fx;
let fx2;
const outs = [];
const tmpOut = () => {
  const o = mkdtempSync(join(tmpdir(), 'gw-mdx-out-'));
  outs.push(o);
  return o;
};

before(() => {
  fx = makeFixtureRepo();
  fx2 = makeFixtureRepo();
});

after(() => {
  fx?.cleanup();
  fx2?.cleanup();
  for (const o of outs) rmSync(o, { recursive: true, force: true, maxRetries: 5 });
});

describe('--md combined with other flags', () => {
  test('--theme does not change wrapped.md', async () => {
    const a = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true }, { today: TODAY });
    const b = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true, theme: 'mono' }, { today: TODAY });
    assert.equal(readFileSync(b.markdown, 'utf8'), readFileSync(a.markdown, 'utf8'));
  });

  test('--json + --md: both written; headline numbers agree with stats.json', async () => {
    const out = tmpOut();
    const stdout = sink();
    const code = await run([fx.dir, '--md', '--json', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const t = json.stats.totals;
    assert.match(md, new RegExp(`^- \\*\\*Commits:\\*\\* ${t.commits}$`, 'm'));
    assert.match(md, new RegExp(`^- \\*\\*Active days:\\*\\* ${t.activeDays}$`, 'm'));
    assert.match(md, new RegExp(`^- \\*\\*Files touched:\\*\\* ${t.filesTouched}$`, 'm'));
    assert.match(stdout.data, /stats\.json/);
    assert.match(stdout.data, /Markdown summary: .*wrapped\.md/);
  });

  test('--no-png and PNG runs write the same wrapped.md (PNGs are never linked)', async () => {
    const fakePng = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const a = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true }, { today: TODAY });
    const b = await generate({ path: fx.dir, out: tmpOut(), png: true, md: true }, { today: TODAY, renderPng: fakePng });
    const md = readFileSync(b.markdown, 'utf8');
    assert.equal(md, readFileSync(a.markdown, 'utf8'));
    assert.doesNotMatch(md, /\]\([^)]*\.png\)/);
    assert.doesNotMatch(md, /pngs\//);
  });

  test('--exclude removes the file from hot files and languages in wrapped.md', async () => {
    const plain = readFileSync((await generate({ path: fx.dir, out: tmpOut(), png: false, md: true }, { today: TODAY })).markdown, 'utf8');
    assert.match(plain, /\| src\/app\.js \|/);
    const r = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true, exclude: ['src/app.js'] }, { today: TODAY });
    const md = readFileSync(r.markdown, 'utf8');
    assert.doesNotMatch(md, /src\/app\.js/);
    const t = r.stats.totals;
    const sign = (n, s) => (n > 0 ? `${s}${n.toLocaleString('en-US')}` : '0');
    assert.match(md, new RegExp(`^- \\*\\*Lines:\\*\\* ${sign(t.linesAdded, '\\+')} / ${sign(t.linesRemoved, '−')}$`, 'm'));
  });

  test('multi-repo: "N repos" title, repo table, no absolute paths', async () => {
    const out = tmpOut();
    const r = await generate({ path: fx.dir, paths: [fx.dir, fx2.dir], out, png: false, md: true }, { today: TODAY });
    const md = readFileSync(r.markdown, 'utf8');
    assert.match(md, /^# 2 repos Wrapped$/m);
    assert.match(md, /^## Repos$/m);
    assert.ok(!md.includes(fx.dir) && !md.includes(fx2.dir) && !md.includes(out) && !md.includes(tmpdir()), md);
    assertTablesWellFormed(md);
    assert.ok(!md.includes('@'));
  });

  test('multi-repo in Turkish names the run in Turkish', async () => {
    const r = await generate({ path: fx.dir, paths: [fx.dir, fx2.dir], out: tmpOut(), png: false, md: true, lang: 'tr' }, { today: TODAY });
    const md = readFileSync(r.markdown, 'utf8');
    assert.doesNotMatch(md, /2 repos/);
    assert.match(md, new RegExp(`^## ${tr.recap.repos}$`, 'm'));
  });

  test('--year with a previous year: yoy line, window label as subtitle, en and tr', async () => {
    const all = [
      commit('2024-05-02T10:00:00Z', 'b'), commit('2024-05-01T10:00:00Z', 'a'),
      commit('2023-07-03T10:00:00Z', 'z'), commit('2023-07-02T10:00:00Z', 'y'), commit('2023-07-01T10:00:00Z', 'x'),
    ];
    const reader = async (_p, { since, until, author, limit }) => {
      const pool = all.filter((c) => (!author || c.email === author) && (!since || c.date.slice(0, 10) >= since) && (!until || c.date.slice(0, 10) <= until));
      return { commits: pool.slice(0, limit), truncated: pool.length > limit, limit, shallow: false };
    };
    const today = '2025-01-10';
    const r = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true, year: '2024', since: '2024-01-01', until: '2024-12-31' }, { today, readHistory: reader });
    assert.ok(r.stats.yearOverYear, 'yoy computed');
    const md = readFileSync(r.markdown, 'utf8');
    assert.match(md, /^_2024_$/m);
    assert.match(md, /^- \*\*vs 2023:\*\* −1 commit, /m);
    // Past window: streak is "at window end" if any is running; never "Current streak".
    assert.doesNotMatch(md, /Current streak/);
    const rt = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true, year: '2024', since: '2024-01-01', until: '2024-12-31', lang: 'tr' }, { today, readHistory: reader });
    const mdt = readFileSync(rt.markdown, 'utf8');
    assert.doesNotMatch(mdt, /vs 2023/);
    assert.ok(mdt.includes(tr.recap.vsYear(2023)), mdt);
  });
});

describe('hostile names and subjects', () => {
  const nasty = [
    commit('2024-03-01T10:00:00Z', 'merge `main` | see https://evil.io/x?a=b and www.evil.io, ping <dev@corp.io> (cc: ops@corp.io)', [{ path: 'src/a.js', added: 900, removed: 1 }]),
    commit('2024-03-02T10:00:00Z', 'x', [{ path: 'src/b.js', added: 2, removed: 0 }], '**Bold** | [link](http://x.io) <img src=x>', 'bold@corp.io'),
    commit('2024-03-03T10:00:00Z', 'y', [{ path: 'src/c.js', added: 2, removed: 0 }], 'mallory@corp.io', 'mallory@corp.io'),
    commit('2024-03-04T10:00:00Z', 'z', [{ path: 'src/d.js', added: 2, removed: 0 }], 'Eve <eve@corp.io>', 'eve@corp.io'),
    commit('2024-03-05T10:00:00Z', 'w', [{ path: 'src/e.js', added: 2, removed: 0 }], 'Line\nBreak‮RTL', 'lb@corp.io'),
  ];
  const stats = computeStats(nasty, { today: TODAY, author: 'ada@example.com', team: nasty });

  for (const lang of ['en', 'tr']) {
    test(`${lang}: no emails, no live links, no raw HTML, tables intact, single lines`, () => {
      const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, author: 'Ada <ada@example.com>', lang });
      assert.ok(!md.includes('@'), md);
      assert.doesNotMatch(md, /corp\.io>|example\.com/);
      assert.doesNotMatch(md, /https?:\/\//);
      assert.doesNotMatch(md, /(?<!\\)www\./);
      assert.doesNotMatch(md, /(?<!\\)<(img|dev)/);
      assert.doesNotMatch(md, /(?<!\\)\[link/);
      assert.ok(!/[‪-‮⁦-⁩]/.test(md));
      assertTablesWellFormed(md);
      // The team table: the markdown-y name escaped (contributorName cuts at "<").
      assert.ok(md.includes('| \\*\\*Bold\\*\\* \\| \\[link\\]\\(http\\://x.io\\) |'), md);
      assert.match(md, /\| mallory \|/);
      assert.match(md, /\| Eve \|/);
      assert.match(md, /\| Line Break RTL \|/);
      // The subject keeps its words; the addresses are gone.
      assert.match(md, /“merge \\`main\\` \\\| see https\\:\/\/evil\.io\/x\?a=b and www\\\.evil\.io, ping \\<…\\> \\\(cc: …\\\)”/);
    });
  }

  test('long subject is clipped to one line', () => {
    const s = computeStats([commit('2024-03-01T10:00:00Z', 'word '.repeat(200), [{ path: 'a.js', added: 999, removed: 0 }])], { today: TODAY });
    const md = buildMarkdown(s, { today: TODAY });
    const line = md.split('\n').find((l) => l.startsWith('“'));
    assert.ok(line && line.includes('…”'), md);
    assert.ok([...line].length < 200);
  });

  // BUG: emails are only scrubbed from commit subjects (freeText). A hot-file path or a
  // repo (folder) name that contains an address is written as "ada\@example.com", which
  // still renders as the address. The module promises "Never contains an email address".
  test('an email-shaped hot-file path or repo name does not leak the address', () => {
    const s = computeStats([commit('2024-03-01T10:00:00Z', 'add key', [{ path: 'keys/ada@example.com.pub', added: 1, removed: 0 }])], { today: TODAY });
    const md = buildMarkdown(s, { repoName: 'me@corp.io', today: TODAY });
    assert.doesNotMatch(md, EMAIL_RE, md);
  });
});

describe('output shape', () => {
  const stats = computeStats([
    commit('2024-03-01T23:00:00Z', 'a'), commit('2024-03-02T23:00:00Z', 'b', [{ path: 'README.md', added: 4, removed: 0 }], 'Bob', 'bob@example.com'),
  ], { today: TODAY, author: 'ada@example.com', team: [commit('2024-03-01T23:00:00Z', 'a'), commit('2024-03-02T23:00:00Z', 'b', [{ path: 'README.md', added: 4, removed: 0 }], 'Bob', 'bob@example.com')] });
  const cards = ['intro', 'totals', 'peak-hour', 'streak', 'activity', 'months', 'hot-files', 'languages', 'contributors', 'messages', 'personality', 'outro'].map((id, i) => ({ id, file: `cards/${String(i + 1).padStart(2, '0')}-${id}.svg` }));

  test('ends with exactly one newline, no trailing spaces, no blank-line runs', () => {
    for (const lang of ['en', 'tr']) {
      for (const s of [stats, computeStats([], { today: TODAY })]) {
        const md = buildMarkdown(s, { repoName: 'x', today: TODAY, lang, cards });
        assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'), JSON.stringify(md.slice(-20)));
        assert.doesNotMatch(md, /[ \t]+$/m);
        assert.doesNotMatch(md, /\n\n\n/);
        assert.doesNotMatch(md, /\r/);
      }
    }
  });

  test('Turkish output has no untranslated English section headings or labels', () => {
    const md = strip(buildMarkdown(stats, { repoName: 'x', today: TODAY, lang: 'tr', cards }));
    const headings = md.match(/^##? .*$/gm);
    const enHeadings = [en.markdown.numbers, en.markdown.habits, en.markdown.streaks, en.markdown.hotFiles, en.markdown.languages, en.markdown.cards, en.contributors.eyebrow, en.personality.eyebrow, en.recap.repos];
    for (const h of headings) for (const e of enHeadings) assert.ok(!h.includes(e), `English heading "${e}" in "${h}"`);
    const enLabels = [en.markdown.busiestWeekday, en.markdown.busiestDay, en.markdown.longestStreak, en.markdown.longestBreak, en.markdown.currentStreak, en.markdown.file, en.markdown.contributor, en.markdown.footer, en.recap.powerHour, en.totals.activeDays, en.totals.filesTouched];
    for (const l of enLabels) assert.ok(!md.includes(l), `English "${l}" in Turkish output`);
    assert.doesNotMatch(md, /\b(Biggest commit|Starring|days|commits|lines)\b/);
    // Every card alt text is Turkish too.
    const alts = buildMarkdown(stats, { today: TODAY, lang: 'tr', cards }).match(/!\[[^\]]*\]/g);
    assert.equal(alts.length, cards.length);
    for (const a of alts) assert.ok(!Object.values(en.markdown.cardNames).some((n) => a === `![${n}]` && !Object.values(tr.markdown.cardNames).includes(n)), a);
  });

  test('every card id has a localized alt text (no raw ids)', () => {
    for (const lang of ['en', 'tr']) {
      const md = buildMarkdown(stats, { today: TODAY, lang, cards });
      for (const { id } of cards) assert.ok(!md.includes(`![${id}]`) && !md.includes(`![${id.replace('-', '\\-')}]`), `${lang}: raw id ${id}`);
    }
  });

  test('unknown --lang falls back to English sections', () => {
    const md = buildMarkdown(stats, { today: TODAY, lang: 'xx' });
    assert.match(md, /^## In numbers$/m);
  });

  test('nothing breaks on garbage stats', () => {
    for (const s of [undefined, null, {}, { totals: { commits: 3 } }, { totals: { commits: NaN } }]) {
      const md = buildMarkdown(s, { today: TODAY });
      assert.equal(typeof md, 'string');
      assert.ok(md.endsWith('\n'));
      assert.doesNotMatch(md, /NaN|undefined|null|-0\b/);
    }
  });

  test('zero lines show as "0 / 0", never "+0" or "−0"', () => {
    const s = computeStats([commit('2024-03-01T10:00:00Z', 'empty', [])], { today: TODAY });
    const md = buildMarkdown(s, { today: TODAY });
    assert.match(md, /^- \*\*Lines:\*\* 0 \/ 0$/m);
    assert.doesNotMatch(md, /[+−]0\b/);
  });
});
