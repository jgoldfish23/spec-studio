import { describe, expect, it } from "vitest";
import type { Bid } from "@engine";
import { bidProblems, removeBid, upsertBid } from "./bids";
import type { BidDraft } from "./bids";

const bid = (code: string, amountCents: number, extra: Partial<Bid> = {}): Bid => ({
  code,
  amountCents,
  vendor: `${code} vendor`,
  receivedOn: "2026-10-12",
  ...extra,
});

describe("upsertBid", () => {
  it("appends a bid for a code that has none", () => {
    const bids = [bid("framing", 100)];
    const added = bid("roofing", 200);
    expect(upsertBid(bids, added)).toEqual([bids[0], added]);
  });

  it("replaces the bid for the code in place, keeping the others in their order", () => {
    const bids = [bid("plans", 1), bid("framing", 2), bid("roofing", 3)];
    const replacement = bid("framing", 99, { vendor: "New vendor", notes: "Revised" });
    expect(upsertBid(bids, replacement)).toEqual([bids[0], replacement, bids[2]]);
  });

  it("leaves one bid for the code when the list held several, in the place of the first", () => {
    const bids = [bid("plans", 1), bid("framing", 2), bid("roofing", 3), bid("framing", 4, { receivedOn: "2026-10-20" })];
    const replacement = bid("framing", 5);
    const result = upsertBid(bids, replacement);
    expect(result).toEqual([bids[0], replacement, bids[2]]);
    expect(result.filter((b) => b.code === "framing")).toHaveLength(1);
  });

  it("does not change the list it was given, or the bid", () => {
    const bids = [bid("plans", 1), bid("framing", 2)];
    const before = structuredClone(bids);
    const added = bid("framing", 7);
    const addedBefore = structuredClone(added);
    const result = upsertBid(bids, added);
    expect(bids).toEqual(before);
    expect(added).toEqual(addedBefore);
    expect(result).not.toBe(bids);
  });

  it("works on an empty list", () => {
    const only = bid("roofing", 5);
    expect(upsertBid([], only)).toEqual([only]);
  });
});

describe("removeBid", () => {
  it("removes the bid for the code and keeps the rest in order", () => {
    const bids = [bid("plans", 1), bid("framing", 2), bid("roofing", 3)];
    expect(removeBid(bids, "framing")).toEqual([bids[0], bids[2]]);
  });

  it("removes every bid for the code", () => {
    const bids = [bid("framing", 1), bid("plans", 2), bid("framing", 3)];
    expect(removeBid(bids, "framing")).toEqual([bids[1]]);
  });

  it("returns an equal list when no bid is for the code", () => {
    const bids = [bid("plans", 1)];
    expect(removeBid(bids, "roofing")).toEqual(bids);
  });

  it("does not change the list it was given", () => {
    const bids = [bid("plans", 1), bid("framing", 2)];
    const before = structuredClone(bids);
    const result = removeBid(bids, "framing");
    expect(bids).toEqual(before);
    expect(result).not.toBe(bids);
  });
});

describe("bidProblems", () => {
  const draft = (over: Partial<BidDraft> = {}): BidDraft => ({
    vendor: "Wasatch Roofing",
    amountCents: 3_000_000,
    receivedOn: "2026-10-31",
    ...over,
  });

  it("finds nothing wrong with a complete bid", () => {
    expect(bidProblems(draft())).toEqual({});
  });

  it("asks for a vendor when it is empty or only spaces", () => {
    expect(bidProblems(draft({ vendor: "" }))).toEqual({ vendor: "Vendor is required" });
    expect(bidProblems(draft({ vendor: "   " }))).toEqual({ vendor: "Vendor is required" });
  });

  it("asks for an amount above $0 when it is missing, zero or not a usable number", () => {
    const message = "Enter an amount above $0";
    expect(bidProblems(draft({ amountCents: undefined }))).toEqual({ amount: message });
    expect(bidProblems(draft({ amountCents: 0 }))).toEqual({ amount: message });
    expect(bidProblems(draft({ amountCents: -5 }))).toEqual({ amount: message });
    expect(bidProblems(draft({ amountCents: Number.NaN }))).toEqual({ amount: message });
  });

  it("takes one cent, the smallest amount", () => {
    expect(bidProblems(draft({ amountCents: 1 }))).toEqual({});
  });

  it("gives the engine's own message for a date it would refuse", () => {
    expect(bidProblems(draft({ receivedOn: "0026-10-31" })).receivedOn).toBe("Year must be 1900 or later");
    expect(bidProblems(draft({ receivedOn: "2101-01-01" })).receivedOn).toBe("Year must be 2100 or earlier");
    expect(bidProblems(draft({ receivedOn: "2026-02-31" })).receivedOn).toBe("Must be a real date as YYYY-MM-DD");
  });

  it("reports every problem at once", () => {
    expect(Object.keys(bidProblems(draft({ vendor: "", amountCents: 0, receivedOn: "2026-02-31" }))).sort()).toEqual([
      "amount",
      "receivedOn",
      "vendor",
    ]);
  });
});
