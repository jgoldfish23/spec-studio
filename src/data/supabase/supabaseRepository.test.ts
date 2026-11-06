import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import type { Comp } from "@engine";
import { sampleComps, sampleDealInputs } from "../sample";
import { DataError } from "../types";
import type { StoredDeal } from "../types";
import { compToRow } from "./mappers";
import { createSupabaseRepository } from "./supabaseRepository";

const CO = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const CREATED = "2026-10-30T12:00:00.123456+00:00";
const UPDATED = "2026-10-31T09:30:00.5+00:00";
const COMP_ID = "33333333-3333-4333-8333-333333333333";
const FAILED = "Couldn't save — the server said no. Try again in a minute.";
const CONFLICT = "This deal was changed on another device or tab.";
const DELETED = "This deal was deleted on another device or tab.";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const LATER = "2026-10-31T10:00:00.25+00:00";

/** One request as the repository sent it. `url` is parsed, so `searchParams` are already decoded. */
interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A repository on a real Supabase client whose `fetch` is fake: every request is recorded, and `respond` (an empty
 * list unless the test says otherwise) decides what comes back. Nothing touches the network.
 */
function setup(respond: (request: Recorded) => Response = () => json([]), companyId = CO) {
  const requests: Recorded[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const recorded: Recorded = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: text === "" ? undefined : JSON.parse(text),
    };
    requests.push(recorded);
    return respond(recorded);
  };
  const client = createClient("http://test.local", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch },
  });
  return { repo: createSupabaseRepository(client, companyId), requests };
}

const params = (request: Recorded): Record<string, string> => Object.fromEntries(request.url.searchParams);

function dealRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DEAL_ID,
    company_id: CO,
    name: "Kaysville lot",
    status: "analyzing",
    schema_version: 1,
    inputs: sampleDealInputs(),
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

function storedDeal(overrides: Partial<StoredDeal> = {}): StoredDeal {
  return {
    id: DEAL_ID,
    name: "Kaysville lot",
    status: "analyzing",
    inputs: sampleDealInputs(),
    createdAt: CREATED,
    updatedAt: UPDATED,
    ...overrides,
  };
}

const comp = (id = COMP_ID, region = "utah-north"): Comp => ({ ...(sampleComps()[0] as Comp), id, region });

/** What Postgres would send back for a comp. */
const compRow = (c: Comp): Record<string, unknown> => ({ ...compToRow(c, CO), created_at: CREATED, updated_at: UPDATED });

async function error(promise: Promise<unknown>): Promise<DataError> {
  const caught = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(caught).toBeInstanceOf(DataError);
  return caught as DataError;
}

const NOT_UUID = { code: "22P02", details: null, hint: null, message: 'invalid input syntax for type uuid: "x"' };

describe("listDeals", () => {
  it("asks for the company's deals, newest edit first", async () => {
    const { repo, requests } = setup();
    await repo.listDeals();
    expect(requests).toHaveLength(1);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(params(request)).toMatchObject({ select: "*", company_id: `eq.${CO}`, order: "updated_at.desc,id.asc" });
  });

  it("returns the deals as the app stores them", async () => {
    const { repo } = setup(() => json([dealRow()]));
    expect(await repo.listDeals()).toEqual({ deals: [storedDeal()], problems: [] });
  });

  it("keeps the server's order", async () => {
    const rows = [dealRow({ id: "b", updated_at: LATER }), dealRow({ id: "a" })];
    const { repo } = setup(() => json(rows));
    expect((await repo.listDeals()).deals.map((d) => d.id)).toEqual(["b", "a"]);
  });

  it("lists a deal it cannot read as a problem and still lists the others", async () => {
    const inputs = sampleDealInputs();
    const rows = [
      dealRow({ id: "good" }),
      dealRow({ id: "bad", inputs: { ...inputs, lot: { ...inputs.lot, priceCents: "x" } } }),
      dealRow({ id: "newer", schema_version: 2 }),
    ];
    const { repo } = setup(() => json(rows));
    const result = await repo.listDeals();
    expect(result.deals.map((d) => d.id)).toEqual(["good"]);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]?.id).toBe("bad");
    expect(result.problems[0]?.message).toMatch(/^inputs\.lot\.priceCents: /);
    expect(result.problems[1]?.id).toBe("newer");
    expect(result.problems[1]?.message).toMatch(/version 2/);
  });

  it("turns a server error into a DataError of kind failed, without the server's words", async () => {
    const { repo } = setup(() => json({ code: "42501", details: null, hint: null, message: "permission denied for table deals" }, 403));
    const caught = await error(repo.listDeals());
    expect(caught.kind).toBe("failed");
    expect(caught.message).toBe("Couldn't load your deals — the server said no. Try again in a minute.");
    expect(caught.message).not.toMatch(/permission/);
  });
});

describe("getDeal", () => {
  it("asks for one deal of the company, with maybeSingle", async () => {
    const { repo, requests } = setup(() => json([dealRow()]));
    expect(await repo.getDeal(DEAL_ID)).toEqual(storedDeal());
    const [request] = requests as [Recorded];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(params(request)).toMatchObject({ select: "*", id: `eq.${DEAL_ID}`, company_id: `eq.${CO}` });
  });

  it("returns null when there is no such deal", async () => {
    const { repo } = setup(() => json([]));
    expect(await repo.getDeal(DEAL_ID)).toBeNull();
  });

  it("throws a DataError naming the deal when its shape is unreadable", async () => {
    const inputs = sampleDealInputs();
    const bad = { ...inputs, lot: { ...inputs.lot, priceCents: "x" } };
    const { repo } = setup(() => json([dealRow({ inputs: bad })]));
    const caught = await error(repo.getDeal(DEAL_ID));
    expect(caught.recordId).toBe(DEAL_ID);
    expect(caught.path).toBe("inputs.lot.priceCents");
    expect(caught.message).toMatch(new RegExp(`^Deal ${DEAL_ID} is unreadable: inputs\\.lot\\.priceCents: `));
  });

  it("throws a DataError for a deal saved under another schema version", async () => {
    const { repo } = setup(() => json([dealRow({ schema_version: 2 })]));
    const caught = await error(repo.getDeal(DEAL_ID));
    expect(caught.recordId).toBe(DEAL_ID);
    expect(caught.path).toBe("schema_version");
  });

  it("turns a 400 into a DataError of kind failed", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    const caught = await error(repo.getDeal(DEAL_ID));
    expect(caught.kind).toBe("failed");
    expect(caught.message).toBe("Couldn't load this deal — the server said no. Try again in a minute.");
    expect(caught.recordId).toBe(DEAL_ID);
  });
});

describe("createDeal", () => {
  it("inserts the deal as analyzing and lets the database assign the id and timestamps", async () => {
    const inputs = sampleDealInputs();
    const { repo, requests } = setup(() => json(dealRow(), 201));
    const created = await repo.createDeal({ name: "Kaysville lot", inputs });
    expect(created).toEqual(storedDeal());

    expect(requests).toHaveLength(1);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("POST");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(request.headers.get("Prefer")).toContain("return=representation");
    expect(request.headers.get("Accept")).toBe("application/vnd.pgrst.object+json");
    expect(request.body).toEqual({
      company_id: CO,
      name: "Kaysville lot",
      status: "analyzing",
      schema_version: 1,
      inputs,
    });
    expect(Object.keys(request.body as object)).not.toContain("id");
    expect(Object.keys(request.body as object)).not.toContain("created_at");
    expect(Object.keys(request.body as object)).not.toContain("updated_at");
  });

  it("returns the id and timestamps the server chose, not the ones it was asked about", async () => {
    const { repo } = setup(() => json(dealRow({ id: "server-id", created_at: LATER, updated_at: LATER }), 201));
    const created = await repo.createDeal({ name: "Kaysville lot", inputs: sampleDealInputs() });
    expect(created).toMatchObject({ id: "server-id", createdAt: LATER, updatedAt: LATER });
  });

  it("refuses a blank name without making a request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.createDeal({ name: "", inputs: sampleDealInputs() }));
    expect(caught.recordId).toBeUndefined();
    expect(caught.path).toBe("name");
    expect(caught.message).toMatch(/^Couldn't save — name: /);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s in the inputs, which JSON would turn into null, without making a request", async (_name, bad) => {
    const inputs = sampleDealInputs();
    const { repo, requests } = setup();
    const caught = await error(repo.createDeal({ name: "A", inputs: { ...inputs, lot: { ...inputs.lot, priceCents: bad } } }));
    expect(caught.path).toBe("inputs.lot.priceCents");
    expect(requests).toHaveLength(0);
  });

  it("still creates a deal with a problem the owner can fix, such as an empty city", async () => {
    const inputs = sampleDealInputs();
    inputs.lot.city = "";
    const { repo, requests } = setup(() => json(dealRow({ inputs }), 201));
    await repo.createDeal({ name: "New deal", inputs });
    expect(requests).toHaveLength(1);
  });

  it("turns a server error into a DataError of kind failed, without the server's words", async () => {
    const { repo } = setup(() => json({ code: "42501", details: null, hint: null, message: "new row violates row-level security policy" }, 403));
    const caught = await error(repo.createDeal({ name: "A", inputs: sampleDealInputs() }));
    expect(caught.kind).toBe("failed");
    expect(caught.message).toBe(FAILED);
  });
});

describe("saveDeal", () => {
  it("updates the deal by id and the updated_at it was made from, never upserting", async () => {
    const deal = storedDeal();
    const { repo, requests } = setup(() => json([dealRow({ updated_at: LATER })]));
    await repo.saveDeal(deal);

    expect(requests).toHaveLength(1);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("PATCH");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(request.headers.get("Prefer")).toContain("return=representation");
    expect(request.headers.get("Prefer") ?? "").not.toContain("merge-duplicates");
    expect(params(request)).toMatchObject({ id: `eq.${DEAL_ID}`, updated_at: `eq.${UPDATED}`, company_id: `eq.${CO}` });
    expect(params(request).on_conflict).toBeUndefined();
  });

  it("sends only the columns the owner can change", async () => {
    const deal = storedDeal();
    const { repo, requests } = setup(() => json([dealRow({ updated_at: LATER })]));
    await repo.saveDeal(deal);
    expect((requests[0] as Recorded).body).toEqual({
      name: "Kaysville lot",
      status: "analyzing",
      schema_version: 1,
      inputs: deal.inputs,
    });
  });

  it("filters on the stored timestamp verbatim, microseconds and offset included", async () => {
    const stamp = "2026-11-01T02:17:17.123456+00:00";
    const { repo, requests } = setup(() => json([dealRow({ updated_at: LATER })]));
    await repo.saveDeal(storedDeal({ updatedAt: stamp }));
    const raw = (requests[0] as Recorded).url.search;
    expect(params(requests[0] as Recorded).updated_at).toBe(`eq.${stamp}`);
    // The + of the offset is escaped, so the server reads it as a plus and not as a space.
    expect(raw).toContain("%2B00%3A00");
  });

  it("returns the row the server sent back, with its fresh updated_at", async () => {
    const { repo } = setup(() => json([dealRow({ name: "Renamed by the server", updated_at: LATER })]));
    const saved = await repo.saveDeal(storedDeal({ name: "Kaysville lot" }));
    expect(saved).toEqual(storedDeal({ name: "Renamed by the server", updatedAt: LATER }));
  });

  it("with overwrite, drops the updated_at filter", async () => {
    const { repo, requests } = setup(() => json([dealRow({ updated_at: LATER })]));
    await repo.saveDeal(storedDeal(), { overwrite: true });
    expect(requests).toHaveLength(1);
    const query = params(requests[0] as Recorded);
    expect(query).toMatchObject({ id: `eq.${DEAL_ID}` });
    expect(query).not.toHaveProperty("updated_at");
  });

  it("asks once whether the deal still exists when nothing matched, and reports a conflict if it does", async () => {
    const { repo, requests } = setup((request) =>
      request.method === "PATCH" ? json([]) : json([{ id: DEAL_ID, updated_at: LATER }]),
    );
    const caught = await error(repo.saveDeal(storedDeal()));
    expect(caught.kind).toBe("conflict");
    expect(caught.message).toBe(CONFLICT);
    expect(caught.recordId).toBe(DEAL_ID);
    expect(requests.map((r) => r.method)).toEqual(["PATCH", "GET"]);
    const check = requests[1] as Recorded;
    expect(check.url.pathname).toBe("/rest/v1/deals");
    expect(params(check)).toMatchObject({ select: "id,updated_at", id: `eq.${DEAL_ID}` });
  });

  it("reports a deleted deal when nothing matched and nothing is there", async () => {
    const { repo, requests } = setup(() => json([]));
    const caught = await error(repo.saveDeal(storedDeal()));
    expect(caught.kind).toBe("deleted");
    expect(caught.message).toBe(DELETED);
    expect(requests.map((r) => r.method)).toEqual(["PATCH", "GET"]);
  });

  it("reports a deleted deal with overwrite too, without a second request", async () => {
    const { repo, requests } = setup(() => json([]));
    const caught = await error(repo.saveDeal(storedDeal(), { overwrite: true }));
    expect(caught.kind).toBe("deleted");
    expect(caught.message).toBe(DELETED);
    expect(requests).toHaveLength(1);
  });

  it("treats an id that is not a UUID as a deal that is not there, without a request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.saveDeal(storedDeal({ id: "deal-1" })));
    expect(caught.kind).toBe("deleted");
    expect(requests).toHaveLength(0);
  });

  it("refuses a blank name without making a request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.saveDeal(storedDeal({ name: "" })));
    expect(caught.recordId).toBe(DEAL_ID);
    expect(caught.kind).toBe("unreadable");
    expect(caught.path).toBe("name");
    expect(caught.message).toMatch(/^Couldn't save — name: /);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("refuses %s in the inputs, which JSON would turn into null, without making a request", async (_name, bad) => {
    const inputs = sampleDealInputs();
    const { repo, requests } = setup();
    const edited = storedDeal({ inputs: { ...inputs, lot: { ...inputs.lot, priceCents: bad } } });
    const caught = await error(repo.saveDeal(edited));
    expect(caught.recordId).toBe(DEAL_ID);
    expect(caught.path).toBe("inputs.lot.priceCents");
    expect(caught.message).toMatch(/^Couldn't save — inputs\.lot\.priceCents: /);
    expect(requests).toHaveLength(0);
  });

  it("refuses a timestamp that is not a date without making a request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.saveDeal(storedDeal({ updatedAt: "yesterday" })));
    expect(caught.path).toBe("updatedAt");
    expect(requests).toHaveLength(0);
  });

  it("saves a deal with a problem the owner can fix, such as 2.5 build months", async () => {
    const inputs = sampleDealInputs();
    inputs.timeline.buildMonths = 2.5;
    const { repo, requests } = setup(() => json([dealRow({ inputs })]));
    await repo.saveDeal(storedDeal({ inputs }));
    expect(requests).toHaveLength(1);
  });

  it("turns a 400 into a DataError of kind failed, and logs the raw error once", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    const caught = await error(repo.saveDeal(storedDeal()));
    expect(caught.kind).toBe("failed");
    expect(caught.message).toBe(FAILED);
    expect(caught.recordId).toBe(DEAL_ID);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an HTTP 401", () => json({ message: "Unauthorized" }, 401)],
    ["PGRST301", () => json({ code: "PGRST301", message: "JWT expired", details: null, hint: null }, 400)],
    ["PGRST303", () => json({ code: "PGRST303", message: "JWT bad", details: null, hint: null }, 400)],
  ])("maps %s to signedOut", async (_name, respond) => {
    const { repo } = setup(respond);
    const caught = await error(repo.saveDeal(storedDeal()));
    expect(caught.kind).toBe("signedOut");
    expect(caught.message).toBe("You've been signed out.");
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("paging", () => {
  const manyDeals = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => dealRow({ id: `d-${offset + i}` }));

  it("listDeals reads pages of 1000 until a short one", async () => {
    const { repo, requests } = setup((request) => json(params(request).offset === "0" ? manyDeals(1000) : manyDeals(1, 1000)));
    const result = await repo.listDeals();
    expect(result.deals).toHaveLength(1001);
    expect(requests.map((r) => [params(r).offset, params(r).limit])).toEqual([
      ["0", "1000"],
      ["1000", "1000"],
    ]);
    expect(params(requests[0] as Recorded).order).toBe("updated_at.desc,id.asc");
  });

  it("listDeals stops after one short page", async () => {
    const { repo, requests } = setup(() => json(manyDeals(3)));
    await repo.listDeals();
    expect(requests).toHaveLength(1);
  });

  it("listComps reads pages in a stable order", async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => compRow(comp(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)));
    const { repo, requests } = setup((request) => json(params(request).offset === "0" ? rows(1000) : rows(1)));
    expect(await repo.listComps("utah-north")).toHaveLength(1001);
    expect(requests.map((r) => params(r).offset)).toEqual(["0", "1000"]);
    expect(params(requests[1] as Recorded).order).toBe("created_at.asc,id.asc");
  });

  it("getCostBook pages both queries", async () => {
    const price = (i: number) => ({
      id: `p${i}`, company_id: null, region: "utah-north", code: "framing", variant: `v${i}`, tier: null, unit: "sf",
      unit_price_cents: 100, as_of: "2026-10-30", verified: false, source_note: "n",
    });
    const entry = (i: number) => ({
      id: `e${i}`, company_id: CO, code: "framing", variant: `v${i}`, tier: null, unit: "sf",
      unit_price_cents: "100", as_of: "2026-09-01", vendor: null, notes: null,
    });
    const { repo, requests } = setup((request) => {
      const first = params(request).offset === "0";
      const isPrices = request.url.pathname.endsWith("/default_prices");
      const make = isPrices ? price : entry;
      return json(Array.from({ length: first ? 1000 : 1 }, (_, i) => make(first ? i : 1000)));
    });
    const book = await repo.getCostBook("utah-north");
    expect(book.defaults).toHaveLength(1001);
    expect(book.priceBook).toHaveLength(1001);
    for (const path of ["/rest/v1/default_prices", "/rest/v1/price_book_entries"]) {
      const mine = requests.filter((r) => r.url.pathname === path);
      expect(mine.map((r) => params(r).offset)).toEqual(["0", "1000"]);
      expect(mine.map((r) => params(r).limit)).toEqual(["1000", "1000"]);
    }
  });

  it("stops at a failing page with its error", async () => {
    const { repo } = setup((request) => (params(request).offset === "0" ? json(manyDeals(1000)) : json(NOT_UUID, 400)));
    expect((await error(repo.listDeals())).kind).toBe("failed");
  });
});

describe("ids that are not UUIDs", () => {
  it("getDeal returns null with no request", async () => {
    const { repo, requests } = setup();
    expect(await repo.getDeal("abc")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("deleteDeal and deleteComp do nothing with no request", async () => {
    const { repo, requests } = setup();
    await repo.deleteDeal("abc");
    await repo.deleteComp("comp-1");
    expect(requests).toHaveLength(0);
  });

  it("saveComp refuses one with no request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.saveComp(comp("comp-1")));
    expect(caught.path).toBe("id");
    expect(requests).toHaveLength(0);
  });
});

describe("deleteDeal and resetDeals", () => {
  it("deletes one deal of the company", async () => {
    const { repo, requests } = setup(() => new Response(null, { status: 204 }));
    await repo.deleteDeal(DEAL_ID);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("DELETE");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(params(request)).toEqual({ id: `eq.${DEAL_ID}`, company_id: `eq.${CO}` });
  });

  it("deletes every deal of the company, and only that company's", async () => {
    const { repo, requests } = setup(() => new Response(null, { status: 204 }));
    await repo.resetDeals();
    const [request] = requests as [Recorded];
    expect(request.method).toBe("DELETE");
    expect(request.url.pathname).toBe("/rest/v1/deals");
    expect(params(request)).toEqual({ company_id: `eq.${CO}` });
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.deleteDeal(DEAL_ID))).kind).toBe("failed");
    expect((await error(repo.resetDeals())).kind).toBe("failed");
  });
});

describe("a lost connection", () => {
  it("is a DataError, not a raw rejection", async () => {
    // A write, because the client retries a read that fails to connect, with a delay, before giving up.
    const client = createClient("http://test.local", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    const caught = await error(createSupabaseRepository(client, CO).deleteDeal(DEAL_ID));
    expect(caught.kind).toBe("offline");
    expect(caught.message).toBe("Can't reach the server — check your connection.");
    expect(caught.recordId).toBe(DEAL_ID);
  });
});

describe("listComps", () => {
  it("asks for the company's comps in one region", async () => {
    const { repo, requests } = setup();
    await repo.listComps("utah-north");
    const [request] = requests as [Recorded];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/comps");
    expect(params(request)).toMatchObject({ select: "*", company_id: `eq.${CO}`, region: "eq.utah-north" });
  });

  it("asks for a stable order, so editing a comp does not move it", async () => {
    const { repo, requests } = setup();
    await repo.listComps("utah-north");
    expect(params(requests[0] as Recorded).order).toBe("created_at.asc,id.asc");
  });

  it("returns the comps as the engine reads them", async () => {
    const a = comp("a");
    const b = comp("b");
    const { repo } = setup(() => json([compRow(a), compRow(b)]));
    expect(await repo.listComps("utah-north")).toEqual([a, b]);
  });

  it("leaves out a comp it cannot read, like the demo store", async () => {
    const good = comp("good");
    const bad = { ...compRow(comp("bad")), data: { address: "1 Main St" } };
    const { repo } = setup(() => json([compRow(good), bad]));
    expect(await repo.listComps("utah-north")).toEqual([good]);
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.listComps("utah-north"))).kind).toBe("failed");
  });
});

describe("saveComp", () => {
  it("upserts the comp on its id, with the id, company and region as columns and the rest in data", async () => {
    const original = comp(COMP_ID);
    const { repo, requests } = setup(() => json(compRow(original)));
    await repo.saveComp(original);

    expect(requests).toHaveLength(1);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("POST");
    expect(request.url.pathname).toBe("/rest/v1/comps");
    expect(request.headers.get("Prefer")).toContain("resolution=merge-duplicates");
    expect(params(request).on_conflict).toBe("id");
    const body = request.body as { id: string; company_id: string; region: string; data: Record<string, unknown> };
    expect(Object.keys(body).sort()).toEqual(["company_id", "data", "id", "region"]);
    expect(body).toMatchObject({ id: COMP_ID, company_id: CO, region: "utah-north" });
    expect(body.data.address).toBe(original.address);
    expect(body.data).not.toHaveProperty("id");
  });

  it("returns the comp the server sent back", async () => {
    const original = comp(COMP_ID);
    const { repo } = setup(() => json(compRow(original)));
    expect(await repo.saveComp(original)).toEqual(original);
  });

  it("refuses a comp whose price is NaN without making a request", async () => {
    const { repo, requests } = setup();
    const caught = await error(repo.saveComp({ ...comp(COMP_ID), soldPriceCents: Number.NaN }));
    expect(caught.recordId).toBe(COMP_ID);
    expect(caught.path).toBe("soldPriceCents");
    expect(caught.message).toMatch(/^Couldn't save — soldPriceCents: /);
    expect(requests).toHaveLength(0);
  });

  it("turns a 400 into a DataError of kind failed", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    const caught = await error(repo.saveComp(comp(COMP_ID)));
    expect(caught.kind).toBe("failed");
    expect(caught.message).toBe(FAILED);
    expect(caught.recordId).toBe(COMP_ID);
  });
});

describe("deleteComp", () => {
  it("deletes one comp of the company", async () => {
    const { repo, requests } = setup(() => new Response(null, { status: 204 }));
    await repo.deleteComp(COMP_ID);
    const [request] = requests as [Recorded];
    expect(request.method).toBe("DELETE");
    expect(request.url.pathname).toBe("/rest/v1/comps");
    expect(params(request)).toEqual({ id: `eq.${COMP_ID}`, company_id: `eq.${CO}` });
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.deleteComp(COMP_ID))).kind).toBe("failed");
  });
});

describe("getCostBook", () => {
  const price = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "p1",
    company_id: null,
    region: "utah-north",
    code: "framing",
    variant: "base",
    tier: null,
    unit: "sf",
    unit_price_cents: 2_350,
    as_of: "2026-10-30",
    verified: false,
    source_note: "Starter estimate",
    ...overrides,
  });
  const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "e1",
    company_id: CO,
    code: "framing",
    variant: "base",
    tier: null,
    unit: "sf",
    unit_price_cents: "2400",
    as_of: "2026-09-01",
    vendor: null,
    notes: null,
    ...overrides,
  });

  function setupBook(prices: unknown[], entries: unknown[]) {
    return setup((request) => json(request.url.pathname.endsWith("/default_prices") ? prices : entries));
  }

  it("reads the region's default prices, global and the company's own, and the company's price book", async () => {
    const { repo, requests } = setupBook([], []);
    await repo.getCostBook("utah-north");
    expect(requests).toHaveLength(2);
    const defaults = requests.find((r) => r.url.pathname === "/rest/v1/default_prices") as Recorded;
    const book = requests.find((r) => r.url.pathname === "/rest/v1/price_book_entries") as Recorded;
    expect(defaults.method).toBe("GET");
    expect(params(defaults).region).toBe("eq.utah-north");
    expect(params(defaults).or).toBe(`(company_id.is.null,company_id.eq."${CO}")`);
    expect(book.method).toBe("GET");
    expect(params(book)).toMatchObject({ select: "*", company_id: `eq.${CO}` });
  });

  it("asks for both lists in a fixed order, so the same data always comes back the same way", async () => {
    const { repo, requests } = setupBook([], []);
    await repo.getCostBook("utah-north");
    const defaults = requests.find((r) => r.url.pathname === "/rest/v1/default_prices") as Recorded;
    const book = requests.find((r) => r.url.pathname === "/rest/v1/price_book_entries") as Recorded;
    expect(params(defaults).order).toBe("code.asc,variant.asc,tier.asc,company_id.asc");
    expect(params(book).order).toBe("code.asc,variant.asc,tier.asc,id.asc");
  });

  it("quotes the company id in the filter, so a quote, backslash, comma or parenthesis in it cannot change the filter", async () => {
    const awkward = String.raw`a"b\c,d)`;
    const { repo, requests } = setup(() => json([]), awkward);
    await repo.getCostBook("utah-north");
    const defaults = requests.find((r) => r.url.pathname === "/rest/v1/default_prices") as Recorded;
    const book = requests.find((r) => r.url.pathname === "/rest/v1/price_book_entries") as Recorded;
    // Inside the quotes, `"` becomes `\"` and `\` becomes `\\`.
    expect(params(defaults).or).toBe(String.raw`(company_id.is.null,company_id.eq."a\"b\\c,d)")`);
    // A plain filter carries the value as it is; the URL encoding keeps it in one piece.
    expect(params(book).company_id).toBe(`eq.${awkward}`);
  });

  it("maps the rows to the engine's cost book", async () => {
    const { repo } = setupBook([price()], [entry()]);
    expect(await repo.getCostBook("utah-north")).toEqual({
      defaults: [
        {
          code: "framing",
          variant: "base",
          tier: null,
          region: "utah-north",
          unitPriceCents: 2_350,
          unit: "sf",
          asOf: "2026-10-30",
          verified: false,
          sourceNote: "Starter estimate",
        },
      ],
      priceBook: [{ code: "framing", variant: "base", tier: null, unitPriceCents: 2_400, unit: "sf", asOf: "2026-09-01" }],
    });
  });

  it("keeps the company's own default price when a global one has the same code, variant and tier", async () => {
    const global = price({ id: "g", unit_price_cents: 2_350 });
    const own = price({ id: "o", company_id: CO, unit_price_cents: 2_600, verified: true });
    const other = price({ id: "g2", code: "roofing", variant: "base", unit: "sq", unit_price_cents: 60_000 });
    // The company row can arrive before or after the global one; it wins either way.
    for (const rows of [[global, own, other], [own, global, other]]) {
      const { repo } = setupBook(rows, []);
      const { defaults } = await repo.getCostBook("utah-north");
      expect(defaults).toHaveLength(2);
      const framing = defaults.find((p) => p.code === "framing");
      expect(framing).toMatchObject({ unitPriceCents: 2_600, verified: true });
      expect(defaults.find((p) => p.code === "roofing")?.unitPriceCents).toBe(60_000);
    }
  });

  it("treats a different tier or variant as a different price", async () => {
    const rows = [
      price({ id: "a", tier: "standard" }),
      price({ id: "b", tier: "upgraded" }),
      price({ id: "c", tier: null }),
      price({ id: "d", variant: "heavy" }),
      price({ id: "e", company_id: CO, tier: "standard", unit_price_cents: 9_999 }),
    ];
    const { repo } = setupBook(rows, []);
    const { defaults } = await repo.getCostBook("utah-north");
    expect(defaults).toHaveLength(4);
    expect(defaults.find((p) => p.tier === "standard")?.unitPriceCents).toBe(9_999);
  });

  it("returns every price book entry of the company", async () => {
    const { repo } = setupBook([], [entry({ id: "e1" }), entry({ id: "e2", variant: "heavy", vendor: "Wasatch Lumber" })]);
    const { priceBook } = await repo.getCostBook("utah-north");
    expect(priceBook).toHaveLength(2);
    expect(priceBook[1]).toHaveProperty("vendor", "Wasatch Lumber");
    expect(priceBook[0]).not.toHaveProperty("vendor");
  });

  it("throws a DataError rather than guess a price when a row is unreadable", async () => {
    const { repo } = setupBook([price({ unit_price_cents: "12.5" })], []);
    const caught = await error(repo.getCostBook("utah-north"));
    expect(caught.recordId).toBe("p1");
    expect(caught.path).toBe("unitPriceCents");
  });

  it("throws a DataError rather than skip a price book entry it cannot read", async () => {
    const { repo } = setupBook([price()], [entry({ id: "e1" }), entry({ id: "bad", unit_price_cents: "24.5" })]);
    const caught = await error(repo.getCostBook("utah-north"));
    expect(caught.recordId).toBe("bad");
    expect(caught.path).toBe("unitPriceCents");
    expect(caught.message).toMatch(/^Price book entry bad is unreadable: /);
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.getCostBook("utah-north"))).kind).toBe("failed");
  });
});

describe("getMarketSettings", () => {
  const settings = Object.fromEntries(Object.entries(DEFAULT_MARKET_SETTINGS).filter(([key]) => key !== "region"));

  it("asks for the company's settings for the region", async () => {
    const { repo, requests } = setup();
    await repo.getMarketSettings("utah-north");
    const [request] = requests as [Recorded];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/market_settings");
    expect(params(request)).toMatchObject({ select: "*", company_id: `eq.${CO}`, region: "eq.utah-north" });
  });

  it("returns the stored settings", async () => {
    const stored = { ...settings, elasticity: 4.5, marketCondition: "slow" };
    const { repo } = setup(() => json([{ company_id: CO, region: "utah-north", settings: stored }]));
    expect(await repo.getMarketSettings("utah-north")).toEqual({ ...stored, region: "utah-north" });
  });

  it("falls back to the defaults, with the region replaced, when there is no row", async () => {
    const { repo } = setup(() => json([]));
    expect(await repo.getMarketSettings("utah-south")).toEqual({ ...DEFAULT_MARKET_SETTINGS, region: "utah-south" });
  });

  it("falls back to the defaults on an empty response body", async () => {
    const { repo } = setup(() => new Response("", { status: 200 }));
    expect(await repo.getMarketSettings("utah-north")).toEqual(DEFAULT_MARKET_SETTINGS);
  });

  it("returns a copy of the defaults that a caller can change", async () => {
    const { repo } = setup(() => json([]));
    const first = await repo.getMarketSettings("utah-north");
    first.seasonalFactors[0] = 99;
    first.featureValues.poolCents = 1;
    const second = await repo.getMarketSettings("utah-north");
    expect(second).toEqual(DEFAULT_MARKET_SETTINGS);
    expect(DEFAULT_MARKET_SETTINGS.seasonalFactors[0]).toBe(1.2);
  });

  it("throws a DataError rather than ignore a stored row that is unreadable", async () => {
    const { repo } = setup(() => json([{ company_id: CO, region: "utah-north", settings: { ...settings, includeThreshold: 500 } }]));
    const caught = await error(repo.getMarketSettings("utah-north"));
    expect(caught.recordId).toBe("utah-north");
    expect(caught.path).toBe("includeThreshold");
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.getMarketSettings("utah-north"))).kind).toBe("failed");
  });
});

describe("getCompanySettings", () => {
  it("asks for the company's row", async () => {
    const { repo, requests } = setup();
    await repo.getCompanySettings();
    const [request] = requests as [Recorded];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/company_settings");
    expect(params(request)).toMatchObject({ select: "*", company_id: `eq.${CO}` });
  });

  it("returns the stored rules and contingency", async () => {
    const rules = { minMarginOnSale: 0.2, minAnnualizedReturn: 0.3, minDownsideProfitCents: 1_000_000 };
    const { repo } = setup(() => json([{ company_id: CO, rules, contingency_pct: 0.08 }]));
    expect(await repo.getCompanySettings()).toEqual({ rules, contingencyPct: 0.08 });
  });

  it("falls back to the default rules and a 5% contingency when there is no row", async () => {
    const { repo } = setup(() => json([]));
    expect(await repo.getCompanySettings()).toEqual({ rules: DEFAULT_RULES, contingencyPct: 0.05 });
  });

  it("returns a copy of the default rules that a caller can change", async () => {
    const { repo } = setup(() => json([]));
    (await repo.getCompanySettings()).rules.minMarginOnSale = 0.99;
    expect(DEFAULT_RULES.minMarginOnSale).toBe(0.15);
    expect((await repo.getCompanySettings()).rules.minMarginOnSale).toBe(0.15);
  });

  it("throws a DataError rather than ignore stored rules that are unreadable", async () => {
    const { repo } = setup(() => json([{ company_id: CO, rules: { minMarginOnSale: "high" }, contingency_pct: 0.05 }]));
    const caught = await error(repo.getCompanySettings());
    expect(caught.recordId).toBe(CO);
    expect(caught.path).toBe("rules.minMarginOnSale");
  });

  it("turns a server error into a DataError", async () => {
    const { repo } = setup(() => json(NOT_UUID, 400));
    expect((await error(repo.getCompanySettings())).kind).toBe("failed");
  });
});
