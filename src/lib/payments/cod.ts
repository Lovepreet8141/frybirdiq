/**
 * Cash on delivery / pay on collection for online orders. Roadmap 1.2.
 *
 * Decision (14 Sep 2026): COD stays available for online orders, capped at
 * ₹1,500 per order "until settings say otherwise". Roadmap 5.5 moved the cap
 * onto `organizations.cod_cap` — a restaurant settings field, not a deploy —
 * so callers read the org's own figure and pass it in. `COD_CAP` remains as
 * the fallback/seed default: the value the column ships with, and what a
 * caller with no org context (a test, a script) gets without passing one.
 *
 * The cap only bites when an online method exists to send the customer to.
 * With no gateway configured, refusing a ₹1,600 order would mean refusing it
 * outright — worse than taking cash at the door, which is what the shop did
 * before online payment existed.
 */

import { type Paise, formatINR, fromRupees } from "@/lib/money";

export const COD_CAP: Paise = fromRupees("1500");

export type CodDecision = { ok: true } | { ok: false; reason: string };

export function codAllowed(payable: Paise, onlineAvailable: boolean, cap: Paise = COD_CAP): CodDecision {
  if (!onlineAvailable) return { ok: true };
  if (payable > cap) {
    return { ok: false, reason: `Orders over ${formatINR(cap, "whole")} are paid online. Choose UPI, card or net banking.` };
  }
  return { ok: true };
}
