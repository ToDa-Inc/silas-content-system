/**
 * Server-side fetch to FastAPI — profiles.api_key as X-Api-Key + X-Org-Slug.
 * Per-request context is cached (React cache) so parallel fetches don’t repeat Supabase work.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { resolveProfileApiKeyForServer } from "@/lib/supabase/service-admin";
import { tryLoadServerWorkspace } from "@/lib/server-workspace";
import { getContentApiBase } from "@/lib/env";
import { resolveTenancy, type ResolvedTenancy } from "@/lib/tenancy";
import { ACTIVE_CLIENT_SLUG_COOKIE } from "@/lib/workspace-cookie";
import type { ReelAnalysisSummary } from "@/lib/reel-types";

export { getContentApiBase } from "@/lib/env";
export type { ReelAnalysisDetail, ReelAnalysisSummary } from "@/lib/reel-types";

export function getApiBase(): string {
  return getContentApiBase();
}

export type ServerApiContext = {
  headers: HeadersInit;
  clientSlug: string;
  orgSlug: string;
  user: User | null;
  tenancy: ResolvedTenancy | null;
  /**
   * Client list for the sidebar when workspace was loaded with the service role.
   * `null` means the anon/RLS path was used instead — layout may run its own query.
   */
  workspaceClients: { slug: string; name: string }[] | null;
};

async function loadServerApiContext(): Promise<ServerApiContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  const preferredClient = cookieStore.get(ACTIVE_CLIENT_SLUG_COOKIE)?.value ?? null;
  let tenancy: ResolvedTenancy | null = null;
  let workspaceClients: { slug: string; name: string }[] | null = null;

  if (user?.id) {
    const ws = await tryLoadServerWorkspace(user.id, preferredClient);
    if (ws.ok) {
      tenancy = ws.tenancy;
      workspaceClients = ws.clients;
    } else {
      tenancy = await resolveTenancy(supabase, user.id, preferredClient);
    }
  }

  /** Org + client from service-role workspace when available, else anon `resolveTenancy`. */
  const orgSlug = tenancy?.orgSlug || "";
  const clientSlug = tenancy?.clientSlug?.trim() || "";

  const h: Record<string, string> = {};
  if (orgSlug) {
    h["X-Org-Slug"] = orgSlug;
  }
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("api_key")
      .eq("id", user.id)
      .maybeSingle();
    let apiKey =
      typeof profile?.api_key === "string" && profile.api_key.trim()
        ? profile.api_key.trim()
        : null;
    if (!apiKey) {
      apiKey = await resolveProfileApiKeyForServer(user.id);
    }
    if (apiKey) {
      h["X-Api-Key"] = apiKey;
    }
  }
  return { headers: h, clientSlug, orgSlug, user, tenancy, workspaceClients };
}

export const getCachedServerApiContext = cache(loadServerApiContext);

export type CompetitorRow = {
  id: string;
  client_id: string;
  username: string;
  profile_url: string | null;
  followers: number | null;
  avg_views: number | null;
  avg_likes: number | null;
  /** Average comments per post (competitor baseline); set after enrichment / discovery. */
  avg_comments?: number | null;
  language: string | null;
  content_style: string | null;
  topics: string[] | null;
  reasoning: string | null;
  relevance_score: number | null;
  performance_score: number | null;
  language_bonus: number | null;
  composite_score: number | null;
  tier: number | null;
  tier_label: string | null;
  /** Free text when added via UI; null = found by automated discovery */
  added_by?: string | null;
  /** Set when row came from automated discovery; null = added manually (paste) */
  discovery_job_id?: string | null;
  last_scraped_at?: string | null;
};

export type BaselineRow = {
  avg_views: number | null;
  median_views: number | null;
  max_views: number | null;
  p90_views: number | null;
  p10_views: number | null;
  reels_analyzed: number | null;
  scraped_at: string | null;
  expires_at: string | null;
};

/** One block of the client brain (Context page). */
export type ClientContextSection = {
  text: string;
  source: "manual" | "upload" | "generated" | "chat";
  file: {
    name: string;
    storage_path: string;
    uploaded_at: string;
  } | null;
  updated_at: string | null;
};

export type ClientContextData = Partial<
  Record<
    | "icp"
    | "brand_map"
    | "story_board"
    | "communication_guideline"
    | "offer_documentation"
    | "onboarding_transcript",
    ClientContextSection
  >
>;

/** Active client row from `GET /api/v1/clients/{slug}` — niche_config drives discovery copy. */
export type ClientRow = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  instagram_handle: string | null;
  language: string;
  niche_config: unknown[];
  icp: Record<string, unknown>;
  products: Record<string, unknown>;
  client_context?: ClientContextData | null;
  /** Pre-compiled briefs for AI (analysis, generation, voice). See docs/client_dna.md. */
  client_dna?: Record<string, unknown> | null;
  is_active: boolean;
  outlier_ratio_threshold?: number | null;
};

/** POST /clients/{slug}/dna/chat-preview — LLM only; may include only `analysis_brief` keys. */
export type DnaChatPreviewResponse = {
  summary: string;
  changed_sections: Record<string, string>;
  before: Record<string, string>;
  updated_sections: string[];
};

/** POST /clients/{slug}/dna/chat-apply — persist `analysis_brief` into client_dna only. */
export type DnaChatApplyResponse = {
  summary: string;
  updated_sections: string[];
  client: ClientRow;
};

export type ScrapedReelRow = {
  id: string;
  client_id: string;
  competitor_id: string | null;
  post_url: string | null;
  thumbnail_url: string | null;
  account_username: string;
  account_avg_views: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  outlier_ratio: number | null;
  is_outlier: boolean | null;
  outlier_views_ratio?: number | null;
  outlier_likes_ratio?: number | null;
  outlier_comments_ratio?: number | null;
  is_outlier_views?: boolean | null;
  is_outlier_likes?: boolean | null;
  is_outlier_comments?: boolean | null;
  hook_text: string | null;
  caption: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
  source?: string | null;
  similarity_score?: number | null;
  analysis?: ReelAnalysisSummary | null;
  /** Present on GET /activity week_breakouts tops — delta from snapshots in post-age window (days 8–14 by default). */
  growth_views?: number | null;
  growth_likes?: number | null;
  growth_comments?: number | null;
  /** Seconds from Apify (GET /reels). */
  video_duration?: number | null;
  /** API-computed: (likes+comments+saves+shares)/views when views > 0. */
  engagement_rate?: number | null;
  /** API-computed: views ÷ comments when comments > 0 (e.g. 20 = 20 views per comment). */
  comment_view_ratio?: number | null;
  save_rate?: number | null;
  share_rate?: number | null;
  /** GET /activity trending_now — views ÷ account_avg_views from last sync. */
  trending_ratio?: number | null;
  /** GET /activity proven_performers — how growth_views was derived. */
  proven_growth_source?: "snapshots" | "raw_views" | null;
  /** GET /reels/replicate-suggestions — views ÷ competitor avg_first_day_views. */
  outbreaker_ratio?: number | null;
  /** Whether ratio used milestone avg or fell back to lifetime account avg. */
  outbreaker_ratio_source?: "milestone_avg" | "account_avg_fallback" | null;
  /** GET /dashboard/competitor-wins — views ÷ that competitor's account_avg_views. */
  win_ratio?: number | null;
};

export type ScrapeQueueStats = {
  /** Present when cron/worker enqueues jobs; inline scrape uses competitors_scraped + reels_processed. */
  jobs_queued?: number;
  competitors_scraped?: number;
  reels_processed?: number;
  skipped_fresh: number;
  skipped_duplicate: number;
  competitors_considered: number;
};

export async function fetchCompetitors(): Promise<{
  ok: boolean;
  data: CompetitorRow[];
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: [],
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/competitors`, {
      headers: { ...headers },
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      return {
        ok: false,
        data: [],
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

export async function fetchClient(): Promise<{
  ok: boolean;
  data: ClientRow | null;
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: null,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}`, {
      headers: { ...headers },
      next: { revalidate: 60 },
    });
    if (res.status === 404) {
      return { ok: false, data: null, error: "Client not found" };
    }
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

export async function fetchBaseline(): Promise<{
  ok: boolean;
  data: BaselineRow | null;
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: null,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/baseline`, {
      headers: { ...headers },
      next: { revalidate: 60 },
    });
    if (res.status === 404) {
      return { ok: true, data: null };
    }
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

export async function fetchOwnReels(): Promise<{
  ok: boolean;
  data: ScrapedReelRow[];
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: [],
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(
      `${base}/api/v1/clients/${clientSlug}/reels?own_reels_only=true&include_analysis=true&limit=50&sort_by=posted_at`,
      {
        headers: { ...headers },
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        data: [],
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

/** GET /api/v1/clients/{slug}/stats — averages for your own reels (see INTELLIGENCE-GUIDE.md). */
export type IntelligenceStatsRow = {
  average_views_last_30_reels: number | null;
  average_likes_last_30_reels: number | null;
  total_own_reels: number;
  avg_views_change_vs_prior_week_pct: number | null;
};

export async function fetchIntelligenceStats(): Promise<{
  ok: boolean;
  data: IntelligenceStatsRow | null;
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: null,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/stats`, {
      headers: { ...headers },
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

/** Subset of GET /activity `own_reel_growth[]` — backend may attach reel metadata. */
export type OwnReelGrowthItem = {
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

export type WeekBreakoutsPayload = {
  /** When set, tops are from all stored reels (GET /reels), not weekly competitor breakouts. */
  scope?: "all_stored" | "weekly_breakouts" | "growth_7d" | "growth_7d_post_age";
  /** growth_7d_post_age: window is posted_at + maturity_days … + measure_days (not scrape time). */
  anchor?: string | null;
  maturity_days?: number | null;
  measure_days?: number | null;
  min_post_age_days?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  days: number;
  /** @deprecated use top_n_by_type */
  top_n?: number;
  top_n_by_type?: { views: number; likes: number; comments: number };
  top_by_views: ScrapedReelRow[];
  top_by_likes: ScrapedReelRow[];
  top_by_comments: ScrapedReelRow[];
};

export type NicheBenchmarksPayload = {
  reel_count: number;
  niche_avg_views: number | null;
  niche_avg_likes: number | null;
  niche_avg_engagement_rate: number | null;
  /** Mean views ÷ comments over competitor reels (when API sends niche benchmarks). */
  niche_avg_comment_view_ratio?: number | null;
  niche_avg_duration_seconds: number | null;
};

export type ActivityLanePayload = {
  meta: Record<string, unknown>;
  reels: ScrapedReelRow[];
};

export type IntelligenceActivityRow = {
  since: string;
  new_breakout_reels: ScrapedReelRow[];
  niche_benchmarks?: NicheBenchmarksPayload;
  /** Competitor reels posted in ~24h with views ≥ 0.3× account average. */
  trending_now?: ActivityLanePayload;
  /** Competitor reels 14d+ old: growth vs snapshot anchor, else top by views. */
  proven_performers?: ActivityLanePayload;
  week_breakouts?: WeekBreakoutsPayload;
  own_reel_growth: OwnReelGrowthItem[];
  is_quiet: boolean;
};

export async function fetchIntelligenceActivity(sinceIso?: string): Promise<{
  ok: boolean;
  data: IntelligenceActivityRow | null;
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: null,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const q = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/activity${q}`, {
      headers: { ...headers },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        data: null,
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

export async function fetchScrapedReels(
  outlierOnly: boolean,
  includeAnalysis = true,
  limit = 50,
  sortBy: "posted_at" | "views" | "outlier_ratio" = "posted_at",
  source?: string,
): Promise<{
  ok: boolean;
  data: ScrapedReelRow[];
  error?: string;
}> {
  const base = getContentApiBase();
  const params = new URLSearchParams();
  if (outlierOnly) params.set("outlier_only", "true");
  if (includeAnalysis) params.set("include_analysis", "true");
  params.set("limit", String(limit));
  params.set("sort_by", sortBy);
  if (source) params.set("source", source);
  const q = `?${params.toString()}`;
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: [],
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/reels${q}`, {
      headers: { ...headers },
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      return {
        ok: false,
        data: [],
        error: `${res.status} ${await res.text()}`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return {
      ok: false,
      data: [],
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

async function fetchDashboardLane(
  path: "fresh-niche" | "competitor-wins",
  days: number,
  limit: number,
): Promise<{ ok: boolean; data: ScrapedReelRow[]; error?: string }> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) return { ok: false, data: [], error: "No active creator" };
    const res = await fetch(
      `${base}/api/v1/clients/${clientSlug}/dashboard/${path}?days=${days}&limit=${limit}`,
      { headers: { ...headers }, cache: "no-store" },
    );
    if (!res.ok) return { ok: false, data: [], error: `${res.status} ${await res.text()}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, data: [], error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** GET /dashboard/fresh-niche — recent keyword-similarity reels, ranked by views. */
export function fetchDashboardFreshNiche(days = 3, limit = 3) {
  return fetchDashboardLane("fresh-niche", days, limit);
}

/** GET /dashboard/competitor-wins — recent competitor reels beating their account avg. */
export function fetchDashboardCompetitorWins(days = 3, limit = 3) {
  return fetchDashboardLane("competitor-wins", days, limit);
}

export type ReelsListSortBy =
  | "posted_at"
  | "views"
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "outlier_ratio"
  | "similarity_score"
  | "video_duration"
  | "first_seen_at";

export type ReelsListFilters = {
  source?: string | null;
  creator?: string | null;
  competitorId?: string | null;
  outlierOnly?: boolean;
  ownReelsOnly?: boolean;
  minViews?: number | null;
  maxViews?: number | null;
  minLikes?: number | null;
  maxLikes?: number | null;
  minComments?: number | null;
  maxComments?: number | null;
  postedAfter?: string | null;
  postedBefore?: string | null;
};

export type ReelsListQuery = ReelsListFilters & {
  sortBy?: ReelsListSortBy;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  includeAnalysis?: boolean;
};

/**
 * GET /clients/{slug}/reels with the full filter/sort/pagination contract.
 * Returns rows + the server's matching-row total (from X-Total-Count) so the
 * UI can show "Showing X of Y" and paginate honestly across the catalog.
 *
 * Kept as a separate function from `fetchScrapedReels` to avoid breaking
 * callers that just want "give me the recent N" without thinking about pages.
 */
export async function fetchReelsList(query: ReelsListQuery = {}): Promise<{
  ok: boolean;
  data: ScrapedReelRow[];
  total: number;
  error?: string;
}> {
  const base = getContentApiBase();
  const params = new URLSearchParams();
  params.set("include_analysis", String(query.includeAnalysis ?? true));
  params.set("limit", String(query.limit ?? 100));
  if (query.offset && query.offset > 0) params.set("offset", String(query.offset));
  if (query.sortBy) params.set("sort_by", query.sortBy);
  if (query.sortDir) params.set("sort_dir", query.sortDir);
  if (query.outlierOnly) params.set("outlier_only", "true");
  if (query.ownReelsOnly) params.set("own_reels_only", "true");
  if (query.source) params.set("source", query.source);
  if (query.creator) params.set("creator", query.creator);
  if (query.competitorId) params.set("competitor_id", query.competitorId);
  if (query.minViews != null) params.set("min_views", String(query.minViews));
  if (query.maxViews != null) params.set("max_views", String(query.maxViews));
  if (query.minLikes != null) params.set("min_likes", String(query.minLikes));
  if (query.maxLikes != null) params.set("max_likes", String(query.maxLikes));
  if (query.minComments != null) params.set("min_comments", String(query.minComments));
  if (query.maxComments != null) params.set("max_comments", String(query.maxComments));
  if (query.postedAfter) params.set("posted_after", query.postedAfter);
  if (query.postedBefore) params.set("posted_before", query.postedBefore);

  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: [],
        total: 0,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    }
    const res = await fetch(
      `${base}/api/v1/clients/${clientSlug}/reels?${params.toString()}`,
      {
        headers: { ...headers },
        // Filter combinations explode the cache key; rely on the URL state
        // change to refetch on filter changes and keep TTL low.
        next: { revalidate: 15 },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        data: [],
        total: 0,
        error: `${res.status} ${await res.text()}`,
      };
    }
    const data = (await res.json()) as ScrapedReelRow[];
    const totalHeader = res.headers.get("x-total-count");
    const total = totalHeader != null ? Number.parseInt(totalHeader, 10) : data.length;
    return { ok: true, data, total: Number.isFinite(total) ? total : data.length };
  } catch (e) {
    return {
      ok: false,
      data: [],
      total: 0,
      error: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

/** GET /api/v1/clients/{slug}/stats/outlier-count — cheap single COUNT query. */
export async function fetchOutlierCount(): Promise<{
  ok: boolean;
  count: number;
  error?: string;
}> {
  const base = getContentApiBase();
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug)
      return {
        ok: false,
        count: 0,
        error:
          "No active creator in this workspace. Finish onboarding or pick a creator in the header.",
      };
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/stats/outlier-count`, {
      headers: { ...headers },
      next: { revalidate: 30 },
    });
    if (!res.ok) return { ok: false, count: 0, error: `${res.status}` };
    const data = await res.json();
    return { ok: true, count: data.count ?? 0 };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : "fetch failed" };
  }
}
