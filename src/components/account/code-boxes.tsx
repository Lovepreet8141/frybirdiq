"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export const CODE_LENGTH = 6;

function digitsFrom(raw: string, length: number): string[] {
  const clean = raw.replace(/\D/g, "").slice(0, length);
  return Array.from({ length }, (_, i) => clean[i] ?? "");
}

/**
 * A one-digit-per-box code entry, all wired to one hidden field so the
 * server action (`verifyOtpAction`) never sees anything but the same
 * `token` string it always has — this is a display and input-ergonomics
 * change only, no server contract change.
 *
 * Submits itself the moment the last box fills (typed or pasted) — once,
 * guarded against the pending state re-firing it and against a state
 * update after unmount. `resetToken` remounts the group (fresh empty
 * boxes, first box focused) whenever the caller changes it — the OTP
 * screen bumps it after a failed verify, since a wrong code should never
 * sit there ready to be silently resubmitted.
 */
export function CodeBoxes({
  name,
  length = CODE_LENGTH,
  resetToken,
  invalid = false,
}: {
  name: string;
  length?: number;
  resetToken: number;
  invalid?: boolean;
}) {
  return <CodeBoxesInner key={resetToken} name={name} length={length} invalid={invalid} />;
}

function CodeBoxesInner({ name, length, invalid }: { name: string; length: number; invalid: boolean }) {
  const { pending } = useFormStatus();
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const boxRefs = useRef<Array<HTMLInputElement | null>>([]);
  const submittedRef = useRef(false);

  useEffect(() => {
    boxRefs.current[0]?.focus();
  }, []);

  function maybeSubmit(next: string[]) {
    if (submittedRef.current) return;
    if (next.every((d) => d !== "")) {
      submittedRef.current = true;
      boxRefs.current[length - 1]?.form?.requestSubmit();
    }
  }

  function handleChange(index: number, raw: string) {
    if (pending) return;
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < length - 1) boxRefs.current[index + 1]?.focus();
    maybeSubmit(next);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (pending) return;
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = "";
      setDigits(next);
      boxRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      boxRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      boxRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (pending) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData("text/plain");
    if (!/\d/.test(pasted)) return;
    const next = digitsFrom(pasted, length);
    setDigits(next);
    const lastFilled = next.reduce((acc, d, i) => (d ? i : acc), -1);
    boxRefs.current[Math.min(lastFilled + 1, length - 1)]?.focus();
    maybeSubmit(next);
  }

  const joined = digits.join("");

  return (
    <div role="group" aria-label={`${length}-digit code`} className="flex justify-center gap-2 sm:gap-3">
      <input type="hidden" name={name} value={joined} />
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            boxRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="one-time-code"
          value={digit}
          disabled={pending}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          className={`h-14 w-11 rounded-md border bg-surface text-center text-xl font-semibold tabular outline-none transition-colors focus-visible:border-border-strong disabled:opacity-50 sm:h-[52px] sm:w-12 ${
            invalid ? "border-destructive" : "border-border"
          }`}
        />
      ))}
    </div>
  );
}
