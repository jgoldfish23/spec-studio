import { FinishTierSchema } from "@engine";
import type { FinishTier } from "@engine";
import { formatMoney } from "../../lib/format";
import { Card } from "../../ui/Card";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import { CHOICE_GRID, TIER_NAMES, TIER_OPTIONS } from "./shared";
import type { HouseCardProps } from "./shared";
import type { TierCost } from "./tierPreview";

type Area = "kitchen" | "primaryBath" | "basement";

const AREAS: { area: Area; label: string }[] = [
  { area: "kitchen", label: "Kitchen" },
  { area: "primaryBath", label: "Primary bath" },
  { area: "basement", label: "Basement" },
];

/** An area with no tier of its own follows the house. */
type OverrideChoice = FinishTier | "same";

const OVERRIDE_OPTIONS: { value: OverrideChoice; label: string }[] = [{ value: "same", label: "Same as house" }, ...TIER_OPTIONS];

function TierButton({
  tier,
  selected,
  cost,
  onChoose,
}: {
  tier: FinishTier;
  selected: boolean;
  cost: TierCost;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        if (!selected) onChoose();
      }}
      className={`min-h-16 cursor-pointer rounded-[10px] border-2 px-2 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce sm:px-4 ${
        selected ? "border-spruce bg-spruce text-white" : "border-[#C9CEC8] bg-surface text-ink hover:bg-paper"
      }`}
    >
      <span className="block text-[15px] font-bold">{TIER_NAMES[tier]}</span>
      <span className={`mt-1 block text-xs sm:text-[13px] ${selected ? "text-white" : "text-muted"}`}>{`${formatMoney(cost.costPerFinishedSfCents)} / fin sf`}</span>
    </button>
  );
}

interface FinishesCardProps extends HouseCardProps {
  /** What the estimate comes to at each house tier. */
  previews: Record<FinishTier, TierCost>;
}

/** The house finish tier, each tier priced per finished square foot, and the areas that are finished differently. */
export function FinishesCard({ house, evaluation, edit, previews }: FinishesCardProps) {
  const { finishes } = house;
  const tierError = fieldError(evaluation, "house.finishes.houseTier");
  return (
    <Card
      title="Finishes"
      actions={
        <span className="rounded-full bg-[#E5EFEB] px-2 py-[3px] text-xs font-semibold text-spruce">Try it — the numbers update</span>
      }
    >
      <div role="group" aria-label="Finishes" className="grid grid-cols-3 gap-2.5">
        {FinishTierSchema.options.map((tier) => (
          <TierButton
            key={tier}
            tier={tier}
            selected={finishes.houseTier === tier}
            cost={previews[tier]}
            onChoose={() => edit((draft) => void (draft.house.finishes.houseTier = tier))}
          />
        ))}
      </div>
      {tierError ? <p className="m-0 text-[13px] font-medium text-no-go">{tierError}</p> : null}

      <div className={CHOICE_GRID}>
        {AREAS.map(({ area, label }) => (
          <SegmentedField
            key={area}
            label={label}
            options={OVERRIDE_OPTIONS}
            value={finishes.overrides[area] ?? "same"}
            onChange={(choice) =>
              edit((draft) => {
                const { overrides } = draft.house.finishes;
                if (choice === "same") delete overrides[area];
                else overrides[area] = choice;
              })
            }
            error={fieldError(evaluation, `house.finishes.overrides.${area}`)}
          />
        ))}
      </div>
    </Card>
  );
}
