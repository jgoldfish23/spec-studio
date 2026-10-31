import type { DealEvaluation, DealInputs } from "@engine";
import { Card } from "../../ui/Card";
import { MoneyField, PercentField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import type { Edit } from "../deal/stepShared";
import { FIELD_GRID } from "./FinancingCard";

interface CardProps {
  inputs: DealInputs;
  evaluation: DealEvaluation;
  edit: Edit;
}

/** What it costs to hold the project: builder's risk insurance, and the monthly bills while building and after. */
export function CarryingCard({ inputs, evaluation, edit }: CardProps) {
  const { carry } = inputs;
  const error = (path: string) => fieldError(evaluation, path);
  return (
    <Card title="Carrying" headingLevel={3}>
      <div className={FIELD_GRID}>
        <PercentField
          label="Builder's risk %/yr"
          min={0}
          max={1}
          value={carry.insuranceRate}
          onChange={(rate) => edit((draft) => void (draft.carry.insuranceRate = rate))}
          error={error("carry.insuranceRate")}
        />
        <MoneyField
          label="Utilities during build $/mo"
          min={0}
          valueCents={carry.utilitiesBuildMonthlyCents}
          onChange={(cents) => edit((draft) => void (draft.carry.utilitiesBuildMonthlyCents = cents))}
          error={error("carry.utilitiesBuildMonthlyCents")}
        />
        <MoneyField
          label="Utilities after completion $/mo"
          min={0}
          valueCents={carry.utilitiesAfterMonthlyCents}
          onChange={(cents) => edit((draft) => void (draft.carry.utilitiesAfterMonthlyCents = cents))}
          error={error("carry.utilitiesAfterMonthlyCents")}
        />
        <MoneyField
          label="Staging $/mo"
          min={0}
          valueCents={carry.stagingMonthlyCents}
          onChange={(cents) => edit((draft) => void (draft.carry.stagingMonthlyCents = cents))}
          error={error("carry.stagingMonthlyCents")}
        />
        <MoneyField
          label="Upkeep $/mo"
          min={0}
          valueCents={carry.upkeepMonthlyCents}
          onChange={(cents) => edit((draft) => void (draft.carry.upkeepMonthlyCents = cents))}
          error={error("carry.upkeepMonthlyCents")}
        />
      </div>
    </Card>
  );
}
