"use client";

import Link, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

type Variant = "neutral" | "amber" | "purple";

type Pill = {
  href: string;
  label: string;
  active: boolean;
  variant?: Variant;
};

type Props = {
  pills: Pill[];
};

const ACTIVE_CLASS: Record<Variant, string> = {
  neutral: "rounded-lg bg-zinc-200 px-3 py-1.5 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
  amber: "rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-700 dark:text-amber-400",
  purple: "rounded-lg bg-purple-500/20 px-3 py-1.5 font-semibold text-purple-700 dark:text-purple-400",
};

const IDLE_CLASS = "rounded-lg px-3 py-1.5 text-app-fg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800";

/**
 * `useLinkStatus` (Next 15+) reports navigation pending state for the parent <Link>.
 * Renders a tiny spinner inline so the user gets visible feedback while the server
 * re-fetches the reels list with the new `source` filter — the work is server-side,
 * but the UI was previously silent during the round-trip.
 */
function PillSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      className="ml-1.5 inline h-3 w-3 shrink-0 animate-spin align-[-1px]"
      aria-hidden
    />
  );
}

export function SourceFilterPills({ pills }: Props) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {pills.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={p.active ? "page" : undefined}
          className={
            p.active ? ACTIVE_CLASS[p.variant ?? "neutral"] : IDLE_CLASS
          }
          prefetch={false}
        >
          {p.label}
          <PillSpinner />
        </Link>
      ))}
    </div>
  );
}
