/**
 * The engine's public API: `evaluateDeal`, the deal input schemas and defaults, and the types of
 * everything it takes and returns.
 */
export { evaluateDeal } from "./evaluate";
export type { DealEvaluation, EngineContext } from "./evaluate";

export {
  BidSchema,
  CarrySchema,
  ConstructionLoanSchema,
  DealInputsSchema,
  DEFAULT_RULES,
  DEFAULT_SCENARIO_DEFS,
  LotSchema,
  RulesSchema,
  ScenarioDefSchema,
  ScenarioDefsSchema,
  SellingSchema,
  TimelineSchema,
  UtilitySchema,
  UtilityStatusSchema,
  validateDeal,
} from "./deal";
export type {
  Bid,
  Carry,
  ConstructionLoan,
  DealInputs,
  Lot,
  Rules,
  ScenarioDef,
  ScenarioDefs,
  Selling,
  Timeline,
  Utility,
  UtilityStatus,
} from "./deal";

export { FinishTierSchema, HouseModelSchema } from "./house";
export type { FinishTier, HouseModel, TierArea } from "./house";

export { DEFAULT_MARKET_SETTINGS } from "./market";
export type {
  BasementFinish,
  Comp,
  CompSource,
  CompStatus,
  MarketCondition,
  MarketSettings,
  PriceEstimate,
  ScoredComp,
  Subject,
} from "./market";

export { DEFAULT_QUANTITY_RULES } from "./quantities";
export type { Q, Quantities, QuantityRules } from "./quantities";

export { COST_CODES } from "./costbook";
export type {
  CostBookView,
  CostCode,
  CostCodeId,
  DefaultPrice,
  Division,
  LinePart,
  PriceBookEntry,
  PriceKey,
  ResolvedPrice,
  Unit,
} from "./costbook";

export { formatUsd } from "./money";
export type { Cents } from "./money";

export { fitSeasonalFactors } from "./dom";
export type { DomConfidence, DomEstimate } from "./dom";

export type { ISODate, YearMonth } from "./dates";
export type { MissingItem, Result, ValidationIssue, Warning } from "./result";
export type { Estimate, EstimateContext, EstimateLine, EstimatePart } from "./estimate";
export type { CashFlow, CashFlowTimes, Period, ProFormaInput, Sale, ScenarioInputs } from "./cashflow";
export type { EquityFlow, Metrics } from "./metrics";
export type { Band, GridCell, ScenarioName, ScenarioResult } from "./scenarios";
export type { RuleCheck, Verdict, VerdictKind } from "./verdict";
export type { Adjustment, LeverResult } from "./goalseek";
