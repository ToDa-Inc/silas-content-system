/**
 * Server-side fetch to FastAPI — profiles.api_key as X-Api-Key + X-Org-Slug.
 * Per-request context is cached (React cache) so parallel fetches don’t repeat Supabase work.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
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
};

async function loadServerApiContext(): Promise<ServerApiContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  const preferredClient = cookieStore.get(ACTIVE_CLIENT_SLUG_COOKIE)?.value ?? null;
  const tenancy = await resolveTenancy(supabase, user?.id, preferredClient);
  /** Org + client only from Supabase membership / cookie (`resolveTenancy`) — no `.env` fallbacks. */
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
    if (profile?.api_key) {
      h["X-Api-Key"] = profile.api_key;
    }
  }
  return { headers: h, clientSlug, orgSlug, user, tenancy };
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
  source: "manual" | "upload" | "generated";
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
  hook_text: string | null;
  caption: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
  source?: string | null;
  analysis?: ReelAnalysisSummary | null;
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
          "No creator (client) in your workspace — finish onboarding or add a row in Supabase clients.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/competitors`, {
      headers: { ...headers },
      cache: "no-store",
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
        error: "No client in your workspace.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}`, {
      headers: { ...headers },
      cache: "no-store",
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
        error: "No client in your workspace.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/baseline`, {
      headers: { ...headers },
      cache: "no-store",
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
        error: "No client in your workspace.",
      };
    }
    const res = await fetch(
      `${base}/api/v1/clients/${clientSlug}/reels?own_reels_only=true&include_analysis=true`,
      {
        headers: { ...headers },
        cache: "no-store",
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
      return { ok: false, data: null, error: "No client in your workspace." };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/stats`, {
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

export type IntelligenceActivityRow = {
  since: string;
  new_breakout_reels: ScrapedReelRow[];
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
      return { ok: false, data: null, error: "No client in your workspace." };
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
): Promise<{
  ok: boolean;
  data: ScrapedReelRow[];
  error?: string;
}> {
  const base = getContentApiBase();
  const params = new URLSearchParams();
  if (outlierOnly) params.set("outlier_only", "true");
  if (includeAnalysis) params.set("include_analysis", "true");
  const q = params.toString() ? `?${params.toString()}` : "";
  try {
    const { headers, clientSlug } = await getCachedServerApiContext();
    if (!clientSlug) {
      return {
        ok: false,
        data: [],
        error: "No client in your workspace.",
      };
    }
    const res = await fetch(`${base}/api/v1/clients/${clientSlug}/reels${q}`, {
      headers: { ...headers },
      cache: "no-store",
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
