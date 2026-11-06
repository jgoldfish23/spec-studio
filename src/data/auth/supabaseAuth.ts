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
      const { data } = auth.onAuthStateChange((_event, session) =>
        listener(userOf(session)),
      );
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
      await call(() =>
        auth.signOut().then((result) => ({ data: null, error: result.error })),
      );
    },
  };
}
