# Plan 3 (go live): status and handoff

This note is how to pick Plan 3 up on another machine. It covers what is done, what is left, and the decisions made along the way that the plan text doesn't show. The plan itself is `2026-11-01-plan-3-go-live.md`. Work happens on branch `plan-3-supabase` (draft PR jgoldfish23/spec-studio#3). That branch is stacked on `plan-2-app` (draft PR #2), which still needs merging first.

## Done

Every task below went through its own review and fix rounds, and CI passed on each push.

| Task | What | Commits |
|---|---|---|
| T1 | DB hardening, `create_company` | 0851850, a6d303f |
| T2 | Migration runner, starter cost book | 46c770a, 404066e |
| T3 | Repository conflicts, settings | a74a519, 1a339fa |
| T4 | Settings data layer | 956ae82 |
| T5 | Offline outbox | 495d582 … e26bbdd |
| T6 | Editor save states (offline, signed out, conflict, deleted) | 2f7aba6, e013d7d, 5e14093 |
| T7 | Auth and company gateways | 9ef86bb, f6c71cf |
| T8 | Sign-in, company setup, account menu | 5197090, a973c20 |
| T9 | Hosted mode wiring, plus offline start from the device | cdb0000, 7ebea2d, d56361b, f4b6ef7 |
| R9 | Never send a data request without a session | 9b5dcc7 |
| T10 | Settings screen, per-deal rules | 5acb18b, 64039f7 |
| T11 | Export and import | a3b1d0b, 5af8f8b, e023465 |
| T12 | Lender package print view | 2eb6159, cdb8c47 |
| T13 | Deploy pipeline and owner guide (`docs/deploy.md`) | ba1dd53, d60446e |
| T14 | Hosted e2e against a fake Supabase | 3c5e88c |
| Final review | Fix wave for Important 1–5 and the minors | a2db8ab … d0281d7 |
| Follow-up | An untouched deal takes the server's newer version | 0d9ec76 |

Test-only fixes for timing-sensitive tests: 35b8208, 3460e9b.

The final whole-branch review found no Critical issues and 5 Important ones. All 5 are fixed, along with most Minors:
1. A slow offline open: screens now open from the device in seconds, not 7–30 s.
2. "Saved" was shown over unsynced edits.
3. Keep mine, queued while offline, could overwrite. It is now a rebase.
4. "Saved on this device" was shown when storage was blocked or full.
5. Sign-out was global. It is now this device only.

A narrow follow-up fixed one regression the wave introduced: on a slow connection, a deal stayed on the device copy.

## Left

1. **T15**, go live with the owner. It needs the owner's Supabase and Cloudflare accounts. Follow `docs/deploy.md` steps 1–6, then merge PR #2 and then PR #3 into `main`. The deploy workflow runs on a push to `main`. Never paste secret values into chat, issues or commits; GitHub stores them, and the workflows read them by name.
2. Smoke test the live site, using the checklist below.

### Go-live smoke test

- Sign in with the emailed code.
- Create the company.
- Load the sample deal and check that the verdict shows.
- Edit, reload, and check the edit is kept.
- Turn on airplane mode, edit, reload, and check the edit is still shown.
- Turn airplane mode off and check the note clears.
- Export from the demo, import, and check that a second import adds nothing.
- Open the lender package.
- Then turn off "Allow new users to sign up".

## Decisions that aren't in the plan text

- **R1.** Saving market settings invalidates only that region's market settings, not the cost book.
- **R2, R8.** The offline repository has `discardPending(dealId)`, `queue(deal)` (a synchronous outbox write) and the `isOfflineRepository` guard.
- **R3.** The "Your data" card lives on the Settings page.
- **R4.** The secret scan is `scripts/check-bundle.mjs` (`npm run check:bundle`, plus `-- --demo` in CI), not a vitest test.
- **R5.** Wrangler is not a dependency. `deploy.yml` pins `npx wrangler@4.158.0`.
- **R6.** The offline deals list shows a neutral `notice`, not a problem row.
- **R7.** Sample comps are marked `source: "sample"` and get fresh UUIDs per company.
- **R9.** The client refuses any `/rest/v1/` request carrying the anon key as bearer, and treats it as offline. A flaky token refresh would otherwise read as "no company / no deals / deleted".
- **Offline start (T9).** A returning owner opens from the device; "Can't reach Spec Studio's server" is only for a device that remembers nothing. To make that work:
  - the device remembers `spec-studio:last-user` and `spec-studio:company:<userId>`;
  - the offline repository keeps a per-owner device copy of reads (`spec-studio:cache:<userId>:…`), served only when offline;
  - an explicit sign-out from the account menu clears that copy but keeps the outbox;
  - "Load their version" reads from the server only.
- **Import (T11).** Deals match by name AND content, because the default name "Untitled deal" would otherwise drop deals. Imported comps always get fresh ids, and deal status carries over.
- **The deal page offers Delete only for a deal that is actually unreadable,** never for an offline or temporary failure.
- **Keep mine (final review).** It rebases onto the server version the owner saw, and never overwrites. A later change made elsewhere asks again. This overrides the plan's "Keep mine saves with overwrite". The `overwrite` option is gone from `Repository.saveDeal`.
- **Offline reads (final review).** When the browser reports offline, the device copy answers at once. Otherwise it answers after a 3 s grace, and the server's answer replaces it when it lands. An untouched deal takes the newer version.
- **Sign-out is per device** (`scope: "local"`).
- **The email code is checked as exactly 6 digits.** `docs/deploy.md` says to keep Supabase's OTP length at 6.

## Plan 4 starting list (deferred with rulings)

Refactors:
- Split `HostedRoot.tsx`, `useDealEditor.ts` and `offlineRepository.ts`.
- Tidy the interfaces that grew ad hoc:
  - `getDeal(id, { fromServer })`;
  - `forgetDeviceCopy`/`stopDeviceCopy` on the repository;
  - the test-only `fetchOverride`;
  - `isOfflineRepository` sniffing in the editor;
  - SS002 detected by message text.

Offline:
- Creating a new deal, loading the sample, comps and settings all still need a connection.
- The settings forms seed only once, and can show a stale device copy on a slow connection.
- An export's comps and settings can come from the device copy with no notice.

Editor re-seeding:
- It re-seeds on a *different* stamp. It should only take a *newer* one.
- A re-seed replaces text typed but not yet committed (for example, the name box in the first ~3 s on a slow connection).
- On a slow connection, the deal's late server answer is dropped when the list's late answer lands first. The editor stays on the device copy, and a real conflict then surfaces one edit later.

Two tabs:
- The other tab can rewrite the device copy after an explicit sign-out (same owner only).
- A deep link survives a reload after the owner changes.

Smaller items:
- An old hash-router listener is left after a re-sign-in.
- A committed save that takes more than 20 s can conflict with the owner's own later edit.
- `stableStringify` doesn't drop keys whose value is `undefined`.
- A `VITE_SUPABASE_*` variable in the shell overrides `.env.hosted-test`.
- The fake's SS002/401 paths have no unit test.

Deploy:
- Pin wrangler's transitive dependencies with a lockfile, or use wrangler-action by SHA.
- Pin actions by SHA.

## Running it

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build && npm run check:bundle -- --demo
npm run e2e
```

`npm run test:db` needs a local Postgres (CI provides one). On a machine whose Chromium isn't Playwright's own, set `PW_CHROMIUM_PATH` to it.
