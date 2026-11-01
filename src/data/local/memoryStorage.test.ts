import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memoryStorage";

describe("MemoryStorage", () => {
  it("starts empty and returns null for a missing key", () => {
    const storage = new MemoryStorage();
    expect(storage.length).toBe(0);
    expect(storage.getItem("a")).toBeNull();
    expect(storage.key(0)).toBeNull();
  });

  it("stores, replaces and removes items", () => {
    const storage = new MemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    storage.setItem("a", "3");
    expect(storage.length).toBe(2);
    expect(storage.getItem("a")).toBe("3");
    storage.removeItem("a");
    storage.removeItem("missing");
    expect(storage.length).toBe(1);
    expect(storage.getItem("a")).toBeNull();
    expect(storage.getItem("b")).toBe("2");
  });

  it("lists keys by index in the order they were first stored", () => {
    const storage = new MemoryStorage();
    storage.setItem("a", "1");
    storage.setItem("b", "2");
    storage.setItem("a", "3");
    expect([storage.key(0), storage.key(1), storage.key(2)]).toEqual(["a", "b", null]);
  });

  it("keeps text, like the real thing", () => {
    const storage = new MemoryStorage();
    storage.setItem("n", 5 as unknown as string);
    expect(storage.getItem("n")).toBe("5");
  });

  it("clears everything", () => {
    const storage = new MemoryStorage();
    storage.setItem("a", "1");
    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.getItem("a")).toBeNull();
  });

  it("is a Storage, so it can stand in for localStorage", () => {
    const storage: Storage = new MemoryStorage();
    expect(storage).toBeInstanceOf(MemoryStorage);
  });
});
