// Regression tests for the pre-1.1.0 audit LOW fixes: --author privacy on images, --open
// failure reporting, dormant-repo calendar copy, ordered first/last days, recap / card
// text hygiene, viewer a11y and the unborn-HEAD hint. (The HIGH/MED fixes are covered by
// audit-fixes-025.test.js.)
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';
import { generate, openInBrowser, run } from '../src/cli.js';
import { authorName, buildCards, buildCardSpecs, cardDescription, escapeXml, footerText, measureText, renderShareCard, truncateStart } from '../src/cards/index.js';
import { computePersonality, computeStats, computeTotals, dayKeyFromEpoch, daysUpTo, LANGUAGE_NAMES, longestRun, shownLongest } from '../src/stats/index.js';
import { formatSummary, stripControl } from '../src/summary.js';
import { buildViewerHtml, escapeHtml } from '../src/viewer.js';

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

const commit = (date, subject = 'work', email = 'a@x.io') => ({
  hash: 'h', name: 'A', email, date, subject, parents: ['p'],
  files: [{ path: 'src/a.js', added: 2, removed: 1, binary: false }], linesAdded: 2, linesRemoved: 1,
});


// ---------------------------------------------------------------------------
describe('5. --author shows only the name part on images', () => {
  test('authorName', () => {
    assert.equal(authorName('ada@example.com'), 'ada');
    assert.equal(authorName(' first.last+tag@corp.example '), 'first.last+tag');
    assert.equal(authorName('ada'), 'ada');
    assert.equal(authorName('@example.com'), null, 'nothing but a domain: left out');
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
    assert.match(byId.totals, /^The grand total\. 2 commits\. .*Lines added: \+4\. Lines removed: −2\. Commit sizes\. Tiny \(under 10 lines\): 2 commits \(100%\)\.$/);
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

// ---------------------------------------------------------------------------
describe('11. future-dated commits do not stretch the date range or the Steady Shipper span', () => {
  const recent = ['2026-10-03', '2026-10-04', '2026-10-05'].map((d) => commit(`${d}T10:00:00+00:00`));
  const future = commit('2099-06-01T10:00:00+00:00', 'from the future');
  const specs = (stats, opts = {}) => buildCardSpecs(stats, { repoName: 'demo', today: TODAY, ...opts });

  test('daysUpTo keeps days up to today + 1, all of them when none qualify, and everything without today', () => {
    const days = ['2026-10-04', '2026-10-06', '2026-10-07', '2099-06-01'].map((day) => ({ day, commits: 1 }));
    assert.deepEqual(daysUpTo(days, TODAY).map((x) => x.day), ['2026-10-04', '2026-10-06']);
    assert.deepEqual(daysUpTo(days.slice(2), TODAY).map((x) => x.day), ['2026-10-07', '2099-06-01']);
    assert.equal(daysUpTo(days, undefined).length, 4);
    assert.equal(daysUpTo(days, 'nope').length, 4);
    assert.deepEqual(daysUpTo([{ day: 'bad' }, null, ...days.slice(0, 1)], TODAY).map((x) => x.day), ['2026-10-04']);
    assert.deepEqual(daysUpTo(undefined, TODAY), []);
  });

  test('a 2099 commit: footer and intro range end today; the totals still count it', () => {
    const stats = computeStats([...recent, future], { today: TODAY });
    assert.equal(stats.totals.lastDay, '2099-06-01', 'stats keep the raw day');
    assert.equal(stats.totals.commits, 4);
    const cards = specs(stats);
    for (const { id, spec } of cards) assert.equal(spec.footer, 'demo · Oct 3 – Oct 5, 2026', id);
    assert.equal(cards[0].spec.chart.value, 'Oct 3 – Oct 5, 2026');
    assert.match(cards[0].spec.chart.note, /^4 commits/);
    for (const { svg } of buildCards(stats, { repoName: 'demo', today: TODAY })) assert.doesNotMatch(svg, /2099/);
    assert.doesNotMatch(renderShareCard(stats, { repoName: 'demo', today: TODAY }), /2099/);
    assert.equal(footerText(stats, { repoName: 'demo', today: TODAY }), 'demo · Oct 3 – Oct 5, 2026');
  });

  test('the author-local tomorrow (today + 1) still counts; today + 2 does not', () => {
    const stats = computeStats([...recent, commit('2026-10-06T10:00:00+00:00'), commit('2026-10-07T10:00:00+00:00')], { today: TODAY });
    assert.equal(specs(stats)[1].spec.footer, 'demo · Oct 3 – Oct 6, 2026');
  });

  test('old (1970) commits are not clamped; only the future end is', () => {
    const stats = computeStats([commit('1970-01-02T10:00:00+00:00'), ...recent, future], { today: TODAY });
    assert.equal(specs(stats)[0].spec.chart.value, 'Jan 2, 1970 – Oct 5, 2026');
  });

  test('only future days: the range still shows them; without today nothing changes', () => {
    const only = computeStats([future, commit('2099-06-03T10:00:00+00:00')], { today: TODAY });
    assert.equal(specs(only)[0].spec.footer, 'demo · Jun 1 – Jun 3, 2099');
    const stats = computeStats([...recent, future], { today: TODAY });
    assert.equal(footerText(stats, { repoName: 'demo' }), 'demo · Oct 3, 2026 – Jun 1, 2099');
    assert.equal(buildCardSpecs(stats, { repoName: 'demo' })[0].spec.footer, 'demo · Oct 3, 2026 – Jun 1, 2099');
  });

  test('a --since/--until window label is unaffected', () => {
    const stats = computeStats([...recent, future], { today: TODAY });
    assert.equal(specs(stats, { since: '2026-01-01', until: '2026-12-31' })[0].spec.footer, 'demo · 2026');
  });

  test('Steady Shipper: a 2099 commit neither adds a day nor stretches the span', () => {
    const daily = Array.from({ length: 30 }, (_, i) => commit(`${dayKeyFromEpoch(20731 - 29 + i)}T10:00:00+00:00`));
    assert.equal(daily.at(-1).date.slice(0, 10), TODAY);
    const steady = (s) => s.personality.scores.find((x) => x.id === 'steady-shipper').score;
    const base = computeStats(daily, { today: TODAY });
    const withFuture = computeStats([...daily, future], { today: TODAY });
    assert.equal(steady(withFuture), steady(base));
    assert.equal(steady(base), 1);
    assert.equal(withFuture.personality.archetype.id, 'steady-shipper');
    assert.equal(withFuture.personality.archetype.reason, 'You committed on 30 of 30 days, with a longest streak of 30 days.');
    // Without `today` the raw totals are used (documented fallback), and the span is huge.
    const raw = computePersonality(withFuture, {}).scores.find((x) => x.id === 'steady-shipper').score;
    assert.ok(raw < 0.5, String(raw));
    // A grace-day (tomorrow) commit is a real day and does count.
    const withTomorrow = computeStats([...daily, commit('2026-10-06T10:00:00+00:00')], { today: TODAY });
    assert.match(withTomorrow.personality.archetype.reason, /^You committed on 31 of 31 days/);
  });

  test('a past window (todayComplete): a day after the window end + 1 is left out too', () => {
    const late = commit('2026-10-08T10:00:00+00:00');
    const stats = computeStats([...recent, late], { today: '2026-10-05', todayComplete: true });
    assert.equal(stats.totals.lastDay, '2026-10-08', 'raw stats keep it');
    // 3 of 3 days (Oct 8 left out) and a 3-day streak: 0.7 + 0.3 × 3/14.
    assert.equal(stats.personality.scores.find((x) => x.id === 'steady-shipper').score, 0.76);
    const raw = computePersonality(stats, {}).scores.find((x) => x.id === 'steady-shipper').score;
    assert.ok(stats.personality.scores.find((x) => x.id === 'steady-shipper').score > raw);
    assert.equal(specs(stats, { today: '2026-10-05' })[1].spec.footer, 'demo · Oct 3 – Oct 5, 2026');
  });
});

// ---------------------------------------------------------------------------
describe('12. tester additions: images, PNG input, recap and terminal hygiene', () => {
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(tmpdir(), 'gw-no-such-gitconfig'),
    GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete env[k];
  /** A repo with one commit per entry: {date, email?, subject?, file?}. */
  function repoOf(commits) {
    const dir = tmp('gw-a2t-repo-');
    const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    commits.forEach((c, i) => {
      writeFileSync(join(dir, c.file ?? 'f.txt'), `${i}\n`, { flag: 'a' });
      git(['add', '-A']);
      git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', c.subject ?? `commit ${i}`],
        { GIT_AUTHOR_EMAIL: c.email ?? 'a@x.io', GIT_AUTHOR_DATE: c.date });
    });
    return dir;
  }
  /** A fake rasterizer that records the SVG text every PNG is made from. */
  function recorder() {
    const seen = [];
    return { seen, renderPng: async (svg) => { seen.push(svg); return Buffer.from('png'); } };
  }

  test('--author email: no domain in the SVGs the PNGs (cards + share) are rendered from', async () => {
    const dir = repoOf([
      { date: '2026-10-01T10:00:00+00:00', email: 'ada@example.com' },
      { date: '2026-10-02T10:00:00+00:00', email: 'ada@example.com' },
      { date: '2026-10-03T10:00:00+00:00', email: 'bob@other.io' },
    ]);
    const rec = recorder();
    const r = await generate({ path: dir, out: tmp('gw-a2t-png-'), png: true, author: 'ada@example.com' }, { today: TODAY, renderPng: rec.renderPng });
    assert.equal(r.commits, 2);
    assert.equal(rec.seen.length, 12, '11 cards (two authors: the contributors card too) + share');
    assert.ok(r.sharePng);
    for (const svg of rec.seen) {
      assert.doesNotMatch(svg, /@example|example\.com/i);
      assert.doesNotMatch(svg, /other\.io|bob/i);
    }
    assert.ok(rec.seen.some((s) => s.includes('Starring ada.')));
    assert.ok(rec.seen.some((s) => /GIT WRAPPED · ADA</.test(s)));
    const html = readFileSync(r.html, 'utf8');
    assert.doesNotMatch(html, /@example|example\.com/i);
  });

  test('a 2099 commit: no 2099 in any SVG/PNG input, wrapped.html or the recap; Steady Shipper not deflated', async () => {
    const dir = repoOf([
      ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) => ({ date: `${d}T10:00:00+00:00` })),
      { date: '2099-06-01T10:00:00+00:00', subject: 'from the future' },
    ]);
    const rec = recorder();
    const r = await generate({ path: dir, out: tmp('gw-a2t-fut-'), png: true }, { today: TODAY, renderPng: rec.renderPng });
    assert.equal(r.commits, 6);
    assert.equal(r.stats.totals.lastDay, '2099-06-01');
    for (const svg of rec.seen) assert.doesNotMatch(svg, /2099/);
    for (const f of [...r.cardFiles, r.shareSvg]) assert.doesNotMatch(readFileSync(f, 'utf8'), /2099/, f);
    assert.doesNotMatch(readFileSync(r.html, 'utf8'), /2099/);
    assert.match(readFileSync(r.cardFiles[0], 'utf8'), /Oct 1 – Oct 5, 2026/);
    const steady = r.stats.personality.scores.find((x) => x.id === 'steady-shipper');
    assert.ok(steady.score >= 0.7, String(steady.score)); // 5 of 5 days, not 6 of ~26,540
    assert.equal(r.stats.personality.archetype.id, 'steady-shipper');
    assert.match(r.stats.personality.archetype.reason, /^You committed on 5 of 5 days/);
    const stdout = sink();
    const code = await run([dir, '--no-png', '--out', tmp('gw-a2t-fut-run-')], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.doesNotMatch(stdout.data, /2099/);
  });

  test('recap never prints −0 (or -0): zero lines, empty stats, no stats', () => {
    const zero = { ...commit('2026-10-05T10:00:00+00:00'), files: [{ path: 'a.bin', added: 0, removed: 0, binary: true }], linesAdded: 0, linesRemoved: 0 };
    for (const stats of [computeStats([zero], { today: TODAY }), computeStats([], { today: TODAY }), undefined, {}]) {
      const out = formatSummary(stats, { repoName: 'demo' });
      assert.doesNotMatch(out, /[−+-]0\b/, out);
    }
    assert.match(formatSummary(computeStats([zero], { today: TODAY })), /\b0 \/ 0 lines/);
    const removedOnly = { ...commit('2026-10-05T10:00:00+00:00'), files: [{ path: 'a.js', added: 0, removed: 3, binary: false }], linesAdded: 0, linesRemoved: 3 };
    assert.match(formatSummary(computeStats([removedOnly], { today: TODAY })), /\b0 \/ −3 lines/);
  });

  test('every bidi control (U+202A-202E, U+2066-2069) is stripped from subjects and paths in SVG, share, html and terminal', async () => {
    const BIDI = ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'];
    const evil = `x${BIDI.join('y')}z`;
    const dir = repoOf([1, 2, 3].map((i) => ({
      date: `2026-10-0${i}T10:00:00+00:00`,
      subject: `fix: ${evil} ${i}`,
      file: process.platform === 'win32' ? 'plain.js' : `f${'\u202E'}sj.exe`,
    })));
    const out = tmp('gw-a2t-bidi-');
    const stdout = sink();
    const stderr = sink();
    const code = await run([dir, '--no-png', '--out', out], { stdout, stderr, env: {}, today: TODAY });
    assert.equal(code, 0, stderr.data);
    const RE = /[\u202A-\u202E\u2066-\u2069\u2028\u2029]/;
    assert.doesNotMatch(stdout.data, RE);
    assert.doesNotMatch(stderr.data, RE);
    const files = [join(out, 'wrapped.html'), join(out, 'share.svg')];
    for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), RE, f);
    const r = await generate({ path: dir, out: tmp('gw-a2t-bidi2-'), png: false }, { today: TODAY });
    for (const f of r.cardFiles) assert.doesNotMatch(readFileSync(f, 'utf8'), RE, f);
  });
});

// ---------------------------------------------------------------------------
describe('13. fix round: future streaks, bidi width / page title, author names, recap signs', () => {
  const steadyOf = (s) => s.personality.scores.find((x) => x.id === 'steady-shipper');

  test('a 2099 run is never the longest streak on cards, share, recap or Steady Shipper; stats keep it', () => {
    const stats = computeStats(['2026-09-01', '2026-09-10', '2099-06-01', '2099-06-02', '2099-06-03'].map((d) => commit(`${d}T10:00:00+00:00`)), { today: TODAY });
    assert.deepEqual(stats.streaks.longest, { length: 3, start: '2099-06-01', end: '2099-06-03' }, 'raw stats (stats.json) unchanged');
    assert.deepEqual(shownLongest(stats, TODAY), { length: 1, start: '2026-09-01', end: '2026-09-01' });
    assert.deepEqual(shownLongest(stats, undefined), stats.streaks.longest);
    const cards = buildCards(stats, { repoName: 'demo', today: TODAY });
    for (const { id, svg, description } of cards) {
      assert.doesNotMatch(svg, /2099/, id);
      assert.doesNotMatch(description, /2099/, id);
    }
    const streakSpec = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'streak').spec;
    assert.equal(streakSpec.big, '1');
    assert.match(streakSpec.subtitle, /^On Sep 1, 2026\./);
    const outro = buildCardSpecs(stats, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'outro').spec;
    assert.ok(JSON.stringify(outro).includes('"value":"1 day"'), 'outro best streak');
    const share = renderShareCard(stats, { repoName: 'demo', today: TODAY });
    assert.doesNotMatch(share, /2099|3 DAYS/i);
    // Steady Shipper: 2 of 10 days, a 1-day streak; the streak never exceeds the active days.
    assert.equal(stats.personality.scores.find((x) => x.id === 'steady-shipper').score, Math.round((0.7 * 0.2 + 0.3 / 14) * 100) / 100);
    const reason = `You committed on 2 of 10 days, with a longest streak of 1 day.`;
    const p = computePersonality(stats, { today: TODAY });
    assert.equal(p.scores.find((x) => x.id === 'steady-shipper').score, steadyOf(stats).score);
    if (p.archetype.id === 'steady-shipper') assert.equal(p.archetype.reason, reason);
    // The recap follows the cards when given today, and the raw stats without it.
    assert.match(formatSummary(stats, { today: TODAY }), /longest 1 day\b/);
    assert.match(formatSummary(stats), /longest 3 days/);
  });

  test('longestRun: ties go to the earliest run; unordered and invalid input', () => {
    const d = (...keys) => keys.map((day) => ({ day, commits: 1 }));
    assert.deepEqual(longestRun(d('2026-01-05', '2026-01-01', '2026-01-02', 'bad', '2026-01-06')), { length: 2, start: '2026-01-01', end: '2026-01-02' });
    assert.deepEqual(longestRun([]), { length: 0, start: null, end: null });
    assert.deepEqual(longestRun(undefined), { length: 0, start: null, end: null });
  });

  test('measureText: characters escapeXml strips are zero width, so truncation matches the visible text', () => {
    const hidden = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u2028\u2029\u0001\u007F\u0085\uFFFE';
    assert.equal(measureText(`ab${hidden}c`, 40), measureText('abc', 40));
    for (const ch of hidden) assert.equal(measureText(ch, 40), 0, ch.codePointAt(0).toString(16));
    assert.equal(measureText('\uD800', 40), 0, 'lone surrogate');
    assert.equal(measureText(`\u{1F600}${hidden}`, 40), measureText('\u{1F600}', 40), 'grapheme path too');
    const word = `${'\u202E'.repeat(200)}short`;
    assert.equal(truncateStart(word, { maxWidth: 1000, fontSize: 40 }), word, 'fits once the invisible chars are not counted');
  });

  test('wrapped.html <title>, <h1> and the carousel label drop bidi / control characters', () => {
    const stats = computeStats([commit('2026-10-05T10:00:00+00:00')], { today: TODAY });
    const html = buildViewerHtml(buildCards(stats, { repoName: 'demo', today: TODAY }), { title: 'gitwrapped · re\u202Epo\u2066x\u2069\u2028\u0007' });
    assert.match(html, /<title>gitwrapped · repox<\/title>/);
    assert.match(html, /<h1 class="title">gitwrapped · repox<\/h1>/);
    assert.match(html, /aria-label="gitwrapped · repox"/);
    assert.doesNotMatch(html, /[\u202A-\u202E\u2066-\u2069\u2028\u2029\u0007]/);
    assert.equal(escapeHtml('a\u202E<b>\tc\n'), 'a&lt;b&gt;\tc\n', 'tab / newline kept');
  });

  test('generate(): a repo folder whose name has bidi characters', { skip: process.platform === 'win32' ? 'file names' : false }, async () => {
    const base = tmp('gw-a2t-bidiname-');
    const dir = join(base, 'my\u202Erepo\u2066');
    mkdirSync(dir);
    const git = (args) => execFileSync('git', args, {
      cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(tmpdir(), 'gw-no-such-gitconfig'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.io', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.io', GIT_AUTHOR_DATE: '2026-10-05T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-05T10:00:00Z' },
    });
    git(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'f.txt'), 'x\n');
    git(['add', '-A']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'first']);
    const r = await generate({ path: dir, out: tmp('gw-a2t-bidiname-out-'), png: false }, { today: TODAY });
    const html = readFileSync(r.html, 'utf8');
    assert.match(html, /<title>gitwrapped · myrepo<\/title>/);
    assert.match(html, /<h1 class="title">gitwrapped · myrepo<\/h1>/);
    assert.doesNotMatch(html, /[\u202A-\u202E\u2066-\u2069]/);
  });

  test('authorName: first "@", "Name <email>", regex alternations; no "@" or domain on images', () => {
    const cases = [
      ['a@b@c.com', 'a'],
      ['Ada Lovelace <ada@example.com>', 'Ada Lovelace'],
      ['<ada@example.com>', 'ada'],
      ['ada@example.com|bob@other.io', 'ada'],
      ['ada@example.com\\|bob@other.io', 'ada'],
      ['@example.com', null],
      ['noat', 'noat'],
    ];
    for (const [input, want] of cases) assert.equal(authorName(input), want, input);
    for (const [input] of cases) {
      const stats = computeStats([commit('2026-10-05T10:00:00+00:00')], { today: TODAY });
      const images = [...buildCards(stats, { repoName: 'demo', author: input, today: TODAY }).map((c) => c.svg), renderShareCard(stats, { repoName: 'demo', author: input })].join('\n');
      assert.doesNotMatch(images, /@|example\.com|other\.io|c\.com/i, input);
    }
    const none = buildCardSpecs(computeStats([commit('2026-10-05T10:00:00+00:00')], { today: TODAY }), { repoName: 'demo', author: '@example.com', today: TODAY })[0].spec;
    assert.doesNotMatch(none.subtitle, /Starring/);
  });

  test('recap: rounded counts never print -0, +-N or −-N', () => {
    for (const [added, removed] of [[-0.4, -0], [-3, -7], [0.4, 0.2], [-0, 2.6], [Number.NaN, Infinity]]) {
      const out = formatSummary({ totals: { commits: 1, activeDays: 1, linesAdded: added, linesRemoved: removed } });
      assert.doesNotMatch(out, /\+-|−-|-0\b|−0\b|\+0\b/, `${added} / ${removed}: ${out}`);
    }
    assert.match(formatSummary({ totals: { commits: 1, activeDays: 1, linesAdded: -3, linesRemoved: 2.6 } }), /\b0 \/ −3 lines/);
    assert.match(formatSummary({ totals: { commits: -0.2, activeDays: 1, linesAdded: 1, linesRemoved: 0 } }), /^gitwrapped: 0 commits/);
  });
});
