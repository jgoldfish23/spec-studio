import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installFakeClock } from "../../testing/editorTiming";
import { sampleSetup } from "../../testing/stepHarness";
import { card, openProForma } from "./proformaTestUtils";

installFakeClock();

describe("Pro forma page layout", () => {
  it("draws the cards in the mockup's order, under a heading for the step", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    expect(screen.getByRole("heading", { level: 1, name: "Pro forma" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "What would make it a Go",
      "Scenarios",
      "Timeline & loan",
      "Profit by sale price × days on market",
      "Assumptions",
      "Monthly cash flow",
    ]);
    // The four assumption cards sit under the "Assumptions" heading, one level down.
    const under = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(under).toEqual(["Financing", "Selling", "Carrying", "Your rules"]);
    expect(card("Financing")).toBeVisible();
  });

  it("is the page the Pro forma tab opens, not a placeholder", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    expect(screen.queryByText("This step is being built.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pro forma" })).toHaveAttribute("href", `#/deals/${deal.id}/proforma`);
  });

  it("has a Lender package button that is disabled, with a Later tag", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const button = screen.getByRole("button", { name: /Lender package \(PDF\)/ });
    expect(button).toBeDisabled();
    expect(within(button).getByText("Later")).toBeVisible();
  });

  it("scrolls the grid and the month by month table inside boxes of their own, so a narrow page never scrolls sideways", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const grid = within(card("Profit by sale price × days on market")).getByRole("table");
    expect(grid.parentElement).toHaveClass("overflow-x-auto");
    const months = within(card("Monthly cash flow")).getByRole("table");
    expect(months.parentElement).toHaveClass("overflow-x-auto");
  });
});
