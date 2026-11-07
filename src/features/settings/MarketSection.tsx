import { MarketSettingsSchema } from "@engine";
import type { MarketSettings } from "@engine";
import { useSaveMarketSettings } from "../../data/queries";
import { Card } from "../../ui/Card";
import { MoneyField, NumberField, PercentField } from "../../ui/fields";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FIELD_GRID } from "../proforma/FinancingCard";
import { SaveBar } from "./SaveBar";
import { SeasonalFields } from "./SeasonalFields";
import { SimilarityWeightsFields } from "./SimilarityWeightsFields";
import { issueAt, issuesOf, useSettingsForm } from "./useSettingsForm";

const validate = (draft: MarketSettings) => {
  const parsed = MarketSettingsSchema.safeParse(draft);
  return parsed.success ? [] : issuesOf(parsed.error);
};

const CONDITIONS = [
  { value: "hot", label: "Hot" },
  { value: "normal", label: "Normal" },
  { value: "slow", label: "Slow" },
] as const;

const GROUP_TITLE = "m-0 text-sm font-bold";

interface Props {
  saved: MarketSettings;
  onDirtyChange: (dirty: boolean) => void;
}

/** How the comps are weighed and the days on market read in Northern Utah (Davis & Weber). */
export function MarketSection({ saved, onDirtyChange }: Props) {
  const save = useSaveMarketSettings();
  const form = useSettingsForm<MarketSettings>({
    saved,
    validate,
    save: (draft) => save.mutateAsync(draft).then(() => draft),
    onDirtyChange,
  });
  const { draft, issues } = form;
  const error = (path: string) => issueAt(issues, path);
  const set = (update: (draft: MarketSettings) => MarketSettings) => form.change(update);
  const feature = (key: keyof MarketSettings["featureValues"]) => (cents: number) =>
    set((d) => ({
      ...d,
      featureValues: { ...d.featureValues, [key]: cents },
    }));
  // As in the rules form, the boxes carry no limits of their own: the schema's message shows and Save is off.
  return (
    <Card title="Market settings — Northern Utah (Davis & Weber)">
      <form onSubmit={(event) => void form.submit(event)} noValidate className="flex flex-col gap-6">
        <SegmentedControl
          label="Market condition"
          options={[...CONDITIONS]}
          value={draft.marketCondition}
          onChange={(marketCondition) => set((d) => ({ ...d, marketCondition }))}
        />

        <div className={FIELD_GRID}>
          <PercentField
            label="Default property tax rate"
            value={draft.defaultTaxRate}
            onChange={(defaultTaxRate) => set((d) => ({ ...d, defaultTaxRate }))}
            error={error("defaultTaxRate")}
          />
          <NumberField
            label="Basement value factor"
            value={draft.basementFactor}
            onChange={(basementFactor) => set((d) => ({ ...d, basementFactor }))}
            error={error("basementFactor")}
          />
          <NumberField
            label="Price elasticity"
            value={draft.elasticity}
            onChange={(elasticity) => set((d) => ({ ...d, elasticity }))}
            error={error("elasticity")}
          />
          <NumberField
            label="Include comps scoring at least"
            hint="0 to 100"
            value={draft.includeThreshold}
            onChange={(includeThreshold) => set((d) => ({ ...d, includeThreshold }))}
            error={error("includeThreshold")}
          />
          <NumberField
            label="Assumed days from contract to close"
            value={draft.assumedClosingDays}
            onChange={(assumedClosingDays) => set((d) => ({ ...d, assumedClosingDays }))}
            error={error("assumedClosingDays")}
          />
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className={`${GROUP_TITLE} mb-3 p-0`}>Feature values</legend>
          <div className={FIELD_GRID}>
            <MoneyField
              label="Garage bay"
              valueCents={draft.featureValues.garageBayCents}
              onChange={feature("garageBayCents")}
              error={error("featureValues.garageBayCents")}
            />
            <MoneyField
              label="Walkout"
              valueCents={draft.featureValues.walkoutCents}
              onChange={feature("walkoutCents")}
              error={error("featureValues.walkoutCents")}
            />
            <MoneyField
              label="Lot per acre"
              valueCents={draft.featureValues.lotPerAcreCents}
              onChange={feature("lotPerAcreCents")}
              error={error("featureValues.lotPerAcreCents")}
            />
            <MoneyField
              label="ADU"
              valueCents={draft.featureValues.aduCents}
              onChange={feature("aduCents")}
              error={error("featureValues.aduCents")}
            />
            <MoneyField
              label="Pool"
              valueCents={draft.featureValues.poolCents}
              onChange={feature("poolCents")}
              error={error("featureValues.poolCents")}
            />
          </div>
        </fieldset>

        <SimilarityWeightsFields
          weights={draft.similarityWeights}
          issues={issues}
          onChange={(similarityWeights) => set((d) => ({ ...d, similarityWeights }))}
        />

        <SeasonalFields
          factors={draft.seasonalFactors}
          issues={issues}
          onChange={(seasonalFactors) => set((d) => ({ ...d, seasonalFactors }))}
        />

        <SaveBar disabled={issues.length > 0} saving={form.saving} saved={form.justSaved} failure={form.failure} />
      </form>
    </Card>
  );
}
