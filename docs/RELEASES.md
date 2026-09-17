# Releases

One row per production deploy of **frybirdiq.tech**, newest first. Append-only: never edit a past row. If a row turns out wrong, add a correction row.

- **Who deploys:** only FRYBIRD Chief (the hive orchestrator), and only after the owner says yes to that specific deploy.
- **Commit:** the full SHA that was built. Production's `/var/www/frybird/.next/BUILD_ID` must equal the local `.next/BUILD_ID` of that build.
- **Smoke:** signed-out HTTP checks on the live site (no forms, no orders, no payments).
- **Signed-in check:** a staff session walks the changed screens. Never place, pay, cancel or refund an order in production to do it.
- **Migration head:** the last migration applied in production (`drizzle.__drizzle_migrations` count vs `supabase/migrations/meta/_journal.json`).

| # | Deployed (UTC) | Commit | Branch | BUILD_ID | Migration head | Who | Smoke | Signed-in check | Evidence / approval |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-09-16 21:15 | `86de13321133b6108d2aa07a9450f4212fa77c12` | `kit-radix-nova` | `iF6V3Sbwg6RdvAkAnSfAn` | `0032_backfill_rls_gap` (33 of 33 applied) | Not recorded. Built and shipped from the main checkout; no hive agent deployed it | Pass, run 2026-09-16 23:56 UTC during reconstruction: `/` 200, `/menu` 200, `/sign-in` 200, `/app/orders` and `/app/finance` 307 → `/sign-in`. `/app` 404 (there is no index page at that route) | Not run. Needs a staff sign-in | Baseline reconstructed 2026-09-16 23:56 UTC, read-only: remote BUILD_ID equals the local build's; SHA-256 of every server `.js` in `.next/server/{app,chunks}` matches between local and production; a string added in `86de133` is present in the production bundle; HEAD was `86de133` from 21:04 UTC until after the 21:15 UTC build; service started 21:15:22 UTC. Deploys before this one are narrated in `FRYBIRD-IQ-PROGRESS.md` |
| 1 | 2026-09-17 10:55 | `5d7ed22` | `kit-radix-nova` (release/rc-3) | `xzUttXpC0koH-qJgLA7wL` | `0033_rls_write_lockdown` (34 of 34 applied) | god (FRYBIRD Chief), owner-approved | Pass 10:56 UTC (`/`, `/menu`, `/sign-in` 200; `/app/orders`, `/app/finance` 307); deploy.sh gates 921 unit tests; service active, 0 errors in journal | Not run (needs owner device: signed-in KDS realtime) | Owner approved rel-2 2026-09-17 10:46 UTC. Pre-check: 33/33 applied, backup 12 h. Post-check: anon/authenticated INSERT/UPDATE/DELETE grants on public = 0 (read-only query). Includes rc-1..rc-3: P0 role self-promotion fix (0033), order/payment state fixes, rider cash close, IST P&L, refund/double-capture counting, dormant IQ foundations (no 0034+). |
