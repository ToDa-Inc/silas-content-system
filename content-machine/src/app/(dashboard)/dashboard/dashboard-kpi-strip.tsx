import { Eye, Film, Heart } from "lucide-react";
import type { IntelligenceStatsRow } from "@/lib/api";

function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

type Props = {
  stats: IntelligenceStatsRow | null;
};

export function DashboardKpiStrip({ stats }: Props) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="glass group relative overflow-hidden rounded-2xl border border-app-card-border p-5 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
        <div className="absolute right-0 top-0 h-24 w-24 opacity-[0.07] blur-3xl transition-opacity group-hover:opacity-[0.11] amber-gradient" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
              Your reels stored
            </p>
            <p className="text-2xl font-bold tabular-nums tracking-tight text-app-fg">
              {stats ? stats.total_own_reels.toLocaleString() : "—"}
            </p>
            <p className="text-[11px] text-app-fg-muted">From your Instagram account</p>
          </div>
          <div className="rounded-xl bg-app-icon-btn-bg p-2.5 text-app-accent">
            <Film className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </div>

      <div className="glass group relative overflow-hidden rounded-2xl border border-app-card-border p-5 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
        <div className="absolute right-0 top-0 h-24 w-24 bg-teal-400 opacity-[0.06] blur-3xl transition-opacity group-hover:opacity-[0.1]" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
              Average views
            </p>
            <p className="text-2xl font-bold tabular-nums tracking-tight text-app-fg">
              {formatInt(stats?.average_views_last_30_reels ?? null)}
            </p>
            <p className="text-[11px] text-app-fg-muted">Across your latest reels</p>
          </div>
          <div className="rounded-xl bg-app-icon-btn-bg p-2.5 text-teal-500 dark:text-teal-400">
            <Eye className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </div>

      <div className="glass group relative overflow-hidden rounded-2xl border border-app-card-border p-5 transition-colors hover:bg-zinc-100/70 dark:hover:bg-white/[0.05]">
        <div className="relative flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-subtle">
              Average likes
            </p>
            <p className="text-2xl font-bold tabular-nums tracking-tight text-app-fg">
              {formatInt(stats?.average_likes_last_30_reels ?? null)}
            </p>
            <p className="text-[11px] text-app-fg-muted">Across your latest reels</p>
          </div>
          <div className="rounded-xl bg-app-icon-btn-bg p-2.5 text-rose-500 dark:text-rose-400">
            <Heart className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}
