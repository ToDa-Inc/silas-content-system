"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/cn";
import { mainNav } from "./nav";
import { SignOutButton } from "./sign-out-button";
import { SidebarClientPanel } from "./sidebar-client-panel";
import { ThemeToggle } from "./theme-toggle";
import type { ClientOption } from "./client-switcher";

type SidebarProps = {
  onNavigate?: () => void;
  /** Inside mobile drawer — scrollable column, not sticky */
  embedded?: boolean;
  clients?: ClientOption[];
  activeSlug?: string;
  orgSlug?: string;
};

export function Sidebar({
  onNavigate,
  embedded,
  clients = [],
  activeSlug = "",
  orgSlug = "",
}: SidebarProps) {
  const pathname = usePathname();
  const { show } = useToast();

  return (
    <aside
      className={cn(
        "z-40 flex w-[220px] flex-col border-r border-zinc-200/80 bg-white/90 px-4 py-4 backdrop-blur-md dark:border-app-card-border dark:bg-zinc-950/95",
        embedded
          ? "relative flex h-full min-h-0 flex-col"
          : "hidden md:sticky md:top-0 md:flex md:h-svh md:shrink-0 md:self-start",
      )}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-zinc-950">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </div>
          <span className="truncate text-sm font-semibold text-app-fg">
            Silas
          </span>
        </div>
        <ThemeToggle />
      </div>

      <nav
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden py-1"
        aria-label="Main navigation"
      >
        {mainNav.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              prefetch
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-r-lg border-l-2 border-transparent py-2 pl-3 pr-2 text-[13px] font-medium",
                active
                  ? "border-amber-500 bg-amber-500/12 text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-zinc-600 hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-app-fg-subtle dark:hover:bg-white/[0.06] dark:hover:text-app-fg-secondary",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 space-y-1 border-t border-zinc-200 pt-4 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={() =>
            show("Projects aren’t multi-tenant yet — everything uses your current workspace.", "success")
          }
          className="mb-1 w-full rounded-xl bg-amber-500 py-2.5 text-[13px] font-semibold text-zinc-950 shadow-lg shadow-amber-500/15 transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          New project
        </button>
        <SidebarClientPanel clients={clients} activeSlug={activeSlug} orgSlug={orgSlug} />
        <SignOutButton className="w-full justify-start" />
      </div>
    </aside>
  );
}
