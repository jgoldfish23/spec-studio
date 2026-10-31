import { lazy } from "react";
import type { ComponentType } from "react";
import { StepLoadFailed } from "./StepLoadFailed";

/**
 * A step's screen, fetched when the step is first opened. If the fetch fails the step shows `StepLoadFailed` instead
 * of throwing, so the deal's frame and tabs stay up and the failure is not mistaken for a calculation error. A failed
 * fetch is not tried again by the browser until the page is reloaded, which is what the message asks for.
 */
export function lazyStep(load: () => Promise<{ default: ComponentType }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      console.error("Couldn't load a step's screen:", error);
      return { default: StepLoadFailed };
    }),
  );
}
