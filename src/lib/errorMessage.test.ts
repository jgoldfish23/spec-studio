import { describe, expect, it } from "vitest";
import { errorMessage, withoutSavePrefix } from "./errorMessage";

describe("errorMessage", () => {
  it("is an error's message, or the text of anything else", () => {
    expect(errorMessage(new Error("disk is full"))).toBe("disk is full");
    expect(errorMessage("plain text")).toBe("plain text");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});

describe("withoutSavePrefix", () => {
  it("drops a leading Couldn't save and its dash, so a screen that says it already does not say it twice", () => {
    expect(withoutSavePrefix("Couldn't save — browser storage is full or unavailable")).toBe(
      "browser storage is full or unavailable",
    );
    expect(withoutSavePrefix("Couldn't save — inputs.lot.priceCents: expected number")).toBe(
      "inputs.lot.priceCents: expected number",
    );
    expect(withoutSavePrefix("Couldn’t save - the store is locked")).toBe("the store is locked");
  });

  it("is empty when nothing but the prefix is there", () => {
    expect(withoutSavePrefix("Couldn't save")).toBe("");
    expect(withoutSavePrefix("Couldn't save —")).toBe("");
    expect(withoutSavePrefix("Couldn't save — ")).toBe("");
  });

  it("leaves any other message alone, even one that mentions saving later on", () => {
    expect(withoutSavePrefix("browser storage is full")).toBe("browser storage is full");
    expect(withoutSavePrefix("The disk said: Couldn't save — full")).toBe("The disk said: Couldn't save — full");
    expect(withoutSavePrefix("Couldn't saveguard anything")).toBe("Couldn't saveguard anything");
  });
});
