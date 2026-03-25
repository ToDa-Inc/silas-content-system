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

export { getContentApiBase } from "@/lib/env";

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
      `${base}/api/v1/clients/${clientSlug}/reels?own_reels_only=true`,
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

export async function fetchScrapedReels(outlierOnly: boolean): Promise<{
  ok: boolean;
  data: ScrapedReelRow[];
  error?: string;
}> {
  const base = getContentApiBase();
  const q = outlierOnly ? "?outlier_only=true" : "";
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
