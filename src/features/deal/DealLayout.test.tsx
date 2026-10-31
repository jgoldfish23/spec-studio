import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEALS_KEY } from "../../data/local/localRepository";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
import type { StoredDeal } from "../../data/types";
import { createHarness, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";
import { useDealEditorContext } from "./DealEditorContext";
import { DealRoute } from "./DealRoute";
import { resetLostSaves } from "./lostSaves";

/** Stands in for a step screen: buttons that change the deal, as the real steps will. */
function Controls() {
  const editor = useDealEditorContext();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          editor.edit((draft) => {
            draft.contingencyPct = 0.02;
          })
        }
      >
        Lower contingency
      </button>
      <button
        type="button"
        onClick={() =>
          editor.edit((draft) => {
            draft.lot.priceCents = 70_000_000;
          })
        }
      >
        Raise land price
      </button>
    </div>
  );
}

function renderDeal(harness: Harness, id: string, step = "lot") {
  const router = createMemoryRouter(
    [
      { path: "/deals", element: <h1>Deals list</h1> },
      {
        path: "/deals/:dealId",
        element: <DealRoute />,
        children: [
          { path: "lot", element: <Controls /> },
          { path: "house", element: <p>House step</p> },
        ],
      },
    ],
    { initialEntries: [`/deals/${id}/${step}`] },
  );
  return render(<RouterProvider router={router} />, { wrapper: harness.Providers });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 31, 12) });
});
afterEach(() => {
  vi.useRealTimers();
  resetLostSaves();
});

async function sampleSetup() {
  const harness = createHarness();
  const deal = await seedSampleDeal(harness.repository);
  return { harness, deal };
}

describe("DealLayout when ready", () => {
  it("shows the back link, the name, the verdict, undo and redo, and that it is saved", async () => {
    const { harness, deal } = await sampleSetup();
    renderDeal(harness, deal.id);

    expect(await screen.findByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    expect(screen.getByRole("link", { name: "← Deals" })).toHaveAttribute("href", "/deals");
    expect(screen.getByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
    expect(screen.queryByText("Needs:")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    const status = screen.getByText("Saved");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows the five summary figures from the base scenario, and the days on market as a range", async () => {
    const { harness, deal } = await sampleSetup();
    renderDeal(harness, deal.id);

    const strip = await screen.findByRole("region", { name: "Deal summary" });
    const tiles = ["Sale price (base)", "Total project cost", "Profit", "Margin on sale", "Days on market"];
    expect(within(strip).getAllByRole("term").map((term) => term.textContent)).toEqual(tiles);
    for (const label of tiles) {
      const value = within(strip).getByText(label).closest("dl") as HTMLElement;
      expect(value).not.toHaveTextContent("—");
    }
    expect(within(strip).getByText("Sale price (base)").closest("dl")).toHaveTextContent(/\$[\d,]+/);
    expect(within(strip).getByText("Margin on sale").closest("dl")).toHaveTextContent(/%/);
    expect(within(strip).getByText("Days on market").closest("dl")).toHaveTextContent(/\d+–\d+/);
  });

  it("shows a dash for each figure while the deal cannot be priced", async () => {
    const { harness, deal } = await sampleSetup();
    const blank = structuredClone(deal.inputs);
    blank.lot.city = "";
    await harness.repository.saveDeal({ ...deal, inputs: blank });
    renderDeal(harness, deal.id);

    const strip = await screen.findByRole("region", { name: "Deal summary" });
    expect(within(strip).getAllByText("—")).toHaveLength(5);
  });

  it("has no heads-up list for the sample, and lists one after contingency is lowered", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    expect(screen.queryByRole("list", { name: "Heads-up" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    const list = await screen.findByRole("list", { name: "Heads-up" });
    expect(within(list).getByText("Contingency is below 3%")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Raise land price" }));
    await within(list).findByText("Land and closing are more than 40% of the sale price");
  });

  it("numbers the five steps as links, with the current one marked", async () => {
    const { harness, deal } = await sampleSetup();
    renderDeal(harness, deal.id, "house");

    const nav = await screen.findByRole("navigation", { name: "Deal steps" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["1Lot", "2House", "3Estimate", "4Market", "5Pro forma"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ["lot", "house", "estimate", "market", "proforma"].map((step) => `/deals/${deal.id}/${step}`),
    );
    expect(within(nav).getByRole("link", { name: "House" })).toHaveAttribute("aria-current", "step");
    for (const name of ["Lot", "Estimate", "Market", "Pro forma"]) {
      expect(within(nav).getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
    expect(screen.getByText("House step")).toBeVisible();
  });

  describe("the verdict and what a deal still needs", () => {
    it("lists the first three things, each linked to the step that fixes it, and counts the rest", async () => {
      const harness = createHarness();
      const sample = await seedSampleDeal(harness.repository);
      const inputs = structuredClone(sample.inputs);
      inputs.lot.city = "";
      inputs.lot.county = "";
      inputs.lot.acres = -1;
      inputs.lot.priceCents = -5;
      const deal = await harness.repository.createDeal({ name: "Needy", inputs });
      renderDeal(harness, deal.id);

      expect(await screen.findByText("Needs info")).toBeVisible();
      const needs = screen.getByText("Needs:").parentElement as HTMLElement;
      const links = within(needs).getAllByRole("link");
      expect(links).toHaveLength(3);
      for (const link of links) expect(link).toHaveAttribute("href", `/deals/${deal.id}/lot`);
      expect(links[0]).toHaveTextContent("lot.city: Required");
      expect(within(needs).getByText("+1 more")).toBeVisible();
    });
  });

  describe("renaming", () => {
    it("keeps the typed name on blur and saves it", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      const name = await screen.findByLabelText("Deal name");

      await user.clear(name);
      await user.type(name, "  Maple Street  ");
      await user.tab();
      expect(name).toHaveValue("Maple Street");
      expect(screen.getByText("Unsaved changes")).toBeVisible();
      await waitFor(async () => expect((await harness.repository.getDeal(deal.id))?.name).toBe("Maple Street"), { timeout: 3000 });
      await screen.findByText("Saved", undefined, { timeout: 3000 });
    });

    it("puts the old name back when the box is left empty", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      const name = await screen.findByLabelText("Deal name");

      await user.clear(name);
      expect(name).toHaveValue("");
      await user.tab();
      expect(name).toHaveValue(SAMPLE_DEAL_NAME);
      expect(screen.getByText("Saved")).toBeVisible();
    });

    it("commits on Enter", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      const name = await screen.findByLabelText("Deal name");

      await user.clear(name);
      await user.type(name, "Oak Hollow{Enter}");
      expect(name).not.toHaveFocus();
      expect(name).toHaveValue("Oak Hollow");
      expect(screen.getByText("Unsaved changes")).toBeVisible();
    });
  });

  describe("undo and redo", () => {
    it("steps an edit back and forward, with the buttons enabled only when there is something to do", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
      await screen.findByText("Contingency is below 3%");

      await user.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(screen.queryByText("Contingency is below 3%")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Redo" }));
      await screen.findByText("Contingency is below 3%");
    });
  });

  describe("the save status", () => {
    it("moves from Unsaved changes to Saved after an edit", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      expect(screen.getByText("Unsaved changes")).toHaveAttribute("aria-live", "polite");
      await screen.findByText("Saved", undefined, { timeout: 3000 });
      expect((await harness.repository.getDeal(deal.id))?.inputs.contingencyPct).toBe(0.02);
    });

    it("says it could not save, with the reason, and that it will retry", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      const save = vi.spyOn(harness.repository, "saveDeal");
      save.mockRejectedValueOnce(new Error("Couldn't save — browser storage is full"));
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      const status = await screen.findByText("Couldn't save — retrying", undefined, { timeout: 3000 });
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveTextContent("Couldn't save — browser storage is full");
    });
  });
});

describe("DealLayout when there is nothing to show", () => {
  it("shows a skeleton while the deal loads", async () => {
    const { harness, deal } = await sampleSetup();
    renderDeal(harness, deal.id);
    expect(screen.getByRole("status", { name: "Loading deal" })).toBeVisible();
    await screen.findByLabelText("Deal name");
    expect(screen.queryByRole("status", { name: "Loading deal" })).not.toBeInTheDocument();
  });

  it("says Deal not found, with a way back", async () => {
    renderDeal(createHarness(), "does-not-exist");
    expect(await screen.findByText("Deal not found")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Deals" })).toHaveAttribute("href", "/deals");
    expect(screen.queryByRole("navigation", { name: "Deal steps" })).not.toBeInTheDocument();
  });

  describe("a deal that cannot be read", () => {
    async function brokenDeal() {
      const { harness, deal } = await sampleSetup();
      const stored = JSON.parse(harness.storage.getItem(DEALS_KEY) as string) as Record<string, StoredDeal>;
      stored[deal.id] = { ...deal, inputs: { ...deal.inputs, loan: null as never } };
      harness.storage.setItem(DEALS_KEY, JSON.stringify(stored));
      return { harness, deal };
    }

    it("shows what is wrong and offers Delete this deal", async () => {
      const { harness, deal } = await brokenDeal();
      renderDeal(harness, deal.id);
      expect(await screen.findByText(/^This deal couldn't be read: /)).toHaveTextContent("loan");
      expect(screen.getByRole("button", { name: "Delete this deal" })).toBeEnabled();
      expect(screen.getByRole("link", { name: "Back to Deals" })).toBeVisible();
    });

    it("deletes it after a confirm, and goes back to the list", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await brokenDeal();
      renderDeal(harness, deal.id);
      await user.click(await screen.findByRole("button", { name: "Delete this deal" }));

      const dialog = screen.getByRole("alertdialog", { name: "Delete this deal? This can't be undone." });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByText(/^This deal couldn't be read: /)).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Delete this deal" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("heading", { name: "Deals list" })).toBeVisible();
      expect(Object.keys(JSON.parse(harness.storage.getItem(DEALS_KEY) as string))).toEqual([]);
    });

    it("says why when the deal cannot be deleted", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await brokenDeal();
      vi.spyOn(harness.repository, "deleteDeal").mockRejectedValueOnce(new Error("storage is locked"));
      renderDeal(harness, deal.id);
      await user.click(await screen.findByRole("button", { name: "Delete this deal" }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the deal: storage is locked");
      expect(screen.getByRole("button", { name: "Delete this deal" })).toBeEnabled();
    });
  });
});

describe("one editor per deal", () => {
  it("does not carry one deal's edits into the next", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    const other = await harness.repository.createDeal({ name: "Other", inputs: structuredClone(deal.inputs) });
    const router = createMemoryRouter(
      [
        {
          path: "/deals/:dealId",
          element: <DealRoute />,
          children: [{ path: "lot", element: <Controls /> }],
        },
      ],
      { initialEntries: [`/deals/${deal.id}/lot`] },
    );
    render(<RouterProvider router={router} />, { wrapper: harness.Providers });
    expect(await screen.findByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    await screen.findByText("Contingency is below 3%");

    await act(async () => {
      await router.navigate(`/deals/${other.id}/lot`);
    });
    await waitFor(() => expect(screen.getByLabelText("Deal name")).toHaveValue("Other"));
    expect(screen.queryByText("Contingency is below 3%")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
