import type { Rules } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";
import { Card } from "../../ui/Card";
import { MUTED_NOTE } from "../deal/stepShared";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right font-bold">{value}</dd>
    </div>
  );
}

/** The three rules the verdict judges the deal by, read-only: they are the company's, and are edited in Settings, later. */
export function RulesCard({ rules }: { rules: Rules }) {
  return (
    <Card title="Your rules">
      <dl className="m-0 flex flex-col gap-3">
        <Row label="Minimum margin on sale" value={formatPercent(rules.minMarginOnSale)} />
        <Row label="Minimum annualized return" value={formatPercent(rules.minAnnualizedReturn)} />
        <Row label="Minimum downside profit" value={formatMoney(rules.minDownsideProfitCents)} />
      </dl>
      <p className={MUTED_NOTE}>Edit in Settings (later).</p>
    </Card>
  );
}
