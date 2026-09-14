import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A text input at the IQ density: 40px tall, panel ground, one hairline,
 * the 3px brand focus ring, and a red-ink border with a soft ring when the
 * value is invalid (design-system/MASTER.md §5 "Inputs").
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-panel px-3 py-1 text-base text-foreground transition-[border-color,box-shadow] duration-[120ms] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/15 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
