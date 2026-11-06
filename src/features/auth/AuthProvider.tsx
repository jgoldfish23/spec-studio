import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AuthError } from "../../data/auth/authGateway";
import type { AuthGateway, AuthUser } from "../../data/auth/authGateway";

export interface AuthState {
  /** `unreachable`: the stored session could not be read because the server could not be reached. */
  status: "loading" | "signedOut" | "signedIn" | "unreachable";
  user?: AuthUser;
  auth: AuthGateway;
  /** Reads the stored session again (after `unreachable`). */
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const sameUser = (a: AuthUser | null, b: AuthUser | null): boolean =>
  a === b || (a !== null && b !== null && a.id === b.id && a.email === b.email);

/** What is known about the session: nothing yet (undefined), who is signed in, or that the server could not be reached. */
type Known = { user: AuthUser | null } | { unreachable: true };

const UNREACHABLE: Known = { unreachable: true };

/**
 * Reads the stored session once, then follows sign-ins and sign-outs. A read that fails because the server cannot be
 * reached (an expired session that could not be refreshed) is `unreachable`, not signed out, so the owner is not asked
 * to sign in while offline; `retry` reads again. Any other failed read is signed out.
 */
export function AuthProvider({
  auth,
  children,
}: {
  auth: AuthGateway;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<Known | undefined>(undefined);
  /** Bumped by `retry` to read the session again. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    // A change that arrives before the first read finishes is newer than that read.
    let changed = false;
    const unsubscribe = auth.onChange((user) => {
      changed = true;
      if (!live) return;
      // A token refresh reports the same user again; keep the state so consumers do not re-render.
      setCurrent((prev) =>
        prev && "user" in prev && sameUser(prev.user, user) ? prev : { user },
      );
    });
    auth.currentUser().then(
      (user) => {
        if (live && !changed) setCurrent({ user });
      },
      (error: unknown) => {
        if (!live || changed) return;
        const offline =
          error instanceof AuthError && error.reason === "offline";
        setCurrent(offline ? UNREACHABLE : { user: null });
      },
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [auth, attempt]);

  const retry = useCallback(() => {
    setCurrent(undefined);
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<AuthState>(() => {
    if (current === undefined) return { status: "loading", auth, retry };
    if (!("user" in current)) return { status: "unreachable", auth, retry };
    return current.user
      ? { status: "signedIn", user: current.user, auth, retry }
      : { status: "signedOut", auth, retry };
  }, [current, auth, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider.");
  return value;
}
