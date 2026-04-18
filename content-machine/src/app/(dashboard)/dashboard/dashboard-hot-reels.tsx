"use client";

import { useState } from "react";
import Link from "next/link";
import { Flame, Sparkles } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { RecreateReelModal } from "@/app/(dashboard)/intelligence/components/recreate-reel-modal";

type Props = {
  reels: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
  disabledHint?: string | null;
};

function titleFor(reel: ScrapedReelRow): string {
  const h = (reel.hook_text || reel.caption || "").trim().replace(/\s+/g, " ");
  if (h.length > 48) return `${h.slice(0, 46)}…`;
  if (h.length > 0) return h;
  return `@${reel.account_username || "competitor"} reel`;
}

function ratioBadge(reel: ScrapedReelRow): string | null {
  const r = reel.trending_ratio;
  if (r == null || !Number.isFinite(Number(r))) return null;
  return `${Number(r).toFixed(1)}× their average`;
}

export function DashboardHotReels({ reels, clientSlug, orgSlug, disabled, disabledHint }: Props) {
  const [recreateRow, setRecreateRow] = useState<ScrapedReelRow | null>(null);
  const list = reels.slice(0, 6);

  return (
    <>
      <div className="glass glass-strong flex h-full min-h-[320px] flex-col rounded-2xl border border-app-card-border">
        <div className="flex items-center justify-between border-b border-app-divider px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-rose-500/15 p-1.5 text-rose-500 dark:text-rose-400">
              <Flame className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-app-fg">Heating up</h2>
              <p className="text-[10px] text-app-fg-muted">
                Competitor reels from the last 24h beating that account&apos;s usual reach — recreate in your client DNA
              </p>
            </div>
          </div>
          <Sparkles className="h-4 w-4 text-app-fg-faint" aria-hidden />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {list.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <p className="text-xs text-app-fg-muted">
                No fresh competitor breakouts in the last 24h. Sync to refresh, or browse Intelligence.
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
              {list.map((reel) => {
                const badge = ratioBadge(reel);
                return (
                  <li key={reel.id} className="flex items-center gap-2 px-3 py-2.5">
                    <ReelThumbnail
                      src={reel.thumbnail_url}
                      alt=""
                      href={reel.post_url}
                      className="h-11 w-11 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold text-app-fg-muted">
                        @{reel.account_username}
                      </p>
                      <p className="truncate text-xs font-medium text-app-fg">{titleFor(reel)}</p>
                      {badge ? (
                        <p className="mt-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {badge}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      title={disabledHint ?? undefined}
                      onClick={() => setRecreateRow(reel)}
                      className="shrink-0 rounded-md bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-bold text-app-on-amber-title hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      Recreate
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-app-divider px-4 py-2.5">
          <Link
            href="/intelligence"
            className="text-[11px] font-semibold text-app-accent hover:underline"
          >
            Intelligence — full feed
          </Link>
        </div>
      </div>

      <RecreateReelModal
        open={Boolean(recreateRow)}
        onClose={() => setRecreateRow(null)}
        reel={recreateRow}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </>
  );
}
