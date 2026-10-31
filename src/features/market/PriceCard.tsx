import type { PriceEstimate, Result } from "@engine";
import { formatMoney } from "../../lib/format";
import { Card } from "../../ui/Card";
import { NEEDS_PRICE_COMPS, whyIncomplete } from "./marketFormat";
import { NeedsNote } from "./NeedsNote";

interface TileProps {
  label: string;
  cents: number;
  /** The middle figure, the one the deal's base case uses, is drawn heavier. */
  base?: boolean;
}

function PriceTile({ label, cents, base = false }: TileProps) {
  return (
    <dl
      className={`m-0 flex items-baseline justify-between gap-3 rounded-[10px] p-3 sm:block ${
        base ? "border-2 border-spruce bg-[#F1F6F4]" : "border border-line"
      }`}
    >
      <dt className={`text-xs ${base ? "font-semibold text-spruce" : "text-muted"}`}>{label}</dt>
      <dd className="m-0 text-xl font-bold text-ink sm:mt-1">{formatMoney(cents)}</dd>
    </dl>
  );
}

/**
 * The sale price the comps point to: a low, a mid and a high, the mid price per effective sf, and how many comps it
 * rests on. Every figure is the engine's. While there is no estimate it says what is missing.
 */
export function PriceCard({ price }: { price: Result<PriceEstimate> }) {
  if (price.status !== "ok") {
    return (
      <Card title="Sale price estimate">
        <NeedsNote>{whyIncomplete(price.missing, "noComps", NEEDS_PRICE_COMPS)}</NeedsNote>
      </Card>
    );
  }
  const { lowCents, midCents, highCents, midPerEffectiveSfCents, comps } = price.value;
  return (
    <Card title="Sale price estimate">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <PriceTile label="Low · downside" cents={lowCents} />
        <PriceTile label="Mid · base" cents={midCents} base />
        <PriceTile label="High · upside" cents={highCents} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="m-0 font-semibold">{`${formatMoney(midPerEffectiveSfCents)} per effective sf`}</p>
        <p className="m-0 text-muted">{`Based on ${comps.length} ${comps.length === 1 ? "comp" : "comps"}`}</p>
      </div>
      <p className="m-0 text-xs text-muted">
        Each included comp is adjusted to this house. Low and high are the 25th and 75th percentiles, weighted by how
        well each comp matches. Effective sf counts a finished basement at a discount.
      </p>
    </Card>
  );
}
