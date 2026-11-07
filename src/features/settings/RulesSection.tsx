import { LIMITS } from "@engine";
import { CompanySettingsSchema } from "../../data/readBack";
import { useSaveCompanySettings } from "../../data/queries";
import type { CompanySettings } from "../../data/types";
import { Card } from "../../ui/Card";
import { MoneyField, PercentField } from "../../ui/fields";
import { FIELD_GRID } from "../deal/stepShared";
import { SaveBar } from "./SaveBar";
import { issueAt, schemaValidator, useSettingsForm } from "./useSettingsForm";

const validate = schemaValidator<CompanySettings>(CompanySettingsSchema);

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
    save: (draft) => save.mutateAsync(draft),
    onDirtyChange,
  });
  const { draft, issues } = form;
  const error = (path: string) => issueAt(issues, path);
  // A box that holds text that is not a value (or one out of its range) shows its own message and turns Save off;
  // the schema is the backstop for what a box cannot see.
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
            onInvalidChange={form.invalid("rules.minMarginOnSale")}
            min={0}
            max={LIMITS.rate}
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
            onInvalidChange={form.invalid("rules.minAnnualizedReturn")}
            min={0}
            max={LIMITS.rate}
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
            onInvalidChange={form.invalid("rules.minDownsideProfitCents")}
            min={0}
            max={LIMITS.moneyCents}
          />
          <PercentField
            label="Contingency for new deals"
            value={draft.contingencyPct}
            onChange={(rate) => form.change((d) => ({ ...d, contingencyPct: rate }))}
            error={error("contingencyPct")}
            onInvalidChange={form.invalid("contingencyPct")}
            min={0}
            max={LIMITS.rate}
          />
        </div>
        <SaveBar disabled={!form.canSave} saving={form.saving} saved={form.justSaved} failure={form.failure} />
      </form>
    </Card>
  );
}
