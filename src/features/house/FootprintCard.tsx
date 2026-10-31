import { Card } from "../../ui/Card";
import { NumberField, Toggle } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import { CHOICE_GRID, FIELD_GRID, MAX_AREA, MAX_BAYS, MAX_ROOMS, SIX_GRID, issueAt } from "./shared";
import type { HouseCardProps } from "./shared";

const COMPLEXITIES = [
  { value: "simple", label: "Simple box" },
  { value: "moderate", label: "Moderate" },
  { value: "complex", label: "Complex" },
] as const;

const ROOF_STYLES = [
  { value: "gable", label: "Gable" },
  { value: "hip", label: "Hip" },
  { value: "mixed", label: "Mixed" },
] as const;

/** The footprint and its corners, the roof, the garage, and how many rooms of each kind. */
export function FootprintCard({ house, evaluation, edit }: HouseCardProps) {
  const error = (path: string) => fieldError(evaluation, path);
  const { footprint, roof, garage, rooms } = house;
  // The rule that the footprint covers half the main level belongs to the width and depth together.
  const footprintRule = issueAt(evaluation, "house.footprint");
  return (
    <Card title="Footprint, roof & rooms">
      <div className={FIELD_GRID}>
        <NumberField
          label="Width ft"
          unit="ft"
          min={0}
          max={MAX_AREA}
          value={footprint.widthFt}
          onChange={(ft) => edit((draft) => void (draft.house.footprint.widthFt = ft))}
          error={error("house.footprint.widthFt")}
        />
        <NumberField
          label="Depth ft"
          unit="ft"
          min={0}
          max={MAX_AREA}
          value={footprint.depthFt}
          onChange={(ft) => edit((draft) => void (draft.house.footprint.depthFt = ft))}
          error={error("house.footprint.depthFt")}
        />
      </div>
      {footprintRule ? <p className="m-0 -mt-2 text-[13px] font-medium text-no-go">{footprintRule}</p> : null}

      <div className={CHOICE_GRID}>
        <SegmentedField
          label="Corners & jogs"
          options={[...COMPLEXITIES]}
          value={footprint.complexity}
          onChange={(complexity) => edit((draft) => void (draft.house.footprint.complexity = complexity))}
          error={error("house.footprint.complexity")}
        />
        <SegmentedField
          label="Roof style"
          options={[...ROOF_STYLES]}
          value={roof.style}
          onChange={(style) => edit((draft) => void (draft.house.roof.style = style))}
          error={error("house.roof.style")}
        />
      </div>

      <div className={SIX_GRID}>
        <NumberField
          label="Pitch (/12)"
          unit="/12"
          min={0}
          value={roof.pitchPer12}
          onChange={(pitch) => edit((draft) => void (draft.house.roof.pitchPer12 = pitch))}
          error={error("house.roof.pitchPer12")}
        />
        <NumberField
          label="Garage bays"
          integer
          min={0}
          max={MAX_BAYS}
          value={garage.bays}
          onChange={(bays) => edit((draft) => void (draft.house.garage.bays = bays))}
          error={error("house.garage.bays")}
        />
        <NumberField
          label="Bedrooms"
          integer
          min={0}
          max={MAX_ROOMS}
          value={rooms.bedrooms}
          onChange={(count) => edit((draft) => void (draft.house.rooms.bedrooms = count))}
          error={error("house.rooms.bedrooms")}
        />
        <NumberField
          label="Full baths"
          integer
          min={0}
          max={MAX_ROOMS}
          value={rooms.fullBaths}
          onChange={(count) => edit((draft) => void (draft.house.rooms.fullBaths = count))}
          error={error("house.rooms.fullBaths")}
        />
        <NumberField
          label="Half baths"
          integer
          min={0}
          max={MAX_ROOMS}
          value={rooms.halfBaths}
          onChange={(count) => edit((draft) => void (draft.house.rooms.halfBaths = count))}
          error={error("house.rooms.halfBaths")}
        />
        <NumberField
          label="Fireplaces"
          integer
          min={0}
          max={MAX_ROOMS}
          value={rooms.fireplaces}
          onChange={(count) => edit((draft) => void (draft.house.rooms.fireplaces = count))}
          error={error("house.rooms.fireplaces")}
        />
      </div>

      <div role="group" aria-label="Garage options" className="flex flex-wrap gap-x-8">
        <Toggle label="Tandem" checked={garage.tandem} onChange={(on) => edit((draft) => void (draft.house.garage.tandem = on))} />
        <Toggle label="RV bay" checked={garage.rvBay} onChange={(on) => edit((draft) => void (draft.house.garage.rvBay = on))} />
      </div>
    </Card>
  );
}
