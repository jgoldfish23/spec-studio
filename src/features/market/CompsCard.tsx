import { useEffect, useRef, useState } from "react";
import type { Comp, DealEvaluation, DealInputs, EngineContext } from "@engine";
import { useDeleteComp, useSaveComp } from "../../data/queries";
import { errorMessage, withoutSavePrefix } from "../../lib/errorMessage";
import { Card } from "../../ui/Card";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { FOCUS_RING, MUTED_NOTE } from "../deal/stepShared";
import type { Edit } from "../deal/stepShared";
import { CompForm } from "./CompForm";
import { emptyCompForm, formFromComp, keepUnshownFields } from "./compForm";
import { CompsTable } from "./CompsTable";
import type { CompRow } from "./CompsTable";

/** The one form that is open: a new comp (with the id it will be saved under) or an existing comp being edited. */
type OpenForm = { kind: "add"; id: string } | { kind: "edit"; comp: Comp };

const HEADER_BUTTON = `inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold ${FOCUS_RING}`;
const LIVE_BUTTON = `${HEADER_BUTTON} cursor-pointer border-[#C9CEC8] bg-surface text-ink hover:bg-paper`;
const LATER_BUTTON = `${HEADER_BUTTON} cursor-not-allowed border-[#DCDFD9] bg-paper text-muted`;

/** A header button for something that arrives later: disabled, with a tag that says so. */
function LaterButton({ children }: { children: string }) {
  return (
    <button type="button" disabled className={LATER_BUTTON}>
      {children}
      <span className="rounded border border-[#B8BEB9] px-1.5 py-px text-[11px] font-medium">Later</span>
    </button>
  );
}

/** The rows of the table: every comp scored, best first, or, while the deal cannot be scored, the library as it is. */
function rowsOf(evaluation: DealEvaluation, comps: Comp[]): CompRow[] {
  if (evaluation.scoredComps.length > 0) {
    return evaluation.scoredComps.map(({ comp, score, included }) => ({ comp, score, included }));
  }
  return comps.map((comp) => ({ comp, score: null, included: null }));
}

/** The line under the card's title: how many comps, and that they are ranked when they have been scored. */
function caption(count: number, ranked: boolean): string {
  if (count === 0) return "Sold homes like this one.";
  const comps = `${count} ${count === 1 ? "comp" : "comps"}`;
  return ranked ? `${comps}, ranked by match.` : `${comps}. Match scores appear once the deal's missing details are filled in.`;
}

interface CompsCardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  context: EngineContext;
  edit: Edit;
}

/**
 * The comps library for the deal's region: the table with each comp's match, adjusted value and whether it counts,
 * the inline form to add or edit one, and the confirmed delete. Which comps count is the deal's own choice
 * (`compSelections`, written through the editor); the comps themselves are shared by every deal in the region, so they
 * are saved and deleted through the data layer, and the estimates follow when the library changes.
 */
export function CompsCard({ inputs, evaluation, context, edit }: CompsCardProps) {
  const saveComp = useSaveComp();
  const deleteComp = useDeleteComp();
  const [form, setForm] = useState<OpenForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Comp | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** The form that is open now, for work that finishes later and must not close a form opened since. */
  const openNow = useRef<OpenForm | null>(null);
  useEffect(() => {
    openNow.current = form;
  }, [form]);

  const rows = rowsOf(evaluation, context.comps);
  /** Every comp has a score only when the deal could be scored; otherwise the table is the library as it is. */
  const ranked = rows.some((row) => row.score !== null);
  const county = inputs.lot.county;

  /** Moves focus to the element marked `marker` in the card. False when there is none. */
  function focusMarked(marker: string): boolean {
    const found = Array.from(boxRef.current?.querySelectorAll<HTMLElement>("[data-focus]") ?? []).find(
      (element) => element.dataset.focus === marker,
    );
    found?.focus();
    return found !== undefined;
  }

  function focusFirstBox() {
    boxRef.current?.querySelector<HTMLElement>("form input")?.focus();
  }

  /** Closes the form, with focus on the button that opened it (the comp's Edit, when that is still there). */
  function closeForm(closing: OpenForm) {
    if (closing.kind === "add") addRef.current?.focus();
    else if (!focusMarked(`edit:${closing.comp.id}`)) boxRef.current?.focus();
    setForm(null);
    setSaveError(null);
  }

  function openAdd() {
    setSaveError(null);
    // A new comp that is half typed is kept, not replaced by an empty form.
    if (form?.kind === "add") focusFirstBox();
    else setForm({ kind: "add", id: crypto.randomUUID() });
  }

  function openEdit(comp: Comp) {
    setSaveError(null);
    setForm({ kind: "edit", comp });
  }

  async function save(comp: Comp) {
    const target = form;
    if (target === null) return;
    setSaveError(null);
    setSaving(true);
    try {
      await saveComp.mutateAsync(target.kind === "edit" ? keepUnshownFields(comp, target.comp) : comp);
    } catch (error) {
      setSaveError(`Couldn't save the comp: ${withoutSavePrefix(errorMessage(error))}`);
      return;
    } finally {
      setSaving(false);
    }
    // Only the form that was saved is closed: the owner may have opened another while the save was under way.
    if (openNow.current === target) closeForm(target);
  }

  async function remove(comp: Comp) {
    setToDelete(null);
    setDeleteError(null);
    try {
      await deleteComp.mutateAsync(comp.id);
    } catch (error) {
      setDeleteError(`Couldn't delete ${comp.address}: ${withoutSavePrefix(errorMessage(error))}`);
      return;
    }
    // The deal's choice for the comp goes with it, so no key is left for a comp that is gone.
    edit((draft) => void delete draft.compSelections[comp.id]);
    const open = openNow.current;
    if (open?.kind === "edit" && open.comp.id === comp.id) {
      setForm(null);
      setSaveError(null);
    }
    // The row the owner pressed Delete on is gone, and focus with it. Take it back, unless it has moved on meanwhile.
    const active = document.activeElement;
    if (active === null || active === document.body || boxRef.current?.contains(active)) boxRef.current?.focus();
  }

  return (
    <Card
      title="Comps"
      actions={
        <div className="flex flex-wrap gap-3">
          <button ref={addRef} type="button" onClick={openAdd} className={LIVE_BUTTON}>
            Add comp
          </button>
          <LaterButton>Import spreadsheet</LaterButton>
          <LaterButton>Import file</LaterButton>
        </div>
      }
    >
      <p className="m-0 -mt-2 text-[13px] text-muted">{caption(rows.length, ranked)}</p>
      {/* Focusable only from code: the last place focus can go back to when the row it was on is gone. */}
      <div ref={boxRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {form !== null ? (
          <CompForm
            key={form.kind === "add" ? "add" : `edit:${form.comp.id}`}
            mode={form.kind}
            initial={form.kind === "add" ? emptyCompForm(county) : formFromComp(form.comp)}
            region={inputs.lot.region}
            id={form.kind === "add" ? form.id : form.comp.id}
            saving={saving}
            saveError={saveError}
            onSave={(comp) => void save(comp)}
            onCancel={() => closeForm(form)}
          />
        ) : null}
        {deleteError ? (
          <p role="alert" className="m-0 text-[13px] font-medium text-no-go">
            {deleteError}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className={MUTED_NOTE}>No comps yet. Add the first one to get a market estimate.</p>
        ) : (
          <CompsTable
            rows={rows}
            ranked={ranked}
            price={evaluation.price}
            settings={context.marketSettings}
            selections={inputs.compSelections}
            // Flips what the table shows: the comp is in now if its score put it there or the owner did.
            onToggle={({ comp, included }) => edit((draft) => void (draft.compSelections[comp.id] = !included))}
            onReset={(comp) => edit((draft) => void delete draft.compSelections[comp.id])}
            onEdit={openEdit}
            onDelete={setToDelete}
          />
        )}
      </div>
      {toDelete !== null ? (
        <ConfirmDialog
          message={`Delete ${toDelete.address}? It's removed from every deal in Northern Utah. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void remove(toDelete)}
          onCancel={() => setToDelete(null)}
        />
      ) : null}
    </Card>
  );
}
