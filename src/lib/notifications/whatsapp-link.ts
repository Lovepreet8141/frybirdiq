/**
 * WhatsApp, by link.
 *
 * Builds a `wa.me` URL with the message pre-written. Opening it launches
 * WhatsApp — the app on a phone, WhatsApp Web on a desktop — with the
 * conversation open and the text filled in. A person presses send.
 *
 * No API, no Business account, no template approval, no per-message cost. The
 * trade is that it cannot send on its own, which is why `manual` is true: the
 * caller must not report this as "sent".
 */

import { type NotificationProvider, type SendResult, toWhatsAppNumber } from "./provider";

export const WHATSAPP_LINK_PROVIDER = "whatsapp-link";

export function whatsappLink(phone: string, message: string): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export const whatsappLinkProvider: NotificationProvider = {
  name: WHATSAPP_LINK_PROVIDER,

  async sendWhatsapp({ to, message }): Promise<SendResult> {
    const url = whatsappLink(to, message);
    if (!url) return { ok: false, manual: true, error: "That is not a mobile number WhatsApp can reach." };
    return { ok: true, manual: true, url };
  },

  async sendSms(): Promise<SendResult> {
    // Commercial SMS in India needs DLT registration — a registered sender
    // header and an approved template. Returning a fake success would be
    // worse than saying so.
    return { ok: false, manual: false, error: "SMS is not wired up yet." };
  },

  async sendEmail(): Promise<SendResult> {
    return { ok: false, manual: false, error: "Email is not wired up yet." };
  },
};
