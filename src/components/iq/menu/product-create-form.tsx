"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { ReloadAppButton } from "@/components/reload-app-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { type CreateProductResult, createProductAction } from "@/lib/menu-admin/actions";

const IDLE: CreateProductResult = { ok: true };

const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-panel px-3 text-sm text-foreground transition-[border-color,box-shadow] duration-[120ms] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? "Creating…" : "Create draft"}
    </Button>
  );
}

/**
 * Creates a bare product as a draft, then hands off to the full editor —
 * asking for everything (pricing, modifiers, photos, availability) on one
 * screen before the product even exists is more form than a first save
 * needs.
 */
export function ProductCreateForm({
  categories,
  initialCategoryId,
}: {
  categories: readonly { id: string; name: string }[];
  initialCategoryId?: string;
}) {
  const router = useRouter();
  const action = (prev: CreateProductResult, formData: FormData) => recoverFromStaleDeployment(() => createProductAction(prev, formData));
  const [state, formAction] = useActionState<CreateProductResult, FormData>(action, IDLE);
  const isStale = !state.ok && state.error === STALE_DEPLOYMENT_MESSAGE;

  useEffect(() => {
    if (state.ok && state.id) router.push(`/app/iq/menu/products/${state.id}`);
  }, [state, router]);

  return (
    <Panel>
      <PanelHeader title="New product" description="Starts as a draft. Price, photos, modifiers and availability are set on the next screen." />
      <PanelBody>
        <form action={formAction} className="flex flex-col gap-4">
          {!state.ok && state.error && (
            <p role="alert" className="rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
              {state.error}
              {isStale && (
                <span className="mt-2 block">
                  <ReloadAppButton />
                </span>
              )}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="product-name" className="text-[13px] font-semibold">
                Name
              </Label>
              <Input id="product-name" name="name" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="product-slug" className="text-[13px] font-semibold">
                Slug
              </Label>
              <Input id="product-slug" name="slug" required pattern="[a-z0-9\-]+" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="product-category" className="text-[13px] font-semibold">
              Category
            </Label>
            <select id="product-category" name="categoryId" defaultValue={initialCategoryId ?? ""} className={selectClass}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Everything else defaults sensibly and is edited on the next screen. */}
          <input type="hidden" name="spiceLevel" value="0" />
          <input type="hidden" name="isVegetarian" value="" />

          <div>
            <Submit />
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
