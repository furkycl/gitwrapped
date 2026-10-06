// --lang tr|en: the string tables in src/i18n (same keys, types and function arities in
// every language, nothing empty), Turkish formatting (numbers, dates, percents, casing),
// localized cards / share image / viewer / recap, and the CLI flag end to end. English
// stays the default and byte-identical to output without --lang.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANG, getStrings, isLang, LANGS, t } from '../src/i18n/index.js';
import { formatDecimal, formatInteger } from '../src/i18n/format.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';
import { buildCards, buildCardSpecs, cardDescription, formatDateRange, formatDay, layoutCard, renderShareCard, windowLabel } from '../src/cards/index.js';
import { compactNumber, CONTENT_BOTTOM, CONTENT_TOP, fitCount, formatNumber } from '../src/cards/svg.js';
import { ARCHETYPES, computePersonality, personalityReason } from '../src/stats/personality.js';
import { computeStats, hourLabel } from '../src/stats/index.js';
import { shareLabel } from '../src/stats/contributors.js';
import { formatSummary } from '../src/summary.js';
import { buildViewerHtml, CSP, cspFor, cspHash } from '../src/viewer.js';
import { HELP_TEXT, parseCli, run } from '../src/cli.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const TODAY = '2026-10-05';
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));

function commit(date, subject, files = [{ path: 'src/app.js', added: 3, removed: 1 }], author = 'A', email = 'a@x') {
  return {
    hash: `${date}-${subject}`, author, email, date, subject, files,
    filesChanged: files.length, linesAdded: files.reduce((n, f) => n + f.added, 0), linesRemoved: files.reduce((n, f) => n + f.removed, 0),
  };
}

const sampleCommits = () => [
  commit('2026-10-01T23:10:00+03:00', 'feat: start'),
  commit('2026-10-02T23:40:00+03:00', 'fix: bug', [{ path: 'README.md', added: 10, removed: 2 }]),
  commit('2026-10-03T23:05:00+03:00', 'fix: more fix'),
  commit('2026-10-04T01:00:00+03:00', 'oops: tidy', [{ path: 'test/a/b/c.test.js', added: 40, removed: 0 }], 'Bob', 'b@x'),
];
const sampleStats = () => computeStats(sampleCommits(), { today: TODAY });

/** Every leaf of a table as [path, value]. */
function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, path) : [[path, v]];
  });
}

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

/** Sample arguments for a table function at `path` with `arity` parameters. */
function sampleArgs(path, arity) {
  if (path === 'andList') return [[['Ada', 'Bob', 'Cem']], [['Ada']]];
  if (path === 'date') return [[4, 10, 2026], [1, 1, '0099']];
  if (path === 'sameYearRange') return [[4, 10, 5, 11, 2026]];
  if (path === 'hourLabel') return [[0], [9], [12], [23]];
  if (path === 'upper') return [['istanbul'], ['gitwrapped']];
  if (path.endsWith('languageDetail')) return [['74%', 'files', 0], ['74%', 'lines', 2]];
  return [Array(arity).fill(2), Array(arity).fill(1)];
}

describe('i18n string tables', () => {
  test('LANGS, DEFAULT_LANG and getStrings', () => {
    assert.deepEqual([...LANGS], ['en', 'tr']);
    assert.equal(DEFAULT_LANG, 'en');
    assert.equal(getStrings('en'), en);
    assert.equal(getStrings('tr'), tr);
    assert.equal(t('tr'), tr);
    // Unknown or missing → English.
    for (const x of [undefined, null, '', 'xx', 'TR', 'toString', '__proto__']) assert.equal(getStrings(x), en, String(x));
    assert.equal(isLang('tr'), true);
    assert.equal(isLang('constructor'), false);
    for (const code of LANGS) assert.equal(getStrings(code).code, code);
  });

  for (const [a, b, an, bn] of [[en, tr, 'en', 'tr'], [tr, en, 'tr', 'en']]) {
    test(`every key in ${an} exists in ${bn} with the same type (and arity)`, () => {
      for (const [path, v] of leaves(a)) {
        const w = get(b, path);
        assert.notEqual(w, undefined, `${bn} is missing ${path}`);
        const kind = (x) => (Array.isArray(x) ? 'array' : typeof x);
        assert.equal(kind(w), kind(v), `${path}: ${kind(v)} in ${an}, ${kind(w)} in ${bn}`);
        if (typeof v === 'function') assert.equal(w.length, v.length, `${path}: arity ${v.length} in ${an}, ${w.length} in ${bn}`);
        if (Array.isArray(v)) assert.equal(w.length, v.length, `${path}: ${v.length} items in ${an}, ${w.length} in ${bn}`);
      }
      // Nested objects too (an empty object would have no leaves).
      const objects = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? [[p + k, v], ...objects(v, `${p}${k}.`)] : []));
      for (const [path, v] of objects(a)) assert.deepEqual(Object.keys(get(b, path)).sort(), Object.keys(v).sort(), path);
    });
  }

  for (const [code, table] of [['en', en], ['tr', tr]]) {
    test(`${code}: no empty strings; every function returns non-empty strings`, () => {
      for (const [path, v] of leaves(table)) {
        if (typeof v === 'string') assert.ok(v.trim().length > 0, `${code}.${path} is empty`);
        else if (Array.isArray(v)) {
          assert.ok(v.length > 0, `${code}.${path} is an empty list`);
          for (const x of v.flat()) assert.ok(typeof x === 'string' && x.trim(), `${code}.${path} has an empty item`);
        } else if (typeof v === 'function') {
          for (const args of sampleArgs(path, v.length)) {
            const out = v(...args);
            assert.equal(typeof out, 'string', `${code}.${path}(${args}) → ${typeof out}`);
            assert.ok(out.trim().length > 0, `${code}.${path}(${args}) is empty`);
            assert.doesNotMatch(out, /undefined|NaN|\[object/, `${code}.${path}(${args}) → ${out}`);
          }
        } else if (typeof v === 'number') assert.ok(Number.isFinite(v) && v > 0, `${code}.${path}`);
        else assert.fail(`${code}.${path}: unexpected ${typeof v}`);
      }
    });
  }

  test('weekday names are lower-case inside a sentence, capitalized at its start', () => {
    assert.equal(tr.peak.dayBusiest('Pazartesi'), 'En yoğun günün pazartesi.');
    assert.equal(tr.peak.dayTied('Çarşamba'), 'Çarşamba, en yoğun günlerinden biri.');
  });

  test('Turkish copy uses Turkish letters (not ASCII stand-ins)', () => {
    const all = leaves(tr).filter(([, v]) => typeof v === 'string').map(([, v]) => v).join(' ');
    for (const ch of 'çğıİöşü') assert.ok(all.includes(ch), `no ${ch} in tr.js`);
    assert.equal(tr.weekdays[3], 'Çarşamba');
    assert.equal(tr.months[7], 'Ağu');
  });

  test('archetypes and language quips cover the same ids in every language', () => {
    assert.deepEqual(ARCHETYPES.map((a) => [a.id, a.name, a.roast]), Object.entries(en.personality.archetypes).map(([id, a]) => [id, a.name, a.roast]));
    for (const L of [en, tr]) {
      assert.deepEqual(Object.keys(L.personality.archetypes), ARCHETYPES.map((a) => a.id));
      assert.deepEqual(Object.keys(L.personality.reasons), ARCHETYPES.map((a) => a.id));
    }
    assert.deepEqual(Object.keys(tr.languages.quips), Object.keys(en.languages.quips));
  });

  test('hour labels: English matches stats, Turkish is 24-hour', () => {
    for (let h = 0; h < 24; h++) assert.equal(en.hourLabel(h), hourLabel(h));
    assert.deepEqual([0, 9, 13, 23].map(tr.hourLabel), ['00:00', '09:00', '13:00', '23:00']);
  });
});

describe('i18n formatting', () => {
  test('numbers: English matches formatNumber, Turkish groups with dots', () => {
    for (const n of [0, 7, 999, 1000, 12345, 1234567.6, -2048, 9_007_199_254_740_991, 1e21, NaN, Infinity, '12']) {
      assert.equal(en.num(n), formatNumber(n), String(n));
      assert.equal(tr.num(n), formatNumber(n).replace(/,/g, '.'), String(n));
    }
    assert.equal(formatInteger(12345, '.'), '12.345');
    assert.equal(tr.num(1234567), '1.234.567');
  });

  test('decimals and percents', () => {
    assert.equal(en.dec(1234.56), '1,234.6');
    assert.equal(en.dec(23), '23');
    assert.equal(tr.dec(1234.56), '1.234,6');
    assert.equal(tr.dec(42.53), '42,5');
    assert.equal(tr.dec(23), '23');
    assert.equal(tr.dec(0.04), '0');
    assert.equal(formatDecimal(-1.26, '.', ','), '−1,3');
    assert.equal(en.pct(74), '74%');
    assert.equal(tr.pct(74), '%74');
    assert.equal(shareLabel(0.2, 1, tr.pct), '<%1');
    assert.equal(shareLabel(99.6, 9, tr.pct), '%99');
    assert.equal(shareLabel(31.3, 5), '31%');
  });

  test('Turkish upper-casing: i → İ, ı → I; brand names keep a plain I', () => {
    assert.equal(tr.upper('istikrar ışığı'), 'İSTİKRAR IŞIĞI');
    assert.equal(tr.upper('Gözde dosyaların'), 'GÖZDE DOSYALARIN');
    assert.equal(tr.upper('gitwrapped sunar'), 'GITWRAPPED SUNAR');
    assert.equal(tr.upper("2025 Git Wrapped'im"), "2025 GIT WRAPPED'İM");
    assert.equal(tr.upper("commit'lerin kişiliğin"), "COMMIT'LERİN KİŞİLİĞİN");
    assert.equal(tr.upper('commit takvimin'), 'COMMIT TAKVİMİN');
    assert.equal(en.upper('istikrar'), 'ISTIKRAR');
  });

  test('dates, ranges and windows', () => {
    assert.equal(formatDay('2026-10-04', 'tr'), '4 Eki 2026');
    assert.equal(formatDay('2026-10-04'), 'Oct 4, 2026');
    assert.equal(formatDateRange('2026-10-04', '2026-11-05', 'tr'), '4 Eki – 5 Kas 2026');
    assert.equal(formatDateRange('2025-12-30', '2026-01-02', 'tr'), '30 Ara 2025 – 2 Oca 2026');
    assert.equal(formatDateRange('2026-02-03', '2026-02-03', 'tr'), '3 Şub 2026');
    assert.equal(windowLabel({ since: '2025-01-03', lang: 'tr' }), '3 Oca 2025 ve sonrası');
    assert.equal(windowLabel({ until: '2025-03-09', lang: 'tr' }), '9 Mar 2025 ve öncesi');
    assert.equal(windowLabel({ since: '2025-01-01', until: '2025-12-31', lang: 'tr' }), '2025');
    assert.equal(windowLabel({ since: '2025-01-03' }), 'since Jan 3, 2025');
  });

  test('compact counts per language', () => {
    assert.equal(compactNumber(12345), '12.3K');
    assert.equal(compactNumber(12345, 'tr'), '12,3B');
    assert.equal(compactNumber('12.345', 'tr'), '12,3B');
    assert.equal(compactNumber('+4.500.000', 'tr'), '+4,5Mn');
    assert.equal(compactNumber(1e19, 'tr'), '9.999Tn+');
    assert.equal(compactNumber(1e19), '9,999T+');
    assert.equal(fitCount('4.567.890 gün', 300, 44, 1.02, 'tr'), '4,6Mn gün');
    assert.equal(fitCount('4,567,890 days', 260, 44), '4.6M days');
    assert.equal(fitCount('4,567,890 days', 300, 44, 1.02, 'tr'), null); // not a Turkish count
  });
});

describe('localized cards and share image', () => {
  test('lang en (or unknown) renders exactly what no lang renders', () => {
    const s = sampleStats();
    const base = buildCards(s, { repoName: 'demo', today: TODAY });
    assert.deepEqual(buildCards(s, { repoName: 'demo', today: TODAY, lang: 'en' }), base);
    assert.deepEqual(buildCards(s, { repoName: 'demo', today: TODAY, lang: 'xx' }), base);
    assert.equal(renderShareCard(s, { repoName: 'demo', today: TODAY, lang: 'en' }), renderShareCard(s, { repoName: 'demo', today: TODAY }));
  });

  test('Turkish cards: Turkish copy, no English card copy left', () => {
    const s = sampleStats();
    const cards = buildCards(s, { repoName: 'demo', today: TODAY, lang: 'tr', author: 'a@x' });
    const all = cards.map((c) => c.svg + c.description).join('\n');
    for (const want of ['GITWRAPPED SUNAR', 'GENEL TOPLAM', 'ALTIN SAATİN', 'EN UZUN SERİN', 'COMMIT TAKVİMİN', 'GÖZDE DOSYALARIN', 'DİLLERİN', 'EKİP', 'MESAJ ŞÖHRETLER SALONU', 'COMMIT KİŞİLİĞİN', 'HEPSİ BU KADAR', 'Teşekkürler!', 'Gece Kuşu', '23:00', '1 Eki – 4 Eki 2026', 'Az', 'Çok', 'Başrolde: a.']) {
      assert.ok(all.includes(want), `missing ${want}`);
    }
    for (const english of ['commits', 'Your ', 'The grand total', 'Night Owl', 'Steady Shipper', 'Less', 'More', ' PM', ' AM', 'Oct ', 'active day', 'Longest', 'Thanks!', 'lines']) {
      assert.ok(!all.includes(english), `English left in Turkish cards: ${english}`);
    }
    // The personality reason is re-phrased from the real numbers.
    assert.match(all, /Commit'lerinin %\d+ kadarı 22:00 ile 04:00 arasında geliyor\./);
  });

  test('personalityReason: localized from computePersonality, null for hand-built stats', () => {
    const s = sampleStats();
    // The facts ride along under a hidden key: not in JSON, not in Object.keys / spreads.
    assert.deepEqual(Object.keys(s.personality), ['archetype', 'scores']);
    assert.doesNotMatch(JSON.stringify(s.personality), /fixShare|enough|"span"/);
    assert.equal(personalityReason({ ...s.personality }, tr), null);
    assert.equal(personalityReason(s.personality, en), s.personality.archetype.reason);
    assert.match(personalityReason(s.personality, tr), /kadarı/);
    assert.equal(personalityReason(JSON.parse(JSON.stringify(s.personality)), tr), null);
    assert.equal(personalityReason(computePersonality({}), tr), 'Henüz yeterince commit yok.');
    // A hand-built archetype still gets its Turkish name; the reason falls back to stats' text.
    const hand = { ...s, personality: { archetype: { id: 'fixaholic', name: 'Fixaholic', roast: 'r', reason: 'Custom reason.' }, scores: [] } };
    const svg = buildCards(hand, { today: TODAY, lang: 'tr' }).find((c) => c.id === 'personality').svg;
    assert.match(svg, /Fix Bağımlısı/);
    assert.match(svg, /Custom reason\./);
  });

  test('cardDescription follows spec.lang', () => {
    assert.match(cardDescription({ chart: { kind: 'calendar', days: [{ day: '2026-10-01', commits: 1 }] } }), /Commit calendar of 1 active day\./);
    assert.match(cardDescription({ lang: 'tr', chart: { kind: 'calendar', days: [{ day: '2026-10-01', commits: 1 }] } }), /1 aktif günlük commit takvimi\./);
  });

  test('Turkish card layouts stay inside the content area (long copy included)', () => {
    const variants = [sampleStats(), computeStats([], { today: TODAY })];
    const long = sampleStats();
    long.personality.archetype = { ...long.personality.archetype, id: 'weekend-warrior' };
    variants.push(long);
    for (const s of variants) {
      for (const opts of [{}, { since: '2025-01-01', until: '2025-12-31' }, { author: 'a@x' }]) {
        for (const { id, spec } of buildCardSpecs(s, { repoName: 'a-rather-long-repository-name', today: TODAY, lang: 'tr', ...opts })) {
          const layout = layoutCard(spec);
          for (const b of layout.blocks) {
            assert.ok(b.top >= CONTENT_TOP - 0.01 && b.bottom <= CONTENT_BOTTOM + 0.01, `${id}: ${b.kind} ${b.top}..${b.bottom}`);
          }
          if (layout.eyebrow) assert.ok(layout.eyebrow.right <= 96 + 888 + 0.5, `${id}: eyebrow too wide (${layout.eyebrow.right})`);
          const sorted = [...layout.blocks].sort((x, y) => x.top - y.top);
          for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].top >= sorted[i - 1].bottom - 0.01, `${id}: blocks overlap`);
        }
      }
    }
  });

  test('Turkish share image', () => {
    const svg = renderShareCard(sampleStats(), { repoName: 'demo', today: TODAY, lang: 'tr', since: '2026-01-01', until: '2026-12-31' });
    assert.match(svg, /2026 GIT WRAPPED&apos;İM/);
    for (const want of ['COMMIT', 'EN İYİ SERİ', 'ALTIN SAAT', 'KİŞİLİK', 'EN GÖZDE DOSYA', '>Gece<', '>Kuşu<']) assert.ok(svg.includes(want), want);
    assert.doesNotMatch(svg, /Hottest|Best streak|Power hour|My 2026/);
  });
});

describe('localized viewer and recap', () => {
  test('viewer: html lang, labels and a CSP that hashes the Turkish script', () => {
    const cards = buildCards(sampleStats(), { today: TODAY, lang: 'tr' });
    const html = buildViewerHtml(cards, { title: 'gitwrapped · demo', lang: 'tr' });
    assert.match(html, /<html lang="tr">/);
    for (const want of ['aria-label="Önceki kart"', 'aria-label="Sonraki kart"', 'aria-label="Duraklat"', 'aria-label="Kart işlemleri"', '<span class="sr">İndir: </span>PNG', '>Paylaş</button>', 'Klavye kısayolları', '>Kapat</button>', 'aria-roledescription="slayt"', 'aria-label="1 / ', "'Oynat'", "' kaydedildi'", "Paylaş\\'a"]) {
      assert.ok(html.includes(want), want);
    }
    // (Code comments in the inline script stay English.)
    const visible = html.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    for (const english of ['Previous card', 'Next card', 'Keyboard shortcuts', 'Download ', '>Share<', 'Saved ', 'Sharing failed', '<html lang="en">']) {
      assert.ok(!visible.includes(english), english);
    }
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(cspFor('tr').includes(cspHash(script)));
    assert.ok(html.includes(cspFor('tr')));
    assert.notEqual(cspFor('tr'), CSP);
    assert.equal(cspFor('en'), CSP);
    // The generated script is valid JavaScript.
    assert.doesNotThrow(() => new Function(script));
  });

  test('viewer: English default unchanged', () => {
    const cards = buildCards(sampleStats(), { today: TODAY });
    const html = buildViewerHtml(cards, { title: 'x' });
    assert.equal(buildViewerHtml(cards, { title: 'x', lang: 'en' }), html);
    assert.match(html, /<html lang="en">/);
    assert.ok(html.includes(`content="${CSP}"`));
    assert.ok(html.includes("status.textContent = 'Card ' + (i + 1) + ' of ' + n + ': '"));
  });

  test('recap in Turkish', () => {
    const s = sampleStats();
    const out = formatSummary(s, { lang: 'tr', repoName: 'demo', today: TODAY, paths: { html: 'o/wrapped.html', cardsDir: 'o/cards', cardCount: 11, pngDir: 'o/png', pngCount: 11, sharePng: 'o/share.png' } });
    assert.match(out, /^gitwrapped: 4 commit → o\/wrapped\.html\n/);
    for (const want of ['4 aktif gün', 'satır', 'Altın saat', '23:00', 'Seri', 'en uzun', 'Gözde dosya', 'Favori dil', 'Ekip', 'Kişiliğin', 'Gece Kuşu', '11 kart: o/cards', '11 PNG: o/png', 'paylaşım görseli: o/share.png']) {
      assert.ok(out.includes(want), `${want} in\n${out}`);
    }
    assert.doesNotMatch(out, /commits|active day|Power hour|Night Owl|share image/);
    assert.equal(formatSummary(s, { lang: 'en', today: TODAY }), formatSummary(s, { today: TODAY }));
    assert.match(formatSummary(computeStats([]), { lang: 'tr' }), /Hiç commit bulunamadı/);
  });
});

describe('CLI --lang', () => {
  test('parseCli accepts --lang tr / --lang=tr, defaults to no lang (English)', () => {
    assert.equal(parseCli(['--lang', 'tr']).lang, 'tr');
    assert.equal(parseCli(['--lang=tr']).lang, 'tr');
    assert.equal(parseCli(['--lang', ' TR ']).lang, 'tr');
    assert.equal(parseCli(['--lang', 'en']).lang, 'en');
    assert.equal('lang' in parseCli([]), false);
  });

  test('parseCli rejects unknown, empty and missing values', () => {
    assert.throws(() => parseCli(['--lang', 'xx']), /invalid --lang "xx": expected one of en, tr/);
    assert.throws(() => parseCli(['--lang=']), /--lang requires a non-empty value/);
    assert.throws(() => parseCli(['--lang']), /--lang requires a value/);
    assert.throws(() => parseCli(['--lang', 'constructor']), /invalid --lang/);
  });

  test('--help documents --lang', () => {
    assert.match(HELP_TEXT, /--lang <code> +Language of the cards, viewer and recap/);
    assert.match(HELP_TEXT, /en \(English, default\) or tr \(Türkçe\)/);
  });

  test('run: --lang xx exits 2 with a clear message and writes nothing', async () => {
    const out = [];
    const err = [];
    const code = await run(['--lang', 'xx'], { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
    assert.equal(code, 2);
    assert.equal(out.join(''), '');
    assert.match(err.join(''), /gitwrapped: invalid --lang "xx": expected one of en, tr\nRun "gitwrapped --help" for usage\./);
  });
});

describe('bin: --lang end to end on the fixture repo', () => {
  let fixture;
  let tmp;
  const bin = (args) => spawnSync(process.execPath, [BIN, ...args, '--no-png', '--no-color'], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', NO_COLOR: '1' } });
  before(() => {
    fixture = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gw-i18n-'));
  });
  after(() => {
    fixture?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('--lang tr: Turkish cards, share image, viewer and recap; stats.json unchanged', () => {
    const trOut = join(tmp, 'tr');
    const enOut = join(tmp, 'en');
    const r = bin([fixture.dir, '--out', trOut, '--lang', 'tr', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^gitwrapped: 8 commit → /);
    assert.match(r.stdout, /Altın saat/);
    assert.match(r.stdout, /Kişiliğin/);
    assert.match(r.stdout, /11 kart: /);
    const html = readFileSync(join(trOut, 'wrapped.html'), 'utf8');
    assert.match(html, /<html lang="tr">/);
    assert.match(html, /Klavye kısayolları/);
    const cards = readdirSync(join(trOut, 'cards')).sort();
    assert.equal(cards.length, 11);
    assert.deepEqual(cards.slice(0, 2), ['01-intro.svg', '02-totals.svg']); // file names stay language-neutral
    const svgs = cards.map((f) => readFileSync(join(trOut, 'cards', f), 'utf8')).join('\n');
    for (const want of ['GITWRAPPED SUNAR', 'GENEL TOPLAM', 'EKİP', 'HEPSİ BU KADAR']) assert.ok(svgs.includes(want), want);
    assert.ok(!svgs.includes('The grand total'));
    const share = readFileSync(join(trOut, 'share.svg'), 'utf8');
    assert.match(share, /GIT WRAPPED&apos;İM/);
    assert.match(share, /EN GÖZDE DOSYA/);

    const e = bin([fixture.dir, '--out', enOut, '--json']);
    assert.equal(e.status, 0, e.stderr);
    assert.match(e.stdout, /^gitwrapped: 8 commits → /);
    assert.match(readFileSync(join(enOut, 'wrapped.html'), 'utf8'), /<html lang="en">/);
    assert.match(readFileSync(join(enOut, 'cards', '02-totals.svg'), 'utf8'), /THE GRAND TOTAL/);
    // stats.json is language-neutral.
    assert.equal(readFileSync(join(trOut, 'stats.json'), 'utf8'), readFileSync(join(enOut, 'stats.json'), 'utf8'));
  });

  test('--lang en is byte-identical to no --lang', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    const ra = bin([fixture.dir, '--out', a]);
    const rb = bin([fixture.dir, '--out', b, '--lang=en']);
    assert.equal(ra.status, 0, ra.stderr);
    assert.equal(rb.stdout.replaceAll(b, a), ra.stdout);
    for (const f of ['wrapped.html', 'share.svg', ...readdirSync(join(a, 'cards')).map((x) => join('cards', x))]) {
      assert.equal(readFileSync(join(b, f), 'utf8'), readFileSync(join(a, f), 'utf8'), f);
    }
  });

  test('--lang xx exits 2', () => {
    const r = bin([fixture.dir, '--out', join(tmp, 'xx'), '--lang', 'xx']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /invalid --lang "xx"/);
  });
});
