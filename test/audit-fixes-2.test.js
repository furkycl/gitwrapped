// Regression tests for the loop-025 audit fixes: output safety (stale-PNG cleanup only in
// our own folder, no writes through symlinks), future-dated commits, --author privacy on
// images, --open failure reporting, dormant-repo calendar copy, ordered first/last days,
// recap / card text hygiene, viewer a11y and the unborn-HEAD hint.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { generate, openInBrowser, run } from '../src/cli.js';
import { authorName, buildCards, buildCardSpecs, cardDescription, escapeXml, renderShareCard } from '../src/cards/index.js';
import { calendarWindow, layoutCard } from '../src/cards/svg.js';
import { computePersonality, computeStats, computeStreaks, computeTotals, dayKeyFromEpoch, LANGUAGE_NAMES } from '../src/stats/index.js';
import { formatSummary, stripControl } from '../src/summary.js';
import { buildViewerHtml } from '../src/viewer.js';

const TODAY = '2026-10-05';
const tmpDirs = [];
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
const fixtures = [];
function fixture() {
  const fx = makeFixtureRepo();
  fixtures.push(fx);
  return fx;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  for (const fx of fixtures) fx.cleanup();
});

function sink() {
  let data = '';
  return { write(s) { data += s; return true; }, get data() { return data; } };
}

/** symlinkSync, or null when this platform / user may not create symlinks (Windows). */
function trySymlink(target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (err) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL', 'ENOENT'].includes(err?.code)) return null;
    throw err;
  }
}

const commit = (date, subject = 'work', email = 'a@x.io') => ({
  hash: 'h', name: 'A', email, date, subject, parents: ['p'],
  files: [{ path: 'src/a.js', added: 2, removed: 1, binary: false }], linesAdded: 2, linesRemoved: 1,
});

// ---------------------------------------------------------------------------
describe('1. --no-png cleanup only in a folder an earlier run wrote', () => {
  test('a user\'s share.png and png/01-intro.png survive when there is no wrapped.html', async () => {
    const fx = fixture();
    const out = tmp('gw-own-');
    mkdirSync(join(out, 'png'));
    writeFileSync(join(out, 'png', '01-intro.png'), 'mine');
    writeFileSync(join(out, 'share.png'), 'mine');
    await generate({ path: fx.dir, out, png: false }, { today: '2024-03-14' });
    assert.equal(readFileSync(join(out, 'share.png'), 'utf8'), 'mine');
    assert.equal(readFileSync(join(out, 'png', '01-intro.png'), 'utf8'), 'mine');
    assert.ok(existsSync(join(out, 'wrapped.html')));
  });
});

// ---------------------------------------------------------------------------
describe('2. never writes or deletes through symlinks inside --out', () => {
  test('share.svg -> a file outside: refused, nothing written, target untouched', async (t) => {
    const fx = fixture();
    const base = tmp('gw-link-');
    const victim = join(base, 'victim.txt');
    writeFileSync(victim, 'precious');
    const out = join(base, 'out');
    mkdirSync(out);
    if (!trySymlink(victim, join(out, 'share.svg'), 'file')) return t.skip('symlinks not permitted here');
    await assert.rejects(generate({ path: fx.dir, out, png: false }, { today: '2024-03-14' }), /refusing to write through a symlink: .*share\.svg/);
    assert.equal(readFileSync(victim, 'utf8'), 'precious');
    assert.equal(existsSync(join(out, 'wrapped.html')), false, 'nothing written');
    assert.equal(existsSync(join(out, 'cards')), false, 'nothing written');
  });

  test('cards/ -> another directory: refused with exit 1 from run()', async (t) => {
    const fx = fixture();
    const base = tmp('gw-link-');
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(elsewhere);
    const out = join(base, 'out');
    mkdirSync(out);
    if (!trySymlink(elsewhere, join(out, 'cards'), 'junction')) return t.skip('symlinks not permitted here');
    const stderr = sink();
    const code = await run([fx.dir, '--out', out, '--no-png'], { stdout: sink(), stderr, env: {}, today: '2024-03-14' });
    assert.equal(code, 1);
    assert.match(stderr.data, /refusing to write through a symlink: .*cards/);
    assert.deepEqual(readdirSync(elsewhere), [], 'nothing written into the link target');
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });

  test('wrapped.html / a card file as a symlink are refused too', async (t) => {
    const fx = fixture();
    for (const rel of ['wrapped.html', join('cards', '01-intro.svg')]) {
      const base = tmp('gw-link-');
      const victim = join(base, 'victim.txt');
      writeFileSync(victim, 'precious');
      const out = join(base, 'out');
      mkdirSync(join(out, 'cards'), { recursive: true });
      if (!trySymlink(victim, join(out, rel), 'file')) return t.skip('symlinks not permitted here');
      await assert.rejects(generate({ path: fx.dir, out, png: false }, { today: '2024-03-14' }), /refusing to write through a symlink/);
      assert.equal(readFileSync(victim, 'utf8'), 'precious', rel);
    }
  });

  test('an explicit --out that is a dangling symlink gets a clear error', async (t) => {
    const fx = fixture();
    const base = tmp('gw-link-');
    const link = join(base, 'dangling');
    if (!trySymlink(join(base, 'missing'), link, 'junction')) return t.skip('symlinks not permitted here');
    await assert.rejects(generate({ path: fx.dir, out: link, outExplicit: true, png: false }, { today: '2024-03-14' }), /output path is a broken symlink/);
  });

  test('--out itself may be a symlink (the user chose it)', async (t) => {
    const fx = fixture();
    const base = tmp('gw-link-');
    const real = join(base, 'real');
    mkdirSync(real);
    const link = join(base, 'link');
    if (!trySymlink(real, link, 'junction')) return t.skip('symlinks not permitted here');
    await generate({ path: fx.dir, out: link, outExplicit: true, png: false }, { today: '2024-03-14' });
    assert.ok(existsSync(join(real, 'wrapped.html')));
    // The same symlink as the default output folder (not typed by the user) is refused.
    rmSync(join(real, 'wrapped.html'));
    await assert.rejects(generate({ path: fx.dir, out: link, png: false }, { today: '2024-03-14' }), /the default output folder is a symlink/);
    assert.equal(existsSync(join(real, 'wrapped.html')), false, 'nothing written');
  });

  test('--no-png cleanup does not follow a symlinked png/ or delete a symlinked share.png', async (t) => {
    const fx = fixture();
    const base = tmp('gw-link-');
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, '01-intro.png'), 'theirs');
    const victim = join(base, 'victim.png');
    writeFileSync(victim, 'theirs');
    const out = join(base, 'out');
    mkdirSync(out);
    writeFileSync(join(out, 'wrapped.html'), 'an earlier run'); // the folder is ours
    if (!trySymlink(elsewhere, join(out, 'png'), 'junction')) return t.skip('symlinks not permitted here');
    if (!trySymlink(victim, join(out, 'share.png'), 'file')) return t.skip('symlinks not permitted here');
    await generate({ path: fx.dir, out, png: false }, { today: '2024-03-14' });
    assert.equal(readFileSync(join(elsewhere, '01-intro.png'), 'utf8'), 'theirs');
    assert.equal(readFileSync(victim, 'utf8'), 'theirs');
  });
});

// ---------------------------------------------------------------------------
describe('3. future-dated (2099) and ancient (1970) commits', () => {
  const recent = ['2026-10-03', '2026-10-04', '2026-10-05'].map((d) => commit(`${d}T10:00:00+00:00`));
  const future = commit('2099-06-01T10:00:00+00:00', 'from the future');
  const ancient = commit('1970-01-02T10:00:00+00:00', 'from the past');

  test('a 2099 commit does not hide the streak running today', () => {
    const s = computeStreaks([...recent, future, ancient], { today: TODAY });
    assert.deepEqual(s.current, { length: 3, start: '2026-10-03', end: '2026-10-05' });
    // Yesterday still counts (grace day) without today's commit.
    assert.deepEqual(computeStreaks([...recent.slice(0, 2), future], { today: TODAY }).current, { length: 2, start: '2026-10-03', end: '2026-10-04' });
    // A complete day (past window end) has no grace day.
    assert.equal(computeStreaks([...recent.slice(0, 2), future], { today: TODAY, todayComplete: true }).current.length, 0);
  });

  test('a run that continues into the future is counted only up to tomorrow', () => {
    const run = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => commit(`${d}T10:00:00+00:00`));
    assert.deepEqual(computeStreaks(run, { today: TODAY }).current, { length: 2, start: '2026-10-05', end: '2026-10-06' });
  });

  test('the activity calendar ends at today, not in 2099; totals still count the 2099 day', () => {
    const stats = computeStats([...recent, future, ancient], { today: TODAY });
    assert.equal(stats.totals.activeDays, 5);
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.ok(spec.chart.days.every((d) => d.day <= '2026-10-06'), JSON.stringify(spec.chart.days));
    const win = calendarWindow(spec.chart.days);
    const lastShown = dayKeyFromEpoch(win.start + win.weeks * 7 - 1);
    assert.ok(lastShown >= TODAY && lastShown < '2026-10-12', lastShown);
    assert.equal(spec.eyebrow, 'Your last 12 months');
    assert.equal(spec.big, '3'); // the three recent days in the window (1970 is clipped)
    // The honest full range stays on the intro card.
    const intro = buildCardSpecs(stats, { repoName: 'demo', today: TODAY })[0].spec;
    assert.equal(intro.chart.value, 'Jan 2, 1970 – Jun 1, 2099');
  });

  test('dropped future days are mentioned in the subtitle, and it still fits the card', () => {
    const stats = computeStats([...recent, future, commit('2099-06-02T10:00:00+00:00')], { today: TODAY });
    const cards = buildCardSpecs(stats, { repoName: 'demo', today: TODAY });
    const spec = cards.find((c) => c.id === 'activity').spec;
    assert.match(spec.subtitle, /\+2 future-dated days not shown\.$/);
    const one = buildCardSpecs(computeStats([...recent, future], { today: TODAY }), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.match(one.subtitle, /\+1 future-dated day not shown\.$/);
    const layout = layoutCard(spec);
    const sub = layout.blocks.find((b) => /not shown/.test(b.svg));
    assert.ok(sub, 'note rendered in full');
    const sorted = [...layout.blocks].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].top >= sorted[i - 1].bottom, 'blocks do not overlap');
    // No note when nothing was dropped.
    const plain = buildCardSpecs(computeStats(recent, { today: TODAY }), { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.doesNotMatch(plain.subtitle, /future/);
  });

  test('only future days: the calendar still shows them rather than nothing', () => {
    const stats = computeStats([future], { today: TODAY });
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.deepEqual(spec.chart.days, [{ day: '2099-06-01', commits: 1 }]);
  });
});

// ---------------------------------------------------------------------------
describe('5. --author shows only the name part on images', () => {
  test('authorName', () => {
    assert.equal(authorName('ada@example.com'), 'ada');
    assert.equal(authorName(' first.last+tag@corp.example '), 'first.last+tag');
    assert.equal(authorName('ada'), 'ada');
    assert.equal(authorName('@example.com'), '@example.com');
    assert.equal(authorName(''), null);
  });

  test('cards, share image and wrapped.html never show the email; stats.json keeps it', async () => {
    const fx = fixture();
    const out = tmp('gw-author-');
    const r = await generate({ path: fx.dir, out, png: false, json: true, author: 'ada@example.com' }, { today: '2024-03-14' });
    assert.ok(r.commits > 0);
    const intro = readFileSync(r.cardFiles[0], 'utf8');
    assert.match(intro, /Starring ada\./);
    for (const f of [...r.cardFiles, r.shareSvg, r.html]) {
      assert.doesNotMatch(readFileSync(f, 'utf8'), /example\.com/i, f);
    }
    assert.match(readFileSync(r.shareSvg, 'utf8'), /GIT WRAPPED · ADA</);
    assert.equal(JSON.parse(readFileSync(r.statsJson, 'utf8')).filters.author, 'ada@example.com');
  });

  test('renderShareCard with an email author', () => {
    const svg = renderShareCard(computeStats([], { today: TODAY }), { repoName: 'demo', author: 'Ada@Example.com' });
    assert.doesNotMatch(svg, /example\.com/i);
    assert.match(svg, /· ADA</);
  });
});

// ---------------------------------------------------------------------------
describe('6. --open reports an opener that fails right away', () => {
  function fakeSpawn(behave) {
    return () => {
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => {
        child.emit('spawn');
        behave(child);
      });
      return child;
    };
  }

  test('non-zero exit within the wait → rejects', async () => {
    await assert.rejects(
      openInBrowser('/x', { platform: 'linux', spawn: fakeSpawn((c) => c.emit('exit', 3, null)) }),
      /xdg-open exited with code 3/,
    );
  });

  test('exit 0, a signal, or still running after the wait → resolves', async () => {
    await openInBrowser('/x', { platform: 'linux', spawn: fakeSpawn((c) => c.emit('exit', 0, null)) });
    await openInBrowser('/x', { platform: 'linux', spawn: fakeSpawn((c) => c.emit('exit', null, 'SIGTERM')) });
    const start = Date.now();
    await openInBrowser('/x', { platform: 'linux', spawn: fakeSpawn(() => {}), waitMs: 30 });
    assert.ok(Date.now() - start < 1000);
  });

  test('a failure after the wait is ignored (the run has moved on)', async () => {
    await openInBrowser('/x', { platform: 'linux', waitMs: 5, spawn: fakeSpawn((c) => setTimeout(() => c.emit('exit', 1, null), 40)) });
  });

  test('run(): the warning names the exit code and the run still exits 0', async () => {
    const fx = fixture();
    const stdout = sink();
    const stderr = sink();
    const code = await run([fx.dir, '--no-png', '--open', '--out', tmp('gw-open-')], {
      stdout, stderr, env: {}, today: '2024-03-14',
      openFile: (f) => openInBrowser(f, { platform: 'linux', spawn: fakeSpawn((c) => c.emit('exit', 4, null)) }),
    });
    assert.equal(code, 0);
    assert.match(stderr.data, /could not open a browser \(xdg-open exited with code 4\); open .*wrapped\.html yourself/);
    assert.match(stdout.data, /Opening .*wrapped\.html…\n$/, 'announced before the opener reports');
  });
});

// ---------------------------------------------------------------------------
describe('7. dormant repo: the activity card does not say "your last 12 months"', () => {
  // Weekly commits over two years, ending in April 2021.
  const old = Array.from({ length: 104 }, (_, i) => commit(`${dayKeyFromEpoch(18000 + i * 7)}T10:00:00+00:00`));
  test('names the month the window ends', () => {
    const stats = computeStats(old, { today: TODAY });
    const spec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'activity').spec;
    const last = dayKeyFromEpoch(18000 + 103 * 7);
    assert.equal(last, '2021-04-04');
    assert.equal(spec.eyebrow, '12 months to Apr 2021');
  });
  test('a past window that ended recently still reads "Your last 12 months"', () => {
    const stats = computeStats(old, { today: '2021-04-20', todayComplete: true });
    const spec = buildCardSpecs(stats, { repoName: 'demo', until: '2021-04-20', today: TODAY }).find((c) => c.id === 'activity').spec;
    assert.equal(spec.eyebrow, 'Your last 12 months');
  });
  test('without a known today the copy is unchanged', () => {
    const spec = buildCardSpecs(computeStats(old, { today: TODAY }), { repoName: 'demo' }).find((c) => c.id === 'activity').spec;
    assert.equal(spec.eyebrow, 'Your last 12 months');
  });
});

// ---------------------------------------------------------------------------
describe('8. first / last day are ordered with mixed offsets', () => {
  // Earliest instant (10:30Z) is local Jan 2 at +14:00; latest (11:00Z) is local Jan 1 at -12:00.
  const mixed = [commit('2026-01-02T00:30:00+14:00'), commit('2026-01-01T23:00:00-12:00'), commit('2026-01-01T12:00:00-12:00')];
  test('totals.firstDay <= lastDay', () => {
    const t = computeTotals(mixed);
    assert.equal(t.firstDay, '2026-01-01');
    assert.equal(t.lastDay, '2026-01-02');
    assert.equal(t.firstCommitDate, '2026-01-02T00:30:00+14:00', 'instants are unchanged');
  });
  test('steady-shipper span covers both days, even if handed in reverse order', () => {
    const stats = computeStats(mixed, { today: '2026-01-05' });
    const reversed = { ...stats, totals: { ...stats.totals, firstDay: '2026-01-02', lastDay: '2026-01-01' } };
    for (const s of [stats, reversed]) {
      const steady = computePersonality(s).scores.find((x) => x.id === 'steady-shipper');
      assert.ok(steady.score >= 0.7, String(steady.score)); // density 2/2 = 1 → 0.7 + streak part
    }
  });
});

// ---------------------------------------------------------------------------
describe('9. text hygiene', () => {
  test('recap prints 0 (no sign) for zero lines, like the cards', () => {
    const c = { ...commit('2026-10-05T10:00:00+00:00'), files: [{ path: 'a.js', added: 5, removed: 0, binary: false }], linesAdded: 5, linesRemoved: 0 };
    const out = formatSummary(computeStats([c], { today: TODAY }));
    assert.match(out, /\+5 \/ 0 lines/);
    assert.doesNotMatch(out, /−0/);
  });

  test('bidi controls and line separators are stripped from the recap and card text', () => {
    const evil = 'a\u202Eb\u2066c\u2069d\u2028e\u2029f\u202Ag';
    assert.equal(stripControl(evil), 'abcdefg');
    const stats = computeStats([commit('2026-10-05T10:00:00+00:00', `${evil} subject`)], { today: TODAY });
    const recap = formatSummary(stats, { repoName: `repo${evil}` });
    assert.doesNotMatch(recap, /[\u202A-\u202E\u2066-\u2069\u2028\u2029]/);
    assert.equal(escapeXml(evil), 'abcdefg');
    for (const { svg, description } of buildCards(stats, { repoName: `repo${evil}`, today: TODAY })) {
      assert.doesNotMatch(svg, /[\u202A-\u202E\u2066-\u2069\u2028\u2029]/);
      assert.doesNotMatch(description, /[\u202A-\u202E\u2066-\u2069\u2028\u2029]/);
    }
  });

  test('README states the real number of built-in languages', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.ok(readme.includes(`(${LANGUAGE_NAMES.length} built in)`), `README should say (${LANGUAGE_NAMES.length} built in)`);
  });

  test('every card has a plain-text description built from its content', () => {
    const stats = computeStats([...['2026-10-04', '2026-10-05'].map((d) => commit(`${d}T10:00:00+00:00`, 'fix: things'))], { today: TODAY });
    const cards = buildCards(stats, { repoName: 'demo', today: TODAY });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c.description]));
    assert.match(byId.totals, /^The grand total\. 2 commits\. .*Lines added: \+4\. Lines removed: −2\.$/);
    assert.match(byId.streak, /2 days in a row/);
    assert.match(byId['hot-files'], /src\/a\.js: 2 commits/);
    assert.match(byId.outro, /Commits: 2\./);
    for (const c of cards) assert.ok(c.description.length > 10 && !/undefined|null|NaN/.test(c.description), c.id);
    assert.equal(cardDescription({}), '');
  });

  test('viewer: carousel region, card descriptions, pause button uses only aria-label', () => {
    const stats = computeStats([commit('2026-10-05T10:00:00+00:00', 'a <b> & "c"')], { today: TODAY });
    const cards = buildCards(stats, { repoName: 'demo', today: TODAY });
    const html = buildViewerHtml(cards, { title: 'demo' });
    assert.match(html, /<div class="story" id="story" role="region" aria-roledescription="carousel" aria-label="demo">/);
    assert.match(html, /<button type="button" class="pause" id="pause" aria-label="Pause">/);
    assert.doesNotMatch(html, /aria-pressed/);
    cards.forEach((c, i) => {
      const id = `card-${i + 1}-desc`;
      assert.ok(html.includes(`aria-describedby="${id}"`), id);
      const m = new RegExp(`<p class="sr" id="${id}" aria-hidden="true">([^<]*)</p>`).exec(html);
      assert.ok(m, `${id} paragraph`);
    });
    assert.ok(html.includes('&lt;b&gt; &amp; &quot;c&quot;'), 'description escaped');
    // Without descriptions (custom cards) nothing extra is added.
    const bare = buildViewerHtml([{ id: 'x', svg: '<svg viewBox="0 0 1 1"><title>X</title></svg>' }]);
    assert.doesNotMatch(bare.slice(0, bare.indexOf('<script>')), /aria-describedby|-desc"/);
    // A downloaded card does not keep a reference into the page.
    assert.match(html, /clone\.removeAttribute\('aria-describedby'\)/);
    // Tap zones let the pointer through to the card (so <title> tooltips show on hover).
    assert.match(html, /\.nav\{[^}]*pointer-events:none/);
  });
});

// ---------------------------------------------------------------------------
describe('10. HEAD without commits while other branches have history', () => {
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(tmpdir(), 'gw-no-such-gitconfig'),
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.io', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io',
    GIT_AUTHOR_DATE: '2024-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2024-01-01T12:00:00Z',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete env[k];
  const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const runIn = async (dir) => {
    const stdout = sink();
    const code = await run([dir, '--no-png', '--out', tmp('gw-orphan-out-')], { stdout, stderr: sink(), env: {}, today: TODAY });
    return { code, out: stdout.data };
  };

  test('an orphan branch gets a hint that only HEAD is read', async () => {
    const dir = tmp('gw-orphan-');
    git(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'f.txt'), 'x\n');
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'first']);
    git(dir, ['checkout', '-q', '--orphan', 'empty']);
    const { code, out } = await runIn(dir);
    assert.equal(code, 0);
    assert.match(out, /Note: the current branch \(HEAD\) has no commits yet, and gitwrapped only reads HEAD's history\. Check out a branch with commits/);
    assert.match(out, /No commits found/);
  });

  test('a brand-new empty repo gets no such hint', async () => {
    const dir = tmp('gw-empty-');
    git(dir, ['init', '-q', '-b', 'main']);
    const { code, out } = await runIn(dir);
    assert.equal(code, 0);
    assert.doesNotMatch(out, /only reads HEAD/);
    assert.match(out, /No commits found/);
  });
});
