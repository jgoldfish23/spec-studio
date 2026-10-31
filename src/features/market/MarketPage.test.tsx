import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Comp } from "@engine";
import { sampleComps } from "../../data/sample";
import { formatDayRange, formatMoney } from "../../lib/format";
import { advance, installFakeClock, newUser, pasteOver, savedAfterAutosave } from "../../testing/editorTiming";
import { card, openMarket, sampleDom, samplePrice, sampleSetup, setupWith, summaryTile } from "./marketTestUtils";

installFakeClock();

describe("Market page layout", () => {
  it("draws the cards in the mockup's order, under a page heading", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    expect(screen.getByRole("heading", { level: 1, name: "Market" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Your numbers (optional)", "Sale price estimate", "Days on market", "Comps"]);
  });

  it("says the market condition is Normal for now, and where it will be changed", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    expect(
      screen.getByText("Market condition: Normal · seasonality and condition settings arrive with Settings (later)."),
    ).toBeVisible();
  });

  it("ends with a link to the pro forma", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    expect(screen.getByRole("link", { name: "Next: see the pro forma →" })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/proforma`,
    );
  });
});

describe("sale price estimate", () => {
  it("shows three dollar values, the engine's low, mid and high", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const price = await samplePrice();

    const estimate = card("Sale price estimate");
    const values = ["Low · downside", "Mid · base", "High · upside"].map(
      (label) => within(estimate).getByText(label).closest("dl")?.textContent ?? "",
    );
    expect(values).toEqual([
      `Low · downside${formatMoney(price.lowCents)}`,
      `Mid · base${formatMoney(price.midCents)}`,
      `High · upside${formatMoney(price.highCents)}`,
    ]);
    for (const value of values) expect(value).toMatch(/\$[\d,]{7,}$/);
    expect(price.lowCents).toBeLessThan(price.midCents);
    expect(price.midCents).toBeLessThan(price.highCents);
  });

  it("gives the price per effective sf and how many comps it rests on", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const price = await samplePrice();

    const estimate = card("Sale price estimate");
    expect(within(estimate).getByText(`${formatMoney(price.midPerEffectiveSfCents)} per effective sf`)).toBeVisible();
    expect(within(estimate).getByText(`Based on ${price.comps.length} comps`)).toBeVisible();
  });
});

describe("days on market", () => {
  it("shows the low to high range in large type, the typical days and a confidence chip", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const dom = await sampleDom();

    const days = card("Days on market");
    expect(within(days).getByText(`${formatDayRange(dom.lowDays, dom.highDays)} days`)).toBeVisible();
    expect(within(days).getByText(`Typical: ${dom.typicalDays} days`)).toBeVisible();
    expect(dom.confidence).toBe("medium");
    expect(within(days).getByText("Medium")).toBeVisible();
  });

  it("counts the comps and the recent ones, and names the month the house lists in", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const dom = await sampleDom();

    // Land closes 2027-06, plus 2 months of design and 9 of building.
    expect(
      within(card("Days on market")).getByText(
        `${dom.compCount} comps · ${dom.recentCount} sold in the last 6 months · listing in May 2028`,
      ),
    ).toBeVisible();
  });

  it("lists what drove the estimate, one row for each of the engine's factors", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const dom = await sampleDom();

    const days = card("Days on market");
    expect(within(days).getByRole("heading", { level: 3, name: "What drove it" })).toBeVisible();
    const rows = within(within(days).getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(dom.explain.map(({ label, effect }) => `${label}${effect}`));
  });

  it("draws a bar from 0 to 180 days that screen readers skip, since the words say it all", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const dom = await sampleDom();

    const bar = within(card("Days on market")).getByTestId("dom-range");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    const band = within(bar).getByTestId("dom-range-band");
    expect(parseFloat(band.style.left)).toBeCloseTo((dom.lowDays / 180) * 100, 5);
    expect(parseFloat(band.style.width)).toBeCloseTo(((dom.highDays - dom.lowDays) / 180) * 100, 5);
    expect(parseFloat(within(bar).getByTestId("dom-range-typical").style.left)).toBeGreaterThan(parseFloat(band.style.left));
    expect(bar).toHaveTextContent("180 days");
  });

  it("keeps the bar inside its track when the days run past 180", async () => {
    // A list price far over the market slows the sale well beyond half a year.
    const { harness, deal } = await setupWith((inputs) => {
      inputs.plannedListPriceCents = 500_000_000;
    });
    await openMarket(harness, deal);

    const days = card("Days on market");
    const range = within(days).getByText(/^[\d,]+–[\d,]+ days$/).textContent ?? "";
    const high = Number((range.split("–")[1] ?? "").replace(/[^\d]/g, ""));
    expect(high).toBeGreaterThan(180);
    const band = within(days).getByTestId("dom-range-band");
    expect(parseFloat(band.style.left) + parseFloat(band.style.width)).toBeLessThanOrEqual(100);
    const typical = parseFloat(within(days).getByTestId("dom-range-typical").style.left);
    expect(typical).toBeGreaterThanOrEqual(0);
    expect(typical).toBeLessThanOrEqual(100);
  });

  /** The sample deal over a library of exactly `comps`. */
  async function openWithLibrary(comps: Comp[]) {
    const { harness, deal } = await sampleSetup();
    for (const comp of await harness.repository.listComps("utah-north")) await harness.repository.deleteComp(comp.id);
    for (const comp of comps) await harness.repository.saveComp(comp);
    await openMarket(harness, deal);
  }

  it("reads High, in a neutral chip, for ten comps of which five are recent", async () => {
    // Four of the sample's comps sold within six months of the test date; three copies of each make twelve.
    const recent = ["comp-1", "comp-3", "comp-5", "comp-6"].map((id) => sampleComps().find((comp) => comp.id === id) as Comp);
    const library = [0, 1, 2].flatMap((copy) =>
      recent.map((comp, n) => ({ ...comp, id: `00000000-0000-4000-8000-0000000000${copy}${n}` })),
    );
    await openWithLibrary(library);

    const chip = within(card("Days on market")).getByText("High");
    expect(chip).toBeVisible();
    expect(chip).toHaveClass("bg-paper", "text-muted");
  });

  it("reads Medium, in a marginal chip, for the sample's eight comps", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    const chip = within(card("Days on market")).getByText("Medium");
    expect(chip).toHaveClass("bg-marginal-bg", "text-marginal");
  });

  it("reads Low, in a no-go chip, for three comps", async () => {
    await openWithLibrary(sampleComps().slice(0, 3));

    const chip = within(card("Days on market")).getByText("Low");
    expect(chip).toHaveClass("bg-no-go-bg", "text-no-go");
  });
});

describe("your numbers", () => {
  it("has three optional boxes, empty on the sample, and says what blank means", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);

    const numbers = card("Your numbers (optional)");
    expect(within(numbers).getByLabelText("Base sale price")).toHaveValue("");
    expect(within(numbers).getByLabelText("Base days on market")).toHaveValue("");
    expect(within(numbers).getByLabelText("Planned list price")).toHaveValue("");
    expect(within(numbers).getByText("Leave blank to use the market estimate below.")).toBeVisible();
  });

  it("shows the numbers a deal already holds", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides = { basePriceCents: 140_000_000, baseDomDays: 60 };
      inputs.plannedListPriceCents = 145_000_000;
    });
    await openMarket(harness, deal);

    const numbers = card("Your numbers (optional)");
    expect(within(numbers).getByLabelText("Base sale price")).toHaveValue("1,400,000");
    expect(within(numbers).getByLabelText("Base days on market")).toHaveValue("60");
    expect(within(numbers).getByLabelText("Planned list price")).toHaveValue("1,450,000");
  });

  it("makes a base sale price of 1,400,000 the summary strip's sale price, and stores it", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    expect(summaryTile("Sale price (base)")).not.toHaveTextContent("$1,400,000");

    await pasteOver(user, "Base sale price", "1,400,000", card("Your numbers (optional)"));
    await advance(200);

    expect(summaryTile("Sale price (base)")).toHaveTextContent("$1,400,000");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.overrides).toEqual({ basePriceCents: 140_000_000 });
  });

  it("leaves the market estimate alone when the base sale price is overridden", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const price = await samplePrice();

    await pasteOver(newUser(), "Base sale price", "1,400,000", card("Your numbers (optional)"));
    await advance(200);

    expect(within(card("Sale price estimate")).getByText("Mid · base").closest("dl")).toHaveTextContent(formatMoney(price.midCents));
  });

  it("removes the base sale price from the deal when its box is emptied", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides = { basePriceCents: 140_000_000 };
    });
    await openMarket(harness, deal);
    const user = newUser();
    expect(summaryTile("Sale price (base)")).toHaveTextContent("$1,400,000");

    await user.clear(within(card("Your numbers (optional)")).getByLabelText("Base sale price"));
    await advance(200);

    expect(summaryTile("Sale price (base)")).not.toHaveTextContent("$1,400,000");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.overrides).toEqual({});
    expect("basePriceCents" in stored.overrides).toBe(false);
  });

  it("stores a whole number of days for the base days on market, and removes it when emptied", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    const numbers = card("Your numbers (optional)");

    await pasteOver(user, "Base days on market", "75", numbers);
    await advance(200);
    expect((await savedAfterAutosave(harness, deal)).overrides).toEqual({ baseDomDays: 75 });

    await user.clear(within(numbers).getByLabelText("Base days on market"));
    await advance(200);
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.overrides).toEqual({});
  });

  it("refuses a fraction of a day and a figure the engine would refuse, without storing either", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    const numbers = card("Your numbers (optional)");

    await pasteOver(user, "Base days on market", "7.5", numbers);
    expect(within(numbers).getByText("Enter a number")).toBeVisible();
    await pasteOver(user, "Base days on market", "5000", numbers);
    expect(within(numbers).getByText("Must be between 0 and 1,095")).toBeVisible();
    await pasteOver(user, "Base sale price", "200,000,000", numbers);
    expect(within(numbers).getByText("Must be between $0 and $100,000,000")).toBeVisible();

    expect((await savedAfterAutosave(harness, deal)).overrides).toEqual({});
  });

  it("shows the engine's message under a stored number it refuses", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides = { baseDomDays: 2000 };
    });
    await openMarket(harness, deal);

    const numbers = card("Your numbers (optional)");
    expect(within(numbers).getByLabelText("Base days on market")).toHaveValue("2,000");
    expect(within(numbers).getByText("Must be 1095 or less")).toBeVisible();
  });

  it("stores the planned list price, removes it when emptied, and moves the days-on-market estimate", async () => {
    const { harness, deal } = await sampleSetup();
    await openMarket(harness, deal);
    const user = newUser();
    const numbers = card("Your numbers (optional)");
    expect(within(card("Days on market")).getByText("Price position (no planned list price)")).toBeVisible();

    await pasteOver(user, "Planned list price", "1,500,000", numbers);
    await advance(200);
    expect(within(card("Days on market")).getByText(/^Price position \(\d+% over mid\)$/)).toBeVisible();
    expect((await savedAfterAutosave(harness, deal)).plannedListPriceCents).toBe(150_000_000);

    await user.clear(within(numbers).getByLabelText("Planned list price"));
    await advance(200);
    const stored = await savedAfterAutosave(harness, deal);
    expect("plannedListPriceCents" in stored).toBe(false);
  });
});
