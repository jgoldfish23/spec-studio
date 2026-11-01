import type { DealEvaluation, DealInputs } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";
import { Card } from "../../ui/Card";
import { NextStepLink } from "../deal/NextStepLink";
import { summarize } from "../deal/summary";
import { landPlusClosing, priceThatMakesGo, shareOf } from "./lotFigures";

function Row({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className={`m-0 text-right font-bold ${good ? "text-go" : ""}`}>{value}</dd>
    </div>
  );
}

interface LotSidePanelProps {
  dealId: string;
  lot: DealInputs["lot"];
  evaluation: DealEvaluation;
}

/** What the lot adds up to, how much of the deal it is, the price that would make the deal a Go, and the way on. */
export function LotSidePanel({ dealId, lot, evaluation }: LotSidePanelProps) {
  const { totalProjectCostCents, salePriceCents } = summarize(evaluation);
  const land = landPlusClosing(lot);
  const goPrice = priceThatMakesGo(evaluation);
  return (
    <aside aria-label="About this lot" className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
      <Card title="Lot so far">
        <dl className="m-0 flex flex-col gap-3.5">
          <Row label="Land + closing" value={formatMoney(land)} />
          <Row label="Share of total project cost" value={formatPercent(shareOf(land, totalProjectCostCents))} />
          <Row label="Share of base sale price" value={formatPercent(shareOf(land, salePriceCents))} />
          <Row label="Price that makes this a Go" value={goPrice.text} good={goPrice.good} />
        </dl>
      </Card>
      <NextStepLink to={`/deals/${dealId}/house`}>Next: describe the house →</NextStepLink>
    </aside>
  );
}
