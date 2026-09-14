import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A panel: white ground, one hairline, 12px corners, no shadow. Elevation on
 * the IQ surface comes from the panel sitting on the grey page, not from a
 * drop shadow — shadows are for things that float (dialogs, drawers).
 * The header is a 14/600 title with a quiet 13px meta line or action on
 * the right; content sits flush inside the same panel.
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card @container/card flex flex-col overflow-hidden rounded-xl border border-border bg-card text-sm text-card-foreground [--card-spacing:--spacing(5)] data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min content-center items-start gap-1 px-(--card-spacing) pt-(--card-spacing) pb-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] @max-md/card:flex @max-md/card:flex-wrap @max-md/card:[&:has(>[data-slot=card-title],>[data-slot=card-description])>*:not([data-slot=card-title]):not([data-slot=card-description]):not([data-slot=card-action])]:w-full",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-sm leading-snug font-semibold tracking-[-0.005em]",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn(
        "text-[13px] text-muted-foreground group-has-data-[slot=card-title]/card-header:@max-md/card:order-last group-has-data-[slot=card-title]/card-header:@max-md/card:w-full",
        className
      )}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-start-1 self-start justify-self-end text-[13px] text-muted-foreground group-has-data-[slot=card-description]/card-header:row-end-3 @max-md/card:ms-auto",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        "flex-1 px-(--card-spacing) py-(--card-spacing) group-has-data-[slot=card-header]/card:pt-0",
        className
      )}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-border px-(--card-spacing) py-3 text-[13px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
