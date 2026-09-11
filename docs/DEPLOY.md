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
```

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

## What this does not have yet

- **No zero-downtime deploy.** `systemctl restart` stops the old process before
  the new one is listening — a second or two of 502s.
- **No backups of your own.** Supabase backs up the database on its own
  schedule. Nothing here backs up WordPress; that is separate.
- **No error monitoring.** §53 asks for structured logging, request IDs and
  error monitoring. Right now there is `journalctl` and nothing else, so a
  failure at 9pm on a Saturday is invisible until someone rings up.
- **No staging.** §80 asks for development, staging and production. There are
  two: your Mac and the real shop.

None of these block a first deploy. All of them matter before this is the only
way FRYBIRD takes orders.
