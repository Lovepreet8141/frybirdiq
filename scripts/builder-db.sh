#!/usr/bin/env bash
# Own local test database for a builder worktree: a separate database on the local Docker Postgres,
# built ONLY from the migration files in the given worktree. Refuses anything that is not local.
#   scripts/builder-db.sh <name> [worktree-dir]     -> creates database frybird_b_<name>, writes <worktree>/.env.test.local
set -euo pipefail
NAME="${1:?usage: builder-db.sh <name> [worktree]}"; WT="${2:-$PWD}"
[[ "$NAME" =~ ^[a-z0-9_]+$ ]] || { echo "name must be [a-z0-9_]+"; exit 1; }
D="frybird_b_$NAME"; C=supabase_db_Frybirdiq
P() { docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
PD() { docker exec -i $C psql -U postgres -d "$D" -v ON_ERROR_STOP=1 -q "$@"; }
P -d postgres -c "DROP DATABASE IF EXISTS $D"; P -d postgres -c "CREATE DATABASE $D"
PD -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text); CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'select null::uuid'; CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'select null::text'; CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid); CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS 'select string_to_array(name, ''/'')'; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY"
for f in $(ls "$WT"/supabase/migrations/*.sql | sort) $(ls "$WT"/supabase/migrations/PENDING_*.sql 2>/dev/null | sort); do PD --single-transaction < "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }; done
BASE=$(grep -E '^DATABASE_URL=' "$WT/.env.test.local" 2>/dev/null | head -1 | sed -E 's#(postgres(ql)?://[^/]+/).*#\1#' || true)
[ -n "$BASE" ] || { echo "no DATABASE_URL in $WT/.env.test.local: copy the integrator's .env.test.local there first"; exit 1; }
sed -i.bak -E "s#^DATABASE_URL=.*#DATABASE_URL=${BASE}${D}#" "$WT/.env.test.local"; rm -f "$WT/.env.test.local.bak"
echo "database $D ready; $WT/.env.test.local now points at it"
