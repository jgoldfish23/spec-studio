import type { DealEvaluation, DealInputs } from "@engine";
import { Card } from "../../ui/Card";
import { OptionalMoneyField, OptionalNumberField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import type { Edit } from "../estimate/shared";

/** The most a price may be: the engine's cap, $100 million. */
const MAX_PRICE_CENTS = 10_000_000_000;
/** The most days on market the engine takes: three years. */
const MAX_DOM_DAYS = 1_095;

const FIELDS = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4";

interface OverridesCardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

/**
 * The owner's own figures, each optional: a base sale price and base days on market that stand in for the market
 * estimate, and the price the house is planned to list at (which slows or speeds the days on market). An emptied
 * box takes its key out of the deal, so the market estimate is used again.
 */
export function OverridesCard({ inputs, evaluation, edit }: OverridesCardProps) {
  const error = (path: string) => fieldError(evaluation, path);

  function setOverride(key: "basePriceCents" | "baseDomDays", value: number | undefined) {
    edit((draft) => {
      if (value === undefined) delete draft.overrides[key];
      else draft.overrides[key] = value;
    });
  }

  return (
    <Card title="Your numbers (optional)">
      <div className={FIELDS}>
        <OptionalMoneyField
          label="Base sale price"
          min={0}
          max={MAX_PRICE_CENTS}
          valueCents={inputs.overrides.basePriceCents}
          onChange={(cents) => setOverride("basePriceCents", cents)}
          error={error("overrides.basePriceCents")}
        />
        <OptionalNumberField
          label="Base days on market"
          integer
          min={0}
          max={MAX_DOM_DAYS}
          value={inputs.overrides.baseDomDays}
          onChange={(days) => setOverride("baseDomDays", days)}
          error={error("overrides.baseDomDays")}
        />
        <OptionalMoneyField
          label="Planned list price"
          min={0}
          max={MAX_PRICE_CENTS}
          valueCents={inputs.plannedListPriceCents}
          onChange={(cents) =>
            edit((draft) => {
              if (cents === undefined) delete draft.plannedListPriceCents;
              else draft.plannedListPriceCents = cents;
            })
          }
          error={error("plannedListPriceCents")}
        />
      </div>
      <p className="m-0 text-[13px] text-muted">Leave blank to use the market estimate below.</p>
    </Card>
  );
}
