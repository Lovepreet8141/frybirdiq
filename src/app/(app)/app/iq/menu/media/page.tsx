import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listMediaWithUsage } from "@/lib/repositories/media";
import { MediaLibrary } from "@/components/iq/menu/media-library";
import { PermissionDenied } from "@/components/states";

export const metadata: Metadata = { title: "Media library — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.edit"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage media" />
      </div>
    );
  }

  const items = await listMediaWithUsage(staff.orgId);

  return (
    <div className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">Media library</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload once, use on any product or category. Uploads only accept JPEG, PNG or WebP up to 8MB, and only an owner, admin or manager can upload or delete —
        the public site only ever gets read access. Search by product or category to find a photo, or filter to unused uploads to see what nothing is wearing.
      </p>
      <div className="mt-6">
        <MediaLibrary initialItems={items} />
      </div>
    </div>
  );
}
