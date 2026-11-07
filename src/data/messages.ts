import type { Comp } from "@engine";

// What the owner is told, where more than one module tells it: said once here, so the same thing always reads the same.

/** A save that lost to another device or tab. */
export const DEAL_CHANGED_ELSEWHERE = "This deal was changed on another device or tab.";

/** A save of a deal another device or tab deleted. */
export const DEAL_DELETED_ELSEWHERE = "This deal was deleted on another device or tab.";

/** A request that got no answer: no network, or the server is down. */
export const CANT_REACH_SERVER = "Can't reach the server — check your connection.";

/** A request refused because the owner's session ended. */
export const SIGNED_OUT = "You've been signed out.";

/** An edit the outbox holds while the owner is signed out. */
export const SIGNED_OUT_SAVED_ON_DEVICE = "Signed out — sign in to sync. Your changes are saved on this device.";

const squash = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * How two comps are told to be the same one: the address, ignoring case and spacing, and the sold date. An import
 * skips a comp the account already has by this, and Load sample deal adds back only the sample comps missing by it.
 */
export const compIdentity = (comp: Pick<Comp, "address" | "soldDate">): string =>
  `${squash(comp.address)}|${comp.soldDate ?? ""}`;
