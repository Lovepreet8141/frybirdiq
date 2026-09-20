/**
 * The mock WhatsApp provider: records what would have been sent, sends
 * nothing, touches no network. Roadmap 7.2's local proof reads `sent`.
 * A real provider (Business API) is a sibling module behind the same
 * interface.
 */

import type { WhatsappOrderProvider, WhatsappSendInput, WhatsappSendResult } from "./whatsapp-provider";

export class MockWhatsappProvider implements WhatsappOrderProvider {
  readonly name = "mock";
  readonly sent: WhatsappSendInput[] = [];
  private failNext: WhatsappSendResult | null = null;

  /** Make the next send return this failure, once. */
  failOnce(result: Extract<WhatsappSendResult, { ok: false }>): void {
    this.failNext = result;
  }

  async send(input: WhatsappSendInput): Promise<WhatsappSendResult> {
    if (this.failNext) {
      const result = this.failNext;
      this.failNext = null;
      return result;
    }
    // Like a vendor honouring an idempotency key: the same key is one message.
    const existing = this.sent.findIndex((m) => m.idempotencyKey === input.idempotencyKey);
    if (existing >= 0) return { ok: true, providerMessageId: `mock-${existing + 1}` };
    this.sent.push(input);
    return { ok: true, providerMessageId: `mock-${this.sent.length}` };
  }
}
