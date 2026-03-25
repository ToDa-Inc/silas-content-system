"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clientApiHeaders, contentApiFetch, getContentApiBase } from "@/lib/api-client";
import type { ScrapedReelRow } from "@/lib/api";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { ReelCardWithAnalysis } from "./reel-card-with-analysis";
import { ReelEngagementInline } from "./reel-engagement-inline";

const STORAGE_KEY = "silas_intel_last_visit";

type OwnReelGrowth = {
  reel_id: string;
  views_gained: number;
  views_now: number;
  post_url?: string | null;
  thumbnail_url?: string | null;
  hook_text?: string | null;
  caption?: string | null;
  account_username?: string | null;
  likes?: number | null;
  comments?: number | null;
};

type ActivityPayload = {
  since: string;
  new_breakout_reels: ScrapedReelRow[];
  own_reel_growth: OwnReelGrowth[];
  is_quiet: boolean;
};

type Props = {
  clientSlug: string;
  orgSlug: string;
  disabled?: boolean;
};

export function WhatHappenedSection({ clientSlug, orgSlug, disabled }: Props) {
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (disabled || !clientSlug.trim() || !orgSlug.trim()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const prev = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const apiBase = getContentApiBase();
        const headers = await clientApiHeaders({ orgSlug });
        const q = prev ? `?since=${encodeURIComponent(prev)}` : "";
        const res = await contentApiFetch(`${apiBase}/api/v1/clients/${clientSlug}/activity${q}`, {
          headers,
        });
        if (!res.ok) {
          const t = await res.text();
          if (!cancelled) setErr(t.slice(0, 200));
          return;
        }
        const json = (await res.json()) as ActivityPayload;
        if (!cancelled) setData(json);
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, new Date().toISOString());
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug, disabled]);

  if (disabled || !clientSlug.trim()) {
    return null;
  }

  if (loading) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-app-fg">What happened</h2>
        <div className="glass animate-pulse rounded-xl px-5 py-8 text-xs text-app-fg-muted">Loading…</div>
      </section>
    );
  }

  if (err) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-app-fg">What happened</h2>
        <p className="text-xs text-app-fg-muted">{err}</p>
      </section>
    );
  }

  const quiet = !data?.new_breakout_reels?.length && !data?.own_reel_growth?.length;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-app-fg">What happened</h2>
      <p className="mb-3 text-[11px] text-app-fg-subtle">
        Since your last visit — your reel momentum and competitor reels that popped.
      </p>
      {quiet ? (
        <div className="glass rounded-xl px-5 py-6 text-sm text-app-fg-muted">
          Everything&apos;s up to date. Sync to pull the latest numbers.
        </div>
      ) : (
        <div className="space-y-6">
          {(data?.own_reel_growth?.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">
                Your reels gaining traction
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data!.own_reel_growth!.map((g) => (
                  <div
                    key={g.reel_id}
                    className="flex gap-3 rounded-xl border border-zinc-200/90 bg-zinc-50/95 p-3 dark:border-white/10 dark:bg-zinc-950/75"
                  >
                    <ReelThumbnail
                      src={g.thumbnail_url}
                      alt="Your reel"
                      href={g.post_url}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        +{g.views_gained.toLocaleString()} views since last visit
                      </p>
                      <p className="mt-0.5 text-[10px] text-app-fg-subtle">
                        Now {g.views_now.toLocaleString()} total views
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-app-fg-muted">
                        {g.hook_text || g.caption || "—"}
                      </p>
                      <ReelEngagementInline
                        className="mt-2"
                        views={g.views_now}
                        likes={g.likes}
                        comments={g.comments}
                      />
                      {g.post_url ? (
                        <a
                          href={g.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          Open ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(data?.new_breakout_reels?.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-app-fg-subtle">
                Competitor breakouts
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data!.new_breakout_reels!.slice(0, 8).map((r) => (
                  <ReelCardWithAnalysis
                    key={r.id}
                    row={r}
                    clientSlug={clientSlug}
                    orgSlug={orgSlug}
                  >
                    <div className="relative shrink-0">
                      <ReelThumbnail
                        src={r.thumbnail_url}
                        alt={`@${r.account_username} reel`}
                        href={r.post_url}
                        size="md"
                      />
                      {r.outlier_ratio != null ? (
                        <span className="absolute -right-1 -top-1 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-zinc-950 shadow">
                          {Number(r.outlier_ratio).toFixed(1)}× avg
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-app-fg">@{r.account_username}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-app-fg-muted">
                        {r.hook_text || r.caption || "—"}
                      </p>
                      <ReelEngagementInline
                        className="mt-2"
                        views={r.views}
                        likes={r.likes}
                        comments={r.comments}
                      />
                      {r.competitor_id ? (
                        <Link
                          href={`/intelligence/reels?competitor=${encodeURIComponent(r.competitor_id)}`}
                          className="mt-2 inline-block text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          More from this account →
                        </Link>
                      ) : null}
                      {r.post_url ? (
                        <a
                          href={r.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-block text-[10px] font-semibold text-app-fg-muted hover:underline"
                        >
                          Instagram ↗
                        </a>
                      ) : null}
                    </div>
                  </ReelCardWithAnalysis>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
