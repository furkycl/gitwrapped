// The --json export: computeStats() output plus run metadata as stable, pretty JSON.
// Pure string building; no generation timestamp or machine paths, so the same history,
// options and reference day (`asOf`) always give byte-identical output.

/** Bump when a key is removed or changes meaning (adding keys does not bump it). */
export const STATS_SCHEMA_VERSION = 1;

/**
 * `value` as plain JSON data: Maps become objects (keys as strings), Sets and other
 * iterables arrays, Dates ISO strings, non-finite numbers and bigints null/strings,
 * undefined / functions / symbols are dropped from objects (null inside arrays).
 * Object keys keep their insertion order, which the stats engine builds deterministically.
 */
export function toJsonSafe(value) {
  if (value === null) return null;
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'string':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return undefined; // undefined, function, symbol
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Map) {
    const out = {};
    for (const [k, v] of value) {
      const safe = toJsonSafe(v);
      if (safe !== undefined) out[String(k)] = safe;
    }
    return out;
  }
  if (Array.isArray(value) || value instanceof Set) {
    return Array.from(value, (v) => toJsonSafe(v) ?? null);
  }
  const out = {};
  for (const k of Object.keys(value)) {
    const safe = toJsonSafe(value[k]);
    if (safe !== undefined) out[k] = safe;
  }
  return out;
}

/**
 * The stats.json document, as a newline-terminated, 2-space-indented JSON string:
 * `{schemaVersion, generator: {name, version}, repo, asOf, filters: {since, until,
 * author, maxCommits}, truncated, stats}`. `asOf` ('YYYY-MM-DD') is the day the current
 * streak is relative to (today, or a past window's end). Unset date / author filters are
 * null; maxCommits is the cap in effect. `repo` is a display name (the folder's
 * basename), never a full path.
 */
export function buildStatsJson({ stats, repoName, version, asOf, filters = {}, truncated = false }) {
  const or = (v) => (v === undefined || v === '' ? null : v);
  const doc = {
    schemaVersion: STATS_SCHEMA_VERSION,
    generator: { name: '@furkycl/gitwrapped', version: or(version) },
    repo: or(repoName),
    asOf: or(asOf),
    filters: {
      since: or(filters.since),
      until: or(filters.until),
      author: or(filters.author),
      maxCommits: or(filters.maxCommits),
    },
    truncated: Boolean(truncated),
    stats: toJsonSafe(stats ?? {}),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
