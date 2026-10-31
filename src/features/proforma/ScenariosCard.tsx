import type { DealInputs, ScenarioName, ScenarioResult } from "@engine";
import { formatDays, formatMoney, formatPercent, formatPercentCompact } from "../../lib/format";
import { Card } from "../../ui/Card";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { StatTile } from "../../ui/StatTile";
import { SCENARIOS } from "./scenarioLabels";

type Tone = "plain" | "subtotal" | "profit";

interface WaterfallLine {
  label: string;
  /** A line under the label: what the figure is made of. */
  note?: string;
  /** Signed: a cost is negative. */
  cents: number;
  tone?: Tone;
  /** What colors the bar and the figure. */
  bar: "price" | "cost" | "result";
}

/** The bar's width: this line's share of the sale price, kept between 0 and 100 percent. */
function shareOfPrice(cents: number, salePriceCents: number): number {
  if (!(salePriceCents > 0) || !Number.isFinite(cents)) return 0;
  return Math.min(100, Math.max(0, (Math.abs(cents) / salePriceCents) * 100));
}

function extensionsText(count: number): string {
  if (count === 0) return "no extension";
  return count === 1 ? "1 extension" : `${count} extensions`;
}

function WaterfallRow({ line, salePriceCents }: { line: WaterfallLine; salePriceCents: number }) {
  const { label, note, cents, tone = "plain", bar } = line;
  const result = bar === "result";
  const barColor = result ? (cents >= 0 ? "bg-go" : "bg-no-go") : bar === "price" ? "bg-spruce" : "bg-clay";
  const figureColor = result ? (cents >= 0 ? "text-go" : "text-no-go") : "";
  return (
    <tr className={`border-b border-[#EEF0EC] last:border-b-0 ${tone === "subtotal" ? "bg-[#F7F8F6]" : ""}`}>
      <th scope="row" className={`px-2.5 py-2.5 text-left align-top font-normal ${tone === "profit" ? "py-3.5" : ""}`}>
        <span className={`block ${tone === "profit" ? "text-xl font-bold" : "text-[15px]"} ${tone === "plain" ? "" : "font-semibold"}`}>
          {label}
        </span>
        {note ? <span className="mt-0.5 block text-xs text-[#5B625E]">{note}</span> : null}
        <span aria-hidden="true" className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#EEF0EC]">
          <span
            data-testid="waterfall-bar"
            className={`block h-full rounded-full ${barColor}`}
            style={{ width: `${shareOfPrice(cents, salePriceCents)}%` }}
          />
        </span>
      </th>
      <td
        className={`whitespace-nowrap px-2.5 py-2.5 text-right align-top ${figureColor} ${
          tone === "profit" ? "py-3.5 text-xl font-bold" : tone === "subtotal" ? "text-[15px] font-bold" : "text-[15px]"
        }`}
      >
        {formatMoney(cents)}
      </td>
    </tr>
  );
}

/** The waterfall's lines for one scenario. Every figure is the engine's; only the land, which is an input, is added up here. */
function linesFor(result: ScenarioResult, inputs: DealInputs): WaterfallLine[] {
  const { metrics, cashFlow, inputs: scenario } = result;
  const { selling, loan, lot } = inputs;
  const commissions = formatPercentCompact(selling.listingPct + selling.buyerPct, 2);
  const buydown = selling.concessionsCents > 0 ? ` · rate buydown ${formatMoney(selling.concessionsCents)}` : "";
  return [
    { label: "Sale price", cents: metrics.salePriceCents, tone: "plain", bar: "price" },
    {
      label: "Selling costs",
      note: `Commissions ${commissions} · closing ${formatPercentCompact(selling.closingPct, 2)}${buydown}`,
      cents: -metrics.sellingCostsCents,
      bar: "cost",
    },
    { label: "Net proceeds", cents: cashFlow.sale.netCents, tone: "subtotal", bar: "price" },
    { label: "Land & closing", cents: -(lot.priceCents + lot.closingCents), bar: "cost" },
    {
      label: "Build",
      note:
        scenario.overrunPct === 0
          ? `Estimate incl. ${formatPercentCompact(inputs.contingencyPct, 2)} contingency`
          : `Estimate +${formatPercentCompact(scenario.overrunPct, 2)} overrun`,
      cents: -metrics.buildSpentCents,
      bar: "cost",
    },
    {
      label: "Financing",
      note: `${formatPercentCompact(loan.points, 2)} points · ${formatPercent(loan.rate, 2)} on drawn balance · ${extensionsText(cashFlow.extensions)}`,
      cents: -metrics.financingCents,
      bar: "cost",
    },
    {
      label: "Carrying",
      note: "Tax, insurance, utilities, staging, upkeep",
      cents: -metrics.carryCents,
      bar: "cost",
    },
    { label: "Profit", cents: metrics.profitCents, tone: "profit", bar: "result" },
  ];
}

interface ScenariosCardProps {
  scenario: ScenarioName;
  onScenario: (scenario: ScenarioName) => void;
  result: ScenarioResult;
  /** The inputs the result was worked out from. */
  inputs: DealInputs;
}

/**
 * The scenario the owner picked, laid out: what it assumes, a waterfall from the sale price down to the profit, and the
 * deal's headline figures. The selector is here, and drives the timeline and the month by month table below as well.
 */
export function ScenariosCard({ scenario, onScenario, result, inputs }: ScenariosCardProps) {
  const { metrics } = result;
  const overrun = result.inputs.overrunPct;
  const assumptions =
    `Sale price ${formatMoney(result.inputs.priceCents)} · ${formatDays(result.inputs.domDays)} on market` +
    (overrun === 0 ? "" : ` · build costs ${formatPercent(overrun, 1, { signed: true })}`);
  return (
    <Card
      title="Scenarios"
      actions={<SegmentedControl label="Scenario" options={[...SCENARIOS]} value={scenario} onChange={onScenario} />}
    >
      <p aria-live="polite" className="m-0 text-sm text-muted">
        {assumptions}
      </p>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
        <table aria-label="Profit waterfall" className="min-w-0 flex-[999_1_460px] border-collapse">
          <tbody>
            {linesFor(result, inputs).map((line) => (
              <WaterfallRow key={line.label} line={line} salePriceCents={metrics.salePriceCents} />
            ))}
          </tbody>
        </table>
        <div className="grid min-w-0 flex-[1_1_360px] grid-cols-2 gap-2.5">
          <StatTile label="Margin on sale" value={formatPercent(metrics.marginOnSale)} />
          <StatTile label="Margin on cost" value={formatPercent(metrics.marginOnCost)} />
          <StatTile label="Peak cash you put in" value={formatMoney(metrics.peakCashCents)} />
          <StatTile label="Return on your cash" value={formatPercent(metrics.returnOnCash)} />
          <StatTile label="Annualized (IRR)" value={formatPercent(metrics.annualizedReturn)} />
          <StatTile label="Break-even sale price" value={formatMoney(metrics.breakEvenSalePriceCents)} />
          <StatTile label="Each month it sits" value={formatMoney(metrics.monthlyBurnWhileListedCents)} />
          <StatTile
            label="Land close → sale close"
            value={Number.isFinite(metrics.monthsLandToClose) ? `${metrics.monthsLandToClose.toFixed(1)} mo` : "—"}
          />
        </div>
      </div>
    </Card>
  );
}
