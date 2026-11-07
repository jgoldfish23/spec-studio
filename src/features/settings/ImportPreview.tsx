import { PRICE_BOOK_SKIP } from "../../data/exportFile";
import type { ImportPlan } from "../../data/exportFile";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../deal/stepShared";

interface Props {
  plan: ImportPlan;
  replaceSettings: boolean;
  onReplaceSettingsChange: (replace: boolean) => void;
  running: boolean;
  onImport: () => void;
  onCancel: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What an import would do, shown before anything is written: what comes in, what is skipped and why. */
export function ImportPreview({ plan, replaceSettings, onReplaceSettingsChange, running, onImport, onCancel }: Props) {
  const nothing = plan.deals.length + plan.comps.length === 0 && !replaceSettings;
  const skipped = [
    ...plan.skippedDeals.map((deal) => `Deal "${deal.name}": ${deal.reason}`),
    ...plan.skippedComps.map((comp) => `Comp ${comp.address}: ${comp.reason}`),
    ...(plan.skippedPriceBook > 0
      ? [`${plural(plan.skippedPriceBook, "price override", "price overrides")}: ${PRICE_BOOK_SKIP}`]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4">
      <h3 className="m-0 text-[15px] font-bold">What this import will do</h3>
      <p className="m-0 text-sm text-ink">
        {`${plural(plan.deals.length, "deal", "deals")} and ${plural(plan.comps.length, "comp", "comps")} will be imported.`}
      </p>
      {plan.droppedSelections > 0 ? (
        <p className="m-0 text-sm text-muted">
          {`${plural(plan.droppedSelections, "comp choice points", "comp choices point")} at a comp that isn't in the file or your account, so ${plan.droppedSelections === 1 ? "it is" : "they are"} left out.`}
        </p>
      ) : null}
      {skipped.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm font-semibold">{`Skipped (${skipped.length})`}</p>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
        <input
          type="checkbox"
          checked={replaceSettings}
          onChange={(event) => onReplaceSettingsChange(event.target.checked)}
          className="size-5 accent-spruce"
        />
        Also replace my settings
      </label>
      <p className="m-0 text-sm text-muted">
        {replaceSettings
          ? "Your go/no-go rules, contingency and market settings will be replaced with the ones in the file."
          : "Your settings stay as they are."}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onImport}
          disabled={running || nothing}
          className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {running ? "Importing…" : "Import"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={running}
          className={`${SECONDARY_BUTTON} disabled:opacity-60`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
