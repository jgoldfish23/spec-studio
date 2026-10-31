import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { LeverResult, Verdict } from "@engine";
import { formatMoney, formatPercent } from "../../lib/format";
import { installFakeClock } from "../../testing/editorTiming";
import { evaluated } from "../../testing/engineContext";
import { sampleSetup, setupWith } from "../../testing/stepHarness";
import { card, openProForma } from "./proformaTestUtils";
import { checkLine, verdictHeadline } from "./verdictText";
import { VerdictPanel } from "./VerdictPanel";

installFakeClock();

const verdictPanel = () => card("Verdict");

describe("the verdict of the sample deal", () => {
  it("shows the chip for the engine's verdict, its headline, and one line for each of the three rules", async () => {
    const { harness, deal } = await sampleSetup();
    const { verdict } = await evaluated();
    expect(verdict.kind).toBe("marginal");
    await openProForma(harness, deal);

    const panel = verdictPanel();
    expect(within(panel).getByText("Marginal")).toBeVisible();
    expect(within(panel).getByText(verdictHeadline(verdict.kind))).toBeVisible();
    expect(within(panel).getByText("Makes money, but misses one of your rules.")).toBeVisible();
    const lines = within(within(panel).getByRole("list", { name: "Rule checks" })).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual(verdict.checks.map(checkLine));
    expect(lines).toHaveLength(3);
  });

  it("marks each rule as passed or failed with an icon that has a name, not by color alone", async () => {
    const { harness, deal } = await sampleSetup();
    const { verdict } = await evaluated();
    await openProForma(harness, deal);

    const lines = within(within(verdictPanel()).getByRole("list", { name: "Rule checks" })).getAllByRole("listitem");
    verdict.checks.forEach((check, index) => {
      const icon = within(lines[index] as HTMLElement).getByRole("img");
      expect(icon).toHaveAccessibleName(check.pass ? "Passes" : "Fails");
    });
    expect(verdict.checks.map((check) => check.pass)).toEqual([false, true, true]);
  });

  it("writes the margin line as the brief words it", async () => {
    const { harness, deal } = await sampleSetup();
    const { verdict } = await evaluated();
    await openProForma(harness, deal);

    const margin = verdict.checks[0]?.actual ?? 0;
    expect(within(verdictPanel()).getByText(`Margin ${formatPercent(margin, 1)} — your rule is 15.0% or better`)).toBeVisible();
    expect(within(verdictPanel()).getByText(/^Annualized return \d+\.\d% — beats your 25\.0% rule$/)).toBeVisible();
    expect(within(verdictPanel()).getByText(/^Downside profit \$[\d,]+ — passes your \$0 rule$/)).toBeVisible();
  });

  it("has no loan heads-up while the base case needs no extension", async () => {
    const { harness, deal } = await sampleSetup();
    expect((await evaluated()).verdict.loanWarning).toBeUndefined();
    await openProForma(harness, deal);

    expect(within(verdictPanel()).queryByText(/Loan heads-up/)).not.toBeInTheDocument();
  });
});

describe("a deal that passes every rule", () => {
  it("shows Go and its headline, and no list of ways to make it a Go", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.lot.priceCents = 15_000_000;
    });
    await openProForma(harness, deal);

    const panel = verdictPanel();
    expect(within(panel).getByText("Go")).toBeVisible();
    expect(within(panel).getByText("Passes all your rules.")).toBeVisible();
    expect(screen.queryByText("What would make it a Go")).not.toBeInTheDocument();
    for (const line of within(within(panel).getByRole("list", { name: "Rule checks" })).getAllByRole("listitem")) {
      expect(within(line).getByRole("img")).toHaveAccessibleName("Passes");
    }
  });
});

describe("a deal that loses money", () => {
  async function nogoSetup() {
    return setupWith((inputs) => {
      inputs.overrides.basePriceCents = 115_000_000;
    });
  }

  it("shows No-go with its headline and every rule failed", async () => {
    const { harness, deal } = await nogoSetup();
    await openProForma(harness, deal);

    const panel = verdictPanel();
    expect(within(panel).getByText("No-go")).toBeVisible();
    expect(within(panel).getByText("Doesn't pass your rules.")).toBeVisible();
    for (const line of within(within(panel).getByRole("list", { name: "Rule checks" })).getAllByRole("listitem")) {
      expect(within(line).getByRole("img")).toHaveAccessibleName("Fails");
    }
  });

  it("lists the three ways to make it a Go, in the engine's words and numbers", async () => {
    const { harness, deal } = await nogoSetup();
    const { goalSeek } = await evaluated(deal.inputs);
    await openProForma(harness, deal);

    const section = screen.getByRole("region", { name: "What would make it a Go" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const [lot, sale, build] = goalSeek as [LeverResult, LeverResult, LeverResult];
    expect(lot.reachable && sale.reachable && build.reachable).toBe(true);
    expect(rows[0]).toHaveTextContent("Lot price");
    expect(within(rows[0] as HTMLElement).getByText(`Buy the lot for ${formatMoney(lot.valueCents)} (${formatMoney(lot.deltaCents)})`)).toBeVisible();
    expect(rows[1]).toHaveTextContent("Sale price");
    expect(
      within(rows[1] as HTMLElement).getByText(
        `Sell for ${formatMoney(sale.valueCents)} (${formatPercent(sale.deltaPct, 1, { signed: true })})`,
      ),
    ).toBeVisible();
    expect(rows[2]).toHaveTextContent("Build cost");
    expect(
      within(rows[2] as HTMLElement).getByText(
        `Build for ${formatMoney(build.valueCents)} (${formatMoney(build.deltaCents)}, ${formatPercent(build.deltaPct, 1, { signed: true })})`,
      ),
    ).toBeVisible();
  });

  it("writes the lot price lower with the engine's minus sign, the sale price higher with a plus", async () => {
    const { harness, deal } = await nogoSetup();
    await openProForma(harness, deal);

    const section = screen.getByRole("region", { name: "What would make it a Go" });
    expect(within(section).getByText(/^Buy the lot for \$[\d,]+ \(−\$[\d,]+\)$/)).toBeVisible();
    expect(within(section).getByText(/^Sell for \$[\d,]+ \(\+\d+\.\d%\)$/)).toBeVisible();
    expect(within(section).getByText(/^Build for \$[\d,]+ \(−\$[\d,]+, −\d+\.\d%\)$/)).toBeVisible();
    expect(section.textContent).not.toMatch(/-\$|-\d/);
  });
});

describe("the sample deal, which is marginal", () => {
  it("also lists the ways to make it a Go", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const section = screen.getByRole("region", { name: "What would make it a Go" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the loan heads-up", () => {
  it("says how soon it must go under contract, and counts the extension fee, for a house that sits too long", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      inputs.overrides.baseDomDays = 100;
    });
    const { verdict } = await evaluated(deal.inputs);
    const warning = verdict.loanWarning;
    if (warning === undefined || warning.maxDomWithoutExtension === null) throw new Error("expected a loan warning");
    expect(warning.maxDomWithoutExtension).toBeGreaterThan(0);
    await openProForma(harness, deal);

    const fees = warning.extensions === 1 ? "1 extension fee is" : `${warning.extensions} extension fees are`;
    expect(
      within(verdictPanel()).getByText(
        `Loan heads-up: to avoid an extension it must go under contract within ${warning.maxDomWithoutExtension} days ` +
          `(typical here is ${warning.baseDomDays}). ${fees} already in the numbers.`,
      ),
    ).toBeVisible();
  });

  it("says the loan ends before the sale closes when the term is over before the house lists", async () => {
    const { harness, deal } = await setupWith((inputs) => {
      // Two months of permits and a nine month build: a nine month term ends the day the house lists.
      inputs.loan.termMonths = 9;
    });
    const { verdict } = await evaluated(deal.inputs);
    expect(verdict.loanWarning?.maxDomWithoutExtension).toBe(0);
    await openProForma(harness, deal);

    expect(
      within(verdictPanel()).getByText("Loan heads-up: the loan term ends before the sale closes, so extension fees apply."),
    ).toBeVisible();
  });
});

describe("VerdictPanel", () => {
  const panel = (verdict: Verdict, goalSeek: LeverResult[] | null = null) =>
    render(
      <MemoryRouter>
        <VerdictPanel dealId="deal-1" verdict={verdict} goalSeek={goalSeek} />
      </MemoryRouter>,
    );

  it("says a lever that cannot get to a Go on its own is not reachable", () => {
    panel({ kind: "nogo", checks: [] }, [
      { lever: "lotPrice", reachable: false },
      { lever: "salePrice", reachable: true, valueCents: 142_000_000, deltaCents: 7_000_000, deltaPct: 0.0519 },
      { lever: "buildCost", reachable: false },
    ]);

    const rows = within(screen.getByRole("region", { name: "What would make it a Go" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("Not reachable with this alone")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("Sell for $1,420,000 (+5.2%)")).toBeVisible();
    expect(within(rows[2] as HTMLElement).getByText("Not reachable with this alone")).toBeVisible();
  });

  it("leaves the list of ways out when the verdict is a Go, whatever it is given", () => {
    panel({ kind: "go", checks: [] }, [{ lever: "lotPrice", reachable: false }]);
    expect(screen.queryByText("What would make it a Go")).not.toBeInTheDocument();
  });

  it("leaves the list of ways out when the engine gave none", () => {
    panel({ kind: "marginal", checks: [] }, null);
    expect(screen.queryByText("What would make it a Go")).not.toBeInTheDocument();
  });

  it("writes one fee as 'fee' and several as 'fees'", () => {
    panel({
      kind: "marginal",
      checks: [],
      loanWarning: { maxDomWithoutExtension: 56, baseDomDays: 62, extensions: 1 },
    });
    expect(screen.getByText(/ 1 extension fee is already in the numbers\.$/)).toBeVisible();
  });
});
