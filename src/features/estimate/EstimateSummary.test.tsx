import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sampleDealInputs } from "../../data/sample";
import { formatMoney, formatPercent } from "../../lib/format";
import { advance, installFakeClock, newUser, pasteOver, savedAfterAutosave } from "../../testing/editorTiming";
import { costTable, estimateOf, openEstimate, region, sampleSetup, setupEveryLineBid } from "./estimateTestUtils";

installFakeClock();

describe("Build estimate card", () => {
  it("shows the total, the cost per finished sf and the subtotal from the estimate", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    const card = region("Build estimate");
    expect(within(card).getByText(formatMoney(estimate.totalCents))).toBeVisible();
    expect(within(card).getByText(`${formatMoney(estimate.costPerFinishedSfCents)} per finished sf · Upgraded finishes`)).toBeVisible();
    expect(card).toHaveTextContent(`Subtotal${formatMoney(estimate.subtotalCents)}`);
  });

  it("holds the contingency rate in a percent box, with the amount beside it", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    const card = region("Build estimate");
    expect(within(card).getByLabelText("Contingency")).toHaveValue("5.00");
    expect(within(card).getByText(formatMoney(estimate.contingencyCents))).toBeVisible();
  });

  it("sets the footer's contingency to 10% of the subtotal when the rate is set to 10", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const user = newUser();

    await pasteOver(user, "Contingency", "10", region("Build estimate"));
    await advance(200);

    const withTen = sampleDealInputs();
    withTen.contingencyPct = 0.1;
    const estimate = await estimateOf(withTen);
    expect(estimate.contingencyCents).toBe(Math.round(estimate.subtotalCents / 10));
    const footer = within(costTable()).getByRole("rowheader", { name: "Contingency" }).closest("tr");
    expect(footer).toHaveTextContent("10%");
    expect(footer).toHaveTextContent(formatMoney(estimate.contingencyCents));
    const total = within(costTable()).getByRole("rowheader", { name: "Build estimate" }).closest("tr");
    expect(total).toHaveTextContent(formatMoney(estimate.totalCents));
    expect(within(region("Build estimate")).getByText(formatMoney(estimate.totalCents))).toBeVisible();

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.contingencyPct).toBe(0.1);
  });

  it("does not take a rate above 100%, and says why", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);

    await pasteOver(newUser(), "Contingency", "150", region("Build estimate"));
    await advance(200);

    expect(within(region("Build estimate")).getByText("Must be between 0% and 100%")).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("How solid is this number", () => {
  it("shows the share backed by bids, a bar of the three shares and the three amounts", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const { confidence } = await estimateOf();

    const card = region("How solid is this number?");
    expect(card).toHaveTextContent(`${formatPercent(confidence.bidShare, 0)} backed by real bids`);
    expect(
      within(card).getByRole("img", {
        name: `${formatPercent(confidence.bidShare, 0)} bids, ${formatPercent(confidence.priceBookShare, 0)} your price book, ${formatPercent(confidence.defaultShare, 0)} starter defaults`,
      }),
    ).toBeVisible();
    const amounts = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(amounts).toEqual([
      `Bids for this job${formatMoney(confidence.bidCents)}`,
      `Your price book${formatMoney(confidence.priceBookCents)}`,
      `Starter defaults${formatMoney(confidence.defaultCents)}`,
    ]);
  });
});

describe("Get bids here next", () => {
  it("lists the lines the estimate says to bid first, with their totals", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const estimate = await estimateOf();

    const card = region("Get bids here next");
    const items = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    const expected = estimate.bidsNext.codes.map((code) => {
      const line = estimate.lines.find((l) => l.code === code);
      return `${line?.name}${formatMoney(line?.totalCents)}`;
    });
    expect(expected).toHaveLength(4);
    expect(items).toEqual(expected);
  });

  it("says how far bidding them cuts the default share", async () => {
    const { harness, deal } = await sampleSetup();
    await openEstimate(harness, deal);
    const { confidence, bidsNext } = await estimateOf();

    const sentence = `Bidding these cuts defaults from ${formatPercent(confidence.defaultShare, 0)} to ${formatPercent(bidsNext.defaultShareAfter, 0)}.`;
    expect(within(region("Get bids here next")).getByText(sentence)).toBeVisible();
  });

  it("has nothing to say once no line is on a default", async () => {
    const { harness, deal } = await setupEveryLineBid();
    await openEstimate(harness, deal);

    const card = region("Get bids here next");
    expect(within(card).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Bidding these cuts defaults/)).not.toBeInTheDocument();
    expect(within(card).getByText("No line is still on a starter default.")).toBeVisible();
  });
});
