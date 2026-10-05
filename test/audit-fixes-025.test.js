// Regression tests for the loop-025 audit fixes: deletions only in an owned out dir,
// no writes / deletions through symlinks, and future-dated commits (clock skew).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/cli.js';
import { buildCardSpecs, CARD_IDS } from '../src/cards/index.js';
import { computeStats, computeStreaks } from '../src/stats/index.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2024-03-14'; // after the fixture's history
const pad = (n) => String(n).padStart(2, '0');
const NAMES = CARD_IDS.map((id, i) => `${pad(i + 1)}-${id}`);
const fakePng = async () => Buffer.from('89504e470d0a1a0a', 'hex');

function tmp(t, prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

function fixture(t) {
  const f = makeFixtureRepo();
  t.after(() => f.cleanup());
  return f;
}

/** Create a symlink, or skip the test where the OS does not allow it (Windows without rights). */
function linkOrSkip(t, target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (err) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(err?.code)) {
      t.skip(`cannot create symlinks here (${err.code})`);
      return false;
    }
    throw err;
  }
}

const isLink = (p) => lstatSync(p).isSymbolicLink();

describe('--no-png deletes nothing in an out dir gitwrapped does not own', () => {
  test('current-numbered PNGs and share.png in a foreign folder are kept', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-foreign-');
    mkdirSync(join(out, 'png'));
    writeFileSync(join(out, 'png', `${NAMES[0]}.png`), 'mine');
    writeFileSync(join(out, 'share.png'), 'mine');
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.equal(readFileSync(join(out, 'png', `${NAMES[0]}.png`), 'utf8'), 'mine');
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
  });

  test('an out dir with an earlier wrapped.html is ours: stale PNGs are removed', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-owned-');
    await generate({ path: f.dir, out }, { today: TODAY, renderPng: fakePng });
    assert.ok(existsSync(join(out, 'share.png')));
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.equal(existsSync(join(out, 'share.png')), false);
    assert.equal(existsSync(join(out, 'png')), false);
  });
});

describe('writes never follow symlinks in the out dir', () => {
  for (const rel of ['wrapped.html', 'share.svg', join('cards', `${NAMES[0]}.svg`)]) {
    test(`a symlinked ${rel} fails the run before anything is written; its target is untouched`, async (t) => {
      const f = fixture(t);
      const out = tmp(t, 'gw025-link-');
      const elsewhere = tmp(t, 'gw025-target-');
      const target = join(elsewhere, 'precious.txt');
      writeFileSync(target, 'precious');
      mkdirSync(join(out, 'cards'));
      if (!linkOrSkip(t, target, join(out, rel), 'file')) return;
      await assert.rejects(generate({ path: f.dir, out, png: false }, { today: TODAY }), /refusing to write through a symlink/);
      assert.equal(readFileSync(target, 'utf8'), 'precious');
      assert.ok(isLink(join(out, rel)), 'the link itself is left as it was');
      if (rel !== 'wrapped.html') assert.equal(existsSync(join(out, 'wrapped.html')), false, 'nothing written');
    });
  }

  test('a dangling symlink does not create its target', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-dangling-');
    const elsewhere = tmp(t, 'gw025-target-');
    const target = join(elsewhere, 'created-by-gitwrapped.svg');
    if (!linkOrSkip(t, target, join(out, 'share.svg'), 'file')) return;
    await assert.rejects(generate({ path: f.dir, out, png: false }, { today: TODAY }), /symlink/);
    assert.equal(existsSync(target), false);
  });

  test('a symlinked share.png / png card fails a PNG run; targets untouched', async (t) => {
    const f = fixture(t);
    for (const rel of ['share.png', join('png', `${NAMES[1]}.png`)]) {
      const out = tmp(t, 'gw025-pnglink-');
      const target = join(tmp(t, 'gw025-target-'), 'photo.png');
      writeFileSync(target, 'photo');
      mkdirSync(join(out, 'png'));
      if (!linkOrSkip(t, target, join(out, rel), 'file')) return;
      await assert.rejects(generate({ path: f.dir, out }, { today: TODAY, renderPng: fakePng }), /symlink/, rel);
      assert.equal(readFileSync(target, 'utf8'), 'photo', rel);
    }
  });

  test('stats.json: a symlink fails a --json run; without --json it is left alone', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-json-');
    const target = join(tmp(t, 'gw025-target-'), 'data.json');
    writeFileSync(target, '{"mine":true}');
    if (!linkOrSkip(t, target, join(out, 'stats.json'), 'file')) return;
    await assert.rejects(generate({ path: f.dir, out, png: false, json: true }, { today: TODAY }), /symlink/);
    assert.equal(readFileSync(target, 'utf8'), '{"mine":true}');
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.ok(isLink(join(out, 'stats.json')));
    assert.equal(readFileSync(target, 'utf8'), '{"mine":true}');
  });

  test('a symlinked cards/ (or png/) directory fails the run; nothing lands outside', async (t) => {
    const f = fixture(t);
    for (const sub of ['cards', 'png']) {
      const out = tmp(t, 'gw025-dirlink-');
      const elsewhere = tmp(t, 'gw025-elsewhere-');
      writeFileSync(join(elsewhere, 'keep.txt'), 'keep');
      if (!linkOrSkip(t, elsewhere, join(out, sub), 'dir')) return;
      await assert.rejects(generate({ path: f.dir, out }, { today: TODAY, renderPng: fakePng }), /refusing to write through a symlink/, sub);
      assert.deepEqual(readdirSync(elsewhere), ['keep.txt'], sub);
    }
  });
});

describe('deletions never follow symlinks', () => {
  test('--no-png in an owned dir: a symlinked png/ dir and share.png are left alone', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-delpng-');
    await generate({ path: f.dir, out, png: false }, { today: TODAY }); // now the folder is ours
    const elsewhere = tmp(t, 'gw025-elsewhere-');
    for (const n of [...NAMES.map((x) => `${x}.png`), '05-hot-files.png']) writeFileSync(join(elsewhere, n), 'user');
    const shareTarget = join(elsewhere, 'share-target.png');
    writeFileSync(shareTarget, 'user');
    if (!linkOrSkip(t, elsewhere, join(out, 'png'), 'dir')) return;
    if (!linkOrSkip(t, shareTarget, join(out, 'share.png'), 'file')) return;
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.equal(readdirSync(elsewhere).length, NAMES.length + 2, 'nothing deleted through png/');
    assert.ok(isLink(join(out, 'png')));
    assert.ok(isLink(join(out, 'share.png')));
    assert.equal(readFileSync(shareTarget, 'utf8'), 'user');
  });

  test('old-numbered card names that are symlinks are not deleted', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-delcards-');
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    const target = join(tmp(t, 'gw025-target-'), 'x.svg');
    writeFileSync(target, 'user');
    if (!linkOrSkip(t, target, join(out, 'cards', '05-hot-files.svg'), 'file')) return;
    writeFileSync(join(out, 'cards', '08-outro.svg'), 'old'); // a regular old card: removed
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.ok(isLink(join(out, 'cards', '05-hot-files.svg')));
    assert.equal(readFileSync(target, 'utf8'), 'user');
    assert.equal(existsSync(join(out, 'cards', '08-outro.svg')), false, 'a regular old-numbered card is still cleaned up');
  });
});

describe('future-dated commits (clock skew)', () => {
  const at = (date) => ({ hash: date, author: 'A', email: 'a@x', date, subject: 'feat: x', files: [{ path: 'src/a.js', added: 1, removed: 0 }], filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
  const days = (...keys) => keys.map((k) => at(`${k}T12:00:00Z`));
  const today = '2026-10-05';
  const running = days('2026-10-03', '2026-10-04', '2026-10-05');

  test('a commit dated years ahead does not reset the current streak', () => {
    const s = computeStreaks([...running, ...days('2031-01-01')], { today });
    assert.deepEqual(s.current, { length: 3, start: '2026-10-03', end: '2026-10-05' });
    assert.deepEqual(computeStreaks(running, { today }).current, s.current);
  });

  test('future days never lengthen the current streak (it ends at the grace day)', () => {
    const s = computeStreaks([...running, ...days('2026-10-06', '2026-10-07', '2026-10-08')], { today });
    assert.deepEqual(s.current, { length: 4, start: '2026-10-03', end: '2026-10-06' });
    assert.deepEqual(s.longest, { length: 6, start: '2026-10-03', end: '2026-10-08' }, 'longest still counts every day');
  });

  test('only future commits → no current streak', () => {
    assert.deepEqual(computeStreaks(days('2031-01-01', '2031-01-02'), { today }).current, { length: 0, start: null, end: null });
  });

  test('past window (todayComplete) is unchanged: the end day must be active, no grace day', () => {
    const s = (input) => computeStreaks(input, { today: '2025-12-31', todayComplete: true }).current;
    assert.deepEqual(s(days('2025-12-30', '2025-12-31')), { length: 2, start: '2025-12-30', end: '2025-12-31' });
    assert.equal(s(days('2025-12-29', '2025-12-30')).length, 0);
  });

  test('activity calendar ends at today (+1 grace day): future days are left off the grid', () => {
    const stats = computeStats([...running, ...days('2031-01-01')], { today });
    const cal = (opts) => buildCardSpecs(stats, opts).find((c) => c.id === 'activity').spec;
    const spec = cal({ today });
    assert.deepEqual(spec.chart.days.map((d) => d.day), ['2026-10-03', '2026-10-04', '2026-10-05']);
    assert.equal(spec.big, '3');
    assert.match(spec.subtitle, /Busiest day: Oct 3, 2026/);
    assert.match(spec.subtitle, /2 different weeks/); // Sat 10-03, Mon 10-05 (2031 would make it 3)
    assert.equal(spec.eyebrow, 'Your commit calendar', 'the 2031 day does not stretch the window');
    // Without `today` (library use) nothing is dropped: the 2031 day is on the grid and
    // the 53-week window clips the real 2026 days away (the bug `today` fixes).
    assert.deepEqual(cal({}).chart.days.map((d) => d.day), ['2031-01-01']);
  });

  test('activity: when every day is in the future the grid still shows them', () => {
    const stats = computeStats(days('2031-01-01'), { today });
    const spec = buildCardSpecs(stats, { today }).find((c) => c.id === 'activity').spec;
    assert.deepEqual(spec.chart.days.map((d) => d.day), ['2031-01-01']);
  });

  test('end to end: a future-dated commit keeps the streak and the calendar', async (t) => {
    const dir = tmp(t, 'gw025-skew-repo-');
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.io', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io' };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete env[k];
    const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra }, stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'commit.gpgsign', 'false']);
    ['2026-10-03', '2026-10-04', '2026-10-05', '2031-01-01'].forEach((d, i) => {
      writeFileSync(join(dir, 'a.txt'), `${i}\n`);
      git(['add', '-A']);
      git(['commit', '-q', '--no-verify', '-m', `c${i}`], { GIT_AUTHOR_DATE: `${d}T12:00:00+00:00`, GIT_COMMITTER_DATE: `${d}T12:00:00+00:00` });
    });
    const out = tmp(t, 'gw025-skew-out-');
    const r = await generate({ path: dir, out, png: false }, { today });
    assert.equal(r.commits, 4);
    assert.equal(r.stats.streaks.current.length, 3);
    const svg = readFileSync(join(out, 'cards', `${NAMES[CARD_IDS.indexOf('streak')]}.svg`), 'utf8');
    assert.match(svg, /3-day streak right now/);
  });
});

// ---------------------------------------------------------------------------
// Tester additions (loop 025): edge cases around the fixes above.

/** A throwaway repo whose commits are [{date (ISO with offset), email?}] in order. */
function repoWith(t, commits) {
  const dir = tmp(t, 'gw025-edge-repo-');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete env[k];
  const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra }, stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'commit.gpgsign', 'false']);
  commits.forEach(({ date, email = 't@x.io' }, i) => {
    writeFileSync(join(dir, 'a.txt'), `${i}\n`);
    git(['add', '-A']);
    git(['commit', '-q', '--no-verify', '-m', `c${i}`], {
      GIT_AUTHOR_NAME: email.split('@')[0], GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    });
  });
  return dir;
}

describe('tester: ownership edge cases', () => {
  test('--json --no-png in a foreign dir: stats.json is written, user PNGs are kept', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-jsonforeign-');
    mkdirSync(join(out, 'png'));
    for (const n of [`${NAMES[0]}.png`, '05-hot-files.png', 'holiday.png']) writeFileSync(join(out, 'png', n), 'mine');
    writeFileSync(join(out, 'share.png'), 'mine');
    const r = await generate({ path: f.dir, out, png: false, json: true }, { today: TODAY });
    assert.equal(r.statsJson, join(out, 'stats.json'));
    assert.ok(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')));
    assert.deepEqual(readdirSync(join(out, 'png')).sort(), [`${NAMES[0]}.png`, '05-hot-files.png', 'holiday.png'].sort());
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
  });

  test('a directory named wrapped.html does not make the folder ours (the run fails, nothing deleted)', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-dirhtml-');
    mkdirSync(join(out, 'wrapped.html'));
    writeFileSync(join(out, 'share.png'), 'mine');
    await assert.rejects(generate({ path: f.dir, out, png: false }, { today: TODAY }), /directory is in the way/);
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
  });

  test('PNG renderer failure in a foreign dir deletes nothing', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-rfail-');
    mkdirSync(join(out, 'png'));
    writeFileSync(join(out, 'png', `${NAMES[0]}.png`), 'mine');
    writeFileSync(join(out, 'share.png'), 'mine');
    const r = await generate({ path: f.dir, out }, { today: TODAY, renderPng: async () => { throw new Error('boom'); } });
    assert.equal(r.pngSkipped, 'boom');
    assert.equal(readFileSync(join(out, 'png', `${NAMES[0]}.png`), 'utf8'), 'mine');
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
  });

  test('--no-png in a foreign dir with a symlinked png/: run succeeds, target untouched', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-foreignlink-');
    const elsewhere = tmp(t, 'gw025-t-elsewhere-');
    writeFileSync(join(elsewhere, `${NAMES[0]}.png`), 'user');
    if (!linkOrSkip(t, elsewhere, join(out, 'png'), 'dir')) return;
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.ok(isLink(join(out, 'png')));
    assert.deepEqual(readdirSync(elsewhere), [`${NAMES[0]}.png`]);
  });

  test('an out dir that is itself a symlink works, and ownership carries over to --no-png', async (t) => {
    const f = fixture(t);
    const real = tmp(t, 'gw025-t-realout-');
    const holder = tmp(t, 'gw025-t-holder-');
    const out = join(holder, 'out');
    if (!linkOrSkip(t, real, out, 'dir')) return;
    await generate({ path: f.dir, out }, { today: TODAY, renderPng: fakePng });
    assert.ok(existsSync(join(real, 'share.png')));
    await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.equal(existsSync(join(real, 'share.png')), false);
    assert.equal(existsSync(join(real, 'png')), false);
    assert.ok(existsSync(join(real, 'wrapped.html')));
  });

  test('a symlinked wrapped.html does not mark the folder as ours even when the run is refused', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-htmllink-');
    const real = tmp(t, 'gw025-t-realhtml-');
    await generate({ path: f.dir, out: real, png: false }, { today: TODAY });
    writeFileSync(join(out, 'share.png'), 'mine');
    if (!linkOrSkip(t, join(real, 'wrapped.html'), join(out, 'wrapped.html'), 'file')) return;
    await assert.rejects(generate({ path: f.dir, out, png: false }, { today: TODAY }), /symlink/);
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
  });
});

describe('tester: stats.json symlinks', () => {
  test('a symlinked stats.json fails a --json PNG run before any PNG or SVG is written', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-jsonpng-');
    const target = join(tmp(t, 'gw025-t-target-'), 'data.json');
    writeFileSync(target, 'keep');
    if (!linkOrSkip(t, target, join(out, 'stats.json'), 'file')) return;
    let rendered = 0;
    await assert.rejects(generate({ path: f.dir, out, json: true }, { today: TODAY, renderPng: async () => { rendered++; return Buffer.from('x'); } }), /refusing to write through a symlink: .*stats\.json/);
    assert.equal(rendered, 0, 'the check runs before rasterizing');
    assert.equal(readFileSync(target, 'utf8'), 'keep');
    assert.deepEqual(readdirSync(out), ['stats.json']);
  });

  test('a dangling stats.json symlink with --json does not create its target', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-jsondangle-');
    const target = join(tmp(t, 'gw025-t-target-'), 'new.json');
    if (!linkOrSkip(t, target, join(out, 'stats.json'), 'file')) return;
    await assert.rejects(generate({ path: f.dir, out, png: false, json: true }, { today: TODAY }), /symlink/);
    assert.equal(existsSync(target), false);
  });

  test('a dangling stats.json symlink without --json is left alone and the run succeeds', async (t) => {
    const f = fixture(t);
    const out = tmp(t, 'gw025-t-jsondangle2-');
    const target = join(tmp(t, 'gw025-t-target-'), 'new.json');
    if (!linkOrSkip(t, target, join(out, 'stats.json'), 'file')) return;
    const r = await generate({ path: f.dir, out, png: false }, { today: TODAY });
    assert.equal(r.statsJson, null);
    assert.ok(isLink(join(out, 'stats.json')));
    assert.equal(existsSync(target), false);
  });
});

describe('tester: future-dated commits, timezones and filters', () => {
  const at = (date) => ({ hash: date, author: 'A', email: 'a@x', date, subject: 'x', files: [], filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
  const today = '2026-10-05';
  const base = ['2026-10-03T12:00:00Z', '2026-10-04T12:00:00Z', '2026-10-05T12:00:00Z'].map(at);

  test('the grace day is the author-local day: +14:00 late on today+1 counts, its UTC instant is irrelevant', () => {
    // 2026-10-06T23:30+14:00 is 2026-10-06T09:30Z: author-local day is the grace day.
    const s = computeStreaks([...base, at('2026-10-06T23:30:00+14:00')], { today });
    assert.deepEqual(s.current, { length: 4, start: '2026-10-03', end: '2026-10-06' });
  });

  test('author-local today+2 is ignored even when its UTC instant is still today+1', () => {
    // 2026-10-07T00:30+14:00 is 2026-10-06T10:30Z, but the author's calendar says 10-07.
    const s = computeStreaks([...base, at('2026-10-07T00:30:00+14:00')], { today });
    assert.deepEqual(s.current, { length: 3, start: '2026-10-03', end: '2026-10-05' });
    assert.equal(s.longest.length, 3, '10-07 is not consecutive with 10-05');
  });

  test('a negative offset whose UTC instant is today+2 still counts as the grace day', () => {
    // 2026-10-06T23:00-12:00 is 2026-10-07T11:00Z; author-local day 10-06.
    const s = computeStreaks([...base, at('2026-10-06T23:00:00-12:00')], { today });
    assert.equal(s.current.length, 4);
    assert.equal(s.current.end, '2026-10-06');
  });

  test('a gap before the future day: the run before it is current, not the future run', () => {
    const s = computeStreaks([...base, ...['2026-10-08T12:00:00Z', '2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z', '2026-10-11T12:00:00Z'].map(at)], { today });
    assert.deepEqual(s.current, { length: 3, start: '2026-10-03', end: '2026-10-05' });
    assert.deepEqual(s.longest, { length: 4, start: '2026-10-08', end: '2026-10-11' });
  });

  test('todayComplete ignores the would-be grace day too (past window)', () => {
    const s = computeStreaks([...base.slice(0, 2), at('2026-10-05T12:00:00Z')], { today: '2026-10-04', todayComplete: true });
    assert.deepEqual(s.current, { length: 2, start: '2026-10-03', end: '2026-10-04' });
  });

  test('activity calendar keeps the grace day and drops today+2, by author-local day', () => {
    const stats = computeStats([...base, at('2026-10-06T23:30:00+14:00'), at('2026-10-07T00:30:00+14:00')], { today });
    const spec = buildCardSpecs(stats, { today }).find((c) => c.id === 'activity').spec;
    assert.deepEqual(spec.chart.days.map((d) => d.day), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
    assert.equal(spec.big, '4');
  });

  test('activity: a future busiest day is not reported as the busiest day', () => {
    const many = Array.from({ length: 5 }, (_, i) => at(`2031-01-01T1${i}:00:00Z`));
    const stats = computeStats([...base, ...many], { today });
    assert.equal(stats.daily.busiest.day, '2031-01-01', 'precondition: the raw stats see 2031 as busiest');
    const spec = buildCardSpecs(stats, { today }).find((c) => c.id === 'activity').spec;
    assert.match(spec.subtitle, /Busiest day: Oct 3, 2026 with 1 commit\./);
  });

  test('e2e --author: another author\'s future commit is filtered out, and the author\'s own future commit does not reset the streak', async (t) => {
    const dir = repoWith(t, [
      { date: '2026-10-03T12:00:00+00:00', email: 'me@x.io' },
      { date: '2026-10-04T12:00:00+00:00', email: 'me@x.io' },
      { date: '2026-10-05T12:00:00+00:00', email: 'me@x.io' },
      { date: '2031-01-01T12:00:00+00:00', email: 'other@x.io' },
      { date: '2030-06-01T12:00:00+00:00', email: 'me@x.io' },
    ]);
    const out = tmp(t, 'gw025-t-author-');
    const r = await generate({ path: dir, out, png: false, author: 'me@x.io' }, { today });
    assert.equal(r.commits, 4);
    assert.equal(r.stats.streaks.current.length, 3);
    const cal = readFileSync(join(out, 'cards', `${NAMES[CARD_IDS.indexOf('activity')]}.svg`), 'utf8');
    const cells = [...cal.matchAll(/<title>([A-Z][a-z]{2} \d+, \d{4}): \d+ commits?<\/title>/g)].map((m) => m[1]);
    assert.deepEqual(cells, ['Oct 3, 2026', 'Oct 4, 2026', 'Oct 5, 2026'], 'future days are left off the calendar grid');
    const other = await generate({ path: dir, out: tmp(t, 'gw025-t-author2-'), png: false, author: 'other@x.io' }, { today });
    assert.equal(other.commits, 1);
    assert.equal(other.stats.streaks.current.length, 0, 'only a future commit: no current streak');
  });

  test('e2e past --until window with future commits in the repo: unchanged behaviour', async (t) => {
    const dir = repoWith(t, [
      { date: '2025-12-30T12:00:00+00:00' },
      { date: '2025-12-31T12:00:00+00:00' },
      { date: '2026-10-05T12:00:00+00:00' },
      { date: '2031-01-01T12:00:00+00:00' },
    ]);
    const r = await generate({ path: dir, out: tmp(t, 'gw025-t-until-'), png: false, since: '2025-01-01', until: '2025-12-31' }, { today });
    assert.equal(r.pastWindow, true);
    assert.equal(r.asOf, '2025-12-31');
    assert.equal(r.commits, 2);
    assert.deepEqual(r.stats.streaks.current, { length: 2, start: '2025-12-30', end: '2025-12-31' });
  });

  test('e2e json: stats.json streak matches the card when a future commit exists', async (t) => {
    const dir = repoWith(t, [
      { date: '2026-10-04T12:00:00+00:00' },
      { date: '2026-10-05T12:00:00+00:00' },
      { date: '2031-01-01T12:00:00+00:00' },
    ]);
    const out = tmp(t, 'gw025-t-json-');
    await generate({ path: dir, out, png: false, json: true }, { today });
    const j = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const cur = j.streaks?.current ?? j.stats?.streaks?.current;
    assert.equal(cur?.length, 2, JSON.stringify(Object.keys(j)));
  });
});
