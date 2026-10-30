import { describe, expect, it } from "vitest";
import { incomplete, isOk, ok, type MissingItem, type Warning } from "./result";

describe("ok", () => {
  it("wraps a value with no warnings by default", () => {
    expect(ok(42)).toEqual({ status: "ok", value: 42, warnings: [] });
  });

  it("carries warnings through", () => {
    const warnings: Warning[] = [{ code: "w1", message: "heads up" }];
    expect(ok("x", warnings)).toEqual({ status: "ok", value: "x", warnings });
  });

  it("gives each result its own default warnings array", () => {
    const a = ok(1);
    const b = ok(2);
    expect(a.status === "ok" && b.status === "ok" && a.warnings !== b.warnings).toBe(true);
  });
});

describe("incomplete", () => {
  it("lists what is missing and which step it belongs to", () => {
    const missing: MissingItem[] = [{ code: "lot.price", message: "Lot price is required", step: "lot" }];
    expect(incomplete<number>(missing)).toEqual({ status: "incomplete", missing });
  });
});

describe("isOk", () => {
  it("narrows to the ok variant", () => {
    const r = ok(7);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(7);
  });

  it("is false for incomplete results", () => {
    expect(isOk(incomplete<number>([{ code: "c", message: "m", step: "market" }]))).toBe(false);
  });
});
