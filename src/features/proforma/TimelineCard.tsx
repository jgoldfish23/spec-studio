import type { ScenarioName, ScenarioResult, YearMonth } from "@engine";
import { Card } from "../../ui/Card";
import { SCENARIO_LABELS } from "./scenarioLabels";
import { barLayout, timelineSegments } from "./timeline";
import type { SegmentKey } from "./timeline";

/** Each stretch of the bar has its own color; the key under the bar says which is which, in words. */
const COLORS: Record<SegmentKey, string> = {
  permits: "#C9D6D0",
  build: "#1F4B3F",
  listed: "#E9A06A",
  closing: "#F6D2B6",
};

interface TimelineCardProps {
  scenario: ScenarioName;
  /** A scenario that ran, so its dates can be named. */
  result: ScenarioResult;
  /** The land close month of the inputs the result was worked out from. */
  landClose: YearMonth;
}

/**
 * The selected scenario as a bar from land close to the sale closing: permits, build, on the market, closing. A marker
 * shows where the loan matures when that is before the sale closes. The bar is a picture; the words under it say the
 * same, with the three months worth knowing.
 */
export function TimelineCard({ scenario, result, landClose }: TimelineCardProps) {
  const { segments, maturityMonth, dates } = timelineSegments(result.cashFlow.times, landClose);
  const { pieces, maturityPct } = barLayout(segments, maturityMonth);
  const months = result.metrics.monthsLandToClose;
  return (
    <Card
      title="Timeline & loan"
      actions={
        <span className="text-[13px] text-muted">
          {`${SCENARIO_LABELS[scenario]} case · ${Number.isFinite(months) ? months.toFixed(1) : "—"} months`}
        </span>
      }
    >
      <div className="relative pt-7">
        <div data-testid="timeline-bar" aria-hidden="true" className="relative h-10 overflow-hidden rounded-lg bg-[#EEF0EC]">
          {pieces.map((piece) => (
            <div
              key={piece.key}
              data-testid="timeline-piece"
              className="absolute inset-y-0"
              style={{ left: `${piece.leftPct}%`, width: `${piece.widthPct}%`, backgroundColor: COLORS[piece.key] }}
            />
          ))}
        </div>
        {maturityPct !== null ? (
          <>
            <div
              data-testid="loan-marker"
              aria-hidden="true"
              className="absolute -bottom-1.5 top-0 -ml-px w-0.5 bg-no-go"
              style={{ left: `${maturityPct}%` }}
            />
            <span
              className={`absolute top-0 whitespace-nowrap text-xs font-bold text-no-go ${maturityPct > 50 ? "-translate-x-full pr-2" : "pl-2"}`}
              style={{ left: `${maturityPct}%` }}
            >
              Loan matures
            </span>
          </>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px] font-semibold">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 flex-none rounded-xs border border-black/10"
              style={{ backgroundColor: COLORS[segment.key] }}
            />
            {segment.label}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-[#5B625E]">
        <span>{`${dates.landClose} · land closes`}</span>
        <span>{`${dates.list} · lists`}</span>
        <span>{`${dates.saleClose} · sale closes`}</span>
      </div>
    </Card>
  );
}
