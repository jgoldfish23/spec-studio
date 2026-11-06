import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "@engine";
import { DataError } from "../types";
import { createSupabaseCompany } from "./supabaseCompany";

const CO = "11111111-1111-4111-8111-111111111111";
const settings = { rules: DEFAULT_RULES, contingencyPct: 0.05 };
const row = {
  company_id: CO,
  companies: { id: CO, name: "Hill Homes", default_region: "utah-north" },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(respond: (request: Recorded) => Response = () => json([])) {
  const requests: Recorded[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const recorded = {
      method: request.method,
      url: new URL(request.url),
      body: text === "" ? undefined : JSON.parse(text),
    };
    requests.push(recorded);
    return respond(recorded);
  };
  const client = createClient("http://test.local", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch },
  });
  return { gateway: createSupabaseCompany(client), requests };
}

const pgError = (code: string, status = 400) =>
  json(
    { code, message: "raw postgres text", details: null, hint: null },
    status,
  );

describe("supabase company gateway", () => {
  it("myCompany reads memberships with the company embedded", async () => {
    const { gateway, requests } = setup(() => json([row]));
    expect(await gateway.myCompany()).toEqual({
      id: CO,
      name: "Hill Homes",
      defaultRegion: "utah-north",
    });
    expect(at(requests, 0).method).toBe("GET");
    expect(at(requests, 0).url.pathname).toBe("/rest/v1/memberships");
    expect(at(requests, 0).url.searchParams.get("select")).toBe(
      "company_id,companies(id,name,default_region)",
    );
    expect(at(requests, 0).url.searchParams.get("limit")).toBe("1");
  });

  it("myCompany is null with no rows", async () => {
    const { gateway } = setup(() => json([]));
    expect(await gateway.myCompany()).toBeNull();
  });

  it("myCompany takes the first of several and logs once", async () => {
    const { gateway } = setup(() =>
      json([row, { ...row, companies: { ...row.companies, name: "Other" } }]),
    );
    expect((await gateway.myCompany())?.name).toBe("Hill Homes");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("createCompany maps a network failure to offline (a write: the client retries a failed read with a delay)", async () => {
    const { gateway } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      gateway.createCompany("Hill Homes", settings),
    ).rejects.toMatchObject({ kind: "offline" });
  });

  it("createCompany calls rpc/create_company, then reads the company back", async () => {
    const { gateway, requests } = setup((request) =>
      request.url.pathname.endsWith("/rpc/create_company")
        ? json(CO)
        : json([row]),
    );
    expect(await gateway.createCompany("Hill Homes", settings)).toEqual({
      id: CO,
      name: "Hill Homes",
      defaultRegion: "utah-north",
    });
    expect(at(requests, 0).method).toBe("POST");
    expect(at(requests, 0).url.pathname).toBe("/rest/v1/rpc/create_company");
    expect(at(requests, 0).body).toEqual({
      p_name: "Hill Homes",
      p_rules: DEFAULT_RULES,
      p_contingency_pct: 0.05,
    });
  });

  it.each([
    ["SS002", "failed", "You already have a company."],
    ["SS003", "failed", "Enter a company name of 120 characters or fewer."],
    ["SS001", "signedOut", "You've been signed out."],
  ])("createCompany maps %s", async (code, kind, message) => {
    const { gateway } = setup(() => pgError(code));
    const error = await gateway
      .createCompany("Hill Homes", settings)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({ kind, message });
  });

  it("createCompany hides an unknown server error", async () => {
    const { gateway } = setup(() => pgError("XX000", 500));
    const error = await gateway
      .createCompany("Hill Homes", settings)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "failed" });
    expect((error as DataError).message).not.toContain("raw postgres");
  });
});

function at(requests: Recorded[], index: number): Recorded {
  const request = requests[index];
  if (!request) throw new Error(`no request #${index}`);
  return request;
}

describe("a lost connection on a read", () => {
  it("myCompany is offline at once, without retrying", async () => {
    let calls = 0;
    const { gateway } = setup(() => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    });
    await expect(gateway.myCompany()).rejects.toMatchObject({
      kind: "offline",
    });
    expect(calls).toBe(1);
  });
});
