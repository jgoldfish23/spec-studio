import { testSampleComps } from "./sampleIds";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach } from "vitest";
import type { ReactNode } from "react";
import { App } from "../App";
import { createLocalRepository } from "../data/local/localRepository";
import { createQueryClient } from "../data/queryClient";
import { RepositoryProvider } from "../data/RepositoryProvider";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "../data/sample";
import { MemoryStorage } from "../data/local/memoryStorage";
import type { Repository, StoredDeal } from "../data/types";
import { resetLostSaves } from "../features/deal/lostSaves";

// The lost-saves banner list is a module-level store, so one test's entries would reach the next. A test that uses
// this harness cannot forget to clear it: it is emptied when a harness is made and after every test.
afterEach(() => {
  resetLostSaves();
});

/** What a screen test runs against: a local repository on in-memory storage and a fresh query client. */
export interface Harness {
  storage: MemoryStorage;
  repository: Repository;
  client: QueryClient;
  /** Wraps a tree in the query client and repository providers. */
  Providers: (props: { children: ReactNode }) => ReactNode;
}

export function createHarness(): Harness {
  resetLostSaves();
  const storage = new MemoryStorage();
  const repository = createLocalRepository(storage);
  const client = createQueryClient();
  const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider repository={repository}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  return { storage, repository, client, Providers };
}

/** Renders the whole app at `hash` (like `#/deals`) against the harness. */
export function renderApp(hash: string, harness: Harness = createHarness()) {
  window.location.hash = hash;
  return { ...render(<App />, { wrapper: harness.Providers }), ...harness };
}

/** Stores the sample deal and its comps, the way "Load sample deal" does. */
export async function seedSampleDeal(repository: Repository): Promise<StoredDeal> {
  for (const comp of testSampleComps()) await repository.saveComp(comp);
  return repository.createDeal({ name: SAMPLE_DEAL_NAME, inputs: sampleDealInputs() });
}
