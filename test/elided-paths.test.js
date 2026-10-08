// Middle-elided paths on cards: a path too long for its place is shortened as
// "first/…/near/file.js" (elidePath / elidedPathForms in src/cards/svg.js) before it is cut
// from the start (hot files' folder, the outro's hottest file) or dropped (the co-change
// row). The recap, wrapped.md and stats.json keep the full paths.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/stats/index.js';
import { mergeHistories } from '../src/git.js';
import { buildCards, buildCardSpecs } from '../src/cards/index.js';
import { elidePath, elidedPathForms, escapeXml, measureText, rowFits, rowValueFits } from '../src/cards/svg.js';
import { formatSummary } from '../src/summary.js';
import { buildMarkdown } from '../src/markdown.js';
import en from '../src/i18n/en.js';
import tr from '../src/i18n/tr.js';

const TODAY = '2026-04-01';
const H = (i) => `${String(i).padStart(4, '0')}abcdef0123456789abcdef0123456789abcd`;
const commit = (i, paths) => ({
  hash: H(i),
  date: `2026-03-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
  subject: `feat: change ${i}`,
  author: 'Ada',
  email: 'ada@example.com',
  files: paths.map((path) => ({ path, added: 3, removed: 1 })),
  parents: ['p'],
});
const times = (n, paths, from = 1) => Array.from({ length: n }, (_, k) => commit(from + k, paths));
const stats = (commits) => computeStats(commits, { today: TODAY });
const cards = (s, lang) => buildCards(s, { repoName: 'demo', today: TODAY, lang });
const svgOf = (s, lang, id) => cards(s, lang).find((c) => c.id === id).svg;
const hotSpec = (s, lang) => buildCardSpecs(s, { repoName: 'demo', today: TODAY, lang }).find((c) => c.id === 'hot-files').spec;
const LANGS = [['en', en], ['tr', tr]];

describe('elidedPathForms', () => {
  test('first segment, ellipsis, then the nearest segments, most kept first', () => {
    assert.deepEqual(elidedPathForms('a/b/c/d/e.js'), ['a/…/c/d/e.js', 'a/…/d/e.js', 'a/…/e.js']);
    assert.deepEqual(elidedPathForms('a/b/c.js'), ['a/…/c.js']);
    for (const f of elidedPathForms('a/b/c/d/e.js')) assert.ok(f.includes('/…/'), f);
  });

  test('fewer than 3 segments: nothing to elide; empty segments ignored', () => {
    assert.deepEqual(elidedPathForms('a.js'), []);
    assert.deepEqual(elidedPathForms('src/a.js'), []);
    assert.deepEqual(elidedPathForms('src//a.js'), []);
    assert.deepEqual(elidedPathForms(''), []);
    assert.deepEqual(elidedPathForms(null), []);
    assert.deepEqual(elidedPathForms('/a//b/c.js'), ['a/…/c.js']);
  });

  test('a folder keeps its trailing slash', () => {
    assert.deepEqual(elidedPathForms('packages/core/src/lib/'), ['packages/…/src/lib/', 'packages/…/lib/']);
  });
});

describe('elidePath', () => {
  const size = 40;
  const w = (t) => measureText(t, size);

  test('fits: unchanged', () => {
    assert.equal(elidePath('src/a/b/c.js', { maxWidth: w('src/a/b/c.js'), fontSize: size }), 'src/a/b/c.js');
    assert.equal(elidePath('a.js', { maxWidth: 1000, fontSize: size }), 'a.js');
  });

  test('too long: the first form that fits, most kept folders first', () => {
    const p = 'src/components/shared/forms/Input.tsx';
    assert.equal(elidePath(p, { maxWidth: w('src/…/shared/forms/Input.tsx'), fontSize: size }), 'src/…/shared/forms/Input.tsx');
    assert.equal(elidePath(p, { maxWidth: w('src/…/forms/Input.tsx'), fontSize: size }), 'src/…/forms/Input.tsx');
    assert.equal(elidePath(p, { maxWidth: w('src/…/Input.tsx'), fontSize: size }), 'src/…/Input.tsx');
    assert.equal(elidePath(p, { maxWidth: w('src/…/Input.tsx') - 1, fontSize: size }), null);
  });

  test('fewer than 3 segments and too long: null', () => {
    assert.equal(elidePath('src/a-very-long-file-name.js', { maxWidth: 50, fontSize: size }), null);
    assert.equal(elidePath('a-very-long-file-name.js', { maxWidth: 50, fontSize: size }), null);
  });

  test('a multi-repo path keeps its repo label (the first segment)', () => {
    const p = 'api/src/server/handlers/users.js';
    assert.equal(elidePath(p, { maxWidth: w('api/…/handlers/users.js'), fontSize: size }), 'api/…/handlers/users.js');
  });
});

describe('hot-files card: the folder after a deep file is middle-elided', () => {
  const deep = 'src/components/shared/forms/inputs/TextInput.tsx';
  const s = stats([...times(2, [deep]), commit(3, ['README.md'])]);
  for (const [lang] of LANGS) {
    test(lang, () => {
      const svg = svgOf(s, lang, 'hot-files');
      assert.ok(svg.includes('>src/…/forms/inputs/<'), 'first folder, ellipsis, nearest folders');
      assert.ok(!svg.includes('>…forms/inputs/<') && !svg.includes('>…/forms/inputs/<'), 'not cut from the start');
      // The tooltip keeps the full path.
      assert.ok(svg.includes(`<title>${escapeXml(deep)}:`), 'full path in the title');
    });
  }

  for (const [lang] of LANGS) {
    test(`a folder whose elided forms do not fit still falls back to the start cut (${lang})`, () => {
      const long = 'packages/very-long-workspace-name/src/components/shared/forms/inputs/TextInputField.tsx';
      const svg = svgOf(stats([...times(2, [long]), commit(3, ['README.md'])]), lang, 'hot-files');
      assert.ok(/>…\/?forms\/inputs\/</.test(svg), 'start cut');
    });
  }

  test('a short folder is unchanged', () => {
    const svg = svgOf(stats([...times(2, ['src/lib/a.js']), commit(3, ['README.md'])]), 'en', 'hot-files');
    assert.ok(svg.includes('>src/lib/<'));
  });
});

describe('outro: the hottest file is middle-elided', () => {
  for (const [lang] of LANGS) {
    test(lang, () => {
      const p = 'src/app/very/deep/nested/feature/module/handlers/user.go';
      const svg = svgOf(stats([...times(2, [p]), commit(3, ['README.md'])]), lang, 'outro');
      assert.ok(svg.includes('>src/…/handlers/user.go<'), 'first folder + nearest that fit');
      assert.ok(!svg.includes('>…'), 'not cut from the start');
    });
  }

  test('a short path is unchanged', () => {
    const svg = svgOf(stats([...times(2, ['src/lib/a.js']), commit(3, ['README.md'])]), 'en', 'outro');
    assert.ok(svg.includes('>src/lib/a.js<'));
  });
});

describe('co-change row: middle-elided names when the full ones do not fit', () => {
  for (const [lang, L] of LANGS) {
    test(`same-name long paths now get a row (${lang})`, () => {
      const a = 'a/long-folder-name-here/c/x.js';
      const b = 'b/long-folder-name-here/c/x.js';
      const s = stats(times(3, [a, b]));
      const row = hotSpec(s, lang).lines.at(-1);
      // The most kept folders that fit; the two names differ.
      assert.deepEqual(row, { label: 'a/…/c/x.js + b/…/c/x.js', value: L.hotFiles.coChangeTimes(3), description: L.hotFiles.coChangeDescription(a, b, 3) });
      assert.ok(rowFits(row));
      const svg = svgOf(s, lang, 'hot-files');
      assert.ok(svg.includes(escapeXml('a/…/c/x.js + b/…/c/x.js')));
      // stats, the recap and wrapped.md keep the full paths.
      assert.deepEqual(s.coChange.files, [a, b]);
      assert.ok(formatSummary(s, { paths: {} }).includes(`${a} + ${b}`));
      assert.ok(buildMarkdown(s, {}).includes(a) && buildMarkdown(s, {}).includes(b));
    });

    test(`fewer folders when needed, different first folders (${lang})`, () => {
      const row = hotSpec(stats(times(3, ['a/components/shared/x.js', 'b/components/shared/x.js'])), lang).lines.at(-1);
      assert.equal(row.label, 'a/…/x.js + b/…/x.js');
      assert.ok(rowFits(row));
    });
  }

  test('same first folder: elision cannot make them differ, so still no row', () => {
    const s = stats(times(3, ['packages/first-package/src/lib/index.js', 'packages/other-package/src/lib/index.js']));
    for (const [lang, L] of LANGS) {
      const lines = hotSpec(s, lang).lines ?? [];
      assert.equal(lines.find((r) => r.description === L.hotFiles.coChangeDescription('packages/first-package/src/lib/index.js', 'packages/other-package/src/lib/index.js', 3)), undefined);
    }
  });

  test('regression: a short pair renders exactly the same row as before', () => {
    for (const [lang, L] of LANGS) {
      const row = hotSpec(stats(times(3, ['src/a.js', 'src/b.js'])), lang).lines.at(-1);
      assert.deepEqual(row, { label: L.hotFiles.coChange, value: 'a.js + b.js · 3×', description: L.hotFiles.coChangeDescription('src/a.js', 'src/b.js', 3) });
    }
    const same = hotSpec(stats(times(3, ['src/x.js', 'lib/x.js'])), 'en').lines.at(-1);
    assert.deepEqual(same, { label: 'lib/x.js + src/x.js', value: '3× together', description: 'lib/x.js and src/x.js changed together in 3 commits' });
  });
});

/** The dimmed 28px subs (the hot files' folders) drawn on a hot-files card. */
const subsOf = (svg) => [...svg.matchAll(/<text [^>]*font-size="28"[^>]*fill-opacity="0.6"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe('co-change: paths sharing leading folders (monorepo)', () => {
  for (const [lang, L] of LANGS) {
    test(`named from the folder where they differ (${lang})`, () => {
      const a = 'packages/core/src/server/index.js';
      const b = 'packages/web/src/server/index.js';
      const row = hotSpec(stats(times(3, [a, b])), lang).lines.at(-1);
      // Step 1 (tails) and step 2 (first folder: "packages/…/index.js" twice) do not fit or
      // read alike; step 3 from "core"/"web", in the compact shape.
      assert.deepEqual(row, { label: 'core/…/index.js + web/…/index.js', value: L.hotFiles.coChangeTimesShort(3), description: L.hotFiles.coChangeDescription(a, b, 3) });
      assert.ok(rowFits(row));
      assert.ok(svgOf(stats(times(3, [a, b])), lang, 'hot-files').includes(escapeXml('core/…/index.js + web/…/index.js')));
    });

    test(`the README examples render (${lang})`, () => {
      const row = hotSpec(stats(times(3, ['api/src/server/handlers/index.js', 'web/src/server/handlers/index.js'])), lang).lines.at(-1);
      assert.equal(row.label, 'api/…/index.js + web/…/index.js');
      assert.equal(row.value, '3×');
    });

    test(`compact shape: more folders kept when only "3×" fits (${lang})`, () => {
      const row = hotSpec(stats(times(3, ['app/components/shared/util/x.js', 'web/components/shared/util/x.js'])), lang).lines.at(-1);
      assert.deepEqual([row.label, row.value], ['app/…/util/x.js + web/…/util/x.js', '3×']);
    });

    test(`a pair too long for every form is still left out (${lang})`, () => {
      const a = 'app/components/shared/util/a-really-quite-long-component-name.js';
      const b = 'web/components/shared/util/a-really-quite-long-component-name.js';
      const lines = hotSpec(stats(times(3, [a, b])), lang).lines ?? [];
      assert.equal(lines.find((r) => r.description === L.hotFiles.coChangeDescription(a, b, 3)), undefined);
    });

    test(`different file names: no elided names, the row is left out when the names do not fit (${lang})`, () => {
      const a = 'deep/a/b/c/a-really-quite-extraordinarily-long-name-one.js';
      const b = 'deep/a/b/d/a-really-quite-extraordinarily-long-name-two.js';
      const lines = hotSpec(stats(times(3, [a, b])), lang).lines ?? [];
      assert.equal(lines.find((r) => r.description === L.hotFiles.coChangeDescription(a, b, 3)), undefined);
      assert.ok(!lines.some((r) => `${r.label} ${r.value}`.includes('…')));
    });
  }

  test('i18n: the compact count', () => {
    assert.equal(en.hotFiles.coChangeTimesShort(12), '12×');
    assert.equal(tr.hotFiles.coChangeTimesShort(1234), `${tr.num(1234)}×`);
  });
});

describe('hot files: same-name files keep the folder where they differ', () => {
  const p = 'packages/core-x/src/components/forms/inputs/fields/TextInputField.tsx';
  const q = 'packages/web-y/src/components/forms/inputs/fields/TextInputField.tsx';
  const s = stats([...times(3, [p]), ...times(2, [q], 10), commit(20, ['README.md'])]);
  for (const [lang] of LANGS) {
    test(lang, () => {
      const subs = subsOf(svgOf(s, lang, 'hot-files'));
      assert.ok(subs.includes('core-x/…/fields/'), JSON.stringify(subs));
      assert.ok(subs.includes('web-y/…/fields/'), JSON.stringify(subs));
      assert.ok(!subs.includes('packages/…/fields/'), JSON.stringify(subs));
    });
  }

  test('different file names in the same folders: the usual first-folder elision', () => {
    const t = stats([...times(3, ['packages/core-x/src/components/forms/inputs/fields/A.tsx']), ...times(2, ['packages/web-y/src/components/forms/inputs/fields/B.tsx'], 10), commit(20, ['README.md'])]);
    const subs = subsOf(svgOf(t, 'en', 'hot-files'));
    assert.ok(subs.every((x) => !x.startsWith('core-x/') && !x.startsWith('web-y/')), JSON.stringify(subs));
    assert.ok(subs.some((x) => x.startsWith('packages/…/')), JSON.stringify(subs));
  });

  test('a short differing tail is offered whole ("core/forms/", not "packages/…/forms/" twice)', () => {
    const t = stats([...times(10, ['packages/shared/core/forms/InputField.tsx']), ...times(8, ['packages/shared/web/forms/InputField.tsx'], 100)]);
    for (const [lang] of LANGS) {
      const subs = subsOf(svgOf(t, lang, 'hot-files'));
      assert.equal(new Set(subs).size, subs.length, JSON.stringify(subs));
      assert.ok(subs.includes('core/forms/') && subs.includes('web/forms/'), JSON.stringify(subs));
    }
  });

  test('a label with runs of whitespace that draws whole fits', () => {
    assert.ok(rowFits({ label: 'a  b/i.js', value: '3' }));
    assert.ok(rowFits({ label: 'x', value: '1  2' }));
  });

  test('same-name files whose folders fit are unchanged', () => {
    const subs = subsOf(svgOf(stats([...times(3, ['src/core/lib/index.js']), ...times(2, ['src/web/lib/index.js'], 10), commit(20, ['README.md'])]), 'en', 'hot-files'));
    assert.ok(subs.includes('src/core/lib/') && subs.includes('src/web/lib/'), JSON.stringify(subs));
  });
});

describe('multi-repo: the repo label is kept', () => {
  const deep = 'src/server/handlers/really/deeply/nested/users.js';
  const { commits } = mergeHistories([
    { label: 'api', commits: [commit(1, [deep]), commit(2, [deep])] },
    { label: 'web', commits: [commit(3, ['README.md'])] },
  ]);
  const s = computeStats(commits, { today: TODAY, repos: ['api', 'web'] });
  for (const [lang] of LANGS) {
    test(lang, () => {
      assert.equal(s.hotFiles[0].path, `api/${deep}`);
      const subs = subsOf(svgOf(s, lang, 'hot-files'));
      assert.ok(subs.some((x) => x.startsWith('api/…/')), JSON.stringify(subs));
      const outro = svgOf(s, lang, 'outro');
      assert.ok(/>api\/…\/[^<]*users\.js</.test(outro), 'outro keeps the repo label');
    });
  }
});

describe('top folders: single segments keep the middle cut', () => {
  const name = 'a-really-quite-extraordinarily-long-top-level-folder-name-for-the-tests';
  const s = stats([...times(2, [`${name}/x.js`]), commit(3, ['lib/y.js'])]);
  for (const [lang] of LANGS) {
    test(lang, () => {
      const labels = [...svgOf(s, lang, 'hot-files').matchAll(/<text [^>]*font-size="36" font-weight="800"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
      const folder = labels.find((t) => t.includes('…') && t.endsWith('/'));
      assert.ok(folder, JSON.stringify(labels));
      assert.ok(/^a-really-quite…[a-z-]*-for-the-tests\/$/.test(folder), folder); // head + '…' + tail
      assert.ok(!folder.includes('/…/'));
    });
  }
});

describe('audit fixes (turn 088): same-name hot files, edge cases', () => {
  // When no form fits, the part from where they differ is cut in the middle: both its
  // start (the differing folder) and its end stay, so they never read alike.
  for (const [name, p, q, a, b] of [
    ['differing at the end of the folder', 'packages/shared/component-library-alpha-version-one/forms/InputField.tsx', 'packages/shared/component-library-alpha-version-two/forms/InputField.tsx', null, null],
    ['differing at the start of the folder', 'packages/shared/one-component-library-alpha-version/forms/InputField.tsx', 'packages/shared/two-component-library-alpha-version/forms/InputField.tsx', 'one', 'two'],
    ['short differing prefix', 'packages/shared/core-library-alpha-long-name/forms/InputField.tsx', 'packages/shared/web-library-alpha-long-name/forms/InputField.tsx', 'core', 'web'],
  ]) {
    test(`a differing tail too long for every form is cut in the middle, never alike: ${name} (en, tr)`, () => {
      const t = stats([...times(10, [p]), ...times(8, [q], 100)]);
      for (const [lang] of LANGS) {
        const subs = subsOf(svgOf(t, lang, 'hot-files'));
        assert.equal(subs.length, 2, JSON.stringify(subs));
        assert.equal(new Set(subs).size, 2, JSON.stringify(subs));
        assert.ok(subs.every((x) => !x.includes('packages') && x.endsWith('/forms/')), JSON.stringify(subs));
        if (a) assert.ok(subs[0].startsWith(a) && subs[1].startsWith(b), JSON.stringify(subs));
      }
    });
  }

  test('multi-repo: same name in one repo keeps the repo label and the differing folder (en, tr)', () => {
    const { commits } = mergeHistories([
      { label: 'api', commits: [...times(10, ['packages/shared/core/forms/InputField.tsx']), ...times(8, ['packages/shared/web/forms/InputField.tsx'], 50)] },
      { label: 'web', commits: times(3, ['README.md'], 100) },
    ]);
    const t = computeStats(commits, { today: TODAY, repos: ['api', 'web'] });
    for (const [lang] of LANGS) {
      const subs = subsOf(svgOf(t, lang, 'hot-files'));
      assert.ok(subs.includes('api/…/core/forms/') && subs.includes('api/…/web/forms/'), JSON.stringify(subs));
    }
  });

  test('multi-repo: same path in two repos differs at the repo label, which is kept (en, tr)', () => {
    const f = 'packages/core-x/src/components/forms/inputs/fields/TextInputField.tsx';
    const { commits } = mergeHistories([
      { label: 'api', commits: times(10, [f]) },
      { label: 'web', commits: times(8, [f], 100) },
    ]);
    const t = computeStats(commits, { today: TODAY, repos: ['api', 'web'] });
    for (const [lang] of LANGS) {
      const subs = subsOf(svgOf(t, lang, 'hot-files'));
      assert.ok(subs.some((x) => x.startsWith('api/')) && subs.some((x) => x.startsWith('web/')), JSON.stringify(subs));
      assert.ok(!subs.some((x) => x.startsWith('packages/')), JSON.stringify(subs));
    }
  });

  test('rowFits / rowValueFits: runs of whitespace on either side compare as one space', () => {
    assert.ok(rowValueFits('1  2'));
    assert.ok(rowValueFits(' 12 '));
    assert.ok(rowValueFits('1\t\t2'));
    assert.ok(rowFits({ label: '  x  y  ', value: ' 3  ×' }));
    // Still false when the text really is cut.
    assert.ok(!rowValueFits('x '.repeat(200)));
    assert.ok(!rowFits({ label: 'y'.repeat(400), value: '1' }));
  });
});
