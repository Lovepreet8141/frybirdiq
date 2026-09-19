/**
 * The one-tap reasons for closing the shop (owner requirement 1, Release 2).
 *
 * In an emergency nobody types: the person taps a reason, and that tap is the
 * second tap of "two-tap close" (tap the switch, tap a reason). A free-text
 * note is optional. The stored reason is one string — "Too busy" or
 * "Too busy: two riders off" — because the audit row and the other till read a
 * string. Pure: shared by the POS switch, Admin → Restaurant and the action.
 */

export const PAUSE_REASON_PRESETS = ["Too busy", "Out of stock", "Equipment problem", "Staff shortage", "Other"] as const;
export type PauseReasonPreset = (typeof PAUSE_REASON_PRESETS)[number];

/** Free text is optional and staff-only; the total with the preset stays inside the 200-character column rule. */
export const PAUSE_NOTE_MAX = 150;

export function composePauseReason(preset: PauseReasonPreset, note: string | undefined): string {
  const trimmed = (note ?? "").trim();
  return trimmed ? `${preset}: ${trimmed}` : preset;
}

/** Null when fine; the message otherwise. The preset is never optional, the note always is. */
export function noteProblem(note: string): string | null {
  return note.trim().length > PAUSE_NOTE_MAX ? `Keep the note under ${PAUSE_NOTE_MAX} characters.` : null;
}
