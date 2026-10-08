// Cold audit of the 1.12 work (co-change pair, cleanup commits, renames). Bugs fixed
// (regression tests below):
// - the totals card's plain "Born / buried" row (stats.fileLifecycle, released in 1.10) was
//   added without a fit check, so 7-digit counts drew a cut value ("9,999,999 / 9,999,…"),
//   also as the fallback of the 1.12 "Born / buried / renamed" row: it is now left off when
//   it would be cut, as the merges row is (the recap, wrapped.md and stats.json keep it).
// - the totals card's pairing row (stats.coAuthors, released in 1.6) drew a long top
//   co-author name cut ("Paired (top: Bartholomew Alexander…"): it now falls back to
//   "Paired commits" when the name would be cut, and is left off when even that would be.
// Also removed: the unused cleanupsOnTotals export (added in 1.12).
// Also pinned here (checked, not bugs): the cleanup share is rounded once (from the exact
// ratio), and stats.json keeps exactly `{commits, share, biggest}`.
// Written by the builder of loop turn 083; extended by the tester of loop turn 083 and by
// the builder of loop turn 084 (the [1.12.0] CHANGELOG pins).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeCleanups, computeStats, shownCleanups } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, cleanupShareText } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { mergeHistories } from '../src/git.js';
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
const opts = (lang = 'en') => ({ repoName: 'demo', today: TODAY, lang });
const totalsLines = (stats, lang) => buildCardSpecs(stats, opts(lang)).find((c) => c.id === 'totals').spec.lines;
const withLifecycle = (fileLifecycle) => ({ ...computeStats([commit()], { today: TODAY }), fileLifecycle });
const LABELS = [en.totals.fileLifecycle, en.totals.fileLifecycleRenamed, tr.totals.fileLifecycle, tr.totals.fileLifecycleRenamed];
const lifecycleRowOf = (lines) => lines.find((r) => LABELS.includes(r?.label));

describe('totals card: the born / buried row is only ever drawn whole', () => {
  test('7-digit counts: no row (en and tr), instead of a cut "9,999,999 / 9,999,…"', () => {
    for (const lang of ['en', 'tr']) {
      for (const lc of [{ added: 9999999, deleted: 9999999, renamed: 0 }, { added: 1234567, deleted: 7654321, renamed: 5 }, { added: 9999999, deleted: 9999999, renamed: 9999999 }]) {
        const lines = totalsLines(withLifecycle(lc), lang);
        assert.equal(lifecycleRowOf(lines), undefined, `${lang} ${JSON.stringify(lc)}`);
        for (const r of lines) assert.ok(rowFits(r), `${lang}: ${JSON.stringify(r)} drawn whole`);
      }
    }
  });

  test('counts that fit are still drawn as before', () => {
    assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added: 999999, deleted: 999999, renamed: 0 }), 'en')), { label: 'Born / buried', value: '999,999 / 999,999' });
    assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added: 12, deleted: 3, renamed: 4 }), 'en')), { label: 'Born / buried / renamed', value: '12 / 3 / 4' });
    // Turkish: the three-part row is too wide for two digits, so the plain row stays.
    assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added: 12, deleted: 3, renamed: 4 }), 'tr')), { label: 'Doğan / gömülen', value: '12 / 3' });
  });

  test('the recap and wrapped.md still show the 7-digit counts', () => {
    const stats = withLifecycle({ added: 9999999, deleted: 9999999, renamed: 0 });
    assert.match(formatSummary(stats, { repoName: 'demo' }), /9,999,999 born · 9,999,999 buried/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /9,999,999 files added, 9,999,999 deleted/);
  });
});

describe('totals card: born / buried fit boundary and fallback chain (tester)', () => {
  const plainRow = (L, a, d) => ({ label: L.totals.fileLifecycle, value: L.totals.fileLifecycleValue(a, d) });
  const LANGS = { en, tr };

  test('boundary: the widest pair that fits is drawn, one more digit is not (en and tr)', () => {
    // [lang, added, deleted, drawn?]: en's last fitting pair is 1,000,000 / 999,999; tr's
    // longer label leaves less room ("1.000.000 / 9.999" fits, "1.000.000 / 99.999" does not).
    const cases = [
      ['en', 999999, 999999, true], ['en', 1000000, 999999, true], ['en', 9999999, 999999, true], ['en', 1000000, 1000000, false],
      ['tr', 999999, 999999, true], ['tr', 1000000, 9999, true], ['tr', 1000000, 99999, false], ['tr', 1000000, 999999, false],
    ];
    for (const [lang, added, deleted, drawn] of cases) {
      const L = LANGS[lang];
      const row = lifecycleRowOf(totalsLines(withLifecycle({ added, deleted, renamed: 0 }), lang));
      assert.deepEqual(row, drawn ? plainRow(L, added, deleted) : undefined, `${lang} ${added} / ${deleted}`);
    }
  });

  test('one big side alone still fits: "9,999,999 / 0" and "0 / 9,999,999" are drawn', () => {
    for (const lang of ['en', 'tr']) {
      for (const [added, deleted] of [[9999999, 0], [0, 9999999], [9999999, 1]]) {
        assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added, deleted, renamed: 0 }), lang)), plainRow(LANGS[lang], added, deleted), `${lang} ${added} / ${deleted}`);
      }
    }
  });

  test('row drawn exactly when the plain row fits (sweep, no renames)', () => {
    const values = [0, 1, 9, 99, 999, 9999, 99999, 999999, 1000000, 9999999];
    for (const lang of ['en', 'tr']) {
      const L = LANGS[lang];
      for (const added of values) {
        for (const deleted of values) {
          if (added + deleted === 0) continue;
          const expected = rowFits(plainRow(L, added, deleted)) ? plainRow(L, added, deleted) : undefined;
          assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added, deleted, renamed: 0 }), lang)), expected, `${lang} ${added} / ${deleted}`);
        }
      }
    }
  });

  test('chain: renamed row → plain row → no row', () => {
    // 1. the renamed row fits: drawn.
    assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle({ added: 9, deleted: 9, renamed: 9 }), 'tr')), { label: 'Doğan / gömülen / taşınan', value: '9 / 9 / 9' });
    // 2. too wide with renames, the plain row fits: the plain row.
    const fallback = { added: 1000000, deleted: 999999, renamed: 5 };
    assert.equal(rowFits({ label: en.totals.fileLifecycleRenamed, value: en.totals.fileLifecycleValue(1000000, 999999, 5) }), false);
    assert.deepEqual(lifecycleRowOf(totalsLines(withLifecycle(fallback), 'en')), { label: 'Born / buried', value: '1,000,000 / 999,999' });
    // 3. neither fits: no row at all (not a cut renamed or plain row).
    assert.equal(lifecycleRowOf(totalsLines(withLifecycle({ added: 1000000, deleted: 1000000, renamed: 5 }), 'en')), undefined);
    // Renames alone, too wide for "0 / 0 / N": no row (no plain fallback either).
    assert.equal(lifecycleRowOf(totalsLines(withLifecycle({ added: 0, deleted: 0, renamed: 9999999 }), 'en')), undefined);
  });

  test('dropping the row leaves every other totals row in place (merges and cleanups too)', () => {
    for (const lang of ['en', 'tr']) {
      const base = { ...withLifecycle({ added: 0, deleted: 0, renamed: 0 }), merges: { commits: 2, share: 0.3, pullRequests: 0 } };
      const without = totalsLines(base, lang);
      const dropped = totalsLines({ ...base, fileLifecycle: { added: 9999999, deleted: 9999999, renamed: 0 } }, lang);
      assert.deepEqual(dropped, without, lang);
      assert.ok(without.some((r) => r.label === LANGS[lang].totals.mergesLabel(0, 2)), `${lang}: merges row still drawn`);
    }
    // With cleanups as well: the dropped row does not change where they go.
    const cleaned = computeStats([commit({ files: [{ path: 'src/a.js', added: 0, removed: 5 }] }), commit()], { today: TODAY });
    const a = buildCardSpecs({ ...cleaned, fileLifecycle: { added: 0, deleted: 0, renamed: 0 } }, opts());
    const b = buildCardSpecs({ ...cleaned, fileLifecycle: { added: 9999999, deleted: 9999999, renamed: 0 } }, opts());
    assert.deepEqual(b, a);
  });

  test('the rendered totals SVG has no cut born / buried value', () => {
    for (const lang of ['en', 'tr']) {
      const svg = buildCards(withLifecycle({ added: 9999999, deleted: 9999999, renamed: 0 }), opts(lang)).find((c) => c.id === 'totals').svg;
      assert.doesNotMatch(svg, /9[,.]999[,.]…|Born \/ buried|Doğan \/ gömülen/, lang);
    }
  });

  test('multi-repo run: same rule (row dropped, repo bars kept; counts fit → row drawn)', () => {
    const histories = ['api', 'web'].map((label) => ({ label, commits: [commit()], truncated: false }));
    const { commits } = mergeHistories(histories);
    const stats = computeStats(commits, { today: TODAY, repos: ['api', 'web'] });
    for (const lang of ['en', 'tr']) {
      const big = buildCardSpecs({ ...stats, fileLifecycle: { added: 9999999, deleted: 9999999, renamed: 0 } }, opts(lang)).find((c) => c.id === 'totals').spec;
      assert.equal(lifecycleRowOf(big.lines), undefined, lang);
      for (const r of big.lines) assert.ok(rowFits(r), `${lang}: ${JSON.stringify(r)}`);
      assert.ok([].concat(big.chart).some((c) => c.kind === 'hbars'), `${lang}: repo bars kept`);
      const small = totalsLines({ ...stats, fileLifecycle: { added: 12, deleted: 3, renamed: 0 } }, lang);
      assert.deepEqual(lifecycleRowOf(small), plainRow(LANGS[lang], 12, 3), lang);
    }
  });

  test('stats.json keeps the 7-digit counts', () => {
    const stats = withLifecycle({ added: 9999999, deleted: 9999999, renamed: 3 });
    const json = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(json.stats.fileLifecycle, { added: 9999999, deleted: 9999999, renamed: 3 });
  });
});

describe('cleanup share: rounded once, from the exact ratio', () => {
  const history = (k, total) => [
    ...Array.from({ length: k }, () => commit({ files: [{ path: 'src/a.js', added: 0, removed: 5 }] })),
    ...Array.from({ length: total - k }, () => commit()),
  ];

  test('49 / 2,000 → "2%", 45 / 10,000 → "<1%", 1,999 / 2,000 → "99%", all → "100%"', () => {
    for (const [k, total, text, share] of [[49, 2000, '2%', 0.025], [45, 10000, '<1%', 0.005], [1999, 2000, '99%', 0.999], [5, 5, '100%', 1]]) {
      const stat = computeCleanups(history(k, total));
      assert.equal(stat.share, share, `${k}/${total} share`);
      assert.equal(cleanupShareText(shownCleanups(stat)), text, `${k}/${total}`);
    }
    assert.equal(cleanupShareText(shownCleanups(computeCleanups(history(49, 2000))), tr), '%2');
  });

  test('stats.json keeps exactly {commits, share, biggest}', () => {
    const stats = computeStats(history(49, 2000), { today: TODAY });
    const json = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(Object.keys(json.stats.cleanups), ['commits', 'share', 'biggest']);
    assert.equal(json.stats.cleanups.share, 0.025);
  });
});

describe('totals card: the pairing row is only ever drawn whole (orchestrator, turn 083)', () => {
  const LONG = 'Bartholomew Alexander Montgomery-Smithson the Third';
  const withPairing = (name, paired = 5) => ({
    ...computeStats([commit()], { today: TODAY }),
    coAuthors: { paired, share: 1, total: paired, top: name ? [{ name, commits: paired }] : [] },
  });
  const pairedOf = (lines, L) => lines.find((r) => typeof r?.label === 'string' && (r.label === L.pairing.row(null) || r.label.startsWith(L.pairing.row('\u0000').split('\u0000')[0])));

  test('a long top co-author name falls back to the label without it (en and tr)', () => {
    for (const [lang, L] of [['en', en], ['tr', tr]]) {
      const lines = totalsLines(withPairing(LONG), lang);
      const row = pairedOf(lines, L);
      assert.deepEqual(row, { label: L.pairing.row(null), value: '5' }, lang);
      for (const r of lines) assert.ok(rowFits(r), `${lang}: ${JSON.stringify(r)} drawn whole`);
    }
  });

  test('a short name is still shown', () => {
    assert.deepEqual(pairedOf(totalsLines(withPairing('Ada'), 'en'), en), { label: 'Paired (top: Ada)', value: '5' });
  });

  test('cleanupsOnTotals is no longer exported', async () => {
    const mod = await import('../src/cards/index.js');
    assert.equal(mod.cleanupsOnTotals, undefined);
  });
});

describe('CHANGELOG [1.12.0]', () => {
  const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');

  test('[1.12.0] names the co-change pair, cleanup commits, renames and the audit fixes', () => {
    const m = /^## \[1\.12\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.12.0] section');
    assert.match(m[1], /Co-change pair/);
    assert.match(m[1], /Cleanup commits/);
    assert.match(m[1], /Renames/);
    assert.match(m[1], /"Born \/ buried" row was drawn cut/);
    assert.match(m[1], /"Paired commits"/);
    assert.match(m[1], /stats\.coChange/);
    assert.match(m[1], /stats\.cleanups/);
    assert.match(m[1], /stats\.fileLifecycle\.renamed/);
  });

  test('compare links', () => {
    assert.match(text, /^\[1\.12\.0\]: \S+\/compare\/v1\.11\.0\.\.\.v1\.12\.0$/m);
    assert.match(text, /^\[1\.11\.0\]: \S+\/compare\/v1\.10\.0\.\.\.v1\.11\.0$/m);
  });
});
