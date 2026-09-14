-- Realtime. BUILD-PLAN.md §18; roadmap Phase 2.
--
-- Two paths, one source of truth (order_events):
--
-- 1. Staff screens subscribe to Postgres changes on order_events (and, for
--    the POS grid, on products / product_availability). Row-level security
--    from 0001 already limits every row to the signed-in member's
--    organization, and Realtime applies the same policies to the change
--    stream, so a member of one organization can never receive another's
--    events. The tables just have to be in the publication.
--
-- 2. The customer's tracking page has no staff session, so it cannot read
--    order_events. Instead a trigger broadcasts each new event to a public
--    topic named by the order's own id — an unguessable uuid the customer
--    already holds because it is in their URL — carrying only the status
--    and the time. Nothing else about the order leaves the database this
--    way.
--
-- Both guards below exist so an order write can never fail because of
-- Realtime: if the publication or realtime.send is missing, the write goes
-- through and the screens fall back to their 60 s poll.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['order_events', 'products', 'product_availability'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = target
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', target);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.order_events_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Broadcast-from-database: realtime.send(payload, event, topic, private).
  -- Guarded so a project without the function still inserts the event.
  IF to_regprocedure('realtime.send(jsonb, text, text, boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object(
          'orderId', NEW.order_id,
          'fromStatus', NEW.from_status,
          'toStatus', NEW.to_status,
          'at', NEW.created_at
        ),
        'status',
        'order:' || NEW.order_id::text,
        false
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never let a notification failure roll back an order event.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS order_events_broadcast_trigger ON public.order_events;
--> statement-breakpoint
CREATE TRIGGER order_events_broadcast_trigger
AFTER INSERT ON public.order_events
FOR EACH ROW EXECUTE FUNCTION public.order_events_broadcast();
