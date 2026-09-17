import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { payments, webhookEvents } from "@/db/schema";
import { RAZORPAY_PROVIDER, getProvider, isRazorpayConfigured } from "@/lib/payments";
import { markOnlinePaymentFailed, recordOnlinePayment } from "@/lib/repositories/payments";

/**
 * Razorpay webhook. Roadmap 1.3 (and the server half of 1.5).
 *
 * §45: verified, idempotent, and it never trusts the payload for money. The
 * signature is checked over the raw body before anything is read from it.
 * Every verified event lands in `webhook_events`, unique on (provider,
 * event id), so a redelivery is answered from the table rather than
 * re-run. A captured payment goes through the same settlement core the
 * order page's confirm uses — `recordOnlinePayment` — which is itself
 * idempotent on the Razorpay payment id and asks Razorpay for the payment
 * before it records a rupee. Replaying the same webhook twice records one
 * payment.
 *
 * A processing failure (Razorpay unreachable, say) is stored on the event
 * row and answered with 500 so Razorpay retries; the retry finds the row
 * unprocessed and runs it again. A duplicate of a processed event is 200.
 */

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string | null; error_description?: string | null; status?: string } };
    order?: { entity?: { id?: string } };
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRazorpayConfigured()) return NextResponse.json({ error: "razorpay is not configured" }, { status: 503 });

  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const verification = await getProvider(RAZORPAY_PROVIDER).verifyWebhook({ body, signature });
  if (!verification.ok) {
    // Not recorded: an unsigned or mis-signed body is noise, and a table of
    // it would be a place for an attacker to write.
    return NextResponse.json({ error: verification.error ?? "unverified" }, { status: 400 });
  }

  let parsed: RazorpayWebhookBody;
  try {
    parsed = JSON.parse(body) as RazorpayWebhookBody;
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }

  // Razorpay sends x-razorpay-event-id; fall back to a hash of the body so
  // an event without one is still deduplicated on its exact content.
  const eventId = request.headers.get("x-razorpay-event-id")?.trim() || `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const eventType = verification.eventType ?? parsed.event ?? "unknown";

  const database = db();
  const [inserted] = await database
    .insert(webhookEvents)
    .values({ provider: RAZORPAY_PROVIDER, eventId, eventType, payload: parsed as Record<string, unknown>, signatureVerified: "true" })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });

  let eventRowId = inserted?.id ?? null;
  if (!eventRowId) {
    const [existing] = await database
      .select({ id: webhookEvents.id, processedAt: webhookEvents.processedAt })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, RAZORPAY_PROVIDER), eq(webhookEvents.eventId, eventId)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "could not record event" }, { status: 500 });
    if (existing.processedAt) return NextResponse.json({ ok: true, duplicate: true });
    eventRowId = existing.id; // recorded before, never finished — run it again
  }

  let outcome: Outcome;
  try {
    outcome = await handle(eventType, parsed);
  } catch (error) {
    // An unexpected throw from `handle` (a database error, an exhausted
    // retry inside settle()'s invoice-numbering, anything not already
    // turned into a `{ ok: false }` result) used to escape this route
    // entirely — the `webhookEvents` row below was never reached, so it
    // stayed at `processedAt: null` with no `error` recorded: invisible to
    // the audit trail this table exists for, and worse, the payment can
    // already have been captured as an earlier, separate statement by the
    // time the throw happens, so this is not a "nothing happened" failure.
    // Recorded and retried exactly like an ordinary `{ ok: false, retry:
    // true }` outcome, rather than a raw 500 with nothing written down.
    outcome = { ok: false, error: error instanceof Error ? error.message : "unexpected error", retry: true };
  }

  await database
    .update(webhookEvents)
    .set(outcome.ok ? { processedAt: new Date(), error: null } : { error: outcome.error.slice(0, 500) })
    .where(eq(webhookEvents.id, eventRowId));

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.retry ? 500 : 200 });
  return NextResponse.json({ ok: true });
}

type Outcome = { ok: true } | { ok: false; error: string; retry: boolean };

/** Which of our orders a Razorpay order id belongs to — through the pending payment row that was opened for it. */
async function orderIdForProviderOrder(providerOrderId: string | null | undefined): Promise<string | null> {
  if (!providerOrderId) return null;
  const [row] = await db()
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(and(eq(payments.provider, RAZORPAY_PROVIDER), eq(payments.providerOrderId, providerOrderId)))
    .limit(1);
  return row?.orderId ?? null;
}

async function handle(eventType: string, body: RazorpayWebhookBody): Promise<Outcome> {
  const payment = body.payload?.payment?.entity;

  switch (eventType) {
    case "payment.captured":
    case "order.paid": {
      if (!payment?.id) return { ok: false, error: "no payment entity", retry: false };
      const orderId = await orderIdForProviderOrder(payment.order_id ?? body.payload?.order?.entity?.id);
      // Not ours (a payment made outside this app on the same Razorpay
      // account). Acknowledged, not retried.
      if (!orderId) return { ok: false, error: `no order for razorpay order ${payment.order_id ?? "?"}`, retry: false };
      const result = await recordOnlinePayment({ orderId, providerPaymentId: payment.id, providerOrderId: payment.order_id ?? undefined });
      if (result.ok) return { ok: true };
      // "already paid" by another attempt is final; a gateway or database
      // error is worth a retry.
      const final = /already been paid|different order|does not match/i.test(result.error);
      return { ok: false, error: result.error, retry: !final };
    }
    case "payment.failed": {
      const orderId = await orderIdForProviderOrder(payment?.order_id);
      if (!orderId) return { ok: true };
      // The proof here is the webhook body signature, verified above — which
      // is also why this reporter may carry the gateway's own wording.
      await markOnlinePaymentFailed({ orderId, via: { kind: "webhook", reason: payment?.error_description ?? "Payment failed" } });
      return { ok: true };
    }
    default:
      // Recorded for the audit trail; nothing to do for refunds (we
      // initiate those) or settlement events yet.
      return { ok: true };
  }
}
