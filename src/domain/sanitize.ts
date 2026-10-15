const BIDIRECTIONAL_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const DISALLOWED_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalizes text that came from a client before it is stored, narrated, or
 * placed inside a model prompt.
 *
 * @param value - Raw client text. Non-strings are treated as empty.
 * @returns A single-line string with nulls, ASCII controls, and bidi overrides removed.
 */
export function sanitizeUserText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(DISALLOWED_CONTROLS, "")
    .replace(BIDIRECTIONAL_CONTROLS, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wraps untrusted text so a model prompt can tell data from instructions.
 * The wrapper is removed from the payload itself so the client cannot close it early.
 *
 * @param label - Short ASCII name for the field, such as `intention`.
 * @param value - Untrusted text. It is sanitized first.
 * @returns A delimited block safe to interpolate into a prompt.
 */
export function delimitUserData(label: string, value: string): string {
  const safeLabel = label.replace(/[^a-z0-9_]/gi, "");
  const safeValue = sanitizeUserText(value).replaceAll("</user_data>", "");
  return `<user_data name="${safeLabel}">\n${safeValue}\n</user_data>`;
}
