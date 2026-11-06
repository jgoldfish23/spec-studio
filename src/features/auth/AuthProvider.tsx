import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthGateway, AuthUser } from "../../data/auth/authGateway";

export interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user?: AuthUser;
  auth: AuthGateway;
}

const AuthContext = createContext<AuthState | null>(null);

const sameUser = (a: AuthUser | null, b: AuthUser | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.email === b.email);

/** Reads the stored session once, then follows sign-ins and sign-outs. */
export function AuthProvider({
  auth,
  children,
}: {
  auth: AuthGateway;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<{ user: AuthUser | null } | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    // A change that arrives before the first read finishes is newer than that read.
    let changed = false;
    const unsubscribe = auth.onChange((user) => {
      changed = true;
      if (!live) return;
      // A token refresh reports the same user again; keep the state so consumers do not re-render.
      setCurrent((prev) =>
        prev && sameUser(prev.user, user) ? prev : { user },
      );
    });
    auth.currentUser().then(
      (user) => {
        if (live && !changed) setCurrent({ user });
      },
      () => {
        if (live && !changed) setCurrent({ user: null });
      },
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [auth]);

  const value = useMemo<AuthState>(
    () =>
      current === undefined
        ? { status: "loading", auth }
        : current.user
          ? { status: "signedIn", user: current.user, auth }
          : { status: "signedOut", auth },
    [current, auth],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider.");
  return value;
}
