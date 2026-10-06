import { parseArgs, promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildCards, CARD_IDS, renderShareCard, windowLabel } from './cards/index.js';
import { DEFAULT_LIMIT, readHistory } from './git.js';
import { buildStatsJson } from './json.js';
import { renderPng } from './png.js';
import { computeStats, localToday } from './stats/index.js';
import { formatSummary, shouldUseColor, stripControl } from './summary.js';
import { buildViewerHtml } from './viewer.js';

const execFileAsync = promisify(execFile);

export const HELP_TEXT = `Usage: gitwrapped [path] [options]

Turn a git repo's commit history into shareable story cards.
Writes <out>/wrapped.html (open it in a browser), <out>/cards/*.svg,
<out>/png/*.png (1080x1920) and a 1200x630 share image <out>/share.png (+ .svg).

Arguments:
  path                 Path to the git repository (default: ".")

Options:
  --since YYYY-MM-DD   Only include commits on or after this date
  --until YYYY-MM-DD   Only include commits on or before this date
  --year YYYY          One calendar year: --since YYYY-01-01 --until YYYY-12-31
  --author <email>     Only include commits by this author email
                       (exact email match, case-insensitive, after .mailmap)
  --out <dir>          Output directory (default: "gitwrapped-out")
  --max-commits <n>    Analyze at most the n most recent commits
                       (default: 50000)
  --no-png             Skip PNG rendering (faster; SVG + HTML only)
  --json               Also write every stat to <out>/stats.json
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
  out: { type: 'string' },
  'max-commits': { type: 'string' },
  'no-png': { type: 'boolean' },
  json: { type: 'boolean' },
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
 * plus, only when given: color (false for --no-color; absent = auto), until, year
 * (--year YYYY also sets since/until to Jan 1 / Dec 31 of that year), json (true) and
 * open (true).
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

  if (positionals.length > 1) {
    throw new Error(`expected at most one path, got ${positionals.length}: ${positionals.join(' ')}`);
  }

  for (const name of ['since', 'until', 'year', 'author', 'out', 'max-commits']) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw new Error(`--${name} requires a non-empty value`);
    }
  }

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

  return {
    // An empty path ("") means the current directory, like the default.
    path: positionals[0] || '.',
    since,
    author: values.author?.trim(),
    out: values.out?.trim() ?? 'gitwrapped-out',
    png: !values['no-png'],
    maxCommits: values['max-commits'] === undefined ? DEFAULT_LIMIT : validateMaxCommits(values['max-commits']),
    ...(values['no-color'] ? { color: false } : {}),
    ...(until ? { until } : {}),
    ...(year ? { year } : {}),
    ...(values.json ? { json: true } : {}),
    ...(values.open ? { open: true } : {}),
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

/**
 * Generate the story into `out`: wrapped.html, cards/NN-<id>.svg, share.svg and (unless
 * `png` is false) png/NN-<id>.png (1080x1920) plus share.png (1200x630).
 * Everything is rendered in memory and the output paths are checked first, so a bad
 * --out fails before anything is written. If the PNG renderer cannot be loaded or fails,
 * the SVG/HTML output is still written and `pngSkipped` holds the reason.
 * At most `maxCommits` (default 50,000) of the most recent commits are analyzed.
 * `until` (YYYY-MM-DD, inclusive) ends the window; when it is before `today` (default: the
 * machine's local date) the current streak is computed relative to `until` instead.
 * With `json`, <out>/stats.json (see json.js) is written too.
 * With `author`, the history is read a second time without it (same window and cap) for
 * stats.contributors, which then ranks that author against everyone ("you vs the team");
 * that second read is skipped when the author has no commits in the window.
 * Returns {commits, stats, repoName, truncated, teamTruncated, limit, shallow, unbornWithRefs, html, cardsDir, cardFiles,
 * shareSvg, pngDir, pngFiles, sharePng, pngSkipped, statsJson, asOf, pastWindow} with the
 * written paths
 * (joined onto `out`; PNG paths null/[] when skipped, statsJson null without `json`);
 * `truncated` is true when the cap cut the history short (`teamTruncated`: the unfiltered
 * read of an --author run), `shallow` when the repo is a
 * shallow clone, `unbornWithRefs` when HEAD has no commits but other branches / tags
 * exist; `asOf` is the day the current streak is relative to and `pastWindow`
 * whether that is a past `until`.
 * `renderPng` (svg, {width}) → Promise<Buffer> replaces the PNG renderer (for tests).
 */
export async function generate({ path, since, until, author, out, png = true, maxCommits = DEFAULT_LIMIT, json = false }, { today, renderPng: rasterize = renderPng } = {}) {
  const { commits, truncated, limit, shallow, unborn = false, otherRefs = false } = await readHistory(path, { since, until, author, limit: maxCommits });
  // A past window's "current" streak is the one running when the window closed; its end
  // day is over, so there is no "today isn't over yet" grace day (todayComplete).
  const ref = today ?? localToday();
  const pastWindow = Boolean(until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < ref);
  const asOf = pastWindow ? until : ref;
  // --author filters in git, so the team behind the contributors card ("you vs the
  // team") needs a second read of the same window and cap without the author filter.
  // Not when the author has no commits here: there is no "you" to rank, so no card.
  const team = author && commits.length > 0 ? await readHistory(path, { since, until, limit: maxCommits }) : null;
  const stats = computeStats(commits, {
    today: asOf,
    todayComplete: pastWindow,
    team: team?.commits,
    author,
    // Whether the history the contributors were counted in was capped.
    teamTruncated: team ? Boolean(team.truncated) : Boolean(truncated),
  });
  const name = await repoName(path);
  const cards = buildCards(stats, { repoName: name, since, until, author, today: ref });
  const shareSvg = renderShareCard(stats, { repoName: name, since, until, author, today: ref });

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
      version: readVersion(),
      asOf,
      filters: { since, until, author, maxCommits: limit },
      truncated,
    })
    : null;
  const label = windowLabel({ since, until });
  const page = buildViewerHtml(cards, { title: `gitwrapped · ${name}${label ? ` · ${label}` : ''}` });
  const stem = (id, i) => `${String(i + 1).padStart(2, '0')}-${id}`;
  const files = cards.map(({ id, svg }, i) => ({ file: join(cardsDir, `${stem(id, i)}.svg`), svg }));
  const pngTargets = png ? cards.map(({ id, svg }, i) => ({ file: join(pngDir, `${stem(id, i)}.png`), svg, width: 1080 })) : [];
  if (png) pngTargets.push({ file: sharePngPath, svg: shareSvg, width: 1200 });

  const dirs = [{ dir: cardsDir, what: 'cards' }];
  if (png) dirs.push({ dir: pngDir, what: 'PNGs' });
  checkOutputPaths(out, dirs, [html, shareSvgPath, ...(statsJsonPath ? [statsJsonPath] : []), ...files.map((f) => f.file), ...pngTargets.map((t) => t.file)]);

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
    truncated,
    teamTruncated: Boolean(team?.truncated),
    limit,
    shallow: Boolean(shallow),
    unbornWithRefs: Boolean(unborn && otherRefs),
    html,
    cardsDir,
    cardFiles: files.map((f) => f.file),
    shareSvg: shareSvgPath,
    pngDir: pngs.length > 0 ? pngDir : null,
    pngFiles,
    sharePng: pngs.length > 0 ? sharePngPath : null,
    pngSkipped,
    statsJson: statsJsonPath,
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
 * succeeds. Tests pass their own so no real browser is launched.
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, today, renderPng: rasterize, openFile = openInBrowser } = {}) {
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
    result = await generate(opts, { today, ...(rasterize ? { renderPng: rasterize } : {}) });
  } catch (err) {
    stderr.write(`gitwrapped: ${err?.message ?? String(err)}\n`);
    return 1;
  }
  const notes = [];
  if (result.truncated) {
    const n = result.limit.toLocaleString('en-US');
    notes.push(
      opts.since || opts.until || opts.author
        ? `Note: more than ${n} matching commits; only the most recent ${n} were analyzed.`
        : `Note: this repo has more than ${n} commits; only the most recent ${n} were analyzed.`,
    );
  }
  if (result.teamTruncated && !result.truncated) {
    const n = result.limit.toLocaleString('en-US');
    notes.push(`Note: the contributors card ranks you within the most recent ${n} commits by everyone.`);
  }
  if (result.shallow) {
    notes.push('Note: shallow clone: line counts for the oldest (boundary) commit are skipped, and older history is missing.');
  }
  if (result.unbornWithRefs) {
    notes.push('Note: the current branch (HEAD) has no commits yet, and gitwrapped only reads HEAD\'s history. Check out a branch with commits (e.g. git switch main) and run again.');
  } else if (result.commits === 0 && opts.author && !opts.author.includes('@')) {
    notes.push(`Note: no commits by "${opts.author}". --author expects an email address (e.g. you@example.com).`);
  } else if (result.commits === 0 && (opts.since || opts.until || opts.author)) {
    notes.push(`Note: no commits match ${filterText(opts)}.`);
  }
  stdout.write(
    formatSummary(result.stats, {
      color: shouldUseColor({ stream: stdout, env, flag: opts.color }),
      repoName: result.repoName,
      window: windowLabel(opts),
      streakAtWindowEnd: result.pastWindow,
      today: result.asOf,
      notes,
      paths: {
        html: result.html,
        cardsDir: result.cardsDir,
        cardCount: result.cardFiles.length,
        pngDir: result.pngDir,
        pngCount: result.pngFiles.length,
        sharePng: result.sharePng,
        shareSvg: result.shareSvg,
        statsJson: result.statsJson,
      },
    }),
  );
  if (result.pngSkipped) stderr.write(`gitwrapped: PNG export skipped: ${result.pngSkipped}\n`);
  if (opts.open) {
    const target = resolve(result.html);
    // Say so first: the opener may take up to OPEN_WAIT_MS to report a failure.
    stdout.write(`Opening ${stripControl(target)}…\n`);
    try {
      await openFile(target);
    } catch (err) {
      const why = err?.code ?? (String(err?.message ?? err).split('\n')[0] || 'unknown error');
      stderr.write(`gitwrapped: could not open a browser (${why}); open ${target} yourself\n`);
    }
  }
  return 0;
}
