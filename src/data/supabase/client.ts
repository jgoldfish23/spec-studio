import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    ...(fetchOverride ? { global: { fetch: fetchOverride } } : {}),
  });
}
