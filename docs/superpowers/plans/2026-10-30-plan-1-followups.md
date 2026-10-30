# Plan 1 (engine) — follow-ups for Plans 2 and 3

Plan 1 shipped the calculation engine (`src/engine/`, 484 tests, golden spreadsheet matched to the cent). These items were found during per-task and final reviews and deliberately deferred. Plan 2 should open with the first group.

## Do first in Plan 2

1. **Validate the engine context.** Add Zod schemas and a `validateContext` for `Comp`, `MarketSettings`, `CostBookView` entries and `QuantityRules`, plus `today`. `evaluateDeal` should return an incomplete result, not throw, when context data is bad. Today, a malformed comp or `asOf` date, a non-12-entry seasonal curve, or `today: ""` throws. NaN or null prices flow through silently.
2. **Expose `scoredComps`** on `DealEvaluation`. The Market screen's comp table needs each comp's score and include flag.
3. **Upper bounds on counts.** Months and days have no ceilings. A huge `preConMonths` throws past year 9999, and a huge `domDays` makes the period loop run for a very long time.
4. **Selling refine float edge.** `0.7 + 0.2 + 0.1` passes `< 1`. Use `< 1 − 1e-9`.
5. **Similarity weights must sum to 100.** Validate this in settings, or normalize in `similarity`.
6. **Loan warning.** Key it off `base.cashFlow.extensions > 0` rather than `maxDomWithoutExtension`. The current value reports 0 days of headroom when the loan term is shorter than the build.
7. **Docs and golden script.** Update the Reference algorithm (plan, `scripts/golden/build_golden.py`) to describe the 1e-9 whole-month snap of `contract`/`saleClose` and the `+1e-9` in `maxDomWithoutExtension`. Add a financed golden scenario (land loan, capitalized interest, list-early) so the spreadsheet checks those paths too.

## Product decisions for the settings screen

- `minDownsideProfitCents` cannot be negative, so a builder can't accept a set downside loss.
- `minAnnualizedReturn` is capped at 100%.
- Bids for codes no longer in the takeoff (pool turned off, fireplaces set to 0) still count. Add a `bidForUnusedCode` warning.
- Undated sold comps get full recency and age credit.
- At very high LTC with large soft costs, the loan can draw before build start. This is the Reference algorithm today; decide whether loans should wait until the loan closes.
- Default prices for `utah-north` still need researching (milestone M7).

## Smaller cleanups (any time)

- **Boundary guard:** the regex flags `Date.now`/`from` in comments, misses `require()`, and scans `.ts` only.
- **CI:** no `permissions` block, and it double-runs on PRs. `@types/node` ^26 doesn't match Node 22.
- **Shared helpers:**
  - `zodIssues` lives in `house.ts`; move it to `result.ts`.
  - Exported defaults and fixtures are mutable; deep-freeze them.
  - `roundCents` is reused for non-money rounding; add a `roundHalfAway` helper.
- **Quantities and costs:**
  - Door and kitchen counts are hard-coded outside `QuantityRules`.
  - `resolvePrice` ignores unit mismatches.
  - `unitPriceCents` is typed `number`, not `Cents`.
- **Engine edge cases:**
  - `addMonths` doesn't check that `n` is an integer.
  - `gridOf` doesn't check that its bounds are finite.
  - The build-cost goal-seek value is the nominal total, not the realized one.
  - The `noPriceMid` reason is dropped in the roll-up.
  - The `missing` array is shared (aliased) across results.
- **Test gaps:**
  - Flooring/trim part quantities.
  - A full 29-row cost-code table lock.
  - Zero full baths.
  - Untested default coefficients.
  - A discriminating region-wiring test.
  - Literal grid price rows.
  - Lever reachability at a $500k price.
  - Assert the golden comps' types, not just cast them.
- **Wording and polish:**
  - Test titles that overstate what they check.
  - The `priceLabel` "at mid" vs "+1%" mismatch.
  - The "reruning" typo.

## Rulings made during Plan 1 execution

| Ruling | Why | If wrong |
|---|---|---|
| 0 garage bays → no garage wall term and no double door | No garage means neither exists | Slight under-count for garage-less houses |
| ADU plumbing +6 and kitchen cabinets 12 apply to any ADU | Only reading consistent with the spec and the sample values | Detached-ADU plumbing slightly over-counted |
| Every `EstimateLine` carries `takeoff` (unpriced parts) | Spec: a bid line still shows its quantity | One field to remove |
| `loan.extensionMonths ≥ 1` | The algorithm divides by it | Can't model a "no extensions" loan |
| `Period.pointsCents` = construction points only (land points sit in period-0 land purchase) | Matches the golden spreadsheet | Only the per-period split changes |
| Price-monotonicity property uses whole-dollar steps | Two fee roundings can lower net by 1¢ on a 1¢ step | Harmless 1¢ effect |
| "Recent" comp = sold ≤ 6 months ago (182 days yes, 183 no) | Same rule as similarity recency | One day's difference |
| Root-level `house`/`lot` validation paths map to those steps | They are house/lot issues | UI link only |
| Context validation and `scoredComps` deferred to Plan 2 | Shape depends on Plan 2's persistence and imports | Interim callers could crash the engine (no UI yet) |
| Loan draws before build start left as-is | It is the Reference algorithm; changing it is a spec decision | Small early draw plus one fee at very high LTC |
