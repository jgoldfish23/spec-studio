import { LIMITS } from "@engine";
import type { DealEvaluation, DealInputs } from "@engine";
import { useCompanySettings } from "../../data/queries";
import { Card } from "../../ui/Card";
import { MoneyField, PercentField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import type { Edit } from "../deal/stepShared";
import { SECONDARY_BUTTON } from "../deal/stepShared";
import { FIELD_GRID } from "./FinancingCard";

interface CardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

/**
 * The three rules the verdict judges this deal by. They start as the company's (Settings) and are the deal's own from
 * then on: edited here and saved like any other input, or copied afresh from the company with Use company rules.
 */
export function RulesCard({ inputs, evaluation, edit }: CardProps) {
  const { rules } = inputs;
  const company = useCompanySettings().data;
  const error = (path: string) => fieldError(evaluation, path);
  return (
    <Card
      title="Your rules"
      headingLevel={3}
      actions={
        <button
          type="button"
          disabled={company === undefined}
          onClick={() => company && edit((draft) => void (draft.rules = { ...company.rules }))}
          className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          Use company rules
        </button>
      }
    >
      <div className={FIELD_GRID}>
        <PercentField
          label="Minimum margin on sale %"
          min={0}
          max={LIMITS.rate}
          value={rules.minMarginOnSale}
          onChange={(rate) => edit((draft) => void (draft.rules.minMarginOnSale = rate))}
          error={error("rules.minMarginOnSale")}
        />
        <PercentField
          label="Minimum annualized return %"
          min={0}
          max={LIMITS.rate}
          value={rules.minAnnualizedReturn}
          onChange={(rate) => edit((draft) => void (draft.rules.minAnnualizedReturn = rate))}
          error={error("rules.minAnnualizedReturn")}
        />
        <MoneyField
          label="Minimum downside profit $"
          min={0}
          max={LIMITS.moneyCents}
          valueCents={rules.minDownsideProfitCents}
          onChange={(cents) => edit((draft) => void (draft.rules.minDownsideProfitCents = cents))}
          error={error("rules.minDownsideProfitCents")}
        />
      </div>
    </Card>
  );
}
