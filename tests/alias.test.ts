import { describe, expect, it } from "vitest";
import { evaluateDeal } from "@engine";
import { evaluateDeal as evaluateDealDirect } from "../src/engine/evaluate";

describe("@engine alias (node project)", () => {
  it("resolves to the engine's public API, the same module instance as src/engine", () => {
    expect(evaluateDeal).toBe(evaluateDealDirect);
  });
});
