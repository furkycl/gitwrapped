// Time zones: the distinct UTC offsets of the commits' author dates and the most common
// one, as stats.timezones (computeTimezones, src/stats/timezones.js), on the power-hour
// card (when the commits came from two or more offsets and it fits), in the recap and in
// wrapped.md (two or more offsets).
import { test, describe, before, after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { computeStats, computeTimezones, formatOffset, offsetMinutes, shownTimezones, utcLabel } from '../src/stats/index.js';
import { buildCards, buildCardSpecs, COLOR_THEME_NAMES, layoutCard } from '../src/cards/index.js';
import { CONTENT_BOTTOM, CONTENT_TOP } from '../src/cards/svg.js';
import { buildStatsJson } from '../src/json.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { generate } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-07';
let n = 0;
const commit = (date, extra = {}) => ({
  hash: `${String(++n).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`,
  date,
  subject: 'work',
  author: 'Ada',
  email: 'ada@example.com',
  files: [{ path: 'src/a.js', added: 3, removed: 1 }],
  parents: ['p'],
  ...extra,
});
const statsOf = (commits) => computeStats(commits, { today: TODAY });
/** `count` commits on consecutive March days at `hour`, offsets cycling through `offsets`. */
const spread = (offsets, count = 30, hour = 21) => Array.from({ length: count }, (_, i) =>
  commit(`2026-03-${String(1 + (i % 28)).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00${offsets[i % offsets.length]}`));
const peakSpec = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'peak-hour').spec;
const peakSvg = (stats, opts = {}) => buildCards(stats, { repoName: 'demo', today: TODAY, ...opts }).find((c) => c.id === 'peak-hour').svg;

/** Blocks inside the content area and not overlapping (as test/commit-types-extra.test.js). */
function assertLayoutOk(spec, label) {
  const layout = layoutCard(spec);
  const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
  for (const [i, b] of sorted.entries()) {
    assert.ok(b.top >= CONTENT_TOP && b.bottom <= CONTENT_BOTTOM, `${label}: ${b.kind} [${b.top}, ${b.bottom}] inside the content area`);
    if (i > 0) assert.ok(b.top >= sorted[i - 1].bottom, `${label}: ${b.kind} does not overlap ${sorted[i - 1].kind}`);
  }
  return layout;
}

describe('computeTimezones', () => {
  test('empty or missing input → no offsets', () => {
    const none = { count: 0, top: null, offsets: [] };
    assert.deepEqual(computeTimezones([]), none);
    assert.deepEqual(computeTimezones(), none);
    assert.deepEqual(computeTimezones(null), none);
    assert.deepEqual(computeTimezones('nope'), none);
    assert.deepEqual(statsOf([]).timezones, none);
    assert.deepEqual(computeStats().timezones, none);
  });

  test('a single offset', () => {
    const tz = computeTimezones([commit('2026-03-01T09:00:00+03:00'), commit('2026-03-02T23:00:00+03:00')]);
    assert.deepEqual(tz, { count: 1, top: { offset: '+03:00', commits: 2, share: 1 }, offsets: [{ offset: '+03:00', commits: 2 }] });
  });

  test('most commits first; the top offset with its share (3 decimals)', () => {
    const tz = computeTimezones([
      commit('2026-03-01T09:00:00+03:00'), commit('2026-03-02T09:00:00-05:00'),
      commit('2026-03-03T09:00:00+03:00'), commit('2026-03-04T09:00:00+00:00'),
      commit('2026-03-05T09:00:00+03:00'), commit('2026-03-06T09:00:00-05:00'),
    ]);
    assert.equal(tz.count, 3);
    assert.deepEqual(tz.top, { offset: '+03:00', commits: 3, share: 0.5 });
    assert.deepEqual(tz.offsets, [{ offset: '+03:00', commits: 3 }, { offset: '-05:00', commits: 2 }, { offset: '+00:00', commits: 1 }]);
    assert.equal(computeTimezones([commit('2026-03-01T09:00:00+01:00'), commit('2026-03-02T09:00:00+01:00'), commit('2026-03-03T09:00:00+02:00')]).top.share, 0.667);
  });

  test('ties: the lower offset first (west to east), whatever the input order', () => {
    const commits = [commit('2026-03-01T09:00:00+05:30'), commit('2026-03-02T09:00:00Z'), commit('2026-03-03T09:00:00-08:00'), commit('2026-03-04T09:00:00+01:00')];
    const want = ['-08:00', '+00:00', '+01:00', '+05:30'];
    assert.deepEqual(computeTimezones(commits).offsets.map((o) => o.offset), want);
    assert.deepEqual(computeTimezones([...commits].reverse()).offsets.map((o) => o.offset), want);
    assert.deepEqual(computeTimezones(commits).top, { offset: '-08:00', commits: 1, share: 0.25 });
  });

  test('"Z", "+00:00" and "-00:00" are one offset, "+00:00"', () => {
    const tz = computeTimezones([commit('2026-03-01T09:00:00Z'), commit('2026-03-02T09:00:00z'), commit('2026-03-03T09:00:00+00:00'), commit('2026-03-04T09:00:00-00:00')]);
    assert.deepEqual(tz.offsets, [{ offset: '+00:00', commits: 4 }]);
    assert.equal(tz.count, 1);
  });

  test('negative, half-hour and quarter-hour offsets; "+0530" is "+05:30"', () => {
    const tz = computeTimezones([
      commit('2026-03-01T09:00:00-03:30'), commit('2026-03-02T09:00:00+05:30'), commit('2026-03-03T09:00:00+0530'),
      commit('2026-03-04T09:00:00+05:45'), commit('2026-03-05T09:00:00-09:30'), commit('2026-03-06T09:00:00+14:00'), commit('2026-03-07T09:00:00-12:00'),
    ]);
    assert.deepEqual(tz.offsets, [
      { offset: '+05:30', commits: 2 },
      { offset: '-12:00', commits: 1 }, { offset: '-09:30', commits: 1 }, { offset: '-03:30', commits: 1 },
      { offset: '+05:45', commits: 1 }, { offset: '+14:00', commits: 1 },
    ]);
    assert.equal(tz.count, 6);
  });

  test('every commit counts, merges included (as the power hour); bad dates and entries are skipped', () => {
    const merge = commit('2026-03-01T09:00:00-05:00', { parents: ['a', 'b'], files: [] });
    const tz = computeTimezones([merge, commit('2026-03-02T09:00:00+03:00'), commit('nope'), commit('2026-03-03T09:00:00'), commit('2024-02-30T09:00:00Z'), null, 42]);
    assert.deepEqual(tz.offsets, [{ offset: '-05:00', commits: 1 }, { offset: '+03:00', commits: 1 }]);
    assert.equal(tz.top.share, 0.5);
    const counted = statsOf([merge, commit('2026-03-02T09:00:00+03:00')]);
    assert.equal(counted.habits.byHour.reduce((a, b) => a + b, 0), counted.timezones.offsets.reduce((a, o) => a + o.commits, 0));
  });

  test('stats.timezones follows stats.habits', () => {
    const keys = Object.keys(statsOf([commit('2026-03-01T09:00:00Z')]));
    assert.equal(keys[keys.indexOf('habits') + 1], 'timezones');
  });

  test('a multi-repo run counts the merged commits', () => {
    const a = [commit('2026-03-01T09:00:00+03:00', { repo: 'api' }), commit('2026-03-02T09:00:00+03:00', { repo: 'api' })];
    const b = [commit('2026-03-03T09:00:00-05:00', { repo: 'web' })];
    const s = computeStats([...a, ...b], { today: TODAY, repos: ['api', 'web'] });
    assert.deepEqual(s.timezones.offsets, [{ offset: '+03:00', commits: 2 }, { offset: '-05:00', commits: 1 }]);
  });
});

describe('offset helpers', () => {
  test('formatOffset / offsetMinutes round trip', () => {
    for (const [m, s] of [[0, '+00:00'], [180, '+03:00'], [-300, '-05:00'], [330, '+05:30'], [-570, '-09:30'], [840, '+14:00']]) {
      assert.equal(formatOffset(m), s);
      assert.equal(offsetMinutes(s), m);
    }
    assert.equal(formatOffset(-0), '+00:00');
    assert.equal(offsetMinutes('-00:00'), 0);
    assert.ok(Object.is(offsetMinutes('-00:00'), 0));
    for (const bad of [null, 1, 'Z', '+3:00', '+0300', '+03:60', '+24:00', ' +03:00']) assert.equal(offsetMinutes(bad), null, String(bad));
    assert.equal(formatOffset(1.5), null);
    assert.equal(formatOffset('3'), null);
  });

  test('utcLabel uses a real minus sign', () => {
    assert.equal(utcLabel('+03:00'), 'UTC+03:00');
    assert.equal(utcLabel('-05:00'), 'UTC−05:00');
    assert.equal(utcLabel('+00:00'), 'UTC+00:00');
  });

  test('shownTimezones: two or more offsets; no "top" on a tie; malformed → null', () => {
    assert.equal(shownTimezones(computeTimezones([])), null);
    assert.equal(shownTimezones(computeTimezones([commit('2026-03-01T09:00:00Z')])), null);
    assert.deepEqual(shownTimezones(computeTimezones(spread(['+03:00', '+03:00', '-05:00'], 3))), { count: 2, top: '+03:00', commits: 2, share: 66.7 });
    assert.deepEqual(shownTimezones(computeTimezones(spread(['+03:00', '-05:00'], 4))), { count: 2, top: null, commits: 2, share: 50 });
    for (const bad of [null, undefined, 'x', 42, {}, { count: 2 }, { count: 2, offsets: 'x' }, { count: 2, offsets: [{ offset: '+03:00', commits: 1 }, { offset: 'bad', commits: 1 }] }, { offsets: [{ offset: '+03:00', commits: 1 }, { offset: '+04:00', commits: 0 }] }]) {
      assert.equal(shownTimezones(bad), null, JSON.stringify(bad));
    }
    // Hand-edited / unsorted input is sorted again.
    assert.equal(shownTimezones({ count: 2, offsets: [{ offset: '+04:00', commits: 1 }, { offset: '+03:00', commits: 5 }] }).top, '+03:00');
  });
});

describe('power-hour card', () => {
  test('one offset (or none): the card is byte-identical to one without stats.timezones', () => {
    for (const commits of [spread(['+03:00']), spread(['Z'], 3, 9), []]) {
      const stats = statsOf(commits);
      const without = { ...stats };
      delete without.timezones;
      for (const lang of ['en', 'tr']) {
        assert.equal(peakSvg(stats, { lang }), peakSvg(without, { lang }), lang);
        assert.deepEqual(peakSpec(stats, { lang }), peakSpec(without, { lang }));
      }
    }
  });

  test('two or more offsets: the row keeps the quip, with the big word at most one step smaller', () => {
    const stats = statsOf(spread(['+03:00', '+03:00', '-05:00']));
    const base = { ...stats, timezones: computeTimezones([]) };
    const spec = peakSpec(stats);
    const before = peakSpec(base);
    assert.equal(spec.subtitle, before.subtitle);
    assert.match(spec.subtitle, /After-hours hero\./);
    assert.deepEqual(spec.lines, [{ label: '2 time zones', value: 'mostly UTC+03:00' }]);
    assert.equal(spec.big, before.big);
    assert.deepEqual(spec.chart, before.chart);
    assert.ok(peakSvg(stats).includes('>mostly UTC+03:00<'));
    const a = layoutCard(spec);
    const b = layoutCard(before);
    assert.deepEqual(a.drawnCharts, b.drawnCharts);
    assert.ok(a.shrinkSteps <= b.shrinkSteps + 1);
  });

  test('Turkish: the sentence in place of the quip and weekday when nothing else fits', () => {
    const stats = statsOf(spread(['+03:00', '+03:00', '-05:00']));
    const spec = peakSpec(stats, { lang: 'tr' });
    assert.equal(spec.subtitle, '30 commit saat 21:00 sularında geldi. 2 saat diliminden commit attın, çoğunu UTC+03:00 diliminden.');
    assert.equal(spec.lines, undefined);
    assert.ok(peakSvg(stats, { lang: 'tr' }).includes('çoğunu UTC+03:00'));
    assertLayoutOk({ ...spec, lang: 'tr' }, 'tr');
  });

  test('the sentence after the subtitle when it fits; the quip makes way before the weekday', () => {
    const spec = peakSpec(statsOf(spread(['+03:00', '-05:00'])));
    assert.equal(spec.subtitle, '30 commits landed in the 9 PM hour. After-hours hero. Sunday is tied for your busiest day. Committed from 2 time zones.');
    const tr2 = peakSpec(statsOf(spread(['+03:00', '-05:00'])), { lang: 'tr' });
    assert.equal(tr2.subtitle, '30 commit saat 21:00 sularında geldi. Pazar, en yoğun günlerinden biri. 2 saat diliminden commit attın.');
  });

  test('a tie for the most common offset: no "mostly"', () => {
    const spec = peakSpec(statsOf(spread(['+03:00', '-05:00'])));
    assert.match(spec.subtitle, /Committed from 2 time zones\.$/);
    assert.doesNotMatch(spec.subtitle, /mostly/);
  });

  test('as a row when the subtitle has no room', () => {
    // The fixture repo's dates: every hour tied at one commit, so a long subtitle, small bars.
    const commits = ['2024-03-04T10:00:00+01:00', '2024-03-05T14:30:00+01:00', '2024-03-06T23:45:00+01:00', '2024-03-09T11:00:00+01:00',
      '2024-03-10T02:15:00-08:00', '2024-03-11T09:00:00+00:00', '2024-03-12T16:20:00+05:30', '2024-03-13T12:00:00+00:00'].map((d) => commit(d));
    const stats = statsOf(commits);
    const spec = peakSpec(stats);
    assert.deepEqual(spec.lines, [{ label: '4 time zones', value: 'mostly UTC+01:00' }]);
    assert.deepEqual(peakSpec(stats, { lang: 'tr' }).lines, [{ label: '4 saat dilimi', value: 'en çok UTC+01:00' }]);
    assert.ok(peakSvg(stats).includes('>mostly UTC+01:00<'));
  });

  test('every theme and language, many shapes: the zones always shown, inside the content area, no overlap', () => {
    const offsetSets = [['+03:00', '+03:00', '-05:00'], ['+03:00', '-05:00'], ['+05:30', '-09:30', '+14:00', '-12:00', '+00:00'], ['-05:00', '+01:00', '+01:00']];
    const shapes = [];
    for (const offsets of offsetSets) for (const count of [4, 30, 1234]) for (const hour of [0, 9, 21]) shapes.push(spread(offsets, count, hour));
    shapes.push(Array.from({ length: 24 }, (_, i) => commit(`2026-03-${String(1 + i).padStart(2, '0')}T${String(i).padStart(2, '0')}:00:00${i % 2 ? '-05:00' : '+03:00'}`)));
    const kinds = { row: 0, sentence: 0 };
    for (const commits of shapes) {
      const stats = statsOf(commits);
      const shown = shownTimezones(stats.timezones);
      assert.ok(shown, 'two or more zones');
      for (const lang of ['en', 'tr']) {
        const L = lang === 'tr' ? tr : en;
        const base = peakSpec({ ...stats, timezones: computeTimezones([]) }, { lang });
        const before = layoutCard(base);
        const top = shown.top ? utcLabel(shown.top) : null;
        const sentence = L.peak.timezones(shown.count, top);
        const row = { label: L.recap.timezonesValue(shown.count), value: top ? L.recap.mostly(top) : '' };
        for (const colorTheme of COLOR_THEME_NAMES) {
          const label = `${lang}/${colorTheme}/${commits.length}`;
          const spec = peakSpec(stats, { lang, colorTheme });
          const layout = assertLayoutOk(spec, label);
          const svg = peakSvg(stats, { lang, colorTheme });
          assert.doesNotMatch(svg, /NaN|undefined|Infinity|null/, label);
          // The zones are always there: as the last subtitle sentence (drawn whole), or as the row.
          const drawn = [...(layout.blocks.find((b) => b.kind === 'subtitle')?.svg ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
          if (spec.lines) {
            assert.deepEqual(spec.lines, [row], label);
            assert.equal(spec.subtitle, base.subtitle, `${label}: subtitle kept with the row`);
            assert.ok(svg.includes(`>${row.label}<`), `${label}: row drawn`);
            kinds.row += 1;
          } else {
            assert.ok(spec.subtitle.endsWith(sentence), `${label}: ${spec.subtitle}`);
            assert.ok(spec.subtitle.startsWith(base.subtitle.split('. ')[0]), `${label}: lead kept`);
            assert.ok(drawn.includes(sentence.replace(/&/g, '&amp;')), `${label}: sentence drawn whole`);
            kinds.sentence += 1;
          }
          // Never more than the one step the other optional rows take, and every chart kept.
          assert.deepEqual(layout.drawnCharts, before.drawnCharts, `${label}: same charts`);
          assert.ok(layout.shrinkSteps <= before.shrinkSteps + 1, `${label}: at most one step smaller`);
        }
      }
    }
    assert.ok(kinds.row > 0 && kinds.sentence > 0, JSON.stringify(kinds));
  });
});

describe('recap and wrapped.md', () => {
  test('two or more offsets: a "Time zones" line with the most common one and its share', () => {
    const stats = statsOf(spread(['+03:00', '+03:00', '-05:00']));
    assert.match(formatSummary(stats, { repoName: 'demo', today: TODAY }), /\n {2}Time zones {3}2 time zones · mostly UTC\+03:00 \(67% of commits\)\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY }), /^- \*\*Time zones:\*\* 2 time zones \(mostly UTC\+03:00, 67% of commits\)$/m);
    const trRecap = formatSummary(stats, { repoName: 'demo', today: TODAY, lang: 'tr' });
    assert.match(trRecap, /\n {2}Saat dilimleri {3}2 saat dilimi · en çok UTC\+03:00 \(commit'lerin %67 kadarı\)\n/);
    assert.match(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr' }), /^- \*\*Saat dilimleri:\*\* 2 saat dilimi \(en çok UTC\+03:00, commit'lerin %67 kadarı\)$/m);
  });

  test('negative top offset with a real minus; a tie leaves "mostly" out', () => {
    const west = statsOf(spread(['-05:00', '-05:00', '+01:00']));
    assert.match(formatSummary(west, { repoName: 'demo', today: TODAY }), /Time zones {3}2 time zones · mostly UTC−05:00 \(67% of commits\)\n/);
    const tie = statsOf(spread(['-05:00', '+01:00']));
    assert.match(formatSummary(tie, { repoName: 'demo', today: TODAY }), /\n {2}Time zones {3}2 time zones\n/);
    assert.match(buildMarkdown(tie, { repoName: 'demo', today: TODAY }), /^- \*\*Time zones:\*\* 2 time zones$/m);
  });

  test('one offset (or none): no line', () => {
    for (const stats of [statsOf(spread(['+03:00'])), statsOf([]), { ...statsOf(spread(['+03:00', '-05:00'])), timezones: undefined }]) {
      for (const lang of ['en', 'tr']) {
        assert.doesNotMatch(formatSummary(stats, { repoName: 'demo', today: TODAY, lang }), /Time zones|Saat dilimleri/);
        assert.doesNotMatch(buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang }), /Time zones|Saat dilimleri/);
      }
    }
  });

  test('color: the recap line stays one line with ANSI codes', () => {
    const out = formatSummary(statsOf(spread(['+03:00', '+03:00', '-05:00'])), { repoName: 'demo', today: TODAY, color: true });
    // eslint-disable-next-line no-control-regex
    assert.match(out.replace(/\x1b\[\d+m/g, ''), /\n {2}Time zones {3}2 time zones · mostly UTC\+03:00 \(67% of commits\)\n/);
  });
});

describe('stats.json and strings', () => {
  test('stats.timezones in the JSON document', () => {
    const stats = statsOf(spread(['+03:00', '+03:00', '-05:00']));
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.timezones, { count: 2, top: { offset: '+03:00', commits: 20, share: 0.667 }, offsets: [{ offset: '+03:00', commits: 20 }, { offset: '-05:00', commits: 10 }] });
    assert.deepEqual(Object.keys(doc.stats.timezones), ['count', 'top', 'offsets']);
    const empty = JSON.parse(buildStatsJson({ stats: statsOf([]), repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(empty.stats.timezones, { count: 0, top: null, offsets: [] });
  });

  test('en / tr strings', () => {
    for (const L of [en, tr]) {
      assert.equal(typeof L.peak.timezones, 'function');
      assert.equal(typeof L.recap.timezones, 'string');
      assert.equal(typeof L.recap.timezonesValue, 'function');
      assert.equal(typeof L.recap.mostly, 'function');
    }
    assert.equal(en.peak.timezones(3, 'UTC+03:00'), 'Committed from 3 time zones, mostly UTC+03:00.');
    assert.equal(en.peak.timezones(2, null), 'Committed from 2 time zones.');
    assert.equal(en.peak.timezones(1234, null), 'Committed from 1,234 time zones.');
    assert.equal(tr.peak.timezones(3, 'UTC+03:00'), '3 saat diliminden commit attın, çoğunu UTC+03:00 diliminden.');
    assert.equal(tr.peak.timezones(2, null), '2 saat diliminden commit attın.');
    assert.equal(en.recap.timezonesValue(1), '1 time zone');
    assert.equal(en.recap.timezonesValue(2), '2 time zones');
    assert.equal(tr.recap.timezonesValue(2), '2 saat dilimi');
    assert.equal(en.recap.mostly('UTC+03:00'), 'mostly UTC+03:00');
    assert.equal(tr.recap.mostly('UTC+03:00'), 'en çok UTC+03:00');
    assert.ok(tr.recap.timezones.length <= tr.recap.labelWidth - 1);
    assert.ok(en.recap.timezones.length <= en.recap.labelWidth - 1);
  });
});

describe('time zones: end to end', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png'], { cwd: ROOT, encoding: 'utf8', env });
  };
  const gitEnv = (extra = {}) => {
    const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
    return env;
  };
  const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  const at = (date) => ({ GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', GIT_COMMITTER_DATE: date });
  const repo = (name, dates) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    for (const d of dates) git(dir, ['commit', '-q', '--allow-empty', '-m', `work ${d}`], at(d));
    return dir;
  };

  let fixture;
  let tmp;
  before(() => {
    fixture = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gw-timezones-'));
  });
  after(() => {
    fixture?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('CLI --json --md on the fixture repo (four offsets): stats.json, recap, wrapped.md and the card', () => {
    const out = join(tmp, 'all');
    const r = bin([fixture.dir, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.timezones, {
      count: 4,
      top: { offset: '+01:00', commits: 4, share: 0.5 },
      offsets: [{ offset: '+01:00', commits: 4 }, { offset: '+00:00', commits: 2 }, { offset: '-08:00', commits: 1 }, { offset: '+05:30', commits: 1 }],
    });
    assert.match(r.stdout, /\n {2}Time zones {3}4 time zones · mostly UTC\+01:00 \(50% of commits\)\n/);
    assert.match(readFileSync(join(out, 'wrapped.md'), 'utf8'), /^- \*\*Time zones:\*\* 4 time zones \(mostly UTC\+01:00, 50% of commits\)$/m);
    const card = readFileSync(join(out, 'cards', '03-peak-hour.svg'), 'utf8');
    assert.ok(card.includes('4 time zones') && card.includes('mostly UTC+01:00'), 'peak-hour card shows the time zones');
  });

  test('CLI --since narrows the window: offsets outside it are not counted', () => {
    const dir = repo('window', ['2026-01-05T09:00:00-05:00', '2026-03-02T09:00:00+03:00', '2026-03-03T09:00:00+03:00']);
    const out = join(tmp, 'window-out');
    const r = bin([dir, '--out', out, '--json', '--md', '--since', '2026-03-01']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.stats.timezones, { count: 1, top: { offset: '+03:00', commits: 2, share: 1 }, offsets: [{ offset: '+03:00', commits: 2 }] });
    assert.doesNotMatch(r.stdout, /Time zones/);
    assert.doesNotMatch(readFileSync(join(out, 'wrapped.md'), 'utf8'), /Time zones/);
  });

  test('generate on two repos: offsets over the merged history, Z as +00:00', async () => {
    const api = repo('multi/api', ['2026-09-01T09:00:00Z', '2026-09-02T09:00:00+00:00']);
    const web = repo('multi/web', ['2026-09-02T10:00:00-07:00']);
    const out = join(tmp, 'multi-out');
    const r = await generate({ path: api, paths: [api, web], out, png: false, json: true }, { today: TODAY });
    assert.deepEqual(r.repos, ['api', 'web']);
    const want = { count: 2, top: { offset: '+00:00', commits: 2, share: 0.667 }, offsets: [{ offset: '+00:00', commits: 2 }, { offset: '-07:00', commits: 1 }] };
    assert.deepEqual(r.stats.timezones, want);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')).stats.timezones, want);
  });
});
