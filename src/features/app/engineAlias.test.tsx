import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, evaluateDeal } from "@engine";

// App code can only name the engine through the alias, so this is the check available to the dom
// project; `tests/alias.test.ts` proves the alias hits `src/engine/index.ts` itself.
describe("@engine alias (dom project)", () => {
  it("resolves to the engine's public API", () => {
    expect(typeof evaluateDeal).toBe("function");
    expect(DEFAULT_RULES).toBeDefined();
  });
});
