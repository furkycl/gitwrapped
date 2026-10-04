import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildCards } from './cards/index.js';
import { readCommits } from './git.js';
import { computeStats } from './stats/index.js';
import { buildViewerHtml } from './viewer.js';

const execFileAsync = promisify(execFile);

export const HELP_TEXT = `Usage: gitwrapped [path] [options]

Turn a git repo's commit history into shareable story cards.
Writes <out>/cards/*.svg and <out>/wrapped.html (open it in a browser).

Arguments:
  path                 Path to the git repository (default: ".")

Options:
  --since YYYY-MM-DD   Only include commits on or after this date
  --author <email>     Only include commits by this author email
                       (exact email match, case-insensitive)
  --out <dir>          Output directory (default: "gitwrapped-out")
  -h, --help           Show this help and exit
  -v, --version        Show the version and exit
`;

const OPTIONS = {
  since: { type: 'string' },
  author: { type: 'string' },
  out: { type: 'string' },
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

/**
 * Parse CLI arguments (without node/script prefix).
 * Returns {help:true}, {version:true}, or {path, since, author, out}.
 * Throws an Error with a user-facing message on invalid input.
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
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

  for (const name of ['since', 'author', 'out']) {
    if (values[name] !== undefined && values[name].trim() === '') {
      throw new Error(`--${name} requires a non-empty value`);
    }
  }

  return {
    path: positionals[0] ?? '.',
    since: values.since === undefined ? undefined : validateSince(values.since),
    author: values.author?.trim(),
    out: values.out?.trim() ?? 'gitwrapped-out',
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
 * Name to show for the repo: basename of `git rev-parse --show-toplevel`, falling back to
 * the basename of the resolved path.
 */
export async function repoName(repoPath) {
  const fallback = basename(resolve(repoPath)) || 'your repo';
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
 * as) a directory, <out>/cards a directory, <out>/wrapped.html not a directory, and no
 * card file may be occupied by a directory.
 */
function checkOutputPaths(out, htmlPath, cardsDir, cardPaths) {
  const outSt = statOrNull(out);
  if (outSt && !outSt.isDirectory()) throw outputError(`output path is not a directory: ${out}`);
  if (statOrNull(htmlPath)?.isDirectory()) throw outputError(`cannot write ${htmlPath}: a directory is in the way`);
  const cardsSt = statOrNull(cardsDir);
  if (cardsSt && !cardsSt.isDirectory()) throw outputError(`cannot write cards: ${cardsDir} exists and is not a directory`);
  for (const p of cardPaths) {
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

/**
 * Generate the story into `out`: cards/NN-<id>.svg and wrapped.html.
 * Everything is rendered in memory and the output paths are checked first, so a bad
 * --out fails before anything is written.
 * Returns {commits, html, cardsDir, cardFiles} with the written paths (joined onto `out`).
 */
export async function generate({ path, since, author, out }, { today } = {}) {
  const commits = await readCommits(path, { since, author });
  const stats = computeStats(commits, { today });
  const name = await repoName(path);
  const cards = buildCards(stats, { repoName: name, since, author });

  const cardsDir = join(out, 'cards');
  const html = join(out, 'wrapped.html');
  const page = buildViewerHtml(cards, { title: `gitwrapped · ${name}` });
  const files = cards.map(({ id, svg }, i) => ({
    file: join(cardsDir, `${String(i + 1).padStart(2, '0')}-${id}.svg`),
    svg,
  }));

  checkOutputPaths(out, html, cardsDir, files.map((f) => f.file));
  ensureDir(out);
  ensureDir(cardsDir);
  for (const { file, svg } of files) writeOutput(file, svg);
  writeOutput(html, page);
  return { commits: commits.length, html, cardsDir, cardFiles: files.map((f) => f.file) };
}

/**
 * Run the CLI. Resolves to a process exit code.
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr, today } = {}) {
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
    result = await generate(opts, { today });
  } catch (err) {
    stderr.write(`gitwrapped: ${err?.message ?? String(err)}\n`);
    return 1;
  }
  const noun = result.commits === 1 ? 'commit' : 'commits';
  stdout.write(`gitwrapped: ${result.commits} ${noun} → ${result.html}\n`);
  stdout.write(`  ${result.cardFiles.length} cards in ${result.cardsDir}\n`);
  for (const file of result.cardFiles) stdout.write(`    ${file}\n`);
  return 0;
}
