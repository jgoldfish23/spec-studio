import { useId } from "react";
import { compDomDays } from "@engine";
import type { Comp, MarketSettings, PriceEstimate, Result } from "@engine";
import { formatMoney, formatNumberInput } from "../../lib/format";
import { ACTION_BUTTON, FOCUS_RING } from "../estimate/shared";
import { finishedSf, listedToSold, MISSING, pricePerFinishedSf } from "./marketFormat";

/** A comp as the table lists it. `score` and `included` are null while the deal cannot be scored. */
export interface CompRow {
  comp: Comp;
  score: number | null;
  included: boolean | null;
}

const HEADER = "px-3 py-2.5 font-semibold";
const CELL = "px-3 py-3";

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5 6 10l5-6" />
    </svg>
  );
}

interface RowProps {
  row: CompRow;
  /** What the price estimate made of this comp, if it was used. */
  impliedCents: number | undefined;
  settings: MarketSettings;
  /** The owner has chosen for this comp, rather than leaving it to the match score. */
  chosen: boolean;
  onToggle: () => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function CompTableRow({ row, impliedCents, settings, chosen, onToggle, onReset, onEdit, onDelete }: RowProps) {
  const uid = useId();
  const nameId = `${uid}-name`;
  const hintId = `${uid}-hint`;
  const { comp, score, included } = row;
  const finished = finishedSf(comp);
  return (
    <tr className="border-t border-[#EEF0EC] align-middle">
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <div id={nameId} className="font-semibold">
          {comp.address}
        </div>
        <div className="text-[13px] text-muted">{comp.city}</div>
      </th>
      <td className={CELL}>{comp.yearBuilt}</td>
      <td className={`${CELL} text-right`}>{finished === null ? MISSING : formatNumberInput(finished)}</td>
      <td className={`${CELL} text-right font-semibold`}>{formatMoney(comp.soldPriceCents)}</td>
      <td className={`${CELL} text-right`}>{formatMoney(pricePerFinishedSf(comp))}</td>
      <td className={`${CELL} text-right font-semibold`}>{daysToContract(comp, settings)}</td>
      <td className={`${CELL} whitespace-nowrap text-muted`}>{listedToSold(comp)}</td>
      <td className={`${CELL} text-right`}>{score === null ? MISSING : `${Math.round(score)}%`}</td>
      <td className={`${CELL} text-right`}>{formatMoney(impliedCents)}</td>
      <td className="px-3 py-1">
        {included === null ? (
          MISSING
        ) : (
          <div className="flex flex-col items-start">
            <button
              type="button"
              onClick={onToggle}
              aria-describedby={`${nameId} ${hintId}`}
              className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center rounded-lg ${FOCUS_RING}`}
            >
              {included ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-go-bg px-2.5 py-1 text-xs font-semibold text-go">
                  <CheckIcon />
                  Included
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-dashed border-[#B8BEB9] bg-[#EEF0EC] px-2.5 py-1 text-xs font-semibold text-muted">
                  Excluded
                </span>
              )}
            </button>
            <span id={hintId} className="sr-only">
              {included ? "Press to leave this comp out of the estimates." : "Press to use this comp in the estimates."}
            </span>
            {chosen ? (
              <button type="button" onClick={onReset} aria-describedby={nameId} className={`${ACTION_BUTTON} -ml-2`}>
                Reset to automatic
              </button>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-3 py-1">
        <div className="flex justify-end gap-x-1">
          <button type="button" data-focus={`edit:${comp.id}`} aria-describedby={nameId} onClick={onEdit} className={ACTION_BUTTON}>
            Edit
          </button>
          <button type="button" data-focus={`delete:${comp.id}`} aria-describedby={nameId} onClick={onDelete} className={ACTION_BUTTON}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Days from listing to contract, from the engine's own count; a dash when the comp's dates do not give one. */
function daysToContract(comp: Comp, settings: MarketSettings): string {
  try {
    const days = compDomDays(comp, settings);
    return days === null ? MISSING : String(days);
  } catch {
    // The engine refuses a date that is not a real one; a comp like that shows a dash rather than take the table down.
    return MISSING;
  }
}

export interface CompsTableProps {
  rows: CompRow[];
  price: Result<PriceEstimate>;
  settings: MarketSettings;
  /** The deal's choices, comp id to in or out. */
  selections: Record<string, boolean>;
  onToggle: (row: CompRow) => void;
  onReset: (comp: Comp) => void;
  onEdit: (comp: Comp) => void;
  onDelete: (comp: Comp) => void;
}

/**
 * The comps, best match first, with what each is worth to this house and whether it counts. The table scrolls
 * sideways inside its own box on a narrow screen, so the page does not.
 */
export function CompsTable({ rows, price, settings, selections, onToggle, onReset, onEdit, onDelete }: CompsTableProps) {
  const used = price.status === "ok" ? price.value.comps : [];
  return (
    <div className="relative overflow-x-auto">
      <table aria-label="Comps ranked by match" className="w-full min-w-[1120px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#F7F8F6] text-left text-xs uppercase tracking-[0.04em] text-muted">
            <th scope="col" className={HEADER}>
              Comp
            </th>
            <th scope="col" className={HEADER}>
              Built
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              Fin. sf
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              Sold price
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              $ / fin sf
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              Days to contract
            </th>
            <th scope="col" className={HEADER}>
              Listed → sold
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              Match
            </th>
            <th scope="col" className={`${HEADER} text-right`}>
              Adjusted value
            </th>
            <th scope="col" className={HEADER}>
              Use
            </th>
            <th scope="col" className={HEADER}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CompTableRow
              key={row.comp.id}
              row={row}
              impliedCents={used.find((entry) => entry.id === row.comp.id)?.impliedCents}
              settings={settings}
              // `hasOwn` keeps an id such as "constructor" from reading an inherited property.
              chosen={Object.hasOwn(selections, row.comp.id)}
              onToggle={() => onToggle(row)}
              onReset={() => onReset(row.comp)}
              onEdit={() => onEdit(row.comp)}
              onDelete={() => onDelete(row.comp)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
