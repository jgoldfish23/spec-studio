import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Estimate } from "@engine";
import { formatMoney } from "../../lib/format";
import { installFakeClock, newUser } from "../../testing/editorTiming";
import {
  bodyRows,
  costTable,
  crewBid,
  estimateOf,
  lineRow,
  openEstimate,
  region,
  sampleSetup,
  setupEveryLineBid,
  setupWith,
} from "./estimateTestUtils";
import { formatAsOf, formatQuantity, variantName } from "./lineFormat";

installFakeClock();

const line = (estimate: Estimate, code: string) => {
  const found = estimate.lines.find((l) => l.code === code);
  if (found === undefined) throw new Error(`no ${code} line`);
  return found;
};

describe("Estimate page layout", () => {
  it("draws the three summary cards and the cost lines, in the mockup's order", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Build estimate", "How solid is this number?", "Get bids here next", "Cost lines"]);
    expect(screen.getByRole("heading", { level: 1, name: "Estimate" })).toBeInTheDocument();
  });

  it("links on to the market step", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    expect(screen.getByRole("link", { name: "Next: check the market →" })).toHaveAttribute("href", `#/deals/${deal.id}/market`);
  });

  it("scrolls the table inside its own box, so a narrow screen's page never scrolls sideways", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    expect(costTable().parentElement).toHaveClass("overflow-x-auto");
  });
});

describe("Estimate page cost lines", () => {
  it("shows a Bid badge on the Framing line and a Default badge on the Roofing line", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    expect(within(lineRow("Framing")).getByText("Bid")).toBeVisible();
    expect(within(lineRow("Framing")).queryByText("Default")).not.toBeInTheDocument();
    expect(within(lineRow("Roofing")).getByText("Default")).toBeVisible();
    expect(within(lineRow("Roofing")).queryByText("Bid")).not.toBeInTheDocument();
  });

  it("names the columns", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    const names = within(costTable())
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(names).toEqual(["Line", "Quantity", "Unit cost", "Total", "Price source", "Action"]);
  });

  it("groups the lines under their divisions, each with the engine's subtotal", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    const names = within(costTable())
      .getAllByRole("rowheader")
      .filter((header) => header.getAttribute("scope") === "rowgroup")
      .map((header) => header.textContent);
    expect(names).toEqual([
      "Soft costs",
      "Site",
      "Structure",
      "Envelope",
      "Plumbing, electrical & HVAC",
      "Interior",
      "Exterior finish",
      "General",
    ]);
    const structure = within(costTable()).getByRole("rowheader", { name: "Structure" }).closest("tr");
    expect(structure).toHaveTextContent(formatMoney(estimate.divisionSubtotals.structure));
    const general = within(costTable()).getByRole("rowheader", { name: "General" }).closest("tr");
    expect(general).toHaveTextContent(formatMoney(estimate.divisionSubtotals.general));
  });

  it("shows each line's quantity, unit cost and total", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    // One part: its quantity and unit, its unit price, and the line's total.
    const roofing = within(lineRow("Roofing")).getAllByRole("cell");
    expect(roofing.map((cell) => cell.textContent)).toEqual(["40 sq", "$600.00", "$24,000", "Default", "Add bid"]);
    // Several parts: how many, and "Mixed".
    const flooring = within(lineRow("Flooring")).getAllByRole("cell");
    expect(flooring.slice(0, 3).map((cell) => cell.textContent)).toEqual([
      "5 parts",
      "Mixed",
      formatMoney(line(estimate, "flooring").totalCents),
    ]);
    // A bid line has no unit price; its quantity is the takeoff's.
    const framingTakeoff = line(estimate, "framing").takeoff[0];
    if (framingTakeoff === undefined) throw new Error("framing has a takeoff");
    const framing = within(lineRow("Framing")).getAllByRole("cell");
    expect(framing.map((cell) => cell.textContent)).toEqual([
      formatQuantity(framingTakeoff.quantity, framingTakeoff.unit),
      "—",
      "$108,000",
      "Bid",
      "Edit bidRemove bid",
    ]);
  });

  it("totals the whole estimate in the footer", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    const subtotal = within(costTable()).getByRole("rowheader", { name: "Subtotal" }).closest("tr");
    expect(subtotal).toHaveTextContent(formatMoney(estimate.subtotalCents));
    const contingency = within(costTable()).getByRole("rowheader", { name: "Contingency" }).closest("tr");
    expect(contingency).toHaveTextContent("5%");
    expect(contingency).toHaveTextContent(formatMoney(estimate.contingencyCents));
    const total = within(costTable()).getByRole("rowheader", { name: "Build estimate" }).closest("tr");
    expect(total).toHaveTextContent(formatMoney(estimate.totalCents));
  });

  it("marks an old price", async () => {
    // A bid received more than a year before today is stale.
    const { harness, deal } = await setupWith((inputs) => {
      const framing = inputs.bids.find((bid) => bid.code === "framing");
      if (framing === undefined) throw new Error("the sample has a framing bid");
      framing.receivedOn = "2025-06-01";
    });
    await openEstimate(harness, deal);

    expect(within(lineRow("Framing")).getByText("Old price")).toBeVisible();
    expect(within(lineRow("Roofing")).queryByText("Old price")).not.toBeInTheDocument();
  });
});

describe("Estimate page filter", () => {
  it("lists every line under All lines, which is the starting choice", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    const show = screen.getByRole("group", { name: "Show" });
    expect(within(show).getByRole("button", { name: "All lines" })).toHaveAttribute("aria-pressed", "true");
    expect(within(show).getByRole("button", { name: "Defaults only" })).toHaveAttribute("aria-pressed", "false");
    expect(within(costTable()).getByRole("button", { name: "Framing" })).toBeVisible();
  });

  it("hides the Framing row under Defaults only, and brings it back under All lines", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(screen.getByRole("button", { name: "Defaults only" }));
    expect(within(costTable()).queryByRole("button", { name: "Framing" })).not.toBeInTheDocument();
    expect(within(costTable()).getByRole("button", { name: "Roofing" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "All lines" }));
    expect(within(costTable()).getByRole("button", { name: "Framing" })).toBeVisible();
  });

  it("hides a division with no default lines, and its subtotal row, but keeps the footer's whole-estimate totals", async () => {
    // Every line of the General division is bid, so under Defaults only it has nothing to show.
    const { harness, deal } = await setupWith((inputs) => {
      for (const code of ["cleaning", "supervision"]) inputs.bids.push(crewBid(code));
    });
    await openEstimate(harness, deal);
    const user = newUser();
    const totalRow = () => within(costTable()).getByRole("rowheader", { name: "Build estimate" }).closest("tr");
    const totalBefore = totalRow()?.textContent;
    expect(within(costTable()).getByRole("rowheader", { name: "General" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Defaults only" }));

    expect(within(costTable()).queryByRole("rowheader", { name: /^General/ })).not.toBeInTheDocument();
    expect(within(costTable()).getByRole("rowheader", { name: /^Structure/ })).toBeVisible();
    expect(totalRow()?.textContent).toBe(totalBefore);
  });

  it("labels a division's subtotal as the whole division's while only some of its lines are listed", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();
    const user = newUser();
    const structure = () => within(costTable()).getByRole("rowheader", { name: /^Structure/ }).closest("tr");

    // Every line is listed, so the subtotal is just the division's.
    expect(within(costTable()).getByRole("rowheader", { name: "Structure" })).toBeVisible();
    expect(within(costTable()).queryByRole("rowheader", { name: /all lines/ })).not.toBeInTheDocument();

    // Only Roofing is a default in the Structure division, yet its subtotal is still the whole division's.
    await user.click(screen.getByRole("button", { name: "Defaults only" }));
    expect(within(costTable()).getByRole("rowheader", { name: "Structure subtotal (all lines)" })).toBeVisible();
    expect(structure()).toHaveTextContent(formatMoney(estimate.divisionSubtotals.structure));
    expect(within(costTable()).queryByRole("button", { name: "Framing" })).not.toBeInTheDocument();
    expect(within(costTable()).getByRole("button", { name: "Roofing" })).toBeVisible();

    // Back to every line: the plain name again.
    await user.click(screen.getByRole("button", { name: "All lines" }));
    expect(within(costTable()).getByRole("rowheader", { name: "Structure" })).toBeVisible();
  });

  it("says so when no line is on a default", async () => {
    const { harness, deal } = await setupEveryLineBid();
    await openEstimate(harness, deal);

    await newUser().click(screen.getByRole("button", { name: "Defaults only" }));

    expect(within(region("Cost lines")).getByText("No line is priced from a starter default.")).toBeVisible();
  });
});

describe("Estimate page line details", () => {
  it("expands a line to its parts when its name is clicked, and folds it up again", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();
    const user = newUser();

    const name = within(costTable()).getByRole("button", { name: "Flooring" });
    expect(name).toHaveAttribute("aria-expanded", "false");
    await user.click(name);
    expect(name).toHaveAttribute("aria-expanded", "true");

    const parts = screen.getByRole("table", { name: "Flooring parts" });
    expect(within(parts).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Variant",
      "Tier",
      "Quantity",
      "Unit price",
      "Total",
      "Source",
      "As of",
    ]);
    const rows = bodyRows(parts);
    expect(rows).toHaveLength(5);

    const first = line(estimate, "flooring").parts[0];
    if (first === undefined) throw new Error("flooring has parts");
    expect(within(rows[0] as HTMLElement).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      variantName(first.variant),
      "Upgraded",
      formatQuantity(first.quantity, first.unit),
      formatMoney(first.unitPriceCents, { cents: true }),
      formatMoney(first.totalCents),
      "Default",
      formatAsOf(first.asOf),
    ]);

    await user.click(name);
    expect(name).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Flooring parts" })).not.toBeInTheDocument();
  });

  it("shows a dash for a tier a part does not have", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await newUser().click(within(costTable()).getByRole("button", { name: "Roofing" }));

    const rows = bodyRows(screen.getByRole("table", { name: "Roofing parts" }));
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getAllByRole("cell")[1]).toHaveTextContent("—");
  });

  it("keeps two lines open at once", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(costTable()).getByRole("button", { name: "Flooring" }));
    await user.click(within(costTable()).getByRole("button", { name: "Roofing" }));

    expect(screen.getByRole("table", { name: "Flooring parts" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Roofing parts" })).toBeVisible();
  });

  it("shows a bid line's takeoff quantities and says it is priced by bid", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await user.click(within(costTable()).getByRole("button", { name: "Cabinets & countertops" }));

    expect(screen.getByText("Priced by bid")).toBeVisible();
    // The takeoff has three parts for the cabinets (kitchen, primary bath and the rest), none of them priced.
    const takeoff = screen.getByRole("table", { name: "Cabinets & countertops takeoff" });
    expect(within(takeoff).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Variant", "Tier", "Quantity"]);
    expect(bodyRows(takeoff)).toHaveLength(3);
    expect(screen.queryByRole("table", { name: "Cabinets & countertops parts" })).not.toBeInTheDocument();
  });

  it("names the bid's vendor and date with the note", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await newUser().click(within(costTable()).getByRole("button", { name: "Framing" }));

    expect(screen.getByText("Priced by bid")).toBeVisible();
    expect(screen.getByText("Golden, received Oct 12, 2026")).toBeVisible();
  });
});
