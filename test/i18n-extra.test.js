// --lang tr|en, extra coverage: Turkish casing and number formatting as they come out of
// the rendered cards / share image / recap, every archetype translated and rendered, the
// viewer CSP hashes checked independently against the page's own inline script and style,
// no English UI words in the Turkish share image, the index helpers, and the CLI flag
// spellings (TR, =tr, missing value) end to end.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatNumberFor, getStrings, pluralFor, upperFor } from '../src/i18n/index.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { buildCards, renderShareCard } from '../src/cards/index.js';
import { escapeXml } from '../src/cards/svg.js';
import { ARCHETYPES } from '../src/stats/personality.js';
import { computeStats } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { buildViewerHtml } from '../src/viewer.js';
import { parseCli, run } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));

function commit(date, subject, files = [{ path: 'src/app.js', added: 3, removed: 1 }], author = 'A', email = 'a@x') {
  return {
    hash: `${date}-${subject}-${Math.random()}`, author, email, date, subject, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

const sampleStats = () => computeStats([
  commit('2026-10-01T23:10:00+03:00', 'feat: start'),
  commit('2026-10-02T23:40:00+03:00', 'fix: bug', [{ path: 'README.md', added: 10, removed: 2 }]),
  commit('2026-10-03T23:05:00+03:00', 'fix: more fix'),
  commit('2026-10-04T01:00:00+03:00', 'oops: tidy', [{ path: 'test/a/b/c.test.js', added: 40, removed: 0 }], 'Bob', 'b@x'),
], { today: TODAY });

/** 1,500 commits over 400 days (some days twice), with big line counts. */
function bigStats() {
  const commits = [];
  const start = Date.UTC(2025, 8, 1);
  for (let i = 0; i < 1500; i++) {
    const day = new Date(start + (i % 400) * 86_400_000).toISOString().slice(0, 10);
    const hour = String(10 + (i % 8)).padStart(2, '0');
    commits.push(commit(`${day}T${hour}:${String(i % 60).padStart(2, '0')}:00Z`, `feat: thing ${i}`, [{ path: `src/f${i % 1234}.js`, added: 1234, removed: 567 }]));
  }
  return computeStats(commits, { today: '2026-10-05' });
}

const textOf = (svg) => [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1]).join('\n');

describe('Turkish casing in rendered output', () => {
  test('every Turkish eyebrow is upper-cased with Turkish rules on its card', () => {
    const cards = buildCards(sampleStats(), { repoName: 'demo', today: TODAY, lang: 'tr', author: 'a@x' });
    const all = cards.map((c) => c.svg).join('\n');
    for (const s of [tr.intro.eyebrow, tr.totals.eyebrow, tr.peak.eyebrow, tr.streak.eyebrow, tr.activity.calendar, tr.hotFiles.eyebrow, tr.languages.eyebrow, tr.messages.eyebrow, tr.personality.eyebrow, tr.contributors.eyebrow, tr.outro.eyebrow]) {
      const up = tr.upper(s);
      assert.ok(all.includes(escapeXml(up)), `missing eyebrow ${up}`);
      // Every lower-case i in the source (outside the brand words) became İ.
      if (/i/.test(s.replace(/\bgit(?:wrapped)?\b/gi, ''))) assert.match(up, /İ/, up);
    }
  });

  test('no ASCII-I upper-casing of Turkish words in Turkish cards or share image', () => {
    const s = sampleStats();
    const cards = buildCards(s, { repoName: 'demo', today: TODAY, lang: 'tr', author: 'a@x' });
    const share = renderShareCard(s, { repoName: 'demo', today: TODAY, lang: 'tr' });
    const text = textOf(cards.map((c) => c.svg).join('\n') + share);
    // English-rule casing of Turkish i-words would show up as these.
    for (const wrong of ['KIŞILIĞIN', 'SAATIN', 'SERIN', 'TAKVIMIN', 'DILLERIN', 'EKIP', 'KIŞILIK', 'İYI SERI']) {
      assert.ok(!text.includes(wrong), `English-rule casing left: ${wrong}`);
    }
    // The loanword "commit" keeps a plain I (COMMIT, COMMIT'LERİN), never COMMİT.
    assert.ok(text.includes('COMMIT'));
    assert.ok(!text.includes('COMMİT'), 'COMMİT');
    // ...while the brand keeps a plain I.
    assert.ok(text.includes('GITWRAPPED SUNAR'));
    assert.ok(!text.includes('GİTWRAPPED'));
  });

  test('upper: dotless ı → I, dotted i → İ, mixed case and non-strings', () => {
    assert.equal(tr.upper('ılık iğne'), 'ILIK İĞNE');
    assert.equal(tr.upper('Istanbul'), 'ISTANBUL'); // an upper I stays I
    assert.equal(tr.upper('git’i GitHub'), 'GIT’İ GİTHUB'); // only the bare brand word is exempt
    assert.equal(tr.upper(42), '42');
    assert.equal(en.upper('ılık iğne'), 'ILIK IĞNE');
    assert.equal(upperFor('istanbul', 'tr'), 'İSTANBUL');
    assert.equal(upperFor('istanbul', 'xx'), 'ISTANBUL');
  });
});

describe('Turkish number formatting in rendered output', () => {
  let big;
  before(() => {
    big = bigStats();
  });

  test('cards group thousands with "." and never with ","', () => {
    const trCards = buildCards(big, { repoName: 'demo', today: TODAY, lang: 'tr' });
    const enCards = buildCards(big, { repoName: 'demo', today: TODAY });
    const trText = trCards.map((c) => textOf(c.svg) + '\n' + c.description).join('\n');
    const enText = enCards.map((c) => textOf(c.svg) + '\n' + c.description).join('\n');
    assert.ok(enText.includes('1,500'), 'English shows 1,500');
    assert.ok(trText.includes('1.500'), 'Turkish shows 1.500');
    assert.doesNotMatch(trText, /\d,\d{3}(?!\d)/, 'a comma thousands separator in Turkish');
  });

  test('decimals use "," in Turkish (average per active day, message length)', () => {
    const trCards = buildCards(big, { repoName: 'demo', today: TODAY, lang: 'tr' });
    const totals = trCards.find((c) => c.id === 'totals');
    // 1500 commits / 400 days = 3.75 → 3,8 (en: 3.8).
    assert.match(textOf(totals.svg) + totals.description, /Aktif gün başına 3,8 commit\./);
    const enTotals = buildCards(big, { repoName: 'demo', today: TODAY }).find((c) => c.id === 'totals');
    assert.match(textOf(enTotals.svg) + enTotals.description, /3\.8 commits per active day/);
  });

  test('share image and recap use Turkish grouping', () => {
    const share = textOf(renderShareCard(big, { repoName: 'demo', today: TODAY, lang: 'tr' }));
    assert.ok(share.includes('1.500'), share);
    assert.doesNotMatch(share, /\d,\d{3}(?!\d)/);
    const recap = formatSummary(big, { lang: 'tr', repoName: 'demo', today: TODAY });
    assert.match(recap, /^gitwrapped: 1\.500 commit/);
    assert.doesNotMatch(recap, /\d,\d{3}(?!\d)/);
    assert.match(formatSummary(big, { repoName: 'demo', today: TODAY }), /^gitwrapped: 1,500 commits/);
  });

  test('index helpers', () => {
    assert.equal(formatNumberFor(1234567, 'tr'), '1.234.567');
    assert.equal(formatNumberFor(1234567, 'en'), '1,234,567');
    assert.equal(formatNumberFor(1234567), '1,234,567');
    assert.equal(pluralFor(1, 'commit', 'en'), '1 commit');
    assert.equal(pluralFor(1500, 'commit', 'en'), '1,500 commits');
    assert.equal(pluralFor(1500, 'day', 'tr'), '1.500 gün');
    assert.equal(pluralFor(1, 'activeDay', 'tr'), '1 aktif gün');
    assert.equal(tr.dec(1999.96), '2.000');
    assert.equal(tr.dec(-0.04), '0');
    assert.equal(tr.dec(1e6 + 0.25), '1.000.000,3');
  });
});

describe('archetypes in Turkish', () => {
  test('every archetype id has a translated tr name, roast and reason', () => {
    for (const { id } of ARCHETYPES) {
      const a = tr.personality.archetypes[id];
      assert.ok(a, `tr has no archetype ${id}`);
      assert.ok(typeof a.name === 'string' && a.name.trim(), `${id}: empty name`);
      assert.ok(typeof a.roast === 'string' && a.roast.trim(), `${id}: empty roast`);
      assert.notEqual(a.name, en.personality.archetypes[id].name, `${id}: name not translated`);
      assert.notEqual(a.roast, en.personality.archetypes[id].roast, `${id}: roast not translated`);
      assert.equal(typeof tr.personality.reasons[id], 'function', `${id}: no reason`);
    }
  });

  test('every archetype renders its Turkish name and roast on the personality card', () => {
    const base = sampleStats();
    for (const { id } of ARCHETYPES) {
      const E = en.personality.archetypes[id];
      const stats = { ...base, personality: { archetype: { id, name: E.name, roast: E.roast, reason: 'r' }, scores: [] } };
      const card = buildCards(stats, { today: TODAY, lang: 'tr' }).find((c) => c.id === 'personality');
      const text = textOf(card.svg);
      const { name, roast } = tr.personality.archetypes[id];
      // Lines may wrap: every word must be there.
      for (const word of `${name} ${roast}`.split(/\s+/)) assert.ok(text.includes(escapeXml(word)), `${id}: missing "${word}"`);
      assert.ok(!text.includes(escapeXml(E.name)), `${id}: English name "${E.name}" on the Turkish card`);
      // And the share image carries the Turkish name too.
      const share = textOf(renderShareCard(stats, { today: TODAY, lang: 'tr' }));
      for (const word of name.split(/\s+/)) assert.ok(share.includes(escapeXml(word)), `${id}: share missing "${word}"`);
    }
  });
});

describe('viewer CSP (checked independently)', () => {
  for (const lang of ['tr', 'en']) {
    test(`${lang}: the CSP meta hashes exactly the page's inline script and style`, () => {
      const cards = buildCards(sampleStats(), { today: TODAY, lang });
      const html = buildViewerHtml(cards, { title: 'gitwrapped · demo', lang });
      const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
      assert.ok(meta, 'no CSP meta');
      const policy = Object.fromEntries(meta[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...vals] = d.split(/\s+/);
        return [name, vals];
      }));
      const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      assert.equal(scripts.length, 1, 'exactly one inline script');
      assert.ok(!/<script\b[^>]*\bsrc=/.test(html), 'no external script');
      assert.deepEqual(policy['script-src'], [sha(scripts[0][1])]);
      const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
      assert.equal(styles.length, 1, 'exactly one inline style');
      assert.deepEqual(policy['style-src'], [sha(styles[0][1])]);
      // No inline event handlers (they would need 'unsafe-inline').
      assert.doesNotMatch(html, /\son[a-z]+="/i);
      assert.doesNotThrow(() => new Function(scripts[0][1]));
    });
  }

  test('tr and en scripts differ (and so do their hashes); tr strings are JS-escaped', () => {
    const page = (lang) => buildViewerHtml(buildCards(sampleStats(), { today: TODAY, lang }), { title: 'x', lang });
    const script = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const a = script(page('tr'));
    const b = script(page('en'));
    assert.notEqual(a, b);
    // The apostrophe in "Paylaş'a" must not end the JS string literal.
    assert.ok(a.includes("Paylaş\\'a"));
    // Running the script's string table should yield the Turkish messages.
    assert.ok(a.includes(' kaydedildi'));
    assert.ok(!a.includes('Sharing failed'));
  });
});

describe('Turkish share image: no English UI words', () => {
  const variants = () => {
    const s = sampleStats();
    return [
      ['sample', s, {}],
      ['author', s, { author: 'a@x' }],
      ['year', s, { since: '2026-01-01', until: '2026-12-31' }],
      ['empty', computeStats([], { today: TODAY }), {}],
    ];
  };

  test('no en share/outro labels (raw or upper-cased) and no English archetype names', () => {
    const english = [
      en.outro.commits, en.outro.powerHour, en.outro.bestStreak, en.outro.personality, en.outro.hottestFile,
      en.outro.noneYet, en.outro.tbd, en.share.noHotFiles, en.share.eyebrow(null), en.share.eyebrow(2026), en.yourRepo,
      ...Object.values(en.personality.archetypes).map((a) => a.name),
    ];
    for (const [name, stats, opts] of variants()) {
      const svg = renderShareCard(stats, { today: TODAY, lang: 'tr', ...opts });
      const text = textOf(svg);
      for (const w of english) {
        for (const form of new Set([w, en.upper(w)])) {
          // "Commit" is shared vocabulary; the English plural "COMMITS" is not.
          if (form === 'Commits') continue;
          assert.ok(!text.includes(escapeXml(form)), `${name}: English "${form}" in Turkish share image`);
        }
      }
      assert.ok(!text.includes('COMMITS'), `${name}: COMMITS`);
      assert.doesNotMatch(text, /\b(AM|PM)\b/, `${name}: 12-hour clock`);
    }
  });

  test('empty repo share image is Turkish (fallbacks localized)', () => {
    const text = textOf(renderShareCard(computeStats([], { today: TODAY }), { today: TODAY, lang: 'tr' }));
    for (const want of [tr.empty, tr.yourRepo, tr.outro.tbd, tr.upper(tr.outro.personality), '0 gün']) assert.ok(text.includes(escapeXml(want)), `${want} in\n${text}`);
  });

  test('long Turkish archetype names step down in size instead of being cut', () => {
    const base = sampleStats();
    for (const { id } of ARCHETYPES) {
      const stats = { ...base, personality: { archetype: { id, name: 'x', roast: 'r', reason: 'r' }, scores: [] } };
      for (const lang of ['tr', 'en']) {
        const text = textOf(renderShareCard(stats, { today: TODAY, lang }));
        assert.ok(!text.includes('…'), `${lang} ${id}: text cut on the share image:\n${text}`);
      }
    }
    // English layout is unchanged: two-word names still wrap at 34px.
    const en34 = renderShareCard({ ...base, personality: { archetype: { id: 'weekend-warrior', name: 'Weekend Warrior', roast: 'r', reason: 'r' }, scores: [] } }, { today: TODAY });
    assert.match(en34, /font-size="34" font-weight="900">Weekend<\/text>/);
  });
});

describe('Turkish recap', () => {
  test('streak, team, top word and notes are Turkish; label column is padded to tr width', () => {
    const s = sampleStats();
    const notes = [tr.notes.shallow];
    const out = formatSummary(s, { lang: 'tr', repoName: 'demo', today: TODAY, notes, author: 'a@x', paths: { html: 'o/wrapped.html', cardsDir: 'o/cards', cardCount: 11, statsJson: 'o/stats.json' } });
    assert.ok(out.includes(tr.notes.shallow), out);
    assert.ok(out.includes('istatistik JSON: o/stats.json') || out.includes('istatistik JSON:'), out);
    // Every row label is followed by padding up to labelWidth (17).
    for (const label of ['Altın saat', 'Seri', 'Gözde dosya']) {
      const line = out.split('\n').find((l) => l.trimStart().startsWith(label));
      assert.ok(line, `no ${label} row in\n${out}`);
      const rest = line.trimStart().slice(label.length);
      assert.ok(/^ +\S/.test(rest), `${label}: not padded: ${JSON.stringify(line)}`);
      assert.equal(line.trimStart().length - rest.trimStart().length, tr.recap.labelWidth, `${label}: padded to ${tr.recap.labelWidth}`);
    }
    for (const english of ['Power hour', 'Streak', 'Hottest file', 'Top language', 'Team', 'You are', 'stats JSON', 'longest', 'current', 'Note:']) {
      assert.ok(!out.includes(english), `English "${english}" in Turkish recap:\n${out}`);
    }
  });
});

describe('CLI --lang spellings', () => {
  test('case and = forms', () => {
    for (const argv of [['--lang', 'TR'], ['--lang=TR'], ['--lang=tr'], ['--lang=Tr'], ['--lang', 'tR'], ['--lang=EN']]) {
      const want = argv.join('').toLowerCase().endsWith('en') ? 'en' : 'tr';
      assert.equal(parseCli(argv).lang, want, argv.join(' '));
    }
    // The last one wins, like the other options.
    assert.equal(parseCli(['--lang', 'tr', '--lang', 'en']).lang, 'en');
  });

  test('missing value: at the end, or followed by another option', () => {
    for (const argv of [['--lang'], ['.', '--lang'], ['--lang', '--json'], ['--lang', '-h'], ['--lang', '--no-png', '.']]) {
      assert.throws(() => parseCli(argv), /--lang requires a value/, argv.join(' '));
    }
    assert.throws(() => parseCli(['--lang', '   ']), /--lang requires a non-empty value/);
    for (const v of ['tr-TR', 'turkish', 'türkçe', 'de']) assert.throws(() => parseCli(['--lang', v]), /invalid --lang/, v);
  });

  test('run: --lang without a value exits 2 and writes nothing to stdout', async () => {
    const out = [];
    const err = [];
    const code = await run(['--lang'], { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
    assert.equal(code, 2);
    assert.equal(out.join(''), '');
    assert.match(err.join(''), /gitwrapped: --lang requires a value/);
  });
});

describe('bin: --lang spellings and Turkish notes end to end', () => {
  let fixture;
  let tmp;
  const bin = (args) => spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', NO_COLOR: '1' } });
  before(() => {
    fixture = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gw-i18n-extra-'));
  });
  after(() => {
    fixture?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('--lang TR and --lang=tr produce identical Turkish output', () => {
    const a = join(tmp, 'upper');
    const b = join(tmp, 'eq');
    const ra = bin([fixture.dir, '--out', a, '--lang', 'TR']);
    const rb = bin([fixture.dir, '--out', b, '--lang=tr']);
    assert.equal(ra.status, 0, ra.stderr);
    assert.equal(rb.status, 0, rb.stderr);
    assert.match(ra.stdout, /^gitwrapped: 8 commit → /);
    assert.equal(rb.stdout.replaceAll(b, a), ra.stdout);
    for (const f of ['wrapped.html', 'share.svg', ...readdirSync(join(a, 'cards')).map((x) => join('cards', x))]) {
      assert.equal(readFileSync(join(b, f), 'utf8'), readFileSync(join(a, f), 'utf8'), f);
    }
    assert.match(readFileSync(join(a, 'wrapped.html'), 'utf8'), /<html lang="tr">/);
  });

  test('--lang without a value exits 2', () => {
    const r = bin([fixture.dir, '--out', join(tmp, 'none'), '--lang']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--lang requires a value/);
    assert.equal(r.stdout, '');
  });

  test('Turkish notes: truncated history and a non-email --author', () => {
    const r = bin([fixture.dir, '--out', join(tmp, 'cap'), '--lang', 'tr', '--max-commits', '3']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Not: bu repoda 3 üzerinde commit var; yalnızca en yeni 3 commit incelendi\./);
    assert.doesNotMatch(r.stdout, /Note:/);
    const a = bin([fixture.dir, '--out', join(tmp, 'auth'), '--lang', 'tr', '--author', 'nobody']);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /Not: "nobody" için commit yok\. --author bir e-posta adresi bekler/);
    assert.match(a.stdout, /Hiç commit bulunamadı/);
  });
});
