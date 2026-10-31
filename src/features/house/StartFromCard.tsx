import type { ReactNode } from "react";
import { Card } from "../../ui/Card";
import { TextField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import type { HouseCardProps } from "./shared";

const CHOICE_BASE =
  "min-h-11 cursor-pointer rounded-[10px] px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

function SourceButton({
  selected,
  title,
  detail,
  onChoose,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        if (!selected) onChoose();
      }}
      className={`${CHOICE_BASE} border-2 ${selected ? "border-spruce bg-[#F1F6F4]" : "border-[#C9CEC8] bg-surface hover:bg-paper"}`}
    >
      <span className="block text-[15px] font-semibold text-ink">{title}</span>
      <span className="mt-1 block text-[13px] text-muted">{detail}</span>
    </button>
  );
}

/** A choice that is planned but not built: dimmed and disabled, with a Later tag. */
function LaterButton({ title, detail }: { title: ReactNode; detail: string }) {
  return (
    <button
      type="button"
      disabled
      className={`${CHOICE_BASE} cursor-not-allowed border border-dashed border-[#B8BEB9] bg-[#F7F8F6]`}
    >
      <span className="block text-[15px] font-semibold text-muted">{title}</span>
      <span className="mt-1 block text-[13px] text-muted">{detail}</span>
    </button>
  );
}

/** Where the house comes from: described here, or typed in from a stock plan or drafter's PDF. */
export function StartFromCard({ house, evaluation, edit }: HouseCardProps) {
  const error = (path: string) => fieldError(evaluation, path);
  const sourceError = error("house.source");
  return (
    <Card title="Start from">
      <div role="group" aria-label="Start from" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2.5">
        <SourceButton
          selected={house.source === "described"}
          title="Describe it"
          detail="Sizes, levels, features"
          onChoose={() => edit((draft) => void (draft.house.source = "described"))}
        />
        <SourceButton
          selected={house.source === "stockPlan"}
          title="Stock plan or drafter PDF"
          detail="Type in the plan's specs"
          onChoose={() => edit((draft) => void (draft.house.source = "stockPlan"))}
        />
        <LaterButton
          title={
            <>
              Plan library <span className="ml-1 rounded-sm border border-[#B8BEB9] px-1.5 py-px text-[11px] font-normal">Later</span>
            </>
          }
          detail="Your saved plans + options"
        />
      </div>
      {sourceError ? <p className="m-0 text-[13px] font-medium text-no-go">{sourceError}</p> : null}
      {house.source === "stockPlan" ? (
        <div className="max-w-lg">
          <TextField
            label="Plan name/reference"
            value={house.stockPlanRef ?? ""}
            onChange={(text) =>
              edit((draft) => {
                if (text === "") delete draft.house.stockPlanRef;
                else draft.house.stockPlanRef = text;
              })
            }
            error={error("house.stockPlanRef")}
          />
        </div>
      ) : null}
    </Card>
  );
}
