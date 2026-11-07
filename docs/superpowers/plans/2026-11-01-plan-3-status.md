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

Test-only fixes for timing-sensitive tests: 35b8208, 3460e9b.

## Left

1. **T14**, hosted-mode e2e against a fake Supabase. In progress when this note was written; check `git log`.
2. **Final whole-branch review.** Use the most capable model, then one fix wave. Items parked for it are listed below.
3. **T15**, go live with the owner. This is a stop point: it needs the owner's Supabase and Cloudflare accounts. Follow `docs/deploy.md`. Never paste secret values into chat, issues or commits; GitHub stores them, and the workflows read them by name.
4. Merge PR #2, then PR #3.

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

## Parked for the final review

The full list, with file and line references, is in the SDD ledger (git-ignored, under `.superpowers/sdd/`). Load-bearing ones:

- When two tabs are open, the other tab can rewrite the device copy after an explicit sign-out in this one. This is same-owner only.
- A deep link can survive a reload after the owner changes.
- `pendingCount` counts conflict and deleted entries.
- An old hash-router listener is left behind after a re-sign-in.
- A committed save that takes more than 20 s can conflict with the owner's own later edit.
- The settings form seeds itself only once.
- The comp-address normaliser could be shared.
- `stableStringify` doesn't drop keys whose value is `undefined`.

## Running it

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build && npm run check:bundle -- --demo
npm run e2e
```

`npm run test:db` needs a local Postgres (CI provides one). On a machine whose Chromium isn't Playwright's own, set `PW_CHROMIUM_PATH` to it.
