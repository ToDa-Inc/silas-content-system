"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";

export type ClientOption = { slug: string; name: string };

type Props = {
  clients: ClientOption[];
  activeSlug: string;
  orgLabel: string;
};

export function ClientSwitcher({ clients, activeSlug, orgLabel }: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  if (clients.length === 0) {
    return null;
  }

  async function onChange(slug: string) {
    if (!slug || slug === activeSlug) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/session/active-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!r.ok) {
        show("Couldn’t switch creator — try again.", "error");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        <Users className="h-3.5 w-3.5" aria-hidden />
        {orgLabel ? <span className="text-zinc-500">@{orgLabel}</span> : null}
      </span>
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Creator</span>
        <div className="relative">
          <select
            value={activeSlug && clients.some((c) => c.slug === activeSlug) ? activeSlug : clients[0]!.slug}
            disabled={busy}
            onChange={(e) => void onChange(e.target.value)}
            className="appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.slug})
              </option>
            ))}
          </select>
          {busy ? (
            <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-zinc-500" />
          ) : null}
        </div>
      </label>
    </div>
  );
}
