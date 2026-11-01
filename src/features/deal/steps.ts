/** The five steps of a deal, in order. Each is a route under `/deals/:dealId/`. */
export const STEPS = [
  { path: "lot", title: "Lot" },
  { path: "house", title: "House" },
  { path: "estimate", title: "Estimate" },
  { path: "market", title: "Market" },
  { path: "proforma", title: "Pro forma" },
] as const;

export type StepId = (typeof STEPS)[number]["path"];
