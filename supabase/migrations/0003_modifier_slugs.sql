-- Give modifiers a stable identity, independent of their display name.
--
-- The menu repository derived a modifier's slug from its name — slugify("8 pc")
-- gives "8-pc" — while src/db/menu-data.ts declares "8pc". The two disagreed,
-- so a cart carrying "8pc" resolved against the database silently dropped the
-- size modifier and priced Nashville wings at ₹179 instead of ₹299.
--
-- The failure mode is the dangerous kind: no error, no warning, the customer
-- is simply undercharged. Renaming any modifier would have done the same to
-- every saved cart.
--
-- Identity is now stored rather than derived.

-- The columns are NOT NULL with no default, so existing rows have to go first.
-- The seed recreates every one of them, and no orders exist yet — order lines
-- snapshot their own modifier names anyway (§51), so nothing referencing these
-- rows loses meaning.
DELETE FROM "modifiers";
DELETE FROM "modifier_groups";

ALTER TABLE "modifier_groups" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "modifiers" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_org_slug_unique" UNIQUE("org_id","slug");--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_slug_unique" UNIQUE("group_id","slug");
