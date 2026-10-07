import { parseArgs, promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildCards, CARD_IDS, displayRepoName, renderShareCard, windowLabel } from './cards/index.js';
import { DEFAULT_LIMIT, mergeHistories, readHistory, repoLabels } from './git.js';
import { compileExcludes } from './glob.js';
import { buildStatsJson } from './json.js';
import { buildMarkdown } from './markdown.js';
import { renderPng } from './png.js';
import { computeStats, localParts, localToday } from './stats/index.js';
import { excludeFiles } from './stats/files.js';
import { hasTeamCard } from './stats/contributors.js';
import { formatSummary, shouldUseColor, stripControl } from './summary.js';
import { buildViewerHtml } from './viewer.js';
import { DEFAULT_LANG, getStrings, isLang, LANGS } from './i18n/index.js';
import { COLOR_THEME_NAMES, DEFAULT_COLOR_THEME, isColorTheme } from './cards/themes.js';

const execFileAsync = promisify(execFile);

export const HELP_TEXT = `Usage: gitwrapped [path...] [options]

Turn a git repo's commit history into shareable story cards.
Writes <out>/wrapped.html (open it in a browser), <out>/cards/*.svg,
<out>/png/*.png (1080x1920) and a 1200x630 share image <out>/share.png (+ .svg).

Arguments:
  path                 Path to the git repository (default: ".")
                       Give several paths to merge their histories into one
                       Wrapped (file paths are shown as <repo>/<path>)

Options:
  --since YYYY-MM-DD   Only include commits on or after this date
  --until YYYY-MM-DD   Only include commits on or before this date
  --year YYYY          One calendar year: --since YYYY-01-01 --until YYYY-12-31,
                       compared with the year before (commits, lines, active days)
  --author <email>     Only include commits by this author email
                       (exact email match, case-insensitive, after .mailmap)
  --exclude <glob>     Leave matching files out of lines, files touched, hot
                       files, languages, the biggest commit and commit sizes
                       (repeatable; commits still count).
                       *.min.js and docs match at any depth, docs/ or docs/**
                       a whole folder, src/gen/*.js from the repo root
  --out <dir>          Output directory (default: "gitwrapped-out")
  --lang <code>        Language of the cards, viewer and recap:
                       en (English, default) or tr (Türkçe)
  --theme <name>       Color theme of the cards, share image and viewer:
                       default (gradients), mono (grayscale) or
                       neon (dark with neon glows)
  --max-commits <n>    Analyze at most the n most recent commits
                       (default: 50000; with several repos, in total)
  --no-png             Skip PNG rendering (faster; SVG + HTML only)
  --json               Also write every stat to <out>/stats.json
  --md                 Also write a Markdown summary to <out>/wrapped.md
                       (for READMEs and PR descriptions; links the card SVGs)
  --open               Open <out>/wrapped.html in your default browser
                       when done
  --no-color           Plain console output (also: NO_COLOR=1;
                       FORCE_COLOR=1 forces color)
  -h, --help           Show this help and exit
  -v, --version        Show the version and exit
`;

const OPTIONS = {
  since: { type: 'string' },
  until: { type: 'string' },
  year: { type: 'string' },
  author: { type: 'string' },
  exclude: { type: 'string', multiple: true },
  out: { type: 'string' },
  lang: { type: 'string' },
  theme: { type: 'string' },
  'max-commits': { type: 'string' },
  'no-png': { type: 'boolean' },
  json: { type: 'boolean' },
  md: { type: 'boolean' },
  open: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function validateDate(name, value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    throw new Error(`invalid --${name} "${value}": expected format YYYY-MM-DD`);
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Same range as --year (and git cannot represent earlier dates anyway).
  if (y < 1970) throw new Error(`invalid --${name} "${value}": dates before 1970 are not supported`);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`invalid --${name} "${value}": not a real calendar date`);
  }
  return value;
}

function validateYear(value) {
  const v = value.trim();
  const n = Number(v);
  if (!/^\d{4}$/.test(v) || n < 1970) {
    throw new Error(`invalid --year "${value}": expected a four-digit year from 1970 to 9999`);
  }
  return v;
}

function validateLang(value) {
  const v = value.trim().toLowerCase();
  if (!isLang(v)) throw new Error(`invalid --lang "${value}": expected one of ${LANGS.join(', ')}`);
  return v;
}

function validateTheme(value) {
  const v = value.trim().toLowerCase();
  if (!isColorTheme(v)) throw new Error(`invalid --theme "${value}": expected one of ${COLOR_THEME_NAMES.join(', ')}`);
  return v;
}

function validateMaxCommits(value) {
  const v = value.trim();
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error(`invalid --max-commits "${value}": expected a positive whole number`);
  }
  return n;
}

const VALUE_OPTIONS = new Set(Object.keys(OPTIONS).filter((k) => OPTIONS[k].type === 'string').map((k) => `--${k}`));
const NEGATIVE_NUMBER = /^-\d/;

/**
 * Pre-scan argv for value-taking options followed by a token that starts with "-".
 * Node's parseArgs reports those as "argument is ambiguous"; instead a negative number
 * (`--max-commits -5`) is joined into `--max-commits=-5` so validation gives a precise
 * message, and anything else (`--since --no-png`, or the option last) is "requires a value".
 */
function normalizeArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      out.push(...argv.slice(i));
      break;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && !NEGATIVE_NUMBER.test(next))) {
        throw new Error(`${arg} requires a value`);
      }
      out.push(`${arg}=${next}`);
      i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Parse CLI arguments (without node/script prefix).
 * Returns {help:true}, {version:true}, or {path, since, author, out, png, maxCommits}
 * plus, only when given: paths (every path, when more than one was given; `path` is then
 * the first), color (false for --no-color; absent = auto), until, year
 * (--year YYYY also sets since/until to Jan 1 / Dec 31 of that year), json (true), md (true),
 * open (true), lang (a code from src/i18n LANGS, e.g. 'tr'; absent = English) and
 * theme (a non-default color theme from cards/themes.js, e.g. 'mono'; absent = default)
 * and exclude (the --exclude globs in order, trimmed; see compileGlob in src/glob.js).
 * Throws an Error with a user-facing message on invalid input.
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: normalizeArgv(argv), options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    // Strip Node's verbose suffix (e.g. "To specify a positional argument ...").
    const msg = String(err.message).split(/\.(?:\s|$)/)[0];
    throw new Error(msg);
  }
  const { values, positionals } = parsed;

  if (values.help) return { help: true };
  if (values.version) return { version: true };

  for (const name of ['since', 'until', 'year', 'author', 'out', 'lang', 'theme', 'max-commits']) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw new Error(`--${name} requires a non-empty value`);
    }
  }

  const exclude = (values.exclude ?? []).map((p) => p.trim());
  if (exclude.some((p) => p === '')) throw new Error('--exclude requires a non-empty value');
  compileExcludes(exclude); // throws a user-facing error for a pattern that matches nothing

  // Surrounding whitespace is ignored, as for --year (e.g. a quoted " 2025-01-01").
  let since = values.since === undefined ? undefined : validateDate('since', values.since.trim());
  let until = values.until === undefined ? undefined : validateDate('until', values.until.trim());
  let year;
  if (values.year !== undefined) {
    if (since || until) throw new Error('--year cannot be combined with --since or --until');
    year = validateYear(values.year);
    since = `${year}-01-01`;
    until = `${year}-12-31`;
  }
  // Both are validated YYYY-MM-DD, so string order is date order.
  if (since && until && since > until) {
    throw new Error(`--since ${since} is after --until ${until}`);
  }

  const lang = values.lang === undefined ? undefined : validateLang(values.lang);
  const theme = values.theme === undefined ? undefined : validateTheme(values.theme);

  // An empty path ("") means the current directory, like the default.
  const paths = positionals.map((p) => p || '.');
  return {
    path: paths[0] ?? '.',
    ...(paths.length > 1 ? { paths } : {}),
    since,
    author: values.author?.trim(),
    out: values.out?.trim() ?? 'gitwrapped-out',
    png: !values['no-png'],
    maxCommits: values['max-commits'] === undefined ? DEFAULT_LIMIT : validateMaxCommits(values['max-commits']),
    ...(values['no-color'] ? { color: false } : {}),
    ...(until ? { until } : {}),
    ...(year ? { year } : {}),
    ...(values.json ? { json: true } : {}),
    ...(values.md ? { md: true } : {}),
    ...(values.open ? { open: true } : {}),
    ...(lang ? { lang } : {}),
    ...(theme && theme !== DEFAULT_COLOR_THEME ? { theme } : {}),
    ...(exclude.length > 0 ? { exclude } : {}),
  };
}

export function readVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

function repoEnv() {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR']) delete env[name];
  return env;
}

/**
 * Folder name for a repo path without a work tree: "proj.git" → "proj", and a ".git"
 * directory itself → its parent folder's name.
 */
export function bareRepoName(repoPath) {
  const abs = resolve(repoPath);
  const base = basename(abs);
  if (base === '.git') return basename(dirname(abs));
  return base.replace(/\.git$/, '') || base;
}

/**
 * Name to show for the repo: basename of `git rev-parse --show-toplevel`, falling back to
 * bareRepoName(path) (bare repos and .git dirs have no top level).
 */
export async function repoName(repoPath) {
  const fallback = bareRepoName(repoPath) || 'your repo';
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      env: repoEnv(),
    });
    return basename(stdout.trim()) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * `p` as one canonical string, so two spellings of the same folder compare equal:
 * symlinks resolved with the OS's own realpath (realpathSync.native: on Windows it also
 * expands 8.3 short names such as RUNNER~1, which git never prints but os.tmpdir() may
 * contain, and normalizes "D:/a" to "D:\\a"), lower-cased on Windows; falls back to the
 * JS realpath, then to the resolved path.
 */
export function realKey(p) {
  let real;
  try {
    real = realpathSync.native(p);
  } catch {
    try {
      real = realpathSync(p);
    } catch {
      real = resolve(p);
    }
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Which repository `repoPath` belongs to: `{keys, name, known}`. `keys` identify it: the
 * real path of its top level (absent for a bare repo) and of its common git dir, which
 * every `git worktree` of one repository shares; two paths are the same repository when
 * any key matches. `name` is what repoName() would show. `known` is false when git could
 * not tell (not a repo, missing path, ...): `keys` is then just the path itself.
 */
export async function repoIdentity(repoPath) {
  const ask = async (args) => {
    try {
      const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], { encoding: 'utf8', env: repoEnv() });
      return stdout.trim();
    } catch {
      return '';
    }
  };
  const top = await ask(['rev-parse', '--show-toplevel']);
  // Printed relative to `repoPath` (e.g. ".git") unless it lies elsewhere.
  const common = await ask(['rev-parse', '--git-common-dir']);
  const keys = [top && realKey(top), common && realKey(resolve(repoPath, common))].filter(Boolean);
  if (keys.length === 0) return { keys: [realKey(repoPath)], name: bareRepoName(repoPath) || 'repo', known: false };
  return { keys, name: (top && basename(top)) || bareRepoName(repoPath) || 'repo', known: true };
}

/**
 * Read several repos with the same filters and cap (each read like readHistory) and merge
 * them (see mergeHistories in git.js): commits newest first, labeled with their repo and
 * with "<label>/" path prefixes; at most `limit` in total.
 * Before any history is read, every path is identified (repoIdentity, in the given order):
 * a path git cannot identify fails right there with readHistory's error (so the first bad
 * path is the one named), and two paths of the same repository (including a worktree of
 * one already given) are an error. `labels` (when given) are reused and that check is
 * skipped (the unfiltered second read of an --author run).
 * Returns {commits, truncated, limit, shallow, unborn, otherRefs, unbornRepos, labels}:
 * shallow is true when it is true for any repo; unbornRepos lists the labels of repos
 * whose HEAD has no commits while other branches / tags exist (unborn / otherRefs are
 * true when there is one).
 */
async function readRepos(paths, { since, until, author, limit, labels, coAuthors, tags, reverts }, readFn = readHistory) {
  let names = labels;
  if (!names) {
    const seen = new Map();
    const found = [];
    for (const p of paths) {
      const id = await repoIdentity(p);
      // Not identifiable: let readHistory say why (missing path, not a repo, ownership).
      if (!id.known) await readFn(p, { limit: 1 });
      const dup = id.keys.find((k) => seen.has(k));
      if (dup) throw new Error(`the same repository was given twice: ${seen.get(dup)} and ${p}`);
      for (const k of id.keys) seen.set(k, p);
      found.push(id.name);
    }
    names = repoLabels(found);
  }
  const reads = [];
  for (const p of paths) reads.push(await readFn(p, { since, until, author, limit, ...(coAuthors === false ? { coAuthors } : {}), ...(tags === false ? { tags } : {}), ...(reverts === false ? { reverts } : {}) }));
  const merged = mergeHistories(reads.map((r, i) => ({ label: names[i], commits: r.commits, truncated: r.truncated })), { limit });
  const unbornRepos = names.filter((_, i) => reads[i].unborn && reads[i].otherRefs);
  return {
    commits: merged.commits,
    truncated: merged.truncated,
    limit,
    shallow: reads.some((r) => r.shallow),
    unborn: unbornRepos.length > 0,
    otherRefs: unbornRepos.length > 0,
    unbornRepos,
    labels: names,
  };
}

/** fs.Stats for `p`, or null if nothing is there (or it cannot be inspected). */
function statOrNull(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/** A user-facing Error with a short message (no errno noise, no stack in the CLI). */
function outputError(message) {
  return new Error(message);
}

/**
 * Make sure `dir` exists as a directory, creating missing levels one at a time.
 * Checks the nearest existing ancestor first and fails fast if it is not a writable
 * directory (Node's recursive mkdir can hang on paths like /proc/x).
 */
function ensureDir(dir, label = dir) {
  const missing = [];
  let cur = resolve(dir);
  let st = statOrNull(cur);
  while (!st) {
    missing.unshift(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
    st = statOrNull(cur);
  }
  if (!st) throw outputError(`cannot create output directory: ${label}`);
  if (!st.isDirectory()) {
    throw outputError(missing.length ? `output path is not a directory: ${cur} (needed for ${label})` : `output path is not a directory: ${label}`);
  }
  if (missing.length === 0) return;
  try {
    accessSync(cur, fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    throw outputError(`output directory is not writable: ${cur} (needed for ${label})`);
  }
  for (const p of missing) {
    try {
      mkdirSync(p);
    } catch (err) {
      if (err?.code === 'EEXIST' && statOrNull(p)?.isDirectory()) continue;
      throw outputError(`cannot create output directory ${p}: ${err?.code ?? err?.message ?? err}`);
    }
  }
}

/** fs.Stats for `p` itself (a symlink is not followed), or null if nothing is there. */
function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** The error for an output path inside <out> that is a symlink. */
function symlinkError(p) {
  return outputError(`refusing to write through a symlink: ${p} (remove it or choose another --out)`);
}

/**
 * Check where the output will go before writing anything: `out` must be (or be creatable
 * as) a directory, every subdirectory (<out>/cards, <out>/png) a directory if it exists,
 * and no output file (wrapped.html, share.*, card files) may be occupied by a directory.
 * Symlinks: `out` itself may be one (the user named it), but gitwrapped never writes
 * through a symlink inside it. A subdirectory or output file that is a symlink (even a
 * dangling one) fails the run here, before anything is written, so nothing outside the
 * out dir is ever created, overwritten or deleted through a link.
 */
function checkOutputPaths(out, dirs, filePaths) {
  const outSt = statOrNull(out);
  if (outSt && !outSt.isDirectory()) throw outputError(`output path is not a directory: ${out}`);
  for (const { dir, what } of dirs) {
    if (lstatOrNull(dir)?.isSymbolicLink()) throw symlinkError(dir);
    const st = statOrNull(dir);
    if (st && !st.isDirectory()) throw outputError(`cannot write ${what}: ${dir} exists and is not a directory`);
  }
  for (const p of filePaths) {
    if (lstatOrNull(p)?.isSymbolicLink()) throw symlinkError(p);
    if (statOrNull(p)?.isDirectory()) throw outputError(`cannot write ${p}: a directory is in the way`);
  }
}

// O_NOFOLLOW (POSIX): even if a symlink appears after checkOutputPaths, the write fails
// instead of following it. Not available on Windows, where the check above still applies.
const WRITE_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0);

function writeOutput(file, data) {
  try {
    writeFileSync(file, data, { flag: WRITE_FLAGS });
  } catch (err) {
    if (err?.code === 'ELOOP') throw symlinkError(file);
    throw outputError(`cannot write ${file}: ${err?.code ?? err?.message ?? err}`);
  }
}

/** True when `file` exists and is a regular file (not a symlink). */
function isFile(file) {
  return Boolean(lstatOrNull(file)?.isFile());
}

/** True when `dir` exists and is a real directory (not a symlink to one). */
function isRealDir(dir) {
  return Boolean(lstatOrNull(dir)?.isDirectory());
}

/** Delete `f` only if it is a regular file (never a symlink or its target); else leave it. */
function removeRegularFile(f) {
  try {
    if (isFile(f)) unlinkSync(f);
  } catch {
    // not removable: leave it
  }
}

/**
 * Remove share.png and this card set's png/NN-<id>.png files (and png/ if left empty).
 * Only called when the out dir is ours (see generate). Only regular files are removed,
 * and nothing inside png/ is touched when png/ is a symlink.
 */
function removeStalePngs(pngDir, sharePngPath, names) {
  removeRegularFile(sharePngPath);
  if (!isRealDir(pngDir)) return;
  for (const n of names) removeRegularFile(join(pngDir, n));
  try {
    rmdirSync(pngDir); // only succeeds when empty
  } catch {
    // not empty or missing
  }
}

/**
 * Remove card files an earlier run (possibly an older version with different numbering,
 * e.g. 05-hot-files.svg before the activity card) left in `dir`: only `NN-<card id>.<ext>`
 * names with a known card id that are not in `keep`, and only regular files (symlinks are
 * left alone, and so is everything when `dir` itself is a symlink). Anything else is left
 * alone. Only called when `<out>/wrapped.html` existed before this run (the folder is ours).
 */
function removeOldCardFiles(dir, ext, keep) {
  if (!isRealDir(dir)) return;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const keepSet = new Set(keep);
  for (const n of names) {
    const m = /^\d{2}-([a-z-]+)\.([a-z]+)$/.exec(n);
    if (!m || m[2] !== ext || !CARD_IDS.includes(m[1]) || keepSet.has(n)) continue;
    removeRegularFile(join(dir, n));
  }
}

/** A commit's author-date instant (ms), or null when unparseable. */
function instant(c) {
  const t = Date.parse(c?.date);
  return Number.isNaN(t) ? null : t;
}

/** The oldest of `commits` by author-date instant (null when none parses). */
function oldestCommit(commits) {
  let best = null;
  for (const c of commits) {
    const t = instant(c);
    if (t !== null && (best === null || t < best.t)) best = { c, t };
  }
  return best;
}

/**
 * The commits the contributors card ranks in an --author run whose unfiltered team read
 * (`team`) hit the cap, so both "you" and everyone else cover the same span: everyone's
 * commits are read again (same filters, cap and repos) from the author-local day of the
 * oldest of `mine` (the author's commits in this run). If that read fits the cap, the
 * ranking covers exactly everyone's commits since that oldest commit (so "you" has the
 * commits the totals count); if not, it covers that read, i.e. the most recent commits by
 * everyone, "you" counted within it too. Returns {commits, from ('YYYY-MM-DD', the first
 * day covered), capped} (or the team read itself, `from` null, when no date parses).
 */
async function teamSpan(team, mine, { read, until, limit, labels }) {
  const oldest = oldestCommit(mine);
  const from = oldest ? localParts(oldest.c.date)?.dayKey : null;
  if (!from) return { commits: team.commits, from: null, capped: true };
  const span = await read({ since: from, until, limit, labels, coAuthors: false, tags: false, reverts: false });
  if (!span.truncated) {
    const commits = span.commits.filter((c) => !(instant(c) !== null && instant(c) < oldest.t));
    return { commits, from, capped: false };
  }
  const first = oldestCommit(span.commits);
  return { commits: span.commits, from: (first && localParts(first.c.date)?.dayKey) ?? from, capped: true };
}

/**
 * Generate the story into `out`: wrapped.html, cards/NN-<id>.svg, share.svg and (unless
 * `png` is false) png/NN-<id>.png (1080x1920) plus share.png (1200x630).
 * Everything is rendered in memory and the output paths are checked first, so a bad
 * --out fails before anything is written. If the PNG renderer cannot be loaded or fails,
 * the SVG/HTML output is still written and `pngSkipped` holds the reason.
 * At most `maxCommits` (default 50,000) of the most recent commits are analyzed.
 * `until` (YYYY-MM-DD, inclusive) ends the window; when it is before `today` (default: the
 * machine's local date) the current streak is computed relative to `until` instead.
 * With `json`, <out>/stats.json (see json.js) is written too (language-neutral: `lang`
 * does not change it). With `md`, <out>/wrapped.md (see markdown.js), a Markdown summary
 * in `lang` that links the card SVGs (cards/NN-<id>.svg) and never shows an email.
 * `lang` (a src/i18n code, default 'en') is the language of the cards, the share image
 * and the viewer. `theme` (a cards/themes.js color theme, default 'default') is their
 * colors (stats.json does not change with it either).
 * With `author`, the history is read a second time without it (same window and cap) for
 * stats.contributors, which then ranks that author against everyone ("you vs the team");
 * that second read is skipped when the author has no commits in the window. When it hits
 * the cap (`teamTruncated`), everyone is read once more from the day of the author's
 * oldest commit in this run (see teamSpan), so both sides of the ranking cover the same
 * span; `teamSpan` is then `{from, capped}` (else null).
 * Returns {commits, stats, repoName, truncated, teamTruncated, teamSpan, previousYearTruncated, previousYearError, limit, shallow, unbornWithRefs, html, cardsDir, cardFiles,
 * shareSvg, pngDir, pngFiles, sharePng, pngSkipped, statsJson, markdown, asOf, pastWindow}
 * with the written paths
 * (joined onto `out`; PNG paths null/[] when skipped, statsJson null without `json`,
 * markdown null without `md`);
 * `truncated` is true when the cap cut the history short (`teamTruncated`: the unfiltered
 * read of an --author run), `shallow` when the repo is a
 * shallow clone, `unbornWithRefs` when HEAD has no commits but other branches / tags
 * exist; `asOf` is the day the current streak is relative to and `pastWindow`
 * whether that is a past `until`.
 * With `paths` (two or more repos) their histories are merged (see readRepos): the same
 * filters apply to each, `maxCommits` caps the merged history (the most recent commits by
 * author date across all repos), file paths get a "<repo>/" prefix, stats get a per-repo
 * breakdown (stats.repos), the cards name the run "N repos", and the result has `repos`
 * (the labels) and `unbornRepos` (labels of repos whose HEAD has no commits while other
 * branches / tags exist); `path` is then ignored.
 * With `year` ('YYYY', what --year gave; `since` / `until` are then that year's Jan 1 /
 * Dec 31) the previous calendar year is read too, with the same author filter, repos and
 * cap, for stats.yearOverYear (this year vs the previous one on commits, lines changed
 * and active days; see stats/yoy.js); the totals and outro cards and the recap then show
 * the change (the outro not when it needs the room for the releases panel). That read is skipped when this year has no commits, and nothing is shown
 * when either year has none. Without `year` nothing changes.
 * When that extra read fails, the run goes on without the comparison and the result's
 * `previousYearError` holds the reason (else null); `previousYearTruncated` is true when
 * --max-commits cut the previous year short (its numbers then cover only its most recent
 * commits).
 * With `exclude` (glob patterns, see compileGlob in src/glob.js) the matching files are
 * removed from every commit right after each read (this run's, the team read and the
 * previous year's; see excludeFiles in stats/files.js), so lines, files touched, hot
 * files, languages, per-repo and per-contributor lines and the year-over-year lines all
 * leave them out; commits themselves (counts, days, streaks, habits) are unchanged.
 * stats.json echoes the patterns as `filters.exclude`.
 * `renderPng` (svg, {width}) → Promise<Buffer> replaces the PNG renderer (for tests), and
 * `readHistory` (same contract as git.js readHistory) the history reader.
 */
export async function generate({ path, paths, since, until, year, author, exclude = [], out, png = true, maxCommits = DEFAULT_LIMIT, json = false, md = false, lang = DEFAULT_LANG, theme = DEFAULT_COLOR_THEME }, { today, renderPng: rasterize = renderPng, readHistory: readFn = readHistory } = {}) {
  const multi = Array.isArray(paths) && paths.length > 1;
  const isExcluded = compileExcludes(exclude);
  const readRaw = (opts) => (multi ? readRepos(paths, opts, readFn) : readFn(path, opts));
  // --exclude: drop matching files from every read, so all stats see the same files.
  const read = isExcluded
    ? async (opts) => {
      const r = await readRaw(opts);
      return { ...r, commits: excludeFiles(r.commits, isExcluded) };
    }
    : readRaw;
  const { commits, truncated, limit, shallow, unborn = false, otherRefs = false, labels, unbornRepos } = await read({ since, until, author, limit: maxCommits });
  // A past window's "current" streak is the one running when the window closed; its end
  // day is over, so there is no "today isn't over yet" grace day (todayComplete).
  const ref = today ?? localToday();
  const pastWindow = Boolean(until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < ref);
  const asOf = pastWindow ? until : ref;
  // --author filters in git, so the team behind the contributors card ("you vs the
  // team") needs a second read of the same window and cap without the author filter.
  // Not when the author has no commits here: there is no "you" to rank, so no card.
  // (Co-authors, releases and reverts are counted from the main read only: no .mailmap,
  // tag or revert call for this one.)
  const team = author && commits.length > 0 ? await read({ since, until, limit: maxCommits, labels, coAuthors: false, tags: false, reverts: false }) : null;
  // --year: the previous calendar year, read with the same filters and cap, for the
  // year-over-year comparison (stats.yearOverYear). Only when the window is exactly that
  // year, and not when it has no commits: there is nothing to compare (see stats/yoy.js).
  // The comparison is an extra: if its read fails, the run goes on without it.
  const isYear = year !== undefined && /^\d{4}$/.test(String(year)) && since === `${year}-01-01` && until === `${year}-12-31`;
  const prevYear = isYear ? Number(year) - 1 : null;
  let previous = null;
  let previousYearError = null;
  if (prevYear && commits.length > 0) {
    try {
      previous = await read({ since: `${prevYear}-01-01`, until: `${prevYear}-12-31`, author, limit: maxCommits, labels, coAuthors: false, tags: false, reverts: false });
    } catch (err) {
      previousYearError = String(err?.message ?? err).split('\n')[0] || 'unknown error';
    }
  }
  // A capped team read holds only everyone's most recent commits, which can leave out some
  // (or all) of yours: rank everyone over the span your commits cover instead.
  const span = team?.truncated ? await teamSpan(team, commits, { read, until, limit: maxCommits, labels }) : null;
  const teamCommits = span ? span.commits : team?.commits;
  const stats = computeStats(commits, {
    today: asOf,
    todayComplete: pastWindow,
    team: teamCommits,
    author,
    // Whether the history the contributors were counted in was capped.
    teamTruncated: team ? Boolean(team.truncated) : Boolean(truncated),
    ...(multi ? { repos: labels } : {}),
    ...(previous ? { previousYear: { year: prevYear + 1, commits: previous.commits, truncated: Boolean(previous.truncated) } } : {}),
  });
  // Several repos are named together ("3 repos", in `lang`); one repo by its folder.
  const name = multi ? displayRepoName(stats, { lang }) : await repoName(path);
  const cards = buildCards(stats, { repoName: name, since, until, author, today: ref, lang, colorTheme: theme });
  const shareSvg = renderShareCard(stats, { repoName: name, since, until, author, today: ref, lang, colorTheme: theme });

  const cardsDir = join(out, 'cards');
  const pngDir = join(out, 'png');
  const html = join(out, 'wrapped.html');
  const shareSvgPath = join(out, 'share.svg');
  const sharePngPath = join(out, 'share.png');
  const statsJsonPath = json ? join(out, 'stats.json') : null;
  const statsJson = json
    ? buildStatsJson({
      stats,
      repoName: name,
      ...(multi ? { repos: labels } : {}),
      version: readVersion(),
      asOf,
      filters: { since, until, author, maxCommits: limit, exclude },
      truncated,
    })
    : null;
  const label = windowLabel({ since, until, lang });
  const stem = (id, i) => `${String(i + 1).padStart(2, '0')}-${id}`;
  const markdownPath = md ? join(out, 'wrapped.md') : null;
  const markdown = md
    ? buildMarkdown(stats, {
      repoName: name,
      window: label,
      author,
      today: ref,
      streakAtWindowEnd: pastWindow,
      lang,
      cards: cards.map(({ id }, i) => ({ id, file: `cards/${stem(id, i)}.svg` })),
    })
    : null;
  const page = buildViewerHtml(cards, { title: `gitwrapped · ${name}${label ? ` · ${label}` : ''}`, lang, colorTheme: theme });
  const files = cards.map(({ id, svg }, i) => ({ file: join(cardsDir, `${stem(id, i)}.svg`), svg }));
  const pngTargets = png ? cards.map(({ id, svg }, i) => ({ file: join(pngDir, `${stem(id, i)}.png`), svg, width: 1080 })) : [];
  if (png) pngTargets.push({ file: sharePngPath, svg: shareSvg, width: 1200 });

  const dirs = [{ dir: cardsDir, what: 'cards' }];
  if (png) dirs.push({ dir: pngDir, what: 'PNGs' });
  checkOutputPaths(out, dirs, [html, shareSvgPath, ...(statsJsonPath ? [statsJsonPath] : []), ...(markdownPath ? [markdownPath] : []), ...files.map((f) => f.file), ...pngTargets.map((t) => t.file)]);

  // Rasterize before writing anything, so a renderer failure never leaves half a PNG set.
  let pngs = [];
  let pngSkipped = null;
  if (png) {
    try {
      for (const t of pngTargets) pngs.push({ file: t.file, data: await rasterize(t.svg, { width: t.width }) });
    } catch (err) {
      pngs = [];
      pngSkipped = String(err?.message ?? err).split('\n')[0] || 'unknown error';
    }
  }

  // A wrapped.html from an earlier run (a regular file, not a symlink) marks the folder as
  // gitwrapped output. gitwrapped only ever deletes files in a folder it owns: old-numbered
  // card files from an earlier card set, and with --no-png the PNGs a previous run left.
  const ownsOut = isFile(html);
  ensureDir(out);
  ensureDir(cardsDir);
  for (const { file, svg } of files) writeOutput(file, svg);
  if (ownsOut) removeOldCardFiles(cardsDir, 'svg', files.map((f) => basename(f.file)));
  writeOutput(shareSvgPath, shareSvg);
  writeOutput(html, page);
  // Without --json an existing stats.json is left alone (like any file that is not a card).
  if (statsJsonPath) writeOutput(statsJsonPath, statsJson);
  // Likewise without --md an existing wrapped.md is left alone.
  if (markdownPath) writeOutput(markdownPath, markdown);
  if (pngs.length > 0) {
    ensureDir(pngDir);
    for (const { file, data } of pngs) writeOutput(file, data);
    if (ownsOut) removeOldCardFiles(pngDir, 'png', pngs.map((p) => basename(p.file)));
  } else {
    // No PNGs this run: drop ones a previous run left behind so nothing stale remains
    // (only in a folder that is ours: a first run into a user's folder deletes nothing).
    if (ownsOut) {
      removeOldCardFiles(pngDir, 'png', []);
      removeStalePngs(pngDir, sharePngPath, cards.map(({ id }, i) => `${stem(id, i)}.png`));
    }
  }
  const pngFiles = pngs.map((p) => p.file).filter((f) => f !== sharePngPath);
  return {
    commits: commits.length,
    stats,
    repoName: name,
    ...(multi ? { repos: labels } : {}),
    truncated,
    teamTruncated: Boolean(team?.truncated),
    teamSpan: span ? { from: span.from, capped: span.capped } : null,
    previousYearTruncated: Boolean(stats.yearOverYear?.previousTruncated),
    previousYearError,
    limit,
    shallow: Boolean(shallow),
    unbornWithRefs: Boolean(unborn && otherRefs),
    ...(multi ? { unbornRepos } : {}),
    html,
    cardsDir,
    cardFiles: files.map((f) => f.file),
    shareSvg: shareSvgPath,
    pngDir: pngs.length > 0 ? pngDir : null,
    pngFiles,
    sharePng: pngs.length > 0 ? sharePngPath : null,
    pngSkipped,
    statsJson: statsJsonPath,
    markdown: markdownPath,
    asOf,
    pastWindow,
  };
}

/**
 * A Windows path as a file:// URL, the same as url.pathToFileURL() gives on Windows, but
 * on any platform (so it is testable everywhere): "C:\\a b\\x.html" →
 * "file:///C:/a%20b/x.html", "\\\\server\\share\\x.html" → "file://server/share/x.html".
 */
export function windowsFileUrl(file) {
  let p = String(file).replace(/\\/g, '/');
  const url = new URL('file:///');
  const unc = /^\/\/([^/]+)(\/.*)?$/.exec(p);
  if (unc) {
    url.hostname = unc[1];
    p = unc[2] ?? '/';
  } else if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  // The pathname setter encodes spaces, # and ?, but leaves a literal % alone.
  url.pathname = p.replace(/%/g, '%25');
  return url.href;
}

/**
 * The command that opens `file` with the system's default handler (a browser for .html)
 * on `platform` (process.platform), as `{command, args}` for spawn() without a shell:
 * - darwin: `open <file>`
 * - win32: `rundll32 url.dll,FileProtocolHandler <file:// URL>` (see windowsFileUrl). No
 *   cmd.exe is involved, so characters like & ^ % in the path are never parsed as shell
 *   syntax (`cmd /c start` would), and unlike `explorer.exe` it does not misread paths
 *   containing commas. A percent-encoded URL keeps spaces, # and ? intact.
 * - anything else: `xdg-open <file>`
 */
export function openCommand(file, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [file] };
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', windowsFileUrl(file)] };
  return { command: 'xdg-open', args: [file] };
}

/** How long --open waits for the opener command to fail before moving on. */
export const OPEN_WAIT_MS = 1500;

/**
 * Open `file` in the default browser: spawn openCommand() detached, with stdio ignored
 * and unref'd, so it never keeps gitwrapped running past the wait below.
 * Rejects with the spawn error (e.g. ENOENT when xdg-open is missing), or with an Error
 * when the opener exits with a non-zero code within `waitMs` (default OPEN_WAIT_MS),
 * e.g. xdg-open finding no browser. Resolves when it exits with 0, is ended by a signal,
 * or is still running after `waitMs`: gitwrapped then moves on and never waits for the
 * browser itself. `spawn`, `platform` and `waitMs` can be replaced for tests.
 */
export function openInBrowser(file, { platform = process.platform, spawn: spawnFn = spawn, waitMs = OPEN_WAIT_MS } = {}) {
  const { command, args } = openCommand(file, platform);
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawnFn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let timer = null;
    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolvePromise();
    };
    child.once('error', settle);
    child.once('exit', (code) => {
      settle(typeof code === 'number' && code !== 0 ? new Error(`${command} exited with code ${code}`) : null);
    });
    // The timer (not the child) keeps the process alive for at most waitMs.
    child.once('spawn', () => {
      if (!settled) timer = setTimeout(() => settle(null), waitMs);
    });
    child.unref?.();
  });
}

/** The date / author filters of `opts` as CLI flags, e.g. "--year 2025 --author a@b.c". */
function filterText({ since, until, year, author }) {
  const parts = year ? [`--year ${year}`] : [since && `--since ${since}`, until && `--until ${until}`];
  if (author) parts.push(`--author ${author}`);
  return parts.filter(Boolean).join(' ');
}

/**
 * Run the CLI. Resolves to a process exit code.
 * `openFile(path)` (default openInBrowser) opens wrapped.html for --open; it may return a
 * promise. If it throws or rejects, a one-line warning goes to stderr and the run still
 * succeeds. Tests pass their own so no real browser is launched. `renderPng` and
 * `readHistory` are passed on to generate() (for tests).
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, today, renderPng: rasterize, readHistory: readFn, openFile = openInBrowser } = {}) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (err) {
    stderr.write(`gitwrapped: ${err.message}\n`);
    stderr.write(`Run "gitwrapped --help" for usage.\n`);
    return 2;
  }

  if (opts.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  if (opts.version) {
    stdout.write(`${readVersion()}\n`);
    return 0;
  }

  let result;
  try {
    result = await generate(opts, { today, ...(rasterize ? { renderPng: rasterize } : {}), ...(readFn ? { readHistory: readFn } : {}) });
  } catch (err) {
    stderr.write(`gitwrapped: ${err?.message ?? String(err)}\n`);
    return 1;
  }
  const L = getStrings(opts.lang);
  const N = L.notes;
  const limitText = () => L.num(result.limit);
  const notes = [];
  if (result.truncated) {
    const n = limitText();
    notes.push(opts.since || opts.until || opts.author ? N.truncatedFiltered(n) : opts.paths ? N.truncatedRepos(n) : N.truncated(n));
  }
  // Only when the team card is built: there is no ranking to qualify otherwise.
  if (result.teamTruncated && hasTeamCard(result.stats)) {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result.teamSpan?.from ?? '');
    const from = day ? L.date(+day[3], +day[2], day[1]) : null;
    notes.push(result.teamSpan && !result.teamSpan.capped && from ? N.teamSince(limitText(), from) : N.teamTruncated(limitText(), from));
  }
  if (result.previousYearTruncated) {
    notes.push(N.previousYearTruncated(limitText(), result.stats.yearOverYear.previousYear));
  }
  if (result.shallow) {
    notes.push(N.shallow);
  }
  if (result.unbornWithRefs) {
    notes.push(result.unbornRepos ? N.unbornRepos(L.andList(result.unbornRepos.map(stripControl))) : N.unborn);
  } else if (result.commits === 0 && opts.author && !opts.author.includes('@')) {
    notes.push(N.authorNotEmail(opts.author));
  } else if (result.commits === 0 && (opts.since || opts.until || opts.author)) {
    notes.push(N.noMatch(filterText(opts)));
  }
  stdout.write(
    formatSummary(result.stats, {
      color: shouldUseColor({ stream: stdout, env, flag: opts.color }),
      repoName: result.repoName,
      window: windowLabel(opts),
      streakAtWindowEnd: result.pastWindow,
      today: result.asOf,
      notes,
      lang: opts.lang,
      paths: {
        html: result.html,
        cardsDir: result.cardsDir,
        cardCount: result.cardFiles.length,
        pngDir: result.pngDir,
        pngCount: result.pngFiles.length,
        sharePng: result.sharePng,
        shareSvg: result.shareSvg,
        statsJson: result.statsJson,
        markdown: result.markdown,
      },
    }),
  );
  if (result.pngSkipped) stderr.write(`gitwrapped: PNG export skipped: ${result.pngSkipped}\n`);
  if (result.previousYearError) stderr.write(`gitwrapped: year-over-year comparison skipped: ${result.previousYearError}\n`);
  if (opts.open) {
    const target = resolve(result.html);
    // Say so first: the opener may take up to OPEN_WAIT_MS to report a failure.
    stdout.write(`${L.recap.opening(stripControl(target))}\n`);
    try {
      await openFile(target);
    } catch (err) {
      const why = err?.code ?? (String(err?.message ?? err).split('\n')[0] || 'unknown error');
      stderr.write(`gitwrapped: could not open a browser (${why}); open ${target} yourself\n`);
    }
  }
  return 0;
}
