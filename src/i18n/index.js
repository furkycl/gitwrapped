// Localization: one string table per language (en.js, tr.js) with the same keys. Every
// user-visible string of the cards, share image, viewer and terminal recap comes from
// getStrings(lang). Stats and stats.json stay language-neutral (English data values).
import en from './en.js';
import tr from './tr.js';

export { formatDecimal, formatInteger } from './format.js';

/** Supported --lang codes, default first. */
export const LANGS = Object.freeze(['en', 'tr']);
export const DEFAULT_LANG = 'en';

const TABLES = Object.freeze({ en, tr });

/** True when `lang` is a supported language code. */
export function isLang(lang) {
  return typeof lang === 'string' && Object.hasOwn(TABLES, lang);
}

/** The string table for `lang`; anything unsupported (or missing) → English. */
export function getStrings(lang) {
  return isLang(lang) ? TABLES[lang] : TABLES[DEFAULT_LANG];
}

/** Short alias of getStrings. */
export const t = getStrings;

/** `n` as a whole number with the language's thousands separator ("12,345" / "12.345"). */
export function formatNumberFor(n, lang) {
  return getStrings(lang).num(n);
}

/** Upper-case `s` with the language's rules (Turkish: i → İ, ı → I). */
export function upperFor(s, lang) {
  return getStrings(lang).upper(s);
}

/** "1 commit" / "2 commits" with the language's number format and unit words. */
export function pluralFor(n, unit, lang) {
  const L = getStrings(lang);
  const [one, many] = L.units[unit];
  return `${L.num(n)} ${n === 1 ? one : many}`;
}
