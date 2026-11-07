// The hosted build in a real browser, against the fake Supabase (`./fakeSupabase`): sign-in, company setup, saving
// to the server, offline edits, conflicts, Settings, and moving demo deals in. Each spec starts from a fresh browser
// and an empty fake, and checks what reached the server through the fake's tables.
import { expect, test as base } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { SIGN_IN_CODE, installFakeSupabase } from "./fakeSupabase";
import type { FakeSupabase, Row } from "./fakeSupabase";
import { loadSampleDeal, openStep, startSampleDeal } from "./helpers";

const test = base.extend<{ fake: FakeSupabase }>({
  // The fixture's hand-over is not named `use`, which the React hooks lint rule would take for React's.
  fake: async ({ page }, provide) => {
    const fake = await installFakeSupabase(page);
    await provide(fake);
    expect(fake.problems(), "requests the fake does not model, or its own failures").toEqual([]);
  },
});

const EMAIL = "pat@citycreek.test";
const COMPANY = "City Creek Construction";
const SAMPLE = "Sample — Kaysville lot";
/** The sample deal is complete, so it always has a real verdict, never "Needs info". */
const VERDICT = /^(Go|Marginal|No-go)$/;
/** The demo build, served beside the hosted one (playwright.config.ts). Its own origin, so its own storage. */
const DEMO_URL = "http://localhost:4173";
const OFFLINE_NOTE = "Offline — saved on this device, will sync";
/** The header's note while edits wait on this device. */
const SYNC_NOTE = "1 change waiting to sync";
const CONFLICT = "This deal was changed on another device or tab.";
const OTHER_BROWSER =
  "This link was opened in a different browser than the one that asked for it. Type the 6-digit code from the same email instead.";

/** Errors the page logs or throws, for a spec in which nothing should go wrong. */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

/** On the sign-in page: asks for the email, then signs in with its 6-digit code. */
async function signIn(page: Page) {
  await expect(page.getByRole("heading", { name: "Sign in to Spec Studio" })).toBeVisible();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(SIGN_IN_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** On the company setup page: names the company and waits for the empty Deals page. */
async function nameCompany(page: Page) {
  await expect(page.getByRole("heading", { name: "Name your company" })).toBeVisible();
  await page.getByLabel("Company name").fill(COMPANY);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByText("No deals yet")).toBeVisible();
}

/** From a fresh browser: signs in as a new owner and sets up the company. Ends on the empty Deals page. */
async function signUp(page: Page) {
  await page.goto("/");
  await signIn(page);
  await nameCompany(page);
}

/** The id of the deal the page has open. */
function openDealId(page: Page): string {
  const id = /#\/deals\/([0-9a-f-]{36})\//.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`No deal is open at ${page.url()}`);
  return id;
}

/** A deal row's lot price, in cents. */
const lotPriceOf = (deal: Row | undefined) => (deal?.inputs as { lot?: { priceCents?: number } } | undefined)?.lot?.priceCents;

/** Types a new lot price on the Lot step and leaves the box, as the owner does. */
async function setLotPrice(page: Page, dollars: string) {
  const box = page.getByLabel("Lot price");
  await box.fill(dollars);
  await box.blur();
}

async function openSettings(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

/** On Settings: pastes an export into the import box and waits for the preview of what it would do. */
async function previewImport(page: Page, exported: string): Promise<Locator> {
  const yourData = page.getByRole("region", { name: "Your data" });
  await yourData.getByLabel("Or paste an export").fill(exported);
  await yourData.getByRole("button", { name: "Preview import" }).click();
  await expect(yourData.getByRole("heading", { name: "What this import will do" })).toBeVisible();
  return yourData;
}

test("an owner signs in with the emailed code, sets up the company and loads the sample deal", async ({ page, fake }) => {
  const problems = collectProblems(page);
  await page.goto("/");
  await signIn(page);
  expect(fake.emailsSent()).toEqual([{ email: EMAIL, redirectTo: "http://localhost:4174/" }]);
  await nameCompany(page);

  // The server made the company, the owner's membership and the company's starting settings.
  const companies = fake.rows("companies");
  expect(companies).toEqual([expect.objectContaining({ name: COMPANY, default_region: "utah-north" })]);
  const companyId = companies[0]?.id;
  expect(fake.rows("memberships")).toEqual([expect.objectContaining({ company_id: companyId, role: "owner" })]);
  expect(fake.rows("company_settings")).toEqual([
    expect.objectContaining({
      company_id: companyId,
      rules: { minMarginOnSale: 0.15, minAnnualizedReturn: 0.25, minDownsideProfitCents: 0 },
      contingency_pct: 0.05,
    }),
  ]);

  await startSampleDeal(page);
  await expect(page.getByText(VERDICT).first()).toBeVisible();
  // The deal and its eight sample comps are the company's, on the server.
  expect(fake.rows("deals")).toEqual([expect.objectContaining({ id: openDealId(page), company_id: companyId, name: SAMPLE })]);
  const comps = fake.rows("comps");
  expect(comps).toHaveLength(8);
  expect(comps.every((comp) => comp.company_id === companyId)).toBe(true);
  expect(problems).toEqual([]);
});

test("an edit is saved to the server and is still there after a reload", async ({ page, fake }) => {
  const problems = collectProblems(page);
  await signUp(page);
  await startSampleDeal(page);
  const id = openDealId(page);
  await openStep(page, "Lot");
  await expect(page.getByRole("heading", { level: 1, name: "Lot" })).toBeAttached();

  await setLotPrice(page, "412000");
  // The save lands on the server, then the header says so.
  await expect.poll(() => lotPriceOf(fake.deal(id))).toBe(41_200_000);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Lot price")).toHaveValue("412,000");
  expect(lotPriceOf(fake.deal(id))).toBe(41_200_000);
  expect(problems).toEqual([]);
});

test("an edit made offline waits on the device, survives a reload, and syncs when the connection is back", async ({ page, fake }) => {
  const problems = collectProblems(page);
  await signUp(page);
  await startSampleDeal(page);
  const id = openDealId(page);
  await openStep(page, "Lot");
  await expect(page.getByRole("heading", { level: 1, name: "Lot" })).toBeAttached();
  const before = lotPriceOf(fake.deal(id));

  fake.setOffline(true);
  await setLotPrice(page, "398000");
  await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
  await expect(page.getByText(SYNC_NOTE)).toBeVisible();
  expect(lotPriceOf(fake.deal(id))).toBe(before);

  // Reloaded with no connection: the deal opens from the outbox, with the edit, and it still waits. A read that gets no
  // answer fails at once (it is not tried again), so the page draws from the device within the usual wait.
  await page.reload();
  await expect(page.getByLabel("Lot price")).toHaveValue("398,000");
  await expect(page.getByText(SYNC_NOTE)).toBeVisible();
  expect(lotPriceOf(fake.deal(id))).toBe(before);

  // The connection is back and the browser says so: the outbox syncs, and the note goes.
  fake.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => lotPriceOf(fake.deal(id))).toBe(39_800_000);
  await expect(page.getByText(SYNC_NOTE)).toHaveCount(0);
  await expect(page.getByLabel("Lot price")).toHaveValue("398,000");
  // The browser reports each request that met no connection; the app itself reports nothing.
  expect(problems.filter((problem) => !problem.endsWith("net::ERR_INTERNET_DISCONNECTED"))).toEqual([]);
});

test("a deal changed on another device: Keep mine puts the owner's version on the server", async ({ page, fake }) => {
  const problems = collectProblems(page);
  await signUp(page);
  await startSampleDeal(page);
  const id = openDealId(page);
  await openStep(page, "Lot");
  await expect(page.getByRole("heading", { level: 1, name: "Lot" })).toBeAttached();

  const theirs = fake.editDealElsewhere(id, { name: "Kaysville lot — office copy" });
  await setLotPrice(page, "405000");
  const panel = page.getByRole("alert").filter({ hasText: CONFLICT });
  await expect(panel).toBeVisible();
  // The save that lost changed nothing: the server still holds the other device's version.
  expect(fake.deal(id)).toMatchObject({ name: "Kaysville lot — office copy", updated_at: theirs.updated_at });
  expect(lotPriceOf(fake.deal(id))).toBe(lotPriceOf(theirs));

  await panel.getByRole("button", { name: "Keep mine" }).click();
  await expect.poll(() => lotPriceOf(fake.deal(id))).toBe(40_500_000);
  expect(fake.deal(id)?.name).toBe(SAMPLE);
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

test("a sign-in link opened in a different browser says so and offers the code instead", async ({ page, fake }) => {
  const problems = collectProblems(page);
  // The email was asked for on another device, so this browser holds no code verifier for the link's code.
  fake.addUser(EMAIL);
  await page.goto("/?code=bogus#/deals");
  await expect(page.getByText(OTHER_BROWSER)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  // The spent code is gone from the address, so a reload does not try it again.
  expect(new URL(page.url()).search).toBe("");

  // The code from the same email signs in: no loop back to the link.
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("6-digit code").fill(SIGN_IN_CODE);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Name your company" })).toBeVisible();
  expect(fake.requests().filter((request) => request.includes("grant_type=pkce"))).toEqual([]);
  expect(problems).toEqual([]);
});

test("a new minimum margin saved in Settings is the one a new deal's rules start from", async ({ page, fake }) => {
  const problems = collectProblems(page);
  await signUp(page);
  await openSettings(page);
  const rules = page.getByRole("region", { name: "Go/no-go rules for new deals" });
  const margin = rules.getByLabel("Minimum margin on sale price");
  await expect(margin).toHaveValue("15.00");
  await margin.fill("18");
  await rules.getByRole("button", { name: "Save changes" }).click();
  await expect(rules.getByRole("status")).toHaveText("Saved");
  expect(fake.rows("company_settings")).toEqual([expect.objectContaining({ rules: expect.objectContaining({ minMarginOnSale: 0.18 }) })]);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Deals" }).click();
  await page.getByRole("button", { name: "New deal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lot" })).toBeAttached();
  const id = openDealId(page);
  await openStep(page, "Pro forma");
  await expect(page.getByLabel("Minimum margin on sale %")).toHaveValue("18.00");
  expect(fake.deal(id)?.inputs).toMatchObject({ rules: { minMarginOnSale: 0.18 } });
  expect(problems).toEqual([]);
});

test("demo deals move into the account by copy and paste, and a second import skips them", async ({ page, context, fake }) => {
  // The demo build, open beside the hosted one. It may use the clipboard, so Copy to clipboard puts the export there
  // and the spec reads it back (rather than the text box shown when the clipboard is refused).
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: DEMO_URL });
  const demo = await context.newPage();
  const demoProblems = collectProblems(demo);
  await loadSampleDeal(demo, DEMO_URL);
  await expect(demo.getByText(VERDICT).first()).toBeVisible();
  const demoSummary = (await demo.getByRole("region", { name: "Deal summary" }).textContent()) ?? "";
  await openSettings(demo);
  const demoData = demo.getByRole("region", { name: "Your data" });
  await demoData.getByRole("button", { name: "Copy to clipboard" }).click();
  await expect(demoData.getByText("Copied your data to the clipboard.")).toBeVisible();
  const exported = await demo.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(exported)).toMatchObject({ deals: [expect.objectContaining({ name: SAMPLE })] });
  expect(demoProblems).toEqual([]);
  await demo.close();

  const problems = collectProblems(page);
  await signUp(page);
  await openSettings(page);
  let yourData = await previewImport(page, exported);
  await expect(yourData.getByText("1 deal and 8 comps will be imported.")).toBeVisible();
  await yourData.getByRole("button", { name: "Import", exact: true }).click();
  await expect(yourData.getByRole("status").filter({ hasText: "Imported" })).toHaveText("Imported 1 deal and 8 comps.");
  const deals = fake.rows("deals");
  expect(deals).toEqual([expect.objectContaining({ name: SAMPLE })]);
  expect(fake.rows("comps")).toHaveLength(8);

  // The deal is in the list, and it comes out as it did in the demo: the same figures from the same cost book.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Deals" }).click();
  await page.getByRole("table", { name: "Deals" }).getByRole("link", { name: SAMPLE }).click();
  await openStep(page, "Pro forma");
  await expect(page.getByRole("heading", { level: 1, name: "Pro forma" })).toBeAttached();
  await expect(page.getByRole("region", { name: "Deal summary" })).toHaveText(demoSummary);

  // The same export again: nothing new comes in, and the preview says why.
  await openSettings(page);
  yourData = await previewImport(page, exported);
  await expect(yourData.getByText("0 deals and 0 comps will be imported.")).toBeVisible();
  await expect(yourData.getByText(`Deal "${SAMPLE}": already in your account`)).toBeVisible();
  await expect(yourData.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  expect(fake.rows("deals")).toEqual(deals);
  expect(fake.rows("comps")).toHaveLength(8);
  expect(problems).toEqual([]);
});
