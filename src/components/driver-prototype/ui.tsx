"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The prototype's phone-scale primitives. Same tokens and type as FRYBIRD
 * IQ — Instrument Sans, the serif for money at display size, the gain /
 * loss / flag signals — sized for a thumb outdoors: 56px primary actions,
 * 48px secondaries, 16px body.
 */

export function BigButton({
  children,
  onClick,
  tone = "primary",
  disabled,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "inverse" | "outline" | "quiet" | "loss";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-[56px] w-full touch-manipulation select-none items-center justify-center gap-2 rounded-xl px-4 text-[16px] font-semibold transition-[background-color,transform,opacity] duration-[120ms] active:translate-y-px disabled:opacity-50",
        tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary-strong",
        tone === "inverse" && "bg-inverse text-inverse-foreground hover:bg-inverse/85",
        tone === "outline" && "border border-border-strong bg-panel text-foreground active:bg-surface-muted",
        tone === "quiet" && "min-h-[48px] text-[15px] text-muted-foreground active:bg-surface-muted",
        tone === "loss" && "bg-loss-soft text-loss active:bg-loss-soft/70",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Dot({ tone, className }: { tone: "gain" | "loss" | "flag" | "neutral"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-[7px] shrink-0 rounded-full",
        tone === "gain" && "bg-gain",
        tone === "loss" && "bg-loss",
        tone === "flag" && "bg-flag",
        tone === "neutral" && "bg-muted-foreground/60",
        className,
      )}
    />
  );
}

/** A dot and a word — the IQ status idiom, never colour alone. */
export function StatusWord({ tone, children, className }: { tone: "gain" | "loss" | "flag" | "neutral"; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-semibold", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "flag" && "text-flag", tone === "neutral" && "text-muted-foreground", className)}>
      <Dot tone={tone} />
      {children}
    </span>
  );
}

export function Money({ amount, size = "md", className }: { amount: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return <span className={cn("tabular font-money leading-none tracking-[-0.01em]", size === "lg" && "text-[40px]", size === "md" && "text-[28px]", size === "sm" && "text-[22px]", className)}>{amount}</span>;
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn("flex w-full touch-manipulation select-none flex-col rounded-xl border border-border bg-panel text-left transition-[background-color,border-color] duration-[120ms] hover:border-border-strong active:bg-surface-muted", className)}>
        {children}
      </button>
    );
  }
  return <div className={cn("flex flex-col rounded-xl border border-border bg-panel", className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-semibold tracking-[0.04em] text-muted-foreground", className)}>{children}</p>;
}

/** The screen's top bar: a title, an optional back, an optional right slot. 56px, sits under the fake status bar. */
export function TopBar({ title, onBack, right, subtitle }: { title: ReactNode; onBack?: () => void; right?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex min-h-[56px] shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back" className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-foreground transition-colors duration-[120ms] active:bg-surface-muted">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className={cn("min-w-0 flex-1", !onBack && "pl-1")}>
        <p className="truncate font-heading text-[17px] font-semibold leading-tight tracking-[-0.01em]">{title}</p>
        {subtitle && <p className="truncate text-[12.5px] leading-tight text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}

/** A bottom sheet that stays inside the phone frame (no portal — it is part of the prototype's own layout). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 z-30 bg-foreground/40"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="absolute inset-x-0 bottom-0 z-40 flex max-h-[88%] flex-col rounded-t-2xl border-t border-border bg-panel pb-[max(env(safe-area-inset-bottom),12px)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
            initial={reduced ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
              <p className="font-heading text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
              <button type="button" onClick={onClose} aria-label="Close" className="flex size-9 touch-manipulation items-center justify-center rounded-lg text-muted-foreground active:bg-surface-muted">
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Five-step progress for a job: the rider always knows where they are. */
export function StepBar({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn("h-1.5 rounded-full transition-colors duration-[200ms]", done && "bg-gain", active && "bg-inverse", !done && !active && "bg-muted")} aria-hidden="true" />
            <span className={cn("truncate text-[10.5px] font-semibold tracking-[0.02em]", active ? "text-foreground" : "text-muted-foreground")}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A quiet toast at the top of the phone; the prototype uses it where a real app would dial or open a camera. */
export function Toast({ message }: { message: string | null }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          role="status"
          className="absolute inset-x-3 top-14 z-50 rounded-lg bg-inverse px-3.5 py-2.5 text-center text-[13.5px] font-medium text-inverse-foreground shadow-lg"
          initial={reduced ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-7 w-12 shrink-0 touch-manipulation rounded-full transition-colors duration-[120ms]", checked ? "bg-gain" : "bg-muted-foreground/40")}
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-[left] duration-[120ms]", checked ? "left-[22px]" : "left-0.5")} aria-hidden="true" />
    </button>
  );
}
