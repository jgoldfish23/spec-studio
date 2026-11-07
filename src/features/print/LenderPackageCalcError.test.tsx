import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealInputs, EngineContext } from "@engine";
import { inputHash } from "../../lib/inputHash";
import { renderApp } from "../../testing/renderApp";
import { sampleSetup } from "../../testing/stepHarness";

// The engine is real except that it throws for chosen inputs (spec §8), as in the deal screens' calc-error tests.
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  control.throwWhen = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the lender package when the engine cannot calculate the deal", () => {
  it("says so, with why and the input hash, and offers no print and no sections", async () => {
    const { harness, deal } = await sampleSetup();
    control.throwWhen = () => true;
    renderApp(`#/deals/${deal.id}/print`, harness);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't calculate this deal")).toBeVisible();
    expect(within(alert).getByText("engine fell over")).toBeInTheDocument();
    expect(within(alert).getByText(`Input hash ${inputHash(deal.inputs)}`)).toBeInTheDocument();
    expect(screen.queryByText("This deal needs a few more details before it can be printed.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print or save as PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to the pro forma" })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/proforma`,
    );
  });
});
