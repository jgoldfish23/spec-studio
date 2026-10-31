import { useMemo } from "react";
import { Link } from "react-router";
import { evaluateDeal } from "@engine";
import type { EngineContext, ISODate, VerdictKind } from "@engine";
import { useEngineContext } from "../../data/queries";
import type { StoredDeal } from "../../data/types";
import { formatDayRange, formatMoney, formatPercent } from "../../lib/format";
import { relativeDay } from "../../lib/relativeDay";
import { VerdictChip } from "../../ui/VerdictChip";
import { summarize } from "../deal/summary";
import type { Summary } from "../deal/summary";
import { houseLine } from "./houseLine";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";
const HEAD = "px-3 py-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted";

/** What a row knows about its deal: still working it out, unable to, or the evaluation's figures and verdict. */
type Calculation =
  | { kind: "waiting" }
  | { kind: "failed" }
  | { kind: "done"; verdict: VerdictKind; summary: Summary };

/** The region a stored deal names. A stored deal is read as it comes, so a region that is not text counts as none. */
function regionOf(deal: StoredDeal): string {
  const region: unknown = deal.inputs.lot?.region;
  return typeof region === "string" ? region : "";
}

function DealRow({
  deal,
  context,
  waiting,
  today,
  onDelete,
}: {
  deal: StoredDeal;
  /** The prices, comps and settings the deal is evaluated with; undefined until they are read, or if they cannot be. */
  context: EngineContext | undefined;
  waiting: boolean;
  today: ISODate;
  onDelete: (deal: StoredDeal) => void;
}) {
  // One deal the engine cannot evaluate must not take the list down with it (spec §8): the row says so and the rest work.
  const calculation = useMemo<Calculation>(() => {
    if (context === undefined) return waiting ? { kind: "waiting" } : { kind: "failed" };
    try {
      const evaluation = evaluateDeal(deal.inputs, context);
      return { kind: "done", verdict: evaluation.verdict.kind, summary: summarize(evaluation) };
    } catch {
      return { kind: "failed" };
    }
  }, [deal.inputs, context, waiting]);
  const summary = calculation.kind === "done" ? calculation.summary : null;

  return (
    <tr className="border-t border-line align-top">
      <td className="px-5 py-4">
        <Link to={`/deals/${deal.id}/lot`} className={`text-[15px] font-semibold text-spruce underline-offset-2 hover:underline ${focusRing}`}>
          {deal.name}
        </Link>
        <div className="mt-1 text-[13px] text-muted">{houseLine(deal.inputs.house)}</div>
      </td>
      <td className="px-3 py-4">
        {calculation.kind === "done" ? (
          <VerdictChip kind={calculation.verdict} />
        ) : calculation.kind === "waiting" ? (
          <span className="text-muted">
            <span aria-hidden="true">…</span>
            <span className="sr-only">Calculating</span>
          </span>
        ) : (
          <span className="text-[13px] font-semibold text-muted">Couldn't calculate</span>
        )}
      </td>
      <td className="px-3 py-4 text-right font-semibold">{formatMoney(summary?.profitCents)}</td>
      <td className="px-3 py-4 text-right">{formatPercent(summary?.marginOnSale)}</td>
      <td className="px-3 py-4 text-right">{formatPercent(summary?.annualizedReturn)}</td>
      <td className="px-3 py-4 text-right">{formatDayRange(summary?.domLow, summary?.domHigh)}</td>
      <td className="px-3 py-4 text-right text-muted">
        <time dateTime={deal.updatedAt}>{relativeDay(deal.updatedAt, today)}</time>
      </td>
      <td className="py-1.5 pr-4 pl-1 text-right">
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
  const waiting = engine.isLoading;
  return (
    <>
      {deals.map((deal) => (
        <DealRow key={deal.id} deal={deal} context={engine.data} waiting={waiting} today={today} onDelete={onDelete} />
      ))}
    </>
  );
}

export interface DealsTableProps {
  deals: StoredDeal[];
  today: ISODate;
  onDelete: (deal: StoredDeal) => void;
}

/** Every deal with its verdict and headline figures. A wide table scrolls inside its box on a phone. */
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
    <div className="overflow-x-auto">
      <table aria-label="Deals" className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
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
        <tbody>
          {groups.map(([region, regionDeals]) => (
            <RegionRows key={region} region={region} deals={regionDeals} today={today} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
