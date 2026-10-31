import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installFakeClock, newUser } from "../../testing/editorTiming";
import { sampleSetup } from "../../testing/stepHarness";
import { card, openProForma, pickScenario, scenariosOf } from "./proformaTestUtils";
import { TimelineCard } from "./TimelineCard";

installFakeClock();

const timeline = () => card("Timeline & loan");

describe("the timeline", () => {
  it("names the land close, listing and sale close months under the bar", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);

    const dates = within(timeline());
    expect(dates.getByText("Jun 2027 · land closes")).toBeVisible();
    expect(dates.getByText("May 2028 · lists")).toBeVisible();
    expect(dates.getByText("Jul 2028 · sale closes")).toBeVisible();
  });

  it("says in words what each stretch of the bar is, for the scenario shown", async () => {
    const { harness, deal } = await sampleSetup();
    const { base, downside } = await scenariosOf();
    await openProForma(harness, deal);

    const listed = (days: number) => `Listed ${days} d`;
    expect(within(timeline()).getByText("Permits 2 mo")).toBeVisible();
    expect(within(timeline()).getByText("Build 9 mo · loan draws")).toBeVisible();
    expect(within(timeline()).getByText(listed(base.inputs.domDays))).toBeVisible();
    expect(within(timeline()).getByText("Close")).toBeVisible();

    await pickScenario(newUser(), "Downside");
    expect(within(timeline()).getByText(listed(downside.inputs.domDays))).toBeVisible();
    expect(within(timeline()).queryByText(listed(base.inputs.domDays))).not.toBeInTheDocument();
  });

  it("draws the bar and the loan marker as graphics that assistive tech skips", async () => {
    const { harness, deal } = await sampleSetup();
    await openProForma(harness, deal);
    await pickScenario(newUser(), "Downside");

    const bar = within(timeline()).getByTestId("timeline-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(within(bar).getAllByTestId("timeline-piece")).toHaveLength(4);
    expect(within(timeline()).getByTestId("loan-marker")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks where the loan matures only in a scenario that is still on the loan at that point", async () => {
    const { harness, deal } = await sampleSetup();
    const { base, downside } = await scenariosOf();
    // The base case sells before month 14, when the loan matures; the downside sells after it and pays for an extension.
    expect(base.cashFlow.times.saleClose).toBeLessThan(base.cashFlow.times.maturity);
    expect(downside.cashFlow.times.saleClose).toBeGreaterThan(downside.cashFlow.times.maturity);
    await openProForma(harness, deal);
    const user = newUser();

    expect(within(timeline()).queryByText("Loan matures")).not.toBeInTheDocument();
    await pickScenario(user, "Downside");
    expect(within(timeline()).getByText("Loan matures")).toBeVisible();
    await pickScenario(user, "Base");
    expect(within(timeline()).queryByText("Loan matures")).not.toBeInTheDocument();
  });
});

describe("TimelineCard", () => {
  it("shows the marker at the share of the bar the maturity month is", async () => {
    const { downside } = await scenariosOf();
    render(<TimelineCard scenario="downside" result={downside} landClose="2027-06" />);

    const left = Number.parseFloat(screen.getByTestId("loan-marker").style.left);
    expect(left).toBeCloseTo((downside.cashFlow.times.maturity / downside.cashFlow.times.saleClose) * 100, 3);
    expect(screen.getByRole("region", { name: "Timeline & loan" })).toBeVisible();
  });

  it("names the months from the land close it is given", async () => {
    const { base } = await scenariosOf();
    render(<TimelineCard scenario="base" result={base} landClose="2026-11" />);

    expect(screen.getByText("Nov 2026 · land closes")).toBeVisible();
    expect(screen.getByText("Oct 2027 · lists")).toBeVisible();
    expect(screen.getByText("Dec 2027 · sale closes")).toBeVisible();
  });
});
