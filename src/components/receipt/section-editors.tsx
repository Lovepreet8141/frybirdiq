"use client";

/**
 * The right-hand column of the designer: one editor per section kind.
 * Every control writes straight into the template, so the preview beside
 * it changes on the keystroke. Nothing here touches money — a row can be
 * shown, hidden or renamed, never recomputed.
 */

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Trash2, Upload, X } from "lucide-react";
import { Field, inputClass, selectClass } from "@/components/inventory/field";
import { Button } from "@/components/ui/button";
import { uploadReceiptImageAction } from "@/lib/receipt/actions";
import type { Align, ImageSize, ItemsSection, OtherQr, RestaurantField, Section, TextSize, TextStyle, ToggleRow } from "@/lib/receipt/template";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

export function Check({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (next: boolean) => void; hint?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-[36px] cursor-pointer items-start gap-2.5 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-[3px] size-4 shrink-0 accent-[var(--primary)]" />
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void; label: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border bg-background p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn("min-h-[36px] flex-1 rounded-[5px] px-2 text-sm font-medium transition-colors", value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
] as const satisfies readonly { value: Align; label: string }[];
const TEXT_SIZES = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Large" },
] as const satisfies readonly { value: TextSize; label: string }[];
const IMAGE_SIZES = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
] as const satisfies readonly { value: ImageSize; label: string }[];

function Spacing({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (next: number) => void }) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} onChange={(event) => onChange(Number(event.target.value))} className={selectClass}>
        {[0, 1, 2, 3, 4].map((lines) => (
          <option key={lines} value={lines}>
            {lines === 0 ? "None" : `${lines} line${lines === 1 ? "" : "s"}`}
          </option>
        ))}
      </select>
    </Field>
  );
}

function StyleEditor({ id, style, onChange }: { id: string; style: TextStyle; onChange: (next: TextStyle) => void }) {
  return (
    <>
      <Segmented label="Alignment" value={style.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...style, align })} />
      <Segmented label="Text size" value={style.size} options={TEXT_SIZES} onChange={(size) => onChange({ ...style, size })} />
      <Check id={`${id}-bold`} label="Bold" checked={style.bold} onChange={(bold) => onChange({ ...style, bold })} />
      <div className="grid grid-cols-2 gap-3">
        <Spacing id={`${id}-above`} label="Space above" value={style.spaceAbove} onChange={(spaceAbove) => onChange({ ...style, spaceAbove })} />
        <Spacing id={`${id}-below`} label="Space below" value={style.spaceBelow} onChange={(spaceBelow) => onChange({ ...style, spaceBelow })} />
      </div>
    </>
  );
}

/** Upload → the media library → the public URL stored in the template. */
function ImagePicker({ id, label, url, purpose, onChange, hint }: { id: string; label: string; url: string | null; purpose: "logo" | "paymentQr" | "qr"; onChange: (url: string | null) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", purpose);
    const result = await uploadReceiptImageAction(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange(result.url);
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center gap-3 rounded-md border border-border bg-background p-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- previewing the uploaded file at thumbnail size
          <img src={url} alt="" className="size-14 shrink-0 rounded border border-border object-contain [filter:grayscale(1)]" />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
            <Upload className="size-4" aria-hidden="true" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
              {url ? "Replace" : "Upload"}
            </Button>
            {url && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onChange(null)}>
                <X aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{hint ?? "PNG, JPEG or WebP up to 8 MB. Prints in black and white."}</p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row lists — show/hide, rename, reorder                              */
/* ------------------------------------------------------------------ */

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function RowsEditor({ id, rows, onChange, reorder = false, labelHint = "Label" }: { id: string; rows: readonly ToggleRow[]; onChange: (rows: ToggleRow[]) => void; reorder?: boolean; labelHint?: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row, index) => (
        <li key={row.key} className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          <input
            id={`${id}-${row.key}-show`}
            type="checkbox"
            checked={row.show}
            aria-label={`Show ${row.label || row.key}`}
            onChange={(event) => onChange(rows.map((candidate) => (candidate.key === row.key ? { ...candidate, show: event.target.checked } : candidate)))}
            className="size-4 shrink-0 accent-[var(--primary)]"
          />
          <input
            type="text"
            value={row.label}
            aria-label={`${labelHint} for ${row.key}`}
            placeholder={row.key}
            onChange={(event) => onChange(rows.map((candidate) => (candidate.key === row.key ? { ...candidate, label: event.target.value } : candidate)))}
            className="h-[34px] min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring"
          />
          {reorder && (
            <span className="flex shrink-0">
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onChange(move(rows, index, index - 1))}>
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => onChange(move(rows, index, index + 1))}>
                <ChevronDown aria-hidden="true" />
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RestaurantFieldsEditor({ fields, onChange }: { fields: readonly RestaurantField[]; onChange: (fields: RestaurantField[]) => void }) {
  const update = (key: string, patch: Partial<RestaurantField>) => onChange(fields.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  return (
    <ul className="flex flex-col gap-2">
      {fields.map((field, index) => (
        <li key={field.key} className="rounded-md border border-border bg-background p-2">
          <div className="flex items-center gap-2">
            <input id={`rf-${field.key}-show`} type="checkbox" checked={field.show} aria-label={`Show ${field.label}`} onChange={(event) => update(field.key, { show: event.target.checked })} className="size-4 shrink-0 accent-[var(--primary)]" />
            <label htmlFor={`rf-${field.key}-value`} className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {field.label}
            </label>
            <span className="flex shrink-0">
              <Button type="button" size="icon-xs" variant="ghost" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={() => onChange(move(fields, index, index - 1))}>
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={`Move ${field.label} down`} disabled={index === fields.length - 1} onClick={() => onChange(move(fields, index, index + 1))}>
                <ChevronDown aria-hidden="true" />
              </Button>
            </span>
          </div>
          <input id={`rf-${field.key}-value`} type="text" value={field.value} placeholder={`Add ${field.label.toLowerCase()}`} onChange={(event) => update(field.key, { value: event.target.value })} className={cn(inputClass, "mt-1.5 h-[38px]")} />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function SectionEditor({ section, onChange, onDelete }: { section: Section; onChange: (next: Section) => void; onDelete?: () => void }) {
  const id = section.id;
  switch (section.kind) {
    case "logo":
      return (
        <>
          <ImagePicker id={`${id}-file`} label="Logo image" url={section.url} purpose="logo" onChange={(url) => onChange({ ...section, url })} hint="A dark logo on a white background prints best. PNG, JPEG or WebP up to 8 MB." />
          <Segmented label="Size" value={section.size} options={IMAGE_SIZES} onChange={(size) => onChange({ ...section, size })} />
          <Segmented label="Alignment" value={section.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...section, align })} />
          <div className="grid grid-cols-2 gap-3">
            <Spacing id={`${id}-above`} label="Space above" value={section.spaceAbove} onChange={(spaceAbove) => onChange({ ...section, spaceAbove })} />
            <Spacing id={`${id}-below`} label="Space below" value={section.spaceBelow} onChange={(spaceBelow) => onChange({ ...section, spaceBelow })} />
          </div>
        </>
      );
    case "header":
    case "text":
    case "footer":
      return (
        <>
          <Field id={`${id}-text`} label={section.kind === "header" ? "Header text" : section.kind === "footer" ? "Footer text" : "Text"} hint="One line per row. Blank lines print as spacing.">
            <textarea id={`${id}-text`} value={section.text} rows={4} onChange={(event) => onChange({ ...section, text: event.target.value })} className={cn(inputClass, "h-auto py-2")} />
          </Field>
          <StyleEditor id={id} style={section.style} onChange={(style) => onChange({ ...section, style })} />
          {section.kind === "text" && onDelete && (
            <Button type="button" variant="outline" className="justify-start text-destructive" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              Remove this text block
            </Button>
          )}
        </>
      );
    case "restaurant":
      return (
        <>
          <Note>Tick a field to print it, edit what it says, and use the arrows to change the order. The restaurant page stays as it is — this is only what the bill shows.</Note>
          <Segmented label="Alignment" value={section.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...section, align })} />
          <RestaurantFieldsEditor fields={section.fields} onChange={(fields) => onChange({ ...section, fields })} />
        </>
      );
    case "order":
      return (
        <>
          <Note>Each line prints as its label followed by the order&rsquo;s own value. Clear a label to print the value alone. Date and time share one line when both are on.</Note>
          <Segmented label="Alignment" value={section.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...section, align })} />
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "customer":
      return (
        <>
          <Note>Only prints what the order actually has: a walk-in with no phone on the order prints nothing here.</Note>
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "items":
      return <ItemsEditor section={section} onChange={onChange} />;
    case "discounts":
      return (
        <>
          <Note>A discount line prints only when that discount was applied. A coupon or offer prints under its own name instead of the label.</Note>
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "taxes":
      return (
        <>
          <Note>Tax is computed per line by the pricing engine and is not changed here — this only decides whether, and how, the totals are shown.</Note>
          <Check id={`${id}-rate`} label="Show the rate" hint="CGST 2.5% instead of CGST" checked={section.showRate} onChange={(showRate) => onChange({ ...section, showRate })} />
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} />
        </>
      );
    case "charges":
      return (
        <>
          <Note>A charge prints only when the order carried one.</Note>
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "total":
      return (
        <>
          <Note>Subtotal and the grand total always print when ticked; the others print only when they are not zero.</Note>
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "payment":
      return (
        <>
          <Note>Change prints only on cash orders where change was due.</Note>
          <RowsEditor id={id} rows={section.rows} onChange={(rows) => onChange({ ...section, rows })} reorder />
        </>
      );
    case "paymentQr":
      return (
        <>
          <Note>A static image of your UPI QR, exactly as you would stick it on the counter. Nothing is charged through it by the app.</Note>
          <ImagePicker id={`${id}-file`} label="QR image" url={section.url} purpose="paymentQr" onChange={(url) => onChange({ ...section, url })} />
          <Field id={`${id}-above`} label="Text above">
            <input id={`${id}-above`} type="text" value={section.textAbove} onChange={(event) => onChange({ ...section, textAbove: event.target.value })} className={inputClass} />
          </Field>
          <Field id={`${id}-below`} label="Text below">
            <input id={`${id}-below`} type="text" value={section.textBelow} onChange={(event) => onChange({ ...section, textBelow: event.target.value })} className={inputClass} />
          </Field>
          <Segmented label="Size" value={section.size} options={IMAGE_SIZES} onChange={(size) => onChange({ ...section, size })} />
          <Segmented label="Alignment" value={section.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...section, align })} />
        </>
      );
    case "otherQrs":
      return (
        <>
          <Note>Upload a QR for each link you want on the bill. Only ticked codes with an image print.</Note>
          <Segmented label="Size" value={section.size} options={IMAGE_SIZES} onChange={(size) => onChange({ ...section, size })} />
          <Segmented label="Alignment" value={section.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...section, align })} />
          <ul className="flex flex-col gap-2">
            {section.codes.map((code) => (
              <OtherQrEditor key={code.id} code={code} onChange={(next) => onChange({ ...section, codes: section.codes.map((candidate) => (candidate.id === code.id ? next : candidate)) })} />
            ))}
          </ul>
        </>
      );
  }
}

function OtherQrEditor({ code, onChange }: { code: OtherQr; onChange: (next: OtherQr) => void }) {
  return (
    <li className="rounded-md border border-border bg-background p-2">
      <div className="flex items-center gap-2">
        <input id={`${code.id}-show`} type="checkbox" checked={code.show} aria-label={`Print ${code.label}`} onChange={(event) => onChange({ ...code, show: event.target.checked })} className="size-4 shrink-0 accent-[var(--primary)]" />
        <input type="text" value={code.label} aria-label={`Caption for ${code.kind} QR`} onChange={(event) => onChange({ ...code, label: event.target.value })} className="h-[34px] min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm font-medium outline-none focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <div className="mt-1.5">
        <ImagePicker id={`${code.id}-file`} label="" url={code.url} purpose="qr" onChange={(url) => onChange({ ...code, url })} hint="A QR image for this link." />
      </div>
    </li>
  );
}

function ItemsEditor({ section, onChange }: { section: ItemsSection; onChange: (next: Section) => void }) {
  const id = section.id;
  const show = section.show;
  const flag = (key: keyof ItemsSection["show"], label: string, hint?: string) => (
    <Check id={`${id}-${key}`} label={label} hint={hint} checked={show[key]} onChange={(next) => onChange({ ...section, show: { ...show, [key]: next } })} />
  );
  return (
    <>
      <Segmented
        label="Item layout"
        value={section.layout}
        options={[
          { value: "compact", label: "Compact" },
          { value: "detailed", label: "Detailed" },
          { value: "qsr", label: "QSR" },
        ]}
        onChange={(layout) => onChange({ ...section, layout })}
      />
      <Note>
        {section.layout === "compact" && "One line per item: name × quantity, amount on the right."}
        {section.layout === "detailed" && "Name on its own line, then quantity × unit price with the amount — the clearest for GST-style bills."}
        {section.layout === "qsr" && "Quantity first, then the name — quick to read at a counter."}
      </Note>
      <Check id={`${id}-header`} label="Column header row" checked={section.columnHeader} onChange={(columnHeader) => onChange({ ...section, columnHeader })} />
      <div className="grid gap-0.5">
        {flag("quantity", "Quantity")}
        {flag("unitPrice", "Unit price", "Detailed layout only")}
        {flag("total", "Line amount")}
        {flag("modifiers", "Modifiers", "Extra cheese, sauce choices")}
        {flag("modifierPrices", "Modifier prices", "The +₹ next to a paid modifier")}
        {flag("notes", "Item notes", "Kitchen instructions typed on the order")}
        {flag("itemDiscount", "Item-level discount")}
        {flag("itemTax", "Tax per item")}
        {flag("sku", "SKU / code")}
      </div>
    </>
  );
}
