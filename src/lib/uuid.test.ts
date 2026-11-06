import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it.each([
    "5a3e0c0e-5a3e-4000-8000-000000000001",
    "22222222-2222-4222-8222-222222222222",
    "A3E0C0E5-5A3E-4000-B000-00000000000F",
    crypto.randomUUID(),
  ])("accepts %s", (id) => {
    expect(isUuid(id)).toBe(true);
  });

  it.each(["", "abc", "comp-1", "deal-1", "pending", "22222222-2222-4222-8222-22222222222", "22222222-2222-4222-8222-2222222222222", " 22222222-2222-4222-8222-222222222222", "2222222222224222822222222222222g"])(
    "rejects %j",
    (id) => {
      expect(isUuid(id)).toBe(false);
    },
  );
});
