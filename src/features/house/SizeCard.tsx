import { Card } from "../../ui/Card";
import { NumberField, Toggle } from "../../ui/fields";
import { fieldError } from "../deal/fieldErrors";
import { SegmentedField } from "../deal/SegmentedField";
import { FIELD_GRID, MAX_AREA } from "./shared";
import type { HouseCardProps } from "./shared";

const STYLES = [
  { value: "rambler", label: "Rambler" },
  { value: "twoStory", label: "Two-story" },
  { value: "multiLevel", label: "Multi-level" },
] as const;

/** What "Upper level" starts as. */
const DEFAULT_UPPER = { finishedSf: 1000, unfinishedSf: 0, ceilingFt: 9 } as const;

/** One level's three boxes: finished sf, unfinished sf and ceiling height. */
function LevelFields({
  level,
  names,
  path,
  levelOf,
  edit,
  error,
}: {
  level: "main" | "upper";
  names: { finished: string; unfinished: string; ceilings: string };
  path: string;
  levelOf: HouseCardProps["house"]["levels"]["main"];
  edit: HouseCardProps["edit"];
  error: (path: string) => string | undefined;
}) {
  return (
    <>
      <NumberField
        label={names.finished}
        unit="sf"
        min={0}
        max={MAX_AREA}
        value={levelOf.finishedSf}
        onChange={(sf) =>
          edit((draft) => {
            const target = draft.house.levels[level];
            if (target) target.finishedSf = sf;
          })
        }
        error={error(`${path}.finishedSf`)}
      />
      <NumberField
        label={names.unfinished}
        unit="sf"
        min={0}
        max={MAX_AREA}
        value={levelOf.unfinishedSf}
        onChange={(sf) =>
          edit((draft) => {
            const target = draft.house.levels[level];
            if (target) target.unfinishedSf = sf;
          })
        }
        error={error(`${path}.unfinishedSf`)}
      />
      <NumberField
        label={names.ceilings}
        unit="ft"
        min={0}
        value={levelOf.ceilingFt}
        onChange={(ft) =>
          edit((draft) => {
            const target = draft.house.levels[level];
            if (target) target.ceilingFt = ft;
          })
        }
        error={error(`${path}.ceilingFt`)}
      />
    </>
  );
}

/** Style, the main level, and the optional upper level and basement. */
export function SizeCard({ house, evaluation, edit }: HouseCardProps) {
  const error = (path: string) => fieldError(evaluation, path);
  const { main, upper, basement } = house.levels;

  function setUpper(on: boolean) {
    edit((draft) => {
      if (!on) delete draft.house.levels.upper;
      else if (draft.house.levels.upper === undefined) draft.house.levels.upper = { ...DEFAULT_UPPER };
    });
  }

  function setBasement(on: boolean) {
    edit((draft) => {
      const { levels } = draft.house;
      if (!on) {
        delete levels.basement;
      } else if (levels.basement === undefined) {
        // The basement runs under the main level, so it starts as big as that. A main level that is not a usable
        // whole number gives no size to start from.
        const mainFinished = levels.main.finishedSf;
        const totalSf = Number.isInteger(mainFinished) && mainFinished >= 0 ? mainFinished : 0;
        levels.basement = { totalSf, finishedSf: 0, walkout: false };
      }
    });
  }

  return (
    <Card title="Size & levels">
      <div className="max-w-lg">
        <SegmentedField
          label="Style"
          options={[...STYLES]}
          value={house.style}
          onChange={(style) => edit((draft) => void (draft.house.style = style))}
          error={error("house.style")}
        />
      </div>
      <div className={FIELD_GRID}>
        <LevelFields
          level="main"
          names={{ finished: "Main finished sf", unfinished: "Main unfinished sf", ceilings: "Main ceilings ft" }}
          path="house.levels.main"
          levelOf={main}
          edit={edit}
          error={error}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Toggle label="Upper level" checked={upper !== undefined} onChange={setUpper} />
        {upper ? (
          <div role="group" aria-label="Upper level details" className={FIELD_GRID}>
            <LevelFields
              level="upper"
              names={{ finished: "Upper finished sf", unfinished: "Upper unfinished sf", ceilings: "Upper ceilings ft" }}
              path="house.levels.upper"
              levelOf={upper}
              edit={edit}
              error={error}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Toggle label="Basement" checked={basement !== undefined} onChange={setBasement} />
        {basement ? (
          <div role="group" aria-label="Basement details" className={FIELD_GRID}>
            <NumberField
              label="Total sf"
              unit="sf"
              min={0}
              max={MAX_AREA}
              value={basement.totalSf}
              onChange={(sf) =>
                edit((draft) => {
                  if (draft.house.levels.basement) draft.house.levels.basement.totalSf = sf;
                })
              }
              error={error("house.levels.basement.totalSf")}
            />
            <NumberField
              label="Finished sf"
              unit="sf"
              min={0}
              max={MAX_AREA}
              value={basement.finishedSf}
              onChange={(sf) =>
                edit((draft) => {
                  if (draft.house.levels.basement) draft.house.levels.basement.finishedSf = sf;
                })
              }
              error={error("house.levels.basement.finishedSf")}
            />
            <Toggle
              label="Walkout"
              checked={basement.walkout}
              onChange={(walkout) =>
                edit((draft) => {
                  if (draft.house.levels.basement) draft.house.levels.basement.walkout = walkout;
                })
              }
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
