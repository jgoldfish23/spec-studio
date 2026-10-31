import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  advance,
  harnessOver,
  newUser,
  openEstimate,
  region,
  sampleSetup,
  savedAfterAutosave,
  setupWith,
  installFakeClock,
  withoutPricesFor,
} from "./estimateTestUtils";
import { createHarness } from "../../testing/renderApp";

installFakeClock();

/** The sample deal, read through a cost book that has no prices for the windows. */
async function windowsUnpricedSetup() {
  const base = createHarness();
  const harness = harnessOver(base, withoutPricesFor(base.repository, "windows"));
  const { deal } = await setupWith(() => {}, harness);
  return { harness, deal };
}

describe("an estimate with a line that has no price", () => {
  it("says some lines have no price yet, with each missing item, instead of the table", async () => {
    const { harness, deal } = await windowsUnpricedSetup();
    await openEstimate(harness, deal);

    const lines = region("Cost lines");
    expect(within(lines).getByRole("heading", { level: 3, name: "Some lines have no price yet" })).toBeVisible();
    expect(within(lines).getByText(/^No price for Windows & exterior doors \(windows\)/)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // The filter is for the table.
    expect(screen.queryByRole("group", { name: "Show" })).not.toBeInTheDocument();
  });

  it("shows dashes for the figures it cannot work out, and keeps the contingency box usable", async () => {
    const { harness, deal } = await windowsUnpricedSetup();
    await openEstimate(harness, deal);

    const card = region("Build estimate");
    expect(within(card).getByLabelText("Contingency")).toHaveValue("5.00");
    expect(within(card).getByLabelText("Contingency")).toBeEnabled();
    expect(card).toHaveTextContent("—");
    expect(card).not.toHaveTextContent("$");
    expect(region("How solid is this number?")).toHaveTextContent("Fill in the missing prices to see this.");
    expect(region("Get bids here next")).toHaveTextContent("Fill in the missing prices to see this.");
  });

  it("offers Add bid on the item, with a form titled by the line's name", async () => {
    const { harness, deal } = await windowsUnpricedSetup();
    await openEstimate(harness, deal);

    await newUser().click(within(region("Cost lines")).getByRole("button", { name: "Add bid" }));

    const form = screen.getByRole("form", { name: "Add bid for Windows & exterior doors" });
    expect(within(form).getByLabelText("Vendor")).toHaveFocus();
  });

  it("brings the table back, with the line priced by the bid, once a windows bid is saved", async () => {
    const { harness, deal } = await windowsUnpricedSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(region("Cost lines")).getByRole("button", { name: "Add bid" }));
    const form = screen.getByRole("form", { name: /Add bid for Windows/ });
    await user.type(within(form).getByLabelText("Vendor"), "Clear View");
    await user.type(within(form).getByLabelText("Amount"), "31000");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await advance(200);

    expect(screen.queryByText("Some lines have no price yet")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Cost lines by division" });
    const row = within(table).getByRole("button", { name: "Windows & exterior doors" }).closest("tr");
    expect(row).toHaveTextContent("Bid");
    expect(row).toHaveTextContent("$31,000");
    expect(region("Build estimate")).not.toHaveTextContent("—");

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.bids.at(-1)).toEqual({ code: "windows", amountCents: 3_100_000, vendor: "Clear View", receivedOn: "2026-10-31" });
  });

  it("closes the form and leaves the list as it was when Cancel is chosen", async () => {
    const { harness, deal } = await windowsUnpricedSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(region("Cost lines")).getByRole("button", { name: "Add bid" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByText("Some lines have no price yet")).toBeVisible();
    expect(within(region("Cost lines")).getByRole("button", { name: "Add bid" })).toHaveFocus();
  });
});

describe("an estimate that is incomplete for another reason", () => {
  it("links an item that is not about a cost code to the step that fixes it", async () => {
    // A negative finished area stops the house from being evaluated; the engine's item names the House step.
    const { harness, deal } = await setupWith((inputs) => {
      inputs.house.levels.main.finishedSf = -1;
    });
    await openEstimate(harness, deal);

    const lines = region("Cost lines");
    expect(within(lines).getByText("Some lines have no price yet")).toBeVisible();
    expect(within(lines).getByText("house.levels.main.finishedSf: Must be 0 or more")).toBeVisible();
    const link = within(lines).getByRole("link", { name: "Go to House" });
    expect(link).toHaveAttribute("href", `#/deals/${deal.id}/house`);
    expect(within(lines).queryByRole("button", { name: "Add bid" })).not.toBeInTheDocument();
  });
});

describe("a complete estimate", () => {
  it("does not show the incomplete panel", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    expect(screen.queryByText("Some lines have no price yet")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Cost lines by division" })).toBeVisible();
  });
});
