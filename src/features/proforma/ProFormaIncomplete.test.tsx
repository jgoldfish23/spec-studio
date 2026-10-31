import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { installFakeClock } from "../../testing/editorTiming";
import { newDealSetup } from "../../testing/stepHarness";
import { card, openProForma } from "./proformaTestUtils";
import { VerdictPanel } from "./VerdictPanel";

installFakeClock();

const NUMBERS_WAIT = "The numbers appear once the missing details are filled in.";

describe("a new deal", () => {
  it("shows Needs info, says it needs a few more details, and lists what is missing", async () => {
    const { harness, deal } = await newDealSetup();
    await openProForma(harness, deal);

    const panel = card("Verdict");
    expect(within(panel).getByText("Needs info")).toBeVisible();
    expect(within(panel).getByText("Needs a few more details.")).toBeVisible();
    const needs = within(within(panel).getByRole("list", { name: "What is missing" })).getAllByRole("listitem");
    expect(needs.length).toBeGreaterThan(0);
    expect(within(panel).queryByRole("list", { name: "Rule checks" })).not.toBeInTheDocument();
  });

  it("links the city item to the lot step", async () => {
    const { harness, deal } = await newDealSetup();
    await openProForma(harness, deal);

    const city = within(card("Verdict")).getByRole("link", { name: /city/i });
    expect(city).toHaveAttribute("href", `#/deals/${deal.id}/lot`);
  });

  it("says the numbers wait, once, in place of the scenarios, timeline, grid and month by month table", async () => {
    const { harness, deal } = await newDealSetup();
    await openProForma(harness, deal);

    expect(screen.getAllByText(NUMBERS_WAIT)).toHaveLength(1);
    for (const name of ["Scenarios", "Timeline & loan", "Profit by sale price × days on market", "Monthly cash flow"]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("still lets the owner fill in the assumptions", async () => {
    const { harness, deal } = await newDealSetup();
    await openProForma(harness, deal);

    for (const name of ["Financing", "Selling", "Carrying", "Your rules"]) {
      expect(card(name)).toBeVisible();
    }
    expect(within(card("Financing")).getByLabelText("Loan-to-cost %")).toBeVisible();
    expect(screen.getByRole("button", { name: /Lender package \(PDF\)/ })).toBeDisabled();
  });

  it("sends a deal that has its city but no comps to the Market step", async () => {
    const { harness, deal } = await newDealSetup((inputs) => {
      inputs.lot.city = "Kaysville";
    });
    await openProForma(harness, deal);

    expect(screen.getByText(NUMBERS_WAIT)).toBeVisible();
    const comps = within(card("Verdict")).getByRole("link", { name: /sold comps/i });
    expect(comps).toHaveAttribute("href", `#/deals/${deal.id}/market`);
    expect(within(card("Verdict")).queryByRole("link", { name: /city/i })).not.toBeInTheDocument();
  });
});

describe("VerdictPanel while the deal is incomplete", () => {
  const panel = (missing: { code: string; message: string; step: "lot" | "house" | "estimate" | "market" | "proforma" | "settings" }[]) =>
    render(
      <MemoryRouter>
        <VerdictPanel dealId="deal-1" verdict={{ kind: "incomplete", checks: [], missing }} goalSeek={null} />
      </MemoryRouter>,
    );

  it("lists an item once however many steps report it", () => {
    panel([
      { code: "a", message: "Add the city", step: "lot" },
      { code: "b", message: "Add the city", step: "lot" },
      { code: "c", message: "Add sold comps", step: "market" },
    ]);

    const items = within(screen.getByRole("list", { name: "What is missing" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Add the city", "Add sold comps"]);
  });

  it("links each item to the step that fixes it, and the engine's own settings to the pro forma", () => {
    panel([
      { code: "a", message: "Add the city", step: "lot" },
      { code: "b", message: "Choose the house size", step: "house" },
      { code: "c", message: "Price the roofing", step: "estimate" },
      { code: "d", message: "Add sold comps", step: "market" },
      { code: "e", message: "Fix the cost book", step: "settings" },
    ]);

    const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href("Add the city")).toBe("/deals/deal-1/lot");
    expect(href("Choose the house size")).toBe("/deals/deal-1/house");
    expect(href("Price the roofing")).toBe("/deals/deal-1/estimate");
    expect(href("Add sold comps")).toBe("/deals/deal-1/market");
    expect(href("Fix the cost book")).toBe("/deals/deal-1/proforma");
  });

  it("makes each link at least 44 px tall to touch", () => {
    panel([{ code: "a", message: "Add the city", step: "lot" }]);
    expect(screen.getByRole("link", { name: "Add the city" })).toHaveClass("min-h-11");
  });
});
