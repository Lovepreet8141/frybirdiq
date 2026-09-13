"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Delete, Gift, Loader2 } from "lucide-react";
import { parseMobile } from "@/lib/pos/rewards-enrolment";
import { cn } from "@/lib/utils";

/**
 * "Rewards · add mobile" — the keypad behind that one button on the till.
 *
 * Customer-initiated and never in the way: it only exists while it is open,
 * Cancel returns to the tender with nothing changed, and the number is
 * validated once, on submit (`parseMobile`), never while someone is still
 * typing. A real `inputmode="tel"` field takes a hardware keyboard or a
 * pasted number; the on-screen keys are for a tablet at the counter.
 */
export function RewardsKeypad({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  /** Resolves to an error sentence to show inline, or null when the customer was attached. */
  onSubmit: (phone: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function press(key: string) {
    setError(null);
    setValue((current) => (key === "⌫" ? current.slice(0, -1) : current.length < 13 ? current + key : current));
  }

  function submit() {
    const parsed = parseMobile(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const failure = await onSubmit(parsed.phone);
      if (failure) setError(failure);
    });
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
      aria-label="Rewards — add mobile"
    >
      <div className="flex items-center gap-2">
        <Gift className="size-5 text-primary" aria-hidden="true" />
        <h2 className="font-heading text-lg font-semibold">FRYBIRD REWARDS</h2>
      </div>
      <p className="text-sm text-muted-foreground">The customer&rsquo;s mobile number. This order earns them stamps and points.</p>

      <label htmlFor="pos-rewards-mobile" className="sr-only">
        Customer&rsquo;s mobile number
      </label>
      <input
        ref={inputRef}
        id="pos-rewards-mobile"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setError(null);
          setValue(event.target.value);
        }}
        placeholder="10-digit mobile"
        aria-invalid={error !== null}
        aria-describedby={error ? "pos-rewards-error" : undefined}
        className={cn(
          "tabular h-[64px] w-full rounded-md border bg-surface px-4 text-center text-3xl font-bold tracking-[0.08em] outline-none focus:border-primary",
          error ? "border-destructive" : "border-border-strong",
        )}
      />

      <div className="grid grid-cols-3 gap-2">
        {keys.map((key, index) =>
          key === "" ? (
            <span key={index} aria-hidden="true" />
          ) : (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              aria-label={key === "⌫" ? "Delete last digit" : key}
              className="tabular flex min-h-[52px] items-center justify-center rounded-md border border-border bg-surface text-xl font-semibold transition-colors hover:border-border-strong active:bg-surface-muted"
            >
              {key === "⌫" ? <Delete className="size-5" aria-hidden="true" /> : key}
            </button>
          ),
        )}
      </div>

      {error && (
        <p id="pos-rewards-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex min-h-[56px] flex-1 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex min-h-[56px] flex-[2] items-center justify-center gap-2 rounded-md bg-primary px-4 text-base font-bold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : "Add to order"}
        </button>
      </div>
    </form>
  );
}
