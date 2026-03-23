"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { mainNav } from "./nav";

type SidebarProps = {
  onNavigate?: () => void;
  /** Inside mobile drawer — not fixed, always flex */
  embedded?: boolean;
};

export function Sidebar({ onNavigate, embedded }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "z-40 flex h-screen w-[220px] flex-col border-r border-zinc-800/20 bg-zinc-950 px-4 py-6",
        embedded
          ? "relative"
          : "fixed left-0 top-0 hidden md:flex",
      )}
    >
      <div className="mb-10 mt-12 flex items-center gap-3 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg amber-gradient text-on-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <div className="text-lg font-extrabold leading-none text-zinc-50">
            Silas Prism
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">
            Content Automation
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {mainNav.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-200",
                active
                  ? "translate-x-0.5 bg-amber-900/10 font-medium text-amber-400"
                  : "text-zinc-500 hover:translate-x-1 hover:bg-zinc-900",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-zinc-800/20 pt-6">
        <button
          type="button"
          className="mb-4 w-full rounded-xl bg-primary-container py-2.5 text-[13px] font-bold text-on-primary-container shadow-lg shadow-amber-500/10 transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          New Project
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-900"
        >
          <Users className="h-[18px] w-[18px] shrink-0" aria-hidden />
          Client Selector
        </button>
      </div>
    </aside>
  );
}
