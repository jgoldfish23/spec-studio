import { CANT_REACH_SERVER, SIGNED_OUT } from "../messages";
import { DataError } from "../types";

/** PostgREST's codes for a token that is missing, expired or not accepted. */
const AUTH_CODES: ReadonlySet<string> = new Set(["PGRST301", "PGRST303"]);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Turns anything Supabase or `fetch` reports into a `DataError` the owner can act on, with a `kind` the app acts on
 * too. A request that got no response at all (HTTP status 0 as postgres-js reports it, or a message that starts with
 * the `TypeError`/`FetchError` it wraps) is `offline`; an expired or missing sign-in is `signedOut`; everything else is
 * `failed`: its raw error is logged once for whoever looks at the console, kept as `cause`, and never shown. Only the
 * status, code and the start of the message are read, never `details`, which can hold the owner's own data.
 * `action` is what the owner was doing ("save", "load"); `status` is the HTTP status when it is known.
 */
export function toDataError(error: unknown, action: string, recordId?: string, status?: number): DataError {
  const like: { message?: unknown; code?: unknown; status?: unknown } =
    typeof error === "object" && error !== null ? error : {};
  const httpStatus = status ?? (typeof like.status === "number" ? like.status : undefined);
  const message = text(like.message);
  if (error instanceof TypeError || httpStatus === 0 || /^(TypeError|FetchError)\b/.test(message)) {
    return new DataError(CANT_REACH_SERVER, { kind: "offline", recordId, cause: error });
  }
  if (httpStatus === 401 || AUTH_CODES.has(text(like.code))) {
    return new DataError(SIGNED_OUT, { kind: "signedOut", recordId, cause: error });
  }
  console.error(`Couldn't ${action}${recordId === undefined ? "" : ` ${recordId}`}:`, error);
  return new DataError(`Couldn't ${action} — the server said no. Try again in a minute.`, {
    kind: "failed",
    recordId,
    cause: error,
  });
}
