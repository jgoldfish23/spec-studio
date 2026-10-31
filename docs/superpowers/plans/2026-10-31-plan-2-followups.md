# Plan 2 (app, demo mode): follow-ups for Plan 3

Plan 2 shipped the app in demo mode (localStorage). It has the Deals list, the deal frame, and the five steps (Lot, House, Estimate, Market, Pro forma). It also includes the Supabase schema with RLS tested on real Postgres, and a Supabase repository that isn't wired in yet.

At the end: 2,168 unit tests, 26 database tests, and 4 end-to-end specs, all green.

Each task and the whole branch were reviewed. The items below were found and deliberately deferred. Plan 3, which takes the app live on Supabase, should open with the first group.

## Do first in Plan 3 (going live on Supabase)

1. **Sign-up.** Create companies and memberships through a security-definer signup function, or with the service role. Users can't insert either row under RLS.
2. **Ids.** Mint UUIDs for every new deal and comp. The `comps.id` and `deals.id` columns are `uuid`, so the sample's `comp-1` and similar ids fail with 22P02. `getDeal` with a non-UUID id throws instead of returning null. Map 22P02 to null, or validate ids in the router.
3. **Saving on a closing page.** `pagehide` only *starts* a write. Over the network, the save needs `fetch` keepalive (or `sendBeacon`) to finish.
4. **Concurrent edits.**
   - `saveDeal` is an upsert, so a deal deleted in another tab or device comes back.
   - "Never two saves at once" holds per editor only. A remount can seed from a stale read before the old flush lands. Track in-flight saves per deal id.
   - Two tabs editing the same deal: last write wins, and no `storage`/realtime event is handled.
5. **RLS regression tests before go-live.** Show that:
   - a membership can't move companies;
   - users can't insert or update companies;
   - comps, the price book, market settings, company settings and default prices can't be re-parented to another company;
   - positive writes succeed where they should.

   Also:
   - Revoke `anon` default privileges.
   - Revoke EXECUTE on `is_member`/`set_updated_at` from `anon`.
   - Use `(select auth.uid())` inside `is_member` so the planner can cache it.
   - Repeat the revoke-then-grant pair in every migration. The exact-privileges test catches a miss.
6. **Comps library problems.** An unreadable comps store is silent, and the next save starts it over. Give comps a problems channel like deals have. Offer a download of the raw data before "Remove all".
7. **Paging.** `listDeals` and `getCostBook` have no pagination, and PostgREST `max-rows` can truncate them silently.

## Product decisions for the owner

- **Plan-level gaps against the spec.**
  - §6.1 Lot "permits/fees (from cost book)" was dropped without a refinement-table entry.
  - §7 timestamps are missing on four tables.
- **Validation blocks the whole evaluation.** Any single problem, such as an empty city, stops all of it. House and Estimate now say which step to fix, but computing quantities and the estimate when only lot or timeline fields are invalid would be friendlier.
- **Sample comps in older deals.**
  - Deals created *before* "Load sample deal" include the sample comps by default; new deals exclude them.
  - If the comps list hasn't loaded yet when the last sample deal is deleted, the comps cleanup is skipped.
- **Goal-seek range.** A lever whose search spans more than $10M reads "Not reachable with this alone" (the search-grid cap). That is far outside the $750K–$2M band.
- **Bid problem messages.** They read "Bid: …" without naming the field (vendor, amount).

## Performance

- House runs three full evaluations per pause (the tier previews). `evaluateDeal` takes 8–15 ms here, so likely 40–90 ms on a phone. Add an estimate-only entry point, or a `skipGoalSeek` option, for tier previews and Deals rows.
- The entry bundle is 550 kB; the step pages load lazily. The chunk warning limit is 600 kB, with a comment.

## Smaller cleanups (any time)

- **Shared UI constants are still duplicated:**
  - `focusRing` (4 copies)
  - `PRIMARY_BUTTON` (2 copies, with different classes)
  - `FIELD_GRID` / `FIELDS` (4 copies)
  - `type Edit` (2 copies)
  - several hard-coded hex colours instead of tokens

  A shared Button would remove most of them.
- **Accessibility:**
  - `ConfirmDialog` doesn't make the page behind it inert.
  - The save-failure alert is re-announced on every retry during a failure streak.
  - `$`/`%`/`sf` prefixes and suffixes aren't exposed to assistive tech.
  - Below `md`, the Deals card layout drops table semantics; labels come from CSS content.
- **Fields:**
  - Integer fields say "Enter a number" for 2.5. Several call sites add a "Whole …" hint; the House counts don't.
  - `TextField type="date"` overlaps `DateField`.
  - `NameDisplay` re-implements `TextField` styling.
- **Market:**
  - "Add comp" keeps a half-typed draft, while "Edit" discards one silently.
  - A comp sold fewer than 35 days after listing, with no contract date, shows "—" days without saying why.
- **Pro forma:**
  - Grid row prices are re-derived in the UI, because `GridCell` has no `priceCents`.
  - A check line can read "beats your 15.0% rule" at 15.02%.
- **Engine and data:**
  - Context numbers like `sfPerAcre` have no upper bounds.
  - `loan.termMonths` is required even when LTC is 0.
  - Extra `lot.utilities` keys survive reads.
  - `today` is frozen at first load (at most one day of drift).
- **Tests:**
  - A few still assert Tailwind classes.
  - `sample.test`/`starterCostBook.test` build their own engine context.
  - `HousePage.test.tsx` is over 1,000 lines.

## Rulings made during Plan 2 execution

| Ruling | Why | If wrong |
|---|---|---|
| Vitest projects split by file extension (`.ts` node, `.tsx` jsdom), not by folder | The plan's folder list left unit tests under `src/features` unrun | A `.ts` test that needs the DOM gets renamed |
| Test files may import engine fixtures; app code imports only `@engine` | App tests reuse golden fixtures | Tests would duplicate fixtures |
| Quantity-rule divisors must be > 0 | At 0 they produced Infinity/NaN with an ok result | Can't set a divisor to 0 (meaningless anyway) |
| React Router 8 instead of 7 | Same API; no reason to pin an old major | `npm i react-router@7` |
| Stored deals are validated structurally only | A half-filled draft must still load; fixable problems show as "Needs info" | A structurally odd deal could reach a screen; the engine still blocks evaluation |
| An edit during a save waits its own 1 s after that save | Avoids back-to-back saves on a slow backend | The last edit lands up to 1 s later |
| An engine exception is caught in the editor (`failedEvaluation`), and the page stays usable with a "Couldn't calculate — details" panel and input hash | Spec §8; the old route-level catch saved the bad edit and locked the deal | One engine export |
| Confirm dialogs are in-app, never `window.confirm` | Native dialogs are blocked in the sandboxed demo iframe | One small component |
| Money and percent negatives use U+2212; percent *input* text keeps ASCII "-" | Matches the engine's `formatUsd`; `parsePercent` reads ASCII | One glyph |
| Pool/ADU "None" sets `{type: "none"}` | The schema requires both objects | Schema change |
| The engine exports `listYearMonth` and `LIMITS` | The DOM card needs the list month; field ranges must match the schema | Remove the exports, and add a field to `DomEstimate` |
| Five profit blues plus orange; grid shows days across, prices down | The engine has five profit bands; matches the engine and the mockup | Swap the palette or the axes |
| Break-even at 0 days reads "loses money even if it sells right away" | The brief's copy assumed a profitable base case | One string |
| Edits are flushed on `pagehide`/hidden, and the browser asks before closing while saves are failing | Spec §8: never silently drop edits | Listeners only |
| Sample comps are tagged, left out of new deals, and removed with the last sample deal | They were feeding real deals' verdicts | A different marker |
| Garage bays, lot acres and county are required on a comp | Blank-as-0 shifted the price estimate by tens of thousands | Two more required boxes |
| A blocked browser store falls back to memory, with a "not saved" notice | The demo's iframe can block storage, which gave a blank page | — |
