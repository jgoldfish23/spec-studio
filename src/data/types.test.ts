import { describe, expect, it } from "vitest";
import { DataError, StoredDealSchema } from "./types";
import { newDealInputs } from "./newDeal";
import { DEFAULT_RULES } from "@engine";

const inputs = newDealInputs("2026-10-30", { rules: DEFAULT_RULES, contingencyPct: 0.05 });
inputs.lot.city = "Kaysville";
const stored = {
  id: "deal-1",
  name: "Kaysville lot",
  status: "analyzing",
  inputs,
  createdAt: "2026-10-30T12:00:00.000Z",
  updatedAt: "2026-10-30T12:30:00.000Z",
};

describe("StoredDealSchema", () => {
  it("accepts a well-formed stored deal", () => {
    expect(StoredDealSchema.safeParse(stored).success).toBe(true);
  });

  it.each(["analyzing", "bought", "building", "listed", "sold", "dropped"])("accepts status %s", (status) => {
    expect(StoredDealSchema.safeParse({ ...stored, status }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(StoredDealSchema.safeParse({ ...stored, status: "pending" }).success).toBe(false);
  });

  it("rejects an empty name or id", () => {
    expect(StoredDealSchema.safeParse({ ...stored, name: "" }).success).toBe(false);
    expect(StoredDealSchema.safeParse({ ...stored, id: "" }).success).toBe(false);
  });

  it("rejects timestamps that are not ISO date-times", () => {
    expect(StoredDealSchema.safeParse({ ...stored, createdAt: "yesterday" }).success).toBe(false);
    expect(StoredDealSchema.safeParse({ ...stored, updatedAt: "2026-10-30" }).success).toBe(false);
  });

  it("accepts a timestamp with a UTC offset, as Postgres writes it", () => {
    expect(StoredDealSchema.safeParse({ ...stored, updatedAt: "2026-10-30T06:30:00.123+00:00" }).success).toBe(true);
  });

  it("rejects inputs that fail the deal schema, naming the field", () => {
    const bad = { ...stored, inputs: { ...inputs, loan: { ...inputs.loan, ltc: 2 } } };
    const result = StoredDealSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toContain("inputs.loan.ltc");
  });

  it("rejects a record with a missing field", () => {
    const rest: Partial<typeof stored> = { ...stored };
    delete rest.createdAt;
    expect(StoredDealSchema.safeParse(rest).success).toBe(false);
  });
});

describe("DataError", () => {
  it("is a real Error that instanceof can tell apart", () => {
    const error = new DataError("Deal d1 is unreadable", { recordId: "d1", path: "inputs.loan.ltc" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DataError);
    expect(error.name).toBe("DataError");
    expect(error.message).toBe("Deal d1 is unreadable");
    expect(error.recordId).toBe("d1");
    expect(error.path).toBe("inputs.loan.ltc");
  });

  it("works with only a message, and keeps a cause", () => {
    const cause = new SyntaxError("Unexpected token");
    const plain = new DataError("The deal store is not valid JSON", { cause });
    expect(plain.recordId).toBeUndefined();
    expect(plain.path).toBeUndefined();
    expect(plain.cause).toBe(cause);
    expect(new DataError("bare").recordId).toBeUndefined();
    expect(new Error("other")).not.toBeInstanceOf(DataError);
  });
});
