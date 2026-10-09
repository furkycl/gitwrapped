// Edge cases for stats.rewritten (src/stats/rewritten.js) and the committer date read by
// src/git.js (LOG_FORMAT's %cI line): a brute-force reference on random histories (time
// zones, the exact one-hour edge, merges, missing / malformed dates), parser robustness on
// real git output (Co-authored-by trailers, ISO-looking subjects and trailer values, empty
// subjects, multi-line bodies; every other parsed field unchanged from the old format),
// the cards (never displacing a row, byte-identical without the stat), and the CLI on real
// repos (merges, exactly one hour, --since / --until, --author with .mailmap, multi-repo,
// --lang tr).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRewritten, computeStats, isRewrittenCommit, shownRewritten } from '../src/stats/index.js';
import { LOG_FORMAT, parseLog, readCommits } from '../src/git.js';
import { buildCards, buildCardSpecs, rewrittenCard, rewrittenShareText } from '../src/cards/index.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import { buildStatsJson } from '../src/json.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const US = '\x1f';
const plain = (o) => (o ? { ...o } : o);

/** mulberry32: a small seeded PRNG; rand(n) in [0, n). */
function rng(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return n > 0 ? Math.floor(r * n) : 0;
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** An instant (ms) as strict ISO 8601 in a zone `offMin` minutes east of UTC ("Z" for 0 when `z`). */
function iso(ms, offMin, z = false) {
  const d = new Date(ms + offMin * 60_000);
  const zone = offMin === 0 && z ? 'Z' : `${offMin < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${zone}`;
}

/** Independent instant parser for strict ISO (no Date.parse): ms, or null. */
function instant(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (!m) return null;
  const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const off = m[7] === 'Z' ? 0 : (m[8] === '-' ? -1 : 1) * (+m[9] * 60 + +m[10]);
  return local - off * 60_000;
}

/** Independent reference for computeRewritten. */
function reference(commits) {
  let total = 0;
  let hit = 0;
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c || typeof c !== 'object') continue;
    const merge = Array.isArray(c.parents) ? c.parents.length >= 2 : typeof c.subject === 'string' && /^Merge /.test(c.subject.trim());
    if (merge) continue;
    total += 1;
    const a = instant(c.date);
    const b = instant(c.committerDate);
    if (a !== null && b !== null && b - a > 3_600_000) hit += 1;
  }
  if (total === 0) return null;
  let share = Math.round((hit / total) * 1000) / 1000;
  if (hit < total && share > 0.999) share = 0.999;
  return { commits: hit, share };
}

const ZONES = [0, 60, -300, 180, 330, -720, 840, 345];
const BASE = Date.UTC(2026, 2, 1, 10);
// Committer-minus-author gaps around the one-hour edge (seconds).
const GAPS = [0, 1, 59 * 60, 3599, 3600, 3601, 7200, 86_400, -3601, -86_400, 30 * 86_400];

function randomCommit(rand, i) {
  const t = BASE + rand(40) * 86_400_000 + rand(86_400) * 1000;
  const c = {
    hash: `${pad(i, 6)}abcdef0123456789abcdef0123456789ab`,
    author: 'Ada',
    email: 'ada@example.com',
    date: iso(t, ZONES[rand(ZONES.length)], rand(2) === 0),
    committerDate: iso(t + GAPS[rand(GAPS.length)] * 1000, ZONES[rand(ZONES.length)], rand(2) === 0),
    subject: `feat: change ${i}`,
    parents: ['p'],
    files: [],
  };
  const k = rand(16);
  if (k === 0) c.parents = ['a', 'b'];
  else if (k === 1) c.parents = ['a', 'b', 'c'];
  else if (k === 2) { delete c.parents; c.subject = "Merge branch 'x'"; }
  else if (k === 3) delete c.committerDate;
  else if (k === 4) c.committerDate = 'soon';
  else if (k === 5) c.committerDate = 7_200_000;
  else if (k === 6) c.date = 'yesterday';
  else if (k === 7) { delete c.parents; } // no parents, ordinary subject: not a merge
  else if (k === 8) return [null, 'x', 3][rand(3)];
  return c;
}

describe('computeRewritten: brute force', () => {
  test('matches an independent reference on 600 random histories (zones, the hour edge, merges, malformed)', () => {
    const rand = rng(20261009);
    let nulls = 0;
    let zeros = 0;
    let some = 0;
    let all = 0;
    for (let round = 0; round < 600; round++) {
      const commits = Array.from({ length: rand(14) }, (_, i) => randomCommit(rand, i));
      const snapshot = JSON.stringify(commits);
      const got = computeRewritten(commits);
      const want = reference(commits);
      assert.deepEqual(plain(got), want, `round ${round}`);
      if (got) {
        assert.deepEqual(Object.keys(got), ['commits', 'share']);
        assert.deepEqual(JSON.parse(JSON.stringify(got)), want);
        const shown = shownRewritten(got);
        if (got.commits === 0) assert.equal(shown, null);
        else {
          assert.equal(shown.commits, got.commits);
          // The share text comes from the exact ratio, and reads 100% only when every non-merge commit counts.
          const text = rewrittenShareText(shown);
          assert.equal(text === '100%', got.share === 1, `${round}: ${text}`);
          assert.match(text, /^(<1|\d{1,3})%$/);
        }
      }
      // Same counts commit by commit.
      for (const c of commits) {
        if (c && typeof c === 'object') assert.equal(isRewrittenCommit(c), instant(c.date) !== null && instant(c.committerDate) !== null && instant(c.committerDate) - instant(c.date) > 3_600_000);
      }
      assert.equal(JSON.stringify(commits), snapshot, 'never mutates');
      if (want === null) nulls += 1;
      else if (want.commits === 0) zeros += 1;
      else if (want.share === 1) all += 1;
      else some += 1;
    }
    assert.ok(nulls > 0 && zeros > 0 && some > 0 && all > 0, `coverage ${nulls}/${zeros}/${some}/${all}`);
  });

  test('order never matters; time zones only matter through the instant', () => {
    const rand = rng(7);
    for (let round = 0; round < 100; round++) {
      const commits = Array.from({ length: 1 + rand(10) }, (_, i) => randomCommit(rand, i));
      assert.deepEqual(plain(computeRewritten([...commits].reverse())), plain(computeRewritten(commits)));
    }
    // The exact hour in every zone pairing: never rewritten; a second more: always.
    for (const za of ZONES) {
      for (const zc of ZONES) {
        assert.equal(isRewrittenCommit({ date: iso(BASE, za), committerDate: iso(BASE + 3_600_000, zc) }), false, `${za}/${zc}`);
        assert.equal(isRewrittenCommit({ date: iso(BASE, za), committerDate: iso(BASE + 3_601_000, zc) }), true, `${za}/${zc}`);
      }
    }
  });

  test('stats.json after a round trip: the share text agrees with the in-memory one (2/3, 1/1500)', () => {
    const mk = (i, gap) => ({ date: iso(BASE + i * 1000, 0), committerDate: iso(BASE + i * 1000 + gap, 0), parents: ['p'], subject: 's' });
    const two = computeRewritten([mk(1, 7_200_000), mk(2, 7_200_000), mk(3, 0)]);
    const doc = JSON.parse(buildStatsJson({ stats: { ...computeStats([], { today: TODAY }), rewritten: two }, repoName: 'demo', version: '0.0.0', asOf: TODAY }));
    assert.deepEqual(doc.stats.rewritten, { commits: 2, share: 0.667 });
    assert.equal(rewrittenShareText(shownRewritten(two)), rewrittenShareText(shownRewritten(doc.stats.rewritten)));
    const tiny = computeRewritten(Array.from({ length: 1500 }, (_, i) => mk(i, i === 0 ? 7_200_000 : 0)));
    assert.deepEqual(plain(tiny), { commits: 1, share: 0.001 });
    assert.equal(rewrittenShareText(shownRewritten(tiny)), '<1%');
    const almost = computeRewritten(Array.from({ length: 1500 }, (_, i) => mk(i, i === 0 ? 0 : 7_200_000)));
    assert.deepEqual(plain(almost), { commits: 1499, share: 0.999 });
    assert.equal(rewrittenShareText(shownRewritten(almost)), '99%');
    assert.equal(rewrittenShareText(shownRewritten(JSON.parse(JSON.stringify(almost)))), '99%');
  });
});

describe('parseLog: synthetic records', () => {
  const rec = (subject, tail, { hash = 'h', parents = '' } = {}) => [hash, 'A', 'a@x', '2025-01-01T00:00:00Z', parents, tail === undefined ? subject : `${subject}\n${tail}`].join(US);

  test('ISO-looking subjects, trailers after the date line, empty subject, CRLF, \\x1f in a trailer', () => {
    const [a] = parseLog(`${rec('2025-01-02T03:04:05Z', '2025-01-02T05:00:00+00:00\n2025-01-03T00:00:00Z\nBob <bob@x>')}\0`);
    assert.equal(a.subject, '2025-01-02T03:04:05Z');
    assert.equal(a.committerDate, '2025-01-02T05:00:00+00:00');
    assert.deepEqual(a.coAuthors, [{ name: '2025-01-03T00:00:00Z', email: '' }, { name: 'Bob', email: 'bob@x' }]);
    const [b] = parseLog(`${rec('', '2025-01-02T05:00:00-07:30')}\0`);
    assert.equal(b.subject, '');
    assert.equal(b.committerDate, '2025-01-02T05:00:00-07:30');
    assert.deepEqual(b.coAuthors, []);
    const [c] = parseLog(`${rec('s', '2025-01-02T05:00:00z\r\nBob <bob@x>')}\0`);
    assert.equal(c.committerDate, '2025-01-02T05:00:00+00:00');
    assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
    const [d] = parseLog(`${rec('s', `2025-01-02T05:00:00+01:00\nB${US}ob <bob@x>`)}\0`);
    assert.equal(d.committerDate, '2025-01-02T05:00:00+01:00');
    assert.equal(d.coAuthors.length, 1);
    assert.equal(d.coAuthors[0].email, 'bob@x');
  });

  test('near-miss date lines are not taken as the committer date, and are dropped (never co-authors)', () => {
    for (const line of ['2025-01-02', '2025-01-02T05:00:00', '2025-01-02 05:00:00 +0000', '2025-01-02T05:00:00.123Z', ' 2025-01-02T05:00:00Z', '2025-01-02T05:00:00+0100', 'x2025-01-02T05:00:00Z']) {
      const [c] = parseLog(`${rec('s', `${line}\nBob <bob@x>`)}\0`);
      assert.equal('committerDate' in c, false, line);
      assert.deepEqual(c.coAuthors, [{ name: 'Bob', email: 'bob@x' }], line);
    }
  });

  test('regression: an fsck-invalid zone or a 5-digit year on the %cI line is dropped, never a fake co-author', () => {
    for (const line of ['2025-01-02T05:00:00+123:45', '12025-01-02T05:00:00+00:00', '2025-13-45T99:99:99+00:00']) {
      for (const tail of ['', '\nBob <bob@x>']) {
        const [c] = parseLog(`${rec('s', `${line}${tail}`)}\0`);
        assert.equal('committerDate' in c, false, line);
        assert.equal(isRewrittenCommit(c), false, line);
        assert.deepEqual(c.coAuthors, tail ? [{ name: 'Bob', email: 'bob@x' }] : [], line);
      }
    }
  });

  test('a record from the older format (no committer date line) keeps its first co-author', () => {
    const [c] = parseLog(`${rec('s', 'Bob <bob@x>\nCy <cy@x>')}\0`);
    assert.equal('committerDate' in c, false);
    assert.deepEqual(c.coAuthors.map((x) => x.name), ['Bob', 'Cy']);
  });

  test('an old git that prints the trailers placeholder literally: no co-authors, the date still read', () => {
    const [c] = parseLog(`${rec('s', '2025-01-02T05:00:00+00:00\n%(trailers:key=Co-authored-by,valueonly,unfold,separator=\n)')}\0`);
    assert.equal(c.committerDate, '2025-01-02T05:00:00+00:00');
    assert.deepEqual(c.coAuthors, []);
  });

  test('numstat entries after a record with a committer date still attach to it', () => {
    const out = `${rec('s', '2025-01-02T05:00:00+00:00\nBob <bob@x>', { hash: 'h1' })}\n\x003\t1\ta.js\x00-\t-\tb.png\x00${rec('t', '2025-01-03T05:00:00+00:00', { hash: 'h2', parents: 'h1' })}\n\x001\t0\tc.js\x00`;
    const [c1, c2] = parseLog(out);
    assert.deepEqual(c1.files.map((f) => f.path), ['a.js', 'b.png']);
    assert.equal(c1.linesAdded, 3);
    assert.deepEqual(c1.coAuthors, [{ name: 'Bob', email: 'bob@x' }]);
    assert.deepEqual(c2.files.map((f) => f.path), ['c.js']);
    assert.equal(c2.committerDate, '2025-01-03T05:00:00+00:00');
    assert.deepEqual(c2.parents, ['h1']);
  });
});

// ---------------------------------------------------------------------------------------
// Real git: shared helpers.
const gitEnv = (extra = {}) => {
  const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com', ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return env;
};
const git = (cwd, args, extra) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
const dates = (author, committer = author) => ({ GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer });
const write = (dir, rel, text) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

describe('parseLog: real git output (parser robustness)', () => {
  let tmp;
  let dir;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-rewritten-parse-'));
    dir = join(tmp, 'r');
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    const steps = [
      // [file, message, author date, committer date]
      ['a.txt', 'feat: plain', '2026-03-01T10:00:00+00:00', '2026-03-01T10:00:00+00:00'],
      // Co-authors, rewritten.
      ['b.txt', 'feat: pair\n\nBody line.\n\nCo-authored-by: Bob <bob@example.com>\nCo-authored-by: Cy <cy@example.com>', '2026-03-02T10:00:00+00:00', '2026-03-02T15:00:00+00:00'],
      // Subject is an ISO date; a co-author value is an ISO date too.
      ['c.txt', '2026-01-01T00:00:00Z\n\nCo-authored-by: 2026-02-02T00:00:00+00:00\nCo-authored-by: Dee <dee@example.com>', '2026-03-03T10:00:00+02:00', '2026-03-03T10:30:00+02:00'],
      // Empty message.
      ['d.txt', '', '2026-03-04T10:00:00-05:00', '2026-03-05T10:00:00+09:00'],
      // Multi-line body with date-looking lines and a Co-authored-by line inside the body (not a trailer).
      ['e.txt', 'fix: body\n\n2026-03-05T10:00:00+00:00\nCo-authored-by: Nope <nope@example.com>\nmore text here\n\nSigned-off-by: Ada <ada@example.com>\nCo-authored-by: Eve <eve@example.com>', '2026-03-05T10:00:00+00:00', '2026-03-05T11:00:00+00:00'],
      // Folded trailer, lowercase key.
      ['f.txt', 'feat: folded\n\nco-authored-by: Fay\n  Long <fay@example.com>', '2026-03-06T10:00:00+00:00', '2026-03-06T11:00:01+00:00'],
      // Subject with a unit separator-free tab and unicode.
      ['g.txt', 'docs: ünïcode\tsubject — ok', '2026-03-07T10:00:00+00:00', '2026-03-07T10:00:00+00:00'],
    ];
    for (const [file, msg, a, c] of steps) {
      write(dir, file, `${file}\n`);
      git(dir, ['add', file]);
      git(dir, ['commit', '-q', '--allow-empty-message', '-m', msg], dates(a, c));
    }
    // A merge committed two days after it was authored.
    git(dir, ['checkout', '-q', '-b', 'side', 'HEAD~1']);
    write(dir, 'side.txt', 's\n');
    git(dir, ['add', 'side.txt']);
    git(dir, ['commit', '-q', '-m', 'feat: side'], dates('2026-03-08T10:00:00+00:00'));
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '-q', '--no-ff', '-m', 'Merge branch side\n\nCo-authored-by: Mo <mo@example.com>', 'side'], dates('2026-03-09T10:00:00+00:00', '2026-03-11T10:00:00+00:00'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  const logArgs = (format) => ['log', '-z', '--numstat', '--no-renames', '--root', `--format=${format}`];
  const OLD_FORMAT = LOG_FORMAT.replace('%n%cI', '');

  test('the old format really was the new one minus the committer date line', () => {
    assert.notEqual(OLD_FORMAT, LOG_FORMAT);
    assert.equal(LOG_FORMAT.includes('%s%n%cI%n%(trailers'), true);
  });

  test('every commit: committerDate equals git\'s own %cI; everything else equals the old format\'s parse', () => {
    const now = parseLog(git(dir, logArgs(LOG_FORMAT)));
    const old = parseLog(git(dir, logArgs(OLD_FORMAT)));
    const truth = new Map(git(dir, ['log', '--format=%H %cI']).trim().split('\n').map((l) => l.split(' ')));
    assert.equal(now.length, 9);
    assert.equal(old.length, now.length);
    for (const [i, c] of now.entries()) {
      assert.equal(c.committerDate, truth.get(c.hash).replace(/Z$/, '+00:00'), c.hash);
      const { committerDate, ...rest } = c;
      // Old-format output (never produced any more) whose first Co-authored-by value is
      // itself a strict ISO date is ambiguous: that line reads as a committer date there.
      if (c.subject === '2026-01-01T00:00:00Z') {
        assert.equal(old[i].committerDate, '2026-02-02T00:00:00+00:00');
        assert.deepEqual({ ...old[i], committerDate: undefined, coAuthors: rest.coAuthors }, { ...rest, committerDate: undefined });
        continue;
      }
      assert.deepEqual(rest, old[i], c.subject);
      assert.equal('committerDate' in old[i], false);
    }
  });

  test('co-authors equal git\'s own trailer output, commit by commit', () => {
    const now = parseLog(git(dir, logArgs(LOG_FORMAT)));
    for (const c of now) {
      const values = git(dir, ['log', '-1', '--format=%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x0a)', c.hash]).replace(/\n+$/, '');
      const want = values === '' ? [] : values.split('\n').map((v) => {
        const m = /^(.*?)\s*<([^<>]*)>\s*$/.exec(v.replace(/\s+/g, ' ').trim());
        return m ? { name: m[1], email: m[2] } : { name: v.trim(), email: '' };
      });
      assert.deepEqual(c.coAuthors, want, c.subject);
    }
  });

  test('co-authors, subjects and dates read exactly', () => {
    const bySubject = new Map(parseLog(git(dir, logArgs(LOG_FORMAT))).map((c) => [c.subject, c]));
    assert.deepEqual(bySubject.get('feat: pair').coAuthors, [{ name: 'Bob', email: 'bob@example.com' }, { name: 'Cy', email: 'cy@example.com' }]);
    assert.equal(bySubject.get('feat: pair').committerDate, '2026-03-02T15:00:00+00:00');
    const iso = bySubject.get('2026-01-01T00:00:00Z');
    assert.ok(iso, 'ISO-looking subject kept as the subject');
    assert.equal(iso.committerDate, '2026-03-03T10:30:00+02:00');
    assert.deepEqual(iso.coAuthors, [{ name: '2026-02-02T00:00:00+00:00', email: '' }, { name: 'Dee', email: 'dee@example.com' }]);
    const empty = bySubject.get('');
    assert.ok(empty, 'empty subject');
    assert.equal(empty.committerDate, '2026-03-05T10:00:00+09:00');
    assert.deepEqual(empty.coAuthors, []);
    assert.deepEqual(empty.files.map((f) => f.path), ['d.txt']);
    const body = bySubject.get('fix: body');
    assert.deepEqual(body.coAuthors, [{ name: 'Eve', email: 'eve@example.com' }]);
    assert.equal(body.committerDate, '2026-03-05T11:00:00+00:00');
    assert.deepEqual(bySubject.get('feat: folded').coAuthors, [{ name: 'Fay Long', email: 'fay@example.com' }]);
    assert.equal(bySubject.get('docs: ünïcode\tsubject — ok').committerDate, '2026-03-07T10:00:00+00:00');
    const m = bySubject.get('Merge branch side');
    assert.equal(m.parents.length, 2);
    assert.deepEqual(m.coAuthors, [{ name: 'Mo', email: 'mo@example.com' }]);
  });

  test('readCommits: rewritten = pair (5h), empty (-05:00 → +09:00, 10h), folded (1h + 1s); not the exact hour, the merge or the 30 min one', async () => {
    const res = await readCommits(dir);
    const commits = res.commits ?? res;
    const hits = commits.filter((c) => isRewrittenCommit(c) && c.parents.length < 2).map((c) => c.subject).sort();
    assert.deepEqual(hits, ['', 'feat: folded', 'feat: pair']);
    assert.ok(isRewrittenCommit(commits.find((c) => c.parents.length > 1)), 'the merge itself is late');
    // 8 non-merge commits.
    assert.deepEqual(computeRewritten(commits), { commits: 3, share: 0.375 });
    const s = computeStats(commits, { today: TODAY });
    assert.deepEqual(s.rewritten, { commits: 3, share: 0.375 });
    // Co-authors stat unaffected by the extra line: pair (Bob, Cy), ISO (the date "name", Dee), body (Eve), folded (Fay); the merge skipped.
    assert.equal(s.coAuthors.paired, 4);
    assert.equal(s.coAuthors.commits, 8);
    assert.equal(s.coAuthors.total, 6); // Bob, Cy, the date "name", Dee, Eve, Fay (Mo only on the merge)
  });
});

// ---------------------------------------------------------------------------------------
// Cards: never displacing, byte-identical when absent.
const H = (i) => `${pad(i, 4)}abcdef0123456789abcdef0123456789abcd`;
const day = (i) => `2026-03-${pad(1 + (i % 27))}`;
const mk = (i, files, extra = {}) => ({
  hash: H(i),
  date: `${day(i)}T10:00:00+00:00`,
  committerDate: `${day(i)}T10:00:00+00:00`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added, removed]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const svgs = (s, lang) => buildCards(s, cardOpts(lang)).map((c) => [c.id, c.svg]);
const isRow = (r, L) => [L.totals.rewritten, L.totals.rewrittenLabelShort].includes(r?.label);

function randomCardHistory(rand) {
  const authors = [['Ada', 'ada@example.com'], ['Bob', 'bob@example.com'], ['Cy', 'cy@example.com']];
  const subjects = ['feat: add thing', 'fix: bug', 'chore(deps): bump x', 'docs: readme', 'Revert "feat: x"', 'refactor: cleanup', 'fixup! feat: add thing', 'wip', 'test: more tests #12'];
  const paths = ['src/a.js', 'src/b.ts', 'package.json', 'package-lock.json', 'README.md', 'test/a.test.js', 'docs/g.md', 'lib/c.py'];
  return Array.from({ length: 1 + rand(30) }, (_, i) => {
    const [author, email] = authors[rand(1 + rand(3))];
    const files = Array.from({ length: 1 + rand(4) }, () => [paths[rand(paths.length)], rand(200), rand(50)]);
    const late = rand(3) === 0;
    const c = mk(i + 1, files, { author, email, subject: subjects[rand(subjects.length)] });
    c.date = `${day(i + rand(5))}T${pad(rand(24))}:${pad(rand(60))}:00+00:00`;
    c.committerDate = late ? `2026-03-28T23:00:00+00:00` : c.date;
    if (rand(10) === 0) c.parents = ['a', 'b'];
    return c;
  });
}

describe('cards: random histories', () => {
  test('the row only ever adds a last row to one card (totals, else messages); everything else byte-identical', () => {
    const rand = rng(424242);
    let onTotals = 0;
    let onMessages = 0;
    let none = 0;
    for (let round = 0; round < 40; round++) {
      const commits = randomCardHistory(rand);
      const s = computeStats(commits, { today: TODAY });
      const without = { ...s, rewritten: null };
      for (const [lang, L] of [['en', en], ['tr', tr]]) {
        const a = buildCardSpecs(s, cardOpts(lang));
        const b = buildCardSpecs(without, cardOpts(lang));
        const sa = svgs(s, lang);
        const sb = svgs(without, lang);
        assert.deepEqual(sa.map(([id]) => id), sb.map(([id]) => id));
        const where = rewrittenCard(s, { L });
        const changed = sa.filter(([id, svg], i) => svg !== sb[i][1]).map(([id]) => id);
        if (!shownRewritten(s.rewritten) || where === null) {
          assert.deepEqual(changed, [], `${round} ${lang}`);
          none += 1;
          continue;
        }
        assert.deepEqual(changed, [where], `${round} ${lang}`);
        if (where === 'totals') onTotals += 1;
        else onMessages += 1;
        const spec = a.find((c) => c.id === where).spec;
        const base = b.find((c) => c.id === where).spec;
        assert.ok(isRow(spec.lines.at(-1), L), `${round} ${lang}`);
        assert.deepEqual(spec.lines.slice(0, -1), base.lines, `${round} ${lang}: no row displaced`);
        assert.equal(spec.lines.filter((r) => isRow(r, L)).length, 1);
        for (const c of a) if (c.id !== where) assert.equal((c.spec.lines ?? []).some((r) => isRow(r, L)), false, c.id);
        for (const [, svg] of sa) assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
      }
    }
    assert.ok(onTotals > 0 && none > 0, `coverage ${onTotals}/${onMessages}/${none}`);
  });

  test('absent / null / zero / malformed stat: every card byte-identical, en and tr', () => {
    const rand = rng(5);
    for (let round = 0; round < 8; round++) {
      const s = computeStats(randomCardHistory(rand), { today: TODAY });
      const { rewritten, ...noKey } = s;
      for (const lang of ['en', 'tr']) {
        const base = svgs(noKey, lang);
        for (const v of [null, undefined, { commits: 0, share: 0 }, { commits: 0, share: 0.5 }, { commits: NaN, share: 1 }, 'x', 7, []]) {
          assert.deepEqual(svgs({ ...s, rewritten: v }, lang), base, `${round} ${lang} ${JSON.stringify(v)}`);
        }
      }
    }
  });

  test('zero rewritten commits from real data: stat is {0, 0}, no recap / md line', () => {
    const s = computeStats([mk(1, [['a.js', 1, 0]]), mk(2, [['b.js', 1, 0]], { committerDate: '2026-03-03T11:00:00+00:00' })], { today: TODAY });
    assert.deepEqual(plain(s.rewritten), { commits: 0, share: 0 });
    for (const lang of ['en', 'tr']) {
      assert.deepEqual(svgs(s, lang), svgs({ ...s, rewritten: null }, lang));
      assert.doesNotMatch(formatSummary(s, { repoName: 'demo', today: TODAY, lang }), /Rewritten|Yeniden yazıl/);
      assert.doesNotMatch(buildMarkdown(s, { repoName: 'demo', today: TODAY, lang }), /Rewritten|Yeniden yazıl/);
    }
  });
});

// ---------------------------------------------------------------------------------------
// The CLI on real repos.
describe('rewritten: CLI on real git repos', () => {
  const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const bin = (args) => {
    const env = { ...process.env, TZ: 'UTC' };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    return spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { cwd: ROOT, encoding: 'utf8', env });
  };
  let tmp;
  let main;
  const init = (name) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };
  const commitAt = (dir, file, msg, a, c = a, who = {}) => {
    write(dir, file, `${msg}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', msg], { ...dates(a, c), ...who });
  };
  const run = (args, name) => {
    const out = join(tmp, `${name}-out`);
    const r = bin([...args, '--out', out, '--json', '--md']);
    assert.equal(r.status, 0, r.stderr);
    return { r, out, doc: JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8')), md: readFileSync(join(out, 'wrapped.md'), 'utf8') };
  };
  const cardSvg = (out, re) => {
    const f = readdirSync(join(out, 'cards')).find((x) => re.test(x));
    return f ? readFileSync(join(out, 'cards', f), 'utf8') : null;
  };

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gw-rewritten-extra-'));
    main = init('main');
    // February: one rewritten (authored Feb 27, committed Feb 27 + 3h).
    commitAt(main, 'a.js', 'feat: feb plain', '2026-02-10T10:00:00+00:00');
    commitAt(main, 'b.js', 'feat: feb late', '2026-02-27T10:00:00+00:00', '2026-02-27T13:00:00+00:00');
    // Authored Feb 28, committed Mar 2 (a rebase across the window edge).
    commitAt(main, 'c.js', 'feat: across', '2026-02-28T10:00:00+00:00', '2026-03-02T10:00:00+00:00');
    // March: exactly one hour (not rewritten), 61 minutes (rewritten), plain.
    commitAt(main, 'd.js', 'feat: exactly an hour', '2026-03-03T10:00:00+00:00', '2026-03-03T11:00:00+00:00');
    commitAt(main, 'e.js', 'feat: an hour and a minute', '2026-03-04T10:00:00+00:00', '2026-03-04T11:01:00+00:00');
    commitAt(main, 'f.js', 'feat: mar plain', '2026-03-05T10:00:00+00:00');
    // Bob (old email, mailmapped to bob@new.example.com), rewritten in March.
    const oldBob = { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@old.example.com' };
    commitAt(main, 'g.js', 'feat: bob old', '2026-03-06T10:00:00+00:00', '2026-03-07T10:00:00+00:00', oldBob);
    commitAt(main, 'h.js', 'feat: bob new', '2026-03-08T10:00:00+00:00', '2026-03-08T10:00:00+00:00', { GIT_AUTHOR_NAME: 'Bob', GIT_AUTHOR_EMAIL: 'bob@new.example.com' });
    // A late merge: never counted.
    git(main, ['checkout', '-q', '-b', 'side']);
    commitAt(main, 'side.js', 'feat: side', '2026-03-09T10:00:00+00:00');
    git(main, ['checkout', '-q', 'main']);
    commitAt(main, 'i.js', 'feat: before merge', '2026-03-10T10:00:00+00:00');
    git(main, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side'], dates('2026-03-11T10:00:00+00:00', '2026-03-20T10:00:00+00:00'));
    // Authored Mar 31, committed Apr 2: inside --until 2026-03-31.
    commitAt(main, 'j.js', 'feat: end of march', '2026-03-31T10:00:00+00:00', '2026-04-02T10:00:00+00:00');
    write(main, '.mailmap', 'Bob <bob@new.example.com> <bob@old.example.com>\n');
    git(main, ['add', '.mailmap']);
    git(main, ['commit', '-q', '-m', 'chore: mailmap'], dates('2026-04-01T10:00:00+00:00'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); });

  test('whole history: late merge and exact hour not counted; stats.json, recap and wrapped.md agree', () => {
    const { r, doc, md } = run([main], 'all');
    // Non-merge: 12 (a b c d e f g h side i j mailmap). Rewritten: b, c, e, g, j = 5.
    assert.deepEqual(doc.stats.rewritten, { commits: 5, share: 0.417 });
    assert.match(r.stdout, /\n {2}Rewritten\s+5 commits \(42% of non-merge commits\)\n/);
    assert.match(md, /## Rewritten commits\n\n5 commits \\\(42% of non-merge commits\\\)\n/);
  });

  test('--since / --until go by the author date: a rebase across the edge stays in its authored month', () => {
    const feb = run([main, '--since', '2026-02-01', '--until', '2026-02-28'], 'feb');
    // a, b (late), c (authored Feb 28, committed Mar 2: late).
    assert.deepEqual(feb.doc.stats.rewritten, { commits: 2, share: 0.667 });
    const mar = run([main, '--since', '2026-03-01', '--until', '2026-03-31'], 'mar');
    // d e f g h side i j (merge excluded): e, g, j late → 3 of 8.
    assert.deepEqual(mar.doc.stats.rewritten, { commits: 3, share: 0.375 });
    assert.match(mar.r.stdout, /Rewritten\s+3 commits \(38% of non-merge commits\)/);
    const exact = run([main, '--since', '2026-03-03', '--until', '2026-03-03'], 'exact');
    assert.deepEqual(exact.doc.stats.rewritten, { commits: 0, share: 0 });
    assert.doesNotMatch(exact.r.stdout, /Rewritten/);
    assert.doesNotMatch(exact.md, /Rewritten/);
  });

  test('--author with .mailmap: both of Bob\'s emails count, only his commits', () => {
    const bob = run([main, '--author', 'bob@new.example.com'], 'bob');
    assert.deepEqual(bob.doc.stats.rewritten, { commits: 1, share: 0.5 });
    assert.match(bob.r.stdout, /Rewritten\s+1 commit \(50% of non-merge commits\)/);
    const ada = run([main, '--author', 'ada@example.com'], 'ada');
    // Ada: a b c d e f side i j mailmap = 10; late b c e j = 4.
    assert.deepEqual(ada.doc.stats.rewritten, { commits: 4, share: 0.4 });
  });

  test('null: only a merge in the window', () => {
    const only = run([main, '--since', '2026-03-11', '--until', '2026-03-11'], 'merge-only');
    assert.equal(only.doc.stats.rewritten, null);
    assert.ok('rewritten' in only.doc.stats);
    assert.doesNotMatch(only.r.stdout, /Rewritten/);
    assert.doesNotMatch(only.md, /Rewritten/);
  });

  test('multi-repo with --lang tr: counts summed across repos, Turkish recap / md', () => {
    const api = init('api');
    const web = init('web');
    commitAt(api, 'a.js', 'feat: api', '2026-03-02T10:00:00+03:00', '2026-03-02T10:00:00+00:00'); // 3h later
    commitAt(api, 'b.js', 'feat: api 2', '2026-03-03T10:00:00+00:00');
    commitAt(web, 'c.js', 'feat: web', '2026-03-04T10:00:00+00:00', '2026-03-04T12:00:00+00:00');
    commitAt(web, 'd.js', 'feat: web 2', '2026-03-05T10:00:00+00:00', '2026-03-05T10:59:59+00:00');
    const { r, doc, md, out } = run([api, web, '--lang', 'tr'], 'multi');
    assert.deepEqual(doc.stats.rewritten, { commits: 2, share: 0.5 });
    assert.match(r.stdout, /Yeniden yazılmış\s+2 commit \(merge dışı commit'lerin %50 kadarı\)/);
    assert.match(md, /## Yeniden yazılan commit'ler\n\n2 commit \\\(merge dışı commit'lerin %50 kadarı\\\)\n/);
    // This fixture has room on the totals card: the row is there, and only there.
    const has = (svg) => Boolean(svg && /Yeniden yazıl(an|mış)/.test(svg));
    assert.deepEqual([has(cardSvg(out, /totals\.svg$/)), has(cardSvg(out, /messages\.svg$/))], [true, false]);
  });

  test('tiny single repo: the row is in the written totals SVG, en and tr; a repo without rewrites has none', () => {
    const dir = init('tiny');
    commitAt(dir, 'a.js', 'feat: a', '2026-03-02T10:00:00+00:00');
    commitAt(dir, 'b.js', 'feat: b', '2026-03-03T10:00:00+00:00', '2026-03-03T18:00:00+00:00');
    for (const [lang, re, val] of [['en', /Rewritten commits/, /1 commit · 50%/], ['tr', /Yeniden yazıl(an|mış)/, /· %50/]]) {
      const { out, doc } = run([dir, '--lang', lang], `tiny-${lang}`);
      assert.deepEqual(doc.stats.rewritten, { commits: 1, share: 0.5 });
      const svg = cardSvg(out, /totals\.svg$/);
      assert.match(svg, re, lang);
      assert.match(svg, val, lang);
    }
    const clean = init('clean');
    commitAt(clean, 'a.js', 'feat: a', '2026-03-02T10:00:00+00:00');
    commitAt(clean, 'b.js', 'feat: b', '2026-03-03T10:00:00+00:00', '2026-03-03T11:00:00+00:00');
    const c = run([clean], 'clean');
    assert.deepEqual(c.doc.stats.rewritten, { commits: 0, share: 0 });
    for (const f of readdirSync(join(c.out, 'cards')).filter((x) => x.endsWith('.svg'))) {
      assert.doesNotMatch(readFileSync(join(c.out, 'cards', f), 'utf8'), /Rewritten/, f);
    }
  });
});
