// Scans text for values that must never ship in the browser bundle. It returns rule names only, never the matched value.
const FORBIDDEN = ["service_role", "postgres://", "postgresql://"];
// supabase-js itself contains the bare prefix `sb_secret_` (it checks for it), so only a prefix followed by key characters is a key.
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co/;

function payloadRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

/** Returns [{ rule }] for every rule that matches. `demo` adds the rules for a build that must hold no project. */
export function scanText(text, { demo = false } = {}) {
  const hits = [];
  for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push({ rule: needle });
  if (SECRET_KEY.test(text)) hits.push({ rule: "sb_secret_ key" });
  const tokens = text.match(JWT) ?? [];
  if (tokens.some((t) => payloadRole(t) === "service_role")) hits.push({ rule: "service-role JWT" });
  if (demo) {
    if (tokens.length > 0) hits.push({ rule: "JWT" });
    if (PROJECT_URL.test(text)) hits.push({ rule: "project URL" });
  }
  return hits;
}
