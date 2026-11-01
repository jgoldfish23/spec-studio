import { describe, expect, it } from "vitest";
import { openBrowserStorage, PROBE_KEY } from "./browserStorage";
import { MemoryStorage } from "./memoryStorage";

/** A store whose writes are refused, as a browser that blocks storage (or an old Safari private window) refuses them. */
class RefusingStorage extends MemoryStorage {
  setItem(): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }
}

describe("openBrowserStorage", () => {
  it("uses the browser's storage when it can be read and written, and leaves no probe behind", () => {
    const real = new MemoryStorage();
    real.setItem("kept", "yes");
    const opened = openBrowserStorage(() => real);
    expect(opened.storage).toBe(real);
    expect(opened.persistent).toBe(true);
    expect(real.getItem(PROBE_KEY)).toBeNull();
    expect(real.getItem("kept")).toBe("yes");
    expect(real.length).toBe(1);
  });

  it("falls back to storage in memory when reading the browser's storage throws (a blocked or sandboxed page)", () => {
    const opened = openBrowserStorage(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(opened.storage).toBeInstanceOf(MemoryStorage);
    expect(opened.persistent).toBe(false);
    // The fallback works like the real thing.
    opened.storage.setItem("a", "1");
    expect(opened.storage.getItem("a")).toBe("1");
  });

  it("falls back to storage in memory when the browser has no storage at all", () => {
    const opened = openBrowserStorage(() => null as unknown as Storage);
    expect(opened.storage).toBeInstanceOf(MemoryStorage);
    expect(opened.persistent).toBe(false);
  });

  it("falls back to storage in memory when an empty store refuses a write", () => {
    const refusing = new RefusingStorage();
    const opened = openBrowserStorage(() => refusing);
    expect(opened.storage).not.toBe(refusing);
    expect(opened.storage).toBeInstanceOf(MemoryStorage);
    expect(opened.persistent).toBe(false);
  });

  it("keeps a store that already holds data but refuses a write: it is full, not blocked, and its deals must still load", () => {
    const full = new RefusingStorage();
    MemoryStorage.prototype.setItem.call(full, "spec-studio:deals", "{}");
    const opened = openBrowserStorage(() => full);
    expect(opened.storage).toBe(full);
    expect(opened.persistent).toBe(true);
  });

  it("reads window.localStorage when given nothing, and falls back where there is no window", () => {
    // The node test environment has no window, which is as good as storage that cannot be reached.
    const opened = openBrowserStorage();
    expect(opened.persistent).toBe(false);
    expect(opened.storage).toBeInstanceOf(MemoryStorage);
  });
});
