import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** How long one request may wait for the server's answer before it is given up as unreachable (one bar on site). */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `fetchImpl` with a time limit: a request with no answer after `ms` is aborted. It then fails as an `AbortError`,
 * which supabase-js reports as a failed request (status 0 for data, a retryable fetch error for sign-in) and does not
 * retry, so it reads as offline instead of hanging. A signal the caller passes still aborts the request.
 */
export function withTimeout(
  fetchImpl: typeof fetch,
  ms: number = REQUEST_TIMEOUT_MS,
): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const caller = init?.signal ?? undefined;
    const fromCaller = () => controller.abort(caller?.reason);
    if (caller?.aborted) fromCaller();
    else caller?.addEventListener("abort", fromCaller, { once: true });
    // No reason: the fetch then fails with an `AbortError`, which supabase-js does not retry.
    const timer = setTimeout(() => controller.abort(), ms);
    return fetchImpl(input, { ...init, signal: controller.signal }).finally(
      () => {
        clearTimeout(timer);
        caller?.removeEventListener("abort", fromCaller);
      },
    );
  };
}

/**
 * `fetchImpl` that never sends a data request (PostgREST: a table or an `rpc`, under `/rest/v1/`) as the anon key.
 * When `auth.getSession()` has no session (a refresh that failed on a flaky connection), supabase-js falls back to the
 * anon key as the bearer, and RLS then answers the owner's reads with nothing: no company, no deals, and a save that
 * matches 0 rows and reads as "deleted". The app never makes a signed-out data request (sign-in is `/auth/v1/`), so
 * such a request is refused here without touching the network. It fails as an `AbortError`, the same rejection the
 * time limit uses: postgrest-js neither retries nor delays it and reports status 0, which reads as offline. If the
 * session is really gone, auth-js signs the owner out by itself. Only the `Authorization` header is read, in any form
 * `fetch` takes it (`Headers`, plain object, pairs, or on a `Request`), and the key is never logged or put in the error.
 */
export function withSignedInData(
  fetchImpl: typeof fetch,
  anonKey: string,
): typeof fetch {
  const anonBearer = `Bearer ${anonKey}`;
  return (input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost",
    ).pathname;
    if (path.includes("/rest/v1/")) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (headers.get("Authorization") === anonBearer) {
        return Promise.reject(
          new DOMException(
            "Refused: no signed-in session for a data request.",
            "AbortError",
          ),
        );
      }
    }
    return fetchImpl(input, init);
  };
}

/**
 * The one place a Supabase client is made. The session is kept in `storage` (the app's browser storage, so it survives
 * a reload) and the sign-in link's `?code=` is exchanged by the app itself, not by the client.
 */
export function createSupabase(
  config: { url: string; anonKey: string },
  storage: Storage,
  /** Tests only: replaces the client's `fetch`. */
  fetchOverride?: typeof fetch,
): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage,
    },
    // Every request is time-limited, so a connection that never answers reads as offline; a data request with no
    // signed-in session is refused the same way (see `withSignedInData`).
    global: {
      fetch: withSignedInData(
        withTimeout(fetchOverride ?? ((input, init) => fetch(input, init))),
        config.anonKey,
      ),
    },
  });
}
