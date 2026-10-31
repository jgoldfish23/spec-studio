import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dismissLostSave, reportLostSave, resetLostSaves, useLostSaves } from "./lostSaves";

const entry = (dealId: string, message = "browser storage is full") => ({ dealId, dealName: `Deal ${dealId}`, message });

afterEach(() => {
  resetLostSaves();
});

describe("lostSaves", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useLostSaves());
    expect(result.current).toEqual([]);
  });

  it("lists a reported entry, and updates a mounted reader", () => {
    const { result } = renderHook(() => useLostSaves());
    act(() => reportLostSave(entry("a")));
    expect(result.current).toEqual([entry("a")]);
  });

  it("is there for a reader that mounts after the report", () => {
    reportLostSave(entry("a"));
    const { result } = renderHook(() => useLostSaves());
    expect(result.current).toEqual([entry("a")]);
  });

  it("keeps entries for different deals in the order they were reported", () => {
    reportLostSave(entry("a"));
    reportLostSave(entry("b"));
    const { result } = renderHook(() => useLostSaves());
    expect(result.current.map((l) => l.dealId)).toEqual(["a", "b"]);
  });

  it("replaces the entry of a deal that is reported again, in place", () => {
    reportLostSave(entry("a", "first"));
    reportLostSave(entry("b"));
    const { result } = renderHook(() => useLostSaves());
    act(() => reportLostSave({ dealId: "a", dealName: "Renamed", message: "second" }));
    expect(result.current).toEqual([{ dealId: "a", dealName: "Renamed", message: "second" }, entry("b")]);
  });

  it("dismisses one deal's entry and leaves the others", () => {
    reportLostSave(entry("a"));
    reportLostSave(entry("b"));
    const { result } = renderHook(() => useLostSaves());
    act(() => dismissLostSave("a"));
    expect(result.current).toEqual([entry("b")]);
  });

  it("returns the same array until something changes", () => {
    reportLostSave(entry("a"));
    const { result, rerender } = renderHook(() => useLostSaves());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    // Nothing changes, so nothing is replaced: dismissing a deal with no entry, or reporting the same entry again.
    act(() => dismissLostSave("nobody"));
    act(() => reportLostSave(entry("a")));
    expect(result.current).toBe(first);

    act(() => reportLostSave(entry("b")));
    expect(result.current).not.toBe(first);
  });

  it("hands the reader a copy, so the stored entries cannot be changed from outside", () => {
    const original = entry("a");
    reportLostSave(original);
    original.message = "changed afterwards";
    const { result } = renderHook(() => useLostSaves());
    expect(result.current[0]?.message).toBe("browser storage is full");
  });

  it("resetLostSaves empties the store", () => {
    reportLostSave(entry("a"));
    resetLostSaves();
    const { result } = renderHook(() => useLostSaves());
    expect(result.current).toEqual([]);
  });
});
