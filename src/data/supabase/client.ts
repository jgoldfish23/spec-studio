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
    // Every request is time-limited, so a connection that never answers reads as offline.
    global: {
      fetch: withTimeout(
        fetchOverride ?? ((input, init) => fetch(input, init)),
      ),
    },
  });
}
