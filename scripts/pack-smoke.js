#!/usr/bin/env node
// Packed-tarball smoke test: proves the package as published works, not just the repo.
//
//   npm run pack-smoke            # or: node scripts/pack-smoke.js [--keep]
//
// 1. `npm pack` this repo into a temp dir and check the tarball's file list.
// 2. Install the tarball into a fresh temp project (`npm install <tgz>`). This step needs
//    registry access for @resvg/resvg-js; it is a dev/CI script, not part of the runtime.
// 3. Build the fixture repo (scripts/make-fixture-repo.js) and run the *installed* package
//    on it with `--json --out <tmp>/out`, then check wrapped.html, 10 SVG cards, 10 PNGs +
//    share.png (so resvg's native binary resolved from the install), stats.json and
//    `--version` (also via `npx --no-install gitwrapped`, to prove the bin link works).
// Work dir: a fresh os.tmpdir() dir, or $PACK_SMOKE_DIR if set (created; must be empty).
// It is removed at the end unless --keep is given, or the run failed with $CI set (so CI
// can upload it as an artifact). Each child process gets a 5-minute timeout.
// Exits 1 with a message on failure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureRepo } from './make-fixture-repo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CARD_COUNT = 10;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Top-level files allowed in the tarball besides bin/ and src/. */
const ALLOWED_TOP_FILES = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'];
const REQUIRED_FILES = ['package.json', 'bin/gitwrapped.js', 'src/cli.js', 'README.md', 'CHANGELOG.md', 'LICENSE'];

/** Problems with a tarball file list (from `npm pack --json`), as strings; empty = OK. */
export function checkTarballFiles(paths) {
  const files = paths.map((p) => p.replace(/\\/g, '/').replace(/^package\//, ''));
  const problems = [];
  for (const f of REQUIRED_FILES) if (!files.includes(f)) problems.push(`missing ${f}`);
  for (const f of files) {
    if (/^(test|docs|scripts|\.loop|\.github)\//.test(f) || /(^|\/)node_modules\//.test(f) || /\.test\.js$/.test(f)) {
      problems.push(`must not ship ${f}`);
    }
    else if (!ALLOWED_TOP_FILES.includes(f) && !/^(bin|src)\//.test(f)) problems.push(`unexpected file ${f}`);
  }
  return problems;
}

/** Parse `npm pack --json` stdout into `{filename, files}` (npm may print lifecycle noise first). */
export function parsePackJson(stdout) {
  // The JSON array starts on its own line; noise before it may itself contain '['.
  const m = /^\[/m.exec(stdout);
  if (!m) throw new Error('npm pack --json printed no JSON');
  const start = m.index;
  const entry = JSON.parse(stdout.slice(start))[0];
  if (!entry?.filename || !Array.isArray(entry.files)) throw new Error('npm pack --json: unexpected shape');
  return { filename: entry.filename, files: entry.files.map((f) => f.path) };
}

/** Where npm links the installed bin in a project, per platform. */
export function binLinkPath(projectDir, platform = process.platform) {
  return join(projectDir, 'node_modules', '.bin', platform === 'win32' ? 'gitwrapped.cmd' : 'gitwrapped');
}

/** The installed package's bin script (run with `node` directly, works everywhere). */
export function installedBinScript(projectDir) {
  return join(projectDir, 'node_modules', '@furkycl', 'gitwrapped', 'bin', 'gitwrapped.js');
}

/**
 * Quote an argument for cmd.exe (used only when spawning npm/npx with shell: true on
 * Windows). Double quotes stop & | < > ^ ( ) and spaces, but not %VAR% expansion, so an
 * argument with % (or ") is rejected rather than silently mangled. ! only expands under
 * delayed expansion, which cmd /c does not enable by default, so it is left alone.
 */
export function shellArg(arg, platform = process.platform) {
  if (platform !== 'win32') return arg;
  if (/[%"]/.test(arg)) throw new Error(`cannot pass ${JSON.stringify(arg)} safely through cmd.exe (contains % or ")`);
  return /[\s&|<>^()]/.test(arg) ? `"${arg}"` : arg;
}

/** Width/height of a PNG buffer, or null if it is not a PNG. */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Problems with a gitwrapped `--json --out <out>` result dir; empty = OK. */
export function checkOutputDir(out, expectedCommits) {
  const problems = [];
  if (!existsSync(join(out, 'wrapped.html'))) problems.push('wrapped.html missing');
  const list = (d, ext) => (existsSync(join(out, d)) ? readdirSync(join(out, d)).filter((f) => f.endsWith(ext)) : []);
  const svgs = list('cards', '.svg');
  if (svgs.length !== CARD_COUNT) problems.push(`expected ${CARD_COUNT} SVG cards, got ${svgs.length}`);
  const pngs = list('png', '.png');
  if (pngs.length !== CARD_COUNT) problems.push(`expected ${CARD_COUNT} PNGs, got ${pngs.length}`);
  for (const f of pngs) {
    const size = pngSize(readFileSync(join(out, 'png', f)));
    if (!size || size.width !== 1080 || size.height !== 1920) problems.push(`png/${f} is not a 1080x1920 PNG`);
  }
  const share = existsSync(join(out, 'share.png')) ? pngSize(readFileSync(join(out, 'share.png'))) : null;
  if (!share || share.width !== 1200 || share.height !== 630) problems.push('share.png missing or not 1200x630');
  try {
    const doc = JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'));
    const commits = doc?.stats?.totals?.commits;
    if (commits !== expectedCommits) problems.push(`stats.json totals.commits is ${commits}, expected ${expectedCommits}`);
  } catch (err) {
    problems.push(`stats.json unreadable: ${err.message}`);
  }
  return problems;
}

class SmokeError extends Error {}

export const STEP_TIMEOUT_MS = 5 * 60_000;

function run(cmd, args, { cwd, shell = false, env } = {}) {
  const r = spawnSync(cmd, shell ? args.map((a) => shellArg(a)) : args, {
    cwd,
    encoding: 'utf8',
    shell,
    env: env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: STEP_TIMEOUT_MS,
  });
  const what = `${cmd} ${args.join(' ')}`;
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
  if (r.error?.code === 'ETIMEDOUT') {
    throw new SmokeError(`${what} timed out after ${STEP_TIMEOUT_MS / 60_000} minutes\n${output}`.trimEnd());
  }
  if (r.error) throw new SmokeError(`${what}: ${r.error.message}`);
  if (r.signal) throw new SmokeError(`${what} was killed by ${r.signal}\n${output}`.trimEnd());
  if (r.status !== 0) throw new SmokeError(`${what} exited ${r.status}\n${output}`.trimEnd());
  return r.stdout;
}

/** The work dir: $PACK_SMOKE_DIR (created, must be empty) or a fresh temp dir. */
function makeWorkDir(env) {
  const dir = env.PACK_SMOKE_DIR;
  if (!dir) return mkdtempSync(join(tmpdir(), 'gitwrapped-pack-smoke-'));
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  if (readdirSync(abs).length > 0) throw new SmokeError(`PACK_SMOKE_DIR is not empty: ${abs}`);
  return abs;
}

/** Keep the work dir? On --keep, or on failure in CI (for the artifact upload). */
export function shouldKeep({ keepFlag, failed, env }) {
  return keepFlag || (failed && Boolean(env.CI));
}

const npm = (args, cwd) => run('npm', args, { cwd, shell: process.platform === 'win32' });

function cleanEnv() {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const keepFlag = argv.includes('--keep');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const t0 = Date.now();
  const step = (msg) => process.stdout.write(`pack-smoke: ${msg}\n`);
  let tmp;
  try {
    tmp = makeWorkDir(env);
  } catch (err) {
    process.stderr.write(`pack-smoke: FAILED: ${err.message}\n`);
    return 1;
  }
  let failed = true;
  try {
    // 1. pack
    const packDir = join(tmp, 'pack');
    mkdirSync(packDir);
    const packed = parsePackJson(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], ROOT));
    const tarball = join(packDir, packed.filename);
    if (!existsSync(tarball)) throw new SmokeError(`tarball not found: ${tarball}`);
    const tarProblems = checkTarballFiles(packed.files);
    if (tarProblems.length) throw new SmokeError(`tarball contents:\n  ${tarProblems.join('\n  ')}`);
    step(`packed ${packed.filename} (${packed.files.length} files)`);

    // 2. install into a fresh project
    const project = join(tmp, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'pack-smoke', version: '0.0.0', private: true }, null, 2)}\n`);
    npm(['install', tarball, '--no-audit', '--no-fund', '--loglevel=error'], project);
    const script = installedBinScript(project);
    if (!existsSync(script)) throw new SmokeError(`installed bin script missing: ${script}`);
    if (!existsSync(binLinkPath(project))) throw new SmokeError(`bin link missing: ${binLinkPath(project)}`);
    step('installed tarball into a temp project');

    // 3. version via node and via the npx bin link
    const childEnv = cleanEnv();
    const v1 = run(process.execPath, [script, '--version'], { cwd: project, env: childEnv }).trim();
    const v2 = run('npx', ['--no-install', 'gitwrapped', '--version'], { cwd: project, env: childEnv, shell: process.platform === 'win32' }).trim();
    for (const [how, v] of [['node bin', v1], ['npx bin link', v2]]) {
      if (v !== pkg.version) throw new SmokeError(`--version via ${how} printed "${v}", expected ${pkg.version}`);
    }
    step(`--version ${pkg.version} (node bin + npx bin link)`);

    // 4. full run on the fixture repo
    const fixture = makeFixtureRepo({ dir: join(tmp, 'fixture') });
    const out = join(tmp, 'out');
    run(process.execPath, [script, fixture.dir, '--json', '--no-color', '--out', out], { cwd: project, env: childEnv });
    const outProblems = checkOutputDir(out, fixture.commits.length);
    if (outProblems.length) throw new SmokeError(`output of the installed package:\n  ${outProblems.join('\n  ')}`);
    step(`ran on fixture: ${fixture.commits.length} commits → wrapped.html, ${CARD_COUNT} SVG, ${CARD_COUNT} PNG + share.png, stats.json`);
    step(`OK in ${((Date.now() - t0) / 1000).toFixed(1)}s${keepFlag ? ` (kept ${tmp})` : ''}`);
    failed = false;
    return 0;
  } catch (err) {
    process.stderr.write(`pack-smoke: FAILED: ${err instanceof SmokeError ? err.message : err.stack}\n`);
    if (shouldKeep({ keepFlag, failed, env })) process.stderr.write(`pack-smoke: temp files kept in ${tmp}\n`);
    return 1;
  } finally {
    if (!shouldKeep({ keepFlag, failed, env })) {
      // A failed cleanup (e.g. a locked file on Windows) must never change the result.
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
      } catch (err) {
        process.stderr.write(`pack-smoke: warning: could not remove ${tmp}: ${err.message}\n`);
      }
    }
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    const norm = (p) => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
    return norm(resolve(process.argv[1])) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main();
