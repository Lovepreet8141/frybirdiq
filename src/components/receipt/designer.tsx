"use client";

/**
 * Bill & Receipt — the designer.
 *
 * Three columns: the sections on the roll (show, hide, drag to reorder),
 * the live 79 mm preview against a sample order, and the editor for the
 * selected section. Everything edits the *draft*; the POS keeps printing
 * the *active* design until Apply. Print Test prints the sample on the
 * screen — no order is created, nothing is recorded.
 */

import { useState, useTransition } from "react";
import { Check as CheckIcon, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Loader2, Plus, Printer, RotateCcw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/staff/page-header";
import { applyReceiptDesignAction, restoreReceiptDesignAction, saveReceiptDraftAction } from "@/lib/receipt/actions";
import { type SampleSize, sampleReceipt } from "@/lib/receipt/data";
import { renderReceipt, renderedSectionIds } from "@/lib/receipt/render";
import { SECTION_LABELS, type ReceiptTemplate, type Section, newTextSection } from "@/lib/receipt/template";
import { cn } from "@/lib/utils";
import { ReceiptSheet } from "./receipt-sheet";
import { Check, SectionEditor } from "./section-editors";

export interface DesignerProps {
  readonly draft: ReceiptTemplate;
  readonly hasActive: boolean;
  readonly hasPrevious: boolean;
  /** ISO strings — the page serialises the repository's dates. */
  readonly draftUpdatedAt: string | null;
  readonly appliedAt: string | null;
}

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

const SAMPLES: readonly { value: SampleSize; label: string; hint: string }[] = [
  { value: "small", label: "Small", hint: "1 item" },
  { value: "normal", label: "Normal", hint: "3 items, coupon" },
  { value: "large", label: "Large", hint: "14 items, delivery" },
];

function stamp(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ReceiptDesigner(props: DesignerProps) {
  const [template, setTemplate] = useState<ReceiptTemplate>(props.draft);
  const [savedTemplate, setSavedTemplate] = useState<ReceiptTemplate>(props.draft);
  const [hasActive, setHasActive] = useState(props.hasActive);
  const [hasPrevious, setHasPrevious] = useState(props.hasPrevious);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState(props.draftUpdatedAt);
  const [appliedAt, setAppliedAt] = useState(props.appliedAt);
  const [selectedId, setSelectedId] = useState<string | null>(props.draft.sections.find((section) => section.kind === "restaurant")?.id ?? props.draft.sections[0]?.id ?? null);
  const [sample, setSample] = useState<SampleSize>("normal");
  const [status, setStatus] = useState<Status>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [textSeq, setTextSeq] = useState(1);
  const [isPending, startTransition] = useTransition();

  const dirty = template !== savedTemplate;
  const data = sampleReceipt(sample);
  const printed = renderedSectionIds(renderReceipt(template, data));
  const selected = template.sections.find((section) => section.id === selectedId) ?? null;

  /* ---- editing ------------------------------------------------------ */

  const setSections = (sections: readonly Section[]) => setTemplate((current) => ({ ...current, sections }));
  const updateSection = (next: Section) => setSections(template.sections.map((section) => (section.id === next.id ? next : section)));
  const toggleVisible = (id: string) => setSections(template.sections.map((section) => (section.id === id ? { ...section, visible: !section.visible } : section)));
  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= template.sections.length) return;
    const next = [...template.sections];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setSections(next);
  };
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = template.sections.findIndex((section) => section.id === dragId);
    const to = template.sections.findIndex((section) => section.id === targetId);
    if (from < 0 || to < 0) return;
    moveSection(from, to);
    setDragId(null);
  };
  const addText = () => {
    const block = newTextSection(textSeq);
    setTextSeq((n) => n + 1);
    // Right after the selected section, or at the end.
    const at = selectedId ? template.sections.findIndex((section) => section.id === selectedId) : -1;
    const next = [...template.sections];
    next.splice(at >= 0 ? at + 1 : next.length, 0, block);
    setSections(next);
    setSelectedId(block.id);
  };
  const deleteSection = (id: string) => {
    setSections(template.sections.filter((section) => section.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  /* ---- saving ------------------------------------------------------- */

  function saveDraft() {
    setStatus(null);
    startTransition(async () => {
      const result = await saveReceiptDraftAction(template);
      if (!result.ok) {
        setStatus({ tone: "error", text: result.error });
        return;
      }
      setSavedTemplate(template);
      setDraftUpdatedAt(new Date().toISOString());
      setStatus({ tone: "ok", text: "Draft saved. The POS still prints the current design until you apply this one." });
    });
  }

  function apply() {
    setConfirmApply(false);
    setStatus(null);
    startTransition(async () => {
      const result = await applyReceiptDesignAction(template);
      if (!result.ok) {
        setStatus({ tone: "error", text: result.error });
        return;
      }
      setSavedTemplate(template);
      const now = new Date().toISOString();
      setDraftUpdatedAt(now);
      setAppliedAt(now);
      setHasPrevious(hasActive || hasPrevious);
      setHasActive(true);
      setStatus({ tone: "ok", text: "✓ Receipt design is now active on POS" });
    });
  }

  function restore() {
    setConfirmRestore(false);
    setStatus(null);
    startTransition(async () => {
      const result = await restoreReceiptDesignAction();
      if (!result.ok) {
        setStatus({ tone: "error", text: result.error });
        return;
      }
      setAppliedAt(new Date().toISOString());
      setStatus({ tone: "ok", text: "The previous design is active on POS again. Your draft here is unchanged." });
    });
  }

  function printTest() {
    window.print();
  }

  /* ---- render ------------------------------------------------------- */

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Bill & Receipt"
        description="Customize exactly what prints on your 79 mm POS receipt."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="lg" onClick={saveDraft} disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              Save Draft
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={printTest}>
              <Printer aria-hidden="true" />
              Print Test
            </Button>
            <Button type="button" size="lg" onClick={() => setConfirmApply(true)} disabled={isPending}>
              <Send aria-hidden="true" />
              Apply to POS
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", hasActive ? "bg-success" : "bg-warning")} aria-hidden="true" />
          {hasActive ? `Active on POS${appliedAt ? ` · applied ${stamp(appliedAt)}` : ""}` : "No design applied yet — the POS prints the built-in default"}
        </span>
        <span>{dirty ? "Unsaved changes" : draftUpdatedAt ? `Draft saved ${stamp(draftUpdatedAt)}` : "Draft not saved yet"}</span>
        {hasPrevious && (
          <button type="button" onClick={() => setConfirmRestore(true)} disabled={isPending} className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-50">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Restore previous design
          </button>
        )}
      </div>

      {status && (
        <p role={status.tone === "error" ? "alert" : "status"} className={cn("border-l-2 bg-surface px-4 py-3 text-sm", status.tone === "error" ? "border-[var(--destructive)]" : status.tone === "ok" ? "border-[var(--success)]" : "border-border-strong")}>
          {status.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        {/* LEFT — sections on the roll */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:self-start">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-base font-semibold">Receipt sections</h2>
            <span className="text-xs text-muted-foreground">Top to bottom</span>
          </div>
          <ol className="flex flex-col gap-1">
            {template.sections.map((section, index) => {
              const isSelected = section.id === selectedId;
              const prints = section.visible && printed.has(section.id);
              return (
                <li
                  key={section.id}
                  draggable
                  onDragStart={(event) => {
                    setDragId(section.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropOn(section.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border bg-surface pr-1 transition-colors",
                    isSelected ? "border-foreground" : "border-border hover:border-border-strong",
                    dragId === section.id && "opacity-50",
                    !section.visible && "text-muted-foreground",
                  )}
                >
                  <span className="flex h-[44px] w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing" aria-hidden="true">
                    <GripVertical className="size-4" />
                  </span>
                  <button type="button" onClick={() => setSelectedId(section.id)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left text-sm">
                    <span className={cn("truncate font-medium", !section.visible && "line-through decoration-muted-foreground/60")}>{section.kind === "text" ? section.text.split("\n")[0]?.slice(0, 24) || "Custom text" : SECTION_LABELS[section.kind]}</span>
                    {section.kind === "text" && <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Text</span>}
                    {section.visible && !prints && <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Empty</span>}
                  </button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={section.visible ? `Hide ${SECTION_LABELS[section.kind]}` : `Show ${SECTION_LABELS[section.kind]}`} aria-pressed={section.visible} onClick={() => toggleVisible(section.id)}>
                    {section.visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                  </Button>
                  <span className="flex flex-col">
                    <Button type="button" size="icon-xs" variant="ghost" className="h-5" aria-label="Move up" disabled={index === 0} onClick={() => moveSection(index, index - 1)}>
                      <ChevronUp aria-hidden="true" />
                    </Button>
                    <Button type="button" size="icon-xs" variant="ghost" className="h-5" aria-label="Move down" disabled={index === template.sections.length - 1} onClick={() => moveSection(index, index + 1)}>
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>
          <Button type="button" variant="outline" onClick={addText} className="justify-start">
            <Plus aria-hidden="true" />
            Add custom text
          </Button>

          <div className="mt-2 flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Paper</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1">
                <span className="font-medium">Width</span>
                <select value={template.paperWidthMm} onChange={(event) => setTemplate({ ...template, paperWidthMm: Number(event.target.value) as 79 | 58 })} className="h-[38px] rounded-md border border-border bg-background px-2">
                  <option value={79}>79 mm</option>
                  <option value={58}>58 mm</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Dividers</span>
                <select value={template.divider} onChange={(event) => setTemplate({ ...template, divider: event.target.value as ReceiptTemplate["divider"] })} className="h-[38px] rounded-md border border-border bg-background px-2">
                  <option value="dashed">Dashed</option>
                  <option value="solid">Solid</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
          </div>
        </aside>

        {/* CENTRE — the roll */}
        <section className="flex min-w-0 flex-col gap-3" aria-label="Live preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">Live preview</h2>
            <div role="radiogroup" aria-label="Sample order" className="flex rounded-md border border-border bg-background p-0.5">
              {SAMPLES.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={sample === option.value} onClick={() => setSample(option.value)} className={cn("min-h-[36px] rounded-[5px] px-3 text-sm font-medium transition-colors", sample === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")} title={option.hint}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-muted px-4 py-6">
            <div className="mx-auto w-fit">
              <ReceiptSheet template={template} data={data} mode="preview" selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Sample data · {SAMPLES.find((option) => option.value === sample)?.hint}. Click any part of the bill to edit it. Print Test prints this sample and never creates an order.</p>
        </section>

        {/* RIGHT — the selected section */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:max-h-[calc(100dvh-var(--header-height)-2rem)] lg:self-start lg:overflow-y-auto">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-heading text-base font-semibold">{selected.kind === "text" ? "Custom text" : SECTION_LABELS[selected.kind]}</h2>
                <Check id={`${selected.id}-visible`} label="Show on bill" checked={selected.visible} onChange={() => toggleVisible(selected.id)} />
              </div>
              <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4">
                <SectionEditor section={selected} onChange={updateSection} onDelete={selected.kind === "text" ? () => deleteSection(selected.id) : undefined} />
              </div>
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Select a section on the left, or click the bill, to edit it.</p>
          )}
        </aside>
      </div>

      {/* The print copy: invisible on screen, the only thing on the page when printing. */}
      <ReceiptSheet template={template} data={data} mode="print" />

      <Dialog open={confirmApply} onOpenChange={setConfirmApply}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this receipt design to POS?</DialogTitle>
            <DialogDescription>This will replace the current POS receipt layout. Every bill printed from the till from now on uses this design. You can restore the previous design afterwards.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmApply(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={apply}>
              <CheckIcon aria-hidden="true" />
              Apply to POS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore the previous design?</DialogTitle>
            <DialogDescription>The POS goes back to the design that was active before the last apply. The draft you are editing here is not changed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRestore(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={restore}>
              <RotateCcw aria-hidden="true" />
              Restore previous
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
