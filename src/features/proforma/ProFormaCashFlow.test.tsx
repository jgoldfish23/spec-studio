import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatMoney } from "../../lib/format";
import { installFakeClock, newUser } from "../../testing/editorTiming";
import { sampleSetup } from "../../testing/stepHarness";
import { card, openProForma, pickScenario, scenariosOf } from "./proformaTestUtils";

installFakeClock();

const cashFlow = () => card("Monthly cash flow");

async function expand(user: ReturnType<typeof newUser>) {
  await user.click(within(cashFlow()).getByText("Show month by month"));
}

describe("the month by month table", () => {
  it("is folded away behind 'Show month by month' to start with", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const details = within(cashFlow()).getByText("Show month by month").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(within(cashFlow()).getByRole("table")).not.toBeVisible();
  });

  it("shows ceil(saleClose) rows once it is expanded", async () => {
    const { harness, deal } = await sampleSetup();
    const { base } = await scenariosOf();
    await openProForma(harness, deal);
    const user = newUser();

    await expand(user);

    const table = within(cashFlow()).getByRole("table");
    expect(table).toBeVisible();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(Math.ceil(base.cashFlow.times.saleClose));
    expect(rows).toHaveLength(14);
  });

  it("has the columns the brief names", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const headers = within(within(cashFlow()).getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Month",
      "Spend",
      "Loan draw",
      "Interest",
      "Carry",
      "Equity out",
      "Cumulative equity",
      "Loan balance",
    ]);
  });

  it("names each month from the land close, and shows the engine's figures for it", async () => {
    const { harness, deal } = await sampleSetup();
    const { base } = await scenariosOf();
    await openProForma(harness, deal);

    const rows = within(within(cashFlow()).getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0] as HTMLElement).getByRole("rowheader")).toHaveTextContent("Jun 2027");
    expect(within(rows[1] as HTMLElement).getByRole("rowheader")).toHaveTextContent("Jul 2027");
    expect(within(rows[7] as HTMLElement).getByRole("rowheader")).toHaveTextContent("Jan 2028");
    rows.forEach((row, index) => {
      const period = base.cashFlow.periods[index];
      if (period === undefined) throw new Error(`no period ${index}`);
      const carry =
        period.taxCents + period.insuranceCents + period.utilitiesCents + period.stagingCents + period.upkeepCents + period.hoaCents;
      const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
      expect(cells).toEqual([
        formatMoney(period.spendCents),
        formatMoney(period.loanDrawCents),
        formatMoney(period.interestCents),
        formatMoney(carry),
        formatMoney(period.equityOutCents),
        formatMoney(period.cumulativeEquityCents),
        formatMoney(period.loanBalanceEndCents),
      ]);
    });
  });

  it("follows the scenario picked", async () => {
    const { harness, deal } = await sampleSetup();
    const { downside } = await scenariosOf();
    await openProForma(harness, deal);
    const user = newUser();

    await pickScenario(user, "Downside");
    await expand(user);

    const rows = within(within(cashFlow()).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(Math.ceil(downside.cashFlow.times.saleClose));
    expect(rows).toHaveLength(15);
  });

  it("says what is in the Carry and Interest columns, and where the other costs went", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    expect(
      within(cashFlow()).getByText(
        "Carry is property tax, insurance, utilities, staging, upkeep and HOA. Interest is the construction loan's; points, fees and land-loan interest are in Equity out.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Month by month cash flow" })).toBeInTheDocument();
  });
});
