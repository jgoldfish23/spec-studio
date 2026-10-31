import type { DealEditor } from "../deal/useDealEditor";

export type Edit = DealEditor["edit"];

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce";

/** A text-style button in a table row or a list ("Add bid", "Edit bid"): spruce text, at least 44 px to touch. */
export const ACTION_BUTTON = `inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] font-semibold text-spruce underline-offset-2 hover:underline ${FOCUS_RING}`;

/** The wide button at the foot of a form that carries it out. */
export const PRIMARY_BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-spruce px-4.5 text-[15px] font-semibold text-white hover:bg-spruce-dark ${FOCUS_RING}`;

/** A bordered button beside a primary one ("Cancel"). */
export const SECONDARY_BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-[#C9CEC8] bg-surface px-4.5 text-[15px] font-semibold text-ink hover:bg-paper ${FOCUS_RING}`;

/** What a card with nothing to show says, in muted type. */
export const MUTED_NOTE = "m-0 text-sm text-muted";
