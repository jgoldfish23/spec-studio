import { useEffect, useRef, useState } from "react";
import { AuthFrame } from "../auth/AuthFrame";
import { PRIMARY_BUTTON } from "../deal/stepShared";

// The screens shown before the app is up (and while `#/sign-in` signs out). Small and free of Supabase code, so the
// demo build's entry chunk can carry them.

/** What the owner sees when the server can't be reached while the app starts. */
export const UNREACHABLE =
  "Can't reach Spec Studio's server. Check your connection, then try again.";

/** How long a wait goes on before it says it can't reach the server. The request keeps going meanwhile. */
export const STARTUP_PATIENCE_MS = 15_000;

/**
 * A wait on the server, labelled ("Loading…", "Signing out…"). After `STARTUP_PATIENCE_MS` it says it can't reach the
 * server and offers Try again, so a request that never answers is never an endless spinner.
 */
export function Loading({
  label = "Loading…",
  onRetry,
}: {
  label?: string;
  onRetry: () => void;
}) {
  const [round, setRound] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STARTUP_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [round]);
  if (slow) {
    return (
      <StartupProblem
        title="Can't connect"
        message={UNREACHABLE}
        onAction={() => {
          setSlow(false);
          setRound((n) => n + 1);
          onRetry();
        }}
      />
    );
  }
  return (
    <main
      aria-busy="true"
      className="flex min-h-dvh items-center justify-center bg-paper px-4 text-ink"
    >
      <p className="m-0 text-[15px] text-muted">{label}</p>
    </main>
  );
}

/**
 * A start that cannot go on: what happened, in the owner's words, and the one thing to do about it (if there is one),
 * with the keyboard on it.
 */
export function StartupProblem({
  title,
  message,
  action = "Try again",
  onAction,
}: {
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <AuthFrame title={title}>
      <div className="flex flex-col gap-4">
        <p role="alert" className="m-0 text-[15px] wrap-break-word">
          {message}
        </p>
        {onAction ? (
          <button
            ref={button}
            type="button"
            onClick={onAction}
            className={PRIMARY_BUTTON}
          >
            {action}
          </button>
        ) : null}
      </div>
    </AuthFrame>
  );
}
