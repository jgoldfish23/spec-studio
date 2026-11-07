import type { MarketSettings } from "@engine";
import { NumberField } from "../../ui/fields";
import { FIELD_GRID } from "../proforma/FinancingCard";
import { issueAt } from "./useSettingsForm";
import type { SettingsIssue } from "./useSettingsForm";

type Weights = MarketSettings["similarityWeights"];

const WEIGHTS: readonly { key: keyof Weights; label: string }[] = [
  { key: "location", label: "Location" },
  { key: "size", label: "Size" },
  { key: "age", label: "Age" },
  { key: "recency", label: "Recency" },
  { key: "features", label: "Features" },
];

const TOTAL = 100;

/** The words under the boxes when the weights do not total 100; null when they do (or a box holds a bad value). */
export function weightsTotalMessage(weights: Weights): string | null {
  const values = Object.values(weights);
  if (!values.every((n) => Number.isFinite(n) && n >= 0)) return null;
  const total = values.reduce((sum, n) => sum + n, 0);
  return Math.abs(total - TOTAL) <= 1e-9 ? null : `Weights must add up to ${TOTAL} — now ${Number(total.toFixed(6))}`;
}

interface Props {
  weights: Weights;
  issues: readonly SettingsIssue[];
  onChange: (weights: Weights) => void;
}

/** How much each likeness counts when a comp is scored against the house. They are shares of 100. */
export function SimilarityWeightsFields({ weights, issues, onChange }: Props) {
  const total = weightsTotalMessage(weights);
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-3 p-0 text-sm font-bold">Similarity weights (total 100)</legend>
      <div className={FIELD_GRID}>
        {WEIGHTS.map(({ key, label }) => (
          <NumberField
            key={key}
            label={label}
            value={weights[key]}
            onChange={(n) => onChange({ ...weights, [key]: n })}
            error={issueAt(issues, `similarityWeights.${key}`)}
          />
        ))}
      </div>
      {total ? <p className="m-0 text-[13px] font-medium text-no-go">{total}</p> : null}
    </fieldset>
  );
}
