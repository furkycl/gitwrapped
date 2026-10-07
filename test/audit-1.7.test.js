// Cold audit of the 1.7 work (time zones, files born / buried, busiest day): regression
// tests for the bugs it found.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStats, computeTimezones, shownTimezones } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
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
const statsOf = (commits) => computeStats(commits, { today: TODAY });
/** `count` commits on consecutive March days at 10:00, all at `offset`. */
const at = (offset, count) => Array.from({ length: count }, (_, i) =>
  commit(`2026-03-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00${offset}`));
const recap = (stats, lang) => formatSummary(stats, { repoName: 'demo', today: TODAY, lang });
const md = (stats, lang) => buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang });
const tzLine = (text, lang) => text.split('\n').find((l) => l.includes(LANGS[lang].recap.timezones)) ?? null;

describe('time zones: a share never reads 100% while another zone exists', () => {
  const stats = statsOf([...at('+03:00', 2000), ...at('-05:00', 1)]);

  test('stats.timezones.top.share stays below 1', () => {
    assert.equal(stats.timezones.count, 2);
    assert.equal(stats.timezones.top.offset, '+03:00');
    assert.equal(stats.timezones.top.commits, 2000);
    assert.ok(stats.timezones.top.share < 1, `share ${stats.timezones.top.share} < 1`);
    assert.ok(computeTimezones([...at('+03:00', 2000), ...at('-05:00', 1)]).top.share < 1);
  });

  test('shownTimezones keeps the top share below 100', () => {
    const shown = shownTimezones(stats.timezones);
    assert.equal(shown.top, '+03:00');
    assert.ok(shown.share < 100, `share ${shown.share} < 100`);
  });

  for (const lang of ['en', 'tr']) {
    test(`recap and wrapped.md (${lang}): "99", never "100%"`, () => {
      for (const [what, text] of [['recap', recap(stats, lang)], ['wrapped.md', md(stats, lang)]]) {
        const line = tzLine(text, lang);
        assert.ok(line, `${what} has a time-zone line`);
        assert.ok(line.includes(LANGS[lang].recap.mostly('UTC+03:00')), `${what}: ${line}`);
        assert.doesNotMatch(line, /100/, `${what}: ${line}`);
        assert.match(line, /99/, `${what}: ${line}`);
        assert.doesNotMatch(line, /100\s?%|%\s?100/, `${what}: the time-zone line never says 100%`);
      }
    });
  }

  test('a single-zone repo: still no time-zone line', () => {
    const one = statsOf(at('+03:00', 2000));
    assert.equal(one.timezones.count, 1);
    assert.equal(one.timezones.top.share, 1);
    assert.equal(shownTimezones(one.timezones), null);
    for (const lang of ['en', 'tr']) {
      assert.equal(tzLine(recap(one, lang), lang), null);
      assert.equal(tzLine(md(one, lang), lang), null);
    }
  });

  test('an exact 50/50 tie: no "mostly"', () => {
    const tie = statsOf([...at('+03:00', 1000), ...at('-05:00', 1000)]);
    assert.equal(tie.timezones.top.share, 0.5);
    assert.equal(shownTimezones(tie.timezones).top, null);
    for (const lang of ['en', 'tr']) {
      const mostly = LANGS[lang].recap.mostly('X').replace(' X', '');
      for (const text of [recap(tie, lang), md(tie, lang)]) {
        const line = tzLine(text, lang);
        assert.ok(line && line.includes(LANGS[lang].recap.timezonesValue(2)), line);
        assert.ok(!line.includes(mostly), line);
      }
    }
  });
});

describe('totals card: the files born / buried label is never cut', () => {
  const base = () => statsOf([commit('2026-03-01T10:00:00Z'), commit('2026-03-02T10:00:00Z')]);
  const card = (stats, lang) => ({
    spec: buildCardSpecs(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').spec,
    svg: buildCards(stats, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'totals').svg,
  });

  for (const lang of ['en', 'tr']) {
    for (const fileLifecycle of [{ added: 123456, deleted: 654321 }, { added: 12345, deleted: 6789 }]) {
      test(`${lang}, ${fileLifecycle.added} / ${fileLifecycle.deleted}`, () => {
        const label = LANGS[lang].totals.fileLifecycle;
        const { spec, svg } = card({ ...base(), fileLifecycle }, lang);
        assert.deepEqual(spec.lines.at(-1), { label, value: LANGS[lang].totals.fileLifecycleValue(fileLifecycle.added, fileLifecycle.deleted) });
        assert.ok(svg.includes(label), `the SVG holds the full label "${label}"`);
        for (let k = 1; k < label.length; k += 1) {
          const cut = `${label.slice(0, k).trimEnd()}…`;
          assert.ok(!svg.includes(cut), `no truncated "${cut}"`);
        }
      });
    }
  }
});

describe('CHANGELOG', () => {
  test('[1.7.0] mentions the busiest day and "Busiest weekday"', () => {
    const text = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
    const m = /^## \[1\.7\.0\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(text);
    assert.ok(m, 'a [1.7.0] section');
    assert.match(m[1], /busiest day/i);
    assert.match(m[1], /Busiest weekday/);
  });
});
