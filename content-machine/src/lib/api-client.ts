"use client";

import type {
  OwnReelsMetricsResponse,
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
  const tenancy = await resolveTenancy(supabase, user?.id);
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

/** Competitor reels with highest comments÷views (for Generate → adapt URL quick picks). */
export async function fetchAdaptPreviewReels(
  clientSlug: string,
  orgSlug: string,
): Promise<{ ok: true; data: ScrapedReelRow[] } | { ok: false; error: string }> {
  const base = getContentApiBase();
  const headers = await clientApiHeaders({ orgSlug });
  try {
    const res = await contentApiFetch(
      `${base}/api/v1/clients/${encodeURIComponent(clientSlug)}/reels/adapt-preview?limit=5`,
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
  hooks?: Array<{ tier: number; text: string }> | null;
  script?: string | null;
  caption_body?: string | null;
  hashtags?: string[] | null;
  story_variants?: string[] | null;
  text_blocks?: TextBlock[] | null;
  background_type?: string | null;
  broll_clip_id?: string | null;
  background_url?: string | null;
  rendered_video_url?: string | null;
  render_status?: string | null;
  render_error?: string | null;
  status: string;
  feedback?: string | null;
  prompt_version?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  /** Mean comments/views over mature reels in this format (0–1). */
  avg_comment_view_ratio?: number | null;
  avg_save_rate?: number | null;
  avg_share_rate?: number | null;
  avg_duration_s?: number | null;
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
  body: { scope: "hooks" | "script" | "caption" | "story" | "all"; feedback?: string },
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
  body: { text_blocks: TextBlock[] },
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

export { getContentApiBase };
