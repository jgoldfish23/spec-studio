import { DataError } from "../types";

const OFFLINE = "Can't reach the server — check your connection.";
const SIGNED_OUT = "You've been signed out.";

/** PostgREST's codes for a token that is missing, expired or not accepted. */
const AUTH_CODES: ReadonlySet<string> = new Set(["PGRST301", "PGRST303"]);

interface ErrorLike {
  message?: unknown;
  details?: unknown;
  code?: unknown;
  status?: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Turns anything Supabase or `fetch` reports into a `DataError` the owner can act on, with a `kind` the app acts on
 * too. A lost connection is `offline`, an expired or missing sign-in is `signedOut`, and everything else is `failed`:
 * its raw message is logged once for whoever looks at the console and never shown. `action` is the verb the owner
 * was doing ("save", "load"). A response's HTTP status goes in `error.status` when it is known.
 */
export function toDataError(error: unknown, action: string, recordId?: string): DataError {
  const like: ErrorLike = typeof error === "object" && error !== null ? error : {};
  if (error instanceof TypeError || /TypeError|Failed to fetch|NetworkError|Load failed/.test(`${text(like.message)} ${text(like.details)}`)) {
    return new DataError(OFFLINE, { kind: "offline", recordId, cause: error });
  }
  if (like.status === 401 || AUTH_CODES.has(text(like.code))) {
    return new DataError(SIGNED_OUT, { kind: "signedOut", recordId, cause: error });
  }
  console.error(`Couldn't ${action}${recordId === undefined ? "" : ` ${recordId}`}:`, error);
  return new DataError(`Couldn't ${action} — the server said no. Try again in a minute.`, {
    kind: "failed",
    recordId,
    cause: error,
  });
}
