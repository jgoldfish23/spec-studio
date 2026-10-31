import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inputHash } from "../lib/inputHash";
import { CalcErrorBoundary } from "./CalcErrorBoundary";

let failing = true;
function Fragile() {
  if (failing) throw new Error("the engine fell over");
  return <p>All good</p>;
}

beforeEach(() => {
  failing = true;
  // React reports an error caught by a boundary through console.error; the tests expect it.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CalcErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    failing = false;
    render(
      <CalcErrorBoundary input={{ a: 1 }}>
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeVisible();
    expect(screen.queryByText("Couldn't calculate")).not.toBeInTheDocument();
  });

  it("shows Couldn't calculate, with the message and the input hash in details", () => {
    render(
      <CalcErrorBoundary input={{ a: 1 }}>
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent("the engine fell over");
    expect(details).toHaveTextContent(`Input hash: ${inputHash({ a: 1 })}`);
    expect(screen.queryByText("All good")).not.toBeInTheDocument();
  });

  it("tries again when the input changes", () => {
    const view = render(
      <CalcErrorBoundary input={{ a: 1 }}>
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();
    failing = false;

    view.rerender(
      <CalcErrorBoundary input={{ a: 1 }}>
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();

    view.rerender(
      <CalcErrorBoundary input={{ a: 2 }}>
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeVisible();
  });

  it("does not remount healthy children when the input changes", () => {
    failing = false;
    const view = render(
      <CalcErrorBoundary input={1}>
        <input aria-label="kept" />
      </CalcErrorBoundary>,
    );
    const field = screen.getByLabelText("kept");
    view.rerender(
      <CalcErrorBoundary input={2}>
        <input aria-label="kept" />
      </CalcErrorBoundary>,
    );
    expect(screen.getByLabelText("kept")).toBe(field);
  });
});
