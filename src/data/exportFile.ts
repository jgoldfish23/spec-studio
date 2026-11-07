import { z } from "zod";
import { CompSchema, MarketSettingsSchema, PriceBookEntrySchema } from "@engine";
import type { Comp, DealInputs, MarketSettings, PriceBookEntry } from "@engine";
import { errorMessage } from "../lib/errorMessage";
import { CompanySettingsSchema, firstProblem } from "./readBack";
import { StoredDealSchema } from "./types";
import type { CompanySettings, DealStatus, Repository, StoredDeal } from "./types";

/** What the first line of every export file says, so a file from another version of the app is recognised. */
export const EXPORT_FORMAT = "spec-studio-export/v1";

/** The most text an export may hold. A real one is well under a megabyte; anything bigger is not one. */
export const MAX_EXPORT_CHARS = 20 * 1024 * 1024;

const ExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exportedAt: z.string(),
  deals: z.array(StoredDealSchema),
  comps: z.array(CompSchema),
  companySettings: CompanySettingsSchema,
  marketSettings: z.array(MarketSettingsSchema),
  priceBook: z.array(PriceBookEntrySchema),
});

/** Everything the owner keeps in the app, as one JSON file. `marketSettings` is an array to leave room for more regions. */
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  deals: StoredDeal[];
  comps: Comp[];
  companySettings: CompanySettings;
  marketSettings: MarketSettings[];
  priceBook: PriceBookEntry[];
}

/** Reads everything for `region` into an export. The shared starter prices are not the owner's data and are left out. */
export async function buildExport(
  repo: Repository,
  region: string,
  now: string,
): Promise<{ file: ExportFile; unreadable: number }> {
  const [list, comps, companySettings, marketSettings, costBook] = await Promise.all([
    repo.listDeals(),
    repo.listComps(region),
    repo.getCompanySettings(),
    repo.getMarketSettings(region),
    repo.getCostBook(region),
  ]);
  return {
    file: {
      format: EXPORT_FORMAT,
      exportedAt: now,
      deals: list.deals,
      comps,
      companySettings,
      marketSettings: [marketSettings],
      priceBook: costBook.priceBook,
    },
    unreadable: list.problems.length,
  };
}

/** " 2 deals couldn't be read and aren't in the file." — or nothing when every deal was read. */
export function unreadableNote(unreadable: number): string {
  if (unreadable <= 0) return "";
  return unreadable === 1
    ? " 1 deal couldn't be read and isn't in the file."
    : ` ${unreadable} deals couldn't be read and aren't in the file.`;
}

export type ParseResult = { ok: true; file: ExportFile } | { ok: false; message: string };

const NOT_AN_EXPORT = "That isn't a Spec Studio export file.";

export function parseExport(text: string): ParseResult {
  if (text.length > MAX_EXPORT_CHARS)
    return {
      ok: false,
      message: "That file is too big to be a Spec Studio export.",
    };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: NOT_AN_EXPORT };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: NOT_AN_EXPORT };
  const format = (raw as { format?: unknown }).format;
  if (format !== EXPORT_FORMAT) {
    return {
      ok: false,
      message: `This file is from a different version of Spec Studio (${String(format)}).`,
    };
  }
  const parsed = ExportFileSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      message: `This export has a problem: ${firstProblem(parsed.error).message}.`,
    };
  return { ok: true, file: parsed.data as ExportFile };
}

/** "spec-studio-export-2026-11-02.json", dated by the local day of `now`. */
export function exportFileName(now: string): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `spec-studio-export-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Hands the export to the browser as a download, then lets go of the temporary address. */
export function downloadExport(file: ExportFile, now: string): string {
  const name = exportFileName(now);
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return name;
}

export const ALREADY_IN = "already in your account";
export const PRICE_BOOK_SKIP = "price overrides come in with the cost book screen";

export interface PlannedDeal {
  name: string;
  status: DealStatus;
  inputs: DealInputs;
}

export interface ImportPlan {
  /** Comps to save, each under a new id. */
  comps: Comp[];
  skippedComps: { address: string; reason: string }[];
  deals: PlannedDeal[];
  skippedDeals: { name: string; reason: string }[];
  /** Price-book entries in the file; none are imported yet. */
  skippedPriceBook: number;
  /** Comp choices that pointed at a comp that is neither in the file nor in the account. */
  droppedSelections: number;
  /** Set only when the owner chose to replace their settings. */
  settings: { company: CompanySettings; market: MarketSettings[] } | null;
}

export interface PlanOptions {
  replaceSettings?: boolean;
  /** Where new comp ids come from; a random UUID by default. */
  newId?: () => string;
}

const squash = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
/** How two comps are told to be the same: address (ignoring case and spacing) and sold date. */
const compKey = (comp: Comp) => `${squash(comp.address)}|${comp.soldDate ?? ""}`;

/** JSON with object keys sorted, so two equal values read the same however a store (Postgres jsonb) ordered the keys. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** How two deals are told to be the same: the same name (ignoring case and spacing) and the same inputs. */
const dealKey = (name: string, inputs: DealInputs) => `${squash(name)}\u0000${stableStringify(inputs)}`;

/**
 * What an import would do, without doing it. A deal with the name and inputs of one already there is skipped, and so is a comp
 * with the address and sold date of one already there (or earlier in the file), so importing the same file twice adds
 * nothing. Every comp that comes in gets a new id, since comp ids are unique across all accounts; deal comp choices
 * are re-pointed at the new ids (or at the matching comp's id), and a choice for a comp nobody has is dropped.
 */
export function planImport(
  file: ExportFile,
  existing: { deals: readonly StoredDeal[]; comps: readonly Comp[] },
  options: PlanOptions = {},
): ImportPlan {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const byKey = new Map<string, string>(existing.comps.map((comp) => [compKey(comp), comp.id]));
  const existingIds = new Set(existing.comps.map((comp) => comp.id));
  const idMap = new Map<string, string>();
  const comps: Comp[] = [];
  const skippedComps: ImportPlan["skippedComps"] = [];
  for (const comp of file.comps) {
    const key = compKey(comp);
    const match = byKey.get(key);
    if (match !== undefined) {
      idMap.set(comp.id, match);
      skippedComps.push({ address: comp.address, reason: ALREADY_IN });
      continue;
    }
    const id = newId();
    byKey.set(key, id);
    idMap.set(comp.id, id);
    comps.push({ ...comp, id });
  }

  const inAccount = new Set(existing.deals.map((deal) => dealKey(deal.name, deal.inputs)));
  const inFile = new Set<string>();
  const deals: PlannedDeal[] = [];
  const skippedDeals: ImportPlan["skippedDeals"] = [];
  let droppedSelections = 0;
  for (const deal of file.deals) {
    let dropped = 0;
    const compSelections: Record<string, boolean> = {};
    for (const [id, chosen] of Object.entries(deal.inputs.compSelections)) {
      const target = idMap.get(id) ?? (existingIds.has(id) ? id : undefined);
      if (target === undefined) dropped += 1;
      else compSelections[target] = chosen;
    }
    const inputs = { ...deal.inputs, compSelections };
    const key = dealKey(deal.name, inputs);
    if (inAccount.has(key)) {
      skippedDeals.push({ name: deal.name, reason: ALREADY_IN });
      continue;
    }
    if (inFile.has(key)) {
      skippedDeals.push({ name: deal.name, reason: "appears twice in this file" });
      continue;
    }
    inFile.add(key);
    droppedSelections += dropped;
    deals.push({ name: deal.name, status: deal.status, inputs });
  }

  return {
    comps,
    skippedComps,
    deals,
    skippedDeals,
    skippedPriceBook: file.priceBook.length,
    droppedSelections,
    settings: options.replaceSettings ? { company: file.companySettings, market: file.marketSettings } : null,
  };
}

export interface ImportReport {
  importedDeals: number;
  importedComps: number;
  failed: boolean;
  /** What to tell the owner. */
  message: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Saves the plan: comps first (so the deals' choices point at saved comps), then deals, then settings if planned. Stops at the first failure. */
export async function runImport(repo: Repository, plan: ImportPlan): Promise<ImportReport> {
  let importedComps = 0;
  let importedDeals = 0;
  let replaced = false;
  const counts = () => `${count(importedDeals, "deal", "deals")} and ${count(importedComps, "comp", "comps")}`;
  try {
    for (const comp of plan.comps) {
      await repo.saveComp(comp);
      importedComps += 1;
    }
    for (const deal of plan.deals) {
      const created = await repo.createDeal({ name: deal.name, inputs: deal.inputs });
      if (deal.status !== created.status) await repo.saveDeal({ ...created, status: deal.status });
      importedDeals += 1;
    }
    if (plan.settings) {
      await repo.saveCompanySettings(plan.settings.company);
      for (const market of plan.settings.market) await repo.saveMarketSettings(market);
      replaced = true;
    }
  } catch (error) {
    const reason = errorMessage(error).trim();
    return {
      importedDeals,
      importedComps,
      failed: true,
      message: `Imported ${counts()}, then it stopped: ${/[.!?]$/.test(reason) ? reason : `${reason}.`} Importing again skips what's already in.`,
    };
  }

  const skipped: string[] = [];
  if (plan.skippedDeals.length > 0) skipped.push(count(plan.skippedDeals.length, "deal", "deals"));
  if (plan.skippedComps.length > 0) skipped.push(count(plan.skippedComps.length, "comp", "comps"));
  const parts = [importedDeals + importedComps === 0 ? "Nothing new to import." : `Imported ${counts()}.`];
  if (skipped.length > 0) parts.push(`Skipped ${skipped.join(" and ")} ${ALREADY_IN}.`);
  if (plan.skippedPriceBook > 0) {
    parts.push(`Skipped ${count(plan.skippedPriceBook, "price override", "price overrides")} (${PRICE_BOOK_SKIP}).`);
  }
  if (replaced) parts.push("Replaced your settings.");
  return {
    importedDeals,
    importedComps,
    failed: false,
    message: parts.join(" "),
  };
}
