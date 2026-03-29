import { NextResponse } from "next/server";

/**
 * Vercel Cron (see vercel.json `crons[].schedule`, default 05:00 UTC daily).
 * Secured with Authorization: Bearer CRON_SECRET (set the same value as backend CRON_SECRET).
 *
 * 1) POST /api/v1/cron/sync-all — enqueue baseline + all competitor scrapes (worker / Apify).
 * 2) POST /api/v1/cron/recompute-breakouts — refresh breakout flags from DB only (no Apify).
 */
export const dynamic = "force-dynamic";

async function forwardCron(path: string, secret: string, base: string) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Cron-Secret": secret },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const base = (
    process.env.CONTENT_API_URL ||
    process.env.NEXT_PUBLIC_CONTENT_API_URL ||
    ""
  ).trim();
  if (!base) {
    return NextResponse.json(
      { error: "CONTENT_API_URL or NEXT_PUBLIC_CONTENT_API_URL required" },
      { status: 503 },
    );
  }

  const syncAll = await forwardCron("/api/v1/cron/sync-all", secret, base);
  const recompute = await forwardCron("/api/v1/cron/recompute-breakouts", secret, base);

  const ok = syncAll.ok && recompute.ok;
  return NextResponse.json(
    {
      ok,
      sync_all: { status: syncAll.status, body: syncAll.body },
      recompute_breakouts: { status: recompute.status, body: recompute.body },
    },
    { status: ok ? 200 : 502 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
