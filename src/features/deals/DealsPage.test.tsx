import { TEST_SAMPLE_IDS, testSampleComps } from "../../testing/sampleIds";
import { sampleComps } from "../../data/sample";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comp } from "@engine";
import { DEALS_KEY } from "../../data/local/localRepository";
import { isSampleComp, SAMPLE_DEAL_NAME, sampleDealInputs } from "../../data/sample";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";

const EMPTY = "No deals yet — start one, or load the sample deal to look around.";

beforeEach(() => {
  window.location.hash = "";
  // A fixed clock (Date only, so timers and promises run as usual) keeps the sample's comps inside their year.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 31, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

const main = () => screen.getByRole("main");

const OWN_COMP_ID = "0b6f6c0e-6a43-4c1f-9b55-3a6c7f2f0e11";
/** A sold comp the owner added: not one of the sample's. */
const ownComp = (): Comp => ({ ...(testSampleComps()[0] as Comp), id: OWN_COMP_ID, source: "manual", address: "12 Own Street, Layton, UT" });

describe("Deals page", () => {
  it("shows the title, the subtitle and the empty state when there are no deals", async () => {
    renderApp("#/");
    expect(within(main()).getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(screen.getByText("Every lot you're sizing up, with its go/no-go verdict.")).toBeVisible();
    expect(await screen.findByText(EMPTY)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New deal" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Load sample deal" })).toBeEnabled();
  });

  it("says Deal not found at the address of a deal that does not exist", async () => {
    renderApp("#/deals/does-not-exist/lot");
    expect(await screen.findByText("Deal not found")).toBeVisible();
    expect(within(main()).getByRole("link", { name: "Back to Deals" })).toHaveAttribute("href", "#/deals");
  });

  it("is also at #/deals", async () => {
    renderApp("#/deals");
    expect(await screen.findByText(EMPTY)).toBeVisible();
  });

  it("shows the three cards", async () => {
    const harness = createHarness();
    await seedSampleDeal(harness.repository);
    renderApp("#/", harness);

    const rules = screen.getByRole("region", { name: "Go/no-go rules" });
    expect(await within(rules).findByText("Margin on sale price")).toBeVisible();
    expect(within(rules).getByText("≥ 15%")).toBeVisible();
    expect(within(rules).getByText("Annualized return on cash")).toBeVisible();
    expect(within(rules).getByText("≥ 25%")).toBeVisible();
    expect(within(rules).getByText("Downside case profit")).toBeVisible();
    expect(within(rules).getByText("≥ $0")).toBeVisible();
    expect(within(rules).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "#/settings");
    expect(within(rules).queryByText("Later")).not.toBeInTheDocument();

    const costBook = screen.getByRole("region", { name: "Cost book" });
    expect(
      within(costBook).getByText(
        "Northern Utah starter estimates (unverified), as of Oct 2026. Replace them with your bids.",
      ),
    ).toBeVisible();

    const comps = screen.getByRole("region", { name: "Comps library" });
    expect(await within(comps).findByText("8 sold comps in Northern Utah (8 are sample data).")).toBeVisible();
  });

  it("counts the owner's own comps with the sample's, and says how many are sample data", async () => {
    const harness = createHarness();
    await seedSampleDeal(harness.repository);
    await harness.repository.saveComp(ownComp());
    renderApp("#/", harness);
    const comps = screen.getByRole("region", { name: "Comps library" });
    expect(await within(comps).findByText("9 sold comps in Northern Utah (8 are sample data).")).toBeVisible();
  });

  it("says nothing about sample data when there is none", async () => {
    const harness = createHarness();
    await harness.repository.saveComp(ownComp());
    renderApp("#/", harness);
    const comps = screen.getByRole("region", { name: "Comps library" });
    expect(await within(comps).findByText("1 sold comp in Northern Utah.")).toBeVisible();
  });

  it("counts no comps before any are stored", async () => {
    renderApp("#/");
    const comps = screen.getByRole("region", { name: "Comps library" });
    expect(await within(comps).findByText("0 sold comps in Northern Utah.")).toBeVisible();
  });

  it("starts a new deal named Untitled deal and opens its Lot step, which still needs a city", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    renderApp("#/", harness);

    await user.click(await screen.findByRole("button", { name: "New deal" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/deals\/[^/]+\/lot$/));
    const id = window.location.hash.split("/")[2] as string;

    expect(await within(main()).findByText("Needs info")).toBeVisible();
    expect(within(main()).getByText("Needs:")).toBeVisible();
    const city = within(main()).getByRole("link", { name: "City: Required" });
    expect(city).toHaveAttribute("href", `#/deals/${id}/lot`);
    expect(within(main()).getByLabelText("Deal name")).toHaveValue("Untitled deal");
    expect((await harness.repository.getDeal(id))?.name).toBe("Untitled deal");
  });

  it("loads the sample deal, opens its Pro forma with a sale price, and lists it as one deal", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    renderApp("#/", harness);

    await user.click(await screen.findByRole("button", { name: "Load sample deal" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/deals\/[^/]+\/proforma$/));

    const strip = await screen.findByRole("region", { name: "Deal summary" });
    const salePrice = within(strip).getByText("Sale price (base)").closest("dl");
    expect(salePrice).toHaveTextContent(/\$[\d,]+/);
    expect(salePrice).not.toHaveTextContent("—");
    expect(await harness.repository.listComps("utah-north")).toHaveLength(8);

    // Back to the list: one row, with a real verdict, and the sample button is gone.
    await user.click(within(main()).getByRole("link", { name: "← Deals" }));
    const link = await screen.findByRole("link", { name: SAMPLE_DEAL_NAME });
    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getByText("3,800 sf rambler · finished basement · 3-car")).toBeVisible();
    expect(within(row).getByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
    expect(within(row).queryByText("Needs info")).not.toBeInTheDocument();
    expect(within(row).getByText("Today")).toBeVisible();
    expect(within(row).getAllByText(/^[−$\d,%.]+$/).length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load sample deal" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  describe("the sample's comps", () => {
    it("are added by Load sample deal only where missing: a sample comp the owner changed keeps the change", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      const [first] = sampleComps() as [Comp];
      await harness.repository.saveComp({ ...first, soldPriceCents: 123_456_700 });
      renderApp("#/", harness);

      await user.click(await screen.findByRole("button", { name: "Load sample deal" }));
      await waitFor(() => expect(window.location.hash).toMatch(/\/proforma$/));
      const comps = await harness.repository.listComps("utah-north");
      expect(comps).toHaveLength(8);
      expect(comps.every(isSampleComp)).toBe(true);
      expect(comps.find((comp) => comp.id === first.id)?.soldPriceCents).toBe(123_456_700);
    });

    it("get their own ids in each company's library, so two companies can both load the sample", async () => {
      const user = userEvent.setup();
      const ids: string[][] = [];
      for (let i = 0; i < 2; i++) {
        const harness = createHarness();
        const view = renderApp("#/", harness);
        await user.click(await screen.findByRole("button", { name: "Load sample deal" }));
        await waitFor(() => expect(window.location.hash).toMatch(/\/proforma$/));
        ids.push((await harness.repository.listComps("utah-north")).map((comp) => comp.id));
        view.unmount();
        window.location.hash = "#/";
      }
      expect(ids.map((list) => list.length)).toEqual([8, 8]);
      expect(new Set(ids.flat()).size).toBe(16);
    });

    it("are left out of a new deal (as choices the owner can change on Market); the owner's own comps are not", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await seedSampleDeal(harness.repository);
      await harness.repository.saveComp(ownComp());
      renderApp("#/", harness);

      await user.click(await screen.findByRole("button", { name: "New deal" }));
      await waitFor(() => expect(window.location.hash).toMatch(/^#\/deals\/[^/]+\/lot$/));
      const id = window.location.hash.split("/")[2] as string;
      const stored = await harness.repository.getDeal(id);
      expect(stored?.inputs.compSelections).toEqual(Object.fromEntries(TEST_SAMPLE_IDS.map((compId) => [compId, false])));
    });

    it("are not chosen for a new deal when the library has none of them", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await harness.repository.saveComp(ownComp());
      renderApp("#/", harness);
      await user.click(await screen.findByRole("button", { name: "New deal" }));
      await waitFor(() => expect(window.location.hash).toMatch(/\/lot$/));
      const id = window.location.hash.split("/")[2] as string;
      expect((await harness.repository.getDeal(id))?.inputs.compSelections).toEqual({});
    });

    it("go with the last sample deal, and the confirm says so; the owner's own comps stay", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await seedSampleDeal(harness.repository);
      await harness.repository.saveComp(ownComp());
      renderApp("#/", harness);

      await user.click(await screen.findByRole("button", { name: `Delete ${SAMPLE_DEAL_NAME}` }));
      const dialog = screen.getByRole("alertdialog", {
        name: `Delete ${SAMPLE_DEAL_NAME}? This can't be undone. Its 8 sample comps are removed too.`,
      });
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
      expect(await screen.findByText(EMPTY)).toBeVisible();
      await waitFor(async () => expect((await harness.repository.listComps("utah-north")).map((comp) => comp.id)).toEqual([OWN_COMP_ID]));
      const comps = screen.getByRole("region", { name: "Comps library" });
      expect(await within(comps).findByText("1 sold comp in Northern Utah.")).toBeVisible();
    });

    it("stay while another sample deal is left", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await seedSampleDeal(harness.repository);
      await harness.repository.createDeal({ name: SAMPLE_DEAL_NAME, inputs: sampleDealInputs() });
      renderApp("#/", harness);

      const [deleteFirst] = await screen.findAllByRole("button", { name: `Delete ${SAMPLE_DEAL_NAME}` });
      await user.click(deleteFirst as HTMLElement);
      const dialog = screen.getByRole("alertdialog", { name: `Delete ${SAMPLE_DEAL_NAME}? This can't be undone.` });
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.getAllByRole("link", { name: SAMPLE_DEAL_NAME })).toHaveLength(1));
      expect(await harness.repository.listComps("utah-north")).toHaveLength(8);
    });
  });

  it("links a deal's name to its Lot step", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp("#/", harness);
    expect(await screen.findByRole("link", { name: SAMPLE_DEAL_NAME })).toHaveAttribute("href", `#/deals/${deal.id}/lot`);
  });

  it("shows a deal that is not finished as needing info", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    renderApp("#/", harness);
    await user.click(await screen.findByRole("button", { name: "New deal" }));
    await waitFor(() => expect(window.location.hash).toMatch(/\/lot$/));
    await user.click(await within(main()).findByRole("link", { name: "← Deals" }));

    const row = (await screen.findByRole("link", { name: "Untitled deal" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Needs info")).toBeVisible();
    expect(within(row).getByText("2,000 sf rambler · unfinished basement · 3-car")).toBeVisible();
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  describe("deleting a deal", () => {
    it("asks first, keeps the deal on Cancel, and removes it on Delete", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await seedSampleDeal(harness.repository);
      renderApp("#/", harness);

      await user.click(await screen.findByRole("button", { name: `Delete ${SAMPLE_DEAL_NAME}` }));
      const dialog = screen.getByRole("alertdialog", { name: new RegExp(`^Delete ${SAMPLE_DEAL_NAME}\\? This can't be undone\\.`) });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();
      expect((await harness.repository.listDeals()).deals).toHaveLength(1);
      expect(await harness.repository.listComps("utah-north")).toHaveLength(8);

      await user.click(screen.getByRole("button", { name: `Delete ${SAMPLE_DEAL_NAME}` }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      expect(await screen.findByText(EMPTY)).toBeVisible();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect((await harness.repository.listDeals()).deals).toEqual([]);
      // With the sample gone, it can be loaded again.
      expect(screen.getByRole("button", { name: "Load sample deal" })).toBeVisible();
    });

    it("is not offered by window.confirm", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm");
      const harness = createHarness();
      await seedSampleDeal(harness.repository);
      renderApp("#/", harness);
      await user.click(await screen.findByRole("button", { name: `Delete ${SAMPLE_DEAL_NAME}` }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      await screen.findByText(EMPTY);
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });
  });

  describe("focus after a delete", () => {
    /** Three deals as the list shows them, top to bottom. */
    async function threeDeals() {
      const harness = createHarness();
      for (const name of ["Deal A", "Deal B", "Deal C"]) await harness.repository.createDeal({ name, inputs: sampleDealInputs() });
      renderApp("#/", harness);
      await screen.findByRole("link", { name: "Deal C" });
      const names = screen.getAllByRole("link", { name: /^Deal [ABC]$/ }).map((link) => link.textContent ?? "");
      return { harness, names };
    }

    async function deleteDeal(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(screen.getByRole("button", { name: `Delete ${name}` }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.queryByRole("link", { name })).not.toBeInTheDocument());
    }

    it("moves to the next deal's name", async () => {
      const user = userEvent.setup();
      const { names } = await threeDeals();
      const [, middle, last] = names as [string, string, string];
      await deleteDeal(user, middle);
      await waitFor(() => expect(screen.getByRole("link", { name: last })).toHaveFocus());
    });

    it("moves to the previous deal's name when the last one goes", async () => {
      const user = userEvent.setup();
      const { names } = await threeDeals();
      const [, middle, last] = names as [string, string, string];
      await deleteDeal(user, last);
      await waitFor(() => expect(screen.getByRole("link", { name: middle })).toHaveFocus());
    });

    it("moves to New deal when no deal is left", async () => {
      const user = userEvent.setup();
      const harness = createHarness();
      await harness.repository.createDeal({ name: "Deal A", inputs: sampleDealInputs() });
      renderApp("#/", harness);
      await screen.findByRole("link", { name: "Deal A" });
      await deleteDeal(user, "Deal A");
      await waitFor(() => expect(screen.getByRole("button", { name: "New deal" })).toHaveFocus());
    });
  });

  describe("a deal that cannot be read", () => {
    async function withBrokenDeal() {
      const harness = createHarness();
      const good = await seedSampleDeal(harness.repository);
      const stored = JSON.parse(harness.storage.getItem(DEALS_KEY) as string) as Record<string, typeof good>;
      stored["bad-1"] = { ...good, id: "bad-1", inputs: { ...good.inputs, lot: { ...good.inputs.lot, priceCents: "x" as never } } };
      harness.storage.setItem(DEALS_KEY, JSON.stringify(stored));
      return { harness, good };
    }

    it("is listed as a problem next to the deals that can be read, and Remove deletes just it, after a confirm", async () => {
      const user = userEvent.setup();
      const { harness } = await withBrokenDeal();
      renderApp("#/", harness);

      const problem = await screen.findByText(/^Couldn't read one saved deal \(bad-1\): /);
      expect(problem).toHaveTextContent("priceCents");
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();

      const question = "Remove this unreadable deal (bad-1)? Its saved data is discarded.";
      await user.click(screen.getByRole("button", { name: "Remove bad-1" }));
      await user.click(within(screen.getByRole("alertdialog", { name: question })).getByRole("button", { name: "Cancel" }));
      expect(screen.getByText(/^Couldn't read one saved deal \(bad-1\): /)).toBeVisible();
      expect(Object.keys(JSON.parse(harness.storage.getItem(DEALS_KEY) as string))).toHaveLength(2);

      await user.click(screen.getByRole("button", { name: "Remove bad-1" }));
      await user.click(within(screen.getByRole("alertdialog", { name: question })).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(screen.queryByText(/Couldn't read one saved deal/)).not.toBeInTheDocument());
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();
      expect(Object.keys(JSON.parse(harness.storage.getItem(DEALS_KEY) as string))).toHaveLength(1);
      // The row is gone, and focus with it: it moves on to the next row.
      await waitFor(() => expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toHaveFocus());
    });

    it("shows just the problem when no deal can be read, with no empty list under a heading", async () => {
      const harness = createHarness();
      const good = await seedSampleDeal(harness.repository);
      harness.storage.setItem(
        DEALS_KEY,
        JSON.stringify({ "bad-1": { ...good, id: "bad-1", inputs: { ...good.inputs, loan: null } } }),
      );
      renderApp("#/", harness);

      expect(await screen.findByText(/^Couldn't read one saved deal \(bad-1\): /)).toBeVisible();
      expect(screen.queryByRole("heading", { name: "All deals" })).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    });

    it("shows the error panel at its own address, and Delete this deal removes it after a confirm", async () => {
      const user = userEvent.setup();
      const { harness } = await withBrokenDeal();
      renderApp("#/deals/bad-1/lot", harness);

      expect(await screen.findByText(/^This deal couldn't be read: /)).toHaveTextContent("priceCents");
      await user.click(screen.getByRole("button", { name: "Delete this deal" }));
      const dialog = screen.getByRole("alertdialog", { name: "Delete this deal? This can't be undone." });
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(window.location.hash).toBe("#/deals"));
      expect(await screen.findByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();
      expect(screen.queryByText(/Couldn't read one saved deal/)).not.toBeInTheDocument();
      expect(Object.keys(JSON.parse(harness.storage.getItem(DEALS_KEY) as string))).toHaveLength(1);
    });
  });

  it("offers to start over when the whole store cannot be read, after a confirm", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    harness.storage.setItem(DEALS_KEY, "{ not json");
    renderApp("#/", harness);

    expect(await screen.findByText("Your saved deals couldn't be read")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(harness.storage.getItem(DEALS_KEY)).toBe("{ not json");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove all" }));
    expect(await screen.findByText(EMPTY)).toBeVisible();
    expect(screen.queryByText("Your saved deals couldn't be read")).not.toBeInTheDocument();
    expect(harness.storage.getItem(DEALS_KEY)).toBeNull();
  });

  it("offers to download a copy before removing everything, and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    harness.storage.setItem(DEALS_KEY, "{ not json");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = (URL.createObjectURL = vi.fn(() => "blob:copy"));
    URL.revokeObjectURL = vi.fn();
    renderApp("#/", harness);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Download a copy first" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(
      await within(dialog).findByText(
        "Downloaded spec-studio-export-2026-10-31.json. 1 deal couldn't be read and isn't in the file.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Download a copy first" })).toBeEnabled();
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(harness.storage.getItem(DEALS_KEY)).toBe("{ not json");
    click.mockRestore();
  });

  it("says so when an action fails, and keeps working", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const createDeal = vi.spyOn(harness.repository, "createDeal").mockRejectedValueOnce(new Error("disk is full"));
    renderApp("#/", harness);
    await user.click(await screen.findByRole("button", { name: "New deal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the deal: disk is full");
    expect(window.location.hash).not.toMatch(/\/lot$/);

    await user.click(screen.getByRole("button", { name: "New deal" }));
    await waitFor(() => expect(window.location.hash).toMatch(/\/lot$/));
    expect(createDeal).toHaveBeenCalledTimes(2);
  });
});

describe("Deals page notice", () => {
  it("shows the list's notice as a plain line, not an alert or a problem row", async () => {
    const harness = createHarness();
    const stored = await seedSampleDeal(harness.repository);
    vi.spyOn(harness.repository, "listDeals").mockResolvedValue({
      deals: [stored],
      problems: [],
      notice: "Showing what's saved on this device — can't reach the server.",
    });
    renderApp("#/", harness);
    const notice = await screen.findByText("Showing what's saved on this device — can't reach the server.");
    expect(notice).toBeVisible();
    expect(notice).not.toHaveAttribute("role", "alert");
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });
});
