/**
 * Cash on delivery / pay on collection for online orders. Roadmap 1.2.
 *
 * Decision (14 Sep 2026): COD stays available for online orders, capped at
 * ₹1,500 per order "until settings say otherwise". The cap is a constant
 * here so there is exactly one place to move it into restaurant settings
 * (roadmap 5.5); nothing else may hard-code the figure.
 *
 * The cap only bites when an online method exists to send the customer to.
 * With no gateway configured, refusing a ₹1,600 order would mean refusing it
 * outright — worse than taking cash at the door, which is what the shop did
 * before online payment existed.
 */

import { type Paise, formatINR, fromRupees } from "@/lib/money";

export const COD_CAP: Paise = fromRupees("1500");

export type CodDecision = { ok: true } | { ok: false; reason: string };

export function codAllowed(payable: Paise, onlineAvailable: boolean): CodDecision {
  if (!onlineAvailable) return { ok: true };
  if (payable > COD_CAP) {
    return { ok: false, reason: `Orders over ${formatINR(COD_CAP, "whole")} are paid online. Choose UPI, card or net banking.` };
  }
  return { ok: true };
}
