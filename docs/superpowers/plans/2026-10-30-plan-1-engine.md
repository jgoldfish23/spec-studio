# Spec Studio — Plan 1 of 3: Calculation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the pure-TypeScript engine that turns a lot, a house description, a cost book, and comps into an estimate, a market estimate, a monthly cash-flow pro forma, scenarios, a sensitivity grid, a verdict, and goal-seek answers.

**Architecture:** `src/engine/` is a folder of pure, deterministic functions with no UI, database, clock, or randomness. Data flows one way: house → quantities → estimate; comps → price + DOM; lot + timeline + financing + estimate + scenario → cash flow → metrics → verdict. A hand-built spreadsheet of the golden deal is the independent check on the money math.

**Tech Stack:** TypeScript (strict), Node ≥ 22, npm, Zod, Vitest, fast-check, ESLint (typescript-eslint). Python 3 + openpyxl + LibreOffice (headless) for the golden spreadsheet only.

**Spec:** `docs/superpowers/specs/2026-10-30-spec-studio-deal-analyzer-design.md` (§5 is the engine). This plan covers milestones M0–M3. Plan 2 (app shell + deal screens, M4–M5) and Plan 3 (cost book, comps, imports, lender package, deploy, M6–M7) follow and consume this engine's public API.

## Global Constraints

- Money is integer cents (`Cents = number`). Never store or pass floating dollars. Display rounds to whole dollars.
- Rates and percentages are decimals (`0.09` = 9%).
- Rounding is half away from zero, applied only at the points this plan names: per quantity (§5.3 table), per money amount when computed, and totals = sums of rounded parts.
- `src/engine/**` (non-test files) may import only relative paths that stay inside `src/engine/` and the package `zod`. No `Date.now(`, `new Date()` with no arguments, or `Math.random(` in engine non-test files. "Today" is always passed in as an ISO date string.
- Functions that lack required input return `{ status: "incomplete", missing }`. Missing data is never treated as zero.
- `evaluateDeal` on the golden deal: median of 20 runs < 50 ms.
- Days per month: `MONTH_DAYS = 365 / 12`.
- Default region id: `utah-north`.
- Tests are colocated as `*.test.ts`. Every commit leaves `npm run lint`, `npm run typecheck`, and `npm test` green.
- Commit message trailers (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YKDt1SeyzP4DFjvTWhCsHH
  ```

## Review Focus

1. **No usable comps.** Zero comps, one comp, all excluded, or comps missing list dates. Expected: the market result is `incomplete` with code `noComps` / `noDomComps` and never NaN. With base price/DOM overrides the base scenario still runs, with a `noMarketRange` warning. Tests in Tasks 10, 11, 12, 14.
2. **Listing during construction with a fast sale.** The sale cannot close before completion: `saleClose = max(contract + closingDays/MONTH_DAYS, completion)`. Test in Task 8.
3. **All-cash deal (LTC 0) running past the loan term.** Expected: no points, draw fees, interest, or extension fees. Test in Task 8.
4. **Deep-loss deal where sale proceeds don't cover the loan.** Expected: negative profit, `annualizedReturn` is `null` (never NaN/Infinity), verdict No-go, goal seek returns per-lever results without throwing. Tests in Tasks 9, 13, 14.
5. **Very long days on market (400 days).** Expected: multiple extension fees, and profit keeps falling as DOM rises. Golden "stress" scenario in Task 7, checked in Tasks 8 and 9, plus a property test in Task 9.

## Reference: cash-flow algorithm (used by Tasks 7 and 8)

The spreadsheet (Task 7) and `runCashFlow` (Task 8) implement exactly this. All money is rounded to the cent at the point it is computed (`round` = half away from zero).

1. **Times (months, may be fractional):**
   - `buildStart = P` (pre-con months), `completion = P + B`, `list = completion − L`
   - `contract = list + dom / MONTH_DAYS`
   - `saleClose = max(contract + closingDays / MONTH_DAYS, completion)`
   - `maturity = buildStart + termMonths`
   - Periods `k = 0 … N−1`, where `N = ceil(saleClose)`
   - `overlap(k, a, b) = max(0, min(k + 1, b) − max(k, a))`
2. **Overrun:** `softActual = round(soft × (1 + o))`, `hardActual = round(hard × (1 + o))`. `soft` = sum of estimate lines in division `soft`; `hard = estimate.totalCents − soft` (includes contingency); `estimateTotal = estimate.totalCents`.
3. **Spend:**
   - Period 0 spends `softActual`.
   - Build month `i` (0 … B−1) spends at period `P + i`: `draw_i = round(hardActual × w_i)` for `i < B−1`; the last draw is `hardActual − Σ` earlier draws.
   - Weights: `w_i = sin(π (i + 0.5) / B) / Σ_j sin(π (j + 0.5) / B)`.
4. **Funding (equity first):**
   - `commitment = round(ltc × estimateTotal)`; `equityReq = estimateTotal − commitment`.
   - For each period's spend `x` in order, with `S` = cumulative spend before it and `drawn` = loan drawn so far:
     - `eq = min(x, max(0, equityReq − S))`
     - `ln = min(x − eq, commitment − drawn)`
     - `eq += x − eq − ln`
     - then `S += x` and `drawn += ln`
5. **Loan fees:** points `round(points × commitment)` at period `P` (only if commitment > 0). Draw fee `drawFeeCents` in each period where `ln > 0`.
6. **Construction interest, period k:** `round(balanceStart_k × rate / 12 × overlap(k, buildStart, saleClose))`.
   - `balanceStart_k` = Σ `ln` over periods < k, plus capitalized interest over periods < k. Draws land at period end.
   - Mode `paid` → paid by equity. Mode `capitalized` → added to the balance after the period.
7. **Land loan** (if financed):
   - `landLoan = round(ltv × landPrice)`, with points `round(points × landLoan)` at period 0.
   - Interest in period k: `round(landLoan × rate / 12 × overlap(k, 0, saleClose))`, paid by equity.
   - Repaid from sale proceeds.
8. **Extensions** (only if commitment > 0 and `saleClose > maturity`):
   - `n = ceil((saleClose − maturity) / extensionMonths)`, each fee `round(extensionPct × commitment)`.
   - Fee `j` (0 … n−1) is paid at period `floor(maturity + j × extensionMonths)`.
9. **Carry, period k:**
   - `tax = round(taxRate / 12 × (landPrice + S_endOfPeriod_k) × overlap(k, 0, saleClose))`
   - `insurance = round(insuranceRate / 12 × estimateTotal × overlap(k, buildStart, saleClose))`
   - `utilities = round(uBuild × overlap(k, buildStart, completion) + uAfter × overlap(k, completion, saleClose))`
   - `staging = round(staging × overlap(k, list, contract))`
   - `upkeep = round(upkeep × overlap(k, completion, saleClose))`
   - `hoa = round(hoa × overlap(k, 0, saleClose))`
10. **Equity out, period k:** (k = 0: `landPrice − landLoan + landClosing + landPoints`) + `eq` + construction points + draw fee + paid interest + land-loan interest + extension fees + all carry.
11. **Sale** (at `saleClose`, booked on period N−1):
    - `commissions = round(price × (listingPct + buyerPct))`, `closing = round(price × closingPct)`
    - `net = price − commissions − closing − concessions`
    - `payoff = drawn + Σ capitalized interest + landLoan`
    - `equityReturn = net − payoff`
12. **Totals:**
    - `buildSpent = softActual + hardActual`
    - `financing = constructionPoints + landPoints + Σ construction interest (paid + capitalized) + Σ land interest + Σ draw fees + Σ extension fees`
    - `carry = Σ (tax + insurance + utilities + staging + upkeep + hoa)`
    - `totalProjectCost = landPrice + landClosing + buildSpent + financing + carry`
    - `sellingCosts = commissions + closing + concessions`
    - `profit = price − sellingCosts − totalProjectCost`
13. **Peak cash** = max over k of cumulative equity out through period k (sale inflow excluded).
14. **Monthly burn while listed** = `round(balanceAtCompletion × rate / 12) + round(landLoan × landRate / 12) + round(taxRate / 12 × (landPrice + buildSpent)) + round(insuranceRate / 12 × estimateTotal) + uAfter + staging + upkeep + hoa`. `balanceAtCompletion` = loan balance after period `completion − 1`.
15. **`maxDomWithoutExtension`** = `max(0, floor((maturity − list) × MONTH_DAYS − closingDays))`; `null` when commitment = 0.

## File map

```
package.json, tsconfig.json, vitest.config.ts, eslint.config.js, .gitignore
.github/workflows/ci.yml
tests/boundary.ts, tests/engine-boundary.test.ts       engine import/purity guard
scripts/golden/build_golden.py                         golden spreadsheet + expected JSON
docs/golden-deal.xlsx                                   generated, committed
src/engine/
  index.ts          public API re-exports
  money.ts          Cents, rounding, formatting
  dates.ts          ISODate / YearMonth helpers
  result.ts         Result, Warning, MissingItem, ValidationIssue
  house.ts          HouseModel schema + validateHouse + tierFor
  deal.ts           Lot, Timeline, loan, carry, selling, rules, scenarios, Bid, DealInputs + validateDeal
  quantities.ts     takeoff rules
  costbook.ts       cost codes, line parts, price resolution
  estimate.ts       estimate assembly, confidence, bids-next, staleness
  cashflow.ts       ProFormaInput + monthly schedule
  metrics.ts        metrics, IRR, break-evens
  market.ts         comps, similarity, weighted percentile, price estimate
  dom.ts            comp DOM, DOM estimate, seasonality fit, confidence
  scenarios.ts      scenario resolution, runs, sensitivity grid
  verdict.ts        rules → verdict
  goalseek.ts       bisection search + lever results
  evaluate.ts       evaluateDeal orchestrator
  __fixtures__/     sampleHouse.ts, books.ts, golden.ts, golden-deal.inputs.json,
                    golden-deal.expected.json, golden-comps.json, arbitraries.ts
```

---

### Task 1: Project scaffold, tooling, CI, engine boundary guard

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.github/workflows/ci.yml`, `tests/boundary.ts`, `tests/engine-boundary.test.ts`, `src/engine/index.ts`

**Interfaces:**
- Produces: npm scripts `test`, `test:watch`, `typecheck`, `lint`, `golden`. `checkEngineSource(filePath: string, source: string): string[]` (violation messages) in `tests/boundary.ts`.

- [ ] **Step 1: Create the project.** `package.json` settings:
  - `"name": "spec-studio"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`
  - Scripts: `test` = `vitest run`, `test:watch` = `vitest`, `typecheck` = `tsc --noEmit`, `lint` = `eslint .`, `golden` = `python3 scripts/golden/build_golden.py`
  - Install `zod` as a dependency, and `typescript vitest fast-check eslint @eslint/js typescript-eslint @types/node` as dev dependencies, at current versions.
  - `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `resolveJsonModule`, `types: ["node"]`, include `src`, `tests`, `vitest.config.ts`.
  - `vitest.config.ts`: include `src/**/*.test.ts` and `tests/**/*.test.ts`.
  - `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` recommended; ignore `dist`, `coverage`, `docs`, `scripts`.
  - `.gitignore`: `node_modules`, `dist`, `coverage`, `.DS_Store`, `__pycache__`.

- [ ] **Step 2: Write the failing boundary test** in `tests/engine-boundary.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEngineSource } from "./boundary";

const ENGINE = join(process.cwd(), "src/engine");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe("engine boundary", () => {
  it("flags imports that leave the engine", () => {
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import x from "../data/db";`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import React from "react";`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `import { z } from "zod"; import { a } from "./b";`)).toEqual([]);
  });
  it("flags clock and randomness in non-test files", () => {
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const t = Date.now();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const t = new Date();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.ts"), `const r = Math.random();`)).toHaveLength(1);
    expect(checkEngineSource(join(ENGINE, "a.test.ts"), `import { it } from "vitest"; Date.now();`)).toEqual([]);
  });
  it("every engine file passes", () => {
    const files = walk(ENGINE).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => checkEngineSource(f, readFileSync(f, "utf8")))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails.** Run `npm test`. Expected: FAIL (cannot resolve `./boundary`).

- [ ] **Step 4: Implement `checkEngineSource` in `tests/boundary.ts`.**
  - Extract specifiers from `from "…"` and `import("…")`.
  - A file is "test-like" if it ends with `.test.ts` or lives in `__fixtures__/`. Test-like files may also import `vitest`, `fast-check`, and `node:*`, and are exempt from the clock/random check.
  - Relative specifiers must resolve (via `path.resolve`) inside `src/engine`.
  - Forbidden patterns in non-test-like files: `Date.now(`, `new Date()`, `Math.random(`.
  - Then create `src/engine/index.ts` containing `export {};`.

- [ ] **Step 5: Verify everything passes.** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass.

- [ ] **Step 6: Add CI.** `.github/workflows/ci.yml`: on push and pull_request, use `actions/setup-node` with Node 22 and npm cache, then run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "chore: scaffold TypeScript project with engine boundary guard and CI"` (plus trailers).

---

### Task 2: Core utilities — money, dates, results

**Files:**
- Create: `src/engine/money.ts`, `src/engine/dates.ts`, `src/engine/result.ts`, `src/engine/money.test.ts`, `src/engine/dates.test.ts`

**Interfaces:**
- Produces:
  - `type Cents = number`
  - `roundCents(x: number): Cents` — half away from zero, with a `1e-6` epsilon so float noise at .5 rounds away from zero
  - `mulRate(c: Cents, rate: number): Cents`
  - `sumCents(xs: readonly Cents[]): Cents`
  - `dollars(d: number): Cents`
  - `formatUsd(c: Cents): string` — whole dollars, U+2212 minus sign
  - `type ISODate = string` (`YYYY-MM-DD`), `type YearMonth = string` (`YYYY-MM`)
  - `daysBetween(a: ISODate, b: ISODate): number` (b − a, UTC)
  - `addMonths(ym: YearMonth, n: number): YearMonth`
  - `calendarMonth(ym: YearMonth): number` (1–12)
  - `monthOfDate(d: ISODate): number`
  - `yearOfDate(d: ISODate): number`
  - `MONTH_DAYS = 365 / 12`
  - `type Warning = { code: string; message: string }`
  - `type MissingItem = { code: string; message: string; step: "lot" | "house" | "estimate" | "market" | "proforma" }`
  - `type ValidationIssue = { path: string; message: string }`
  - `type Result<T> = { status: "ok"; value: T; warnings: Warning[] } | { status: "incomplete"; missing: MissingItem[] }`
  - `ok<T>(value: T, warnings?: Warning[]): Result<T>`, `incomplete<T>(missing: MissingItem[]): Result<T>`, `isOk<T>(r: Result<T>): r is …`

- [ ] **Step 1: Write the failing tests:**

```ts
// money.test.ts
expect(roundCents(267.49999999999997)).toBe(268);
expect(roundCents(267.4)).toBe(267);
expect(roundCents(-267.5)).toBe(-268);
expect(mulRate(70_095_000, 0.05)).toBe(3_504_750);
expect(dollars(1_350_000)).toBe(135_000_000);
expect(formatUsd(135_000_000)).toBe("$1,350,000");
expect(formatUsd(3_504_750)).toBe("$35,048");
expect(formatUsd(-1_900_000)).toBe("−$19,000");

// dates.test.ts
expect(daysBetween("2026-01-10", "2026-10-30")).toBe(293);
expect(daysBetween("2026-06-15", "2026-10-30")).toBe(137);
expect(addMonths("2027-06", 11)).toBe("2028-05");
expect(addMonths("2027-11", 2)).toBe("2028-01");
expect(calendarMonth("2028-05")).toBe(5);
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/money.test.ts src/engine/dates.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** the three modules with the signatures above. Use `Date.UTC(y, m − 1, d)` for date math; constructing a `Date` from explicit parts is allowed.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): money, date, and result utilities`.

---

### Task 3: Deal input schemas and validation

**Files:**
- Create: `src/engine/house.ts`, `src/engine/deal.ts`, `src/engine/house.test.ts`, `src/engine/deal.test.ts`, `src/engine/__fixtures__/sampleHouse.ts`

**Interfaces:**
- Consumes: `ValidationIssue`, `Cents`, `YearMonth`, `addMonths` (Task 2).
- Produces:
  - `FinishTier`, `HouseModelSchema`, `type HouseModel` — exactly spec §5.2
  - `type TierArea = "kitchen" | "primaryBath" | "basement" | "house"`
  - `tierFor(h: HouseModel, area: TierArea): FinishTier`
  - `validateHouse(h: unknown): ValidationIssue[]`
  - `deal.ts`:
    - `Utility = "water" | "sewer" | "gas" | "power" | "secondaryWater"`
    - `UtilityStatus = "available" | "needsConnection" | "unknown"`
    - `Lot { city; county; region; acres; frontageFt?; priceCents; closingCents; financing: { kind: "cash" } | { kind: "loan"; ltv; rate; points }; utilities: Record<Utility, UtilityStatus>; hoaMonthlyCents; propertyTaxRate }`
    - `Timeline { landClose: YearMonth; preConMonths; buildMonths; listEarlyMonths; closingDays }`
    - `ConstructionLoan { ltc; rate; points; drawFeeCents; termMonths; extensionPct; extensionMonths; interestMode: "paid" | "capitalized" }`
    - `Carry { insuranceRate; utilitiesBuildMonthlyCents; utilitiesAfterMonthlyCents; stagingMonthlyCents; upkeepMonthlyCents }`
    - `Selling { listingPct; buyerPct; closingPct; concessionsCents }`
    - `Rules { minMarginOnSale; minAnnualizedReturn; minDownsideProfitCents }`
    - `ScenarioDef { priceSource: "low" | "mid" | "high"; domSource: "low" | "typical" | "high"; overrunPct }`
    - `ScenarioDefs { downside; base; upside }`
    - `Bid { code: string; amountCents; vendor; receivedOn: ISODate; notes? }`
    - `DealInputs { lot; house; timeline; loan; carry; selling; rules; scenarioDefs; contingencyPct; overrides: { basePriceCents?; baseDomDays? }; plannedListPriceCents?; bids: Bid[]; compSelections: Record<string, boolean> }`
    - `DealInputsSchema`, `validateDeal(d: unknown): ValidationIssue[]` (Zod issues + `validateHouse`, with dotted paths)
    - `DEFAULT_RULES = { minMarginOnSale: 0.15, minAnnualizedReturn: 0.25, minDownsideProfitCents: 0 }`
    - `DEFAULT_SCENARIO_DEFS = { downside: {low, high, 0.05}, base: {mid, typical, 0}, upside: {high, low, 0} }`
    - `listYearMonth(t: Timeline): YearMonth` = `addMonths(landClose, preCon + build − listEarly)`
  - Fixture `SAMPLE_HOUSE: HouseModel` and `SAMPLE_LOT: Lot`:
    - House: rambler; main fin 2200 / unfin 0 / ceiling 10; no upper; basement total 2200 / fin 1600 / walkout false; footprint 55×40 moderate; garage 3 bays, no tandem, no RV; roof hip 6/12; 5 bed, 3 full, 1 half, 1 fireplace; exterior stone 25 / stucco 50 / board-batten 25 / fiber cement 0; finishes upgraded with overrides kitchen luxury, basement standard; no ADU; no pool; outside: patio 400, flatwork 1500, fence 240, landscaping upgraded
    - Lot: Kaysville / Davis / `utah-north`; 0.33 ac; price 29,500,000; closing 400,000; cash; water, sewer, gas, power `needsConnection`; secondary water `unknown`; HOA 0; tax rate 0.0048

- [ ] **Step 1: Write the failing tests:**

```ts
expect(validateHouse(SAMPLE_HOUSE)).toEqual([]);
const bad = structuredClone(SAMPLE_HOUSE);
bad.levels.basement!.finishedSf = 2300;
expect(validateHouse(bad).map((i) => i.path)).toContain("levels.basement.finishedSf");
// also: exterior percentages summing to 90 → path "exterior";
// footprint 30×30 → path "footprint" (900 < 50% of 2200);
// adu.type "basement" with no basement → path "adu.type";
// rooms.bedrooms −1 → an issue at "rooms.bedrooms"
expect(tierFor(SAMPLE_HOUSE, "kitchen")).toBe("luxury");
expect(tierFor(SAMPLE_HOUSE, "basement")).toBe("standard");
expect(tierFor(SAMPLE_HOUSE, "primaryBath")).toBe("upgraded");
expect(listYearMonth({ landClose: "2027-06", preConMonths: 2, buildMonths: 9, listEarlyMonths: 0, closingDays: 35 })).toBe("2028-05");
// validateDeal: buildMonths 0 → "timeline.buildMonths"; listEarlyMonths 10 with buildMonths 9 → "timeline.listEarlyMonths";
// loan.ltc 1.2 → "loan.ltc"; non-integer preConMonths → "timeline.preConMonths"
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/house.test.ts src/engine/deal.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the Zod schemas and checks:
  - Non-negative numbers everywhere.
  - Rates 0–1; `ltc` 0–0.95.
  - Integer months; `buildMonths ≥ 1`; `0 ≤ listEarlyMonths ≤ buildMonths`.
  - The blocking house rules from spec §5.2.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): house and deal input schemas with validation`.

---

### Task 4: Quantity takeoff

**Files:**
- Create: `src/engine/quantities.ts`, `src/engine/quantities.test.ts`

**Interfaces:**
- Consumes: `HouseModel`, `Lot`, `tierFor` (Task 3); `Result` (Task 2).
- Produces:
  - `type Q = { value: number; explain: string }`
  - `Quantities`:
    - Scalars (each a `Q`): `finishedSf`, `conditionedSf`, `perimeterLf`, `foundationLf`, `garageSf`, `framingSf`, `excavationYd3`, `roofSquares`, `exteriorWallNetSf`, `windowCount`, `insulatedEnvelopeSf`, `drywallSf`, `paintSf`, `plumbingFixtures`, `hvacTons`, `utilityConnections`, `landscapedSf`, `fenceLf`, `flatworkSf`, `coveredPatioSf`, `fireplaces`
    - Groups:
      - `cladding: { stone; stucco; boardBatten; fiberCement }`
      - `cabinetLf: { kitchen; primaryBath; rest }`
      - `flooring: { tile; hardAbove; carpetAbove; hardBasement; carpetBasement }`
      - `trimSf: { aboveGrade; basement }`
      - `fixtureSets: { kitchen; primaryBath; otherFullBaths; halfBaths }`
      - `garageDoors: { double; single; rv }`
  - `QuantityRules` and `DEFAULT_QUANTITY_RULES` — every coefficient from spec §5.3, plus the decisions below
  - `computeQuantities(h: HouseModel, lot: Lot, rules: QuantityRules): Result<Quantities>` — `incomplete` with one `MissingItem` per validation issue (step `"house"`)

**Decisions beyond the spec table:**
- `framingSf` = main total + upper total + basement finished + garageSf.
- Tile is carved out of above-grade finished first: `tile = 60 × full + 25 × half + 60`. The remaining above-grade finished splits hard/carpet by tier share (hard = round(rest × share); carpet = rest − hard). Basement finished splits 30% hard / 70% carpet the same way.
- `cabinetLf`: kitchen 25 / 30 / 36 by kitchen tier; primaryBath 5 if fullBaths ≥ 1; rest = 5 × (fullBaths − 1) + 3 × halfBaths + 6 laundry (+ 12 for an ADU kitchen).
- `fixtureSets`: kitchen 1; primaryBath = min(1, fullBaths); otherFullBaths = max(0, fullBaths − 1); halfBaths.
- `landscapedSf = max(0, round(acres × 43,560) − width × depth − garageSf − flatworkSf − coveredPatioSf)`.
- `utilityConnections` = number of utilities marked `needsConnection`.
- `exteriorWallNetSf` garage term uses `(12 × bays + 24) × 10` (the RV bay is not added). `insulatedEnvelopeSf` uses the same expression without the garage term, rounded once at the end.
- `trimSf` = above-grade finished (main + upper) and basement finished.

- [ ] **Step 1: Write the failing tests.** Exact values for `SAMPLE_HOUSE` / `SAMPLE_LOT`:

```ts
const q = unwrap(computeQuantities(SAMPLE_HOUSE, SAMPLE_LOT, DEFAULT_QUANTITY_RULES));
expect(values(q)).toMatchObject({
  finishedSf: 3800, conditionedSf: 4400, perimeterLf: 190, foundationLf: 214, garageSf: 768,
  framingSf: 4568, excavationYd3: 880, roofSquares: 40, exteriorWallNetSf: 2600, windowCount: 26,
  insulatedEnvelopeSf: 4272, drywallSf: 15370, paintSf: 15370, plumbingFixtures: 22, hvacTons: 5,
  utilityConnections: 4, landscapedSf: 9507, fenceLf: 240, flatworkSf: 1500, coveredPatioSf: 400, fireplaces: 1,
  cladding: { stone: 650, stucco: 1300, boardBatten: 650, fiberCement: 0 },
  cabinetLf: { kitchen: 36, primaryBath: 5, rest: 19 },
  flooring: { tile: 265, hardAbove: 1161, carpetAbove: 774, hardBasement: 480, carpetBasement: 1120 },
  trimSf: { aboveGrade: 2200, basement: 1600 },
  fixtureSets: { kitchen: 1, primaryBath: 1, otherFullBaths: 2, halfBaths: 1 },
  garageDoors: { double: 1, single: 1, rv: 0 },
});
expect(q.foundationLf.explain).toContain("1.125");
```

Additional variants:
- No basement: `excavationYd3` 244, `windowCount` 22, basement flooring 0.
- Add upper `{ finishedSf: 1200, unfinishedSf: 0, ceilingFt: 9 }`: `exteriorWallNetSf` 4483, `hvacTons` 6.5.
- `rvBay: true`: `garageSf` 1248, `garageDoors.rv` 1.
- Invalid house → `status: "incomplete"`.

(`values()` and `unwrap()` are small test helpers in the test file.)

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/quantities.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `computeQuantities`** per spec §5.3 and the decisions above. Each `explain` names its inputs and coefficients, e.g. `"190 LF perimeter × 1.125 moderate"`.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): quantity takeoff from house model`.

---

### Task 5: Cost codes, line parts, price resolution

**Files:**
- Create: `src/engine/costbook.ts`, `src/engine/costbook.test.ts`, `src/engine/__fixtures__/books.ts`

**Interfaces:**
- Consumes: `Quantities` (Task 4); `HouseModel`, `tierFor`, `FinishTier` (Task 3).
- Produces:
  - `CostCodeId` — the 29 slugs below, in order
  - `Division = "soft" | "site" | "structure" | "envelope" | "mep" | "interior" | "exteriorFinish" | "general"`
  - `CostCode { id; number; name; division }`, `COST_CODES: readonly CostCode[]`
  - `Unit = "sf" | "lf" | "yd3" | "sq" | "ea" | "ton" | "mo" | "ls"`
  - `LinePart { code: CostCodeId; variant: string; tier: FinishTier | null; quantity: number; unit: Unit; area?: TierArea }`
  - `linePartsFor(q: Quantities, h: HouseModel, buildMonths: number): LinePart[]` — omits parts with quantity 0
  - `PriceKey { code; variant; tier: FinishTier | null }`
  - `DefaultPrice extends PriceKey { region; unitPriceCents; unit; asOf: ISODate; verified: boolean; sourceNote: string }`
  - `PriceBookEntry extends PriceKey { unitPriceCents; unit; asOf; vendor?; notes? }`
  - `CostBookView { defaults: DefaultPrice[]; priceBook: PriceBookEntry[] }`
  - `ResolvedPrice { unitPriceCents; source: "priceBook" | "default"; asOf }`
  - `resolvePrice(p: LinePart, book: CostBookView, region: string): ResolvedPrice | null`
    - Price book beats default.
    - Within a source, an exact tier match beats `tier: null`.
    - Defaults must match the region.
  - Fixture: `uniformBookFor(parts: LinePart[], region: string, unitPriceCents: Cents, asOf: ISODate): CostBookView` — one default per distinct `PriceKey`.

**Code → parts table** (tier shorthand: H = house, K = kitchen, P = primaryBath, B = basement, L = landscaping tier, — = null):

| # | id | division | parts `variant(tier) × quantity unit` |
|---|---|---|---|
| 1 | plans | soft | `ls(—) × 1 ls` |
| 2 | permits | soft | `ls(—) × 1 ls` |
| 3 | surveySoils | soft | `ls(—) × 1 ls` |
| 4 | excavation | site | `base(—) × excavationYd3 yd3` |
| 5 | utilities | site | `connection(—) × utilityConnections ea` |
| 6 | foundation | structure | `base(—) × foundationLf lf` |
| 7 | framing | structure | `base(—) × framingSf sf` |
| 8 | roofing | structure | `base(—) × roofSquares sq` |
| 9 | windows | envelope | `window(H) × windowCount ea` |
| 10 | cladding | envelope | `stone / stucco / boardBatten / fiberCement(—) × cladding.* sf` |
| 11 | insulation | envelope | `base(—) × insulatedEnvelopeSf sf` |
| 12 | plumbing | mep | `fixture(—) × plumbingFixtures ea` |
| 13 | electrical | mep | `base(H) × conditionedSf sf` |
| 14 | hvac | mep | `ton(—) × hvacTons ton` |
| 15 | drywall | interior | `base(—) × drywallSf sf` |
| 16 | trim | interior | `aboveGrade(H) × trimSf.aboveGrade sf`; `basement(B) × trimSf.basement sf` |
| 17 | cabinets | interior | `lf(K) × kitchen`; `lf(P) × primaryBath`; `lf(H) × rest` (all lf; `area` set) |
| 18 | flooring | interior | `tile(H) × tile`; `hard(H) × hardAbove`; `carpet(H) × carpetAbove`; `hard(B) × hardBasement`; `carpet(B) × carpetBasement` (sf) |
| 19 | paint | interior | `base(—) × paintSf sf` |
| 20 | fixtures | interior | `kitchen(K) × 1`; `primaryBath(P) × 1`; `fullBath(H) × otherFullBaths`; `halfBath(H) × halfBaths` (ea) |
| 21 | garageDoors | exteriorFinish | `double / single / rv(—) × garageDoors.* ea` |
| 22 | flatwork | exteriorFinish | `base(—) × flatworkSf sf` |
| 23 | landscaping | exteriorFinish | `allowance(L) × landscapedSf sf`; `fence(—) × fenceLf lf` |
| 24 | cleaning | general | `base(—) × finishedSf sf` |
| 25 | supervision | general | `month(—) × buildMonths mo` |
| 26 | fireplaces | interior | `unit(H) × fireplaces ea` |
| 27 | adu | interior | `basement` or `detached(—) × 1 ls` |
| 28 | pool | exteriorFinish | `fiberglass` or `gunite(—) × 1 ls`; `spa(—) × 1` if spa; `heater(—) × 1` if heated; `safety(—) × 1 ls` |
| 29 | patio | exteriorFinish | `base(—) × coveredPatioSf sf` |

Names come from spec §5.4 (e.g. `framing` → "Framing", `garageDoors` → "Garage doors").

- [ ] **Step 1: Write the failing tests:**

```ts
expect(COST_CODES).toHaveLength(29);
expect(COST_CODES.map((c) => c.number)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
const parts = linePartsFor(q, SAMPLE_HOUSE, 9);
expect(new Set(parts.map((p) => p.code)).size).toBe(27); // 25 base + fireplaces + patio
expect(parts.filter((p) => p.code === "cabinets").map((p) => p.tier)).toEqual(["luxury", "upgraded", "upgraded"]);
expect(parts.filter((p) => p.code === "flooring" && p.variant === "carpet").map((p) => p.tier)).toEqual(["upgraded", "standard"]);
expect(parts.find((p) => p.code === "supervision")!.quantity).toBe(9);
expect(parts.some((p) => p.code === "adu" || p.code === "pool")).toBe(false);
// pool { type: "gunite", spa: true, heated: false } → pool parts variants ["gunite", "spa", "safety"];
// adu { type: "basement" } → one part "basement"
```

`resolvePrice` cases:
- A price-book entry beats a default.
- A `tier: "luxury"` entry beats `tier: null` for a luxury part.
- A default for region `utah-south` is ignored for `utah-north`.
- Returns `null` when nothing matches.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/costbook.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `COST_CODES`, `linePartsFor`, `resolvePrice`, and the `uniformBookFor` fixture.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): cost codes, line parts, price resolution`.

---

### Task 6: Estimate assembly

**Files:**
- Create: `src/engine/estimate.ts`, `src/engine/estimate.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `EstimateContext { region: string; contingencyPct: number; buildMonths: number; today: ISODate }`
  - `EstimatePart extends LinePart { unitPriceCents; totalCents; source: "priceBook" | "default"; asOf; stale: boolean }`
  - `EstimateLine { code; name; division; parts: EstimatePart[]; totalCents; source: "bid" | "priceBook" | "default"; bid?: Bid; stale: boolean }`
  - `Estimate`:
    - `lines`, `divisionSubtotals: Record<Division, Cents>`, `subtotalCents`, `contingencyPct`, `contingencyCents`, `totalCents`, `costPerFinishedSfCents`
    - `confidence: { bidCents; priceBookCents; defaultCents; bidShare; priceBookShare; defaultShare }`
    - `bidsNext: { codes: CostCodeId[]; defaultShareAfter: number }`
    - `staleCount`
  - `buildEstimate(q: Quantities, h: HouseModel, book: CostBookView, bids: Bid[], ctx: EstimateContext): Result<Estimate>`

**Rules:**
- One line per code present in `linePartsFor` **or** having a bid.
- A bid replaces the whole line. When there are several bids for one code, the latest `receivedOn` wins; ties go to the first in the array.
- Line `source` = `bid` if bid; else `default` if any part is default; else `priceBook`.
- Part total = `roundCents(quantity × unitPriceCents)`.
- Contingency = `mulRate(subtotal, contingencyPct)`.
- Stale = `asOf` (or the bid's `receivedOn`) more than 365 days before `today`.
- `bidsNext` = the 4 largest lines whose source is `default`. `defaultShareAfter = (defaultCents − Σ default-part cents of those lines) / subtotal`.
- Any part without a price → `incomplete` with one item per missing key: code `missingPrice`, message names code/variant/tier, step `"estimate"`.

- [ ] **Step 1: Write the failing tests:**

```ts
// all 27 codes bid at $1,000 each → subtotal 2,700,000 cents
expect(est.subtotalCents).toBe(2_700_000);
expect(est.contingencyCents).toBe(135_000);
expect(est.totalCents).toBe(2_835_000);
expect(est.confidence.bidShare).toBe(1);

// uniform default book at 100 cents/unit, no bids
expect(line("framing").totalCents).toBe(456_800);
expect(line("framing").source).toBe("default");

// one price-book entry for framing base at 1,500 cents
//   → framing 6,852,000 with source "priceBook"; confidence.priceBookCents === 6_852_000
// two bids for "plans" (2026-09-01 $9,000; 2026-10-12 $8,500) → line total 850,000
// default asOf "2025-09-01" with today "2026-10-30" → stale, staleCount > 0
// remove the default for windows → status "incomplete", missing[0].code === "missingPrice"
// mulRate check: subtotal 70,095,000 at 0.05 → total 73,599,750
```

Property test (fast-check): for random bid amounts on random subsets of codes, `totalCents === Σ lines.totalCents + contingencyCents`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/estimate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `buildEstimate`** per the rules above.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): estimate assembly with sources, confidence, bids-next`.

---

### Task 7: Golden deal — inputs, spreadsheet, expected values

**Files:**
- Create: `src/engine/__fixtures__/golden-deal.inputs.json`, `src/engine/__fixtures__/golden-comps.json`, `src/engine/__fixtures__/golden.ts`, `src/engine/__fixtures__/golden.test.ts`, `scripts/golden/build_golden.py`, `docs/golden-deal.xlsx`, `src/engine/__fixtures__/golden-deal.expected.json`

**Interfaces:**
- Consumes: `DealInputs`, `validateDeal` (Task 3).
- Produces:
  - `GOLDEN_DEAL: DealInputs`
  - `GOLDEN_EXPECTED` (typed view of the expected JSON)
  - `GOLDEN_COMPS: Comp[]` (typed once Task 10 defines `Comp`; until then `unknown[]`)

**`golden-deal.inputs.json`:**
- `house`: `SAMPLE_HOUSE` with `rooms.fireplaces = 0` and `outside.coveredPatioSf = 0`.
- `lot`: `SAMPLE_LOT`.
- `timeline`: `{ landClose: "2027-06", preConMonths: 2, buildMonths: 9, listEarlyMonths: 0, closingDays: 35 }`.
- `loan`: `{ ltc: 0.8, rate: 0.09, points: 0.01, drawFeeCents: 20000, termMonths: 12, extensionPct: 0.005, extensionMonths: 3, interestMode: "paid" }`.
- `carry`: `{ insuranceRate: 0.0035, utilitiesBuildMonthlyCents: 15000, utilitiesAfterMonthlyCents: 25000, stagingMonthlyCents: 50000, upkeepMonthlyCents: 10000 }`.
- `selling`: `{ listingPct: 0.025, buyerPct: 0.025, closingPct: 0.01, concessionsCents: 1500000 }`.
- `rules`, `scenarioDefs`: the defaults. `contingencyPct: 0.05`.
- `overrides`: `{ basePriceCents: 135000000, baseDomDays: 62 }`. `compSelections: {}`.
- `bids`: one per code, vendor `"Golden"`, `receivedOn: "2026-10-12"`, amounts in dollars:

| Code | $ | Code | $ | Code | $ |
|---|---|---|---|---|---|
| plans | 8,500 | permits | 26,800 | surveySoils | 3,200 |
| excavation | 22,000 | utilities | 15,500 | foundation | 62,000 |
| framing | 108,000 | roofing | 24,000 | windows | 31,000 |
| cladding | 38,000 | insulation | 10,500 | plumbing | 33,000 |
| electrical | 29,700 | hvac | 26,500 | drywall | 30,000 |
| trim | 24,500 | cabinets | 54,000 | flooring | 31,000 |
| paint | 18,000 | fixtures | 24,000 | garageDoors | 6,800 |
| flatwork | 16,500 | landscaping | 20,000 | cleaning | 4,150 |
| supervision | 33,300 | | | | |

These sum to $700,950. Soft-cost codes sum to $38,500.

**`golden-comps.json`:** the 8 comps from the mockup's Market screen.
- Copy city, year built, finished sf, sold price, and list/sold months from the mockup; use day 15 for every date; no contract date.
- Split finished sf 55% above grade (rounded) / remainder basement.
- Garage 3, basement finish `partial`, no walkout, no ADU, no pool, lot 0.30 ac, county Davis, region `utah-north`, status `sold`, source `manual`, verified `true`.

**`build_golden.py`:**
- Reads the inputs JSON. Builds `docs/golden-deal.xlsx` with an `Inputs` sheet (labeled cells, values in **dollars**) and one schedule sheet per scenario:
  - `base`: price $1,350,000, DOM 62, overrun 0
  - `stress`: price $1,255,500, DOM 400, overrun 0.05
- Every schedule value is an Excel **formula** implementing the Reference cash-flow algorithm, steps 1–15, with `ROUND(…, 2)` wherever the reference says `round`.
  - The script decides only the row count (`N`).
  - Draw weights use `SIN(PI()*(i+0.5)/B)`.
  - IRR is not computed in the sheet.
- Recalculates by running `soffice --headless --calc --convert-to xlsx --outdir <tmpdir> docs/golden-deal.xlsx`, then reads the converted file with `openpyxl` (`data_only=True`). This was verified to recalculate formulas in this environment.
- Writes `golden-deal.expected.json`, converting dollars ×100 → integer cents:
  ```json
  { "scenarios": { "base": { "inputs": {}, "times": {}, "extensions": 0,
    "periods": [ { "spendCents": 0, "equitySpendCents": 0, "loanDrawCents": 0, "drawFeeCents": 0, "pointsCents": 0,
      "interestCents": 0, "landLoanInterestCents": 0, "extensionFeeCents": 0, "taxCents": 0, "insuranceCents": 0,
      "utilitiesCents": 0, "stagingCents": 0, "upkeepCents": 0, "hoaCents": 0, "equityOutCents": 0 } ],
    "sale": { "commissionsCents": 0, "closingCents": 0, "netCents": 0, "loanPayoffCents": 0, "equityReturnCents": 0 },
    "metrics": { "totalProjectCostCents": 0, "buildSpentCents": 0, "financingCents": 0, "carryCents": 0,
      "sellingCostsCents": 0, "profitCents": 0, "peakCashCents": 0, "breakEvenSalePriceCents": 0,
      "monthlyBurnWhileListedCents": 0, "maxDomWithoutExtension": 0 },
    "equityFlows": [ { "t": 0, "cents": 0 } ] }, "stress": {} } }
  ```
  (Shape shown; values come from the sheet.)

- [ ] **Step 1: Write the failing fixture test** `golden.test.ts`:

```ts
expect(validateDeal(GOLDEN_DEAL)).toEqual([]);
expect(GOLDEN_DEAL.bids).toHaveLength(25);
expect(GOLDEN_DEAL.bids.reduce((s, b) => s + b.amountCents, 0)).toBe(70_095_000);
expect(GOLDEN_EXPECTED.scenarios.base.periods).toHaveLength(15);     // saleClose ≈ 14.189
expect(GOLDEN_EXPECTED.scenarios.base.extensions).toBe(1);
expect(GOLDEN_EXPECTED.scenarios.stress.extensions).toBe(4);         // saleClose ≈ 25.301, maturity 14
expect(GOLDEN_EXPECTED.scenarios.base.metrics.maxDomWithoutExtension).toBe(56);
expect(GOLDEN_COMPS).toHaveLength(8);
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run src/engine/__fixtures__/golden.test.ts`. Expected: FAIL (files missing).

- [ ] **Step 3: Write the inputs JSON, comps JSON, `golden.ts` loader, and `build_golden.py`.**

- [ ] **Step 4: Generate the outputs.** Run `npm run golden`. Expected: `docs/golden-deal.xlsx` and `golden-deal.expected.json` are written and the script prints `base profit` and `stress profit` in dollars. Open the xlsx and spot-check that period rows sum to the summary totals.

- [ ] **Step 5: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 6: Commit.** Message: `test(engine): golden deal inputs, spreadsheet, and expected values`.

---

### Task 8: Monthly cash flow

**Files:**
- Create: `src/engine/cashflow.ts`, `src/engine/cashflow.test.ts`, `src/engine/__fixtures__/arbitraries.ts`

**Interfaces:**
- Consumes: `DealInputs` (Task 3), `Estimate` (Task 6), `MONTH_DAYS`, `roundCents` (Task 2).
- Produces:
  - `ScenarioInputs { priceCents: Cents; domDays: number; overrunPct: number }`
  - `ProFormaInput`: `{ landPriceCents; landClosingCents; landFinancing; preConMonths; buildMonths; listEarlyMonths; closingDays; softCents; hardCents; estimateTotalCents; overrunPct; loan; carry; taxRate; hoaMonthlyCents; selling; salePriceCents; domDays }`
  - `buildProFormaInput(d: DealInputs, e: Estimate, s: ScenarioInputs): ProFormaInput`
  - `drawWeights(buildMonths: number): number[]`
  - `Period` — the fields in the expected-JSON `periods` entries, plus `index` and `loanBalanceEndCents`, `cumulativeEquityCents`
  - `CashFlow { periods; times: { buildStart; completion; list; contract; saleClose; maturity }; commitmentCents; landLoanCents; loanDrawnCents; capitalizedInterestCents; extensions; sale: { priceCents; commissionsCents; closingCents; concessionsCents; netCents; loanPayoffCents; equityReturnCents } }`
  - `runCashFlow(input: ProFormaInput): CashFlow` — implements the Reference algorithm
  - Fixture `arbProFormaInput()` (fast-check) — realistic ranges: price 500k–3M dollars, DOM 0–400, LTC 0–0.9, build 4–14 months

- [ ] **Step 1: Write the failing tests.** Hand cases build `ProFormaInput` directly; unspecified fields are 0, cash, or `paid`.

```ts
const w = drawWeights(9);
expect(w[0]).toBeCloseTo(0.03015369, 8);
expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);

// hard 90,000,000, B 9 → first draw 2,713,832; draws sum to exactly 90,000,000

// Loan case: hard 100,000,000, P 0, B 2, LTC 0.8, rate 0.12, points 0.01, dom 30, closingDays 0
//   → periods 3; points 800,000 at period 0; period 0 equity 20,000,000 + loan 30,000,000;
//     interest [0, 300,000, 789,041]
// Same with termMonths 2, extensionPct 0.005, extensionMonths 3
//   → extensions 1; extensionFeeCents 400,000 at period 2
// Early listing: P 0, B 3, listEarlyMonths 2, dom 10, closingDays 10 → times.saleClose === 3     (Review Focus 2)
// All cash: LTC 0, termMonths 1, dom 200
//   → every pointsCents, drawFeeCents, interestCents, extensionFeeCents is 0                    (Review Focus 3)

// Golden: for "base" and "stress", every period field and the sale block equal GOLDEN_EXPECTED exactly
// goldenQ = computeQuantities(GOLDEN_DEAL.house, GOLDEN_DEAL.lot, DEFAULT_QUANTITY_RULES)
// goldenCtx = { region: "utah-north", contingencyPct: 0.05, buildMonths: 9, today: "2026-10-30" }
const est = unwrap(buildEstimate(goldenQ, GOLDEN_DEAL.house, { defaults: [], priceBook: [] }, GOLDEN_DEAL.bids, goldenCtx));
expect(est.totalCents).toBe(73_599_750);
```

Property test: `Σ equitySpend + Σ loanDraw === Σ spend` and `Σ spend === softActual + hardActual`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/cashflow.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `drawWeights`, `buildProFormaInput` (soft = Σ lines with division `soft`; `taxRate` and HOA from the lot), and `runCashFlow` per the Reference.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS. If a golden field differs, diff that period's column against the spreadsheet. The spreadsheet is the arbiter only after both are re-checked against the Reference.

- [ ] **Step 5: Commit.** Message: `feat(engine): monthly cash flow matching golden spreadsheet`.

---

### Task 9: Metrics, IRR, break-evens

**Files:**
- Create: `src/engine/metrics.ts`, `src/engine/metrics.test.ts`

**Interfaces:**
- Consumes: `CashFlow`, `ProFormaInput`, `runCashFlow` (Task 8).
- Produces:
  - `Metrics { salePriceCents; totalProjectCostCents; buildSpentCents; financingCents; carryCents; sellingCostsCents; profitCents; marginOnSale; marginOnCost; peakCashCents; returnOnCash; annualizedReturn: number | null; breakEvenSalePriceCents; monthlyBurnWhileListedCents; maxDomWithoutExtension: number | null; monthsLandToClose }`
  - `computeMetrics(cf: CashFlow, input: ProFormaInput): Metrics` (Reference 12–15)
  - `equityFlows(cf: CashFlow): { t: number; cents: Cents }[]` — outflows at t = k as negatives; inflow at t = saleClose
  - `irrMonthly(flows): number | null` — bisection on r ∈ [−0.99, 1.0], stop at |Δr| < 1e-12 or 200 iterations; `null` if there is no sign change or no positive flow
  - `annualized = (1 + r)^12 − 1`
  - `breakEvenSalePriceCents = roundCents((totalProjectCost + concessions) / (1 − listingPct − buyerPct − closingPct))`
  - `breakEvenDomDays(input: ProFormaInput): number | null` — 0 if profit(0) ≤ 0; `null` if profit(1095) > 0; else the smallest integer d with profit ≤ 0, by bisection

- [ ] **Step 1: Write the failing tests:**

```ts
expect((1 + irrMonthly([{ t: 0, cents: -10000 }, { t: 12, cents: 11000 }])!) ** 12 - 1).toBeCloseTo(0.10, 9);
expect(irrMonthly([{ t: 0, cents: -10000 }, { t: 12, cents: -1 }])).toBeNull();

// Golden base and stress: every metric equals GOLDEN_EXPECTED.scenarios.<name>.metrics exactly
// NPV of GOLDEN_EXPECTED base equityFlows at the engine's monthly IRR: |NPV| < 1 cent

// Deep loss (golden base at price $500,000): profitCents < 0, annualizedReturn is null,
//   no NaN anywhere in Metrics                                                            (Review Focus 4)

// Profit at price = breakEvenSalePriceCents: |profitCents| ≤ 2
// breakEvenDomDays(golden base) = d: profit(d) ≤ 0 and profit(d − 1) > 0
// Extension boundary on golden base: DOM 56 → cf.extensions 0; DOM 57 → 1
//   (saleClose 13.992 vs 14.025 against maturity 14)
```

Property tests (fast-check, with `arbProFormaInput`):
- Profit is non-increasing as `domDays` rises (Review Focus 5).
- Profit is non-decreasing as `salePriceCents` rises.
- `Σ equityFlows.cents === profitCents`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/metrics.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the signatures above.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): pro forma metrics, IRR, break-evens`.

---

### Task 10: Market — comps, similarity, price estimate

**Files:**
- Create: `src/engine/market.ts`, `src/engine/market.test.ts`
- Modify: `src/engine/__fixtures__/golden.ts` (type `GOLDEN_COMPS` as `Comp[]`)

**Interfaces:**
- Consumes: `HouseModel`, `Lot` (Task 3); dates and `Result` (Task 2).
- Produces:
  - `Comp` — spec §5.5 fields: `id; address; city; county; region; status; listDate?; listPriceCents?; originalListPriceCents?; priceCuts?; contractDate?; soldDate?; soldPriceCents?; aboveGradeFinishedSf; basementFinishedSf; unfinishedSf; beds; baths; yearBuilt; newConstruction; lotAcres; garageBays; basementFinish; walkout; adu; pool; source; verified; notes?`
  - `Subject { city; county; region; aboveGradeFinishedSf; basementFinishedSf; garageBays; basementFinish; walkout; adu; pool; lotAcres }`
  - `subjectFromDeal(h: HouseModel, lot: Lot): Subject`
    - `basementFinish`: `none` if no basement; `finished` if fin = total; `unfinished` if fin = 0; else `partial`
    - `adu = type !== "none"`, `pool = type !== "none"`
  - `MarketSettings { region; basementFactor; featureValues: { garageBayCents; walkoutCents; lotPerAcreCents; aduCents; poolCents }; similarityWeights: { location; size; age; recency; features }; includeThreshold; seasonalFactors: number[]; elasticity; marketCondition: "hot" | "normal" | "slow"; conditionFactors: { hot; normal; slow }; assumedClosingDays; defaultTaxRate }`
  - `DEFAULT_MARKET_SETTINGS`:
    - `region: "utah-north"`, `basementFactor: 0.6`
    - Feature values: garage bay $12,000; walkout $9,000; lot $60,000/acre; ADU $35,000; pool $25,000
    - Weights 25 / 25 / 15 / 20 / 15; include threshold 75
    - Seasonal factors Jan→Dec `[1.20, 1.10, 0.95, 0.90, 0.90, 0.95, 1.00, 1.00, 1.05, 1.10, 1.15, 1.20]`
    - Elasticity 3.0; condition factors 0.85 / 1.00 / 1.20; condition `normal`
    - `assumedClosingDays: 35`, `defaultTaxRate: 0.0048`
  - `effectiveSf(aboveGrade: number, basementFin: number, basementFactor: number): number`
  - `similarity(s: Subject, c: Comp, m: MarketSettings, today: ISODate): number` (0–100, unrounded)
    - Factor rules per spec §5.5.
    - Age uses `soldDate` year (or `today` if unsold) − `yearBuilt` ≤ 3.
    - Recency months = `daysBetween(soldDate, today) / MONTH_DAYS`.
    - Features = matches among garageBays, basementFinish, walkout, adu, pool ÷ 5.
  - `ScoredComp { comp; score; included }`
  - `scoreComps(s, comps, m, selections: Record<string, boolean>, today): ScoredComp[]` — sorted by score desc; `included = selections[id] ?? score ≥ includeThreshold`
  - `weightedPercentile(xs: { value: number; weight: number }[], p: number): number`
  - `PriceEstimate { lowCents; midCents; highCents; midPerEffectiveSfCents; comps: { id; adjustedCents; impliedCents; weight }[] }`
  - `estimatePrice(s, scored, m): Result<PriceEstimate>`
    - Uses included comps with `status === "sold"` and `soldPriceCents`.
    - Otherwise `incomplete` with code `noComps`, step `"market"`.

- [ ] **Step 1: Write the failing tests.** Subject = `subjectFromDeal(SAMPLE_HOUSE, SAMPLE_LOT)`, today `"2026-10-30"`.

```ts
// Comp A: Kaysville, 2200 + 1600, built 2025, sold 2026-06-15, garage 3, partial, no walkout/ADU/pool
expect(similarity(subject, compA, DEFAULT_MARKET_SETTINGS, today)).toBeCloseTo(100, 6);

// Comp B: Layton (Davis), 2400 + 1000, built 2018, sold 2026-01-10, garage 2, partial, walkout
expect(similarity(subject, compB, DEFAULT_MARKET_SETTINGS, today)).toBeCloseTo(68.78, 2);

expect(weightedPercentile([{ value: 10, weight: 1 }, { value: 20, weight: 1 }, { value: 30, weight: 2 }], 0.5)).toBe(20);

// Adjustment: comp garage 2, walkout, lot 0.25, pool vs subject (3, no walkout, 0.33, no pool)
//   → adjustedCents = soldPriceCents − 1_720_000

// Price estimate. Three Kaysville comps (built 2025, sold within 6 months, features match):
//   C1 2200/1600 sold $1,264,000; C2 2000/1000 sold $1,066,000; C3 2500/1500 sold $1,292,000
expect([est.lowCents, est.midCents, est.highCents]).toEqual([120_080_000, 126_400_000, 129_560_000]);

// only C1 included → low = mid = high = 126_400_000
// selections { [compB.id]: true } includes B despite its score
// no included sold comps → status "incomplete", missing[0].code "noComps"                 (Review Focus 1)
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/market.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** per spec §5.5 and the signatures above. Implied value = `roundCents(adjusted / compEffectiveSf × subjectEffectiveSf)`. Weights = scores.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): comp scoring and sale-price estimate`.

---

### Task 11: Market — days on market, seasonality, confidence

**Files:**
- Create: `src/engine/dom.ts`, `src/engine/dom.test.ts`

**Interfaces:**
- Consumes: `Comp`, `Subject`, `ScoredComp`, `MarketSettings`, `weightedPercentile` (Task 10).
- Produces:
  - `compDomDays(c: Comp, m: MarketSettings): number | null`
    - With a contract date: contract − list.
    - Otherwise: sold − list − `assumedClosingDays`.
    - `null` if any needed date is missing or the result is < 0.
  - `DomEstimate { lowDays; typicalDays; highDays; confidence: "high" | "medium" | "low"; compCount; recentCount; factors: { seasonal; pricePosition; condition }; explain: { label: string; effect: string }[] }`
  - `estimateDom(scored: ScoredComp[], m: MarketSettings, listMonth: number, priceMidCents: Cents, plannedListPriceCents: Cents | undefined, today: ISODate): Result<DomEstimate>`
    - Follows spec §5.5 steps 1–4.
    - `compCount` = included sold comps with non-null DOM; `recentCount` = those sold ≤ 6 months before `today`.
    - Zero → `incomplete` with code `noDomComps`.
    - Days rounded half away from zero.
  - `fitSeasonalFactors(comps: Comp[], m: MarketSettings): number[] | null`
    - Requires ≥ 24 sold comps with DOM spanning ≥ 9 distinct list months.
    - `raw[month] = median(DOM of that list month) / overall median`; months with no data are 1.0.
    - Then a circular 3-month moving average, rounded to 2 decimals.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(compDomDays({ ...c, listDate: "2026-04-01", contractDate: "2026-05-16" }, M)).toBe(45);
expect(compDomDays({ ...c, listDate: "2026-02-02", contractDate: undefined, soldDate: "2026-06-01" }, M)).toBe(84);
expect(compDomDays({ ...c, listDate: undefined }, M)).toBeNull();                          // Review Focus 1

// Three score-100 comps (Kaysville, 2200/1600, built 2025, features match subject), all in 2026:
//   D1 list 04-01, contract 05-16, sold 06-20
//   D2 list 07-01, contract 08-30, sold 10-01
//   D3 list 02-02, sold 06-01, no contract
// listMonth 5, mid $1,350,000, no planned price
expect([d.lowDays, d.typicalDays, d.highDays]).toEqual([45, 54, 69]);
expect(d.confidence).toBe("low");

// planned list price = mid × 1.02 → typicalDays 57
// marketCondition "slow" → typicalDays 65
// 10 comps with 5 sold in the last 6 months → "high"; 5 comps → "medium"
// zero comps with valid DOM → incomplete "noDomComps"                                   (Review Focus 1)

// Seasonality fit: 3 comps listed in Jan with DOM 90, 3 per month Feb–Sep with DOM 60 (27 comps)
expect(f[0]).toBe(1.17); expect(f[1]).toBe(1.17); expect(f[2]).toBe(1); expect(f[11]).toBe(1.17);
// same data without the September comps (8 months) → null
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/dom.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the signatures above.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): days-on-market estimate, confidence, seasonality fit`.

---

### Task 12: Scenarios and sensitivity grid

**Files:**
- Create: `src/engine/scenarios.ts`, `src/engine/scenarios.test.ts`

**Interfaces:**
- Consumes: `ScenarioDefs`, `DealInputs` (Task 3); `Estimate` (Task 6); `ScenarioInputs`, `buildProFormaInput`, `runCashFlow` (Task 8); `computeMetrics`, `Metrics` (Task 9); `PriceEstimate` (Task 10); `DomEstimate` (Task 11).
- Produces:
  - `ScenarioName = "downside" | "base" | "upside"`
  - `resolveScenarios(defs: ScenarioDefs, price: PriceEstimate | null, dom: DomEstimate | null, overrides: DealInputs["overrides"]): Result<Record<ScenarioName, ScenarioInputs>>`
    - Price: with an override `P0` and market data, low = `roundCents(P0 × low / mid)` and high = `roundCents(P0 × high / mid)`.
    - DOM: likewise, with whole-day rounding.
    - Override but no market → all three scenarios equal the override, with warning `noMarketRange`.
    - Neither → `incomplete` (`noComps`).
  - `ScenarioResult { inputs: ScenarioInputs; cashFlow: CashFlow; metrics: Metrics }`
  - `runScenarios(d: DealInputs, e: Estimate, s: Record<ScenarioName, ScenarioInputs>): Record<ScenarioName, ScenarioResult>`
  - `PRICE_DELTAS = [0.05, 0, -0.05, -0.10, -0.15]`, `DOM_COLUMNS = [30, 60, 90, 120, 180]`
  - `Band = "loss" | "b0_50" | "b50_100" | "b100_150" | "b150_200" | "b200plus"` (thresholds in dollars of profit)
  - `GridCell { priceDelta; domDays; profitCents; band; isBase: boolean }`
  - `sensitivityGrid(d: DealInputs, e: Estimate, base: ScenarioInputs): GridCell[][]` — rows follow `PRICE_DELTAS` order; `isBase` marks delta 0 at the column nearest the base DOM

- [ ] **Step 1: Write the failing tests:**

```ts
// market low/mid/high 120_900_000 / 130_000_000 / 135_200_000; DOM 45/54/69; overrides 135_000_000 and 62
expect(r.downside).toEqual({ priceCents: 125_550_000, domDays: 79, overrunPct: 0.05 });
expect(r.base).toEqual({ priceCents: 135_000_000, domDays: 62, overrunPct: 0 });
expect(r.upside).toEqual({ priceCents: 140_400_000, domDays: 52, overrunPct: 0 });

// no market, overrides present → all three scenarios equal; warnings contain "noMarketRange"  (Review Focus 1)
// no market, no overrides → incomplete

// Grid on the golden deal: 5 × 5; cell [1][1] (0%, 60 d) profit equals a direct run at (price base, dom 60);
// a negative-profit cell has band "loss"; exactly one cell has isBase
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/scenarios.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the signatures above.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): scenarios and sensitivity grid`.

---

### Task 13: Verdict and goal seek

**Files:**
- Create: `src/engine/verdict.ts`, `src/engine/goalseek.ts`, `src/engine/verdict.test.ts`, `src/engine/goalseek.test.ts`

**Interfaces:**
- Consumes: `Metrics` (Task 9), `Rules` (Task 3), `MissingItem` (Task 2).
- Produces:
  - `VerdictKind = "incomplete" | "go" | "marginal" | "nogo"`
  - `RuleCheck { rule: "marginOnSale" | "annualizedReturn" | "downsideProfit"; pass: boolean; actual: number | null; threshold: number }`
  - `Verdict { kind; checks: RuleCheck[]; loanWarning?: { maxDomWithoutExtension: number; baseDomDays: number }; missing?: MissingItem[] }`
  - `evaluateVerdict(base: Metrics, downside: Metrics, rules: Rules, baseDomDays: number): Verdict` — spec §5.8 definitions. A `null` annualized return fails its rule. The loan warning appears when `maxDomWithoutExtension !== null && baseDomDays > maxDomWithoutExtension`.
  - `incompleteVerdict(missing: MissingItem[]): Verdict`
  - `seekMax(passes: (x: number) => boolean, lo: number, hi: number, step: number): number | null` — largest x on the step grid in [lo, hi] that passes, assuming passes is monotone (true for x ≤ answer)
  - `seekMin(...)` — mirror image
  - `Adjustment { lotPriceCents?: Cents; salePriceFactor?: number; buildCostFactor?: number }`
  - `LeverResult { lever: "lotPrice" | "salePrice" | "buildCost"; reachable: boolean; valueCents?: Cents; deltaCents?: Cents; deltaPct?: number }`
  - `goalSeek(current: { lotPriceCents: Cents; basePriceCents: Cents; buildTotalCents: Cents }, isGo: (a: Adjustment) => boolean): LeverResult[]`
    - Step 10,000 cents ($100).
    - Lot: `seekMax` over [0, current].
    - Sale: `seekMin` over [base, round(base × 1.5)], applied as a factor to every scenario price.
    - Build: `seekMax` over [round(current × 0.5), current], applied as a factor to every estimate line.

- [ ] **Step 1: Write the failing tests:**

```ts
// Verdict table (rules = defaults; downside profit given in cents):
//   margin 0.12, annual 0.31, downside 2_897_000            → "marginal"
//   all pass                                                → "go"
//   base profit −1                                          → "nogo"
//   only the downside rule fails                            → "nogo"
//   margin and annual fail                                  → "nogo"
//   annualizedReturn null                                   → the annual check fails with actual null
//   maxDomWithoutExtension 56, baseDomDays 62               → loanWarning present
// Property (fast-check): kind === "go" only if every check passes

expect(seekMax((x) => x <= 25_400_000, 0, 29_500_000, 10_000)).toBe(25_400_000);
expect(seekMax(() => false, 0, 29_500_000, 10_000)).toBeNull();
expect(seekMin((x) => x >= 140_200_000, 135_000_000, 202_500_000, 10_000)).toBe(140_200_000);

// goalSeek with current { lot 29_500_000, base price 135_000_000, build 73_599_750 } and a synthetic isGo:
//   lot ≤ $254,000, or salePriceFactor ≥ 1.039, or buildCostFactor ≤ 0.944
//   → valueCents 25_400_000 (lot), 140_270_000 (sale), 69_469_875 (build)
// Grid points are lo + k × step, plus hi itself.
// isGo always false → all three { reachable: false }                                    (Review Focus 4)
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/verdict.test.ts src/engine/goalseek.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the signatures above.

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(engine): verdict rules and goal seek`.

---

### Task 14: `evaluateDeal` orchestrator, public API, performance

**Files:**
- Create: `src/engine/evaluate.ts`, `src/engine/evaluate.test.ts`
- Modify: `src/engine/index.ts` (re-export the public API)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `EngineContext { today: ISODate; costBook: CostBookView; comps: Comp[]; marketSettings: MarketSettings; quantityRules: QuantityRules }`
  - `DealEvaluation { validation: ValidationIssue[]; quantities: Result<Quantities>; estimate: Result<Estimate>; price: Result<PriceEstimate>; dom: Result<DomEstimate>; scenarios: Result<Record<ScenarioName, ScenarioResult>>; grid: GridCell[][] | null; verdict: Verdict; goalSeek: LeverResult[] | null; breakEvenDomDays: number | null }`
  - `evaluateDeal(d: DealInputs, ctx: EngineContext): DealEvaluation`
    - Pipeline: validate → quantities → estimate (region from `d.lot.region`, `buildMonths` from timeline) → `subjectFromDeal` + `scoreComps` → price → dom (list month from `listYearMonth`; `plannedListPriceCents`) → `resolveScenarios` → `runScenarios` → grid → verdict → goal seek (only when the verdict is `marginal` or `nogo`) → `breakEvenDomDays` (base).
    - `isGo` for goal seek re-runs scenarios + verdict with the adjustment applied (lot price on `d.lot`; price factor on all scenario prices; build factor on all estimate lines and totals).
    - Missing items from any step roll up into an `incomplete` verdict.
  - `index.ts` re-exports: `evaluateDeal`, the input types/schemas/defaults (`DEFAULT_RULES`, `DEFAULT_SCENARIO_DEFS`, `DEFAULT_MARKET_SETTINGS`, `DEFAULT_QUANTITY_RULES`), `validateDeal`, `COST_CODES`, `formatUsd`, `fitSeasonalFactors`, and all result types.

- [ ] **Step 1: Write the failing tests.** Context: today `"2026-10-30"`, empty cost book, `GOLDEN_COMPS`, default settings and rules.

```ts
const ev = evaluateDeal(GOLDEN_DEAL, ctx);
expect(ev.validation).toEqual([]);
expect(unwrap(ev.estimate).totalCents).toBe(73_599_750);
expect(ev.price.status).toBe("ok");
expect(ev.dom.status).toBe("ok");
expect(unwrap(ev.scenarios).base.metrics).toEqual(expectedBaseMetricsSubset); // fields from GOLDEN_EXPECTED.base.metrics
expect(ev.verdict.kind).not.toBe("incomplete");
expect(ev.grid).toHaveLength(5);
expect(ev.breakEvenDomDays).not.toBeNull();

// if verdict ≠ "go": a reachable lot result → re-evaluating with that lot price gives "go",
// and that price + $100 does not
// comps [] and no overrides → verdict "incomplete", missing includes "noComps"                (Review Focus 1)
// comps [] with overrides → scenarios ok with warning "noMarketRange"; verdict not incomplete
// basement.finishedSf > totalSf → validation non-empty, verdict "incomplete"
// price override $500,000 → verdict "nogo"; goalSeek returns 3 results; nothing throws         (Review Focus 4)

// Performance: 3 warm-up runs, then the median of 20 timed runs (performance.now) < 50 ms
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/engine/evaluate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `evaluateDeal` and the `index.ts` exports.

- [ ] **Step 4: Run the full verification.** Run `npm run lint && npm run typecheck && npm test`. Expected: all pass, including the boundary guard.

- [ ] **Step 5: Commit.** Message: `feat(engine): evaluateDeal orchestrator and public API`.
