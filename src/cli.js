import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildCards, renderShareCard } from './cards/index.js';
import { DEFAULT_LIMIT, readHistory } from './git.js';
import { renderPng } from './png.js';
import { computeStats } from './stats/index.js';
import { formatSummary, shouldUseColor } from './summary.js';
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
  --author <email>     Only include commits by this author email
                       (exact email match, case-insensitive, after .mailmap)
  --out <dir>          Output directory (default: "gitwrapped-out")
  --max-commits <n>    Analyze at most the n most recent commits
                       (default: 50000)
  --no-png             Skip PNG rendering (faster; SVG + HTML only)
  --no-color           Plain console output (also: NO_COLOR=1;
                       FORCE_COLOR=1 forces color)
  -h, --help           Show this help and exit
  -v, --version        Show the version and exit
`;

const OPTIONS = {
  since: { type: 'string' },
  author: { type: 'string' },
  out: { type: 'string' },
  'max-commits': { type: 'string' },
  'no-png': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function validateSince(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    throw new Error(`invalid --since "${value}": expected format YYYY-MM-DD`);
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`invalid --since "${value}": not a real calendar date`);
  }
  return value;
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
 * Returns {help:true}, {version:true}, or {path, since, author, out, png, maxCommits, color}
 * (color: false for --no-color, else undefined = auto).
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

  for (const name of ['since', 'author', 'out', 'max-commits']) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw new Error(`--${name} requires a non-empty value`);
    }
  }

  return {
    // An empty path ("") means the current directory, like the default.
    path: positionals[0] || '.',
    since: values.since === undefined ? undefined : validateSince(values.since),
    author: values.author?.trim(),
    out: values.out?.trim() ?? 'gitwrapped-out',
    png: !values['no-png'],
    maxCommits: values['max-commits'] === undefined ? DEFAULT_LIMIT : validateMaxCommits(values['max-commits']),
    ...(values['no-color'] ? { color: false } : {}),
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

/**
 * Check where the output will go before writing anything: `out` must be (or be creatable
 * as) a directory, every subdirectory (<out>/cards, <out>/png) a directory if it exists,
 * and no output file (wrapped.html, share.*, card files) may be occupied by a directory.
 */
function checkOutputPaths(out, dirs, filePaths) {
  const outSt = statOrNull(out);
  if (outSt && !outSt.isDirectory()) throw outputError(`output path is not a directory: ${out}`);
  for (const { dir, what } of dirs) {
    const st = statOrNull(dir);
    if (st && !st.isDirectory()) throw outputError(`cannot write ${what}: ${dir} exists and is not a directory`);
  }
  for (const p of filePaths) {
    if (statOrNull(p)?.isDirectory()) throw outputError(`cannot write ${p}: a directory is in the way`);
  }
}

function writeOutput(file, data) {
  try {
    writeFileSync(file, data);
  } catch (err) {
    throw outputError(`cannot write ${file}: ${err?.code ?? err?.message ?? err}`);
  }
}

/** Remove share.png and this card set's png/NN-<id>.png files (and png/ if left empty). */
function removeStalePngs(pngDir, sharePngPath, names) {
  const rmFile = (f) => {
    try {
      if (statSync(f).isFile()) unlinkSync(f);
    } catch {
      // missing or not removable: leave it
    }
  };
  rmFile(sharePngPath);
  for (const n of names) rmFile(join(pngDir, n));
  try {
    rmdirSync(pngDir); // only succeeds when empty
  } catch {
    // not empty or missing
  }
}

/**
 * Generate the story into `out`: wrapped.html, cards/NN-<id>.svg, share.svg and (unless
 * `png` is false) png/NN-<id>.png (1080x1920) plus share.png (1200x630).
 * Everything is rendered in memory and the output paths are checked first, so a bad
 * --out fails before anything is written. If the PNG renderer cannot be loaded or fails,
 * the SVG/HTML output is still written and `pngSkipped` holds the reason.
 * At most `maxCommits` (default 50,000) of the most recent commits are analyzed.
 * Returns {commits, stats, repoName, truncated, limit, shallow, html, cardsDir, cardFiles,
 * shareSvg, pngDir, pngFiles, sharePng, pngSkipped} with the written paths (joined onto
 * `out`; PNG paths null/[] when skipped); `truncated` is true when the cap cut the history
 * short, `shallow` when the repo is a shallow clone.
 * `renderPng` (svg, {width}) → Promise<Buffer> replaces the PNG renderer (for tests).
 */
export async function generate({ path, since, author, out, png = true, maxCommits = DEFAULT_LIMIT }, { today, renderPng: rasterize = renderPng } = {}) {
  const { commits, truncated, limit, shallow } = await readHistory(path, { since, author, limit: maxCommits });
  const stats = computeStats(commits, { today });
  const name = await repoName(path);
  const cards = buildCards(stats, { repoName: name, since, author });
  const shareSvg = renderShareCard(stats, { repoName: name, since, author });

  const cardsDir = join(out, 'cards');
  const pngDir = join(out, 'png');
  const html = join(out, 'wrapped.html');
  const shareSvgPath = join(out, 'share.svg');
  const sharePngPath = join(out, 'share.png');
  const page = buildViewerHtml(cards, { title: `gitwrapped · ${name}` });
  const stem = (id, i) => `${String(i + 1).padStart(2, '0')}-${id}`;
  const files = cards.map(({ id, svg }, i) => ({ file: join(cardsDir, `${stem(id, i)}.svg`), svg }));
  const pngTargets = png ? cards.map(({ id, svg }, i) => ({ file: join(pngDir, `${stem(id, i)}.png`), svg, width: 1080 })) : [];
  if (png) pngTargets.push({ file: sharePngPath, svg: shareSvg, width: 1200 });

  const dirs = [{ dir: cardsDir, what: 'cards' }];
  if (png) dirs.push({ dir: pngDir, what: 'PNGs' });
  checkOutputPaths(out, dirs, [html, shareSvgPath, ...files.map((f) => f.file), ...pngTargets.map((t) => t.file)]);

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

  ensureDir(out);
  ensureDir(cardsDir);
  for (const { file, svg } of files) writeOutput(file, svg);
  writeOutput(shareSvgPath, shareSvg);
  writeOutput(html, page);
  if (pngs.length > 0) {
    ensureDir(pngDir);
    for (const { file, data } of pngs) writeOutput(file, data);
  } else {
    // No PNGs this run: drop ones a previous run left behind so nothing stale remains.
    removeStalePngs(pngDir, sharePngPath, cards.map(({ id }, i) => `${stem(id, i)}.png`));
  }
  const pngFiles = pngs.map((p) => p.file).filter((f) => f !== sharePngPath);
  return {
    commits: commits.length,
    stats,
    repoName: name,
    truncated,
    limit,
    shallow: Boolean(shallow),
    html,
    cardsDir,
    cardFiles: files.map((f) => f.file),
    shareSvg: shareSvgPath,
    pngDir: pngs.length > 0 ? pngDir : null,
    pngFiles,
    sharePng: pngs.length > 0 ? sharePngPath : null,
    pngSkipped,
  };
}

/**
 * Run the CLI. Resolves to a process exit code.
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, today, renderPng: rasterize } = {}) {
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
      opts.since || opts.author
        ? `Note: more than ${n} matching commits; only the most recent ${n} were analyzed.`
        : `Note: this repo has more than ${n} commits; only the most recent ${n} were analyzed.`,
    );
  }
  if (result.shallow) {
    notes.push('Note: shallow clone: line counts for the oldest (boundary) commit are skipped, and older history is missing.');
  }
  if (result.commits === 0 && opts.author && !opts.author.includes('@')) {
    notes.push(`Note: no commits by "${opts.author}". --author expects an email address (e.g. you@example.com).`);
  }
  stdout.write(
    formatSummary(result.stats, {
      color: shouldUseColor({ stream: stdout, env, flag: opts.color }),
      repoName: result.repoName,
      notes,
      paths: {
        html: result.html,
        cardsDir: result.cardsDir,
        cardCount: result.cardFiles.length,
        pngDir: result.pngDir,
        pngCount: result.pngFiles.length,
        sharePng: result.sharePng,
        shareSvg: result.shareSvg,
      },
    }),
  );
  if (result.pngSkipped) stderr.write(`gitwrapped: PNG export skipped: ${result.pngSkipped}\n`);
  return 0;
}
