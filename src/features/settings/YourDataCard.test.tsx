import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS } from "@engine";
import { buildExport, exportFileName } from "../../data/exportFile";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
import { DEALS_KEY } from "../../data/local/localRepository";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

const REGION = DEFAULT_MARKET_SETTINGS.region;
const NOW = new Date(2026, 10, 2, 12, 0, 0);

let blobs: Blob[];
let downloads: string[];
let revoked: string[];

beforeEach(() => {
  window.location.hash = "";
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  blobs = [];
  downloads = [];
  revoked = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:test-url";
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const card = () => screen.getByRole("region", { name: "Your data" });
const user = () => userEvent.setup();
/** user-event installs its own clipboard when it is set up, so a test sets its clipboard up after that. */
const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

async function openCard(harness: Harness = createHarness()) {
  renderApp("#/settings", harness);
  await screen.findByRole("region", { name: "Your data" });
  return harness;
}

/** An export of a different account that holds the sample deal and its comps. */
async function sampleExportText(): Promise<string> {
  const source = createHarness();
  await seedSampleDeal(source.repository);
  return JSON.stringify((await buildExport(source.repository, REGION, NOW.toISOString())).file);
}

describe("Your data card: export", () => {
  it("downloads the export under its dated name as JSON, then lets go of the blob URL", async () => {
    const harness = createHarness();
    await seedSampleDeal(harness.repository);
    await openCard(harness);
    await user().click(within(card()).getByRole("button", { name: "Export all data" }));
    await waitFor(() => expect(downloads).toEqual([exportFileName(NOW.toISOString())]));
    expect(downloads[0]).toBe("spec-studio-export-2026-11-02.json");
    expect(blobs[0]?.type).toBe("application/json");
    const text = await blobs[0]!.text();
    expect(JSON.parse(text).deals[0].name).toBe(SAMPLE_DEAL_NAME);
    expect(revoked).toEqual(["blob:test-url"]);
    expect(await within(card()).findByRole("status")).toHaveTextContent(
      "Downloaded spec-studio-export-2026-11-02.json.",
    );
  });

  it("says how many deals couldn't be read when it exports", async () => {
    const harness = createHarness();
    harness.storage.setItem(DEALS_KEY, "{ not json");
    await openCard(harness);
    await user().click(within(card()).getByRole("button", { name: "Export all data" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "Downloaded spec-studio-export-2026-11-02.json. Your saved deals couldn't be read and aren't in the file.",
    );
  });

  it("copies to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const u = user();
    setClipboard({ writeText });
    await openCard();
    await u.click(within(card()).getByRole("button", { name: "Copy to clipboard" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0]![0] as string).format).toBe("spec-studio-export/v1");
    expect(await within(card()).findByRole("status")).toHaveTextContent("Copied your data to the clipboard.");
    expect(within(card()).queryByLabelText("Your data, ready to copy")).not.toBeInTheDocument();
  });

  it("falls back to a selectable text box when the clipboard refuses", async () => {
    const u = user();
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("no")) });
    await openCard();
    await u.click(within(card()).getByRole("button", { name: "Copy to clipboard" }));
    const box = (await within(card()).findByLabelText("Your data, ready to copy")) as HTMLTextAreaElement;
    expect(box).toHaveAttribute("readonly");
    expect(JSON.parse(box.value).format).toBe("spec-studio-export/v1");
    expect(box.selectionEnd - box.selectionStart).toBe(box.value.length);
  });

  it("says how many deals couldn't be read when it copies", async () => {
    const harness = createHarness();
    harness.storage.setItem(DEALS_KEY, "{ not json");
    const u = user();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    await openCard(harness);
    await u.click(within(card()).getByRole("button", { name: "Copy to clipboard" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "Copied your data to the clipboard. Your saved deals couldn't be read and aren't in the file.",
    );
  });

  it("falls back too when there is no clipboard at all", async () => {
    const u = user();
    setClipboard(undefined);
    await openCard();
    await u.click(within(card()).getByRole("button", { name: "Copy to clipboard" }));
    expect(await within(card()).findByLabelText("Your data, ready to copy")).toBeVisible();
  });
});

describe("Your data card: import", () => {
  it("previews a chosen file, imports it, shows the data, and a second import adds nothing", async () => {
    const text = await sampleExportText();
    const harness = await openCard();
    const invalidate = vi.spyOn(harness.client, "invalidateQueries");
    const u = user();
    const file = new File([text], "export.json", { type: "application/json" });
    await u.upload(within(card()).getByLabelText("Choose an export file"), file);

    expect(await within(card()).findByText("1 deal and 8 comps will be imported.")).toBeVisible();
    expect((await harness.repository.listDeals()).deals).toHaveLength(0);
    await u.click(within(card()).getByRole("button", { name: "Import" }));
    expect(await within(card()).findByText("Imported 1 deal and 8 comps.")).toBeVisible();
    expect((await harness.repository.listDeals()).deals).toHaveLength(1);
    expect(await harness.repository.listComps(REGION)).toHaveLength(8);
    expect(within(card()).queryByText("What this import will do")).not.toBeInTheDocument();

    // What the app reads was refreshed: deals, comps, company and market settings.
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["deals"], ["comps"], ["companySettings"], ["marketSettings", REGION]]),
    );

    await u.upload(
      within(card()).getByLabelText("Choose an export file"),
      new File([text], "export.json", { type: "application/json" }),
    );
    expect(await within(card()).findByText("0 deals and 0 comps will be imported.")).toBeVisible();
    expect(within(card()).getByText(`Deal "${SAMPLE_DEAL_NAME}": already in your account`)).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Import" })).toBeDisabled();
    expect((await harness.repository.listDeals()).deals).toHaveLength(1);
  });

  it("still reports the import when refreshing the screens fails", async () => {
    const text = await sampleExportText();
    const harness = await openCard();
    vi.spyOn(harness.client, "invalidateQueries").mockRejectedValue(new Error("boom"));
    const u = user();
    await u.click(within(card()).getByLabelText("Or paste an export"));
    await u.paste(text);
    await u.click(within(card()).getByRole("button", { name: "Preview import" }));
    await u.click(await within(card()).findByRole("button", { name: "Import" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "Imported 1 deal and 8 comps. The screens couldn't refresh (boom). Reload the page to see what was imported.",
    );
  });

  it("previews pasted text", async () => {
    const text = await sampleExportText();
    await openCard();
    const u = user();
    await u.click(within(card()).getByLabelText("Or paste an export"));
    await u.paste(text);
    await u.click(within(card()).getByRole("button", { name: "Preview import" }));
    expect(await within(card()).findByText("1 deal and 8 comps will be imported.")).toBeVisible();
  });

  it("replaces settings only when the box is ticked", async () => {
    const source = createHarness();
    const { file } = await buildExport(source.repository, REGION, NOW.toISOString());
    file.companySettings = { ...file.companySettings, contingencyPct: 0.09 };
    const harness = await openCard();
    const u = user();
    await u.click(within(card()).getByLabelText("Or paste an export"));
    await u.paste(JSON.stringify(file));
    await u.click(within(card()).getByRole("button", { name: "Preview import" }));
    const tick = await within(card()).findByRole("checkbox", {
      name: "Also replace my settings",
    });
    expect(tick).not.toBeChecked();
    expect(within(card()).getByText("Your settings stay as they are.")).toBeVisible();
    await u.click(tick);
    expect(within(card()).getByText(/will be replaced with the ones in the file/)).toBeVisible();
    await u.click(within(card()).getByRole("button", { name: "Import" }));
    expect(await within(card()).findByText(/Replaced your settings\./)).toBeVisible();
    expect((await harness.repository.getCompanySettings()).contingencyPct).toBe(0.09);
  });

  it("says why a file is refused, and writes nothing", async () => {
    const harness = await openCard();
    const u = user();
    await u.click(within(card()).getByLabelText("Or paste an export"));
    await u.paste("hello");
    await u.click(within(card()).getByRole("button", { name: "Preview import" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent("That isn't a Spec Studio export file.");
    expect((await harness.repository.listDeals()).deals).toHaveLength(0);
  });

  it("refuses a file over 20 MB without reading it", async () => {
    await openCard();
    const big = new File(["x"], "big.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 + 1 });
    const text = vi.spyOn(big, "text");
    await user().upload(within(card()).getByLabelText("Choose an export file"), big);
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "That file is too big to be a Spec Studio export.",
    );
    expect(text).not.toHaveBeenCalled();
  });

  it("reports what got in when the import stops part-way, and keeps the button usable to try again", async () => {
    const text = await sampleExportText();
    const harness = await openCard();
    const saveComp = harness.repository.saveComp.bind(harness.repository);
    let n = 0;
    vi.spyOn(harness.repository, "saveComp").mockImplementation((c) =>
      ++n === 3 ? Promise.reject(new Error("You're offline.")) : saveComp(c),
    );
    const u = user();
    await u.click(within(card()).getByLabelText("Or paste an export"));
    await u.paste(text);
    await u.click(within(card()).getByRole("button", { name: "Preview import" }));
    await u.click(await within(card()).findByRole("button", { name: "Import" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "Imported 0 deals and 2 comps, then it stopped: You're offline. Importing again skips what's already in.",
    );
    expect(await harness.repository.listComps(REGION)).toHaveLength(2);
  });
});
