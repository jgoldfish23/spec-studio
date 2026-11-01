import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inputHash } from "../lib/inputHash";
import { CalcErrorBoundary } from "./CalcErrorBoundary";

let failing = true;
function Fragile({ onRender }: { onRender?: () => void }) {
  onRender?.();
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

  it("tries again when resetOn changes, even though the input did not", () => {
    const view = render(
      <CalcErrorBoundary input={{ a: 1 }} resetOn="first">
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();
    failing = false;

    view.rerender(
      <CalcErrorBoundary input={{ a: 1 }} resetOn="first">
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();

    view.rerender(
      <CalcErrorBoundary input={{ a: 1 }} resetOn="second">
        <Fragile />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeVisible();
  });

  it("tries a changed input once, and does not loop when that fails too", () => {
    const rendered = vi.fn();
    const view = render(
      <CalcErrorBoundary input={1} resetOn="first">
        <Fragile onRender={rendered} />
      </CalcErrorBoundary>,
    );
    rendered.mockClear();
    view.rerender(
      <CalcErrorBoundary input={2} resetOn="second">
        <Fragile onRender={rendered} />
      </CalcErrorBoundary>,
    );
    expect(screen.getByText("Couldn't calculate")).toBeVisible();
    // One retry for the change (React itself renders a failing child twice), then it stays on the message.
    expect(rendered.mock.calls.length).toBeLessThanOrEqual(2);
    rendered.mockClear();
    view.rerender(
      <CalcErrorBoundary input={2} resetOn="second">
        <Fragile onRender={rendered} />
      </CalcErrorBoundary>,
    );
    expect(rendered).not.toHaveBeenCalled();
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
