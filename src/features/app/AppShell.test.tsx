import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import { reportLostSave } from "../deal/lostSaves";

const renderAt = (hash: string) => renderApp(hash);

describe("app shell", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("shows the brand link, the Deals link and the demo-mode pill", () => {
    renderAt("#/deals");
    const header = screen.getByRole("banner");
    const brand = within(header).getByRole("link", { name: "Spec Studio" });
    expect(brand).toHaveAttribute("href", "#/deals");
    const nav = within(header).getByRole("navigation", { name: "Main" });
    const deals = within(nav).getByRole("link", { name: "Deals" });
    expect(deals).toHaveAttribute("href", "#/deals");
    expect(deals).toHaveAttribute("aria-current", "page");
    expect(within(header).getByText("Demo mode · saved in this browser")).toBeVisible();
  });

  it("says nothing is saved when the browser blocks storage", async () => {
    window.location.hash = "#/deals";
    render(<App persistentStorage={false} />, { wrapper: createHarness().Providers });
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Demo mode · not saved — this browser blocks storage")).toBeVisible();
    expect(within(header).queryByText("Demo mode · saved in this browser")).not.toBeInTheDocument();
    // The app still works: the Deals page is there to use.
    expect(await screen.findByRole("button", { name: "New deal" })).toBeEnabled();
  });

  it.each(["Cost book", "Comps", "Plans", "Builds"])(
    "shows %s as an inert item with a Later tag, not a link",
    (name) => {
      renderAt("#/deals");
      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(within(nav).queryByRole("link", { name })).not.toBeInTheDocument();
      const item = within(nav).getByText(name);
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(within(item).getByText("Later")).toBeVisible();
    },
  );

  it("renders the Deals page at #/deals", () => {
    renderAt("#/deals");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  });

  it("sends the root address to #/deals, so the list has one address", async () => {
    renderAt("#/");
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(window.location.hash).toBe("#/deals");
  });

  it("shows a not-found page with a link back to Deals for an unknown route", async () => {
    renderAt("#/nope");
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    const back = within(main).getByRole("link", { name: "Back to Deals" });
    expect(back).toHaveAttribute("href", "#/deals");
    expect(screen.getByRole("link", { name: "Spec Studio" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Deals", current: false })).toBeVisible();

    await userEvent.click(back);
    expect(await screen.findByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
    expect(window.location.hash).toBe("#/deals");
  });

  it("redirects a deal URL without a step to its Lot step", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}`, harness);
    expect(await screen.findByRole("heading", { level: 1, name: /Lot/ })).toBeVisible();
    expect(window.location.hash).toBe(`#/deals/${deal.id}/lot`);
    expect(screen.getByRole("link", { name: "Deals" })).toHaveAttribute("aria-current", "page");
  });

  it("has a route for the lot step, with its screen", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/lot`, harness);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "Lot" })).toBeInTheDocument();
    expect(await within(main).findByLabelText("City")).toHaveValue("Kaysville");
    expect(within(main).queryByText("This step is being built.")).not.toBeInTheDocument();
  });

  it("has a route for the house step, with its screen", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/house`, harness);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "House" })).toBeInTheDocument();
    expect(await within(main).findByLabelText("Main finished sf")).toHaveValue("2,200");
    expect(within(main).queryByText("This step is being built.")).not.toBeInTheDocument();
  });

  it("has a route for the estimate step, with its screen", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/estimate`, harness);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "Estimate" })).toBeInTheDocument();
    expect(await within(main).findByRole("table", { name: "Cost lines by division" })).toBeInTheDocument();
    expect(within(main).queryByText("This step is being built.")).not.toBeInTheDocument();
  });

  it("has a route for the market step, with its screen", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/market`, harness);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "Market" })).toBeInTheDocument();
    expect(await within(main).findByRole("table", { name: "Comps ranked by match" })).toBeInTheDocument();
    expect(within(main).queryByText("This step is being built.")).not.toBeInTheDocument();
  });

  it("has a route for the pro forma step, with its screen", async () => {
    const harness = createHarness();
    const deal = await seedSampleDeal(harness.repository);
    renderApp(`#/deals/${deal.id}/proforma`, harness);
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("heading", { level: 1, name: "Pro forma" })).toBeInTheDocument();
    expect(await within(main).findByRole("table", { name: "Profit waterfall" })).toBeInTheDocument();
    expect(within(main).queryByText("This step is being built.")).not.toBeInTheDocument();
  });

  it("mounts under StrictMode, as main.tsx does", () => {
    window.location.hash = "#/nope";
    const harness = createHarness();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
      { wrapper: harness.Providers },
    );
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  it("treats an unknown step as not found", () => {
    renderAt("#/deals/abc/garage");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  describe("the Deals link", () => {
    it.each(["#/", "#/deals", "#/deals/abc", "#/deals/abc/lot", "#/deals/abc/proforma"])(
      "is the current page at %s",
      (hash) => {
        renderAt(hash);
        expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Deals" })).toHaveAttribute(
          "aria-current",
          "page",
        );
      },
    );

    it.each(["#/nope", "#/dealsfoo", "#/deals/abc/garage", "#/deals/abc/lot/extra"])(
      "is not the current page on the not-found address %s",
      (hash) => {
        renderAt(hash);
        expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
        expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Deals" })).not.toHaveAttribute(
          "aria-current",
        );
      },
    );
  });

  describe("edits that could not be saved", () => {
    it("shows nothing when nothing was lost", () => {
      renderAt("#/deals");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a dismissible banner above the page for each deal whose last changes were lost", async () => {
      const user = userEvent.setup();
      renderAt("#/deals");
      act(() => {
        reportLostSave({ dealId: "d1", dealName: "Maple Street", message: "browser storage is full" });
        reportLostSave({ dealId: "d2", dealName: "Oak Hollow", message: "storage is blocked" });
      });

      const alerts = await screen.findAllByRole("alert");
      expect(alerts).toHaveLength(2);
      expect(alerts[0]).toHaveTextContent("Couldn't save your last changes to Maple Street: browser storage is full");
      expect(alerts[1]).toHaveTextContent("Couldn't save your last changes to Oak Hollow: storage is blocked");
      const heading = screen.getByRole("heading", { level: 1, name: "Deals" });
      expect(alerts[0]?.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

      await user.click(within(alerts[0] as HTMLElement).getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
      expect(screen.queryByText(/Maple Street/)).not.toBeInTheDocument();
      expect(screen.getByText(/Oak Hollow/)).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not say Couldn't save twice when the reason already starts that way", () => {
      renderAt("#/deals");
      act(() => {
        reportLostSave({ dealId: "d1", dealName: "Maple Street", message: "Couldn't save — browser storage is full or unavailable" });
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        /^Couldn't save your last changes to Maple Street: browser storage is full or unavailable/,
      );
    });
  });
});
