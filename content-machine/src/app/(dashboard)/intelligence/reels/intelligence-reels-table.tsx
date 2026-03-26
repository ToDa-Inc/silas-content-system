"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import type { ScrapedReelRow } from "@/lib/api";
import { replicabilityLabel } from "@/lib/replicability-label";
import { AnalyzeReelModal } from "../components/analyze-reel-modal";
import { ReelAnalysisDetailModal } from "../components/reel-analysis-detail-modal";

function formatPosted(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

type SortKey = "views" | "likes" | "comments" | "outlier_ratio" | "posted_at" | "total_score";

type Props = {
  rows: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
};

function compareForSort(a: ScrapedReelRow, b: ScrapedReelRow, key: SortKey): number {
  switch (key) {
    case "views": {
      const va = a.views;
      const vb = b.views;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    case "likes": {
      const va = a.likes;
      const vb = b.likes;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    case "comments": {
      const va = a.comments;
      const vb = b.comments;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    case "outlier_ratio": {
      const va = a.outlier_ratio;
      const vb = b.outlier_ratio;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return Number(va) - Number(vb);
    }
    case "posted_at": {
      const ta = a.posted_at ? new Date(a.posted_at).getTime() : NaN;
      const tb = b.posted_at ? new Date(b.posted_at).getTime() : NaN;
      const na = Number.isNaN(ta);
      const nb = Number.isNaN(tb);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return ta - tb;
    }
    case "total_score": {
      const va = a.analysis?.total_score;
      const vb = b.analysis?.total_score;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    default:
      return 0;
  }
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="py-3 pr-2 font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-0.5 text-left uppercase tracking-widest hover:text-zinc-700 dark:hover:text-app-fg-muted"
      >
        {label}
        {active ? (
          dir === "desc" ? (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ChevronUp className="h-3 w-3 shrink-0" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

export function IntelligenceReelsTable({ rows, clientSlug, orgSlug }: Props) {
  const [detailReelId, setDetailReelId] = useState<string | null>(null);
  const [creatorFilter, setCreatorFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeInitialUrl, setAnalyzeInitialUrl] = useState<string | null>(null);

  const creatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.account_username?.trim()) set.add(r.account_username.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!creatorFilter) return rows;
    return rows.filter((r) => r.account_username === creatorFilter);
  }, [rows, creatorFilter]);

  const displayRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const base = compareForSort(a, b, sortKey);
      return sortDir === "asc" ? base : -base;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <label className="flex flex-wrap items-center gap-2 text-xs text-app-fg-muted">
          <span className="font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle">
            Creator
          </span>
          <select
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
            className="glass-inset min-w-[180px] rounded-lg border border-zinc-200/80 bg-white/80 px-3 py-2 text-sm text-zinc-900 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg"
          >
            <option value="">All creators</option>
            {creatorOptions.map((u) => (
              <option key={u} value={u}>
                @{u}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200/90 bg-zinc-50/90 dark:border-white/10 dark:bg-zinc-950/60">
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200/90 text-[10px] uppercase tracking-widest text-zinc-500 dark:border-white/10 dark:text-app-fg-subtle">
              <th className="px-3 py-3 pr-2 font-medium">#</th>
              <th className="py-3 pr-2 font-medium">Thumb</th>
              <th className="py-3 pr-2 font-medium">Account</th>
              <SortHeader
                label="Silas"
                active={sortKey === "total_score"}
                dir={sortDir}
                onClick={() => handleSort("total_score")}
              />
              <SortHeader
                label="Views"
                active={sortKey === "views"}
                dir={sortDir}
                onClick={() => handleSort("views")}
              />
              <SortHeader
                label="×Their avg"
                active={sortKey === "outlier_ratio"}
                dir={sortDir}
                onClick={() => handleSort("outlier_ratio")}
              />
              <SortHeader
                label="Likes"
                active={sortKey === "likes"}
                dir={sortDir}
                onClick={() => handleSort("likes")}
              />
              <SortHeader
                label="Comments"
                active={sortKey === "comments"}
                dir={sortDir}
                onClick={() => handleSort("comments")}
              />
              <SortHeader
                label="Date"
                active={sortKey === "posted_at"}
                dir={sortDir}
                onClick={() => handleSort("posted_at")}
              />
              <th className="py-3 pr-2 font-medium">Link</th>
            </tr>
          </thead>
          <tbody className="text-xs text-zinc-800 dark:text-app-fg-secondary">
            {displayRows.map((row, i) => {
              const a = row.analysis;
              const canAnalyze = !a && Boolean(row.post_url?.trim());
              return (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100/90 transition-colors hover:bg-zinc-100/80 dark:border-white/[0.06] dark:hover:bg-white/[0.06]"
                >
                  <td className="px-3 py-2.5 pr-2 align-middle tabular-nums text-zinc-500 dark:text-app-fg-subtle">
                    {i + 1}
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    <ReelThumbnail
                      src={row.thumbnail_url}
                      alt={`@${row.account_username} reel`}
                      href={row.post_url}
                      size="sm"
                    />
                  </td>
                  <td className="py-2.5 pr-2 align-middle font-medium text-zinc-900 dark:text-app-fg">
                    @{row.account_username}
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    {a ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="whitespace-nowrap text-[10px] font-semibold text-emerald-700 dark:text-emerald-300/95">
                          {a.total_score != null ? `${a.total_score}/50` : "—"}
                          {a.replicability_rating
                            ? ` · ${replicabilityLabel(a.replicability_rating)}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDetailReelId(row.id)}
                          className="w-fit text-left text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          View analysis
                        </button>
                      </div>
                    ) : canAnalyze ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAnalyzeInitialUrl(row.post_url!.trim());
                          setAnalyzeOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
                        title="Run Silas video analysis (same as Intelligence toolbar)"
                      >
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                        Analyze
                      </button>
                    ) : (
                      <span className="text-zinc-400 dark:text-app-fg-faint">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.views != null ? row.views.toLocaleString() : "—"}
                  </td>
                  <td
                    className={
                      row.is_outlier === true
                        ? "py-2.5 pr-2 align-middle font-bold text-amber-600 dark:text-amber-400"
                        : "py-2.5 pr-2 align-middle text-zinc-400 dark:text-app-fg-faint"
                    }
                  >
                    {row.outlier_ratio != null ? `${Number(row.outlier_ratio).toFixed(1)}×` : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.likes != null ? row.likes.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.comments != null ? row.comments.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle text-zinc-600 dark:text-app-fg-muted">
                    {formatPosted(row.posted_at)}
                  </td>
                  <td className="py-2.5 align-middle">
                    {row.post_url ? (
                      <a
                        href={row.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                      >
                        ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReelAnalysisDetailModal
        open={detailReelId != null}
        onClose={() => setDetailReelId(null)}
        reelId={detailReelId ?? ""}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
      />
      <AnalyzeReelModal
        open={analyzeOpen}
        onClose={() => {
          setAnalyzeOpen(false);
          setAnalyzeInitialUrl(null);
        }}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        initialUrl={analyzeInitialUrl}
      />
    </>
  );
}
