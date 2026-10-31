import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const VERDICT = /^(Go|Marginal|No-go|Needs info)$/;

/** The big figure of the build estimate on the House step's side panel. */
const buildEstimateFigure = (page: Page) => page.getByRole("region", { name: "Build estimate" }).locator("div").first();

/** Opens a step from the deal's tabs (the "Next:" links on the pages are not the tabs). */
async function openStep(page: Page, title: "Lot" | "House" | "Estimate" | "Market" | "Pro forma") {
  await page.getByRole("navigation", { name: "Deal steps" }).getByRole("link", { name: title, exact: true }).click();
}

/** The header's save status says "Saved" once the editor has written what was waiting. */
async function expectSaved(page: Page) {
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test("a deal is started from the sample, edited on three steps, saved and found again after a reload", async ({ page }) => {
  // 1. A fresh browser has no deals.
  await page.goto("/");
  await expect(page.getByText("No deals yet")).toBeVisible();

  // 2. The sample deal opens on the Pro forma step with a verdict.
  await page.getByRole("button", { name: "Load sample deal" }).click();
  await expect(page.getByRole("heading", { name: "Pro forma" })).toBeAttached();
  await expect(page.getByText(VERDICT).first()).toBeVisible();

  // 3. Luxury finishes change the build estimate.
  await openStep(page, "House");
  const estimate = buildEstimateFigure(page);
  await expect(estimate).toHaveText(/^\$/);
  const before = await estimate.innerText();
  await page.getByRole("group", { name: "Finishes" }).getByRole("button", { name: /^Luxury/ }).click();
  await expect(estimate).not.toHaveText(before);

  // 4. The first comp is left out of the estimates.
  await openStep(page, "Market");
  const comps = page.getByRole("table", { name: /^Comps/ });
  const firstComp = comps.getByRole("row").nth(1);
  const address = (await firstComp.getByRole("rowheader").locator("div").first().innerText()).trim();
  await firstComp.getByRole("button", { name: "Included" }).click();
  await expect(firstComp.getByText("Excluded")).toBeVisible();

  // 5. A $30,000 bid on Roofing.
  await openStep(page, "Estimate");
  const roofing = page.getByRole("row", { name: /Roofing/ });
  await roofing.getByRole("button", { name: "Add bid" }).click();
  const form = page.getByRole("form", { name: /Add bid for Roofing/ });
  await form.getByLabel("Vendor").fill("Acme Roofing");
  await form.getByLabel("Amount").fill("30000");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(roofing.getByText("Bid", { exact: true })).toBeVisible();

  // 6. Once the header says Saved, a reload keeps both changes.
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole("row", { name: /Roofing/ }).getByText("Bid", { exact: true })).toBeVisible();
  await openStep(page, "Market");
  const reloaded = page.getByRole("row", { name: new RegExp(address) });
  await expect(reloaded.getByText("Excluded")).toBeVisible();

  // 7. The Deals list has the one deal, with its verdict.
  await page.getByRole("link", { name: "← Deals" }).click();
  const rows = page.getByRole("table", { name: "Deals" }).locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByText(VERDICT)).toBeVisible();
});

test("an edit is kept when the page is reloaded straight after it, without waiting for Saved", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample deal" }).click();
  await openStep(page, "House");
  const luxury = page.getByRole("group", { name: "Finishes" }).getByRole("button", { name: /^Luxury/ });
  await expect(luxury).toHaveAttribute("aria-pressed", "false");
  await luxury.click();
  await expect(luxury).toHaveAttribute("aria-pressed", "true");

  // The autosave is a second away. Leaving the page must save what is waiting, not lose it.
  await page.reload();
  await expect(page.getByRole("group", { name: "Finishes" }).getByRole("button", { name: /^Luxury/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
