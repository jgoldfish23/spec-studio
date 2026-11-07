import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNED_OUT } from "../messages";
import { DataError } from "../types";
import { toDataError } from "../supabase/errors";
import { ALREADY_HAS_COMPANY } from "./companyGateway";
import type { CompanyGateway } from "./companyGateway";

const BAD_NAME = "Enter a company name of 120 characters or fewer.";

interface MembershipRow {
  company_id: string;
  companies: { id: string; name: string; default_region: string } | null;
}

export function createSupabaseCompany(client: SupabaseClient): CompanyGateway {
  async function myCompany() {
    const { data, error, status } = await client
      .from("memberships")
      .select("company_id,companies(id,name,default_region)")
      .limit(1)
      // A failed read would otherwise retry for several seconds before the app can say it is offline.
      .retry(false);
    if (error) throw toDataError(error, "load your company", undefined, status);
    const rows = (data ?? []) as unknown as MembershipRow[];
    if (rows.length > 1)
      console.error(
        `Expected one company membership, found ${rows.length}; using the first.`,
      );
    const company = rows[0]?.companies;
    return company
      ? {
          id: company.id,
          name: company.name,
          defaultRegion: company.default_region,
        }
      : null;
  }

  return {
    myCompany,
    async createCompany(name, settings) {
      const { error, status } = await client.rpc("create_company", {
        p_name: name,
        p_rules: settings.rules,
        p_contingency_pct: settings.contingencyPct,
      });
      if (error) {
        if (error.code === "SS001")
          throw new DataError(SIGNED_OUT, {
            kind: "signedOut",
            cause: error,
          });
        if (error.code === "SS002")
          throw new DataError(ALREADY_HAS_COMPANY, {
            kind: "failed",
            cause: error,
          });
        if (error.code === "SS003")
          throw new DataError(BAD_NAME, { kind: "failed", cause: error });
        throw toDataError(error, "create your company", undefined, status);
      }
      const company = await myCompany();
      if (!company)
        throw new DataError(
          "Couldn't find your new company — try again in a minute.",
          { kind: "failed" },
        );
      return company;
    },
  };
}
