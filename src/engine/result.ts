/** A non-blocking note attached to a successful result. */
export type Warning = { code: string; message: string };

/** Required input that was not provided, or context data that cannot be used; names the step that fixes it. */
export type MissingItem = {
  code: string;
  message: string;
  /** The wizard step that supplies it; `settings` is the engine context (comps, cost book, market settings, rules). */
  step: "lot" | "house" | "estimate" | "market" | "proforma" | "settings";
  /** What the item is about, when that is one identifiable thing: the cost-code id on a `missingPrice` item. */
  ref?: string;
};

/** A problem found while validating input at a specific field path. */
export type ValidationIssue = { path: string; message: string };

/** Outcome of a calculation: a value, or the list of inputs it could not proceed without. */
export type Result<T> =
  | { status: "ok"; value: T; warnings: Warning[] }
  | { status: "incomplete"; missing: MissingItem[] };

export function ok<T>(value: T, warnings: Warning[] = []): Result<T> {
  return { status: "ok", value, warnings };
}

export function incomplete<T>(missing: MissingItem[]): Result<T> {
  return { status: "incomplete", missing };
}

export function isOk<T>(r: Result<T>): r is Extract<Result<T>, { status: "ok" }> {
  return r.status === "ok";
}
