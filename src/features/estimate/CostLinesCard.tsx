import { useEffect, useRef, useState } from "react";
import type { Bid, DealEvaluation } from "@engine";
import { Card } from "../../ui/Card";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { removeBid, upsertBid } from "./bids";
import { CostTable } from "./CostTable";
import type { FocusTarget, LineFilter } from "./CostTable";
import { IncompleteEstimate } from "./IncompleteEstimate";
import type { Edit } from "./shared";

const FILTERS = [
  { value: "all", label: "All lines" },
  { value: "defaults", label: "Defaults only" },
] as const satisfies readonly { value: LineFilter; label: string }[];

interface CostLinesCardProps {
  dealId: string;
  evaluation: DealEvaluation;
  edit: Edit;
}

/**
 * The cost lines: the table with its filter, the parts of the lines that are open and the bid forms, or, while the
 * engine cannot price every line, what it is missing. Bids go into the deal through `edit`, one bid per cost code.
 */
export function CostLinesCard({ dealId, evaluation, edit }: CostLinesCardProps) {
  const { estimate } = evaluation;
  const [filter, setFilter] = useState<LineFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** The one bid form that is open: a line's code in the table, or an item's key in the incomplete list. */
  const [openForm, setOpenForm] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Where focus goes once the form has gone: set when it is closed, used when the screen has drawn without it. */
  const returnFocus = useRef<string | null>(null);

  useEffect(() => {
    if (openForm !== null || returnFocus.current === null) return;
    const marker = returnFocus.current;
    returnFocus.current = null;
    boxRef.current?.querySelector<HTMLElement>(`[data-focus="${marker}"]`)?.focus();
  }, [openForm]);

  function toggle(code: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }

  function closeForm(key: string, target: FocusTarget) {
    returnFocus.current = `${target}:${key}`;
    setOpenForm(null);
  }

  function saveBid(key: string, bid: Bid) {
    edit((draft) => void (draft.bids = upsertBid(draft.bids, bid)));
    // The line's own button changes (Add bid becomes Edit bid) once the estimate is worked out again; its name stays.
    closeForm(key, "name");
  }

  function dropBid(code: string) {
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
      <div ref={boxRef}>
        {estimate.status === "ok" ? (
          <CostTable
            estimate={estimate.value}
            filter={filter}
            expanded={expanded}
            openForm={openForm}
            onToggle={toggle}
            onOpenForm={setOpenForm}
            onCloseForm={closeForm}
            onSaveBid={(bid) => saveBid(bid.code, bid)}
            onRemoveBid={dropBid}
          />
        ) : (
          <IncompleteEstimate
            dealId={dealId}
            missing={estimate.missing}
            openForm={openForm}
            onOpenForm={setOpenForm}
            onCloseForm={closeForm}
            onSaveBid={(bid) => saveBid(openForm ?? bid.code, bid)}
          />
        )}
      </div>
    </Card>
  );
}
