import { LIMITS } from "@engine";
import type { DealEvaluation, DealInputs } from "@engine";
import { Card } from "../../ui/Card";
import { MoneyField, PercentField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { FIELD_GRID } from "../deal/stepShared";
import type { Edit } from "../deal/stepShared";

interface CardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

/** What it costs to sell: the two agents, the closing, and any concessions or rate buydown for the buyer. */
export function SellingCard({ inputs, evaluation, edit }: CardProps) {
  const { selling } = inputs;
  const error = (path: string) => fieldError(evaluation, path);
  // The rule that the three rates stay under 100% belongs to the group, not to a box; `fieldError` would hand back a
  // box's own message for the group, so the group's is looked up by its exact path.
  const totalError = evaluation.validation.find((issue) => issue.path === "selling")?.message;
  return (
    <Card title="Selling" headingLevel={3}>
      <div className={FIELD_GRID}>
        <PercentField
          label="Listing agent %"
          min={0}
          max={LIMITS.rate}
          value={selling.listingPct}
          onChange={(pct) => edit((draft) => void (draft.selling.listingPct = pct))}
          error={error("selling.listingPct")}
        />
        <PercentField
          label="Buyer's agent %"
          min={0}
          max={LIMITS.rate}
          value={selling.buyerPct}
          onChange={(pct) => edit((draft) => void (draft.selling.buyerPct = pct))}
          error={error("selling.buyerPct")}
        />
        <PercentField
          label="Closing & title %"
          min={0}
          max={LIMITS.rate}
          value={selling.closingPct}
          onChange={(pct) => edit((draft) => void (draft.selling.closingPct = pct))}
          error={error("selling.closingPct")}
        />
        <MoneyField
          label="Rate buydown / concessions $"
          min={0}
          max={LIMITS.moneyCents}
          valueCents={selling.concessionsCents}
          onChange={(cents) => edit((draft) => void (draft.selling.concessionsCents = cents))}
          error={error("selling.concessionsCents")}
        />
      </div>
      {totalError ? <p className="m-0 text-[13px] font-medium text-no-go">{totalError}</p> : null}
    </Card>
  );
}
