"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Field, inputClass, selectClass } from "@/components/inventory/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addDays } from "@/lib/dates";
import { deletePromotionAction, duplicatePromotionAction, savePromotionAction } from "@/lib/promotions/actions";
import { CUSTOMER_SEGMENTS, DAYS, PROMO_TYPES, type PromoStatus, type PromoType, generateCode, summarize, typeFlags, validate } from "@/lib/promotions/engine";
import { type PickerProduct, type PromoInput, type PromoMeta, blankInput, toEngineProducts, toPromo } from "@/lib/promotions/form";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ProductPicker } from "./product-picker";

/** A saved promotion as the page hands it over: the editable fields plus what the server knows. */
export interface SavedPromo {
  readonly input: PromoInput & { readonly id: string };
  readonly meta: PromoMeta;
  readonly performance: { readonly orders: number; readonly revenue: string; readonly discountGiven: string };
}

const STATUS_LABEL: Record<PromoStatus, string> = { draft: "Draft", live: "Live", paused: "Paused" };
const STATUS_BADGE: Record<PromoStatus, string> = {
  live: "bg-promo-live text-promo-live-fg",
  paused: "bg-promo-paused text-promo-paused-fg",
  draft: "bg-promo-draft text-promo-draft-fg",
};
const STATUS_EDGE: Record<PromoStatus, string> = { live: "border-l-promo-live-line", paused: "border-l-promo-paused-line", draft: "border-l-promo-draft-line" };

const SEGMENT_LABEL: Record<(typeof CUSTOMER_SEGMENTS)[number], string> = { everyone: "Everyone", new: "New customers", returning: "Returning customers", members: "Loyalty members" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel px-5 py-5">
      <h3 className="mb-3.5 text-xs font-semibold tracking-[0.1em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Money({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <Field id={id} label={label}>
      <div className="flex items-center rounded-md border border-border bg-background px-3">
        <span className="text-muted-foreground">₹</span>
        <input id={id} type="number" min={0} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-[44px] w-full bg-transparent px-1.5 text-[15px] font-semibold outline-none" />
      </div>
    </Field>
  );
}

/**
 * The Promotions workspace from `Promotions.dc.html` (IQ view): the library
 * on the left, the editor on the right, "Customer sees" and the action
 * column beside it. Sections show or hide by the type's flags. Everything
 * previewed here is computed by the same engine the server saves with
 * (`toPromo` → `summarize` / `validate`); the server is the only place a
 * promotion is evaluated against an order.
 */
export function PromotionsWorkspace({ promos, products, today, canEdit }: { promos: readonly SavedPromo[]; products: readonly PickerProduct[]; today: string; canEdit: boolean }) {
  const router = useRouter();
  const engineProducts = useMemo(() => toEngineProducts(products), [products]);
  const [selectedId, setSelectedId] = useState<string | null>(promos[0]?.input.id ?? null);
  const [draft, setDraft] = useState<PromoInput>(() => promos[0]?.input ?? blankInput("percent", today, addDays));
  const [dirty, setDirty] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saved = promos.find((promo) => promo.input.id === selectedId) ?? null;
  const meta: PromoMeta = useMemo(() => saved?.meta ?? { status: "draft", liveSince: null, usageCount: 0 }, [saved]);

  // When the server hands back fresh rows (after a save), refresh the
  // selection from them — unless the owner is mid-edit. Adjusted during
  // render, the way React asks for prop-driven state, not in an effect.
  const [seenPromos, setSeenPromos] = useState(promos);
  if (promos !== seenPromos) {
    setSeenPromos(promos);
    if (!dirty && saved) setDraft(saved.input);
  }

  const promo = useMemo(() => toPromo(draft, meta), [draft, meta]);
  const summary = useMemo(() => summarize(promo, engineProducts), [promo, engineProducts]);
  const errors = useMemo(() => validate(promo), [promo]);
  const t = typeFlags(draft.type);

  const patch = (changes: Partial<PromoInput>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setDirty(true);
    setError(null);
  };
  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  const select = (promoRow: SavedPromo) => {
    setSelectedId(promoRow.input.id);
    setDraft(promoRow.input);
    setDirty(false);
    setError(null);
    setLibraryOpen(false);
  };

  const startNew = (type: PromoType = "percent") => {
    setSelectedId(null);
    setDraft(blankInput(type, today, addDays));
    setDirty(true);
    setError(null);
    setLibraryOpen(false);
  };

  const run = (work: () => Promise<{ ok: true; id?: string } | { ok: false; error: string }>, message: string, after?: (id?: string) => void) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.(result.id);
      say(message);
      router.refresh();
    });

  const save = (mode: "save" | "draft") =>
    run(() => savePromotionAction(draft, mode), mode === "draft" ? "Saved as draft" : meta.status === "live" ? "Promotion updated" : "Saved", (id) => {
      if (id) setSelectedId(id);
      setDirty(false);
    });

  const duplicate = () => {
    if (!saved) return;
    run(() => duplicatePromotionAction(saved.input.id), "Duplicated as a draft", (id) => {
      if (id) setSelectedId(id);
      setDirty(false);
    });
  };

  const remove = () => {
    if (!saved) {
      startNew();
      return;
    }
    if (!window.confirm(`Delete "${saved.input.name || "Untitled promotion"}"? This cannot be undone.`)) return;
    run(() => deletePromotionAction(saved.input.id), "Deleted", () => {
      const next = promos.find((promo) => promo.input.id !== saved.input.id);
      if (next) select(next);
      else startNew();
    });
  };

  const liveCount = promos.filter((row) => row.meta.status === "live").length;
  const draftCount = promos.filter((row) => row.meta.status === "draft").length;
  const dirtyLabel = !saved ? "New · not saved yet" : dirty ? "Unsaved changes" : "All changes saved";

  const library = (
    <div className="flex flex-col">
      {promos.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No promotions yet. Start with + New.</p>}
      {promos.map((row) => {
        const active = row.input.id === selectedId;
        const short = summarize(toPromo(row.input, row.meta), engineProducts).short;
        const on = [row.input.channels.pos && "POS", row.input.channels.web && "Website"].filter(Boolean);
        return (
          <button
            key={row.input.id}
            type="button"
            onClick={() => select(row)}
            aria-current={active ? "true" : undefined}
            className={cn("flex w-full flex-col gap-0.5 border-b border-l-[3px] border-border px-4 py-3 text-left hover:bg-surface-muted", active ? "border-l-foreground bg-secondary/40" : STATUS_EDGE[row.meta.status])}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{row.input.name || "Untitled promotion"}</span>
              <span className={cn("rounded-full px-2.5 py-[3px] text-[11px] font-semibold", STATUS_BADGE[row.meta.status])}>{STATUS_LABEL[row.meta.status]}</span>
            </span>
            <span className="truncate text-[13px] text-muted-foreground">{short}</span>
            <span className="text-xs text-muted-foreground">{on.length ? `On ${on.join(" · ")}` : "Not active anywhere"}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Title row */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[260px] flex-1">
          <h1 className="font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.015em]">Promotions</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Build offers as drafts. Nothing reaches the counter until you push it to a channel.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-[7px] rounded-full", liveCount > 0 ? "bg-gain" : "bg-muted-foreground/60")} aria-hidden="true" />
            <b className="tabular text-foreground">{liveCount}</b> live
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-[7px] rounded-full bg-muted-foreground/60" aria-hidden="true" />
            <b className="tabular text-foreground">{draftCount}</b> drafts
          </span>
        </div>
        <button type="button" onClick={() => setLibraryOpen(true)} className="inline-flex h-10 items-center rounded-md border border-border bg-panel px-3.5 text-sm font-semibold lg:hidden">
          Library ({promos.length})
        </button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]">
        {/* Library — a column on desktop, a drawer on a phone */}
        <aside className="sticky top-[76px] hidden overflow-hidden rounded-xl border border-border bg-panel lg:block">
          <div className="flex items-center border-b border-border px-4 py-3.5">
            <span className="text-sm font-semibold">Promotion library</span>
            {canEdit && (
              <button type="button" onClick={() => startNew()} className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-inverse px-2.5 text-[13px] font-semibold text-inverse-foreground transition-colors hover:bg-inverse/85">
                <Plus className="size-3.5" aria-hidden="true" /> New
              </button>
            )}
          </div>
          {library}
        </aside>
        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent side="left" className="w-full overflow-y-auto p-0 sm:max-w-sm">
            <SheetHeader className="border-b border-border">
              <SheetTitle>Promotion library</SheetTitle>
            </SheetHeader>
            {canEdit && (
              <div className="border-b border-border px-4 py-2">
                <button type="button" onClick={() => startNew()} className="inline-flex min-h-[40px] items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold">
                  <Plus className="size-4" aria-hidden="true" /> New
                </button>
              </div>
            )}
            {library}
          </SheetContent>
        </Sheet>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          {/* Editor */}
          <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-4 disabled:opacity-90">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("rounded-full px-3 py-1 text-[13px] font-semibold", STATUS_BADGE[meta.status])}>{STATUS_LABEL[meta.status]}</span>
              <span className="text-[13px] text-muted-foreground">{dirtyLabel}</span>
              {meta.status === "live" && saved && (
                <span className="text-[13px] font-semibold text-success">
                  ✓ Live on {[saved.input.channels.pos && "POS", saved.input.channels.web && "Website"].filter(Boolean).join(" + ") || "no channel"}
                  {meta.liveSince ? ` · since ${new Date(meta.liveSince).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` : ""}
                </span>
              )}
            </div>

            <Section title="OFFER">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="promo-name" label="Promotion name">
                  <input id="promo-name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="e.g. BOGO Burger" className={cn(inputClass, "font-semibold")} />
                </Field>
                <Field id="promo-type" label="Promotion type">
                  <select id="promo-type" value={draft.type} onChange={(event) => patch({ type: event.target.value as PromoType })} className={selectClass}>
                    {PROMO_TYPES.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field id="promo-description" label="Description">
                    <input id="promo-description" value={draft.description} onChange={(event) => patch({ description: event.target.value })} placeholder="What the customer is told" className={inputClass} />
                  </Field>
                </div>
              </div>
            </Section>

            {t.isBuyGet && (
              <Section title="PRODUCTS">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[10px] border border-border p-3.5">
                    <p className="mb-2.5 text-sm font-semibold">Customer buys</p>
                    <div className="mb-2.5 w-24">
                      <Field id="promo-buy-qty" label="Quantity">
                        <input id="promo-buy-qty" type="number" min={1} value={draft.buyQty} onChange={(event) => patch({ buyQty: Number(event.target.value) })} className={inputClass} />
                      </Field>
                    </div>
                    <p className="mb-1.5 text-[13px] text-muted-foreground">Product</p>
                    <ProductPicker label="Customer buys" products={products} selected={draft.buyProducts} onChange={(buyProducts) => patch({ buyProducts })} />
                  </div>
                  <div className="rounded-[10px] border border-border p-3.5">
                    <p className="mb-2.5 text-sm font-semibold">Customer gets</p>
                    <div className="mb-2.5 flex gap-3">
                      <div className="w-24">
                        <Field id="promo-get-qty" label="Quantity">
                          <input id="promo-get-qty" type="number" min={1} value={draft.getQty} onChange={(event) => patch({ getQty: Number(event.target.value) })} className={inputClass} />
                        </Field>
                      </div>
                      <Field id="promo-get-discount" label="Discount">
                        <select id="promo-get-discount" value={draft.getDiscountPct} onChange={(event) => patch({ getDiscountPct: Number(event.target.value) })} className={selectClass}>
                          <option value={100}>100% (free)</option>
                          <option value={50}>50%</option>
                          <option value={25}>25%</option>
                        </select>
                      </Field>
                    </div>
                    <p className="mb-1.5 text-[13px] text-muted-foreground">Product</p>
                    <ProductPicker label="Customer gets" products={products} selected={draft.getProducts} onChange={(getProducts) => patch({ getProducts })} />
                  </div>
                </div>
                <p className="mt-3.5 text-[15px] font-semibold">{summary.short}</p>
              </Section>
            )}

            {t.hasProducts && (
              <Section title={t.productsTitle}>
                <ProductPicker label={t.isCombo ? "Products in this combo" : "Free product"} products={products} selected={draft.products} onChange={(selected) => patch({ products: selected })} />
                {t.isCombo && (
                  <div className="mt-4 grid items-end gap-3.5 sm:grid-cols-3">
                    <Money id="promo-combo-price" label="Combo price" value={draft.comboPrice} onChange={(comboPrice) => patch({ comboPrice })} />
                    <div className="text-[13px] text-muted-foreground">
                      Original value
                      <div className="mt-1.5 text-lg font-semibold text-foreground">{formatINR(summary.orig ?? 0n as never, "whole")}</div>
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      Customer saves
                      <div className="mt-1.5 text-lg font-semibold text-success">{formatINR((summary.saves && summary.saves > 0n ? summary.saves : 0n) as never, "whole")}</div>
                    </div>
                  </div>
                )}
              </Section>
            )}

            {t.showDiscount && (
              <Section title="DISCOUNT">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  {t.isCoupon && (
                    <div className="sm:col-span-2">
                      <Field id="promo-code" label="Coupon code" hint="Capital letters and digits, 3–20 characters.">
                        <div className="flex gap-2">
                          <input
                            id="promo-code"
                            value={draft.code}
                            onChange={(event) => patch({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) })}
                            placeholder="FRYBIRD10"
                            className={cn(inputClass, "min-w-0 flex-1 font-mono font-semibold tracking-[0.06em]")}
                          />
                          <button type="button" onClick={() => patch({ code: generateCode() })} className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-md border border-border px-3.5 text-[13px] font-semibold">
                            Generate code
                          </button>
                        </div>
                      </Field>
                    </div>
                  )}
                  {t.isPct && (
                    <Field id="promo-pct" label="Discount">
                      <div className="flex items-center rounded-md border border-border bg-background px-3">
                        <input id="promo-pct" type="number" min={0} max={100} inputMode="decimal" value={draft.discountPct} onChange={(event) => patch({ discountPct: event.target.value })} className="h-[44px] w-full bg-transparent text-[15px] font-semibold outline-none" />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </Field>
                  )}
                  {t.isFlat && <Money id="promo-flat" label="Discount" value={draft.discountAmt} onChange={(discountAmt) => patch({ discountAmt })} />}
                  <Money id="promo-min" label="Minimum order" value={draft.minOrder} onChange={(minOrder) => patch({ minOrder })} placeholder="0" />
                  {t.hasMinMax && <Money id="promo-max" label="Maximum discount" value={draft.maxDiscount} onChange={(maxDiscount) => patch({ maxDiscount })} placeholder="No cap" />}
                </div>
                <p className="mt-3.5 text-[15px] font-semibold">{summary.headline}</p>
              </Section>
            )}

            <Section title="SCHEDULE">
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="promo-start" label="Start date">
                  <input id="promo-start" type="date" value={draft.startDate} onChange={(event) => patch({ startDate: event.target.value })} className={inputClass} />
                </Field>
                <Field id="promo-end" label="End date">
                  <input id="promo-end" type="date" value={draft.endDate} onChange={(event) => patch({ endDate: event.target.value })} className={inputClass} />
                </Field>
                <Field id="promo-start-time" label="Start time">
                  <input id="promo-start-time" type="time" value={draft.startTime} onChange={(event) => patch({ startTime: event.target.value })} className={inputClass} />
                </Field>
                <Field id="promo-end-time" label="End time">
                  <input id="promo-end-time" type="time" value={draft.endTime} onChange={(event) => patch({ endTime: event.target.value })} className={inputClass} />
                </Field>
              </div>
              <p className="mb-2 mt-4 text-[13px] text-muted-foreground">Days</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                {DAYS.map((label, i) => {
                  const on = Boolean(draft.days[i]);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ days: draft.days.map((value, index) => (index === i ? !value : value)) })}
                      className={cn("min-h-[36px] rounded-full border px-3 text-[13px] font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted-foreground")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Timezone Asia/Kolkata · leave times empty for all day</p>
            </Section>

            <Section title="CONDITIONS">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="promo-customer" label="Customer">
                  <select id="promo-customer" value={draft.customer} onChange={(event) => patch({ customer: event.target.value as PromoInput["customer"] })} className={selectClass}>
                    {CUSTOMER_SEGMENTS.map((segment) => (
                      <option key={segment} value={segment}>
                        {SEGMENT_LABEL[segment]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="promo-stacking" label="Stacking">
                  <select id="promo-stacking" value={draft.stacking} onChange={(event) => patch({ stacking: event.target.value as PromoInput["stacking"] })} className={selectClass}>
                    <option value="none">Cannot combine with other offers</option>
                    <option value="allow">Can combine with other offers</option>
                  </select>
                </Field>
              </div>
              <p className="mb-2 mt-4 text-[13px] text-muted-foreground">Channels</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["pos", "POS", "Counter checkout"],
                    ["web", "Website", "Online ordering"],
                  ] as const
                ).map(([key, label, note]) => (
                  <label key={key} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 text-sm">
                    <input type="checkbox" checked={draft.channels[key]} onChange={() => patch({ channels: { ...draft.channels, [key]: !draft.channels[key] } })} className="size-[15px] accent-[var(--primary)]" />
                    <span className="flex-1 font-medium">{label}</span>
                    <span className="text-[11px] text-muted-foreground">{note}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-muted-foreground">Ticking a channel doesn&rsquo;t activate it — pushing does.</p>
            </Section>

            <Section title="LIMITS">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="promo-usage" label="Total uses">
                  <input id="promo-usage" type="number" min={0} inputMode="numeric" value={draft.usageLimit} onChange={(event) => patch({ usageLimit: event.target.value })} placeholder="Unlimited" className={inputClass} />
                </Field>
                <Field id="promo-per-customer" label="Uses per customer">
                  <input id="promo-per-customer" type="number" min={0} inputMode="numeric" value={draft.perCustomer} onChange={(event) => patch({ perCustomer: event.target.value })} placeholder="Unlimited" className={inputClass} />
                </Field>
              </div>
            </Section>
          </fieldset>

          {/* Preview + actions */}
          <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-[76px]">
            <div className="rounded-xl border border-border bg-panel px-5 py-[18px]">
              <h3 className="mb-3 font-heading text-sm font-semibold">Customer sees</h3>
              <div className="rounded-xl bg-promo-live p-[18px]">
                <p className="text-[11px] font-bold tracking-[0.08em] text-promo-live-fg">OFFER</p>
                <p className="mt-1 break-words text-xl font-bold leading-[1.2]">{draft.name || "Untitled promotion"}</p>
                <p className="mt-2.5 text-[15px] font-semibold leading-[1.3]">{summary.headline}</p>
                {summary.lines.map((line) => (
                  <p key={line} className="mt-0.5 text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
                {draft.description && <p className="mt-2 break-words text-[13px] text-muted-foreground">{draft.description}</p>}
                <div className="mt-3.5 rounded-lg bg-foreground py-2.5 text-center text-sm font-semibold text-background">Add offer</div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-panel px-5 py-[18px]">
              {errors.length > 0 && (
                <div className="mb-3.5">
                  <h3 className="mb-2 font-heading text-sm font-semibold text-flag">Before you can push</h3>
                  <ul className="flex flex-col gap-1.5">
                    {errors.map((message) => (
                      <li key={message} className="flex gap-1.5 text-[13px] text-flag">
                        <span aria-hidden="true">⚠</span>
                        <span>{message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <p role="alert" className="mb-3 border-l-2 border-destructive bg-surface-muted px-3 py-2 text-sm">
                  {error}
                </p>
              )}
              {canEdit ? (
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => save("save")} disabled={pending} className="h-11 rounded-md bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-colors duration-[120ms] hover:bg-primary-strong disabled:opacity-50">
                    {pending ? "Saving…" : meta.status === "live" ? "Update promotion" : "Save"}
                  </button>
                  <button type="button" onClick={() => save("draft")} disabled={pending} className="h-11 rounded-md border border-border bg-panel px-4 text-[15px] font-semibold transition-colors duration-[120ms] hover:border-border-strong disabled:opacity-50">
                    Save as draft
                  </button>
                  <div className="flex gap-2">
                    <button type="button" onClick={duplicate} disabled={pending || !saved} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-panel px-3 text-[13px] font-semibold transition-colors duration-[120ms] hover:border-border-strong disabled:opacity-50">
                      <Copy className="size-3.5" aria-hidden="true" /> Duplicate
                    </button>
                    <button type="button" onClick={remove} disabled={pending} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-loss-soft px-3 text-[13px] font-semibold text-primary-strong transition-colors duration-[120ms] hover:bg-loss-soft/70 disabled:opacity-50">
                      <Trash2 className="size-3.5" aria-hidden="true" /> Delete
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Saving never activates a promotion. Pushing to POS or the website comes next and is what makes one live.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Only an owner or manager can change promotions.</p>
              )}
            </div>

            {saved && (
              <div className="rounded-xl border border-border bg-panel px-5 py-[18px] text-sm">
                <h3 className="mb-2 font-heading text-sm font-semibold">So far</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Applied</dt>
                  <dd className="tabular">
                    {meta.usageCount}
                    {saved.input.usageLimit ? ` / ${saved.input.usageLimit}` : ""}
                  </dd>
                  <dt className="text-muted-foreground">Paid orders</dt>
                  <dd className="tabular">{saved.performance.orders}</dd>
                  <dt className="text-muted-foreground">Discount given</dt>
                  <dd className="tabular">{saved.performance.discountGiven}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4.5 py-2.5 text-sm font-semibold text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
