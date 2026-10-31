import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Bid, DealInputs } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import { formatPercent } from "../../lib/format";
import { advance, installFakeClock, newUser, savedAfterAutosave } from "../../testing/editorTiming";
import type { User } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import { lineRow, openEstimate, region, sampleSetup } from "./estimateTestUtils";

installFakeClock();

const ROOFING_BID: Bid = { code: "roofing", amountCents: 3_000_000, vendor: "Wasatch Roofing", receivedOn: "2026-10-31" };

/** The bid share the engine works out for the sample deal with `bids` in place of its own. */
async function bidShareWith(bids: Bid[]): Promise<string> {
  const inputs: DealInputs = sampleDealInputs();
  inputs.bids = bids;
  const evaluation = await evaluated(inputs);
  if (evaluation.estimate.status !== "ok") throw new Error("the estimate is incomplete");
  return formatPercent(evaluation.estimate.value.confidence.bidShare, 0);
}

const solid = () => region("How solid is this number?");

async function addRoofingBid(user: User) {
  await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));
  const form = screen.getByRole("form", { name: /Add bid for Roofing/ });
  await user.type(within(form).getByLabelText("Vendor"), "Wasatch Roofing");
  await user.type(within(form).getByLabelText("Amount"), "30000");
  await user.click(within(form).getByRole("button", { name: "Save" }));
  await advance(200);
}

describe("adding a bid", () => {
  it("makes the line a bid at the bid's amount, and raises the bid share", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();
    const before = await bidShareWith(sampleDealInputs().bids);
    const after = await bidShareWith([...sampleDealInputs().bids, ROOFING_BID]);
    expect(after).not.toBe(before);
    expect(solid()).toHaveTextContent(`${before} backed by real bids`);

    await addRoofingBid(user);

    const roofing = lineRow("Roofing");
    expect(within(roofing).getByText("Bid")).toBeVisible();
    expect(within(roofing).queryByText("Default")).not.toBeInTheDocument();
    expect(roofing).toHaveTextContent("$30,000");
    expect(within(roofing).getByRole("button", { name: "Edit bid" })).toBeVisible();
    expect(within(roofing).getByRole("button", { name: "Remove bid" })).toBeVisible();
    expect(within(roofing).queryByRole("button", { name: "Add bid" })).not.toBeInTheDocument();
    expect(solid()).toHaveTextContent(`${after} backed by real bids`);
    // The form closed when the bid was saved.
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("stores the bid with the deal, after the other bids", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await addRoofingBid(newUser());

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.bids).toEqual([...sampleDealInputs().bids, ROOFING_BID]);
    // A blank note is left out, not stored as "".
    expect(stored.bids.at(-1)).not.toHaveProperty("notes");
  });

  it("stores the notes, trimmed, when there are some", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));
    const form = screen.getByRole("form", { name: /Add bid for Roofing/ });
    await user.type(within(form).getByLabelText("Vendor"), "  Wasatch Roofing ");
    await user.type(within(form).getByLabelText("Amount"), "30,000.50");
    await user.type(within(form).getByLabelText("Notes"), "  Includes tear-off ");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.bids.at(-1)).toEqual({ ...ROOFING_BID, amountCents: 3_000_050, notes: "Includes tear-off" });
  });

  it("opens the form under the line, titled with the line's name, with the date set to today and the vendor focused", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await newUser().click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));

    const form = screen.getByRole("form", { name: "Add bid for Roofing" });
    expect(within(form).getByRole("heading", { level: 3 })).toHaveTextContent("Add bid for Roofing");
    expect(within(form).getByLabelText("Vendor")).toHaveFocus();
    expect(within(form).getByLabelText("Amount")).toHaveValue("");
    expect(within(form).getByLabelText("Received")).toHaveValue("2026-10-31");
    expect(within(form).getByLabelText("Notes")).toHaveValue("");
    // Directly under the line it is for.
    expect(lineRow("Roofing").nextElementSibling).toContainElement(form);
  });

  it("asks for what is missing only once Save has been tried, and writes nothing", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));
    const form = screen.getByRole("form", { name: /Add bid for Roofing/ });
    expect(within(form).queryByText("Vendor is required")).not.toBeInTheDocument();
    expect(within(form).queryByText("Enter an amount above $0")).not.toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(within(form).getByText("Vendor is required")).toBeVisible();
    expect(within(form).getByText("Enter an amount above $0")).toBeVisible();
    expect(within(form).getByLabelText("Vendor")).toHaveFocus();
    await advance(200);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(within(lineRow("Roofing")).getByText("Default")).toBeVisible();
  });

  it("closes the form without writing when Cancel is chosen, and puts focus back on the line's button", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));
    const form = screen.getByRole("form", { name: /Add bid for Roofing/ });
    await user.type(within(form).getByLabelText("Vendor"), "Someone");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" })).toHaveFocus();
    await advance(200);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(within(lineRow("Roofing")).getByText("Default")).toBeVisible();
  });

  it("opens one form at a time", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Add bid" }));
    await user.click(within(lineRow("Flooring")).getByRole("button", { name: "Add bid" }));

    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(screen.getByRole("form", { name: /Add bid for Flooring/ })).toBeVisible();
  });
});

describe("editing a bid", () => {
  it("opens the form filled in with the bid, and replaces that bid in place when saved", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Framing")).getByRole("button", { name: "Edit bid" }));

    const form = screen.getByRole("form", { name: "Edit bid for Framing" });
    expect(within(form).getByLabelText("Vendor")).toHaveValue("Golden");
    expect(within(form).getByLabelText("Amount")).toHaveValue("108,000.00");
    expect(within(form).getByLabelText("Received")).toHaveValue("2026-10-12");

    const amount = within(form).getByLabelText("Amount");
    await user.clear(amount);
    await user.type(amount, "110000");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await advance(200);

    expect(lineRow("Framing")).toHaveTextContent("$110,000");
    const stored = await savedAfterAutosave(harness, deal);
    const expected = sampleDealInputs().bids.map((bid) => (bid.code === "framing" ? { ...bid, amountCents: 11_000_000 } : bid));
    expect(stored.bids).toEqual(expected);
  });
});

describe("removing a bid", () => {
  it("puts the line back on its default price and lowers the bid share again", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();
    const before = await bidShareWith(sampleDealInputs().bids);

    await addRoofingBid(user);
    await user.click(within(lineRow("Roofing")).getByRole("button", { name: "Remove bid" }));
    await advance(200);

    const roofing = lineRow("Roofing");
    expect(within(roofing).getByText("Default")).toBeVisible();
    expect(within(roofing).queryByText("Bid")).not.toBeInTheDocument();
    expect(roofing).toHaveTextContent("$24,000");
    expect(within(roofing).getByRole("button", { name: "Add bid" })).toBeVisible();
    expect(solid()).toHaveTextContent(`${before} backed by real bids`);
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.bids).toEqual(sampleDealInputs().bids);
  });

  it("can be undone from the header", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Framing")).getByRole("button", { name: "Remove bid" }));
    await advance(200);
    expect(within(lineRow("Framing")).getByText("Default")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await advance(200);
    expect(within(lineRow("Framing")).getByText("Bid")).toBeVisible();
  });
});

describe("where keyboard focus goes", () => {
  /** The button with a line's name, which stays in the row whatever the line's price comes from. */
  const nameButton = (name: string) => within(lineRow(name)).getByRole("button", { name });

  it("is the line's name when a bid is saved, since the Save button goes with the form", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await addRoofingBid(newUser());

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(nameButton("Roofing"));
  });

  it("is the line's name when Remove bid is pressed, since that button goes with the bid", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Framing")).getByRole("button", { name: "Remove bid" }));
    expect(document.activeElement).toBe(nameButton("Framing"));

    // And it is still there once the line has been redrawn as a default.
    await advance(200);
    expect(within(lineRow("Framing")).getByText("Default")).toBeVisible();
    expect(document.activeElement).toBe(nameButton("Framing"));
  });

  it("is the button that opened the form when it is cancelled", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(lineRow("Framing")).getByRole("button", { name: "Edit bid" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(within(lineRow("Framing")).getByRole("button", { name: "Edit bid" }));
  });
});
