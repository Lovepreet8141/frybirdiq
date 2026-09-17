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

`docs/DEPLOY.md` §9.4 is the authoritative disable/rollback procedure —
this proof does not restate it, only points to it. It covers what a
timer-disable alone misses (DEVOPS-RELEASE review of 78659ff): a job that
already failed once is sitting in `Restart=on-failure`'s wait state and can
still fire up to two more times on its own schedule after
`disable --now`, so §9.4 also runs `systemctl stop 'frybird-job@*.service'`
(cancels the pending restart) and `systemctl reset-failed 'frybird-job@*.service'`
(clears the failure count so a later `systemctl start` isn't refused) —
neither of which this local proof exercised, since no systemd ran here.
§9.4 also has the nginx rollback (back up `/etc/nginx/sites-available/frybird`
before overwriting, `nginx -t` before every reload).

What this proof *did* confirm, and still holds under §9.4: unsetting
`JOB_SECRET` (and `JOB_SECRET_PREVIOUS`) and restarting the app makes every
`/api/jobs/*` request answer 404 regardless of the bearer presented,
whatever state any timer or unit is in — confirmed above by restarting the
local server with `JOB_SECRET` removed.

## Post-deploy checks the local proof cannot cover

Nothing here ran under systemd (no systemd on macOS), so two things stay
unverified until the first real install:

1. **The `LoadCredential`/`%i` hand-off.** Before enabling the timer, run
   `systemctl start frybird-job@heartbeat` by hand (DEPLOY.md §9.2) and
   confirm a real 200/SUCCEEDED in `journalctl -u frybird-job@heartbeat`.
   This proof's 200/SUCCEEDED came from a plain `curl` with a bearer read
   from `.env.local` — it never exercised systemd's own credential
   injection (`LoadCredential=job-header:/etc/frybird/jobs.header`) or the
   `%i` instance-name substitution the real unit relies on.
2. **The live, certbot-forked nginx config**, not the throwaway container:
   `nginx -T | grep -c 'location \^~ /api/jobs/'` must equal 1, and
   `curl -s -o /dev/null -w '%{http_code}\n' https://frybirdiq.tech/api/jobs/heartbeat`
   must be 404 (DEPLOY.md §9.5). §5a: certbot forks the 80 block into a 443
   block once, at cert-issue time — a location added to the source file
   afterwards does not retroactively reach the already-forked 443 block, so
   the container test above (which only ran the port-80-shaped block) does
   not stand in for this.

## Cleanup

Local server process killed, throwaway `nginx:alpine` container removed
(`docker rm -f`), `.env.local` (holds the local-only `JOB_SECRET`) is
gitignored and stays out of this commit.
