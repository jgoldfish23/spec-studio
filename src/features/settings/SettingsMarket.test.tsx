import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import { card, MARKET_CARD, newUser, openSettings, pasteOver, saveButton } from "./settingsTestUtils";

beforeEach(() => {
  window.location.hash = "";
});

const market = () => within(card(MARKET_CARD));

describe("Market settings — Northern Utah (Davis & Weber)", () => {
  it("shows the saved values in human units", async () => {
    await openSettings();
    const form = market();
    expect(form.getByLabelText("Default property tax rate")).toHaveValue("0.48");
    expect(form.getByLabelText("Basement value factor")).toHaveValue("0.6");
    expect(form.getByLabelText("Price elasticity")).toHaveValue("3");
    expect(form.getByLabelText("Include comps scoring at least")).toHaveValue("75");
    expect(form.getByLabelText("Assumed days from contract to close")).toHaveValue("35");
    expect(form.getByLabelText("Garage bay")).toHaveValue("12,000");
    expect(form.getByLabelText("Walkout")).toHaveValue("9,000");
    expect(form.getByLabelText("Lot per acre")).toHaveValue("60,000");
    expect(form.getByLabelText("ADU")).toHaveValue("35,000");
    expect(form.getByLabelText("Pool")).toHaveValue("25,000");
    const condition = form.getByRole("group", { name: "Market condition" });
    expect(
      within(condition)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Hot", "Normal", "Slow"]);
    expect(within(condition).getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    const months = form.getByRole("group", { name: "Seasonal factors" });
    expect(within(months).getAllByRole("textbox")).toHaveLength(12);
    expect(within(months).getByLabelText("January")).toHaveValue("1.2");
    expect(within(months).getByLabelText("December")).toHaveValue("1.2");
    expect(form.getByText("1.00 is an average month")).toBeVisible();
  });

  it("stores every edit, as cents, fractions and the same twelve factors", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(MARKET_CARD);
    await pasteOver(user, form, "Default property tax rate", "0.55");
    await pasteOver(user, form, "Basement value factor", "0.5");
    await pasteOver(user, form, "Price elasticity", "2.5");
    await pasteOver(user, form, "Include comps scoring at least", "80");
    await pasteOver(user, form, "Assumed days from contract to close", "40");
    await pasteOver(user, form, "Garage bay", "13,000");
    await pasteOver(user, form, "Pool", "30000");
    await pasteOver(user, form, "March", "1.5");
    await user.click(within(within(form).getByRole("group", { name: "Market condition" })).getByRole("button", { name: "Hot" }));
    await user.click(saveButton(form));

    expect(await within(form).findByText("Saved")).toBeVisible();
    const stored = await harness.repository.getMarketSettings("utah-north");
    expect(stored).toEqual({
      ...DEFAULT_MARKET_SETTINGS,
      defaultTaxRate: 0.0055,
      basementFactor: 0.5,
      elasticity: 2.5,
      includeThreshold: 80,
      assumedClosingDays: 40,
      featureValues: {
        ...DEFAULT_MARKET_SETTINGS.featureValues,
        garageBayCents: 1_300_000,
        poolCents: 3_000_000,
      },
      seasonalFactors: DEFAULT_MARKET_SETTINGS.seasonalFactors.map((f, i) => (i === 2 ? 1.5 : f)),
      marketCondition: "hot",
    });
  });

  it("says what the weights add up to when they do not total 100, and blocks Save", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(MARKET_CARD);
    const weights = within(form).getByRole("group", {
      name: /Similarity weights/,
    });
    await pasteOver(user, weights, "Location", "20");
    expect(await within(form).findByText("Weights must add up to 100 — now 95")).toBeVisible();
    expect(saveButton(form)).toBeDisabled();
    await pasteOver(user, weights, "Size", "30");
    expect(within(form).queryByText(/Weights must add up to 100/)).not.toBeInTheDocument();
    expect(saveButton(form)).toBeEnabled();
    await user.click(saveButton(form));
    await within(form).findByText("Saved");
    expect((await harness.repository.getMarketSettings("utah-north")).similarityWeights).toEqual({
      location: 20,
      size: 30,
      age: 15,
      recency: 20,
      features: 15,
    });
  });

  it("shows the schema's message for an out-of-range value and blocks Save", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(MARKET_CARD);
    await pasteOver(user, form, "Basement value factor", "2");
    expect(await within(form).findByText("Must be 1 or less")).toBeVisible();
    expect(saveButton(form)).toBeDisabled();
    await pasteOver(user, form, "Basement value factor", "0.6");
    await pasteOver(user, form, "Include comps scoring at least", "120");
    expect(await within(form).findByText("Must be 100 or less")).toBeVisible();
    await pasteOver(user, form, "Include comps scoring at least", "75");
    await pasteOver(user, form, "Assumed days from contract to close", "20.5");
    expect(await within(form).findByText("Must be a whole number")).toBeVisible();
    await pasteOver(user, form, "Assumed days from contract to close", "35");
    await pasteOver(user, within(form).getByRole("group", { name: "Seasonal factors" }), "July", "0");
    expect(await within(form).findByText("Must be above 0")).toBeVisible();
    expect(saveButton(form)).toBeDisabled();
    expect(await harness.repository.getMarketSettings("utah-north")).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("shows a failed save's message and stays unsaved", async () => {
    const harness = createHarness();
    harness.repository.saveMarketSettings = () => Promise.reject(new Error("Couldn't reach the server."));
    await openSettings(harness);
    const user = newUser();
    const form = card(MARKET_CARD);
    await pasteOver(user, form, "Price elasticity", "4");
    await user.click(saveButton(form));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    expect(within(form).queryByText("Saved")).not.toBeInTheDocument();
  });

  it("changes what an open deal's evaluation shows, once saved", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/market`, harness);
    const days = () => screen.getByRole("region", { name: "Days on market" });
    const typical = async () =>
      (await within(await screen.findByRole("region", { name: "Days on market" })).findByText(/^Typical:/)).textContent;
    const before = await typical();
    const listing = /listing in (\w+) \d{4}/.exec(days().textContent ?? "");
    const month = listing?.[1];
    expect(month).toBeDefined();

    const user = newUser();
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Settings" }));
    const form = await screen.findByRole("region", { name: MARKET_CARD });
    const current = Number((within(form).getByLabelText(month!) as HTMLInputElement).value);
    await pasteOver(user, form, month!, String(current * 2));
    await user.click(saveButton(form));
    await within(form).findByText("Saved");

    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Deals" }));
    await user.click(await screen.findByRole("link", { name: /Sample/ }));
    await user.click(await screen.findByRole("link", { name: /Market/ }));
    await waitFor(async () => expect(await typical()).not.toBe(before));
  });
});
