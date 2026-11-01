import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalcErrorBoundary } from "../../ui/CalcErrorBoundary";
import { lazyStep } from "./lazyStep";
import { StepLoadFailed } from "./StepLoadFailed";

afterEach(() => {
  vi.restoreAllMocks();
});

function Loaded() {
  return <p>The screen</p>;
}

function ThrowsWhileDrawing(): never {
  throw new Error("a bug in drawing");
}

function renderStep(Step: ReturnType<typeof lazyStep>) {
  return render(
    <Suspense fallback={<p role="status">Loading step</p>}>
      <Step />
    </Suspense>,
  );
}

describe("lazyStep", () => {
  it("shows the screen once its code has loaded", async () => {
    const Step = lazyStep(() => Promise.resolve({ default: Loaded }));
    renderStep(Step);
    expect(screen.getByRole("status")).toHaveTextContent("Loading step");
    expect(await screen.findByText("The screen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the screen could not be loaded, with a Reload button, when the code cannot be fetched", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new TypeError("Failed to fetch dynamically imported module: /assets/HousePage.js");
    const Step = lazyStep(() => Promise.reject(failure));
    renderStep(Step);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this screen — reload the page");
    expect(alert).not.toHaveTextContent(/calculate/i);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    // The cause goes to the console for whoever has to find out why.
    expect(log).toHaveBeenCalledWith(expect.stringContaining("load"), failure);
    expect(screen.queryByText("The screen")).not.toBeInTheDocument();
  });

  it("is not an error that reaches an error boundary: the page around it keeps rendering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Step = lazyStep(() => Promise.reject(new Error("offline")));
    render(
      <>
        <nav aria-label="Tabs">Tabs stay</nav>
        <section aria-label="Failed fetch">
          <CalcErrorBoundary input="step">
            <Suspense fallback={null}>
              <Step />
            </Suspense>
          </CalcErrorBoundary>
        </section>
        {/* The same boundary does catch a screen that throws while drawing, so it is a real one. */}
        <section aria-label="Drawing bug">
          <CalcErrorBoundary input="crash">
            <ThrowsWhileDrawing />
          </CalcErrorBoundary>
        </section>
      </>,
    );
    const failed = screen.getByRole("region", { name: "Failed fetch" });
    expect(await within(failed).findByRole("alert")).toHaveTextContent("Couldn't load this screen — reload the page");
    expect(within(failed).queryByText("Couldn't calculate")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Drawing bug" })).getByText("Couldn't calculate")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Tabs" })).toBeInTheDocument();
  });
});

describe("StepLoadFailed", () => {
  it("reloads the page when Reload is pressed", async () => {
    const onReload = vi.fn();
    render(<StepLoadFailed onReload={onReload} />);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
