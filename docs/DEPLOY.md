# Deploying to a Hostinger VPS

WordPress on the apex domain, the ordering app on `order.frybird.in`, both on
one box. The database stays on Supabase — nothing about this puts Postgres on
the VPS.

Everything here is written to be run by you, on your server. I have no access
to it and have not run any of it.

---

## Before anything else: the database connection will break

Your `DATABASE_URL` currently points at Supabase's **direct** connection:

```
db.shbmprmarlubyhaklmpr.supabase.co:5432
```

That host is **IPv6-only** on current Supabase projects. It works from your Mac
because your home connection has IPv6. Most VPS instances are IPv4-primary, and
on one of those the app will start cleanly, serve the menu from cache, and then
fail on the first database read with a connection timeout — which looks like a
Supabase outage rather than a config problem.

Use the **Session pooler** string in production instead:

Supabase dashboard → Project Settings → Database → Connection string → **Session
pooler**. It looks like:

```
postgresql://postgres.shbmprmarlubyhaklmpr:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two things to carry over:

- The username changes to `postgres.<project-ref>`. It is not just a new host.
- Your password contains an `@`, which must stay percent-encoded as `%40`, or
  the driver reads the host as starting from the wrong character.

`postgres` is already configured with `prepare: false`, which is what a pooled
connection requires.

Check before you deploy:

```bash
psql "$DATABASE_URL" -c "select 1"
```

---

## 1. The VPS

A 2 GB plan is the smallest sensible size once WordPress and PHP-FPM are also
running. 1 GB will work but leaves nothing spare.

Ubuntu 22.04 or 24.04. If you pick a Hostinger template that installs a control
panel, the panel manages nginx — see the note in step 5.

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
./deploy/deploy.sh frybird@YOUR_SERVER_IP
```

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
| A | `@` | your server IP |
| A | `www` | your server IP |
| A | `order` | your server IP |

Then certificates:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d frybird.in -d www.frybird.in -d order.frybird.in
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
./deploy/deploy.sh frybird@YOUR_SERVER_IP
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
