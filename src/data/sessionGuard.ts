import { DataError } from "./types";
import type { Repository } from "./types";

const SESSION_ENDED = "You've been signed out.";

/**
 * `remote` for one owner's session: every call passes through until `end()`, then fails as signed out without
 * reaching the server (an outbox in front of it keeps what it was sending). A call already on its way finishes.
 *
 * A request goes out under whatever session the client holds when it is sent, so without this, a sync run still going
 * when its owner signs out would send their next edit under no session, or under the next owner's, whose company's
 * rules then make it look deleted.
 */
export function guardSession(remote: Repository): {
  remote: Repository;
  end: () => void;
} {
  let open = true;
  const guarded: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(remote) as [
    string,
    (...args: unknown[]) => Promise<unknown>,
  ][]) {
    guarded[name] = (...args: unknown[]) =>
      open
        ? method(...args)
        : Promise.reject(new DataError(SESSION_ENDED, { kind: "signedOut" }));
  }
  return {
    remote: guarded as unknown as Repository,
    end: () => {
      open = false;
    },
  };
}
