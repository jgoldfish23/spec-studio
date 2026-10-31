import { describe, expect, it } from "vitest";
import type { Quantities } from "@engine";
import { evaluated } from "../../testing/engineContext";
import { takeoffRows } from "./takeoff";

async function sampleQuantities(): Promise<Quantities> {
  const { quantities } = await evaluated();
  if (quantities.status !== "ok") throw new Error("the sample takeoff is incomplete");
  return quantities.value;
}

describe("takeoffRows", () => {
  it("has one row for every quantity the engine works out, scalar or group", async () => {
    const quantities = await sampleQuantities();
    const rows = takeoffRows(quantities);
    expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(quantities).sort());
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length);
  });

  it("gives the label, the value with its unit, and the engine's own account of how it was worked out", async () => {
    const quantities = await sampleQuantities();
    const rows = takeoffRows(quantities);
    const row = (key: string) => {
      const found = rows.find((candidate) => candidate.key === key);
      if (found === undefined) throw new Error(`no row for ${key}`);
      return found;
    };

    expect(row("foundationLf")).toEqual({
      key: "foundationLf",
      label: "Foundation",
      value: "214 LF",
      explain: quantities.foundationLf.explain,
    });
    expect(row("finishedSf")).toMatchObject({ label: "Finished area", value: "3,800 sf" });
    expect(row("excavationYd3")).toMatchObject({ label: "Excavation", value: `${quantities.excavationYd3.value} yd³` });
    expect(row("roofSquares").value).toBe(`${quantities.roofSquares.value} squares`);
    expect(row("hvacTons")).toMatchObject({ label: "HVAC", value: "5 tons" });
    // A count has no unit.
    expect(row("windowCount")).toMatchObject({ label: "Windows", value: String(quantities.windowCount.value) });
    expect(row("plumbingFixtures").value).toBe(String(quantities.plumbingFixtures.value));
  });

  it("groups thousands, and keeps a half ton as a half", async () => {
    const quantities = await sampleQuantities();
    const big = { ...quantities, drywallSf: { value: 15_000, explain: "x" }, hvacTons: { value: 4.5, explain: "y" } };
    const rows = takeoffRows(big);
    expect(rows.find((row) => row.key === "drywallSf")?.value).toBe("15,000 sf");
    expect(rows.find((row) => row.key === "hvacTons")?.value).toBe("4.5 tons");
  });

  it("shows a group as the total of its parts, and says which parts", async () => {
    const quantities = await sampleQuantities();
    const rows = takeoffRows(quantities);
    const sum = (qs: { value: number }[]) => qs.reduce((total, q) => total + q.value, 0);

    const cladding = rows.find((row) => row.key === "cladding");
    expect(cladding).toMatchObject({ label: "Cladding", value: `${sum(Object.values(quantities.cladding)).toLocaleString("en-US")} sf` });
    expect(cladding?.explain).toMatch(/Stone .* \+ stucco .* \+ board and batten .* \+ fiber cement/);

    expect(rows.find((row) => row.key === "cabinetLf")).toMatchObject({
      label: "Cabinets",
      value: `${sum(Object.values(quantities.cabinetLf))} LF`,
    });
    expect(rows.find((row) => row.key === "flooring")?.value).toBe(
      `${sum(Object.values(quantities.flooring)).toLocaleString("en-US")} sf`,
    );
    expect(rows.find((row) => row.key === "trimSf")?.value).toBe(`${sum(Object.values(quantities.trimSf)).toLocaleString("en-US")} sf`);
    expect(rows.find((row) => row.key === "fixtureSets")?.value).toBe(String(sum(Object.values(quantities.fixtureSets))));
    expect(rows.find((row) => row.key === "garageDoors")?.value).toBe(String(sum(Object.values(quantities.garageDoors))));
  });

  it("shows a dash for a figure that is not a number", async () => {
    const quantities = await sampleQuantities();
    const broken = {
      ...quantities,
      foundationLf: { value: Number.NaN, explain: "x" },
      cladding: { ...quantities.cladding, stone: { value: Number.POSITIVE_INFINITY, explain: "z" } },
    };
    const rows = takeoffRows(broken);
    expect(rows.find((row) => row.key === "foundationLf")?.value).toBe("—");
    expect(rows.find((row) => row.key === "cladding")?.value).toBe("—");
  });
});
