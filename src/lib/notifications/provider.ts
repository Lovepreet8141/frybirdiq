/**
 * Notification providers. BUILD-PLAN.md §3.
 *
 * "Do not hard-code a communication vendor into order business logic."
 *
 * There is no messaging API yet. Rather than wait for one, the interface goes
 * in now and the first implementation is a link: `wa.me` opens WhatsApp with
 * the message already written, and a person presses send.
 *
 * That is honest about what it is — a human sending a message, not an
 * automated one — and it works today with nothing to sign up for. A Business
 * API implementation slots in behind the same interface later, and the code
 * that composes an order message does not change.
 */

export interface SendResult {
  readonly ok: boolean;
  /** True when a person still has to press send. */
  readonly manual: boolean;
  /** Where to send them, for the manual case. */
  readonly url?: string;
  readonly error?: string;
}

export interface NotificationProvider {
  readonly name: string;
  sendWhatsapp(input: { to: string; message: string }): Promise<SendResult>;
  sendSms(input: { to: string; message: string }): Promise<SendResult>;
  sendEmail(input: { to: string; subject: string; body: string }): Promise<SendResult>;
}

export class NotSupportedYet extends Error {
  constructor(channel: string) {
    super(`notifications: ${channel} is not wired up yet`);
    this.name = "NotSupportedYet";
  }
}

/** Indian mobile numbers, normalised to what wa.me expects. */
export function toWhatsAppNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  // Already carries the country code.
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}
