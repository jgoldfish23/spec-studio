import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";

const renderAt = (hash: string) => {
  window.location.hash = hash;
  return render(<App />);
};

describe("app shell", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("shows the brand link, the Deals link and the demo-mode pill", () => {
    renderAt("#/");
    const header = screen.getByRole("banner");
    const brand = within(header).getByRole("link", { name: "Spec Studio" });
    expect(brand).toHaveAttribute("href", "#/");
    const nav = within(header).getByRole("navigation", { name: "Main" });
    const deals = within(nav).getByRole("link", { name: "Deals" });
    expect(deals).toHaveAttribute("href", "#/");
    expect(deals).toHaveAttribute("aria-current", "page");
    expect(within(header).getByText("Demo mode · saved in this browser")).toBeVisible();
  });

  it.each(["Cost book", "Comps", "Plans", "Builds"])(
    "shows %s as an inert item with a Later tag, not a link",
    (name) => {
      renderAt("#/");
      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(within(nav).queryByRole("link", { name })).not.toBeInTheDocument();
      const item = within(nav).getByText(name);
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(within(item).getByText("Later")).toBeVisible();
    },
  );

  it("renders the Deals page at the root route", () => {
    renderAt("#/");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  });

  it("shows a not-found page with a link back to Deals for an unknown route", async () => {
    renderAt("#/nope");
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    const back = within(main).getByRole("link", { name: "Back to Deals" });
    expect(back).toHaveAttribute("href", "#/");
    expect(screen.getByRole("link", { name: "Spec Studio" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Deals", current: false })).toBeVisible();

    await userEvent.click(back);
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(window.location.hash).toBe("#/");
  });

  it("redirects a deal URL without a step to its Lot step", async () => {
    renderAt("#/deals/abc");
    expect(await screen.findByRole("heading", { level: 1, name: /Lot/ })).toBeVisible();
    expect(window.location.hash).toBe("#/deals/abc/lot");
    expect(screen.getByRole("link", { name: "Deals" })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["lot", "Lot"],
    ["house", "House"],
    ["estimate", "Estimate"],
    ["market", "Market"],
    ["proforma", "Pro forma"],
  ])("has a route for the %s step", (step, title) => {
    renderAt(`#/deals/abc/${step}`);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: new RegExp(title) })).toBeVisible();
  });

  it("mounts under StrictMode, as main.tsx does", () => {
    window.location.hash = "#/nope";
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  it("treats an unknown step as not found", () => {
    renderAt("#/deals/abc/garage");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});
