import { createContext } from "react";
import type { ReactNode } from "react";

/**
 * What the hosted build adds to the app: the header's account menu and sync note, and how the `#/sign-in` route ends
 * a stale session. The router's elements are made once, so `App` hands these down by context rather than as props.
 * Null in demo mode, whose shell shows the demo pill.
 */
export interface HostedShell {
  account: ReactNode;
  syncNote: ReactNode;
  /**
   * Ends the session, so the gate shows the sign-in page: what `#/sign-in` does while someone is signed in. Resolves
   * false when it could not (the failure is already reported).
   */
  signOut: () => Promise<boolean>;
}

export const HostedShellContext = createContext<HostedShell | null>(null);
