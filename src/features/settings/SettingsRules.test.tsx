import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { createHarness } from "../../testing/renderApp";
import { card, newUser, openSettings, pasteOver, RULES_CARD, saveButton } from "./settingsTestUtils";

beforeEach(() => {
  window.location.hash = "";
});

describe("Go/no-go rules for new deals", () => {
  it("shows the company's rules and contingency in human units", async () => {
    await openSettings();
    const rules = within(card(RULES_CARD));
    expect(rules.getByLabelText("Minimum margin on sale price")).toHaveValue("15.00");
    expect(rules.getByLabelText("Minimum annualized return on cash")).toHaveValue("25.00");
    expect(rules.getByLabelText("Minimum downside case profit")).toHaveValue("0");
    expect(rules.getByLabelText("Contingency for new deals")).toHaveValue("5.00");
    expect(saveButton(card(RULES_CARD))).toBeEnabled();
  });

  it("stores edits as fractions and integer cents, and says Saved", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Minimum margin on sale price", "18");
    await pasteOver(user, form, "Minimum annualized return on cash", "30.5");
    await pasteOver(user, form, "Minimum downside case profit", "50,000");
    await pasteOver(user, form, "Contingency for new deals", "7");
    expect(within(form).queryByText("Saved")).not.toBeInTheDocument();
    await user.click(saveButton(form));

    expect(await within(form).findByText("Saved")).toBeVisible();
    expect(within(form).getByRole("status")).toHaveTextContent("Saved");
    expect(await harness.repository.getCompanySettings()).toEqual({
      rules: {
        minMarginOnSale: 0.18,
        minAnnualizedReturn: 0.305,
        minDownsideProfitCents: 5_000_000,
      },
      contingencyPct: 0.07,
    });
  });

  it("starts a deal from the saved rules and contingency", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Minimum margin on sale price", "20");
    await pasteOver(user, form, "Contingency for new deals", "8");
    await user.click(saveButton(form));
    await within(form).findByText("Saved");

    // Saved, so leaving is not blocked.
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Deals" }));
    await user.click(await screen.findByRole("button", { name: "New deal" }));
    await waitFor(async () => expect((await harness.repository.listDeals()).deals).toHaveLength(1));
    const { inputs } = (await harness.repository.listDeals()).deals[0]!;
    expect(inputs.rules.minMarginOnSale).toBe(0.2);
    expect(inputs.contingencyPct).toBe(0.08);
  });

  it("shows the schema's message for a value out of range and blocks Save", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Minimum margin on sale price", "150");
    expect(await within(form).findByText("Must be 1 or less (use a decimal, e.g. 0.09 for 9%)")).toBeVisible();
    expect(within(form).getByLabelText("Minimum margin on sale price")).toHaveAttribute("aria-invalid", "true");
    expect(saveButton(form)).toBeDisabled();

    await pasteOver(user, form, "Minimum margin on sale price", "-2");
    expect(await within(form).findByText("Must be 0 or more")).toBeVisible();
    expect(saveButton(form)).toBeDisabled();
    expect((await harness.repository.getCompanySettings()).rules.minMarginOnSale).toBe(0.15);

    await pasteOver(user, form, "Minimum margin on sale price", "12");
    expect(saveButton(form)).toBeEnabled();
  });

  it("shows a failed save's message and stays unsaved", async () => {
    const harness = createHarness();
    harness.repository.saveCompanySettings = () =>
      Promise.reject(new Error("You're offline. Try again when you have a connection."));
    await openSettings(harness);
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Contingency for new deals", "9");
    await user.click(saveButton(form));
    expect(await within(form).findByRole("alert")).toHaveTextContent("You're offline. Try again when you have a connection.");
    expect(within(form).queryByText("Saved")).not.toBeInTheDocument();
    expect(saveButton(form)).toBeEnabled();
  });
});
