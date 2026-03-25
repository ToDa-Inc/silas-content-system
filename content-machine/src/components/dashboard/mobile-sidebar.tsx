"use client";

import { X } from "lucide-react";
import type { ClientOption } from "./client-switcher";
import { Sidebar } from "./sidebar";

type MobileSidebarProps = {
  open: boolean;
  onClose: () => void;
  clients?: ClientOption[];
  activeSlug?: string;
  orgSlug?: string;
};

export function MobileSidebar({
  open,
  onClose,
  clients = [],
  activeSlug = "",
  orgSlug = "",
}: MobileSidebarProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 left-0 z-50 flex h-svh w-[220px] flex-col shadow-2xl md:hidden">
        <button
          type="button"
          className="absolute right-2 top-3 z-10 rounded-lg p-2 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-900"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar
          embedded
          onNavigate={onClose}
          clients={clients}
          activeSlug={activeSlug}
          orgSlug={orgSlug}
        />
      </div>
    </>
  );
}
