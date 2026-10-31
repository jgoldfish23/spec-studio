import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Bid, DealEvaluation } from "@engine";
import { Card } from "../../ui/Card";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { removeBid, upsertBid } from "./bids";
import { CostTable } from "./CostTable";
import type { FocusTarget, LineFilter } from "./CostTable";
import { IncompleteEstimate } from "./IncompleteEstimate";
import type { Edit } from "../deal/stepShared";

const FILTERS = [
  { value: "all", label: "All lines" },
  { value: "defaults", label: "Defaults only" },
] as const satisfies readonly { value: LineFilter; label: string }[];

interface CostLinesCardProps {
  dealId: string;
  evaluation: DealEvaluation;
  edit: Edit;
  /** What to say in place of the lines when a problem with the deal stops the estimate (no bid can help then). */
  blocked?: ReactNode;
}

/**
 * The cost lines: the table with its filter, the parts of the lines that are open and the bid forms, or, while the
 * engine cannot price every line, what it is missing (or, when a problem with the deal stops it, what to fix). Bids go into the deal through `edit`, one bid per cost code.
 */
export function CostLinesCard({ dealId, evaluation, edit, blocked }: CostLinesCardProps) {
  const { estimate } = evaluation;
  const [filter, setFilter] = useState<LineFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** The one bid form that is open: a line's code in the table, or an item's key in the incomplete list. */
  const [openForm, setOpenForm] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /**
   * Set when a bid is saved while the estimate cannot be priced yet: the line it is for gets the focus once the
   * table has come back. `evaluation` is the one the bid was saved against, so a different one means the answer is in.
   */
  const awaitingTable = useRef<{ code: string; evaluation: DealEvaluation } | null>(null);

  /** Moves focus to the element in the cost lines marked `marker` (a `data-focus` value). False when there is none. */
  function focusMarked(marker: string): boolean {
    const target = boxRef.current?.querySelector<HTMLElement>(`[data-focus="${marker}"]`);
    target?.focus();
    return target != null;
  }

  useEffect(() => {
    const waiting = awaitingTable.current;
    if (waiting === null || waiting.evaluation === evaluation) return;
    awaitingTable.current = null;
    // Focus is only put back where it was lost: if the owner has gone to something else meanwhile, it stays there.
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost && !boxRef.current?.contains(active)) return;
    // The line's name when the table is back with it; else what is still to be fixed; else the cost lines themselves.
    if (!focusMarked(`name:${waiting.code}`) && !focusMarked("incomplete-heading")) boxRef.current?.focus();
  }, [evaluation]);

  function toggle(code: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }

  /** Closes the form for `key`, with focus on the button that opened it or on the line's name. */
  function closeForm(key: string, target: FocusTarget) {
    // Before the form goes: its button is what holds focus now, and would take it with it.
    focusMarked(`${target}:${key}`);
    setOpenForm(null);
  }

  function saveBid(key: string, bid: Bid) {
    edit((draft) => void (draft.bids = upsertBid(draft.bids, bid)));
    if (estimate.status === "ok") {
      // The line's own button changes (Add bid becomes Edit bid) once the estimate is worked out again; its name stays.
      closeForm(key, "name");
      return;
    }
    // The table is not there to focus yet; the list of what is missing keeps the focus until it is.
    awaitingTable.current = { code: bid.code, evaluation };
    focusMarked("incomplete-heading");
    setOpenForm(null);
  }

  function dropBid(code: string) {
    // The button pressed is about to go (a line without a bid has no Remove bid); the line's name stays.
    focusMarked(`name:${code}`);
    edit((draft) => void (draft.bids = removeBid(draft.bids, code)));
  }

  return (
    <Card
      title="Cost lines"
      actions={
        estimate.status === "ok" ? (
          // A set width, so "Defaults only" stays on one line.
          <div className="w-64 max-w-full">
            <SegmentedControl label="Show" options={[...FILTERS]} value={filter} onChange={setFilter} />
          </div>
        ) : undefined
      }
    >
      {/* Focusable only from code: the last place focus can go back to (see `awaitingTable`). */}
      <div ref={boxRef} tabIndex={-1} className="outline-none">
        {estimate.status === "ok" ? (
          <CostTable
            estimate={estimate.value}
            filter={filter}
            expanded={expanded}
            openForm={openForm}
            onToggle={toggle}
            onOpenForm={setOpenForm}
            onCloseForm={closeForm}
            onSaveBid={saveBid}
            onRemoveBid={dropBid}
          />
        ) : blocked ? (
          blocked
        ) : (
          <IncompleteEstimate
            dealId={dealId}
            missing={estimate.missing}
            openForm={openForm}
            onOpenForm={setOpenForm}
            onCloseForm={closeForm}
            onSaveBid={saveBid}
          />
        )}
      </div>
    </Card>
  );
}
