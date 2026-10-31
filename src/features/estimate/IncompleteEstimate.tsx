import { useId } from "react";
import { Link } from "react-router";
import { COST_CODES } from "@engine";
import type { Bid, MissingItem } from "@engine";
import { needText } from "../deal/needText";
import { STEPS } from "../deal/steps";
import { stepForMissing } from "../deal/summary";
import { BidForm } from "./BidForm";
import type { FocusTarget } from "./CostTable";
import { ACTION_BUTTON, FOCUS_RING } from "../deal/stepShared";

interface ItemProps {
  dealId: string;
  item: MissingItem;
  /** Names the item among its siblings; the key of its bid form. */
  itemKey: string;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: (target: FocusTarget) => void;
  onSaveBid: (bid: Bid) => void;
}

function MissingEntry({ dealId, item, itemKey, formOpen, onOpenForm, onCloseForm, onSaveBid }: ItemProps) {
  const messageId = useId();
  // An item about one cost code can be fixed right here with a bid; any other is fixed on the step it names.
  const costCode = item.ref === undefined ? undefined : COST_CODES.find((code) => code.id === item.ref);
  const step = stepForMissing(item);
  const stepTitle = STEPS.find((candidate) => candidate.path === step)?.title ?? step;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span id={messageId} className="min-w-0 flex-1 basis-60 py-1 text-sm font-medium">
          {needText(item)}
        </span>
        {costCode ? (
          <button
            type="button"
            data-focus={`trigger:${itemKey}`}
            aria-describedby={messageId}
            onClick={onOpenForm}
            className={ACTION_BUTTON}
          >
            Add bid
          </button>
        ) : (
          <Link to={`/deals/${dealId}/${step}`} aria-describedby={messageId} className={`${ACTION_BUTTON} no-underline`}>
            {`Go to ${stepTitle}`}
          </Link>
        )}
      </div>
      {costCode && formOpen ? (
        <div className="pb-2">
          <BidForm code={costCode.id} codeName={costCode.name} onSave={onSaveBid} onCancel={() => onCloseForm("trigger")} />
        </div>
      ) : null}
    </li>
  );
}

export interface IncompleteEstimateProps {
  dealId: string;
  missing: readonly MissingItem[];
  /** The key of the item whose bid form is open. */
  openForm: string | null;
  onOpenForm: (key: string) => void;
  onCloseForm: (key: string, target: FocusTarget) => void;
  /** Called with the key of the item the bid form was open on, and the bid. */
  onSaveBid: (key: string, bid: Bid) => void;
}

/** What the cost lines show in place of the table while the engine cannot price every line: each thing it is missing. */
export function IncompleteEstimate({ dealId, missing, openForm, onOpenForm, onCloseForm, onSaveBid }: IncompleteEstimateProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Where focus goes after a bid is saved here and the estimate still cannot be priced: the list is what is left to read. */}
      <h3
        tabIndex={-1}
        data-focus="incomplete-heading"
        className={`m-0 rounded-md text-base font-bold ${FOCUS_RING}`}
      >
        Some lines have no price yet
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {missing.map((item, index) => {
          const key = `item-${index}`;
          return (
            <MissingEntry
              key={key}
              dealId={dealId}
              item={item}
              itemKey={key}
              formOpen={openForm === key}
              onOpenForm={() => onOpenForm(key)}
              onCloseForm={(target) => onCloseForm(key, target)}
              onSaveBid={(bid) => onSaveBid(key, bid)}
            />
          );
        })}
      </ul>
    </div>
  );
}
