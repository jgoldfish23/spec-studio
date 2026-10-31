import { useId } from "react";
import type { Estimate } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";
import { Card } from "../../ui/Card";
import { PercentField } from "../../ui/fields";
import { TIER_NAMES } from "../house/shared";
import { MUTED_NOTE } from "./shared";

/** The most a contingency rate may be: the engine's cap, 100% (stored as the decimal 1). */
const MAX_CONTINGENCY = 1;

const WAITING = "Fill in the missing prices to see this.";

interface BuildEstimateCardProps {
  /** The estimate, or null while a line has no price. */
  estimate: Estimate | null;
  /** The contingency rate as it is being edited (a decimal), which can be ahead of the estimate. */
  contingencyPct: number;
  /** The house's finish tier as stored, which can be a value this screen has no name for. */
  houseTier: string;
  contingencyError: string | undefined;
  onContingencyChange: (decimal: number) => void;
}

/** The estimate's total and cost per finished sf, its subtotal, and the contingency rate that is added to it. */
export function BuildEstimateCard({ estimate, contingencyPct, houseTier, contingencyError, onContingencyChange }: BuildEstimateCardProps) {
  const titleId = useId();
  const tier = (TIER_NAMES as Record<string, string | undefined>)[houseTier];
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-xl bg-spruce-dark p-5 text-paper sm:p-[22px]">
      <h2 id={titleId} className="m-0 text-sm font-semibold text-nav-text">
        Build estimate
      </h2>
      <div aria-live="polite" className="text-4xl font-bold tracking-[-0.02em]">
        {formatMoney(estimate?.totalCents)}
      </div>
      <div className="text-sm text-nav-text">{`${formatMoney(estimate?.costPerFinishedSfCents)} per finished sf${tier ? ` · ${tier} finishes` : ""}`}</div>
      <div className="flex flex-col gap-3 border-t border-[#2E433B] pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-nav-text">Subtotal</span>
          <span>{formatMoney(estimate?.subtotalCents)}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="w-40 max-w-full rounded-lg bg-surface px-3 py-2.5 text-ink">
            <PercentField
              label="Contingency"
              min={0}
              max={MAX_CONTINGENCY}
              value={contingencyPct}
              onChange={onContingencyChange}
              error={contingencyError}
            />
          </div>
          <span aria-live="polite" className="pb-3.5">
            {formatMoney(estimate?.contingencyCents)}
          </span>
        </div>
      </div>
    </section>
  );
}

const BAR_COLORS = { bid: "#1F4B3F", priceBook: "#6E9C8C", default: "#DCE5E1" } as const;

/** One legend row: a swatch, what the money is, and how much of it there is. */
function LegendRow({ color, label, cents, outline = false }: { color: string; label: string; cents: number; outline?: boolean }) {
  return (
    <li className="flex justify-between gap-2">
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{ background: color }}
          className={`size-2.5 shrink-0 rounded-xs ${outline ? "border border-[#B8C6C0]" : ""}`}
        />
        {label}
      </span>
      <strong>{formatMoney(cents)}</strong>
    </li>
  );
}

/** How much of the subtotal rests on real bids, on the owner's price book, and on starter defaults. */
export function ConfidenceCard({ estimate }: { estimate: Estimate | null }) {
  if (estimate === null) {
    return (
      <Card title="How solid is this number?">
        <p className={MUTED_NOTE}>{WAITING}</p>
      </Card>
    );
  }
  const { confidence } = estimate;
  const bids = formatPercent(confidence.bidShare, 0);
  const book = formatPercent(confidence.priceBookShare, 0);
  const defaults = formatPercent(confidence.defaultShare, 0);
  return (
    <Card title="How solid is this number?">
      <p className="m-0">
        <span className="text-[28px] font-bold tracking-[-0.02em]">{bids}</span>{" "}
        <span className="text-[15px] font-medium text-muted">backed by real bids</span>
      </p>
      <div
        role="img"
        aria-label={`${bids} bids, ${book} your price book, ${defaults} starter defaults`}
        className="flex h-3 overflow-hidden rounded-md"
      >
        <div style={{ width: `${confidence.bidShare * 100}%`, background: BAR_COLORS.bid }} />
        <div style={{ width: `${confidence.priceBookShare * 100}%`, background: BAR_COLORS.priceBook }} />
        <div style={{ width: `${confidence.defaultShare * 100}%`, background: BAR_COLORS.default }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        <LegendRow color={BAR_COLORS.bid} label="Bids for this job" cents={confidence.bidCents} />
        <LegendRow color={BAR_COLORS.priceBook} label="Your price book" cents={confidence.priceBookCents} />
        <LegendRow color={BAR_COLORS.default} label="Starter defaults" cents={confidence.defaultCents} outline />
      </ul>
    </Card>
  );
}

/** The biggest lines still on starter defaults, and how much of the number bidding them would firm up. */
export function BidsNextCard({ estimate }: { estimate: Estimate | null }) {
  if (estimate === null) {
    return (
      <Card title="Get bids here next">
        <p className={MUTED_NOTE}>{WAITING}</p>
      </Card>
    );
  }
  const { codes, defaultShareAfter } = estimate.bidsNext;
  const lines = codes.flatMap((code) => estimate.lines.filter((line) => line.code === code));
  return (
    <Card title="Get bids here next">
      {lines.length === 0 ? (
        <p className={MUTED_NOTE}>No line is still on a starter default.</p>
      ) : (
        <>
          <p className="m-0 -mt-2 text-[13px] text-muted">Biggest lines still on defaults.</p>
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {lines.map((line) => (
              <li key={line.code}>
                <span className="flex justify-between gap-2">
                  <span>{line.name}</span>
                  <strong>{formatMoney(line.totalCents)}</strong>
                </span>
              </li>
            ))}
          </ol>
          <p className="m-0 text-[13px] font-semibold text-go">
            {`Bidding these cuts defaults from ${formatPercent(estimate.confidence.defaultShare, 0)} to ${formatPercent(defaultShareAfter, 0)}.`}
          </p>
        </>
      )}
    </Card>
  );
}
