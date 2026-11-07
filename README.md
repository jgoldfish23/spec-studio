# Spec Studio

A deal analyzer for spec homes in Northern Utah (Davis and Weber counties). Describe a lot and a house, price the build,
check the market, and get a go / marginal / no-go verdict with the pro forma behind it.

The app is React, TypeScript and Vite. The numbers come from a pure calculation engine in `src/engine`, which works in
integer cents and has no clock, randomness or network access of its own.

## Demo mode

This is the only mode so far. Everything you enter is saved in this browser's `localStorage`: nothing is sent anywhere,
and a different browser or a cleared profile starts empty. On the Deals page, **Load sample deal** adds a worked example
(a Kaysville lot) so you can look around.

The starter prices are unverified estimates. Replace them with your own bids on the Estimate step before relying on a
verdict.

## Going live

To save deals online and sign in by email, follow [docs/deploy.md](docs/deploy.md). It is a step-by-step guide for the
owner: Supabase for the data, Cloudflare Pages for the site, and a GitHub Actions workflow (`deploy.yml`) that migrates the
database and publishes on every push to `main`. `npm run check:bundle` fails the build if a secret ends up in `dist/`.

## Commands

You need Node 22 or newer. Run `npm ci` once first.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Type-checks, then builds the static site into `dist/` |
| `npm run preview` | Serves `dist/` locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no output |
| `npm test` | Engine, data and component tests. No database or browser needed |
| `npm run test:db` | Tests the Supabase schema on Postgres (see below) |
| `npm run e2e` | Browser tests with Playwright (see below) |

### Database tests

`npm run test:db` checks the schema in `supabase/migrations` and its row-level security.

- With `DATABASE_URL` unset, it starts a throwaway PostgreSQL 16 server on port 54329 from `/usr/lib/postgresql/16/bin`
  and removes it afterwards.
- With `DATABASE_URL` set to a server you can create databases on, it uses that server and starts nothing. CI does this
  with a `postgres:16` service container.

Each test file works in a database of its own and drops it when done.

### End-to-end tests

`npm run e2e` builds the app twice, serves both builds and drives them in Chromium, as two Playwright projects:

- `demo`: the demo build (`npm run build`) on port 4173, for every spec but `hosted.spec.ts`.
- `hosted`: a hosted build made against a fake Supabase (`npm run build:hosted-test`, into `dist-hosted/`) on port 4174,
  for `hosted.spec.ts`. `tests/e2e/fakeSupabase/` answers the app's Supabase requests in the browser, through
  Playwright's request interception, from in-memory tables seeded with the starter cost book.

`npx playwright test --project demo` (or `hosted`) runs one of them. The specs in `tests/e2e` (shared steps in
`helpers.ts`) check, among other things:

- `deal-flow.spec.ts`: the sample deal is loaded into an empty browser, edited on House, Market and Estimate, saved, and
  found again with both changes after a reload and on the Deals list.
- `deal-flow.spec.ts`: an edit is kept when the page is reloaded straight after it, before the autosave's second is up.
- `layout.spec.ts`: the Deals list and every step fit a 390 px screen without scrolling sideways, with no console errors.
- `chunk-failure.spec.ts`: a step whose code cannot be fetched says so, keeps the deal's tabs, and recovers on Reload.
- `hosted.spec.ts`: signing in with the emailed code and setting up the company; an edit saved to the server; an edit
  made offline that survives a reload and syncs when the connection is back; a deal changed on another device, kept
  with Keep mine; a sign-in link opened in another browser; a Settings change that new deals start from; and demo deals
  moved into the account by copy and paste, with a second import skipping them.

Notes:

- Install the browser once with `npx playwright install --with-deps chromium`.
- If Chromium is already installed somewhere else, set `PW_CHROMIUM_PATH` to its executable and skip the install.
- Every run writes an HTML report to `playwright-report/`; after a failure, `npx playwright show-report` opens it.

## Static build

`npm run build` writes `dist/`. Its assets are loaded by relative path (`./assets/...`), so the folder can be hosted
anywhere as static files, including from a sub-folder. CI checks this on every build.

## Continuous integration

`.github/workflows/ci.yml` runs three jobs on pushes to `main` and on pull requests: `check` (lint, typecheck, tests,
build), `db` (the Postgres tests) and `e2e` (the browser tests; the report is attached to a failed run).
