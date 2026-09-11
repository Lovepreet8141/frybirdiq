-- Explicit Supabase Storage RLS policies for the `media` bucket, created for
-- the Menu Manager's media library.
--
-- Today, before this migration, `storage.objects` has row-level security
-- enabled (Supabase's default on every project) and carries zero policies
-- for this bucket. With RLS on and no policy, Postgres denies every
-- operation to any role that is not the table owner or a role that bypasses
-- RLS outright — so anonymous/authenticated writes are already refused in
-- practice. But "already refused because nothing says otherwise" is an
-- absence, not a stated intent: nothing here would stop the *next* migration
-- from adding a permissive policy without anyone noticing it changed this
-- bucket's posture. This migration makes the intended model explicit and
-- durable, the same way 0001 made table-level tenancy explicit instead of
-- resting on every repository remembering to filter by org.
--
-- The model:
--   - Read: public. The bucket's own `public` flag already serves downloads
--     through Storage's unauthenticated public-URL endpoint without
--     touching RLS at all (that is how every product photo on the website
--     loads today) — this SELECT policy exists so an authenticated read
--     path is equally explicit, not because the public path needs it.
--   - Write (insert/delete): only an active OWNER, ADMIN or MANAGER — the
--     same roles `menu.edit` already grants in src/domain/permissions.ts —
--     and only inside their own organization's folder. The application's
--     own upload path (src/lib/repositories/media.ts) always writes to
--     "<orgId>/<uuid>.<ext>" using the service role, which bypasses RLS
--     entirely and is unaffected by this; these policies are the backstop
--     for anyone calling Supabase Storage directly with a signed-in user's
--     own session, bypassing the Next.js app.
--   - Overwrite/metadata update: refused for every non-service-role
--     caller — there is deliberately no UPDATE policy. Every upload gets a
--     fresh random filename (see media.ts), so this app never updates a
--     Storage object in place; a policy permitting it would only be a
--     capability nothing legitimate uses and something illegitimate could.
--
-- Reuses auth_has_role(target_org, roles), defined in 0001, which already
-- resolves the signed-in user's active membership and role without RLS
-- recursion (SECURITY DEFINER).

CREATE POLICY "media_public_read" ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'media');

CREATE POLICY "media_insert_own_org_editors" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND auth_has_role((storage.foldername(name))[1]::uuid, ARRAY['OWNER', 'ADMIN', 'MANAGER'])
);

CREATE POLICY "media_delete_own_org_editors" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND auth_has_role((storage.foldername(name))[1]::uuid, ARRAY['OWNER', 'ADMIN', 'MANAGER'])
);
