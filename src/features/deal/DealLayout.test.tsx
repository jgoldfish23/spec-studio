import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DEALS_KEY } from "../../data/local/localRepository";
import { MemoryStorage } from "../../data/local/memoryStorage";
import { createOfflineRepository } from "../../data/offline/offlineRepository";
import { RepositoryProvider } from "../../data/RepositoryProvider";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
import { DataError } from "../../data/types";
import type { StoredDeal } from "../../data/types";
import { createHarness, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";
import { sampleSetup } from "../../testing/stepHarness";
import { PercentField } from "../../ui/fields";
import { useDealEditorContext } from "./DealEditorContext";
import { DealRoute } from "./DealRoute";

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
      {editor.inputs ? (
        <PercentField
          label="Contingency"
          value={editor.inputs.contingencyPct}
          onChange={(value) =>
            editor.edit((draft) => {
              draft.contingencyPct = value;
            })
          }
        />
      ) : null}
      <p>{`Contingency now ${editor.inputs?.contingencyPct}`}</p>
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
  return { ...render(<RouterProvider router={router} />, { wrapper: harness.Providers }), router };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 31, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

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
    // A routine status is read where it is, not announced.
    const status = screen.getByText("Saved");
    expect(status).not.toHaveAttribute("aria-live");
    expect(status.closest("[aria-live]")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
      expect(links.map((link) => link.textContent)).toEqual(["City: Required", "County: Required", "Acres: Must be 0 or more"]);
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

    it("keeps a name still being typed when the page is closed, and saves it before the page goes", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      renderDeal(harness, deal.id);
      const name = await screen.findByLabelText("Deal name");

      await user.clear(name);
      await user.type(name, "  Birch Court ");
      expect(name).toHaveFocus();
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      // Written while the page was still there: no timer has had a chance to run.
      const stored = JSON.parse(harness.storage.getItem(DEALS_KEY) as string) as Record<string, StoredDeal>;
      expect(stored[deal.id]?.name).toBe("Birch Court");
    });

    it("leaves the name alone on pagehide when the box is blank or unchanged", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      const save = vi.spyOn(harness.repository, "saveDeal");
      renderDeal(harness, deal.id);
      const name = await screen.findByLabelText("Deal name");

      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await user.clear(name);
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      expect(save).not.toHaveBeenCalled();
      expect((await harness.repository.getDeal(deal.id))?.name).toBe(SAMPLE_DEAL_NAME);
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
      expect(screen.getByText("Unsaved changes").closest("[aria-live]")).toBeNull();
      await screen.findByText("Saved", undefined, { timeout: 3000 });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect((await harness.repository.getDeal(deal.id))?.inputs.contingencyPct).toBe(0.02);
    });

    it("says it could not save, with the reason, and that it will retry", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      const save = vi.spyOn(harness.repository, "saveDeal");
      save.mockRejectedValueOnce(new Error("disk is full"));
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      // Announced: a failure is the one save status the owner must hear about.
      const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
      expect(alert).toHaveTextContent("Couldn't save — retrying: disk is full");
      expect(alert.closest("[aria-live]")).toBeNull();
      // Once the retry works, the alert is gone and the status is quiet again.
      expect(await screen.findByText("Saved", undefined, { timeout: 7000 })).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }, 10_000);

    it("does not say Couldn't save twice when the reason starts that way", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      const save = vi.spyOn(harness.repository, "saveDeal");
      save.mockRejectedValueOnce(new Error("Couldn't save — browser storage is full or unavailable"));
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      const status = await screen.findByText("Couldn't save — retrying", undefined, { timeout: 3000 });
      expect(status.textContent).toBe("Couldn't save — retrying: browser storage is full or unavailable");
    });

    it("shows just the retry notice when the reason is only Couldn't save", async () => {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      const save = vi.spyOn(harness.repository, "saveDeal");
      save.mockRejectedValueOnce(new Error("Couldn't save"));
      renderDeal(harness, deal.id);
      await screen.findByLabelText("Deal name");

      await user.click(screen.getByRole("button", { name: "Lower contingency" }));
      const status = await screen.findByText("Couldn't save — retrying", undefined, { timeout: 3000 });
      expect(status.textContent).toBe("Couldn't save — retrying");
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

describe("DealLayout when the deal can't be opened right now", () => {
  const offline = () => new DataError("Can't reach the server — check your connection.", { kind: "offline" });

  it("offers Try again and Back to Deals, never Delete, when the deal can't be read offline; Try again opens it", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, "getDeal").mockRejectedValueOnce(offline());
    renderDeal(harness, deal.id);
    expect(await screen.findByRole("heading", { name: "Can't open this deal right now" })).toBeVisible();
    expect(screen.getByText("Can't reach the server — check your connection.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete this deal" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Deals" })).toHaveAttribute("href", "/deals");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
  });

  it.each([
    ["the cost book", "getCostBook"],
    ["the comps", "listComps"],
    ["the market settings", "getMarketSettings"],
  ] as const)("is calm when %s can't be read, and Try again opens the deal", async (_name, method) => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, method).mockRejectedValueOnce(offline());
    renderDeal(harness, deal.id);
    expect(await screen.findByRole("heading", { name: "Can't open this deal right now" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete this deal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
  });

  it.each([
    ["signed out", new DataError("You've been signed out.", { kind: "signedOut" })],
    ["refused by the server", new DataError("Couldn't load — the server said no. Try again in a minute.", { kind: "failed" })],
    ["not a DataError", new Error("Something broke")],
  ])("offers no Delete when the deal's read is %s", async (_name, error) => {
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, "getDeal").mockRejectedValueOnce(error);
    renderDeal(harness, deal.id);
    expect(await screen.findByRole("heading", { name: "Can't open this deal right now" })).toBeVisible();
    expect(screen.getByText(error.message)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete this deal" })).not.toBeInTheDocument();
  });

  it("offers no Delete when what can't be read is the comps, not the deal", async () => {
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, "listComps").mockRejectedValueOnce(
      new DataError("Your saved comps couldn't be read.", { recordId: "*" }),
    );
    renderDeal(harness, deal.id);
    expect(await screen.findByRole("heading", { name: "Can't open this deal right now" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete this deal" })).not.toBeInTheDocument();
  });

  it("still offers Delete when the deal's own record is unreadable", async () => {
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, "getDeal").mockRejectedValueOnce(
      new DataError(`Deal ${deal.id} is unreadable: inputs.loan: expected object`, { recordId: deal.id }),
    );
    renderDeal(harness, deal.id);
    expect(await screen.findByText(/^This deal couldn't be read: /)).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete this deal" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Can't open this deal right now" })).not.toBeInTheDocument();
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

describe("DealLayout save problems", () => {
  /** The harness with an outbox in front of its repository, as the hosted app has. */
  async function withOutbox() {
    const { harness: plain, deal } = await sampleSetup();
    const offline = createOfflineRepository(plain.repository, new MemoryStorage(), "u");
    const Providers = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={plain.client}>
        <RepositoryProvider repository={offline}>{children}</RepositoryProvider>
      </QueryClientProvider>
    );
    return { harness: { ...plain, repository: offline, Providers } as Harness, deal, remote: plain.repository, offline };
  }

  async function failing(error: DataError, outbox = true) {
    const user = userEvent.setup();
    const plain = await sampleSetup();
    const { harness, deal, remote } = outbox
      ? await withOutbox()
      : { harness: plain.harness, deal: plain.deal, remote: plain.harness.repository };
    const save = vi.spyOn(remote, "saveDeal");
    save.mockRejectedValueOnce(error);
    const view = renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    return { user, harness, deal, save, view };
  }
  const OFFLINE = "Offline — saved on this device, will sync";
  const SIGNED_OUT = "Signed out — sign in to sync. Your changes are saved on this device.";

  it("shows offline as a calm note, not an alert", async () => {
    await failing(new DataError("x", { kind: "offline" }));
    expect(await screen.findByText(OFFLINE, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
  });

  it("shows signed out as a note with a Sign in link", async () => {
    await failing(new DataError("x", { kind: "signedOut" }));
    expect(await screen.findByText(SIGNED_OUT, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("without an outbox, offline keeps Plan 2's copy", async () => {
    await failing(new DataError("Can't reach the server", { kind: "offline" }), false);
    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent("Couldn't save — retrying: Can't reach the server");
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });

  it("keeps Plan 2's copy for other failures", async () => {
    await failing(new DataError("The server said no", { kind: "failed" }));
    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent("Couldn't save — retrying: The server said no");
  });


  it("offers Load their version and Keep mine on a conflict, and Keep mine saves with overwrite", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    const real = harness.repository.saveDeal.bind(harness.repository);
    const save = vi.spyOn(harness.repository, "saveDeal");
    save.mockRejectedValueOnce(new DataError("This deal was changed on another device or tab.", { kind: "conflict" }));
    save.mockImplementation(real);
    renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));

    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent("This deal was changed on another device or tab.");
    expect(within(alert).getByRole("button", { name: "Load their version" })).toBeVisible();
    await user.click(within(alert).getByRole("button", { name: "Keep mine" }));
    await screen.findByText("Saved", undefined, { timeout: 3000 });
    expect(save).toHaveBeenLastCalledWith(expect.anything(), { overwrite: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect((await harness.repository.getDeal(deal.id))?.inputs.contingencyPct).toBe(0.02);
  });

  it("Load their version shows the stored deal and clears undo", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    const save = vi.spyOn(harness.repository, "saveDeal");
    save.mockRejectedValueOnce(new DataError("This deal was changed on another device or tab.", { kind: "conflict" }));
    renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    expect(await screen.findByRole("button", { name: "Load their version" }, { timeout: 3000 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByText("Contingency now 0.02")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Load their version" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText("Contingency now 0.02")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByText("Saved")).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("deleted: Save as a new deal keeps the edits on the same step; Discard goes to Deals", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    const save = vi.spyOn(harness.repository, "saveDeal");
    save.mockRejectedValue(new DataError("This deal was deleted on another device or tab.", { kind: "deleted" }));
    const view = renderDeal(harness, deal.id, "house");
    // The house step has no controls here: edit the name instead.
    await user.clear(await screen.findByLabelText("Deal name"));
    await user.type(screen.getByLabelText("Deal name"), "Rescued deal");
    await user.tab();
    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent("This deal was deleted on another device or tab.");
    expect(within(alert).getByRole("button", { name: "Discard my changes" })).toBeVisible();

    await user.click(within(alert).getByRole("button", { name: "Save as a new deal" }));
    await waitFor(() => expect(view.router.state.location.pathname).toMatch(/^\/deals\/[^/]+\/house$/));
    expect(view.router.state.location.pathname).not.toContain(deal.id);
    expect(await screen.findByLabelText("Deal name")).toHaveValue("Rescued deal");
    expect(screen.getByText("House step")).toBeVisible();
    const { deals } = await harness.repository.listDeals();
    expect(deals.find((d) => d.name === "Rescued deal")).toBeDefined();
  });

  it("deleted: Discard my changes goes to Deals and nothing is saved again", async () => {
    const user = userEvent.setup();
    const { harness, deal } = await sampleSetup();
    const save = vi.spyOn(harness.repository, "saveDeal");
    save.mockRejectedValue(new DataError("This deal was deleted on another device or tab.", { kind: "deleted" }));
    const view = renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    await user.click(within(alert).getByRole("button", { name: "Discard my changes" }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/deals"));
    expect(await screen.findByRole("heading", { name: "Deals list" })).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a failed Load their version says so in the panel, and the choice stays", async () => {
    const user = userEvent.setup();
    const { harness, deal, remote, offline } = await withOutbox();
    vi.spyOn(remote, "saveDeal").mockRejectedValueOnce(
      new DataError("This deal was changed on another device or tab.", { kind: "conflict" }),
    );
    renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    await screen.findByRole("button", { name: "Load their version" }, { timeout: 3000 });
    expect(offline.pending()).toHaveLength(1);

    const real = harness.repository.getDeal;
    harness.repository.getDeal = async () => {
      throw new Error("no signal");
    };
    await user.click(screen.getByRole("button", { name: "Load their version" }));
    expect(await screen.findByText("Couldn't load their version — no signal. Try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeEnabled();
    expect(offline.pending()).toHaveLength(1);
    harness.repository.getDeal = real;
  });

  it("deleted: Discard my changes clears the outbox entry", async () => {
    const user = userEvent.setup();
    const { harness, deal, remote, offline } = await withOutbox();
    vi.spyOn(remote, "saveDeal").mockRejectedValue(
      new DataError("This deal was deleted on another device or tab.", { kind: "deleted" }),
    );
    renderDeal(harness, deal.id);
    await screen.findByLabelText("Deal name");
    await user.click(screen.getByRole("button", { name: "Lower contingency" }));
    const alert = await screen.findByRole("alert", undefined, { timeout: 3000 });
    expect(offline.pending().map((p) => p.dealId)).toEqual([deal.id]);
    await user.click(within(alert).getByRole("button", { name: "Discard my changes" }));
    await waitFor(() => expect(offline.pending()).toHaveLength(0));
  });

  describe("while a version is being chosen", () => {
    /** A conflict on a land-price edit, then Load their version held open on a gated read. */
    async function loading(outcome: "fail" | "succeed") {
      const user = userEvent.setup();
      const { harness, deal } = await sampleSetup();
      vi.spyOn(harness.repository, "saveDeal").mockRejectedValueOnce(
        new DataError("This deal was changed on another device or tab.", { kind: "conflict" }),
      );
      renderDeal(harness, deal.id);
      const field = await screen.findByLabelText("Contingency");
      const before = (field as HTMLInputElement).value;
      await user.click(screen.getByRole("button", { name: "Raise land price" }));
      await screen.findByRole("button", { name: "Load their version" }, { timeout: 3000 });

      const real = harness.repository.getDeal.bind(harness.repository);
      let settle: () => void = () => {};
      const gate = new Promise<void>((resolve) => (settle = resolve));
      harness.repository.getDeal = async (id) => {
        await gate;
        if (outcome === "fail") throw new Error("no signal");
        return real(id);
      };
      await user.click(screen.getByRole("button", { name: "Load their version" }));
      return { field, before, settle, harness };
    }

    it("makes the step inert and busy, and lifts both afterwards", async () => {
      const { settle } = await loading("succeed");
      const container = screen.getByLabelText("Contingency").closest("[inert]");
      expect(container).not.toBeNull();
      expect(container).toHaveAttribute("aria-busy", "true");
      settle();
      await waitFor(() => expect(screen.getByLabelText("Contingency").closest("[inert]")).toBeNull());
    });

    it("shows the deal's value, not leftover text, after a failed read", async () => {
      const { before, settle } = await loading("fail");
      fireEvent.change(screen.getByLabelText("Contingency"), { target: { value: "9" } });
      settle();
      await screen.findByText("Couldn't load their version — no signal. Try again.");
      expect(screen.getByLabelText("Contingency")).toHaveValue(before);
    });

    it("shows the deal's value after a successful read whose value matches the old one", async () => {
      const { before, settle } = await loading("succeed");
      fireEvent.change(screen.getByLabelText("Contingency"), { target: { value: "9" } });
      settle();
      await waitFor(() => expect(screen.queryByRole("button", { name: "Load their version" })).not.toBeInTheDocument());
      expect(screen.getByLabelText("Contingency")).toHaveValue(before);
    });
  });
});
