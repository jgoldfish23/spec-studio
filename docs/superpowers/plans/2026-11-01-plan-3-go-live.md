# Spec Studio — Plan 3: Go Live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner signs in with an emailed link or code. Deals, comps and settings save to Supabase, scoped to his company, with an on-device copy that syncs after a dropped connection. He can edit go/no-go rules and market settings, export and import all data, and print a lender package. The app is deployed to his Cloudflare account. Demo mode keeps working as before.

**Architecture:**
- **Two build modes from one codebase.** With `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set, the build is **hosted**: an auth gate, then a company gate, then the app on a Supabase repository wrapped in an **offline outbox**. With neither set, the build is **demo**, exactly as Plan 2 shipped it.
- **Conflicts are surfaced, never silently overwritten.** `saveDeal` checks the deal's `updatedAt` against the stored row. A mismatch is a conflict and a missing row is a deletion, and the editor offers the owner a choice.
- **Database changes go through numbered migrations** applied by a small runner (`npm run db:migrate`), tested on throwaway Postgres like Plan 2. Deploys run from GitHub Actions to Cloudflare Pages.

**Tech Stack:**
- Unchanged from Plan 2: React 19, Vite, Tailwind v4, React Router 8 (hash routes), TanStack Query v5, Zod 4, Vitest, Playwright 1.64.1, `pg`.
- `@supabase/supabase-js` v2 (already a dependency), now used for real: auth with the PKCE flow, PostgREST and RPC.
- New dev dependencies: `yaml`, used to read workflow files in tests, and `wrangler`, pinned and used only in CI.

**Spec:**
- `docs/superpowers/specs/2026-10-30-spec-studio-deal-analyzer-design.md` (§2, §3, §4, §6.2, §6.3, §7, §8, §10 M4/M6/M7, §11).
- Follow-ups this plan closes: `docs/superpowers/plans/2026-10-31-plan-2-followups.md` ("Do first in Plan 3").
- Plan 2's constraints and refinements still bind: `docs/superpowers/plans/2026-10-31-plan-2-app.md`.

## Decisions that refine the spec (made while planning; the owner chose "go live first")

| Spec says | This plan does | Why |
|---|---|---|
| §10 M6: cost book, comps library, CSV import, Claude-file import, bid PDFs | **Plan 4** | The owner chose to go live first. |
| §5.8 snapshots / "re-run with today's numbers"; §7 `evaluation_snapshots` | **Plan 4**, together with the cost book screen | Snapshots matter once prices change through the app, and that happens in Plan 4. |
| §10 M7 starter cost book research | **Plan 4** (with the cost book screen) | Same reason. The starter book ships as global rows now (Task 2). |
| §6.1 Lot "permits/fees (from cost book)", "soils report status" | **Plan 4** | Permits and fees are cost-book items. The soils status drives no number. |
| §6.2 "edits stay in local storage and sync when back" | An **outbox** per signed-in user in `localStorage`. It is written *before* the network call, so a closing page never loses an edit. | This also closes the Plan 2 follow-up "pagehide only starts a write". |
| §4 "email magic-link login" | Magic link **and** the 6-digit code from the same email | A link opened on another device (the phone's mail app) can't finish a PKCE sign-in. Typing the code works anywhere. |
| "Import your demo deals on first sign-in" (planning summary) | **Export from the demo, import into the account** (a file, or paste) | The demo runs on a different web origin than the live site, so the live site can't read the demo's browser storage. Export and import also serve as backup and restore. |
| §6.1 Settings: quantity rule coefficients | Shown **read-only** | As the spec says for Phase 1. |
| Go/no-go rules editable | Company rules are the defaults for new deals (Settings). Each deal's own rules are editable on Pro forma, with "Use company rules". | Rules live inside each deal's inputs (Plan 2). This keeps old verdicts stable when the defaults change. |
| Sign-ups | The owner signs up once, then turns off "Allow new users to sign up" in Supabase (`docs/deploy.md`) | §2: single user at first. RLS already isolates companies; this stops strangers making accounts. |

## Global Constraints

- **Carried over.** Every Plan 2 Global Constraint still applies:
  - the engine boundary;
  - integer cents;
  - money and percent display;
  - timing: 150 ms evaluation, 1 s autosave, 5 s retry;
  - the design tokens;
  - accessibility: labels, icon plus text, 4.5:1 contrast, 44 px targets, 390 px width;
  - `base: "./"`, test commands and commit trailers.
- **Build modes.** Hosted mode needs both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Demo mode is neither. Exactly one set is a configuration error, shown on screen as "Spec Studio isn't configured correctly: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither."
- **Demo mode stays network-free.** The demo build and all Plan 2 e2e specs keep passing unchanged.
- **Secrets.**
  - Only the anon key (public by design) reaches the browser.
  - The service-role key, database URL, Cloudflare token and account id live only in GitHub Actions secrets. They never go in the repo, the bundle or logs.
  - A test greps `dist/` for `service_role` and `postgres://` and fails if either is found.
- **Timestamps.**
  - `updatedAt` / `createdAt` from the database are passed through **verbatim**, with microseconds and offset. They are never re-formatted, because the conflict check compares them exactly.
  - Local timestamps stay `new Date().toISOString()`.
- **Ids.** Every new deal and comp id is a v4 UUID. A non-UUID id is never sent to Supabase.
- **Region.** Still only `"utah-north"`.
- **Error copy.** Name what happened and what to do, in the owner's words, never a raw Supabase or Postgres message. Every Supabase/PostgREST error is mapped to a `DataError` with a `kind` (Task 3).
- **Database.**
  - Every new table and function follows the 0001 pattern: `revoke all … from anon, authenticated`, then grant exactly what's needed.
  - The exact-privileges test covers every new object.
  - Migrations are append-only: an applied file never changes.

## Review Focus

1. **A sign-in link opened in a different browser.** For example, the iPad's mail app. The PKCE exchange fails ("code verifier not found"). The owner should see: "This link was opened in a different browser than the one that asked for it. Type the 6-digit code from the same email instead." The code box is shown, and he is never left on a blank screen or a loop. → Task 8 test.
2. **The session expires, or another person signs in on the same device, mid-edit.**
   - Saves fail as signed-out. Edits stay in that user's outbox, and the header says "Signed out — sign in to sync. Your changes are saved on this device."
   - When the same user signs back in, the outbox syncs.
   - When a different user signs in, they never see or sync the first user's outbox.

   → Task 5 and Task 9 tests.
3. **Reloading while offline with unsynced edits.** The deal opens from the outbox copy, not the stale server copy, and the Deals list shows the locally edited name. → Task 5 test.
4. **Importing the same export twice.** No duplicate deals or comps. The preview lists what will be skipped and why. → Task 11 test.
5. **Supabase is unreachable at startup.** For example, on a job site with one bar. The owner sees "Can't reach Spec Studio's server. Check your connection, then try again." with a **Try again** button. Not a blank page or an endless spinner. → Task 9 test.

---

### Task 1: Database hardening and company sign-up function

**Files:**
- Create: `supabase/migrations/0002_go_live.sql`
- Test: `tests/db/goLive.test.ts`; extend `tests/db/rls.test.ts` only if a shared helper is needed.

**Interfaces:**
- Produces, for the Supabase gateways (Task 7):
  - SQL function `public.create_company(p_name text, p_rules jsonb, p_contingency_pct numeric) returns uuid`
  - error codes: `SS001` (not signed in), `SS002` (already a member), `SS003` (bad name)

- [ ] **Step 1: Write the failing tests** in `tests/db/goLive.test.ts`. Use the existing `tests/db/helpers.ts` (`asUser`, the fresh database per file).
  - `create_company` called as a signed-in user with name "City Creek Construction":
    - returns a uuid;
    - creates the company with `default_region = 'utah-north'`, an `owner` membership for `auth.uid()`, and a `company_settings` row holding the given rules and contingency.
  - Calling it again as the same user raises `SS002`. Calling it with no `auth.uid()` raises `SS001`.
  - Name validation raises `SS003` for each of: `''`, `'   '`, a 121-character name.
  - `anon` cannot execute `create_company` or `is_member`. Assert `permission denied`.
  - **Regression checks deferred from Plan 2:**
    - an `authenticated` member cannot `update memberships set company_id = <other>`;
    - cannot `insert`/`update` `companies` directly;
    - cannot move a `comps`, `price_book_entries`, `market_settings`, `company_settings` or company `default_prices` row to another company;
    - **can** insert, update and delete its own `price_book_entries`, `market_settings`, `company_settings` and company `default_prices` rows.
  - **Timestamps:** every table in `public` has `created_at` and `updated_at`. Query `information_schema.columns`. Each `updated_at` changes on update.
  - **Default privileges:** a table created by the migration owner after 0002 grants `anon`/`authenticated` nothing. Create a scratch table in the test and check `information_schema.role_table_grants`.
  - The existing exact-privileges test in `rls.test.ts` still passes, now including any new table.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (function missing).
- [ ] **Step 3: Write `0002_go_live.sql`.**
  - `create_company`:
    - `security definer`, `set search_path = ''`.
    - Trim the name. Reject empty or > 120 characters with `SS003`.
    - Reject `auth.uid() is null` with `SS001`, and an existing membership with `SS002`.
    - Insert the three rows.
    - `revoke all on function … from public, anon`, then `grant execute … to authenticated`.
  - Rewrite `is_member` with `(select auth.uid())`, and apply the same revoke/grant.
  - Add `created_at`/`updated_at` plus the `set_updated_at` trigger to every table that lacks them: `memberships`, `default_prices`, `price_book_entries`, `market_settings`, `company_settings`.
  - Run these four, in this order:
    - `alter default privileges in schema public revoke all on tables from anon, authenticated;`
    - `alter default privileges in schema public revoke execute on functions from public, anon;`
    - `revoke execute on function public.set_updated_at() from public, anon, authenticated;`
    - `revoke all on all functions in schema public from anon;`
  - Comment each block with why.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, the 26 existing tests plus the new ones.
- [ ] **Step 5: Commit**: `feat(db): company sign-up function, timestamps everywhere, tighter grants`.

---

### Task 2: Migration runner and the starter cost book as global rows

**Files:**
- Create:
  - `scripts/db/migrate.mjs`
  - `src/data/supabase/starterSeed.ts` with test
  - `supabase/migrations/0003_starter_cost_book.sql` (generated)
  - `tests/db/migrate.test.ts`
  - `tests/db/starterSeed.test.ts`
- Modify: `package.json` (add `"db:migrate": "node scripts/db/migrate.mjs"`)

**Interfaces:**
- Produces:
  - `starterSeedSql(prices: readonly DefaultPrice[]): string`
  - CLI `npm run db:migrate [-- --dry-run]`, which reads `DATABASE_URL`

- [ ] **Step 1: Write failing tests.**
  - `starterSeed.test.ts` (node project):
    - `starterSeedSql(STARTER_COST_BOOK)` equals the committed `0003_starter_cost_book.sql` byte for byte.
    - With `UPDATE_SEED=1` set, the test writes the file instead. Document that in a one-line file header comment.
    - The SQL inserts global rows (`company_id` null) with `on conflict do nothing`.
    - Strings are escaped (a `source_note` containing `'` round-trips).
  - `tests/db/starterSeed.test.ts`: after migrations, `default_prices where company_id is null` has `STARTER_COST_BOOK.length` rows, readable by an `authenticated` member and not writable by them.
  - `tests/db/migrate.test.ts`, run against a fresh database with the shim applied:
    - the runner applies 0001–0003 and records them in `spec_studio_meta.schema_migrations (filename, checksum, applied_at)`;
    - a second run applies nothing and prints "Up to date";
    - after a test edits a copy of an applied file (point the runner at a temp migrations directory through `MIGRATIONS_DIR`), it exits 1 with "0001_init.sql has changed since it was applied";
    - a failing migration rolls back only that file and leaves earlier ones recorded;
    - `--dry-run` lists pending files and applies nothing;
    - `spec_studio_meta` is not readable by `anon` or `authenticated`.
- [ ] **Step 2: Run** `npm test` and `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `migrate.mjs`:
    - Plain ESM; uses `pg`.
    - Creates the meta schema and table if they are missing, and revokes them from public, anon and authenticated.
    - Applies each pending file in its own transaction.
    - Uses a sha256 checksum of the file bytes.
    - Logs one line per file. Never logs the URL.
  - Generate `0003` with `UPDATE_SEED=1 npx vitest run src/data/supabase/starterSeed.test.ts`.
- [ ] **Step 4: Run** `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(db): migration runner and starter cost book as shared rows`.

---

### Task 3: Repository: conflicts, deletions, error kinds, UUIDs, paging

**Files:**
- Modify:
  - `src/data/types.ts` (`DataError`, `Repository.saveDeal`)
  - `src/data/local/localRepository.ts`
  - `src/data/supabase/supabaseRepository.ts`
  - `src/data/supabase/mappers.ts` (timestamps verbatim)
  - `src/data/sample.ts` (sample comp ids)
- Test: the matching `*.test.ts` files.

**Interfaces:**
- Produces:
  - `type DataErrorKind = "unreadable" | "conflict" | "deleted" | "offline" | "signedOut" | "failed"`
  - `DataError.kind: DataErrorKind`. The constructor takes `{ kind? }` and defaults to `"unreadable"`, so existing callers keep their meaning.
  - `Repository.saveDeal(deal: StoredDeal, options?: { overwrite?: boolean }): Promise<StoredDeal>`
    - throws `kind: "conflict"` when the stored `updatedAt` ≠ `deal.updatedAt` (skipped with `overwrite`);
    - throws `kind: "deleted"` when no row exists (even with `overwrite`).
  - `SAMPLE_COMP_IDS` become fixed v4 UUIDs: `5a3e0c0e-5a3e-4000-8000-00000000000N`, N = 1…8 in sample order.
  - `isUuid(id: string): boolean` in `src/lib/uuid.ts`.

- [ ] **Step 1: Write failing tests.**
  - **Both repositories:**
    - Saving a deal whose `updatedAt` is stale (another save happened in between) throws `DataError` `kind: "conflict"` with message "This deal was changed on another device or tab."
    - `overwrite: true` saves anyway.
    - Saving a deal whose row was deleted throws `kind: "deleted"` with "This deal was deleted on another device or tab." That holds with `overwrite` too.
    - A normal save returns a fresh `updatedAt`.
  - **Supabase, at the `fakeFetch` boundary:**
    - `saveDeal` issues `PATCH /rest/v1/deals?id=eq.<id>&updated_at=eq.<exact stored string>` with `Prefer: return=representation`, never an upsert.
    - An empty response triggers one `GET ?select=id,updated_at&id=eq.<id>` to tell conflict from deleted.
    - `overwrite` drops the `updated_at` filter.
    - `getDeal("abc")` returns `null` with **zero** requests.
    - `listDeals`, `listComps` and both `getCostBook` queries page with `Range` 0–999, then 1000–1999, stopping on a short page. Use a fake returning 1000 rows, then 1.
    - The mapper keeps `updated_at: "2026-11-01T02:17:17.123456+00:00"` verbatim.
    - Error mapping:
      - `fetch` rejecting with `TypeError` gives `kind: "offline"`, message "Can't reach the server — check your connection."
      - HTTP 401, or PostgREST `PGRST301`/`PGRST303`, gives `kind: "signedOut"`, message "You've been signed out."
      - Anything else gives `kind: "failed"`, message "Couldn't save — the server said no. Try again in a minute." Log the raw error with `console.error` once.
  - **Local:** on open, a store holding the legacy sample ids `comp-1…comp-8` rewrites them to the new UUIDs, in both the comps store and every deal's `compSelections` keys, once. After the rewrite, no `comp-` id remains, and the deals still read back.
  - **Sample:** every `sampleComps()` id passes `isUuid`. `SAMPLE_COMP_IDS` has the 8 fixed values.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** The editor's save path passes the deal it got from the last save, and the query cache already updates after each save (Plan 2), so `updatedAt` stays current without other changes. Check that and say so in the report.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(data): conflict and deletion checks on save, UUID ids, paging, error kinds`.

---

### Task 4: Repository: saving settings

**Files:**
- Modify:
  - `src/data/types.ts`
  - `src/data/local/localRepository.ts`
  - `src/data/supabase/supabaseRepository.ts` and `mappers.ts`
  - `src/data/queries.ts`
  - `src/data/readBack.ts`
- Test: the matching test files.

**Interfaces:**
- Produces:
  - `Repository.saveCompanySettings(settings: CompanySettings): Promise<CompanySettings>`
  - `Repository.saveMarketSettings(settings: MarketSettings): Promise<MarketSettings>` (the region is inside `settings`)
  - Hooks, each invalidating its query key:
    - `useSaveCompanySettings()` → `queryKeys.companySettings`
    - `useSaveMarketSettings()` → `queryKeys.marketSettings(region)`, plus `queryKeys.costBook(region)` (unaffected; leave it alone)

- [ ] **Step 1: Write failing tests.**
  - **Both repositories:**
    - A saved company setting reads back from `getCompanySettings()`.
    - A saved market setting reads back from `getMarketSettings("utah-north")`.
    - Settings that fail `CompanySettingsSchema` / `MarketSettingsSchema` are refused before any write, with `DataError` "Couldn't save — <first problem>".
    - Unsaved settings still fall back to the defaults (unchanged).
  - **Supabase:**
    - `POST /rest/v1/company_settings` with `Prefer: resolution=merge-duplicates,return=representation` and `on_conflict=company_id`.
    - `market_settings` with `on_conflict=company_id,region`.
    - Each body holds exactly the expected columns.
  - **Local:** the storage keys are `spec-studio:company-settings` and `spec-studio:market-settings:<region>`. An unreadable stored value falls back to the defaults and shows up via `console.error` once. It isn't silently dropped.
  - **Queries:** after `useSaveCompanySettings().mutateAsync`, `useCompanySettings()` returns the new value. An engine context re-read picks up new market settings.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(data): save company and market settings`.

---

### Task 5: Offline outbox

**Files:**
- Create: `src/data/offline/offlineRepository.ts` and test.

**Interfaces:**
- Produces:
  - `createOfflineRepository(remote: Repository, storage: Storage, scope: string): OfflineRepository`
  - `interface OfflineRepository extends Repository { pending(): PendingSave[]; subscribe(listener: () => void): () => void; syncNow(): Promise<SyncResult> }`
  - `PendingSave = { dealId: string; dealName: string; queuedAt: string; problem?: "conflict" | "deleted" }`
  - `SyncResult = { synced: number; remaining: number; stoppedOffline: boolean }`
  - Storage key: `spec-studio:outbox:<scope>`. The scope is the signed-in user's id.

- [ ] **Step 1: Write failing tests**, using `MemoryStorage` and a scripted fake remote.
  - **`saveDeal`:**
    - Writes the outbox entry **before** calling the remote. Assert storage holds it when the remote's `saveDeal` is entered.
    - Removes the entry on success, but only if it is still the same entry. A newer queued save survives an older success.
    - On remote `offline`, it keeps the entry and rethrows `DataError` `kind: "offline"`, message "Offline — your changes are saved on this device and will sync."
    - On `signedOut`, it keeps the entry and rethrows with "Signed out — sign in to sync. Your changes are saved on this device."
    - On `conflict`/`deleted`, it keeps the entry with `problem` set and rethrows unchanged.
  - **`getDeal`:**
    - With an entry for that id, it returns the outbox copy. Its `updatedAt` is the base the edit started from, so the next save is still checked.
    - When the remote is offline and there is no entry, it rethrows `offline`.
    - When the remote is offline and there is an entry, it returns the entry. **(Review Focus 3.)**
  - **`listDeals`:** outbox copies replace their remote rows, so a renamed deal shows its local name. A remote that is offline but has entries gives the entries plus a problem "Showing what's saved on this device — can't reach the server."
  - **`syncNow`:**
    - Replays entries oldest first. It stops at the first `offline` (`stoppedOffline: true`) and marks `conflict`/`deleted` entries without retrying them.
    - Notifies subscribers after every change.
    - Two concurrent calls don't double-save.
  - **Isolation:** two scopes (users) never see each other's entries. **(Review Focus 2.)**
  - Every method other than deals passes straight through.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(data): offline outbox that keeps unsynced edits on the device`.

---

### Task 6: Deal editor: offline, signed-out, conflict and deletion states

**Files:**
- Modify:
  - `src/features/deal/autosaver.ts`
  - `src/features/deal/useDealEditor.ts`
  - `src/features/deal/DealLayout.tsx`
- Create: `src/features/deal/SaveProblem.tsx`
- Test: `autosaver.test.ts`, `useDealEditor.test.tsx`, `DealLayout.test.tsx`

**Interfaces:**
- Produces:
  - `SaveStatus` error variant becomes `{ kind: "error"; message: string; reason: DataErrorKind | "unknown" }`.
  - Autosaver option `shouldRetry?: (error: unknown) => boolean`, default always true. The editor passes `false` for `conflict`/`deleted`.
  - The editor gains:
    - `keepMine(): void` (saves now with `overwrite`)
    - `loadTheirs(): Promise<void>` (drops local changes and the outbox entry, re-reads and re-seeds)
    - `saveAsNewDeal(): Promise<string>` (creates a deal from the current name and inputs, returns its id)

- [ ] **Step 1: Write failing tests.**
  - **Autosaver:** `shouldRetry` false means no 5 s retry and the status stays `error`. A later edit tries again.
  - **Editor and layout:**
    - **Offline:**
      - `reason: "offline"` shows a neutral note, "Offline — saved on this device, will sync". It is not `role="alert"`.
      - The `beforeunload` prompt does **not** fire, because the edit is safe on the device.
      - The retry continues.
    - **Signed out:** `reason: "signedOut"` shows "Signed out — sign in to sync. Your changes are saved on this device." with a **Sign in** link (`#/sign-in`). No prompt.
    - **Conflict:**
      - `reason: "conflict"` shows an alert: "This deal was changed on another device or tab."
      - It offers **Load their version** and **Keep mine**. Keep mine saves with `overwrite`; the repository then holds the local inputs and the status reaches "Saved".
      - Load their version replaces the inputs with the stored ones and clears undo history.
      - No retry happens in between.
    - **Deleted:**
      - `reason: "deleted"` shows "This deal was deleted on another device or tab."
      - It offers **Save as a new deal** (navigates to the new deal's same step, with the edits kept) and **Discard my changes** (goes to Deals).
    - Every other error keeps Plan 2's behaviour and copy.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(app): say when a deal is offline, signed out, changed or deleted elsewhere`.

---

### Task 7: Auth and company gateways

**Files:**
- Create:
  - `src/data/supabase/client.ts`
  - `src/data/auth/authGateway.ts`
  - `src/data/auth/supabaseAuth.ts` with test
  - `src/data/auth/companyGateway.ts`
  - `src/data/auth/supabaseCompany.ts` with test
  - `src/data/testing/fakeAuth.ts`
  - `src/features/auth/AuthProvider.tsx` with test

**Interfaces:**
- Produces:
  - `createSupabase(config: { url: string; anonKey: string }, storage: Storage): SupabaseClient`
    - `auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage }`. The app does the URL exchange itself (Task 8).
  - `interface AuthGateway`:
    - `currentUser(): Promise<AuthUser | null>`
    - `onChange(listener: (user: AuthUser | null) => void): () => void`
    - `sendSignInEmail(email: string, redirectTo: string): Promise<void>`
    - `verifyCode(email: string, code: string): Promise<AuthUser>`
    - `exchangeLinkCode(code: string): Promise<AuthUser>`
    - `signOut(): Promise<void>`
  - `AuthUser = { id: string; email: string }`
  - `class AuthError extends Error { reason: "rateLimited" | "badCode" | "otherBrowser" | "offline" | "failed" }`
  - `interface CompanyGateway`:
    - `myCompany(): Promise<Company | null>`
    - `createCompany(name: string, settings: CompanySettings): Promise<Company>`
  - `Company = { id: string; name: string; defaultRegion: string }`
  - `createFakeAuth(options?)`, `createFakeCompanies()`
  - `AuthProvider` and `useAuth(): { status: "loading" | "signedOut" | "signedIn"; user?: AuthUser; auth: AuthGateway }`

- [ ] **Step 1: Write failing tests.** These are `fakeFetch` tests on a real `createClient`, the pattern from Plan 2 Task 8.
  - `sendSignInEmail` posts to `/auth/v1/otp` with the email, `create_user: true`, and `redirect_to`.
  - `verifyCode` posts to `/auth/v1/verify` with `type: "email"`.
  - Error mapping:
    - HTTP 429 maps to `rateLimited`: "Too many tries — wait a minute, then try again."
    - An invalid or expired token maps to `badCode`: "That code didn't work or has expired. Send a new one."
    - A missing PKCE code verifier, on exchange, maps to `otherBrowser`: "This link was opened in a different browser than the one that asked for it. Type the 6-digit code from the same email instead."
    - A `fetch` `TypeError` maps to `offline`.
  - `myCompany` reads `memberships?select=company_id,companies(id,name,default_region)` and returns `null` when there are no rows.
  - `createCompany` calls `rpc/create_company` with `p_name`, `p_rules` and `p_contingency_pct`. Mapped errors:
    - `SS002` → "You already have a company."
    - `SS003` → "Enter a company name of 120 characters or fewer."
    - `SS001` → `signedOut`.
  - `AuthProvider`:
    - goes from `loading` to `signedOut`/`signedIn`;
    - follows `onChange`;
    - unsubscribes on unmount.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(auth): Supabase sign-in and company gateways, with fakes for tests`.

---

### Task 8: Sign-in, link callback and company setup screens

**Files:**
- Create:
  - `src/features/auth/SignInPage.tsx` with test
  - `src/features/auth/CreateCompanyPage.tsx` with test
  - `src/features/auth/linkCallback.ts` with test
  - `src/features/auth/AccountMenu.tsx` with test

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `handleLinkCallback(location: Location, auth: AuthGateway): Promise<{ handled: boolean; error?: AuthError }>`. It exchanges `?code=` and then strips `code` from the URL with `history.replaceState`, keeping the hash route.
  - `redirectUrl(location: Location): string` returns `origin + pathname`, with no query and no hash.
  - `<SignInPage auth />`, `<CreateCompanyPage companies onCreated />`, `<AccountMenu user pendingCount onSignOut />`

- [ ] **Step 1: Write failing tests.**
  - **SignInPage:**
    - Heading "Sign in to Spec Studio". Email field labelled "Email". Button "Email me a sign-in link".
    - An invalid email shows "Enter an email address" and sends nothing.
    - After sending, it shows "Check your email" and "We sent a link and a 6-digit code to <email>.", a "6-digit code" field, a **Sign in** button and **Use a different email**.
    - The code field accepts only 6 digits; anything else shows "Enter the 6-digit code".
    - Each `AuthError` reason shows its copy.
  - **Link callback:**
    - `?code=abc#/deals` with a successful exchange signs in and leaves the URL `…/#/deals`.
    - An exchange failing with `otherBrowser` shows SignInPage with that message **and the code entry open**. **(Review Focus 1.)**
    - No `code` means `handled: false`.
  - **CreateCompanyPage:**
    - Heading "Name your company". Field "Company name". Button "Create company".
    - A blank name, or more than 120 characters, shows the inline error. The gateway errors show their copy.
    - On success it calls `onCreated(company)` with the company settings `{ rules: DEFAULT_RULES, contingencyPct: 0.05 }`.
  - **AccountMenu:**
    - Shows the email and **Sign out**.
    - With `pendingCount > 0`, Sign out asks first through `ConfirmDialog`: "2 changes haven't synced yet. Sign out anyway? They stay on this device and sync the next time you sign in here."
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement (forms reuse `src/ui` fields and `stepShared` buttons), then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(auth): sign-in with link or code, company setup, account menu`.

---

### Task 9: Hosted mode wiring

**Files:**
- Create:
  - `src/config.ts` with test
  - `src/HostedRoot.tsx` with test
  - `src/DemoRoot.tsx` (moved from `main.tsx`)
  - `src/data/offline/useOutboxSync.ts` with test
- Modify:
  - `src/main.tsx`
  - `src/features/app/AppShell.tsx` (account menu, sync note)
  - `src/App.tsx` (route `#/sign-in`: in hosted mode it clears a stale session and shows SignInPage, and after sign-in it returns to `#/deals`; in demo mode it redirects to `#/deals`)

**Interfaces:**
- Produces:
  - `readAppConfig(env: Record<string, string | undefined>): AppConfig`, where `AppConfig = { mode: "demo" } | { mode: "hosted"; supabaseUrl: string; supabaseAnonKey: string }`. Throws `ConfigError` with the Global Constraints copy.
  - `<HostedRoot config storage />`
  - `useOutboxSync(repo: OfflineRepository): { pendingCount: number; syncing: boolean }`. It syncs on mount, on `window` `online`, and every 30 s while anything is pending.

- [ ] **Step 1: Write failing tests.**
  - `readAppConfig`: no variables → demo; both set → hosted; one set → `ConfigError`; a non-https URL → `ConfigError` (except `http://localhost…` and `http://*.test`, which tests use).
  - `HostedRoot` with the fake auth and company gateways:
    - loading → SignInPage → CreateCompanyPage → the Deals page.
    - The repository is `createOfflineRepository(createSupabaseRepository(client, company.id), storage, user.id)`.
    - The query cache is cleared when the user changes.
    - **Unreachable at startup** (the gateway throws `offline`): "Can't reach Spec Studio's server. Check your connection, then try again." with **Try again**, which retries. **(Review Focus 5.)**
  - **Session ends mid-edit:** the fake auth fires a signed-out change while a deal has an unsaved edit. The gate shows SignInPage, the unmounting editor's flush lands in user A's outbox, and signing back in as A syncs it.
  - **User switch:** user A has a pending outbox entry and signs out. User B signs in and sees no pending count. A signs back in and the entry syncs. **(Review Focus 2.)**
  - `useOutboxSync`: syncs on mount; syncs again on `online`; polls every 30 s only while there are pending entries (fake timers).
  - **AppShell:**
    - Hosted mode shows the AccountMenu in place of the demo pill.
    - "2 changes waiting to sync" shows while there are pending entries, as a polite live region announced only when the count changes.
    - Demo mode is unchanged. Every Plan 2 shell test still passes.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes. Also run `npm run build` (demo) and confirm the bundle has no Supabase URL.
- [ ] **Step 5: Commit**: `feat(app): hosted mode — sign-in gate, company gate, Supabase with offline outbox`.

---

### Task 10: Settings screen and per-deal rules

**Files:**
- Create:
  - `src/features/settings/SettingsPage.tsx`, with section components in the same folder, plus tests split by section
- Modify:
  - `src/App.tsx` (route `#/settings`)
  - `AppShell.tsx` (nav item "Settings")
  - `DealsPage.tsx` (rules card **Edit** links to Settings)
  - `src/features/proforma/` "Your rules" card

**Interfaces:**
- Consumes: Task 4 hooks; `RulesSchema`, `MarketSettingsSchema`, `DEFAULT_QUANTITY_RULES`, `LIMITS` from `@engine`.

- [ ] **Step 1: Write failing tests.**
  - **Go/no-go rules for new deals:**
    - Fields: "Minimum margin on sale price" (%), "Minimum annualized return on cash" (%), "Minimum downside case profit" ($), and "Contingency for new deals" (%).
    - **Save changes** stores them through `saveCompanySettings`. "Saved" shows.
    - A new deal created afterwards carries the new rules and contingency.
    - Out-of-range values show the schema's message and block Save.
  - **Market settings — Northern Utah (Davis & Weber):**
    - Market condition: a `SegmentedControl` of Hot | Normal | Slow.
    - Fields: Default property tax rate (%), Basement value factor, Price elasticity, Include comps scoring at least (0–100), Assumed days from contract to close.
    - Feature values: Garage bay, Walkout, Lot per acre, ADU and Pool, each in $.
    - Similarity weights must total 100 ("Weights must add up to 100 — now 95").
    - Seasonal factors: 12 fields labelled January–December, with the note "1.00 is an average month".
    - **Save changes** stores them through `saveMarketSettings`. An open deal's evaluation then uses them; assert the DOM estimate changes after a seasonal edit.
  - **Quantity rules:** a read-only table of `DEFAULT_QUANTITY_RULES`, with the note "Read-only for now."
  - Unsaved edits plus navigating away asks first: "You have unsaved settings. Leave without saving?" (via `ConfirmDialog`).
  - **Pro forma, "Your rules":**
    - The three fields are editable per deal and autosaved like every other input.
    - **Use company rules** copies the company rules into the deal.
    - The old "Edit in Settings (later)" note is gone.
  - **Nav:** "Settings" is enabled with `aria-current` on `#/settings`. The Deals rules card **Edit** goes to Settings.
  - At 390 px nothing scrolls the page sideways. Add `#/settings` to the e2e layout spec.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(app): settings for go/no-go rules and market, per-deal rules on pro forma`.

---

### Task 11: Export all data and import an export

**Files:**
- Create:
  - `src/data/exportFile.ts` with test
  - `src/features/settings/YourDataCard.tsx` with test
  - `src/features/settings/ImportPreview.tsx` with test
- Modify: `DealsPage.tsx` ("Remove all" offers "Download a copy first").

**Interfaces:**
- Produces:
  - `EXPORT_FORMAT = "spec-studio-export/v1"`
  - `buildExport(repo: Repository, region: string, now: string): Promise<ExportFile>`
  - `ExportFile = { format; exportedAt; deals: StoredDeal[]; comps: Comp[]; companySettings; marketSettings: MarketSettings[]; priceBook: PriceBookEntry[] }`
  - `parseExport(text: string): { ok: true; file: ExportFile } | { ok: false; message: string }`
  - `planImport(file: ExportFile, existing: { deals: StoredDeal[]; comps: Comp[] }): ImportPlan` (pure)
  - `runImport(repo: Repository, plan: ImportPlan): Promise<ImportReport>`
  - `exportFileName(now: string): string` returns `"spec-studio-export-YYYY-MM-DD.json"`

- [ ] **Step 1: Write failing tests.**
  - `buildExport` on the sample deal: `parseExport(JSON.stringify(file))` round-trips to an equal file.
  - `parseExport`:
    - Not JSON gives "That isn't a Spec Studio export file."
    - The wrong `format` gives "This file is from a different version of Spec Studio (<format>)."
    - A schema failure gives "This export has a problem: <first issue>."
  - `planImport`:
    - Deals whose name matches an existing deal are skipped with the reason "already in your account".
    - Comps matching an existing comp by address and sold date are skipped.
    - Non-UUID ids get new UUIDs, and `compSelections` keys are remapped to the new comp ids.
    - Settings import only when the owner ticks "Also replace my settings". The default is off.
    - **Importing the same export twice adds nothing the second time.** **(Review Focus 4.)**
  - `runImport`: saves comps first, then creates deals, and reports "Imported 3 deals and 8 comps. Skipped 1 deal already in your account."
  - **YourDataCard:**
    - **Export all data** downloads `exportFileName`. Assert the anchor's `download` attribute and blob type `application/json`.
    - **Copy to clipboard** calls `navigator.clipboard.writeText` (mocked). On rejection it falls back to a selectable text box.
    - **Import an export** accepts a file input or pasted text, shows the `ImportPreview` (counts and skip reasons), then **Import** runs it.
    - In demo mode the same card works. That is how the owner moves demo deals into his account.
  - **Deals page:** the "Remove all" dialog adds **Download a copy first**.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes.
- [ ] **Step 5: Commit**: `feat(app): export all data and import an export, with duplicates skipped`.

---

### Task 12: Lender package (print view)

**Files:**
- Create:
  - `src/features/print/LenderPackagePage.tsx`, with section components and tests
  - `src/features/print/print.css`, imported by the page
- Modify:
  - `src/App.tsx` (route `#/deals/:dealId/print`, outside the AppShell chrome)
  - the Pro forma "Lender package (PDF)" button, which becomes a link to the route without the "Later" tag

**Interfaces:**
- Consumes: the deal editor (read-only use), `summarize`, `checkLine`, `verdictHeadline`, `timelineSegments`, `needText`, `formatMoney`, `formatPercent`.

- [ ] **Step 1: Write failing tests** on the sample deal.
  - The page heading is the deal name. Sections appear in this order, as §6.3 lists them, and each is an `h2`:
    1. "Deal summary": lot, house one-liner, region.
    2. "Verdict and rules": headline plus one check line per rule.
    3. "Scenarios": a table with Downside | Base | Upside columns and Sale price, Total project cost, Profit, Margin on sale, Annualized return, Days on market and Months rows.
    4. "Estimate by division": division subtotals with each one's source mix, contingency and total.
    5. "Market estimate and comps used": low/mid/high and the included comps only.
    6. "Timeline": land close, list date and sale close.
    7. "Monthly cash flow (base case)".
    8. "Assumptions": financing, selling and carrying.
  - The footer reads "Decision support only — not an appraisal, legal advice, or a lending decision." and "Prepared <Month D, YYYY> with Spec Studio."
  - **Print or save as PDF** calls `window.print` (mocked). A `← Back to the pro forma` link is present.
  - An incomplete deal shows "This deal needs a few more details before it can be printed." with the needs list linked to its steps, and no sections.
  - The print stylesheet hides the buttons and back link (`print:hidden`) and avoids breaking table rows across pages (`break-inside: avoid`). Assert the classes.
  - E2E (demo): the sample deal's print route shows all eight headings, with no horizontal scroll at 390 px.
- [ ] **Step 2–4:** Run `npm test` and confirm it fails, implement, then run it again and confirm it passes. Run `npm run e2e`.
- [ ] **Step 5: Commit**: `feat(app): lender package print view`.

---

### Task 13: Deploy pipeline and owner setup guide

**Files:**
- Create:
  - `.github/workflows/deploy.yml`
  - `public/_headers`
  - `docs/deploy.md`
  - `tests/deployConfig.test.ts`
  - `tests/bundleSecrets.test.ts`
- Modify:
  - `package.json` (devDependencies `yaml` and `wrangler`, pinned exactly)
  - `README.md` ("Going live" section linking to `docs/deploy.md`)
  - `.github/workflows/ci.yml` (run `bundleSecrets` after the build)

**Decisions:**
- **`deploy.yml`:**
  - Triggers on `push` to `main` and `workflow_dispatch`, with `concurrency: deploy` (no cancel-in-progress) and `permissions: contents: read`.
  - Job `migrate` runs `npm ci && npm run db:migrate` with `DATABASE_URL: ${{ secrets.SUPABASE_DB_URL }}`. It is skipped with a notice when the secret is empty; check in a step, since secrets can't be used in a job-level `if`.
  - Job `deploy` needs `migrate`. It runs:
    - `npm ci`
    - `npm run build` with `VITE_SUPABASE_URL: ${{ vars.SUPABASE_URL }}` and `VITE_SUPABASE_ANON_KEY: ${{ vars.SUPABASE_ANON_KEY }}` (repository *variables*, because the anon key is public)
    - `npx wrangler pages deploy dist --project-name=spec-studio --branch=main`, with secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  - It fails with a clear message if the variables are empty, so a demo build is never deployed by mistake.
- **`_headers`:**
  - `/*` gets:
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: strict-origin-when-cross-origin`
    - `X-Content-Type-Options: nosniff`
    - `Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`
  - `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`.
- **`docs/deploy.md`**: a numbered checklist with exact field names and values.
  1. Create a Supabase project (region: West US).
  2. Authentication → URL Configuration: Site URL `https://spec-studio.pages.dev` (or the custom domain), Redirect URLs the same.
  3. Authentication → Email Templates → Magic Link: add the line `Or type this code: {{ .Token }}` under the link.
  4. Copy the Project URL and anon key into GitHub → Settings → Secrets and variables → Actions → **Variables** `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
  5. Copy the database connection string (Session pooler) into the **Secret** `SUPABASE_DB_URL`.
  6. Cloudflare: create a Pages project named `spec-studio` (direct upload), and an API token with "Cloudflare Pages: Edit". Put it in the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  7. Run the Deploy workflow.
  8. Sign in, then Authentication → Providers → Email → turn off "Allow new users to sign up".
  9. Move demo deals: Demo → Settings → Export all data (Copy). Live → Settings → Import an export (paste).
  10. Smoke test: the list in Task 15.

- [ ] **Step 1: Write failing tests.**
  - `deployConfig.test.ts` parses both workflows with `yaml`:
    - triggers, permissions and concurrency are as above;
    - `deploy` needs `migrate`;
    - the secret and variable names are exactly the ones above;
    - wrangler is pinned (no `@latest`);
    - `ci.yml` still has `check`/`db`/`e2e`.
  - `_headers` contains every header above.
  - `bundleSecrets.test.ts`, run in CI after the build, fails if any file in `dist/` contains `service_role`, `postgres://` or `postgresql://`.
- [ ] **Step 2–4:** Run the tests and confirm they fail, implement, then run them again and confirm they pass. Run `npm run build`; `dist/_headers` exists.
- [ ] **Step 5: Commit**: `ci: deploy to Cloudflare Pages with migrations; owner setup guide`.

---

### Task 14: Hosted-mode end-to-end tests against a fake Supabase

**Files:**
- Create:
  - `tests/e2e/fakeSupabase.ts`
  - `tests/e2e/hosted.spec.ts`
- Modify: `playwright.config.ts` (a second project `hosted`), `package.json` (`"build:hosted-test"` script)

**Decisions:**
- **The `hosted` project:**
  - Builds with `VITE_SUPABASE_URL=http://fake-supabase.test` and `VITE_SUPABASE_ANON_KEY=test-anon-key` into `dist-hosted/`.
  - Serves it on port 4174 through a second `webServer` entry. The existing project is renamed `demo`.
  - `npm run e2e` runs both projects.
- **`fakeSupabase.ts`** installs `page.route("http://fake-supabase.test/**")`. It covers only what the app calls, backed by in-memory tables:
  - **Auth:** `/auth/v1/otp` records the email; `/auth/v1/verify` with code `123456` returns a session; `/auth/v1/user`; `/auth/v1/token?grant_type=refresh_token`; `/auth/v1/logout`.
  - **REST:** `memberships` (with the embedded company), `deals` (GET, POST, PATCH with `id`/`updated_at` eq filters returning an empty array on a mismatch, DELETE), `comps`, `default_prices` (the starter book as global rows), `price_book_entries`, `market_settings`, `company_settings`.
  - **RPC:** `rpc/create_company`.
  - It exposes helpers: `setOffline(bool)` (abort REST requests), `editDealElsewhere(id, patch)` (bumps `updated_at`), `deleteDealElsewhere(id)`.
  - It respects the `Range` header.

- [ ] **Step 1: Write the specs.** Each uses a fresh context.
  1. **Sign in and set up.** Open the app, enter an email, enter code `123456`, create "City Creek Construction", land on the empty Deals page, then **Load sample deal**: the Pro forma verdict shows.
  2. **Saves survive a reload.** Edit the lot price, wait for "Saved", reload: the value is kept and the fake's `deals` row holds it.
  3. **Offline.**
     - `setOffline(true)` and edit: "Offline — saved on this device, will sync" shows.
     - Reload while still offline: the edit is still shown, opened from the outbox.
     - `setOffline(false)`: within 30 s, or on the `online` event (dispatch it), the fake holds the edit and the note clears.
  4. **Conflict.** `editDealElsewhere` then a local edit shows "This deal was changed on another device or tab." **Keep mine** gets the local value into the fake.
  5. **Link opened in another browser.** Visit `/?code=bogus#/deals`: the "different browser" message and the code entry show.
  6. **Settings.** Change the minimum margin and Save, then create a new deal: its Pro forma rules show the new margin.
  7. **Move demo deals.** In the `demo` project, export by copying to the clipboard. Grant clipboard permissions, or read the fallback text box. Import in the hosted app. The deal appears, and a second import skips it.
- [ ] **Step 2:** Run `npm run e2e`. Failures must come from the app or the fake, never the config. Fix the app within the earlier tasks' scope, or fix the fake, and record which.
- [ ] **Step 3:** Run the full verification: `npm run lint && npm run typecheck && npm test && npm run test:db && npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`. Expected: all pass, with clean output.
- [ ] **Step 4: Commit**: `test(e2e): hosted mode against a fake Supabase — sign-in, sync, offline, conflicts`.

---

### Task 15: Go live (owner and controller together)

The steps marked **(owner)** need the owner's accounts. The controller stops before them and asks. Everything else the controller does.

- [ ] **Step 1 (controller):** Merge-ready check. CI is green on the PR, and `docs/deploy.md` has been reviewed against the actual workflow and dashboard names.
- [ ] **Step 2 (owner):** Follow `docs/deploy.md` steps 1–6: create the Supabase and Cloudflare projects, and add the GitHub variables and secrets. The controller walks through it live and checks each value's *name* (never asks for secret values in chat).
- [ ] **Step 3 (owner):** Merge the PR. The Deploy workflow runs migrations, then the build, then Pages.
- [ ] **Step 4 (controller):** Read the workflow logs: `migrate` applied 0001–0003 (or "Up to date"), and the deploy printed the Pages URL.
- [ ] **Step 5 (owner, controller watching):** Smoke test on the live URL:
  1. Sign in with the code from the email.
  2. Create the company.
  3. Load the sample deal and check its verdict.
  4. Change the lot price, reload, and check the change stuck.
  5. On a second device or browser, open the same deal, edit it in both, and check that one shows the conflict choice.
  6. Settings: save the rules.
  7. Print the lender package (Save as PDF).
  8. Turn off sign-ups (deploy.md step 8).
  9. Import the demo export.
- [ ] **Step 6 (controller):** Record in `docs/superpowers/plans/2026-11-01-plan-3-followups.md`:
  - the live URL;
  - anything the smoke test found;
  - the Plan 4 starting list: cost book screen, comps library, CSV/Claude import, bid PDFs, snapshots, starter-price research, permits/fees, the comps problems channel, and House performance.

  Commit it: `docs: Plan 3 go-live notes and Plan 4 starting list`.
