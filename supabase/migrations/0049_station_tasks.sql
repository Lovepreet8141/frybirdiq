-- Station tasks (roadmap 4.2, combos and sauces). Relaxes one unique index on
-- the new kitchen_line_status table (PENDING_stations): a combo line is worked
-- at several stations, so a done mark is per (order item, station) rather than
-- per order item. Run after PENDING_stations. No data is lost: every existing
-- row is still unique under the wider key.
DROP INDEX IF EXISTS "kitchen_line_status_item_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "kitchen_line_status_item_station_idx" ON "kitchen_line_status" USING btree ("order_item_id","station");
