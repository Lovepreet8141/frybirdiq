-- Move the GST price basis from products to the organization.
--
-- Whether menu prices include GST is one decision for the whole business, not
-- a per-item attribute. As a column on `products` the answer could drift item
-- by item, and the two modes differ by the tax rate on every total — so drift
-- here is silent revenue error rather than a visible bug.
--
-- Now a single value that every price, invoice line and margin figure reads
-- through src/lib/pricing.

ALTER TABLE "organizations" ADD COLUMN "price_basis" "price_basis" DEFAULT 'exclusive' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "price_basis";