import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { BasementFinish, Comp } from "@engine";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Toggle } from "../../ui/fields";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../estimate/shared";
import { compFromForm } from "./compForm";
import type { CompFormField, CompFormValues } from "./compForm";
import { FormBox } from "./FormBox";

const FINISHES: { value: BasementFinish; label: string }[] = [
  { value: "none", label: "None" },
  { value: "unfinished", label: "Unfinished" },
  { value: "partial", label: "Partial" },
  { value: "finished", label: "Finished" },
];

/** The boxes in a row, wrapping to a column on a phone. */
const BOXES = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4";

export interface CompFormProps {
  mode: "add" | "edit";
  /** What the boxes start as: empty with the deal's county, or the comp being edited. */
  initial: CompFormValues;
  /** The deal's region, which the comp is saved into. */
  region: string;
  /** The id the comp is saved under. For a new comp it is made when the form opens, so saving twice saves one comp. */
  id: string;
  /** A save is under way: Save waits. */
  saving: boolean;
  /** Why the last Save did not go through, if it did not. */
  saveError: string | null;
  onSave: (comp: Comp) => void;
  onCancel: () => void;
}

/**
 * An inline card for a sold comp. It checks nothing until Save is tried, then says what is wrong under each box and
 * keeps saying it as the boxes are fixed. Save hands the finished `Comp` to `onSave`; Cancel (or Escape) calls
 * `onCancel`; neither writes anything itself. Focus starts in Address, and goes to the first box with a message when
 * a Save is refused.
 */
export function CompForm({ mode, initial, region, id, saving, saveError, onSave, onCancel }: CompFormProps) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  /** Counts refused Saves, so each one moves focus to the first box with a message. */
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    formRef.current?.querySelector("input")?.focus();
  }, []);
  useEffect(() => {
    if (refusals > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusals]);

  const { comp, issues } = compFromForm(values, region, id);
  const messages = new Map<string, string>(attempted ? issues.map((issue) => [issue.path, issue.message] as const) : []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (comp === undefined) {
      setAttempted(true);
      setRefusals((count) => count + 1);
      return;
    }
    onSave(comp);
  }

  function cancelOnEscape(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  }

  /** A text box of the form: its text, and the message about it if Save has been tried. */
  function box(field: CompFormField, label: string, extra: { hint?: string; type?: "date"; numeric?: boolean; prefix?: string } = {}) {
    return (
      <FormBox
        label={label}
        value={values[field]}
        onChange={(text) => setValues((current) => ({ ...current, [field]: text }))}
        error={messages.get(field)}
        hint={extra.hint}
        type={extra.type}
        inputMode={extra.numeric ? "decimal" : undefined}
        prefix={extra.prefix}
      />
    );
  }

  const flag = (key: "walkout" | "adu" | "pool", label: string) => (
    <Toggle label={label} checked={values[key]} onChange={(checked) => setValues((current) => ({ ...current, [key]: checked }))} />
  );

  return (
    <form
      ref={formRef}
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={cancelOnEscape}
      // On a phone the form uses the card's full width, with rules above and below instead of a box: the basement finish
      // choice needs more room than a padded box leaves.
      className="flex flex-col gap-4 border-y border-[#C9CEC8] py-4 sm:rounded-xl sm:border sm:bg-[#F7F8F6] sm:p-5"
    >
      <h3 id={titleId} className="m-0 text-[15px] font-bold">
        {mode === "add" ? "Add comp" : "Edit comp"}
      </h3>
      <div className={BOXES}>
        {box("address", "Address")}
        {box("city", "City")}
        {box("county", "County")}
        {box("listDate", "List date", { type: "date" })}
        {box("contractDate", "Contract date", { type: "date", hint: "Optional" })}
        {box("soldDate", "Sold date", { type: "date" })}
        {box("soldPrice", "Sold price", { numeric: true, prefix: "$" })}
        {box("listPrice", "List price", { numeric: true, prefix: "$", hint: "Optional · defaults to the sold price" })}
        {box("aboveGradeSf", "Above-grade finished sf", { numeric: true })}
        {box("basementSf", "Basement finished sf", { numeric: true })}
        {box("unfinishedSf", "Unfinished sf", { numeric: true })}
        {box("beds", "Beds", { numeric: true })}
        {box("baths", "Baths", { numeric: true })}
        {box("yearBuilt", "Year built", { numeric: true })}
        {box("lotAcres", "Lot acres", { numeric: true })}
        {box("garageBays", "Garage bays", { numeric: true })}
      </div>
      <div className="w-full sm:max-w-md">
        <SegmentedControl
          label="Basement finish"
          options={FINISHES}
          value={values.basementFinish}
          onChange={(basementFinish) => setValues((current) => ({ ...current, basementFinish }))}
        />
      </div>
      <div className="flex flex-wrap gap-x-8">
        {flag("walkout", "Walkout")}
        {flag("adu", "ADU")}
        {flag("pool", "Pool")}
      </div>
      <p className="m-0 text-xs text-muted">A blank area, bed, bath, lot or garage box counts as 0.</p>
      {saveError ? (
        <p role="alert" className="m-0 text-[13px] font-medium text-no-go">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={`${PRIMARY_BUTTON} disabled:cursor-wait disabled:opacity-70`}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}
