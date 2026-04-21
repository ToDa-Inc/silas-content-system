"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchReelMetricsSeries } from "@/lib/api-client";
import type { OwnReelsMetricPoint } from "@/lib/reel-types";

type Props = {
  clientSlug: string;
  orgSlug: string;
  reelId: string;
};

function formatCompactAbs(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return String(Math.round(abs));
}

function formatCompactDeltaSigned(n: number): string {
  if (n === 0) return "0";
  const body = formatCompactAbs(n);
  return n > 0 ? `+${body}` : `−${body}`;
}

function formatSnapshotWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function viewsSparklinePath(points: OwnReelsMetricPoint[]): string | null {
  const vals = points
    .map((p) => (p.views != null && Number.isFinite(Number(p.views)) ? Number(p.views) : null))
    .filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const pad = 2;
  const w = 100;
  const h = 28;
  const span = Math.max(maxV - minV, 1);
  const coords = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - minV) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${coords.join(" L ")}`;
}

export function ReelHistoryStrip({ clientSlug, orgSlug, reelId }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [snapCount, setSnapCount] = useState(0);
  const [points, setPoints] = useState<OwnReelsMetricPoint[]>([]);
  const [latestAt, setLatestAt] = useState<string | null>(null);
  const [competitorId, setCompetitorId] = useState<string | null>(null);
  const [d24, setD24] = useState<number | null>(null);
  const [d7, setD7] = useState<number | null>(null);

  const canFetch = Boolean(clientSlug.trim() && orgSlug.trim() && reelId.trim());

  useEffect(() => {
    if (!canFetch) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      const res = await fetchReelMetricsSeries(clientSlug, orgSlug, reelId);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setErr(res.error);
        setPoints([]);
        setSnapCount(0);
        setLatestAt(null);
        setCompetitorId(null);
        setD24(null);
        setD7(null);
        return;
      }
      const d = res.data;
      setPoints(d.points ?? []);
      setSnapCount(d.snapshot_count ?? (d.points?.length ?? 0));
      setLatestAt(d.latest_snapshot_at ?? null);
      setCompetitorId(d.competitor_id ?? null);
      setD24(d.views_delta_24h ?? null);
      setD7(d.views_delta_7d ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug, reelId]);

  const path = useMemo(() => viewsSparklinePath(points), [points]);
  const isOwn = competitorId == null;
  const muted = "text-zinc-500 dark:text-app-fg-muted";
  const label = "text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-app-fg-subtle";
  const chipPos = "text-emerald-700 dark:text-emerald-400";
  const chipNeg = "text-zinc-600 dark:text-zinc-400";
  const border =
    "rounded-lg border border-zinc-200/80 bg-zinc-100/50 dark:border-white/10 dark:bg-white/[0.04]";

  if (!canFetch) return null;

  return (
    <div className={`mt-4 space-y-2 p-3 ${border}`} aria-label="Engagement history">
      <p className={label}>Views over time</p>
      {loading ? (
        <div className={`flex items-center gap-2 text-[11px] ${muted}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Loading history…
        </div>
      ) : err ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-200/90" role="alert">
          {err}
        </p>
      ) : snapCount === 0 ? (
        <p className={`text-[11px] leading-snug ${muted}`}>
          No history yet — daily refresh adds the first snapshot point.
        </p>
      ) : snapCount === 1 ? (
        <p className={`text-[11px] leading-snug ${muted}`}>
          One measurement so far
          {latestAt ? ` (${formatSnapshotWhen(latestAt)})` : ""}. After the next refresh you will see
          a trend line and 24h / 7d view deltas.
        </p>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <svg
              className="h-8 min-w-[100px] flex-1 shrink-0 text-sky-600 dark:text-sky-400"
              viewBox="0 0 100 28"
              preserveAspectRatio="none"
              aria-hidden
            >
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <text x="4" y="16" className="fill-current text-[8px] opacity-70">
                  No view counts in snapshots
                </text>
              )}
            </svg>
            <div className="flex shrink-0 flex-col gap-1 text-[10px] tabular-nums">
              <span
                className={d24 != null ? (d24 > 0 ? chipPos : d24 < 0 ? chipNeg : muted) : muted}
                title="Views change vs snapshot at or before 24h before the latest scrape"
              >
                24h: {d24 != null ? formatCompactDeltaSigned(d24) : "—"}
              </span>
              <span
                className={d7 != null ? (d7 > 0 ? chipPos : d7 < 0 ? chipNeg : muted) : muted}
                title="Views change vs snapshot at or before 7d before the latest scrape"
              >
                7d: {d7 != null ? formatCompactDeltaSigned(d7) : "—"}
              </span>
            </div>
          </div>
          {latestAt ? (
            <p className={`text-[10px] ${muted}`}>Latest pull: {formatSnapshotWhen(latestAt)}</p>
          ) : null}
        </>
      )}
      {isOwn && snapCount > 0 ? (
        <p className="pt-0.5">
          <Link
            href={`/dashboard?focusReel=${encodeURIComponent(reelId)}`}
            className="text-[11px] font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
          >
            Open in metrics dashboard →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
