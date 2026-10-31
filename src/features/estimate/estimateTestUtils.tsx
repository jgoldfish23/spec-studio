// Shared set-up for the estimate page's tests (not a test itself).
import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import type { DealInputs } from "@engine";
import { RepositoryProvider } from "../../data/RepositoryProvider";
import type { Repository, StoredDeal } from "../../data/types";
import { createHarness, renderApp, seedSampleDeal } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

/**
 * Fake timers for a test file, so the 150 ms evaluation delay and the 1 s autosave can be stepped through. Fake time
 * also moves with real time, so the data layer's reads (which are promises, not timers) finish as they do in the app.
 * "Today" is 31 October 2026.
 */
export function installFakeClock() {
  beforeEach(() => {
    window.location.hash = "";
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 31, 12) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** One `userEvent` that steps the fake clock, as real typing would. */
export const newUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
export type User = ReturnType<typeof newUser>;

/** Replaces whatever is in the box with `text` as a single change. */
export async function pasteOver(user: User, label: string, text: string, parent: HTMLElement = document.body) {
  const input = within(parent).getByLabelText(label);
  await user.clear(input);
  await user.click(input);
  await user.paste(text);
}

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

/** The deal as stored, once the autosave has had its second and the page says "Saved". */
export async function savedAfterAutosave(harness: Harness, deal: StoredDeal): Promise<DealInputs> {
  await advance(1100);
  await screen.findByText("Saved");
  const stored = await harness.repository.getDeal(deal.id);
  if (stored === null) throw new Error("the deal is gone");
  return stored.inputs;
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
