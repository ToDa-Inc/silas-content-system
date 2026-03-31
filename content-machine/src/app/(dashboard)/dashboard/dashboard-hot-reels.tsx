import Link from "next/link";
import { Flame, TrendingUp } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { OwnReelGrowthItem } from "@/lib/api";

type Props = {
  items: OwnReelGrowthItem[];
};

function titleFor(item: OwnReelGrowthItem): string {
  const h = (item.hook_text || "").trim().replace(/\s+/g, " ");
  if (h.length > 48) return `${h.slice(0, 46)}…`;
  if (h.length > 0) return h;
  return "Your reel";
}

export function DashboardHotReels({ items }: Props) {
  const sorted = [...items].sort((a, b) => b.views_gained - a.views_gained).slice(0, 6);

  return (
    <div className="glass glass-strong flex h-full min-h-[320px] flex-col rounded-2xl border border-app-card-border">
      <div className="flex items-center justify-between border-b border-app-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-rose-500/15 p-1.5 text-rose-500 dark:text-rose-400">
            <Flame className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-app-fg">Heating up</h2>
            <p className="text-[10px] text-app-fg-muted">
              Your configured Instagram — largest view gains (latest vs prior snapshot)
            </p>
          </div>
        </div>
        <TrendingUp className="h-4 w-4 text-app-fg-faint" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {sorted.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <p className="text-xs text-app-fg-muted">
              No growth pulse yet — open Intelligence after a sync to compare snapshots.
            </p>
            <Link
              href="/intelligence"
              className="text-xs font-semibold text-app-accent underline-offset-2 hover:underline"
            >
              Open Intelligence
            </Link>
          </div>
        ) : (
          <ul className="max-h-[380px] flex-1 divide-y divide-app-divider overflow-y-auto">
            {sorted.map((item) => (
              <li key={item.reel_id}>
                <Link
                          href="/intelligence/reels"
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-100/60 dark:hover:bg-white/[0.04]"
                >
                  <ReelThumbnail
                    src={item.thumbnail_url}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-app-fg">
                      {titleFor(item)}
                    </p>
                    <p className="text-[10px] text-app-fg-muted">
                      +{item.views_gained.toLocaleString()} views
                      {item.views_now != null ? (
                        <span className="text-app-fg-subtle">
                          {" "}
                          · {item.views_now.toLocaleString()} now
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    +{item.views_gained >= 1000
                      ? `${(item.views_gained / 1000).toFixed(1)}k`
                      : item.views_gained}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-app-divider px-4 py-2.5">
        <Link
          href="/intelligence/reels"
          className="text-[11px] font-semibold text-app-accent hover:underline"
        >
          View all reels
        </Link>
      </div>
    </div>
  );
}
