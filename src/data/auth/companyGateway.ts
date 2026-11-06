import type { CompanySettings } from "../types";

export type Company = { id: string; name: string; defaultRegion: string };

/** The signed-in owner's company. The hosted build uses Supabase; tests use `createFakeCompanies`. */
export interface CompanyGateway {
  /** The owner's company, or null before sign-up has created one. */
  myCompany(): Promise<Company | null>;
  /** Creates the company with its starting settings. A `DataError` of kind `failed` when the owner already has one or the name is not 1 to 120 characters. */
  createCompany(name: string, settings: CompanySettings): Promise<Company>;
}
