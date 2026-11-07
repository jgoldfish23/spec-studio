import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "../../testing/renderApp";
import { card, MARKET_CARD, newUser, openSettings, pasteOver, RULES_CARD, saveButton, UNSAVED } from "./settingsTestUtils";

beforeEach(() => {
  window.location.hash = "";
});

const dealsLink = () =>
  within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", {
    name: "Deals",
  });

describe("leaving Settings with unsaved edits", () => {
  it("does not ask when nothing was changed", async () => {
    await openSettings();
    await newUser().click(dealsLink());
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });

  it("asks first, and Cancel keeps the edit on the page", async () => {
    await openSettings();
    const user = newUser();
    await pasteOver(user, card(RULES_CARD), "Contingency for new deals", "9");
    await user.click(dealsLink());

    const dialog = await screen.findByRole("alertdialog", { name: UNSAVED });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    expect(within(card(RULES_CARD)).getByLabelText("Contingency for new deals")).toHaveValue("9.00");
  });

  it("leaves, and drops the edit, when the owner confirms", async () => {
    const harness = createHarness();
    await openSettings(harness);
    const user = newUser();
    await pasteOver(user, card(RULES_CARD), "Contingency for new deals", "9");
    await user.click(dealsLink());
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Leave",
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect((await harness.repository.getCompanySettings()).contingencyPct).toBe(0.05);
  });

  it("also guards edits to the market form", async () => {
    await openSettings();
    const user = newUser();
    await pasteOver(user, card(MARKET_CARD), "Price elasticity", "4");
    await user.click(dealsLink());
    expect(await screen.findByRole("alertdialog", { name: UNSAVED })).toBeVisible();
  });

  it("stops asking once the edit is saved", async () => {
    await openSettings();
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Contingency for new deals", "9");
    await user.click(saveButton(form));
    await within(form).findByText("Saved");
    await user.click(dealsLink());
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });

  it("asks again after a saved form is edited again", async () => {
    await openSettings();
    const user = newUser();
    const form = card(RULES_CARD);
    await pasteOver(user, form, "Contingency for new deals", "9");
    await user.click(saveButton(form));
    await within(form).findByText("Saved");
    await pasteOver(user, form, "Contingency for new deals", "10");
    expect(within(form).queryByText("Saved")).not.toBeInTheDocument();
    await user.click(dealsLink());
    expect(await screen.findByRole("alertdialog", { name: UNSAVED })).toBeVisible();
  });
});
