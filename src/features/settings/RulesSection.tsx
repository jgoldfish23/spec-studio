import { CompanySettingsSchema } from "../../data/readBack";
import { useSaveCompanySettings } from "../../data/queries";
import type { CompanySettings } from "../../data/types";
import { Card } from "../../ui/Card";
import { MoneyField, PercentField } from "../../ui/fields";
import { FIELD_GRID } from "../proforma/FinancingCard";
import { SaveBar } from "./SaveBar";
import { issueAt, issuesOf, useSettingsForm } from "./useSettingsForm";

const validate = (draft: CompanySettings) => {
  const parsed = CompanySettingsSchema.safeParse(draft);
  return parsed.success ? [] : issuesOf(parsed.error);
};

interface Props {
  saved: CompanySettings;
  onDirtyChange: (dirty: boolean) => void;
}

/** The go/no-go rules and the contingency every new deal starts from. Existing deals keep the rules they hold. */
export function RulesSection({ saved, onDirtyChange }: Props) {
  const save = useSaveCompanySettings();
  const form = useSettingsForm<CompanySettings>({
    saved,
    validate,
    save: (draft) => save.mutateAsync(draft).then(() => draft),
    onDirtyChange,
  });
  const { draft, issues } = form;
  const error = (path: string) => issueAt(issues, path);
  // No min/max on the boxes: a value outside the range still reaches the draft, so the schema's own message shows
  // and Save is off, rather than the box refusing the value and leaving the old one to be saved.
  return (
    <Card title="Go/no-go rules for new deals">
      <form onSubmit={(event) => void form.submit(event)} noValidate className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">New deals start with these. Deals you already have keep their own.</p>
        <div className={FIELD_GRID}>
          <PercentField
            label="Minimum margin on sale price"
            value={draft.rules.minMarginOnSale}
            onChange={(rate) =>
              form.change((d) => ({
                ...d,
                rules: { ...d.rules, minMarginOnSale: rate },
              }))
            }
            error={error("rules.minMarginOnSale")}
          />
          <PercentField
            label="Minimum annualized return on cash"
            value={draft.rules.minAnnualizedReturn}
            onChange={(rate) =>
              form.change((d) => ({
                ...d,
                rules: { ...d.rules, minAnnualizedReturn: rate },
              }))
            }
            error={error("rules.minAnnualizedReturn")}
          />
          <MoneyField
            label="Minimum downside case profit"
            valueCents={draft.rules.minDownsideProfitCents}
            onChange={(cents) =>
              form.change((d) => ({
                ...d,
                rules: { ...d.rules, minDownsideProfitCents: cents },
              }))
            }
            error={error("rules.minDownsideProfitCents")}
          />
          <PercentField
            label="Contingency for new deals"
            value={draft.contingencyPct}
            onChange={(rate) => form.change((d) => ({ ...d, contingencyPct: rate }))}
            error={error("contingencyPct")}
          />
        </div>
        <SaveBar disabled={issues.length > 0} saving={form.saving} saved={form.justSaved} failure={form.failure} />
      </form>
    </Card>
  );
}
