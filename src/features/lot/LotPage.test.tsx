import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { evaluateDeal } from "@engine";
import type { DealInputs, ValidationIssue } from "@engine";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "../../data/sample";
import type { StoredDeal } from "../../data/types";
import { formatMoney } from "../../lib/format";
import { advance, installFakeClock, newUser, pasteOver, savedAfterAutosave, typeOver } from "../../testing/editorTiming";
import { contextFor, evaluated } from "../../testing/engineContext";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";
import { newDealSetup, sampleSetup } from "../../testing/stepHarness";
import { DealEditorContext } from "../deal/DealEditorContext";
import { summarize } from "../deal/summary";
import type { DealEditor } from "../deal/useDealEditor";
import { LotPage } from "./LotPage";

installFakeClock();

async function openLot(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/lot`, harness);
  await screen.findByLabelText("City");
}

const card = (name: string) => screen.getByRole("region", { name });
const group = (name: string) => screen.getByRole("group", { name });
const tile = (label: string) => within(screen.getByRole("region", { name: "Deal summary" })).getByText(label).closest("dl") as HTMLElement;

describe("Lot page layout", () => {
  it("draws the four cards and the side panel, in the mockup's order", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["The lot", "Price & closing", "City & carrying", "Timeline", "Lot so far"]);
  });

  it("shows the deal name read-only, and says where to change it", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const name = within(card("The lot")).getByLabelText("Address / name");
    expect(name).toHaveValue(SAMPLE_DEAL_NAME);
    expect(name).toHaveAttribute("readonly");
    expect(within(card("The lot")).getByText("Change the name at the top of the page")).toBeVisible();
    // The header's own box is still the only editable "Deal name".
    expect(screen.getByLabelText("Deal name")).not.toHaveAttribute("readonly");
    // 16 px on a phone like every other box, so focusing it does not zoom the page on iOS.
    expect(name).toHaveClass("text-base", "sm:text-[15px]");
  });

  it("shows the sample lot in the fields", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const lot = card("The lot");
    expect(within(lot).getByLabelText("City")).toHaveValue("Kaysville");
    expect(within(lot).getByLabelText("County")).toHaveValue("Davis");
    expect(within(lot).getByLabelText("Acres")).toHaveValue("0.33");
    expect(within(lot).getByLabelText("Frontage")).toHaveValue("");
    const region = within(lot).getByRole("group", { name: "Region" });
    expect(within(region).getAllByRole("button")).toHaveLength(1);
    expect(within(region).getByRole("button", { name: "Northern Utah (Davis & Weber)" })).toHaveAttribute("aria-pressed", "true");

    const price = card("Price & closing");
    expect(within(price).getByLabelText("Lot price")).toHaveValue("295,000");
    expect(within(price).getByLabelText("Closing costs")).toHaveValue("4,000");
    expect(within(price).getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "true");
    expect(within(price).getByRole("button", { name: "Land loan" })).toHaveAttribute("aria-pressed", "false");

    const carrying = card("City & carrying");
    expect(within(carrying).getByLabelText("Property tax rate %")).toHaveValue("0.48");
    expect(within(carrying).getByText("Default for Northern Utah · verify with the county")).toBeVisible();
    expect(within(carrying).getByLabelText("HOA $/month")).toHaveValue("0");

    const timeline = card("Timeline");
    expect(within(timeline).getByLabelText("Land closes")).toHaveValue("2027-06");
    expect(within(timeline).getByLabelText("Design & permits months")).toHaveValue("2");
    expect(within(timeline).getByLabelText("Build months")).toHaveValue("9");
    expect(within(timeline).getByLabelText("Closing days after contract")).toHaveValue("35");
    expect(within(timeline).getByRole("button", { name: "At completion" })).toHaveAttribute("aria-pressed", "true");
    expect(within(timeline).getByRole("button", { name: "Before completion" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has one control for each utility, with the same three answers", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const expected: Record<string, string> = {
      Water: "Needs connection",
      Sewer: "Needs connection",
      Gas: "Needs connection",
      Power: "Needs connection",
      "Secondary water": "Unknown",
    };
    for (const [name, pressed] of Object.entries(expected)) {
      const utility = group(name);
      expect(within(utility).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Available",
        "Needs connection",
        "Unknown",
      ]);
      expect(within(utility).getByRole("button", { pressed: true })).toHaveTextContent(pressed);
    }
  });

  it("has a link to the house step", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);
    expect(screen.getByRole("link", { name: "Next: describe the house →" })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/house`,
    );
  });
});

describe("Lot page edits", () => {
  it("updates the summary strip's total project cost within 200 ms of a new lot price", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const edited = structuredClone(deal.inputs);
    edited.lot.priceCents = 25_400_000;
    const expected = summarize(evaluateDeal(edited, await contextFor({ repository: harness.repository }))).totalProjectCostCents;
    expect(expected).not.toBeNull();
    const before = tile("Total project cost").textContent;
    expect(before).not.toContain(formatMoney(expected));

    fireEvent.change(screen.getByLabelText("Lot price"), { target: { value: "254,000" } });
    // The figure waits out the 150 ms quiet period, then catches up.
    await advance(60);
    expect(tile("Total project cost").textContent).toBe(before);
    await advance(140);
    expect(tile("Total project cost")).toHaveTextContent(formatMoney(expected));
    expect(tile("Total project cost").textContent).not.toBe(before);
  });

  it("saves the lot price and moves the side panel's figures", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);
    const panel = card("Lot so far");
    expect(within(panel).getByText("Land + closing").nextElementSibling).toHaveTextContent("$299,000");

    await typeOver(newUser(), "Lot price", "254,000");
    await advance(200);

    expect(within(panel).getByText("Land + closing").nextElementSibling).toHaveTextContent("$258,000");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.lot.priceCents).toBe(25_400_000);
    expect(stored.lot.closingCents).toBe(400_000);
  });

  describe("paying for the land", () => {
    it("shows LTV, rate and points at the defaults for Land loan, and stores the loan", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      expect(screen.queryByLabelText("LTV %")).not.toBeInTheDocument();

      await user.click(within(card("Price & closing")).getByRole("button", { name: "Land loan" }));

      expect(screen.getByLabelText("LTV %")).toHaveValue("70.00");
      expect(screen.getByLabelText("Rate %")).toHaveValue("10.00");
      expect(screen.getByLabelText("Points %")).toHaveValue("1.00");
      expect(within(card("Price & closing")).getByRole("button", { name: "Land loan" })).toHaveAttribute("aria-pressed", "true");

      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.lot.financing).toEqual({ kind: "loan", ltv: 0.7, rate: 0.1, points: 0.01 });
      expect(stored.lot.financing.kind).toBe("loan");
    });

    it("writes each loan field as a decimal", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      await user.click(screen.getByRole("button", { name: "Land loan" }));

      await typeOver(user, "LTV %", "65");
      await typeOver(user, "Rate %", "9.5");
      await typeOver(user, "Points %", "1.5");

      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.lot.financing).toEqual({ kind: "loan", ltv: 0.65, rate: 0.095, points: 0.015 });
    });

    it("keeps the typed loan terms when the pressed Land loan is clicked again, and Cash drops the loan", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      await user.click(screen.getByRole("button", { name: "Land loan" }));
      await typeOver(user, "LTV %", "60");

      await user.click(screen.getByRole("button", { name: "Land loan" }));
      expect(screen.getByLabelText("LTV %")).toHaveValue("60.00");

      await user.click(screen.getByRole("button", { name: "Cash" }));
      expect(screen.queryByLabelText("LTV %")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Rate %")).not.toBeInTheDocument();
      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.lot.financing).toEqual({ kind: "cash" });

      // Back to a loan: the defaults again, not the 60% from before.
      await user.click(screen.getByRole("button", { name: "Land loan" }));
      expect(screen.getByLabelText("LTV %")).toHaveValue("70.00");
    });

    it("undoes the whole switch in one step", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      await user.click(screen.getByRole("button", { name: "Land loan" }));
      expect(screen.getByLabelText("LTV %")).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(screen.queryByLabelText("LTV %")).not.toBeInTheDocument();
      expect(within(card("Price & closing")).getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "true");
    });

    it("refuses a loan-to-value above 100%, and shows the engine's message for a stored one", async () => {
      const user = newUser();
      const harness = createHarness();
      const sample = await seedSampleDeal(harness.repository);
      const inputs = structuredClone(sample.inputs);
      inputs.lot.financing = { kind: "loan", ltv: 1.5, rate: 0.1, points: 0.01 };
      const deal = await harness.repository.createDeal({ name: "Loan", inputs });
      await openLot(harness, deal);

      expect(screen.getByLabelText("LTV %")).toHaveAttribute("aria-invalid", "true");
      expect(within(card("Price & closing")).getByText(/Must be 1 or less/)).toBeVisible();
      expect(screen.getByLabelText("Rate %")).not.toHaveAttribute("aria-invalid");

      await typeOver(user, "LTV %", "120");
      expect(screen.getByText("Must be between 0% and 100%")).toBeVisible();
    });
  });

  describe("listing for sale", () => {
    it("shows the months box for Before completion, starting at 1, and stores the months typed", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      expect(screen.queryByLabelText("Months before completion")).not.toBeInTheDocument();

      await user.click(within(card("Timeline")).getByRole("button", { name: "Before completion" }));
      const months = screen.getByLabelText("Months before completion");
      expect(months).toHaveValue("1");
      expect(within(card("Timeline")).getByRole("button", { name: "Before completion" })).toHaveAttribute("aria-pressed", "true");

      await typeOver(user, "Months before completion", "2");
      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.timeline.listEarlyMonths).toBe(2);
    });

    it("sets listEarlyMonths back to 0 for At completion and hides the box", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      await user.click(screen.getByRole("button", { name: "Before completion" }));
      await typeOver(user, "Months before completion", "3");

      await user.click(screen.getByRole("button", { name: "At completion" }));
      expect(screen.queryByLabelText("Months before completion")).not.toBeInTheDocument();
      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.timeline.listEarlyMonths).toBe(0);
    });

    it("opens on Before completion, with the stored months, for a deal that lists early", async () => {
      const harness = createHarness();
      const sample = await seedSampleDeal(harness.repository);
      const inputs = structuredClone(sample.inputs);
      inputs.timeline.listEarlyMonths = 2;
      const deal = await harness.repository.createDeal({ name: "Early", inputs });
      await openLot(harness, deal);

      expect(screen.getByRole("button", { name: "Before completion" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Months before completion")).toHaveValue("2");
    });

    it("keeps the months between 1 and the build length", async () => {
      const user = newUser();
      const { harness, deal } = await sampleSetup();
      await openLot(harness, deal);
      await user.click(screen.getByRole("button", { name: "Before completion" }));

      await typeOver(user, "Months before completion", "10");
      expect(screen.getByText("Must be between 1 and 9")).toBeVisible();
      await typeOver(user, "Months before completion", "0");
      expect(screen.getByText("Must be between 1 and 9")).toBeVisible();
      await typeOver(user, "Months before completion", "1.5");
      expect(screen.getByText("Enter a number")).toBeVisible();

      const stored = await savedAfterAutosave(harness, deal);
      expect(stored.timeline.listEarlyMonths).toBe(1);
    });

    it("leaves the upper limit to the engine when the build length is not a usable number", async () => {
      const harness = createHarness();
      const sample = await seedSampleDeal(harness.repository);
      const inputs = structuredClone(sample.inputs);
      inputs.timeline.buildMonths = 0;
      inputs.timeline.listEarlyMonths = 3;
      const deal = await harness.repository.createDeal({ name: "No build", inputs });
      await openLot(harness, deal);

      const user = newUser();
      expect(screen.getByLabelText("Months before completion")).toHaveValue("3");
      // No limit of ours: 40 is accepted by the field, and the engine says what is wrong with the deal.
      await typeOver(user, "Months before completion", "40");
      expect(screen.queryByText(/Must be between/)).not.toBeInTheDocument();
      await advance(200);
      expect(within(card("Timeline")).getByLabelText("Build months")).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("stores a utility answer and leaves the other four alone", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    await user.click(within(group("Sewer")).getByRole("button", { name: "Available" }));
    await user.click(within(group("Secondary water")).getByRole("button", { name: "Needs connection" }));

    expect(within(group("Sewer")).getByRole("button", { name: "Available" })).toHaveAttribute("aria-pressed", "true");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.lot.utilities).toEqual({
      water: "needsConnection",
      sewer: "available",
      gas: "needsConnection",
      power: "needsConnection",
      secondaryWater: "needsConnection",
    });
  });

  it("stores the county, acres, frontage and the carrying costs", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    await typeOver(user, "County", "Weber");
    await typeOver(user, "Acres", "0.5");
    await typeOver(user, "Frontage", "95");
    await typeOver(user, "Closing costs", "5,500");
    await typeOver(user, "Property tax rate %", "0.55");
    await typeOver(user, "HOA $/month", "75");

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.lot).toMatchObject({
      county: "Weber",
      acres: 0.5,
      frontageFt: 95,
      closingCents: 550_000,
      propertyTaxRate: 0.0055,
      hoaMonthlyCents: 7_500,
    });
  });

  it("removes the frontage when its box is emptied", async () => {
    const user = newUser();
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const inputs = structuredClone(sample.inputs);
    inputs.lot.frontageFt = 95;
    const deal = await harness.repository.createDeal({ name: "Frontage", inputs });
    await openLot(harness, deal);
    expect(screen.getByLabelText("Frontage")).toHaveValue("95");

    await user.clear(screen.getByLabelText("Frontage"));
    const stored = await savedAfterAutosave(harness, deal);
    expect("frontageFt" in stored.lot).toBe(false);
  });

  it("stores the timeline numbers and the land close month", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    fireEvent.change(screen.getByLabelText("Land closes"), { target: { value: "2027-09" } });
    await typeOver(user, "Design & permits months", "3");
    await typeOver(user, "Build months", "10");
    await typeOver(user, "Closing days after contract", "45");

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.timeline).toMatchObject({
      landClose: "2027-09",
      preConMonths: 3,
      buildMonths: 10,
      closingDays: 45,
    });
  });

  it("holds a number the field refuses out of the deal", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    // Pasted, so no shorter text on the way is a number the field would accept and send on.
    await pasteOver(user, "Lot price", "100,000,001");
    expect(screen.getByText("Must be between $0 and $100,000,000")).toBeVisible();
    await pasteOver(user, "Build months", "2.5");
    expect(within(card("Timeline")).getByText("Enter a number")).toBeVisible();
    await pasteOver(user, "Build months", "40");
    expect(within(card("Timeline")).getByText("Must be between 1 and 36")).toBeVisible();
    await pasteOver(user, "Acres", "-1");
    expect(screen.getByText("Must be between 0 ac and 1,000 ac")).toBeVisible();
    // The field and the engine agree on the most a lot can be.
    await pasteOver(user, "Acres", "1001");
    expect(screen.getByText("Must be between 0 ac and 1,000 ac")).toBeVisible();
    await pasteOver(user, "Property tax rate %", "150");
    expect(screen.getByText("Must be between 0% and 100%")).toBeVisible();

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.lot.priceCents).toBe(29_500_000);
    expect(stored.timeline.buildMonths).toBe(9);
    expect(stored.lot.acres).toBe(0.33);
    expect(stored.lot.propertyTaxRate).toBe(0.0048);
  });
});

describe("a new deal", () => {
  it("asks for the city, and stops asking once it is typed", async () => {
    const user = newUser();
    const { harness, deal } = await newDealSetup();
    await openLot(harness, deal);

    const city = screen.getByLabelText("City");
    expect(city).toHaveValue("");
    expect(await screen.findByText("Required")).toBeVisible();
    expect(city).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Needs info")).toBeVisible();
    const needs = screen.getByText("Needs:").parentElement as HTMLElement;
    const cityNeed = within(needs).getByRole("link", { name: "City: Required" });
    expect(cityNeed).toHaveAttribute("href", `#/deals/${deal.id}/lot`);

    await user.type(city, "Layton");
    await advance(200);

    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(city).not.toHaveAttribute("aria-invalid");
    // The city was the only thing the lot step lacked. What is still missing is on the market step (no comps fit a
    // 2,000 sf rambler), so the verdict is still "Needs info" but no longer mentions the city.
    expect(screen.getByText("Needs info")).toBeVisible();
    const remaining = screen.getByText("Needs:").parentElement as HTMLElement;
    expect(within(remaining).queryByText(/City/)).not.toBeInTheDocument();
    expect(within(remaining).getByRole("link")).toHaveAttribute("href", `#/deals/${deal.id}/market`);
  });

  it("leaves Needs info once the city is typed and the sale price is entered by hand", async () => {
    const user = newUser();
    const { harness, deal } = await newDealSetup((inputs) => {
      inputs.overrides = { basePriceCents: 90_000_000, baseDomDays: 60 };
    });
    await openLot(harness, deal);
    expect(await screen.findByText("Needs info")).toBeVisible();

    await user.type(screen.getByLabelText("City"), "Layton");
    await advance(200);

    expect(screen.queryByText("Needs info")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs:")).not.toBeInTheDocument();
    expect(screen.getByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
  });

  it("shows dashes for the figures that need a price, and the land total from the lot", async () => {
    const { harness, deal } = await newDealSetup();
    await openLot(harness, deal);

    const panel = card("Lot so far");
    expect(within(panel).getByText("Land + closing").nextElementSibling).toHaveTextContent("$0");
    expect(within(panel).getByText("Share of total project cost").nextElementSibling).toHaveTextContent("—");
    expect(within(panel).getByText("Share of base sale price").nextElementSibling).toHaveTextContent("—");
    const goPrice = within(panel).getByText("Price that makes this a Go").nextElementSibling;
    expect(goPrice).toHaveTextContent("—");
    expect(goPrice).not.toHaveClass("text-go");
  });
});

describe("the side panel", () => {
  it("shows the land total, its shares of cost and of the sale price, and the lot price that makes it a Go", async () => {
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    const evaluation = evaluateDeal(deal.inputs, await contextFor({ repository: harness.repository }));
    const summary = summarize(evaluation);
    const land = 29_500_000 + 400_000;
    const panel = card("Lot so far");
    const row = (label: string) => within(panel).getByText(label).nextElementSibling;

    expect(row("Land + closing")).toHaveTextContent("$299,000");
    const costShare = `${((land / (summary.totalProjectCostCents as number)) * 100).toFixed(1)}%`;
    const saleShare = `${((land / (summary.salePriceCents as number)) * 100).toFixed(1)}%`;
    expect(row("Share of total project cost")).toHaveTextContent(costShare);
    expect(row("Share of base sale price")).toHaveTextContent(saleShare);
    expect(evaluation.verdict.kind).toBe("marginal");
    expect(row("Price that makes this a Go")).toHaveTextContent("$227,100 (−$67,900)");
    // The price to aim for is shown in the Go color, as on the mockup.
    expect(row("Price that makes this a Go")).toHaveClass("text-go");
    expect(row("Land + closing")).not.toHaveClass("text-go");
  });

  it("says Already a Go when the verdict is a go", async () => {
    const user = newUser();
    const { harness, deal } = await sampleSetup();
    await openLot(harness, deal);

    await typeOver(user, "Lot price", "1");
    await advance(200);
    expect(screen.getByText(/^Go$/)).toBeVisible();
    const goPrice = within(card("Lot so far")).getByText("Price that makes this a Go").nextElementSibling;
    expect(goPrice).toHaveTextContent("Already a Go");
    expect(goPrice).toHaveClass("text-go");
  });

  it("says when the lot price alone cannot make it a Go", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const inputs = structuredClone(sample.inputs);
    inputs.overrides.basePriceCents = 50_000_000;
    const deal = await harness.repository.createDeal({ name: "Low price", inputs });
    await openLot(harness, deal);

    expect(await screen.findByText("No-go")).toBeVisible();
    const goPrice = within(card("Lot so far")).getByText("Price that makes this a Go").nextElementSibling;
    expect(goPrice).toHaveTextContent("Not reachable with lot price alone");
    // Not good news, so not in the Go color.
    expect(goPrice).not.toHaveClass("text-go");
  });

  it("shows dashes, not NaN, for a stored deal whose lot price is a fraction of a cent", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const inputs = structuredClone(sample.inputs);
    inputs.lot.priceCents = 100.5;
    const deal = await harness.repository.createDeal({ name: "Fraction", inputs });
    await openLot(harness, deal);

    const panel = card("Lot so far");
    expect(within(panel).getByText("Land + closing").nextElementSibling).toHaveTextContent("—");
    expect(within(panel).getByText("Share of total project cost").nextElementSibling).toHaveTextContent("—");
    expect(within(panel).getByText("Share of base sale price").nextElementSibling).toHaveTextContent("—");
    expect(panel.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("messages from the engine", () => {
  it("shows each problem under its own field", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const inputs = structuredClone(sample.inputs);
    inputs.lot.county = "";
    inputs.lot.acres = -1;
    inputs.lot.priceCents = 20_000_000_000;
    inputs.lot.closingCents = -5;
    inputs.lot.hoaMonthlyCents = 1.5;
    inputs.lot.propertyTaxRate = 1.5;
    inputs.lot.frontageFt = -3;
    inputs.timeline.landClose = "2026-13";
    inputs.timeline.preConMonths = 2.5;
    inputs.timeline.closingDays = 200;
    const deal = await harness.repository.createDeal({ name: "Problems", inputs });
    await openLot(harness, deal);

    /** The field is marked invalid and points at a message with this text. */
    const under = (label: string, message: RegExp | string) => {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("aria-invalid", "true");
      const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
      const texts = ids.map((id) => document.getElementById(id)?.textContent ?? "");
      expect(texts.some((text) => (typeof message === "string" ? text === message : message.test(text)))).toBe(true);
    };
    under("County", "Required");
    under("Acres", "Must be 0 or more");
    under("Frontage", "Must be 0 or more");
    under("Lot price", "Must be $100,000,000 or less");
    under("Closing costs", "Must be 0 or more");
    under("HOA $/month", "Must be a whole number of cents");
    under("Property tax rate %", /Must be 1 or less/);
    under("Land closes", "Must be a month as YYYY-MM");
    under("Design & permits months", "Must be a whole number of months");
    under("Closing days after contract", "Must be 180 or less");
    expect(screen.getByLabelText("City")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Build months")).not.toHaveAttribute("aria-invalid");
  });

  it("shows the rule that links the listing months to the build under the months box", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const inputs = structuredClone(sample.inputs);
    inputs.timeline.buildMonths = 9;
    inputs.timeline.listEarlyMonths = 10;
    const deal = await harness.repository.createDeal({ name: "Too early", inputs });
    await openLot(harness, deal);

    const months = screen.getByLabelText("Months before completion");
    expect(months).toHaveAttribute("aria-invalid", "true");
    const message = within(card("Timeline")).getByText("Cannot list earlier than the build is long");
    expect(months.getAttribute("aria-describedby")).toContain(message.id);
  });
});

/**
 * The choice controls have no box of their own for a message, and no value that breaks a rule the owner can fix gets
 * past the data layer for most of them (an unknown utility, a loan kind that is neither, a region other than the one
 * offered are all refused). So these tests give the page an evaluation that reports the problem, to see where it is shown.
 */
describe("messages under the choice controls", () => {
  async function renderWith(validation: ValidationIssue[], change: (inputs: DealInputs) => void = () => {}) {
    const inputs = sampleDealInputs();
    change(inputs);
    const evaluation = { ...(await evaluated(inputs)), validation };
    const now = new Date().toISOString();
    const editor: DealEditor = {
      status: "ready",
      deal: { id: "deal-1", name: "Fake", status: "analyzing", inputs, createdAt: now, updatedAt: now },
      inputs,
      evaluation,
      context: await contextFor(),
      edit: vi.fn(),
      rename: () => true,
      undo: vi.fn(),
      redo: vi.fn(),
      discardChanges: vi.fn(),
      saveNow: vi.fn(),
      canUndo: false,
      canRedo: false,
      saveStatus: { kind: "saved" },
    };
    render(
      <MemoryRouter>
        <DealEditorContext.Provider value={editor}>
          <LotPage />
        </DealEditorContext.Provider>
      </MemoryRouter>,
    );
  }

  it("shows a region problem under the region control and ties it to the group", async () => {
    await renderWith([{ path: "lot.region", message: "Region is not offered" }]);
    expect(group("Region")).toHaveAccessibleDescription("Region is not offered");
    expect(screen.getByText("Region is not offered")).toHaveClass("text-no-go");
  });

  it("shows a utility problem under that utility only", async () => {
    await renderWith([{ path: "lot.utilities.sewer", message: "Pick an answer" }]);
    expect(screen.getAllByText("Pick an answer")).toHaveLength(1);
    expect(group("Sewer")).toHaveAccessibleDescription("Pick an answer");
    for (const other of ["Water", "Gas", "Power", "Secondary water"]) {
      expect(group(other)).not.toHaveAttribute("aria-describedby");
    }
  });

  it("shows a problem with how the land is paid for under the control while no loan box is there", async () => {
    await renderWith([{ path: "lot.financing", message: "Choose cash or a loan" }]);
    expect(group("Pay for land with")).toHaveAccessibleDescription("Choose cash or a loan");
  });

  it("leaves a loan's problem to the loan's own box, not repeated under the control", async () => {
    await renderWith([{ path: "lot.financing.ltv", message: "Too high" }], (inputs) => {
      inputs.lot.financing = { kind: "loan", ltv: 1.5, rate: 0.1, points: 0.01 };
    });
    expect(screen.getAllByText("Too high")).toHaveLength(1);
    expect(screen.getByLabelText("LTV %")).toHaveAccessibleDescription("Too high");
    expect(group("Pay for land with")).not.toHaveAttribute("aria-describedby");
  });

  it("shows a listing problem under the control while no months box is there", async () => {
    await renderWith([{ path: "timeline.listEarlyMonths", message: "Cannot list early" }]);
    expect(group("List for sale")).toHaveAccessibleDescription("Cannot list early");
  });

  it("leaves a listing problem to the months box when it is there, not repeated under the control", async () => {
    await renderWith([{ path: "timeline.listEarlyMonths", message: "Cannot list early" }], (inputs) => {
      inputs.timeline.listEarlyMonths = 12;
    });
    expect(screen.getAllByText("Cannot list early")).toHaveLength(1);
    expect(screen.getByLabelText("Months before completion")).toHaveAccessibleDescription(/Cannot list early/);
    expect(group("List for sale")).not.toHaveAttribute("aria-describedby");
  });
});
