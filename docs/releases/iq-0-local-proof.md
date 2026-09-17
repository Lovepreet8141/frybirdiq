# IQ-0 job runner — local end-to-end proof

Ran 2026-09-17 by QA (card iq0-s12), against `release/rc-7` HEAD `8eb11a7`,
entirely on a laptop: local `supabase start` stack (Docker), a standalone
Next.js build bound to `127.0.0.1:3000`, and a throwaway `nginx:alpine`
container running the real `deploy/nginx-frybird.conf`. No production
access, no VPS, no real secrets. This is a **local proof**, not a
production readiness sign-off — see "What this does not prove" below.

## Setup

1. `supabase db reset` — fresh local Postgres, migrations 0000–0036 applied.
2. `pnpm build` (`output: "standalone"` in `next.config.ts`).
3. `pnpm db:seed` — creates the single `frybird` organization (no orders;
   an empty org is sufficient to prove the job runner, since a facts/P&L
   parity check over zero rows is trivially equal).
4. `.env.local` at the repo root with the local Supabase `DATABASE_URL`
   (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, the well-known
   local-dev demo credential, not a secret) plus a `JOB_SECRET` generated
   locally with `secrets.token_hex(32)` (64 hex chars) — **generated once,
   held only in this file and the running process's environment, never
   printed to a terminal, log, or this document.**
5. **Standalone-build gotcha**: `.next/standalone/` does not inherit the
   repo root's `.env.local`, `public/`, or `.next/static/` — `next start`
   itself refuses to run against a standalone build and says so
   ("`next start` does not work with `output: standalone`... Use
   `node .next/standalone/server.js` instead"). Copied `.env.local`,
   `public/`, and `.next/static/` into `.next/standalone/` before starting
   `node .next/standalone/server.js` with `HOSTNAME=127.0.0.1 PORT=3000`.
   A production deploy needs the same copy step — worth confirming
   `docs/DEPLOY.md`'s systemd unit (or its build step) does this; this proof
   only exercises the job route, which does not use `public/` or
   `/_next/static/`, so a missing copy would not have shown up here.

## Results

| Check | Expectation | Result |
|---|---|---|
| POST `/api/jobs/heartbeat`, correct secret, no explicit `X-Forwarded-For` | 200, one SUCCEEDED `iq_job_runs` row | **200**; `{"counts":{"SUCCEEDED":1,...}}`; DB row confirmed: `heartbeat \| SUCCEEDED \| 2026-09-17T11` |
| Same request repeated | 200, NOOP (already done this period) | **200**; `{"counts":{"NOOP":1,...}}` |
| POST with a wrong bearer secret | 404 | **404** |
| POST with an explicit non-loopback `X-Forwarded-For: 8.8.8.8` | 404 | **404** |
| POST with **no** `X-Forwarded-For` header at all (the heartbeat test above) | Accepted, not refused | **Accepted** — proves Next fills `x-forwarded-for` from the raw socket address when the header is absent (`base-server.js:611`; T1), so a local curl arrives as `127.0.0.1` and passes the loopback check without the caller setting anything |
| `JOB_SECRET` unset, correct *old* secret presented | 404 (dormant route) | **404** — confirmed by restarting the server with `JOB_SECRET` removed from the environment |
| RED-TEAM F2: `deploy/nginx-frybird.conf` (real file, only its `proxy_pass` target rewritten from `127.0.0.1:3000` to `host.docker.internal:3000` so a container can reach the host-run app — the `/api/jobs/` block itself is untouched), run in `nginx:alpine` via `docker run`, `nginx -t` | Config valid; plain GET, POST, and the exact traversal from the fix's own comment (`/_next/static/%2e%2e/%2e%2e/api/jobs/heartbeat`) all 404 before reaching the app | `nginx -t`: **config OK**. GET `/api/jobs/heartbeat`: **404**. POST `/api/jobs/heartbeat`: **404**. Traversal: **404**. Sanity check, GET `/` through the same nginx: **200** (proves the proxy genuinely reaches the live app rather than everything just erroring) |
| POST `/api/jobs/iq-facts-nightly` for the seeded `frybird` org | 200, SUCCEEDED, `parity_ok: 1` | **200**; DB row: `status: SUCCEEDED`, `summary: {"parity_ok": 1, "parity_checks": 2, "parity_mismatches": 0, "parity_missing_days": 0, "days_recomputed": 47, "rows_written": 1034, "trust_signals_written": 376, ...}` |

## Not run here (no systemd on macOS)

`systemd-analyze verify` / `--iterations` calendar checks on the shipped
`.timer`/`.service` units (DESIGN.md §3's "Local proof" list) need a Linux
systemd host and were not run on this laptop. The timer↔registry drift this
would catch is instead covered continuously by
`src/lib/jobs/registry.test.ts`'s "keeps each installed timer in step with
the registry" test (28/28, run 3× with no flake in the rc-7 gate pass) and
by DEVOPS-RELEASE's own review of the unit files. Recommend a
`systemd-analyze verify` pass as part of first VPS install, not before.

## What this does not prove

- Real production DNS/TLS/certbot behaviour, or the live `frybirdiq.tech`
  Host header path (tested here with a synthetic `Host: frybirdiq.tech`
  against a container, not a certificate).
- systemd's own retry/backoff, `LoadCredential`, or `DynamicUser` sandboxing
  (no systemd on this machine — see above).
- Behaviour under the real VPS's nginx process (only `nginx:alpine` was
  used, same config, different base image/binary).
- Anything about a second, concurrent org — this proof seeded exactly one.
  Two-org isolation is covered by `iq-job-runs.integration.test.ts`, not
  repeated here.

## Recovery

- **Disable the timer** (stop future runs, keep the unit installed):
  `systemctl disable --now frybird-job-heartbeat.timer` (and the same for
  any other job's timer once it ships).
- **Stop units immediately** (mid-run): `systemctl stop frybird-job@<job>.service`
  — the lease expires (300 s) and the next scheduled attempt takes over
  cleanly; nothing needs to be cleared by hand.
- **Go fully dormant without touching systemd**: unset `JOB_SECRET` (and
  `JOB_SECRET_PREVIOUS`) in `/etc/frybird/env` and restart the app. Every
  `/api/jobs/*` request then gets an empty 404 regardless of the bearer
  presented — confirmed above by restarting the local server with
  `JOB_SECRET` removed. This is the fastest full stop: no systemd unit
  needs touching, and nginx's own `/api/jobs/` block already refuses public
  traffic on top of it.

## Cleanup

Local server process killed, throwaway `nginx:alpine` container removed
(`docker rm -f`), `.env.local` (holds the local-only `JOB_SECRET`) is
gitignored and stays out of this commit.
