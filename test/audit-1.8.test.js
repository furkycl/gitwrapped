// Cold audit of the 1.8 work (top folders, weekend share, cadence): no code bugs found;
// these lock in the invariants the audit verified, plus the README wording fix (the
// weekend share is of the commits that carry a date, not of all commits).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStats, shownCadence, shownWeekend } from '../src/stats/index.js';
import { weekendPercentLabel } from '../src/stats/weekend.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { mergeHistories } from '../src/git.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-10-07';
const LANGS = { en, tr };
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(6, '0')}abcdef0123456789abcdef0123456789ab`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const recap = (stats, lang) => formatSummary(stats, { repoName: 'demo', today: TODAY, lang });
const md = (stats, lang) => buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang });
const lineWith = (text, needle) => text.split('\n').find((l) => l.includes(needle)) ?? null;
const datedOf = (stats) => (stats.habits?.byHour ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

describe('weekend share: the base is the commits that carry a date', () => {
  test('2 dated (1 Saturday) + 2 undated → {commits: 1, share: 0.5}, totals.commits 4', () => {
    const stats = statsOf([
      commit('2026-03-07T10:00:00Z'), // Saturday
      commit('2026-03-09T10:00:00Z'), // Monday
      commit('bad'),
      commit('bad'),
    ]);
    assert.equal(stats.totals.commits, 4);
    assert.equal(datedOf(stats), 2, 'the power-hour base counts the dated commits only');
    assert.deepEqual(stats.weekend, { commits: 1, share: 0.5 });
    assert.deepEqual(shownWeekend(stats), { commits: 1, percent: 50 });
  });

  test('README describes stats.weekend.share as of the commits that carry a date', () => {
    const text = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
    const start = text.indexOf('`stats.weekend`');
    assert.ok(start >= 0, 'README documents stats.weekend');
    const para = text.slice(start, text.indexOf('\n\n', start)).replace(/\s+/g, ' ');
    assert.match(para, /`share` is of the commits that carry a date/);
    assert.doesNotMatch(para, /share` is of all commits/);
  });
});

describe('seeded fuzz: weekend / cadence / folders never leak or break', () => {
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const offs = ['+00:00', '+03:00', '-05:00', '+14:00', '-12:00', '+05:30'];
  const paths = ['src/a.js', 'src/deep/b.ts', 'test/x.test.js', 'README.md', 'docs/g.md', 'ada@example.com/x.js',
    'ada@example.com/k', `lib/${'z'.repeat(80)}/f.js`, 'package-lock.json', 'img/logo.png', '(root)/weird.js', 'a b/c.js'];
  const BAD = /NaN|undefined/;
  const start = Date.parse('2025-06-01T00:00:00Z');

  test('60 histories, en + tr', () => {
    for (let it = 0; it < 60; it += 1) {
      const k = 1 + Math.floor(rnd() * 40);
      const list = [];
      for (let i = 0; i < k; i += 1) {
        const t = new Date(start + Math.floor(rnd() * 500) * 86400000 + Math.floor(rnd() * 86400000));
        let d = t.toISOString().slice(0, 19) + pick(offs);
        if (rnd() < 0.05) d = `2099-05-0${1 + Math.floor(rnd() * 8)}T10:00:00Z`;
        if (rnd() < 0.05) d = 'bad';
        const files = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({
          path: pick(paths), added: pick([0, 1, 5, 100, null]), removed: pick([0, 2, null]),
        }));
        list.push(commit(d, { subject: pick(['feat: x', 'fix: y', 'work']), files, parents: rnd() < 0.1 ? ['a', 'b'] : ['p'] }));
      }
      const multi = rnd() < 0.3;
      const commits = multi
        ? mergeHistories([{ label: 'api', commits: list.slice(0, k >> 1) }, { label: 'web', commits: list.slice(k >> 1) }]).commits
        : list;
      const ctx = `history ${it} (${k} commits${multi ? ', 2 repos' : ''})`;
      const stats = statsOf(commits, multi ? { repos: ['api', 'web'] } : {});

      const { commits: wc, share } = stats.weekend;
      assert.ok(share >= 0 && share <= 1, `${ctx}: share ${share} in [0, 1]`);
      const dated = datedOf(stats);
      if (wc !== dated) assert.ok(share <= 0.999, `${ctx}: share ${share} ≤ 0.999 (${wc} of ${dated})`);
      else if (dated > 0) assert.equal(share, 1, `${ctx}: all dated commits on a weekend`);
      if (stats.cadence?.perActiveDay > 0) assert.ok(stats.cadence.perActiveDay >= 1, `${ctx}: perActiveDay ${stats.cadence.perActiveDay}`);
      const cad = shownCadence(stats, TODAY);
      if (cad) assert.ok(cad.perActiveDay >= 1 && cad.medianGapDays > 0, `${ctx}: shown cadence ${JSON.stringify(cad)}`);
      assert.ok(!JSON.stringify(stats.folders).includes('ada@example.com'), `${ctx}: no email in stats.folders`);

      for (const lang of ['en', 'tr']) {
        const opts = { repoName: 'demo', today: TODAY, lang };
        const cards = buildCards(stats, opts);
        buildCardSpecs(stats, opts);
        const outputs = [['recap', formatSummary(stats, opts)], ['wrapped.md', buildMarkdown(stats, opts)],
          ...cards.map((c) => [`card ${c.id}`, c.svg])];
        for (const [what, text] of outputs) {
          assert.doesNotMatch(text, BAD, `${ctx} ${lang} ${what}: ${text.match(/.{0,30}(NaN|undefined).{0,30}/)?.[0]}`);
          assert.ok(!text.includes('ada@example.com'), `${ctx} ${lang} ${what}: leaks the email`);
        }
      }
    }
  });
});

describe('recap and wrapped.md agree on the weekend percent and the cadence', () => {
  // 7 commits on 4 active days (Fri, Sat x3, Sun, Tue): 4 weekend of 7 → 57%.
  const stats = statsOf([
    commit('2026-03-06T10:00:00Z'),
    commit('2026-03-07T09:00:00Z'), commit('2026-03-07T11:00:00Z'), commit('2026-03-07T15:00:00Z'),
    commit('2026-03-08T10:00:00Z'),
    commit('2026-03-10T10:00:00Z'), commit('2026-03-10T12:00:00Z'),
  ]);

  test('stats', () => {
    assert.deepEqual(stats.weekend, { commits: 4, share: 0.571 });
    assert.deepEqual(shownWeekend(stats), { commits: 4, percent: 57 });
    const cad = shownCadence(stats, TODAY);
    assert.equal(cad.activeDays, 4);
    assert.equal(cad.perActiveDay, 1.8);
  });

  for (const lang of ['en', 'tr']) {
    test(lang, () => {
      const L = LANGS[lang];
      const r = recap(stats, lang);
      const m = md(stats, lang);
      const pct = L.recap.ofCommits(weekendPercentLabel(shownWeekend(stats).percent, L.pct));
      const rw = lineWith(r, L.recap.weekend);
      const mw = lineWith(m, L.markdown.weekend);
      assert.ok(rw && mw, `weekend lines: ${rw} / ${mw}`);
      assert.ok(rw.includes(pct), `recap: ${rw}`);
      assert.ok(mw.includes(pct), `wrapped.md: ${mw}`);
      assert.match(pct, /57/);

      const cad = shownCadence(stats, TODAY);
      const text = `${L.streak.cadencePerDay(cad.perActiveDay)} · ${L.streak.cadenceEvery(cad.medianGapDays)}`;
      const rc = lineWith(r, L.recap.cadence);
      const mc = lineWith(m, L.markdown.cadence);
      assert.ok(rc && mc, `cadence lines: ${rc} / ${mc}`);
      assert.ok(rc.includes(text), `recap: ${rc} has "${text}"`);
      assert.ok(mc.includes(text), `wrapped.md: ${mc} has "${text}"`);
    });
  }
});
