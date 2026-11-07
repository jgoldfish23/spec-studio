import { useEffect, useId, useRef, useState } from "react";
import type { AuthUser } from "../../data/auth/authGateway";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { FOCUS_RING } from "../deal/stepShared";

export interface AccountMenuProps {
  user: AuthUser;
  /** Edits saved on this device that a sync can still send. */
  pendingCount: number;
  /** The names of the deals whose waiting edit the server refused: they wait for the owner's choice. */
  refused?: readonly string[];
  onSignOut: () => void;
}

/** Wording for the sign-out question: "1 change hasn't", "2 changes haven't". */
function pendingText(count: number): string {
  return count === 1 ? "1 change hasn't" : `${count} changes haven't`;
}

/** “A”, “A” and “B”, “A”, “B” and “C”. */
function namesText(names: readonly string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The sign-out question. Waiting edits sync the next time the owner signs in here; an edit the server refused never
 * syncs by itself, so it says so and what to do.
 */
function questionText(pending: number, refused: readonly string[]): string {
  if (refused.length === 0) {
    return `${pendingText(pending)} synced yet. Sign out anyway? They stay on this device and sync the next time you sign in here.`;
  }
  const one = refused.length === 1;
  const choice = `${namesText(refused)} ${one ? "needs" : "need"} your choice before ${one ? "it" : "they"} can sync.`;
  if (pending === 0) {
    return `${choice} Sign out anyway? Your changes stay on this device; sign in here again and open ${one ? "the deal" : "each deal"} to choose.`;
  }
  return `${pendingText(pending)} synced yet, and ${choice} Sign out anyway? Your changes stay on this device: the waiting ones sync the next time you sign in here, and the others wait for your choice.`;
}

/**
 * The signed-in owner's email in the header, opening a small panel with Sign out. A disclosure (a button with
 * `aria-expanded`), not an ARIA menu: it holds one action, so plain Tab order is the right keyboard behaviour.
 * Escape and a click outside close it. Unsynced edits, and edits the server refused, get a question first.
 */
export function AccountMenu({
  user,
  pendingCount,
  refused = [],
  onSignOut,
}: AccountMenuProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, confirming]);

  function signOut() {
    setConfirming(false);
    setOpen(false);
    onSignOut();
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex min-h-11 max-w-48 cursor-pointer items-center rounded-md px-3 text-sm text-paper hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
      >
        <span className="truncate">{user.email}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-40 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-ink shadow-lg"
        >
          <p className="m-0 text-[13px] wrap-break-word text-muted">
            {user.email}
          </p>
          <button
            type="button"
            onClick={() =>
              pendingCount > 0 || refused.length > 0
                ? setConfirming(true)
                : signOut()
            }
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-[15px] font-semibold text-spruce hover:bg-paper ${FOCUS_RING}`}
          >
            Sign out
          </button>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          message={questionText(pendingCount, refused)}
          confirmLabel="Sign out"
          onConfirm={signOut}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
