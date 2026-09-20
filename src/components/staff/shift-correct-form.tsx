"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, errorNoteClass, inputClass, submitClass, successNoteClass } from "@/components/inventory/field";
import { type ShiftActionState, correctBreakAction, correctShiftAction } from "@/lib/shifts/actions";
import { SHIFT_NOTE_MAX } from "@/db/schema/shifts";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitClass}>
      {pending ? "Saving…" : "Save correction"}
    </button>
  );
}

/** A manager's correction of one shift. Times are Ambala time; a reason is required and audited. */
export function ShiftCorrectForm({ shiftId, clockIn, clockOut }: { shiftId: string; clockIn: string; clockOut: string }) {
  const [state, action] = useActionState<ShiftActionState, FormData>(correctShiftAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3 pt-2">
      <input type="hidden" name="shiftId" value={shiftId} />
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`in-${shiftId}`} label="Clock in (IST)">
          <input id={`in-${shiftId}`} name="clockIn" type="datetime-local" required defaultValue={clockIn} className={inputClass} />
        </Field>
        <Field id={`out-${shiftId}`} label="Clock out (IST)" hint="Leave empty to keep the shift open.">
          <input id={`out-${shiftId}`} name="clockOut" type="datetime-local" defaultValue={clockOut} className={inputClass} />
        </Field>
      </div>
      <Field id={`why-${shiftId}`} label="Reason">
        <input id={`why-${shiftId}`} name="reason" type="text" required maxLength={SHIFT_NOTE_MAX} className={inputClass} placeholder="Forgot to clock out" />
      </Field>
      <div className="flex justify-end">
        <Save />
      </div>
    </form>
  );
}

/** A manager's correction of one break's times, with a required, audited reason. */
export function BreakCorrectForm({ breakId, start, end }: { breakId: string; start: string; end: string }) {
  const [state, action] = useActionState<ShiftActionState, FormData>(correctBreakAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3 pt-2">
      <input type="hidden" name="breakId" value={breakId} />
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`bs-${breakId}`} label="Break start (IST)">
          <input id={`bs-${breakId}`} name="start" type="datetime-local" required defaultValue={start} className={inputClass} />
        </Field>
        <Field id={`be-${breakId}`} label="Break end (IST)" hint="Leave empty to keep the break open.">
          <input id={`be-${breakId}`} name="end" type="datetime-local" defaultValue={end} className={inputClass} />
        </Field>
      </div>
      <Field id={`br-${breakId}`} label="Reason">
        <input id={`br-${breakId}`} name="reason" type="text" required maxLength={SHIFT_NOTE_MAX} className={inputClass} />
      </Field>
      <div className="flex justify-end">
        <Save />
      </div>
    </form>
  );
}
