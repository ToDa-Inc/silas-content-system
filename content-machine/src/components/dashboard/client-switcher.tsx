"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { useToast } from "@/components/ui/toast-provider";
import { invalidateApiContext } from "@/lib/api-client";

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
      invalidateApiContext();
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
      <div className="relative flex items-end gap-2">
        <AppSelect
          label="Creator"
          value={
            activeSlug && clients.some((c) => c.slug === activeSlug) ? activeSlug : clients[0]!.slug
          }
          disabled={busy}
          onChange={(slug) => void onChange(slug)}
          options={clients.map((c) => ({
            value: c.slug,
            label: `${c.name} (${c.slug})`,
          }))}
          triggerClassName="min-w-[200px] py-1.5 text-xs font-semibold"
        />
        {busy ? (
          <Loader2 className="mb-1 h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" aria-hidden />
        ) : null}
      </div>
    </div>
  );
}
