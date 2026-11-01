// Timing and typing helpers for tests that render a deal editor screen. Like `renderApp.tsx` and `engineContext.ts`,
// these are for tests only.
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import type { DealInputs } from "@engine";
import type { StoredDeal } from "../data/types";
import type { Harness } from "./renderApp";

/**
 * Fake timers for a test file, so the editor's 150 ms evaluation delay and its 1 s autosave can be stepped through.
 * Call it once at the top of the file. Fake time also moves with real time, so the data layer's reads (which are
 * promises, not timers) finish as they do in the app. The location hash starts empty, and "today" is 31 October 2026.
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

/** Lets `ms` of fake time pass, with React told about the updates it causes. */
export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** One `userEvent` that steps the fake clock, as real typing would. */
export const newUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
export type User = ReturnType<typeof newUser>;

/** Replaces whatever is in the box with `text` as a single change. `parent` narrows the search for the label. */
export async function pasteOver(user: User, label: string, text: string, parent: HTMLElement = document.body) {
  const input = within(parent).getByLabelText(label);
  await user.clear(input);
  await user.click(input);
  await user.paste(text);
}

/** Replaces whatever is in the box with `text`, key by key. `parent` narrows the search for the label. */
export async function typeOver(user: User, label: string, text: string, parent: HTMLElement = document.body) {
  const input = within(parent).getByLabelText(label);
  await user.clear(input);
  await user.type(input, text);
}

/** The deal as stored, once the autosave has had its second and the page says "Saved". */
export async function savedAfterAutosave(harness: Harness, deal: StoredDeal): Promise<DealInputs> {
  await advance(1100);
  await screen.findByText("Saved");
  const stored = await harness.repository.getDeal(deal.id);
  if (stored === null) throw new Error("the deal is gone");
  return stored.inputs;
}
