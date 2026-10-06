// A small, dependency-free glob matcher for --exclude (gitignore-like, see compileGlob).

// Token kinds of a compiled pattern.
const STAR = 1; // "*": any run of characters except '/'
const ANY = 2; // "?": one character except '/'
const GLOBSTAR = 3; // "**": any run of characters, '/' included
const DIRS = 4; // "**/" at a segment start: zero or more whole directories ('' or '.../')

/**
 * The pattern as given, normalized: backslashes become '/', surrounding whitespace is
 * dropped. Throws a user-facing Error for a non-string or an empty pattern.
 */
function normalize(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new Error('--exclude requires a non-empty pattern');
  }
  return pattern.trim().replace(/\\/g, '/');
}

/**
 * A glob body (no anchor / trailing slash; '/' separated) as tokens: a string for a
 * literal character, else STAR / ANY / GLOBSTAR / DIRS. Runs of three or more stars count
 * as "**"; a "**" that is not a whole segment (other characters before or after it in
 * its segment) is a plain STAR; and redundant neighbours collapse ("**" + "/" + "**" + "/" → one DIRS; DIRS next
 * to GLOBSTAR → GLOBSTAR; "**" + "*" is already one run), so no input grows the work.
 */
function tokenize(body) {
  const out = [];
  const push = (t) => {
    const prev = out[out.length - 1];
    if (t === DIRS && (prev === DIRS || prev === GLOBSTAR)) return;
    if (t === GLOBSTAR && (prev === DIRS || prev === GLOBSTAR)) {
      out[out.length - 1] = GLOBSTAR;
      return;
    }
    if (t === STAR && prev === GLOBSTAR) return;
    out.push(t);
  };
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '*') {
      let j = i;
      while (body[j] === '*') j++;
      if (j - i === 1) {
        push(STAR);
        i = j;
        continue;
      }
      // Only a "**" that is a whole path segment crosses '/'; elsewhere ("src**.js",
      // "test**") it is a plain "*", as in gitignore.
      const atStart = i === 0 || body[i - 1] === '/';
      if (atStart && body[j] === '/') {
        push(DIRS);
        i = j + 1;
      } else {
        push(atStart && j === body.length ? GLOBSTAR : STAR);
        i = j;
      }
      continue;
    }
    push(ch === '?' ? ANY : ch);
    i++;
  }
  return out;
}

/**
 * The text positions `k` such that `tokens` match exactly `text.slice(0, k)`, as a
 * boolean array of length text.length + 1. A set-of-positions simulation: each token
 * maps the reachable positions to the next ones in one linear sweep, so the whole match
 * is O(tokens × text) with no backtracking, whatever the pattern.
 */
function reachable(tokens, text) {
  const n = text.length;
  let reach = new Uint8Array(n + 1);
  reach[0] = 1;
  for (const t of tokens) {
    const next = new Uint8Array(n + 1);
    let any = false;
    if (t === STAR) {
      // Carry a reachable start forward until a '/' blocks it.
      let carry = 0;
      for (let j = 0; j <= n; j++) {
        if (j > 0 && text[j - 1] === '/') carry = 0;
        if (reach[j]) carry = 1;
        if (carry) next[j] = 1;
      }
    } else if (t === GLOBSTAR) {
      let carry = 0;
      for (let j = 0; j <= n; j++) {
        if (reach[j]) carry = 1;
        next[j] = carry;
      }
    } else if (t === DIRS) {
      // Zero directories (stay), or any run that ends right after a '/'.
      let seen = 0;
      for (let j = 0; j <= n; j++) {
        if (reach[j] || (seen && j > 0 && text[j - 1] === '/')) next[j] = 1;
        if (reach[j]) seen = 1;
      }
    } else {
      for (let j = 0; j < n; j++) {
        if (reach[j] && (t === ANY ? text[j] !== '/' : text[j] === t)) next[j + 1] = 1;
      }
    }
    for (let j = 0; j <= n; j++) if (next[j]) { any = true; break; }
    if (!any) return next;
    reach = next;
  }
  return reach;
}

/**
 * Compile one --exclude glob into a predicate `(path) => boolean` over '/'-separated
 * paths as git prints them (repo-relative). Semantics, gitignore-like:
 * - `*` matches any characters except '/', `?` exactly one character except '/',
 *   a `**` segment any characters including '/' (a `**` with other characters in its
 *   segment, like `src**.js`, is a plain `*`); a `**` segment followed by '/' also matches
 *   zero directories (`**` + `/x.js` matches `x.js` at the root and at any depth), and
 *   `docs/**` matches everything under `docs/`.
 *   Everything else is literal (no `[...]` classes, no `!` negation, no `{a,b}`), and
 *   matching is case-sensitive, as in git.
 * - A pattern matches a path when it matches the whole path or any of its leading
 *   directories, so a directory pattern drops everything under it: `docs`, `docs/` and
 *   `docs/**` all exclude `docs/guide/intro.md`.
 * - A trailing '/' only matches directories: `build/` excludes `build/x.js` but not a file
 *   named `build`.
 * - A pattern with no '/' (other than a trailing one) matches at any depth, against each
 *   path segment: `*.min.js` excludes `a/b/app.min.js`, `fixtures` excludes
 *   `test/fixtures/x.json`.
 * - A pattern with a '/' inside, or a leading '/' or './', is anchored at the repo root:
 *   `src/gen/*.js` excludes `src/gen/a.js` but not `lib/src/gen/a.js`; `/README.md` only
 *   the root README.
 * - Backslashes are read as '/' (for Windows users); surrounding whitespace is ignored.
 * Matching is linear in pattern length × path length (no regex, no backtracking), so no
 * pattern can make it slow. The predicate has `named: true` for a name pattern (no '/'
 * other than a trailing one, not anchored), else `named: false`, and `label: true` when
 * it may be tried against a multi-repo "<repo>/<path>" label: a path pattern whose first
 * segment has no wildcard (`api/src/`, `/web`), so that segment can only match a repo
 * label literally (`*` + `/generated/` or `**` + `/x.js` never match a label).
 * Throws an Error with a user-facing message for an empty pattern (or one that is only
 * an anchor and slashes, like "/" or "./").
 */
export function compileGlob(pattern) {
  let body = normalize(pattern);
  let anchored = false;
  if (body.startsWith('./')) {
    anchored = true;
    body = body.replace(/^(?:\.\/)+/, '');
  }
  if (body.startsWith('/')) {
    anchored = true;
    body = body.replace(/^\/+/, '');
  }
  const dirOnly = body.endsWith('/');
  body = body.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (body === '' || body === '.') {
    throw new Error(`invalid --exclude "${pattern}": the pattern matches nothing (give a path or glob, e.g. "docs/" or "*.min.js")`);
  }
  const named = !anchored && !body.includes('/');
  const tokens = tokenize(named ? `**/${body}` : body);
  const match = (path) => {
    if (typeof path !== 'string' || path === '') return false;
    const reach = reachable(tokens, path);
    // The whole path (unless the pattern only matches directories), or any leading
    // directory (a prefix ending just before a '/'), so a matching directory takes
    // everything under it.
    if (!dirOnly && reach[path.length]) return true;
    for (let k = 1; k < path.length; k++) if (path[k] === '/' && reach[k]) return true;
    return false;
  };
  // A name pattern (no '/' inside, not anchored) matches at any depth of a repo-relative
  // path; excludeFiles never tries it against a multi-repo "<repo>/<path>" label.
  match.named = named;
  match.label = !named && !/[*?]/.test(body.split('/')[0]);
  return match;
}

/**
 * One predicate `(path, {labelled = false} = {}) => boolean` for several --exclude
 * patterns: true when any of them matches (see compileGlob). With `labelled: true` (a
 * multi-repo "<repo>/<path>" as shown) only path patterns whose first segment is literal
 * are tried (compileGlob's `label`), never name patterns or a pattern starting with a
 * wildcard, so `docs`, `api*` or `*` + `/generated/` cannot match a repo's label: `docs`
 * cannot drop a whole repo, and `*` + `/generated/` excludes the same files as in a
 * single-repo run.
 * No patterns (empty / missing) → null, so callers can skip filtering.
 * Throws like compileGlob for an invalid pattern.
 */
export function compileExcludes(patterns) {
  const list = (patterns ?? []).map(compileGlob);
  if (list.length === 0) return null;
  return (path, { labelled = false } = {}) => list.some((m) => (!labelled || m.label) && m(path));
}
