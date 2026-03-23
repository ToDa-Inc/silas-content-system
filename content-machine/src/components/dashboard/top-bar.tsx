"use client";

import Image from "next/image";
import { Bell, Menu } from "lucide-react";

type TopBarProps = {
  onMenuClick?: () => void;
};

export function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="fixed top-0 z-50 flex h-14 w-full items-center justify-between border-b border-zinc-800/50 bg-zinc-950/80 px-4 backdrop-blur-xl md:pl-[220px] md:pr-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 md:hidden"
          aria-label="Open menu"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-xl font-bold tracking-tighter text-zinc-50">
          Silas Prism
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-full p-2 text-zinc-400 transition-all hover:bg-zinc-900"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <div className="h-8 w-8 overflow-hidden rounded-full border border-outline-variant/20 bg-surface-container-highest">
          <Image
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBtAphDS67xjAt5V_2LuBCyHUk-FAc-lKTx_E1gSlYL9NDBkpC3mcUOF4q0Do6AS-K4jWIe1bTNXJvdzynZidJBsn6jNjoFCpNRQPQkeV-7rJjerhUi5O_bqQqfMT3CXZ1h2knDL3iYQgONv9FvbBkmVmLrKM5xdkP2q0Jnv8Dns55cRA8gIkb7xBBSDMdCfTORvGQb1EcAIxGaUovTh3wyXYeIJrzlkTBRfMEpDORLCC8fjCUnBtdX3f2jU-UD1XMNp2uEOYJmVdnl"
            alt=""
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
