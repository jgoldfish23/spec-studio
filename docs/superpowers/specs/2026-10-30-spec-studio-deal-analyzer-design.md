# Spec Studio — Phase 1: Deal Analyzer

**Design spec** · 2026-10-30 · Status: draft for owner review
**Working name:** Spec Studio (placeholder — rename anytime)
**Clickable mockups:** https://claude.ai/artifact/BEyzHAt6pkEwATMJXSB1ek

---

## 1. Purpose

A web app for designing, pricing, and evaluating spec homes. Phase 1 answers one question fast and honestly:

> "If I buy **this lot** and build **this house**, do I make money — and how long will it sit before it sells?"

### Success criteria

1. For a real lot, the owner goes from nothing to a **Go / Marginal / No-go verdict** in about 30 minutes.
2. Every number shows where it came from (bid, price book, default, comp) and how confident it is.
3. The numbers are solid enough to show a lender (exportable lender package).
4. Changing anything (finish tier, lot price, days on market) updates profit and verdict instantly.
5. The engine's math is verified against a hand-built spreadsheet of the same deal.

## 2. Context and decisions

Captured from the brainstorming session.

**What the owner said**

| Topic | Decision |
|---|---|
| Who it's for | The owner's own spec builds first; structured so it could be sold to other builders later |
| Owner's experience | Construction-adjacent; no spec build yet → needs believable regional defaults that get replaced by real bids over time |
| Design ambition | 2D floor-plan sketcher, 3D walkthrough with finish swaps, plan library with options. **No** permit-ready drawings (export to a drafter instead) |
| Market | Davis and Weber counties (Northern Wasatch Front), Utah |
| Price band | $750K–$2M |
| First real use | Sizing up a specific lot → go/no-go |
| Financing | Any mix of construction loan + cash; investor splits later |
| Comp data | Public sources for now (manual entry, spreadsheet import); MLS exports later |
| Extras in house model | ADUs (basement or detached) and pools |
| Go/no-go thresholds | Editable defaults |
| Build approach | "Numbers first, then the drafting table" (phased; see §3) |

**Assumptions the owner approved**

- Web app (browser on laptop/iPad; phone-friendly later). No install.
- Single user at first; every record is scoped to a company so multi-company later needs no rewrite.
- ~30 standard residential cost codes.
- Pro forma is a month-by-month cash flow, not a static sheet.
- Days on market is an explainable range with a confidence level, not a black-box number.

## 3. Scope

### In scope — Phase 1 (this spec)

- Deals list and the five-step deal flow: **Lot → House → Estimate → Market → Pro forma**
- House model (described by form, or typed in from a stock plan / drafter PDF)
- Quantity takeoff from the house model
- Cost book: regional defaults → owner's price book → per-deal bids (with PDF attachments)
- Estimate with source badges, confidence, and "get bids here next"
- Comps library (form entry + CSV import with column mapping), comp selection, sale-price and days-on-market estimates
- Monthly cash-flow pro forma with construction loan, carry, selling costs
- Scenarios (downside / base / upside), sensitivity grid, verdict, "what would make it a Go"
- Go/no-go rules and market settings (editable)
- Lender package (print-ready page → Save as PDF)
- Login, company-scoped data, deploy

### Out of scope — later phases

| Phase | Adds |
|---|---|
| 2 | 2D floor-plan sketcher that produces the same house model with real geometry |
| 3 | 3D walkthrough with finish swaps; plan library with options (flip, bonus room, 3rd bay, finished basement) |
| 4 | Construction cost tracking: budget vs. actual, lender draws, change orders; actuals feed future estimates |
| Later | Investor waterfalls, live MLS feed, multiple users/billing, native mobile app, in-app AI assistant |

Never in scope: permit-ready construction documents.

## 4. Architecture

```
┌──────────────────────── Browser (React + TypeScript) ────────────────────────┐
│                                                                              │
│  Screens (Deals, Lot, House, Estimate, Market, Pro forma, Cost book, Comps)  │
│        │ user edits                         ▲ results                        │
│        ▼                                    │                                │
│  ┌──────────────────────── ENGINE (pure TypeScript) ──────────────────────┐ │
│  │ HouseModel → Quantities → Estimate ─┐                                   │ │
│  │ Comps + MarketSettings → MarketEstimate ─┼→ CashFlow → Metrics → Verdict│ │
│  │ Lot + Financing + Selling + Timeline ─┘        ↘ Scenarios, Grid, GoalSeek│ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│        │ save / load                                                         │
└────────┼─────────────────────────────────────────────────────────────────────┘
         ▼
   Supabase: Postgres (row-level security by company) · Auth · Storage (bid PDFs)
   Hosting: Cloudflare (static site)
```

### Stack

| Piece | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| UI | React, Vite, React Router, Tailwind CSS |
| Data fetching | TanStack Query |
| Validation | Zod schemas, shared by UI, engine inputs, and persistence |
| Database / auth / files | Supabase (Postgres, email magic-link login, Storage) |
| Hosting | Cloudflare (owner's existing account) |
| Unit + property tests | Vitest + fast-check |
| End-to-end tests | Playwright |

### Code layout

One app, not a multi-package monorepo:

```
spec-studio/
  src/
    engine/        ← pure functions; no React, no Supabase, no browser APIs
      money.ts, house.ts, quantities.ts, costbook.ts, estimate.ts,
      market.ts, cashflow.ts, metrics.ts, scenarios.ts, verdict.ts, goalseek.ts
    data/          ← Supabase client, queries, Zod ↔ row mapping
    features/      ← screens: deals/, lot/, house/, estimate/, market/, proforma/, costbook/, comps/, settings/
    ui/            ← shared components
  supabase/migrations/
  tests/e2e/
  docs/
```

A lint rule forbids `src/engine/**` from importing anything outside `src/engine/`.

## 5. Engine

### 5.1 Conventions

- **Money:** integer cents (`number`, safe to ±$90 trillion). Never floating dollars. Display rounds to whole dollars.
- **Rates and percentages:** decimals (`0.09` = 9%). Basis-point precision on input.
- **Rounding:** happens only at defined points — quantity rules round as stated in §5.3; money rounds half-up to the cent per line; totals are sums of rounded lines.
- **Time:** the pro forma runs in **monthly periods**. Month 0 is the land-close month. Days convert to months at 365/12 = 30.4167 days per month. A partial final month is prorated.
- **Purity:** every engine function is deterministic — same input, same output. No dates read from the clock inside the engine; "today" is passed in.
- **Incomplete input:** functions return `{ status: "incomplete", missing: [...] }` instead of guessing. Missing data is never treated as zero.

### 5.2 House model

Stored as a versioned JSON document (`schemaVersion: 1`). Phase 2 extends it with geometry; old documents are upgraded by migration functions.

```ts
type FinishTier = "standard" | "upgraded" | "luxury";

interface HouseModel {
  schemaVersion: 1;
  source: "described" | "stockPlan";       // Phase 3 adds "library"; Phase 2 adds "drawn"
  stockPlanRef?: string;                    // plan name / drafter PDF reference
  style: "rambler" | "twoStory" | "multiLevel";
  levels: {
    main:     { finishedSf: number; unfinishedSf: number; ceilingFt: number };
    upper?:   { finishedSf: number; unfinishedSf: number; ceilingFt: number };
    basement?: { totalSf: number; finishedSf: number; walkout: boolean };
  };
  footprint: { widthFt: number; depthFt: number; complexity: "simple" | "moderate" | "complex" };
  garage: { bays: number; tandem: boolean; rvBay: boolean };
  roof: { style: "gable" | "hip" | "mixed"; pitchPer12: number };
  rooms: { bedrooms: number; fullBaths: number; halfBaths: number; fireplaces: number };
  exterior: { stonePct: number; stuccoPct: number; boardBattenPct: number; fiberCementPct: number }; // sums to 100
  finishes: {
    houseTier: FinishTier;
    overrides: { kitchen?: FinishTier; primaryBath?: FinishTier; basement?: FinishTier };
  };
  adu: { type: "none" | "basement" | "detached"; finishedSf?: number };
  pool: { type: "none" | "fiberglass" | "gunite"; spa: boolean; heated: boolean };
  outside: { coveredPatioSf: number; flatworkSf: number; fenceLf: number; landscapingTier: FinishTier };
}
```

**Validation (blocking):** finished ≤ total at every level; basement finished ≤ basement total; exterior percentages sum to 100; footprint area ≥ 50% of main level total; all counts ≥ 0; basement ADU requires a basement.

### 5.3 Quantities (takeoff)

`computeQuantities(house, lot) → Quantities`. Coefficients live in a `QuantityRules` config (editable in Settings later); the values below are the starting defaults.

| Quantity | Rule (defaults) | Rounding |
|---|---|---|
| finishedSf | main.fin + upper.fin + basement.fin | — |
| conditionedSf | main total + upper total + basement total (garage excluded) | — |
| perimeterLf | 2 × (width + depth) | — |
| foundationLf | perimeterLf × complexity (simple 1.00, moderate 1.125, complex 1.25) | nearest LF |
| garageSf | 256 × bays + (rvBay ? 480 : 0) | — |
| excavationYd3 | basement ? basement.totalSf × 10.8 / 27 : width × depth × 3 / 27 | nearest yd³ |
| roofSquares | (width × depth + garageSf) × 1.12 overhang × √(1 + (pitch/12)²) × style (gable 1.00, hip 1.08, mixed 1.12) / 100 | nearest square |
| exteriorWallNetSf | [foundationLf × (main.ceilingFt + 1) + (upper ? foundationLf × (upper.ceilingFt + 1) : 0) + (12 × bays + 24) × 10] × (1 − 0.12 openings) | nearest sf |
| claddingSf by type | exteriorWallNetSf × each exterior % | nearest sf |
| windowCount | (main total + upper total) / 100 + ceil(basement.finishedSf / 400) | nearest whole |
| insulatedEnvelopeSf | exteriorWallNetSf computed without the garage term + top-floor footprint (width × depth) | nearest sf |
| drywallSf | finishedSf × 3.6 + garageSf × 2.2 | nearest sf |
| paintSf | = drywallSf | — |
| plumbingFixtures | 4 × fullBaths + 2 × halfBaths + 3 kitchen + 2 laundry + 2 hose bibs + 1 water heater (+ 6 for a basement or detached ADU) | — |
| hvacTons | conditionedSf / 900, rounded up to nearest 0.5 | 0.5 ton |
| cabinetLf (by area) | kitchen: 25 / 30 / 36 by kitchen tier; vanities: 5 per full bath, 3 per half; laundry 6; ADU kitchen 12 | — |
| flooringSf (by area) | above-grade finished: hard-surface share 45% / 60% / 70% by tier, rest carpet; basement finished: 30% hard / 70% carpet; tile: 60 per full bath + 25 per half + 60 laundry | nearest sf |
| garageDoors | 1 double if bays ≤ 2; 1 double + 1 single if bays = 3; +1 single per extra bay; +1 RV door | — |
| utilityConnections | count of lot utilities marked "needs connection" | — |
| buildMonths | from timeline | — |

Each quantity carries a short `explain` string (e.g., "190 LF perimeter × 1.125 moderate complexity") for the UI.

Phase 2 replaces these estimates with measured geometry; the `Quantities` type does not change.

### 5.4 Cost book and estimate

**Cost codes** (29 codes; codes 26–29 appear only when used):

| # | Code | Division | Quantity basis | Typical pricing |
|---|---|---|---|---|
| 1 | Plans & engineering | Soft | — | Lump sum |
| 2 | Permits & impact fees | Soft | — | Lump sum (city schedule) |
| 3 | Survey & soils report | Soft | — | Lump sum |
| 4 | Excavation & grading | Site | excavationYd3 | $/yd³ |
| 5 | Utility connections | Site | utilityConnections | $/ea |
| 6 | Foundation & waterproofing | Structure | foundationLf | $/LF |
| 7 | Framing | Structure | main total + upper total + basement finished + garageSf | $/sf |
| 8 | Roofing | Structure | roofSquares | $/square |
| 9 | Windows & exterior doors | Envelope | windowCount | $/window by tier |
| 10 | Exterior cladding | Envelope | claddingSf by type | $/sf per cladding type |
| 11 | Insulation | Envelope | insulatedEnvelopeSf | $/sf |
| 12 | Plumbing | MEP | plumbingFixtures | $/fixture |
| 13 | Electrical | MEP | conditionedSf | $/sf by tier |
| 14 | HVAC | MEP | hvacTons | $/ton |
| 15 | Drywall | Interior | drywallSf | $/sf |
| 16 | Interior trim & doors | Interior | finishedSf, split above-grade / basement | $/sf by area tier |
| 17 | Cabinets & countertops | Interior | cabinetLf by area | $/LF by area tier |
| 18 | Flooring | Interior | flooringSf by type and area | $/sf by type and tier |
| 19 | Paint | Interior | paintSf | $/sf |
| 20 | Fixtures & appliances | Interior | kitchen + baths | Allowance by area tier |
| 21 | Garage doors | Exterior finish | garageDoors | $/door |
| 22 | Concrete flatwork | Exterior finish | flatworkSf | $/sf |
| 23 | Landscaping & fencing | Exterior finish | lot sf − footprint; fenceLf | Allowance by tier + $/LF |
| 24 | Final cleaning | General | finishedSf | $/sf |
| 25 | Supervision & overhead | General | buildMonths | $/month |
| 26 | Fireplaces | Interior | rooms.fireplaces | $/ea by tier |
| 27 | ADU package | Interior | adu | Lump by type: 2nd kitchen, separate entrance/egress, fire separation, optional separate meter and HVAC |
| 28 | Pool & spa | Exterior finish | pool | Lump by type + spa/heat add-ons + safety cover and fencing |
| 29 | Covered patio / deck | Exterior finish | coveredPatioSf | $/sf |
| — | Contingency | — | % of subtotal (default 5%) | — |

**Tiered pricing by area.** Lines marked "by area tier" split their quantity by area (kitchen, primary bath, basement, rest of house) and price each part at that area's tier (`overrides[area] ?? houseTier`).

**Price resolution — the most specific source wins, per line:**

1. **Bid for this deal** — replaces the whole line total (quantity still shown for reference). Has vendor, date, optional PDF.
2. **Owner's price book** — unit price (per code, per tier where relevant), vendor, as-of date.
3. **Regional default** — unit price for (region, code, tier), as-of date, `verified` flag, source note.

If no source exists for a needed line, the estimate is `incomplete` with that line listed.

**Estimate output:** lines (code, quantity, unit, unit price, total, source, as-of), division subtotals, subtotal, contingency, total, cost per finished sf, and:

- **Confidence:** share of subtotal from bids / price book / defaults.
- **Get bids here next:** the four largest default-priced lines, plus how much the default share would drop if they were bid.
- **Stale flags:** any price older than 12 months.

**Starter cost book.** The first regional defaults (region `utah-north`) are starter values marked `verified: false` and shown under a "Starter defaults — unverified" banner. A dedicated milestone (M7) researches each default against public sources and records the source note. The mockup's sample unit prices are illustrative only.

### 5.5 Market model

**Comp record:** address, city, county, region, status (sold / active / pending), list date, list price, original list price, price-cut count, contract (pending) date (optional), sold date, sold price, above-grade finished sf, basement finished sf, unfinished sf, beds, baths, year built, new-construction flag, lot acres, garage bays, basement finish, walkout, ADU, pool, source (`manual` | `csv` | `claudeFile` | `ownSale`), verified flag, notes.

**Comp days on market** means days to **contract**, to match the pro forma (which adds closing days separately):
- With a contract date: contract date − list date.
- Without one: sold date − list date − `assumedClosingDays` (market setting, default 35).
- Sold comps only. Comps missing a list date, or whose dates are out of order, are skipped for DOM but still count for price.

**Similarity score (0–100)** between subject and comp — weights are editable defaults:

| Factor | Weight | Score |
|---|---|---|
| Location | 25 | same city 1.0 · same county 0.7 · same region 0.4 |
| Size | 25 | max(0, 1 − abs(Δ effective sf) / (0.3 × subject effective sf)) |
| Age | 15 | comp sold ≤ 3 years after it was built 1.0 · otherwise 0.5 |
| Recency | 20 | sold ≤ 6 months ago 1.0 · ≤ 12 months 0.7 · older 0.4 |
| Features | 15 | share of matches among garage bays, basement finish, walkout, ADU, pool |

Comps scoring ≥ 75 are included by default; the owner can include or exclude any comp per deal.

**Weighted percentile** (used below): sort values ascending, accumulate similarity weights, and take the first value whose cumulative weight ≥ p × total weight.

**Effective sf** = above-grade finished sf + basement finished sf × `basementFactor` (default 0.60).

**Sale price estimate:**

1. Adjust each included comp toward the subject: `adjusted = soldPrice + Σ (subject feature − comp feature) × featureValue`. Starting feature values (editable): garage bay $12,000; walkout $9,000; lot size $60,000 per acre; ADU $35,000; pool $25,000.
2. Implied subject value per comp = (adjusted / comp effective sf) × subject effective sf.
3. **Low / mid / high** = similarity-weighted 25th / 50th / 75th percentile of implied values.

**Days-on-market estimate:**

1. De-seasonalize each comp: `domAdj = dom / seasonal[listMonth(comp)]`.
2. Typical = similarity-weighted median of `domAdj`; low / high = weighted 25th / 75th percentile.
3. Multiply all three by:
   - `seasonal[subject list month]`
   - price position: `1 + elasticity × max(0, subjectListPrice / mid − 1)` (default elasticity 3.0 → 1% over mid ≈ +3% days). `subjectListPrice` is the owner's planned list price when set, otherwise mid (factor = 1).
   - market condition: hot 0.85 · normal 1.00 · slow 1.20 (owner-set; default normal)
4. Round to whole days.

**Seasonal factors.** A starting 12-month curve (editable; ~1.2 in Dec–Jan down to ~0.9 in Apr–May), labelled "starting guess." Once a region has ≥ 24 sold comps spanning ≥ 9 list months, the app offers a fitted curve (monthly median DOM ÷ overall median, smoothed with a 3-month moving average).

**Confidence:**
- **High:** ≥ 10 included comps and ≥ 5 sold in the last 6 months
- **Medium:** ≥ 5 included comps
- **Low:** fewer than 5

With zero included sold comps the market estimate is `incomplete`.

**Explain list:** every factor applied (comps median, season, price position, market condition) with its effect, for the "What drove it" panel.

**Owner's own sales** are added to comps automatically (source `ownSale`) when a deal is marked sold.

### 5.6 Pro forma (monthly cash flow)

**Inputs**

- **Lot:** price, closing costs, paid by cash or land loan (LTV, rate, points). A land loan stays outstanding until sale close, accrues monthly interest paid from equity, charges points at month 0, and is repaid from sale proceeds before equity. It does not count toward the construction loan.
- **Timeline:** land close date (calendar month — sets the list month used by the market model), pre-construction months, build months, list timing (at completion, or N months before completion), closing days after contract (default 35)
- **Construction loan:** loan-to-cost on the build estimate (default 80%), rate, points, draw/inspection fee per draw, term in months from loan close (= build start), extension fee % and extension length (default 0.5% per 3 months), interest paid monthly in cash (default) or capitalized
- **Carry:** property tax rate (annual, default per region, editable), builder's risk insurance (annual % of build estimate), utilities $/month during build and after completion, staging $/month while listed, upkeep (snow/lawn) $/month after completion, HOA $/month
- **Selling:** listing commission %, buyer-agent commission %, closing & title %, concessions/rate buydown $
- **From other steps:** build estimate (by line), sale price, days on market

**Timeline in months**

- Land close = month 0; build start = `preConMonths`; completion = build start + `buildMonths`; list = completion − `listEarlyMonths`
- Contract = list + DOM; sale close = contract + closing days (fractional months allowed)
- Loan maturity = build start + `termMonths`

**Spending schedule**

- Land + closing costs: month 0.
- Soft-cost lines (codes 1–3): first pre-construction month (month 0 if no pre-construction).
- All other lines + contingency are drawn over build months by a default S-curve: weight for build month *i* (0-based) = sin(π × (i + 0.5) / buildMonths), normalized to 100%.
- Downside overrun % scales the drawn amounts.

**Funding order (equity first)**

- Loan commitment = LTC × build estimate (before overrun).
- Equity always pays the land (or the land-loan shortfall), land closing costs, and loan points.
- Build-equity requirement = build estimate − loan commitment. Equity pays build draws until cumulative build spend reaches that requirement; after that the loan funds draws up to the commitment.
- Overruns beyond the commitment are paid with equity.
- Interest each month = loan balance at start of month × rate / 12, prorated in the final partial month. Paid from equity (default) or added to the balance (capitalized).
- Loan points are paid at loan close; draw fees at each draw.

**Extensions.** If sale close > maturity, `extensions = ceil((saleClose − maturity) / extensionMonths)` and each costs `extension% × commitment`, paid at the maturity date and every extension after.

**Carry by month**

- Property tax = rate × (land cost + cumulative build spend) / 12
- Insurance from build start to sale close
- Utilities by phase; staging while listed; upkeep after completion; HOA throughout

**Sale.** Price − commissions − closing & title − concessions = net proceeds. Net proceeds repay the loan balance; the remainder returns to equity at sale close.

**Metrics**

| Metric | Definition |
|---|---|
| totalProjectCost | land + land closing + build spent (incl. contingency, overrun) + financing (points, interest, draw fees, extension fees) + carry |
| sellingCosts | commissions + closing & title + concessions |
| profit | price − sellingCosts − totalProjectCost |
| marginOnSale | profit / price |
| marginOnCost | profit / totalProjectCost |
| peakCash | max cumulative equity outflow before sale proceeds |
| returnOnCash | profit / peakCash |
| annualizedReturn | monthly IRR of equity cash flows (bisection solver), (1 + r)^12 − 1 |
| breakEvenSalePrice | (totalProjectCost + concessions) / (1 − commission% − closing%) |
| monthlyBurnWhileListed | interest on the full balance + carry items active while listed |
| maxDomWithoutExtension | (maturity − list) × 30.4167 − closing days, floored at 0 |
| breakEvenDomDays | smallest whole-day DOM where profit ≤ 0, holding price; found by bisection over 0–1,095 days (profit is monotonic in DOM); "over 3 years" if never |
| monthsLandToClose | sale close − month 0 |

The cash flow table (month by month: spend, equity, draws, balance, interest, carry, cumulative equity) is part of the output and shown in an expandable panel and in the lender package.

### 5.7 Scenarios and sensitivity

| Scenario | Price | DOM | Build overrun |
|---|---|---|---|
| Downside | market low | DOM high | +5% |
| Base | market mid | DOM typical | 0% |
| Upside | market high | DOM low | 0% |

The scenario definitions are editable per deal. The owner can override the base price (e.g., a planned list price) and/or the base DOM; low and high then shift by the same percentages the market model produced around its own mid/typical values.

**Sensitivity grid:** profit for sale price at +5%, 0, −5%, −10%, −15% of base × DOM at 30, 60, 90, 120, 180 days, all else at base. Cells are bucketed into color bands (loss, $0–50K, $50–100K, $100–150K, $150–200K, $200K+). The base cell is outlined.

### 5.8 Verdict and goal seek

**Rules** (company defaults, copied into each deal at evaluation):

- `minMarginOnSale` (default 15%)
- `minAnnualizedReturn` (default 25%)
- `minDownsideProfit` (default $0)

**Verdict**

- **Incomplete** — required inputs missing (lists what's needed)
- **No-go** — base profit ≤ 0, or the downside rule fails, or two or more rules fail
- **Marginal** — base profit > 0 and exactly one rule fails, and it isn't the downside rule
- **Go** — all rules pass

Reasons list every rule with pass/fail and the actual value. A **loan warning** is added when base DOM > `maxDomWithoutExtension`.

**What would make it a Go.** For each lever — lot price, base sale price, build cost — find by bisection the value where all rules pass, holding the other levers fixed. The engine is monotonic in each lever. Output the value and change from current. If a lever can't get there within bounds (lot ≥ $0; price ≤ +50%; build ≥ −50%), say "not reachable with this lever alone." Goal seek runs only when the verdict isn't Go.

**Snapshots.** Each evaluation stores the inputs hash, the cost-book prices used, the rules used, and the result. Reopening a deal shows the saved verdict. "Re-run with today's numbers" shows a before/after diff.

### 5.9 Engine API

```ts
computeQuantities(house: HouseModel, lot: Lot, rules: QuantityRules): Result<Quantities>
buildEstimate(q: Quantities, house: HouseModel, book: CostBookView, bids: Bid[], ctx: { region: string; contingencyPct: number; buildMonths: number; today: ISODate }): Result<Estimate>
estimateMarket(subject: Subject, comps: Comp[], settings: MarketSettings, listMonth: number, today: ISODate): Result<MarketEstimate>
runCashFlow(input: ProFormaInput): Result<CashFlow>
computeMetrics(cf: CashFlow, input: ProFormaInput): Metrics
runScenarios(deal: DealInputs, ctx: EngineContext): Result<ScenarioResults>
sensitivityGrid(deal: DealInputs, ctx: EngineContext): Result<Grid>
evaluateVerdict(results: ScenarioResults, rules: Rules): Verdict
goalSeek(deal: DealInputs, ctx: EngineContext, rules: Rules): GoalSeekResult
evaluateDeal(deal: DealInputs, ctx: EngineContext): DealEvaluation   // runs everything above
```

`Result<T> = { status: "ok"; value: T; warnings: Warning[] } | { status: "incomplete"; missing: MissingItem[] }`.

`evaluateDeal` must finish in < 50 ms for a typical deal on a mid-range laptop, so the UI can recompute on every edit (debounced 150 ms).

## 6. App

### 6.1 Screens

As in the mockups, with the adjustments listed below.

1. **Deals** — table of deals: verdict chip (icon + text, never color alone), profit, margin, annualized return, DOM range, last updated. Cards for go/no-go rules, cost book confidence, comps library. "New deal" button.
2. **Lot** — address, parcel ID, size, frontage, zoning (text), slope, utilities (each: available / needs connection / unknown), price, closing costs, cash or land loan, permits/fees (from cost book), property tax rate, HOA, soils report status, timeline inputs. Side panel: land totals, share of project cost and of sale price, and the lot price that makes it a Go.
3. **House** — the §5.2 form, grouped as in the mockup. Side panel: build estimate, cost per sf, change vs. previous value, live takeoff with explanations.
4. **Estimate** — summary, confidence bar, get-bids-next list, cost lines grouped by division with source badges and actions (add bid, view bid, edit), filter "defaults only", add custom line, contingency %.
5. **Market** — sale price low/mid/high with adjustment breakdown, DOM range with confidence and "what drove it", comps table with match score, source, include/exclude, plus add comp, import CSV, import file.
6. **Pro forma** — verdict panel, what-would-make-it-a-Go panel, scenario tabs (waterfall + metrics), timeline bar with loan maturity marker, sensitivity grid, financing/selling/monthly-burn cards, expandable monthly cash-flow table, lender package button.
7. **Cost book** — cost codes; regional defaults (with as-of, verified, source note); price book entries; stale flags.
8. **Comps library** — all comps, filters, CSV import with saved column mappings, verify toggle.
9. **Settings** — go/no-go rules, market settings per region (seasonal curve, basement factor, feature values, elasticity, market condition, default tax rate), quantity rule coefficients (read-only in Phase 1; editable later).

**Changes from the mockups:**

- Lot screen: the property tax rate label becomes "Davis County default · verify" (the app can't call the Zillow connector). The embedded parcel map becomes an "Open in maps" link (no map provider in Phase 1).
- Market screen: "Pull facts with Claude" becomes **"Import file"**. In a Claude session, Claude can research comps and lot facts (including via the Zillow connector) and produce a CSV/JSON file in the app's import format, which the owner imports and verifies.
- Mockup dollar figures were hand-approximated. The engine will compute slightly different values for the same inputs.

**Every deal screen** shows the header with verdict chip, the live summary strip (sale price, total cost, profit, margin, DOM range), and step tabs. Steps can be visited in any order.

### 6.2 Recompute and autosave

- Edits update local deal state → debounced `evaluateDeal` → UI re-renders. No server round-trip for math.
- Autosave to Supabase 1 s after the last edit. A "Saved / Saving / Not saved — retrying" indicator. On connection loss, edits stay in local storage and sync when back.
- Undo/redo per deal for the current session.

### 6.3 Lender package

A print-optimized route (`/deals/:id/print`): deal summary, verdict and rules, base/downside/upside table, estimate by division with sources, market estimate with comps used, timeline, monthly cash flow, assumptions. The owner uses the browser's "Save as PDF." No PDF library in Phase 1.

### 6.4 Import formats

- **Comps CSV:** any column layout; a mapping screen matches columns to comp fields, previews 5 rows, validates, and saves the mapping by name for reuse (e.g., "Realtor MLS export").
- **Claude file (JSON):** a documented schema (`spec-studio-import/v1`) carrying comps and/or lot facts. Imported rows are `verified: false` until confirmed.

## 7. Data and persistence

**Tables** (all with `id`, `company_id`, `created_at`, `updated_at`):

| Table | Holds |
|---|---|
| companies | name, default region |
| memberships | user ↔ company, role (`owner` for now) |
| deals | name, region, status (`analyzing` / `bought` / `building` / `listed` / `sold` / `dropped`), and JSONB documents: `lot`, `house`, `timeline`, `financing`, `selling`, `scenarioDefs`, `rules`, `estimateOverrides` (custom lines, contingency) — each with `schemaVersion` |
| deal_comp_selections | deal ↔ comp, included flag (overrides the score default) |
| evaluation_snapshots | deal, computed_at, inputs_hash, prices_used JSONB, rules JSONB, result JSONB |
| cost_codes | the 29 codes (global rows have null `company_id`) |
| default_prices | region, cost code, tier, area, unit, unit price (cents), as_of, verified, source_note |
| price_book_entries | cost code, tier, unit, unit price, vendor, as_of, notes |
| bids | deal, cost code, amount (cents), vendor, received_on, file path, notes |
| comps | the §5.5 comp record |
| csv_mappings | name, column → field map |
| market_settings | region, seasonal factors, basement factor, feature values, elasticity, market condition, default tax rate |
| company_settings | go/no-go rule defaults, contingency default |

**Rules**

- **Row-level security:** every table is readable and writable only by members of the row's company. Global rows (null `company_id`) are read-only for everyone.
- **Files:** a Supabase Storage bucket per company for bid PDFs, with the path stored on the bid.
- **JSON documents** are validated with Zod on read and write; `schemaVersion` mismatches run migration functions.
- **Backups:** a weekly "Export all data" (JSON download) button in Settings, in addition to Supabase's own backups.

## 8. Error handling and validation

| Situation | Behavior |
|---|---|
| Missing required input | Engine returns `incomplete`; verdict chip shows "Needs: …" linking to the step |
| Impossible input (§5.2 rules, negative money, % > 100) | Blocked at the field with a message; deal still saves as a draft |
| Suspicious input | Warning (not blocking): build $/sf outside 0.6×–1.6× the region's typical; lot > 40% of sale price; DOM > 365; comps older than 12 months; contingency < 3% |
| Auto-filled or imported data | Marked "verify" until the owner confirms |
| Stale prices | Lines with as-of > 12 months flagged; estimate shows a count |
| Save failure | "Not saved — retrying" banner; local copy kept; never silently drops edits |
| Bad CSV rows | Preview shows row-level errors; good rows import, bad rows are listed for download |
| Engine exception (bug) | Caught at the screen boundary; shows "Couldn't calculate — details" with input hash; data unaffected |

## 9. Testing

**Engine (test-first, Vitest):**

- Unit tests per module with hand-calculated expectations, including every rule in §5.3 and §5.6.
- **Golden deal:** the mockup's sample deal inputs:
  - Lot: Kaysville, $295,000 + $4,000 closing, cash; land closes June 2027
  - Timeline: 2-month pre-con, 9-month build, list at completion, 35-day close
  - Estimate: the 25 estimate lines from the mockup, entered as bids (fixed line totals), + 5% contingency
  - Loan: 80% LTC, 9%, 1 point, $200/draw, 12-month term, 0.5% per 3-month extension, interest paid monthly
  - Carry: tax 0.48%/yr; builder's risk 0.35%/yr of build estimate; utilities $150/mo during build and $250/mo after completion; staging $500/mo while listed; upkeep $100/mo after completion; no HOA
  - Selling: 2.5% + 2.5% + 1% + $15,000
  - Base price override $1,350,000; base DOM override 62

  Expected outputs are computed first in a hand-built spreadsheet (`docs/golden-deal.xlsx`) and committed. The engine must match to the cent.
- **Boundary tests:** DOM at `maxDomWithoutExtension` and +1 day; zero pre-con; all-cash (LTC 0); 100% defaults; zero comps; one comp; basement absent; ADU/pool on and off.
- **Property tests (fast-check):** profit never increases as DOM increases; profit never decreases as price increases; estimate total = Σ lines + contingency; cash-flow equity + loan draws = total spend; verdict is never Go when any rule fails.
- **Performance:** `evaluateDeal` on the golden deal < 50 ms.

**App:**

- Component tests for forms and validation messages.
- Playwright end-to-end: sign in → new deal → lot → house → estimate → add a bid → import comps CSV → pro forma shows a verdict → change finish tier → verdict updates → print view renders.
- Row-level security tests: a second test company can't read the first company's rows.

## 10. Milestones (Phase 1)

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo, tooling, CI (lint, typecheck, tests), golden-deal spreadsheet | CI green on an empty app; spreadsheet committed |
| M1 | Engine: money, house model + validation, quantities, cost resolution, estimate | Unit tests pass |
| M2 | Engine: cash flow, metrics, scenarios, grid, verdict, goal seek | Golden deal matches to the cent; property tests pass |
| M3 | Engine: market model | Unit + property tests pass |
| M4 | App shell: Supabase schema + RLS + auth, deals list, deal CRUD, autosave | Can create, save, and reopen a deal |
| M5 | Deal screens wired to engine: Lot, House, Estimate, Market, Pro forma | E2E core flow passes |
| M6 | Cost book, comps library, CSV import, Claude-file import, bid PDFs, settings | Import and bid flows pass E2E |
| M7 | Lender package, starter cost book research (sources recorded), deploy to Cloudflare | Live URL; owner runs a real lot through it |

## 11. Risks and open items

- **Default cost accuracy.** Starter defaults are approximate until researched (M7) and replaced by bids. Mitigation: unverified banner, confidence bar, get-bids-next list.
- **Comp data quality.** Public data lacks reliable list dates; DOM confidence will often be Low or Medium until MLS exports are available. Mitigation: confidence shown everywhere; CSV import ready for MLS exports.
- **Seasonality and elasticity defaults are guesses** until enough comps exist to fit them; labelled as such.
- **Property tax modeling is simplified** (rate × cost basis); real Utah assessment timing differs. Labelled "estimate."
- **Not advice.** The app is decision support, not an appraisal, legal, or lending determination; the lender package says so.
- **Code hosting.** The repository needs a home on GitHub so work survives this cloud session; creating it is the first step of M0.

## 12. Glossary

- **Spec home** — built without a buyer lined up, to sell on completion.
- **Takeoff** — the list of material quantities measured from a plan.
- **LTC (loan-to-cost)** — the share of build cost the lender funds.
- **Draw** — a loan disbursement as construction progresses.
- **DOM (days on market)** — days from listing to accepted contract.
- **Comps** — comparable recently sold homes.
- **IRR** — the annualized return that accounts for when money goes in and comes out.
- **Carry** — costs of holding the property (interest, tax, insurance, utilities) until sale.
