import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Bid, Cents, ISODate } from "@engine";
import { todayIso } from "../../lib/today";
import { DateField, OptionalMoneyField, TextField } from "../../ui/fields";
import { bidProblems, MAX_BID_CENTS } from "./bids";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../deal/stepShared";

export interface BidFormProps {
  /** The cost code the bid is for. */
  code: string;
  /** The line's name, for the title. */
  codeName: string;
  /** The bid being edited; none when a new one is being added. */
  bid?: Bid | undefined;
  onSave: (bid: Bid) => void;
  onCancel: () => void;
}

/** The boxes in a row, wrapping to a column on a phone. */
const FIELDS = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4";

/**
 * A bid for one cost code: vendor, amount, the date it was received and optional notes. It checks nothing until Save
 * is tried, then says what is missing under each box. Save hands the finished `Bid` to `onSave`; Cancel (or Escape)
 * calls `onCancel`; neither writes anything itself.
 */
export function BidForm({ code, codeName, bid, onSave, onCancel }: BidFormProps) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [vendor, setVendor] = useState(bid?.vendor ?? "");
  const [amountCents, setAmountCents] = useState<Cents | undefined>(bid?.amountCents);
  const [receivedOn, setReceivedOn] = useState<ISODate>(() => bid?.receivedOn ?? todayIso());
  const [notes, setNotes] = useState(bid?.notes ?? "");
  const [attempted, setAttempted] = useState(false);
  /** Counts failed Saves, so each one moves focus to the first box with a message. */
  const [failedSaves, setFailedSaves] = useState(0);

  // The vendor box is where a bid starts.
  useEffect(() => {
    formRef.current?.querySelector("input")?.focus();
  }, []);
  useEffect(() => {
    if (failedSaves > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [failedSaves]);

  const problems = bidProblems({ vendor, amountCents, receivedOn });
  const shown = attempted ? problems : {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A typed box holds on to the last value it understood while it shows a message of its own (an amount over the
    // ceiling, a date left half-typed), so a box that is marked invalid right now must stop the save too.
    const boxWithMessage = formRef.current?.querySelector('[aria-invalid="true"]') != null;
    if (boxWithMessage || amountCents === undefined || Object.keys(problems).length > 0) {
      setAttempted(true);
      setFailedSaves((count) => count + 1);
      return;
    }
    const saved: Bid = { code, vendor: vendor.trim(), amountCents, receivedOn };
    // Notes are optional: a blank box leaves the key out rather than storing "".
    const trimmedNotes = notes.trim();
    if (trimmedNotes !== "") saved.notes = trimmedNotes;
    onSave(saved);
  }

  function cancelOnEscape(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  }

  return (
    <form
      ref={formRef}
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={cancelOnEscape}
      className="flex flex-col gap-4"
    >
      <h3 id={titleId} className="m-0 text-[15px] font-bold">
        <span className="font-semibold text-muted">{bid ? "Edit bid for" : "Add bid for"}</span> <span>{codeName}</span>
      </h3>
      <div className={FIELDS}>
        <TextField label="Vendor" value={vendor} onChange={setVendor} error={shown.vendor} />
        {/* No `min` here: a zero reaches the form's own message ("Enter an amount above $0") rather than the box's. */}
        <OptionalMoneyField
          label="Amount"
          allowCents
          max={MAX_BID_CENTS}
          valueCents={amountCents}
          onChange={setAmountCents}
          error={shown.amount}
        />
        <DateField label="Received" value={receivedOn} onChange={setReceivedOn} error={shown.receivedOn} />
        <TextField label="Notes" value={notes} onChange={setNotes} />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={PRIMARY_BUTTON}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}
