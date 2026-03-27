"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

const MAX_SERIES = 8;

type MetricKey = "views" | "likes" | "comments";
type ChartKind = "line" | "area" | "bars";

type ChartRow = Record<string, string | number | null | undefined>;

function reelDisplayLabel(r: OwnReelsMetricsSeries, index: number): string {
  const hook = (r.hook_text || "").trim().replace(/\s+/g, " ");
  if (hook.length > 28) return `${hook.slice(0, 26)}…`;
  if (hook.length > 0) return hook;
  return `Reel ${index + 1}`;
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

function pickSeries(
  reels: OwnReelsMetricsSeries[],
  m: MetricKey,
): OwnReelsMetricsSeries[] {
  return [...reels]
    .filter((r) => r.points.some((p) => metricAtPoint(p, m) !== null))
    .sort((a, b) => latestMetricValue(b, m) - latestMetricValue(a, m))
    .slice(0, MAX_SERIES);
}

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
  const labels = series.map((r, i) => reelDisplayLabel(r, i));

  const rows: ChartRow[] = sortedT.map((t) => {
    const short = formatTickDate(t);
    const row: ChartRow = { t, tShort: short };
    series.forEach((r, i) => {
      const pt = r.points.find((p) => p.scraped_at === t);
      row[dataKeys[i]] = pt ? metricAtPoint(pt, m) : null;
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

type Props = {
  clientSlug: string;
  orgSlug: string;
};

export function OwnReelMetricsDashboard({ clientSlug, orgSlug }: Props) {
  const { resolvedTheme } = useTheme();
  const [metric, setMetric] = useState<MetricKey>("views");
  const [chartKind, setChartKind] = useState<ChartKind>("line");
  const [raw, setRaw] = useState<OwnReelsMetricsSeries[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canFetch = Boolean(clientSlug.trim() && orgSlug.trim());
  const [loading, setLoading] = useState(canFetch);

  useEffect(() => {
    if (!canFetch) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setErr(null);
      void (async () => {
        const res = await fetchOwnReelsMetrics(clientSlug, orgSlug);
        if (cancelled) return;
        if (!res.ok) {
          setErr(res.error);
          setRaw(null);
        } else {
          setRaw(res.data.reels);
        }
        setLoading(false);
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, clientSlug, orgSlug]);

  const isDark = resolvedTheme !== "light";
  const tickFill = isDark ? "#e4e4e7" : "#3f3f46";
  const axisLineStroke = isDark ? "rgba(244,244,245,0.4)" : "rgba(24,24,27,0.35)";
  const gridColor = isDark ? "rgba(244,244,245,0.1)" : "rgba(24,24,27,0.08)";
  const lineColors = isDark ? LINE_COLORS_DARK : LINE_COLORS_LIGHT;

  const chartMargin = { top: 16, right: 14, left: 4, bottom: 36 } as const;

  const effectiveRaw = canFetch ? raw : null;

  const series = useMemo(
    () => (effectiveRaw ? pickSeries(effectiveRaw, metric) : []),
    [effectiveRaw, metric],
  );

  const { rows, dataKeys, labels } = useMemo(
    () => buildMergedRows(series, metric),
    [series, metric],
  );

  const barRows = useMemo(() => {
    return series.map((r, i) => ({
      name:
        labels[i].length > 18 ? `${labels[i].slice(0, 16)}…` : labels[i],
      v: latestMetricValue(r, metric),
      fill: lineColors[i % lineColors.length],
    }));
  }, [series, labels, metric, lineColors]);

  const barChartHeight = Math.min(520, Math.max(280, barRows.length * 40 + 80));

  const hasAnyPoint = rows.some((row) =>
    dataKeys.some((k) => row[k] != null && row[k] !== ""),
  );

  const hasBarData = barRows.some((r) => r.v > 0);

  /** One snapshot → many series share the same X → line/area stacks dots; use bars + copy instead. */
  const singleSnapshotOnly = rows.length < 2;

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

  return (
    <div className="glass glass-strong rounded-2xl border border-app-card-border p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-app-fg">Trends over time</h2>
          <p className="text-[11px] text-app-fg-muted">
            Line / area need 2+ syncs · One snapshot shows a reel comparison instead · Bars = latest
            per reel
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["line", "Line"],
              ["area", "Area"],
              ["bars", "Bars"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setChartKind(k)}
              className={
                chartKind === k
                  ? "rounded-full bg-app-accent px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-950"
                  : "rounded-full border border-app-card-border bg-app-chip-bg px-3 py-1.5 text-xs font-medium text-app-fg-secondary hover:bg-app-chip-bg-hover"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-app-divider pb-4">
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
        <Link
          href="/intelligence"
          className="ml-auto rounded-full border border-app-card-border px-3 py-1.5 text-xs font-semibold text-app-accent hover:bg-app-chip-bg"
        >
          Intelligence
        </Link>
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
          <p className="text-sm font-medium text-app-fg">No own reels stored yet</p>
          <p className="text-xs text-app-fg-muted">
            Finish onboarding, then use <strong className="text-app-fg">Update my reels</strong> at the
            top of the Dashboard (or Intelligence) to pull your posts from Instagram.
          </p>
          <Link
            href="/intelligence"
            className="inline-block text-xs font-semibold text-app-accent underline-offset-2 hover:underline"
          >
            Open Intelligence
          </Link>
        </div>
      ) : chartKind === "bars" ? (
        !hasBarData ? (
          <div className="py-12 text-center text-sm text-app-fg-muted">
            No {metric} values to compare yet.
          </div>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-app-fg-subtle">
              Latest {metric} per reel (top {barRows.length} by {metric})
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
                  <Bar dataKey="v" radius={[0, 6, 6, 0]} maxBarSize={28}>
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
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-medium text-app-fg">No history for {metric} yet</p>
          <p className="text-xs text-app-fg-muted">
            After you pull your reels again, more snapshot points will show up here.
          </p>
        </div>
      ) : singleSnapshotOnly ? (
        <>
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
                    <Bar dataKey="v" radius={[0, 6, 6, 0]} maxBarSize={28}>
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
          {effectiveRaw.length > MAX_SERIES ? (
            <p className="mb-4 text-[11px] text-app-fg-subtle">
              Showing top {MAX_SERIES} reels by latest {metric}.{" "}
              <Link href="/intelligence/reels" className="text-app-accent hover:underline">
                View all reels
              </Link>
            </p>
          ) : null}
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
                    domain={[0, yDomainMax]}
                  />
                  <Tooltip
                    contentStyle={tooltipContentStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    labelFormatter={(_label, payload) => {
                      const t = payload?.[0]?.payload?.t as string | undefined;
                      return t ? formatTooltipWhen(t) : "";
                    }}
                    formatter={(value: number | string) =>
                      value != null && value !== ""
                        ? [formatAxisNumber(Number(value)), metric]
                        : ["—", metric]
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value) => {
                      const i = dataKeys.indexOf(value);
                      return i >= 0 ? labels[i] : value;
                    }}
                  />
                  {dataKeys.map((key, i) => {
                    const c = lineColors[i % lineColors.length];
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={c}
                        strokeWidth={2}
                        dot={{ r: 4, fill: c, stroke: c, strokeWidth: 1 }}
                        activeDot={{ r: 6, fill: c, stroke: "#fff", strokeWidth: 2 }}
                        connectNulls={false}
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
                    domain={[0, yDomainMax]}
                  />
                  <Tooltip
                    contentStyle={tooltipContentStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    labelFormatter={(_label, payload) => {
                      const t = payload?.[0]?.payload?.t as string | undefined;
                      return t ? formatTooltipWhen(t) : "";
                    }}
                    formatter={(value: number | string) =>
                      value != null && value !== ""
                        ? [formatAxisNumber(Number(value)), metric]
                        : ["—", metric]
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value) => {
                      const i = dataKeys.indexOf(value);
                      return i >= 0 ? labels[i] : value;
                    }}
                  />
                  {dataKeys.map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={lineColors[i % lineColors.length]}
                      strokeWidth={2}
                      fill={`url(#area-grad-${key})`}
                      connectNulls={false}
                    />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
