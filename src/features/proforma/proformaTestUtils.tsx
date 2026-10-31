// Shared set-up for the pro forma page's tests (not a test itself).
import { screen, within } from "@testing-library/react";
import type { DealInputs, ScenarioName, ScenarioResult } from "@engine";
import { sampleDealInputs } from "../../data/sample";
import type { StoredDeal } from "../../data/types";
import { evaluated } from "../../testing/engineContext";
import { renderApp } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

export async function openProForma(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/proforma`, harness);
  await screen.findByRole("region", { name: "Verdict" });
}

export const card = (name: string) => screen.getByRole("region", { name });

/** What the engine says about a deal (the sample when omitted), scenario by scenario. */
export async function scenariosOf(inputs: DealInputs = sampleDealInputs()): Promise<Record<ScenarioName, ScenarioResult>> {
  const evaluation = await evaluated(inputs);
  if (evaluation.scenarios.status !== "ok") throw new Error("the scenarios are incomplete");
  return evaluation.scenarios.value;
}

/** Picks a scenario with the selector in the Scenarios card. */
export async function pickScenario(user: { click: (element: Element) => Promise<void> }, name: "Downside" | "Base" | "Upside") {
  await user.click(within(screen.getByRole("group", { name: "Scenario" })).getByRole("button", { name }));
}

const waterfall = () => screen.getByRole("table", { name: "Profit waterfall" });

/** The amount in a row of the waterfall (the row is found by the start of its label). */
export function waterfallValue(label: string): string {
  const header = within(waterfall()).getByRole("rowheader", { name: new RegExp(`^${label}`) });
  const row = header.closest("tr");
  if (row === null) throw new Error(`no row for ${label}`);
  return within(row).getByRole("cell").textContent ?? "";
}

/** The labels of the waterfall's rows, top to bottom (without their notes). */
export function waterfallLabels(): string[] {
  return within(waterfall())
    .getAllByRole("rowheader")
    .map((header) => header.firstElementChild?.textContent ?? "");
}

/** The tile of a label in the Scenarios card. */
export const tile = (label: string): HTMLElement =>
  within(card("Scenarios")).getByText(label).closest("dl") as HTMLElement;
