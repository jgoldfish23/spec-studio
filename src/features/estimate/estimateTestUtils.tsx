// Shared set-up for the estimate page's tests (not a test itself).
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Bid, DealInputs, Estimate } from "@engine";
import { RepositoryProvider } from "../../data/RepositoryProvider";
import { sampleDealInputs } from "../../data/sample";
import type { Repository, StoredDeal } from "../../data/types";
import { evaluated } from "../../testing/engineContext";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

export async function sampleSetup() {
  const harness = createHarness();
  const deal = await seedSampleDeal(harness.repository);
  return { harness, deal };
}

/** The sample deal with a change, stored as a deal of its own. */
export async function setupWith(change: (inputs: DealInputs) => void, base: Harness = createHarness()) {
  const sample = await seedSampleDeal(base.repository);
  const inputs = structuredClone(sample.inputs);
  change(inputs);
  const deal = await base.repository.createDeal({ name: "Changed", inputs });
  return { harness: base, deal };
}

/** What the engine says the estimate is for a deal (the sample when omitted). */
export async function estimateOf(inputs: DealInputs = sampleDealInputs()): Promise<Estimate> {
  const evaluation = await evaluated(inputs);
  if (evaluation.estimate.status !== "ok") throw new Error("the estimate is incomplete");
  return evaluation.estimate.value;
}

/** A $5,000 bid on `code`, received 12 October 2026. */
export const crewBid = (code: string): Bid => ({ code, amountCents: 500_000, vendor: "Crew", receivedOn: "2026-10-12" });

/** The sample deal with a bid on every line of its estimate, so no line is left on a default. */
export async function setupEveryLineBid() {
  const estimate = await estimateOf();
  return setupWith((inputs) => {
    inputs.bids = estimate.lines.map((line) => crewBid(line.code));
  });
}

/** The same harness reading everything through `repository`. */
export function harnessOver(base: Harness, repository: Repository): Harness {
  const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={base.client}>
      <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  return { ...base, repository, Providers };
}

/** A repository whose cost book has no prices for `code`, neither in the owner's price book nor among the defaults. */
export function withoutPricesFor(repository: Repository, code: string): Repository {
  return {
    ...repository,
    getCostBook: async (region) => {
      const book = await repository.getCostBook(region);
      return {
        defaults: book.defaults.filter((price) => price.code !== code),
        priceBook: book.priceBook.filter((entry) => entry.code !== code),
      };
    },
  };
}

export async function openEstimate(harness: Harness, deal: StoredDeal) {
  renderApp(`#/deals/${deal.id}/estimate`, harness);
  await screen.findByRole("region", { name: "Cost lines" });
}

export const region = (name: string) => screen.getByRole("region", { name });
export const costTable = () => screen.getByRole("table", { name: "Cost lines by division" });

/** The row of a cost line, found by its name. */
export function lineRow(name: string): HTMLElement {
  const row = within(costTable()).getByRole("button", { name }).closest("tr");
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

/** The body rows of the footer-less part of a nested table (everything after its header row). */
export function bodyRows(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole("row").slice(1);
}
