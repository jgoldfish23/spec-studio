import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { AuthError, authErrorFrom } from "./authGateway";
import type { AuthGateway, AuthUser } from "./authGateway";

function userOf(session: Session | null): AuthUser | null {
  const user = session?.user;
  if (!user) return null;
  return { id: user.id, email: user.email ?? "" };
}

/** Runs one auth call, turning a returned or thrown problem into an `AuthError`. */
async function call<T>(
  run: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  let result: { data: T; error: unknown };
  try {
    result = await run();
  } catch (error) {
    throw authErrorFrom(error);
  }
  if (result.error) throw authErrorFrom(result.error);
  return result.data;
}

async function signedIn(
  run: () => PromiseLike<{ data: { session: Session | null }; error: unknown }>,
): Promise<AuthUser> {
  const user = userOf((await call(run)).session);
  if (!user) throw new AuthError("failed");
  return user;
}

export function createSupabaseAuth(client: SupabaseClient): AuthGateway {
  const auth = client.auth;
  return {
    async currentUser() {
      return userOf(
        (await call<{ session: Session | null }>(() => auth.getSession()))
          .session,
      );
    },
    onChange(listener) {
      const { data } = auth.onAuthStateChange((event, session) => {
        // The stored session's first read is `currentUser`'s to report. supabase-js reports it as no session when
        // the read failed, and an expired session that could not be refreshed offline is not a sign-out.
        if (event === "INITIAL_SESSION") return;
        listener(userOf(session));
      });
      return () => data.subscription.unsubscribe();
    },
    async sendSignInEmail(email, redirectTo) {
      await call(() =>
        auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
        }),
      );
    },
    verifyCode: (email, code) =>
      signedIn(() => auth.verifyOtp({ email, token: code, type: "email" })),
    exchangeLinkCode: (code) =>
      signedIn(() => auth.exchangeCodeForSession(code)),
    async signOut() {
      // This device only. auth-js's default ends every session the owner has, so signing out of the office laptop
      // would sign the iPad on the job site out too, the next time its token is renewed.
      await call(() =>
        auth
          .signOut({ scope: "local" })
          .then((result) => ({ data: null, error: result.error })),
      );
    },
  };
}
