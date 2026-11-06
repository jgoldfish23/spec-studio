import { afterEach, describe, expect, it, vi } from "vitest";
import { DataError } from "../types";
import { toDataError } from "./errors";

const OFFLINE = "Can't reach the server — check your connection.";
const SIGNED_OUT = "You've been signed out.";
const FAILED = "Couldn't save — the server said no. Try again in a minute.";

afterEach(() => vi.restoreAllMocks());

describe("toDataError", () => {
  it("maps a failed fetch (a TypeError) to offline", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = toDataError(new TypeError("Failed to fetch"), "save");
    expect(result).toBeInstanceOf(DataError);
    expect(result.kind).toBe("offline");
    expect(result.message).toBe(OFFLINE);
  });

  it("maps a PostgREST error that wraps a fetch failure to offline", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = toDataError({ message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch", code: "" }, "save");
    expect(result.kind).toBe("offline");
  });

  it.each([
    [{ status: 401, message: "JWT expired" }],
    [{ code: "PGRST301", message: "JWT expired" }],
    [{ code: "PGRST303", message: "JWT issued at future" }],
    [{ status: 401, code: "PGRST301", message: "x" }],
  ])("maps %j to signedOut", (error) => {
    const result = toDataError(error, "save");
    expect(result.kind).toBe("signedOut");
    expect(result.message).toBe(SIGNED_OUT);
  });

  it("maps anything else to failed, never exposing the raw message, and logs it once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = { code: "42501", message: "permission denied for table deals", details: null, hint: null };
    const result = toDataError(raw, "save", "deal-id");
    expect(result.kind).toBe("failed");
    expect(result.message).toBe(FAILED);
    expect(result.message).not.toMatch(/permission/);
    expect(result.recordId).toBe("deal-id");
    expect(result.cause).toBe(raw);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/save/);
  });

  it("uses the action in the message of a failed read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toDataError({ message: "boom" }, "load").message).toBe("Couldn't load — the server said no. Try again in a minute.");
  });

  it("does not log a signed-out or offline error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    toDataError({ status: 401, message: "x" }, "save");
    toDataError(new TypeError("x"), "save");
    expect(log).not.toHaveBeenCalled();
  });
});
