import type { DealEvaluation } from "@engine";

/**
 * The message the engine's validation gives for the field at `path` (a dotted path such as `lot.city`), for a
 * step screen to show under that field. An issue at the path itself wins; failing that, the first issue under it
 * counts, so a group such as `lot.financing` shows the problem of `lot.financing.ltv`. Undefined when the deal has
 * not been evaluated yet or has no issue there.
 */
export function fieldError(evaluation: DealEvaluation | undefined, path: string): string | undefined {
  if (evaluation === undefined) return undefined;
  const { validation } = evaluation;
  const exact = validation.find((issue) => issue.path === path);
  if (exact !== undefined) return exact.message;
  return validation.find((issue) => issue.path.startsWith(`${path}.`))?.message;
}
