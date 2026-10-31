import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEALS_KEY } from "../../data/local/localRepository";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
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
    expect(within(rules).getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(within(rules).getByText("Later")).toBeVisible();

    const costBook = screen.getByRole("region", { name: "Cost book" });
    expect(
      within(costBook).getByText(
        "Northern Utah starter estimates (unverified), as of Oct 2026. Replace them with your bids.",
      ),
    ).toBeVisible();

    const comps = screen.getByRole("region", { name: "Comps library" });
    expect(await within(comps).findByText("8 sold comps in Northern Utah.")).toBeVisible();
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
    const city = within(main()).getByRole("link", { name: /city/i });
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
      const dialog = screen.getByRole("alertdialog", { name: `Delete ${SAMPLE_DEAL_NAME}? This can't be undone.` });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();
      expect((await harness.repository.listDeals()).deals).toHaveLength(1);

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

  describe("a deal that cannot be read", () => {
    async function withBrokenDeal() {
      const harness = createHarness();
      const good = await seedSampleDeal(harness.repository);
      const stored = JSON.parse(harness.storage.getItem(DEALS_KEY) as string) as Record<string, typeof good>;
      stored["bad-1"] = { ...good, id: "bad-1", inputs: { ...good.inputs, lot: { ...good.inputs.lot, priceCents: "x" as never } } };
      harness.storage.setItem(DEALS_KEY, JSON.stringify(stored));
      return { harness, good };
    }

    it("is listed as a problem next to the deals that can be read, and Remove deletes just it", async () => {
      const user = userEvent.setup();
      const { harness } = await withBrokenDeal();
      renderApp("#/", harness);

      const problem = await screen.findByText(/^Couldn't read one saved deal \(bad-1\): /);
      expect(problem).toHaveTextContent("priceCents");
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Remove bad-1" }));
      await waitFor(() => expect(screen.queryByText(/Couldn't read one saved deal/)).not.toBeInTheDocument());
      expect(screen.getByRole("link", { name: SAMPLE_DEAL_NAME })).toBeVisible();
      expect(Object.keys(JSON.parse(harness.storage.getItem(DEALS_KEY) as string))).toHaveLength(1);
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
