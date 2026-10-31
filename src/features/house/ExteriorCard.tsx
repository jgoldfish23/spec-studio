import { Card } from "../../ui/Card";
import { NumberField } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { COUNT_GRID } from "./shared";
import type { HouseCardProps } from "./shared";

type Material = "stonePct" | "stuccoPct" | "boardBattenPct" | "fiberCementPct";

// Stone, stucco and board and batten are the House mockup's colors; fiber cement is a cool slate the mockup does not use.
const MATERIALS: { key: Material; name: string; label: string; color: string }[] = [
  { key: "stonePct", name: "Stone", label: "Stone %", color: "#8C8174" },
  { key: "stuccoPct", name: "Stucco", label: "Stucco %", color: "#E4DDD0" },
  { key: "boardBattenPct", name: "Board & batten", label: "Board & batten %", color: "#33403A" },
  { key: "fiberCementPct", name: "Fiber cement", label: "Fiber cement %", color: "#6F8796" },
];

/** The engine accepts a total this close to 100. */
const TOLERANCE = 1e-6;

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A share of the bar: a figure that is not a usable number, or is below zero, takes no room. */
const room = (value: unknown): number => (isNumber(value) && value > 0 ? value : 0);

/** The mix as a bar, each material as wide as its share of what is entered. Decoration: the boxes and the total carry the numbers. */
function MixBar({ exterior }: { exterior: HouseCardProps["house"]["exterior"] }) {
  const sum = MATERIALS.reduce((total, { key }) => total + room(exterior[key]), 0);
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="flex h-9 overflow-hidden rounded-lg border border-line bg-[#F7F8F6]">
        {MATERIALS.map(({ key, color }) => (
          <div key={key} data-material={key} style={{ width: sum > 0 ? `${(room(exterior[key]) / sum) * 100}%` : 0, backgroundColor: color }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted">
        {MATERIALS.map(({ key, name, color }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className="size-3 rounded-xs border border-line" style={{ backgroundColor: color }} />
            {`${name} ${isNumber(exterior[key]) ? `${PERCENT.format(exterior[key])}%` : "—"}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The exterior mix: four whole percentages that must add up to 100, with the total and the mix drawn as a bar. */
export function ExteriorCard({ house, evaluation, edit }: HouseCardProps) {
  const { exterior } = house;
  const error = (path: string) => fieldError(evaluation, path);
  const values = MATERIALS.map(({ key }) => exterior[key]);
  // A stored deal can hold a figure that is not a usable number; then there is no total to show.
  const total = values.every(isNumber) ? values.reduce((sum, value) => sum + value, 0) : null;
  const adds = total !== null && Math.abs(total - 100) <= TOLERANCE;
  const engineMessage = error("house.exterior");
  return (
    <Card title="Exterior">
      <MixBar exterior={exterior} />
      <div className={COUNT_GRID}>
        {MATERIALS.map(({ key, label }) => (
          <NumberField
            key={key}
            label={label}
            unit="%"
            hint="Whole percent"
            integer
            min={0}
            max={100}
            value={exterior[key]}
            onChange={(pct) => edit((draft) => void (draft.house.exterior[key] = pct))}
            error={error(`house.exterior.${key}`)}
          />
        ))}
      </div>
      <p
        aria-live="polite"
        className={`m-0 text-sm ${total === null || adds ? "font-semibold text-ink" : "font-semibold text-no-go"}`}
      >
        {total === null
          ? "Total: —"
          : adds
            ? `Total: ${PERCENT.format(total)}%`
            : `Total: ${PERCENT.format(total)}% — must add up to 100%`}
      </p>
      {engineMessage ? <p className="m-0 text-[13px] font-medium text-no-go">{engineMessage}</p> : null}
    </Card>
  );
}
