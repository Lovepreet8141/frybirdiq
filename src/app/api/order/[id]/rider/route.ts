import { NextResponse } from "next/server";
import { riderViewForViewer } from "@/lib/order/rider-view";

export const dynamic = "force-dynamic";

/**
 * Where this order's rider is right now, for the customer's tracking page (Lane B). Who may ask, and what they may be told, is
 * decided in `riderViewForViewer`: the person who placed the order gets the newest fix while the order is out; everyone else, and
 * every unknown or malformed id, gets the same empty 404. Never cached.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;
  const body = await riderViewForViewer(id);
  if (!body) return new NextResponse(null, { status: 404, headers });
  return NextResponse.json(body, { headers });
}
