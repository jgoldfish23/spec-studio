import { useEffect, useId, useRef, useState } from "react";
import type { AuthUser } from "../../data/auth/authGateway";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { FOCUS_RING } from "../deal/stepShared";

export interface AccountMenuProps {
  user: AuthUser;
  /** Edits saved on this device that have not reached the server. */
  pendingCount: number;
  onSignOut: () => void;
}

/** Wording for the sign-out question: "1 change hasn't", "2 changes haven't". */
function pendingText(count: number): string {
  return count === 1 ? "1 change hasn't" : `${count} changes haven't`;
}

/**
 * The signed-in owner's email in the header, opening a small panel with Sign out. A disclosure (a button with
 * `aria-expanded`), not an ARIA menu: it holds one action, so plain Tab order is the right keyboard behaviour.
 * Escape and a click outside close it. Unsynced edits get a question first.
 */
export function AccountMenu({
  user,
  pendingCount,
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
        className={`inline-flex min-h-11 max-w-48 cursor-pointer items-center rounded-md px-3 text-sm text-paper hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper`}
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
            onClick={() => (pendingCount > 0 ? setConfirming(true) : signOut())}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-[15px] font-semibold text-spruce hover:bg-paper ${FOCUS_RING}`}
          >
            Sign out
          </button>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          message={`${pendingText(pendingCount)} synced yet. Sign out anyway? They stay on this device and sync the next time you sign in here.`}
          confirmLabel="Sign out"
          onConfirm={signOut}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
