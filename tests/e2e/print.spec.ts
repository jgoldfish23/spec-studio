import { expect, test } from "@playwright/test";
import { loadSampleDeal } from "./helpers";

// A phone: the lender package must fit its width, with the month by month table scrolling inside its own box.
test.use({ viewport: { width: 390, height: 844 } });

test("the sample deal's lender package shows all eight sections and fits a 390 px screen", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  await loadSampleDeal(page);
  await page.getByRole("link", { name: "Lender package (PDF)" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Deal summary" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Deal summary",
    "Verdict and rules",
    "Scenarios",
    "Estimate by division",
    "Market estimate and comps used",
    "Timeline",
    "Monthly cash flow (base case)",
    "Assumptions",
  ]);
  // No app chrome: the page is the document.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByText("Decision support only — not an appraisal, legal advice, or a lending decision."),
  ).toBeVisible();

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, "the lender package scrolls sideways at 390 px").toBe(true);

  await page.getByRole("link", { name: "← Back to the pro forma" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pro forma" })).toBeAttached();
  expect(problems).toEqual([]);
});
