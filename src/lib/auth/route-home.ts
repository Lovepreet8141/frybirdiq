import "server-only";

/**
 * Where a signed-in person belongs.
 *
 * There are two sign-in forms on one auth system. Routing by *which form was
 * used* is what created a loop: the owner signing in at the customer form got
 * a valid session and was sent to /account, which requires a customers row they
 * do not have, which redirected back to the customer sign-in form, forever.
 *
 * So the destination is decided by what the account actually is, never by
 * where it signed in. Staff go to the counter, customers go to their account,
 * and an account that is neither is told so rather than bounced.
 */

import { getStaff } from "./index";
import { getCustomer } from "@/lib/customer";

export type Home =
  | { kind: "staff"; path: "/app/orders" }
  | { kind: "customer"; path: "/account" }
  | { kind: "neither"; path: null };

export async function resolveHome(): Promise<Home> {
  // Staff first: an owner who is also a customer should land on the counter,
  // because that is the side of the business they signed in to run.
  const staff = await getStaff();
  if (staff) return { kind: "staff", path: "/app/orders" };

  const customer = await getCustomer();
  if (customer) return { kind: "customer", path: "/account" };

  return { kind: "neither", path: null };
}
