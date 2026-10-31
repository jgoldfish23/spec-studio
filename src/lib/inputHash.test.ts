import { describe, expect, it } from "vitest";
import { inputHash } from "./inputHash";

describe("inputHash", () => {
  it("is eight lowercase hex characters", () => {
    expect(inputHash({ lot: { city: "Kaysville" } })).toMatch(/^[0-9a-f]{8}$/);
    expect(inputHash("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is the FNV-1a hash of the JSON text, so it is the same on every run", () => {
    // Worked out independently with the 32-bit FNV-1a offset basis 0x811c9dc5 and prime 0x01000193.
    expect(inputHash({ a: 1 })).toBe("8b9e4511");
    expect(inputHash("")).toBe("ffcaaa85");
    expect(inputHash([])).toBe("741638a5");
  });

  it("is the same for equal content in different objects, and different for different content", () => {
    expect(inputHash({ a: 1, b: [2, 3] })).toBe(inputHash({ a: 1, b: [2, 3] }));
    expect(inputHash({ a: 1 })).not.toBe(inputHash({ a: 2 }));
    expect(inputHash({ a: 1 })).not.toBe(inputHash({ b: 1 }));
  });

  it("still gives a hash for a value JSON cannot write", () => {
    expect(inputHash(undefined)).toBe("9b61ad43");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(inputHash(loop)).toMatch(/^[0-9a-f]{8}$/);
    expect(inputHash(10n)).toMatch(/^[0-9a-f]{8}$/);
  });
});
