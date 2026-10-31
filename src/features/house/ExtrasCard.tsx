import { LIMITS } from "@engine";
import { Card } from "../../ui/Card";
import { NumberField, OptionalNumberField, Toggle } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import { CHOICE_GRID, FIELD_GRID, TIER_OPTIONS } from "./shared";
import type { HouseCardProps } from "./shared";

const ADU_KINDS = [
  { value: "none", label: "None" },
  { value: "basement", label: "Basement" },
  { value: "detached", label: "Detached" },
] as const;

const POOL_KINDS = [
  { value: "none", label: "None" },
  { value: "fiberglass", label: "Fiberglass" },
  { value: "gunite", label: "Gunite" },
] as const;

/** An accessory dwelling unit, a pool, and the work outside the house. */
export function ExtrasCard({ house, evaluation, edit }: HouseCardProps) {
  const error = (path: string) => fieldError(evaluation, path);
  const { adu, pool, outside } = house;
  return (
    <Card title="Extras & outside">
      <div className={CHOICE_GRID}>
        <div className="flex flex-col gap-4">
          <SegmentedField
            label="ADU"
            options={[...ADU_KINDS]}
            value={adu.type}
            onChange={(type) =>
              edit((draft) => {
                // None leaves no size behind; a kind keeps the size already typed.
                if (type === "none") draft.house.adu = { type };
                else draft.house.adu.type = type;
              })
            }
            error={error("house.adu.type")}
          />
          {adu.type !== "none" ? (
            <div role="group" aria-label="ADU details">
              <OptionalNumberField
                label="Finished sf"
                unit="sf"
                min={0}
                max={LIMITS.areaSf}
                value={adu.finishedSf}
                onChange={(sf) =>
                  edit((draft) => {
                    if (sf === undefined) delete draft.house.adu.finishedSf;
                    else draft.house.adu.finishedSf = sf;
                  })
                }
                error={error("house.adu.finishedSf")}
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <SegmentedField
            label="Pool"
            options={[...POOL_KINDS]}
            value={pool.type}
            onChange={(type) =>
              edit((draft) => {
                // None puts the spa and the heater away with it; a kind keeps the ones already chosen.
                if (type === "none") draft.house.pool = { type, spa: false, heated: false };
                else draft.house.pool.type = type;
              })
            }
            error={error("house.pool.type")}
          />
          {pool.type !== "none" ? (
            <div role="group" aria-label="Pool details" className="flex flex-wrap gap-x-8">
              <Toggle label="Spa" checked={pool.spa} onChange={(on) => edit((draft) => void (draft.house.pool.spa = on))} />
              <Toggle label="Heated" checked={pool.heated} onChange={(on) => edit((draft) => void (draft.house.pool.heated = on))} />
            </div>
          ) : null}
        </div>
      </div>

      <div className={FIELD_GRID}>
        <NumberField
          label="Covered patio sf"
          unit="sf"
          min={0}
          max={LIMITS.areaSf}
          value={outside.coveredPatioSf}
          onChange={(sf) => edit((draft) => void (draft.house.outside.coveredPatioSf = sf))}
          error={error("house.outside.coveredPatioSf")}
        />
        <NumberField
          label="Driveway & flatwork sf"
          unit="sf"
          min={0}
          max={LIMITS.areaSf}
          value={outside.flatworkSf}
          onChange={(sf) => edit((draft) => void (draft.house.outside.flatworkSf = sf))}
          error={error("house.outside.flatworkSf")}
        />
        <NumberField
          label="Fencing lf"
          unit="lf"
          min={0}
          max={LIMITS.fenceLf}
          value={outside.fenceLf}
          onChange={(lf) => edit((draft) => void (draft.house.outside.fenceLf = lf))}
          error={error("house.outside.fenceLf")}
        />
      </div>
      <div className="max-w-lg">
        <SegmentedField
          label="Landscaping tier"
          options={TIER_OPTIONS}
          value={outside.landscapingTier}
          onChange={(tier) => edit((draft) => void (draft.house.outside.landscapingTier = tier))}
          error={error("house.outside.landscapingTier")}
        />
      </div>
    </Card>
  );
}
