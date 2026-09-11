import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { ModifierGroupForm } from "@/components/iq/menu/modifier-group-form";

export const metadata: Metadata = { title: "New modifier group — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewModifierGroupPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.edit"))) redirect("/app/iq/menu/modifiers");

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/modifiers" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Modifier groups
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">New modifier group</h1>
      <p className="mt-1 text-sm text-muted-foreground">Add its options after creating it. Saves as a draft until published.</p>
      <div className="mt-6">
        <ModifierGroupForm />
      </div>
    </div>
  );
}
