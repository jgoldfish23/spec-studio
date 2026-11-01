import type { ScenarioName } from "@engine";

/** The scenarios in the order the selector lists them, with the word each goes by. */
export const SCENARIOS: readonly { value: ScenarioName; label: string }[] = [
  { value: "downside", label: "Downside" },
  { value: "base", label: "Base" },
  { value: "upside", label: "Upside" },
];

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  downside: "Downside",
  base: "Base",
  upside: "Upside",
};
