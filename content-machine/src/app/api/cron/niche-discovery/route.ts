import { NextResponse } from "next/server";

/**
 * GitHub Actions / external cron: same contract as FastAPI
 * `POST /api/v1/cron/keyword-reel-similarity` but on the dashboard origin.
 *
 * Set `NICHE_DISCOVERY_CRON_URL` to:
 *   `https://<dashboard-host>/api/cron/niche-discovery`
 * with header `X-Cron-Secret: <CRON_SECRET>` (same as other cron workflows).
 *
 * Forwards to `CONTENT_API_URL` or `NEXT_PUBLIC_CONTENT_API_URL` + `/api/v1/cron/keyword-reel-similarity`.
 */
export const dynamic = "force-dynamic";

function backendBase(): string {
  return (
    process.env.CONTENT_API_URL ||
    process.env.NEXT_PUBLIC_CONTENT_API_URL ||
    ""
  ).trim();
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const xCron = request.headers.get("x-cron-secret")?.trim();
  const auth = request.headers.get("authorization")?.trim();
  const authorized =
    xCron === secret || auth === `Bearer ${secret}` || auth === `bearer ${secret}`;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = backendBase();
  if (!base) {
    return NextResponse.json(
      {
        error:
          "CONTENT_API_URL or NEXT_PUBLIC_CONTENT_API_URL required to forward niche discovery",
      },
      { status: 503 },
    );
  }

  const url = `${base.replace(/\/$/, "")}/api/v1/cron/keyword-reel-similarity`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "X-Cron-Secret": secret,
      "Content-Type": "application/json",
    },
  });

  const text = await upstream.text();
  const ct = upstream.headers.get("content-type") || "application/json";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": ct },
  });
}
