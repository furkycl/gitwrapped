// Privacy helpers shared by the stats engine and every output: no email address is ever
// shown or exported from repo-derived text.

/**
 * An email-like token: local@domain, the domain with or without a dot ("ada@localhost",
 * "root@buildbox" too), starting with a letter: a version or a scale suffix after the "@"
 * ("lodash@4.17.21", "@babel/core@7.2", "logo@2x.png") is not an address and is kept.
 * Neither side spans "/" or "\\", so in a path only the file name part is cut
 * ("keys/ada@example.com.pub" → "keys/…").
 */
const EMAIL = /[^\s<>()[\]"'`,;:|/\\@]+@(?=\p{L})[^\s<>()[\]"'`,;:|/\\@]+/gu;

/** `s` (a commit subject, path or name) with every email-like token (see EMAIL) replaced by "…". */
export function scrubEmails(s) {
  return String(s ?? '').replace(EMAIL, '…');
}
