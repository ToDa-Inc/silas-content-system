"use client";

import { useState } from "react";
import { MobileSidebar } from "./mobile-sidebar";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <TopBar onMenuClick={() => setMobileOpen(true)} />
      <Sidebar />
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="min-h-screen bg-surface-container-lowest pt-14 md:pl-[220px]">
        {children}
      </div>
    </>
  );
}
