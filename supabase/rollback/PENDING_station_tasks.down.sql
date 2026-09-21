-- Hand-run only. Reverses PENDING_station_tasks: back to one done mark per order
-- item. REFUSES while any item has marks at more than one station (a combo), as
-- collapsing them would lose which stations finished. Run before
-- PENDING_stations.down.sql if rolling back both.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "kitchen_line_status" GROUP BY "order_item_id" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'kitchen_line_status has items marked at several stations; delete those rows deliberately first';
  END IF;
END $$;
DROP INDEX IF EXISTS "kitchen_line_status_item_station_idx";
CREATE UNIQUE INDEX "kitchen_line_status_item_idx" ON "kitchen_line_status" USING btree ("order_item_id");
COMMIT;
