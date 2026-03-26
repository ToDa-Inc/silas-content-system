import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * BFF proxy: browser calls same-origin `/api/backend/api/v1/...` so DevTools Network
 * shows every call to localhost:3000 (Next forwards to FastAPI — see `backendBase()`).
 * Server Components should keep using absolute `CONTENT_API_URL` in `getContentApiBase()` (server branch).
 *
 * Node's fetch (Undici) defaults to ~5m headers timeout — POST /sync can run much longer
 * (baseline + many competitor scrapes). Use a long-lived agent for this proxy only.
 */
export const runtime = "nodejs";

const BACKEND_PROXY_AGENT = new Agent({
  connectTimeout: 120_000,
  headersTimeout: 1_800_000, // 30 min
  bodyTimeout: 1_800_000,
});

function backendBase(): string {
  return (
    process.env.CONTENT_API_URL ||
    process.env.NEXT_PUBLIC_CONTENT_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://127.0.0.1:8787"
  );
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxyRequest(req: NextRequest, pathSegments: string[]) {
  if (pathSegments.length < 2 || pathSegments[0] !== "api") {
    return new NextResponse("Not found", { status: 404 });
  }

  const path = pathSegments.join("/");
  const base = backendBase().replace(/\/$/, "");
  const target = `${base}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers.set(key, value);
  }

  const method = req.method;
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    body = await req.arrayBuffer();
  }

  let upstream: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    upstream = await undiciFetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      dispatcher: BACKEND_PROXY_AGENT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isConn =
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|socket/i.test(message);
    return NextResponse.json(
      {
        error: "Upstream API unreachable",
        detail: message,
        backendBase: base,
        hint: isConn
          ? "Start the FastAPI server (e.g. `npm run dev:api` from repo root) or set CONTENT_API_URL / NEXT_PUBLIC_CONTENT_API_URL."
          : undefined,
      },
      { status: 502 },
    );
  }

  const res = new NextResponse(upstream.body as unknown as BodyInit, {
    status: upstream.status,
    statusText: upstream.statusText,
  });

  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "transfer-encoding" || k === "connection") return;
    res.headers.set(key, value);
  });

  res.headers.set("X-Proxied-By", "content-machine-next");

  return res;
}

type RouteCtx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  const segments = path ?? [];
  return proxyRequest(req, segments);
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
