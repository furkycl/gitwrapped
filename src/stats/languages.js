// Languages: lines changed and files touched per language, from numstat.
import { isIgnoredPath } from './files.js';

/** The bucket for files whose language is not in the table. */
export const OTHER = 'Other';

/** Language → lowercase file extensions (without the dot). */
const BY_EXTENSION = {
  JavaScript: ['js', 'mjs', 'cjs', 'jsx'],
  TypeScript: ['ts', 'mts', 'cts', 'tsx'],
  Python: ['py', 'pyw', 'pyi'],
  // Notebooks are JSON with embedded outputs, so their line counts run high; they still
  // count as Python-ish work, under their own name.
  'Jupyter Notebook': ['ipynb'],
  Go: ['go'],
  Rust: ['rs'],
  Java: ['java'],
  Kotlin: ['kt', 'kts'],
  Swift: ['swift'],
  C: ['c', 'h'],
  'C++': ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'ino'],
  'C#': ['cs', 'csx'],
  'Objective-C': ['m', 'mm'],
  Ruby: ['rb', 'rake', 'gemspec', 'erb'],
  PHP: ['php', 'phtml'],
  Shell: ['sh', 'bash', 'zsh', 'ksh', 'fish'],
  PowerShell: ['ps1', 'psm1', 'psd1'],
  Batchfile: ['bat', 'cmd'],
  HTML: ['html', 'htm', 'xhtml'],
  CSS: ['css'],
  SCSS: ['scss'],
  Sass: ['sass'],
  Less: ['less'],
  Stylus: ['styl'],
  Vue: ['vue'],
  Svelte: ['svelte'],
  Astro: ['astro'],
  Markdown: ['md', 'markdown', 'mdown', 'mkd'],
  MDX: ['mdx'],
  reStructuredText: ['rst'],
  AsciiDoc: ['adoc', 'asciidoc'],
  TeX: ['tex', 'sty', 'cls', 'bib'],
  Text: ['txt'],
  JSON: ['json', 'jsonc', 'json5', 'jsonl', 'ndjson'],
  CSV: ['csv', 'tsv'],
  YAML: ['yml', 'yaml'],
  TOML: ['toml'],
  XML: ['xml', 'xsd', 'xsl', 'xslt'],
  INI: ['ini', 'cfg', 'properties'],
  SQL: ['sql'],
  GraphQL: ['graphql', 'gql'],
  'Protocol Buffers': ['proto'],
  Dart: ['dart'],
  Lua: ['lua'],
  R: ['r', 'rmd'],
  Scala: ['scala', 'sc'],
  Elixir: ['ex', 'exs', 'heex'],
  Erlang: ['erl', 'hrl'],
  Haskell: ['hs', 'lhs'],
  OCaml: ['ml', 'mli'],
  'F#': ['fs', 'fsi', 'fsx'],
  Clojure: ['clj', 'cljs', 'cljc', 'edn'],
  Elm: ['elm'],
  Julia: ['jl'],
  Perl: ['pl', 'pm'],
  Groovy: ['groovy', 'gradle'],
  Zig: ['zig'],
  Nim: ['nim'],
  Crystal: ['cr'],
  Gleam: ['gleam'],
  Solidity: ['sol'],
  HCL: ['tf', 'tfvars', 'hcl'],
  Nix: ['nix'],
  Dockerfile: ['dockerfile'],
  Makefile: ['mk', 'mak'],
  CMake: ['cmake'],
  Assembly: ['asm', 's'],
  WebAssembly: ['wat', 'wast'],
  Fortran: ['f90', 'f95', 'f03', 'for'],
  'Visual Basic': ['vb', 'vbs'],
  Pascal: ['pas'],
  GLSL: ['glsl', 'vert', 'frag'],
  CUDA: ['cu', 'cuh'],
  Handlebars: ['hbs', 'handlebars'],
  Pug: ['pug'],
  Liquid: ['liquid'],
  Prisma: ['prisma'],
  Lisp: ['el', 'lisp', 'lsp'],
  Racket: ['rkt'],
  'Vim Script': ['vim'],
  SystemVerilog: ['sv', 'svh'],
  VHDL: ['vhd', 'vhdl'],
  Razor: ['razor', 'cshtml'],
  GDScript: ['gd'],
  WGSL: ['wgsl'],
  HLSL: ['hlsl'],
};

/** Languages that are data / config formats; everything else not in PROSE is programming. */
const DATA = new Set(['JSON', 'CSV', 'YAML', 'TOML', 'XML', 'INI', 'Protocol Buffers']);
/** Languages that are mostly prose (docs, notes, papers). */
const PROSE = new Set(['Markdown', 'MDX', 'reStructuredText', 'AsciiDoc', 'TeX', 'Text']);

/**
 * The kind of a language: 'programming', 'data' (JSON, YAML, TOML, XML, INI, CSV,
 * Protocol Buffers), 'prose' (Markdown, MDX, reStructuredText, AsciiDoc, TeX, Text) or
 * 'other' for OTHER (unknown file types) and anything not in the table.
 */
export function languageType(name) {
  if (DATA.has(name)) return 'data';
  if (PROSE.has(name)) return 'prose';
  return name !== OTHER && KNOWN.has(name) ? 'programming' : 'other';
}

/** Well-known file names (exact basename) with no telling extension. */
const BY_FILENAME = {
  Containerfile: 'Dockerfile',
  Dockerfile: 'Dockerfile',
  dockerfile: 'Dockerfile',
  Makefile: 'Makefile',
  makefile: 'Makefile',
  GNUmakefile: 'Makefile',
  'CMakeLists.txt': 'CMake',
  Gemfile: 'Ruby',
  Rakefile: 'Ruby',
  Podfile: 'Ruby',
  Vagrantfile: 'Ruby',
  Brewfile: 'Ruby',
  Guardfile: 'Ruby',
  Jenkinsfile: 'Groovy',
  Justfile: 'Makefile',
  justfile: 'Makefile',
  '.bashrc': 'Shell',
  '.bash_profile': 'Shell',
  '.zshrc': 'Shell',
  '.zprofile': 'Shell',
  '.profile': 'Shell',
};

const EXTENSIONS = new Map(Object.entries(BY_EXTENSION).flatMap(([lang, exts]) => exts.map((e) => [e, lang])));

/** Every language name the table knows (OTHER excluded). */
export const LANGUAGE_NAMES = Object.freeze([...new Set([...Object.keys(BY_EXTENSION), ...Object.values(BY_FILENAME)])]);
const KNOWN = new Set(LANGUAGE_NAMES);

/** The lowercase extension of a path's basename ('' for none; a dotfile's leading dot is not one). */
function extensionOf(base) {
  const dot = base.lastIndexOf('.');
  return dot <= 0 || dot === base.length - 1 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * The language of a file path (git's '/'-separated form, taken literally: readCommits
 * uses --no-renames, so " => " is just part of a file name): a well-known file name
 * (Dockerfile, Makefile, Gemfile, CMakeLists.txt, .bashrc, ...), `Dockerfile.<x>`, else the
 * extension after the last '.' of the basename, case-insensitive. A dotfile's leading dot
 * is not an extension (".env" → Other). Unknown or missing → OTHER. `.h` is C here;
 * computeLanguages may count headers as C++ (see there). Never throws.
 */
export function languageOf(path) {
  if (typeof path !== 'string' || path === '') return OTHER;
  const base = path.split('/').pop();
  if (Object.hasOwn(BY_FILENAME, base)) return BY_FILENAME[base];
  if (/^(?:Dockerfile|Containerfile)\./i.test(base)) return 'Dockerfile';
  return EXTENSIONS.get(extensionOf(base)) ?? OTHER;
}

/** A line count as a non-negative finite number; anything else → 0. */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Whole-number percentages of `values`, by the largest remainder method with one rule for
 * ties: equal values always get equal shares.
 * Every value gets floor(exact %); then, in order of largest remainder (ties: earlier
 * first), each group of equal values gets one more point per member, as a whole group,
 * while points are left. A group bigger than the points left is rounded up only if that
 * leaves the total closer to 100 (it may then pass 100 and the pass ends); otherwise it
 * is skipped, and so is every later group with the same floor, so a larger value never
 * ends up with a smaller share.
 * With all values distinct the shares sum to exactly 100. With ties the sum is the
 * closest to 100 these rules allow, off by at most half the size of a tie group
 * ([1, 1, 1] → [33, 33, 33] = 99). All zero / empty → all 0.
 */
export function percentShares(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  const groups = new Map();
  values.forEach((v, i) => {
    if (!groups.has(v)) groups.set(v, { r: exact[i] - shares[i], floor: shares[i], members: [] });
    groups.get(v).members.push(i);
  });
  const order = [...groups.values()].sort((a, b) => b.r - a.r || a.members[0] - b.members[0]);
  const blocked = new Set();
  for (const g of order) {
    if (left <= 0) break;
    if (g.r <= 0 || blocked.has(g.floor)) continue;
    // Round the whole group up only when that leaves the total closer to 100.
    if (g.members.length - left >= left) {
      blocked.add(g.floor);
      continue;
    }
    for (const i of g.members) shares[i] += 1;
    left -= g.members.length;
  }
  return shares;
}

/**
 * Lines changed and files touched per language (shape from src/git.js readCommits).
 * Returns `{totalLines, totalFiles, basis, languages: [{name, type, lines, files, share}]}`:
 * - lines: added + removed lines over all commits; files: distinct paths.
 * - type: 'programming' | 'data' | 'prose' | 'other' (see languageType; OTHER is 'other').
 * - Skipped: ignored paths (lockfiles, build output, dependency and vendored dirs,
 *   snapshots: see isIgnoredPath, the same rules as hot files) and binary entries
 *   (numstat "-", `binary: true`).
 * - `.h` headers count as C++ when the history has C++ sources and no `.c` files, else C.
 * - share: whole percent of `basis` ('lines', or 'files' when no lines changed at all),
 *   from percentShares (equal amounts get equal shares; sums to 100 unless a tie
 *   prevents it); 0 for an empty list.
 * - Sorted by lines desc, then files desc, then name asc; OTHER (unknown file types)
 *   always comes last.
 * Empty input → {totalLines: 0, totalFiles: 0, basis: 'lines', languages: []}.
 */
export function computeLanguages(commits) {
  const byName = new Map();
  const seen = new Set();
  const HEADER = '\0h';
  let hasCSource = false;
  for (const c of commits ?? []) {
    for (const f of c?.files ?? []) {
      if (!f || typeof f.path !== 'string' || f.binary === true || isIgnoredPath(f.path)) continue;
      if (f.added === '-' || f.removed === '-') continue;
      const ext = extensionOf(f.path.split('/').pop());
      let name = languageOf(f.path);
      if (ext === 'h') name = HEADER;
      else if (ext === 'c') hasCSource = true;
      let entry = byName.get(name);
      if (!entry) {
        entry = { name, lines: 0, files: 0 };
        byName.set(name, entry);
      }
      entry.lines += count(f.added) + count(f.removed);
      if (!seen.has(f.path)) {
        seen.add(f.path);
        entry.files += 1;
      }
    }
  }
  const headers = byName.get(HEADER);
  if (headers) {
    byName.delete(HEADER);
    const name = !hasCSource && byName.has('C++') ? 'C++' : 'C';
    const into = byName.get(name);
    if (into) {
      into.lines += headers.lines;
      into.files += headers.files;
    } else {
      byName.set(name, { ...headers, name });
    }
  }
  const list = [...byName.values()].sort(
    (a, b) =>
      (a.name === OTHER) - (b.name === OTHER) ||
      b.lines - a.lines ||
      b.files - a.files ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const totalLines = list.reduce((n, l) => n + l.lines, 0);
  const totalFiles = list.reduce((n, l) => n + l.files, 0);
  const basis = totalLines > 0 || totalFiles === 0 ? 'lines' : 'files';
  const shares = percentShares(list.map((l) => l[basis]));
  return {
    totalLines,
    totalFiles,
    basis,
    languages: list.map((l, i) => ({ name: l.name, type: languageType(l.name), lines: l.lines, files: l.files, share: shares[i] })),
  };
}

const finite = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * What the card and the recap lead with, from a computeLanguages() result (tolerates junk):
 * `{name, share, rawShare, tied, only, count, basis, rows}` or null when no known language.
 * - The headline language is the top programming language; only when there is none, the
 *   top data / prose one. `count` is the number of languages in that same group.
 * - `tied`: every language of the group with the same amount (lines, or files for basis
 *   'files') as the headline one, in list order (length 1 = no tie).
 * - `share` is the share to display: never 100 while other rows (Other included) exist,
 *   so it is capped at 99 then. `rawShare` is the stat's own value.
 * - `only`: it is the one and only row.
 * - `rows`: the sanitized rows `{name, type, lines, files, share}` in list order.
 */
export function languageHeadline(stat) {
  const basis = stat?.basis === 'files' ? 'files' : 'lines';
  const rows = (Array.isArray(stat?.languages) ? stat.languages : [])
    .filter((x) => typeof x?.name === 'string' && x.name.trim() && (finite(x.lines) > 0 || finite(x.files) > 0))
    .map((x) => {
      const name = x.name.trim();
      const type = ['programming', 'data', 'prose', 'other'].includes(x.type) ? x.type : languageType(name);
      return { name, type: name === OTHER ? 'other' : type, lines: finite(x.lines), files: finite(x.files), share: Math.round(finite(x.share)) };
    });
  const known = rows.filter((x) => x.name !== OTHER);
  if (known.length === 0) return null;
  const programming = known.filter((x) => x.type === 'programming');
  const pool = programming.length > 0 ? programming : known;
  const [top] = pool;
  const tied = pool.filter((x) => x[basis] === top[basis]).map((x) => x.name);
  const only = rows.length === 1;
  return {
    name: top.name,
    share: only ? top.share : Math.min(99, top.share),
    rawShare: top.share,
    amount: top[basis],
    tied,
    only,
    count: pool.length,
    basis,
    rows,
  };
}
