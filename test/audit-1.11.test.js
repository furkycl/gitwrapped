// Cold audit of the 1.11 work. Bugs fixed (regression tests below):
// - the merge share was rounded twice (stats.merges.share to 3 decimals, then to a whole
//   percent), so 45 merges of 10,000 commits (0.45%) read "1%" instead of "<1%" and 49 of
//   2,000 (2.45%) read "3%" instead of "2%": the shown percent now comes from the exact
//   ratio computeMerges keeps non-enumerably, while stats.json keeps exactly
//   `{commits, share, pullRequests}`;
// - a contributor's share was rounded twice (one decimal, then a whole percent), so 49 of
//   2,000 commits (2.45%, share 2.5) read "3%" on the team card, the recap and wrapped.md:
//   contributorShare() now gives the exact percent, and stats.json still has share 2.5.
// Written by the tester of loop turn 078.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeContributors, computeMerges, computeStats, contributorShare, shareLabel, shownMerges } from '../src/stats/index.js';
import { buildCardSpecs, mergeShareText } from '../src/cards/index.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (extra = {}) => ({
  hash: `${String(++n).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`,
  date: '2026-03-02T10:00:00Z',
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 1, removed: 0 }],
  parents: ['p'],
  ...extra,
});
const merge = () => commit({ subject: "Merge branch 'side'", parents: ['a', 'b'], files: [] });
/** `m` merge commits among `total` commits. */
const history = (m, total) => [...Array.from({ length: m }, merge), ...Array.from({ length: total - m }, () => commit())];
const opts = (lang = 'en', extra = {}) => ({ repoName: 'demo', today: TODAY, lang, ...extra });
const shownText = (stat, L = en) => mergeShareText(shownMerges(stat), L);

describe('merge share: the shown percent is rounded once, from the exact ratio', () => {
  test('45 / 10,000 → "<1%", 49 / 2,000 → "2%", 2,497 / 100,000 → "2%", all merges → "100%"', () => {
    for (const [m, total, text, share] of [[45, 10000, '<1%', 0.005], [49, 2000, '2%', 0.025], [2497, 100000, '2%', 0.025], [7, 7, '100%', 1]]) {
      const stat = computeMerges(history(m, total));
      assert.equal(stat.share, share, `${m}/${total} share`);
      assert.equal(shownText(stat), text, `${m}/${total}`);
    }
    assert.equal(shownText(computeMerges(history(45, 10000)), tr), '<%1');
    assert.equal(shownText(computeMerges(history(49, 2000)), tr), '%2');
  });

  test('near the ends: 9,999 of 10,000 reads 99%, one of a million "<1%"', () => {
    assert.equal(shownText(computeMerges(history(9999, 10000))), '99%');
    assert.equal(shownMerges(computeMerges(history(9999, 10000))).pct < 100, true);
    assert.equal(shownText({ commits: 1, share: 0, pullRequests: 0 }), '<1%');
  });

  test('stats.merges keeps exactly {commits, share, pullRequests}; a JSON copy falls back to share', () => {
    const stat = computeMerges(history(45, 10000));
    assert.deepEqual(stat, { commits: 45, share: 0.005, pullRequests: 0 });
    assert.deepEqual(Object.keys(stat), ['commits', 'share', 'pullRequests']);
    assert.equal(JSON.stringify(stat), '{"commits":45,"share":0.005,"pullRequests":0}');
    // The exact ratio is one own non-enumerable symbol.
    const syms = Object.getOwnPropertySymbols(stat);
    assert.equal(syms.length, 1);
    assert.equal(Object.getOwnPropertyDescriptor(stat, syms[0]).enumerable, false);
    const copy = JSON.parse(JSON.stringify(stat));
    assert.deepEqual(copy, { commits: 45, share: 0.005, pullRequests: 0 });
    assert.deepEqual(Object.keys(copy), ['commits', 'share', 'pullRequests']);
    assert.equal(Object.getOwnPropertySymbols(copy).length, 0);
    // Without the exact ratio: from share (0.5% → "1%", 2.5% → "3%"), as before.
    assert.equal(shownText(copy), '1%');
    assert.equal(shownText({ ...computeMerges(history(49, 2000)) }), '3%');
    assert.equal(shownText(structuredClone(computeMerges(history(49, 2000)))), '3%');
    assert.equal(shownText(JSON.parse(JSON.stringify(computeMerges(history(7, 7))))), '100%');
    // Empty and malformed input as before.
    assert.deepEqual(computeMerges([]), { commits: 0, share: 0, pullRequests: 0 });
    assert.equal(shownMerges(computeMerges([])), null);
    assert.equal(shownMerges(null), null);
    assert.equal(shownText({ commits: 3, share: 2, pullRequests: 0 }), '99%');
  });

  test('stats.json keeps the 3-decimal share', () => {
    const stats = computeStats(history(49, 2000), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.merges, { commits: 49, share: 0.025, pullRequests: 0 });
    assert.deepEqual(Object.keys(doc.stats.merges), ['commits', 'share', 'pullRequests']);
  });

  test('totals card, recap and wrapped.md agree: 45 of 10,000 → "<1%", en and tr', () => {
    const s = computeStats(history(45, 10000), { today: TODAY });
    for (const [lang, L, row, recap] of [
      ['en', en, '45 · <1%', /45 merge commits \(<1% of commits\)/],
      ['tr', tr, '45 · <%1', /<%1/],
    ]) {
      const totals = buildCardSpecs(s, opts(lang)).find((c) => c.id === 'totals').spec;
      const r = (totals.lines ?? []).find((x) => x.label === L.totals.mergesLabel(0, 45));
      assert.equal(r?.value, row, `${lang}: ${JSON.stringify(totals.lines)}`);
      assert.match(formatSummary(s, opts(lang)), recap, `${lang} recap`);
      assert.match(buildMarkdown(s, opts(lang)), lang === 'en' ? /45 merge commits \\\(\\<1% of commits\\\)/ : /\\<%1/, `${lang} md`);
    }
  });

  test('49 of 2,000 → "2%" on the totals card, recap and wrapped.md (was "3%")', () => {
    const s = computeStats(history(49, 2000), { today: TODAY });
    const totals = buildCardSpecs(s, opts()).find((c) => c.id === 'totals').spec;
    assert.ok((totals.lines ?? []).some((x) => x.value === '49 · 2%'), JSON.stringify(totals.lines));
    assert.match(formatSummary(s, opts()), /49 merge commits \(2% of commits\)/);
    assert.match(buildMarkdown(s, opts()), /49 merge commits \\\(2% of commits\\\)/);
  });
});

describe('contributor share: the shown percent is rounded once, from the exact percent', () => {
  // 1,951 commits by Ada and 49 by Bob: Bob's share is 2.45% (stats.json 2.5).
  const bob = (extra = {}) => commit({ author: 'Bob', email: 'bob@example.com', ...extra });
  const pair = () => [...Array.from({ length: 1951 }, () => commit()), ...Array.from({ length: 49 }, () => bob())];

  test('contributorShare gives the exact percent; the JSON row keeps share 2.5 and its keys', () => {
    const c = computeContributors(pair());
    const row = c.top[1];
    assert.equal(row.name, 'Bob');
    assert.equal(row.share, 2.5);
    assert.ok(Math.abs(contributorShare(row) - 2.45) < 1e-9, String(contributorShare(row)));
    assert.equal(shareLabel(contributorShare(row), row.commits), '2%');
    assert.deepEqual(Object.keys(row), ['name', 'rank', 'commits', 'added', 'removed', 'share']);
    const copy = JSON.parse(JSON.stringify(row));
    assert.deepEqual(copy, { name: 'Bob', rank: 2, commits: 49, added: row.added, removed: row.removed, share: 2.5 });
    assert.deepEqual(Object.keys(copy), Object.keys(row));
    // A copy falls back to the one-decimal share (as before: "3%").
    assert.equal(contributorShare(copy), 2.5);
    assert.equal(shareLabel(contributorShare(copy), copy.commits), '3%');
    assert.equal(contributorShare(null), undefined);
    assert.equal(contributorShare({ share: 4 }), 4);
    // you is a row too.
    const you = computeContributors(pair(), { author: 'bob@example.com' }).you;
    assert.equal(you.share, 2.5);
    assert.equal(shareLabel(contributorShare(you), you.commits), '2%');
  });

  test('stats.json keeps share 2.5', () => {
    const stats = computeStats(pair(), { today: TODAY });
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    const row = doc.stats.contributors.top.find((p) => p.name === 'Bob');
    assert.equal(row.share, 2.5);
    assert.deepEqual(Object.keys(row), ['name', 'rank', 'commits', 'added', 'removed', 'share']);
  });

  test('team card, recap and wrapped.md show "2%" for Bob (--author), en and tr', () => {
    const team = pair();
    const s = computeStats(team.filter((c) => c.email === 'bob@example.com'), { today: TODAY, team, author: 'bob@example.com' });
    const spec = buildCardSpecs(s, opts('en', { author: 'bob@example.com' })).find((c) => c.id === 'contributors').spec;
    assert.equal(spec.big, '#2');
    assert.match(spec.subtitle, /You made 2% of the commits/);
    assert.ok(spec.chart.items.some((i) => /Bob \(you\): #2, 49 commits \(2%\)/.test(i.title)), JSON.stringify(spec.chart.items));
    assert.doesNotMatch(JSON.stringify(spec), /3%/);
    assert.match(formatSummary(s, opts()), /you're #2 \(2% of commits\)/);
    assert.match(buildMarkdown(s, opts()), /\| 2 \| Bob \\\(you\\\) \| 49 \| 2% \|/);
    const trSpec = buildCardSpecs(s, opts('tr', { author: 'bob@example.com' })).find((c) => c.id === 'contributors').spec;
    assert.match(trSpec.subtitle, /%2/);
    assert.doesNotMatch(JSON.stringify(trSpec), /%3/);
    assert.match(formatSummary(s, opts('tr')), /sıran #2 \(commit'lerin %2 kadarı\)/);
  });

  test('without --author: the wrapped.md table and the team card rows show "2%"', () => {
    const s = computeStats(pair(), { today: TODAY });
    assert.match(buildMarkdown(s, opts()), /\| 2 \| Bob \| 49 \| 2% \|/);
    const spec = buildCardSpecs(s, opts()).find((c) => c.id === 'contributors').spec;
    assert.ok(spec.chart.items.some((i) => /Bob: #2, 49 commits \(2%\)/.test(i.title)), JSON.stringify(spec.chart.items));
  });

  test('a lead at 2.45% (wrapped.md "you\'re #7" line and the team card lead line)', () => {
    // Six people ahead of Bob (326 + 5 × 325 = 1,951), Bob 7th with 49 of 2,000.
    const team = [
      ...[326, 325, 325, 325, 325, 325].flatMap((k, i) => Array.from({ length: k }, () => commit({ author: `P${i}`, email: `p${i}@example.com` }))),
      ...Array.from({ length: 49 }, () => bob()),
    ];
    const s = computeStats(team.filter((c) => c.email === 'bob@example.com'), { today: TODAY, team, author: 'bob@example.com' });
    assert.equal(s.contributors.you.rank, 7);
    // wrapped.md escapes "#7" (with a word joiner) and the parentheses.
    assert.match(buildMarkdown(s, opts()), /you're \\#\u2060?7 \\\(2% of commits\\\)/);
    assert.match(formatSummary(s, opts()), /you're #7 \(2% of commits\)/);
    const spec = buildCardSpecs(s, opts('en', { author: 'bob@example.com' })).find((c) => c.id === 'contributors').spec;
    assert.match(spec.subtitle, /2% of the commits/);
    // The lead (16.3%) without --author: "P0 leads the pack with 16% of the commits."
    const all = computeStats(team, { today: TODAY });
    const lead = buildCardSpecs(all, opts()).find((c) => c.id === 'contributors').spec;
    assert.match(lead.subtitle, /P0 leads the pack with 16% of the commits/);
  });
});

describe('end to end (the CLI run() on a real repo): 49 merges and 49 Bob commits of 2,000', () => {
  test('stats.json keeps the rounded shares, recap / wrapped.md / cards show "2%"', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { run } = await import('../src/cli.js');
    const tmp = mkdtempSync(join(tmpdir(), 'gw-a111-'));
    try {
      const repo = join(tmp, 'demo');
      mkdirSync(repo, { recursive: true });
      const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
      for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
      const g = (args, input) => execFileSync('git', args, { cwd: repo, env, input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
      g(['init', '-q', '-b', 'main']);
      // A fast-import stream: 1,902 mainline commits and 49 side-branch commits by Ada, and
      // 49 merges of the side commits by Bob: 2,000 commits, 49 of them merges, 49 by Bob.
      const start = Date.parse('2026-01-05T10:00:00Z') / 1000;
      let t = 0;
      let mark = 0;
      let head = 0;
      const out = [];
      const who = (name) => `${name} <${name.toLowerCase()}@example.com> ${start + 3600 * t++} +0000`;
      const data = (s) => `data ${Buffer.byteLength(s)}\n${s}`;
      const plain = (ref, from, name, msg, i) => {
        mark += 1;
        out.push(`commit ${ref}`, `mark :${mark}`, `author ${who(name)}`, `committer ${who(name)}`, data(`${msg}\n`));
        if (from) out.push(`from :${from}`);
        out.push(`M 644 inline src/${ref.endsWith('side') ? 'side' : 'main'}.js`, data(`${i}\n`), '');
        return mark;
      };
      for (let i = 0; i < 1902; i += 1) {
        head = plain('refs/heads/main', head, 'Ada', 'work', i);
        if (i % 38 === 37 && i < 49 * 38) {
          const side = plain('refs/heads/side', head, 'Ada', 'side work', i);
          mark += 1;
          out.push('commit refs/heads/main', `mark :${mark}`, `author ${who('Bob')}`, `committer ${who('Bob')}`, data("Merge branch 'side'\n"), `from :${head}`, `merge :${side}`, `M 644 inline src/side.js`, data(`${i}\n`), '');
          head = mark;
        }
      }
      out.push('done', '');
      g(['fast-import', '--quiet', '--done'], out.join('\n'));
      g(['reset', '-q', '--hard', 'main']);
      assert.equal(String(g(['rev-list', '--count', 'main'])).trim(), '2000');
      assert.equal(String(g(['rev-list', '--count', '--merges', 'main'])).trim(), '49');

      const sink = (f) => ({ write: (x) => { f(String(x)); return true; }, isTTY: false });
      const cli = async (args, lang) => {
        const dir = join(tmp, `out-${lang}-${args.length}`);
        let stdout = '';
        const code = await run([repo, '--no-png', '--json', '--md', '--lang', lang, '--out', dir, ...args], { stdout: sink((x) => { stdout += x; }), stderr: sink(() => {}), env: {}, today: TODAY });
        assert.equal(code, 0);
        const doc = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'));
        const md = readFileSync(join(dir, 'wrapped.md'), 'utf8');
        return { doc, md, stdout, dir };
      };

      const { doc, md, stdout } = await cli([], 'en');
      assert.deepEqual(doc.stats.merges, { commits: 49, share: 0.025, pullRequests: 0 });
      assert.deepEqual(Object.keys(doc.stats.merges), ['commits', 'share', 'pullRequests']);
      const bobRow = doc.stats.contributors.top.find((p) => p.name === 'Bob');
      assert.equal(bobRow.commits, 49);
      assert.equal(bobRow.share, 2.5);
      assert.deepEqual(Object.keys(bobRow), ['name', 'rank', 'commits', 'added', 'removed', 'share']);
      assert.match(stdout, /49 merge commits \(2% of commits\)/);
      assert.match(md, /49 merge commits \\\(2% of commits\\\)/);
      assert.match(md, /\| 2 \| Bob \| 49 \| 2% \|/);
      assert.doesNotMatch(md, /\(3% of commits\)/);

      const trRun = await cli([], 'tr');
      assert.match(trRun.stdout, /%2/);
      assert.match(trRun.md, /\| 2 \| Bob \| 49 \| %2 \|/);

      // --author bob: every analyzed commit is a merge (100%), and Bob is #2 with 2%.
      const you = await cli(['--author', 'bob@example.com'], 'en');
      assert.deepEqual(you.doc.stats.merges, { commits: 49, share: 1, pullRequests: 0 });
      assert.equal(you.doc.stats.contributors.you.share, 2.5);
      assert.match(you.stdout, /49 merge commits \(100% of commits\)/);
      assert.match(you.stdout, /you're #2 \(2% of commits\)/);
      assert.match(you.md, /\| 2 \| Bob \\\(you\\\) \| 49 \| 2% \|/);
      const svgs = (await import('node:fs')).readdirSync(join(you.dir, 'cards')).filter((f) => f.endsWith('.svg'));
      const teamSvg = svgs.find((f) => /contributors/.test(f));
      assert.ok(teamSvg, svgs.join(', '));
      const svg = readFileSync(join(you.dir, 'cards', teamSvg), 'utf8');
      assert.match(svg, /You made 2% of the commits/);
      assert.doesNotMatch(svg, /You made 3%/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('time-zone and pairing shares: the shown percent is rounded once (fix attempt 2)', async () => {
  const { computeCoAuthors, computeTimezones, exactPercent, shownCoAuthors, shownTimezones } = await import('../src/stats/index.js');

  test('shownTimezones: 1,049 of 2,000 from +03:00 reads "52%" (share 52.5), a copy falls back', () => {
    const tz = { count: 2, offsets: [{ offset: '+03:00', commits: 1049 }, { offset: '+00:00', commits: 951 }] };
    const shown = shownTimezones(tz);
    assert.deepEqual(shown, { count: 2, top: '+03:00', commits: 1049, share: 52.5 });
    assert.deepEqual(Object.keys(shown), ['count', 'top', 'commits', 'share']);
    assert.ok(Math.abs(exactPercent(shown) - 52.45) < 1e-9);
    assert.equal(shareLabel(exactPercent(shown), shown.commits), '52%');
    assert.equal(shareLabel(exactPercent(shown), shown.commits, tr.pct), '%52');
    assert.equal(shareLabel(exactPercent({ ...shown }), shown.commits), '53%');
    // Never 100% short of every commit; a tiny top share still reads as a percent.
    const big = shownTimezones({ offsets: [{ offset: '+03:00', commits: 99999 }, { offset: '+00:00', commits: 1 }] });
    assert.equal(shareLabel(exactPercent(big), big.commits), '99%');
  });

  test('computeCoAuthors: 49 paired of 2,000 keeps share 2.5 in stats.json, shows "2%"', () => {
    const commits = Array.from({ length: 2000 }, (_, i) => commit(i < 49 ? { coAuthors: [{ name: 'Bob', email: 'bob@example.com' }] } : {}));
    const co = computeCoAuthors(commits);
    assert.equal(co.share, 2.5);
    assert.deepEqual(Object.keys(co), ['paired', 'commits', 'share', 'total', 'top']);
    assert.equal(JSON.parse(JSON.stringify(co)).share, 2.5);
    const shown = shownCoAuthors(co);
    assert.deepEqual(shown, { paired: 49, share: 2.5, top: 'Bob' });
    assert.equal(shareLabel(exactPercent(shown), shown.paired), '2%');
    assert.equal(shareLabel(exactPercent(shown), shown.paired, tr.pct), '%2');
    // A JSON copy falls back to the one-decimal share (as before).
    assert.equal(shareLabel(exactPercent(shownCoAuthors(JSON.parse(JSON.stringify(co)))), 49), '3%');
    // Every commit paired → 100%; one of 10,000 → "<1%".
    const all = computeCoAuthors(commits.slice(0, 49));
    assert.equal(shareLabel(exactPercent(shownCoAuthors(all)), 49), '100%');
    const one = computeCoAuthors(Array.from({ length: 10000 }, (_, i) => commit(i === 0 ? { coAuthors: [{ name: 'Bob', email: 'bob@example.com' }] } : {})));
    assert.equal(shareLabel(exactPercent(shownCoAuthors(one)), 1), '<1%');
  });

  test('recap and wrapped.md show "52%" for time zones and "2%" for pairing, en and tr', () => {
    const commits = [
      ...Array.from({ length: 1049 }, (_, i) => commit({ date: '2026-03-02T10:00:00+03:00', ...(i < 49 ? { coAuthors: [{ name: 'Bob', email: 'bob@example.com' }] } : {}) })),
      ...Array.from({ length: 951 }, () => commit({ date: '2026-03-02T10:00:00+00:00' })),
    ];
    const s = computeStats(commits, { today: TODAY });
    assert.equal(computeTimezones(commits).top.share, 0.525);
    const recap = formatSummary(s, opts());
    assert.match(recap, /UTC\+03:00 \(52% of commits\)/);
    assert.match(recap, /2% of non-merge commits/);
    const md = buildMarkdown(s, opts());
    assert.match(md, /UTC\+03:00, 52% of commits/);
    assert.match(md, /2% of non-merge commits/);
    assert.doesNotMatch(recap + md, /53% of commits|3% of non-merge/);
    const trRecap = formatSummary(s, opts('tr'));
    assert.match(trRecap, /commit'lerin %52 kadarı/);
    assert.match(trRecap, /merge dışı commit'lerin %2 kadarı/);
    const trMd = buildMarkdown(s, opts('tr'));
    assert.match(trMd, /%52/);
    assert.match(trMd, /merge dışı commit'lerin %2 kadarı/);
  });
});

describe('CHANGELOG [1.11.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.11.0] names period over period, bus factor, broader test detection and the rounding fix', () => {
    const m = /^## \[1\.11\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.11.0] section');
    assert.match(m[1], /Period over period/);
    assert.match(m[1], /Bus factor/);
    assert.match(m[1], /Broader test detection/);
    assert.match(m[1], /rounded twice/);
    assert.match(m[1], /stats\.previousPeriod/);
    assert.match(m[1], /stats\.contributors\.busFactor/);
  });

  test('compare links', () => {
    assert.match(text, /^\[1\.11\.0\]: \S+\/compare\/v1\.10\.0\.\.\.v1\.11\.0$/m);
    assert.match(text, /^\[1\.10\.0\]: \S+\/compare\/v1\.9\.0\.\.\.v1\.10\.0$/m);
  });
});
