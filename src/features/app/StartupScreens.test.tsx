import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Loading, StartupProblem, UNREACHABLE } from "./StartupScreens";

// The one place the copy is checked word for word; other tests import it.
const COPY =
  "Can't reach Spec Studio's server. Check your connection, then try again.";

describe("UNREACHABLE", () => {
  it("is the copy Review Focus 5 names", () => {
    expect(UNREACHABLE).toBe(COPY);
  });
});

describe("Loading", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("waits with its label, busy, then after 15 s says it can't reach the server and offers Try again", async () => {
    const onRetry = vi.fn();
    render(<Loading onRetry={onRetry} />);
    expect(
      screen.getByText("Loading…").closest("[aria-busy='true']"),
    ).not.toBeNull();
    await advance(14_000);
    expect(screen.queryByText(COPY)).not.toBeInTheDocument();
    await advance(1_000);
    expect(screen.getByRole("alert")).toHaveTextContent(COPY);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("Try again tries again and waits another 15 s before saying so again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRetry = vi.fn();
    render(<Loading label="Signing out…" onRetry={onRetry} />);
    expect(screen.getByText("Signing out…")).toBeVisible();
    await advance(15_000);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Signing out…")).toBeVisible();
    await advance(14_000);
    expect(screen.queryByText(COPY)).not.toBeInTheDocument();
    await advance(1_000);
    expect(screen.getByText(COPY)).toBeVisible();
  });

  it("stops its timer when it goes away", async () => {
    const view = render(<Loading onRetry={vi.fn()} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("StartupProblem", () => {
  it("says what happened and offers the one thing to do, with the keyboard on it", async () => {
    const onAction = vi.fn();
    render(
      <StartupProblem
        title="Signed out"
        message="You've been signed out. Sign in again."
        action="Sign in"
        onAction={onAction}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Signed out" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You've been signed out. Sign in again.",
    );
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("has no button when there is nothing to do", () => {
    render(<StartupProblem title="Can't start" message="Not configured." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not configured.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
