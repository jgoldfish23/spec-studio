import { describe, expect, it } from "vitest";
import { ConfigError, readAppConfig } from "./config";

const URL_ = "https://abcd1234.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiJ9.anon-key-for-tests.sig";
const BOTH_OR_NEITHER =
  "Spec Studio isn't configured correctly: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.";

/** The error `readAppConfig` throws for `env`, or a failure when it does not throw one. */
function problem(env: Record<string, string | undefined>): ConfigError {
  try {
    readAppConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error("expected a ConfigError");
}

describe("readAppConfig", () => {
  it("is demo mode with neither variable", () => {
    expect(readAppConfig({})).toEqual({ mode: "demo" });
  });

  it("treats empty or blank values as unset, as a build with an empty repository variable gives", () => {
    expect(
      readAppConfig({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "  " }),
    ).toEqual({ mode: "demo" });
  });

  it("is hosted mode with both, keeping the values", () => {
    expect(
      readAppConfig({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: KEY }),
    ).toEqual({
      mode: "hosted",
      supabaseUrl: URL_,
      supabaseAnonKey: KEY,
    });
  });

  it("trims stray spaces around the values", () => {
    expect(
      readAppConfig({
        VITE_SUPABASE_URL: ` ${URL_}\n`,
        VITE_SUPABASE_ANON_KEY: ` ${KEY} `,
      }),
    ).toEqual({
      mode: "hosted",
      supabaseUrl: URL_,
      supabaseAnonKey: KEY,
    });
  });

  it.each([
    ["only the URL", { VITE_SUPABASE_URL: URL_ }],
    ["only the key", { VITE_SUPABASE_ANON_KEY: KEY }],
    [
      "the URL and an empty key",
      { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: "" },
    ],
  ])("is a configuration error with %s", (_name, env) => {
    expect(problem(env).message).toBe(BOTH_OR_NEITHER);
  });

  it("refuses a plain http:// address, naming its host and never the key", () => {
    const error = problem({
      VITE_SUPABASE_URL: "http://abcd1234.supabase.co",
      VITE_SUPABASE_ANON_KEY: KEY,
    });
    expect(error.message).toMatch(/^Spec Studio isn't configured correctly: /);
    expect(error.message).toContain("https://");
    expect(error.message).toContain("abcd1234.supabase.co");
    expect(error.message).not.toContain(KEY);
  });

  it.each(["ftp://abcd1234.supabase.co", "ws://abcd1234.supabase.co"])(
    "refuses %s",
    (url) => {
      expect(
        problem({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: KEY })
          .message,
      ).toContain("abcd1234.supabase.co");
    },
  );

  it("refuses something that is not an address at all, without echoing it", () => {
    const error = problem({
      VITE_SUPABASE_URL: "abcd1234 supabase",
      VITE_SUPABASE_ANON_KEY: KEY,
    });
    expect(error.message).toMatch(
      /^Spec Studio isn't configured correctly: VITE_SUPABASE_URL/,
    );
    expect(error.message).not.toContain(KEY);
  });

  it("never puts the address's path or query in the message", () => {
    const error = problem({
      VITE_SUPABASE_URL: `http://example.com/x?apikey=${KEY}`,
      VITE_SUPABASE_ANON_KEY: KEY,
    });
    expect(error.message).toContain("example.com");
    expect(error.message).not.toContain("apikey");
    expect(error.message).not.toContain(KEY);
  });

  it.each([
    "http://localhost:54321",
    "http://127.0.0.1:54321",
    "http://fake-supabase.test",
    "http://api.fake-supabase.test:8080",
  ])("allows %s, for local development and the e2e tests", (url) => {
    expect(
      readAppConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: KEY }),
    ).toMatchObject({
      mode: "hosted",
      supabaseUrl: url,
    });
  });

  it.each([
    "http://localhost.example.com",
    "http://test",
    "http://example.test.com",
  ])("does not treat %s as local", (url) => {
    expect(
      problem({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: KEY }),
    ).toBeInstanceOf(ConfigError);
  });
});
