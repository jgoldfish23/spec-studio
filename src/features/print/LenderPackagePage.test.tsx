import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DealInputs } from "@engine";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../data/local/memoryStorage";
import { createOfflineRepository } from "../../data/offline/offlineRepository";
import { RepositoryProvider } from "../../data/RepositoryProvider";
import { sampleDealInputs, SAMPLE_DEAL_NAME } from "../../data/sample";
import { DataError } from "../../data/types";
import { formatDays, formatMoney, formatPercent } from "../../lib/format";
import { advance, installFakeClock } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import { renderApp } from "../../testing/renderApp";
import { TEST_SAMPLE_IDS } from "../../testing/sampleIds";
import { newDealSetup, sampleSetup, setupWith } from "../../testing/stepHarness";
import type { Harness } from "../../testing/renderApp";
import type { StoredDeal } from "../../data/types";
import { houseLine } from "../deals/houseLine";
import { checkLine, verdictHeadline } from "../proforma/verdictText";

installFakeClock();

afterEach(() => {
  vi.restoreAllMocks();
});

const HEADINGS = [
  "Deal summary",
  "Verdict and rules",
  "Scenarios",
  "Estimate by division",
  "Market estimate and comps used",
  "Timeline",
  "Monthly cash flow (base case)",
  "Assumptions",
];

async function openPrint(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/print`, harness);
  // Something only the print page shows.
  await screen.findByRole("heading", { level: 2, name: "Deal summary" });
}

const section = (name: string) => screen.getByRole("region", { name });

describe("the lender package", () => {
  it("is headed by the deal's name, with the eight sections in order, and none of the app's chrome", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SAMPLE_DEAL_NAME);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(HEADINGS);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("summarises the lot, the house and the region", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const inputs = sampleDealInputs();

    const summary = section("Deal summary");
    expect(summary).toHaveTextContent(`${inputs.lot.city}, ${inputs.lot.county}`);
    expect(summary).toHaveTextContent(`${inputs.lot.acres} acres`);
    expect(summary).toHaveTextContent(formatMoney(inputs.lot.priceCents));
    expect(summary).toHaveTextContent(houseLine(inputs.house));
    expect(summary).toHaveTextContent("Northern Utah (Davis & Weber)");
  });

  it("gives the verdict, its headline and one line for each of the rules", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const { verdict } = await evaluated();

    const panel = section("Verdict and rules");
    expect(within(panel).getByText(verdictHeadline(verdict.kind))).toBeVisible();
    expect(verdict.checks).toHaveLength(3);
    const lines = within(within(panel).getByRole("list", { name: "Rule checks" })).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual(verdict.checks.map(checkLine));
  });

  it("tabulates the three scenarios, Downside | Base | Upside, with the seven rows", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const evaluation = await evaluated();
    if (evaluation.scenarios.status !== "ok") throw new Error("incomplete");
    const { downside, base, upside } = evaluation.scenarios.value;

    const table = within(section("Scenarios")).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Measure", "Downside", "Base", "Upside"]);
    const rowNames = within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);
    expect(rowNames).toEqual([
      "Sale price",
      "Total project cost",
      "Profit",
      "Margin on sale",
      "Annualized return",
      "Days on market",
      "Months",
    ]);
    const cells = (name: string) =>
      within(within(table).getByRole("rowheader", { name }).closest("tr") as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    const all = [downside, base, upside];
    expect(cells("Sale price")).toEqual(all.map((s) => formatMoney(s.metrics.salePriceCents)));
    expect(cells("Total project cost")).toEqual(all.map((s) => formatMoney(s.metrics.totalProjectCostCents)));
    expect(cells("Profit")).toEqual(all.map((s) => formatMoney(s.metrics.profitCents)));
    expect(cells("Margin on sale")).toEqual(all.map((s) => formatPercent(s.metrics.marginOnSale)));
    expect(cells("Annualized return")).toEqual(all.map((s) => formatPercent(s.metrics.annualizedReturn)));
    expect(cells("Days on market")).toEqual(all.map((s) => formatDays(s.inputs.domDays)));
    expect(cells("Months")).toEqual(all.map((s) => s.metrics.monthsLandToClose.toFixed(1)));
  });

  it("shows each division's subtotal and source mix, then the contingency and the total", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const evaluation = await evaluated();
    if (evaluation.estimate.status !== "ok") throw new Error("incomplete");
    const estimate = evaluation.estimate.value;

    const table = within(section("Estimate by division")).getByRole("table");
    const siteRow = within(table).getByRole("rowheader", { name: "Site" }).closest("tr") as HTMLElement;
    expect(siteRow).toHaveTextContent(formatMoney(estimate.divisionSubtotals.site));
    // The mix is a share of the division's cost, by where each price came from.
    expect(siteRow.textContent).toMatch(/(Bid|Price book|Default) \d+%/);
    const contingency = within(table)
      .getByRole("rowheader", { name: /^Contingency/ })
      .closest("tr") as HTMLElement;
    expect(contingency).toHaveTextContent(formatMoney(estimate.contingencyCents));
    const total = within(table).getByRole("rowheader", { name: "Total" }).closest("tr") as HTMLElement;
    expect(total).toHaveTextContent(formatMoney(estimate.totalCents));
  });

  it("gives the market range and lists only the comps that are included", async () => {
    const leftOut = (inputs: DealInputs) => void (inputs.compSelections[TEST_SAMPLE_IDS[0] as string] = false);
    const { harness, deal } = await setupWith(leftOut);
    await openPrint(harness, deal);
    const inputs = sampleDealInputs();
    leftOut(inputs);
    const evaluation = await evaluated(inputs);
    if (evaluation.price.status !== "ok") throw new Error("incomplete");
    const { lowCents, midCents, highCents } = evaluation.price.value;

    const market = section("Market estimate and comps used");
    for (const cents of [lowCents, midCents, highCents]) expect(market).toHaveTextContent(formatMoney(cents));
    const included = evaluation.scoredComps.filter((scored) => scored.included);
    const excluded = evaluation.scoredComps.filter((scored) => !scored.included);
    expect(excluded).toHaveLength(1);
    const rows = within(within(market).getByRole("table")).getAllByRole("rowheader");
    expect(rows.map((row) => row.textContent)).toEqual(included.map((scored) => scored.comp.address));
    for (const scored of excluded) expect(market).not.toHaveTextContent(scored.comp.address);
  });

  it("names the land close, list and sale close months", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    const timeline = section("Timeline");
    for (const label of ["Land close", "List date", "Sale close"]) {
      expect(within(timeline).getByText(label)).toBeVisible();
    }
    expect(within(timeline).getAllByText(/^[A-Z][a-z]{2} \d{4}$/)).toHaveLength(3);
  });

  it("lists the base case month by month in a box that scrolls on a phone and prints in full", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const evaluation = await evaluated();
    if (evaluation.scenarios.status !== "ok") throw new Error("incomplete");

    const table = within(section("Monthly cash flow (base case)")).getByRole("table");
    const periods = evaluation.scenarios.value.base.cashFlow.periods.length;
    expect(within(table).getAllByRole("row")).toHaveLength(periods + 1);
    expect(table.parentElement).toHaveClass("overflow-x-auto", "print:overflow-visible");
  });

  it("states the financing, selling and carrying assumptions", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);
    const inputs = sampleDealInputs();

    const assumptions = section("Assumptions");
    expect(
      within(assumptions)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Financing", "Selling", "Carrying"]);
    expect(assumptions).toHaveTextContent(`Loan-to-cost${formatPercent(inputs.loan.ltc)}`);
    expect(assumptions).toHaveTextContent(`Listing agent${formatPercent(inputs.selling.listingPct, 2)}`);
    expect(assumptions).toHaveTextContent(
      `Utilities during build${formatMoney(inputs.carry.utilitiesBuildMonthlyCents)}/mo`,
    );
  });

  it("ends with the disclaimer and the date it was prepared", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("Decision support only — not an appraisal, legal advice, or a lending decision.");
    expect(footer).toHaveTextContent("Prepared October 31, 2026 with Spec Studio.");
  });

  it("prints with the button, and goes back to the pro forma with the link; both stay off the paper", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    const button = screen.getByRole("button", { name: "Print or save as PDF" });
    await user.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    expect(button).toHaveClass("print:hidden");
    const back = screen.getByRole("link", { name: "← Back to the pro forma" });
    expect(back).toHaveAttribute("href", `#/deals/${deal.id}/proforma`);
    expect(back).toHaveClass("print:hidden");
  });

  it("keeps table rows and sections whole across pages", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    for (const name of HEADINGS) expect(section(name)).toHaveClass("print-block");
    for (const row of screen.getAllByRole("row")) expect(row).toHaveClass("print-row");
  });

  it("says when no comps are included, for a deal priced by the owner's own numbers", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      for (const id of TEST_SAMPLE_IDS) inputs.compSelections[id] = false;
      inputs.overrides = { basePriceCents: 90_000_000, baseDomDays: 60 };
    });
    await openPrint(harness, deal);

    const market = section("Market estimate and comps used");
    expect(market).toHaveTextContent("No comps are included in the estimate.");
    expect(within(market).queryByRole("table")).not.toBeInTheDocument();
  });

  it("states no loan terms for a build with no construction loan", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.loan.ltc = 0;
    });
    await openPrint(harness, deal);

    const financing = section("Assumptions");
    expect(financing).toHaveTextContent("ConstructionPaid in cash");
    expect(financing).not.toHaveTextContent("Loan-to-cost");
    expect(financing).not.toHaveTextContent("Extension fee");
    expect(section("Assumptions")).toHaveTextContent("Listing agent");
  });

  it("says the source mix is a rounded share of cost", async () => {
    const { harness, deal } = await sampleSetup();
    await openPrint(harness, deal);

    const divisions = section("Estimate by division");
    expect(within(divisions).getByRole("columnheader", { name: "Source mix (share of cost)" })).toBeVisible();
    expect(divisions).toHaveTextContent("Shares are rounded and may not add to exactly 100%.");
  });

  it("never saves the deal, or queues it in the outbox, behind an offline repository", async () => {
    const { harness: plain, deal } = await sampleSetup();
    const storage = new MemoryStorage();
    const offline = createOfflineRepository(plain.repository, storage, "u");
    const queue = vi.spyOn(offline, "queue");
    const save = vi.spyOn(offline, "saveDeal");
    const Providers = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={plain.client}>
        <RepositoryProvider repository={offline}>{children}</RepositoryProvider>
      </QueryClientProvider>
    );
    await openPrint({ ...plain, repository: offline, Providers } as Harness, deal);
    await advance(6000);

    expect(queue).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(storage.getItem("spec-studio:outbox:u")).toBeNull();
  });

  it("never saves the deal", async () => {
    const { harness, deal } = await sampleSetup();
    const save = vi.spyOn(harness.repository, "saveDeal");
    const create = vi.spyOn(harness.repository, "createDeal");
    await openPrint(harness, deal);
    await advance(6000);

    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the lender package for a deal that is not ready", () => {
  it("says it needs more details, links each need to its step, and shows no sections", async () => {
    const { harness, deal } = await newDealSetup();
    renderApp(`#/deals/${deal.id}/print`, harness);

    expect(await screen.findByText("This deal needs a few more details before it can be printed.")).toBeVisible();
    expect(screen.getByRole("link", { name: "City: Required" })).toHaveAttribute("href", `#/deals/${deal.id}/lot`);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print or save as PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to the pro forma" })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/proforma`,
    );
  });
});

describe("the lender package while the deal loads, or cannot", () => {
  it("says Loading… and is busy until the deal is read", async () => {
    const { harness, deal } = await sampleSetup();
    renderApp(`#/deals/${deal.id}/print`, harness);

    expect(screen.getByText("Loading…")).toBeVisible();
    expect(screen.getByText("Loading…").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    await screen.findByRole("heading", { level: 2, name: "Deal summary" });
  });

  it("is calm when the deal can't be read right now, and offers no delete", async () => {
    const { harness, deal } = await sampleSetup();
    vi.spyOn(harness.repository, "getDeal").mockRejectedValue(
      new DataError("Can't reach the server — check your connection.", {
        kind: "offline",
      }),
    );
    renderApp(`#/deals/${deal.id}/print`, harness);

    expect(
      await screen.findByRole("heading", {
        name: "Can't open this deal right now",
      }),
    ).toBeVisible();
    expect(screen.getByText("Can't reach the server — check your connection.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Deals" })).toHaveAttribute("href", "#/deals");
  });

  it("says there is no such deal", async () => {
    const { harness } = await sampleSetup();
    renderApp("#/deals/not-a-deal/print", harness);

    expect(await screen.findByRole("heading", { name: "Deal not found" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("link", { name: "Back to Deals" })).toBeVisible());
  });
});
