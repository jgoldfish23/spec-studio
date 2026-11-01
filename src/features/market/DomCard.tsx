import type { DomConfidence, DomEstimate, Result } from "@engine";
import { formatDayRange, formatDays } from "../../lib/format";
import { Card } from "../../ui/Card";
import { barPercent, BAR_DAYS, NEEDS_DOM_COMPS, whyIncomplete } from "./marketFormat";
import { NeedsNote } from "./NeedsNote";

const CONFIDENCE: Record<DomConfidence, { text: string; classes: string }> = {
  high: { text: "High", classes: "border-[#B8BEB9] bg-paper text-muted" },
  medium: { text: "Medium", classes: "border-[#F0D9A8] bg-marginal-bg text-marginal" },
  low: { text: "Low", classes: "border-[#F2C2BE] bg-no-go-bg text-no-go" },
};

/** How sure the estimate is, as a word in a chip. The sr-only words say what the chip is about. */
function ConfidenceChip({ confidence }: { confidence: DomConfidence }) {
  const { text, classes } = CONFIDENCE[confidence];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${classes}`}>
      <span className="sr-only">Confidence: </span>
      {text}
    </span>
  );
}

const AXIS = [0, 45, 90, 135, 180] as const;

/** The days on a bar from 0 to 180: the low to high range as a band and the typical days as a mark. */
function RangeBar({ low, typical, high }: { low: number; typical: number; high: number }) {
  const left = barPercent(low);
  const right = barPercent(high);
  return (
    <div data-testid="dom-range" aria-hidden="true">
      <div className="relative h-[34px]">
        <div className="absolute inset-x-0 top-3.5 h-1.5 rounded-[3px] bg-[#EEF0EC]" />
        <div
          data-testid="dom-range-band"
          className="absolute top-2.5 h-3.5 min-w-1.5 rounded-[7px] bg-[#9FC0B3]"
          style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
        />
        <div
          data-testid="dom-range-typical"
          className="absolute top-1 h-[26px] w-1 -translate-x-1/2 rounded-xs bg-spruce"
          style={{ left: `${barPercent(typical)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted">
        {AXIS.map((days) => (
          <span key={days}>{days === BAR_DAYS ? `${days} days` : days}</span>
        ))}
      </div>
    </div>
  );
}

interface DomCardProps {
  dom: Result<DomEstimate>;
  /** The month the house lists in ("May 2028"), or null when it cannot be named. */
  listMonth: string | null;
}

/**
 * How long the house should take to get under contract: the engine's low to high range and typical days, how sure it
 * is and how many comps it rests on, a bar showing where the days fall, and the factors that moved it. While there is
 * no estimate it says what is missing.
 */
export function DomCard({ dom, listMonth }: DomCardProps) {
  if (dom.status !== "ok") {
    return (
      <Card title="Days on market">
        <NeedsNote>{whyIncomplete(dom.missing, "noDomComps", NEEDS_DOM_COMPS)}</NeedsNote>
      </Card>
    );
  }
  const { lowDays, typicalDays, highDays, confidence, compCount, recentCount, explain } = dom.value;
  const comps = `${compCount} ${compCount === 1 ? "comp" : "comps"}`;
  const meta = `${comps} · ${recentCount} sold in the last 6 months${listMonth === null ? "" : ` · listing in ${listMonth}`}`;
  return (
    <Card title="Days on market" actions={<ConfidenceChip confidence={confidence} />}>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
          {`${formatDayRange(lowDays, highDays)} days`}
        </p>
        <p className="m-0 text-sm font-semibold">{`Typical: ${formatDays(typicalDays)}`}</p>
        <p className="m-0 text-sm text-muted">{meta}</p>
      </div>
      <RangeBar low={lowDays} typical={typicalDays} high={highDays} />
      <h3 className="m-0 text-sm font-bold">What drove it</h3>
      <ol className="m-0 flex list-none flex-col p-0">
        {explain.map(({ label, effect }, index) => (
          <li
            key={`${index}-${label}`}
            className="flex justify-between gap-3 border-b border-[#EEF0EC] py-2 text-sm last:border-b-0"
          >
            <span>{label}</span>
            <strong className="text-right">{effect}</strong>
          </li>
        ))}
      </ol>
    </Card>
  );
}
