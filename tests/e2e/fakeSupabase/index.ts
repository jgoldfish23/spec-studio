// A fake Supabase for the hosted-mode browser specs. It answers what supabase-js sends to the hosted build's project
// address (`http://fake-supabase.test`) through Playwright's request interception, from in-memory tables, so the app
// runs unchanged against it. Only what the app calls is modelled; anything else is answered 404 and reported by
// `problems()`, which every spec expects to be empty.
//
//   auth.ts  GoTrue: emailed code, sessions, refresh, logout
//   rest.ts  PostgREST: tables, filters, order, ranges, upserts, row-level security
//   rpc.ts   create_company
//   db.ts    the tables, their keys and policies, timestamps, the starter cost book
import type { BrowserContext, Page } from "@playwright/test";
import { FakeAuth, SIGN_IN_CODE } from "./auth";
import { Db, PgError } from "./db";
import type { Row, TableName } from "./db";
import { isPlainObject } from "./http";
import type { Reply } from "./http";
import { handleRest } from "./rest";
import { handleRpc } from "./rpc";

export { SIGN_IN_CODE };
export type { Row, TableName };

/** What `npm run build:hosted-test` builds the app against. */
export const FAKE_SUPABASE_URL = "http://fake-supabase.test";
export const FAKE_ANON_KEY = "test-anon-key";

export interface FakeSupabase {
  /** While on, every request to the fake fails at once as a dropped connection does (`route.abort`). */
  setOffline(offline: boolean): void;
  /** Another device saves the deal: `patch` is applied and `updated_at` moves on, as the database's trigger moves it. */
  editDealElsewhere(id: string, patch: { name?: string; status?: string; inputs?: unknown }): Row;
  /** Another device deletes the deal. */
  deleteDealElsewhere(id: string): void;
  /** An account for `email`, as if its sign-in email had been asked for from another browser. */
  addUser(email: string): void;
  /** A copy of every row of `table`, past row-level security. */
  rows(table: TableName): Row[];
  /** A copy of one deal's row. */
  deal(id: string): Row | undefined;
  /** Every sign-in email the app asked for, in order. */
  emailsSent(): { email: string; redirectTo: string | null }[];
  /** `METHOD /path?query` of every request the fake received, in order. */
  requests(): string[];
  /** Requests the fake does not model, and errors in the fake itself. A spec expects none. */
  problems(): string[];
}

const JSON_TYPE = "application/json; charset=utf-8";

/** The headers that let the app's page, on another origin, read an answer (and its `Content-Range`). */
function corsHeaders(origin: string | undefined): Record<string, string> {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-expose-headers": "content-range, x-supabase-api-version",
    vary: "Origin",
  };
}

function parseBody(text: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === null || text === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Installs the fake on `target` (a page, or every page of a context). Each call starts with empty tables. */
export async function installFakeSupabase(target: Page | BrowserContext): Promise<FakeSupabase> {
  const db = new Db();
  const auth = new FakeAuth();
  const log: string[] = [];
  const problems: string[] = [];
  let offline = false;

  function answer(method: string, url: URL, headers: Record<string, string>, text: string | null): Reply {
    // The Supabase gateway in front of both services checks the project key first.
    if (headers["apikey"] !== FAKE_ANON_KEY) {
      return { status: 401, body: { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." } };
    }
    const body = parseBody(text);
    if (url.pathname.startsWith("/auth/v1/")) {
      if (!body.ok || (body.value !== undefined && !isPlainObject(body.value))) {
        return { status: 400, body: { code: "bad_json", error_code: "bad_json", msg: "Could not parse request body as JSON" } };
      }
      const reply = auth.handle(method, url, headers["authorization"], (body.value ?? {}) as Record<string, unknown>);
      if (reply) return { ...reply, headers: { "x-supabase-api-version": "2024-01-01", ...reply.headers } };
    } else if (url.pathname.startsWith("/rest/v1/")) {
      // Every data request must carry a live session's token: real RLS gives a request without one nothing of the
      // owner's, and PostgREST refuses a token it can't verify. (The app never sends the anon key as the bearer here.)
      const user = auth.userFor(headers["authorization"]);
      if (!user) return { status: 401, body: new PgError(401, "PGRST301", "JWSError JWSInvalidSignature").body };
      if (!body.ok) return { status: 400, body: new PgError(400, "PGRST102", "Empty or invalid json").body };
      try {
        const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname);
        const viewer = db.viewer(user.id);
        const reply = rpc
          ? method === "POST"
            ? handleRpc(db, viewer, decodeURIComponent(rpc[1] ?? ""), body.value)
            : null
          : handleRest(db, viewer, method, url, headers, body.value);
        if (reply) return reply;
      } catch (error) {
        if (error instanceof PgError) return { status: error.status, body: error.body };
        throw error;
      }
    }
    problems.push(`not modelled: ${method} ${url.pathname}${url.search}`);
    return { status: 404, body: { message: `The fake Supabase does not model ${method} ${url.pathname}.` } };
  }

  await target.route(`${FAKE_SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    try {
      const headers = await request.allHeaders();
      if (method === "OPTIONS") {
        // A CORS preflight: the app's page is on another origin.
        await route.fulfill({
          status: 204,
          headers: {
            ...corsHeaders(headers["origin"]),
            "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "access-control-allow-headers": headers["access-control-request-headers"] ?? "",
            "access-control-max-age": "600",
          },
        });
        return;
      }
      log.push(`${method} ${url.pathname}${url.search}`);
      if (offline) {
        await route.abort("internetdisconnected");
        return;
      }
      let reply: Reply;
      try {
        reply = answer(method, url, headers, request.postData());
      } catch (error) {
        problems.push(`the fake failed on ${method} ${url.pathname}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        reply = { status: 500, body: { message: "The fake Supabase failed; see problems()." } };
      }
      await route.fulfill({
        status: reply.status,
        headers: {
          ...corsHeaders(headers["origin"]),
          ...(reply.body === undefined ? {} : { "content-type": JSON_TYPE }),
          ...reply.headers,
        },
        body: reply.body === undefined ? "" : JSON.stringify(reply.body),
      });
    } catch (error) {
      // The page or context closed while this request was out (a spec ending, a reload): nothing is waiting for it.
      if (!/closed|disposed|already handled/i.test(String(error))) problems.push(`route failed: ${String(error)}`);
    }
  });

  const findDeal = (id: string) => {
    const deal = db.rows.deals.find((row) => row.id === id);
    if (!deal) throw new Error(`The fake has no deal ${id}.`);
    return deal;
  };

  return {
    setOffline(value) {
      offline = value;
    },
    editDealElsewhere(id, patch) {
      return structuredClone(
        db.transaction(() => {
          const deal = findDeal(id);
          const updated = { ...deal, ...structuredClone(patch), updated_at: db.now() };
          db.rows.deals[db.rows.deals.indexOf(deal)] = updated;
          return updated;
        }),
      );
    },
    deleteDealElsewhere(id) {
      const deal = findDeal(id);
      db.rows.deals.splice(db.rows.deals.indexOf(deal), 1);
    },
    addUser(email) {
      auth.addUser(email);
    },
    rows: (table) => db.snapshot(table),
    deal: (id) => db.snapshot("deals").find((row) => row.id === id),
    emailsSent: () => structuredClone(auth.emailsSent),
    requests: () => [...log],
    problems: () => [...problems],
  };
}
