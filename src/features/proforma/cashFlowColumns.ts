import type { Period } from "@engine";

/** The month by month table's columns after the month. */
export const CASH_FLOW_COLUMNS = [
  "Spend",
  "Loan draw",
  "Interest",
  "Carry",
  "Equity out",
  "Cumulative equity",
  "Loan balance",
] as const;

/** Property tax, insurance, utilities, staging, upkeep and HOA for the month. */
export const carryOf = (p: Period): number =>
  p.taxCents + p.insuranceCents + p.utilitiesCents + p.stagingCents + p.upkeepCents + p.hoaCents;
