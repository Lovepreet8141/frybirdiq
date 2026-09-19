#!/usr/bin/env bash
#
# End-to-end test of deploy/backup.sh + deploy/restore-check.sh, run on a dev
# Mac with Docker. Never touches production or the VPS.
#
#   deploy/test/backup-test.sh
#
# What it builds: a throwaway postgres:17 container with its own server. The
# fixture is a copy of the LOCAL supabase stack's schema and data (read-only
# pg_dump via `docker exec supabase_db_Frybirdiq`, so `supabase start` must be
# up) plus two synthetic staff rows in auth.users. The offsite "remote" is a
# local directory (rclone supports that) and the age key is generated in the
# container. Everything is discarded at the end.
#
# Cases: (1) happy path: dumps, counts, encrypted offsite, decrypt + list, restore-check PASS;
# (2) remote set but no age recipient: refuses, nothing uploaded, local dumps kept;
# (3) tampered counts: restore-check FAILs;
# (4) restore-check with no auth dump: FAILs (staff logins uncovered).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'docker rm -f frybird-backup-test >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

echo "==> fixture from the local supabase stack (read-only)"
docker exec supabase_db_Frybirdiq pg_dump -U postgres -d postgres --schema=public --schema=auth \
  --format=custom --no-owner --no-privileges > "$work/fixture.dump"

docker rm -f frybird-backup-test >/dev/null 2>&1 || true
docker run -d --name frybird-backup-test -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$here:/repo:ro" -v "$work:/work" postgres:17 >/dev/null
docker exec frybird-backup-test bash -c '
  until pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq age rclone sudo >/dev/null 2>&1
  command -v age && command -v rclone' >/dev/null

docker exec -i frybird-backup-test bash -s <<'INNER'
set -uo pipefail
pass=0; failn=0
ok()   { echo "  ok   $*"; pass=$((pass+1)); }
nok()  { echo "  FAIL $*"; failn=$((failn+1)); }
check(){ if eval "$2"; then ok "$1"; else nok "$1"; fi; }

createdb -U postgres srcdb
psql -U postgres -d srcdb -q -c "create role authenticated; create role anon; create role service_role; create role supabase_auth_admin; create role authenticator; create role supabase_admin;" >/dev/null 2>&1
pg_restore -U postgres -d srcdb --no-owner --no-privileges /work/fixture.dump >/dev/null 2>&1
psql -U postgres -d srcdb -q -c "insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), 'staff1@example.test', 'x'), (gen_random_uuid(), 'staff2@example.test', 'x');"
src_orders=$(psql -U postgres -d srcdb -At -c "select count(*) from public.orders")
src_users=$(psql -U postgres -d srcdb -At -c "select count(*) from auth.users")
echo "fixture: orders=$src_orders auth_users=$src_users"

age-keygen -o /root/owner.key 2>/root/pub.txt; pub=$(awk "/Public key/{print \$3}" /root/pub.txt)
# The database now demands a password over TCP (the URL below carries a marker password
# with an encoded @), so a run proves the password really reaches the server, and
# the argv probe below has something to look for.
psql -U postgres -q -c "alter role postgres password 'S3cretMARKER@x'" >/dev/null
# Every TCP line demands the password (postgres:17 pads its columns, so match with [[:space:]]).
sed -E -i 's/^(host[[:space:]].*[[:space:]])trust[[:space:]]*$/\1scram-sha-256/' "$(psql -U postgres -At -c 'show hba_file')"
psql -U postgres -q -c "select pg_reload_conf()" >/dev/null
printf "%s\n" "SUPABASE_SERVICE_ROLE_KEY=svc-must-not-leak" "DATABASE_URL=\"postgres://postgres:S3cretMARKER%40x@127.0.0.1/srcdb\"" > /root/env
# Slow the DB tools by 2s so the argv probe has a wide window to look in.
for t in pg_dump psql; do real=$(command -v $t); printf "#!/bin/sh\nsleep 2\nexec %s \"\$@\"\n" "$real" > /usr/local/bin/$t; chmod 755 /usr/local/bin/$t; done
run_backup() { # <backup.env content> ; returns backup.sh exit code
  rm -rf /bk /off /root/argv.hits /root/env.hits; mkdir -p /off
  printf "%b" "$1" > /root/backup.env
  # Probe: every 50ms, look at the command line of EVERY process for the password (encoded or not).
  ( exec 2>/dev/null; while [ ! -f /root/probe.stop ]; do
      for f in /proc/[0-9]*/cmdline; do tr "\0" " " < "$f" 2>/dev/null; echo; done | grep -E "S3cretMARK[E]R" >> /root/argv.hits
      for f in /proc/[0-9]*/environ; do tr "\0" "\n" < "$f" 2>/dev/null; done | grep -q "svc-must-not-lea[k]" && echo hit >> /root/env.hits
      sleep 0.05; done ) &
  probe=$!; rm -f /root/probe.stop
  ENV_FILE=/root/env BACKUP_ENV=/root/backup.env BACKUP_DIR=/bk bash /repo/backup.sh > /root/backup.out 2>&1
  rcode=$?
  touch /root/probe.stop; wait $probe 2>/dev/null; rm -f /root/probe.stop
  return $rcode
}
rc() { PG_AS="gosu postgres" RESULT_DIR=/res BACKUP_DIR=/bk bash /repo/restore-check.sh "$@" > /root/rc.out 2>&1; }
chmod 755 /root; chmod 644 /root/env

echo "== 1. happy path"
run_backup "BACKUP_RCLONE_REMOTE=/off\nBACKUP_AGE_RECIPIENT=$pub\n"; r=$?
check "TCP really enforces the password (no password -> refused)" "! psql 'postgres://postgres@127.0.0.1/srcdb' -w -c 'select 1' >/dev/null 2>&1"
check "backup.sh exits 0 (password reached the server through PGPASSWORD, @ decoded)" "[ $r -eq 0 ]"
check "database password never appears in ANY process argv during the run" "[ ! -s /root/argv.hits ] || { head -3 /root/argv.hits | cut -c1-200; false; }"
check "the backup directory is mode 700" "[ \$(stat -c %a /bk) = 700 ]"
check "other secrets in the env file (service-role key) never reach any child process environment" "[ ! -s /root/env.hits ]"
check "public + auth dumps and counts exist" "ls /bk/frybird-*[0-9].dump /bk/frybird-*.auth.dump /bk/frybird-*.counts >/dev/null 2>&1"
check "offsite holds only encrypted dumps (.age) plus counts" "[ \$(ls /off | grep -c '\.dump\.age\$') -eq 2 ] && ! ls /off | grep -q '\.dump\$'"
check "no plaintext dump content offsite (no PGDMP magic)" "! grep -rl PGDMP /off"
check "no leftover .age on the box" "! ls /bk | grep -q '\.age\$'"
for f in /off/*.dump.age; do
  age -d -i /root/owner.key "$f" > /root/dec.dump 2>/dev/null
  check "owner key decrypts $(basename $f) to a readable archive" "pg_restore --list /root/dec.dump >/dev/null 2>&1"
done
check "decrypt with a wrong key fails" "age-keygen -o /root/other.key 2>/dev/null; ! age -d -i /root/other.key \$(ls /off/*.dump.age | head -1) >/dev/null 2>&1"
mkdir -p /res; chown postgres /res 2>/dev/null; chmod 777 /res
rc; r=$?; cat /root/rc.out | sed "s/^/    | /"
check "restore-check PASS" "[ $r -eq 0 ] && grep -q 'RESULT: PASS' /root/rc.out"
check "result file recorded with orders and auth_users counts" "grep -q \"restored orders=$src_orders\" /res/restore-check-*.txt && grep -q \"restored auth_users=$src_users\" /res/restore-check-*.txt"

echo "== 6. restore-check with leftover scratch databases present"
createdb -U postgres frybird_restore_public; createdb -U postgres frybird_restore_auth
psql -U postgres -d frybird_restore_public -q -c "create table stale(x int)"
rc; r=$?
check "still PASSes, and the stale table is gone" "[ $r -eq 0 ] && ! psql -U postgres -d frybird_restore_public -At -c 'select 1 from stale' >/dev/null 2>&1"

echo "== 3. tampered counts (a restore with fewer rows than were counted must FAIL)"
sed -i "s/^before_orders=.*/before_orders=$((src_orders+50))/;s/^after_orders=.*/after_orders=$((src_orders+60))/" /bk/frybird-*.counts
rc; r=$?
check "restore-check FAILs when restored < counted before" "[ $r -ne 0 ] && grep -q 'RESULT: FAIL' /root/rc.out"

echo "== 4. no auth dump"
rm -f /bk/frybird-*.auth.dump
rc; r=$?
check "restore-check FAILs without an auth dump" "[ $r -ne 0 ] && grep -q 'staff logins are not backed up' /root/rc.out"

echo "== 2. remote configured but no age recipient (fail closed)"
run_backup "BACKUP_RCLONE_REMOTE=/off\n"; r=$?
check "backup.sh exits non-zero (so the failure alert fires)" "[ $r -ne 0 ]"
check "nothing uploaded" "[ -z \"\$(ls -A /off)\" ]"
check "local dumps still written" "ls /bk/frybird-*[0-9].dump /bk/frybird-*.auth.dump >/dev/null 2>&1"
check "message says refused" "grep -q 'offsite refused' /root/backup.out"

echo "== 5. offsite not configured: warns, still succeeds"
run_backup ""; r=$?
check "exit 0 and says offsite NOT configured" "[ $r -eq 0 ] && grep -q 'offsite NOT configured' /root/backup.out"

echo "== 7. DATABASE_URL password forms (auth is enforced, so each must really authenticate)"
setpw() { psql -U postgres -q -c "alter role postgres password \$q\$$1\$q\$" >/dev/null; }
useurl() { printf "%s\n" "DATABASE_URL=$1" > /root/env; }
try() { # <label> <role password> <url> <expect: ok|refuse>
  setpw "$2"; useurl "$3"; run_backup ""; local r=$?
  if [ "$4" = ok ]; then
    check "$1: backup succeeds" "[ $r -eq 0 ] && ls /bk/frybird-*[0-9].dump >/dev/null 2>&1"
  else
    check "$1: exits non-zero and writes no dump" "[ $r -ne 0 ] && ! ls /bk/*.dump >/dev/null 2>&1"
  fi
  check "$1: password never in any argv" "[ ! -s /root/argv.hits ]"
}
try "raw backslash and raw % not followed by hex" 'S3cretMARKER\x%zz' 'postgres://postgres:S3cretMARKER\x%zz@127.0.0.1/srcdb' ok
try "encoded %40 and %25 decode" 'S3cretMARKER@x%1' 'postgres://postgres:S3cretMARKER%40x%251@127.0.0.1/srcdb' ok
try "?password= query parameter" 'S3cretMARKER@x' 'postgres://postgres@127.0.0.1/srcdb?sslmode=disable&password=S3cretMARKER%40x' ok
try "?password= with a uppercase key and other params kept" 'S3cretMARKER@x' 'postgres://postgres@127.0.0.1/srcdb?PASSWORD=S3cretMARKER%40x&connect_timeout=5' ok
try "password given twice is refused" 'S3cretMARKER@x' 'postgres://postgres:S3cretMARKER%40x@127.0.0.1/srcdb?password=S3cretMARKER%40x' refuse
try "WRONG password fails closed" 'S3cretMARKER@x' 'postgres://postgres:S3cretWRONG@127.0.0.1/srcdb' refuse

echo; echo "passed=$pass failed=$failn"; [ $failn -eq 0 ]
INNER
