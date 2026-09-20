/**
 * The automated WhatsApp channel (roadmap 7.2), behind an interface so no
 * order code imports a vendor. Distinct from `NotificationProvider` in
 * provider.ts, which is the manual wa.me link: that one hands a URL to a
 * person, this one sends by itself and reports what happened.
 *
 * A provider sends a message and returns the outcome. It never touches an
 * order's status; the outbox decides what to send and records the result.
 * `idempotencyKey` is passed through so a vendor that supports one can
 * de-duplicate a retry that the outbox could not tell had already landed.
 */

export interface WhatsappSendInput {
  /** E.164-style digits with country code, from toWhatsAppNumber. Never logged. */
  readonly to: string;
  readonly template: string;
  readonly body: string;
  readonly idempotencyKey: string;
}

export type WhatsappSendResult =
  | { readonly ok: true; readonly providerMessageId: string }
  /** `retryable` false means the number or template is rejected: stop trying. The error text must not contain the number. */
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export interface WhatsappOrderProvider {
  readonly name: string;
  send(input: WhatsappSendInput): Promise<WhatsappSendResult>;
}
