import type { DealEvaluation, DealInputs } from "@engine";
import { Card } from "../../ui/Card";
import { MoneyField, NumberField, PercentField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import type { Edit } from "../deal/stepShared";

/** Boxes in a row, wrapping to a column on a phone. */
export const FIELD_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4";

interface CardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

/** The construction loan: how much it lends, what it costs, how long it runs, and whether interest is paid as it comes. */
export function FinancingCard({ inputs, evaluation, edit }: CardProps) {
  const { loan } = inputs;
  const error = (path: string) => fieldError(evaluation, path);
  return (
    <Card title="Financing">
      <div className={FIELD_GRID}>
        <PercentField
          label="Loan-to-cost %"
          min={0}
          max={0.95}
          value={loan.ltc}
          onChange={(ltc) => edit((draft) => void (draft.loan.ltc = ltc))}
          error={error("loan.ltc")}
        />
        <PercentField
          label="Rate %"
          min={0}
          max={1}
          value={loan.rate}
          onChange={(rate) => edit((draft) => void (draft.loan.rate = rate))}
          error={error("loan.rate")}
        />
        <PercentField
          label="Points %"
          min={0}
          max={1}
          value={loan.points}
          onChange={(points) => edit((draft) => void (draft.loan.points = points))}
          error={error("loan.points")}
        />
        <MoneyField
          label="Draw fee $"
          min={0}
          valueCents={loan.drawFeeCents}
          onChange={(cents) => edit((draft) => void (draft.loan.drawFeeCents = cents))}
          error={error("loan.drawFeeCents")}
        />
        <NumberField
          label="Term months"
          integer
          min={1}
          max={60}
          hint="Whole months"
          value={loan.termMonths}
          onChange={(months) => edit((draft) => void (draft.loan.termMonths = months))}
          error={error("loan.termMonths")}
        />
        <PercentField
          label="Extension fee %"
          min={0}
          max={1}
          value={loan.extensionPct}
          onChange={(pct) => edit((draft) => void (draft.loan.extensionPct = pct))}
          error={error("loan.extensionPct")}
        />
        <NumberField
          label="Extension length months"
          integer
          min={1}
          max={12}
          hint="Whole months"
          value={loan.extensionMonths}
          onChange={(months) => edit((draft) => void (draft.loan.extensionMonths = months))}
          error={error("loan.extensionMonths")}
        />
        <SegmentedField
          label="Interest"
          options={[
            { value: "paid", label: "Paid monthly" },
            { value: "capitalized", label: "Rolled into the loan" },
          ]}
          value={loan.interestMode}
          onChange={(mode) => edit((draft) => void (draft.loan.interestMode = mode))}
          error={error("loan.interestMode")}
        />
      </div>
    </Card>
  );
}
