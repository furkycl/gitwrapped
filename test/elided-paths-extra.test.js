// Edge cases for middle-elided paths (elidePath / elidedPathForms, the hot-files folder,
// the outro's hottest file and the co-change row): grapheme safety, odd path spellings,
// many segments, spaces, multi-repo labels, and an en + tr fit fuzz over random deep paths
// (every drawn sub / wide value fits its room and is the full text, an elided form or a
// start cut; elided co-change names always differ and the row always fits).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/stats/index.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { elidePath, elidedPathForms, graphemes, measureText, rowFits } from '../src/cards/svg.js';
import { mergeHistories } from '../src/git.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const LANGS = [['en', en], ['tr', tr]];
const BWF = 1.02; // svg.js BIG_WEIGHT_FACTOR
const ELL = '…';
const norm = (t) => String(t ?? '').replace(/[^\S ]+/g, ' ').trim();
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

let seq = 0;
const commit = (paths, repo) => {
  seq += 1;
  return {
    hash: `${String(seq).padStart(6, '0')}${'a'.repeat(34)}`,
    date: `2026-03-${String(1 + (seq % 27)).padStart(2, '0')}T10:00:00Z`,
    subject: `feat: change ${seq}`,
    author: 'Ada',
    email: 'ada@example.com',
    ...(repo ? { repo } : {}),
    files: paths.map((path) => ({ path, added: 3, removed: 1 })),
    parents: ['p'],
  };
};
const times = (n, paths) => Array.from({ length: n }, () => commit(paths));
const stats = (commits, opts = {}) => computeStats(commits, { today: TODAY, ...opts });
const cardsOf = (s, lang) => buildCards(s, { repoName: 'demo', today: TODAY, lang });
const svgOf = (s, lang, id) => cardsOf(s, lang).find((c) => c.id === id).svg;
const hotSpec = (s, lang) => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').spec;

/** All <text> elements: {x, y, size, weight, opacity, anchor, text}. */
function texts(svg) {
  const out = [];
  for (const m of svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    out.push({ x: Number(a.x), y: Number(a.y), size: Number(a['font-size']), weight: a['font-weight'], opacity: a['fill-opacity'], anchor: a['text-anchor'], text: unescape(m[2]) });
  }
  return out;
}

const dirOf = (p) => {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
};

/** Whether `drawn` is `full` (normalized), one of its elided forms, or a grapheme-safe start cut of it. */
function isAllowedForm(drawn, full) {
  const f = norm(full);
  if (drawn === f) return 'full';
  if (elidedPathForms(f).includes(drawn)) return 'elided';
  // Same-name hot files / co-change pairs: elided from the first folder where they differ
  // (an elided form of a trailing part of the path, "core-x/…/forms/").
  const segs = f.split('/').filter(Boolean);
  for (let i = 1; i < segs.length; i++) {
    if (elidedPathForms(`${segs.slice(i).join('/')}${f.endsWith('/') ? '/' : ''}`).includes(drawn)) return 'anchored';
  }
  if (drawn.startsWith(ELL)) {
    const tail = drawn.slice(ELL.length);
    const gs = graphemes(f);
    for (let i = 0; i <= gs.length; i++) {
      if (gs.slice(i).join('').trimStart() === tail) return 'start';
    }
  }
  return null;
}

/** No lone surrogates in `s` (a cut never splits a code point). */
const wellFormed = (s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('elidedPathForms / elidePath edge cases', () => {
  test('emoji and ZWJ segments stay whole (split on "/" only)', () => {
    const fam = '👨‍👩‍👧‍👦';
    const p = `🚀app/${fam}/deep/🇹🇷flags/file-${fam}.js`;
    const forms = elidedPathForms(p);
    assert.deepEqual(forms, [`🚀app/…/deep/🇹🇷flags/file-${fam}.js`, `🚀app/…/🇹🇷flags/file-${fam}.js`, `🚀app/…/file-${fam}.js`]);
    for (const f of forms) {
      assert.ok(wellFormed(f), f);
      assert.ok(graphemes(f).includes(fam) || graphemes(f).some((g) => g.includes(fam)), 'ZWJ family whole');
    }
    // elidePath picks the first that fits, measured per grapheme cluster.
    const size = 28;
    const want = `🚀app/…/file-${fam}.js`;
    assert.equal(elidePath(p, { maxWidth: measureText(want, size), fontSize: size }), want);
  });

  test('non-Latin segments (Turkish, CJK, RTL)', () => {
    const p = 'İstanbul/şehir/ğüzel/文件夹/مجلد/çıktı.ts';
    assert.equal(elidedPathForms(p).at(-1), 'İstanbul/…/çıktı.ts');
    assert.equal(elidedPathForms(p)[0], 'İstanbul/…/ğüzel/文件夹/مجلد/çıktı.ts');
  });

  test('a leading "/" is dropped in the elided forms; the full path is kept when it fits', () => {
    assert.deepEqual(elidedPathForms('/srv/app/lib/x.js'), ['srv/…/lib/x.js', 'srv/…/x.js']);
    assert.equal(elidePath('/srv/app/lib/x.js', { maxWidth: 10000, fontSize: 28 }), '/srv/app/lib/x.js');
  });

  test('a leading "./": the "." counts as the first segment (forms still end in the file name)', () => {
    const forms = elidedPathForms('./src/a/b/x.js');
    assert.deepEqual(forms, ['./…/a/b/x.js', './…/b/x.js', './…/x.js']);
    for (const f of forms) assert.ok(f.endsWith('/x.js'));
  });

  test('very many segments: forms are ordered, each one shorter, the last is first/…/file', () => {
    const segs = Array.from({ length: 300 }, (_, i) => `d${i}`);
    const p = `${segs.join('/')}/leaf.js`;
    const forms = elidedPathForms(p);
    assert.equal(forms.length, 299);
    assert.equal(forms[0], `d0/…/${segs.slice(2).join('/')}/leaf.js`);
    assert.equal(forms.at(-1), 'd0/…/leaf.js');
    for (let i = 1; i < forms.length; i++) assert.ok(forms[i].length < forms[i - 1].length);
    const size = 28;
    const t0 = Date.now();
    const got = elidePath(p, { maxWidth: measureText('d0/…/d297/d298/d299/leaf.js', size), fontSize: size });
    assert.equal(got, 'd0/…/d297/d298/d299/leaf.js');
    assert.ok(Date.now() - t0 < 2000, 'fast enough');
  });

  test('segments with spaces: kept, runs of whitespace collapsed', () => {
    assert.deepEqual(elidedPathForms('My Docs/Some  Folder/Other\tDir/file name.md'), ['My Docs/…/Other Dir/file name.md', 'My Docs/…/file name.md']);
    assert.deepEqual(elidedPathForms('  a/b/c.js  '), ['a/…/c.js']);
  });

  test('elidePath never returns something wider than maxWidth', () => {
    const p = 'packages/👩‍💻 dev tools/src/İçerik/deep/file.ts';
    for (let w = 0; w <= 900; w += 7) {
      const got = elidePath(p, { maxWidth: w, fontSize: 28 });
      if (got !== null) assert.ok(measureText(got, 28) <= w, `${w}: ${got}`);
    }
  });
});

describe('cards: odd path spellings', () => {
  test('hot-files: emoji folders are elided whole (no broken graphemes)', () => {
    const p = '🚀rocket/👨‍👩‍👧‍👦family/very-long-folder-name/another-folder/🇹🇷/x.js';
    for (const [lang] of LANGS) {
      const svg = svgOf(stats([...times(2, [p]), commit(['README.md'])]), lang, 'hot-files');
      const sub = texts(svg).find((t) => t.size === 28 && t.weight === '600');
      assert.ok(sub, 'sub drawn');
      assert.ok(wellFormed(sub.text));
      assert.ok(isAllowedForm(sub.text, dirOf(p)), sub.text);
    }
  });

  test('multi-repo: the elided hot-file folder keeps the repo label first', () => {
    const deep = 'src/server/handlers/really/deeply/nested/module/users.js';
    const { commits } = mergeHistories([
      { label: 'api', commits: [commit([deep]), commit([deep])] },
      { label: 'web', commits: [commit(['README.md'])] },
    ]);
    const s = stats(commits, { repos: ['api', 'web'] });
    assert.equal(s.hotFiles[0].path, `api/${deep}`);
    for (const [lang] of LANGS) {
      const svg = svgOf(s, lang, 'hot-files');
      const sub = texts(svg).find((t) => t.size === 28 && t.weight === '600');
      assert.ok(sub, 'sub drawn');
      assert.ok(sub.text.startsWith('api/…/'), sub.text);
      assert.equal(isAllowedForm(sub.text, dirOf(`api/${deep}`)), 'elided');
      const outro = texts(svgOf(s, lang, 'outro')).find((t) => t.size === 48 && t.weight === '900');
      assert.ok(isAllowedForm(outro.text, `api/${deep}`), outro.text);
      assert.ok(outro.text.startsWith('api/'), outro.text);
    }
  });

  test('multi-repo co-change of same-name files in two repos: names differ by repo label', () => {
    // Repo-labelled paths as mergeHistories writes them (one commit touching both).
    const x = 'ui/packages/core-package/src/lib/a.js';
    const y = 'db/packages/core-package/src/lib/a.js';
    const s = stats(times(3, [x, y]));
    for (const [lang] of LANGS) {
      const row = (hotSpec(s, lang).lines ?? []).at(-1);
      assert.ok(row, 'row present');
      assert.ok(rowFits(row));
      const names = (row.label.includes(' + ') ? row.label : row.value.replace(/ · .*$/, '')).split(' + ');
      assert.equal(names.length, 2);
      assert.notEqual(names[0], names[1]);
      assert.ok(names.includes(elidedPathForms(x).find((f) => names.includes(f))), `elided: ${names.join(' | ')}`);
      assert.ok(names.some((n) => n.startsWith('ui/…/')) && names.some((n) => n.startsWith('db/…/')), names.join(' | '));
    }
  });
});

// --- fuzz -----------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ['src', 'lib', 'packages', 'components', 'shared', 'very-long-workspace-name', 'internal', 'İçerik', 'şablonlar', 'ğ', '文件夹', '🚀', '👨‍👩‍👧‍👦', '🇹🇷', 'My Docs', 'a', 'x', 'node_modules_like', 'WWWWWWWWWWWW', 'iiiiiiii', 'test fixtures', 'v2', 'mm', 'core'];
const FILES = ['index.js', 'App.tsx', 'README.md', 'çıktı.ts', 'x.js', 'a-really-long-file-name-for-testing.spec.ts', '🚀.js', 'W.go', 'file name.md'];

function randomPath(r, minSegs = 1, maxSegs = 14) {
  const n = minSegs + Math.floor(r() * (maxSegs - minSegs + 1));
  const segs = Array.from({ length: n }, () => POOL[Math.floor(r() * POOL.length)]);
  return [...segs, FILES[Math.floor(r() * FILES.length)]].join('/');
}

/** How often the fuzz saw each drawn form (so it is not vacuous). */
const seen = { subElided: 0, subStart: 0, wideElided: 0, pairElided: 0, pairRows: 0 };

function checkHotFiles(svg, hotPaths, label, repoLabels = []) {
  const ts = texts(svg);
  // The hot files' folders, plus the repo labels the top-folders list shows dimmed in a multi-repo run.
  const dirs = [...hotPaths.map(dirOf).filter(Boolean), ...repoLabels];
  for (const sub of ts.filter((t) => t.size === 28 && t.weight === '600' && t.opacity === '0.6')) {
    assert.ok(wellFormed(sub.text), `${label}: ill-formed ${sub.text}`);
    assert.ok(sub.text !== ELL && sub.text !== '', `${label}: empty sub`);
    // Allowed: the full folder, an elided form, a start cut, of one of the hot files' folders.
    const kinds = dirs.map((d) => isAllowedForm(sub.text, d));
    const ok = kinds.some(Boolean);
    if (kinds.includes('elided')) seen.subElided += 1;
    else if (kinds.includes('start')) seen.subStart += 1;
    assert.ok(ok, `${label}: sub ${JSON.stringify(sub.text)} not a form of ${JSON.stringify(dirs)}`);
    // Fits before the right-aligned value on its line.
    const value = ts.find((t) => t.y === sub.y && t.anchor === 'end' && t.size === 36);
    const right = value ? value.x - measureText(value.text, 36) * BWF - 28 : 984;
    const end = sub.x + measureText(sub.text, 28) * BWF;
    assert.ok(end <= right + 0.2, `${label}: sub ${JSON.stringify(sub.text)} ends at ${end} > ${right}`);
  }
}

function checkOutro(svg, top, label) {
  const ts = texts(svg);
  const v = ts.find((t) => t.size === 48 && t.weight === '900');
  if (!v) return;
  assert.ok(wellFormed(v.text), `${label}: ill-formed ${v.text}`);
  if (isAllowedForm(v.text, top) === 'elided') seen.wideElided += 1;
  assert.ok(isAllowedForm(v.text, top), `${label}: wide ${JSON.stringify(v.text)} not a form of ${JSON.stringify(top)}`);
  const note = ts.find((t) => t.size === 34 && t.anchor === 'end' && Math.abs(t.y - v.y) < 0.5);
  const right = note ? note.x - measureText(note.text, 34) * BWF - 28 : 1008 - 32;
  const end = v.x + measureText(v.text, 48) * BWF;
  assert.ok(end <= right + 0.2, `${label}: wide ${JSON.stringify(v.text)} ends at ${end} > ${right}`);
}

function checkCoChange(s, lang, L, label) {
  const pair = s.coChange;
  if (!pair) return;
  const [a, b] = pair.files;
  const desc = L.hotFiles.coChangeDescription(a, b, pair.commits);
  const row = (hotSpec(s, lang).lines ?? []).find((r) => r?.description === desc);
  if (!row) return;
  seen.pairRows += 1;
  if (row.label.includes(ELL) || row.value.includes(ELL)) seen.pairElided += 1;
  assert.ok(rowFits(row), `${label}: co-change row does not fit: ${JSON.stringify(row)}`);
  const names = row.label === L.hotFiles.coChange ? row.value.replace(/ · [^·]*$/, '').split(' + ') : row.label.split(' + ');
  assert.equal(names.length, 2, `${label}: ${JSON.stringify(row)}`);
  assert.notEqual(names[0], names[1], `${label}: alike names ${JSON.stringify(row)}`);
  // Each name is a tail of its path (the short form), its full path or an elided form.
  const ok = (name, p) => {
    const segs = String(p).split('/').filter(Boolean);
    const tails = segs.map((_, i) => segs.slice(i).join('/'));
    // ...or elided from the first folder where the two differ (an elided form of a tail).
    return tails.includes(name) || tails.some((t) => elidedPathForms(t).includes(name));
  };
  assert.ok(ok(names[0], a), `${label}: ${names[0]} vs ${a}`);
  assert.ok(ok(names[1], b), `${label}: ${names[1]} vs ${b}`);
  // Drawn on the card.
  const svg = svgOf(s, lang, 'hot-files');
  const drawn = texts(svg).map((t) => t.text);
  assert.ok(drawn.includes(row.label), `${label}: row label not drawn ${row.label}`);
}

describe('fit fuzz (en + tr): random deep paths', () => {
  const r = rng(85);
  for (let round = 0; round < 40; round++) {
    const multi = r() < 0.3;
    const p1 = randomPath(r, 2, 14);
    const p2 = r() < 0.4 ? p1.replace(/^[^/]+/, POOL[Math.floor(r() * POOL.length)]) : randomPath(r, 1, 14);
    const p3 = randomPath(r, 0, 10);
    const pathsFor = () => [p1, p2];
    let s;
    if (multi) {
      const { commits } = mergeHistories([
        { label: 'api-service', commits: [commit(pathsFor()), commit(pathsFor()), commit(pathsFor()), commit([p3])] },
        { label: 'w', commits: [commit([p3]), commit([p1])] },
      ]);
      s = stats(commits, { repos: ['api-service', 'w'] });
    } else {
      s = stats([...times(3, pathsFor()), commit([p3]), commit([p1])]);
    }
    for (const [lang, L] of LANGS) {
      test(`round ${round} ${lang}${multi ? ' (multi-repo)' : ''}`, () => {
        const label = `round ${round} ${lang} [${p1} | ${p2} | ${p3}]`;
        const hot = (s.hotFiles ?? []).map((f) => f.path);
        const all = cardsOf(s, lang);
        checkHotFiles(all.find((c) => c.id === 'hot-files').svg, hot, label, multi ? ['api-service', 'w'] : []);
        if (hot[0]) checkOutro(all.find((c) => c.id === 'outro').svg, hot[0], label);
        checkCoChange(s, lang, L, label);
      });
    }
  }
});

describe('co-change: elided names always differ (pairs built to collide)', () => {
  const r = rng(4242);
  for (let i = 0; i < 30; i++) {
    const first = POOL[Math.floor(r() * POOL.length)];
    const mid = Array.from({ length: 2 + Math.floor(r() * 6) }, () => POOL[Math.floor(r() * POOL.length)]);
    const file = FILES[Math.floor(r() * FILES.length)];
    // Same first folder and file name; differ in one middle folder (often only elision-hidden).
    const j = Math.floor(r() * mid.length);
    const mid2 = mid.slice();
    mid2[j] = `${mid2[j]}-other`;
    const a = [first, ...mid, file].join('/');
    const b = [first, ...mid2, file].join('/');
    const s = stats(times(3, [a, b]));
    for (const [lang, L] of LANGS) {
      test(`pair ${i} ${lang}`, () => checkCoChange(s, lang, L, `pair ${i} ${lang} [${a} | ${b}]`));
    }
  }
});

describe('co-change: different first folders, same long tail (elided rows)', () => {
  const r = rng(777);
  const SHORT = ['a', 'b', 'ui', 'db', '🚀', 'ğ', 'x', 'core', 'İ'];
  for (let i = 0; i < 30; i++) {
    const f1 = SHORT[Math.floor(r() * SHORT.length)];
    let f2 = SHORT[Math.floor(r() * SHORT.length)];
    if (f2 === f1) f2 = `${f2}2`;
    const mid = Array.from({ length: 2 + Math.floor(r() * 8) }, () => POOL[Math.floor(r() * POOL.length)]);
    const file = ['x.js', 'i.ts', 'çı.go', '🚀.js', 'index.js'][Math.floor(r() * 5)];
    const a = [f1, ...mid, file].join('/');
    const b = [f2, ...mid, file].join('/');
    const s = stats(times(3, [a, b]));
    for (const [lang, L] of LANGS) {
      test(`pair ${i} ${lang}`, () => checkCoChange(s, lang, L, `pair ${i} ${lang} [${a} | ${b}]`));
    }
  }
});

test('the fuzz exercised elided and start-cut forms', () => {
  assert.ok(seen.subElided > 0, JSON.stringify(seen));
  assert.ok(seen.wideElided > 0, JSON.stringify(seen));
  assert.ok(seen.pairRows > 0 && seen.pairElided > 0, JSON.stringify(seen));
});
