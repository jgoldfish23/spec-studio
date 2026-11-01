/** The text a value is hashed as: its JSON, or its plain string form when JSON cannot write it (BigInt, a loop). */
function textOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    // Falls through to the string form.
  }
  try {
    return String(value);
  } catch {
    return "unserializable";
  }
}

/**
 * A short fingerprint of a value, to put in an error report: eight hex characters, the 32-bit FNV-1a hash of its JSON.
 * It is for telling two inputs apart in a bug report, not for security.
 */
export function inputHash(value: unknown): string {
  const text = textOf(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
