import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealInputs, EngineContext } from "@engine";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import { useDealEditorContext } from "./DealEditorContext";
import { DealRoute } from "./DealRoute";

// The engine is real except that a test can make it throw for chosen inputs (spec §8: an engine exception is
// caught at the screen boundary and the data is unaffected).
const control = vi.hoisted(() => ({ throwWhen: null as null | ((inputs: DealInputs) => boolean) }));
vi.mock("@engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@engine")>();
  return {
    ...actual,
    evaluateDeal: (inputs: DealInputs, context: EngineContext) => {
      if (control.throwWhen?.(inputs)) throw new Error("engine fell over");
      // Tagged with the city it was made for, so a screen can tell which evaluation it is drawing.
      return { ...actual.evaluateDeal(inputs, context), tag: inputs.lot.city };
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 31, 12) });
  // React reports an error caught by a boundary through console.error; these tests expect it.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  control.throwWhen = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the Deals page", () => {
  const calcFailures = () =>
    vi.mocked(console.error).mock.calls.filter(([message]) => typeof message === "string" && message.startsWith("Couldn't"));

  it("shows Couldn't calculate for a deal the engine cannot evaluate, says why, and keeps the others", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const boom = structuredClone(sample.inputs);
    boom.lot.city = "Boomtown";
    const bad = await harness.repository.createDeal({ name: "Boom deal", inputs: boom });
    control.throwWhen = (inputs) => inputs.lot.city === "Boomtown";
    renderApp("#/deals", harness);

    const goodRow = (await screen.findByRole("link", { name: SAMPLE_DEAL_NAME })).closest("tr") as HTMLElement;
    const badRow = (await screen.findByRole("link", { name: "Boom deal" })).closest("tr") as HTMLElement;
    expect(within(badRow).getByText("Couldn't calculate")).toBeVisible();
    expect(within(badRow).getByText("engine fell over")).toBeInTheDocument();
    expect(within(badRow).queryByText(/^(Go|Marginal|No-go|Needs info)$/)).not.toBeInTheDocument();
    expect(within(goodRow).getByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
    expect(within(goodRow).queryByText("Couldn't calculate")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New deal" })).toBeEnabled();

    // The reason is also logged, once for this failure and not again when the list is drawn again.
    expect(calcFailures()).toEqual([[`Couldn't calculate deal ${bad.id}: engine fell over`]]);
    await harness.client.invalidateQueries({ queryKey: ["deals"] });
    await screen.findByRole("link", { name: "Boom deal" });
    expect(calcFailures()).toHaveLength(1);
  });

  it("marks every deal of a region Couldn't calculate, with the reason, when that region's prices cannot be read", async () => {
    const harness = createHarness();
    await seedSampleDeal(harness.repository);
    const other = structuredClone((await harness.repository.listDeals()).deals[0]!.inputs);
    await harness.repository.createDeal({ name: "Second deal", inputs: other });
    vi.spyOn(harness.repository, "getCostBook").mockRejectedValue(new Error("cost book unreadable"));
    renderApp("#/deals", harness);

    for (const name of [SAMPLE_DEAL_NAME, "Second deal"]) {
      const row = (await screen.findByRole("link", { name })).closest("tr") as HTMLElement;
      await waitFor(() => expect(within(row).getByText("Couldn't calculate")).toBeVisible());
      expect(within(row).getByText("cost book unreadable")).toBeInTheDocument();
    }
    // One message for the region, not one per deal.
    expect(calcFailures()).toEqual([["Couldn't read the prices and comps for utah-north: cost book unreadable"]]);
  });
});

function Controls() {
  const editor = useDealEditorContext();
  return (
    <button
      type="button"
      onClick={() =>
        editor.edit((draft) => {
          draft.lot.city = "Boomtown";
        })
      }
    >
      Move to Boomtown
    </button>
  );
}

/** A step that cannot draw one particular evaluation: the one tagged with the city Boomtown. */
function Guard() {
  const { evaluation } = useDealEditorContext();
  if ((evaluation as { tag?: string } | undefined)?.tag === "Boomtown") throw new Error("this evaluation cannot be drawn");
  return <p>Guard is happy</p>;
}

function Crash(): never {
  throw new Error("the step could not draw");
}

function renderDeal(harness: ReturnType<typeof createHarness>, id: string, step: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/deals/:dealId",
        element: <DealRoute />,
        children: [
          { path: "lot", element: <Controls /> },
          { path: "house", element: <Crash /> },
          {
            path: "market",
            element: (
              <>
                <Controls />
                <Guard />
              </>
            ),
          },
        ],
      },
    ],
    { initialEntries: [`/deals/${id}/${step}`] },
  );
  return render(<RouterProvider router={router} />, { wrapper: harness.Providers });
}

describe("a deal screen", () => {
  it("keeps the header and tabs when a step cannot draw, and recovers on another step", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderDeal(harness, deal.id, "house");

    expect(await screen.findByText("Couldn't calculate")).toBeVisible();
    expect(screen.getByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    expect(screen.getByRole("region", { name: "Deal summary" })).toBeVisible();
    expect(screen.getByText("the step could not draw")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Lot" }));
    expect(await screen.findByRole("button", { name: "Move to Boomtown" })).toBeVisible();
    expect(screen.queryByText("Couldn't calculate")).not.toBeInTheDocument();
  });

  it("tries a failing step again when the evaluation catches up with an undo, without changing tabs", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderDeal(harness, deal.id, "market");

    // The edit's evaluation arrives 150 ms later, and the step cannot draw it.
    await user.click(await screen.findByRole("button", { name: "Move to Boomtown" }));
    expect(await screen.findByText("Couldn't calculate")).toBeVisible();

    // Undo changes the inputs at once, but the step is handed the same evaluation until the new one arrives, and
    // fails on it again. When that one arrives the step must be tried again, though the inputs have not changed since.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Guard is happy")).toBeVisible();
    expect(screen.queryByText("Couldn't calculate")).not.toBeInTheDocument();
  });

  it("shows Couldn't calculate with details when the engine throws while editing, and the edit is still saved", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = (inputs) => inputs.lot.city === "Boomtown";
    renderDeal(harness, deal.id, "lot");

    await user.click(await screen.findByRole("button", { name: "Move to Boomtown" }));
    expect(await screen.findByText("Couldn't calculate")).toBeVisible();
    const details = screen.getByText("Details").closest("details") as HTMLElement;
    expect(details).toHaveTextContent("engine fell over");
    expect(details).toHaveTextContent(/Input hash: [0-9a-f]{8}/);

    // The editor unmounted on the way out and saved what was waiting at once, well before the 1 s autosave would have.
    await waitFor(async () => expect((await harness.repository.getDeal(deal.id))?.inputs.lot.city).toBe("Boomtown"), { timeout: 800 });
    expect(screen.queryByText(/Couldn't save your last changes/)).not.toBeInTheDocument();
  });

  it("shows Couldn't calculate for a stored deal the engine cannot evaluate, and the app around it still works", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = () => true;
    renderDeal(harness, deal.id, "lot");
    expect(await screen.findByText("Couldn't calculate")).toBeVisible();
    expect(screen.queryByLabelText("Deal name")).not.toBeInTheDocument();
    expect((await harness.repository.getDeal(deal.id))?.name).toBe(SAMPLE_DEAL_NAME);
  });
});
