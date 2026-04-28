"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchOwnReelsMetrics } from "@/lib/api-client";
import type { OwnReelsMetricsSeries } from "@/lib/reel-types";

const LINE_COLORS_LIGHT = [
  "#b45309",
  "#0f766e",
  "#6d28d9",
  "#be185d",
  "#1d4ed8",
  "#a16207",
  "#047857",
  "#c2410c",
] as const;

const LINE_COLORS_DARK = [
  "#fbbf24",
  "#2dd4bf",
  "#a78bfa",
  "#f472b6",
  "#60a5fa",
  "#facc15",
  "#34d399",
  "#fb923c",
] as const;

/** Backend page size for collecting every reel in the selected publication-date window. */
const BACKEND_REELS_PAGE_LIMIT = 100;
/** Reels shown per UI page, ranked best to worst by the selected metric. */
const REELS_PER_PAGE = 20;

type MetricKey = "views" | "likes" | "comments";
type ChartKind = "line" | "area" | "bars";
type YScale = "linear" | "log";
/** Presets and custom both filter by reel publication date (scraped_reels.posted_at). */
type PresetTimeRange = "30d" | "90d" | "all";
type TrendTimeRange = PresetTimeRange | "custom";

type ChartRow = Record<string, string | number | null | undefined>;
type BarRow = {
  name: string;
  v: number;
  fill: string;
  postUrl?: string | null;
};

const IG_POST_PATH = /instagram\.com\/(?:reel|reels|p|tv)\/([^/?#]+)/i;

/** Legend label from synced data only — no synthetic titles. */
function reelDisplayLabel(r: OwnReelsMetricsSeries): string {
  const hook = (r.hook_text || "").trim().replace(/\s+/g, " ");
  if (hook.length > 28) return `${hook.slice(0, 26)}…`;
  if (hook.length > 0) return hook;
  const url = (r.post_url || "").trim();
  const m = url.match(IG_POST_PATH);
  if (m?.[1]) return m[1].length > 22 ? `${m[1].slice(0, 20)}…` : m[1];
  if (url.length > 0) return url.length > 28 ? `${url.slice(0, 26)}…` : url;
  return r.reel_id.length >= 8 ? `id:${r.reel_id.slice(0, 8)}…` : r.reel_id;
}

function metricAtPoint(
  p: OwnReelsMetricsSeries["points"][number],
  m: MetricKey,
): number | null {
  const v = p[m];
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function latestMetricValue(r: OwnReelsMetricsSeries, m: MetricKey): number {
  const pts = r.points;
  if (!pts.length) return 0;
  for (let i = pts.length - 1; i >= 0; i--) {
    const v = metricAtPoint(pts[i], m);
    if (v !== null) return v;
  }
  return 0;
}

function openInstagramReel(postUrl: string | null | undefined): void {
  const url = (postUrl || "").trim();
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Default custom range: last 30 days before today, scoped to local YYYY-MM-DD. */
function defaultCustomBounds(): { from: string; to: string } {
  const now = new Date();
  const fromD = new Date(now.getTime() - 30 * MS_PER_DAY);
  return { from: toYmdLocal(fromD), to: toYmdLocal(now) };
}

/**
 * Translate the active time-range UI control into ISO bounds on
 * scraped_reels.posted_at for the metrics endpoint. Returns undefined fields
 * when no bound applies.
 */
function postedBoundsForRequest(
  range: TrendTimeRange,
  customFromYmd: string,
  customToYmd: string,
): { postedAfter?: string; postedBefore?: string } {
  if (range === "all") return {};
  if (range === "custom") {
    if (!customFromYmd && !customToYmd) return {};
    let startMs = customFromYmd ? new Date(`${customFromYmd}T00:00:00`).getTime() : Number.NaN;
    let endMs = customToYmd ? new Date(`${customToYmd}T23:59:59.999`).getTime() : Number.NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs) {
      [startMs, endMs] = [endMs, startMs];
    }
    return {
      postedAfter: Number.isFinite(startMs) ? new Date(startMs).toISOString() : undefined,
      postedBefore: Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined,
    };
  }
  const days = range === "30d" ? 30 : 90;
  return {
    postedAfter: new Date(Date.now() - days * MS_PER_DAY).toISOString(),
  };
}

/** Loaded reels that have at least one valid point for the chosen metric. */
function pickSeries(
  reels: OwnReelsMetricsSeries[],
  m: MetricKey,
): OwnReelsMetricsSeries[] {
  return reels.filter((r) => r.points.some((p) => metricAtPoint(p, m) !== null));
}

/**
 * Merge series onto a shared time axis using “as-of” values: at each snapshot time, each reel shows
 * its latest known metric at or before that time. Keeps lines continuous across staggered syncs
 * (no sparse nulls that fragment strokes in Recharts).
 */
function buildMergedRows(
  series: OwnReelsMetricsSeries[],
  m: MetricKey,
): { rows: ChartRow[]; dataKeys: string[]; labels: string[] } {
  const times = new Set<string>();
  for (const r of series) {
    for (const p of r.points) {
      times.add(p.scraped_at);
    }
  }
  const sortedT = [...times].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  const dataKeys = series.map((_, i) => `s${i}`);
  const labels = series.map((r) => reelDisplayLabel(r));

  const sortedPoints = series.map((r) =>
    [...r.points].sort(
      (a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime(),
    ),
  );

  const rows: ChartRow[] = sortedT.map((t) => {
    const short = formatTickDate(t);
    const row: ChartRow = { t, tShort: short };
    const tMs = new Date(t).getTime();
    sortedPoints.forEach((points, i) => {
      let last: number | null = null;
      for (const p of points) {
        if (new Date(p.scraped_at).getTime() > tMs) break;
        const v = metricAtPoint(p, m);
        if (v !== null) last = v;
      }
      row[dataKeys[i]] = last;
    });
    return row;
  });

  return { rows, dataKeys, labels };
}

function formatTickDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** X-axis: include time so same-day syncs don’t collapse; readable on dark backgrounds. */
function formatXAxisTick(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatTooltipWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatAxisNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** IG CDN URLs 403 without auth; route through same-origin proxy so tokens survive. */
function proxiedThumbSrc(raw: string | null | undefined): string {
  const t = (raw || "").trim();
  if (!t) return "";
  try {
    const h = new URL(t).hostname.toLowerCase();
    if (h.endsWith(".cdninstagram.com") || h.endsWith(".fbcdn.net")) {
      return `/api/thumbnail-proxy?url=${encodeURIComponent(t)}`;
    }
  } catch {
    /* leave as-is */
  }
  return t;
}

type Props = {
  clientSlug: string;
  orgSlug: string;
  /** When set (e.g. from `/dashboard?focusReel=`), ensure this reel stays visible on first load. */
  focusReelId?: string;
};

type ReelPickerProps = {
  series: OwnReelsMetricsSeries[];
  labels: string[];
  colors: readonly string[];
  metric: MetricKey;
  hidden: Set<string>;
  onToggle: (reelId: string) => void;
};

function ReelPickerStrip({ series, labels, colors, metric, hidden, onToggle }: ReelPickerProps) {
  if (series.length === 0) return null;
  return (
    <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {series.map((r, i) => {
        const color = colors[i % colors.length];
        const isHidden = hidden.has(r.reel_id);
        const latest = latestMetricValue(r, metric);
        return (
          <button
            key={r.reel_id}
            type="button"
            onClick={() => onToggle(r.reel_id)}
            title={isHidden ? "Show this reel" : "Hide this reel"}
            className={`group flex shrink-0 items-center gap-2 rounded-xl border bg-app-chip-bg px-2 py-1.5 text-left transition-colors hover:bg-app-chip-bg-hover ${
              isHidden ? "opacity-40" : ""
            }`}
            style={{ borderColor: color, borderLeftWidth: 3 }}
          >
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-app-chip-bg-hover">
              {r.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- IG via proxy
                <img
                  src={proxiedThumbSrc(r.thumbnail_url)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="max-w-[140px] truncate text-[11px] font-medium text-app-fg">
                {labels[i]}
              </span>
              <span className="text-[10px] font-semibold text-app-fg-muted">
                {formatAxisNumber(latest)} {metric}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type ThumbTooltipProps = {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | string | null | undefined; color?: string }>;
  series: OwnReelsMetricsSeries[];
  dataKeys: string[];
  labels: string[];
  metric: MetricKey;
  containerStyle: CSSProperties;
  labelStyle: CSSProperties;
};

function ThumbnailTooltip({
  active,
  payload,
  series,
  dataKeys,
  labels,
  metric,
  containerStyle,
  labelStyle,
}: ThumbTooltipProps) {
  if (!active || !payload?.length) return null;
  const rowT = (payload[0] as unknown as { payload?: { t?: string } })?.payload?.t;
  return (
    <div style={containerStyle}>
      <div style={labelStyle}>{rowT ? formatTooltipWhen(rowT) : ""}</div>
      <div className="flex flex-col gap-1.5">
        {payload
          .filter((p) => p.value != null && p.value !== "")
          .map((p) => {
            const i = dataKeys.indexOf(p.dataKey);
            if (i < 0) return null;
            const reel = series[i];
            return (
              <div key={p.dataKey} className="flex items-center gap-2">
                <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded" style={{ boxShadow: `inset 0 0 0 2px ${p.color}` }}>
                  {reel?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- IG via proxy
                    <img
                      src={proxiedThumbSrc(reel.thumbnail_url)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{labels[i]}</span>
                <span className="shrink-0 text-[11px] font-semibold" style={{ color: p.color }}>
                  {formatAxisNumber(Number(p.value))} {metric}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function OwnReelMetricsDashboard({ clientSlug, orgSlug, focusReelId }: Props) {
  const { resolvedTheme } = useTheme();
  const appliedFocusKey = useRef<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("views");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [timeRange, setTimeRange] = useState<TrendTimeRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  /** Reels in the selected publication-date window, newest first. */
  const [raw, setRaw] = useState<OwnReelsMetricsSeries[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hiddenReelIds, setHiddenReelIds] = useState<Set<string>>(new Set());
  const [yScale, setYScale] = useState<YScale>("linear");
  const [currentPage, setCurrentPage] = useState(0);
  /** Server-reported total reels matching the current posted-date filters. */
  const [total, setTotal] = useState<number>(0);
  const canFetch = Boolean(clientSlug.trim() && orgSlug.trim());
  const [loading, setLoading] = useState(canFetch);

  // Track the request bound key so a slow first-page response from a previous
  // filter can never overwrite a fresher one.
  const requestKeyRef = useRef<string>("");
  const buildRequestKey = (
    cs: string,
    os: string,
    range: TrendTimeRange,
    cf: string,
    ct: string,
  ) => `${cs}|${os}|${range}|${cf}|${ct}`;

  // Date-window fetch: replace the shown reels whenever the publication-date
  // range changes. There is no pagination; the date range is the selection tool.
  useEffect(() => {
    if (!canFetch) {
      setRaw(null);
      setTotal(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const key = buildRequestKey(clientSlug, orgSlug, timeRange, customFrom, customTo);
    requestKeyRef.current = key;
    setLoading(true);
    setErr(null);
    queueMicrotask(() => {
      if (cancelled) return;
      void (async () => {
        const bounds = postedBoundsForRequest(timeRange, customFrom, customTo);
        const allReels: OwnReelsMetricsSeries[] = [];
        let nextOffset = 0;
        let nextTotal = 0;
        let hasMore = true;

        while (hasMore) {
          const res = await fetchOwnReelsMetrics(clientSlug, orgSlug, {
            limit: BACKEND_REELS_PAGE_LIMIT,
            offset: nextOffset,
            postedAfter: bounds.postedAfter,
            postedBefore: bounds.postedBefore,
          });
          if (cancelled || requestKeyRef.current !== key) return;
          if (!res.ok) {
            setErr(res.error);
            setRaw(null);
            setTotal(0);
            setLoading(false);
            return;
          }
          allReels.push(...res.data.reels);
          nextTotal = res.data.total;
          hasMore = res.data.has_more && res.data.reels.length > 0;
          nextOffset += res.data.reels.length;
        }

        if (cancelled || requestKeyRef.current !== key) return;
        setRaw(allReels);
        setTotal(nextTotal);
        setLoading(false);
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug, timeRange, customFrom, customTo]);

  useEffect(() => {
    appliedFocusKey.current = null;
  }, [clientSlug, orgSlug, focusReelId]);

  useEffect(() => {
    setCurrentPage(0);
  }, [clientSlug, orgSlug, timeRange, customFrom, customTo, metric]);

  useEffect(() => {
    const fid = focusReelId?.trim();
    if (!raw?.length || !fid) return;
    const match = raw.some((r) => r.reel_id === fid);
    if (!match) return;
    const key = `${clientSlug}:${orgSlug}:${fid}`;
    if (appliedFocusKey.current === key) return;
    appliedFocusKey.current = key;
    setHiddenReelIds((prev) => {
      if (!prev.has(fid)) return prev;
      const next = new Set(prev);
      next.delete(fid);
      return next;
    });
  }, [raw, focusReelId, clientSlug, orgSlug]);

  // Custom range default: prefill from/to (last 30 days) when user picks "Custom"
  // without typing dates. Independent of the loaded dataset since we now filter
  // by reel posted_at, not by snapshot times.
  useEffect(() => {
    if (timeRange !== "custom") return;
    if (customFrom && customTo) return;
    const d = defaultCustomBounds();
    if (d.from && d.to) {
      setCustomFrom(d.from);
      setCustomTo(d.to);
    }
  }, [timeRange, customFrom, customTo]);

  // Reset manual hidden state whenever the active ranked page changes.
  useEffect(() => {
    setHiddenReelIds(new Set());
  }, [clientSlug, orgSlug, timeRange, customFrom, customTo, metric, currentPage]);

  // Prune stale hidden IDs (reels no longer in dataset, e.g. after a filter switch).
  useEffect(() => {
    if (!raw) return;
    setHiddenReelIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(raw.map((r) => r.reel_id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [raw]);

  const toggleReelVisibility = (reelId: string) => {
    setHiddenReelIds((prev) => {
      const next = new Set(prev);
      if (next.has(reelId)) next.delete(reelId);
      else next.add(reelId);
      return next;
    });
  };

  const isDark = resolvedTheme !== "light";
  const tickFill = isDark ? "#e4e4e7" : "#3f3f46";
  const axisLineStroke = isDark ? "rgba(244,244,245,0.4)" : "rgba(24,24,27,0.35)";
  const gridColor = isDark ? "rgba(244,244,245,0.1)" : "rgba(24,24,27,0.08)";
  const lineColors = isDark ? LINE_COLORS_DARK : LINE_COLORS_LIGHT;

  const chartMargin = { top: 16, right: 14, left: 4, bottom: 36 } as const;

  const effectiveRaw = canFetch ? raw : null;

  // Date inputs use today as upper bound — server-side `posted_after`/`posted_before`
  // already drive the filter, so we don't need a min/max derived from the dataset.
  const todayYmd = useMemo(() => toYmdLocal(new Date()), []);

  const loadedSeries = useMemo(
    () => (effectiveRaw ? pickSeries(effectiveRaw, metric) : []),
    [effectiveRaw, metric],
  );

  const rankedSeries = useMemo(
    () =>
      [...loadedSeries].sort(
        (a, b) => latestMetricValue(b, metric) - latestMetricValue(a, metric),
      ),
    [loadedSeries, metric],
  );

  const totalPages = Math.max(1, Math.ceil(rankedSeries.length / REELS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages - 1);
  const pageStart = safeCurrentPage * REELS_PER_PAGE;
  const pageEnd = Math.min(pageStart + REELS_PER_PAGE, rankedSeries.length);
  const pageSeries = useMemo(
    () => rankedSeries.slice(pageStart, pageEnd),
    [rankedSeries, pageStart, pageEnd],
  );

  const series = pageSeries;

  const { rows, dataKeys, labels } = useMemo(
    () => buildMergedRows(series, metric),
    [series, metric],
  );

  const barRows = useMemo<BarRow[]>(() => {
    return series.map((r, i) => ({
      name:
        labels[i].length > 18 ? `${labels[i].slice(0, 16)}…` : labels[i],
      v: latestMetricValue(r, metric),
      fill: lineColors[i % lineColors.length],
      postUrl: r.post_url,
    }));
  }, [series, labels, metric, lineColors]);

  const barChartHeight = Math.min(520, Math.max(280, barRows.length * 40 + 80));

  const hasAnyPoint = rows.some((row) =>
    dataKeys.some((k) => row[k] != null && row[k] !== ""),
  );

  const hasBarData = barRows.some((r) => r.v > 0);

  const visibleDataKeys = useMemo(
    () =>
      dataKeys.filter((_, i) => {
        const reelId = series[i]?.reel_id ?? "";
        return reelId && !hiddenReelIds.has(reelId);
      }),
    [dataKeys, series, hiddenReelIds],
  );

  const visibleRowsWithAnyPoint = useMemo(
    () =>
      rows.filter((row) =>
        visibleDataKeys.some((k) => row[k] != null && row[k] !== ""),
      ).length,
    [rows, visibleDataKeys],
  );

  const loadedReelCount = effectiveRaw?.length ?? 0;
  const rankedReelCount = rankedSeries.length;
  const dateRangeStrip = effectiveRaw?.length ? (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-app-fg-subtle">
      <p>
        Showing {rankedReelCount ? pageStart + 1 : 0}-{pageEnd} of {rankedReelCount} reels ranked by {metric}
        {total > loadedReelCount ? ` (${loadedReelCount} of ${total} loaded)` : ""}.
      </p>
      {rankedReelCount > REELS_PER_PAGE ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={safeCurrentPage <= 0}
            className="rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1 text-[11px] font-semibold text-app-fg-secondary transition-colors hover:bg-app-chip-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {safeCurrentPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safeCurrentPage >= totalPages - 1}
            className="rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1 text-[11px] font-semibold text-app-fg-secondary transition-colors hover:bg-app-chip-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  /** One visible snapshot → line/area looks empty; use bars + copy instead. */
  const singleSnapshotOnly = visibleRowsWithAnyPoint < 2;

  /** Recharts tooltips inherit app text color — force label/body colors per theme. */
  const tooltipContentStyle: CSSProperties = {
    backgroundColor: isDark ? "#27272a" : "#fafafa",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)"}`,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 12,
    color: isDark ? "#f4f4f5" : "#18181b",
    boxShadow: isDark
      ? "0 12px 40px rgba(0,0,0,0.55)"
      : "0 4px 20px rgba(0,0,0,0.08)",
  };

  const tooltipLabelStyle: CSSProperties = {
    color: isDark ? "#fafafa" : "#09090b",
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 6,
  };

  const tooltipItemStyle: CSSProperties = {
    color: isDark ? "#e4e4e7" : "#3f3f46",
    fontSize: 12,
    paddingTop: 2,
  };

  const yDomainMax = (dataMax: number) => {
    const m = Number(dataMax) || 0;
    return m <= 0 ? 1 : Math.ceil(m * 1.12);
  };

  // Recharts log scale silently drops any <=0 data point, which leaves gaps in
  // long reels that were just scraped. Floor at 1 so every snapshot renders.
  const yAxisScaleProps =
    yScale === "log"
      ? ({
          scale: "log" as const,
          domain: [1, "auto"] as [number, string],
          allowDataOverflow: true,
        } as const)
      : ({
          domain: [0, yDomainMax] as [number, (v: number) => number],
        } as const);

  return (
    <div className="glass glass-strong rounded-2xl border border-app-card-border p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-app-fg">Trends over time</h2>
          <p className="text-[11px] text-app-fg-muted">
            Tap a reel below to toggle it on the chart. Log scale helps when one reel dwarfs the rest.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Chart kind + Y-scale merged into a single compact segmented group. */}
          <div
            className="inline-flex overflow-hidden rounded-full border border-app-card-border bg-app-chip-bg"
            role="group"
            aria-label="Chart type"
          >
            {(
              [
                ["line", "Line"],
                ["bars", "Bars"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setChartKind(k)}
                className={
                  chartKind === k
                    ? "bg-app-accent px-3 py-1.5 text-[11px] font-semibold text-white dark:text-zinc-950"
                    : "px-3 py-1.5 text-[11px] font-medium text-app-fg-secondary hover:bg-app-chip-bg-hover"
                }
              >
                {label}
              </button>
            ))}
          </div>
          {chartKind !== "bars" ? (
            <button
              type="button"
              onClick={() => setYScale(yScale === "log" ? "linear" : "log")}
              title={
                yScale === "log"
                  ? "Log scale on — tap to switch to linear"
                  : "Log scale off — tap to flatten big vs small reels onto one chart"
              }
              className={
                yScale === "log"
                  ? "rounded-full border border-app-accent/40 bg-app-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-app-accent"
                  : "rounded-full border border-app-card-border bg-app-chip-bg px-2.5 py-1.5 text-[11px] font-medium text-app-fg-secondary hover:bg-app-chip-bg-hover"
              }
            >
              Log
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 space-y-3 border-b border-app-divider pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["views", "likes", "comments"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={
                metric === m
                  ? "rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900"
                  : "rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1.5 text-xs font-medium text-app-fg-secondary transition-colors hover:bg-app-chip-bg-hover"
              }
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          <span className="hidden h-4 w-px shrink-0 bg-app-divider sm:block" aria-hidden />
          {/* Time range — one segmented control replaces four standalone pills. */}
          <div
            className="inline-flex overflow-hidden rounded-full border border-app-card-border bg-app-chip-bg"
            role="group"
            aria-label="Time range"
          >
            {(
              [
                ["30d", "30d"],
                ["90d", "90d"],
                ["all", "All"],
                ["custom", "Custom"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTimeRange(k)}
                className={
                  timeRange === k
                    ? "bg-app-accent/15 px-3 py-1.5 text-[11px] font-semibold text-app-accent"
                    : "px-3 py-1.5 text-[11px] font-medium text-app-fg-secondary hover:bg-app-chip-bg-hover"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {timeRange === "custom" && effectiveRaw?.length ? (
          <div
            className="flex flex-wrap items-center gap-3 pl-0.5"
            role="group"
            aria-label="Custom date range"
          >
            <label className="flex items-center gap-2 text-[11px] text-app-fg-muted">
              <span className="shrink-0 font-medium text-app-fg-secondary">From</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                max={customTo || todayYmd}
                className="rounded-lg border border-app-card-border bg-app-chip-bg px-2 py-1.5 text-xs text-app-fg [color-scheme:light] dark:[color-scheme:dark]"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-app-fg-muted">
              <span className="shrink-0 font-medium text-app-fg-secondary">To</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom || undefined}
                max={todayYmd}
                className="rounded-lg border border-app-card-border bg-app-chip-bg px-2 py-1.5 text-xs text-app-fg [color-scheme:light] dark:[color-scheme:dark]"
              />
            </label>
          </div>
        ) : null}
      </div>

      {!canFetch ? (
        <p className="text-sm text-app-fg-muted">Select a workspace client to see metrics.</p>
      ) : loading ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-app-fg-muted">
          Loading metrics…
        </div>
      ) : err ? (
        <p className="text-sm text-app-callout-warning-fg">{err}</p>
      ) : !effectiveRaw?.length ? (
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-medium text-app-fg">
            {timeRange === "all"
              ? "No own reels stored yet"
              : "No reels match this date range"}
          </p>
          <p className="text-xs text-app-fg-muted">
            {timeRange === "all" ? (
              <>
                Finish onboarding, then use <strong className="text-app-fg">Update my reels</strong> at the
                top of the Dashboard (or Intelligence) to pull your posts from Instagram.
              </>
            ) : (
              <>
                Try <strong className="text-app-fg">All</strong> or widen your custom dates to see more reels.
              </>
            )}
          </p>
          {timeRange === "all" ? (
            <Link
              href="/intelligence"
              className="inline-block text-xs font-semibold text-app-accent underline-offset-2 hover:underline"
            >
              Open Intelligence
            </Link>
          ) : null}
        </div>
      ) : chartKind === "bars" ? (
        !hasBarData ? (
          <>
            {dateRangeStrip}
            <div className="py-12 text-center text-sm text-app-fg-muted">
              No {metric} values to compare yet.
            </div>
          </>
        ) : (
          <>
            {dateRangeStrip}
            <p className="mb-3 text-[11px] text-app-fg-subtle">
              Latest {metric} per reel ({barRows.length} reels by {metric})
            </p>
            <div style={{ height: barChartHeight }} className="w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barRows}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                >
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: tickFill, fontSize: 11 }}
                    tickFormatter={formatAxisNumber}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={108}
                    tick={{ fill: tickFill, fontSize: 10 }}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                  />
                  <Tooltip
                    contentStyle={tooltipContentStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    formatter={(value: number | string) => [
                      formatAxisNumber(Number(value)),
                      metric,
                    ]}
                  />
                  <Bar
                    dataKey="v"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={28}
                    cursor="pointer"
                    onClick={(data: unknown) => {
                      const row = data as { payload?: BarRow };
                      openInstagramReel(row.payload?.postUrl);
                    }}
                  >
                    {barRows.map((e, i) => (
                      <Cell key={`c-${i}`} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )
      ) : !hasAnyPoint ? (
        <>
          {dateRangeStrip}
          <div className="space-y-2 py-12 text-center">
            <p className="text-sm font-medium text-app-fg">No history for {metric} yet</p>
            <p className="text-xs text-app-fg-muted">
              After you pull your reels again, more snapshot points will show up here.
            </p>
          </div>
        </>
      ) : singleSnapshotOnly ? (
        <>
          {dateRangeStrip}
          <div className="mb-4 rounded-xl border border-app-accent/25 bg-app-accent/10 px-3 py-2.5 text-[11px] leading-relaxed text-app-fg-secondary">
            <span className="font-semibold text-app-on-amber-title dark:text-amber-100/90">
              One snapshot so far.
            </span>{" "}
            Line and area charts need at least two pulls from Instagram. For now you&apos;re seeing
            this snapshot only — use <strong className="text-app-fg">Update my reels</strong> on the
            Dashboard again later to see a trend.
          </div>
          {!hasBarData ? (
            <div className="py-12 text-center text-sm text-app-fg-muted">
              No {metric} values to compare yet.
            </div>
          ) : (
            <>
              <p className="mb-3 text-[11px] text-app-fg-subtle">
                {metric} by reel for this pull
              </p>
              <div style={{ height: barChartHeight }} className="w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={barRows}
                    layout="vertical"
                    margin={{ top: 12, right: 18, left: 6, bottom: 12 }}
                  >
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: tickFill, fontSize: 11 }}
                      tickFormatter={formatAxisNumber}
                      tickLine={{ stroke: axisLineStroke }}
                      axisLine={{ stroke: axisLineStroke }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={108}
                      tick={{ fill: tickFill, fontSize: 10 }}
                      tickLine={{ stroke: axisLineStroke }}
                      axisLine={{ stroke: axisLineStroke }}
                    />
                    <Tooltip
                      contentStyle={tooltipContentStyle}
                      labelStyle={tooltipLabelStyle}
                      itemStyle={tooltipItemStyle}
                      formatter={(value: number | string) => [
                        formatAxisNumber(Number(value)),
                        metric,
                      ]}
                    />
                    <Bar
                      dataKey="v"
                      radius={[0, 6, 6, 0]}
                      maxBarSize={28}
                      cursor="pointer"
                      onClick={(data: unknown) => {
                        const row = data as { payload?: BarRow };
                        openInstagramReel(row.payload?.postUrl);
                      }}
                    >
                      {barRows.map((e, i) => (
                        <Cell key={`snap-${i}`} fill={e.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {dateRangeStrip}
          <ReelPickerStrip
            series={series}
            labels={labels}
            colors={lineColors}
            metric={metric}
            hidden={hiddenReelIds}
            onToggle={toggleReelVisibility}
          />
          <div className="h-[420px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {chartKind === "line" ? (
                <LineChart data={rows} margin={chartMargin}>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="category"
                    tickFormatter={formatXAxisTick}
                    tick={{ fill: tickFill, fontSize: 10 }}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                    height={48}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: tickFill, fontSize: 11 }}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                    tickFormatter={formatAxisNumber}
                    width={56}
                    {...yAxisScaleProps}
                  />
                  <Tooltip
                    content={
                      <ThumbnailTooltip
                        series={series}
                        dataKeys={dataKeys}
                        labels={labels}
                        metric={metric}
                        containerStyle={tooltipContentStyle}
                        labelStyle={tooltipLabelStyle}
                      />
                    }
                  />
                  {dataKeys.map((key, i) => {
                    const c = lineColors[i % lineColors.length];
                    const isHidden = hiddenReelIds.has(series[i]?.reel_id ?? "");
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={c}
                        strokeWidth={2.25}
                        dot={{ r: 2.5, fill: c, stroke: isDark ? "#18181b" : "#fff", strokeWidth: 1 }}
                        activeDot={{ r: 5, fill: c, stroke: isDark ? "#fafafa" : "#fff", strokeWidth: 2 }}
                        connectNulls
                        hide={isHidden}
                      />
                    );
                  })}
                </LineChart>
              ) : (
                <AreaChart data={rows} margin={chartMargin}>
                  <defs>
                    {dataKeys.map((key, i) => (
                      <linearGradient
                        key={key}
                        id={`area-grad-${key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={lineColors[i % lineColors.length]}
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor={lineColors[i % lineColors.length]}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="category"
                    tickFormatter={formatXAxisTick}
                    tick={{ fill: tickFill, fontSize: 10 }}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                    height={48}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: tickFill, fontSize: 11 }}
                    tickLine={{ stroke: axisLineStroke }}
                    axisLine={{ stroke: axisLineStroke }}
                    tickFormatter={formatAxisNumber}
                    width={56}
                    {...yAxisScaleProps}
                  />
                  <Tooltip
                    content={
                      <ThumbnailTooltip
                        series={series}
                        dataKeys={dataKeys}
                        labels={labels}
                        metric={metric}
                        containerStyle={tooltipContentStyle}
                        labelStyle={tooltipLabelStyle}
                      />
                    }
                  />
                  {dataKeys.map((key, i) => {
                    const isHidden = hiddenReelIds.has(series[i]?.reel_id ?? "");
                    return (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={lineColors[i % lineColors.length]}
                        strokeWidth={2.25}
                        fill={`url(#area-grad-${key})`}
                        connectNulls
                        hide={isHidden}
                      />
                    );
                  })}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
