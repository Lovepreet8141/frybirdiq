"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { errorNoteClass, submitClass, successNoteClass } from "@/components/inventory/field";
import { type ShiftActionState, clockInAction, clockOutAction, endBreakAction, startBreakAction } from "@/lib/shifts/actions";

function Tap({ label, busy, offline }: { label: string; busy: string; offline: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || offline} className={`${submitClass} min-h-[44px] px-6`}>
      {pending ? busy : label}
    </button>
  );
}

/** Clock in or out for the signed-in person. The server decides who: nothing about the person is sent. */
export function ClockCard({ onShiftSince, onBreakSince }: { onShiftSince: string | null; onBreakSince: string | null }) {
  const [inState, inAction] = useActionState<ShiftActionState, FormData>(clockInAction, { status: "idle" });
  const [outState, outAction] = useActionState<ShiftActionState, FormData>(clockOutAction, { status: "idle" });
  const [startState, startAction] = useActionState<ShiftActionState, FormData>(startBreakAction, { status: "idle" });
  const [endState, endAction] = useActionState<ShiftActionState, FormData>(endBreakAction, { status: "idle" });
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const state = onShiftSince ? (onBreakSince ? endState : [startState, outState].find((x) => x.status !== "idle") ?? outState) : inState;
  return (
    <div className="flex flex-col gap-3">
      {!online && (
        <p role="status" className={errorNoteClass}>
          You&apos;re offline. Clocking in or out needs a connection.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className={errorNoteClass}>
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className={successNoteClass}>
          {state.message}
        </p>
      )}
      {onShiftSince && (
        <form action={onBreakSince ? endAction : startAction} className="flex flex-wrap items-center gap-4">
          <Tap label={onBreakSince ? "End break" : "Start break"} busy={onBreakSince ? "Ending…" : "Starting…"} offline={!online} />
          <span className="text-sm text-muted-foreground">{onBreakSince ? `On a break since ${onBreakSince}` : "Not on a break."}</span>
        </form>
      )}
      {onShiftSince ? (
        <form action={outAction} className="flex flex-wrap items-center gap-4">
          <Tap label="Clock out" busy="Clocking out…" offline={!online} />
          <span className="text-sm text-muted-foreground">On shift since {onShiftSince}</span>
        </form>
      ) : (
        <form action={inAction} className="flex flex-wrap items-center gap-4">
          <Tap label="Clock in" busy="Clocking in…" offline={!online} />
          <span className="text-sm text-muted-foreground">You are not on shift.</span>
        </form>
      )}
    </div>
  );
}
