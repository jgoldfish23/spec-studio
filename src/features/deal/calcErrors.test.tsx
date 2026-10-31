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
import { resetLostSaves } from "./lostSaves";

// The engine is real except that a test can make it throw for chosen inputs (spec §8: an engine exception is
// caught at the screen boundary and the data is unaffected).
const control = vi.hoisted(() => ({ throwWhen: null as null | ((inputs: DealInputs) => boolean) }));
vi.mock("@engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@engine")>();
  return {
    ...actual,
    evaluateDeal: (inputs: DealInputs, context: EngineContext) => {
      if (control.throwWhen?.(inputs)) throw new Error("engine fell over");
      return actual.evaluateDeal(inputs, context);
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
  resetLostSaves();
});

describe("the Deals page", () => {
  it("shows Couldn't calculate for a deal the engine cannot evaluate and keeps the others", async () => {
    const harness = createHarness();
    const sample = await seedSampleDeal(harness.repository);
    const boom = structuredClone(sample.inputs);
    boom.lot.city = "Boomtown";
    await harness.repository.createDeal({ name: "Boom deal", inputs: boom });
    control.throwWhen = (inputs) => inputs.lot.city === "Boomtown";
    renderApp("#/", harness);

    const goodRow = (await screen.findByRole("link", { name: SAMPLE_DEAL_NAME })).closest("tr") as HTMLElement;
    const badRow = (await screen.findByRole("link", { name: "Boom deal" })).closest("tr") as HTMLElement;
    expect(within(badRow).getByText("Couldn't calculate")).toBeVisible();
    expect(within(badRow).queryByText(/^(Go|Marginal|No-go|Needs info)$/)).not.toBeInTheDocument();
    expect(within(goodRow).getByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
    expect(within(goodRow).queryByText("Couldn't calculate")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New deal" })).toBeEnabled();
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
