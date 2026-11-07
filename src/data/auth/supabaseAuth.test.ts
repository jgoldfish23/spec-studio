import { createClient } from "@supabase/supabase-js";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthPKCECodeVerifierMissingError,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../local/memoryStorage";
import { AuthError, authErrorFrom } from "./authGateway";
import type { AuthErrorReason } from "./authGateway";
import { createSupabaseAuth } from "./supabaseAuth";

const USER_ID = "44444444-4444-4444-8444-444444444444";

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

const sessionBody = {
  access_token: "a.b.c",
  refresh_token: "r",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: USER_ID,
    email: "pat@example.com",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-30T00:00:00Z",
  },
};

function setup(
  respond: (request: Recorded) => Response | Promise<Response> = () => json({}),
  storage = new MemoryStorage(),
) {
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
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage,
    },
    global: { fetch: fakeFetch },
  });
  return { auth: createSupabaseAuth(client), requests, storage };
}

const reasonOf = async (
  promise: Promise<unknown>,
): Promise<AuthErrorReason> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).reason;
  }
  throw new Error("expected a rejection");
};

describe("supabase auth gateway", () => {
  it("sendSignInEmail posts the email, create_user and redirect_to to /auth/v1/otp", async () => {
    const { auth, requests } = setup();
    await auth.sendSignInEmail("pat@example.com", "http://app.test/");
    expect(requests).toHaveLength(1);
    expect(at(requests, 0).method).toBe("POST");
    expect(at(requests, 0).url.pathname).toBe("/auth/v1/otp");
    expect(at(requests, 0).url.searchParams.get("redirect_to")).toBe(
      "http://app.test/",
    );
    expect(at(requests, 0).body).toMatchObject({
      email: "pat@example.com",
      create_user: true,
    });
  });

  it("verifyCode posts type email to /auth/v1/verify and returns the user", async () => {
    const { auth, requests } = setup(() => json(sessionBody));
    const user = await auth.verifyCode("pat@example.com", "123456");
    expect(at(requests, 0).url.pathname).toBe("/auth/v1/verify");
    expect(at(requests, 0).body).toMatchObject({
      type: "email",
      email: "pat@example.com",
      token: "123456",
    });
    expect(user).toEqual({ id: USER_ID, email: "pat@example.com" });
    expect(await auth.currentUser()).toEqual(user);
    expect(requests).toHaveLength(1);
  });

  it("notifies listeners of sign-in and sign-out, and stops after unsubscribe", async () => {
    const { auth } = setup(() => json(sessionBody));
    const seen: (string | null)[] = [];
    const stop = auth.onChange((user) => seen.push(user?.id ?? null));
    await auth.verifyCode("pat@example.com", "123456");
    await auth.signOut();
    stop();
    await auth.verifyCode("pat@example.com", "123456");
    expect(seen).toContain(USER_ID);
    expect(seen.at(-1)).toBeNull();
    expect(seen.filter((id) => id === USER_ID)).toHaveLength(1);
  });

  it("currentUser is null with nothing stored", async () => {
    const { auth, requests } = setup();
    expect(await auth.currentUser()).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("exchangeLinkCode sends the stored verifier with the code", async () => {
    const { auth, requests } = setup((request) =>
      request.url.pathname === "/auth/v1/token" ? json(sessionBody) : json({}),
    );
    await auth.sendSignInEmail("pat@example.com", "http://app.test/");
    const user = await auth.exchangeLinkCode("link-code");
    const exchange = requests.at(-1)!;
    expect(exchange.url.pathname).toBe("/auth/v1/token");
    expect(exchange.url.searchParams.get("grant_type")).toBe("pkce");
    expect(exchange.body).toMatchObject({ auth_code: "link-code" });
    expect(
      (exchange.body as { code_verifier: string }).code_verifier,
    ).toBeTruthy();
    expect(user.id).toBe(USER_ID);
  });

  it("exchangeLinkCode in a browser that never asked maps to otherBrowser", async () => {
    const { auth, requests } = setup();
    const error = await auth
      .exchangeLinkCode("link-code")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).reason).toBe("otherBrowser");
    expect((error as AuthError).message).toBe(
      "This link was opened in a different browser than the one that asked for it. Type the 6-digit code from the same email instead.",
    );
    expect(requests).toHaveLength(0);
  });

  it("maps HTTP 429 to rateLimited", async () => {
    const { auth } = setup(() =>
      json({ error_code: "over_email_send_rate_limit", msg: "slow down" }, 429),
    );
    const error = await auth
      .sendSignInEmail("pat@example.com", "http://app.test/")
      .catch((e: unknown) => e);
    expect((error as AuthError).reason).toBe("rateLimited");
    expect((error as AuthError).message).toBe(
      "Too many tries — wait a minute, then try again.",
    );
  });

  it("maps an expired or invalid token to badCode", async () => {
    const { auth } = setup(() =>
      json(
        { error_code: "otp_expired", msg: "Token has expired or is invalid" },
        403,
      ),
    );
    const error = await auth
      .verifyCode("pat@example.com", "000000")
      .catch((e: unknown) => e);
    expect((error as AuthError).reason).toBe("badCode");
    expect((error as AuthError).message).toBe(
      "That code didn't work or has expired. Send a new one.",
    );
  });

  it("maps a fetch TypeError to offline", async () => {
    const { auth } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await reasonOf(
        auth.sendSignInEmail("pat@example.com", "http://app.test/"),
      ),
    ).toBe("offline");
  });
});

describe("startup with a stored session the server can't refresh", () => {
  afterEach(() => vi.useRealTimers());

  it("is offline for currentUser, and listeners hear nothing, so the app does not show a false sign-out", async () => {
    vi.useFakeTimers();
    // auth-js warns about each failed background refresh itself; that is its output, not ours.
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = new MemoryStorage();
    const expired = {
      ...sessionBody,
      expires_at: Math.floor(Date.now() / 1000) - 3600,
    };
    storage.setItem("sb-test-auth-token", JSON.stringify(expired));
    const { auth } = setup(() => {
      throw new TypeError("Failed to fetch");
    }, storage);
    const seen: (string | null)[] = [];
    const stop = auth.onChange((user) => seen.push(user?.id ?? null));
    const read = reasonOf(auth.currentUser());
    // supabase-js retries the refresh with back-off for most of 30 s before it gives up.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await read).toBe("offline");
    stop();
    expect(seen).toEqual([]);
    // The session stays stored, for when the network is back.
    expect(storage.getItem("sb-test-auth-token")).not.toBeNull();
    // Whatever auth-js warned about was the failed refresh, nothing else.
    for (const [warning] of warned.mock.calls) {
      expect(warning).toMatchObject({ name: "AuthRetryableFetchError" });
    }
    warned.mockRestore();
  });
});

describe("signOut", () => {
  it("signs out on this device only: the owner's other devices stay signed in", async () => {
    const { auth, requests } = setup((request) =>
      request.url.pathname === "/auth/v1/logout"
        ? new Response(null, { status: 204 })
        : json(sessionBody),
    );
    await auth.verifyCode("pat@example.com", "123456");
    await auth.signOut();
    expect(
      requests
        .filter((r) => r.url.pathname === "/auth/v1/logout")
        .map((r) => `${r.method} ${r.url.pathname}${r.url.search}`),
    ).toEqual(["POST /auth/v1/logout?scope=local"]);
    expect(await auth.currentUser()).toBeNull();
  });

  it("maps a thrown network TypeError to offline", async () => {
    const { auth } = setup(() => json(sessionBody));
    await auth.verifyCode("pat@example.com", "123456");
    const { auth: offline } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    // signOut with no session never reaches the network, so give the gateway a client whose auth call throws.
    const broken = createSupabaseAuth({
      auth: { signOut: () => Promise.reject(new TypeError("Failed to fetch")) },
    } as unknown as Parameters<typeof createSupabaseAuth>[0]);
    expect(await reasonOf(broken.signOut())).toBe("offline");
    await expect(offline.signOut()).resolves.toBeUndefined();
  });
});

describe("authErrorFrom", () => {
  const cases: [string, unknown, AuthErrorReason][] = [
    ["429", new AuthApiError("slow", 429, undefined), "rateLimited"],
    [
      "over_email_send_rate_limit",
      new AuthApiError("x", 400, "over_email_send_rate_limit"),
      "rateLimited",
    ],
    [
      "over_request_rate_limit",
      new AuthApiError("x", 400, "over_request_rate_limit"),
      "rateLimited",
    ],
    ["otp_expired", new AuthApiError("x", 400, "otp_expired"), "badCode"],
    ["invalid_otp", new AuthApiError("x", 400, "invalid_otp"), "badCode"],
    [
      "token message",
      new AuthApiError("Token has expired or is invalid", 400, undefined),
      "badCode",
    ],
    ["403", new AuthApiError("Forbidden", 403, undefined), "badCode"],
    [
      "verifier missing",
      new AuthPKCECodeVerifierMissingError(),
      "otherBrowser",
    ],
    [
      "old verifier message",
      new Error(
        "invalid request: both auth code and code verifier should be non-empty",
      ),
      "otherBrowser",
    ],
    ["retryable", new AuthRetryableFetchError("down", 503), "offline"],
    [
      "retryable status 0",
      new AuthRetryableFetchError("Failed to fetch", 0),
      "offline",
    ],
    ["TypeError", new TypeError("Failed to fetch"), "offline"],
    ["unknown", new Error("boom"), "failed"],
    ["non-error", "boom", "failed"],
  ];
  it.each(cases)("%s", (_name, error, reason) => {
    expect(authErrorFrom(error).reason).toBe(reason);
  });

  it("logs only the unmapped errors, once", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    authErrorFrom(new TypeError("x"));
    expect(logged).not.toHaveBeenCalled();
    expect(authErrorFrom(new Error("boom")).message).toBe(
      "Couldn't sign in — try again in a minute.",
    );
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

function at(requests: Recorded[], index: number): Recorded {
  const request = requests[index];
  if (!request) throw new Error(`no request #${index}`);
  return request;
}
