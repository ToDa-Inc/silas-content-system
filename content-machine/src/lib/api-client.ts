"use client";

import type { ReelAnalysisDetail } from "@/lib/reel-types";
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
  if (process.env.NODE_ENV === "development") {
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
  return { headers: h, clientSlug };
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

export { getContentApiBase };
