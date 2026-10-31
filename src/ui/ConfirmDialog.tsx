import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface ConfirmDialogProps {
  /** The question, e.g. "Delete Maple Street? This can't be undone." It also names the dialog. */
  message: string;
  /** What the confirming button says, e.g. "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4.5 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

/**
 * A question the owner must answer before something is lost. It is drawn in the page, not by the browser: the demo
 * build can run inside a frame where `window.confirm` is blocked. Focus starts on Cancel, Tab stays inside, Escape
 * cancels, and focus goes back to where it was when the dialog closes.
 */
export function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const messageId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement;
    cancelButton.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  /** Tab from the last button goes to the first, and Shift+Tab from the first to the last. */
  function keepFocusInside(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const first = cancelButton.current;
    const last = confirmButton.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={messageId}
        onKeyDown={keepFocusInside}
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-line bg-surface p-6 shadow-xl"
      >
        <p id={messageId} className="m-0 text-[17px] font-semibold leading-snug text-ink">
          {message}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            ref={cancelButton}
            type="button"
            onClick={onCancel}
            className={`${BUTTON} border border-[#C9CEC8] bg-surface text-ink hover:bg-paper`}
          >
            Cancel
          </button>
          <button
            ref={confirmButton}
            type="button"
            onClick={onConfirm}
            className={`${BUTTON} bg-no-go text-white hover:bg-[#751C1C]`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
