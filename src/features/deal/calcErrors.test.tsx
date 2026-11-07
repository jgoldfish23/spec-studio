import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealInputs, EngineContext } from "@engine";
import { SAMPLE_DEAL_NAME } from "../../data/sample";
import { inputHash } from "../../lib/inputHash";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import { DealCrashBoundary } from "./DealCrashBoundary";
import { useDealEditorContext } from "./DealEditorContext";
import { DealRoute } from "./DealRoute";

// The engine is real except that a test can make it throw for chosen inputs (spec §8: an engine exception is caught,
// shown as "Couldn't calculate — details" with the input hash, and the deal stays usable).
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

  /** The engine failures the editor reported on the console. */
  const engineFailures = () =>
    vi.mocked(console.error).mock.calls.filter(([message]) => typeof message === "string" && message.startsWith("Couldn't calculate deal"));

  /** The inputs of `deal` moved to Boomtown, as the Controls button makes them. */
  function inBoomtown(inputs: DealInputs): DealInputs {
    const moved = structuredClone(inputs);
    moved.lot.city = "Boomtown";
    return moved;
  }

  it("keeps the header, tabs, Undo and the step when the engine throws on an edit, and says Couldn't calculate with the input hash", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = (inputs) => inputs.lot.city === "Boomtown";
    renderDeal(harness, deal.id, "lot");

    await user.click(await screen.findByRole("button", { name: "Move to Boomtown" }));
    const panel = await screen.findByRole("alert");
    expect(panel).toHaveTextContent("Couldn't calculate — details");
    expect(panel).toHaveTextContent("Undo your last change, or change an input to try again.");
    const details = within(panel).getByText("Couldn't calculate — details").closest("details") as HTMLElement;
    expect(details).toHaveTextContent("engine fell over");
    const hash = inputHash(inBoomtown(deal.inputs));
    expect(details).toHaveTextContent(`Input hash ${hash}`);
    expect(panel).not.toHaveTextContent(/unaffected/);

    // Everything around it still works: the name, the tabs, Undo, the step, and the strip and verdict, which show the
    // failed evaluation as a deal that cannot be worked out.
    expect(screen.getByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    expect(screen.getByRole("navigation", { name: "Deal steps" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move to Boomtown" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Deal summary" })).getAllByText("—")).toHaveLength(5);
    expect(screen.getByText("Needs info")).toBeVisible();

    // Logged once, with the hash, for whoever has to find the bug. The log is an effect that runs after the panel is
    // drawn, so on a slow machine it can land a moment later: wait for it.
    await waitFor(() =>
      expect(engineFailures()).toEqual([[expect.stringContaining(hash), expect.objectContaining({ message: "engine fell over" })]]),
    );
    // The edit is kept like any other: it is saved, so nothing the owner typed is lost.
    await waitFor(async () => expect((await harness.repository.getDeal(deal.id))?.inputs.lot.city).toBe("Boomtown"), { timeout: 3000 });
  });

  it("recovers on Undo without leaving the page, and logs a failure once however often it comes back", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = (inputs) => inputs.lot.city === "Boomtown";
    renderDeal(harness, deal.id, "lot");

    await user.click(await screen.findByRole("button", { name: "Move to Boomtown" }));
    expect(await screen.findByText("Couldn't calculate — details")).toBeVisible();
    // The first failure is logged by an effect after the panel is drawn: wait for it before going on.
    await waitFor(() => expect(engineFailures()).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Couldn't calculate — details")).not.toBeInTheDocument());
    expect(await screen.findByText(/^(Go|Marginal|No-go)$/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Move to Boomtown" })).toBeVisible();

    // The same inputs again: the panel is back, but the console already has this one.
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(await screen.findByText("Couldn't calculate — details")).toBeVisible();
    expect(engineFailures()).toHaveLength(1);
  });

  it("opens a stored deal the engine cannot evaluate, with Couldn't calculate shown and the fields still editable", async () => {
    const user = userEvent.setup();
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = () => true;
    renderApp(`#/deals/${deal.id}/lot`, harness);

    expect(await screen.findByText("Couldn't calculate — details")).toBeVisible();
    expect(screen.getByLabelText("Deal name")).toHaveValue(SAMPLE_DEAL_NAME);
    expect(screen.getByRole("navigation", { name: "Deal steps" })).toBeVisible();

    const city = await screen.findByLabelText("City");
    await user.clear(city);
    await user.type(city, "Layton");
    expect(city).toHaveValue("Layton");
    await waitFor(async () => expect((await harness.repository.getDeal(deal.id))?.inputs.lot.city).toBe("Layton"), { timeout: 3000 });
  });
});

describe("every step stays usable while the engine cannot evaluate the deal", () => {
  it.each([
    ["house", "Bedrooms"],
    ["estimate", "Contingency"],
    ["market", "Base sale price"],
    ["proforma", "Rate %"],
  ])("keeps the %s step's fields, with Couldn't calculate shown once", async (step, label) => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    control.throwWhen = () => true;
    renderApp(`#/deals/${deal.id}/${step}`, harness);

    expect(await screen.findByText("Couldn't calculate — details")).toBeVisible();
    expect(await screen.findByLabelText(label)).toBeVisible();
    // Only the deal's own panel speaks: no step-level boundary has taken the step's place.
    expect(screen.queryByText(/Change an input and it will try again/)).toBeNull();
  });
});

describe("a deal screen that cannot be drawn at all", () => {
  it("says something went wrong showing the deal, that the saved changes are kept, and links back to Deals", async () => {
    const router = createMemoryRouter(
      [
        { path: "/deals", element: <h1>Deals list</h1> },
        {
          path: "/deals/:dealId/lot",
          element: (
            <DealCrashBoundary>
              <Crash />
            </DealCrashBoundary>
          ),
        },
      ],
      { initialEntries: ["/deals/d1/lot"] },
    );
    render(<RouterProvider router={router} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong showing this deal.");
    expect(alert).toHaveTextContent("Your last saved changes are kept. Go back to Deals and open it again.");
    expect(alert).not.toHaveTextContent(/Change an input/i);
    expect(alert).not.toHaveTextContent(/Couldn't calculate/);
    const back = within(alert).getByRole("link", { name: "Back to Deals" });
    expect(back).toHaveAttribute("href", "/deals");
    await userEvent.click(back);
    expect(await screen.findByRole("heading", { name: "Deals list" })).toBeVisible();
  });
});
