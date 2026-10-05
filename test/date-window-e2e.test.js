// End-to-end tests for --until, --year and --json through the real binary
// (`node bin/gitwrapped.js ...`) against throwaway repos with explicit author/committer
// dates, plus timezone probes of the window filter vs. the stats' author-local days.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_IDS } from '../src/cards/index.js';
import { parseCli } from '../src/cli.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const CARD_FILES = CARD_IDS.map((id, i) => `${String(i + 1).padStart(2, '0')}-${id}.svg`);
const WIN = process.platform === 'win32';

const ADA = { name: 'Ada', email: 'ada@example.com' };
const BOB = { name: 'Bob', email: 'bob@example.com' };

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FORCE_COLOR', 'NO_COLOR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: WIN ? 'NUL' : '/dev/null', ...extra };
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A throwaway repo at <tmp>/<name> (a short name keeps card footers from being ellipsized);
 * each commit is [who, ISO date with offset, subject]. Returns the repo path; remove
 * dirname(path).
 */
function makeRepo(prefix, commits, name = 'app') {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), name);
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [who, date, subject] of commits) {
    git(dir, ['commit', '-q', '--allow-empty', '--no-gpg-sign', '--no-verify', '-m', subject], {
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

// Default TZ=UTC so bare YYYY-MM-DD bounds mean UTC midnight; PNGs skipped unless asked.
function bin(args, { env = {}, png = false } = {}) {
  return spawnSync(process.execPath, [BIN, ...args, '--no-color', ...(png ? [] : ['--no-png'])], {
    cwd: ROOT,
    encoding: 'utf8',
    env: cleanEnv({ TZ: 'UTC', ...env }),
  });
}

const readJson = (out) => JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
const embeddedSvgs = (page) => [...page.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0].replace(/ aria-describedby="card-\d+-desc"/, ''));

// Noon UTC, far from any year boundary in every timezone (UTC-12 .. UTC+14).
const HISTORY = [
  [ADA, '2024-12-15T12:00:00+00:00', 'feat: last year'],
  [ADA, '2025-01-10T12:00:00+00:00', 'feat: start the year'],
  [BOB, '2025-03-05T12:00:00+00:00', 'fix: spring cleaning'],
  [ADA, '2025-07-04T12:00:00+00:00', 'feat: summer'],
  [BOB, '2025-11-20T12:00:00+00:00', 'fix: autumn'],
  [ADA, '2026-02-01T12:00:00+00:00', 'feat: next year'],
];

let repo;
let tmp;
const out = (name) => join(tmp, name);

before(() => {
  repo = makeRepo('gw-window-e2e-', HISTORY);
  tmp = mkdtempSync(join(tmpdir(), 'gw-window-e2e-out-'));
});
after(() => {
  if (repo) rmSync(dirname(repo), { recursive: true, force: true, maxRetries: 5 });
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

describe('bin --year', () => {
  let r;
  let o;
  before(() => {
    o = out('year');
    r = bin([repo, '--year', '2025', '--out', o], { png: true });
  });

  test('exits 0; the recap counts only that year and names it', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^gitwrapped: 4 commits → /);
    assert.ok(r.stdout.includes(`${basename(repo)} Wrapped · 2025`), r.stdout);
  });

  test('every card footer and the intro mention the year', () => {
    assert.deepEqual(readdirSync(join(o, 'cards')).sort(), CARD_FILES);
    const intro = readFileSync(join(o, 'cards', CARD_FILES[0]), 'utf8');
    assert.match(intro, /your 2025 in git/i, 'intro callout names the year');
    for (const f of CARD_FILES) {
      const svg = readFileSync(join(o, 'cards', f), 'utf8');
      assert.ok(svg.includes(`${basename(repo)} · 2025`), `${f} footer shows "repo · 2025"`);
      assert.ok(!svg.includes('2026'), `${f} does not mention the next year`);
    }
    assert.ok(readFileSync(join(o, 'share.svg'), 'utf8').includes('2025'), 'share image names the year');
  });

  test('wrapped.html embeds exactly the card SVGs that were written', () => {
    const page = readFileSync(join(o, 'wrapped.html'), 'utf8');
    assert.match(page, /^<!doctype html>/);
    const embedded = embeddedSvgs(page);
    assert.equal(embedded.length, CARD_FILES.length);
    CARD_FILES.forEach((f, i) => {
      const file = readFileSync(join(o, 'cards', f), 'utf8').replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
      assert.equal(embedded[i], file, `${f} is card ${i + 1} in wrapped.html`);
    });
    assert.match(page, /your 2025 in git/i);
  });

  test('PNGs are written for the year run', () => {
    assert.deepEqual(readdirSync(join(o, 'png')).sort(), CARD_FILES.map((f) => f.replace(/\.svg$/, '.png')));
    assert.ok(existsSync(join(o, 'share.png')));
  });

  test('--year=2025 (equals form) gives byte-identical cards', () => {
    const o2 = out('year-eq');
    const r2 = bin([repo, '--year=2025', `--out=${o2}`]);
    assert.equal(r2.status, 0, r2.stderr);
    for (const f of CARD_FILES) {
      assert.equal(readFileSync(join(o2, 'cards', f), 'utf8'), readFileSync(join(o, 'cards', f), 'utf8'), f);
    }
  });
});

describe('bin --json', () => {
  test('--year + --author: filters echoed, totals.commits = matching commits', () => {
    const o = out('json-year-author');
    const r = bin([repo, '--year', '2025', '--author', 'bob@example.com', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 2 commits → /);
    assert.ok(r.stdout.includes(join(o, 'stats.json')), 'recap points at stats.json');
    const j = readJson(o);
    assert.deepEqual(j.filters, { since: '2025-01-01', until: '2025-12-31', author: 'bob@example.com', maxCommits: 50000 });
    assert.equal(j.truncated, false);
    assert.equal(j.repo, basename(repo));
    const expected = HISTORY.filter(([who, d]) => who === BOB && d.startsWith('2025-')).length;
    assert.equal(j.stats.totals.commits, expected);
    assert.equal(j.stats.totals.firstDay, '2025-03-05');
    assert.equal(j.stats.totals.lastDay, '2025-11-20');
    // Current streak is relative to Dec 31, 2025: the last active day is long before it.
    assert.equal(j.stats.streaks.current.length, 0);
  });

  test('--author matches case-insensitively; stats.json keeps the email as given', () => {
    const o = out('json-author-case');
    const r = bin([repo, '--year', '2025', '--author', 'ADA@Example.com', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    const j = readJson(o);
    assert.equal(j.stats.totals.commits, 2);
    assert.equal(j.filters.author, 'ADA@Example.com');
  });

  test('--until alone: inclusive end, since stays null, streak ends at the window end', () => {
    const o = out('json-until');
    const r = bin([repo, '--until', '2025-03-05', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 3 commits → /);
    assert.ok(r.stdout.includes('Wrapped · until Mar 5, 2025'), r.stdout);
    const j = readJson(o);
    assert.deepEqual(j.filters, { since: null, until: '2025-03-05', author: null, maxCommits: 50000 });
    assert.equal(j.stats.totals.commits, 3);
    assert.equal(j.stats.totals.firstDay, '2024-12-15');
    assert.equal(j.stats.totals.lastDay, '2025-03-05');
    assert.deepEqual(j.stats.streaks.current, { length: 1, start: '2025-03-05', end: '2025-03-05' });
    const footer = readFileSync(join(o, 'cards', CARD_FILES[0]), 'utf8');
    assert.ok(footer.includes('until Mar 5, 2025'), 'footer shows the open-ended window');
  });

  test('--until the day before a commit excludes it', () => {
    const r = bin([repo, '--until', '2025-03-04', '--out', out('until-before')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^gitwrapped: 2 commits → /);
  });

  test('--since + --until + --max-commits: cap applies inside the window and is echoed', () => {
    const o = out('json-cap');
    const r = bin([repo, '--since', '2025-01-01', '--until', '2025-12-31', '--max-commits', '2', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    const j = readJson(o);
    assert.equal(j.stats.totals.commits, 2);
    assert.equal(j.truncated, true);
    assert.equal(j.filters.maxCommits, 2);
    // The two most recent commits inside 2025, not the 2026 one.
    assert.equal(j.stats.totals.firstDay, '2025-07-04');
    assert.equal(j.stats.totals.lastDay, '2025-11-20');
    assert.ok(r.stdout.includes('only the most recent 2 were analyzed'), r.stdout);
  });

  test('an empty window still writes valid stats.json and exits 0', () => {
    const o = out('json-empty');
    const r = bin([repo, '--year', '2030', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Note: no commits match --year 2030.'), r.stdout);
    const j = readJson(o);
    assert.equal(j.schemaVersion, 1);
    assert.deepEqual(j.filters, { since: '2030-01-01', until: '2030-12-31', author: null, maxCommits: 50000 });
    assert.equal(j.stats.totals.commits, 0);
    assert.equal(j.truncated, false);
    assert.equal(readdirSync(join(o, 'cards')).length, CARD_FILES.length);
  });

  test('--json on an empty repo writes valid stats.json', () => {
    const empty = makeRepo('gw-window-e2e-empty-', []);
    try {
      const o = out('json-empty-repo');
      const r = bin([empty, '--until', '2025-01-01', '--json', '--out', o]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readJson(o).stats.totals.commits, 0);
    } finally {
      rmSync(dirname(empty), { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

test('a long repo name does not ellipsize the window out of the footer', () => {
  const long = makeRepo('gw-window-e2e-long-', [[ADA, '2025-03-05T12:00:00+00:00', 'x']], 'my-rather-long-project-name');
  try {
    const o = out('long-name');
    const r = bin([long, '--until', '2025-03-05', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of CARD_FILES) {
      assert.ok(readFileSync(join(o, 'cards', f), 'utf8').includes('until Mar 5, 2025'), `${f} footer keeps the full window`);
    }
  } finally {
    rmSync(dirname(long), { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('bin: bad windows exit 2 with a message and write nothing', () => {
  const cases = [
    [['--year', '2025', '--since', '2025-01-01'], '--year cannot be combined with --since or --until'],
    [['--since', '2025-01-01', '--year', '2025'], '--year cannot be combined with --since or --until'],
    [['--year', '2025', '--until', '2025-06-01'], '--year cannot be combined with --since or --until'],
    [['--until', '2025-02-30'], 'invalid --until "2025-02-30": not a real calendar date'],
    [['--until', '2025-02-29'], 'invalid --until "2025-02-29": not a real calendar date'],
    [['--until', '2025/03/01'], 'invalid --until "2025/03/01": expected format YYYY-MM-DD'],
    [['--since', '2025-05-01', '--until', '2025-04-01'], '--since 2025-05-01 is after --until 2025-04-01'],
    [['--year', '99'], 'invalid --year "99": expected a four-digit year from 1970 to 9999'],
    [['--year', '1969'], 'invalid --year "1969"'],
    [['--year', '02025'], 'invalid --year "02025"'],
    [['--year', ''], '--year requires a non-empty value'],
    [['--year'], '--year requires a value'],
    [['--until'], '--until requires a value'],
    [['--json=yes'], "Option '--json' does not take an argument"],
  ];
  for (const [args, msg] of cases) {
    test(args.join(' ') || '(none)', () => {
      const o = out(`bad-${args.join('_').replace(/[^\w-]/g, '')}`);
      const r = bin([repo, ...args, '--out', o]);
      assert.equal(r.status, 2, `exit code; stderr: ${r.stderr}`);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.startsWith(`gitwrapped: ${msg}`), r.stderr);
      assert.ok(r.stderr.includes('Run "gitwrapped --help" for usage.'), r.stderr);
      assert.ok(!existsSync(o), 'nothing written');
    });
  }

  test('leap day 2024-02-29 is a valid --until', () => {
    const r = bin([repo, '--until', '2024-02-29', '--out', out('leap')]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Note: no commits match --until 2024-02-29.'), r.stdout);
  });

  test('--year 1970 and --year 9999 are accepted (bounds of the documented range)', () => {
    for (const y of ['1970', '9999']) {
      const r = bin([repo, '--year', y, '--out', out(`year-${y}`)]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes(`Note: no commits match --year ${y}.`), r.stdout);
    }
  });
});

describe('bin --help', () => {
  test('lists --until, --year and --json', () => {
    const r = bin(['--help']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /--until YYYY-MM-DD/);
    assert.match(r.stdout, /--year YYYY/);
    assert.match(r.stdout, /--json\s+Also write every stat to <out>\/stats\.json/);
  });
});

describe('parseCli equals forms', () => {
  test('--year=2025 --json equals the spaced form', () => {
    const a = parseCli(['--year=2025', '--json']);
    const b = parseCli(['--year', '2025', '--json']);
    assert.deepEqual(a, b);
    assert.equal(a.year, '2025');
    assert.equal(a.since, '2025-01-01');
    assert.equal(a.until, '2025-12-31');
    assert.equal(a.json, true);
  });

  test('--until=YYYY-MM-DD equals the spaced form', () => {
    assert.deepEqual(parseCli(['--until=2025-03-05']), parseCli(['--until', '2025-03-05']));
    assert.equal(parseCli(['--until=2025-03-05']).until, '2025-03-05');
    assert.equal(parseCli(['--until=2025-03-05']).since, undefined);
  });

  test('--year= (empty) and --year=+2025 are rejected', () => {
    assert.throws(() => parseCli(['--year=']), /--year requires a non-empty value/);
    assert.throws(() => parseCli(['--year=+2025']), /invalid --year "\+2025"/);
  });
});

// --- Timezone behavior -------------------------------------------------------------
// git stores each author date with its own offset; the stats attribute a commit to the
// author's local calendar day (dayKey). These cases set TZ on the child process, which
// Windows does not honor reliably, so they are skipped there.
describe('timezones (TZ on the child process)', { skip: WIN && 'TZ env is not reliable on Windows' }, () => {
  let edge;
  before(() => {
    edge = makeRepo('gw-window-e2e-tz-', [
      [ADA, '2025-12-30T12:00:00+00:00', 'mid'],
      // 2025-12-31T10:30Z, but Jan 1, 2026 for the author (Kiribati, UTC+14).
      [ADA, '2026-01-01T00:30:00+14:00', 'kiritimati new year'],
      // 2026-01-01T11:30Z, but Dec 31, 2025 for the author (UTC-12).
      [ADA, '2025-12-31T23:30:00-12:00', 'baker island new year eve'],
    ]);
  });
  after(() => {
    if (edge) rmSync(dirname(edge), { recursive: true, force: true, maxRetries: 5 });
  });

  test('a mid-window commit counts the same in every machine timezone', () => {
    for (const TZ of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles', 'Asia/Kolkata']) {
      const o = out(`tz-mid-${TZ.replace(/\W/g, '_')}`);
      const r = bin([repo, '--since', '2025-03-01', '--until', '2025-03-31', '--json', '--out', o], { env: { TZ } });
      assert.equal(r.status, 0, r.stderr);
      const j = readJson(o);
      assert.equal(j.stats.totals.commits, 1, TZ);
      assert.deepEqual(j.stats.daily.days, [{ day: '2025-03-05', commits: 1 }], TZ);
    }
  });

  test('stats.json is identical across machine timezones when no commit is near a bound', () => {
    const docs = ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12'].map((TZ) => {
      const o = out(`tz-same-${TZ.replace(/\W/g, '_')}`);
      const r = bin([repo, '--year', '2025', '--json', '--out', o], { env: { TZ } });
      assert.equal(r.status, 0, r.stderr);
      return readFileSync(join(o, 'stats.json'), 'utf8');
    });
    assert.equal(docs[1], docs[0]);
    assert.equal(docs[2], docs[0]);
  });

  // The window filter compares each commit's author-local day (the day every stat uses),
  // so near a bound the result does not depend on the machine's timezone.
  for (const TZ of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
    test(`--year 2025 only reports days inside 2025 (TZ=${TZ})`, () => {
      const o = out(`tz-edge-${TZ.replace(/\W/g, '_')}`);
      const r = bin([edge, '--year', '2025', '--json', '--out', o], { env: { TZ } });
      assert.equal(r.status, 0, r.stderr);
      const j = readJson(o);
      for (const { day } of j.stats.daily.days) assert.ok(day >= '2025-01-01' && day <= '2025-12-31', `${day} outside 2025`);
      assert.ok(j.stats.totals.lastDay <= '2025-12-31', j.stats.totals.lastDay);
      assert.ok(!j.stats.streaks.current.end || j.stats.streaks.current.end <= '2025-12-31', JSON.stringify(j.stats.streaks.current));
      // Author-local attribution: "mid" and the UTC-12 commit are 2025, the UTC+14 one is 2026.
      assert.equal(j.stats.totals.commits, 2);
    });
  }
});

// No TZ needed: noon UTC is Jan 3 / Jun 1 for the author in any machine timezone.
test('--year 1970 finds commits from early January 1970', () => {
  const old = makeRepo('gw-window-e2e-1970-', [
    [ADA, '1970-01-03T12:00:00+00:00', 'epoch-ish'],
    [ADA, '1970-06-01T12:00:00+00:00', 'summer of 70'],
    [ADA, '2024-02-29T12:00:00+00:00', 'leap'],
  ]);
  try {
    const o = out('y1970');
    const r = bin([old, '--year', '1970', '--json', '--out', o]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readJson(o).stats.totals.commits, 2);
  } finally {
    rmSync(dirname(old), { recursive: true, force: true, maxRetries: 5 });
  }
});
