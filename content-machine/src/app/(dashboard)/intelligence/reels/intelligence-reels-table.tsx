"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clapperboard,
  Info,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { ReelThumbnail } from "@/components/reel-thumbnail";
import { AppSelect } from "@/components/ui/app-select";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReelsListSortBy, ScrapedReelRow } from "@/lib/api";
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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page-local sort keys are columns the server can't sort on (joined from
 * reel_analyses, or computed from base columns). They only ever apply as a
 * secondary sort over the loaded page.
 */
type LocalSortKey = "total_score" | "comment_view_ratio";
type AnySortKey = ReelsListSortBy | LocalSortKey;

type AnalysisFilter = "all" | "analyzed" | "pending";

/** Mirrors the URL state owned by the page-level Server Component. */
type ServerState = {
  sortBy: ReelsListSortBy;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  creator: string;
  outliersOnly: boolean;
  source: string;
  competitorId: string;
  minViews: number | null;
  maxViews: number | null;
  minLikes: number | null;
  maxLikes: number | null;
  minComments: number | null;
  maxComments: number | null;
  postedAfter: string | null;
  postedBefore: string | null;
};

type Props = {
  rows: ScrapedReelRow[];
  /** Total matching rows (across all pages) — from X-Total-Count. */
  total: number;
  clientSlug: string;
  orgSlug: string;
  serverState: ServerState;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants & small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Sort keys the backend can ORDER BY directly. */
const SERVER_SORT_KEYS: ReadonlySet<string> = new Set<ReelsListSortBy>([
  "posted_at",
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "outlier_ratio",
  "similarity_score",
  "video_duration",
  "first_seen_at",
]);

const SORT_KEY_LABELS: Record<AnySortKey, string> = {
  posted_at: "Posted",
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  saves: "Saves",
  shares: "Shares",
  outlier_ratio: "Signal",
  similarity_score: "Signal",
  video_duration: "Duration",
  first_seen_at: "First seen",
  total_score: "Score",
  comment_view_ratio: "C/V",
};

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;
const BULK_POLL_MS = 2500;
const BULK_MAX_URLS = 20;
const SEGMENT_MS = 20_000;
const STALE_MS = 15 * 60 * 1000;
/** Subtle styling for empty cells (`0` or `—`) so populated values pop. */
const EMPTY_CELL_CLASS = "text-zinc-400 dark:text-app-fg-faint";

function formatPosted(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function startedAtIsStale(startedAt: string | null | undefined): boolean {
  if (!startedAt) return false;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t > STALE_MS;
}

function rowHasPostUrl(row: ScrapedReelRow): boolean {
  return Boolean(row.post_url?.trim());
}

function isAnalyzable(row: ScrapedReelRow): boolean {
  return Boolean(row.post_url?.trim() && !row.analysis);
}

/**
 * Niche-keyword analyses (source = "keyword_similarity") write to a different
 * payload shape than Silas scoring — the score columns end up null/0. Detect
 * this combo so we render the row's actual content instead of a fake "0/50".
 */
function isNicheMatchOnly(row: ScrapedReelRow): boolean {
  const a = row.analysis;
  if (!a) return false;
  const hasSilasScore =
    a.weighted_total != null || (a.total_score != null && a.total_score > 0);
  return row.source === "keyword_similarity" && !hasSilasScore;
}

/** Compares two rows for the given sort key (always ascending; caller flips). */
function compareForSort(a: ScrapedReelRow, b: ScrapedReelRow, key: AnySortKey): number {
  const num = (va: number | null | undefined, vb: number | null | undefined) => {
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return va - vb;
  };
  switch (key) {
    case "views":
      return num(a.views, b.views);
    case "likes":
      return num(a.likes, b.likes);
    case "comments":
      return num(a.comments, b.comments);
    case "saves":
      return num(a.saves, b.saves);
    case "shares":
      return num(a.shares, b.shares);
    case "video_duration":
      return num(a.video_duration, b.video_duration);
    case "comment_view_ratio": {
      const va = viewsToCommentsRatio(a);
      const vb = viewsToCommentsRatio(b);
      return num(va == null ? null : Number(va), vb == null ? null : Number(vb));
    }
    case "outlier_ratio":
    case "similarity_score": {
      const va = a.outlier_ratio ?? a.similarity_score ?? null;
      const vb = b.outlier_ratio ?? b.similarity_score ?? null;
      return num(va, vb);
    }
    case "posted_at":
    case "first_seen_at": {
      const ka = key === "posted_at" ? a.posted_at : a.first_seen_at;
      const kb = key === "posted_at" ? b.posted_at : b.first_seen_at;
      const ta = ka ? new Date(ka).getTime() : NaN;
      const tb = kb ? new Date(kb).getTime() : NaN;
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

// ─────────────────────────────────────────────────────────────────────────────
// SortHeader
// ─────────────────────────────────────────────────────────────────────────────

function SortHeader({
  label,
  primaryActive,
  primaryDir,
  secondaryActive,
  secondaryDir,
  onClick,
  hint,
  serverSortable,
}: {
  label: string;
  primaryActive: boolean;
  primaryDir: "asc" | "desc";
  secondaryActive: boolean;
  secondaryDir: "asc" | "desc";
  onClick: (withShift: boolean) => void;
  hint?: string;
  /**
   * False = column is page-local sort only (joined / computed). Header still
   * works; we just skip the "primary indicator badge" since it can't drive
   * the URL/server.
   */
  serverSortable: boolean;
}) {
  const ariaSort = primaryActive
    ? primaryDir === "desc"
      ? "descending"
      : "ascending"
    : "none";
  const showSecondary = secondaryActive && !primaryActive;
  const hasInfo = Boolean(hint) || !serverSortable;
  const tooltipText = !serverSortable
    ? `${hint ? hint + " " : ""}This column sorts the current page only.`
    : (hint as string);
  // Stop bubbling on the Info trigger so clicking it never toggles sort. The
  // Tooltip itself opens on hover/focus, not click — the icon stays a passive
  // affordance that stays glued to the label without stealing the sort gesture.
  const stopBubble = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <th aria-sort={ariaSort} className="py-3 pr-2 font-medium">
      <button
        type="button"
        onClick={(e) => onClick(e.shiftKey)}
        className={`group inline-flex items-center gap-0.5 rounded text-left uppercase tracking-widest transition-colors ${
          primaryActive || showSecondary
            ? "text-zinc-800 dark:text-app-fg"
            : "text-zinc-500 hover:text-zinc-700 dark:text-app-fg-subtle dark:hover:text-app-fg-muted"
        }`}
        aria-label={`Sort by ${label}${
          primaryActive ? `, currently ${primaryDir === "desc" ? "descending" : "ascending"}` : ""
        }${secondaryActive ? `, also a secondary sort ${secondaryDir === "desc" ? "descending" : "ascending"}` : ""}. Shift+click to add as a secondary sort.`}
      >
        <span>{label}</span>
        {hasInfo ? (
          <Tooltip content={tooltipText}>
            <span
              role="img"
              aria-label={`What is ${label}?`}
              tabIndex={0}
              onClick={stopBubble}
              onMouseDown={stopBubble}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className="inline-flex cursor-help items-center text-zinc-400 transition-colors hover:text-zinc-700 dark:text-app-fg-faint dark:hover:text-app-fg-muted"
            >
              <Info className="h-3 w-3" aria-hidden />
            </span>
          </Tooltip>
        ) : null}
        {primaryActive ? (
          primaryDir === "desc" ? (
            <ArrowDown className="ml-0.5 h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ArrowUp className="ml-0.5 h-3 w-3 shrink-0" aria-hidden />
          )
        ) : showSecondary ? (
          secondaryDir === "desc" ? (
            <ArrowDown className="ml-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden />
          ) : (
            <ArrowUp className="ml-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden />
          )
        ) : (
          <ChevronsUpDown
            className="ml-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50"
            aria-hidden
          />
        )}
        {showSecondary ? (
          <span
            className="ml-0.5 rounded bg-zinc-200 px-1 text-[8px] font-bold text-zinc-700 dark:bg-white/15 dark:text-app-fg-muted"
            aria-hidden
          >
            2
          </span>
        ) : null}
      </button>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterChip
// ─────────────────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: ReactNode;
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

// ─────────────────────────────────────────────────────────────────────────────
// Range filters popover
// ─────────────────────────────────────────────────────────────────────────────

type DraftRanges = {
  minViews: string;
  maxViews: string;
  minLikes: string;
  maxLikes: string;
  minComments: string;
  maxComments: string;
  postedAfter: string;
  postedBefore: string;
};

function emptyDraftFromState(s: ServerState): DraftRanges {
  return {
    minViews: s.minViews?.toString() ?? "",
    maxViews: s.maxViews?.toString() ?? "",
    minLikes: s.minLikes?.toString() ?? "",
    maxLikes: s.maxLikes?.toString() ?? "",
    minComments: s.minComments?.toString() ?? "",
    maxComments: s.maxComments?.toString() ?? "",
    postedAfter: s.postedAfter ?? "",
    postedBefore: s.postedBefore ?? "",
  };
}

function RangeInput({
  value,
  onChange,
  placeholder,
  type = "number",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: "number" | "date";
}) {
  return (
    <input
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={type === "number" ? 0 : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-md border border-zinc-200/80 bg-white/90 px-2 text-xs text-zinc-900 shadow-sm transition-colors focus:border-zinc-300/90 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:focus:ring-amber-400/25"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling types (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function IntelligenceReelsTable({
  rows,
  total,
  clientSlug,
  orgSlug,
  serverState,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ─── URL-state setter ────────────────────────────────────────────────────
  // Given a sparse patch of search-params updates, rebuild the URL and push it.
  // Centralizing here keeps every "change a server filter" call site short,
  // and guarantees we always reset to page=1 unless explicitly preserved.
  const pushFilters = useCallback(
    (
      patch: Record<string, string | number | null | undefined>,
      opts: { keepPage?: boolean } = {},
    ) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") {
          next.delete(k);
        } else {
          next.set(k, String(v));
        }
      }
      if (!opts.keepPage && !("page" in patch)) {
        next.delete("page");
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const resetServerFilters = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  // ─── Client-only state ───────────────────────────────────────────────────
  const [detailReelId, setDetailReelId] = useState<string | null>(null);
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  /** Page-local secondary sort. Always applied AFTER the server-sorted page. */
  const [secondarySort, setSecondarySort] = useState<{
    key: AnySortKey;
    dir: "asc" | "desc";
  } | null>(null);

  /** Page-local primary sort, used when the column isn't server-sortable. */
  const [localPrimarySort, setLocalPrimarySort] = useState<{
    key: LocalSortKey;
    dir: "asc" | "desc";
  } | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftRanges, setDraftRanges] = useState<DraftRanges>(() =>
    emptyDraftFromState(serverState),
  );

  // Keep the draft in sync when the URL changes from the outside (back button,
  // chip clear, etc).
  useEffect(() => {
    setDraftRanges(emptyDraftFromState(serverState));
  }, [serverState]);

  // Bulk / job state (unchanged from previous version).
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeInitialUrl, setAnalyzeInitialUrl] = useState<string | null>(null);
  const [analyzeSkipApify, setAnalyzeSkipApify] = useState(false);
  const [recreateRow, setRecreateRow] = useState<ScrapedReelRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [trackedJobType, setTrackedJobType] = useState<
    "reel_analyze_bulk" | "reel_analyze_url" | null
  >(null);
  const [bulkExpectedTotal, setBulkExpectedTotal] = useState<number | null>(null);
  const [lastJob, setLastJob] = useState<TrackedJobPoll | null>(null);
  const [tick, setTick] = useState(0);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const segmentDoneRef = useRef<number>(-999);
  const [wallMs, setWallMs] = useState(0);
  const [segmentStartMs, setSegmentStartMs] = useState(0);
  const pollTerminalHandledRef = useRef(false);
  const prevTrackedJobIdRef = useRef<string | null>(null);

  // ─── Debounced text search (page-local) ─────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchInput]);

  // ─── Client-side derivations ────────────────────────────────────────────
  const creatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.account_username?.trim()) set.add(r.account_username.trim());
    if (serverState.creator) set.add(serverState.creator);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows, serverState.creator]);

  const displayRows = useMemo(() => {
    let out = rows;
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
    // Sort precedence: page-local primary (only for non-server columns) →
    // server primary order (already applied by API) → page-local secondary.
    // Array.sort is stable since ES2019, so applying secondary alone keeps
    // the server order as the implicit tiebreaker.
    if (localPrimarySort) {
      const copy = [...out];
      copy.sort((a, b) => {
        const base = compareForSort(a, b, localPrimarySort.key);
        return localPrimarySort.dir === "asc" ? base : -base;
      });
      out = copy;
    }
    if (secondarySort) {
      const copy = [...out];
      copy.sort((a, b) => {
        const base = compareForSort(a, b, secondarySort.key);
        return secondarySort.dir === "asc" ? base : -base;
      });
      out = copy;
    }
    return out;
  }, [rows, analysisFilter, searchQuery, localPrimarySort, secondarySort]);

  // ─── Bulk-selection helpers ─────────────────────────────────────────────
  const postUrlVisible = useMemo(
    () => displayRows.filter((r) => rowHasPostUrl(r)),
    [displayRows],
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

  // ─── Job polling (unchanged) ────────────────────────────────────────────
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

  // ─── Sort handlers ──────────────────────────────────────────────────────
  /**
   * Click on a header. Shift+click adds/cycles a secondary sort (page-local).
   * Plain click sets primary: for server-sortable columns this pushes the new
   * sort to the URL (server re-fetches); for non-server columns it sets a
   * page-local primary so users can still re-order Score / C/V locally.
   *
   * Both primary tracks use a 3-state cycle (none → desc → asc → none) so a
   * third click clears the sort entirely.
   */
  const handleSort = useCallback(
    (key: AnySortKey, withShift: boolean) => {
      if (withShift) {
        setSecondarySort((cur) => {
          if (!cur || cur.key !== key) return { key, dir: "desc" };
          if (cur.dir === "desc") return { key, dir: "asc" };
          return null;
        });
        return;
      }
      // Primary click clears any secondary so users don't get surprised by
      // a stale "page 2" sort still influencing the new primary.
      setSecondarySort(null);

      if (SERVER_SORT_KEYS.has(key)) {
        setLocalPrimarySort(null);
        const k = key as ReelsListSortBy;
        if (serverState.sortBy === k) {
          if (serverState.sortDir === "desc") {
            pushFilters({ sort: k, dir: "asc", page: null });
          } else {
            // Cycle off → reset to default (posted_at desc).
            pushFilters({ sort: null, dir: null, page: null });
          }
        } else {
          pushFilters({ sort: k, dir: "desc", page: null });
        }
      } else {
        // Page-local primary for joined/computed columns.
        const local = key as LocalSortKey;
        setLocalPrimarySort((cur) => {
          if (!cur || cur.key !== local) return { key: local, dir: "desc" };
          if (cur.dir === "desc") return { key: local, dir: "asc" };
          return null;
        });
      }
    },
    [pushFilters, serverState.sortBy, serverState.sortDir],
  );

  // ─── Selection helpers ──────────────────────────────────────────────────
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

  // ─── Range filter apply/clear ───────────────────────────────────────────
  const applyRanges = useCallback(() => {
    const toNum = (s: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number.parseInt(t, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    pushFilters({
      min_views: toNum(draftRanges.minViews),
      max_views: toNum(draftRanges.maxViews),
      min_likes: toNum(draftRanges.minLikes),
      max_likes: toNum(draftRanges.maxLikes),
      min_comments: toNum(draftRanges.minComments),
      max_comments: toNum(draftRanges.maxComments),
      posted_after: draftRanges.postedAfter || null,
      posted_before: draftRanges.postedBefore || null,
      page: null,
    });
    setFiltersOpen(false);
  }, [draftRanges, pushFilters]);

  const hasAnyDraftRange =
    Object.values(draftRanges).some((v) => v.trim() !== "");

  const clearDraftRanges = () => {
    setDraftRanges({
      minViews: "",
      maxViews: "",
      minLikes: "",
      maxLikes: "",
      minComments: "",
      maxComments: "",
      postedAfter: "",
      postedBefore: "",
    });
  };

  // ─── Progress bar derivations (unchanged) ───────────────────────────────
  const disableReelAnalysis = Boolean(trackedJobId);
  const staleRunning = Boolean(
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

  // ─── Pagination derivations ─────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / serverState.pageSize));
  const safePage = Math.min(serverState.page, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * serverState.pageSize + 1;
  const rangeEnd = Math.min(safePage * serverState.pageSize, total);

  // ─── Active filter chip data ────────────────────────────────────────────
  const sortChipText = (() => {
    if (localPrimarySort) {
      return `${SORT_KEY_LABELS[localPrimarySort.key]} ${localPrimarySort.dir === "desc" ? "↓" : "↑"} (page)`;
    }
    if (serverState.sortBy !== "posted_at" || serverState.sortDir !== "desc") {
      return `${SORT_KEY_LABELS[serverState.sortBy]} ${serverState.sortDir === "desc" ? "↓" : "↑"}`;
    }
    return null;
  })();

  const fmtRange = (lo: number | null, hi: number | null, suffix = "") => {
    if (lo != null && hi != null) return `${lo.toLocaleString()}–${hi.toLocaleString()}${suffix}`;
    if (lo != null) return `≥ ${lo.toLocaleString()}${suffix}`;
    if (hi != null) return `≤ ${hi.toLocaleString()}${suffix}`;
    return null;
  };

  const viewsChip = fmtRange(serverState.minViews, serverState.maxViews);
  const likesChip = fmtRange(serverState.minLikes, serverState.maxLikes);
  const commentsChip = fmtRange(serverState.minComments, serverState.maxComments);
  const postedChip = (() => {
    if (serverState.postedAfter && serverState.postedBefore)
      return `${serverState.postedAfter} → ${serverState.postedBefore}`;
    if (serverState.postedAfter) return `from ${serverState.postedAfter}`;
    if (serverState.postedBefore) return `until ${serverState.postedBefore}`;
    return null;
  })();

  const serverFilterCount =
    (serverState.creator ? 1 : 0) +
    (viewsChip ? 1 : 0) +
    (likesChip ? 1 : 0) +
    (commentsChip ? 1 : 0) +
    (postedChip ? 1 : 0);
  const clientFilterCount =
    (analysisFilter !== "all" ? 1 : 0) +
    (searchQuery ? 1 : 0) +
    (sortChipText ? 1 : 0) +
    (secondarySort ? 1 : 0);
  const activeFilterCount = serverFilterCount + clientFilterCount;

  const clearAllFilters = () => {
    setAnalysisFilter("all");
    setSearchInput("");
    setSearchQuery("");
    setSecondarySort(null);
    setLocalPrimarySort(null);
    resetServerFilters();
  };

  // Page-size handler keeps us on a sensible page after the size changes.
  const onPageSizeChange = (v: string) => {
    const next = Number.parseInt(v, 10);
    if (!Number.isFinite(next) || next <= 0) return;
    pushFilters({ per: next, page: 1 });
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
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

        {/* Primary toolbar — every control sits on h-9 baseline. */}
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect
            ariaLabel="Filter by creator"
            triggerClassName="h-9 min-w-[160px] py-0"
            value={serverState.creator}
            onChange={(v) => pushFilters({ creator: v || null, page: null })}
            options={[
              { value: "", label: "All creators" },
              ...creatorOptions.map((u) => ({ value: u, label: `@${u}` })),
            ]}
          />
          <AppSelect
            ariaLabel="Filter by analysis state"
            triggerClassName="h-9 min-w-[160px] py-0"
            value={analysisFilter}
            onChange={(v) => setAnalysisFilter(v as AnalysisFilter)}
            options={[
              { value: "all", label: "All reels" },
              { value: "analyzed", label: "Analyzed only" },
              { value: "pending", label: "Not analyzed" },
            ]}
          />
          <div className="glass-inset relative flex h-9 min-w-[220px] items-center rounded-lg border border-zinc-200/80 bg-white/80 text-sm text-zinc-900 shadow-sm transition-colors focus-within:border-zinc-300/90 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg dark:focus-within:ring-amber-400/25">
            <Search
              className="ml-2.5 h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-app-fg-faint"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search account, hook, caption…"
              className="h-full w-full bg-transparent px-2 text-sm placeholder:text-zinc-400 focus:outline-none dark:placeholder:text-app-fg-faint"
              aria-label="Search reels by account, hook, or caption (current page)"
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

          {/* Range Filters — single popover so the toolbar stays clean. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                serverFilterCount > 0
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
                  : "border-zinc-200/80 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900/80 dark:text-app-fg-secondary dark:hover:bg-white/[0.06]"
              }`}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Filters
              {serverFilterCount > 0 ? (
                <span className="ml-0.5 rounded bg-amber-600/80 px-1 text-[10px] font-bold text-white dark:bg-amber-500/90">
                  {serverFilterCount}
                </span>
              ) : null}
            </button>

            {filtersOpen ? (
              <div
                className="absolute right-0 top-full z-40 mt-2 w-[320px] rounded-xl border border-zinc-200/90 bg-white p-4 shadow-xl dark:border-white/12 dark:bg-zinc-900"
                role="dialog"
                aria-label="Range filters"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-app-fg-muted">
                    Range filters
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-app-fg"
                    aria-label="Close filters"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  {[
                    {
                      label: "Views",
                      minKey: "minViews" as const,
                      maxKey: "maxViews" as const,
                    },
                    {
                      label: "Likes",
                      minKey: "minLikes" as const,
                      maxKey: "maxLikes" as const,
                    },
                    {
                      label: "Comments",
                      minKey: "minComments" as const,
                      maxKey: "maxComments" as const,
                    },
                  ].map((row) => (
                    <div key={row.label} className="flex flex-col gap-1">
                      <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle">
                        {row.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <RangeInput
                          value={draftRanges[row.minKey]}
                          onChange={(v) =>
                            setDraftRanges((d) => ({ ...d, [row.minKey]: v }))
                          }
                          placeholder="min"
                        />
                        <span className="text-zinc-400 dark:text-app-fg-faint" aria-hidden>
                          –
                        </span>
                        <RangeInput
                          value={draftRanges[row.maxKey]}
                          onChange={(v) =>
                            setDraftRanges((d) => ({ ...d, [row.maxKey]: v }))
                          }
                          placeholder="max"
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-app-fg-subtle">
                      Posted between
                    </label>
                    <div className="flex items-center gap-2">
                      <RangeInput
                        type="date"
                        value={draftRanges.postedAfter}
                        onChange={(v) =>
                          setDraftRanges((d) => ({ ...d, postedAfter: v }))
                        }
                        placeholder="from"
                      />
                      <span className="text-zinc-400 dark:text-app-fg-faint" aria-hidden>
                        –
                      </span>
                      <RangeInput
                        type="date"
                        value={draftRanges.postedBefore}
                        onChange={(v) =>
                          setDraftRanges((d) => ({ ...d, postedBefore: v }))
                        }
                        placeholder="to"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={clearDraftRanges}
                    disabled={!hasAnyDraftRange}
                    className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-app-fg-subtle dark:hover:text-app-fg"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={applyRanges}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-600"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            disabled={disableReelAnalysis || selectedPostUrls.length === 0}
            onClick={() => void runBulkAnalyze()}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40 dark:text-amber-200"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Analyze selected
            {selectedPostUrls.length > 0 ? ` (${selectedPostUrls.length})` : ""}
          </button>
        </div>

        {selectedPostUrls.length > BULK_MAX_URLS ? (
          <span className="text-[10px] text-amber-800/90 dark:text-amber-200/80">
            Only the first {BULK_MAX_URLS} will run per batch (API limit).
          </span>
        ) : null}
        {bulkMsg ? (
          <p className="text-xs text-zinc-600 dark:text-app-fg-muted" role="status">
            {bulkMsg}
          </p>
        ) : null}

        {/* Result count + active-filter chip strip */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-zinc-500 dark:text-app-fg-subtle">
            {total === 0
              ? "No reels"
              : displayRows.length === rows.length
                ? `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`
                : `Showing ${displayRows.length} of ${rows.length} on this page (${total.toLocaleString()} total)`}
          </span>
          {activeFilterCount > 0 ? (
            <>
              <span className="text-zinc-300 dark:text-app-fg-faint" aria-hidden>
                ·
              </span>
              {serverState.creator ? (
                <FilterChip
                  label="Creator"
                  value={`@${serverState.creator}`}
                  onClear={() => pushFilters({ creator: null, page: null })}
                />
              ) : null}
              {viewsChip ? (
                <FilterChip
                  label="Views"
                  value={viewsChip}
                  onClear={() =>
                    pushFilters({ min_views: null, max_views: null, page: null })
                  }
                />
              ) : null}
              {likesChip ? (
                <FilterChip
                  label="Likes"
                  value={likesChip}
                  onClear={() =>
                    pushFilters({ min_likes: null, max_likes: null, page: null })
                  }
                />
              ) : null}
              {commentsChip ? (
                <FilterChip
                  label="Comments"
                  value={commentsChip}
                  onClear={() =>
                    pushFilters({ min_comments: null, max_comments: null, page: null })
                  }
                />
              ) : null}
              {postedChip ? (
                <FilterChip
                  label="Posted"
                  value={postedChip}
                  onClear={() =>
                    pushFilters({ posted_after: null, posted_before: null, page: null })
                  }
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
              {sortChipText ? (
                <FilterChip
                  label="Sort"
                  value={sortChipText}
                  onClear={() => {
                    if (localPrimarySort) {
                      setLocalPrimarySort(null);
                    } else {
                      pushFilters({ sort: null, dir: null, page: null });
                    }
                  }}
                />
              ) : null}
              {secondarySort ? (
                <FilterChip
                  label="Then by"
                  value={`${SORT_KEY_LABELS[secondarySort.key]} ${secondarySort.dir === "desc" ? "↓" : "↑"} (page)`}
                  onClear={() => setSecondarySort(null)}
                />
              ) : null}
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-[11px] font-semibold text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              >
                Clear all
              </button>
            </>
          ) : null}
        </div>
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
                hint="Silas score 0–100. Reels without a score haven't been analyzed yet — use Analyze to run one. Niche-match reels are scored on keyword similarity instead (see Signal)."
                serverSortable={false}
                primaryActive={localPrimarySort?.key === "total_score"}
                primaryDir={localPrimarySort?.dir ?? "desc"}
                secondaryActive={secondarySort?.key === "total_score"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("total_score", s)}
              />
              <SortHeader
                label="Views"
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "views"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "views"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("views", s)}
              />
              <SortHeader
                label="Signal"
                hint="Why this reel surfaced. ↗ N× = competitor breakout (beat the creator's own average by that multiple). ◎ N% = niche-keyword match score. Each row shows only one — they're independent signals."
                serverSortable
                primaryActive={
                  !localPrimarySort &&
                  (serverState.sortBy === "outlier_ratio" ||
                    serverState.sortBy === "similarity_score")
                }
                primaryDir={serverState.sortDir}
                secondaryActive={
                  secondarySort?.key === "outlier_ratio" ||
                  secondarySort?.key === "similarity_score"
                }
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("outlier_ratio", s)}
              />
              <SortHeader
                label="Comments"
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "comments"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "comments"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("comments", s)}
              />
              <SortHeader
                label="C/V"
                hint="Comments ÷ views — conversation rate. Higher % = more discussion per view."
                serverSortable={false}
                primaryActive={localPrimarySort?.key === "comment_view_ratio"}
                primaryDir={localPrimarySort?.dir ?? "desc"}
                secondaryActive={secondarySort?.key === "comment_view_ratio"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("comment_view_ratio", s)}
              />
              <SortHeader
                label="Saves"
                hint="From Instagram when exposed. Often empty — the platform doesn't always return saves."
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "saves"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "saves"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("saves", s)}
              />
              <SortHeader
                label="Shares"
                hint="Only when your Instagram data source includes share counts. May stay empty until your plan supports it."
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "shares"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "shares"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("shares", s)}
              />
              <SortHeader
                label="Likes"
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "likes"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "likes"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("likes", s)}
              />
              <SortHeader
                label="Dur."
                hint="Length in seconds when Instagram returns duration (not all reels include it)."
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "video_duration"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "video_duration"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("video_duration", s)}
              />
              <SortHeader
                label="Posted"
                serverSortable
                primaryActive={!localPrimarySort && serverState.sortBy === "posted_at"}
                primaryDir={serverState.sortDir}
                secondaryActive={secondarySort?.key === "posted_at"}
                secondaryDir={secondarySort?.dir ?? "desc"}
                onClick={(s) => handleSort("posted_at", s)}
              />
              <th className="py-3 pr-2 font-medium">Open / recreate</th>
            </tr>
          </thead>
          <tbody className="text-xs text-zinc-800 dark:text-app-fg-secondary">
            {displayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="py-12 text-center text-sm text-zinc-500 dark:text-app-fg-muted"
                >
                  {total === 0
                    ? "No reels match the current filters."
                    : "No reels match on this page — try clearing the page-local search/analysis filter."}
                </td>
              </tr>
            ) : null}
            {displayRows.map((row, i) => {
              const a = row.analysis;
              const nicheMatch = isNicheMatchOnly(row);
              const silas = a && !nicheMatch ? formatSilasScoreSummary(a) : null;
              const canAnalyze = isAnalyzable(row);
              const hasPost = rowHasPostUrl(row);
              const rowIndex = (safePage - 1) * serverState.pageSize + i;
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
                          <span className="w-fit text-[10px] font-normal text-purple-600 dark:text-purple-400">
                            niche
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2.5 pr-2 align-middle">
                    {a && nicheMatch ? (
                      <Tooltip content="Niche-keyword analysis. Open it for the full match breakdown.">
                        <button
                          type="button"
                          onClick={() => setDetailReelId(row.id)}
                          className="w-fit text-left text-[10px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
                        >
                          View analysis
                        </button>
                      </Tooltip>
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
                  <td className="py-2.5 pr-2 align-middle">
                    {row.outlier_ratio != null ? (
                      <Tooltip
                        content={`Beat @${row.account_username}'s recent average by ${Number(
                          row.outlier_ratio,
                        ).toFixed(1)}×. This is a competitor breakout.`}
                      >
                        <span
                          className={`inline-flex items-center gap-1 font-bold tabular-nums ${
                            row.is_outlier === true
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-zinc-600 dark:text-app-fg-secondary"
                          }`}
                        >
                          <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
                          {Number(row.outlier_ratio).toFixed(1)}×
                        </span>
                      </Tooltip>
                    ) : row.similarity_score != null ? (
                      <Tooltip content={`Matches your niche keywords by ${row.similarity_score}%.`}>
                        <span className="inline-flex items-center gap-1 font-bold tabular-nums text-purple-600 dark:text-purple-400">
                          <Target className="h-3 w-3 shrink-0" aria-hidden />
                          {row.similarity_score}%
                        </span>
                      </Tooltip>
                    ) : (
                      <span className={EMPTY_CELL_CLASS}>—</span>
                    )}
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

      {total > 0 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-[11px] text-zinc-600 dark:text-app-fg-muted">
            Showing {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <AppSelect
              ariaLabel="Rows per page"
              triggerClassName="h-8 min-w-[120px] py-0 text-[11px]"
              value={String(serverState.pageSize)}
              onChange={onPageSizeChange}
              options={PAGE_SIZE_OPTIONS.map((n) => ({
                value: String(n),
                label: `${n} per page`,
              }))}
            />
            {totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => pushFilters({ page: Math.max(1, safePage - 1) }, { keepPage: true })}
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
                  onClick={() => pushFilters({ page: Math.min(totalPages, safePage + 1) }, { keepPage: true })}
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
