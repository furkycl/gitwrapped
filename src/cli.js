import { parseArgs as nodeParseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

export const HELP_TEXT = `Usage: gitwrapped [path] [options]

Turn a git repo's commit log into shareable story cards. Fully local.

Arguments:
  path                 Path to the git repository (default: ".")

Options:
  --since YYYY-MM-DD   Only include commits on or after this date
  --author <email>     Only include commits by this author email
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

function isValidDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d); // avoids Date.UTC mapping years 0-99 to 19xx
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

export function parseArgs(argv) {
  let parsed;
  try {
    parsed = nodeParseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      const m = /'([^']+)'/.exec(err.message);
      throw new Error(`unknown option ${m ? m[1] : ''}`.trim());
    }
    // Node's own messages for missing/unexpected option values are already clear.
    throw new Error(err.message);
  }
  const { values, positionals } = parsed;

  if (positionals.length > 1) {
    throw new Error(`expected at most one path, got ${positionals.length}: ${positionals.join(' ')}`);
  }
  for (const key of ['since', 'author', 'out']) {
    if (values[key] !== undefined && values[key] === '') {
      throw new Error(`--${key} requires a non-empty value`);
    }
  }
  if (values.since !== undefined && !isValidDate(values.since)) {
    throw new Error(`invalid --since date "${values.since}" (expected a real date in YYYY-MM-DD format)`);
  }

  return {
    path: positionals[0] ?? '.',
    since: values.since ?? null,
    author: values.author ?? null,
    out: values.out ?? 'gitwrapped-out',
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

export function getVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr.write(`gitwrapped: ${err.message}\nRun gitwrapped --help for usage.\n`);
    return 2;
  }
  if (opts.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  if (opts.version) {
    stdout.write(`${getVersion()}\n`);
    return 0;
  }
  stdout.write(
    `gitwrapped: options parsed (path=${opts.path}, since=${opts.since ?? 'any'}, ` +
      `author=${opts.author ?? 'any'}, out=${opts.out}). Card generation is not implemented yet.\n`,
  );
  return 0;
}
