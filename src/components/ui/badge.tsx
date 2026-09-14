import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Pills. Sentence case, 12px semibold, a soft field. Meaning comes from the
 * IQ signal tokens — gain, loss, flag — never from a Tailwind colour; and
 * a pill never carries a state on its own: pair it with a word.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-inverse text-inverse-foreground [a]:hover:bg-inverse/85",
        secondary: "bg-muted text-foreground [a]:hover:bg-muted/70",
        outline: "border-border text-foreground [a]:hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
        success: "bg-gain-soft text-gain [a&]:hover:bg-gain-soft/70",
        destructive: "bg-loss-soft text-loss [a&]:hover:bg-loss-soft/70",
        warning: "bg-flag-soft text-flag [a&]:hover:bg-flag-soft/70",
        info: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/70",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
