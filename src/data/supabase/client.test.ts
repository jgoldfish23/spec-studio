import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../auth/authGateway";
import { MemoryStorage } from "../local/memoryStorage";
import { createSupabaseAuth } from "../auth/supabaseAuth";
import { createOfflineRepository } from "../offline/offlineRepository";
import { sampleDealInputs } from "../sample";
import { DataError } from "../types";
import { createSupabase, REQUEST_TIMEOUT_MS, withTimeout } from "./client";
import { dealToRow } from "./mappers";
import { createSupabaseRepository } from "./supabaseRepository";

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
    const client = createSupabase(
      { url: "http://one-bar.test", anonKey: "anon" },
      new MemoryStorage(),
      fakeFetch,
    );
    return { state, client };
  }

  it("gives up on a sign-in request after 20 s, which reads as offline", async () => {
    vi.useFakeTimers();
    const { state, client } = oneBar();
    state.hang = true;
    let reason: unknown;
    void createSupabaseAuth(client)
      .sendSignInEmail("pat@example.com", "http://app.test/")
      .catch((error: unknown) => (reason = error));
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
