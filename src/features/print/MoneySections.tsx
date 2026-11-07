import type { Estimate, PriceEstimate, Result, ScenarioResult, ScoredComp, YearMonth } from "@engine";
import { formatMoney, formatPercentCompact } from "../../lib/format";
import { DIVISION_NAMES, groupByDivision } from "../estimate/lineFormat";
import { monthYear } from "../market/marketFormat";
import { carryOf, CASH_FLOW_COLUMNS } from "../proforma/cashFlowColumns";
import { monthLabel } from "../proforma/timeline";
import { CELL, Fact, Facts, HEAD_CELL, PRINT_ROW, PRINT_TABLE, PrintSection, ROW_HEAD, TableBox } from "./PrintSection";
import { sourceCents, sourceMixText } from "./sourceMix";

const MISSING = "—";

/** The paper version of the Estimate page's cost lines: a row for each division, then the contingency and the total. */
export function DivisionsSection({ estimate }: { estimate: Estimate }) {
  const divisions = groupByDivision(estimate.lines);
  return (
    <PrintSection title="Estimate by division">
      <TableBox>
        <table className={PRINT_TABLE}>
          <thead>
            <tr className={`${PRINT_ROW} border-b-2 border-ink`}>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                Division
              </th>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                Source mix (share of cost)
              </th>
              <th scope="col" className={`${HEAD_CELL} text-right`}>
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody>
            {divisions.map(({ division, lines }) => (
              <tr key={division} className={PRINT_ROW}>
                <th scope="row" className={ROW_HEAD}>
                  {DIVISION_NAMES[division]}
                </th>
                <td className="px-2 py-2 align-top text-muted">{sourceMixText(sourceCents(lines))}</td>
                <td className={CELL}>{formatMoney(estimate.divisionSubtotals[division])}</td>
              </tr>
            ))}
            <tr className={`${PRINT_ROW} border-t-2 border-ink`}>
              <th scope="row" className={ROW_HEAD}>
                Subtotal
              </th>
              <td className="px-2 py-2" />
              <td className={CELL}>{formatMoney(estimate.subtotalCents)}</td>
            </tr>
            <tr className={PRINT_ROW}>
              <th scope="row" className={ROW_HEAD}>
                {`Contingency (${formatPercentCompact(estimate.contingencyPct, 2)})`}
              </th>
              <td className="px-2 py-2" />
              <td className={CELL}>{formatMoney(estimate.contingencyCents)}</td>
            </tr>
            <tr className={PRINT_ROW}>
              <th scope="row" className={`${ROW_HEAD} font-bold`}>
                Total
              </th>
              <td className="px-2 py-2" />
              <td className={`${CELL} font-bold`}>{formatMoney(estimate.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </TableBox>
      <p className="m-0 text-xs text-muted">Shares are rounded and may not add to exactly 100%.</p>
    </PrintSection>
  );
}

interface MarketSectionProps {
  price: Result<PriceEstimate>;
  scoredComps: readonly ScoredComp[];
}

/** The sale price range the comps point to, and the comps that went into it (the included ones, best match first). */
export function MarketSection({ price, scoredComps }: MarketSectionProps) {
  const included = scoredComps.filter((scored) => scored.included);
  const implied = new Map(price.status === "ok" ? price.value.comps.map((comp) => [comp.id, comp.impliedCents]) : []);
  return (
    <PrintSection title="Market estimate and comps used">
      {price.status === "ok" ? (
        <Facts>
          <Fact label="Low (downside)">{formatMoney(price.value.lowCents)}</Fact>
          <Fact label="Mid (base)">{formatMoney(price.value.midCents)}</Fact>
          <Fact label="High (upside)">{formatMoney(price.value.highCents)}</Fact>
        </Facts>
      ) : (
        <p className="m-0 text-sm">No market estimate: the scenarios use the sale price entered for this deal.</p>
      )}
      {included.length > 0 ? (
        <TableBox>
          <table className={PRINT_TABLE}>
            <thead>
              <tr className={`${PRINT_ROW} border-b-2 border-ink`}>
                <th scope="col" className={`${HEAD_CELL} text-left`}>
                  Address
                </th>
                <th scope="col" className={`${HEAD_CELL} text-left`}>
                  City
                </th>
                <th scope="col" className={`${HEAD_CELL} text-left`}>
                  Sold
                </th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>
                  Sold price
                </th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>
                  Match
                </th>
                <th scope="col" className={`${HEAD_CELL} text-right`}>
                  Worth for this house
                </th>
              </tr>
            </thead>
            <tbody>
              {included.map(({ comp, score }) => (
                <tr key={comp.id} className={PRINT_ROW}>
                  <th scope="row" className={ROW_HEAD}>
                    {comp.address}
                  </th>
                  <td className="px-2 py-2 align-top">{comp.city}</td>
                  <td className="px-2 py-2 align-top whitespace-nowrap">{monthYear(comp.soldDate)}</td>
                  <td className={CELL}>{formatMoney(comp.soldPriceCents)}</td>
                  <td className={CELL}>{`${Math.round(score)}%`}</td>
                  <td className={CELL}>{formatMoney(implied.get(comp.id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      ) : (
        <p className="m-0 text-sm">No comps are included in the estimate.</p>
      )}
    </PrintSection>
  );
}

/** The base case month by month. The table scrolls in its own box on a phone and prints at full width. */
export function CashFlowSection({ base, landClose }: { base: ScenarioResult; landClose: YearMonth }) {
  return (
    <PrintSection title="Monthly cash flow (base case)">
      <TableBox>
        <table className={`${PRINT_TABLE} min-w-[760px] print:min-w-0`}>
          <caption className="sr-only">Month by month cash flow, base case</caption>
          <thead>
            <tr className={`${PRINT_ROW} border-b-2 border-ink`}>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                Month
              </th>
              {CASH_FLOW_COLUMNS.map((name) => (
                <th key={name} scope="col" className={`${HEAD_CELL} text-right`}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {base.cashFlow.periods.map((period) => (
              <tr key={period.index} className={PRINT_ROW}>
                <th scope="row" className={`${ROW_HEAD} whitespace-nowrap`}>
                  {monthLabel(landClose, period.index) || MISSING}
                </th>
                <td className={CELL}>{formatMoney(period.spendCents)}</td>
                <td className={CELL}>{formatMoney(period.loanDrawCents)}</td>
                <td className={CELL}>{formatMoney(period.interestCents)}</td>
                <td className={CELL}>{formatMoney(carryOf(period))}</td>
                <td className={CELL}>{formatMoney(period.equityOutCents)}</td>
                <td className={CELL}>{formatMoney(period.cumulativeEquityCents)}</td>
                <td className={CELL}>{formatMoney(period.loanBalanceEndCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableBox>
      <p className="m-0 text-xs text-muted">
        Carry is property tax, insurance, utilities, staging, upkeep and HOA. Interest is the construction loan's;
        points, fees and land-loan interest are in Equity out.
      </p>
    </PrintSection>
  );
}
