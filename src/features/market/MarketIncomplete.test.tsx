import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DealInputs } from "@engine";
import { newDealInputs } from "../../data/newDeal";
import { advance, installFakeClock, newUser, pasteOver, typeOver } from "../../testing/editorTiming";
import { createHarness, renderApp } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";
import { card, compsTable, fillBoxes, listedAddresses, openMarket, sampleSetup } from "./marketTestUtils";

installFakeClock();

const NEEDS_PRICE = "Needs sold comps — add at least one below, or enter your own base sale price above.";
const NEEDS_DOM = "Needs sold comps — add at least one below, or enter your own base days on market above.";

/** A deal as "New deal" makes it, in a fresh local repository that holds only the starter cost book and no comps. */
async function newDealSetup(change: (inputs: DealInputs) => void = () => {}) {
  const harness = createHarness();
  const settings = await harness.repository.getCompanySettings();
  const inputs = newDealInputs("2026-10-31", settings);
  change(inputs);
  const deal = await harness.repository.createDeal({ name: "Untitled deal", inputs });
  return { harness, deal };
}

const stepLink = (name: string) => within(screen.getByRole("navigation", { name: "Deal steps" })).getByRole("link", { name });

async function goTo(harness: Harness, dealId: string, step: string, ready: () => Promise<unknown>) {
  renderApp(`#/deals/${dealId}/${step}`, harness);
  await ready();
}

describe("a new deal with no comps in its region", () => {
  it("says it needs sold comps once its city is filled in, and its pro forma verdict reads Needs info", async () => {
    const { harness, deal } = await newDealSetup();
    await goTo(harness, deal.id, "lot", () => screen.findByLabelText("City"));
    const user = newUser();

    await typeOver(user, "City", "Kaysville");
    await advance(200);
    await user.click(stepLink("Market"));
    await screen.findByRole("region", { name: "Comps" });

    expect(within(card("Sale price estimate")).getByText(NEEDS_PRICE)).toBeVisible();
    expect(within(card("Days on market")).getByText(NEEDS_DOM)).toBeVisible();
    expect(within(card("Comps")).getByText("No comps yet. Add the first one to get a market estimate.")).toBeVisible();

    await user.click(stepLink("Pro forma"));
    expect(await screen.findByRole("heading", { level: 1, name: /Pro forma/ })).toBeVisible();
    expect(screen.getByText("Needs info")).toBeVisible();
  });

  it("shows no low, mid or high and no days range while it waits", async () => {
    const { harness, deal } = await newDealSetup((inputs) => {
      inputs.lot.city = "Kaysville";
    });
    await goTo(harness, deal.id, "market", () => screen.findByRole("region", { name: "Comps" }));

    const price = card("Sale price estimate");
    expect(within(price).queryByText("Low · downside")).not.toBeInTheDocument();
    expect(within(price).queryByText(/per effective sf/)).not.toBeInTheDocument();
    const days = card("Days on market");
    expect(within(days).queryByText(/Typical:/)).not.toBeInTheDocument();
    expect(within(days).queryByText("What drove it")).not.toBeInTheDocument();
  });

  it("turns the needs message into numbers once its first comp is added", async () => {
    const { harness, deal } = await newDealSetup((inputs) => {
      inputs.lot.city = "Kaysville";
    });
    await goTo(harness, deal.id, "market", () => screen.findByRole("region", { name: "Comps" }));
    const user = newUser();

    await user.click(within(card("Comps")).getByRole("button", { name: "Add comp" }));
    const form = screen.getByRole("form", { name: "Add comp" });
    await fillBoxes(user, form, {
      Address: "1 First Street, Kaysville, UT",
      City: "Kaysville",
      "List date": "2026-06-01",
      "Sold date": "2026-08-20",
      "Sold price": "900,000",
      "Above-grade finished sf": "2,000",
      "Year built": "2026",
      "Garage bays": "3",
    });
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(listedAddresses()).toEqual(["1 First Street, Kaysville, UT"]));
    const price = card("Sale price estimate");
    expect(await within(price).findByText("Based on 1 comp")).toBeVisible();
    expect(within(price).queryByText(NEEDS_PRICE)).not.toBeInTheDocument();
    expect(within(price).getByText("Mid · base").closest("dl")).toHaveTextContent("$");
    const days = card("Days on market");
    expect(within(days).queryByText(NEEDS_DOM)).not.toBeInTheDocument();
    expect(within(days).getByText("Low")).toBeVisible();
    expect(within(days).getByText(/^1 comp · \d sold in the last 6 months · listing in /)).toBeVisible();
  });

  it("gives a verdict once the owner's own base price and days on market stand in for the comps", async () => {
    const { harness, deal } = await newDealSetup((inputs) => {
      inputs.lot.city = "Kaysville";
    });
    await goTo(harness, deal.id, "market", () => screen.findByRole("region", { name: "Comps" }));
    const user = newUser();
    expect(screen.getByText("Needs info")).toBeVisible();

    await pasteOver(user, "Base sale price", "900,000", card("Your numbers (optional)"));
    await pasteOver(user, "Base days on market", "60", card("Your numbers (optional)"));
    await advance(200);

    expect(screen.queryByText("Needs info")).not.toBeInTheDocument();
    // The estimates themselves still wait for comps.
    expect(within(card("Sale price estimate")).getByText(NEEDS_PRICE)).toBeVisible();
  });
});

describe("a deal that cannot be evaluated yet", () => {
  it("shows the engine's own reason instead of saying comps are missing, and still lists the library's comps", async () => {
    const { harness, deal } = await sampleSetup();
    await harness.repository.saveDeal({
      ...deal,
      inputs: { ...deal.inputs, lot: { ...deal.inputs.lot, city: "" } },
    });
    await openMarket(harness, deal);

    expect(within(card("Sale price estimate")).getByText("lot.city: Required")).toBeVisible();
    expect(within(card("Days on market")).getByText("lot.city: Required")).toBeVisible();
    expect(screen.queryByText(NEEDS_PRICE)).not.toBeInTheDocument();
    // Without a score there is nothing to rank or to include, but the comps are still there to edit and delete.
    expect(listedAddresses()).toHaveLength(8);
    const row = within(compsTable()).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByRole("button", { name: "Edit" })).toBeVisible();
    expect(within(row).queryByRole("button", { name: "Included" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Excluded" })).not.toBeInTheDocument();
  });

  it("asks for sold comps with dates when the price is fine but no comp has the dates days on market needs", async () => {
    const { harness, deal } = await sampleSetup();
    for (const comp of await harness.repository.listComps("utah-north")) {
      const undated = { ...comp };
      delete undated.listDate;
      await harness.repository.saveComp(undated);
    }
    await openMarket(harness, deal);

    expect(within(card("Sale price estimate")).getByText("Mid · base")).toBeVisible();
    expect(within(card("Days on market")).getByText(NEEDS_DOM)).toBeVisible();
  });
});
