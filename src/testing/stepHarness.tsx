// Set-up shared by the tests of the step screens (Lot, House, Estimate, Market, Pro forma) and the deal frame: a harness
// with the sample deal stored, a variant of that deal, a deal as "New deal" makes it, and a harness that reads through a
// different repository. Tests only.
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DealInputs } from "@engine";
import { newDealInputs } from "../data/newDeal";
import { RepositoryProvider } from "../data/RepositoryProvider";
import type { Repository } from "../data/types";
import { createHarness, seedSampleDeal } from "./renderApp";
import type { Harness } from "./renderApp";

/** A fresh harness with the sample deal and its comps stored. */
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

/**
 * A deal as "New deal" makes it (the city is empty, so the engine cannot run), with an optional change, stored in a
 * fresh harness whose repository holds only the starter cost book and no comps.
 */
export async function newDealSetup(change: (inputs: DealInputs) => void = () => {}) {
  const harness = createHarness();
  const settings = await harness.repository.getCompanySettings();
  const inputs = newDealInputs("2026-10-31", settings);
  change(inputs);
  const deal = await harness.repository.createDeal({ name: "Untitled deal", inputs });
  return { harness, deal };
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
