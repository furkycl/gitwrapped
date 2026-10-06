// Privacy helpers shared by the stats engine and every output: no email address is ever
// shown or exported from repo-derived text.

/**
 * An email-like token: local@domain, the domain with or without a dot ("ada@localhost",
 * "root@buildbox" too). Neither side spans "/" or "\\", so in a path only the file name
 * part is cut ("keys/ada@example.com.pub" → "keys/…").
 */
const EMAIL = /[^\s<>()[\]"'`,;:|/\\@]+@[^\s<>()[\]"'`,;:|/\\@]+/g;

/** `s` (a commit subject, path or name) with every email-like token (see EMAIL) replaced by "…". */
export function scrubEmails(s) {
  return String(s ?? '').replace(EMAIL, '…');
}
