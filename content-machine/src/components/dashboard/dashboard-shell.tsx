"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ClientSwitcher, type ClientOption } from "./client-switcher";
import { MobileSidebar } from "./mobile-sidebar";
import { Sidebar } from "./sidebar";

/**
 * md+: two-column grid so main always starts top-right of the 220px rail.
 * Mobile: single column; menu button is fixed (out of grid flow).
 */
export function DashboardShell({
  children,
  clients = [],
  activeClientSlug = "",
  orgLabel = "",
}: {
  children: React.ReactNode;
  clients?: ClientOption[];
  activeClientSlug?: string;
  orgLabel?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const slug =
    activeClientSlug && clients.some((c) => c.slug === activeClientSlug)
      ? activeClientSlug
      : (clients[0]?.slug ?? "");

  return (
    <ToastProvider>
      <div className="grid min-h-svh w-full max-w-full grid-cols-1 bg-zinc-50 dark:bg-zinc-950 md:grid-cols-[220px_minmax(0,1fr)]">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="fixed left-4 top-4 z-[60] rounded-xl border border-zinc-200 bg-white/90 p-2.5 text-zinc-700 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-300 md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Sidebar clients={clients} activeSlug={slug} orgSlug={orgLabel} />
        <MobileSidebar
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          clients={clients}
          activeSlug={slug}
          orgSlug={orgLabel}
        />
        <div className="col-start-1 min-h-0 min-w-0 bg-zinc-50 pt-[3.25rem] text-zinc-900 max-md:min-h-svh dark:bg-zinc-950 dark:text-zinc-100 md:col-start-2 md:row-start-1 md:pt-0">
          {clients.length > 0 ? (
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-white/10 md:hidden">
              <ClientSwitcher clients={clients} activeSlug={slug} orgLabel={orgLabel} />
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
