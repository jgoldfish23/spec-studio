import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import { testSampleComps } from "../../testing/sampleIds";
import { createLocalRepository } from "../local/localRepository";
import { MemoryStorage } from "../local/memoryStorage";
import { sampleDealInputs } from "../sample";
import type { StoredDeal } from "../types";
import { createDeviceCopy } from "./deviceCopy";

const SCOPE = "user-a";
const REGION = "utah-north";

const deal = (n: number, over: Partial<StoredDeal> = {}): StoredDeal => ({
  id: `2222222${n}-2222-4222-8222-222222222222`,
  name: `Deal ${n}`,
  status: "analyzing",
  inputs: sampleDealInputs(),
  createdAt: "2026-11-01T12:00:00.123456+00:00",
  updatedAt: `2026-11-0${n + 1}T09:30:00.654321+00:00`,
  ...over,
});
const keys = (storage: Storage) =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "");

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("createDeviceCopy", () => {
  it("has nothing until something is kept", () => {
    const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
    expect(copy.deals()).toBeNull();
    expect(copy.deal(deal(1).id)).toBeUndefined();
    expect(copy.comps(REGION)).toBeNull();
    expect(copy.costBook(REGION)).toBeNull();
    expect(copy.marketSettings(REGION)).toBeNull();
    expect(copy.companySettings()).toBeNull();
  });

  it("keeps each read under the owner's scope, one versioned key per read, apart from the outbox", async () => {
    const storage = new MemoryStorage();
    const copy = createDeviceCopy(storage, SCOPE);
    const costBook = await createLocalRepository(
      new MemoryStorage(),
    ).getCostBook(REGION);
    copy.putDealList([deal(1)]);
    copy.putComps(REGION, testSampleComps());
    copy.putCostBook(REGION, costBook);
    copy.putMarketSettings(REGION, DEFAULT_MARKET_SETTINGS);
    copy.putCompanySettings({ rules: DEFAULT_RULES, contingencyPct: 0.05 });
    expect(keys(storage).sort()).toEqual([
      "spec-studio:cache:user-a:companySettings",
      "spec-studio:cache:user-a:comps:utah-north",
      "spec-studio:cache:user-a:costBook:utah-north",
      "spec-studio:cache:user-a:deals",
      "spec-studio:cache:user-a:marketSettings:utah-north",
    ]);
    expect(
      JSON.parse(storage.getItem("spec-studio:cache:user-a:deals") ?? "{}"),
    ).toMatchObject({ version: 1 });

    // A fresh instance reads it all back, timestamps exactly as given.
    const again = createDeviceCopy(storage, SCOPE);
    expect(again.deals()).toEqual([deal(1)]);
    expect(again.deal(deal(1).id)?.updatedAt).toBe(
      "2026-11-02T09:30:00.654321+00:00",
    );
    expect(again.comps(REGION)).toEqual(testSampleComps());
    expect(again.costBook(REGION)).toEqual(costBook);
    expect(again.marketSettings(REGION)).toEqual(DEFAULT_MARKET_SETTINGS);
    expect(again.companySettings()).toEqual({
      rules: DEFAULT_RULES,
      contingencyPct: 0.05,
    });
  });

  it("keeps one owner's copy from another's on the same device", () => {
    const storage = new MemoryStorage();
    createDeviceCopy(storage, "user-a").putDealList([deal(1)]);
    const b = createDeviceCopy(storage, "user-b");
    expect(b.deals()).toBeNull();
    expect(b.deal(deal(1).id)).toBeUndefined();
  });

  describe("deals", () => {
    it("puts a saved or new deal first, replacing its old copy", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      copy.putDealList([deal(1), deal(2)]);
      copy.putDeal(deal(2, { name: "Renamed" }));
      copy.putDeal(deal(3));
      expect(copy.deals()?.map((d) => d.name)).toEqual([
        "Deal 3",
        "Renamed",
        "Deal 1",
      ]);
      expect(copy.deal(deal(2).id)?.name).toBe("Renamed");
    });

    it("removes one deal, or all of them", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      copy.putDealList([deal(1), deal(2)]);
      copy.removeDeal(deal(1).id);
      expect(copy.deals()?.map((d) => d.name)).toEqual(["Deal 2"]);
      copy.removeAllDeals();
      expect(copy.deals()).toEqual([]);
    });
  });

  describe("comps", () => {
    it("adds or replaces a saved comp in its region's copy, and drops a deleted one from every region", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      const [first, second] = testSampleComps();
      copy.putComps(REGION, [first!]);
      copy.putComps("elsewhere", [{ ...first!, region: "elsewhere" }]);
      copy.putComp({ ...first!, address: "1 New Address" });
      copy.putComp(second!);
      expect(copy.comps(REGION)?.map((c) => c.address)).toEqual([
        "1 New Address",
        second!.address,
      ]);
      copy.removeComp(first!.id);
      expect(copy.comps(REGION)?.map((c) => c.id)).toEqual([second!.id]);
      expect(copy.comps("elsewhere")).toEqual([]);
    });

    it("does not start a region's copy from one saved comp, which would look like the whole list", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      copy.putComp(testSampleComps()[0]!);
      expect(copy.comps(REGION)).toBeNull();
    });
  });

  describe("an unreadable copy", () => {
    it.each([
      ["not JSON", "spec-studio:cache:user-a:deals", "{oops"],
      [
        "another version",
        "spec-studio:cache:user-a:deals",
        JSON.stringify({ version: 2, deals: [] }),
      ],
      [
        "a deal that does not read back",
        "spec-studio:cache:user-a:deals",
        JSON.stringify({
          version: 1,
          deals: [{ ...deal(1), inputs: { lot: null } }],
        }),
      ],
      [
        "comps of the wrong shape",
        "spec-studio:cache:user-a:comps:utah-north",
        JSON.stringify({ version: 1, comps: [{ id: 7 }] }),
      ],
      [
        "a cost book of the wrong shape",
        "spec-studio:cache:user-a:costBook:utah-north",
        JSON.stringify({ version: 1, costBook: { lines: "x" } }),
      ],
      [
        "market settings of the wrong shape",
        "spec-studio:cache:user-a:marketSettings:utah-north",
        JSON.stringify({ version: 1, marketSettings: { region: 3 } }),
      ],
      [
        "company settings of the wrong shape",
        "spec-studio:cache:user-a:companySettings",
        JSON.stringify({ version: 1, companySettings: { rules: null } }),
      ],
    ])("is ignored when it is %s, and said once", (_name, key, raw) => {
      const storage = new MemoryStorage();
      storage.setItem(key, raw);
      const copy = createDeviceCopy(storage, SCOPE);
      const readAll = () => [
        copy.deals(),
        copy.comps(REGION),
        copy.costBook(REGION),
        copy.marketSettings(REGION),
        copy.companySettings(),
      ];
      expect(readAll()).toEqual([null, null, null, null, null]);
      expect(readAll()).toEqual([null, null, null, null, null]);
      expect(logged).toHaveBeenCalledTimes(1);
    });

    it("is ignored when the store cannot be read at all", () => {
      class Unreadable extends MemoryStorage {
        override getItem(): string | null {
          throw new DOMException("blocked", "SecurityError");
        }
      }
      const copy = createDeviceCopy(new Unreadable(), SCOPE);
      expect(copy.deals()).toBeNull();
      expect(copy.companySettings()).toBeNull();
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });

  it("goes on without a copy when the store is full, and says so once", () => {
    class Full extends MemoryStorage {
      override setItem(): void {
        throw new DOMException("full", "QuotaExceededError");
      }
    }
    const copy = createDeviceCopy(new Full(), SCOPE);
    expect(() => copy.putDealList([deal(1)])).not.toThrow();
    expect(() => copy.putComps(REGION, testSampleComps())).not.toThrow();
    expect(copy.deals()).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("forget removes this owner's whole copy, leaving the outbox and other owners, and keeps working after", () => {
    const storage = new MemoryStorage();
    storage.setItem("spec-studio:outbox:user-a", "{}");
    createDeviceCopy(storage, "user-ab").putDealList([deal(2)]);
    const copy = createDeviceCopy(storage, SCOPE);
    copy.putDealList([deal(1)]);
    copy.putComps(REGION, testSampleComps());
    copy.forget();
    expect(keys(storage).sort()).toEqual([
      "spec-studio:cache:user-ab:deals",
      "spec-studio:outbox:user-a",
    ]);
    // A sign-out that did not happen leaves the copy working.
    copy.putDeal(deal(3));
    expect(copy.deals()?.map((d) => d.name)).toEqual(["Deal 3"]);
  });

  it("stop keeps what is there and writes nothing more, so a read that lands after the session ended adds nothing", () => {
    const storage = new MemoryStorage();
    const copy = createDeviceCopy(storage, SCOPE);
    copy.putDealList([deal(1)]);
    copy.stop();
    copy.putDeal(deal(3));
    copy.putComps(REGION, testSampleComps());
    expect(copy.deals()?.map((d) => d.name)).toEqual(["Deal 1"]);
    expect(copy.comps(REGION)).toBeNull();
    copy.forget();
    copy.putDealList([deal(2)]);
    expect(keys(storage)).toEqual([]);
  });

  it("removes a read's copy when writing its newer value fails, so the stale one is never served", () => {
    let full = false;
    class FillsUp extends MemoryStorage {
      override setItem(key: string, value: string): void {
        if (full) throw new DOMException("full", "QuotaExceededError");
        super.setItem(key, value);
      }
    }
    const copy = createDeviceCopy(new FillsUp(), SCOPE);
    copy.putDealList([deal(1)]);
    copy.putCompanySettings({ rules: DEFAULT_RULES, contingencyPct: 0.05 });
    full = true;
    copy.putDeal(deal(1, { name: "Renamed" }));
    copy.putCompanySettings({ rules: DEFAULT_RULES, contingencyPct: 0.07 });
    expect(copy.deals()).toBeNull();
    expect(copy.companySettings()).toBeNull();
  });

  describe("since", () => {
    it("is current until that read's copy is written, by anything", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      const deals = copy.since("deals");
      const comps = copy.since(`comps:${REGION}`);
      expect(deals()).toBe(true);
      copy.putDeal(deal(1));
      expect(deals()).toBe(false);
      expect(comps()).toBe(true);
      copy.putComps(REGION, []);
      expect(comps()).toBe(false);
    });

    it("counts a removal as a write", () => {
      const copy = createDeviceCopy(new MemoryStorage(), SCOPE);
      copy.putDealList([deal(1)]);
      const deals = copy.since("deals");
      copy.removeDeal(deal(1).id);
      expect(deals()).toBe(false);
    });
  });
});
