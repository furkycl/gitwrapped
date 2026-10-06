// --md: <out>/wrapped.md, a Markdown summary (sections, en / tr, no emails, escaping,
// card links that match the written card files, CLI flag, stale-file and symlink rules).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { generate, HELP_TEXT, parseCli, run } from '../src/cli.js';
import { buildMarkdown, escapeMarkdown } from '../src/markdown.js';
import { buildCardSpecs } from '../src/cards/index.js';
import { computeStats } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

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

function commit(date, subject, files = [{ path: 'src/app.js', added: 3, removed: 1 }], author = 'Ada', email = 'ada@example.com') {
  return {
    hash: `${date}-${subject}`, author, email, date, subject, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

const sampleCommits = () => [
  commit('2024-03-01T23:10:00+00:00', 'feat: start'),
  commit('2024-03-02T23:40:00+00:00', 'fix: bug', [{ path: 'README.md', added: 10, removed: 2 }]),
  commit('2024-03-03T23:05:00+00:00', 'fix: more fix'),
  commit('2024-03-08T01:00:00+00:00', 'refactor: big one, thanks carol@example.org', [{ path: 'src/a|b*c_d.js', added: 40, removed: 5 }], 'Bob', 'bob@example.com'),
  // A name that is itself an address: shown cut to its local part.
  commit('2024-03-09T10:00:00+00:00', 'docs: tweak', [{ path: 'README.md', added: 1, removed: 1 }], 'cem@example.net', 'cem@example.net'),
];

/** The cells of a Markdown table row, split on unescaped pipes. */
function cells(row) {
  // A "|" is a cell border unless an odd number of backslashes precedes it ("\\|" is an
  // escaped backslash followed by a border).
  const out = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\') {
      cur += row[i] + (row[i + 1] ?? '');
      i++;
    } else if (row[i] === '|') {
      out.push(cur.trim());
      cur = '';
    } else cur += row[i];
  }
  return out.slice(1);
}

const WJ = '\u2060';

let fx;
const outs = [];
const tmpOut = () => {
  const o = mkdtempSync(join(tmpdir(), 'gw-md-out-'));
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

describe('parseCli --md', () => {
  test('md is only present when given, and documented', () => {
    assert.equal(parseCli(['--md']).md, true);
    assert.equal('md' in parseCli([]), false);
    assert.match(HELP_TEXT, /--md/);
    assert.match(HELP_TEXT, /wrapped\.md/);
  });
});

describe('escapeMarkdown', () => {
  test('escapes inline syntax, pipes and @, flattens lines, breaks links', () => {
    assert.equal(escapeMarkdown('a|b'), 'a\\|b');
    assert.equal(escapeMarkdown('*x* _y_ `z` [l](u) <b> #1 ~s~ & !'), '\\*x\\* \\_y\\_ \\`z\\` \\[l\\]\\(u\\) \\<b\\> \\#' + WJ + '1 \\~s\\~ \\& \\!');
    assert.equal(escapeMarkdown('one\ntwo\r\n\tthree'), 'one two three');
    assert.equal(escapeMarkdown('a\u202eb\x1b[31m'), 'a b [31m'.replace('[', '\\['));
    assert.equal(escapeMarkdown('see https://x.io and www.y.io'), 'see https\\://x.io and www\\.y.io');
    assert.equal(escapeMarkdown('back\\slash'), 'back\\\\slash');
    assert.equal(escapeMarkdown(null), '');
    assert.equal([...escapeMarkdown('x'.repeat(500), 10)].length, 10);
  });
});

describe('escapeMarkdown: emails, mentions, references', () => {
  test('every address is cut, dotless domains too; only the file-name part of a path', () => {
    assert.equal(escapeMarkdown('mail ada@example.com now'), 'mail … now');
    assert.equal(escapeMarkdown('ada@localhost and root@buildbox'), '… and …');
    assert.equal(escapeMarkdown('keys/ada@example.com.pub'), 'keys/…');
    assert.equal(escapeMarkdown('<dev@corp.io>'), '\\<…\\>');
  });

  test('a word joiner after @ and # stops GitHub mentions and issue links', () => {
    const out = escapeMarkdown('thanks @octocat, fixes #12');
    assert.equal(out, `thanks \\@${WJ}octocat, fixes \\#${WJ}12`);
    assert.doesNotMatch(out, /@[a-z]/i);
    assert.doesNotMatch(out, /#\d/);
  });

  test('a backslash right before a pipe stays one cell', () => {
    assert.equal(escapeMarkdown('a\\|b'), 'a\\\\\\|b');
    assert.deepEqual(cells(`| ${escapeMarkdown('a\\|b')} | 2 |`), ['a\\\\\\|b', '2']);
  });
});

describe('buildMarkdown', () => {
  const stats = computeStats(sampleCommits(), { today: TODAY });
  const cards = [{ id: 'intro', file: 'cards/01-intro.svg' }, { id: 'outro', file: 'cards/02-outro.svg' }];

  test('English: every section, numbers that agree with the recap', () => {
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, cards });
    assert.ok(md.endsWith('\n'));
    assert.match(md, /^# demo Wrapped\n/);
    assert.match(md, /_Mar 1 – Mar 9, 2024_/);
    for (const h of ['In numbers', 'When you commit', 'Streaks', 'Hot files', 'Languages', 'The team', 'Your commit personality', 'Story cards']) {
      assert.match(md, new RegExp(`^## ${h}$`, 'm'), h);
    }
    assert.match(md, /^## Biggest commit · Mar 8, 2024$/m);
    assert.match(md, /^- \*\*Commits:\*\* 5$/m);
    assert.match(md, /^- \*\*Active days:\*\* 5$/m);
    assert.match(md, /^- \*\*Lines:\*\* \+57 \/ −10$/m);
    assert.match(md, /^- \*\*Files touched:\*\* 3$/m);
    assert.match(md, /^- \*\*Power hour:\*\* 11 PM \(3 commits\)$/m);
    assert.match(md, /^- \*\*Busiest weekday:\*\* Friday \(2 commits, tied\)$/m);
    assert.match(md, /^- \*\*Longest streak:\*\* 3 days \(Mar 1 – Mar 3, 2024\)$/m);
    // No streak is running on TODAY (last commit Mar 9): no current-streak line, as in the recap.
    assert.doesNotMatch(md, /Current streak/);
    assert.match(md, /^- \*\*Longest break:\*\* 4 days \(Mar 3, 2024 – Mar 8, 2024\)$/m);
    // The recap says the same.
    const recap = formatSummary(stats, { today: TODAY });
    assert.match(recap, /longest 3 days\n/);
    assert.match(recap, /longest 4 days/);
    assert.match(md, /^\*\*Night Owl\*\* — Your best ideas arrive after midnight\. So do your worst ones\.$/m);
    assert.match(md, /^!\[Intro\]\(cards\/01-intro\.svg\)$/m);
    assert.match(md, /^!\[That's a wrap\]\(cards\/02-outro\.svg\)$/m);
    assert.match(md, /_Made with gitwrapped\._\n$/);
  });

  test('tables: hot files (top 5) and languages keep their columns despite | in a path', () => {
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY });
    const hotRows = md.split('## Hot files')[1].split('##')[0].split('\n').filter((l) => l.startsWith('|'));
    assert.ok(hotRows.length >= 4);
    for (const row of hotRows) assert.equal(cells(row).length, 4, row);
    assert.ok(md.includes('| src/a\\|b\\*c\\_d.js | 1 | +40 / −5 |'), md);
    assert.ok(md.includes('| JavaScript |'));
    const many = computeStats(Array.from({ length: 8 }, (_, i) => commit(`2024-03-0${i + 1}T10:00:00Z`, `c${i}`, [{ path: `f${i}.js`, added: 1, removed: 0 }])), { today: TODAY });
    const m2 = buildMarkdown(many, { today: TODAY });
    const section = m2.split('## Hot files')[1].split('##')[0];
    assert.equal(section.split('\n').filter((l) => /^\| \d/.test(l)).length, 5);
  });

  test('never contains an email address: contributors by name, --author by its local part, subjects scrubbed', () => {
    const team = computeStats(sampleCommits(), { today: TODAY, author: 'ada@example.com', team: sampleCommits() });
    for (const lang of ['en', 'tr']) {
      const md = buildMarkdown(team, { repoName: 'demo', today: TODAY, author: 'ada@example.com', lang });
      assert.ok(!md.includes('@'), `${lang}: '@' in\n${md}`);
      assert.doesNotMatch(md, /example\.(com|org|net)/);
      assert.match(md, lang === 'en' ? /Starring ada\./ : /Başrolde/);
      assert.match(md, lang === 'en' ? /Ada \\\(you\\\)/ : /Ada \\\(sen\\\)/);
      assert.match(md, /\| Bob \|/);
      assert.match(md, /\| cem \|/);
      assert.match(md, /thanks …/);
    }
  });

  test('emails in a hot-file path or the repo name do not leak; mentions in subjects are defused', () => {
    const s = computeStats([
      commit('2024-03-01T10:00:00Z', 'add key', [{ path: 'keys/ada@example.com.pub', added: 50, removed: 0 }]),
      commit('2024-03-02T10:00:00Z', 'b', [{ path: 'odd\\|name.js', added: 1, removed: 0 }]),
    ], { today: TODAY });
    const md = buildMarkdown(s, { repoName: 'me@corp.io', today: TODAY });
    assert.ok(!md.includes('@'), md);
    assert.match(md, /^# … Wrapped$/m);
    assert.ok(md.includes('| keys/… |'), md);
    // The repo name of a multi-repo row too.
    const multi = buildMarkdown({ ...s, repos: [{ name: 'root@buildbox', commits: 1 }, { name: 'web', commits: 1 }] }, { today: TODAY });
    assert.ok(!multi.includes('root'), multi);
    // Subject: @ / # kept but joined, so GitHub neither pings nor links.
    const big = buildMarkdown(computeStats([commit('2024-03-01T10:00:00Z', 'thanks @octocat, fixes #12', [{ path: 'a.js', added: 9, removed: 0 }])], { today: TODAY }), { today: TODAY });
    assert.ok(big.includes(`thanks \\@${WJ}octocat, fixes \\#${WJ}12`), big);
    // A path ending in a backslash before "|" keeps the hot-files table at 4 columns.
    const row = md.split('\n').find((l) => l.includes('odd'));
    assert.equal(cells(row).length, 4, row);
  });

  test('the languages table has exactly the languages card bars (top 5 + headline + Other, 99% cap)', () => {
    const files = [
      ['a.md', 400], ['b.json', 300], ['c.yaml', 200], ['d.txt', 150], ['e.csv', 120], ['f.toml', 110], ['f2.xml', 100], ['g.js', 5], ['h.unknownext', 30],
    ].map(([path, added]) => ({ path, added, removed: 0 }));
    for (const lang of ['en', 'tr']) {
      for (const st of [computeStats([commit('2024-03-01T10:00:00Z', 'x', files)], { today: TODAY }), stats]) {
        const md = buildMarkdown(st, { today: TODAY, lang });
        const L = lang === 'en' ? en : tr;
        const table = md.split(`## ${L.markdown.languages}\n\n`)[1].split('\n\n')[0].split('\n').slice(2).map(cells);
        const bars = buildCardSpecs(st, { today: TODAY, lang }).find((c) => c.id === 'languages').spec.chart.items;
        assert.deepEqual(table.map((r) => [r[0].replace(/\\/g, ''), r[1].replace(/\\/g, ''), r[2]]), bars.map((b) => [b.label, b.value, L.num(b.amount)]), md);
      }
    }
    const md = buildMarkdown(computeStats([commit('2024-03-01T10:00:00Z', 'x', files)], { today: TODAY }), { today: TODAY });
    // JavaScript is the headline language (the only programming one) despite its size.
    assert.match(md, /^\| JavaScript \| \\<1% \| 5 \|$/m);
    assert.match(md, /^\| Other \|/m);
    assert.doesNotMatch(md, /100%/);
  });

  test('Turkish: headings, labels and number format from tr.js', () => {
    const md = buildMarkdown(stats, { repoName: 'demo', today: TODAY, lang: 'tr', cards });
    for (const h of [tr.markdown.numbers, tr.markdown.habits, tr.markdown.streaks, tr.markdown.hotFiles, tr.markdown.languages, tr.contributors.eyebrow, tr.personality.eyebrow, tr.markdown.cards]) {
      assert.ok(md.includes(`\n## ${h}\n`), h);
    }
    for (const h of [en.markdown.numbers, en.markdown.streaks, en.markdown.cards, 'Power hour', 'Longest streak']) assert.ok(!md.includes(h), `English "${h}" in Turkish`);
    assert.match(md, /_1 Mar – 9 Mar 2024_/);
    assert.match(md, /^- \*\*Altın saat:\*\* 23:00 /m);
    assert.match(md, /%\d+/);
    assert.match(md, /!\[Giriş\]\(cards\/01-intro\.svg\)/);
    const big = computeStats([commit('2024-03-01T10:00:00Z', 'x', [{ path: 'a.js', added: 1500, removed: 0 }])], { today: TODAY });
    assert.match(buildMarkdown(big, { lang: 'tr', today: TODAY }), /\+1\.500 \/ 0/);
  });

  test('a past window labels the streak at window end; the window replaces the day range', () => {
    const ended = computeStats(sampleCommits(), { today: '2024-03-09', todayComplete: true });
    const md = buildMarkdown(ended, { repoName: 'demo', today: TODAY, window: '2024', streakAtWindowEnd: true });
    assert.match(md, /^_2024_$/m);
    assert.match(md, /^- \*\*Streak at window end:\*\* 2 days$/m);
  });

  test('no commits: title and a short note, no stat sections', () => {
    const md = buildMarkdown(computeStats([], { today: TODAY }), { repoName: 'empty', today: TODAY, cards });
    assert.match(md, /^# empty Wrapped\n\nNo commits found/);
    for (const h of ['In numbers', 'Streaks', 'Hot files', 'Languages']) assert.ok(!md.includes(`## ${h}`), h);
    assert.match(md, /## Story cards/);
  });

  test('optional sections: year over year and several repos', () => {
    const yoy = { ...stats, yearOverYear: { year: 2024, previousYear: 2023, commits: { current: 5, previous: 2, delta: 3 }, lines: { current: 68, previous: 70, delta: -2 }, activeDays: { current: 5, previous: 5, delta: 0 }, previousTruncated: false } };
    assert.match(buildMarkdown(yoy, { today: TODAY }), /^- \*\*vs 2023:\*\* \+3 commits, −2 lines, ±0 active days$/m);
    const multi = { ...stats, repos: [{ name: 'api', commits: 3, linesAdded: 10, linesRemoved: 2 }, { name: 'web|ui', commits: 2, linesAdded: 1, linesRemoved: 0 }] };
    const md = buildMarkdown(multi, { repoName: 'ignored', today: TODAY });
    assert.match(md, /^# 2 repos Wrapped$/m);
    assert.match(md, /^## Repos$/m);
    assert.match(md, /^\| web\\\|ui \| 2 \| \+1 \/ 0 \|$/m);
  });

  test('card links: only plain relative paths are linked', () => {
    const md = buildMarkdown(stats, { today: TODAY, cards: [{ id: 'intro', file: 'cards/01-intro.svg' }, { id: 'x', file: 'javascript:alert(1)' }, { id: 'y', file: 'a b.svg' }] });
    assert.equal((md.match(/!\[/g) ?? []).length, 1);
  });
});

describe('generate / run with --md', () => {
  test('writes wrapped.md linking exactly the card SVGs written', async () => {
    const out = tmpOut();
    const r = await generate({ path: fx.dir, out, png: false, md: true }, { today: TODAY });
    assert.equal(r.markdown, join(out, 'wrapped.md'));
    const md = readFileSync(r.markdown, 'utf8');
    const links = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    assert.deepEqual(links, r.cardFiles.map((f) => relative(out, f).split('\\').join('/')));
    for (const l of links) assert.ok(existsSync(join(out, l)), l);
    assert.ok(!md.includes('@'), 'no email');
    assert.ok(!md.includes(out) && !md.includes(fx.dir), 'no machine paths');
    // Deterministic.
    const again = await generate({ path: fx.dir, out: tmpOut(), png: false, md: true }, { today: TODAY });
    assert.equal(readFileSync(again.markdown, 'utf8'), md);
  });

  test('without md the result has markdown null and nothing is written', async () => {
    const out = tmpOut();
    const r = await generate({ path: fx.dir, out, png: false }, { today: TODAY });
    assert.equal(r.markdown, null);
    assert.equal(existsSync(join(out, 'wrapped.md')), false);
  });

  test('run --md --lang tr --author: Turkish file, path in the recap, no email', async () => {
    const out = tmpOut();
    const stdout = sink();
    const code = await run([fx.dir, '--md', '--lang', 'tr', '--author', 'ada@example.com', '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(code, 0);
    assert.match(stdout.data, /Markdown özeti: .*wrapped\.md/);
    const md = readFileSync(join(out, 'wrapped.md'), 'utf8');
    assert.match(md, /## Rakamlarla/);
    assert.ok(!md.includes('@'));
  });

  test('without --md a stale wrapped.md is left alone and not mentioned', async () => {
    const out = tmpOut();
    await run([fx.dir, '--md', '--no-png', '--out', out], { stdout: sink(), stderr: sink(), env: {}, today: TODAY });
    const before = readFileSync(join(out, 'wrapped.md'), 'utf8');
    const stdout = sink();
    await run([fx.dir, '--no-png', '--out', out], { stdout, stderr: sink(), env: {}, today: TODAY });
    assert.equal(readFileSync(join(out, 'wrapped.md'), 'utf8'), before);
    assert.doesNotMatch(stdout.data, /wrapped\.md|Markdown summary/);
  });

  test('a directory in the way of wrapped.md fails before anything is written', async () => {
    const out = tmpOut();
    mkdirSync(join(out, 'wrapped.md'));
    const stderr = sink();
    const code = await run([fx.dir, '--md', '--no-png', '--out', out], { stdout: sink(), stderr, env: {}, today: TODAY });
    assert.equal(code, 1);
    assert.match(stderr.data, /wrapped\.md: a directory is in the way/);
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });

  test('a symlink at wrapped.md is refused (and its target untouched)', async (t) => {
    const out = tmpOut();
    const target = join(tmpOut(), 'elsewhere.md');
    writeFileSync(target, 'keep');
    try {
      symlinkSync(target, join(out, 'wrapped.md'));
    } catch (err) {
      t.skip(`cannot create symlinks here (${err.code})`);
      return;
    }
    const stderr = sink();
    const code = await run([fx.dir, '--md', '--no-png', '--out', out], { stdout: sink(), stderr, env: {}, today: TODAY });
    assert.equal(code, 1);
    assert.match(stderr.data, /refusing to write through a symlink: .*wrapped\.md/);
    assert.equal(readFileSync(target, 'utf8'), 'keep');
    assert.equal(existsSync(join(out, 'wrapped.html')), false);
  });
});
