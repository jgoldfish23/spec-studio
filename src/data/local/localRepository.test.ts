import { describe, expect, it } from "vitest";
import { testSampleComps } from "../../testing/sampleIds";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES, type Comp } from "@engine";
import { isSampleComp, LEGACY_SAMPLE_COMP_IDS, sampleDealInputs } from "../sample";
import goldenComps from "../../engine/__fixtures__/golden-comps.json";
import { isUuid } from "../../lib/uuid";
import { STARTER_COST_BOOK } from "../starterCostBook";
import { newDealInputs } from "../newDeal";
import { MemoryStorage } from "./memoryStorage";
import { DataError, type StoredDeal } from "../types";
import { COMPS_KEY, createLocalRepository, DEALS_KEY, SETTINGS_KEY } from "./localRepository";

const T0 = "2026-10-31T09:00:00.000Z";
const SAVE_FAILED = "Couldn't save — browser storage is full or unavailable";

/** A repository on fresh memory storage, with a clock the test can move and ids deal-1, deal-2, ... */
function setup(storage: Storage = new MemoryStorage()) {
  const clock = { now: T0 };
  let counter = 0;
  const repo = createLocalRepository(storage, { now: () => clock.now, newId: () => `deal-${++counter}` });
  return { storage, clock, repo };
}

/** A storage that is full: it starts with `seed`, reads work, and every write throws. */
class FullStorage extends MemoryStorage {
  constructor(seed: Record<string, string> = {}) {
    super();
    for (const [key, value] of Object.entries(seed)) super.setItem(key, value);
  }

  override setItem(): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }
}

function storedDeal(id: string, updatedAt = T0): StoredDeal {
  return {
    id,
    name: `Deal ${id}`,
    status: "analyzing",
    inputs: sampleDealInputs(),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt,
  };
}

/** A deal as a hand edit or a buggy older version could have left it: the lot price is a string. */
function badPriceDeal(id: string): unknown {
  const deal = storedDeal(id);
  return { ...deal, inputs: { ...deal.inputs, lot: { ...deal.inputs.lot, priceCents: "x" } } };
}

function putDeals(storage: Storage, deals: Record<string, unknown>): void {
  storage.setItem(DEALS_KEY, JSON.stringify(deals));
}

function comp(id: string, region = "utah-north"): Comp {
  const base = testSampleComps()[0] as Comp;
  return { ...base, id, region, source: "manual" };
}

describe("storage keys", () => {
  it("are versioned", () => {
    expect(DEALS_KEY).toBe("spec-studio:v1:deals");
    expect(COMPS_KEY).toBe("spec-studio:v1:comps");
    expect(SETTINGS_KEY).toBe("spec-studio:v1:settings");
  });
});

describe("createDeal and getDeal", () => {
  it("creates an analyzing deal stamped with the id and the time", async () => {
    const { repo } = setup();
    const inputs = sampleDealInputs();
    const deal = await repo.createDeal({ name: "Kaysville lot", inputs });
    expect(deal).toEqual({
      id: "deal-1",
      name: "Kaysville lot",
      status: "analyzing",
      inputs,
      createdAt: T0,
      updatedAt: T0,
    });
  });

  it("round-trips: what was created is what getDeal reads back", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "Kaysville lot", inputs: sampleDealInputs() });
    expect(await repo.getDeal(created.id)).toEqual(created);
  });

  it("keeps a brand-new deal with an empty city readable", async () => {
    const { repo } = setup();
    const inputs = newDealInputs("2026-10-31", { rules: DEFAULT_RULES, contingencyPct: 0.05 });
    const created = await repo.createDeal({ name: "Blank", inputs });
    expect(await repo.getDeal(created.id)).toEqual(created);
    expect((await repo.listDeals()).problems).toEqual([]);
  });

  it("stores deals as one object keyed by id", async () => {
    const { repo, storage } = setup();
    const a = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const b = await repo.createDeal({ name: "B", inputs: sampleDealInputs() });
    const raw = JSON.parse(storage.getItem(DEALS_KEY) as string) as Record<string, StoredDeal>;
    expect(Object.keys(raw).sort()).toEqual([a.id, b.id]);
    expect(raw[a.id]).toEqual(a);
  });

  it("returns null for a deal that does not exist", async () => {
    const { repo } = setup();
    expect(await repo.getDeal("nope")).toBeNull();
    await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    expect(await repo.getDeal("nope")).toBeNull();
  });

  it("hands out copies: changing a returned deal does not change the store", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    created.name = "Changed";
    created.inputs.lot.city = "Changed";
    const read = (await repo.getDeal("deal-1")) as StoredDeal;
    read.inputs.house.rooms.fireplaces = 9;
    const again = (await repo.getDeal("deal-1")) as StoredDeal;
    expect(again.name).toBe("A");
    expect(again.inputs.lot.city).toBe("Kaysville");
    expect(again.inputs.house.rooms.fireplaces).toBe(1);
  });

  it("does not keep a reference to the inputs it was given", async () => {
    const { repo } = setup();
    const inputs = sampleDealInputs();
    const created = await repo.createDeal({ name: "A", inputs });
    inputs.lot.city = "Changed";
    expect(created.inputs.lot.city).toBe("Kaysville");
  });

  it("uses a random id and the real clock when none are given", async () => {
    const repo = createLocalRepository(new MemoryStorage());
    const before = Date.now();
    const deal = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    expect(deal.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(deal.createdAt).toISOString()).toBe(deal.createdAt);
    expect(Date.parse(deal.createdAt)).toBeGreaterThanOrEqual(before);
    expect(deal.updatedAt).toBe(deal.createdAt);
    const other = await repo.createDeal({ name: "B", inputs: sampleDealInputs() });
    expect(other.id).not.toBe(deal.id);
  });
});

describe("saveDeal", () => {
  it("stamps updatedAt with the current time and returns the saved copy", async () => {
    const { repo, clock } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    clock.now = "2026-10-31T10:30:00.000Z";
    const edited: StoredDeal = { ...created, name: "A, renamed", status: "bought" };
    const saved = await repo.saveDeal(edited);
    expect(saved).toEqual({ ...created, name: "A, renamed", status: "bought", updatedAt: "2026-10-31T10:30:00.000Z" });
    expect(saved).not.toBe(edited);
    expect(saved.createdAt).toBe(T0);
    expect(await repo.getDeal(created.id)).toEqual(saved);
  });

  it("does not change the deal it was given", async () => {
    const { repo, clock } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    clock.now = "2026-10-31T10:30:00.000Z";
    const edited: StoredDeal = { ...created };
    await repo.saveDeal(edited);
    expect(edited.updatedAt).toBe(T0);
  });

  it("stores the edited inputs", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    created.inputs.lot.city = "Layton";
    created.inputs.lot.priceCents = 31_000_000;
    await repo.saveDeal(created);
    const read = (await repo.getDeal(created.id)) as StoredDeal;
    expect(read.inputs.lot.city).toBe("Layton");
    expect(read.inputs.lot.priceCents).toBe(31_000_000);
  });

  it("hands back a copy, so changing it does not change the store", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const saved = await repo.saveDeal(created);
    saved.inputs.lot.city = "Changed";
    expect(((await repo.getDeal(created.id)) as StoredDeal).inputs.lot.city).toBe("Kaysville");
  });

  it("leaves other deals alone, including one that cannot be read", async () => {
    const { repo, storage } = setup();
    putDeals(storage, { good: storedDeal("good"), bad: badPriceDeal("bad") });
    await repo.saveDeal(storedDeal("good"));
    const raw = JSON.parse(storage.getItem(DEALS_KEY) as string) as Record<string, unknown>;
    expect(raw["bad"]).toEqual(badPriceDeal("bad"));
  });

  it("refuses to write over a store that cannot be read", async () => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, "{not json");
    await expect(repo.saveDeal(storedDeal("good"))).rejects.toBeInstanceOf(DataError);
    await expect(repo.createDeal({ name: "A", inputs: sampleDealInputs() })).rejects.toBeInstanceOf(DataError);
    expect(storage.getItem(DEALS_KEY)).toBe("{not json");
  });
});

describe("ids that look like object properties", () => {
  it("are ordinary ids: unknown ones read as missing, and they can be stored", async () => {
    const { repo, storage } = setup();
    for (const id of ["constructor", "toString", "__proto__"]) {
      expect(await repo.getDeal(id)).toBeNull();
      await expect(repo.deleteDeal(id)).resolves.toBeUndefined();
    }
    putDeals(storage, { ["__proto__"]: storedDeal("__proto__") });
    const saved = await repo.saveDeal(storedDeal("__proto__"));
    expect(await repo.getDeal("__proto__")).toEqual(saved);
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual(["__proto__"]);
    await repo.deleteDeal("__proto__");
    expect(await repo.listDeals()).toEqual({ deals: [], problems: [] });
  });
});

describe("listDeals", () => {
  it("is empty when nothing has been saved", async () => {
    const { repo } = setup();
    expect(await repo.listDeals()).toEqual({ deals: [], problems: [] });
  });

  it("lists the newest update first", async () => {
    const { repo, clock } = setup();
    await repo.createDeal({ name: "first", inputs: sampleDealInputs() });
    clock.now = "2026-10-31T09:05:00.000Z";
    await repo.createDeal({ name: "second", inputs: sampleDealInputs() });
    clock.now = "2026-10-31T09:10:00.000Z";
    await repo.createDeal({ name: "third", inputs: sampleDealInputs() });
    expect((await repo.listDeals()).deals.map((d) => d.name)).toEqual(["third", "second", "first"]);

    // Saving the oldest deal moves it to the top.
    clock.now = "2026-10-31T09:20:00.000Z";
    const first = (await repo.getDeal("deal-1")) as StoredDeal;
    await repo.saveDeal(first);
    expect((await repo.listDeals()).deals.map((d) => d.name)).toEqual(["first", "third", "second"]);
  });

  it("orders by the instant, not the text, when timestamps carry an offset", async () => {
    const { repo, storage } = setup();
    putDeals(storage, {
      earlier: storedDeal("earlier", "2026-10-31T09:00:00.000+00:00"),
      later: storedDeal("later", "2026-10-31T08:00:00.000-02:00"),
    });
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual(["later", "earlier"]);
  });

  it("lists a deal it cannot read under problems, and still lists the good ones", async () => {
    const { repo, storage } = setup();
    putDeals(storage, { good: storedDeal("good"), bad: badPriceDeal("bad") });
    const { deals, problems } = await repo.listDeals();
    expect(deals.map((d) => d.id)).toEqual(["good"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.id).toBe("bad");
    expect(problems[0]?.message).toMatch(/^inputs\.lot\.priceCents: expected number/);
  });

  it("names the field when another part of a record is wrong", async () => {
    const { repo, storage } = setup();
    putDeals(storage, {
      noStatus: { ...storedDeal("noStatus"), status: undefined },
      oddStatus: { ...storedDeal("oddStatus"), status: "pending" },
      noInputs: { ...storedDeal("noInputs"), inputs: null },
      notAnObject: "hello",
    });
    const { deals, problems } = await repo.listDeals();
    expect(deals).toEqual([]);
    const byId = Object.fromEntries(problems.map((p) => [p.id, p.message]));
    expect(Object.keys(byId).sort()).toEqual(["noInputs", "noStatus", "notAnObject", "oddStatus"]);
    expect(byId["noStatus"]).toMatch(/^status: /);
    expect(byId["oddStatus"]).toMatch(/^status: /);
    expect(byId["noInputs"]).toMatch(/^inputs: /);
    expect(byId["notAnObject"]).toMatch(/expected object/);
  });

  it.each([
    ["not JSON", "{oops"],
    ["empty text", ""],
    ["null", "null"],
    ["a list", "[]"],
    ["a number", "42"],
    ["text", '"deals"'],
  ])("reports a store that is %s as one problem with id *", async (_name, raw) => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, raw);
    const { deals, problems } = await repo.listDeals();
    expect(deals).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.id).toBe("*");
    expect(problems[0]?.message).toEqual(expect.any(String));
    expect(problems[0]?.message).not.toBe("");
  });

  it("reports a store that cannot be read at all as one problem with id *", async () => {
    class BlockedStorage extends MemoryStorage {
      override getItem(): string | null {
        throw new DOMException("Access is denied.", "SecurityError");
      }
    }
    const { repo } = setup(new BlockedStorage());
    const { deals, problems } = await repo.listDeals();
    expect(deals).toEqual([]);
    expect(problems.map((p) => p.id)).toEqual(["*"]);
  });

  it("hands out copies", async () => {
    const { repo } = setup();
    await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const { deals } = await repo.listDeals();
    (deals[0] as StoredDeal).inputs.lot.city = "Changed";
    expect(((await repo.listDeals()).deals[0] as StoredDeal).inputs.lot.city).toBe("Kaysville");
  });
});

describe("getDeal on corrupt data", () => {
  it("rejects with a DataError that names the record and the field", async () => {
    const { repo, storage } = setup();
    putDeals(storage, { good: storedDeal("good"), bad: badPriceDeal("bad") });
    const error = await repo.getDeal("bad").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    const dataError = error as DataError;
    expect(dataError.recordId).toBe("bad");
    expect(dataError.path).toBe("inputs.lot.priceCents");
    expect(dataError.message).toMatch(/inputs\.lot\.priceCents: expected number/);
  });

  it("still reads the good deal next to it", async () => {
    const { repo, storage } = setup();
    putDeals(storage, { good: storedDeal("good"), bad: badPriceDeal("bad") });
    expect(((await repo.getDeal("good")) as StoredDeal).id).toBe("good");
  });

  it("rejects with a DataError for the whole store when it cannot be read", async () => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, "{oops");
    const error = (await repo.getDeal("any").catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.recordId).toBe("*");
  });
});

describe("deleteDeal", () => {
  it("removes the deal and leaves the others", async () => {
    const { repo } = setup();
    const a = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const b = await repo.createDeal({ name: "B", inputs: sampleDealInputs() });
    await repo.deleteDeal(a.id);
    expect(await repo.getDeal(a.id)).toBeNull();
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual([b.id]);
  });

  it("does nothing for an id that is not there", async () => {
    const { repo, storage } = setup();
    await expect(repo.deleteDeal("nope")).resolves.toBeUndefined();
    expect(storage.getItem(DEALS_KEY)).toBeNull();
    const a = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    await expect(repo.deleteDeal("nope")).resolves.toBeUndefined();
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual([a.id]);
  });

  it("removes a deal that cannot be read, so the list can be cleaned up", async () => {
    const { repo, storage } = setup();
    putDeals(storage, { good: storedDeal("good"), bad: badPriceDeal("bad") });
    await repo.deleteDeal("bad");
    expect(await repo.listDeals()).toEqual({ deals: [storedDeal("good")], problems: [] });
  });

  it("does nothing when the whole store cannot be read", async () => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, "{oops");
    await expect(repo.deleteDeal("any")).resolves.toBeUndefined();
    expect(storage.getItem(DEALS_KEY)).toBe("{oops");
  });
});

describe("resetDeals", () => {
  it("removes the deals key, garbage and all, and leaves a clean empty list", async () => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, "{oops");
    expect((await repo.listDeals()).problems[0]?.id).toBe("*");
    await repo.resetDeals();
    expect(storage.getItem(DEALS_KEY)).toBeNull();
    expect(await repo.listDeals()).toEqual({ deals: [], problems: [] });
  });

  it("removes every readable deal too, and leaves comps alone", async () => {
    const { repo, storage } = setup();
    await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    await repo.saveComp(comp("c1"));
    await repo.resetDeals();
    expect(await repo.listDeals()).toEqual({ deals: [], problems: [] });
    expect(await repo.listComps("utah-north")).toHaveLength(1);
    expect(storage.getItem(COMPS_KEY)).not.toBeNull();
  });

  it("lets new deals be saved afterwards", async () => {
    const { repo, storage } = setup();
    storage.setItem(DEALS_KEY, "{oops");
    await repo.resetDeals();
    const created = await repo.createDeal({ name: "Fresh", inputs: sampleDealInputs() });
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual([created.id]);
  });
});

describe("comps", () => {
  it("saves a comp and lists it by region, leaving other regions out", async () => {
    const { repo } = setup();
    const here = comp("c1");
    const elsewhere = comp("c2", "colorado-front-range");
    expect(await repo.listComps("utah-north")).toEqual([]);
    expect(await repo.saveComp(here)).toEqual(here);
    await repo.saveComp(elsewhere);
    expect(await repo.listComps("utah-north")).toEqual([here]);
    expect(await repo.listComps("colorado-front-range")).toEqual([elsewhere]);
    expect(await repo.listComps("nowhere")).toEqual([]);
  });

  it("replaces the comp that has the same id", async () => {
    const { repo } = setup();
    await repo.saveComp(comp("c1"));
    await repo.saveComp({ ...comp("c1"), address: "12 New Street" });
    const listed = await repo.listComps("utah-north");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.address).toBe("12 New Street");
  });

  it("deletes a comp, and ignores an id that is not there", async () => {
    const { repo } = setup();
    await repo.saveComp(comp("c1"));
    await repo.saveComp(comp("c2"));
    await repo.deleteComp("c1");
    expect((await repo.listComps("utah-north")).map((c) => c.id)).toEqual(["c2"]);
    await expect(repo.deleteComp("nope")).resolves.toBeUndefined();
    expect((await repo.listComps("utah-north")).map((c) => c.id)).toEqual(["c2"]);
  });

  it("does not create the comps key when there is nothing to delete", async () => {
    const { repo, storage } = setup();
    await repo.deleteComp("nope");
    expect(storage.getItem(COMPS_KEY)).toBeNull();
  });

  it("hands out copies", async () => {
    const { repo } = setup();
    const saved = await repo.saveComp(comp("c1"));
    saved.address = "Changed";
    const listed = await repo.listComps("utah-north");
    expect(listed[0]?.address).not.toBe("Changed");
    (listed[0] as Comp).address = "Changed again";
    expect((await repo.listComps("utah-north"))[0]?.address).not.toBe("Changed again");
  });

  it("skips a comp that cannot be read, and lists the rest", async () => {
    const { repo, storage } = setup();
    storage.setItem(
      COMPS_KEY,
      JSON.stringify({ good: comp("good"), bad: { ...comp("bad"), soldPriceCents: "lots" }, worse: 7 }),
    );
    const listed = await repo.listComps("utah-north");
    expect(listed.map((c) => c.id)).toEqual(["good"]);
  });

  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["a list", "[]"],
  ])("lists nothing, and does not throw, when the comps store is %s", async (_name, raw) => {
    const { repo, storage } = setup();
    storage.setItem(COMPS_KEY, raw);
    await expect(repo.listComps("utah-north")).resolves.toEqual([]);
  });

  it("starts the comps store over when saving into one that cannot be read", async () => {
    const { repo, storage } = setup();
    storage.setItem(COMPS_KEY, "{oops");
    await repo.saveComp(comp("c1"));
    expect((await repo.listComps("utah-north")).map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("the starter cost book", () => {
  it("serves the 74 Northern Utah prices with an empty price book", async () => {
    const { repo } = setup();
    const book = await repo.getCostBook("utah-north");
    expect(book.defaults).toHaveLength(74);
    expect(book.defaults).toEqual(STARTER_COST_BOOK);
    expect(book.priceBook).toEqual([]);
  });

  it("has no prices for a region it does not know", async () => {
    const { repo } = setup();
    expect(await repo.getCostBook("nowhere")).toEqual({ defaults: [], priceBook: [] });
  });

  it("hands out a copy", async () => {
    const { repo } = setup();
    const book = await repo.getCostBook("utah-north");
    const price = (book.defaults[0] as { unitPriceCents: number }).unitPriceCents;
    (book.defaults[0] as { unitPriceCents: number }).unitPriceCents = price + 1;
    book.defaults.pop();
    const again = await repo.getCostBook("utah-north");
    expect(again.defaults).toHaveLength(74);
    expect(again.defaults[0]?.unitPriceCents).toBe(price);
    expect(STARTER_COST_BOOK).toHaveLength(74);
  });
});

describe("market settings", () => {
  it("serves the defaults for the region", async () => {
    const { repo } = setup();
    expect(await repo.getMarketSettings("utah-north")).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("replaces the region and keeps everything else", async () => {
    const { repo } = setup();
    const settings = await repo.getMarketSettings("somewhere-else");
    expect(settings).toEqual({ ...DEFAULT_MARKET_SETTINGS, region: "somewhere-else" });
    expect(DEFAULT_MARKET_SETTINGS.region).toBe("utah-north");
  });

  it("hands out a copy, so the defaults cannot be changed through it", async () => {
    const { repo } = setup();
    const settings = await repo.getMarketSettings("utah-north");
    settings.featureValues.poolCents = 1;
    settings.seasonalFactors[0] = 99;
    expect(DEFAULT_MARKET_SETTINGS.featureValues.poolCents).toBe(2_500_000);
    expect(DEFAULT_MARKET_SETTINGS.seasonalFactors[0]).toBe(1.2);
    expect((await repo.getMarketSettings("utah-north")).featureValues.poolCents).toBe(2_500_000);
  });
});

describe("company settings", () => {
  const defaults = { rules: DEFAULT_RULES, contingencyPct: 0.05 };

  it("defaults to the engine's rules and 5% contingency", async () => {
    const { repo } = setup();
    expect(await repo.getCompanySettings()).toEqual(defaults);
  });

  it("reads settings that were stored", async () => {
    const { repo, storage } = setup();
    const stored = {
      rules: { minMarginOnSale: 0.2, minAnnualizedReturn: 0.3, minDownsideProfitCents: 500_000 },
      contingencyPct: 0.08,
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    expect(await repo.getCompanySettings()).toEqual(stored);
  });

  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["a list", "[]"],
    ["the wrong shape", JSON.stringify({ rules: "strict", contingencyPct: "5%" })],
    ["missing rules", JSON.stringify({ contingencyPct: 0.05 })],
  ])("falls back to the defaults when the stored settings are %s", async (_name, raw) => {
    const { repo, storage } = setup();
    storage.setItem(SETTINGS_KEY, raw);
    expect(await repo.getCompanySettings()).toEqual(defaults);
  });

  it("hands out a copy, so the default rules cannot be changed through it", async () => {
    const { repo } = setup();
    const settings = await repo.getCompanySettings();
    settings.rules.minMarginOnSale = 0.99;
    settings.contingencyPct = 0.5;
    expect(DEFAULT_RULES.minMarginOnSale).toBe(0.15);
    expect(await repo.getCompanySettings()).toEqual(defaults);
  });
});

describe("a save that would not read back", () => {
  const rawDeals = (storage: Storage): string | null => storage.getItem(DEALS_KEY);

  it("rejects a blank name and keeps the deal that was stored", async () => {
    const { repo, storage } = setup();
    const created = await repo.createDeal({ name: "Kaysville lot", inputs: sampleDealInputs() });
    const before = rawDeals(storage);
    const error = (await repo.saveDeal({ ...created, name: "" }).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.recordId).toBe(created.id);
    expect(error.path).toBe("name");
    expect(error.message).toMatch(/^Couldn't save — name: /);
    expect(rawDeals(storage)).toBe(before);
    expect(((await repo.getDeal(created.id)) as StoredDeal).name).toBe("Kaysville lot");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s in the inputs, which JSON would turn into null", async (_name, bad) => {
    const { repo, storage } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const before = rawDeals(storage);
    const edited = { ...created, inputs: { ...created.inputs, lot: { ...created.inputs.lot, priceCents: bad } } };
    const error = (await repo.saveDeal(edited).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.recordId).toBe(created.id);
    expect(error.path).toBe("inputs.lot.priceCents");
    expect(error.message).toMatch(/^Couldn't save — inputs\.lot\.priceCents: /);
    expect(rawDeals(storage)).toBe(before);
    expect(await repo.getDeal(created.id)).toEqual(created);
  });

  it("rejects a timestamp that is not a date, so a clock fault cannot corrupt a deal", async () => {
    const { repo, clock, storage } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    const before = rawDeals(storage);
    clock.now = "yesterday";
    const error = (await repo.saveDeal(created).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.path).toBe("updatedAt");
    expect(rawDeals(storage)).toBe(before);
  });

  it("rejects a new deal with a blank name and stores nothing", async () => {
    const { repo, storage } = setup();
    const error = (await repo.createDeal({ name: "", inputs: sampleDealInputs() }).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.path).toBe("name");
    expect(error.message).toMatch(/^Couldn't save — name: /);
    expect(rawDeals(storage)).toBeNull();
    expect(await repo.listDeals()).toEqual({ deals: [], problems: [] });
  });

  it("rejects a comp whose price is NaN and keeps the comp that was stored", async () => {
    const { repo, storage } = setup();
    const original = comp("c1");
    await repo.saveComp(original);
    const before = storage.getItem(COMPS_KEY);
    const error = (await repo
      .saveComp({ ...original, soldPriceCents: Number.NaN })
      .catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.recordId).toBe("c1");
    expect(error.path).toBe("soldPriceCents");
    expect(error.message).toMatch(/^Couldn't save — soldPriceCents: /);
    expect(storage.getItem(COMPS_KEY)).toBe(before);
    expect(await repo.listComps("utah-north")).toEqual([original]);
  });

  it("does not create the comps key for a comp it rejects", async () => {
    const { repo, storage } = setup();
    await expect(repo.saveComp({ ...comp("c1"), yearBuilt: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(DataError);
    expect(storage.getItem(COMPS_KEY)).toBeNull();
  });

  it("still saves a deal with problems the owner can fix", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    created.inputs.lot.city = "";
    created.inputs.timeline.buildMonths = 2.5;
    const basement = created.inputs.house.levels.basement;
    expect(basement).toBeDefined();
    if (basement) basement.finishedSf = 99_999;
    created.inputs.loan.ltc = 2;
    const saved = await repo.saveDeal(created);
    expect(await repo.getDeal(created.id)).toEqual(saved);
    expect(((await repo.getDeal(created.id)) as StoredDeal).inputs.lot.city).toBe("");
  });
});

describe("a write that fails", () => {
  it("turns a full or blocked store into a DataError for saveDeal", async () => {
    const { repo } = setup(new FullStorage({ [DEALS_KEY]: JSON.stringify({ a: storedDeal("a") }) }));
    const error = (await repo.saveDeal(storedDeal("a")).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.message).toBe(SAVE_FAILED);
    expect(error.cause).toBeInstanceOf(DOMException);
  });

  it("does the same for createDeal, saveComp and the deletes", async () => {
    const { repo } = setup(
      new FullStorage({
        [DEALS_KEY]: JSON.stringify({ a: storedDeal("a") }),
        [COMPS_KEY]: JSON.stringify({ c1: comp("c1") }),
      }),
    );
    const error = await repo.createDeal({ name: "B", inputs: sampleDealInputs() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toBe(SAVE_FAILED);
    await expect(repo.saveComp(comp("c2"))).rejects.toThrow(SAVE_FAILED);
    await expect(repo.deleteDeal("a")).rejects.toThrow(SAVE_FAILED);
    await expect(repo.deleteComp("c1")).rejects.toThrow(SAVE_FAILED);
  });

  it("leaves what was stored before untouched", async () => {
    const stored = JSON.stringify({ a: storedDeal("a") });
    const storage = new FullStorage({ [DEALS_KEY]: stored });
    const { repo } = setup(storage);
    await expect(repo.saveDeal(storedDeal("a"))).rejects.toBeInstanceOf(DataError);
    expect(storage.getItem(DEALS_KEY)).toBe(stored);
  });
});

const T1 = "2026-10-31T10:00:00.000Z";
const CONFLICT = "This deal was changed on another device or tab.";
const DELETED = "This deal was deleted on another device or tab.";

async function failure(promise: Promise<unknown>): Promise<DataError> {
  const caught = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(caught).toBeInstanceOf(DataError);
  return caught as DataError;
}

describe("saveDeal conflict and deletion checks", () => {
  it("returns a fresh updatedAt on a normal save", async () => {
    const { repo, clock } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    clock.now = T1;
    const saved = await repo.saveDeal(created);
    expect(saved.updatedAt).toBe(T1);
    expect((await repo.saveDeal(saved)).updatedAt).toBe(T1);
  });

  it("throws a conflict when another save happened in between", async () => {
    const { repo, clock } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    clock.now = T1;
    await repo.saveDeal({ ...created, name: "Other tab" });
    const caught = await failure(repo.saveDeal({ ...created, name: "This tab" }));
    expect(caught.kind).toBe("conflict");
    expect(caught.message).toBe(CONFLICT);
    expect(caught.recordId).toBe(created.id);
    expect((await repo.getDeal(created.id))?.name).toBe("Other tab");
  });

  it("saves a stale deal anyway with overwrite", async () => {
    const { repo, clock } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    clock.now = T1;
    await repo.saveDeal({ ...created, name: "Other tab" });
    const saved = await repo.saveDeal({ ...created, name: "This tab" }, { overwrite: true });
    expect(saved.name).toBe("This tab");
    expect((await repo.getDeal(created.id))?.name).toBe("This tab");
  });

  it("throws deleted when the deal is gone, with or without overwrite", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    await repo.deleteDeal(created.id);
    for (const options of [undefined, { overwrite: true }]) {
      const caught = await failure(repo.saveDeal(created, options));
      expect(caught.kind).toBe("deleted");
      expect(caught.message).toBe(DELETED);
    }
    expect((await repo.listDeals()).deals).toEqual([]);
  });

  it("still refuses a deal that would not read back before checking anything", async () => {
    const { repo } = setup();
    const created = await repo.createDeal({ name: "A", inputs: sampleDealInputs() });
    await repo.deleteDeal(created.id);
    const caught = await failure(repo.saveDeal({ ...created, name: "" }));
    expect(caught.kind).toBe("unreadable");
  });

  it("marks a full store as failed", async () => {
    const created = storedDeal("d1");
    const storage = new FullStorage({ [DEALS_KEY]: JSON.stringify({ d1: created }) });
    const caught = await failure(setup(storage).repo.saveDeal(created));
    expect(caught.kind).toBe("failed");
  });
});

describe("DataError kinds", () => {
  it("defaults to unreadable and accepts a kind", () => {
    expect(new DataError("x").kind).toBe("unreadable");
    expect(new DataError("x", { kind: "offline" }).kind).toBe("offline");
  });

  it("marks an unreadable stored deal as unreadable", async () => {
    const storage = new MemoryStorage();
    putDeals(storage, { bad: badPriceDeal("bad") });
    expect((await failure(setup(storage).repo.getDeal("bad"))).kind).toBe("unreadable");
  });
});

describe("the legacy sample comp ids", () => {
  const legacy = (n: number) => `comp-${n}`;

  function legacyStorage(): MemoryStorage {
    const storage = new MemoryStorage();
    const comps: Record<string, unknown> = Object.fromEntries(
      goldenComps.map((c, i) => [legacy(i + 1), { ...c, id: legacy(i + 1), source: "manual" }]),
    );
    comps["my-comp"] = { ...comp("my-comp") };
    storage.setItem(COMPS_KEY, JSON.stringify(comps));
    const inputs = sampleDealInputs();
    inputs.compSelections = { [legacy(1)]: false, [legacy(8)]: true, "my-comp": false };
    putDeals(storage, { d1: { ...storedDeal("d1"), inputs } });
    return storage;
  }

  /** A repository whose ids are 00000000-0000-4000-8000-000000000001, ...002, ... in the order they are asked for. */
  function open(storage: Storage) {
    let n = 0;
    return createLocalRepository(storage, {
      now: () => T0,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
  }

  it("lists the fixture's eight ids", () => {
    expect(LEGACY_SAMPLE_COMP_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(legacy));
  });

  it("gives the eight comps new UUIDs and the sample mark, and renames every deal's compSelections to match, once", async () => {
    const storage = legacyStorage();
    const repo = open(storage);
    const comps = await repo.listComps("utah-north");
    const sample = comps.filter(isSampleComp);
    expect(sample).toHaveLength(8);
    for (const c of sample) expect(isUuid(c.id), c.id).toBe(true);
    expect(new Set(sample.map((c) => c.id)).size).toBe(8);
    expect(comps.find((c) => c.id === "my-comp")?.source).toBe("manual");
    const idOf = (n: number) => sample.find((c) => c.address === goldenComps[n - 1]?.address)?.id as string;
    const deal = await repo.getDeal("d1");
    expect(deal?.inputs.compSelections).toEqual({ [idOf(1)]: false, [idOf(8)]: true, "my-comp": false });
    expect(storage.getItem(DEALS_KEY)).not.toMatch(/"comp-\d"/);
    expect(storage.getItem(COMPS_KEY)).not.toMatch(/"comp-\d"/);
  });

  it("is idempotent: a second open changes nothing and writes nothing", async () => {
    const storage = legacyStorage();
    open(storage);
    const after = [storage.getItem(COMPS_KEY), storage.getItem(DEALS_KEY)];
    let writes = 0;
    const counting = new (class extends MemoryStorage {
      override setItem(key: string, value: string) {
        writes++;
        super.setItem(key, value);
      }
    })();
    counting.setItem(COMPS_KEY, after[0] as string);
    counting.setItem(DEALS_KEY, after[1] as string);
    writes = 0;
    open(counting);
    expect(writes).toBe(0);
    expect(JSON.parse(after[0] as string)["my-comp"].id).toBe("my-comp");
  });

  it("leaves a store it cannot read untouched", () => {
    const storage = new MemoryStorage();
    storage.setItem(COMPS_KEY, "not json");
    storage.setItem(DEALS_KEY, "[1]");
    open(storage);
    expect(storage.getItem(COMPS_KEY)).toBe("not json");
    expect(storage.getItem(DEALS_KEY)).toBe("[1]");
  });

  it("keeps a deal that cannot be read as it is and rewrites the others", async () => {
    const storage = legacyStorage();
    const deals = JSON.parse(storage.getItem(DEALS_KEY) as string);
    deals.bad = badPriceDeal("bad");
    putDeals(storage, deals);
    const repo = open(storage);
    expect(Object.keys((await repo.getDeal("d1"))?.inputs.compSelections ?? {})).not.toContain(legacy(1));
    expect((await repo.listDeals()).problems.map((p) => p.id)).toEqual(["bad"]);
  });
});
