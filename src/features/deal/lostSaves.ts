import { useSyncExternalStore } from "react";

/** A deal whose last edits could not be saved and are gone: nothing is left to retry. */
export interface LostSave {
  dealId: string;
  dealName: string;
  message: string;
}

let entries: readonly LostSave[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly LostSave[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

/**
 * Records that a deal's final edits were dropped, for a banner to show. A deal that is reported again keeps its
 * place in the list with the newer details.
 */
export function reportLostSave(entry: LostSave): void {
  const next: LostSave = { dealId: entry.dealId, dealName: entry.dealName, message: entry.message };
  const index = entries.findIndex((existing) => existing.dealId === next.dealId);
  const current = entries[index];
  if (current && current.dealName === next.dealName && current.message === next.message) return;
  publish(index === -1 ? [...entries, next] : entries.map((existing, i) => (i === index ? next : existing)));
}

/** Removes a deal's entry, once the owner has seen it. Does nothing for a deal that has none. */
export function dismissLostSave(dealId: string): void {
  if (!entries.some((entry) => entry.dealId === dealId)) return;
  publish(entries.filter((entry) => entry.dealId !== dealId));
}

/**
 * Empties the store: when a different owner signs in on this device (the notices name the last owner's deals), and in
 * tests, so one test's entries do not reach the next.
 */
export function resetLostSaves(): void {
  if (entries.length > 0) publish([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): readonly LostSave[] => entries;

/** The deals with dropped edits. The same array comes back until the list changes. */
export function useLostSaves(): readonly LostSave[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
