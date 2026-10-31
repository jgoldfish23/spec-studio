import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { evaluateDeal } from "@engine";
import type { EngineContext, ISODate, VerdictKind } from "@engine";
import { useEngineContext } from "../../data/queries";
import type { StoredDeal } from "../../data/types";
import { errorMessage } from "../../lib/errorMessage";
import { formatDayRange, formatMoney, formatPercent } from "../../lib/format";
import { relativeDay } from "../../lib/relativeDay";
import { VerdictChip } from "../../ui/VerdictChip";
import { summarize } from "../deal/summary";
import type { Summary } from "../deal/summary";
import { houseLine } from "./houseLine";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const HEAD = "px-3 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted";
/** A figure with its name in front of it on a phone, where each deal is a card and the column headings are gone. */
const FIGURE =
  "flex items-baseline justify-between gap-2 before:content-[attr(data-label)] before:text-xs before:font-normal before:text-muted md:table-cell md:px-3 md:py-4 md:text-right md:before:hidden";

/** What a row knows about its deal: still working it out, unable to (and why), or the evaluation's figures and verdict. */
type Calculation =
  | { kind: "waiting" }
  | { kind: "failed"; reason: string; /** The engine threw on this deal, as opposed to its prices and comps not being readable. */ thrown: boolean }
  | { kind: "done"; verdict: VerdictKind; summary: Summary };

const NO_REGION = "This deal has no region, so its prices and comps cannot be loaded.";

/** The region a stored deal names. A stored deal is read as it comes, so a region that is not text counts as none. */
function regionOf(deal: StoredDeal): string {
  const region: unknown = deal.inputs.lot?.region;
  return typeof region === "string" ? region : "";
}

function DealRow({
  deal,
  context,
  contextError,
  waiting,
  today,
  onDelete,
}: {
  deal: StoredDeal;
  /** The prices, comps and settings the deal is evaluated with; undefined until they are read, or if they cannot be. */
  context: EngineContext | undefined;
  /** Why they could not be read, if they could not. */
  contextError: Error | null;
  waiting: boolean;
  today: ISODate;
  onDelete: (deal: StoredDeal) => void;
}) {
  // One deal the engine cannot evaluate must not take the list down with it (spec §8): the row says so and the rest work.
  const calculation = useMemo<Calculation>(() => {
    if (context === undefined) {
      if (contextError) return { kind: "failed", reason: errorMessage(contextError), thrown: false };
      return waiting ? { kind: "waiting" } : { kind: "failed", reason: NO_REGION, thrown: false };
    }
    try {
      const evaluation = evaluateDeal(deal.inputs, context);
      return { kind: "done", verdict: evaluation.verdict.kind, summary: summarize(evaluation) };
    } catch (error) {
      return { kind: "failed", reason: errorMessage(error), thrown: true };
    }
  }, [deal.inputs, context, contextError, waiting]);
  const summary = calculation.kind === "done" ? calculation.summary : null;

  // The owner sees the reason on the row; the console gets it too, once per failure and not each time the row is drawn
  // (a refreshed list is a new calculation with the same reason). A context that cannot be read is reported by its group.
  const thrownReason = calculation.kind === "failed" && calculation.thrown ? calculation.reason : null;
  useEffect(() => {
    if (thrownReason !== null) console.error(`Couldn't calculate deal ${deal.id}: ${thrownReason}`);
  }, [deal.id, thrownReason]);

  return (
    <tr className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line px-4 py-4 md:table-row md:p-0 md:align-top">
      <td className="col-span-2 min-w-0 break-words md:table-cell md:px-5 md:py-4">
        <Link to={`/deals/${deal.id}/lot`} className={`text-[15px] font-semibold text-spruce underline-offset-2 hover:underline ${focusRing}`}>
          {deal.name}
        </Link>
        <div className="mt-1 text-[13px] text-muted">{houseLine(deal.inputs.house)}</div>
      </td>
      <td className="col-span-2 md:table-cell md:px-3 md:py-4">
        {calculation.kind === "done" ? (
          <VerdictChip kind={calculation.verdict} />
        ) : calculation.kind === "waiting" ? (
          <span className="text-muted">
            <span aria-hidden="true">…</span>
            <span className="sr-only">Calculating</span>
          </span>
        ) : (
          <details className="text-[13px] text-muted">
            <summary className="cursor-pointer py-2 font-semibold">Couldn't calculate</summary>
            <p className="m-0 mb-1 break-words md:max-w-56">{calculation.reason}</p>
          </details>
        )}
      </td>
      <td data-label="Profit" className={`${FIGURE} font-semibold`}>
        {formatMoney(summary?.profitCents)}
      </td>
      <td data-label="Margin" className={FIGURE}>
        {formatPercent(summary?.marginOnSale)}
      </td>
      <td data-label="Annualized" className={FIGURE}>
        {formatPercent(summary?.annualizedReturn)}
      </td>
      <td data-label="Days on market" className={FIGURE}>
        {formatDayRange(summary?.domLow, summary?.domHigh)}
      </td>
      <td data-label="Updated" className={`${FIGURE} text-muted`}>
        <time dateTime={deal.updatedAt}>{relativeDay(deal.updatedAt, today)}</time>
      </td>
      <td className="col-span-2 flex justify-end md:table-cell md:py-1.5 md:pr-4 md:pl-1 md:text-right">
        <button
          type="button"
          aria-label={`Delete ${deal.name}`}
          onClick={() => onDelete(deal)}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-no-go hover:bg-no-go-bg ${focusRing}`}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

/** The deals of one region, evaluated against that region's prices and comps, which are read once for the group. */
function RegionRows({
  region,
  deals,
  today,
  onDelete,
}: {
  region: string;
  deals: StoredDeal[];
  today: ISODate;
  onDelete: (deal: StoredDeal) => void;
}) {
  const engine = useEngineContext(region);
  const { error } = engine;
  // One message for the region, not one for each of its deals.
  useEffect(() => {
    if (error) console.error(`Couldn't read the prices and comps for ${region}: ${error.message}`);
  }, [region, error]);
  return (
    <>
      {deals.map((deal) => (
        <DealRow
          key={deal.id}
          deal={deal}
          context={engine.data}
          contextError={error}
          waiting={engine.isLoading}
          today={today}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

export interface DealsTableProps {
  deals: StoredDeal[];
  today: ISODate;
  onDelete: (deal: StoredDeal) => void;
}

/**
 * Every deal with its verdict and headline figures. From the `md` width up it is a table (scrolling inside its box if
 * the box is narrower than the table); below that each deal is a card: name and house, verdict, a grid of the figures
 * with their names, then Delete. It is one set of elements either way, so nothing is drawn twice.
 */
export function DealsTable({ deals, today, onDelete }: DealsTableProps) {
  const groups = useMemo(() => {
    const byRegion = new Map<string, StoredDeal[]>();
    for (const deal of deals) {
      const region = regionOf(deal);
      byRegion.set(region, [...(byRegion.get(region) ?? []), deal]);
    }
    return [...byRegion];
  }, [deals]);

  return (
    // `relative` so the screen-reader-only text inside (positioned absolutely) is clipped with the table, not left to widen the page.
    <div className="relative md:overflow-x-auto">
      <table aria-label="Deals" className="block w-full border-collapse text-sm md:table md:min-w-[900px]">
        <thead className="hidden md:table-header-group">
          <tr className="text-left">
            <th scope="col" className={`${HEAD} px-5`}>
              Deal
            </th>
            <th scope="col" className={HEAD}>
              Verdict
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Profit
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Margin
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Annualized
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Days on market
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Updated
            </th>
            <th scope="col" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {groups.map(([region, regionDeals]) => (
            <RegionRows key={region} region={region} deals={regionDeals} today={today} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
