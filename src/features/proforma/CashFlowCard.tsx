import type { ScenarioResult, YearMonth } from "@engine";
import { formatMoney } from "../../lib/format";
import { Card } from "../../ui/Card";
import { FOCUS_RING, MUTED_NOTE } from "../deal/stepShared";
import { CASH_FLOW_COLUMNS, carryOf } from "./cashFlowColumns";
import { monthLabel } from "./timeline";

interface CashFlowCardProps {
  /** A scenario that ran, so its months can be named. */
  result: ScenarioResult;
  /** The land close month of the inputs the result was worked out from. */
  landClose: YearMonth;
}

/** The selected scenario's schedule, month by month from land close to the sale, folded away until it is asked for. */
export function CashFlowCard({ result, landClose }: CashFlowCardProps) {
  return (
    <Card title="Monthly cash flow">
      <details>
        <summary
          className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-1 text-[15px] font-semibold text-spruce hover:underline ${FOCUS_RING}`}
        >
          Show month by month
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">Month by month cash flow</caption>
              <thead>
                <tr className="border-b-2 border-ink text-xs text-muted">
                  <th scope="col" className="px-2 py-2 text-left font-semibold">
                    Month
                  </th>
                  {CASH_FLOW_COLUMNS.map((name) => (
                    <th key={name} scope="col" className="px-2 py-2 text-right font-semibold">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.cashFlow.periods.map((period) => (
                  <tr key={period.index} className="border-b border-[#EEF0EC] last:border-b-0">
                    <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-semibold">
                      {monthLabel(landClose, period.index)}
                    </th>
                    <td className="px-2 py-2 text-right">{formatMoney(period.spendCents)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(period.loanDrawCents)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(period.interestCents)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(carryOf(period))}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(period.equityOutCents)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(period.cumulativeEquityCents)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(period.loanBalanceEndCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={MUTED_NOTE}>
            Carry is property tax, insurance, utilities, staging, upkeep and HOA. Interest is the construction loan's;
            points, fees and land-loan interest are in Equity out.
          </p>
        </div>
      </details>
    </Card>
  );
}
