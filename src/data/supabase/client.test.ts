import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../local/memoryStorage";
import { createSupabaseAuth } from "../auth/supabaseAuth";
import { createSupabase } from "./client";

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
