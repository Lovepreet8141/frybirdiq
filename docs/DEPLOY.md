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

Owner decision `dec-1` (job runner on the VPS) has not been made — **do not
install anything in this section until god says that decision has landed.**
Everything here is the repo-file side only; it ships dormant (`JOB_SECRET`
unset) either way, so committing it carries no production risk by itself.

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
printf 'JOB_SECRET=%s\n' "$(cat /tmp/frybird-job-secret)" >> /etc/frybird/env
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
earlier setup, remove that line first so the file doesn't carry two.

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
```

stops future runs; a run already in flight finishes on its own (it's a
plain `curl`, nothing tracks the timer after it starts). To go back to fully
dormant instead of just paused, unset `JOB_SECRET` and `JOB_SECRET_PREVIOUS`
in `/etc/frybird/env` and restart `frybird` — every job route then answers
404 again regardless of whether any timer is still enabled. To remove the
units entirely:

```bash
systemctl disable --now frybird-job-heartbeat.timer
rm /etc/systemd/system/frybird-job@.service /etc/systemd/system/frybird-job-failed@.service /etc/systemd/system/frybird-job-heartbeat.timer
systemctl daemon-reload
```

No migration or data is touched by any of this — `iq_job_runs` rows from
past runs are just history.

### 9.5 Verify (read-only)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://frybirdiq.tech/api/jobs/heartbeat   # expect 404
curl -s -o /dev/null -w '%{http_code}\n' http://frybirdiq.tech/api/jobs/heartbeat    # expect 404 (or 301 to https, then 404)
nginx -T 2>/dev/null | grep -c 'location \^~ /api/jobs/'                             # expect 2 — one per listener (§5a)
systemctl is-active frybird-job-heartbeat.timer
journalctl -u frybird-job@heartbeat -u frybird-job-failed@heartbeat --since -1d -p warning
```

The `nginx -T` count catches exactly the failure mode in §5a: certbot forks
the 80 block into a 443 block once, at cert-issue time, and a `location`
added to this file afterwards never reaches the already-forked 443 block by
itself. 1 means the 443 block is missing it; hand-copy it in (§5a) and
re-check.

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
