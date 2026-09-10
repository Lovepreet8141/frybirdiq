-- FRYBIRD's menu prices are GST-inclusive. Confirmed against a counter bill.
--
-- The board price is the final price: a ₹99 burger takes ₹99 at the till and
-- books ₹94.29 of revenue against ₹4.71 of GST payable. Until now the schema
-- assumed `exclusive`, which would have rung it up at ₹103.95 and overstated
-- revenue by the tax rate on every order.
--
-- One value decides this. Every price, invoice line and margin figure reads it
-- through src/lib/pricing, so flipping the default and the existing row is the
-- entire change.

ALTER TABLE "organizations" ALTER COLUMN "price_basis" SET DEFAULT 'inclusive';

-- Scoped to FRYBIRD rather than every row: this is a finding about one
-- business's menu boards, not a fact about restaurants in general. A second
-- organization would need its own bill checked.
UPDATE "organizations" SET "price_basis" = 'inclusive' WHERE "slug" = 'frybird';

-- NOTE FOR A LIVE DATABASE
--
-- This corrects the setting, not history. Orders already written under the
-- exclusive assumption carry stored taxable_total, tax_total, cgst_total and
-- sgst_total that were computed the wrong way, and changing the flag does not
-- recompute them — order rows are snapshots by design (§51).
--
-- No orders exist at the time of writing, so there is nothing to repair. If
-- that ever stops being true before this is applied, the orders written under
-- the old basis have to be identified and recomputed deliberately, not left to
-- be silently inconsistent with everything written after.
