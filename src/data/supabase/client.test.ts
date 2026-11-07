import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../auth/authGateway";
import { MemoryStorage } from "../local/memoryStorage";
import { createSupabaseAuth } from "../auth/supabaseAuth";
import { createOfflineRepository } from "../offline/offlineRepository";
import { sampleDealInputs } from "../sample";
import { DataError } from "../types";
import { createSupabaseCompany } from "../auth/supabaseCompany";
import {
  createSupabase,
  REQUEST_TIMEOUT_MS,
  withSignedInData,
  withTimeout,
} from "./client";
import { dealToRow } from "./mappers";
import { createSupabaseRepository } from "./supabaseRepository";

/** Stores a signed-in session the way supabase-js keeps one, so the client starts signed in without a request. */
function seedSession(storage: Storage, url: string, token = "user-jwt") {
  const ref = new URL(url).hostname.split(".")[0];
  storage.setItem(
    `sb-${ref}-auth-token`,
    JSON.stringify({
      access_token: token,
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "user-a", aud: "authenticated", email: "pat@example.com" },
    }),
  );
}

describe("createSupabase", () => {
  it("uses PKCE and the given storage", async () => {
    const bodies: unknown[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      bodies.push(JSON.parse((await request.text()) || "{}"));
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const storage = new MemoryStorage();
    const client = createSupabase(
      { url: "http://test.local", anonKey: "anon" },
      storage,
      fakeFetch,
    );
    await createSupabaseAuth(client).sendSignInEmail(
      "pat@example.com",
      "http://app.test/",
    );
    expect(bodies[0]).toMatchObject({ code_challenge_method: "s256" });
    const keys = Array.from(
      { length: storage.length },
      (_, i) => storage.key(i) ?? "",
    );
    expect(keys.some((key) => key.includes("code-verifier"))).toBe(true);
  });
});

describe("the time limit on each request", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const COMPANY = "c0ffee00-0000-4000-8000-000000000001";
  const DEAL = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Maple Street",
    status: "analyzing" as const,
    inputs: sampleDealInputs(),
    createdAt: "2026-11-01T12:00:00.123456+00:00",
    updatedAt: "2026-11-02T09:30:00.654321+00:00",
  };

  /** A server that answers, or (`hang`) never answers until the request is aborted, as a one-bar connection does. */
  function oneBar() {
    const state = { hang: false, calls: 0 };
    const fakeFetch: typeof fetch = (input, init) => {
      state.calls += 1;
      if (state.hang) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
        });
      }
      const url = new URL(new Request(input, init).url);
      const body =
        url.pathname === "/rest/v1/deals" ? [dealToRow(DEAL, COMPANY)] : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    const storage = new MemoryStorage();
    seedSession(storage, "http://one-bar.test");
    const client = createSupabase(
      { url: "http://one-bar.test", anonKey: "anon" },
      storage,
      fakeFetch,
    );
    return { state, client };
  }

  it("gives up on a sign-in request after 20 s, which reads as offline", async () => {
    // `setImmediate` stays real: it is how the test waits for work that no fake timer drives (below).
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    const { state, client } = oneBar();
    state.hang = true;
    let reason: unknown;
    void createSupabaseAuth(client)
      .sendSignInEmail("pat@example.com", "http://app.test/")
      .catch((error: unknown) => (reason = error));
    // Before the request goes out, sign-in makes its PKCE challenge with the real `crypto.subtle`, which no fake
    // timer drives. Wait until the request is actually on its way, so the 20 s are counted from there.
    for (let turn = 0; state.calls === 0 && turn < 1000; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(state.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(reason).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(reason).toBeInstanceOf(AuthError);
    expect((reason as AuthError).reason).toBe("offline");
  });

  it("gives up on a data request after 20 s, once, which reads as offline", async () => {
    vi.useFakeTimers();
    const { state, client } = oneBar();
    state.hang = true;
    let reason: unknown;
    void createSupabaseRepository(client, COMPANY)
      .listDeals()
      .catch((error: unknown) => (reason = error));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(reason).toBeInstanceOf(DataError);
    expect((reason as DataError).kind).toBe("offline");
    // An aborted request is not retried, so the owner is not kept waiting another 20 s per try.
    await vi.advanceTimersByTimeAsync(5 * REQUEST_TIMEOUT_MS);
    expect(state.calls).toBe(1);
  });

  it("a hung list read falls back to the device copy", async () => {
    vi.useFakeTimers();
    const { state, client } = oneBar();
    const outbox = createOfflineRepository(
      createSupabaseRepository(client, COMPANY),
      new MemoryStorage(),
      "user-a",
    );
    expect((await outbox.listDeals()).deals.map((d) => d.name)).toEqual([
      "Maple Street",
    ]);
    state.hang = true;
    let list: Awaited<ReturnType<typeof outbox.listDeals>> | undefined;
    void outbox.listDeals().then((answer) => (list = answer));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(list?.deals.map((d) => d.name)).toEqual(["Maple Street"]);
    expect(list?.notice).toBe(
      "Showing what's saved on this device — can't reach the server.",
    );
  });

  it("leaves no timer behind once the answer comes", async () => {
    vi.useFakeTimers();
    const { client } = oneBar();
    const repository = createSupabaseRepository(client, COMPANY);
    // supabase-js keeps timers of its own; count around a second request.
    await repository.listDeals();
    const before = vi.getTimerCount();
    await repository.listDeals();
    expect(vi.getTimerCount()).toBe(before);
  });

  it("still lets the caller's own signal abort a request", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const limited = withTimeout((_input, init) => {
      seen.push(init?.signal ?? undefined);
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    });
    const caller = new AbortController();
    const request = limited("http://one-bar.test/x", { signal: caller.signal });
    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(seen[0]?.aborted).toBe(true);
  });
});

describe("no data request without a signed-in session", () => {
  const URL_ = "http://signed-out.test";
  const COMPANY = "c0ffee00-0000-4000-8000-000000000001";
  const DEAL = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Maple Street",
    status: "analyzing" as const,
    inputs: sampleDealInputs(),
    createdAt: "2026-11-01T12:00:00.123456+00:00",
    updatedAt: "2026-11-02T09:30:00.654321+00:00",
  };

  /** A client over a fake fetch that records what reaches it; an empty answer would read as "no deals". */
  function boundary(signedIn: boolean) {
    const seen: { path: string; authorization: string | null }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("Authorization"),
      });
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const storage = new MemoryStorage();
    if (signedIn) seedSession(storage, URL_);
    const client = createSupabase(
      { url: URL_, anonKey: "anon-key" },
      storage,
      fakeFetch,
    );
    return { seen, client };
  }

  it("refuses a table read without reaching the network, as offline", async () => {
    const { seen, client } = boundary(false);
    const error = await createSupabaseRepository(client, COMPANY)
      .listDeals()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe("offline");
    expect(seen).toEqual([]);
  });

  it("refuses the company read, so a returning owner is not sent to name a company", async () => {
    const { seen, client } = boundary(false);
    const error = await createSupabaseCompany(client)
      .myCompany()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe("offline");
    expect(seen).toEqual([]);
  });

  it("serves the device copy when the list is refused", async () => {
    const device = new MemoryStorage();
    await createOfflineRepository(
      {
        ...createSupabaseRepository(boundary(true).client, COMPANY),
        listDeals: async () => ({ deals: [DEAL], problems: [] }),
      },
      device,
      "user-a",
    ).listDeals();
    const { seen, client } = boundary(false);
    const outbox = createOfflineRepository(
      createSupabaseRepository(client, COMPANY),
      device,
      "user-a",
    );
    const list = await outbox.listDeals();
    expect(list.deals.map((d) => d.name)).toEqual(["Maple Street"]);
    expect(list.notice).toBe(
      "Showing what's saved on this device — can't reach the server.",
    );
    expect(seen).toEqual([]);
  });

  it("fails a save as offline, not as a deal deleted elsewhere", async () => {
    const { seen, client } = boundary(false);
    const error = await createSupabaseRepository(client, COMPANY)
      .saveDeal(DEAL)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe("offline");
    expect(seen).toEqual([]);
  });

  it("lets data requests through with the user's bearer when signed in", async () => {
    const { seen, client } = boundary(true);
    await createSupabaseRepository(client, COMPANY).listDeals();
    expect(seen).toEqual([
      { path: "/rest/v1/deals", authorization: "Bearer user-jwt" },
    ]);
  });

  it("never touches /auth/v1/ requests, signed out", async () => {
    const { seen, client } = boundary(false);
    await createSupabaseAuth(client).sendSignInEmail(
      "pat@example.com",
      "http://app.test/",
    );
    expect(seen.map((r) => r.path)).toEqual(["/auth/v1/otp"]);
    expect(seen[0]?.authorization).toBe("Bearer anon-key");
  });

  describe("withSignedInData", () => {
    const reached: string[] = [];
    const inner: typeof fetch = async (input) => {
      reached.push(String(input instanceof Request ? input.url : input));
      return new Response("{}");
    };
    const guarded = withSignedInData(inner, "anon-key");
    const rest = "http://x.test/rest/v1/deals";
    beforeEach(() => {
      reached.length = 0;
    });

    it.each([
      [
        "a Headers object",
        () => ({ headers: new Headers({ Authorization: "Bearer anon-key" }) }),
      ],
      [
        "a plain object",
        () => ({ headers: { authorization: "Bearer anon-key" } }),
      ],
      [
        "pair arrays",
        () => ({
          headers: [["Authorization", "Bearer anon-key"]] as [string, string][],
        }),
      ],
    ])("refuses the anon bearer given as %s", async (_name, init) => {
      await expect(guarded(rest, init())).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(reached).toEqual([]);
    });

    it("refuses the anon bearer carried on a Request, and an rpc path", async () => {
      const request = new Request("http://x.test/rest/v1/rpc/create_company", {
        method: "POST",
        headers: { Authorization: "Bearer anon-key" },
      });
      await expect(guarded(request)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(reached).toEqual([]);
    });

    it("passes a user bearer, a non-REST path, and a URL object", async () => {
      await guarded(rest, { headers: { Authorization: "Bearer user-jwt" } });
      await guarded("http://x.test/auth/v1/token", {
        headers: { Authorization: "Bearer anon-key" },
      });
      await guarded(new URL("http://x.test/rest/v1/deals"), {
        headers: { Authorization: "Bearer user-jwt" },
      });
      expect(reached).toHaveLength(3);
    });
  });
});
