"use client";

import type {
  OwnReelsMetricsResponse,
  OwnReelsMetricsSeries,
  ReelAnalysisDetail,
} from "@/lib/reel-types";
import type { ScrapedReelRow } from "@/lib/api";
import { getContentApiBase } from "@/lib/env";

/** FastAPI `detail` is a string (400) or validation array (422). */
export function formatFastApiError(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const detail = (json as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (first && typeof first === "object" && "msg" in first) {
      const msg = (first as { msg?: unknown }).msg;
      if (typeof msg === "string") return msg;
    }
  }
  return fallback;
}
import { createClient } from "@/lib/supabase/client";
import { resolveTenancy } from "@/lib/tenancy";

/** One in-flight GET — many `clientApiHeaders` calls share a single session read per burst. */
let preferredClientSlugFromSession: Promise<string | null> | null = null;

async function getPreferredClientSlugFromSession(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }
  if (preferredClientSlugFromSession) {
    return preferredClientSlugFromSession;
  }
  preferredClientSlugFromSession = (async () => {
    try {
      const r = await fetch("/api/session/active-client", { method: "GET", cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as { slug?: string | null };
      const s = (j.slug ?? "").trim();
      return s || null;
    } catch {
      return null;
    } finally {
      preferredClientSlugFromSession = null;
    }
  })();
  return preferredClientSlugFromSession;
}

export type ClientApiHeaderOptions = {
  /** Explicit org override; otherwise `resolveTenancy` + `X-Org-Slug` from Supabase (no repo `.env` default). */
  orgSlug?: string;
};

/** DevTools + console: use this instead of raw `fetch` for Content API calls from the browser. */
export async function contentApiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "development"
  ) {
    // Use info (not debug) so Chrome default console levels always show it.
    console.info(`[Content API] ${method}`, url);
  }
  return fetch(url, { ...init, cache: "no-store" });
}

/** Browser fetch to FastAPI — profiles.api_key + org from Supabase (or explicit orgSlug override). */
export async function clientApiHeaders(opts?: ClientApiHeaderOptions): Promise<HeadersInit> {
  const { headers } = await clientApiContext(opts);
  return headers;
}

export async function clientApiContext(opts?: ClientApiHeaderOptions): Promise<{
  headers: HeadersInit;
  clientSlug: string;
  orgSlug: string;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const preferred = await getPreferredClientSlugFromSession();
  const tenancy = await resolveTenancy(supabase, user?.id, preferred);
  const orgSlug = opts?.orgSlug?.trim() || tenancy?.orgSlug || "";
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
    if (profile?.api_key) {
      h["X-Api-Key"] = profile.api_key;
    }
  }
  return { headers: h, clientSlug, orgSlug };
}

/** Full Silas analysis for a reel — opens from Intelligence / View all reels. */
export async function fetchReelAnalysisDetail(
  clientSlug: string,
  orgSlug: string,
  reelId: string,
): Promise<{ ok: true; data: ReelAnalysisDetail } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/${encodeURIComponent(reelId)}/analysis`,
      { headers },
    );
    if (res.status === 404) {
      return { ok: false, error: "No saved analysis for this reel." };
    }
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${await res.text()}` };
    }
    const data = (await res.json()) as ReelAnalysisDetail;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Outbreaker reels posted in the last N hours for the Replicate section. */
export async function fetchAdaptPreviewReels(
  clientSlug: string,
  orgSlug: string,
  limit: number = 15,
): Promise<{ ok: true; data: ScrapedReelRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/adapt-preview?limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Request failed (${res.status})`),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as ScrapedReelRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function fetchReplicateSuggestions(
  clientSlug: string,
  orgSlug: string,
  hours: number = 24,
  limit: number = 8,
): Promise<{ ok: true; data: ScrapedReelRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/replicate-suggestions?hours=${hours}&limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(
          json as Record<string, unknown>,
          `Request failed (${res.status})`,
        ),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as ScrapedReelRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

async function fetchDashboardLaneClient(
  path: "fresh-niche" | "competitor-wins",
  clientSlug: string,
  orgSlug: string,
  days: number,
  limit: number,
): Promise<{ ok: true; data: ScrapedReelRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/dashboard/${path}?days=${days}&limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(
          json as Record<string, unknown>,
          `Request failed (${res.status})`,
        ),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as ScrapedReelRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// Mirror of api.ts DASHBOARD_LANE_LIMIT — kept inline to avoid a server-only
// import leaking into the client bundle. Bump both together if you change one.
const DASHBOARD_LANE_LIMIT = 12;

export function fetchDashboardFreshNicheClient(
  clientSlug: string,
  orgSlug: string,
  days = 3,
  limit = DASHBOARD_LANE_LIMIT,
) {
  return fetchDashboardLaneClient("fresh-niche", clientSlug, orgSlug, days, limit);
}

export function fetchDashboardCompetitorWinsClient(
  clientSlug: string,
  orgSlug: string,
  days = 3,
  limit = DASHBOARD_LANE_LIMIT,
) {
  return fetchDashboardLaneClient("competitor-wins", clientSlug, orgSlug, days, limit);
}

export type ActiveReelAnalysisJobResponse =
  | { active: false }
  | {
      active: true;
      job_id: string;
      job_type: string;
      status: string | null;
      started_at: string | null;
    };

/** Running or queued reel analyze-url / analyze-bulk job (resume after reload). */
export async function fetchActiveReelAnalysisJob(
  clientSlug: string,
  orgSlug: string,
): Promise<
  { ok: true; data: ActiveReelAnalysisJobResponse } | { ok: false; error: string }
> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/active-analysis`,
      { headers },
    );
    const json = (await res.json().catch(() => ({}))) as ActiveReelAnalysisJobResponse & {
      detail?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Request failed (${res.status})`),
      };
    }
    return { ok: true, data: json as ActiveReelAnalysisJobResponse };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Own-reel metrics history for dashboard charts — requires repeated pulls from Instagram (snapshots). */
export async function fetchOwnReelsMetrics(
  clientSlug: string,
  orgSlug: string,
  opts?: { from?: string; to?: string; reelIds?: string[] },
): Promise<
  { ok: true; data: OwnReelsMetricsResponse } | { ok: false; error: string }
> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  const sp = new URLSearchParams();
  if (opts?.from) sp.set("from", opts.from);
  if (opts?.to) sp.set("to", opts.to);
  if (opts?.reelIds?.length) sp.set("reel_ids", opts.reelIds.join(","));
  const q = sp.toString();
  const url = `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/metrics${q ? `?${q}` : ""}`;
  try {
    const res = await contentApiFetch(url, { headers });
    const json = (await res.json().catch(() => ({}))) as OwnReelsMetricsResponse & {
      detail?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Request failed (${res.status})`),
      };
    }
    return { ok: true, data: { reels: json.reels ?? [] } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Single-reel snapshot series (own or competitor) + deltas for compact UI. */
export async function fetchReelMetricsSeries(
  clientSlug: string,
  orgSlug: string,
  reelId: string,
  opts?: { from?: string; to?: string },
): Promise<{ ok: true; data: OwnReelsMetricsSeries } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  const sp = new URLSearchParams();
  if (opts?.from) sp.set("from", opts.from);
  if (opts?.to) sp.set("to", opts.to);
  const q = sp.toString();
  const url = `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/${encodeURIComponent(reelId)}/metrics${q ? `?${q}` : ""}`;
  try {
    const res = await contentApiFetch(url, { headers });
    const json = (await res.json().catch(() => ({}))) as OwnReelsMetricsSeries & {
      detail?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Request failed (${res.status})`),
      };
    }
    return {
      ok: true,
      data: {
        reel_id: String(json.reel_id ?? reelId),
        post_url: json.post_url ?? null,
        thumbnail_url: json.thumbnail_url ?? null,
        hook_text: json.hook_text ?? null,
        points: Array.isArray(json.points) ? json.points : [],
        competitor_id: json.competitor_id ?? null,
        latest_snapshot_at: json.latest_snapshot_at ?? null,
        snapshot_count: typeof json.snapshot_count === "number" ? json.snapshot_count : 0,
        views_delta_24h: json.views_delta_24h ?? null,
        views_delta_7d: json.views_delta_7d ?? null,
        likes_delta_24h: json.likes_delta_24h ?? null,
        likes_delta_7d: json.likes_delta_7d ?? null,
        comments_delta_24h: json.comments_delta_24h ?? null,
        comments_delta_7d: json.comments_delta_7d ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function enqueueReelAnalyzeBulk(
  clientSlug: string,
  orgSlug: string,
  urls: string[],
  opts?: { skip_apify?: boolean },
): Promise<{ ok: true; job_id: string; count: number } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const body: { urls: string[]; skip_apify?: boolean } = { urls };
    if (opts?.skip_apify) body.skip_apify = true;
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/analyze-bulk`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      job_id?: string;
      count?: number;
      detail?: unknown;
    };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json, `Request failed (${res.status})`) };
    }
    const jobId = json.job_id;
    if (!jobId) {
      return { ok: false, error: "No job_id returned from server." };
    }
    return { ok: true, job_id: jobId, count: json.count ?? urls.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export type TextBlock = { text: string; isCTA?: boolean };

export type GenerationSession = {
  id: string;
  client_id: string;
  source_type: string;
  source_analysis_ids?: string[] | null;
  source_reel_ids?: string[] | null;
  source_format_key?: string | null;
  source_url?: string | null;
  source_idea?: string | null;
  source_script?: string | null;
  synthesized_patterns?: Record<string, unknown> | null;
  angles?: Array<Record<string, unknown>> | null;
  chosen_angle_index?: number | null;
  hooks?: Array<{ text: string; tier?: number }> | null;
  script?: string | null;
  caption_body?: string | null;
  hashtags?: string[] | null;
  story_variants?: string[] | null;
  text_blocks?: TextBlock[] | null;
  cover_text_options?: string[] | null;
  background_type?: string | null;
  broll_clip_id?: string | null;
  client_image_id?: string | null;
  background_url?: string | null;
  rendered_video_url?: string | null;
  thumbnail_url?: string | null;
  render_status?: string | null;
  render_error?: string | null;
  carousel_slides?: CarouselSlide[] | null;
  status: string;
  feedback?: string | null;
  prompt_version?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CarouselSlide = {
  idx: number;
  text: string;
  image_url?: string | null;
  prompt?: string | null;
};

export type BackgroundJobRow = {
  id: string;
  job_type?: string | null;
  status: string;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
};

export type FormatDigestSummary = {
  format_key: string;
  reel_count?: number | null;
  mature_count?: number | null;
  avg_engagement?: number | null;
  /** Mean views ÷ comments over mature reels in this format. */
  avg_comment_view_ratio?: number | null;
  avg_save_rate?: number | null;
  avg_share_rate?: number | null;
  avg_duration_s?: number | null;
  /** Carousel-only: mean of scraped_reels.outlier_likes_ratio (likes vs account avg). */
  avg_outlier_likes_ratio?: number | null;
  /** Carousel-only: fallback ranking metric when likes outlier is null. */
  avg_outlier_comments_ratio?: number | null;
  computed_at?: string | null;
};

export async function fetchFormatDigests(
  clientSlug: string,
  orgSlug: string,
  refresh = false,
): Promise<{ ok: true; data: FormatDigestSummary[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  const q = refresh ? "?refresh=true" : "";
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/format-digests${q}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(
          json as Record<string, unknown>,
          `Request failed (${res.status})`,
        ),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as FormatDigestSummary[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export type FormatRecommendation = {
  format_key?: string;
  score?: number;
  reasoning?: string;
  suggested_angle_hint?: string;
};

export async function recommendFormatForIdea(
  clientSlug: string,
  orgSlug: string,
  idea: string,
): Promise<{ ok: true; data: FormatRecommendation[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/recommend-format`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      recommendations?: FormatRecommendation[];
      detail?: unknown;
    };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: Array.isArray(json.recommendations) ? json.recommendations : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export type AutoVideoIdea = {
  idea: string;
  suggested_format_key: string;
  reasoning: string;
};

export async function generateAutoVideoIdea(
  clientSlug: string,
  orgSlug: string,
): Promise<{ ok: true; data: AutoVideoIdea } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/auto-video-idea`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      },
    );
    const json = (await res.json().catch(() => ({}))) as Partial<AutoVideoIdea> & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    if (!json.idea || !json.suggested_format_key) {
      return { ok: false, error: "Empty response from auto-video-idea" };
    }
    return {
      ok: true,
      data: {
        idea: String(json.idea),
        suggested_format_key: String(json.suggested_format_key),
        reasoning: String(json.reasoning ?? ""),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export type ReelAnalysisListRow = {
  id: string;
  post_url: string;
  owner_username?: string | null;
  total_score?: number | null;
  replicability_rating?: string | null;
};

/** Saved analyses for generation source picker — GET reel-analyses. */
export async function fetchReelAnalysesList(
  clientSlug: string,
  orgSlug: string,
  limit = 50,
): Promise<{ ok: true; data: ReelAnalysisListRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reel-analyses?limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(
          json as Record<string, unknown>,
          `Request failed (${res.status})`,
        ),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as ReelAnalysisListRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationStart(
  clientSlug: string,
  orgSlug: string,
  body: {
    source_type:
      | "outlier"
      | "patterns"
      | "manual"
      | "format_pick"
      | "idea_match"
      | "url_adapt"
      | "script_adapt";
    source_analysis_ids?: string[];
    max_analyses?: number;
    extra_instruction?: string;
    format_key?: string;
    idea_text?: string;
    url?: string;
    source_script?: string;
  },
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/start`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationChooseAngle(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  angleIndex: number,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/choose-angle`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ angle_index: angleIndex }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationRegenerate(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  body: {
    scope: "hooks" | "script" | "caption" | "story" | "text_blocks" | "all";
    feedback?: string;
  },
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/regenerate`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    if (!json || typeof json !== "object" || typeof (json as GenerationSession).id !== "string") {
      return { ok: false, error: "Invalid response from server after regenerate." };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** Re-roll the AI cover headlines for a session without touching hooks/script/caption.
 *  Cheap, dedicated endpoint — see backend run_cover_text_options. */
export async function generationRegenerateCovers(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/regenerate-covers`,
      { method: "POST", headers },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    if (!json || typeof json !== "object" || typeof (json as GenerationSession).id !== "string") {
      return { ok: false, error: "Invalid response from server after regenerate-covers." };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationListSessions(
  clientSlug: string,
  orgSlug: string,
  limit = 20,
): Promise<{ ok: true; data: GenerationSession[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions?limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(
          json as Record<string, unknown>,
          `Failed (${res.status})`,
        ),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as GenerationSession[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

/** GET …/generate/sessions/{sessionId} — resume a saved session. */
export async function generationGetSession(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}`,
      { headers },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationDeleteSession(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE", headers },
    );
    if (res.status === 204 || res.ok) {
      return { ok: true };
    }
    const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return {
      ok: false,
      error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function creationListSessions(
  clientSlug: string,
  orgSlug: string,
  limit = 50,
): Promise<{ ok: true; data: GenerationSession[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions?limit=${limit}`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as GenerationSession[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function patchCreateSession(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  body: {
    text_blocks?: TextBlock[];
    script?: string;
    caption_body?: string;
    hashtags?: string[];
  },
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationGenerateThumbnail(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  hookText?: string,
): Promise<{ ok: true; data: { thumbnail_url: string } } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/generate-thumbnail`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ hook_text: hookText ?? null }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as { thumbnail_url?: string; detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    if (!json.thumbnail_url) {
      return { ok: false, error: "No thumbnail URL returned" };
    }
    return { ok: true, data: { thumbnail_url: json.thumbnail_url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function creationGenerateBackground(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(sessionId)}/generate-background`,
      { method: "POST", headers },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function creationSetBroll(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  brollClipId: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(sessionId)}/set-broll`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ broll_clip_id: brollClipId }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function creationRenderVideo(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
): Promise<{ ok: true; job_id: string } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(sessionId)}/render`,
      { method: "POST", headers },
    );
    const json = (await res.json().catch(() => ({}))) as { job_id?: string; detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    const jobId = json.job_id;
    if (!jobId) return { ok: false, error: "No job_id returned" };
    return { ok: true, job_id: jobId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export type BrollClipRow = {
  id: string;
  file_url: string;
  thumbnail_url?: string | null;
  label?: string | null;
  created_at?: string | null;
};

export async function brollList(
  clientSlug: string,
  orgSlug: string,
): Promise<{ ok: true; data: BrollClipRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/broll`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as BrollClipRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function brollDelete(
  clientSlug: string,
  orgSlug: string,
  clipId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/broll/${encodeURIComponent(clipId)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: formatFastApiError(json, `Failed (${res.status})`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function fetchBackgroundJob(
  orgSlug: string,
  jobId: string,
): Promise<{ ok: true; data: BackgroundJobRow } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(`${base}/api/v1/jobs/${encodeURIComponent(jobId)}`, { headers });
    const json = (await res.json().catch(() => ({}))) as BackgroundJobRow & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as BackgroundJobRow };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationSetStatus(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  action: "approve" | "reject",
  feedback?: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  const path =
    action === "approve" ? "approve" : "reject";
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/${path}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback ?? null }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ── Client image library (cover + video background, alternative to AI) ──────────

export type ClientImageRow = {
  id: string;
  client_id?: string;
  file_url: string;
  label?: string | null;
  width?: number | null;
  height?: number | null;
  created_at?: string | null;
};

export async function clientImagesList(
  clientSlug: string,
  orgSlug: string,
): Promise<{ ok: true; data: ClientImageRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/images`,
      { headers },
    );
    const json = (await res.json().catch(() => [])) as unknown;
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: Array.isArray(json) ? (json as ClientImageRow[]) : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function clientImagesDelete(
  clientSlug: string,
  orgSlug: string,
  imageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/images/${encodeURIComponent(imageId)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: formatFastApiError(json, `Failed (${res.status})`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function creationSetBackgroundImage(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  clientImageId: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(sessionId)}/set-background-image`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ client_image_id: clientImageId }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function generationComposeThumbnail(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  clientImageId: string,
  hookText?: string,
  wash: boolean = true,
): Promise<{ ok: true; data: { thumbnail_url: string } } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/generate/sessions/${encodeURIComponent(sessionId)}/compose-thumbnail`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          client_image_id: clientImageId,
          hook_text: hookText ?? null,
          wash,
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as { thumbnail_url?: string; detail?: unknown };
    if (!res.ok) {
      return { ok: false, error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`) };
    }
    if (!json.thumbnail_url) {
      return { ok: false, error: "No thumbnail URL returned" };
    }
    return { ok: true, data: { thumbnail_url: json.thumbnail_url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ── Carousel slides ────────────────────────────────────────────────────────

export async function carouselSlidesGenerate(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  count: number,
  style?: string,
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(
        sessionId,
      )}/carousel-slides/generate`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ count, style: style ?? null }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function carouselSlideRegenerate(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  args: {
    idx: number;
    text?: string;
    prompt?: string;
    image_source?: "ai" | "client_image";
    client_image_id?: string;
  },
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(
        sessionId,
      )}/carousel-slides/regenerate`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          idx: args.idx,
          text: args.text ?? null,
          prompt: args.prompt ?? null,
          image_source: args.image_source ?? "ai",
          client_image_id: args.client_image_id ?? null,
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function carouselSlidesPatch(
  clientSlug: string,
  orgSlug: string,
  sessionId: string,
  slides: CarouselSlide[],
): Promise<{ ok: true; data: GenerationSession } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(
        sessionId,
      )}/carousel-slides`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ slides }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GenerationSession & { detail?: unknown };
    if (!res.ok) {
      return {
        ok: false,
        error: formatFastApiError(json as Record<string, unknown>, `Failed (${res.status})`),
      };
    }
    return { ok: true, data: json as GenerationSession };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export function carouselSlidesZipUrl(clientSlug: string, sessionId: string): string {
  const base = getContentApiBase();
  return `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/create/sessions/${encodeURIComponent(
    sessionId,
  )}/carousel-slides/zip`;
}

export { getContentApiBase };
