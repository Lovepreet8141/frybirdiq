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
export DATABASE_URL="postgres://postgres@127.0.0.1/srcdb"
: > /root/env
run_backup() { # <backup.env content> ; returns backup.sh exit code
  rm -rf /bk /off; mkdir -p /off
  printf "%b" "$1" > /root/backup.env
  ENV_FILE=/root/env BACKUP_ENV=/root/backup.env BACKUP_DIR=/bk DATABASE_URL="$DATABASE_URL" bash /repo/backup.sh > /root/backup.out 2>&1
}
rc() { PG_AS="gosu postgres" RESULT_DIR=/res BACKUP_DIR=/bk bash /repo/restore-check.sh "$@" > /root/rc.out 2>&1; }
chmod 755 /root; chmod 644 /root/env

echo "== 1. happy path"
run_backup "BACKUP_RCLONE_REMOTE=/off\nBACKUP_AGE_RECIPIENT=$pub\n"; r=$?
check "backup.sh exits 0" "[ $r -eq 0 ]"
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

echo; echo "passed=$pass failed=$failn"; [ $failn -eq 0 ]
INNER
