import {
  isAuthApiError,
  isAuthPKCECodeVerifierMissingError,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
import { CANT_REACH_SERVER } from "../messages";

/** The signed-in owner, as far as the app needs to know. */
export type AuthUser = { id: string; email: string };

export type AuthErrorReason =
  | "rateLimited"
  | "badCode"
  | "otherBrowser"
  | "offline"
  | "failed";

/** A sign-in problem with a `reason` the app acts on and a message the owner can read. */
export class AuthError extends Error {
  reason: AuthErrorReason;

  constructor(reason: AuthErrorReason, options: { cause?: unknown } = {}) {
    super(
      AUTH_MESSAGES[reason],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "AuthError";
    this.reason = reason;
  }
}

const AUTH_MESSAGES: Record<AuthErrorReason, string> = {
  rateLimited: "Too many tries — wait a minute, then try again.",
  badCode: "That code didn't work or has expired. Send a new one.",
  otherBrowser:
    "This link was opened in a different browser than the one that asked for it. Type the 6-digit code from the same email instead.",
  offline: CANT_REACH_SERVER,
  failed: "Couldn't sign in — try again in a minute.",
};

/** Sign-in by emailed link or 6-digit code. The hosted build uses Supabase; tests use `createFakeAuth`. */
export interface AuthGateway {
  /** The stored session's user, or null. Reads local storage; no network when a session is stored. */
  currentUser(): Promise<AuthUser | null>;
  /** Calls `listener` on every sign-in and sign-out. Returns the unsubscribe. */
  onChange(listener: (user: AuthUser | null) => void): () => void;
  /** Emails a sign-in link and 6-digit code; the link returns to `redirectTo`. */
  sendSignInEmail(email: string, redirectTo: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthUser>;
  /** Finishes a sign-in from the `code` in the link's URL. */
  exchangeLinkCode(code: string): Promise<AuthUser>;
  /** Ends the session on this device only: the owner stays signed in on their other devices. */
  signOut(): Promise<void>;
}

const OLD_VERIFIER_MESSAGE =
  /both auth code and code verifier should be non-empty/i;
const RATE_CODES: ReadonlySet<string> = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);
const BAD_CODE_CODES: ReadonlySet<string> = new Set([
  "otp_expired",
  "invalid_otp",
]);

/** Turns anything auth-js or `fetch` reports into an `AuthError`. The one place this mapping lives. */
export function authErrorFrom(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const like: {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
  } = typeof error === "object" && error !== null ? error : {};
  const message = typeof like.message === "string" ? like.message : "";
  const code = typeof like.code === "string" ? like.code : "";
  const status = typeof like.status === "number" ? like.status : undefined;
  const cause = { cause: error };

  if (
    isAuthPKCECodeVerifierMissingError(error) ||
    like.name === "AuthPKCECodeVerifierMissingError" ||
    OLD_VERIFIER_MESSAGE.test(message)
  ) {
    return new AuthError("otherBrowser", cause);
  }
  if (status === 429 || RATE_CODES.has(code))
    return new AuthError("rateLimited", cause);
  if (
    isAuthApiError(error) &&
    (BAD_CODE_CODES.has(code) ||
      status === 403 ||
      /token has expired or is invalid/i.test(message))
  ) {
    return new AuthError("badCode", cause);
  }
  if (isAuthRetryableFetchError(error) || error instanceof TypeError)
    return new AuthError("offline", cause);
  console.error("Sign-in failed:", error);
  return new AuthError("failed", cause);
}
