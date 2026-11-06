import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { isOfflineRepository } from "../../data/offline/offlineRepository";
import { useRepository } from "../../data/queries";
import { errorMessage } from "../../lib/errorMessage";
import type { SaveStatus } from "./autosaver";
import type { DealEditor } from "./useDealEditor";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const BUTTON = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#C9CEC8] bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-paper disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60 ${focusRing}`;
const PRIMARY = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-spruce px-4 text-sm font-semibold text-white hover:bg-spruce-dark disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

/** Whether this save status is one that needs the owner's choice (rather than a status line). */
export function needsChoice(status: SaveStatus): boolean {
  return status.kind === "error" && (status.reason === "conflict" || status.reason === "deleted");
}

/**
 * The calm notes for a save that waits on the device: the edit is in the outbox, so nothing is at risk and nothing
 * is announced. Null for any other status.
 */
export function SafeOnDeviceNote({ status }: { status: SaveStatus }) {
  if (status.kind !== "error") return null;
  if (status.reason === "offline") {
    return <p className="m-0 text-sm text-muted">Offline — saved on this device, will sync</p>;
  }
  if (status.reason === "signedOut") {
    return (
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        <span>Signed out — sign in to sync. Your changes are saved on this device.</span>
        <Link
          to="/sign-in"
          className={`inline-flex min-h-11 items-center font-semibold text-spruce underline-offset-2 hover:underline ${focusRing}`}
        >
          Sign in
        </Link>
      </p>
    );
  }
  return null;
}

/** A deal that was changed or deleted on another device or tab: the owner picks which version wins. */
export function SaveProblem({ dealId, editor }: { dealId: string; editor: DealEditor }) {
  const { saveStatus: status } = editor;
  const repository = useRepository();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (status.kind !== "error" || (status.reason !== "conflict" && status.reason !== "deleted")) return null;

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const discard = () => {
    editor.discardChanges();
    // Nothing was deleted on this device, so its outbox entry would otherwise try again.
    if (isOfflineRepository(repository)) repository.discardPending(dealId);
    navigate("/deals");
  };
  const saveAsNew = async () => {
    const id = await editor.saveAsNewDeal();
    // The same step of the new deal: the segment after `/deals/<id>/`.
    const step = pathname.split("/")[3] ?? "lot";
    navigate(`/deals/${id}/${step}`);
  };

  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border border-[#F0D9A8] bg-marginal-bg px-4 py-3 text-marginal">
      <p className="m-0 font-semibold">
        {status.reason === "conflict"
          ? "This deal was changed on another device or tab."
          : "This deal was deleted on another device or tab."}
      </p>
      <div className="flex flex-wrap gap-3">
        {status.reason === "conflict" ? (
          <>
            <button type="button" disabled={busy} onClick={() => void run(editor.loadTheirs)} className={BUTTON}>
              Load their version
            </button>
            <button type="button" disabled={busy} onClick={() => void run(editor.keepMine)} className={PRIMARY}>
              Keep mine
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void run(saveAsNew)} className={PRIMARY}>
              Save as a new deal
            </button>
            <button type="button" disabled={busy} onClick={() => void run(discard)} className={BUTTON}>
              Discard my changes
            </button>
          </>
        )}
      </div>
      {failure ? <p className="m-0 text-sm font-medium text-no-go">{`Couldn't do that: ${failure}`}</p> : null}
    </div>
  );
}
