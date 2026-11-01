import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { loadSampleDeal, openStep } from "./helpers";
import type { StepTitle } from "./helpers";

// A phone: every screen must fit its width, with wide tables scrolling inside their own boxes.
test.use({ viewport: { width: 390, height: 844 } });

const STEPS: readonly StepTitle[] = ["Lot", "House", "Estimate", "Market", "Pro forma"];

/** True when the page is no wider than the window, so it does not scroll sideways. */
async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

test("the deals list and every step fit a 390 px screen, with no errors in the console", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  await loadSampleDeal(page);

  // The deal's own screens, each once it has drawn.
  for (const title of STEPS) {
    await openStep(page, title);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeAttached();
    expect(await fitsWidth(page), `${title} scrolls sideways at 390 px`).toBe(true);
  }

  // The list, with the sample deal in it.
  await page.getByRole("link", { name: "← Deals" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Deals" }).getByRole("link", { name: /Sample/ })).toBeVisible();
  expect(await fitsWidth(page), "Deals scrolls sideways at 390 px").toBe(true);

  expect(problems).toEqual([]);
});
