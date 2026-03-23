"use client";

import { X } from "lucide-react";
import { Sidebar } from "./sidebar";

type MobileSidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 left-0 z-50 w-[220px] shadow-2xl md:hidden">
        <button
          type="button"
          className="absolute right-2 top-14 z-10 rounded-lg p-2 text-zinc-400 hover:bg-zinc-900"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar embedded onNavigate={onClose} />
      </div>
    </>
  );
}
