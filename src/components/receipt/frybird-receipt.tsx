import Image from "next/image";
import { formatINR, isZero } from "@/lib/money";
import type { CustomerReceiptData } from "@/lib/receipt/customer-view";
import { formatReceiptWhen, orderTypeLabel, paymentMethodLabel, paymentStatusLabel, scheduledTimeLabel, summarizeRewards } from "@/lib/receipt/format";

/**
 * The FRYBIRD customer receipt — presentation only.
 *
 * Every figure comes straight off `CustomerReceiptData`, which itself comes
 * straight off `getInvoice` and the loyalty ledger. Nothing in this file
 * adds, rounds, or re-derives a number; it formats what it is given with
 * `formatINR` and hides a row when the value behind it is null or zero.
 * Design reference: the FRYBIRD-branded receipt supplied for this feature,
 * adapted to the app's own type system (Archivo display / Instrument Sans
 * body, already loaded site-wide) rather than a generic invoice look.
 *
 * Colours are the literal brand hex values from `design-system/tokens.json`
 * rather than the page's ambient `var(--...)` tokens — a receipt is a fixed
 * "paper" surface that must look the same on the cream customer site, the
 * light staff surface and a dark one, the same reasoning the invoice page
 * this replaces already used for its own hardcoded palette.
 */

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-bold tracking-[0.08em] text-[#796958] uppercase">{label}</span>
      <span className="tabular text-[14px] leading-snug font-semibold break-words text-[#2C211B]">{value}</span>
    </div>
  );
}

function TotalRow({ label, value, muted = true }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={muted ? "text-[13.5px] text-[#796958]" : "text-[13.5px] font-semibold text-[#2C211B]"}>{label}</span>
      <span className="tabular text-[13.5px] text-[#2C211B]">{value}</span>
    </div>
  );
}

export function FrybirdReceipt({ data }: { data: CustomerReceiptData }) {
  const { seller, customer, lines, isTaxInvoice, rewards } = data;
  const docTitle = isTaxInvoice ? "Tax Invoice" : "Receipt";
  const docNumber = isTaxInvoice && data.invoiceNumber ? data.invoiceNumber : `Order #${data.orderNumber}`;
  const isDelivery = data.fulfilment === "DELIVERY";
  const scheduledLabel = scheduledTimeLabel(data.scheduledFor);

  const taxRows = isTaxInvoice
    ? [
        !isZero(data.cgst) ? { label: `CGST`, value: formatINR(data.cgst, "unit") } : null,
        !isZero(data.sgst) ? { label: `SGST`, value: formatINR(data.sgst, "unit") } : null,
        !isZero(data.igst) ? { label: `IGST`, value: formatINR(data.igst, "unit") } : null,
      ].filter((row): row is { label: string; value: string } => row !== null)
    : [];

  const rewardSummary = summarizeRewards(rewards, data.stampRewardDiscount);
  const rewardReady = rewardSummary.kind === "ready";

  return (
    <article className="w-full overflow-hidden rounded-2xl bg-[#FBF8F1] text-[#2C211B] shadow-[0_14px_40px_rgba(31,7,5,0.16)] print:rounded-none print:shadow-none">
      {/* 1 · BRAND HEADER — the logo carries its own red ground; the band matches it so the two are seamless. */}
      <header className="flex justify-center bg-[#B81C1D] p-6 sm:p-8 print:break-inside-avoid">
        <Image src="/frybird-receipt-logo.png" alt="FRYBIRD — Born crispy. Built bold." width={1776} height={434} priority className="h-auto w-full max-w-[320px] object-contain" />
      </header>

      {/* 2 · THANK YOU */}
      <section className="flex flex-col gap-1.5 bg-[#F2A324] px-6 py-5 sm:px-8 print:break-inside-avoid">
        <h1 className="font-heading text-[clamp(19px,3.8vw,26px)] leading-[1.15] font-extrabold tracking-tight text-[#1F0705] text-balance uppercase">Thank you for ordering from FRYBIRD.</h1>
        <p className="max-w-[46ch] text-[14px] leading-relaxed text-[#4A2E09] text-pretty">We hope you enjoyed your meal. See you again soon.</p>
        <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.12em] text-[#4A2E09]/70 uppercase">Born crispy. Built bold.</p>
      </section>

      {/* 3 · DOCUMENT + ORDER / CUSTOMER META */}
      <section className="flex flex-col gap-4 border-b border-[#EAE0C8] px-6 py-6 sm:px-8 print:break-inside-avoid">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <span className="font-heading text-[15px] font-bold tracking-[0.08em] uppercase">{docTitle}</span>
          <span className="tabular text-[13px] text-[#796958]">{docNumber}</span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-4">
          <MetaItem label="Order" value={`#${data.orderNumber}`} />
          <MetaItem label="Placed" value={formatReceiptWhen(data.placedAt)} />
          <MetaItem label="Order type" value={orderTypeLabel(data.channel, data.fulfilment)} />
          {scheduledLabel && <MetaItem label="Requested time" value={scheduledLabel} />}
          <MetaItem label="Billed to" value={customer.name ?? "Guest"} />
          {customer.phone && <MetaItem label="Phone" value={customer.phone} />}
          {isDelivery && customer.address && <MetaItem label="Delivery address" value={customer.address} />}
          {isTaxInvoice && <MetaItem label="Place of supply" value={`${seller.state ?? "—"}${seller.stateCode ? ` (${seller.stateCode})` : ""}`} />}
        </div>
      </section>

      {/* 4 · ITEMS */}
      <section className="px-6 pt-6 pb-2 sm:px-8">
        <table className="w-full border-collapse">
          <caption className="mb-3 text-left text-[10px] font-bold tracking-[0.08em] text-[#796958] uppercase">
            Items
          </caption>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-[#EAE0C8] align-top print:break-inside-avoid">
                <td className="w-9 py-3 pr-2 text-[13.5px] font-bold text-[#B81E1E] tabular">{line.quantity}×</td>
                <td className="py-3 pr-2">
                  <div className="text-[14.5px] leading-snug font-semibold">{line.name}</div>
                  {line.modifiers.map((modifier, mi) => (
                    <div key={mi} className="text-[12.5px] leading-snug text-[#796958]">
                      {modifier}
                    </div>
                  ))}
                  <div className="tabular mt-1 text-[12px] text-[#796958]">{formatINR(line.unitPrice, "unit")} each</div>
                </td>
                <td className="py-3 text-right text-[14px] font-semibold whitespace-nowrap tabular">{formatINR(line.total, "unit")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 5 · TOTALS */}
      <section className="flex flex-col gap-2 px-6 pt-3 pb-6 sm:px-8 print:break-inside-avoid">
        <TotalRow label="Subtotal" value={formatINR(data.subtotal, "unit")} />
        {!isZero(data.discountTotal) && <TotalRow label={data.promotionCode ?? "Discount"} value={`−${formatINR(data.discountTotal, "unit")}`} />}
        {taxRows.map((row) => (
          <TotalRow key={row.label} label={row.label} value={row.value} />
        ))}
        {isDelivery && !isZero(data.deliveryFee) && <TotalRow label="Delivery fee" value={formatINR(data.deliveryFee, "unit")} />}

        <div className="mt-2.5 flex items-baseline justify-between gap-4 border-l-4 border-[#C21F11] bg-[#F5EDD8] px-[18px] py-4">
          <span className="font-heading text-[15px] font-bold tracking-[0.08em] uppercase">Total</span>
          <span className="tabular font-heading text-[24px] font-extrabold text-[#B81E1E]">{formatINR(data.total)}</span>
        </div>

        <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#796958]">
          Amounts in Indian rupees.{isTaxInvoice ? " Prices include GST." : ""}
          {data.pointsRedeemed > 0 ? ` Includes ${data.pointsRedeemed} FRYBIRD REWARDS point${data.pointsRedeemed === 1 ? "" : "s"} redeemed.` : ""}
        </p>
      </section>

      {/* 6 · PAYMENT */}
      {data.payment && (
        <section className="flex flex-wrap items-start justify-between gap-x-7 gap-y-4 border-t border-[#EAE0C8] px-6 py-6 sm:px-8 print:break-inside-avoid">
          <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-6 gap-y-4">
            <MetaItem label="Payment" value={paymentMethodLabel(data.payment.method)} />
            <MetaItem label="Paid" value={formatINR(data.total, "unit")} />
            {data.payment.reference && <MetaItem label="Ref" value={data.payment.reference} />}
          </div>
          <span className="rounded-full border-[1.5px] border-[#B81E1E] bg-[#F5EDD8] px-3.5 py-2 text-[11px] font-bold tracking-[0.08em] text-[#B81E1E] uppercase">
            {paymentStatusLabel(data.payment.status)}
          </span>
        </section>
      )}

      {/* 7 · FRYBIRD REWARDS */}
      {rewards && (
        <section className="flex flex-col gap-5 bg-[#1F0705] px-6 py-7 text-[#F5EDD8] sm:px-8 print:break-inside-avoid">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] font-bold tracking-[0.08em] text-[#F2A324] uppercase">FRYBIRD Rewards</span>
              <span className="font-heading text-[clamp(20px,4vw,26px)] leading-tight font-extrabold tabular">
                {rewards.pointsEarnedThisOrder > 0 ? `+${rewards.pointsEarnedThisOrder} point${rewards.pointsEarnedThisOrder === 1 ? "" : "s"} earned` : "No points on this order"}
              </span>
            </div>
            {rewards.pointsBalance !== null && (
              <div className="text-right">
                <div className="font-heading text-[20px] font-bold text-[#F2A324] tabular">{rewards.pointsBalance.toLocaleString("en-IN")}</div>
                <div className="text-[10px] font-bold tracking-[0.08em] text-[#C3A597] uppercase">Points balance</div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <span className="text-[12.5px] font-bold tracking-[0.04em] uppercase">{rewards.stampsRequired} + 1 stamp card</span>
              <span className="tabular text-[12.5px] font-semibold text-[#F2A324]">{rewardReady ? "Reward ready" : `${rewards.stampCount} of ${rewards.stampsRequired} stamps`}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: rewards.stampsRequired }, (_, i) => {
                const filled = i < rewards.stampCount;
                return (
                  <div key={i} className="grid aspect-square max-w-[52px] flex-1 place-items-center">
                    {filled ? (
                      <div className="font-heading tabular grid size-full place-items-center rounded-full bg-[#F2A324] text-[13px] font-extrabold text-[#1F0705]">{i + 1}</div>
                    ) : (
                      <div className="tabular grid size-full place-items-center rounded-full border border-dashed border-[#F5EDD8]/30 text-[12px] text-[#F5EDD8]/40">{i + 1}</div>
                    )}
                  </div>
                );
              })}
              <div className="grid aspect-square max-w-[52px] flex-1 place-items-center">
                {rewardReady ? (
                  <div className="font-heading grid size-full place-items-center rounded-full bg-[#D92B2B] text-center text-[9.5px] leading-tight font-extrabold tracking-[0.04em]">FREE</div>
                ) : (
                  <div className="font-heading grid size-full place-items-center rounded-full border-[1.5px] border-[#D92B2B] text-center text-[9.5px] leading-tight font-extrabold tracking-[0.04em] text-[#F07A6E]">FREE</div>
                )}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#F5EDD8]/[0.16]">
              <div className="h-full rounded-full bg-[#F2A324]" style={{ width: `${Math.min(100, (rewards.stampCount / rewards.stampsRequired) * 100)}%` }} />
            </div>
          </div>

          {rewardSummary.kind === "ready" && (
            <div className="flex flex-col gap-1 rounded-[10px] bg-[#C21F11] px-5 py-4">
              <span className="font-heading text-[18px] leading-tight font-extrabold uppercase">Free reward unlocked</span>
              <span className="text-[13.5px] leading-relaxed text-[#F8E3DF]">One free item up to {rewardSummary.worth} — mention your phone number on your next order.</span>
            </div>
          )}
          {rewardSummary.kind === "progress" && (
            <p className="max-w-[52ch] text-[13.5px] leading-relaxed text-[#D9C8BC] text-pretty">
              {rewardSummary.stampsRemaining} more qualifying order{rewardSummary.stampsRemaining === 1 ? "" : "s"} and your next item is free, up to {rewardSummary.worth}.
            </p>
          )}
          {rewardSummary.kind === "redeemed" && (
            <p className="text-[13.5px] leading-relaxed text-[#D9C8BC]">Your FRYBIRD REWARDS free item ({rewardSummary.amount}) was on this order.</p>
          )}
        </section>
      )}

      {/* 8 · FOOTER */}
      <footer className="flex flex-col gap-3 bg-[#2C211B] px-6 py-6 text-[#F5EDD8] sm:px-8 print:break-inside-avoid">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <span className="font-heading text-[14px] font-bold tracking-[0.02em]">FRYBIRD</span>
          <span className="text-[12.5px] font-bold tracking-[0.08em] text-[#F2A324] uppercase">Born crispy. Built bold.</span>
        </div>
        <div className="flex flex-col gap-0.5 text-[11.5px] leading-relaxed text-[#C3A597]">
          <span>{[seller.legalName ?? seller.name, seller.address].filter(Boolean).join(" · ")}</span>
          <span className="tabular">{[seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.phone].filter(Boolean).join("  ·  ")}</span>
        </div>
      </footer>
    </article>
  );
}
