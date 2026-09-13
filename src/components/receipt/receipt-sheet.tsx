"use client";

/**
 * One receipt, drawn from `renderReceipt`'s blocks — the same component for
 * the designer's live preview, the test print and the POS slip, so what
 * the owner sees on screen is what the roll prints.
 *
 * Sized in millimetres for the roll (79 mm, or 58 mm when the template
 * says so) with a 3 mm gutter each side, in a monospace face at the point
 * sizes a thermal head resolves cleanly. Print mode carries the
 * `data-print-receipt` hook the print rules in globals.css key off, and an
 * `@page` rule for the roll, and flattens images to high-contrast
 * greyscale since a thermal printer has one colour.
 */

import type { Block } from "@/lib/receipt/render";
import { renderReceipt } from "@/lib/receipt/render";
import type { ReceiptData } from "@/lib/receipt/data";
import type { ReceiptTemplate, TextSize } from "@/lib/receipt/template";
import { cn } from "@/lib/utils";

const SIZE: Record<TextSize, string> = {
  sm: "text-[10px] leading-[13px]",
  md: "text-[12px] leading-[15px]",
  lg: "text-[15px] leading-[18px]",
};
const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
const JUSTIFY = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;

function BlockView({ block, divider }: { block: Block; divider: ReceiptTemplate["divider"] }) {
  switch (block.kind) {
    case "text":
      return <p className={cn("break-words whitespace-pre-wrap", SIZE[block.size], ALIGN[block.align], block.bold && "font-bold", block.muted && "opacity-80")}>{block.text || " "}</p>;
    case "row":
      return (
        <div className={cn("flex items-baseline justify-between gap-2", SIZE[block.size], block.bold && "font-bold", block.muted && "opacity-80", block.indent && "pl-3")}>
          <span className="min-w-0 break-words">{block.left}</span>
          {block.right && <span className="shrink-0 whitespace-nowrap">{block.right}</span>}
        </div>
      );
    case "image":
      return (
        <div className={cn("flex", JUSTIFY[block.align])}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a receipt image goes to a printer at its own size; no optimisation pipeline */}
          <img src={block.url} alt={block.alt} style={{ width: `${block.widthPct}%` }} className="h-auto [filter:grayscale(1)_contrast(1.35)]" />
        </div>
      );
    case "rule":
      return divider === "none" ? null : <hr className={cn("my-1 border-0 border-t border-current", divider === "dashed" && "border-dashed")} />;
    case "space":
      return <div style={{ height: `${block.lines * 13}px` }} aria-hidden="true" />;
  }
}

/** Consecutive blocks of one section, so the preview can outline and select a section as a unit. */
function group(blocks: readonly Block[]): { sectionId: string; blocks: Block[] }[] {
  const out: { sectionId: string; blocks: Block[] }[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (last && last.sectionId === block.sectionId) last.blocks.push(block);
    else out.push({ sectionId: block.sectionId, blocks: [block] });
  }
  return out;
}

export function ReceiptSheet({
  template,
  data,
  mode,
  selectedId = null,
  onSelect,
  className,
}: {
  template: ReceiptTemplate;
  data: ReceiptData;
  /** `preview` draws on screen and is never printed; `print` is invisible on screen and the only thing on the page when printing. */
  mode: "preview" | "print";
  selectedId?: string | null;
  onSelect?: (sectionId: string) => void;
  className?: string;
}) {
  const blocks = renderReceipt(template, data);
  const groups = group(blocks);
  const widthMm = template.paperWidthMm;

  if (mode === "print") {
    return (
      <div
        data-print-receipt=""
        className="hidden bg-white font-mono text-black print:block"
        style={{ width: `${widthMm}mm`, padding: "2mm 3mm" }}
      >
        <style>{`@page { size: ${widthMm}mm auto; margin: 0; }`}</style>
        {blocks.map((block, index) => (
          <BlockView key={index} block={block} divider={template.divider} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("bg-white font-mono text-black shadow-[0_1px_2px_rgba(0,0,0,0.12),0_8px_24px_-12px_rgba(0,0,0,0.35)]", className)}
      style={{ width: `${widthMm}mm`, padding: "4mm 3mm 8mm" }}
      aria-label="Receipt preview"
    >
      {groups.length === 0 && <p className="py-6 text-center text-[11px] opacity-60">Nothing to print — every section is hidden.</p>}
      {groups.map((section, index) => {
        const selected = section.sectionId === selectedId;
        const interactive = Boolean(onSelect);
        return (
          <div
            key={`${section.sectionId}-${index}`}
            data-section-id={section.sectionId}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? () => onSelect?.(section.sectionId) : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect?.(section.sectionId);
                    }
                  }
                : undefined
            }
            className={cn(
              "-mx-1 rounded-sm px-1 outline-none transition-[box-shadow,background-color]",
              interactive && "cursor-pointer hover:bg-[rgba(0,0,0,0.04)] focus-visible:ring-2 focus-visible:ring-ring",
              selected && "bg-[rgba(0,0,0,0.05)] ring-2 ring-ring",
            )}
          >
            {section.blocks.map((block, blockIndex) => (
              <BlockView key={blockIndex} block={block} divider={template.divider} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
