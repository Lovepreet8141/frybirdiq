import { NextResponse } from "next/server";
import { eventTypesOf, verifyHandshake, verifySignature, whatsappAppSecret, whatsappVerifyToken } from "@/lib/notifications/whatsapp-webhook";

export const dynamic = "force-dynamic";

/**
 * The WhatsApp webhook (whatsapp-direct, part 1). Public, unauthenticated by
 * session — Meta is the caller, not a customer or staff member — and gated
 * instead on the verify token (GET) and the signature (POST). No customer
 * message is read, stored or sent by this route; that is a later, separate
 * card. `nginx-frybird.conf` also bounds this path's body size and request
 * rate before it ever reaches Node.
 */

/**
 * GET — Meta's one-time (and any re-triggered) verify handshake. `hub.mode`
 * must be "subscribe" and `hub.verify_token` must match WHATSAPP_VERIFY_TOKEN
 * exactly, in constant time; on a match, `hub.challenge` is echoed back as
 * plain text. Anything else is 403 — including WHATSAPP_VERIFY_TOKEN being
 * unset, which fails closed rather than accepting any token.
 */
export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const ok = verifyHandshake({
    mode: url.searchParams.get("hub.mode"),
    token: url.searchParams.get("hub.verify_token"),
    configuredToken: whatsappVerifyToken(),
  });
  if (!ok) return new NextResponse(null, { status: 403 });
  return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * A generous ceiling on a Cloud API webhook body — real payloads are a few
 * KB. Checked before AND after reading the body: the `Content-Length` header
 * is a claim, not a guarantee, so an absent or dishonest header must not skip
 * the check. `nginx-frybird.conf` has its own, smaller limit on this path;
 * this is a second, independent bound in case that config ever drifts.
 */
const MAX_BODY_BYTES = 262_144;

/**
 * POST — an event notification. Verified over the exact raw body with
 * `X-Hub-Signature-256` before anything is parsed; an unverified request is
 * rejected, not merely ignored. A verified request is answered 200
 * immediately: nothing is written to the database, and the only thing
 * logged is the event's `object` and each change's `field` — never a phone
 * number or message body. WHATSAPP_APP_SECRET unset fails closed (403),
 * the same as an invalid signature.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const appSecret = whatsappAppSecret();
  if (!appSecret) return NextResponse.json({ error: "not configured" }, { status: 403 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  const verified = verifySignature({ body, header: request.headers.get("x-hub-signature-256"), appSecret });
  if (!verified) return NextResponse.json({ error: "unverified" }, { status: 403 });

  const { object, fields } = eventTypesOf(body);
  console.log(`whatsapp-webhook: verified event — object=${object ?? "unknown"} fields=${fields.length ? fields.join(",") : "none"}`);

  return NextResponse.json({ ok: true });
}
