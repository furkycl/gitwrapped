import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

export const HELP_TEXT = `Usage: gitwrapped [path] [options]

Turn a git repo's commit history into shareable story cards.

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

/**
 * Run the CLI. Returns a process exit code.
 */
export function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
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

  const filters = [];
  if (opts.since) filters.push(`since ${opts.since}`);
  if (opts.author) filters.push(`author ${opts.author}`);
  const filterText = filters.length ? ` (${filters.join(', ')})` : '';
  stdout.write(
    `gitwrapped: would analyze ${opts.path}${filterText} into ${opts.out} (not implemented yet)\n`,
  );
  return 0;
}
