import { expect, test } from "@playwright/test";

test("a step whose code cannot be fetched says so and recovers on Reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample deal" }).click();
  await expect(page.getByRole("heading", { name: "Pro forma" })).toBeAttached();

  // The House screen is its own file, fetched the first time the step is opened. Make that fetch fail.
  const chunk = "**/assets/HousePage-*.js";
  await page.route(chunk, (route) => route.abort());
  const tabs = page.getByRole("navigation", { name: "Deal steps" });
  await tabs.getByRole("link", { name: "House", exact: true }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load this screen — reload the page" });
  await expect(alert).toBeVisible();
  await expect(page.getByText(/Couldn't calculate/)).toHaveCount(0);
  // The frame stays up, so the owner can still move to another step.
  await expect(tabs).toBeVisible();

  // The network is back; Reload loads the page again, on the same step.
  await page.unroute(chunk);
  await alert.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "House" })).toBeAttached();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this screen" })).toHaveCount(0);
});
