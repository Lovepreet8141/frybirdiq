# Deploying to a Hostinger VPS

The ordering app and FRYBIRD IQ on `frybirdiq.tech`, on a Hostinger VPS at
194.238.16.200. WordPress can join it later on its own domain. The database stays on Supabase — nothing about this puts Postgres on
the VPS.

Deployed and verified on 2026-09-11. What follows is what actually worked, with
the things that went wrong recorded where they bit rather than as a tidy
afterthought.

---

## The two failures worth knowing about

### Your database password ends in `@` — encode it

This is the one that broke the first deploy. The password must appear in
`DATABASE_URL` as `%40`, not a literal `@`:

```
postgresql://postgres:pass%40word@db.<ref>.supabase.co:5432/postgres
                          ^^^                ^
                          encoded            the real separator
```

Pasted raw, the URL parser treats the password's `@` as the host separator and
sends only the characters before it. The host still parses correctly, so you get:

```
password authentication failed for user "postgres"   (SQLSTATE 28P01)
```

which reads like a wrong password rather than a quoting bug. `nano` will not
warn you. Copy the working line from `.env.local` rather than retyping it.

### Ubuntu's cloud images override your sshd edits

Editing `PasswordAuthentication no` into `/etc/ssh/sshd_config` appears to
work — `sshd -t` passes, the reload succeeds — and changes nothing, because
`/etc/ssh/sshd_config.d/50-cloud-init.conf` sets `yes` and SSH honours the
**first** occurrence of a keyword. The include sits at the top of the main file,
so the drop-in always wins.

Edit the drop-in, and verify the effective setting rather than trusting the
edit:

```bash
sshd -T | grep -i passwordauthentication
```

---

## About IPv6 and the session pooler

Supabase's direct host (`db.<ref>.supabase.co`) is IPv6-only. Advice elsewhere
says to switch production to the session pooler for this reason.

**This VPS did not need it.** Hostinger assigns a global IPv6 address, and the
direct connection works:

```bash
timeout 10 bash -c "cat < /dev/null > /dev/tcp/db.<ref>.supabase.co/5432"
```

For a long-running Node server the direct connection is the better choice — the
pooler exists mainly for serverless. Test before assuming; only move to the
pooler if that check fails, and note that the pooler also changes the username
to `postgres.<project-ref>`.

---

## 1. The VPS

Running on Hostinger **KVM 1** (1 vCPU, 4 GB RAM, 50 GB) — comfortably
oversized. The app, nginx and the OS together sit under 1 GB, and the expensive
job, `next build`, runs on the Mac and ships the result.

**Ubuntu 26.04 LTS**, plain. Do not pick a template bundled with CyberPanel,
Plesk or cPanel: the panel takes ownership of nginx and overwrites the config in
step 5.

```bash
ssh root@YOUR_SERVER_IP

apt update && apt upgrade -y
apt install -y nginx rsync git ufw

# Node 22 LTS. Do not use the version in Ubuntu's own repository; it is years old.
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

### A user for the app

```bash
adduser --system --group --home /var/www/frybird frybird
mkdir -p /var/www/frybird
chown -R frybird:frybird /var/www/frybird
```

The app runs as its own unprivileged user. It never needs root, and a process
that cannot write outside its own directory cannot be made to.

### Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Port 3000 is deliberately **not** opened. The app binds to `127.0.0.1` and
nginx is the only thing that reaches it. A Next process listening on `0.0.0.0`
is reachable directly on the public IP, bypassing TLS and every header nginx
sets.

---

## 2. Secrets

```bash
mkdir -p /etc/frybird
nano /etc/frybird/env
```

```
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1

NEXT_PUBLIC_SUPABASE_URL=https://shbmprmarlubyhaklmpr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# The public address of this site. Links inside WhatsApp messages use it, so a
# wrong value here sends customers a link that goes nowhere.
SITE_URL=https://frybirdiq.tech

# The SESSION POOLER string. See the warning above.
DATABASE_URL=postgresql://postgres.shbmprmarlubyhaklmpr:PASSWORD%40HERE@aws-0-<region>.pooler.supabase.com:5432/postgres

# Online payment (roadmap Phase 1). Leave all three unset and checkout offers
# cash only; set them and "Pay now" appears. The webhook secret is the one you
# type into the Razorpay dashboard when you add the webhook URL
#   https://frybirdiq.tech/api/payments/razorpay/webhook
# for the events payment.captured, payment.failed and order.paid.
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

After changing this file: `systemctl restart frybird`. Razorpay keys are read
at runtime, so no rebuild is needed for them.

```bash
chown root:frybird /etc/frybird/env
chmod 640 /etc/frybird/env
```

Root-owned, readable by the service user, world-readable by nobody. It lives
outside `/var/www` so a deploy that syncs the app directory can never overwrite
or expose it.

**`NEXT_PUBLIC_*` values are compiled into the browser bundle at build time.**
They are baked in when you run `pnpm build` on your Mac, not read from this
file at runtime. If you change either of them, rebuild and redeploy — editing
this file alone will not change what the browser sees.

---

## 3. First deploy

From your Mac:

```bash
cd "/Users/lovepreetsingh/Downloads/Frybirdiq"
./deploy/deploy.sh root@194.238.16.200
```

Deploy **as root**, not as `frybird`. The service user is a `--system` account
with no shell and no password, so it cannot receive an ssh session —
`frybird@` fails with `Permission denied (publickey)`. Files land root-owned
and `deploy.sh` chowns them to `frybird` on arrival.

It runs typecheck, lint and tests first, builds, then ships about 45 MB of
traced output. It builds locally on purpose: `next build` wants 1–2 GB of RAM
and the full dependency tree, and on a small VPS it will either swap itself
into uselessness or be killed by the OOM reaper halfway through — taking the
running site down with it.

For that to work unattended, give the `frybird` user passwordless restart
rights and nothing else:

```bash
echo 'frybird ALL=(root) NOPASSWD: /bin/systemctl restart frybird, /bin/systemctl is-active frybird' \
  > /etc/sudoers.d/frybird
chmod 440 /etc/sudoers.d/frybird
```

---

## 4. The service

```bash
cp deploy/frybird.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now frybird
systemctl status frybird
curl -I http://127.0.0.1:3000
```

Logs:

```bash
journalctl -u frybird -f
```

### `./deploy/deploy.sh` does not ship this file

`deploy.sh` rsyncs the built app into `/var/www/frybird` — it never touches
`/etc/systemd/system/frybird.service`. Edit `deploy/frybird.service` in the
repo and the running unit does not change until you push that edit to the
server yourself:

```bash
scp deploy/frybird.service root@194.238.16.200:/etc/systemd/system/frybird.service
ssh root@194.238.16.200 "systemctl daemon-reload && systemctl restart frybird"
```

Skip this and the repo and the server quietly disagree about what the unit
says — the next person to read `deploy/frybird.service` sees a rule that
was never applied.

`ReadWritePaths` must cover both `.next/cache` **and** `.next/server/app`.
The first is Next's own image and prerender cache. The second is where a
static route handler — `src/app/icon.svg` is the one that surfaced this —
writes its cached response (`icon.svg.body`, `icon.svg.meta`) at request
time even though the build already shipped one. `ProtectSystem=strict`
makes the whole filesystem read-only outside `ReadWritePaths`, so missing
either path means `EROFS` in the log the first time that route is hit,
not at deploy time and not in any gate — see `deploy/frybird.service` for
both entries.

---

## 5. nginx and TLS

```bash
cp deploy/nginx-frybird.conf /etc/nginx/sites-available/frybird
ln -s /etc/nginx/sites-available/frybird /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

**If a control panel is installed**, it owns the nginx configuration and hand
edits get overwritten on its next write. Add `order.frybird.in` as a site in
the panel and set it to reverse-proxy `http://127.0.0.1:3000`; the proxy
headers in `deploy/nginx-frybird.conf` are what to copy into its custom-config
box.

DNS, at your registrar:

| Record | Name | Value |
|---|---|---|
| A | `@` | 194.238.16.200 |
| A | `www` | 194.238.16.200 |

Then certificates:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d frybirdiq.tech -d www.frybirdiq.tech
```

certbot rewrites the server blocks to add TLS and redirect port 80. Renewal is
automatic; check it with `certbot renew --dry-run`.

### 5a. Keeping the 443 block in step with the repo

certbot does not keep reading `deploy/nginx-frybird.conf` after the first run
— it forks the matched server block once, in place on the VPS, into a 443
block with TLS added and rewrites the 80 block to redirect. From that point
the 443 block lives **only** on the server; `git diff` against this repo will
never show it.

Run certbot fresh (TLS not yet issued) and every `location` in this file,
including `location ^~ /api/jobs/ { return 404; }`, is copied into the new
443 block automatically — nothing else to do.

**If TLS is already issued** and you are only updating this file (e.g. this
slice's job-route block, or any future location), the change never reaches
the 443 block by itself:

```bash
ssh root@194.238.16.200
diff <(sudo nginx -T 2>/dev/null | awk '/listen 443/,/^}/') /dev/stdin <<'EOF'
    location ^~ /api/jobs/ { return 404; }
EOF
```

and hand-edit `/etc/nginx/sites-available/frybird`'s 443 block to match this
file's 80 block, then `nginx -t && systemctl reload nginx`. Verify both
listeners refuse the job route (§9's smoke test works over both `http://` and
`https://`).

---

## 6. Migrations

Migrations run from your Mac, against Supabase. Nothing on the VPS applies
them, and the app never migrates itself on boot — a deploy that migrates on
start will run schema changes on every restart and during every crash loop.

```bash
pnpm db:migrate
```

Deploy the code **after** the migration when a change is additive, and
**before** it when a change removes something the old code still reads.

---

## 7. Every deploy after the first

```bash
./deploy/deploy.sh root@194.238.16.200
```

Restarting drops in-flight requests. At a QSR that means doing it between
services, not during one.

`deploy.sh` stamps `DEPLOY_COMMIT=$(git rev-parse HEAD)` into
`/etc/frybird/env` on every run, in place, before restarting — that value is
what `iq_job_runs.code_version` and every insight's `producedBy.codeVersion`
read (`src/lib/env/index.ts`), so a job run or an insight can be traced back
to the code that produced it. It refuses to deploy if `git rev-parse HEAD`
doesn't return a 40-character lowercase SHA, and never prints or forwards
anything else already in that file (`JOB_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`RAZORPAY_*`, `DATABASE_URL`) — only that one line is rewritten, remotely,
without it passing back through this script's own output. This needs
`/etc/frybird/env` to already exist (§2); `deploy.sh` refuses rather than
create one.

---

## 8. Backups (roadmap 0.7)

Supabase backs the database up on its own schedule; this is FRYBIRD's own
nightly copy on the VPS, verified and pruned, with an optional offsite copy.

```bash
apt install -y postgresql-client            # pg_dump / pg_restore
cp deploy/backup.sh /usr/local/bin/frybird-backup && chmod 750 /usr/local/bin/frybird-backup
cp deploy/frybird-backup.service deploy/frybird-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now frybird-backup.timer
systemctl start frybird-backup && journalctl -u frybird-backup -n 20   # run one now
ls -la /var/backups/frybird/
```

Dumps are custom-format, `public` schema only, kept 14 days, root-only
(they hold every customer's phone number). For an offsite copy, configure an
rclone remote (Backblaze B2, Google Drive, any S3) and put
`BACKUP_RCLONE_REMOTE=remote:frybird-backups` in `/etc/frybird/backup.env`.

Prove a restore once — and again after any schema change you would not want
to discover cannot be restored:

```bash
apt install -y postgresql                  # a scratch server the app never touches
bash deploy/restore-check.sh               # restores the newest dump, counts rows, drops the scratch db
```

## 9. Scheduled jobs (IQ-0, S10)

Owner decisions `dec-1` (job runner on the VPS) and `dec-2` (production
`iq_*` migration) are **approved** — see card `dv-1` and §10 for this
release's install order. Ships dormant until `JOB_SECRET` is set either way
(§9.1), so nothing here is live just from being deployed.

The route (`src/app/api/jobs/[job]/route.ts`) is already live in the app —
it answers 404 to everything until `JOB_SECRET` is set. nginx also refuses
`/api/jobs/` outright (§5), so a public request never reaches the app's own
check at all; the two are independent layers on purpose (RED-TEAM, T1/T2).

### 9.1 The secret — created, never printed

```bash
mkdir -p /etc/frybird
umask 077
head -c48 /dev/urandom | base64 > /tmp/frybird-job-secret   # >=32 chars, never echoed
printf 'Authorization: Bearer %s' "$(cat /tmp/frybird-job-secret)" > /etc/frybird/jobs.header
printf '\nJOB_SECRET=%s\n' "$(cat /tmp/frybird-job-secret)" >> /etc/frybird/env
shred -u /tmp/frybird-job-secret
chown root:root /etc/frybird/jobs.header
chmod 600 /etc/frybird/jobs.header
systemctl restart frybird
```

Nothing above prints the secret to the terminal, a log, or a command's argv
(`head`/`base64`/`printf` never appear in `journalctl` with the value; `ps`
cannot see inside a shell builtin's argument list from a file redirect the
way it can a literal CLI argument — even so, avoid retyping the secret on any
command line). Appending with `>>` before the `shred` means `/etc/frybird/env`
never needs to be opened in an editor and the secret never has to be typed
or pasted a second time; if it already has a `JOB_SECRET=` line from an
earlier setup, remove that line first so the file doesn't carry two. The
leading `\n` in the second `printf` guards against the file's last line not
already ending in one — without it, a missing trailing newline would glue
`JOB_SECRET=...` onto whatever the previous line was instead of starting a
new one. A resulting blank line is harmless; `EnvironmentFile=` (used by
`deploy/frybird.service`) ignores empty lines.

`jobs.header` holds the literal header line the unit sends
(`LoadCredential=job-header:/etc/frybird/jobs.header` in
`deploy/frybird-job@.service` — systemd reads this as root and hands the
service a private copy; the file itself stays unreadable to the `frybird`
user or anything else with DynamicUser). It never goes through `deploy.sh`
and is never rsynced — it lives outside `/var/www` exactly like
`/etc/frybird/env`.

### 9.2 Install

```bash
cp deploy/frybird-job@.service deploy/frybird-job-failed@.service /etc/systemd/system/
cp deploy/frybird-job-heartbeat.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now frybird-job-heartbeat.timer
systemctl list-timers frybird-job-heartbeat.timer
systemctl start frybird-job@heartbeat   # run one now, don't wait for the hour
journalctl -u frybird-job@heartbeat -n 20
```

One timer per job (`deploy/frybird-job-<name>.timer`); IQ-0 ships only
`heartbeat`. `src/lib/jobs/registry.test.ts` fails the build if a timer's
`OnCalendar=` and the registry's `onCalendarUtc` for that job ever drift —
adding a job means adding both together.

### 9.3 Rotation

```bash
# 1. Move the current secret to JOB_SECRET_PREVIOUS in /etc/frybird/env,
#    generate a new one for JOB_SECRET (9.1), restart the app:
systemctl restart frybird
# 2. Rewrite /etc/frybird/jobs.header with the NEW secret (9.1) — the timer
#    unit must present the new value, not the one the app now calls "previous":
systemctl daemon-reload   # only if unit files changed; usually not needed here
# 3. Once you've seen a job run succeed on the new secret (journalctl -u
#    frybird-job@heartbeat), clear JOB_SECRET_PREVIOUS from /etc/frybird/env
#    and restart frybird again.
```

The app accepts both `JOB_SECRET` and `JOB_SECRET_PREVIOUS` for exactly this
window (`src/lib/jobs/auth.ts`), so step 1 and step 2 do not have to land in
the same instant — a job that fires between them still authorizes on
whichever secret it was carrying.

### 9.4 Disable / rollback

```bash
systemctl disable --now frybird-job-heartbeat.timer
systemctl stop 'frybird-job@*.service'
systemctl reset-failed 'frybird-job@*.service'
```

`disable --now` on the timer only stops *future* scheduled starts. It does
**not** stop an instance that already failed once and is sitting in
`Restart=on-failure`'s wait state for its next attempt (RELIABILITY,
iq0-s10r-rel) — up to two more runs of a job that failed right before you
disabled the timer can still fire on their own `RestartSec=360` schedule.
`systemctl stop 'frybird-job@*.service'` cancels any such pending restart
across every job instance; `reset-failed` clears the failed/rate-limited
state so a future `systemctl start` isn't refused by the old failure count.

To go back to fully dormant instead of just paused, unset `JOB_SECRET` and
`JOB_SECRET_PREVIOUS` in `/etc/frybird/env` and restart `frybird` — every job
route then answers 404 again regardless of whether any timer is still
enabled. To remove the units entirely:

```bash
systemctl disable --now frybird-job-heartbeat.timer
systemctl stop 'frybird-job@*.service'
systemctl reset-failed 'frybird-job@*.service'
rm /etc/systemd/system/frybird-job@.service /etc/systemd/system/frybird-job-failed@.service /etc/systemd/system/frybird-job-heartbeat.timer
systemctl daemon-reload
```

No migration or data is touched by any of this — `iq_job_runs` rows from
past runs are just history.

**nginx rollback.** The job-route change here is one file
(`/etc/nginx/sites-available/frybird`, both the 80 block and, per §5a, the
443 block certbot forked). Keep the previous version before overwriting it:

```bash
cp /etc/nginx/sites-available/frybird /etc/nginx/sites-available/frybird.bak-$(date +%s)
cp deploy/nginx-frybird.conf /etc/nginx/sites-available/frybird   # (§5a: 443 block still needs its own edit)
nginx -t && systemctl reload nginx
```

and to roll back, restore the newest `.bak-*` file the same way and
`nginx -t && systemctl reload nginx` again. `nginx -t` before every reload —
a bad config leaves the last-loaded (working) config running until reload
succeeds, but reloading a broken one live is still the wrong time to find
that out.

### 9.5 Verify (read-only)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://frybirdiq.tech/api/jobs/heartbeat   # expect 404 — the real proof
curl -s -o /dev/null -w '%{http_code}\n' http://frybirdiq.tech/api/jobs/heartbeat    # expect 301 to https (port 80 only redirects)
nginx -T 2>/dev/null | grep -c 'location \^~ /api/jobs/'                             # expect 1 (live: one 443 server holds `location /`; port 80 is redirect-only)
systemctl is-active frybird-job-heartbeat.timer
journalctl -u frybird-job@heartbeat -u frybird-job-failed@heartbeat --since -1d -p warning
```

The `nginx -T` count is a sanity check on top of the https curl, not a
substitute for it — it catches the failure mode in §5a (certbot forks the
80 block into a 443 block once, at cert-issue time, and a `location` added
to this file afterwards never reaches the already-forked 443 block by
itself): 0 means it's missing from the 443 server entirely; hand-copy it in
(§5a) and re-check. This VPS's live config only has the job block in the
443 server (port 80 is a plain redirect with no locations of its own), so
1 is the expected count here — a 2 would mean it was also added to the 80
block, which isn't wrong, just unnecessary. Confirm which server block(s)
hold it with `nginx -T | grep -B5 'location \^~ /api/jobs/'` before assuming
either way.

## 10. This release: migrations 0033–0036 + the job runner (card `dv-1`)

Owner-approved (`dec-1`, `dec-2`). One-page order for this install — each
step links back to its full detail section. Do not reorder: migrations
before the job runner's own migration-dependent tables exist, `deploy.sh`
before the job unit is installed (systemd has nothing to start yet
otherwise), **nginx's own block verified live before `JOB_SECRET` is ever
set** (SECURITY-TENANCY, dv-1r-sec — otherwise there's a window where the
job route is non-dormant and the only thing refusing a public request is
the app's own header check, not nginx's), the job secret before enabling
the timer (a timer with no secret just spins on 404s), verification last.

1. **Pre-checks (read-only, §8 allowlist).** `systemctl is-active frybird`;
   record the current `drizzle.__drizzle_migrations` head before migrating —
   this release adds exactly `0033_rls_write_lockdown` through
   `0036_iq_facts`, so the head afterwards must be `0036` and nothing else
   should have moved it in between.
2. **Migrate.** `pnpm db:migrate` (§6) — applies those four, from your Mac,
   against Supabase. Confirm the new head is `0036` before moving on.

   **Stop-safety between here and step 3 (RELIABILITY, dv-1r-rel):** the
   currently-running (old) code is safe against all four. `0033` only
   revokes `anon`/`authenticated` Postgres-role write grants and narrows
   three tables' RLS policies to `SELECT`; the app — old code and new code
   alike — has never written through those roles, only through Drizzle as
   `postgres`, which owns every table and bypasses RLS entirely (see
   `0033_rls_write_lockdown.sql`'s own header comment for the full
   reasoning; CLAUDE.md's non-negotiable that the app connects as
   `postgres`). `0034`–`0036` are additive-only (`iq_*` tables old code
   never references). So a gap between migrating and deploying — even an
   unplanned one — is not an outage. To roll back the schema alone, run the
   down files in reverse: `0036_iq_facts.down.sql`,
   `0035_iq_job_runs_failures.down.sql`, `0034_iq_foundations.down.sql`,
   `0033_rls_write_lockdown.down.sql` (`supabase/rollback/`). To roll back
   the code alone, `deploy.sh` at the previous commit.
3. **Deploy the code.** `./deploy/deploy.sh root@194.238.16.200` (§7) —
   builds, ships, stamps `DEPLOY_COMMIT`, restarts `frybird`, smoke-tests
   `/`. The job route exists in the running app now but stays dormant
   (`JOB_SECRET` unset), so it answers 404 on its own even before the next
   step.
4. **Apply and verify the nginx change (§5a).** Back up the live config
   (`cp /etc/nginx/sites-available/frybird
   /etc/nginx/sites-available/frybird.bak-$(date +%s)`), copy in
   `deploy/nginx-frybird.conf`'s `location ^~ /api/jobs/` 404 and the
   server-level proxy headers — both the 80 and 443 blocks, since certbot
   forked the 443 one and a repo edit never reaches it by itself (§5a) —
   `nginx -t && systemctl reload nginx`. Then immediately check: `nginx -T |
   grep -c 'location \^~ /api/jobs/'` must be **1**, `curl` to
   `https://frybirdiq.tech/api/jobs/heartbeat` must be **404**. Do not move
   on until both hold — this is the step SECURITY-TENANCY required happen
   before the secret exists, not after.
5. **Create the job secret.** §9.1's block, run once: writes
   `/etc/frybird/jobs.header` (0600) and appends `JOB_SECRET=` to
   `/etc/frybird/env`, neither ever printed, then `systemctl restart
   frybird` (already the last line of that block).
6. **Install the job units.** §9.2's `cp`/`daemon-reload` steps for
   `frybird-job@.service`, `frybird-job-failed@.service`,
   `frybird-job-heartbeat.timer` — **do not `enable --now` the timer yet.**
7. **Run one heartbeat by hand.** `systemctl start frybird-job@heartbeat`,
   then `journalctl -u frybird-job@heartbeat -n 20` — confirm **200 and
   SUCCEEDED** before anything is on a schedule. This is the first real
   exercise of `LoadCredential`/`%d` end to end (nothing in the local proof
   used systemd at all — `docs/releases/iq-0-local-proof.md`'s own "not run
   here" list) and of this VPS's actual systemd version (open question V1,
   never resolved locally either).
8. **Enable the timer.** `systemctl enable --now frybird-job-heartbeat.timer`
   (§9.2) — now it's on a schedule.
9. **Verify nginx and the route again.** Same two checks as step 4 —
   `nginx -T` count still **1**, https still **404**. Confirms nothing
   later in the install (a reload, a cert renewal) undid step 4.
10. **Smoke.** The public site (`docs/RELEASES.md`'s usual signed-out check)
    plus `systemctl is-active frybird-job-heartbeat.timer`.

**If step 7 doesn't show SUCCEEDED, do not go on to step 8.** The manual
`systemctl start` already put the unit under `Restart=on-failure` — it keeps
auto-retrying on its own `RestartSec=360` schedule whether or not the timer
was ever enabled, so a plain "stop" is not enough on its own. Run §9.4's
`systemctl stop 'frybird-job@*.service'` then `systemctl reset-failed
'frybird-job@*.service'` before doing anything else, so no attempt is left
retrying in the background while the failure is investigated. §9.4 has the
rest of the disable/rollback steps if you need to back out after step 6; to
roll back step 4 alone, restore the newest `frybird.bak-*` file and
`nginx -t && systemctl reload nginx` again (§5a).

## 11. Alerting (card `p0-1`) — written, NOT installed

Before this, nothing told a human that production was down, that a job
failed, or that the nightly backup failed: the failure units wrote one journal
line. Three parts. **Nothing here has been run on the VPS.**

**11.1 `/api/health` — code, ships with the next deploy.** `GET` returns
`200 {"status":"ok"}` only if the app answered and Postgres answered
`select 1`; otherwise `503 {"status":"unavailable"}`. Public, no auth, no
version/commit/schema/error text, `Cache-Control: no-store`, answer cached 5 s
so the URL cannot hammer the database, 3 s probe timeout. It does **not** check
that scheduled jobs are running (see 11.4).

**11.2 On-box failure alerts — files in `deploy/`, VPS change, needs an owner
channel.** `deploy/notify.sh` POSTs one plain-text line (unit, host, UTC time;
never journal contents) to `ALERT_URL` from `/etc/frybird/alert.env`.
`frybird-alert@.service` runs it; `frybird-backup.service` gets
`OnFailure=frybird-alert@%n.service`; `frybird-job-failed@.service` (already
fired by `frybird-job@.service`'s `OnFailure=`) gets a second `ExecStart`.
Install, in this order, as root, after the owner has given the URL:

```bash
install -m 750 deploy/notify.sh /usr/local/bin/frybird-notify
install -m 600 -o root -g root /dev/null /etc/frybird/alert.env
# put ALERT_URL=<owner's channel URL> in it, never printed, never committed
cp deploy/frybird-alert@.service deploy/frybird-backup.service deploy/frybird-job-failed@.service /etc/systemd/system/
systemctl daemon-reload
systemctl start frybird-alert@test.service     # one test alert; owner confirms it arrived
```

Without `alert.env` the units still log and `frybird-notify` exits non-zero,
so the unconfigured state shows in `systemctl --failed` instead of passing
silently. `OnFailure=` on `frybird.service` itself was deliberately not added:
it has `Restart=always, RestartSec=5`, which never reaches systemd's start limit,
so the hook would never fire. An app that is down is caught by 11.3.

**11.3 External uptime monitor — design only, nothing created.** Service:
UptimeRobot, free plan (or Better Stack; same shape). Monitors: (a) HTTPS
`https://frybirdiq.tech/api/health`, expect status 200 and keyword `ok`;
(b) HTTPS `https://frybirdiq.tech/` expect 200. Interval 5 min (free-plan
floor), alert after 2 consecutive failures (so ~10 min to alert), plus
recovery notice. Alert lands: owner's email + the provider's mobile push app.
Also turn on its SSL-expiry reminder if the plan offers one (certbot renews
automatically; this is the check that it actually did). It polls from outside,
so it is the only part that catches "the whole VPS is down".

**Owner approvals and credentials for 11.2/11.3 (nothing below exists yet):**
1. Approve creating an UptimeRobot account (owner's email) and the two monitors.
2. Say where alerts go: which email, and install the provider's phone app for push.
3. Choose the on-box channel and supply its URL for `ALERT_URL`: simplest is
   an ntfy.sh topic (no account; pick a long random topic name, install the ntfy
   phone app, subscribe). That URL is a secret. Telegram/Slack need their own
   bot/webhook and a small change to `notify.sh`.
4. Approve the VPS change in 11.2 (god runs it under the §10 rules).

**11.4 Not covered.** No app error tracker (Sentry, needs account + a dependency,
own card). No dead-man check that the hourly heartbeat still ran: the job unit
is `IPAddressDeny=any` except localhost, so pinging out from it needs a
hardening change; decide separately. `/api/health` proves the DB is
reachable, not that jobs are running.

## What this does not have yet

- **No zero-downtime deploy.** `systemctl restart` stops the old process before
  the new one is listening — a second or two of 502s.
- **No error monitoring.** §53 asks for structured logging, request IDs and
  error monitoring. Right now there is `journalctl` and nothing else, so a
  failure at 9pm on a Saturday is invisible until someone rings up.
- **No staging.** §80 asks for development, staging and production. There are
  two: your Mac and the real shop.

None of these block a first deploy. All of them matter before this is the only
way FRYBIRD takes orders.
