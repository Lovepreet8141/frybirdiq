import "server-only";

/**
 * The last delivery address used on this device.
 *
 * For guests, who have no account to save one against. Kept in a cookie
 * because it is the one store that cannot leak between people: it never leaves
 * the browser that wrote it, so unlike a lookup by phone number there is no
 * way to read someone else's doorstep by guessing their identity.
 *
 * Attacker-controlled like any cookie, so it is validated on read and the
 * server re-prices whatever comes back. A tampered cookie changes what its own
 * owner sees and nothing else.
 */

import { cookies } from "next/headers";
import { z } from "zod";

const COOKIE = "frybird_address";

const schema = z.object({
  line1: z.string().min(1).max(200),
  landmark: z.string().max(200).nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type RememberedAddress = z.infer<typeof schema>;

export async function readRememberedAddress(): Promise<RememberedAddress | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function rememberAddress(address: RememberedAddress): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(address), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
