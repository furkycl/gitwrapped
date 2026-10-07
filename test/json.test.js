// --json: <out>/stats.json shape, determinism, JSON safety and no machine paths.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { generate, HELP_TEXT, parseCli, run } from '../src/cli.js';
import { buildStatsJson, STATS_SCHEMA_VERSION, toJsonSafe } from '../src/json.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const TODAY = '2024-03-14';

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

let fx;
const outs = [];
const tmpOut = () => {
  const o = mkdtempSync(join(tmpdir(), 'gw-json-out-'));
  outs.push(o);
  return o;
};

before(() => {
  fx = makeFixtureRepo();
});

after(() => {
  fx?.cleanup();
  for (const o of outs) rmSync(o, { recursive: true, force: true, maxRetries: 5 });
});

describe('parseCli --json', () => {
  test('json is only present when given', () => {
    assert.equal(parseCli(['--json']).json, true);
    assert.equal('json' in parseCli([]), false);
    assert.match(HELP_TEXT, /--json/);
    assert.match(HELP_TEXT, /stats\.json/);
  });
});

describe('toJsonSafe', () => {
  test('converts Maps, Sets, Dates, non-finite numbers and drops undefined', () => {
    const v = toJsonSafe({
      a: new Map([[1, 'x'], ['b', undefined]]),
      s: new Set([3, 1]),
      d: new Date('2024-01-02T03:04:05Z'),
      inf: Infinity,
      nan: NaN,
      u: undefined,
      fn: () => 1,
      arr: [undefined, -Infinity, 2],
      big: 10n,
      nested: { ok: true, n: null },
    });
    assert.deepEqual(v, {
      a: { 1: 'x' },
      s: [3, 1],
      d: '2024-01-02T03:04:05.000Z',
      inf: null,
      nan: null,
      arr: [null, null, 2],
      big: '10',
      nested: { ok: true, n: null },
    });
    assert.deepEqual(Object.keys(v), ['a', 's', 'd', 'inf', 'nan', 'arr', 'big', 'nested']);
  });

  test('buildStatsJson: fixed top-level shape and null filters', () => {
    const text = buildStatsJson({ stats: { totals: { commits: 0 } }, repoName: 'demo', version: '9.9.9' });
    assert.ok(text.endsWith('}\n'));
    assert.match(text, /^\{\n {2}"schemaVersion": 1,\n/);
    const doc = JSON.parse(text);
    assert.deepEqual(doc, {
      schemaVersion: STATS_SCHEMA_VERSION,
      generator: { name: '@furkycl/gitwrapped', version: '9.9.9' },
      repo: 'demo',
      asOf: null,
      filters: { since: null, until: null, author: null, maxCommits: null, exclude: [] },
      truncated: false,
      stats: { totals: { commits: 0 } },
    });
  });
});

describe('generate / run with --json', () => {
  test('writes stats.json with the documented shape', async () => {
    const out = tmpOut();
    const r = await generate({ path: fx.dir, out, png: false, json: true }, { today: TODAY });
    assert.equal(r.statsJson, join(out, 'stats.json'));
    const text = readFileSync(r.statsJson, 'utf8');
    const doc = JSON.parse(text);
    assert.deepEqual(Object.keys(doc), ['schemaVersion', 'generator', 'repo', 'asOf', 'filters', 'truncated', 'stats']);
    assert.equal(doc.asOf, TODAY);
    assert.equal(doc.schemaVersion, 1);
    assert.deepEqual(doc.generator, { name: PKG.name, version: PKG.version });
    assert.equal(doc.repo, basename(fx.dir));
    // maxCommits is the cap in effect (the default here).
    assert.deepEqual(doc.filters, { since: null, until: null, author: null, maxCommits: 50000, exclude: [] });
    assert.equal(doc.truncated, false);
    assert.deepEqual(Object.keys(doc.stats), ['totals', 'habits', 'streaks', 'daily', 'busiestDay', 'months', 'hotFiles', 'languages', 'contributors', 'messages', 'biggestCommit', 'commitSizes', 'commitTypes', 'emoji', 'reverts', 'firstCommit', 'coAuthors', 'releases', 'personality']);
    // Contributors by name only: no author email anywhere in the file (no --author given).
    assert.equal(doc.stats.contributors.total, 2);
    assert.doesNotMatch(text, /@example\.com/);
    assert.deepEqual(doc.stats, toJsonSafe(r.stats));
    assert.equal(doc.stats.totals.commits, fx.commits.length);
    assert.deepEqual(doc.stats, JSON.parse(JSON.stringify(r.stats)));
    // 2-space pretty print, newline-terminated.
    assert.equal(text, `${JSON.stringify(doc, null, 2)}\n`);
  });

  test('is byte-identical across runs (no timestamp)', async () => {
    const a = await generate({ path: fx.dir, out: tmpOut(), png: false, json: true }, { today: TODAY });
    const b = await generate({ path: fx.dir, out: tmpOut(), png: false, json: true }, { today: TODAY });
    assert.equal(readFileSync(a.statsJson, 'utf8'), readFileSync(b.statsJson, 'utf8'));
  });

  test('contains no absolute paths from this machine', async () => {
    const out = tmpOut();
    const r = await generate({ path: fx.dir, out, png: false, json: true }, { today: TODAY });
    const text = readFileSync(r.statsJson, 'utf8');
    const esc = (p) => JSON.stringify(p).slice(1, -1); // as it would appear inside a JSON string
    for (const p of [fx.dir, out, tmpdir(), homedir()]) {
      assert.ok(!text.includes(p) && !text.includes(esc(p)), `stats.json leaks ${p}`);
    }
    assert.doesNotMatch(text, /"(\/|[A-Za-z]:\\\\)/, 'no string value starts like an absolute path');
  });

  test('filters reflect --year, --author and --max-commits; truncated follows the cap', async () => {
    const out = tmpOut();
    const stdout = sink();
    const code = await run([fx.dir, '--year', '2024', '--author', 'ada@example.com', '--max-commits', '2', '--json', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(doc.filters, { since: '2024-01-01', until: '2024-12-31', author: 'ada@example.com', maxCommits: 2, exclude: [] });
    // The window ends after "today", so today stays the streak reference day.
    assert.equal(doc.asOf, TODAY);
    const past = tmpOut();
    await run([fx.dir, '--until', '2024-03-12', '--json', '--no-png', '--out', past], { stdout: sink(), stderr: sink(), env: {}, today: TODAY });
    assert.equal(JSON.parse(readFileSync(join(past, 'stats.json'), 'utf8')).asOf, '2024-03-12', 'a past window end is the reference day');
    assert.equal(doc.truncated, true);
    assert.equal(doc.stats.totals.commits, 2);
    assert.match(stdout.data, /stats JSON: .*stats\.json/);
  });

  test('without --json nothing is written and a stale stats.json is left alone', async () => {
    const out = tmpOut();
    const stdout = sink();
    await run([fx.dir, '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(existsSync(join(out, 'stats.json')), false);
    assert.doesNotMatch(stdout.data, /stats\.json|stats JSON/);

    await run([fx.dir, '--json', '--no-png', '--out', out], { stdout: sink(), stderr: sink(), env: {}, today: TODAY });
    const before = readFileSync(join(out, 'stats.json'), 'utf8');
    await run([fx.dir, '--no-png', '--out', out], { stdout: sink(), stderr: sink(), env: {}, today: TODAY });
    assert.equal(readFileSync(join(out, 'stats.json'), 'utf8'), before);
  });

  test('a directory in the way of stats.json fails before anything is written', async () => {
    const out = tmpOut();
    mkdirSync(join(out, 'stats.json'));
    writeFileSync(join(out, 'stats.json', 'keep.txt'), 'x');
    const stderr = sink();
    const code = await run([fx.dir, '--json', '--no-png', '--out', out], { stdout: sink(), stderr, env: {}, today: TODAY });
    assert.equal(code, 1);
    assert.match(stderr.data, /stats\.json: a directory is in the way/);
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });
});
