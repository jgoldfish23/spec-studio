export type PriceSource = "bid" | "priceBook" | "default";

export interface SourceBadgeProps {
  source: PriceSource;
  /** The price is more than a year old. Adds a second chip. */
  stale?: boolean;
}

const SOURCES: Record<PriceSource, { text: string; classes: string }> = {
  bid: { text: "Bid", classes: "bg-spruce text-white" },
  priceBook: { text: "Price book", classes: "border border-[#9FC0B3] bg-[#E5EFEB] text-spruce" },
  default: { text: "Default", classes: "border border-[#D5D9D3] bg-[#EEF0EC] text-muted" },
};

const CHIP = "rounded-full px-[9px] py-[3px] text-xs font-semibold";

/** Where a price came from, in words. A price more than a year old also says so. */
export function SourceBadge({ source, stale = false }: SourceBadgeProps) {
  const { text, classes } = SOURCES[source];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`${CHIP} ${classes}`}>{text}</span>
      {stale ? (
        <>
          {" "}
          <span className={`${CHIP} border border-[#F0D9A8] bg-marginal-bg text-marginal`}>Old price</span>
        </>
      ) : null}
    </span>
  );
}
