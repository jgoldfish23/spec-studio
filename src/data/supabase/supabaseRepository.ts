import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_RULES } from "@engine";
import type { Comp, CostBookView, DealInputs, DefaultPrice, MarketSettings } from "@engine";
import { isUuid } from "../../lib/uuid";
import { assertCompReadsBack, assertDealReadsBack } from "../readBack";
import { DataError } from "../types";
import type { CompanySettings, DealListResult, Repository, StoredDeal } from "../types";
import type { DefaultPriceRow } from "./mappers";
import { toDataError } from "./errors";
import { fetchAllPages } from "./paging";
import {
  companySettingsFromRow,
  compFromRow,
  compToRow,
  dealFromRow,
  dealToRow,
  DEAL_SCHEMA_VERSION,
  defaultPriceFromRow,
  marketSettingsFromRow,
  priceBookEntryFromRow,
} from "./mappers";

/** Stands in for the id and timestamps a new deal does not have yet, so the rest of it can be checked before sending. */
const PENDING = { id: "pending", stamp: "1970-01-01T00:00:00.000Z" } as const;

/** What a failed request looked like: PostgREST's error and the HTTP status, for `toDataError`. */
function failed(response: { error: PostgrestError; status: number }, action: string, recordId?: string) {
  const { message, details, code } = response.error;
  return toDataError({ message, details, code, status: response.status }, action, recordId);
}

const CONFLICT = "This deal was changed on another device or tab.";
const DELETED = "This deal was deleted on another device or tab.";

/** A filter value for PostgREST's `or`, quoted so that a comma or parenthesis in it cannot change the filter. */
const quoted = (value: string): string => `"${value.replace(/["\\]/g, "\\$&")}"`;

const defaultPriceKey = (price: DefaultPrice): string => JSON.stringify([price.code, price.variant, price.tier]);

/**
 * The hosted build's repository: the same `Repository` the demo build keeps in localStorage, kept in Supabase for one
 * company. Row-level security already limits what the signed-in user can see, and every query also names the company,
 * so a mistake in a policy cannot widen it. Reads check what they find with the engine's schemas (a deal it cannot
 * read is a problem entry or a `DataError`, never a half-built value), and writes check the record first, so a save
 * never replaces a good record with one that would not read back.
 */
export function createSupabaseRepository(client: SupabaseClient, companyId: string): Repository {
  return {
    async listDeals(): Promise<DealListResult> {
      // Newest edit first; the id breaks a tie so that pages never repeat or skip a row.
      const { data, error, status } = await fetchAllPages((from, to) =>
        client
          .from("deals")
          .select("*")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (error) throw failed({ error, status }, "load your deals");
      const deals: StoredDeal[] = [];
      const problems: DealListResult["problems"] = [];
      for (const row of data ?? []) {
        try {
          deals.push(dealFromRow(row));
        } catch (cause) {
          if (!(cause instanceof DataError)) throw cause;
          problems.push({ id: cause.recordId ?? String(row?.id), message: cause.message });
        }
      }
      return { deals, problems };
    },

    async getDeal(id: string): Promise<StoredDeal | null> {
      // A deal id is a UUID; anything else is not stored, and is never sent to the database.
      if (!isUuid(id)) return null;
      const { data, error, status } = await client
        .from("deals")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw failed({ error, status }, "load this deal", id);
      if (!data) return null;
      try {
        return dealFromRow(data);
      } catch (cause) {
        if (!(cause instanceof DataError)) throw cause;
        throw new DataError(`Deal ${id} is unreadable: ${cause.message}`, { recordId: id, path: cause.path, cause });
      }
    },

    async createDeal(input: { name: string; inputs: DealInputs }): Promise<StoredDeal> {
      assertDealReadsBack(
        {
          id: PENDING.id,
          name: input.name,
          status: "analyzing",
          inputs: input.inputs,
          createdAt: PENDING.stamp,
          updatedAt: PENDING.stamp,
        },
        null,
      );
      // The database assigns the id and both timestamps.
      const { data, error, status } = await client
        .from("deals")
        .insert({
          company_id: companyId,
          name: input.name,
          status: "analyzing",
          schema_version: DEAL_SCHEMA_VERSION,
          inputs: input.inputs,
        })
        .select()
        .single();
      if (error) throw failed({ error, status }, "save");
      return dealFromRow(data);
    },

    async saveDeal(deal: StoredDeal, options: { overwrite?: boolean } = {}): Promise<StoredDeal> {
      assertDealReadsBack(deal);
      // Only a UUID can be stored, so any other id is a deal that is not there.
      if (!isUuid(deal.id)) throw new DataError(DELETED, { kind: "deleted", recordId: deal.id });
      const row = dealToRow(deal, companyId);
      // An update, never an upsert: it must not bring back a deal that was deleted. It matches the `updated_at` this
      // save was made from, exactly as stored, so a save that lost to another device or tab matches no row. The
      // database stamps `updated_at` on every update, and `created_at` stays as it was. Only the columns the owner can
      // change are sent.
      let update = client
        .from("deals")
        .update({ name: row.name, status: row.status, schema_version: row.schema_version, inputs: row.inputs })
        .eq("id", deal.id)
        .eq("company_id", companyId);
      if (options.overwrite !== true) update = update.eq("updated_at", deal.updatedAt);
      const { data, error, status } = await update.select();
      if (error) throw failed({ error, status }, "save", deal.id);
      const saved = data[0];
      if (saved !== undefined) return dealFromRow(saved);

      // Nothing matched: the deal was changed (its `updated_at` moved on) or deleted. One more read tells which.
      if (options.overwrite === true) throw new DataError(DELETED, { kind: "deleted", recordId: deal.id });
      const check = await client
        .from("deals")
        .select("id,updated_at")
        .eq("id", deal.id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (check.error) throw failed({ error: check.error, status: check.status }, "save", deal.id);
      if (check.data === null) throw new DataError(DELETED, { kind: "deleted", recordId: deal.id });
      throw new DataError(CONFLICT, { kind: "conflict", recordId: deal.id });
    },

    async deleteDeal(id: string): Promise<void> {
      if (!isUuid(id)) return;
      const { error, status } = await client.from("deals").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw failed({ error, status }, "delete this deal", id);
    },

    async resetDeals(): Promise<void> {
      const { error, status } = await client.from("deals").delete().eq("company_id", companyId);
      if (error) throw failed({ error, status }, "delete your deals");
    },

    async listComps(region: string): Promise<Comp[]> {
      // Oldest first, so saving a comp does not move it in the list.
      const { data, error, status } = await fetchAllPages((from, to) =>
        client
          .from("comps")
          .select("*")
          .eq("company_id", companyId)
          .eq("region", region)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (error) throw failed({ error, status }, "load your comps");
      const comps: Comp[] = [];
      for (const row of data ?? []) {
        // Like the demo store, a comp that cannot be read is left out rather than failing the whole list. Trade-off: a
        // dropped comp shifts the comp-based price; surfacing comp problems is a Plan 3 follow-up (the interface has
        // no problems channel for comps).
        try {
          comps.push(compFromRow(row));
        } catch (cause) {
          if (!(cause instanceof DataError)) throw cause;
        }
      }
      return comps;
    },

    async saveComp(comp: Comp): Promise<Comp> {
      assertCompReadsBack(comp);
      if (!isUuid(comp.id)) throw new DataError("Couldn't save — id: must be a UUID", { recordId: comp.id, path: "id" });
      const { data, error, status } = await client
        .from("comps")
        .upsert(compToRow(comp, companyId), { onConflict: "id" })
        .select()
        .single();
      if (error) throw failed({ error, status }, "save", comp.id);
      return compFromRow(data);
    },

    async deleteComp(id: string): Promise<void> {
      if (!isUuid(id)) return;
      const { error, status } = await client.from("comps").delete().eq("id", id).eq("company_id", companyId);
      if (error) throw failed({ error, status }, "delete this comp", id);
    },

    async getCostBook(region: string): Promise<CostBookView> {
      const [defaults, priceBook] = await Promise.all([
        // Ordered by the whole key (the table's unique key, less the region), so the same data always comes back in
        // the same order.
        fetchAllPages<DefaultPriceRow>((from, to) =>
          client
            .from("default_prices")
            .select("*")
            .eq("region", region)
            .or(`company_id.is.null,company_id.eq.${quoted(companyId)}`)
            .order("code")
            .order("variant")
            .order("tier")
            .order("company_id")
            .range(from, to),
        ),
        // A price book may repeat a key, so the id breaks the tie.
        fetchAllPages((from, to) =>
          client
            .from("price_book_entries")
            .select("*")
            .eq("company_id", companyId)
            .order("code")
            .order("variant")
            .order("tier")
            .order("id")
            .range(from, to),
        ),
      ]);
      if (defaults.error) throw failed({ error: defaults.error, status: defaults.status }, "load the cost book");
      if (priceBook.error) throw failed({ error: priceBook.error, status: priceBook.status }, "load the cost book");

      // A company's own price replaces the global one with the same code, variant and tier.
      const rows: DefaultPriceRow[] = defaults.data ?? [];
      const byKey = new Map<string, DefaultPrice>();
      for (const row of [...rows.filter((r) => r.company_id === null), ...rows.filter((r) => r.company_id !== null)]) {
        const price = defaultPriceFromRow(row);
        byKey.set(defaultPriceKey(price), price);
      }
      return { defaults: [...byKey.values()], priceBook: (priceBook.data ?? []).map(priceBookEntryFromRow) };
    },

    async getMarketSettings(region: string): Promise<MarketSettings> {
      const { data, error, status } = await client
        .from("market_settings")
        .select("*")
        .eq("company_id", companyId)
        .eq("region", region)
        .maybeSingle();
      if (error) throw failed({ error, status }, "load the market settings");
      if (!data) return { ...structuredClone(DEFAULT_MARKET_SETTINGS), region };
      return marketSettingsFromRow(data);
    },

    async getCompanySettings(): Promise<CompanySettings> {
      const { data, error, status } = await client
        .from("company_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw failed({ error, status }, "load your settings");
      if (!data) return { rules: structuredClone(DEFAULT_RULES), contingencyPct: 0.05 };
      return companySettingsFromRow(data);
    },
  };
}
