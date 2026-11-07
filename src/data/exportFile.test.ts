import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET_SETTINGS, type Comp } from "@engine";
import { testSampleComps } from "../testing/sampleIds";
import { isUuid } from "../lib/uuid";
import { createLocalRepository } from "./local/localRepository";
import { MemoryStorage } from "./local/memoryStorage";
import {
  buildExport,
  EXPORT_FORMAT,
  exportFileName,
  parseExport,
  planImport,
  runImport,
  type ExportFile,
} from "./exportFile";
import { SAMPLE_DEAL_NAME, sampleDealInputs } from "./sample";
import type { Repository } from "./types";

const REGION = DEFAULT_MARKET_SETTINGS.region;
const NOW = "2026-11-02T15:30:00.000Z";
const UUID_A = "0b6f6c0e-6a43-4c1f-9b55-3a6c7f2f0e11";

const newRepo = (): Repository => createLocalRepository(new MemoryStorage());

async function seeded(): Promise<Repository> {
  const repo = newRepo();
  for (const comp of testSampleComps()) await repo.saveComp(comp);
  await repo.createDeal({ name: SAMPLE_DEAL_NAME, inputs: sampleDealInputs() });
  return repo;
}

const exported = async (repo: Repository): Promise<ExportFile> => buildExport(repo, REGION, NOW);
const parsed = (file: ExportFile): ExportFile => {
  const result = parseExport(JSON.stringify(file));
  if (!result.ok) throw new Error(result.message);
  return result.file;
};
const none = { deals: [], comps: [] };
const comp0 = (): Comp => testSampleComps()[0] as Comp;

describe("buildExport and parseExport", () => {
  it("round-trips the sample deal through JSON to an equal file", async () => {
    const file = await exported(await seeded());
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.exportedAt).toBe(NOW);
    expect(file.deals).toHaveLength(1);
    expect(file.comps).toHaveLength(8);
    expect(file.marketSettings).toHaveLength(1);
    const result = parseExport(JSON.stringify(file));
    expect(result).toEqual({ ok: true, file });
  });

  it("names the file for the local date", () => {
    expect(exportFileName("2026-11-02T12:00:00")).toBe("spec-studio-export-2026-11-02.json");
    const local = new Date(2026, 0, 5, 23, 30).toISOString();
    expect(exportFileName(local)).toBe("spec-studio-export-2026-01-05.json");
  });

  it("says a non-JSON file isn't an export", () => {
    expect(parseExport("not json at all")).toEqual({
      ok: false,
      message: "That isn't a Spec Studio export file.",
    });
    expect(parseExport("[1,2]")).toEqual({
      ok: false,
      message: "That isn't a Spec Studio export file.",
    });
  });

  it("names a different format", () => {
    expect(parseExport(JSON.stringify({ format: "other/v9" }))).toEqual({
      ok: false,
      message: "This file is from a different version of Spec Studio (other/v9).",
    });
  });

  it("reports the first schema problem with its path", async () => {
    const file = await exported(await seeded());
    const broken = { ...file, comps: [{ ...file.comps[0], beds: "many" }] };
    const result = parseExport(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/^This export has a problem: comps\.0\.beds: .+\.$/);
    }
  });

  it("refuses text over 20 MB without parsing it", () => {
    const parse = vi.spyOn(JSON, "parse");
    const result = parseExport("x".repeat(20 * 1024 * 1024 + 1));
    expect(result).toEqual({
      ok: false,
      message: "That file is too big to be a Spec Studio export.",
    });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
});

describe("planImport", () => {
  it("skips a deal whose name is already there, and a comp matching by address and sold date", async () => {
    const file = parsed(await exported(await seeded()));
    const existing = {
      deals: [{ ...file.deals[0]!, id: "x" }],
      comps: [
        {
          ...comp0(),
          id: UUID_A,
          address: `  ${comp0().address.toUpperCase()}  `,
        },
      ],
    };
    const plan = planImport(file, existing);
    expect(plan.deals).toEqual([]);
    expect(plan.skippedDeals).toEqual([{ name: SAMPLE_DEAL_NAME, reason: "already in your account" }]);
    expect(plan.comps).toHaveLength(7);
    expect(plan.skippedComps).toHaveLength(1);
    expect(plan.skippedComps[0]?.reason).toBe("already in your account");
  });

  it("gives every imported comp a new UUID and remaps compSelections, including a matched comp", async () => {
    const file = parsed(await exported(await seeded()));
    const [first, second, third] = file.comps as [Comp, Comp, Comp];
    file.comps = [
      { ...first, id: "comp-1" },
      { ...second, id: UUID_A },
      { ...third, id: "comp-3" },
    ];
    file.deals[0]!.inputs.compSelections = {
      "comp-1": true,
      [UUID_A]: false,
      "comp-3": true,
      ghost: true,
    };
    const existingId = "5a1f6c0e-6a43-4c1f-9b55-3a6c7f2f0e99";
    const existing = { deals: [], comps: [{ ...third, id: existingId }] };

    const plan = planImport(file, existing, {
      newId: (() => {
        let n = 0;
        return () => `00000000-0000-4000-8000-00000000000${++n}`;
      })(),
    });
    expect(plan.comps.map((c) => c.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(plan.comps.every((c) => isUuid(c.id))).toBe(true);
    expect(plan.deals[0]?.inputs.compSelections).toEqual({
      "00000000-0000-4000-8000-000000000001": true,
      "00000000-0000-4000-8000-000000000002": false,
      [existingId]: true,
    });
    expect(plan.droppedSelections).toBe(1);
  });

  it("uses real UUIDs by default and keeps the sample marking", async () => {
    const file = parsed(await exported(await seeded()));
    const plan = planImport(file, none);
    expect(plan.comps).toHaveLength(8);
    expect(plan.comps.every((c) => isUuid(c.id) && c.source === "sample")).toBe(true);
    expect(plan.comps.map((c) => c.id)).not.toContain(file.comps[0]!.id);
  });

  it("leaves settings out unless asked, and lists price overrides as skipped", async () => {
    const file = parsed(await exported(await seeded()));
    file.priceBook = [
      {
        code: "framing",
        region: REGION,
        unitPriceCents: 100,
        unit: "sf",
        asOf: "2026-10-01",
      } as never,
    ];
    expect(planImport(file, none).settings).toBeNull();
    const withSettings = planImport(file, none, { replaceSettings: true });
    expect(withSettings.settings).toEqual({
      company: file.companySettings,
      market: file.marketSettings,
    });
    expect(withSettings.skippedPriceBook).toBe(1);
  });

  it("adds nothing the second time", async () => {
    const source = await seeded();
    const file = parsed(await exported(source));
    const target = newRepo();
    const firstPlan = planImport(file, {
      deals: (await target.listDeals()).deals,
      comps: await target.listComps(REGION),
    });
    await runImport(target, firstPlan);
    const second = planImport(file, {
      deals: (await target.listDeals()).deals,
      comps: await target.listComps(REGION),
    });
    expect(second.deals).toEqual([]);
    expect(second.comps).toEqual([]);
    const report = await runImport(target, second);
    expect(report.message).toBe("Nothing new to import. Skipped 1 deal and 8 comps already in your account.");
    expect((await target.listDeals()).deals).toHaveLength(1);
    expect(await target.listComps(REGION)).toHaveLength(8);
  });

  it("skips a comp repeated inside the file and points its selections at the first", async () => {
    const file = parsed(await exported(await seeded()));
    const a = { ...comp0(), id: "a" };
    const b = { ...comp0(), id: "b" };
    file.comps = [a, b];
    file.deals[0]!.inputs.compSelections = { a: true, b: false };
    const plan = planImport(file, none);
    expect(plan.comps).toHaveLength(1);
    const id = plan.comps[0]!.id;
    expect(plan.deals[0]?.inputs.compSelections).toEqual({ [id]: false });
  });
});

describe("runImport", () => {
  it("saves comps first, then deals, and reports the counts", async () => {
    const file = parsed(await exported(await seeded()));
    const target = newRepo();
    const order: string[] = [];
    const saveComp = target.saveComp.bind(target);
    const createDeal = target.createDeal.bind(target);
    vi.spyOn(target, "saveComp").mockImplementation((c) => (order.push("comp"), saveComp(c)));
    vi.spyOn(target, "createDeal").mockImplementation((d) => (order.push("deal"), createDeal(d)));
    const plan = planImport(file, none);
    const report = await runImport(target, plan);
    expect(order).toEqual([...Array<string>(8).fill("comp"), "deal"]);
    expect(report.message).toBe("Imported 1 deal and 8 comps.");
    expect(report).toMatchObject({
      importedDeals: 1,
      importedComps: 8,
      failed: false,
    });
    const [deal] = (await target.listDeals()).deals;
    const ids = (await target.listComps(REGION)).map((c) => c.id);
    expect(Object.keys(deal!.inputs.compSelections).every((id) => ids.includes(id))).toBe(true);
  });

  it("mentions skipped deals", async () => {
    const file = parsed(await exported(await seeded()));
    const second = { ...file.deals[0]!, name: "Other" };
    file.deals = [file.deals[0]!, second];
    const target = newRepo();
    await target.createDeal({
      name: SAMPLE_DEAL_NAME,
      inputs: sampleDealInputs(),
    });
    const plan = planImport(file, {
      deals: (await target.listDeals()).deals,
      comps: [],
    });
    const report = await runImport(target, plan);
    expect(report.message).toBe("Imported 1 deal and 8 comps. Skipped 1 deal already in your account.");
  });

  it("replaces settings only when the plan carries them, after the deals", async () => {
    const file = parsed(await exported(await seeded()));
    file.companySettings = { ...file.companySettings, contingencyPct: 0.09 };
    const target = newRepo();
    await runImport(target, planImport(file, none));
    expect((await target.getCompanySettings()).contingencyPct).toBe(0.05);
    const report = await runImport(target, planImport(file, none, { replaceSettings: true }));
    expect((await target.getCompanySettings()).contingencyPct).toBe(0.09);
    expect(report.message).toContain("Replaced your settings.");
  });

  it("stops at a failure, says what got in, and says importing again is safe", async () => {
    const file = parsed(await exported(await seeded()));
    const target = newRepo();
    const saveComp = target.saveComp.bind(target);
    let n = 0;
    vi.spyOn(target, "saveComp").mockImplementation((c) =>
      ++n === 4 ? Promise.reject(new Error("You're offline.")) : saveComp(c),
    );
    const createDeal = vi.spyOn(target, "createDeal");
    const report = await runImport(target, planImport(file, none));
    expect(createDeal).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      importedDeals: 0,
      importedComps: 3,
      failed: true,
    });
    expect(report.message).toBe(
      "Imported 0 deals and 3 comps, then it stopped: You're offline. Importing again skips what's already in.",
    );
    expect(await target.listComps(REGION)).toHaveLength(3);
  });
});
