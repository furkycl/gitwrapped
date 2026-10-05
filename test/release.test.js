import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const workflowPath = path.join('.github', 'workflows', 'publish.yml');
const workflow = read(workflowPath);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal, dependency-free parsing of the workflow's job steps.
// Each step starts with "- " at the steps' list indentation.
function parseSteps(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
  assert.ok(start >= 0, 'workflow has a steps: list');
  const stepIndent = lines.slice(start + 1).find((l) => /^\s*- /.test(l)).match(/^(\s*)/)[1].length;
  const steps = [];
  let cur = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.match(/^(\s*)/)[1].length < stepIndent) break;
    if (line.match(/^(\s*)- /) && line.match(/^(\s*)/)[1].length === stepIndent) {
      cur = { lines: [line.slice(stepIndent + 2)] };
      steps.push(cur);
    } else if (cur) {
      cur.lines.push(line.length > stepIndent + 2 ? line.slice(stepIndent + 2) : line.trim());
    }
  }
  return steps.map((s) => {
    const text = s.lines.join('\n');
    const name = (text.match(/^name:\s*(.+)$/m) || [])[1] || '';
    return { text, name: name.trim(), run: extractRun(s.lines) };
  });
}

// Returns the run: script of a step (block scalar dedented, or the inline value).
function extractRun(stepLines) {
  const i = stepLines.findIndex((l) => /^run:/.test(l));
  if (i < 0) return null;
  const inline = stepLines[i].replace(/^run:\s*/, '');
  if (!/^[|>][-+]?\s*$/.test(inline)) return inline;
  const body = [];
  for (const l of stepLines.slice(i + 1)) {
    if (l.trim() !== '' && !/^\s/.test(l)) break;
    body.push(l);
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length));
  return body.map((l) => l.slice(indent)).join('\n') + '\n';
}

const steps = parseSteps(workflow);
const stepIndex = (pred) => steps.findIndex(pred);
const runMatches = (re) => (s) => s.run !== null && re.test(s.run);

const guardIdx = stepIndex(
  (s) => s.run !== null && /\$\{?TAG/.test(s.run) && /package\.json/.test(s.run) && /exit 1/.test(s.run),
);

function hasBash() {
  if (process.platform === 'win32') return false;
  const r = spawnSync('bash', ['-c', 'exit 0']);
  return r.status === 0;
}

// --- version ---------------------------------------------------------------

test('package.json version is 1.0.0', () => {
  assert.equal(pkg.version, '1.0.0');
});

test('package-lock.json version matches package.json', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
});

test('gitwrapped --version prints the package version', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'gitwrapped.js'), '--version'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '1.0.0');
});

// --- changelog -------------------------------------------------------------

test('CHANGELOG.md has a dated heading for the package version', () => {
  assert.ok(existsSync(path.join(root, 'CHANGELOG.md')));
  const cl = read('CHANGELOG.md');
  const m = cl.match(new RegExp(`^## \\[${escapeRe(pkg.version)}\\] - (\\d{4})-(\\d{2})-(\\d{2})\\s*$`, 'm'));
  assert.ok(m, `missing "## [${pkg.version}] - YYYY-MM-DD" heading`);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  assert.ok(!Number.isNaN(d.getTime()), 'heading date is a valid date');
  assert.equal(d.toISOString().slice(0, 10), `${m[1]}-${m[2]}-${m[3]}`);
});

test('CHANGELOG.md has a link footer for the package version', () => {
  const cl = read('CHANGELOG.md');
  assert.match(cl, new RegExp(`^\\[${escapeRe(pkg.version)}\\]: https://\\S+v${escapeRe(pkg.version)}\\s*$`, 'm'));
});

test('CHANGELOG.md is shipped in the package files', () => {
  assert.ok(pkg.files.includes('CHANGELOG.md'));
});

// --- publish workflow --------------------------------------------------------

test('publish.yml triggers only on pushed v* tags', () => {
  const on = workflow.match(/^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m);
  assert.ok(on, 'workflow has an on: block');
  const block = on[1];
  assert.match(block, /^\s+push:/m);
  assert.match(block, /tags:\s*\[\s*['"]?v\*['"]?\s*\]|tags:\s*\n\s+-\s*['"]?v\*['"]?/);
  assert.doesNotMatch(block, /branches/);
  assert.doesNotMatch(block, /pull_request/);
  // no other top-level `on` keys (e.g. a bare `on: push` or `on: [push, ...]`)
  assert.doesNotMatch(workflow, /^on:[ \t]*[^\s#]/m);
  // only one trigger event under on:
  const events = block.split('\n').filter((l) => /^ {2}\w[\w-]*:/.test(l));
  assert.deepEqual(events.map((l) => l.trim()), ['push:']);
});

test('publish.yml grants id-token: write for provenance', () => {
  assert.match(workflow, /^\s+id-token:\s*write\s*(#.*)?$/m);
});

test('publish.yml runs npm ci and npm test before npm publish', () => {
  const ci = stepIndex(runMatches(/^npm ci\b/m));
  const t = stepIndex(runMatches(/^npm test\b/m));
  const pub = stepIndex(runMatches(/^npm publish\b/m));
  assert.ok(ci >= 0, 'has npm ci step');
  assert.ok(t >= 0, 'has npm test step');
  assert.ok(pub >= 0, 'has npm publish step');
  assert.ok(ci < t && t < pub, `order ci(${ci}) < test(${t}) < publish(${pub})`);
  assert.equal(steps.filter(runMatches(/npm publish/)).length, 1, 'publishes exactly once');
});

test('npm publish uses --provenance and NODE_AUTH_TOKEN from secrets.NPM_TOKEN', () => {
  const pub = steps.find(runMatches(/^npm publish\b/m));
  assert.match(pub.run, /--provenance/);
  assert.match(pub.text, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.match(workflow, /registry-url:\s*['"]?https:\/\/registry\.npmjs\.org/);
});

test('a tag-vs-package-version guard runs before npm publish', () => {
  assert.ok(guardIdx >= 0, 'has a tag/version check step');
  const pub = stepIndex(runMatches(/^npm publish\b/m));
  assert.ok(guardIdx < pub, 'guard runs before publish');
  assert.match(steps[guardIdx].text, /TAG:\s*\$\{\{\s*github\.ref_name\s*\}\}/);
});

test('no ${{ github.* }} expressions are interpolated inside run: scripts', () => {
  for (const s of steps) {
    if (s.run === null) continue;
    assert.doesNotMatch(s.run, /\$\{\{\s*github\./, `step "${s.name || s.run.split('\n')[0]}" interpolates github context in run:`);
  }
  // belt and braces: every github.ref expression in the file sits on an env-style key line
  for (const line of workflow.split('\n')) {
    if (/\$\{\{\s*github\.ref/.test(line)) {
      assert.match(line, /^\s+[A-Z_][A-Z0-9_]*:\s*\$\{\{/, `github.ref used outside env: ${line.trim()}`);
    }
  }
});

test('no literal npm token in the workflow', () => {
  assert.doesNotMatch(workflow, /npm_[A-Za-z0-9]{36}/);
});

test('tag guard script accepts the matching tag and rejects others', (t) => {
  if (!hasBash()) {
    t.skip('bash not available');
    return;
  }
  assert.ok(guardIdx >= 0);
  const script = steps[guardIdx].run;
  const run = (tag) =>
    spawnSync('bash', ['-e', '-c', script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TAG: tag },
    });

  const ok = run(`v${pkg.version}`);
  assert.equal(ok.status, 0, `v${pkg.version} should pass: ${ok.stdout}${ok.stderr}`);

  for (const bad of ['v9.9.9', `${pkg.version}-beta`, `v${pkg.version}.1`, 'v', '']) {
    const r = run(bad);
    assert.notEqual(r.status, 0, `tag "${bad}" should fail`);
  }
  const fail = run('v9.9.9');
  assert.match(fail.stdout + fail.stderr, /::error::/);
});

test('changelog guard script passes for the current version', (t) => {
  if (!hasBash()) {
    t.skip('bash not available');
    return;
  }
  const s = steps.find((st) => st.run !== null && /CHANGELOG\.md/.test(st.run));
  if (!s) {
    t.skip('no changelog check step');
    return;
  }
  const pub = stepIndex(runMatches(/^npm publish\b/m));
  assert.ok(steps.indexOf(s) < pub);
  const r = spawnSync('bash', ['-e', '-c', s.run], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// --- README ------------------------------------------------------------------

test('README documents NPM_TOKEN and links CHANGELOG.md', () => {
  const readme = read('README.md');
  assert.match(readme, /NPM_TOKEN/);
  assert.match(readme, /\]\(\.?\/?CHANGELOG\.md\)/);
});

// --- release safety ------------------------------------------------------------
test('workflow refuses to publish a tagged commit that is not on main', () => {
  const idx = stepIndex(runMatches(/git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/));
  assert.ok(idx >= 0, 'has a main-ancestry check');
  assert.match(steps[idx].run, /exit 1/);
  assert.ok(idx < stepIndex(runMatches(/^npm publish\b/m)), 'ancestry check runs before publish');
  assert.match(workflow, /fetch-depth:\s*0/, 'checkout fetches full history so origin/main exists');
});

test('prerelease tags publish under the next dist-tag, releases under latest', (t) => {
  if (!hasBash()) {
    t.skip('bash not available');
    return;
  }
  const pub = steps.find(runMatches(/^npm publish\b/m));
  // Swap the real publish for an echo of its arguments.
  const script = pub.run.replace(/^npm publish\b/m, 'echo npm publish');
  const run = (tag) =>
    spawnSync('bash', ['-e', '-c', script], { cwd: root, encoding: 'utf8', env: { ...process.env, TAG: tag } });
  const rel = run('v1.0.0');
  assert.equal(rel.status, 0, rel.stderr);
  assert.match(rel.stdout, /--tag latest\b/);
  const pre = run('v1.1.0-beta.1');
  assert.equal(pre.status, 0, pre.stderr);
  assert.match(pre.stdout, /--tag next\b/);
});
