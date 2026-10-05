// Languages stat + card (07-languages) and the --open flag.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn as spawnReal, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCards, buildCardSpecs, CARD_IDS } from '../src/cards/index.js';
import { HELP_TEXT, openCommand, openInBrowser, parseCli, run, windowsFileUrl } from '../src/cli.js';
import { buildStatsJson } from '../src/json.js';
import { computeLanguages, computeStats, languageOf, languageType, LANGUAGE_NAMES, OTHER_LANGUAGE, percentShares } from '../src/stats/index.js';
import { formatSummary } from '../src/summary.js';
import { makeFixtureRepo } from '../scripts/make-fixture-repo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/gitwrapped.js', import.meta.url));
const TODAY = '2026-10-05';
const pad = (n) => String(n).padStart(2, '0');
const STEMS = CARD_IDS.map((id, i) => `${pad(i + 1)}-${id}`);

const f = (path, added, removed, binary = false) => ({ path, added, removed, binary });
const c = (...files) => ({ hash: 'h', author: 'A', email: 'a@x', date: '2026-10-04T10:00:00Z', subject: 'feat: x', files });
const langSpec = (stats) => buildCardSpecs(stats).find((x) => x.id === 'languages').spec;

function sink() {
  let text = '';
  return { write: (s) => { text += s; return true; }, get text() { return text; } };
}

function bin(args) {
  const env = { ...process.env, TZ: 'UTC' };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', env });
}

// --- language mapping --------------------------------------------------------------------

describe('languageOf', () => {
  test('maps common extensions, case-insensitively', () => {
    const cases = {
      'src/a.js': 'JavaScript', 'a.mjs': 'JavaScript', 'a.cjs': 'JavaScript', 'App.jsx': 'JavaScript',
      'a.ts': 'TypeScript', 'App.tsx': 'TypeScript', 'types.d.ts': 'TypeScript',
      'x.py': 'Python', 'main.go': 'Go', 'lib.rs': 'Rust', 'A.java': 'Java', 'a.kt': 'Kotlin', 'a.swift': 'Swift',
      'a.c': 'C', 'a.h': 'C', 'a.cpp': 'C++', 'a.hpp': 'C++', 'a.cs': 'C#', 'a.rb': 'Ruby', 'a.php': 'PHP',
      'run.sh': 'Shell', 'index.html': 'HTML', 'a.css': 'CSS', 'a.scss': 'SCSS', 'App.vue': 'Vue', 'App.svelte': 'Svelte',
      'README.md': 'Markdown', 'a.json': 'JSON', 'ci.yml': 'YAML', 'a.yaml': 'YAML', 'Cargo.toml': 'TOML', 'q.sql': 'SQL',
      'a.dart': 'Dart', 'a.lua': 'Lua', 'plot.R': 'R', 'a.scala': 'Scala', 'a.ex': 'Elixir', 'a.hs': 'Haskell',
      'SRC/MAIN.PY': 'Python', 'Index.HTML': 'HTML',
    };
    for (const [path, lang] of Object.entries(cases)) assert.equal(languageOf(path), lang, path);
  });

  test('well-known file names, Dockerfile variants and shell dotfiles', () => {
    assert.equal(languageOf('Dockerfile'), 'Dockerfile');
    assert.equal(languageOf('deploy/Dockerfile.prod'), 'Dockerfile');
    assert.equal(languageOf('api.dockerfile'), 'Dockerfile');
    assert.equal(languageOf('Makefile'), 'Makefile');
    assert.equal(languageOf('sub/GNUmakefile'), 'Makefile');
    assert.equal(languageOf('CMakeLists.txt'), 'CMake');
    assert.equal(languageOf('Gemfile'), 'Ruby');
    assert.equal(languageOf('Jenkinsfile'), 'Groovy');
    assert.equal(languageOf('home/.bashrc'), 'Shell');
  });

  test('no extension, dotfiles, trailing dots, odd input → Other; never throws', () => {
    for (const p of ['LICENSE', 'bin/tool', '.gitignore', '.env', 'a.', 'weird.xyz123', 'dir.js/file', '', null, undefined, 42, {}]) {
      assert.equal(languageOf(p), OTHER_LANGUAGE, String(p));
    }
  });

  test('paths with spaces and unicode; " => " is part of a file name, not a rename', () => {
    assert.equal(languageOf('my docs/read me.md'), 'Markdown');
    assert.equal(languageOf('src/über café/ñ.py'), 'Python');
    assert.equal(languageOf('x.py => y'), OTHER_LANGUAGE);
    assert.equal(languageOf('old.txt => new.rs'), 'Rust');
    assert.equal(languageOf('src/{a.js => b}'), OTHER_LANGUAGE);
    const r = computeLanguages([c(f('x.py => y', 4, 0), f('y', 1, 0))]);
    assert.deepEqual(r.languages.map((l) => [l.name, l.lines, l.files]), [['Other', 5, 2]]);
  });

  test('more languages: lowercase dockerfile, Lisp, Racket, Vim, HDLs, Razor, GDScript, shaders, JSON lines', () => {
    const cases = {
      dockerfile: 'Dockerfile', 'init.el': 'Lisp', 'a.lisp': 'Lisp', 'a.rkt': 'Racket', '.vimrc.vim': 'Vim Script',
      'top.sv': 'SystemVerilog', 'alu.vhd': 'VHDL', 'Page.razor': 'Razor', 'Index.cshtml': 'Razor', 'player.gd': 'GDScript',
      'a.wgsl': 'WGSL', 'a.hlsl': 'HLSL', 'events.jsonl': 'JSON', 'data.csv': 'CSV', 'nb.ipynb': 'Jupyter Notebook',
    };
    for (const [path, lang] of Object.entries(cases)) assert.equal(languageOf(path), lang, path);
  });

  test('languageType: programming, data, prose, other', () => {
    for (const n of ['JavaScript', 'Python', 'HTML', 'CSS', 'SQL', 'Dockerfile', 'Shell']) assert.equal(languageType(n), 'programming', n);
    for (const n of ['JSON', 'YAML', 'TOML', 'XML', 'INI', 'CSV', 'Protocol Buffers']) assert.equal(languageType(n), 'data', n);
    for (const n of ['Markdown', 'MDX', 'Text', 'reStructuredText', 'AsciiDoc', 'TeX']) assert.equal(languageType(n), 'prose', n);
    for (const n of ['Other', 'Klingon', '', undefined]) assert.equal(languageType(n), 'other', String(n));
  });

  test('the table has around 60+ languages, all distinct, Other not among them', () => {
    assert.ok(LANGUAGE_NAMES.length >= 60, String(LANGUAGE_NAMES.length));
    assert.equal(new Set(LANGUAGE_NAMES).size, LANGUAGE_NAMES.length);
    assert.ok(!LANGUAGE_NAMES.includes(OTHER_LANGUAGE));
  });
});

// --- percentages -------------------------------------------------------------------------

describe('percentShares', () => {
  test('largest remainder: distinct values always sum to exactly 100', () => {
    assert.deepEqual(percentShares([23, 6, 2]), [74, 19, 7]);
    assert.deepEqual(percentShares([5]), [100]);
    for (const vals of [[1, 2, 3, 4, 5, 6, 7], [999, 1, 2, 3], [1e15, 3, 7], [0, 0, 1], Array.from({ length: 40 }, (_, i) => i * 7 + 1)]) {
      const s = percentShares(vals);
      assert.equal(s.reduce((a, b) => a + b, 0), 100, String(vals));
      assert.ok(s.every((x) => Number.isInteger(x) && x >= 0));
    }
  });

  test('equal values get equal shares; the sum is as close to 100 as that allows', () => {
    assert.deepEqual(percentShares([1, 1, 1]), [33, 33, 33]);
    assert.deepEqual(percentShares([1, 1]), [50, 50]);
    assert.deepEqual(percentShares([2, 1, 1]), [50, 25, 25]);
    assert.deepEqual(percentShares(Array(7).fill(1)), Array(7).fill(14)); // 98: 105 would be further off
    assert.deepEqual(percentShares([5, 5, 5, 5, 1]), [24, 24, 24, 24, 4]);
    // A tie group that can't be rounded up never lets a smaller value overtake it.
    const v = [10, 10, 10, 9.9];
    const sh = percentShares(v);
    assert.equal(sh[0], sh[1]);
    assert.ok(sh[3] <= sh[0]);
    for (const vals of [[3, 3, 3, 2, 2, 1], Array(13).fill(1), [200, ...Array(20).fill(3), ...Array(20).fill(2), ...Array(19).fill(1)]]) {
      const s = percentShares(vals);
      for (let i = 0; i < vals.length; i++) {
        for (let j = 0; j < vals.length; j++) {
          if (vals[i] === vals[j]) assert.equal(s[i], s[j]);
          if (vals[i] > vals[j]) assert.ok(s[i] >= s[j]);
        }
      }
      const sum = s.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 100) <= vals.length / 2, String(sum));
    }
  });

  test('empty or all zero → zeros', () => {
    assert.deepEqual(percentShares([]), []);
    assert.deepEqual(percentShares([0, 0]), [0, 0]);
  });
});

// --- computeLanguages --------------------------------------------------------------------

describe('computeLanguages', () => {
  test('lines (added + removed) and distinct files per language, sorted, shares sum to 100', () => {
    const r = computeLanguages([
      c(f('src/a.js', 10, 5), f('src/b.ts', 3, 0), f('README.md', 1, 1)),
      c(f('src/a.js', 4, 1), f('src/c.js', 2, 0), f('docs/x.md', 0, 2)),
    ]);
    assert.deepEqual(r, {
      totalLines: 29,
      totalFiles: 5,
      basis: 'lines',
      languages: [
        { name: 'JavaScript', type: 'programming', lines: 22, files: 2, share: 76 },
        { name: 'Markdown', type: 'prose', lines: 4, files: 2, share: 14 },
        { name: 'TypeScript', type: 'programming', lines: 3, files: 1, share: 10 },
      ],
    });
  });

  test('skips lockfiles, build output, dependency / vendored dirs, minified files, snapshots and binary entries', () => {
    const r = computeLanguages([c(
      f('vendor/github.com/x/y.go', 900, 0), f('third_party/z.c', 50, 0), f('src/__snapshots__/a.test.js.snap', 300, 0), f('b.snap', 3, 0),
      f('package-lock.json', 9000, 0), f('yarn.lock', 50, 0), f('Cargo.lock', 1, 1),
      f('dist/bundle.js', 5000, 0), f('packages/ui/build/x.js', 10, 0), f('node_modules/x/i.js', 77, 0),
      f('public/app.min.js', 400, 0), f('app.js.map', 1, 0),
      f('logo.png', 0, 0, true), f('data.bin', '-', '-'), f('weird.js', 0, 0, true),
      f('src/build/ok.js', 2, 0), f('src/main.py', 1, 0),
    )]);
    assert.deepEqual(r.languages.map((l) => [l.name, l.lines, l.files]), [['JavaScript', 2, 1], ['Python', 1, 1]]);
    assert.equal(r.totalFiles, 2);
  });

  test('Other always comes last, even when it is the biggest', () => {
    const r = computeLanguages([c(f('LICENSE', 500, 0), f('a.xyz', 100, 0), f('a.go', 1, 0))]);
    assert.deepEqual(r.languages.map((l) => l.name), ['Go', 'Other']);
    assert.deepEqual(r.languages.map((l) => l.share), [0, 100]);
    assert.equal(r.languages[1].files, 2);
  });

  test('ties: lines desc, then files desc, then name', () => {
    const r = computeLanguages([c(f('a.rb', 5, 0), f('a.py', 5, 0), f('b.py', 0, 0), f('a.go', 5, 0))]);
    assert.deepEqual(r.languages.map((l) => l.name), ['Python', 'Go', 'Ruby']);
    assert.deepEqual(r.languages.map((l) => l.share), [33, 33, 33]);
  });

  test('only zero-line changes → shares by files', () => {
    const r = computeLanguages([c(f('a.md', 0, 0), f('b.md', 0, 0), f('run.sh', 0, 0))]);
    assert.equal(r.basis, 'files');
    assert.deepEqual(r.languages.map((l) => [l.name, l.share]), [['Markdown', 67], ['Shell', 33]]);
  });

  test('empty and junk input', () => {
    const empty = { totalLines: 0, totalFiles: 0, basis: 'lines', languages: [] };
    assert.deepEqual(computeLanguages([]), empty);
    assert.deepEqual(computeLanguages(undefined), empty);
    assert.deepEqual(computeLanguages([null, {}, c(null, { path: 7 }, f('', 1, 1))]), empty);
    const r = computeLanguages([c(f('a.js', NaN, -3), f('b.js', Infinity, '4'))]);
    assert.deepEqual(r.languages, [{ name: 'JavaScript', type: 'programming', lines: 0, files: 2, share: 100 }]);
  });

  test('a path listed twice counts one file, a path with spaces or no extension works', () => {
    const r = computeLanguages([c(f('my dir/a b.js', 1, 0)), c(f('my dir/a b.js', 1, 0), f('scripts/deploy', 3, 0))]);
    assert.deepEqual(r.languages.map((l) => [l.name, l.lines, l.files]), [['JavaScript', 2, 1], ['Other', 3, 1]]);
  });

  test('.h headers: C++ when the history has C++ sources and no .c files, else C', () => {
    const names = (...files) => computeLanguages([c(...files)]).languages.map((l) => [l.name, l.lines, l.files]);
    assert.deepEqual(names(f('a.cpp', 10, 0), f('a.h', 5, 0)), [['C++', 15, 2]]);
    assert.deepEqual(names(f('a.cpp', 10, 0), f('b.c', 1, 0), f('a.h', 5, 0)), [['C++', 10, 1], ['C', 6, 2]]);
    assert.deepEqual(names(f('a.h', 5, 0)), [['C', 5, 1]]);
    assert.deepEqual(names(f('a.h', 5, 0), f('a.py', 1, 0)), [['C', 5, 1], ['Python', 1, 1]]);
  });

  test('computeStats includes it', () => {
    assert.deepEqual(computeStats([c(f('a.py', 1, 0))], { today: TODAY }).languages, computeLanguages([c(f('a.py', 1, 0))]));
  });
});

// --- card --------------------------------------------------------------------------------

describe('languages card', () => {
  test('sits right after hot files as card 07 of 10', () => {
    assert.equal(CARD_IDS.length, 10);
    assert.equal(CARD_IDS.indexOf('languages'), CARD_IDS.indexOf('hot-files') + 1);
    assert.equal(STEMS[6], '07-languages');
    assert.equal(langSpec({}).number, '07');
  });

  test('headline share + "Mostly X", top five bars plus Other', () => {
    const names = ['Python', 'Go', 'Rust', 'Java', 'C', 'Ruby', 'PHP'];
    const files = names.map((n, i) => f(`f${i}.${{ Python: 'py', Go: 'go', Rust: 'rs', Java: 'java', C: 'c', Ruby: 'rb', PHP: 'php' }[n]}`, 70 - i * 10, 0));
    const stats = computeStats([c(...files, f('LICENSE', 5, 0))], { today: TODAY });
    const spec = langSpec(stats);
    assert.equal(spec.eyebrow, 'Your languages');
    assert.equal(spec.big, `${stats.languages.languages[0].share}%`);
    assert.equal(spec.title, 'Led by Python'); // 70 of 285 lines
    assert.match(spec.subtitle, /You wrote in 7 languages across 8 files\.$/);
    const items = spec.chart.items;
    assert.equal(spec.chart.kind, 'hbars');
    assert.deepEqual(items.map((i) => i.label), ['Python', 'Go', 'Rust', 'Java', 'C', 'Other']);
    const shown = items.map((i) => Number(i.value.replace('%', '')));
    assert.equal(shown.reduce((a, b) => a + b, 0), 100);
    assert.equal(items[5].amount, 20 + 10 + 5);
    assert.equal(items[5].sub, '3 files');
  });

  test('"Mostly" from 50%, else "Led by"; the big number is the headline share', () => {
    const half = langSpec(computeStats([c(f('a.py', 50, 0), f('a.go', 30, 0), f('a.rs', 20, 0))], { today: TODAY }));
    assert.equal(half.big, '50%');
    assert.equal(half.title, 'Mostly Python');
    const led = langSpec(computeStats([c(f('a.py', 49, 0), f('a.go', 31, 0), f('a.rs', 20, 0))], { today: TODAY }));
    assert.equal(led.big, '49%');
    assert.equal(led.title, 'Led by Python');
  });

  test('headline and count use programming languages; data / prose only as a fallback', () => {
    const stats = computeStats([c(f('README.md', 500, 0), f('data.json', 300, 0), f('a.py', 100, 0), f('b.go', 50, 0))], { today: TODAY });
    assert.deepEqual(stats.languages.languages.map((l) => [l.name, l.type]), [['Markdown', 'prose'], ['JSON', 'data'], ['Python', 'programming'], ['Go', 'programming']]);
    const spec = langSpec(stats);
    assert.equal(spec.big, '10%');
    assert.equal(spec.title, 'Led by Python');
    assert.match(spec.subtitle, /You wrote in 2 languages across 4 files\.$/);
    assert.deepEqual(spec.chart.items.map((i) => i.label), ['Markdown', 'JSON', 'Python', 'Go']); // all kept in the bars
    assert.ok(formatSummary(stats, {}).includes('Top language Python (10% of lines)'));

    // The headline language is always among the bars, even when five data / prose rows outrank it.
    const crowded = langSpec(computeStats([c(f('a.md', 90, 0), f('a.json', 80, 0), f('a.yml', 70, 0), f('a.toml', 60, 0), f('a.xml', 50, 0), f('a.csv', 40, 0), f('a.sh', 1, 0))], { today: TODAY }));
    assert.equal(crowded.title, 'Led by Shell');
    assert.deepEqual(crowded.chart.items.map((i) => i.label), ['Markdown', 'JSON', 'YAML', 'TOML', 'Shell', 'Other']);

    const docs = langSpec(computeStats([c(f('README.md', 60, 0), f('a.yml', 40, 0))], { today: TODAY }));
    assert.equal(docs.title, 'Mostly Markdown');
    assert.equal(docs.big, '60%');
    assert.match(docs.subtitle, /You wrote in 2 languages/);
  });

  test('single language, ties, tiny shares', () => {
    const one = langSpec(computeStats([c(f('a.rs', 3, 1))], { today: TODAY }));
    assert.equal(one.big, '100%');
    assert.equal(one.title, 'All Rust, all the time');
    assert.match(one.subtitle, /You stuck to 1 language across 1 file\./);
    assert.deepEqual(one.chart.items.map((i) => i.label), ['Rust']);

    const tie = langSpec(computeStats([c(f('a.py', 5, 0), f('a.go', 5, 0))], { today: TODAY }));
    assert.equal(tie.title, 'Tied at the top: Go and Python');
    assert.equal(tie.big, '50%');

    const three = langSpec(computeStats([c(f('a.py', 5, 0), f('a.go', 5, 0), f('a.js', 5, 0), f('a.md', 1, 0))], { today: TODAY }));
    assert.equal(three.title, 'Tied at the top: Go, JavaScript and Python');
    assert.equal(three.big, '31%');
    assert.deepEqual(three.chart.items.slice(0, 3).map((i) => i.value), ['31%', '31%', '31%']);

    const four = langSpec(computeStats([c(f('a.py', 5, 0), f('a.go', 5, 0), f('a.js', 5, 0), f('a.rs', 5, 0))], { today: TODAY }));
    assert.equal(four.title, '4-way tie at the top');
    assert.equal(four.big, '25%');
    assert.ok(formatSummary(computeStats([c(f('a.py', 5, 0), f('a.go', 5, 0))], { today: TODAY }), {}).includes('Top language Go (50% of lines, tied with 1 more)'));

    const tiny = langSpec(computeStats([c(f('a.ts', 100000, 0), f('a.css', 1, 0))], { today: TODAY }));
    assert.equal(tiny.chart.items[1].value, '<1%');
    // TypeScript rounds to 100%, but CSS exists: never "100%" or "All TypeScript".
    assert.equal(tiny.big, '99%');
    assert.equal(tiny.title, 'Mostly TypeScript');
    assert.equal(tiny.chart.items[0].value, '99%');
    const tinyStats = computeStats([c(f('a.ts', 100000, 0), f('LICENSE', 1, 0))], { today: TODAY });
    assert.equal(langSpec(tinyStats).big, '99%');
    assert.equal(langSpec(tinyStats).title, 'Mostly TypeScript');
    assert.ok(formatSummary(tinyStats, {}).includes('Top language TypeScript (99% of lines)'));
  });

  test('no code languages: friendly copy, no chart', () => {
    const none = langSpec(computeStats([], { today: TODAY }));
    assert.equal(none.big, 'None');
    assert.equal(none.title, 'No code languages detected');
    assert.equal(none.chart, undefined);
    const other = langSpec(computeStats([c(f('LICENSE', 4, 0), f('.env', 1, 0))], { today: TODAY }));
    assert.equal(other.title, 'No code languages detected');
    assert.match(other.subtitle, /^2 files changed, none in a language we recognize/);
    for (const s of [{}, { languages: null }, { languages: { languages: 'x' } }, { languages: { languages: [null, { name: '' }, { name: 'Go', lines: NaN, files: -1 }] } }]) {
      const svg = buildCards(s)[CARD_IDS.indexOf('languages')].svg;
      assert.ok(!/NaN|undefined|null|\[object/.test(svg.replace(/<[^>]*>/g, ' ')));
      assert.ok(svg.includes('No code languages detected'));
    }
  });

  test('language names are XML-escaped', () => {
    const svg = buildCards({ languages: { basis: 'lines', totalLines: 1, totalFiles: 1, languages: [{ name: '<x>&"', lines: 1, files: 1, share: 100 }] } })[CARD_IDS.indexOf('languages')].svg;
    assert.ok(!svg.includes('<x>'));
    assert.ok(svg.includes('&lt;x&gt;&amp;'));
  });
});

// --- recap and JSON ----------------------------------------------------------------------

describe('recap and stats.json', () => {
  const stats = computeStats([c(f('a.ts', 72, 0), f('b.js', 28, 0))], { today: TODAY });

  test('terminal recap has a Top language line', () => {
    const out = formatSummary(stats, { repoName: 'demo' });
    assert.ok(out.includes('  Top language TypeScript (72% of lines)\n'), out);
    const none = formatSummary(computeStats([c(f('LICENSE', 1, 0))], { today: TODAY }), {});
    assert.ok(!none.includes('Top language'));
    const evil = formatSummary({ totals: { commits: 1 }, languages: { languages: [{ name: 'Go\x1b[31m', lines: 1, files: 1, share: 0 }] } }, {});
    assert.ok(evil.includes('Top language Go[31m (<1% of lines)'), evil);
  });

  test('stats.json carries languages', () => {
    const doc = JSON.parse(buildStatsJson({ stats, repoName: 'demo', version: '1.0.0' }));
    assert.deepEqual(doc.stats.languages, stats.languages);
    assert.deepEqual(Object.keys(doc.stats.languages), ['totalLines', 'totalFiles', 'basis', 'languages']);
  });
});

// --- --open ------------------------------------------------------------------------------

describe('--open', () => {
  test('openCommand per platform', () => {
    const file = '/tmp/my out/wrapped.html';
    assert.deepEqual(openCommand(file, 'darwin'), { command: 'open', args: [file] });
    assert.deepEqual(openCommand('C:\\Users\\A & B\\100%\\#1\\wrapped.html', 'win32'), {
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', 'file:///C:/Users/A%20&%20B/100%25/%231/wrapped.html'],
    });
    assert.deepEqual(openCommand(file, 'linux'), { command: 'xdg-open', args: [file] });
    assert.deepEqual(openCommand(file, 'freebsd'), { command: 'xdg-open', args: [file] });
  });

  test('windowsFileUrl matches pathToFileURL on Windows (drive and UNC paths)', () => {
    assert.equal(windowsFileUrl('C:\\out\\wrapped.html'), 'file:///C:/out/wrapped.html');
    assert.equal(windowsFileUrl('D:\\my out\\é ?.html'), 'file:///D:/my%20out/%C3%A9%20%3F.html');
    assert.equal(windowsFileUrl('\\\\server\\share\\x y.html'), 'file://server/share/x%20y.html');
  });

  test('parseCli and help know --open', () => {
    assert.equal(parseCli(['--open']).open, true);
    assert.equal('open' in parseCli([]), false);
    assert.match(HELP_TEXT, /--open {2,}Open <out>\/wrapped\.html in your default browser/);
  });

  test('openInBrowser spawns detached, ignores stdio, unrefs, resolves on spawn', async () => {
    const calls = [];
    let unrefd = false;
    const fakeSpawn = (command, args, opts) => {
      calls.push({ command, args, opts });
      const child = new EventEmitter();
      child.unref = () => { unrefd = true; };
      setImmediate(() => child.emit('spawn'));
      return child;
    };
    await openInBrowser('/x/wrapped.html', { platform: 'linux', spawn: fakeSpawn, waitMs: 10 });
    assert.deepEqual(calls, [{ command: 'xdg-open', args: ['/x/wrapped.html'], opts: { detached: true, stdio: 'ignore', windowsHide: true } }]);
    assert.ok(unrefd);
  });

  test('openInBrowser rejects on a spawn error (async ENOENT or a throw)', async () => {
    const enoent = () => {
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })));
      return child;
    };
    await assert.rejects(openInBrowser('/x', { platform: 'linux', spawn: enoent }), { code: 'ENOENT' });
    await assert.rejects(openInBrowser('/x', { platform: 'linux', spawn: () => { throw new Error('boom'); } }), /boom/);
    // A real missing command: no browser is launched, the error is caught.
    await assert.rejects(openInBrowser('/x', { platform: 'linux', spawn: (cmd, args, o) => spawnReal(`gitwrapped-no-such-opener-${process.pid}`, args, o) }), { code: 'ENOENT' });
  });

  describe('run()', () => {
    let fixture;
    let tmp;
    before(() => {
      fixture = makeFixtureRepo();
      tmp = mkdtempSync(join(tmpdir(), 'gw-open-'));
    });
    after(() => {
      fixture?.cleanup();
      if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    });

    test('opens the absolute wrapped.html path once, after writing it', async () => {
      const out = join(tmp, 'ok');
      const opened = [];
      const stdout = sink();
      const stderr = sink();
      const code = await run([fixture.dir, '--no-png', '--open', '--out', out], {
        stdout, stderr, env: {}, today: TODAY,
        openFile: (p) => { opened.push({ p, html: readFileSync(p, 'utf8') }); },
      });
      assert.equal(code, 0);
      assert.equal(stderr.text, '');
      assert.equal(opened.length, 1);
      assert.equal(opened[0].p, resolve(out, 'wrapped.html'));
      assert.match(opened[0].html, /^<!doctype html>/);
      assert.ok(stdout.text.endsWith(`\nOpening ${resolve(out, 'wrapped.html')}…\n`), stdout.text);
    });

    test('no --open → the opener is never called', async () => {
      let called = false;
      const code = await run([fixture.dir, '--no-png', '--out', join(tmp, 'no')], { stdout: sink(), stderr: sink(), env: {}, today: TODAY, openFile: () => { called = true; } });
      assert.equal(code, 0);
      assert.equal(called, false);
    });

    test('a failing opener only warns (rejection or throw), exit code stays 0', async () => {
      const out = join(tmp, 'fail');
      const target = resolve(out, 'wrapped.html');
      for (const openFile of [
        () => Promise.reject(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })),
        () => { throw new Error('no display\nmore'); },
      ]) {
        const stdout = sink();
        const stderr = sink();
        const code = await run([fixture.dir, '--no-png', '--open', '--out', out], { stdout, stderr, env: {}, today: TODAY, openFile });
        assert.equal(code, 0);
        assert.match(stdout.text, /^gitwrapped: 8 commits → /);
        // Announced before the opener runs; the failure follows on stderr.
        assert.ok(stdout.text.includes('Opening '), stdout.text);
        const lines = stderr.text.split('\n').filter(Boolean);
        assert.equal(lines.length, 1, stderr.text);
        assert.ok(lines[0].startsWith('gitwrapped: could not open a browser ('), lines[0]);
        assert.ok(lines[0].endsWith(`open ${target} yourself`), lines[0]);
      }
    });
  });
});

// --- end to end --------------------------------------------------------------------------

describe('bin: languages card end to end', () => {
  let fixture;
  let tmp;
  before(() => {
    fixture = makeFixtureRepo();
    tmp = mkdtempSync(join(tmpdir(), 'gw-languages-'));
  });
  after(() => {
    fixture?.cleanup();
    if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  });

  test('10 cards written, wrapped.html includes the languages card, recap and JSON have it', () => {
    const out = join(tmp, 'fresh');
    const r = bin([fixture.dir, '--out', out, '--no-png', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(join(out, 'cards')).sort(), STEMS.map((s) => `${s}.svg`));
    assert.ok(r.stdout.includes(`10 cards in ${join(out, 'cards')}\n`), r.stdout);
    // Fixture: src/app.js + src/main.js 23 lines, README.md 6, "notes/my notes.txt" 2;
    // package-lock.json and the binary logo.png are skipped.
    assert.ok(r.stdout.includes('Top language JavaScript (74% of lines)'), r.stdout);
    const svg = readFileSync(join(out, 'cards', '07-languages.svg'), 'utf8');
    assert.ok(svg.includes('>74%<'));
    assert.ok(svg.includes('>Mostly JavaScript<'));
    const page = readFileSync(join(out, 'wrapped.html'), 'utf8');
    assert.equal((page.match(/<section class="slide/g) ?? []).length, 10);
    const slide7 = page.split('<section').find((s) => s.includes('id="card-7"'));
    assert.ok(slide7.includes('data-card="languages"'));
    assert.ok(slide7.includes('Mostly JavaScript'));
    const json = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    assert.deepEqual(json.stats.languages.languages.map((l) => [l.name, l.type, l.lines, l.files, l.share]), [
      ['JavaScript', 'programming', 23, 2, 74], ['Markdown', 'prose', 6, 1, 19], ['Text', 'prose', 2, 1, 7],
    ]);
  });

  test('re-run into a 9-card output folder: old 07-09 names are removed, user files stay', () => {
    const out = join(tmp, 'old9');
    const cards = join(out, 'cards');
    const pngs = join(out, 'png');
    mkdirSync(cards, { recursive: true });
    mkdirSync(pngs, { recursive: true });
    const OLD = ['intro', 'totals', 'peak-hour', 'streak', 'activity', 'hot-files', 'messages', 'personality', 'outro'].map((id, i) => `${pad(i + 1)}-${id}`);
    for (const s of OLD) {
      writeFileSync(join(cards, `${s}.svg`), 'old');
      writeFileSync(join(pngs, `${s}.png`), 'old');
    }
    writeFileSync(join(cards, 'notes.txt'), 'mine');
    writeFileSync(join(out, 'wrapped.html'), 'old');
    const r = bin([fixture.dir, '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(cards).sort(), [...STEMS.map((s) => `${s}.svg`), 'notes.txt'].sort());
    assert.deepEqual(readdirSync(pngs).sort(), STEMS.map((s) => `${s}.png`));
    for (const s of STEMS) assert.match(readFileSync(join(cards, `${s}.svg`), 'utf8'), /^<svg\b/, s);
    assert.equal(readFileSync(join(cards, 'notes.txt'), 'utf8'), 'mine');
  });
});
