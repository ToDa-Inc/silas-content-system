"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { clientApiHeaders, getContentApiBase } from "@/lib/api-client";
import { slugify } from "@/lib/slug";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/cn";
import type { ClientOption } from "./client-switcher";

type Props = {
  clients: ClientOption[];
  /** Active slug from server (cookie + resolve). */
  activeSlug: string;
  orgSlug: string;
};

export function SidebarClientPanel({ clients, activeSlug, orgSlug }: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [busySwitch, setBusySwitch] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [instagram, setInstagram] = useState("");

  const effectiveSlug =
    activeSlug && clients.some((c) => c.slug === activeSlug) ? activeSlug : (clients[0]?.slug ?? "");
  const active = clients.find((c) => c.slug === effectiveSlug);

  async function switchClient(slug: string) {
    if (!slug || slug === effectiveSlug) return;
    setBusySwitch(true);
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
      setBusySwitch(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      show("Enter a name for this creator.", "error");
      return;
    }
    const s = slug.trim() || slugify(n);
    if (!s) {
      show("Enter a valid URL slug.", "error");
      return;
    }
    setBusyCreate(true);
    try {
      const apiBase = getContentApiBase();
      const ig = instagram.trim().replace(/^@/, "") || undefined;
      const r = await fetch(`${apiBase}/api/v1/clients`, {
        method: "POST",
        headers: {
          ...(await clientApiHeaders({ orgSlug })),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: s,
          name: n,
          instagram_handle: ig,
          language: "en",
          niche_config: [],
          icp: {},
          products: {},
        }),
      });
      if (!r.ok) {
        show("Couldn’t add creator — that name or slug may already exist.", "error");
        return;
      }
      const created = (await r.json()) as { slug: string };
      const setCookie = await fetch("/api/session/active-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: created.slug }),
      });
      if (!setCookie.ok) {
        show("Creator added — select them from the list.", "success");
      } else {
        show("Creator added and selected.", "success");
      }
      setName("");
      setSlug("");
      setInstagram("");
      setAddOpen(false);
      router.refresh();
    } finally {
      setBusyCreate(false);
    }
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Creator
        </p>
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          No creators in this workspace yet.
        </p>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add creator
        </button>
        {addOpen ? (
          <form onSubmit={(e) => void onCreate(e)} className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-white/10">
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (!slug.trim() && name.trim()) setSlug(slugify(name));
                }}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="Brand or creator name"
                required
              />
            </label>
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              URL slug
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="auto from name"
              />
            </label>
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Instagram (optional)
              <input
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="@handle"
              />
            </label>
            <button
              type="submit"
              disabled={busyCreate}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 text-xs font-bold text-zinc-950 disabled:opacity-50"
            >
              {busyCreate ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Create
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        Active creator
      </p>
      {active ? (
        <>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={active.name}>
            {active.name}
          </p>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={active.slug}>
            @{active.slug}
          </p>
        </>
      ) : null}

      <div className="relative mt-2">
        <select
          value={effectiveSlug}
          disabled={busySwitch}
          onChange={(e) => void switchClient(e.target.value)}
          className={cn(
            "w-full appearance-none rounded-lg border border-zinc-200 bg-white py-2 pl-2.5 pr-8 text-xs font-medium text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100",
            busySwitch && "opacity-60",
          )}
          aria-label="Switch creator"
        >
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        {busySwitch ? (
          <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-zinc-500" />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAddOpen((o) => !o)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-400"
        aria-expanded={addOpen}
        aria-controls="sidebar-add-creator-form"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add creator
      </button>

      {addOpen ? (
        <form
          id="sidebar-add-creator-form"
          onSubmit={(e) => void onCreate(e)}
          className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-white/10"
        >
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (!slug.trim() && name.trim()) setSlug(slugify(name));
                }}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="New brand or creator"
                required
              />
            </label>
            <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              URL slug
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="auto from name"
              />
            </label>
          <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Instagram (optional)
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
              placeholder="@handle"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busyCreate}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 text-xs font-bold text-zinc-950 disabled:opacity-50"
            >
              {busyCreate ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false);
                setName("");
                setSlug("");
                setInstagram("");
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-white/10 dark:text-zinc-400"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
