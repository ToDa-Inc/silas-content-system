const DEFAULT_API = "http://127.0.0.1:8000";

export function getApiBase(): string {
  return (
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_API
  );
}

export function getDefaultOrgSlug(): string {
  return process.env.DEFAULT_ORG_SLUG || "silas-agency";
}

export function getDefaultClientSlug(): string {
  return process.env.DEFAULT_CLIENT_SLUG || "conny-gfrerer";
}

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

export async function fetchCompetitors(): Promise<{
  ok: boolean;
  data: CompetitorRow[];
  error?: string;
}> {
  const base = getApiBase();
  const slug = getDefaultClientSlug();
  const org = getDefaultOrgSlug();
  try {
    const res = await fetch(`${base}/api/v1/clients/${slug}/competitors`, {
      headers: { "X-Org-Slug": org },
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
  const base = getApiBase();
  const slug = getDefaultClientSlug();
  const org = getDefaultOrgSlug();
  try {
    const res = await fetch(`${base}/api/v1/clients/${slug}/baseline`, {
      headers: { "X-Org-Slug": org },
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
