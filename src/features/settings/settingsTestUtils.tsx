// Shared set-up for the Settings screen's tests (not a test itself).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../testing/renderApp";
import type { Harness } from "../../testing/renderApp";

export const RULES_CARD = "Go/no-go rules for new deals";
export const MARKET_CARD = "Market settings — Northern Utah (Davis & Weber)";
export const UNSAVED = "You have unsaved settings. Leave without saving?";

export const newUser = () => userEvent.setup();
export type User = ReturnType<typeof newUser>;

/** Opens the Settings screen once both forms have drawn. */
export async function openSettings(harness?: Harness) {
  const view = renderApp("#/settings", harness);
  await screen.findByRole("region", { name: RULES_CARD });
  await screen.findByRole("region", { name: MARKET_CARD });
  return view;
}

export const card = (name: string) => screen.getByRole("region", { name });

/** Replaces whatever is in the box with `text` as one change. */
export async function pasteOver(user: User, parent: HTMLElement, label: string, text: string) {
  const input = within(parent).getByLabelText(label);
  await user.clear(input);
  await user.click(input);
  await user.paste(text);
}

export const saveButton = (parent: HTMLElement) => within(parent).getByRole("button", { name: "Save changes" });
