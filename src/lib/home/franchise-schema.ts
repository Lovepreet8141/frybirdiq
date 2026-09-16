import { z } from "zod";

/**
 * Ported from frybird-web's src/lib/api/franchise.functions.ts. Split out
 * from franchise-actions.ts because a "use server" file may only export
 * async functions — a plain Zod schema can't live there, but both the
 * client form (for instant field errors) and the server action (for the
 * authoritative check) need the exact same one.
 */
export const franchiseInquirySchema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(80),
  city: z.string().trim().min(2, "Which city?").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{7,15}$/, "Enter a phone number we can call."),
  message: z.string().trim().max(1000).optional().default(""),
  // Honeypot: real visitors never see or fill this field. A bot filling
  // every input on the form fills this one too; a human never does.
  company: z.string().max(0).optional().default(""),
});

export type FranchiseInquiryInput = z.infer<typeof franchiseInquirySchema>;
