import { NumberField } from "../../ui/fields";
import { FIELD_GRID } from "../deal/stepShared";
import { issueAt } from "./useSettingsForm";
import type { SettingsIssue } from "./useSettingsForm";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Props {
  factors: readonly number[];
  issues: readonly SettingsIssue[];
  onChange: (factors: number[]) => void;
  invalid: (key: string) => (invalid: boolean) => void;
}

/** One factor per month the house can list in: above 1 is slower than an average month, below 1 is faster. */
export function SeasonalFields({ factors, issues, onChange, invalid }: Props) {
  const whole = issueAt(issues, "seasonalFactors");
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-bold">Seasonal factors</legend>
      <p className="m-0 text-xs text-muted">1.00 is an average month</p>
      <div className={FIELD_GRID}>
        {MONTHS.map((month, index) => (
          <NumberField
            key={month}
            label={month}
            value={factors[index] ?? 1}
            onChange={(n) => onChange(MONTHS.map((_, i) => (i === index ? n : (factors[i] ?? 1))))}
            error={issueAt(issues, `seasonalFactors.${index}`)}
            onInvalidChange={invalid(`seasonalFactors.${index}`)}
          />
        ))}
      </div>
      {whole ? <p className="m-0 text-[13px] font-medium text-no-go">{whole}</p> : null}
    </fieldset>
  );
}
