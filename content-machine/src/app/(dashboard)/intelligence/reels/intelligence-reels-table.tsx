"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clapperboard,
  Info,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { AppSelect } from "@/components/ui/app-select";
import { Tooltip } from "@/components/ui/tooltip";
import type { ScrapedReelRow } from "@/lib/api";
import { formatViewsToComments, viewsToCommentsRatio } from "@/lib/reel-comment-view";
import {
  clientApiHeaders,
  contentApiFetch,
  enqueueReelAnalyzeBulk,
  fetchActiveReelAnalysisJob,
  formatFastApiError,
  getContentApiBase,
} from "@/lib/api-client";
import { analysisSortScore, formatSilasScoreSummary } from "@/lib/silas-score-display";
import { AnalyzeReelModal } from "../components/analyze-reel-modal";
import { RecreateReelModal } from "../components/recreate-reel-modal";
import { IntelligenceProgressBar } from "../components/intelligence-progress-bar";
import { ReelAnalysisDetailModal } from "../components/reel-analysis-detail-modal";

function formatPosted(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

type SortKey =
  | "views"
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "comment_view_ratio"
  | "video_duration"
  | "outlier_ratio"
  | "similarity_score"
  | "posted_at"
  | "total_score";
type AnalysisFilter = "all" | "analyzed" | "pending";

type Props = {
  rows: ScrapedReelRow[];
  clientSlug: string;
  orgSlug: string;
};

/** Rows eligible for bulk selection / re-analysis (must have a canonical post URL). */
function rowHasPostUrl(row: ScrapedReelRow): boolean {
  return Boolean(row.post_url?.trim());
}

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
    case "saves": {
      const va = a.saves;
      const vb = b.saves;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    case "shares": {
      const va = a.shares;
      const vb = b.shares;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    }
    case "comment_view_ratio": {
      const va = viewsToCommentsRatio(a);
      const vb = viewsToCommentsRatio(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return Number(va) - Number(vb);
    }
    case "video_duration": {
      const va = a.video_duration;
      const vb = b.video_duration;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return Number(va) - Number(vb);
    }
    case "outlier_ratio":
    case "similarity_score": {
      // Unified "Signal" sort. Niche reels never have outlier_ratio and competitor
      // reels never have similarity_score, but both signal "why this reel surfaced".
      // Falling back per-row keeps niche matches from sinking when sorting Signal.
      const va = a.outlier_ratio ?? a.similarity_score ?? null;
      const vb = b.outlier_ratio ?? b.similarity_score ?? null;
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
      const va = analysisSortScore(a);
      const vb = analysisSortScore(b);
      if (Number.isNaN(va) && Number.isNaN(vb)) return 0;
      if (Number.isNaN(va)) return 1;
      if (Number.isNaN(vb)) return -1;
      return va - vb;
    }
    default:
      return 0;
  }
}

/**
 * Airtable-feel column header. Sort indicator is always rendered (faded when
 * inactive) so users can see at a glance which columns are sortable. The (i)
 * icon next to the label is what carries the explanatory tooltip — it stays
 * out of the way visually but invites a hover when a metric needs context.
 */
function SortHeader({
  label,
  active,
  dir,
  onClick,
  hint,
  align = "left",
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  /** Tooltip body shown when the (i) icon is hovered/focused. */
  hint?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const ariaSort = active ? (dir === "desc" ? "descending" : "ascending") : "none";
  return (
    <th
      aria-sort={ariaSort}
      className={`py-3 pr-2 font-medium ${align === "right" ? "text-right" : ""} ${className ?? ""}`}
    >
      <span
        className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
      >
        <button
          type="button"
          onClick={onClick}
          className={`group inline-flex items-center gap-1 rounded text-left uppercase tracking-widest transition-colors ${
            active
              ? "text-zinc-800 dark:text-app-fg"
              : "text-zinc-500 hover:text-zinc-700 dark:text-app-fg-subtle dark:hover:text-app-fg-muted"
          }`}
          aria-label={`Sort by ${label}${active ? `, currently ${dir === "desc" ? "descending" : "ascending"}` : ""}`}
        >
          <span>{label}</span>
          {active ? (
            dir === "desc" ? (
              <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
            )
          ) : (
            <ChevronsUpDown
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50"
              aria-hidden
            />
          )}
        </button>
        {hint ? (
          <Tooltip content={hint}>
            <span
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-200/80 hover:text-zinc-700 dark:text-app-fg-faint dark:hover:bg-white/10 dark:hover:text-app-fg-muted"
              tabIndex={0}
            >
              <Info className="h-3 w-3" aria-hidden />
              <span className="sr-only">{`What is ${label}?`}</span>
            </span>
          </Tooltip>
        ) : null}
      </span>
    </th>
  );
}

/** Removable chip used in the active-filters strip above the table. */
function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200/90 bg-white/90 py-0.5 pl-2 pr-1 font-medium text-zinc-700 shadow-sm dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg-secondary">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-app-fg-subtle">
        {label}
      </span>
      <span className="truncate">{value}</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200/80 hover:text-zinc-700 dark:text-app-fg-faint dark:hover:bg-white/10 dark:hover:text-app-fg-muted"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/** Friendly labels for the active-filter chip strip. */
const SORT_KEY_LABELS: Record<SortKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  saves: "Saves",
  shares: "Shares",
  comment_view_ratio: "C/V",
  video_duration: "Duration",
  outlier_ratio: "Signal",
  similarity_score: "Signal",
  posted_at: "Posted",
  total_score: "Score",
};

/** First-time analyze only: has post URL and no analysis row yet. */
function isAnalyzable(row: ScrapedReelRow): boolean {
  return Boolean(row.post_url?.trim() && !row.analysis);
}

/**
 * Niche-keyword analyses (source = "keyword_similarity") write to a different
 * payload shape than Silas scoring — the score columns end up null/0 in the DB.
 * Detect that combo so we can render the row's actual content (verdict, similarity)
 * instead of a misleading "0/50 · Weak" Silas display.
 */
function isNicheMatchOnly(row: ScrapedReelRow): boolean {
  const a = row.analysis;
  if (!a) return false;
  const hasSilasScore =
    a.weighted_total != null || (a.total_score != null && a.total_score > 0);
  return row.source === "keyword_similarity" && !hasSilasScore;
}

/** Subtle styling for empty cells (`0` or `—`) so populated values pop. */
const EMPTY_CELL_CLASS = "text-zinc-400 dark:text-app-fg-faint";

type BulkJobPoll = {
  status: string;
  result?: {
    status?: string;
    bulk?: boolean;
    progress?: { done: number; total: number; current_url?: string };
    total?: number;
    succeeded?: number;
    failed?: number;
  } | null;
  error_message?: string | null;
};

type TrackedJobPoll = BulkJobPoll & {
  id?: string;
  job_type?: string;
  started_at?: string | null;
};

const BULK_POLL_MS = 2500;
const BULK_MAX_URLS = 20;
/** Matches bulk UI estimate: fill toward next step over ~20s, cap at ~88% of segment until server advances. */
const SEGMENT_MS = 20_000;
const STALE_MS = 15 * 60 * 1000;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

function startedAtIsStale(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t > STALE_MS;
}

export function IntelligenceReelsTable({ rows, clientSlug, orgSlug }: Props) {
  const router = useRouter();
  const [detailReelId, setDetailReelId] = useState<string | null>(null);
  const [creatorFilter, setCreatorFilter] = useState("");
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeInitialUrl, setAnalyzeInitialUrl] = useState<string | null>(null);
  const [analyzeSkipApify, setAnalyzeSkipApify] = useState(false);
  const [recreateRow, setRecreateRow] = useState<ScrapedReelRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [trackedJobType, setTrackedJobType] = useState<"reel_analyze_bulk" | "reel_analyze_url" | null>(
    null,
  );
  const [bulkExpectedTotal, setBulkExpectedTotal] = useState<number | null>(null);
  const [lastJob, setLastJob] = useState<TrackedJobPoll | null>(null);
  const [tick, setTick] = useState(0);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const segmentDoneRef = useRef<number>(-999);
  /** Easing clock for the fake progress bar — state (not refs) so eslint allows use in render. */
  const [wallMs, setWallMs] = useState(0);
  const [segmentStartMs, setSegmentStartMs] = useState(0);
  const pollTerminalHandledRef = useRef(false);
  const prevTrackedJobIdRef = useRef<string | null>(null);
  const [page, setPage] = useState(1);
  /** 0 = show all rows (no pagination). */
  const [pageSize, setPageSize] = useState<number>(50);

  const creatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.account_username?.trim()) set.add(r.account_username.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  // Debounce raw input → query so the table doesn't re-sort on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchInput]);

  const filteredRows = useMemo(() => {
    let out = rows;
    if (creatorFilter) {
      out = out.filter((r) => r.account_username === creatorFilter);
    }
    if (analysisFilter === "analyzed") {
      out = out.filter((r) => Boolean(r.analysis));
    } else if (analysisFilter === "pending") {
      out = out.filter((r) => isAnalyzable(r));
    }
    if (searchQuery) {
      const q = searchQuery;
      out = out.filter((r) => {
        const u = r.account_username?.toLowerCase() ?? "";
        const h = r.hook_text?.toLowerCase() ?? "";
        const c = r.caption?.toLowerCase() ?? "";
        return u.includes(q) || h.includes(q) || c.includes(q);
      });
    }
    return out;
  }, [rows, creatorFilter, analysisFilter, searchQuery]);

  const activeFilterCount =
    (creatorFilter ? 1 : 0) +
    (analysisFilter !== "all" ? 1 : 0) +
    (searchQuery ? 1 : 0) +
    (sortKey ? 1 : 0);

  const clearAllFilters = () => {
    setCreatorFilter("");
    setAnalysisFilter("all");
    setSearchInput("");
    setSearchQuery("");
    setSortKey(null);
    setSortDir("desc");
  };

  const displayRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const base = compareForSort(a, b, sortKey);
      return sortDir === "asc" ? base : -base;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  const effectivePageSize =
    pageSize === 0 ? Math.max(displayRows.length, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(displayRows.length / effectivePageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    if (pageSize === 0) return displayRows;
    const start = (safePage - 1) * effectivePageSize;
    return displayRows.slice(start, start + effectivePageSize);
  }, [displayRows, pageSize, safePage, effectivePageSize]);

  useEffect(() => {
    setPage(1);
  }, [creatorFilter, analysisFilter, searchQuery, sortKey, sortDir]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const postUrlVisible = useMemo(
    () => pageRows.filter((r) => rowHasPostUrl(r)),
    [pageRows],
  );

  const selectedPostUrls = useMemo(() => {
    const list: string[] = [];
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      if (!rowHasPostUrl(r)) continue;
      list.push(r.post_url!.trim());
    }
    return list;
  }, [rows, selected]);

  /** Bulk LLM-only when every selected row with a link already has an analysis row. */
  const bulkSkipApify = useMemo(() => {
    const picked = rows.filter((r) => selected.has(r.id) && rowHasPostUrl(r));
    if (picked.length === 0) return false;
    return picked.every((r) => Boolean(r.analysis));
  }, [rows, selected]);

  const allVisibleSelected =
    postUrlVisible.length > 0 && postUrlVisible.every((r) => selected.has(r.id));
  const someVisibleSelected = postUrlVisible.some((r) => selected.has(r.id));

  useEffect(() => {
    const el = headerSelectRef.current;
    if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    if (!trackedJobId) return;
    const w = Date.now();
    setWallMs(w);
    const iv = setInterval(() => {
      setWallMs(Date.now());
      setTick((n) => n + 1);
    }, 150);
    return () => clearInterval(iv);
  }, [trackedJobId]);

  useEffect(() => {
    if (trackedJobId !== prevTrackedJobIdRef.current) {
      prevTrackedJobIdRef.current = trackedJobId;
      pollTerminalHandledRef.current = false;
      if (trackedJobId) {
        setLastJob(null);
        segmentDoneRef.current = -999;
        const t = Date.now();
        setWallMs(t);
        setSegmentStartMs(t);
      }
    }
  }, [trackedJobId]);

  useEffect(() => {
    const d = lastJob?.result?.progress?.done;
    if (typeof d === "number" && d !== segmentDoneRef.current) {
      segmentDoneRef.current = d;
      const t = Date.now();
      setWallMs(t);
      setSegmentStartMs(t);
    }
  }, [lastJob?.result?.progress?.done]);

  useEffect(() => {
    if (!clientSlug?.trim() || !orgSlug?.trim()) return;
    let cancelled = false;
    (async () => {
      const res = await fetchActiveReelAnalysisJob(clientSlug, orgSlug);
      if (cancelled || !res.ok || !res.data.active) return;
      setTrackedJobId(res.data.job_id);
      setTrackedJobType(
        res.data.job_type === "reel_analyze_bulk" ? "reel_analyze_bulk" : "reel_analyze_url",
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [clientSlug, orgSlug]);

  useEffect(() => {
    if (!trackedJobId || !clientSlug?.trim() || !orgSlug?.trim()) return;
    let cancelled = false;
    let timeoutClear: ReturnType<typeof setTimeout> | undefined;
    const apiBase = getContentApiBase();
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = undefined;
    };

    const poll = async () => {
      if (cancelled || pollTerminalHandledRef.current) return;
      try {
        const headersBase = await clientApiHeaders({ orgSlug });
        const jRes = await contentApiFetch(
          `${apiBase}/api/v1/jobs/${encodeURIComponent(trackedJobId)}`,
          { headers: headersBase },
        );
        const job = (await jRes.json().catch(() => ({}))) as TrackedJobPoll;
        if (cancelled) return;
        if (!jRes.ok) {
          pollTerminalHandledRef.current = true;
          stopPolling();
          setBulkMsg(
            formatFastApiError(job as unknown as Record<string, unknown>, "Job status failed"),
          );
          setTrackedJobId(null);
          setTrackedJobType(null);
          setBulkExpectedTotal(null);
          setLastJob(null);
          return;
        }
        setLastJob(job);

        if (job.status === "failed") {
          pollTerminalHandledRef.current = true;
          stopPolling();
          setBulkMsg(job.error_message || "Analysis failed.");
          setTrackedJobId(null);
          setTrackedJobType(null);
          setBulkExpectedTotal(null);
          setLastJob(null);
          return;
        }

        if (job.status === "completed") {
          pollTerminalHandledRef.current = true;
          stopPolling();
          const isBulk = job.job_type === "reel_analyze_bulk" || job.result?.bulk === true;
          if (isBulk && job.result?.bulk) {
            const r = job.result;
            setBulkMsg(
              `Finished: ${r.succeeded ?? 0}/${r.total ?? "?"} succeeded${
                r.failed ? `, ${r.failed} failed` : ""
              }.`,
            );
            setSelected(new Set());
            router.refresh();
            timeoutClear = setTimeout(() => {
              if (!cancelled) {
                setTrackedJobId(null);
                setTrackedJobType(null);
                setBulkExpectedTotal(null);
                setLastJob(null);
              }
            }, 2800);
          } else {
            setBulkMsg(null);
            router.refresh();
            timeoutClear = setTimeout(() => {
              if (!cancelled) {
                setTrackedJobId(null);
                setTrackedJobType(null);
                setBulkExpectedTotal(null);
                setLastJob(null);
              }
            }, 800);
          }
        }
      } catch {
        if (!cancelled) setBulkMsg("Could not load job status.");
      }
    };

    intervalId = setInterval(() => void poll(), BULK_POLL_MS);
    void poll();

    return () => {
      cancelled = true;
      stopPolling();
      if (timeoutClear) clearTimeout(timeoutClear);
    };
  }, [trackedJobId, clientSlug, orgSlug, router]);

  /**
   * Airtable-style 3-state cycle: none → desc → asc → none. Cycling back to
   * "none" lets the user remove sort entirely (was impossible before — clicking
   * the active column only flipped direction).
   */
  function handleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      // Higher value = more useful for almost every column here; default desc.
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortKey(null);
      setSortDir("desc");
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of postUrlVisible) next.delete(r.id);
      } else {
        for (const r of postUrlVisible) next.add(r.id);
      }
      return next;
    });
  }

  async function runBulkAnalyze() {
    if (!clientSlug.trim() || !orgSlug.trim()) {
      setBulkMsg("Missing client or organization context.");
      return;
    }
    const urls = selectedPostUrls.slice(0, BULK_MAX_URLS);
    if (!urls.length) {
      setBulkMsg("Select at least one reel that has a post link.");
      return;
    }

    setBulkMsg(null);
    const enq = await enqueueReelAnalyzeBulk(clientSlug, orgSlug, urls, {
      skip_apify: bulkSkipApify,
    });
    if (!enq.ok) {
      setBulkMsg(enq.error);
      return;
    }
    setBulkExpectedTotal(urls.length);
    setTrackedJobType("reel_analyze_bulk");
    setTrackedJobId(enq.job_id);
  }

  const disableReelAnalysis = Boolean(trackedJobId);
  const staleRunning =
    Boolean(
      trackedJobId &&
        lastJob &&
        (lastJob.status === "running" || lastJob.status === "queued") &&
        startedAtIsStale(lastJob.started_at),
    );

  const jt = lastJob?.job_type ?? trackedJobType ?? "";
  const prog = lastJob?.result?.progress;
  const totalSteps = Math.max(
    1,
    typeof prog?.total === "number"
      ? prog.total
      : jt === "reel_analyze_bulk"
        ? (bulkExpectedTotal ?? 1)
        : 1,
  );
  const done =
    typeof prog?.done === "number" ? Math.min(Math.max(0, prog.done), totalSteps) : 0;
  const floor = (done / totalSteps) * 100;
  const segSpan = (100 / totalSteps) * 0.88;
  const elapsed = wallMs - segmentStartMs;
  const tEase = Math.min(1, elapsed / SEGMENT_MS);
  let barPct = 0;
  if (!trackedJobId) barPct = 0;
  else if (lastJob?.status === "failed") barPct = 10;
  else if (lastJob?.status === "completed") barPct = 100;
  else if (!lastJob) barPct = 6;
  else
    barPct = Math.min(
      floor + tEase * segSpan,
      done < totalSteps ? floor + segSpan : 99,
    );

  void tick;

  let progressLabel = "";
  if (trackedJobId) {
    if (!lastJob) progressLabel = "Connecting to your analysis job…";
    else if (lastJob.status === "failed") progressLabel = "Stopped.";
    else if (lastJob.status === "completed") progressLabel = "Done.";
    else if (prog && prog.total > 0)
      progressLabel = `Reel ${prog.done + 1} of ${prog.total} — Silas is working`;
    else if (jt === "reel_analyze_url") progressLabel = "Analyzing one reel (scrape + video)…";
    else progressLabel = "Bulk analysis running…";
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <AppSelect
              label="Creator"
              value={creatorFilter}
              onChange={setCreatorFilter}
              options={[
                { value: "", label: "All creators" },
                ...creatorOptions.map((u) => ({ value: u, label: `@${u}` })),
              ]}
            />
            <AppSelect
              label="Analysis"
              value={analysisFilter}
              onChange={(v) => setAnalysisFilter(v as AnalysisFilter)}
              options={[
                { value: "all", label: "All reels" },
                { value: "analyzed", label: "Analyzed only" },
                { value: "pending", label: "Not analyzed" },
              ]}
            />
            <div className="flex flex-col">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle">
                Search
              </span>
              <div className="glass-inset relative inline-flex min-w-[220px] items-center rounded-lg border border-zinc-200/80 bg-white/80 text-sm text-zinc-900 shadow-sm transition-colors focus-within:border-zinc-300/90 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:focus-within:ring-amber-400/25">
                <Search
                  className="ml-2.5 h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-app-fg-faint"
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="@account, hook, or caption"
                  className="w-full bg-transparent px-2 py-2 text-sm placeholder:text-zinc-400 focus:outline-none dark:placeholder:text-app-fg-faint"
                  aria-label="Search reels by account, hook, or caption"
                />
                {searchInput ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                    className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 dark:text-app-fg-faint dark:hover:bg-white/10 dark:hover:text-app-fg-muted"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-[1_1_280px] flex-col gap-2">
            {trackedJobId ? (
              <IntelligenceProgressBar
                label={progressLabel}
                percent={barPct}
                status={
                  lastJob?.status === "running" ||
                  lastJob?.status === "queued" ||
                  lastJob?.status === "completed" ||
                  lastJob?.status === "failed"
                    ? lastJob.status
                    : null
                }
                staleHint={staleRunning}
                onDismissStale={() => {
                  setTrackedJobId(null);
                  setTrackedJobType(null);
                  setBulkExpectedTotal(null);
                  setLastJob(null);
                  setBulkMsg(null);
                }}
              />
            ) : null}
            <button
              type="button"
              disabled={disableReelAnalysis || selectedPostUrls.length === 0}
              onClick={() => void runBulkAnalyze()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-200"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Analyze selected
              {selectedPostUrls.length > 0 ? ` (${selectedPostUrls.length})` : ""}
            </button>
            {selectedPostUrls.length > BULK_MAX_URLS ? (
              <span className="text-[10px] text-amber-800/90 dark:text-amber-200/80">
                Only the first {BULK_MAX_URLS} will run per batch (API limit).
              </span>
            ) : null}
          </div>
        </div>
        {bulkMsg ? (
          <p className="text-xs text-zinc-600 dark:text-app-fg-muted" role="status">
            {bulkMsg}
          </p>
        ) : null}

        {(activeFilterCount > 0 || displayRows.length !== rows.length) ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-zinc-500 dark:text-app-fg-subtle">
              {displayRows.length === rows.length
                ? `${rows.length} reel${rows.length === 1 ? "" : "s"}`
                : `${displayRows.length} of ${rows.length} reel${rows.length === 1 ? "" : "s"}`}
            </span>
            {activeFilterCount > 0 ? (
              <span className="text-zinc-300 dark:text-app-fg-faint" aria-hidden>
                ·
              </span>
            ) : null}
            {creatorFilter ? (
              <FilterChip
                label="Creator"
                value={`@${creatorFilter}`}
                onClear={() => setCreatorFilter("")}
              />
            ) : null}
            {analysisFilter !== "all" ? (
              <FilterChip
                label="Analysis"
                value={analysisFilter === "analyzed" ? "Analyzed only" : "Not analyzed"}
                onClear={() => setAnalysisFilter("all")}
              />
            ) : null}
            {searchQuery ? (
              <FilterChip
                label="Search"
                value={`"${searchQuery}"`}
                onClear={() => {
                  setSearchInput("");
                  setSearchQuery("");
                }}
              />
            ) : null}
            {sortKey ? (
              <FilterChip
                label="Sort"
                value={`${SORT_KEY_LABELS[sortKey]} ${sortDir === "desc" ? "↓" : "↑"}`}
                onClear={() => {
                  setSortKey(null);
                  setSortDir("desc");
                }}
              />
            ) : null}
            {activeFilterCount > 0 ? (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-[11px] font-semibold text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              >
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200/90 bg-zinc-50/90 dark:border-white/10 dark:bg-zinc-950/60">
        <table className="w-full min-w-[1120px] border-collapse text-left [&_td]:cursor-default">
          <thead>
            <tr className="border-b border-zinc-200/90 text-[10px] uppercase tracking-widest text-zinc-500 dark:border-white/10 dark:text-app-fg-subtle">
              <th className="w-10 px-2 py-3 font-medium">
                {postUrlVisible.length > 0 ? (
                  <input
                    ref={headerSelectRef}
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-zinc-400 accent-amber-600"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all reels with a post link on this page"
                  />
                ) : null}
              </th>
              <th className="px-1 py-3 pr-2 font-medium tabular-nums">#</th>
              <th className="py-3 pr-2 font-medium">Thumb</th>
              <th className="py-3 pr-2 font-medium">Account</th>
              <SortHeader
                label="Score"
                hint="Silas score 0–100. Reels without a score haven't been analyzed yet — use Analyze to run one. Niche reels show a match instead of a score."
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
                label="Signal"
                hint="Why this reel surfaced. N× = beat the account's average by that multiple (competitor breakout). N% match = how closely it matches your niche keywords."
                active={sortKey === "outlier_ratio" || sortKey === "similarity_score"}
                dir={sortDir}
                onClick={() => handleSort("outlier_ratio")}
              />
              <SortHeader
                label="Comments"
                active={sortKey === "comments"}
                dir={sortDir}
                onClick={() => handleSort("comments")}
              />
              <SortHeader
                label="C/V"
                hint="Comments ÷ views — conversation rate. Higher % = more discussion per view."
                active={sortKey === "comment_view_ratio"}
                dir={sortDir}
                onClick={() => handleSort("comment_view_ratio")}
              />
              <SortHeader
                label="Saves"
                hint="From Instagram when exposed. Often empty — the platform doesn't always return saves."
                active={sortKey === "saves"}
                dir={sortDir}
                onClick={() => handleSort("saves")}
              />
              <SortHeader
                label="Shares"
                hint="Only when your Instagram data source includes share counts. May stay empty until your plan supports it."
                active={sortKey === "shares"}
                dir={sortDir}
                onClick={() => handleSort("shares")}
              />
              <SortHeader
                label="Likes"
                active={sortKey === "likes"}
                dir={sortDir}
                onClick={() => handleSort("likes")}
              />
              <SortHeader
                label="Dur."
                hint="Length in seconds when Instagram returns duration (not all reels include it)."
                active={sortKey === "video_duration"}
                dir={sortDir}
                onClick={() => handleSort("video_duration")}
              />
              <SortHeader
                label="Posted"
                active={sortKey === "posted_at"}
                dir={sortDir}
                onClick={() => handleSort("posted_at")}
              />
              <th className="py-3 pr-2 font-medium">Open / recreate</th>
            </tr>
          </thead>
          <tbody className="text-xs text-zinc-800 dark:text-app-fg-secondary">
            {pageRows.map((row, i) => {
              const a = row.analysis;
              const nicheMatch = isNicheMatchOnly(row);
              const silas = a && !nicheMatch ? formatSilasScoreSummary(a) : null;
              const canAnalyze = isAnalyzable(row);
              const hasPost = rowHasPostUrl(row);
              const rowIndex =
                pageSize === 0 ? i : (safePage - 1) * effectivePageSize + i;
              return (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100/90 transition-colors hover:bg-zinc-100/80 dark:border-white/[0.06] dark:hover:bg-white/[0.06]"
                >
                  <td className="px-2 py-2.5 align-middle">
                    {hasPost ? (
                      <input
                        type="checkbox"
                        disabled={disableReelAnalysis}
                        className="h-3.5 w-3.5 rounded border-zinc-400 accent-amber-600"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select reel @${row.account_username} for bulk analyze`}
                      />
                    ) : null}
                  </td>
                  <td className="px-1 py-2.5 pr-2 align-middle tabular-nums text-zinc-500 dark:text-app-fg-subtle">
                    {rowIndex + 1}
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
                    <div className="flex flex-col gap-0.5">
                      <span>@{row.account_username}</span>
                      {row.source === "keyword_similarity" ? (
                        <Tooltip content="Found via your niche keywords, not from a tracked competitor.">
                          <span className="w-fit rounded bg-purple-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
                            Niche match
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    {a && nicheMatch ? (
                      <div className="flex flex-col gap-0.5">
                        <Tooltip content="Niche-keyword analysis (no Silas score). Open it for the full match breakdown.">
                          <span className="w-fit rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
                            Niche match
                          </span>
                        </Tooltip>
                        <button
                          type="button"
                          onClick={() => setDetailReelId(row.id)}
                          className="w-fit text-left text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          View analysis
                        </button>
                      </div>
                    ) : a ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="whitespace-nowrap text-[10px] font-semibold text-emerald-700 dark:text-emerald-300/95">
                          {silas ? (
                            <>
                              {silas.scoreText}
                              <span className="font-normal opacity-80">{silas.maxSuffix}</span>
                              {silas.ratingText ? ` · ${silas.ratingText}` : ""}
                            </>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDetailReelId(row.id)}
                          className="w-fit text-left text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          View analysis
                        </button>
                        {hasPost ? (
                          <Tooltip content="Re-run Silas from saved data only (no new video download).">
                            <button
                              type="button"
                              disabled={disableReelAnalysis}
                              onClick={() => {
                                setAnalyzeSkipApify(true);
                                setAnalyzeInitialUrl(row.post_url!.trim());
                                setAnalyzeOpen(true);
                              }}
                              className="inline-flex w-fit items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-300"
                            >
                              <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                              Re-analyze
                            </button>
                          </Tooltip>
                        ) : null}
                      </div>
                    ) : canAnalyze ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-app-fg-muted">
                          Not scored yet
                        </span>
                        <Tooltip content="Run Silas video analysis (same as Intelligence toolbar).">
                          <button
                            type="button"
                            disabled={disableReelAnalysis}
                            onClick={() => {
                              setAnalyzeSkipApify(false);
                              setAnalyzeInitialUrl(row.post_url!.trim());
                              setAnalyzeOpen(true);
                            }}
                            className="inline-flex w-fit items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-300"
                          >
                            <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                            Analyze
                          </button>
                        </Tooltip>
                      </div>
                    ) : (
                      <Tooltip content="No post link saved — re-sync the source to enable analysis.">
                        <span className={EMPTY_CELL_CLASS}>—</span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.views != null ? row.views.toLocaleString() : "—"}
                  </td>
                  <td
                    className={
                      row.is_outlier === true
                        ? "py-2.5 pr-2 align-middle font-bold text-amber-600 dark:text-amber-400"
                        : row.similarity_score != null && row.outlier_ratio == null
                          ? "py-2.5 pr-2 align-middle font-bold text-purple-600 dark:text-purple-400"
                          : "py-2.5 pr-2 align-middle text-zinc-400 dark:text-app-fg-faint"
                    }
                  >
                    {row.outlier_ratio != null
                      ? `${Number(row.outlier_ratio).toFixed(1)}×`
                      : row.similarity_score != null
                        ? `${row.similarity_score}% match`
                        : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.comments != null ? row.comments.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums font-medium text-zinc-900 dark:text-app-fg">
                    {formatViewsToComments(row)}
                  </td>
                  <td
                    className={`py-2.5 pr-2 align-middle tabular-nums ${
                      row.saves != null && row.saves > 0 ? "" : EMPTY_CELL_CLASS
                    }`}
                  >
                    {row.saves != null ? row.saves.toLocaleString() : "—"}
                  </td>
                  <td
                    className={`py-2.5 pr-2 align-middle tabular-nums ${
                      row.shares != null && row.shares > 0 ? "" : EMPTY_CELL_CLASS
                    }`}
                  >
                    {row.shares != null ? row.shares.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.likes != null ? row.likes.toLocaleString() : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle tabular-nums">
                    {row.video_duration != null ? `${row.video_duration}s` : "—"}
                  </td>
                  <td className="py-2.5 pr-2 align-middle text-zinc-600 dark:text-app-fg-muted">
                    {formatPosted(row.posted_at)}
                  </td>
                  <td className="py-2.5 align-middle">
                    {row.post_url ? (
                      <div className="flex flex-col items-start gap-1">
                        <a
                          href={row.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          ↗
                        </a>
                        <Tooltip content="Adapt for your client — same format & idea as this reel (opens Generate).">
                          <button
                            type="button"
                            disabled={disableReelAnalysis}
                            onClick={() => setRecreateRow(row)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300/90"
                          >
                            <Clapperboard className="h-3 w-3 shrink-0" aria-hidden />
                            Recreate
                          </button>
                        </Tooltip>
                      </div>
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

      {displayRows.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-[11px] text-zinc-600 dark:text-app-fg-muted">
            {pageSize === 0 ? (
              <>Showing all {displayRows.length} reel{displayRows.length === 1 ? "" : "s"}</>
            ) : (
              <>
                Showing {(safePage - 1) * effectivePageSize + 1}–
                {Math.min(safePage * effectivePageSize, displayRows.length)} of {displayRows.length}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <AppSelect
              label="Per page"
              value={pageSize === 0 ? "all" : String(pageSize)}
              onChange={(v) => {
                if (v === "all") {
                  setPageSize(0);
                  setPage(1);
                } else {
                  setPageSize(Number(v));
                  setPage(1);
                }
              }}
              options={[
                ...PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} per page` })),
                { value: "all", label: "Show all" },
              ]}
            />
            {pageSize > 0 && totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-app-fg-secondary dark:hover:bg-white/[0.06]"
                >
                  Previous
                </button>
                <span className="px-2 text-[11px] text-zinc-600 dark:text-app-fg-muted">
                  Page {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-app-fg-secondary dark:hover:bg-white/[0.06]"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
          setAnalyzeSkipApify(false);
        }}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        initialUrl={analyzeInitialUrl}
        skipApify={analyzeSkipApify}
        disabled={Boolean(disableReelAnalysis && !analyzeOpen)}
        disabledHint="An analysis is already running. Wait for it to finish or dismiss the stalled bar."
        onAnalysisJobEnqueued={(jobId) => {
          setTrackedJobType("reel_analyze_url");
          setTrackedJobId(jobId);
          setBulkExpectedTotal(null);
        }}
      />
      <RecreateReelModal
        open={recreateRow != null}
        onClose={() => setRecreateRow(null)}
        reel={recreateRow}
        clientSlug={clientSlug}
        orgSlug={orgSlug}
        disabled={Boolean(disableReelAnalysis)}
        disabledHint="An analysis job is running. Wait for it to finish or dismiss the stalled bar."
      />
    </>
  );
}
