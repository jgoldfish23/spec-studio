import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DealInputs, ScenarioName } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import { formatMoney, formatPercent } from "../../lib/format";
import { advance, installFakeClock, newUser, pasteOver } from "../../testing/editorTiming";
import { sampleSetup, setupWith } from "../../testing/stepHarness";
import {
  card,
  openProForma,
  pickScenario,
  scenariosOf,
  tile,
  waterfallLabels,
  waterfallValue,
} from "./proformaTestUtils";
import { ScenariosCard } from "./ScenariosCard";

installFakeClock();

const NAMES: Record<ScenarioName, "Downside" | "Base" | "Upside"> = { downside: "Downside", base: "Base", upside: "Upside" };
const tileValue = (label: string) => tile(label).querySelector("dd")?.textContent;

describe("the scenario selector", () => {
  it("offers Downside, Base and Upside, with Base chosen to start", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const group = screen.getByRole("group", { name: "Scenario" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Downside", "Base", "Upside"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("changes the Sale price row to the downside scenario's price", async () => {
    const { harness, deal } = await sampleSetup();
    const scenarios = await scenariosOf();
    await openProForma(harness, deal);
    const user = newUser();

    expect(waterfallValue("Sale price")).toBe(formatMoney(scenarios.base.metrics.salePriceCents));
    await pickScenario(user, "Downside");

    expect(waterfallValue("Sale price")).toBe(formatMoney(scenarios.downside.metrics.salePriceCents));
    expect(waterfallValue("Sale price")).not.toBe(formatMoney(scenarios.base.metrics.salePriceCents));
    expect(screen.getByRole("button", { name: "Downside" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Base" })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the assumptions line, the waterfall, the tiles, the timeline and the month by month table together", async () => {
    const { harness, deal } = await sampleSetup();
    const scenarios = await scenariosOf();
    await openProForma(harness, deal);
    const user = newUser();

    for (const name of ["downside", "upside", "base"] as const) {
      const { inputs, metrics, cashFlow } = scenarios[name];
      await pickScenario(user, NAMES[name]);

      expect(within(card("Scenarios")).getByText(new RegExp(`^Sale price ${formatMoney(inputs.priceCents).replace("$", "\\$")} · `))).toBeVisible();
      expect(waterfallValue("Profit")).toBe(formatMoney(metrics.profitCents));
      expect(tileValue("Break-even sale price")).toBe(formatMoney(metrics.breakEvenSalePriceCents));
      const title = `${NAMES[name]} case · ${metrics.monthsLandToClose.toFixed(1)} months`;
      expect(within(card("Timeline & loan")).getByText(title)).toBeVisible();
      expect(within(card("Monthly cash flow")).getAllByRole("row")).toHaveLength(cashFlow.periods.length + 1);
    }
  });
});

describe("the assumptions line", () => {
  it("names the sale price and days on market, and leaves out the overrun when there is none", async () => {
    const { harness, deal } = await sampleSetup();
    const { base } = await scenariosOf();
    await openProForma(harness, deal);

    expect(
      within(card("Scenarios")).getByText(`Sale price ${formatMoney(base.inputs.priceCents)} · ${base.inputs.domDays} days on market`),
    ).toBeVisible();
  });

  it("adds the cost overrun when a scenario has one", async () => {
    const { harness, deal } = await sampleSetup();
    const { downside } = await scenariosOf();
    expect(downside.inputs.overrunPct).toBe(0.05);
    await openProForma(harness, deal);
    await pickScenario(newUser(), "Downside");

    expect(
      within(card("Scenarios")).getByText(
        `Sale price ${formatMoney(downside.inputs.priceCents)} · ${downside.inputs.domDays} days on market · build costs +5.0%`,
      ),
    ).toBeVisible();
  });
});

describe("the waterfall", () => {
  it("lists the eight rows in order", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    expect(waterfallLabels()).toEqual([
      "Sale price",
      "Selling costs",
      "Net proceeds",
      "Land & closing",
      "Build",
      "Financing",
      "Carrying",
      "Profit",
    ]);
  });

  it("shows the engine's figures for every scenario, with costs as negatives", async () => {
    const { harness, deal } = await sampleSetup();
    const scenarios = await scenariosOf();
    const land = deal.inputs.lot.priceCents + deal.inputs.lot.closingCents;
    await openProForma(harness, deal);
    const user = newUser();

    for (const name of ["downside", "base", "upside"] as const) {
      const { metrics, cashFlow } = scenarios[name];
      await pickScenario(user, NAMES[name]);
      expect(waterfallValue("Sale price")).toBe(formatMoney(metrics.salePriceCents));
      expect(waterfallValue("Selling costs")).toBe(formatMoney(-metrics.sellingCostsCents));
      expect(waterfallValue("Net proceeds")).toBe(formatMoney(cashFlow.sale.netCents));
      expect(waterfallValue("Land & closing")).toBe(formatMoney(-land));
      expect(waterfallValue("Build")).toBe(formatMoney(-metrics.buildSpentCents));
      expect(waterfallValue("Financing")).toBe(formatMoney(-metrics.financingCents));
      expect(waterfallValue("Carrying")).toBe(formatMoney(-metrics.carryCents));
      expect(waterfallValue("Profit")).toBe(formatMoney(metrics.profitCents));
      for (const cost of ["Selling costs", "Land & closing", "Build", "Financing", "Carrying"]) {
        expect(waterfallValue(cost)).toMatch(/^−\$/);
      }
      // The rows add up: what is left of the net proceeds after the four costs is the profit.
      expect(cashFlow.sale.netCents - land - metrics.buildSpentCents - metrics.financingCents - metrics.carryCents).toBe(
        metrics.profitCents,
      );
    }
  });

  it("draws each bar as its share of the sale price, hidden from assistive tech", async () => {
    const { harness, deal } = await sampleSetup();
    const { base } = await scenariosOf();
    await openProForma(harness, deal);

    const table = screen.getByRole("table", { name: "Profit waterfall" });
    const fills = within(table).getAllByTestId("waterfall-bar");
    expect(fills).toHaveLength(8);
    for (const fill of fills) expect(fill.parentElement).toHaveAttribute("aria-hidden", "true");
    const price = base.metrics.salePriceCents;
    const share = (cents: number) => (Math.abs(cents) / price) * 100;
    const widths = fills.map((fill) => Number.parseFloat(fill.style.width));
    expect(widths[0]).toBeCloseTo(100, 6);
    expect(widths[1]).toBeCloseTo(share(base.metrics.sellingCostsCents), 4);
    expect(widths[2]).toBeCloseTo(share(base.cashFlow.sale.netCents), 4);
    expect(widths[4]).toBeCloseTo(share(base.metrics.buildSpentCents), 4);
    expect(widths[7]).toBeCloseTo(share(base.metrics.profitCents), 4);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });

  it("shows a profit in green and a loss in red", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const row = () => screen.getByRole("rowheader", { name: /^Profit/ }).closest("tr") as HTMLElement;
    expect(within(row()).getByRole("cell")).toHaveClass("text-go");
    expect(within(row()).getByRole("cell")).not.toHaveClass("text-no-go");
    expect(within(row()).getByRole("cell").textContent).not.toMatch(/^−/);
  });

  it("shows a loss in red with the minus sign", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides.basePriceCents = 115_000_000;
    });
    await openProForma(harness, deal);

    const cell = within(screen.getByRole("rowheader", { name: /^Profit/ }).closest("tr") as HTMLElement).getByRole("cell");
    expect(cell).toHaveClass("text-no-go");
    expect(cell.textContent).toMatch(/^−\$/);
  });
});

describe("the metric tiles", () => {
  it("shows the engine's eight figures for the scenario picked", async () => {
    const { harness, deal } = await sampleSetup();
    const scenarios = await scenariosOf();
    await openProForma(harness, deal);
    const user = newUser();

    for (const name of ["base", "downside", "upside"] as const) {
      const { metrics } = scenarios[name];
      await pickScenario(user, NAMES[name]);
      expect(tileValue("Margin on sale")).toBe(formatPercent(metrics.marginOnSale));
      expect(tileValue("Margin on cost")).toBe(formatPercent(metrics.marginOnCost));
      expect(tileValue("Peak cash you put in")).toBe(formatMoney(metrics.peakCashCents));
      expect(tileValue("Return on your cash")).toBe(formatPercent(metrics.returnOnCash));
      expect(tileValue("Annualized (IRR)")).toBe(formatPercent(metrics.annualizedReturn));
      expect(tileValue("Break-even sale price")).toBe(formatMoney(metrics.breakEvenSalePriceCents));
      expect(tileValue("Each month it sits")).toBe(formatMoney(metrics.monthlyBurnWhileListedCents));
      expect(tileValue("Land close → sale close")).toBe(`${metrics.monthsLandToClose.toFixed(1)} mo`);
    }
  });

  it("writes months with one decimal", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    expect(tileValue("Land close → sale close")).toMatch(/^\d+\.\d mo$/);
  });

  it("writes a dash, not NaN or Infinity, for a figure the engine cannot give", async () => {
    const { base } = await scenariosOf();
    const inputs: DealInputs = sampleDealInputs();
    render(
      <ScenariosCard
        scenario="base"
        onScenario={() => {}}
        inputs={inputs}
        result={{
          ...base,
          metrics: { ...base.metrics, annualizedReturn: null, breakEvenSalePriceCents: Number.POSITIVE_INFINITY },
        }}
      />,
    );

    expect(tileValue("Annualized (IRR)")).toBe("—");
    expect(tileValue("Break-even sale price")).toBe("—");
    expect(screen.getByRole("region", { name: "Scenarios" }).textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("editing the loan rate", () => {
  it("lowers the Profit row when the Rate goes up to 12%", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const before = waterfallValue("Profit");

    await pasteOver(newUser(), "Rate %", "12");
    await advance(200);

    const edited = structuredClone(deal.inputs);
    edited.loan.rate = 0.12;
    const expected = (await scenariosOf(edited)).base.metrics.profitCents;
    const original = (await scenariosOf()).base.metrics.profitCents;
    expect(expected).toBeLessThan(original);
    expect(before).toBe(formatMoney(original));
    expect(waterfallValue("Profit")).toBe(formatMoney(expected));
    expect(waterfallValue("Profit")).not.toBe(before);
  });
});
