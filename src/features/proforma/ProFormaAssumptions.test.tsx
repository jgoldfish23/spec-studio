import { within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { advance, installFakeClock, newUser, pasteOver, savedAfterAutosave } from "../../testing/editorTiming";
import { harnessOver, sampleSetup, setupWith } from "../../testing/stepHarness";
import { card, openProForma } from "./proformaTestUtils";

installFakeClock();

const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

describe("the Financing card", () => {
  it("shows the loan in its boxes and the interest choice, with Paid monthly chosen for the sample", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const financing = within(card("Financing"));
    expect(financing.getByLabelText("Loan-to-cost %")).toHaveValue("80.00");
    expect(financing.getByLabelText("Rate %")).toHaveValue("9.00");
    expect(financing.getByLabelText("Points %")).toHaveValue("1.00");
    expect(financing.getByLabelText("Draw fee $")).toHaveValue("200");
    expect(financing.getByLabelText("Term months")).toHaveValue("12");
    expect(financing.getByLabelText("Extension fee %")).toHaveValue("0.50");
    expect(financing.getByLabelText("Extension length months")).toHaveValue("3");
    const interest = financing.getByRole("group", { name: "Interest" });
    expect(within(interest).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Paid monthly",
      "Rolled into the loan",
    ]);
    expect(pressed(interest)).toEqual(["Paid monthly"]);
  });

  it("stores each loan field, one at a time, as the engine reads it", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();

    const typed: [string, string][] = [
      ["Loan-to-cost %", "75"],
      ["Rate %", "10.5"],
      ["Points %", "1.5"],
      ["Draw fee $", "250"],
      ["Term months", "15"],
      ["Extension fee %", "0.75"],
      ["Extension length months", "2"],
    ];
    for (const [label, text] of typed) await pasteOver(user, label, text, card("Financing"));
    await advance(200);

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.loan).toEqual({
      ltc: 0.75,
      rate: 0.105,
      points: 0.015,
      drawFeeCents: 25_000,
      termMonths: 15,
      extensionPct: 0.0075,
      extensionMonths: 2,
      interestMode: "paid",
    });
  });

  it("stores interestMode capitalized for Rolled into the loan, and paid again for Paid monthly", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();
    const interest = () => within(card("Financing")).getByRole("group", { name: "Interest" });

    await user.click(within(interest()).getByRole("button", { name: "Rolled into the loan" }));
    expect(pressed(interest())).toEqual(["Rolled into the loan"]);
    expect((await savedAfterAutosave(harness, deal)).loan.interestMode).toBe("capitalized");

    await user.click(within(interest()).getByRole("button", { name: "Paid monthly" }));
    expect(pressed(interest())).toEqual(["Paid monthly"]);
    expect((await savedAfterAutosave(harness, deal)).loan.interestMode).toBe("paid");
  });

  it("leaves everything else in the deal alone", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    await pasteOver(newUser(), "Rate %", "12", card("Financing"));
    const stored = await savedAfterAutosave(harness, deal);

    expect(stored).toEqual({ ...deal.inputs, loan: { ...deal.inputs.loan, rate: 0.12 } });
  });

  it("refuses a loan-to-cost above 95% and a term of zero months, with the range in the message", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();

    await pasteOver(user, "Loan-to-cost %", "96", card("Financing"));
    expect(within(card("Financing")).getByLabelText("Loan-to-cost %")).toHaveAttribute("aria-invalid", "true");
    expect(within(card("Financing")).getByText("Must be between 0% and 95%")).toBeVisible();
    await pasteOver(user, "Term months", "0", card("Financing"));
    expect(within(card("Financing")).getByText("Must be between 1 and 60")).toBeVisible();
    await advance(1200);
    const stored = await harness.repository.getDeal(deal.id);
    expect(stored?.inputs.loan.ltc).toBe(0.8);
    expect(stored?.inputs.loan.termMonths).toBe(12);
  });

  it("asks for whole months in the two month boxes", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    for (const label of ["Term months", "Extension length months"]) {
      const box = within(card("Financing")).getByLabelText(label);
      const hint = (box.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
      expect(hint).toContain("Whole months");
    }
  });

  it("shows the engine's message for a stored loan it rejects", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.loan.termMonths = 70;
      inputs.loan.extensionMonths = 0;
    });
    await openProForma(harness, deal);

    const term = within(card("Financing")).getByLabelText("Term months");
    expect(term).toHaveAttribute("aria-invalid", "true");
    expect(within(card("Financing")).getByText("Must be 60 or less")).toBeVisible();
    expect(within(card("Financing")).getByLabelText("Extension length months")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("the Selling card", () => {
  it("shows the four selling costs", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const selling = within(card("Selling"));
    expect(selling.getByLabelText("Listing agent %")).toHaveValue("2.50");
    expect(selling.getByLabelText("Buyer's agent %")).toHaveValue("2.50");
    expect(selling.getByLabelText("Closing & title %")).toHaveValue("1.00");
    expect(selling.getByLabelText("Rate buydown / concessions $")).toHaveValue("15,000");
  });

  it("stores each as the engine reads it", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();

    await pasteOver(user, "Listing agent %", "3", card("Selling"));
    await pasteOver(user, "Buyer's agent %", "2", card("Selling"));
    await pasteOver(user, "Closing & title %", "1.25", card("Selling"));
    await pasteOver(user, "Rate buydown / concessions $", "20,000", card("Selling"));

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.selling).toEqual({ listingPct: 0.03, buyerPct: 0.02, closingPct: 0.0125, concessionsCents: 2_000_000 });
  });

  it("moves the margin when the commission changes", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const margin = () => within(card("Scenarios")).getByText("Margin on sale").closest("dl")?.querySelector("dd")?.textContent;
    const before = margin();

    await pasteOver(newUser(), "Listing agent %", "4", card("Selling"));
    await advance(200);

    expect(margin()).not.toBe(before);
  });

  it("shows the engine's message about the total once the three rates reach 100%", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.selling.listingPct = 0.5;
      inputs.selling.buyerPct = 0.4;
      inputs.selling.closingPct = 0.1;
    });
    await openProForma(harness, deal);

    const message = "Listing, buyer and closing costs must total less than 100% of the sale price";
    expect(within(card("Selling")).getAllByText(message)).toHaveLength(1);
  });
});

describe("the Carrying card", () => {
  it("shows the five carrying costs", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const carrying = within(card("Carrying"));
    expect(carrying.getByLabelText("Builder's risk %/yr")).toHaveValue("0.35");
    expect(carrying.getByLabelText("Utilities during build $/mo")).toHaveValue("150");
    expect(carrying.getByLabelText("Utilities after completion $/mo")).toHaveValue("250");
    expect(carrying.getByLabelText("Staging $/mo")).toHaveValue("500");
    expect(carrying.getByLabelText("Upkeep $/mo")).toHaveValue("100");
  });

  it("stores each as the engine reads it", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();

    await pasteOver(user, "Builder's risk %/yr", "0.5", card("Carrying"));
    await pasteOver(user, "Utilities during build $/mo", "200", card("Carrying"));
    await pasteOver(user, "Utilities after completion $/mo", "300", card("Carrying"));
    await pasteOver(user, "Staging $/mo", "600", card("Carrying"));
    await pasteOver(user, "Upkeep $/mo", "150", card("Carrying"));

    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.carry).toEqual({
      insuranceRate: 0.005,
      utilitiesBuildMonthlyCents: 20_000,
      utilitiesAfterMonthlyCents: 30_000,
      stagingMonthlyCents: 60_000,
      upkeepMonthlyCents: 15_000,
    });
  });

  it("refuses a negative cost", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    await pasteOver(newUser(), "Staging $/mo", "-5", card("Carrying"));
    expect(within(card("Carrying")).getByLabelText("Staging $/mo")).toHaveAttribute("aria-invalid", "true");
    await advance(1200);
    expect((await harness.repository.getDeal(deal.id))?.inputs.carry.stagingMonthlyCents).toBe(50_000);
  });
});

describe("the Your rules card", () => {
  it("shows the three rules in editable boxes, with no note about Settings later", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const rules = within(card("Your rules"));
    expect(rules.getByLabelText("Minimum margin on sale %")).toHaveValue("15.00");
    expect(rules.getByLabelText("Minimum annualized return %")).toHaveValue("25.00");
    expect(rules.getByLabelText("Minimum downside profit $")).toHaveValue("0");
    expect(rules.queryByText("Edit in Settings (later).")).not.toBeInTheDocument();
    expect(rules.getByRole("button", { name: "Use company rules" })).toBeEnabled();
  });

  it("shows the rules the deal holds", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.rules = { minMarginOnSale: 0.2, minAnnualizedReturn: 0.3, minDownsideProfitCents: 5_000_000 };
    });
    await openProForma(harness, deal);

    const rules = within(card("Your rules"));
    expect(rules.getByLabelText("Minimum margin on sale %")).toHaveValue("20.00");
    expect(rules.getByLabelText("Minimum annualized return %")).toHaveValue("30.00");
    expect(rules.getByLabelText("Minimum downside profit $")).toHaveValue("50,000");
    expect(within(card("Verdict")).getByText("Margin 9.9% — your rule is 20.0% or better")).toBeVisible();
  });

  it("autosaves an edited rule as a fraction or integer cents, like every other input", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    const user = newUser();

    await pasteOver(user, "Minimum margin on sale %", "12.5", card("Your rules"));
    await pasteOver(user, "Minimum annualized return %", "30", card("Your rules"));
    await pasteOver(user, "Minimum downside profit $", "25,000", card("Your rules"));
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.rules).toEqual({ minMarginOnSale: 0.125, minAnnualizedReturn: 0.3, minDownsideProfitCents: 2_500_000 });
    // The verdict reads the new rule.
    expect(within(card("Verdict")).getByText("Margin 9.9% — your rule is 12.5% or better")).toBeVisible();
  });

  it("shows the engine's message for a rule out of range, and does not save it", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    await pasteOver(newUser(), "Minimum margin on sale %", "150", card("Your rules"));
    expect(within(card("Your rules")).getByLabelText("Minimum margin on sale %")).toHaveAttribute("aria-invalid", "true");
    await advance(1200);
    expect((await harness.repository.getDeal(deal.id))?.inputs.rules.minMarginOnSale).toBe(0.15);
  });

  it("copies the company's rules into the deal with Use company rules", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.rules = { minMarginOnSale: 0.2, minAnnualizedReturn: 0.3, minDownsideProfitCents: 5_000_000 };
    });
    await harness.repository.saveCompanySettings({
      rules: { minMarginOnSale: 0.1, minAnnualizedReturn: 0.18, minDownsideProfitCents: 100_000 },
      contingencyPct: 0.06,
    });
    await openProForma(harness, deal);
    const user = newUser();

    await user.click(within(card("Your rules")).getByRole("button", { name: "Use company rules" }));
    const rules = within(card("Your rules"));
    expect(rules.getByLabelText("Minimum margin on sale %")).toHaveValue("10.00");
    expect(rules.getByLabelText("Minimum annualized return %")).toHaveValue("18.00");
    expect(rules.getByLabelText("Minimum downside profit $")).toHaveValue("1,000");
    const stored = await savedAfterAutosave(harness, deal);
    expect(stored.rules).toEqual({ minMarginOnSale: 0.1, minAnnualizedReturn: 0.18, minDownsideProfitCents: 100_000 });
    // Only the rules: the deal's contingency is its own.
    expect(stored.contingencyPct).toBe(deal.inputs.contingencyPct);
  });

  it("holds Use company rules back until the company's settings have loaded", async () => {
    const { harness, deal } = await sampleSetup();
    const pending = new Promise<never>(() => {});
    const slow = { ...harness.repository, getCompanySettings: () => pending };
    await openProForma(harnessOver(harness, slow), deal);
    expect(within(card("Your rules")).getByRole("button", { name: "Use company rules" })).toBeDisabled();
  });
});
