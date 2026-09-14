"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { planMove } from "@/lib/menu-admin/reorder";
import { cn } from "@/lib/utils";
import type { ActionButtonResult } from "./action-button";

export interface SortableHandleProps {
  readonly attributes: ReturnType<typeof useSortable>["attributes"];
  readonly listeners: ReturnType<typeof useSortable>["listeners"];
}

/**
 * Drag-to-reorder from the purchased `data-table4` block (dnd-kit with
 * pointer, touch and keyboard sensors, a vertical-only modifier, a grip
 * handle per row) — lifted out of its demo table so the Menu Manager's
 * lists can use it. A drop is turned into the existing one-step move
 * action, called once per row crossed, so the server's ordering rules are
 * the only ordering rules. The rows re-read after the moves land.
 */
export function SortableList({ ids, move, disabled = false, className, children }: { ids: readonly string[]; move: (id: string, direction: "up" | "down") => Promise<ActionButtonResult>; disabled?: boolean; className?: string; children: (id: string, index: number, handle: SortableHandleProps, dragging: boolean) => ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const plan = planMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    if (!plan) return;
    startTransition(async () => {
      setError(null);
      for (let step = 0; step < plan.steps; step += 1) {
        const result = await recoverFromStaleDeployment(() => move(String(active.id), plan.direction));
        if (!result.ok) {
          setError(result.error ?? "The order couldn't be saved.");
          break;
        }
      }
      router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy} disabled={disabled || isPending}>
        <div className={cn(isPending && "opacity-70", className)} aria-busy={isPending}>
          {ids.map((id, index) => (
            <SortableItem key={id} id={id} disabled={disabled || isPending}>
              {(handle, dragging) => children(id, index, handle, dragging)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      {error && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="min-h-[32px] px-3 text-xs" />}
        </p>
      )}
    </DndContext>
  );
}

function SortableItem({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: SortableHandleProps, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("relative", isDragging && "z-10")}>
      {children({ attributes, listeners }, isDragging)}
    </div>
  );
}

/** The grip. Sits at the start of a row; the whole row stays clickable for everything else. */
export function DragHandle({ handle, label, className }: { handle: SortableHandleProps; label: string; className?: string }) {
  return (
    <button type="button" {...handle.attributes} {...handle.listeners} aria-label={`Drag to reorder ${label}`} className={cn("flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing", className)}>
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}
