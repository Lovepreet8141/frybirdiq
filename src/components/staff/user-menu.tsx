"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/domain/permissions";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * Who's signed in, and the one thing this menu can do: sign out.
 *
 * The sign-out itself is unchanged — still a real POST to
 * `/api/auth/sign-out` — only submitted through a hidden form via
 * `requestSubmit()` so the trigger can be a properly styled menu item
 * instead of a `<form>` awkwardly nested inside one.
 */
export function UserMenu({ displayName, roles }: { displayName: string | null; roles: readonly Role[] }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex items-center gap-2 rounded-full outline-none">
              <Avatar>
                <AvatarFallback>{initials(displayName)}</AvatarFallback>
              </Avatar>
              <span className="sr-only">Open account menu</span>
            </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex flex-col gap-0.5 px-1.5 py-1.5 text-left">
              <span className="truncate text-sm font-semibold">{displayName ?? "Staff"}</span>
              <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{roles.join(" · ")}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive" asChild>
              <button type="button" onClick={() => formRef.current?.requestSubmit()}>
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </button>
            </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={formRef} action="/api/auth/sign-out" method="POST" className="hidden" />
    </>
  );
}
