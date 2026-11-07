import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module without type declarations
import { scanText } from "../scripts/bundleScan.mjs";

type Hit = { rule: string };
const scan = scanText as (text: string, opts?: { demo?: boolean }) => Hit[];

const b64url = (s: string) => Buffer.from(s).toString("base64url");
// Obviously fake: built here from a claims object with a dummy signature.
const jwt = (claims: object) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(claims))}.ZHVtbXk`;
const fakeJwt = jwt;
const rules = (text: string, demo = false) => scan(text, { demo }).map((h) => h.rule);

describe("scanText", () => {
  it("passes ordinary bundle text", () => {
    expect(scan("const a = 1; fetch('/x')")).toEqual([]);
  });

  it("flags forbidden strings", () => {
    expect(rules("x service_role y")).toContain("service_role");
    expect(rules("postgres://u:p@h/db")).toContain("postgres://");
    expect(rules("postgresql://u:p@h/db")).toContain("postgresql://");
    expect(rules("k=sb_secret_AAAAAAAAAAAAAAAAAAAAAAAA")).toContain("sb_secret_ key");
  });

  it("allows the bare sb_secret_ prefix that supabase-js checks for", () => {
    expect(rules("e.startsWith(`sb_secret_`)")).toEqual([]);
  });

  it("flags a JWT whose role is service_role", () => {
    const hits = rules(`k="${fakeJwt({ role: "service_role" })}"`);
    expect(hits).toContain("service-role JWT");
  });

  it("allows an anon JWT in hosted mode", () => {
    expect(rules(`k="${fakeJwt({ role: "anon" })}"`)).toEqual([]);
  });

  it("demo mode rejects any JWT and any project URL", () => {
    expect(rules(`k="${fakeJwt({ role: "anon" })}"`, true)).toContain("JWT");
    expect(rules("https://abcdefghijklmnopqrst.supabase.co", true)).toContain("project URL");
    expect(rules("https://abcdefghijklmnopqrst.supabase.co", false)).toEqual([]);
  });

  it("demo mode allows bare supabase.co and env names", () => {
    expect(rules("VITE_SUPABASE_URL .supabase.co", true)).toEqual([]);
  });

  it("allows a short sb_secret_ value", () => {
    expect(rules("sb_secret_short")).toEqual([]);
  });

  it("does not crash on a JWT-shaped token whose payload is not JSON", () => {
    const t = `${b64url('{"alg":"x"}')}.${b64url("not json")}.ZHVtbXk`;
    expect(rules(`k="${t}"`)).toEqual([]);
  });

  it("ignores a project URL of the wrong length", () => {
    expect(rules("https://abcdefghijklmnopqrs.supabase.co https://abcdefghijklmnopqrstu.supabase.co", true)).toEqual([]);
  });

  it("never returns the matched value", () => {
    const token = fakeJwt({ role: "service_role" });
    expect(JSON.stringify(scan(token, { demo: true }))).not.toContain(token);
  });
});
