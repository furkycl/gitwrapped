// The pre-1.15.0 audit: (1) the Turkish one-touch row's long form ("Tek commit'lik dosyalar"
// next to "42 dosya · %31") never fit a card row, so the Turkish card always fell back to
// the short value; the card label is now "Tek commit'lik" and the long value is drawn;
// (2) `git revert --reference` (git 2.41+) writes "This reverts commit <hash> (<subject>,
// <YYYY-MM-DD>)." and that boilerplate counted as a message body; (3) the CHANGELOG cited
// "42 kodlama oturumu  en uzun 3 sa 10 dk" as the Turkish streak-card row, which never
// fits (it is drawn as "42 oturum  en uzun 3 sa 10 dk"). The unit-level pins for the
// features live in one-touch*.test.js, message-bodies*.test.js and sessions*.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStats, hasMessageBody } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { rowFits } from '../src/cards/svg.js';
import { readHistory } from '../src/git.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = { en, tr };
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, files, extra = {}) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: files.map(([path, added = 1, removed = 0]) => ({ path, added, removed })),
  parents: ['p'],
  ...extra,
});
const cardOpts = (lang) => ({ repoName: 'demo', today: TODAY, lang });
const specOf = (stats, id, lang) => buildCardSpecs(stats, cardOpts(lang)).find((c) => c.id === id).spec;
const svgOf = (stats, id, lang) => buildCards(stats, cardOpts(lang)).find((c) => c.id === id).svg;

describe('one-touch row: the long form is drawn in Turkish too', () => {
  // Two files, one touched once: the hot-files card has room for the row.
  const s = computeStats([commit(1, [['src/a.js', 10, 1]]), commit(2, [['src/a.js', 5, 1], ['src/b.js', 3, 0]])], { today: TODAY });

  test('tr: "Tek commit\'lik" and "1 dosya · %50" on the card and in the SVG', () => {
    const row = specOf(s, 'hot-files', 'tr').lines.at(-1);
    assert.equal(row.label, "Tek commit'lik");
    assert.equal(row.value, '1 dosya · %50');
    const svg = svgOf(s, 'hot-files', 'tr');
    assert.ok(svg.includes('1 dosya · %50'), 'long value drawn');
  });

  test('en is unchanged: "One-touch files" and "1 file · 50%"', () => {
    const row = specOf(s, 'hot-files', 'en').lines.at(-1);
    assert.deepEqual([row.label, row.value], ['One-touch files', '1 file · 50%']);
  });

  test('the first (long) form fits a card row for a spread of counts and shares, in both languages', () => {
    for (const [code, L] of Object.entries(LANGS)) {
      const H2 = L.hotFiles;
      for (const files of [1, 7, 42, 999, 1234]) {
        for (const pct of ['<1%', '5%', '31%', '99%', '100%']) {
          const p = code === 'tr' ? `%${pct.replace('%', '')}` : pct;
          assert.ok(rowFits({ label: H2.oneTouch, value: H2.oneTouchValue(files, p) }), `${code} ${files} ${p}`);
        }
      }
    }
  });
});

describe('message bodies: git revert --reference boilerplate is not a body', () => {
  test('the --reference forms (plain and merge, wrapped as git wraps them) are boilerplate', () => {
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n'), false);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: a (b), c., 2026-10-09), reversing\nchanges made to 1234567 (Merge branch \'x\', 2026-01-01).\n'), false);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n\nSigned-off-by: A <a@x.io>\n'), false);
  });

  test('an explanation still counts, and a parenthetical that is not a reference is prose', () => {
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n\nIt broke the build.\n'), true);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (because it broke prod).\n'), true);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09). It broke prod.\n'), true);
  });

  describe('real git', () => {
    let dir;
    let supported = false;
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-03-02T10:00:00Z', GIT_COMMITTER_DATE: '2026-03-02T10:00:00Z' },
    });
    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'gw-audit-115-'));
      git('init', '-q');
      git('config', 'user.name', 'Ada');
      git('config', 'user.email', 'ada@example.com');
      git('config', 'commit.gpgsign', 'false');
      writeFileSync(join(dir, 'f.txt'), 'a\n');
      writeFileSync(join(dir, 'g.txt'), 'a\n');
      git('add', '.');
      git('commit', '-q', '-m', 'feat: add f and g');
      writeFileSync(join(dir, 'f.txt'), 'a\nb\n');
      git('commit', '-q', '-am', 'fix: tweak f');
      writeFileSync(join(dir, 'g.txt'), 'a\nb\n');
      git('commit', '-q', '-am', 'fix: tweak g');
      try {
        // --reference is git 2.41+: once as git writes it, once with the subject edited
        // (as git asks for) and the boilerplate body kept.
        git('revert', '--reference', '--no-edit', 'HEAD');
        git('revert', '--reference', '--no-commit', 'HEAD~2');
        const tweak = git('rev-parse', '--short', 'HEAD~2').trim();
        git('commit', '-q', '-m', 'revert the f tweak', '-m', `This reverts commit ${tweak} (fix: tweak f, 2026-03-02).`);
        supported = true;
      } catch {
        supported = false;
      }
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    test('git revert --reference commits have no body; stats.messages.bodies is 0', async (t) => {
      if (!supported) return t.skip('git revert --reference needs git 2.41+');
      const body = git('log', '-1', '--format=%b');
      assert.match(body, /^This reverts commit [0-9a-f]{7,} \(.+, \d{4}-\d{2}-\d{2}\)\.\s*$/);
      const { commits } = await readHistory(dir, {});
      assert.equal(commits.length, 5);
      assert.deepEqual(commits.map((c) => c.hasBody), [false, false, false, false, false]);
      assert.deepEqual({ ...computeStats(commits, { today: TODAY }).messages.bodies }, { commits: 0, share: 0 });
    });
  });
});

describe('docs: the Turkish rows quoted are the ones drawn', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
  const README = read('README.md');
  const CHANGELOG = read('CHANGELOG.md');
  const unreleased = /^## \[Unreleased\][^\n]*$([\s\S]*?)(?=^## \[)/m.exec(CHANGELOG)?.[1] ?? '';
  const flat = (s) => s.replace(/\s+/g, ' ');

  test('sessions: 42 sessions, longest 3h 10m is drawn as "42 oturum  en uzun 3 sa 10 dk" in Turkish', () => {
    const S = tr.streak;
    assert.equal(rowFits({ label: S.sessionsRowLabel(42), value: S.sessionsRowValue(42, 190) }), false);
    assert.equal(rowFits({ label: S.sessionsRowShort(42), value: S.sessionsRowValue(42, 190) }), true);
    assert.ok(rowFits({ label: en.streak.sessionsRowLabel(42), value: en.streak.sessionsRowValue(42, 190) }));
    assert.ok(flat(unreleased).includes('"42 oturum en uzun 3 sa 10 dk"'));
    assert.ok(!flat(unreleased).includes('"42 kodlama oturumu en uzun 3 sa 10 dk"'));
    assert.ok(!flat(README).includes('"42 kodlama oturumu en uzun 3 sa 10 dk"'));
  });

  test('one-touch: the README and the CHANGELOG quote the Turkish card row as drawn', () => {
    const row = `"${tr.hotFiles.oneTouch}  ${tr.hotFiles.oneTouchValue(42, '%31')}"`;
    assert.ok(README.includes(row), row);
    assert.ok(flat(unreleased).includes(flat(row)), row);
  });

  test('message bodies: the README and the CHANGELOG mention the --reference revert form', () => {
    assert.ok(flat(README).includes('`git revert --reference`'));
    assert.ok(unreleased.includes('`--reference`'));
  });
});

describe('audit 1.15, edge cases', () => {
  // `total` files, the first `once` of them changed by one commit, the rest by two.
  const spread = (total, once) => {
    const cs = [];
    let i = 0;
    for (let f = 0; f < total; f++) {
      for (let k = 0; k < (f < once ? 1 : 2); k++) cs.push(commit(++i, [[`src/f${f}.js`, 1, 0]]));
    }
    return computeStats(cs, { today: TODAY });
  };
  const CASES = [
    [300, 1, '1 dosya · <%1', '1 file · <1%'],
    [200, 1, '1 dosya · %1', '1 file · 1%'],
    [3, 2, '2 dosya · %67', '2 files · 67%'],
    [100, 31, '31 dosya · %31', '31 files · 31%'],
    [100, 99, '99 dosya · %99', '99 files · 99%'],
    [10, 10, '10 dosya · %100', '10 files · 100%'],
    [1500, 1234, '1.234 dosya · %82', '1,234 files · 82%'],
  ];

  test('one-touch: the Turkish card draws the long value across shares and counts; English unchanged', () => {
    for (const [total, once, trValue, enValue] of CASES) {
      const s = spread(total, once);
      const trRow = specOf(s, 'hot-files', 'tr').lines.at(-1);
      assert.deepEqual([trRow.label, trRow.value], ["Tek commit'lik", trValue], `tr ${total}/${once}`);
      const enRow = specOf(s, 'hot-files', 'en').lines.at(-1);
      assert.deepEqual([enRow.label, enRow.value], ['One-touch files', enValue], `en ${total}/${once}`);
    }
  });

  test('one-touch: the Turkish label is one form; the English long label is untouched', () => {
    assert.equal(tr.hotFiles.oneTouch, tr.hotFiles.oneTouchLabelShort);
    assert.equal(en.hotFiles.oneTouch, 'One-touch files');
    assert.notEqual(en.hotFiles.oneTouch, en.hotFiles.oneTouchLabelShort);
  });

  test('revert --reference: subjects with commas, parentheses, colons, quotes and dates are boilerplate', () => {
    for (const subject of [
      'fix: a, b, and c',
      'fix(cli): handle (nested (parens))',
      'Revert "feat: x (y, z)"',
      'chore: bump to 1.2.3, see 2026-01-01',
      'fix: trailing comma,',
      '',
    ]) {
      assert.equal(hasMessageBody(`This reverts commit d1acf63 (${subject}, 2026-10-09).\n`), false, subject);
    }
  });

  test('revert --reference: long hashes, mixed case and git-style wrapping', () => {
    assert.equal(hasMessageBody(`This reverts commit ${'a'.repeat(40)} (fix: tweak, 2026-10-09).\n`), false);
    assert.equal(hasMessageBody('this reverts commit d1acf63 (fix: tweak, 2026-10-09).\n'), false);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: a rather long subject that git\nwraps, 2026-10-09).\n'), false);
    assert.equal(hasMessageBody('This reverts\n  commit d1acf63 (fix: tweak,\n2026-10-09).\n'), false);
  });

  test('revert --reference merge form: either side or both with a reference', () => {
    const ref = (h) => `${h} (feat: x, y, 2026-01-02)`;
    assert.equal(hasMessageBody(`This reverts commit ${ref('d1acf63')}, reversing changes made to ${ref('1234567')}.\n`), false);
    assert.equal(hasMessageBody(`This reverts commit ${ref('d1acf63')}, reversing changes made to 1234567.\n`), false);
    assert.equal(hasMessageBody(`This reverts commit d1acf63, reversing changes made to ${ref('1234567')}.\n`), false);
    // The plain forms are still boilerplate.
    assert.equal(hasMessageBody('This reverts commit d1acf63.\n'), false);
    assert.equal(hasMessageBody('This reverts commit d1acf63, reversing changes made to 1234567.\n'), false);
  });

  test('revert --reference with other boilerplate paragraphs (trailers, cherry-pick note) is still no body', () => {
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n\n(cherry picked from commit 1234567)\n'), false);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n\nCo-authored-by: B <b@x.io>\nSigned-off-by: A <a@x.io>\n'), false);
  });

  test('lookalikes that are not git\'s reference stay prose', () => {
    for (const body of [
      'This reverts commit d1acf63 (fix: tweak).',                 // no date
      'This reverts commit d1acf63 (fix: tweak 2026-10-09).',      // no comma before the date
      'This reverts commit d1acf63 (fix: tweak, 2026-10).',        // not a short date
      'This reverts commit d1acf63 (fix: tweak, 9 Oct 2026).',     // not a short date
      'This reverts commit d1acf63 (fix: tweak, 2026-10-09)',      // no full stop
      'This reverts commit d1acf63(fix: tweak, 2026-10-09).',      // no space before the parenthesis
      'This reverts commit d1acf63 (fix: tweak, 2026-10-09) because it broke prod.',
      'Partly: this reverts commit d1acf63 (fix: tweak, 2026-10-09).',
      'This reverts commit d1acf63 (fix: tweak, 2026-10-09), reversing changes made to main.',
      'This reverts commits d1acf63 (fix: tweak, 2026-10-09) and 1234567 (fix: b, 2026-10-09).',
      'This reverts commit (fix: tweak, 2026-10-09).',             // no hash
    ]) {
      assert.equal(hasMessageBody(`${body}\n`), true, body);
    }
  });

  test('prose before or after the --reference boilerplate counts, in the same or another paragraph', () => {
    assert.equal(hasMessageBody('It broke the build.\n\nThis reverts commit d1acf63 (fix: tweak, 2026-10-09).\n'), true);
    assert.equal(hasMessageBody('It broke the build.\nThis reverts commit d1acf63 (fix: tweak, 2026-10-09).\n'), true);
    assert.equal(hasMessageBody('This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n\nSigned-off-by: A <a@x.io>\n\nWe will redo it next week.\n'), true);
  });

  test('stats: --reference reverts with and without an explanation are counted apart', () => {
    const ref = 'This reverts commit d1acf63 (fix: tweak, 2026-10-09).\n';
    const cs = [
      commit(1, [['a.js']], { subject: 'Revert "fix: tweak"', hasBody: hasMessageBody(ref) }),
      commit(2, [['a.js']], { subject: 'Revert "fix: tweak"', hasBody: hasMessageBody(`${ref}\nIt broke prod.\n`) }),
    ];
    assert.deepEqual(cs.map((c) => c.hasBody), [false, true]);
    assert.equal(computeStats(cs, { today: TODAY }).messages.bodies.commits, 1);
  });
});

describe('audit 1.15, revert boilerplate stays linear', () => {
  test('a crafted 1 MB revert-like body is classified fast (prose) and real --reference bodies still are boilerplate', () => {
    const evil = 'This reverts commit abcdef0 (' + ', 2020-01-01), reversing changes made to abcdef0 ('.repeat(20000) + 'x';
    const t0 = process.hrtime.bigint();
    assert.equal(hasMessageBody(evil), true);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 500, `took ${ms} ms`);
    const long = 'x'.repeat(900);
    assert.equal(hasMessageBody(`This reverts commit abcdef0 (${long}, 2026-10-09), reversing changes made to 1234567 (${long}, 2026-10-01).`), false);
  });
});
