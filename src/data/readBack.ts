import { z } from "zod";
import { CompSchema, DealInputsSchema, RulesSchema } from "@engine";
import type { Comp } from "@engine";
import { DataError, StoredDealSchema } from "./types";
import type { StoredDeal } from "./types";

/**
 * What "a record reads back" means, for both repositories. The demo build (localStorage) and the hosted build
 * (Supabase) must agree on which records are unreadable and what the owner is told, so the rule and its wording live
 * here and neither repository keeps its own copy.
 */

export type Problem = { path: string; message: string };
export type DealRead = { ok: true; deal: StoredDeal } | ({ ok: false } & Problem);

/** Company-wide settings as stored: the verdict rules and the contingency every new deal starts from. */
export const CompanySettingsSchema = z.object({
  rules: RulesSchema,
  contingencyPct: DealInputsSchema.shape.contingencyPct,
});

/** Zod phrases every type error as "Invalid input: expected number, received string"; the prefix says nothing. */
export const plain = (message: string): string => message.replace(/^Invalid input: /, "");

/** The first thing wrong with a record is enough to find it: its dotted path, and a message that starts with it. */
export function firstProblem(error: z.ZodError): Problem {
  const issue = error.issues[0];
  const path = (issue?.path ?? []).map(String).join(".");
  return { path, message: `${path === "" ? "record" : path}: ${plain(issue?.message ?? "unreadable")}` };
}

export function readDeal(raw: unknown): DealRead {
  const parsed = StoredDealSchema.safeParse(raw);
  // A bad field inside `inputs` arrives from the schema's structural check with its full path (`inputs.lot.priceCents`).
  return parsed.success ? { ok: true, deal: parsed.data } : { ok: false, ...firstProblem(parsed.error) };
}

/**
 * Refuses a record that would not read back. The record is checked as it will be stored, after a trip through JSON:
 * that is where `NaN` and `Infinity` become `null`, and `undefined` fields vanish. Without this, one bad autosave
 * (a blank name, a number gone wrong) would replace a good deal with one that lists as a problem.
 *
 * The error names the deal by its id; pass `null` for a deal that has no id yet.
 */
export function assertDealReadsBack(deal: StoredDeal, recordId: string | null = deal.id): void {
  const read = readDeal(JSON.parse(JSON.stringify(deal)));
  if (!read.ok) throw new DataError(`Couldn't save — ${read.message}`, { recordId: recordId ?? undefined, path: read.path });
}

export function assertCompReadsBack(comp: Comp): void {
  const parsed = CompSchema.safeParse(JSON.parse(JSON.stringify(comp)));
  if (parsed.success) return;
  const problem = firstProblem(parsed.error);
  throw new DataError(`Couldn't save — ${problem.message}`, { recordId: comp.id, path: problem.path });
}
