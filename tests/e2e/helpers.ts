// Steps the browser specs share. Not a spec itself: Playwright runs only `*.spec.ts`.
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The five steps of a deal, as their tabs name them. */
export type StepTitle = "Lot" | "House" | "Estimate" | "Market" | "Pro forma";

/**
 * From a fresh browser: opens the app (at `start`, the project's own address unless another is given), loads the
 * sample deal and waits for its Pro forma step to be drawn.
 */
export async function loadSampleDeal(page: Page, start = "/") {
  await page.goto(start);
  await startSampleDeal(page);
}

/** From the empty Deals page: loads the sample deal and waits for its Pro forma step to be drawn. */
export async function startSampleDeal(page: Page) {
  await expect(page.getByText("No deals yet")).toBeVisible();
  await page.getByRole("button", { name: "Load sample deal" }).click();
  await expect(page.getByRole("heading", { name: "Pro forma" })).toBeAttached();
}

/** Opens a step from the deal's tabs (the "Next:" links on the pages are not the tabs). */
export async function openStep(page: Page, title: StepTitle) {
  await page.getByRole("navigation", { name: "Deal steps" }).getByRole("link", { name: title, exact: true }).click();
}
