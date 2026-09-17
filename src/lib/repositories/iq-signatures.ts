import "server-only";

/**
 * Money crash signatures: the read side (IQ-2 S5, DESIGN.md §1b, R2.5, R2.7).
 *
 * One SELECT per rule, each in its own REPEATABLE READ READ ONLY transaction
 * with statement_timeout 10 s: no FOR UPDATE/SHARE, no advisory locks, nothing
 * that can block a live settlement or refund, and a stray write fails with
 * SQLSTATE 25006. Every query is scoped to the caller's org. Counts only —
 * no order id, amount or claim key leaves this file.
 *
 * Whole-state evaluation, not a 48 h window: each query counts every row in
 * the state (the tables are one restaurant's orders), so a persistent finding
 * is re-checked on every run and only ever expires when its state is gone,
 * which R2.7's window-plus-re-check was there to guarantee.
 *
 * Rules read today's schema, before the refund release: every `refunds` row is
 * a completed refund. The post-release rules and the switch to SUCCEEDED
 * refunds are S6.
 */

import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { observed } from "@/lib/iq/engine/observed-factory";
import { CLAIM_STUCK_OPERATIONS, type SignatureReading, type SignatureRuleId } from "@/lib/iq/signatures/pre-refund";
import { RAZORPAY_PROVIDER } from "@/lib/payments";

/** Per-rule statement budget (R2.5). */
export const SIGNATURE_STATEMENT_TIMEOUT_MS = 10_000;

const EVER_CAPTURED = sql`('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')`;
/** Statuses from which an order may move to REFUNDED (src/domain/order-status.ts). */
const REFUNDABLE_ORDER_STATUSES = sql`('PAID', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED')`;

/** The count query for each rule. Each returns one row with integer `n`. */
function ruleQuery(ruleId: SignatureRuleId, orgId: string): SQL {
  switch (ruleId) {
    // More than one payment ever captured on one order (P2-2, pay-4 regression).
    case "sig.double_capture":
      return sql`
        SELECT count(*)::int AS n FROM (
          SELECT p.order_id FROM payments p
          WHERE p.org_id = ${orgId} AND p.status IN ${EVER_CAPTURED}
          GROUP BY p.order_id
          HAVING count(*) > 1 AND max(p.updated_at) < now() - interval '5 minutes'
        ) doubled`;

    // A refunded payment whose refund rows don't account for it, or refund rows
    // on a payment still marked CAPTURED (P1-1 aftermath). Only payments marked
    // refunded or carrying a refund are candidates (RELIABILITY iq2-s5 #2), so
    // the per-payment sum runs on the small refund set, not on every payment.
    case "sig.refund_unrecorded":
      return sql`
        SELECT count(*)::int AS n FROM payments p
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(r.amount), 0) AS refunded, max(r.created_at) AS last_refund_at
          FROM refunds r WHERE r.org_id = p.org_id AND r.payment_id = p.id
        ) booked
        WHERE p.org_id = ${orgId}
          AND (
            p.status IN ('REFUNDED', 'PARTIALLY_REFUNDED')
            OR EXISTS (SELECT 1 FROM refunds r0 WHERE r0.org_id = p.org_id AND r0.payment_id = p.id)
          )
          AND p.updated_at < now() - interval '5 minutes'
          AND (booked.last_refund_at IS NULL OR booked.last_refund_at < now() - interval '5 minutes')
          AND (
            (p.status = 'REFUNDED' AND booked.refunded <> p.amount)
            OR (p.status = 'PARTIALLY_REFUNDED' AND (booked.refunded = 0 OR booked.refunded >= p.amount))
            OR (p.status = 'CAPTURED' AND booked.refunded > 0)
          )`;

    // An order whose every captured payment is refunded, more than 10 min ago,
    // but whose follow-up never finished (P2-1). Order level, as the refund
    // follow-up decides. Only orders the lifecycle could move to REFUNDED
    // count as unmoved; a CANCELLED/FAILED order is complete once a refund
    // money event exists (R2.7). Driven from the refund rows, grouped by order
    // (RELIABILITY iq2-s5 #2): an order with no refund cannot be a lost follow-up.
    case "sig.refund_followup_lost":
      return sql`
        SELECT count(*)::int AS n FROM (
          SELECT o.id FROM refunds r
          JOIN orders o ON o.id = r.order_id AND o.org_id = r.org_id
          WHERE r.org_id = ${orgId}
          GROUP BY o.id, o.org_id, o.status
          HAVING max(r.created_at) < now() - interval '10 minutes'
            AND EXISTS (SELECT 1 FROM payments p WHERE p.org_id = o.org_id AND p.order_id = o.id AND p.status IN ${EVER_CAPTURED})
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.org_id = o.org_id AND p.order_id = o.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED'))
            AND (
              o.status IN ${REFUNDABLE_ORDER_STATUSES}
              OR (
                o.status IN ('CANCELLED', 'FAILED')
                AND NOT EXISTS (
                  SELECT 1 FROM order_events e
                  WHERE e.org_id = o.org_id AND e.order_id = o.id
                    AND (e.metadata->>'refundId' IS NOT NULL OR e.reason LIKE 'Refund%' OR e.reason LIKE 'Part refunded%')
                )
              )
            )
        ) lost`;

    // An unpaid order older than 10 min with no items or no payment row (P2-3).
    case "sig.half_order":
      return sql`
        SELECT count(*)::int AS n FROM orders o
        WHERE o.org_id = ${orgId}
          AND o.status = 'PENDING_PAYMENT'
          AND o.created_at < now() - interval '10 minutes'
          AND (
            NOT EXISTS (SELECT 1 FROM order_items i WHERE i.org_id = o.org_id AND i.order_id = o.id)
            OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.org_id = o.org_id AND p.order_id = o.id)
          )`;

    // Money captured after the order moved into REFUNDED, CANCELLED or FAILED (pay-6 regression).
    case "sig.capture_on_terminal":
      return sql`
        SELECT count(DISTINCT p.order_id)::int AS n FROM payments p
        JOIN order_events e
          ON e.org_id = p.org_id AND e.order_id = p.order_id
         AND e.to_status IN ('REFUNDED', 'CANCELLED', 'FAILED')
         AND e.from_status IS DISTINCT FROM e.to_status
        WHERE p.org_id = ${orgId}
          AND p.status IN ${EVER_CAPTURED}
          AND p.captured_at IS NOT NULL
          AND p.captured_at > e.created_at
          AND p.captured_at < now() - interval '5 minutes'`;

    // A withIdempotency claim with no stored result for 15 min: its caller died mid-work (R2.7 P2).
    case "sig.claim_stuck":
      return sql`
        SELECT count(*)::int AS n FROM idempotency_keys k
        WHERE k.org_id = ${orgId}
          AND k.response_snapshot IS NULL
          AND k.operation IN (${sql.join(CLAIM_STUCK_OPERATIONS.map((operation) => sql`${operation}`), sql`, `)})
          AND k.created_at < now() - interval '15 minutes'`;

    // A Razorpay webhook for one of this org's payments that failed or never
    // finished, more than an hour ago. Webhook rows carry no org; they belong
    // to the org whose payment their Razorpay order id names.
    case "sig.webhook_failed":
      return sql`
        SELECT count(*)::int AS n FROM webhook_events w
        WHERE w.provider = ${RAZORPAY_PROVIDER}
          AND (w.error IS NOT NULL OR w.processed_at IS NULL)
          AND w.created_at < now() - interval '60 minutes'
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.org_id = ${orgId}
              AND p.provider = ${RAZORPAY_PROVIDER}
              AND p.provider_order_id = coalesce(w.payload->'payload'->'payment'->'entity'->>'order_id', w.payload->'payload'->'order'->'entity'->>'id')
          )`;
  }
}

/**
 * Runs `work` in a REPEATABLE READ READ ONLY transaction with the rule
 * statement budget. Exported so the read-only guarantee is testable.
 */
export async function readOnlyRuleTransaction<T>(work: (tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0]) => Promise<T>, statementTimeoutMs = SIGNATURE_STATEMENT_TIMEOUT_MS): Promise<T> {
  return db().transaction(
    async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${Math.max(1, Math.floor(statementTimeoutMs))}ms'`));
      return work(tx);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function isStatementTimeout(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
  return code === "57014";
}

/** Reads one rule for one org. A statement timeout becomes RULE_TIMEOUT; any other error propagates. */
export async function readSignature(orgId: string, ruleId: SignatureRuleId, statementTimeoutMs = SIGNATURE_STATEMENT_TIMEOUT_MS): Promise<SignatureReading> {
  try {
    const rows = await readOnlyRuleTransaction((tx) => tx.execute<{ n: number }>(ruleQuery(ruleId, orgId)), statementTimeoutMs);
    const n = Number(rows[0]?.n ?? 0);
    return { ruleId, status: "EVALUATED", count: observed({ unit: "count", value: n }), threshold: observed({ unit: "count", value: 0 }) };
  } catch (error) {
    if (isStatementTimeout(error)) return { ruleId, status: "RULE_TIMEOUT" };
    throw error;
  }
}

/** Reads every pre-refund rule for one org, one read-only transaction each. */
export async function readMoneySignatures(orgId: string, ruleIds: readonly SignatureRuleId[]): Promise<readonly SignatureReading[]> {
  const readings: SignatureReading[] = [];
  for (const ruleId of ruleIds) readings.push(await readSignature(orgId, ruleId));
  return readings;
}
