import type { ReactNode } from "react";
import type { DealInputs, ScenarioName, ScenarioResult, Verdict } from "@engine";
import { formatDays, formatMoney, formatNumberInput, formatPercent } from "../../lib/format";
import { VerdictChip } from "../../ui/VerdictChip";
import { houseLine } from "../deals/houseLine";
import { SCENARIOS } from "../proforma/scenarioLabels";
import { timelineSegments } from "../proforma/timeline";
import { checkLine, loanWarningText, verdictHeadline } from "../proforma/verdictText";
import { CELL, Fact, Facts, HEAD_CELL, PRINT_ROW, PRINT_TABLE, PrintSection, ROW_HEAD, TableBox } from "./PrintSection";

/** The one region the app knows, as the Lot step names it. */
const REGION_NAMES: Readonly<Record<string, string>> = {
  "utah-north": "Northern Utah (Davis & Weber)",
};

export function SummarySection({ inputs }: { inputs: DealInputs }) {
  const { lot } = inputs;
  return (
    <PrintSection title="Deal summary">
      <Facts>
        <Fact label="Lot">{`${lot.city}, ${lot.county} · ${formatNumberInput(lot.acres)} acres`}</Fact>
        <Fact label="Lot price">{`${formatMoney(lot.priceCents)} + ${formatMoney(lot.closingCents)} closing`}</Fact>
        <Fact label="House">{houseLine(inputs.house)}</Fact>
        <Fact label="Region">{REGION_NAMES[lot.region] ?? lot.region}</Fact>
      </Facts>
    </PrintSection>
  );
}

function Mark({ pass }: { pass: boolean }) {
  return (
    <span
      className={`print-exact mt-px flex size-[22px] flex-none items-center justify-center rounded-full ${
        pass ? "bg-go-bg text-go" : "bg-no-go-bg text-no-go"
      }`}
    >
      <svg
        role="img"
        aria-label={pass ? "Passes" : "Fails"}
        width="12"
        height="12"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {pass ? <path d="M3 7.5 6 10l5-6" /> : <path d="m4 4 6 6M10 4l-6 6" />}
      </svg>
    </span>
  );
}

export function VerdictSection({ verdict }: { verdict: Verdict }) {
  return (
    <PrintSection title="Verdict and rules">
      <div className="print-exact flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <VerdictChip kind={verdict.kind} size="lg" />
        <p className="m-0 text-[15px]">{verdictHeadline(verdict.kind)}</p>
      </div>
      <ul aria-label="Rule checks" className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
        {verdict.checks.map((check) => (
          <li key={check.rule} className="print-row flex items-start gap-2.5">
            <Mark pass={check.pass} />
            <span>{checkLine(check)}</span>
          </li>
        ))}
      </ul>
      {verdict.loanWarning ? <p className="m-0 text-sm">{loanWarningText(verdict.loanWarning)}</p> : null}
    </PrintSection>
  );
}

interface ScenarioRow {
  label: string;
  value: (result: ScenarioResult) => string;
}

const SCENARIO_ROWS: readonly ScenarioRow[] = [
  {
    label: "Sale price",
    value: ({ metrics }) => formatMoney(metrics.salePriceCents),
  },
  {
    label: "Total project cost",
    value: ({ metrics }) => formatMoney(metrics.totalProjectCostCents),
  },
  { label: "Profit", value: ({ metrics }) => formatMoney(metrics.profitCents) },
  {
    label: "Margin on sale",
    value: ({ metrics }) => formatPercent(metrics.marginOnSale),
  },
  {
    label: "Annualized return",
    value: ({ metrics }) => formatPercent(metrics.annualizedReturn),
  },
  {
    label: "Days on market",
    value: ({ inputs }) => formatDays(inputs.domDays),
  },
  {
    label: "Months",
    value: ({ metrics }) => (Number.isFinite(metrics.monthsLandToClose) ? metrics.monthsLandToClose.toFixed(1) : "—"),
  },
];

export function ScenariosSection({ scenarios }: { scenarios: Record<ScenarioName, ScenarioResult> }) {
  return (
    <PrintSection title="Scenarios">
      <TableBox>
        <table className={PRINT_TABLE}>
          <thead>
            <tr className={`${PRINT_ROW} border-b-2 border-ink`}>
              <th scope="col" className={`${HEAD_CELL} text-left`}>
                <span className="sr-only">Measure</span>
              </th>
              {SCENARIOS.map(({ value, label }) => (
                <th key={value} scope="col" className={`${HEAD_CELL} text-right`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCENARIO_ROWS.map(({ label, value }) => (
              <tr key={label} className={PRINT_ROW}>
                <th scope="row" className={ROW_HEAD}>
                  {label}
                </th>
                {SCENARIOS.map(({ value: name }) => (
                  <td key={name} className={CELL}>
                    {value(scenarios[name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableBox>
    </PrintSection>
  );
}

export function TimelineSection({
  base,
  landClose,
}: {
  base: ScenarioResult;
  landClose: DealInputs["timeline"]["landClose"];
}) {
  const { segments, dates } = timelineSegments(base.cashFlow.times, landClose, {
    domDays: base.inputs.domDays,
    hasLoan: base.cashFlow.commitmentCents > 0,
  });
  return (
    <PrintSection title="Timeline">
      <Facts>
        <Fact label="Land close">{dates.landClose}</Fact>
        <Fact label="List date">{dates.list}</Fact>
        <Fact label="Sale close">{dates.saleClose}</Fact>
      </Facts>
      <p className="m-0 text-sm text-muted">{segments.map((segment) => segment.label).join(" · ")}</p>
    </PrintSection>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="print-block flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-bold">{title}</h3>
      <Facts>{children}</Facts>
    </div>
  );
}

const rate = (decimal: number): string => formatPercent(decimal, 2);

export function AssumptionsSection({ inputs }: { inputs: DealInputs }) {
  const { loan, selling, carry, lot } = inputs;
  const landFinancing =
    lot.financing.kind === "cash"
      ? "Paid in cash"
      : `Loan at ${formatPercent(lot.financing.ltv)} of price, ${rate(lot.financing.rate)} rate, ${rate(lot.financing.points)} points`;
  return (
    <PrintSection title="Assumptions">
      <div className="flex flex-col gap-4">
        <Group title="Financing">
          <Fact label="Land">{landFinancing}</Fact>
          <Fact label="Loan-to-cost">{formatPercent(loan.ltc)}</Fact>
          <Fact label="Rate">{rate(loan.rate)}</Fact>
          <Fact label="Points">{rate(loan.points)}</Fact>
          <Fact label="Draw fee">{formatMoney(loan.drawFeeCents)}</Fact>
          <Fact label="Term">{`${loan.termMonths} months`}</Fact>
          <Fact label="Extension fee">{rate(loan.extensionPct)}</Fact>
          <Fact label="Extension length">{`${loan.extensionMonths} months`}</Fact>
          <Fact label="Interest">{loan.interestMode === "paid" ? "Paid monthly" : "Rolled into the loan"}</Fact>
        </Group>
        <Group title="Selling">
          <Fact label="Listing agent">{rate(selling.listingPct)}</Fact>
          <Fact label="Buyer's agent">{rate(selling.buyerPct)}</Fact>
          <Fact label="Closing & title">{rate(selling.closingPct)}</Fact>
          <Fact label="Rate buydown / concessions">{formatMoney(selling.concessionsCents)}</Fact>
        </Group>
        <Group title="Carrying">
          <Fact label="Builder's risk">{`${rate(carry.insuranceRate)} a year`}</Fact>
          <Fact label="Utilities during build">{`${formatMoney(carry.utilitiesBuildMonthlyCents)}/mo`}</Fact>
          <Fact label="Utilities after completion">{`${formatMoney(carry.utilitiesAfterMonthlyCents)}/mo`}</Fact>
          <Fact label="Staging">{`${formatMoney(carry.stagingMonthlyCents)}/mo`}</Fact>
          <Fact label="Upkeep">{`${formatMoney(carry.upkeepMonthlyCents)}/mo`}</Fact>
          <Fact label="HOA">{`${formatMoney(lot.hoaMonthlyCents)}/mo`}</Fact>
          <Fact label="Property tax rate">{rate(lot.propertyTaxRate)}</Fact>
        </Group>
      </div>
    </PrintSection>
  );
}
