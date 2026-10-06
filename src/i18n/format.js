// Locale-free number helpers shared by the string tables. Hand-written (no Intl), so the
// output is the same on every Node version and ICU build.

/**
 * An integer with `sep` as the thousands separator: (12345, ',') → "12,345",
 * (12345, '.') → "12.345". Rounds; negatives use U+2212. Huge values (≥ 1e21) are written
 * out in full, never in scientific notation. Non-numbers and non-finite values → "0".
 */
export function formatInteger(n, sep = ',') {
  const v = Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 0);
  // BigInt prints every digit of an integral double, where String() would switch to 1e+21.
  const digits = BigInt(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return v < 0 ? `−${digits}` : digits;
}

/**
 * A number with at most one decimal, with the given thousands and decimal separators:
 * (1234.56, '.', ',') → "1.234,6", (23, '.', ',') → "23". Non-finite → "0".
 */
export function formatDecimal(n, sep, point) {
  const r = Math.round((typeof n === 'number' && Number.isFinite(n) ? n : 0) * 10) / 10;
  const abs = Math.abs(r);
  const tenths = Math.round(abs * 10);
  const int = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const body = `${formatInteger(int, sep)}${frac ? `${point}${frac}` : ''}`;
  return r < 0 && tenths > 0 ? `−${body}` : body;
}

