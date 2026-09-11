"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Toasts.
 *
 * Written here rather than pulled in as a dependency: this needs four colours,
 * one animation and an accessible live region, and a library would bring its
 * own theme to argue with.
 *
 * The live region is the part that matters. Adding something to the cart with
 * no visible change is the most jarring moment on an ordering site, and for
 * anyone using a screen reader an unannounced toast is no better than none.
 * The region is rendered on mount and empty, not created when the first toast
 * fires — a live region inserted at the same moment as its content is usually
 * not announced at all.
 */

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly detail?: string;
  readonly action?: { readonly label: string; readonly href: string };
}

interface ToastContextValue {
  show: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** How long a toast stays. Long enough to read twice, short enough not to nag. */
const DURATION = 4200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduced = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      // Only ever one on screen. A stack of "added to cart" from someone
      // tapping quickly is noise, and the newest is the only true one.
      setToasts([{ ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Rendered always, so assistive tech has the region before content
          arrives in it. role="status" is polite — an order confirmation should
          not interrupt what someone is reading mid-sentence. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-6"
      >
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              /* Out faster than in: a thing leaving should not hold attention. */
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: reduced ? 0.15 : 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-3.5 shadow-[6px_6px_0_var(--red)]"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--cream-hi)]">
                <Check className="size-4" aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="font-heading text-sm font-extrabold leading-snug">{toast.message}</p>
                {toast.detail && <p className="mt-0.5 text-sm text-muted-foreground">{toast.detail}</p>}
                {toast.action && (
                  <a
                    href={toast.action.href}
                    className="mt-1.5 inline-flex min-h-[32px] items-center text-sm font-bold text-primary-strong underline underline-offset-4"
                  >
                    {toast.action.label}
                  </a>
                )}
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="-m-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return context;
}
