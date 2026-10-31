import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyStep } from "./lazyStep";
import { StepLoadFailed } from "./StepLoadFailed";

afterEach(() => {
  vi.restoreAllMocks();
});

function Loaded() {
  return <p>The screen</p>;
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
        <Suspense fallback={null}>
          <Step />
        </Suspense>
      </>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
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
