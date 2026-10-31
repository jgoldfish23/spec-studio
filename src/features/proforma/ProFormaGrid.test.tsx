import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GridCell } from "@engine";
import { formatMoney } from "../../lib/format";
import { installFakeClock, newUser } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import { sampleSetup, setupWith } from "../../testing/stepHarness";
import { BAND_STYLES } from "./gridPalette";
import { ProfitGridCard } from "./ProfitGridCard";
import { card, openProForma, pickScenario } from "./proformaTestUtils";

installFakeClock();

const GRID_NAME = "Profit by sale price and days on market";
const gridTable = () => within(card("Profit by sale price × days on market")).getByRole("table", { name: GRID_NAME });

async function sampleGrid(): Promise<{ grid: GridCell[][]; breakEven: number | null; basePrice: number }> {
  const evaluation = await evaluated();
  if (evaluation.grid === null || evaluation.scenarios.status !== "ok") throw new Error("no grid");
  return {
    grid: evaluation.grid,
    breakEven: evaluation.breakEvenDomDays,
    basePrice: evaluation.scenarios.value.base.metrics.salePriceCents,
  };
}

describe("the profit grid", () => {
  it("has twenty-five cells, exactly one of them marked as the base case", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const cells = within(gridTable()).getAllByRole("cell");
    expect(cells).toHaveLength(25);
    const current = cells.filter((cell) => cell.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(gridTable().querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  });

  it("shows the engine's profit in every cell and outlines the engine's base cell", async () => {
    const { harness, deal } = await sampleSetup();
    const { grid } = await sampleGrid();
    await openProForma(harness, deal);

    const rows = within(gridTable()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    grid.forEach((gridRow, rowIndex) => {
      const cells = within(rows[rowIndex] as HTMLElement).getAllByRole("cell");
      gridRow.forEach((cell, columnIndex) => {
        const shown = cells[columnIndex] as HTMLElement;
        expect(shown).toHaveTextContent(formatMoney(cell.profitCents));
        if (cell.isBase) {
          expect(shown).toHaveAttribute("aria-current", "true");
          expect(shown).toHaveClass("outline-3");
        } else {
          expect(shown).not.toHaveAttribute("aria-current");
          expect(shown).not.toHaveClass("outline-3");
        }
      });
    });
  });

  it("colors each cell by its band, in the palette", async () => {
    const { harness, deal } = await sampleSetup();
    const { grid } = await sampleGrid();
    await openProForma(harness, deal);

    const cells = within(gridTable()).getAllByRole("cell");
    grid.flat().forEach((cell, index) => {
      const { background, color } = BAND_STYLES[cell.band];
      expect(cells[index]).toHaveStyle({ backgroundColor: background, color });
    });
  });

  it("puts days on market across the top and sale prices down the side, as the engine lays the grid out", async () => {
    const { harness, deal } = await sampleSetup();
    const { grid, basePrice } = await sampleGrid();
    await openProForma(harness, deal);

    const columns = within(gridTable()).getAllByRole("columnheader").map((header) => header.textContent);
    expect(columns.slice(1)).toEqual(["30 days", "60 days", "90 days", "120 days", "180 days"]);
    const rowHeaders = within(gridTable()).getAllByRole("rowheader").map((header) => header.textContent);
    expect(rowHeaders).toHaveLength(5);
    expect(rowHeaders[1]).toBe(`Base · ${formatMoney(basePrice)}`);
    expect(rowHeaders[0]).toBe(`+5% · ${formatMoney(Math.round(basePrice * 1.05))}`);
    expect(rowHeaders[2]).toBe(`−5% · ${formatMoney(Math.round(basePrice * 0.95))}`);
    expect(rowHeaders[4]).toBe(`−15% · ${formatMoney(Math.round(basePrice * 0.85))}`);
    expect(grid.map((row) => row[0]?.priceDelta)).toEqual([0.05, 0, -0.05, -0.1, -0.15]);
  });

  it("shows a legend of the bands and the base case below the grid", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const legend = within(card("Profit by sale price × days on market")).getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Loss",
      "$0–50K",
      "$50–100K",
      "$100–150K",
      "$150–200K",
      "$200K+",
      "Base case",
    ]);
    expect(gridTable().compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the card a normal surface, not the muted green-grey of the mockup's nudge", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const section = card("Profit by sale price × days on market");
    expect(section).toHaveClass("bg-surface");
    expect(section.getAttribute("style") ?? "").not.toMatch(/4f5a55/i);
  });

  it("says how long the house could sit at full price before profit hits $0", async () => {
    const { harness, deal } = await sampleSetup();
    const { breakEven } = await sampleGrid();
    expect(breakEven).not.toBeNull();
    await openProForma(harness, deal);

    expect(
      within(card("Profit by sale price × days on market")).getByText(
        `At full price it could sit about ${breakEven} days before profit hits $0`,
      ),
    ).toBeVisible();
  });

  it("says it loses money even if it sells right away, for a deal that loses money at its base price", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides.basePriceCents = 115_000_000;
    });
    expect((await evaluated(deal.inputs)).breakEvenDomDays).toBe(0);
    await openProForma(harness, deal);

    const grid = within(card("Profit by sale price × days on market"));
    expect(grid.getByText("At full price it loses money even if it sells right away")).toBeVisible();
    expect(grid.queryByText(/could sit/)).not.toBeInTheDocument();
  });

  it("is the same grid whichever scenario is picked, since it is built on the base case", async () => {
    const { harness, deal } = await sampleSetup();
    const { grid } = await sampleGrid();
    await openProForma(harness, deal);
    await pickScenario(newUser(), "Upside");

    const cells = within(gridTable()).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(formatMoney(grid[0]?.[0]?.profitCents));
  });
});

describe("ProfitGridCard", () => {
  it("says more than 3 years when profit outlasts the longest stay the engine tries", async () => {
    const { grid, basePrice } = await sampleGrid();
    render(<ProfitGridCard grid={grid} basePriceCents={basePrice} breakEvenDomDays={null} />);

    expect(screen.getByText("At full price it could sit more than 3 years before profit hits $0")).toBeVisible();
  });

  it("says the deal loses money even if it sells right away when it already does at full price", async () => {
    const { grid, basePrice } = await sampleGrid();
    render(<ProfitGridCard grid={grid} basePriceCents={basePrice} breakEvenDomDays={0} />);

    expect(screen.getByText("At full price it loses money even if it sells right away")).toBeVisible();
    expect(screen.queryByText(/could sit/)).not.toBeInTheDocument();
  });

  it("says one day, not 1 days", async () => {
    const { grid, basePrice } = await sampleGrid();
    render(<ProfitGridCard grid={grid} basePriceCents={basePrice} breakEvenDomDays={1} />);

    expect(screen.getByText("At full price it could sit about 1 day before profit hits $0")).toBeVisible();
  });
});
